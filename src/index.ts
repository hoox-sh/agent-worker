import { ScheduledEvent } from "@cloudflare/workers-types";
import { ProviderManager, createProviderManager } from "./providers";
import { AIRequest } from "./types";
import { ALL_MODELS } from "./models";
import {
  requireInternalAuth,
  checkInternalAuth,
  createInternalAuthMiddleware,
} from "@jango-blockchained/hoox-shared/middleware";
import {
  Errors,
  createJsonResponse,
  toError,
} from "@jango-blockchained/hoox-shared/errors";
import { healthCheck } from "@jango-blockchained/hoox-shared/health";
import { KVKeys } from "@jango-blockchained/hoox-shared/kvKeys";
import { createRouter } from "@jango-blockchained/hoox-shared/router";
import {
  createLogger,
  withRequestLog,
} from "@jango-blockchained/hoox-shared/middleware";
import { serviceFetch } from "@jango-blockchained/hoox-shared/service-bindings";

// Re-export for backward compatibility with tests
export { requireInternalAuth, checkInternalAuth };

const logger = createLogger({ service: "agent-worker" });

export interface Env extends Cloudflare.Env {
  [key: string]: unknown;
}

function getProviderManager(env: Env): ProviderManager {
  return createProviderManager(env);
}

export async function fetchMarkPrice(
  exchange: string,
  symbol: string
): Promise<number | null> {
  try {
    const ex = exchange.toLowerCase();
    let sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");

    if (ex === "binance") {
      const res = await fetch(
        `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`
      );
      if (res.ok) {
        const data: any = await res.json();
        return parseFloat(data.markPrice);
      }
    } else if (ex === "bybit") {
      const res = await fetch(
        `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${sym}`
      );
      if (res.ok) {
        const data: any = await res.json();
        if (data?.result?.list?.[0]?.markPrice) {
          return parseFloat(data.result.list[0].markPrice);
        }
      }
    } else if (ex === "mexc") {
      if (sym.endsWith("USDT") && !sym.includes("_")) {
        sym = sym.replace("USDT", "_USDT");
      }
      const res = await fetch(
        `https://contract.mexc.com/api/v1/contract/detail?symbol=${sym}`
      );
      if (res.ok) {
        const data: any = await res.json();
        if (data?.data?.fairPrice) {
          return parseFloat(data.data.fairPrice);
        }
      }
    }
  } catch (error: unknown) {
    logger.error(`Failed to fetch mark price for ${symbol} on ${exchange}`, {
      error: toError(error),
    });
  }
  return null;
}

const router = createRouter<Env>();
const requireAuth = createInternalAuthMiddleware();

// --- Routes ---

router.post(
  "/agent/housekeeping",
  async (request: Request, env: Env, ctx: ExecutionContext) => {
    try {
      const results = await runHousekeeping(env);
      return createJsonResponse(results, 200);
    } catch (error: unknown) {
      return Errors.internal(error);
    }
  },
  [requireAuth]
);

router.post(
  "/agent/risk-override",
  async (request: Request, env: Env, ctx: ExecutionContext) => {
    const body: any = await request.json();
    if (body.trailingStopPercent !== undefined) {
      await env.CONFIG_KV.put(
        KVKeys.KV_TRADE_TRAILING_STOP_PERCENT,
        body.trailingStopPercent.toString()
      );
    }
    return createJsonResponse({
      success: true,
      message: "Risk override applied",
    });
  },
  [requireAuth]
);

router.get(
  "/agent/status",
  async (request: Request, env: Env, ctx: ExecutionContext) => {
    const pm = getProviderManager(env);
    const config = await pm.loadConfig();
    return createJsonResponse({
      success: true,
      status: "Healthy",
      config: {
        defaultProvider: config.defaultProvider,
        fallbackChain: config.fallbackChain,
        modelMap: config.modelMap,
      },
      activeTrailingStops: await getActiveTrailingStops(env),
    });
  },
  [requireAuth]
);

router.get(
  "/agent/config",
  async (request: Request, env: Env, ctx: ExecutionContext) => {
    const pm = getProviderManager(env);
    const config = await pm.loadConfig();
    return createJsonResponse({
      success: true,
      config,
    });
  },
  [requireAuth]
);

router.post(
  "/agent/config",
  async (request: Request, env: Env, ctx: ExecutionContext) => {
    const body: any = await request.json();
    const pm = getProviderManager(env);
    const updated = await pm.updateConfig(body);
    return createJsonResponse({ success: true, config: updated });
  },
  [requireAuth]
);

router.post(
  "/agent/test-model",
  async (request: Request, env: Env, ctx: ExecutionContext) => {
    const body: any = await request.json();
    const pm = getProviderManager(env);
    const provider = body.provider || "workers-ai";
    const model = body.model;

    const testRequest: AIRequest = {
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        {
          role: "user",
          content: body.prompt || 'Say "Hello" if you can hear me.',
        },
      ],
      model,
    };

    const result = await pm.run(testRequest);
    return createJsonResponse(
      {
        success: result.success,
        provider: result.provider,
        model: result.model,
        response: result.data?.response,
        error: result.error,
        latencyMs: result.latencyMs,
      },
      result.success ? 200 : 502
    );
  },
  [requireAuth]
);

router.get(
  "/agent/health",
  async (request: Request, env: Env, ctx: ExecutionContext) => {
    const pm = getProviderManager(env);
    const status = await pm.getProviderStatus();
    return createJsonResponse({
      success: true,
      providers: status,
    });
  }
);

router.get(
  "/agent/models",
  async (request: Request, env: Env, ctx: ExecutionContext) => {
    return createJsonResponse({
      success: true,
      models: ALL_MODELS,
    });
  },
  [requireAuth]
);

router.post(
  "/agent/chat",
  async (request: Request, env: Env, ctx: ExecutionContext) => {
    const body: any = await request.json();
    const pm = getProviderManager(env);
    const testRequest: AIRequest = {
      messages: body.messages || [
        {
          role: "system",
          content: body.systemPrompt || "You are a helpful trading assistant.",
        },
        { role: "user", content: body.prompt },
      ],
      temperature: body.temperature,
      maxTokens: body.maxTokens,
    };

    const result = await pm.run(testRequest);
    return createJsonResponse(
      {
        success: result.success,
        response: result.data?.response,
        model: result.model,
        provider: result.provider,
        error: result.error,
      },
      result.success ? 200 : 502
    );
  },
  [requireAuth]
);

router.post(
  "/agent/embedding",
  async (request: Request, env: Env, ctx: ExecutionContext) => {
    const body: any = await request.json();
    const pm = getProviderManager(env);
    const result = await pm.runEmbedding(body.text, body.provider);
    return createJsonResponse(
      {
        success: result.success,
        embedding: result.data?.response,
        model: result.model,
        error: result.error,
      },
      result.success ? 200 : 502
    );
  },
  [requireAuth]
);

// Root endpoint
router.get("/", async () => {
  return new Response("Agent Worker is running");
});

router.get(
  "/health",
  async (request: Request, env: Env, ctx: ExecutionContext) => {
    return healthCheck({ worker: "agent-worker" });
  }
);

export default {
  fetch: withRequestLog(
    (request: Request, env: Env, ctx: ExecutionContext) => {
      return router.handle(request, env, ctx);
    },
    { service: "agent-worker", module: "router" }
  ),

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    logger.info("Agent Worker cron triggered", {
      cron: event.cron,
      scheduledTime: event.scheduledTime,
    });
    ctx.waitUntil(runHousekeeping(env));
    ctx.waitUntil(this.processRoutine(env));
  },

  async processRoutine(env: Env) {
    try {
      logger.info("Starting agent processing routine...");

      const positionsRes = await serviceFetch(
        env.D1_SERVICE,
        "/api/dashboard/positions",
        undefined,
        { method: "GET" }
      );
      if (!positionsRes.ok) {
        logger.error("Failed to fetch positions from D1_SERVICE", {
          status: await positionsRes.text(),
        });
        return;
      }

      const positionsData: any = await positionsRes.json();
      const openPositions = positionsData.positions || [];
      logger.info(`Found ${openPositions.length} open positions.`);

      const killSwitch = await env.CONFIG_KV.get(KVKeys.KV_TRADE_KILL_SWITCH);
      if (killSwitch === "true") {
        logger.warn(
          "Global kill switch is active. Skipping active trade management."
        );
        return;
      }

      const pm = getProviderManager(env);
      const config = await pm.loadConfig();

      let totalUnrealizedPnl = 0;
      let accountValue = 10000;

      try {
        const balancesRes = await serviceFetch(
          env.D1_SERVICE,
          "/api/dashboard/balances",
          undefined,
          { method: "GET" }
        );
        if (balancesRes.ok) {
          const balancesData = (await balancesRes.json()) as {
            totalBalance?: number;
          };
          if (balancesData.totalBalance && balancesData.totalBalance > 0) {
            accountValue = balancesData.totalBalance;
            logger.info(
              `[ActiveTradeManagement] Using account value from balances: ${accountValue}`
            );
          }
        }
      } catch (err: unknown) {
        logger.warn(
          `[ActiveTradeManagement] Failed to fetch account value from D1, using default: ${err}`
        );
      }

      for (const position of openPositions) {
        logger.info(
          `Analyzing position: ${position.symbol} (${position.side}) - Quantity: ${position.size}`
        );

        const markPrice = await fetchMarkPrice(
          position.exchange,
          position.symbol
        );

        if (markPrice !== null) {
          logger.info(
            `${position.exchange} ${position.symbol} Mark Price: ${markPrice}`
          );
          if (position.entry_price && position.size) {
            const priceDiff =
              position.side === "LONG"
                ? markPrice - position.entry_price
                : position.entry_price - markPrice;
            const pnl = priceDiff * position.size;
            totalUnrealizedPnl += pnl;
            logger.info(`Unrealized PnL for ${position.symbol}: ${pnl}`);

            const wmKey = `trade:watermark:${position.exchange}:${position.symbol}:${position.side}`;
            const currentWmStr = await env.CONFIG_KV.get(wmKey);
            const currentWm = currentWmStr
              ? parseFloat(currentWmStr)
              : position.entry_price;

            let newWm = currentWm;
            if (position.side === "LONG" && markPrice > currentWm)
              newWm = markPrice;
            if (position.side === "SHORT" && markPrice < currentWm)
              newWm = markPrice;

            if (newWm !== currentWm) {
              await env.CONFIG_KV.put(wmKey, newWm.toString());
            }

            const trailingStopPercent = config.trailingStopPercent;
            let triggerStop = false;
            if (
              position.side === "LONG" &&
              markPrice < newWm * (1 - trailingStopPercent)
            )
              triggerStop = true;
            if (
              position.side === "SHORT" &&
              markPrice > newWm * (1 + trailingStopPercent)
            )
              triggerStop = true;

            if (triggerStop) {
              logger.info(
                `TRAILING STOP TRIGGERED for ${position.symbol}! Watermark: ${newWm}, Current: ${markPrice}`
              );
              await sendCloseOrder(env, position);
            }

            const tpPercent = config.takeProfitPercent;
            let triggerTp = false;
            if (
              position.side === "LONG" &&
              markPrice > position.entry_price * (1 + tpPercent)
            )
              triggerTp = true;
            if (
              position.side === "SHORT" &&
              markPrice < position.entry_price * (1 - tpPercent)
            )
              triggerTp = true;

            if (triggerTp) {
              const tpKey = `trade:tp_hit:${position.exchange}:${position.symbol}:${position.side}`;
              const alreadyScaled = await env.CONFIG_KV.get(tpKey);
              if (!alreadyScaled) {
                logger.info(
                  `TAKE PROFIT TRIGGERED for ${position.symbol}! Scaling out 50%.`
                );
                await sendCloseOrder(env, position, position.size / 2);
                await env.CONFIG_KV.put(tpKey, "true");
              }
            }
          }
        }
      }

      const maxDrawdownPercentStr = await env.CONFIG_KV.get(
        KVKeys.KV_TRADE_MAX_DAILY_DRAWDOWN_PERCENT
      );
      const maxDrawdownPercent = maxDrawdownPercentStr
        ? parseFloat(maxDrawdownPercentStr)
        : config.maxDailyDrawdownPercent;

      const pnlPercent = (totalUnrealizedPnl / accountValue) * 100;
      if (pnlPercent <= maxDrawdownPercent) {
        logger.warn(
          `GLOBAL RISK BREACH: PnL is ${pnlPercent}%, limit is ${maxDrawdownPercent}%. Engaging kill switch.`
        );
        await env.CONFIG_KV.put(KVKeys.KV_TRADE_KILL_SWITCH, "true");

        if (env.TELEGRAM_SERVICE) {
          await serviceFetch(env.TELEGRAM_SERVICE, "/webhook", {
            message: `🚨 EMERGENCY: Max daily drawdown reached (${pnlPercent.toFixed(2)}%). Global Kill Switch ENGAGED.`,
          });
        }
      }

      const currentMin = new Date().getMinutes();
      if (currentMin >= 0 && currentMin < 5) {
        try {
          const systemLogsRes = await serviceFetch(
            env.D1_SERVICE,
            "/api/dashboard/logs",
            undefined,
            { method: "GET" }
          );
          if (systemLogsRes.ok && env.AI) {
            const logsData: any = await systemLogsRes.json();
            const logs = logsData.logs || [];
            const recentLogsStr = JSON.stringify(logs.slice(0, 10));

            const systemPrompt =
              "You are a professional trading system observer. Summarize the following system logs and give a 1 sentence health update.";
            const aiRequest: AIRequest = {
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Recent Logs: ${recentLogsStr}` },
              ],
            };

            const result = await pm.run(aiRequest);
            if (result.success && result.data?.response) {
              logger.info("AI System Health Summary", {
                response: result.data.response,
              });
              await env.CONFIG_KV.put(
                KVKeys.KV_DASHBOARD_AI_HEALTH_SUMMARY,
                result.data.response
              );

              if (env.TELEGRAM_SERVICE) {
                await serviceFetch(env.TELEGRAM_SERVICE, "/webhook", {
                  message: `🧠 AI System Health Update:\n${result.data.response}`,
                });
              }
            }
          }
        } catch (e: unknown) {
          logger.error("AI summarization failed", { error: toError(e) });
        }
      }
    } catch (error: unknown) {
      logger.error("Error in agent processing routine", {
        error: toError(error),
      });
    }
  },
};

/**
 * Queries KV for active trailing stop watermark keys.
 * Lists all keys with the "trade:watermark:" prefix and returns their names.
 * Returns an empty array if none exist or if KV is unavailable.
 */
async function getActiveTrailingStops(env: Env): Promise<string[]> {
  try {
    const stopsList = await env.CONFIG_KV.list({ prefix: "trade:watermark:" });
    return stopsList.keys.map((k) => k.name);
  } catch (error: unknown) {
    logger.warn("Failed to list active trailing stops from KV", {
      error: toError(error),
    });
    return [];
  }
}

async function runHousekeeping(env: Env): Promise<Record<string, unknown>> {
  const results: {
    timestamp: string;
    checks: Array<{ service: string; status: string; detail: unknown }>;
  } = {
    timestamp: new Date().toISOString(),
    checks: [],
  };

  try {
    // CONFIG_KV write/read test
    await env.CONFIG_KV.put(KVKeys.KV_HEALTH_CHECK, new Date().toISOString());
    const kvTest = await env.CONFIG_KV.get(KVKeys.KV_HEALTH_CHECK);
    results.checks.push({
      service: "CONFIG_KV",
      status: "ok",
      detail: kvTest ? "readable" : "empty",
    });

    if (env.D1_SERVICE) {
      try {
        const d1Res = await serviceFetch(env.D1_SERVICE, "/health", undefined, {
          method: "GET",
        });
        results.checks.push({
          service: "D1_SERVICE",
          status: d1Res.ok ? "ok" : "error",
          detail: d1Res.status,
        });
      } catch (error: unknown) {
        results.checks.push({
          service: "D1_SERVICE",
          status: "error",
          detail: String(error),
        });
      }
    }

    if (env.TRADE_SERVICE) {
      try {
        const tradeRes = await serviceFetch(
          env.TRADE_SERVICE,
          "/health",
          undefined,
          { method: "GET" }
        );
        results.checks.push({
          service: "TRADE_SERVICE",
          status: tradeRes.ok ? "ok" : "error",
          detail: tradeRes.status,
        });
      } catch (error: unknown) {
        results.checks.push({
          service: "TRADE_SERVICE",
          status: "error",
          detail: String(error),
        });
      }
    }

    if (env.TELEGRAM_SERVICE) {
      try {
        const tgRes = await serviceFetch(
          env.TELEGRAM_SERVICE,
          "/health",
          undefined,
          { method: "GET" }
        );
        results.checks.push({
          service: "TELEGRAM_SERVICE",
          status: tgRes.ok ? "ok" : "error",
          detail: tgRes.status,
        });
      } catch (error: unknown) {
        results.checks.push({
          service: "TELEGRAM_SERVICE",
          status: "error",
          detail: String(error),
        });
      }
    }

    await env.CONFIG_KV.put(
      KVKeys.KV_HOUSEKEEPING_LAST_CHECK,
      JSON.stringify(results)
    );
    logger.info("Housekeeping check completed", { results });
  } catch (error: unknown) {
    logger.error("Housekeeping check failed", { error: toError(error) });
    throw error;
  }

  return results;
}

async function sendCloseOrder(env: Env, position: any, qtyOverride?: number) {
  const action = position.side === "LONG" ? "CLOSE_LONG" : "CLOSE_SHORT";
  const quantity = qtyOverride || position.size;
  const payload = {
    exchange: position.exchange,
    symbol: position.symbol,
    action: action,
    quantity: quantity,
  };

  try {
    logger.info("Sending close order to TRADE_SERVICE", { payload });

    const internalKey = env.INTERNAL_KEY_BINDING || env.AGENT_INTERNAL_KEY;
    if (!internalKey) {
      logger.error("INTERNAL_KEY_BINDING not configured for close order");
      return;
    }

    const res = await serviceFetch(env.TRADE_SERVICE, "/webhook", payload, {
      headers: { "X-Internal-Auth-Key": internalKey },
    });
    if (!res.ok) {
      logger.error(`Failed to close position ${position.symbol}`, {
        status: await res.text(),
      });
    }
  } catch (e: unknown) {
    logger.error(`Error closing position ${position.symbol}`, {
      error: toError(e),
    });
  }
}

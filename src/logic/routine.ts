import { toError } from "@jango-blockchained/hoox-shared/errors";
import { KVKeys } from "@jango-blockchained/hoox-shared/kvKeys";
import { serviceFetch } from "@jango-blockchained/hoox-shared/service-bindings";
import { trackAnalytics } from "@jango-blockchained/hoox-shared/analytics";
import type { Logger } from "@jango-blockchained/hoox-shared/middleware";
import type { ProviderManager } from "../providers";
import { AIRequest } from "../types";
import { fetchMarkPrice, sendCloseOrder } from "./trade";

// --- Minimal env interface for processRoutine ---
export interface RoutineEnv {
  D1_SERVICE: Fetcher;
  CONFIG_KV: KVNamespace;
  TELEGRAM_SERVICE: Fetcher;
  ANALYTICS_SERVICE: Fetcher;
  TRADE_SERVICE?: Fetcher;
  INTERNAL_KEY_BINDING?: string;
  AGENT_INTERNAL_KEY?: string;
  AI?: Ai;
}

/**
 * Main agent processing routine.
 */
export async function processRoutine(
  env: RoutineEnv,
  logger: Logger,
  options: {
    getProviderManager: (env: RoutineEnv) => ProviderManager;
    getActiveTrailingStops: (env: RoutineEnv) => Promise<string[]>;
  }
) {
  const { getProviderManager } = options;

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

    const positionsData = (await positionsRes.json()) as {
      positions: Array<{
        exchange: string;
        symbol: string;
        side: "LONG" | "SHORT";
        size: number;
        entry_price: number;
      }>;
    };
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

    // Batch all mark price fetches in parallel before the loop
    const markPriceResults = await Promise.all(
      openPositions.map((pos) =>
        fetchMarkPrice(pos.exchange, pos.symbol, logger)
      )
    );
    const markPriceMap = new Map<number, number | null>();
    openPositions.forEach((pos, i) => {
      markPriceMap.set(i, markPriceResults[i]);
    });

    // Batch all KV watermark reads in parallel before the loop
    const watermarkKeys = openPositions.map(
      (pos) => `trade:watermark:${pos.exchange}:${pos.symbol}:${pos.side}`
    );
    const wmResults = await Promise.all(
      watermarkKeys.map((key) => env.CONFIG_KV.get(key))
    );
    const watermarkMap = new Map<number, string | null>();
    wmResults.forEach((val, i) => {
      watermarkMap.set(i, val);
    });

    // Batch all TP hit KV reads in parallel
    const tpKeys = openPositions.map(
      (pos) => `trade:tp_hit:${pos.exchange}:${pos.symbol}:${pos.side}`
    );
    const tpResults = await Promise.all(
      tpKeys.map((key) => env.CONFIG_KV.get(key))
    );
    const tpHitMap = new Map<number, string | null>();
    tpResults.forEach((val, i) => {
      tpHitMap.set(i, val);
    });

    // Process positions sequentially for state-dependent writes
    for (let i = 0; i < openPositions.length; i++) {
      const position = openPositions[i];
      logger.info(
        `Analyzing position: ${position.symbol} (${position.side}) - Quantity: ${position.size}`
      );

      const markPrice = markPriceMap.get(i) ?? null;

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

          const currentWmStr = watermarkMap.get(i) ?? null;
          const currentWm = currentWmStr
            ? parseFloat(currentWmStr)
            : position.entry_price;

          let newWm = currentWm;
          if (position.side === "LONG" && markPrice > currentWm)
            newWm = markPrice;
          if (position.side === "SHORT" && markPrice < currentWm)
            newWm = markPrice;

          const wmKey = `trade:watermark:${position.exchange}:${position.symbol}:${position.side}`;
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
            await sendCloseOrder(env, position, logger);
            void trackAnalytics(env, "/track/trailing-stop", {
              exchange: position.exchange,
              symbol: position.symbol,
              side: position.side,
              watermark: newWm,
              currentPrice: markPrice,
              trigger: "trailing_stop",
            });
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
            const alreadyScaled = tpHitMap.get(i) ?? null;
            if (!alreadyScaled) {
              const tpKey = `trade:tp_hit:${position.exchange}:${position.symbol}:${position.side}`;
              logger.info(
                `TAKE PROFIT TRIGGERED for ${position.symbol}! Scaling out 50%.`
              );
              await sendCloseOrder(env, position, logger, position.size / 2);
              await env.CONFIG_KV.put(tpKey, "true");
              void trackAnalytics(env, "/track/take-profit", {
                exchange: position.exchange,
                symbol: position.symbol,
                side: position.side,
                entryPrice: position.entry_price,
                currentPrice: markPrice,
                scaledQuantity: position.size / 2,
              });
            }
          }
        }
      }
    }

    // Global Risk Management
    const pnlPercent = (totalUnrealizedPnl / accountValue) * 100;
    const maxDrawdownPercent = config.maxDailyDrawdownPercent;

    logger.info(
      `Total Unrealized PnL: ${totalUnrealizedPnl} (${pnlPercent.toFixed(2)}%)`
    );

    if (pnlPercent < maxDrawdownPercent) {
      logger.error(
        `GLOBAL RISK BREACH: PnL is ${pnlPercent}%, limit is ${maxDrawdownPercent}%. Engaging kill switch.`
      );
      await env.CONFIG_KV.put(KVKeys.KV_TRADE_KILL_SWITCH, "true");
      void trackAnalytics(env, "/track/kill-switch", {
        trigger: "max_drawdown",
        pnlPercent: pnlPercent.toFixed(2),
        limit: maxDrawdownPercent,
        totalUnrealizedPnl,
        accountValue,
      });

      if (env.TELEGRAM_SERVICE) {
        await serviceFetch(
          env.TELEGRAM_SERVICE,
          "/alert",
          {
            message: `🚨 EMERGENCY: Max daily drawdown reached (${pnlPercent.toFixed(2)}%). Global Kill Switch ENGAGED.`,
          },
          {
            headers: env.INTERNAL_KEY_BINDING
              ? { "X-Internal-Auth-Key": env.INTERNAL_KEY_BINDING }
              : undefined,
          }
        );
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
          const logsData = (await systemLogsRes.json()) as {
            logs: Array<{ message: string; level: string; timestamp: string }>;
          };
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

          const aiTimeoutMs = 15000;
          const aiResultPromise = pm.run(aiRequest);
          const aiTimeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(
              () =>
                reject(new Error(`AI call timed out after ${aiTimeoutMs}ms`)),
              aiTimeoutMs
            );
          });
          const result = await Promise.race([
            aiResultPromise,
            aiTimeoutPromise,
          ]);
          if (result.success && result.data?.response) {
            logger.info("AI System Health Summary", {
              response: result.data.response,
            });
            await env.CONFIG_KV.put(
              KVKeys.KV_DASHBOARD_AI_HEALTH_SUMMARY,
              result.data.response
            );

            if (env.TELEGRAM_SERVICE) {
              await serviceFetch(
                env.TELEGRAM_SERVICE,
                "/alert",
                {
                  message: `🧠 AI System Health Update:\n${result.data.response}`,
                },
                {
                  headers: env.INTERNAL_KEY_BINDING
                    ? { "X-Internal-Auth-Key": env.INTERNAL_KEY_BINDING }
                    : undefined,
                }
              );
            }
          }
        }
      } catch (logErr: unknown) {
        logger.warn("Failed to generate AI health summary", {
          error: toError(logErr),
        });
      }
    }
  } catch (error: unknown) {
    logger.error("Error in agent routine", { error: toError(error) });
  }
}

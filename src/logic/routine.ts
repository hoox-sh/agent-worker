import { toError } from "@jango-blockchained/hoox-shared/errors";
import { KVKeys } from "@jango-blockchained/hoox-shared/kvKeys";
import { serviceFetch } from "@jango-blockchained/hoox-shared/service-bindings";
import { AIRequest } from "../types";
import { fetchMarkPrice, sendCloseOrder } from "./trade";

/**
 * Main agent processing routine.
 */
export async function processRoutine(
  env: any,
  logger: any,
  options: {
    getProviderManager: (env: any) => any;
    getActiveTrailingStops: (env: any) => Promise<string[]>;
  }
) {
  const { getProviderManager, getActiveTrailingStops } = options;

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

    for (const position of openPositions) {
      logger.info(
        `Analyzing position: ${position.symbol} (${position.side}) - Quantity: ${position.size}`
      );

      const markPrice = await fetchMarkPrice(
        position.exchange,
        position.symbol,
        logger
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
            await sendCloseOrder(env, position, logger);
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
              await sendCloseOrder(env, position, logger, position.size / 2);
              await env.CONFIG_KV.put(tpKey, "true");
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

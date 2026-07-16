import { toError } from "@jango-blockchained/hoox-shared/errors";
import { type Logger } from "@jango-blockchained/hoox-shared/middleware";
import { authenticatedServiceFetch } from "@jango-blockchained/hoox-shared/service-bindings";

/** Minimal env shape required by sendCloseOrder. */
interface CloseOrderEnv {
  AGENT_INTERNAL_KEY?: string;
  TRADE_SERVICE?: Fetcher;
}

/**
 * Fetches the current mark price for a symbol from an exchange.
 */
export async function fetchMarkPrice(
  exchange: string,
  symbol: string,
  logger: Logger
): Promise<number | null> {
  try {
    const ex = exchange.toLowerCase();
    let sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");

    if (ex === "binance") {
      const res = await fetch(
        `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const data = (await res.json()) as { markPrice: string };
        return parseFloat(data.markPrice);
      }
    } else if (ex === "bybit") {
      const res = await fetch(
        `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${sym}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const data = (await res.json()) as {
          result: { list: Array<{ markPrice: string }> };
        };
        if (data?.result?.list?.[0]?.markPrice) {
          return parseFloat(data.result.list[0].markPrice);
        }
      }
    } else if (ex === "mexc") {
      if (sym.endsWith("USDT") && !sym.includes("_")) {
        sym = sym.replace("USDT", "_USDT");
      }
      const res = await fetch(
        `https://contract.mexc.com/api/v1/contract/detail?symbol=${sym}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const data = (await res.json()) as { data: { fairPrice: string } };
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

/**
 * Sends a close order to the TRADE_SERVICE.
 */
export async function sendCloseOrder(
  env: CloseOrderEnv,
  position: {
    exchange: string;
    symbol: string;
    side: "LONG" | "SHORT";
    size: number;
  },
  logger: Logger,
  qtyOverride?: number
) {
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

    const internalKey = env.AGENT_INTERNAL_KEY;
    if (!internalKey) {
      logger.error("AGENT_INTERNAL_KEY not configured for close order");
      return;
    }

    if (!env.TRADE_SERVICE) {
      logger.error("TRADE_SERVICE binding not configured for close order");
      return;
    }
    const res = await authenticatedServiceFetch(
      env.TRADE_SERVICE,
      { INTERNAL_KEY_BINDING: internalKey },
      "/webhook",
      payload
    );
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

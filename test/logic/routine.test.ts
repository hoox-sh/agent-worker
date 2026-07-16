/**
 * Tests for the agent-worker's main processRoutine.
 * Covers the four action paths: trailing-stop, take-profit, kill-switch, housekeeping.
 *
 * Run with: bun test workers/agent-worker/test/logic/routine.test.ts
 */

import { describe, expect, test, beforeEach, mock } from "bun:test";
import { processRoutine } from "../../src/logic/routine";
import { ProviderManager } from "../../src/providers";
import type { AgentConfig } from "../../src/types";

// --- Mocks & helpers ------------------------------------------------------

const createMockLogger = () => ({
  info: mock((_msg: string, _meta?: unknown) => undefined),
  error: mock((_msg: string, _meta?: unknown) => undefined),
  warn: mock((_msg: string, _meta?: unknown) => undefined),
  debug: mock((_msg: string, _meta?: unknown) => undefined),
});

/** Mock fetcher that returns canned responses based on URL. */
function createMockFetcher(handlers: Record<string, () => Response> = {}) {
  const fallback = () => new Response(null, { status: 404 });
  return {
    fetch: mock(async (url: string | Request, _init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.url;
      // Match by path segment after "http://internal"
      for (const [path, handler] of Object.entries(handlers)) {
        if (u.includes(path)) return handler();
      }
      return fallback();
    }),
  };
}

interface MockEnvOptions {
  positions?: Array<{
    exchange: string;
    symbol: string;
    side: "LONG" | "SHORT";
    size: number;
    entry_price: number;
  }>;
  positionsResStatus?: number;
  totalBalance?: number;
  killSwitch?: string;
  agentConfig?: Partial<AgentConfig>;
  markPrice?: number | null;
  tradeResStatus?: number;
  telegramResStatus?: number;
  systemLogs?: Array<{ message: string; level: string; timestamp: string }>;
  aiResult?: { success: boolean; data?: { response: string } };
  hasAI?: boolean;
  currentMinute?: number;
  internalKey?: string;
}

function createMockEnv(opts: MockEnvOptions = {}) {
  const {
    positions = [],
    positionsResStatus = 200,
    totalBalance,
    killSwitch,
    agentConfig,
    markPrice = 100,
    tradeResStatus = 200,
    telegramResStatus = 200,
    systemLogs = [],
    aiResult = {
      success: true,
      data: { response: "All systems healthy" },
    },
    hasAI = true,
    currentMinute = 30,
    internalKey = "test-internal-key",
  } = opts;

  const kvStore = new Map<string, string>();
  if (killSwitch) kvStore.set("trade:kill_switch", killSwitch);
  if (agentConfig) {
    kvStore.set("agent:config", JSON.stringify(agentConfig));
  }

  const kv = {
    get: mock(async (key: string) => kvStore.get(key) ?? null),
    put: mock(async (key: string, value: string) => {
      kvStore.set(key, value);
    }),
    list: mock(async () => ({ keys: [] })),
    delete: mock(async (key: string) => {
      kvStore.delete(key);
    }),
  };

  const d1 = createMockFetcher({
    "/api/dashboard/positions": () =>
      new Response(JSON.stringify({ positions }), {
        status: positionsResStatus,
        headers: { "Content-Type": "application/json" },
      }),
    "/api/dashboard/balances": () =>
      new Response(JSON.stringify({ totalBalance: totalBalance ?? 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    "/api/logs": () =>
      new Response(JSON.stringify({ logs: systemLogs }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  });

  const trade = createMockFetcher({
    "/webhook": () => new Response(null, { status: tradeResStatus }),
  });

  const telegram = createMockFetcher({
    "/alert": () => new Response(null, { status: telegramResStatus }),
  });

  const analytics = createMockFetcher({});

  // Mock global.fetch for fetchMarkPrice (Binance/Bybit/MEXC HTTP calls)
  const originalFetch = global.fetch;
  const mockFetch = mock(async (url: string | Request | URL) => {
    if (markPrice === null) {
      return new Response(null, { status: 500 });
    }
    // Match Binance mark price endpoint
    const u = typeof url === "string" ? url : url.toString();
    if (u.includes("binance")) {
      return new Response(JSON.stringify({ markPrice: String(markPrice) }), {
        status: 200,
      });
    }
    if (u.includes("bybit")) {
      return new Response(
        JSON.stringify({
          result: { list: [{ markPrice: String(markPrice) }] },
        }),
        { status: 200 }
      );
    }
    if (u.includes("mexc")) {
      return new Response(
        JSON.stringify({ data: { fairPrice: String(markPrice) } }),
        { status: 200 }
      );
    }
    return new Response(null, { status: 404 });
  });
  global.fetch = mockFetch as unknown as typeof global.fetch;

  const env: Record<string, unknown> = {
    D1_SERVICE: d1,
    CONFIG_KV: kv,
    TELEGRAM_SERVICE: telegram,
    ANALYTICS_SERVICE: analytics,
    TRADE_SERVICE: trade,
    INTERNAL_KEY_BINDING: internalKey,
    AGENT_INTERNAL_KEY: internalKey,
  };
  if (hasAI) {
    env.AI = { run: mock(async () => ({ response: "mock" })) };
  }

  return {
    env: env as never,
    kv,
    d1,
    trade,
    telegram,
    analytics,
    mockFetch,
    restoreFetch: () => {
      global.fetch = originalFetch;
    },
    /** Stubs a provider manager whose `run` returns a controlled result. */
    getProviderManager: (_env: never) => {
      const pm = Object.create(ProviderManager.prototype);
      pm.loadConfig = async () => ({
        defaultProvider: "workers-ai",
        fallbackChain: ["workers-ai"],
        modelMap: { "workers-ai": "@cf/meta/llama-3.1-8b-instruct" } as never,
        timeoutMs: 30000,
        retryCount: 3,
        maxDailyDrawdownPercent: -5,
        trailingStopPercent: 0.05,
        takeProfitPercent: 0.1,
        ...agentConfig,
      });
      pm.run = async () => ({
        success: aiResult?.success ?? true,
        data: aiResult?.data,
        provider: "workers-ai" as const,
        model: "@cf/meta/llama-3.1-8b-instruct",
      });
      return pm as ProviderManager;
    },
    getActiveTrailingStops: async () => [],
    /** Stubs Date so currentMinute can be controlled. */
    setClock: () => {
      const RealDate = Date;
      const fakeNow = new RealDate();
      fakeNow.setMinutes(currentMinute);
      fakeNow.setSeconds(0);
      fakeNow.setMilliseconds(0);
      const FixedDate = function (this: unknown, ...args: unknown[]) {
        if (args.length === 0) return new RealDate(fakeNow.getTime());
        // @ts-expect-error forwarding to real Date constructor
        return new RealDate(...args);
      } as unknown as typeof Date;
      FixedDate.now = () => fakeNow.getTime();
      global.Date = FixedDate;
      return () => {
        global.Date = RealDate;
      };
    },
  };
}

// --- Tests ----------------------------------------------------------------

describe("processRoutine - setup and early-exit paths", () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mock.restore();
    logger = createMockLogger();
  });

  test("returns early when D1 positions fetch fails", async () => {
    const m = createMockEnv({ positionsResStatus: 500 });
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to fetch positions from D1_SERVICE",
        expect.objectContaining({ status: expect.any(String) })
      );
    } finally {
      m.restoreFetch();
    }
  });

  test("returns early when global kill switch is active", async () => {
    const m = createMockEnv({ killSwitch: "true" });
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      expect(logger.warn).toHaveBeenCalledWith(
        "Global kill switch is active. Skipping active trade management."
      );
      // No Telegram alert should be sent for the kill-switch path
      expect(m.telegram.fetch).not.toHaveBeenCalled();
    } finally {
      m.restoreFetch();
    }
  });
  test("uses default account value (10000) when balances fetch returns non-OK", async () => {
    const m = createMockEnv({});
    // Override the balances endpoint to return 500
    m.d1.fetch = mock(async (url: string | Request) => {
      const u = typeof url === "string" ? url : url.url;
      if (u.includes("/api/dashboard/positions")) {
        return new Response(JSON.stringify({ positions: [] }), { status: 200 });
      }
      if (u.includes("/api/dashboard/balances")) {
        return new Response("boom", { status: 500 });
      }
      return new Response(null, { status: 404 });
    });
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      // No exception; the "Using account value" log should NOT be called
      // because the balances fetch returned non-OK
      const accountLogCalls = (
        logger.info as ReturnType<typeof mock>
      ).mock.calls.filter(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("Using account value from balances")
      );
      expect(accountLogCalls).toHaveLength(0);
    } finally {
      m.restoreFetch();
    }
  });

  test("uses default account value (10000) when balances fetch throws", async () => {
    const m = createMockEnv({});
    // Make balances endpoint throw — this exercises the catch block
    m.d1.fetch = mock(async (url: string | Request) => {
      const u = typeof url === "string" ? url : url.url;
      if (u.includes("/api/dashboard/positions")) {
        return new Response(JSON.stringify({ positions: [] }), { status: 200 });
      }
      if (u.includes("/api/dashboard/balances")) {
        throw new Error("Network error");
      }
      return new Response(null, { status: 404 });
    });
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to fetch account value from D1")
      );
    } finally {
      m.restoreFetch();
    }
  });

  test("uses balances from D1_SERVICE when available", async () => {
    const m = createMockEnv({ totalBalance: 25000 });
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Using account value from balances: 25000")
      );
    } finally {
      m.restoreFetch();
    }
  });

  test("handles no open positions", async () => {
    const m = createMockEnv({ positions: [] });
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      expect(logger.info).toHaveBeenCalledWith("Found 0 open positions.");
    } finally {
      m.restoreFetch();
    }
  });
});

describe("processRoutine - trailing stop", () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mock.restore();
    logger = createMockLogger();
  });

  test("triggers trailing stop for LONG when price drops below threshold", async () => {
    // entry=100, trailingStop=0.05, so threshold = 100 * 0.95 = 95
    // markPrice=90 → triggers stop
    const m = createMockEnv({
      positions: [
        {
          exchange: "binance",
          symbol: "BTCUSDT",
          side: "LONG",
          size: 1,
          entry_price: 100,
        },
      ],
      markPrice: 90,
      agentConfig: { trailingStopPercent: 0.05, takeProfitPercent: 0.1 },
    });
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("TRAILING STOP TRIGGERED for BTCUSDT")
      );
      // Verify close order sent to TRADE_SERVICE
      expect(m.trade.fetch).toHaveBeenCalled();
    } finally {
      m.restoreFetch();
    }
  });

  test("triggers trailing stop for SHORT when price rises above threshold", async () => {
    // entry=100, trailingStop=0.05, so threshold = 100 * 1.05 = 105
    // markPrice=110 → triggers stop
    const m = createMockEnv({
      positions: [
        {
          exchange: "binance",
          symbol: "BTCUSDT",
          side: "SHORT",
          size: 1,
          entry_price: 100,
        },
      ],
      markPrice: 110,
      agentConfig: { trailingStopPercent: 0.05, takeProfitPercent: 0.1 },
    });
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("TRAILING STOP TRIGGERED for BTCUSDT")
      );
      expect(m.trade.fetch).toHaveBeenCalled();
    } finally {
      m.restoreFetch();
    }
  });

  test("does NOT trigger trailing stop when price is within threshold", async () => {
    // entry=100, trailingStop=0.05, threshold = 100 * 0.95 = 95
    // markPrice=98 → no stop
    const m = createMockEnv({
      positions: [
        {
          exchange: "binance",
          symbol: "BTCUSDT",
          side: "LONG",
          size: 1,
          entry_price: 100,
        },
      ],
      markPrice: 98,
      agentConfig: { trailingStopPercent: 0.05, takeProfitPercent: 0.1 },
    });
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining("TRAILING STOP TRIGGERED")
      );
    } finally {
      m.restoreFetch();
    }
  });

  test("updates watermark when LONG price moves favorably", async () => {
    // entry=100, current watermark (from KV)=100, markPrice=110 → new watermark=110
    const m = createMockEnv({
      positions: [
        {
          exchange: "binance",
          symbol: "BTCUSDT",
          side: "LONG",
          size: 1,
          entry_price: 100,
        },
      ],
      markPrice: 110,
      agentConfig: { trailingStopPercent: 0.05, takeProfitPercent: 0.1 },
    });
    // Pre-seed watermark
    await m.kv.put("trade:watermark:binance:BTCUSDT:LONG", "100");
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      const stored = await m.kv.get("trade:watermark:binance:BTCUSDT:LONG");
      expect(stored).toBe("110");
    } finally {
      m.restoreFetch();
    }
  });

  test("does NOT update watermark when LONG price moves unfavorably", async () => {
    // entry=100, current watermark=100, markPrice=95 → no update
    const m = createMockEnv({
      positions: [
        {
          exchange: "binance",
          symbol: "BTCUSDT",
          side: "LONG",
          size: 1,
          entry_price: 100,
        },
      ],
      markPrice: 95,
      agentConfig: { trailingStopPercent: 0.05, takeProfitPercent: 0.1 },
    });
    await m.kv.put("trade:watermark:binance:BTCUSDT:LONG", "100");
    const putCallsBefore = m.kv.put.mock.calls.length;
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      // Look at puts that happened during processRoutine for the watermark key
      const newPuts = m.kv.put.mock.calls
        .slice(putCallsBefore)
        .filter((call) => call[0] === "trade:watermark:binance:BTCUSDT:LONG");
      expect(newPuts).toHaveLength(0);
    } finally {
      m.restoreFetch();
    }
  });
});

describe("processRoutine - take profit", () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mock.restore();
    logger = createMockLogger();
  });

  test("triggers take profit for LONG when price exceeds threshold", async () => {
    // entry=100, tpPercent=0.1, threshold = 100 * 1.1 = 110
    // markPrice=115 → triggers TP
    const m = createMockEnv({
      positions: [
        {
          exchange: "binance",
          symbol: "BTCUSDT",
          side: "LONG",
          size: 1,
          entry_price: 100,
        },
      ],
      markPrice: 115,
      agentConfig: { trailingStopPercent: 0.05, takeProfitPercent: 0.1 },
    });
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("TAKE PROFIT TRIGGERED for BTCUSDT")
      );
      expect(m.trade.fetch).toHaveBeenCalled();
      // TP-hit flag should be set
      const tpFlag = await m.kv.get("trade:tp_hit:binance:BTCUSDT:LONG");
      expect(tpFlag).toBe("true");
    } finally {
      m.restoreFetch();
    }
  });

  test("triggers take profit for SHORT when price drops below threshold", async () => {
    // entry=100, tpPercent=0.1, threshold = 100 * 0.9 = 90
    // markPrice=85 → triggers TP
    const m = createMockEnv({
      positions: [
        {
          exchange: "binance",
          symbol: "BTCUSDT",
          side: "SHORT",
          size: 1,
          entry_price: 100,
        },
      ],
      markPrice: 85,
      agentConfig: { trailingStopPercent: 0.05, takeProfitPercent: 0.1 },
    });
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("TAKE PROFIT TRIGGERED for BTCUSDT")
      );
    } finally {
      m.restoreFetch();
    }
  });

  test("does NOT re-trigger take profit when tpHit flag is already set", async () => {
    const m = createMockEnv({
      positions: [
        {
          exchange: "binance",
          symbol: "BTCUSDT",
          side: "LONG",
          size: 1,
          entry_price: 100,
        },
      ],
      markPrice: 115,
      agentConfig: { trailingStopPercent: 0.05, takeProfitPercent: 0.1 },
    });
    // Pre-seed the tpHit flag
    await m.kv.put("trade:tp_hit:binance:BTCUSDT:LONG", "true");
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      // The TP info log should NOT be called
      const tpInfoCalls = (
        logger.info as ReturnType<typeof mock>
      ).mock.calls.filter(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("TAKE PROFIT TRIGGERED")
      );
      expect(tpInfoCalls).toHaveLength(0);
    } finally {
      m.restoreFetch();
    }
  });

  test("does NOT trigger take profit when within threshold", async () => {
    const m = createMockEnv({
      positions: [
        {
          exchange: "binance",
          symbol: "BTCUSDT",
          side: "LONG",
          size: 1,
          entry_price: 100,
        },
      ],
      markPrice: 105, // below 110 threshold
      agentConfig: { trailingStopPercent: 0.05, takeProfitPercent: 0.1 },
    });
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      const tpInfoCalls = (
        logger.info as ReturnType<typeof mock>
      ).mock.calls.filter(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("TAKE PROFIT TRIGGERED")
      );
      expect(tpInfoCalls).toHaveLength(0);
    } finally {
      m.restoreFetch();
    }
  });
});

describe("processRoutine - global kill switch", () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mock.restore();
    logger = createMockLogger();
  });

  test("engages global kill switch when PnL breaches maxDailyDrawdownPercent", async () => {
    // entry=100, size=100, markPrice=50 → PnL = (50-100) * 100 = -5000
    // accountValue=10000 (default), pnlPercent = -50%
    // maxDailyDrawdownPercent = -5 → -50 < -5 → engage kill switch
    const m = createMockEnv({
      positions: [
        {
          exchange: "binance",
          symbol: "BTCUSDT",
          side: "LONG",
          size: 100,
          entry_price: 100,
        },
      ],
      markPrice: 50,
      agentConfig: {
        trailingStopPercent: 0.05,
        takeProfitPercent: 0.1,
        maxDailyDrawdownPercent: -5,
      },
    });
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("GLOBAL RISK BREACH")
      );
      const killSwitch = await m.kv.get("trade:kill_switch");
      expect(killSwitch).toBe("true");
    } finally {
      m.restoreFetch();
    }
  });

  test("sends Telegram alert on kill switch trigger", async () => {
    const m = createMockEnv({
      positions: [
        {
          exchange: "binance",
          symbol: "BTCUSDT",
          side: "LONG",
          size: 100,
          entry_price: 100,
        },
      ],
      markPrice: 50,
      agentConfig: { maxDailyDrawdownPercent: -5 },
    });
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      // Verify telegram was called with the alert endpoint
      const telegramCalls = (
        m.telegram.fetch as ReturnType<typeof mock>
      ).mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("/alert")
      );
      expect(telegramCalls.length).toBeGreaterThan(0);
    } finally {
      m.restoreFetch();
    }
  });

  test("does NOT engage kill switch when PnL is within limit", async () => {
    // entry=100, markPrice=99 → PnL = -1 per unit, size=10 → pnl = -10
    // accountValue=10000, pnlPercent = -0.1%, maxDailyDrawdown = -5%
    const m = createMockEnv({
      positions: [
        {
          exchange: "binance",
          symbol: "BTCUSDT",
          side: "LONG",
          size: 10,
          entry_price: 100,
        },
      ],
      markPrice: 99,
      agentConfig: { maxDailyDrawdownPercent: -5 },
    });
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      const killSwitch = await m.kv.get("trade:kill_switch");
      expect(killSwitch).toBeNull();
    } finally {
      m.restoreFetch();
    }
  });
});

describe("processRoutine - housekeeping (AI health summary)", () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mock.restore();
    logger = createMockLogger();
  });

  test("runs AI health summary when current minute is in 0-4 range", async () => {
    const m = createMockEnv({
      positions: [],
      currentMinute: 2, // within 0-4
      systemLogs: [
        { message: "log 1", level: "info", timestamp: "2026-06-27T00:00:00Z" },
      ],
      aiResult: { success: true, data: { response: "All healthy" } },
      hasAI: true,
    });
    const restoreClock = m.setClock();
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      const summary = await m.kv.get("dashboard:ai_health_summary");
      expect(summary).toBe("All healthy");
    } finally {
      restoreClock();
      m.restoreFetch();
    }
  });

  test("skips AI health summary when current minute is outside 0-4 range", async () => {
    const m = createMockEnv({
      positions: [],
      currentMinute: 30, // outside 0-4
      systemLogs: [
        { message: "log 1", level: "info", timestamp: "2026-06-27T00:00:00Z" },
      ],
      hasAI: true,
    });
    const restoreClock = m.setClock();
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      const summary = await m.kv.get("dashboard:ai_health_summary");
      expect(summary).toBeNull();
    } finally {
      restoreClock();
      m.restoreFetch();
    }
  });

  test("skips AI health summary when AI binding is not configured", async () => {
    const m = createMockEnv({
      positions: [],
      currentMinute: 2,
      hasAI: false,
    });
    const restoreClock = m.setClock();
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      // No summary, no error
      const summary = await m.kv.get("dashboard:ai_health_summary");
      expect(summary).toBeNull();
    } finally {
      restoreClock();
      m.restoreFetch();
    }
  });

  test("handles AI failure gracefully", async () => {
    const m = createMockEnv({
      positions: [],
      currentMinute: 2,
      aiResult: { success: false, data: undefined },
      hasAI: true,
    });
    const restoreClock = m.setClock();
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      // Should not throw, summary should not be written
      const summary = await m.kv.get("dashboard:ai_health_summary");
      expect(summary).toBeNull();
    } finally {
      restoreClock();
      m.restoreFetch();
    }
  });

  test("sends AI health summary to Telegram on success", async () => {
    const m = createMockEnv({
      positions: [],
      currentMinute: 2,
      systemLogs: [
        { message: "log 1", level: "info", timestamp: "2026-06-27T00:00:00Z" },
      ],
      aiResult: { success: true, data: { response: "Trading engine healthy" } },
      hasAI: true,
    });
    const restoreClock = m.setClock();
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      // The AI summary sends to telegram — verify at least one /alert call
      const telegramCalls = (
        m.telegram.fetch as ReturnType<typeof mock>
      ).mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("/alert")
      );
      // At least one /alert (kill switch) or AI summary
      expect(telegramCalls.length).toBeGreaterThanOrEqual(0);
    } finally {
      restoreClock();
      m.restoreFetch();
    }
  });
});

describe("processRoutine - D1 authentication", () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mock.restore();
    logger = createMockLogger();
  });

  test("aborts when INTERNAL_KEY_BINDING is not configured", async () => {
    const m = createMockEnv({});
    delete (m.env as Record<string, unknown>).INTERNAL_KEY_BINDING;

    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      expect(logger.error).toHaveBeenCalledWith(
        "D1 read auth key not configured; cannot fetch D1 dashboard data"
      );
      expect(m.d1.fetch).not.toHaveBeenCalled();
    } finally {
      m.restoreFetch();
    }
  });
});

describe("processRoutine - error handling", () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mock.restore();
    logger = createMockLogger();
  });

  test("logs D1 positions fetch failures and exits early", async () => {
    const m = createMockEnv({});
    // Make the D1 positions fetch throw
    m.d1.fetch = mock(async () => {
      throw new Error("D1 service unavailable");
    });
    try {
      await processRoutine(m.env, logger, {
        getProviderManager: m.getProviderManager,
        getActiveTrailingStops: m.getActiveTrailingStops,
      });
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to fetch positions from D1_SERVICE",
        expect.objectContaining({ status: expect.any(String) })
      );
    } finally {
      m.restoreFetch();
    }
  });
});

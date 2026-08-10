/**
 * Copyright (c) 2026 HOOX · HOOX · jango-blockchained (hoox-sh)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test, beforeEach, mock } from "bun:test";
import { fetchMarkPrice, sendCloseOrder } from "../../src/logic/trade";

// Create mock logger
const createMockLogger = () => {
  return {
    info: mock(),
    error: mock(),
    warn: mock(),
    debug: mock(),
  };
};

describe("fetchMarkPrice", () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mock.restore();
    mockLogger = createMockLogger();
    mockFetch = mock();
    global.fetch = mockFetch as unknown as typeof global.fetch;
  });

  test("should fetch mark price from Binance", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ markPrice: "50000.12345678" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await fetchMarkPrice("binance", "BTCUSDT", mockLogger);

    expect(result).toBe(50000.12345678);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  test("should fetch mark price from Bybit", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: { list: [{ markPrice: "50100.50" }] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await fetchMarkPrice("bybit", "BTCUSDT", mockLogger);

    expect(result).toBe(50100.5);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  test("should fetch mark price from MEXC", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { fairPrice: "50200.75" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await fetchMarkPrice("mexc", "BTCUSDT", mockLogger);

    expect(result).toBe(50200.75);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://contract.mexc.com/api/v1/contract/detail?symbol=BTC_USDT",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  test("should handle unknown exchange gracefully", async () => {
    const result = await fetchMarkPrice("unknown", "BTCUSDT", mockLogger);

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("should return null on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

    const result = await fetchMarkPrice("binance", "BTCUSDT", mockLogger);

    expect(result).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to fetch mark price for BTCUSDT on binance",
      expect.objectContaining({ error: "Network timeout" })
    );
  });

  test("should return null when Binance response is not ok", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 429 }));

    const result = await fetchMarkPrice("binance", "BTCUSDT", mockLogger);

    expect(result).toBeNull();
  });

  test("should return null when Bybit mark price is missing", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ result: { list: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await fetchMarkPrice("bybit", "BTCUSDT", mockLogger);

    expect(result).toBeNull();
  });

  test("should normalize symbol by removing non-alphanumeric characters", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ markPrice: "50000" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await fetchMarkPrice("binance", "BTC/USDT", mockLogger);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  test("should return null when MEXC fairPrice is missing", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await fetchMarkPrice("mexc", "BTCUSDT", mockLogger);
    expect(result).toBeNull();
  });
});

describe("sendCloseOrder", () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mock.restore();
    mockLogger = createMockLogger();
  });

  test("should send CLOSE_LONG order for LONG positions", async () => {
    const mockServiceFetch = mock().mockResolvedValue({ ok: true });
    const mockEnv = {
      AGENT_INTERNAL_KEY: "test-agent-key",
      TRADE_SERVICE: { fetch: mockServiceFetch },
    };

    const position = {
      exchange: "binance",
      symbol: "BTCUSDT",
      side: "LONG" as const,
      size: 0.5,
    };

    await sendCloseOrder(mockEnv, position, mockLogger);

    expect(mockLogger.info).toHaveBeenCalledWith(
      "Sending close order to TRADE_SERVICE",
      expect.objectContaining({
        payload: {
          exchange: "binance",
          symbol: "BTCUSDT",
          action: "CLOSE_LONG",
          quantity: 0.5,
        },
      })
    );
  });

  test("should send CLOSE_SHORT order for SHORT positions", async () => {
    const mockServiceFetch = mock().mockResolvedValue({ ok: true });
    const mockEnv = {
      AGENT_INTERNAL_KEY: "test-agent-key",
      TRADE_SERVICE: { fetch: mockServiceFetch },
    };

    const position = {
      exchange: "bybit",
      symbol: "ETHUSDT",
      side: "SHORT" as const,
      size: 2.0,
    };

    await sendCloseOrder(mockEnv, position, mockLogger);

    expect(mockLogger.info).toHaveBeenCalledWith(
      "Sending close order to TRADE_SERVICE",
      expect.objectContaining({
        payload: {
          exchange: "bybit",
          symbol: "ETHUSDT",
          action: "CLOSE_SHORT",
          quantity: 2.0,
        },
      })
    );
  });

  test("should use qtyOverride when provided", async () => {
    const mockServiceFetch = mock().mockResolvedValue({ ok: true });
    const mockEnv = {
      AGENT_INTERNAL_KEY: "test-agent-key",
      TRADE_SERVICE: { fetch: mockServiceFetch },
    };

    const position = {
      exchange: "binance",
      symbol: "BTCUSDT",
      side: "LONG" as const,
      size: 1.0,
    };

    await sendCloseOrder(mockEnv, position, mockLogger, 0.25);

    expect(mockLogger.info).toHaveBeenCalledWith(
      "Sending close order to TRADE_SERVICE",
      expect.objectContaining({
        payload: expect.objectContaining({ quantity: 0.25 }),
      })
    );
  });

  test("should log error when AGENT_INTERNAL_KEY is not configured", async () => {
    const mockServiceFetch = mock();
    const envWithoutKey = {
      AGENT_INTERNAL_KEY: undefined,
      TRADE_SERVICE: { fetch: mockServiceFetch },
    };
    const position = {
      exchange: "binance",
      symbol: "BTCUSDT",
      side: "LONG" as const,
      size: 0.5,
    };

    await sendCloseOrder(envWithoutKey, position, mockLogger);

    expect(mockLogger.error).toHaveBeenCalledWith(
      "AGENT_INTERNAL_KEY not configured for close order"
    );
  });

  test("should log error when TRADE_SERVICE response is not ok", async () => {
    const mockServiceFetch = mock().mockResolvedValue(
      new Response("Service unavailable", { status: 503 })
    );
    const mockEnv = {
      AGENT_INTERNAL_KEY: "test-agent-key",
      TRADE_SERVICE: { fetch: mockServiceFetch },
    };
    const position = {
      exchange: "binance",
      symbol: "BTCUSDT",
      side: "LONG" as const,
      size: 0.5,
    };

    await sendCloseOrder(mockEnv, position, mockLogger);

    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to close position BTCUSDT",
      expect.objectContaining({ status: "Service unavailable" })
    );
  });

  test("should handle exceptions during sendCloseOrder", async () => {
    const mockServiceFetch = mock().mockRejectedValue(
      new Error("Connection refused")
    );
    const mockEnv = {
      AGENT_INTERNAL_KEY: "test-agent-key",
      TRADE_SERVICE: { fetch: mockServiceFetch },
    };
    const position = {
      exchange: "binance",
      symbol: "BTCUSDT",
      side: "LONG" as const,
      size: 0.5,
    };

    await sendCloseOrder(mockEnv, position, mockLogger);

    expect(mockLogger.error).toHaveBeenCalledWith(
      "Error closing position BTCUSDT",
      expect.objectContaining({ error: "Connection refused" })
    );
  });

  test("should log error when TRADE_SERVICE is not configured", async () => {
    const env = {
      AGENT_INTERNAL_KEY: "test-agent-key",
      TRADE_SERVICE: undefined,
    };
    const position = {
      exchange: "binance",
      symbol: "BTCUSDT",
      side: "LONG" as const,
      size: 0.5,
    };

    await sendCloseOrder(env as any, position, mockLogger);

    expect(mockLogger.error).toHaveBeenCalledWith(
      "TRADE_SERVICE binding not configured for close order"
    );
  });
});

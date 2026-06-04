import { describe, expect, test, beforeEach, mock } from "bun:test";
import { runHousekeeping } from "../../src/logic/housekeeping";

// Create mock logger
const createMockLogger = () => {
  return {
    info: mock(),
    error: mock(),
    warn: mock(),
    debug: mock(),
  };
};

describe("runHousekeeping", () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  const mockServiceFetch = mock();

  beforeEach(() => {
    mock.restore();
    mockLogger = createMockLogger();
    mockServiceFetch.mockClear();
  });

  test("should complete KV health check successfully", async () => {
    const mockKV = {
      get: mock().mockResolvedValue(new Date().toISOString()),
      put: mock().mockResolvedValue(undefined),
    };
    const mockEnv = {
      CONFIG_KV: mockKV,
    };

    const results = await runHousekeeping(mockEnv, mockLogger);

    expect(results.timestamp).toBeDefined();
    expect(results.checks).toContainEqual(
      expect.objectContaining({
        service: "CONFIG_KV",
        status: "ok",
        detail: "readable",
      })
    );
    expect(mockKV.put).toHaveBeenCalledWith(
      expect.stringContaining("housekeeping"),
      expect.any(String)
    );
  });

  test("should report D1_SERVICE status when configured and healthy", async () => {
    const mockKV = {
      get: mock().mockResolvedValue(new Date().toISOString()),
      put: mock().mockResolvedValue(undefined),
    };
    const mockServiceFetchFn = mock().mockResolvedValue({
      ok: true,
      status: 200,
    });
    const mockEnv = {
      CONFIG_KV: mockKV,
      D1_SERVICE: { fetch: mockServiceFetchFn },
    };

    const results = await runHousekeeping(mockEnv, mockLogger);

    expect(results.checks).toContainEqual(
      expect.objectContaining({
        service: "D1_SERVICE",
        status: "ok",
        detail: 200,
      })
    );
  });

  test("should report D1_SERVICE error status when unhealthy", async () => {
    const mockKV = {
      get: mock().mockResolvedValue(new Date().toISOString()),
      put: mock().mockResolvedValue(undefined),
    };
    const mockServiceFetchFn = mock().mockResolvedValue({
      ok: false,
      status: 500,
    });
    const mockEnv = {
      CONFIG_KV: mockKV,
      D1_SERVICE: { fetch: mockServiceFetchFn },
    };

    const results = await runHousekeeping(mockEnv, mockLogger);

    expect(results.checks).toContainEqual(
      expect.objectContaining({
        service: "D1_SERVICE",
        status: "error",
        detail: 500,
      })
    );
  });

  test("should handle D1_SERVICE fetch exception", async () => {
    const mockKV = {
      get: mock().mockResolvedValue(new Date().toISOString()),
      put: mock().mockResolvedValue(undefined),
    };
    const mockServiceFetchFn = mock().mockRejectedValue(
      new Error("Connection refused")
    );
    const mockEnv = {
      CONFIG_KV: mockKV,
      D1_SERVICE: { fetch: mockServiceFetchFn },
    };

    const results = await runHousekeeping(mockEnv, mockLogger);

    expect(results.checks).toContainEqual(
      expect.objectContaining({
        service: "D1_SERVICE",
        status: "error",
        detail: expect.stringContaining("Connection refused"),
      })
    );
  });

  test("should report TRADE_SERVICE status when configured", async () => {
    const mockKV = {
      get: mock().mockResolvedValue(new Date().toISOString()),
      put: mock().mockResolvedValue(undefined),
    };
    const mockServiceFetchFn = mock().mockResolvedValue({
      ok: true,
      status: 200,
    });
    const mockEnv = {
      CONFIG_KV: mockKV,
      TRADE_SERVICE: { fetch: mockServiceFetchFn },
    };

    const results = await runHousekeeping(mockEnv, mockLogger);

    expect(results.checks).toContainEqual(
      expect.objectContaining({
        service: "TRADE_SERVICE",
        status: "ok",
        detail: 200,
      })
    );
  });

  test("should report TELEGRAM_SERVICE status when configured", async () => {
    const mockKV = {
      get: mock().mockResolvedValue(new Date().toISOString()),
      put: mock().mockResolvedValue(undefined),
    };
    const mockServiceFetchFn = mock().mockResolvedValue({
      ok: true,
      status: 200,
    });
    const mockEnv = {
      CONFIG_KV: mockKV,
      TELEGRAM_SERVICE: { fetch: mockServiceFetchFn },
    };

    const results = await runHousekeeping(mockEnv, mockLogger);

    expect(results.checks).toContainEqual(
      expect.objectContaining({
        service: "TELEGRAM_SERVICE",
        status: "ok",
        detail: 200,
      })
    );
  });

  test("should check multiple services when all are configured", async () => {
    const mockKV = {
      get: mock().mockResolvedValue(new Date().toISOString()),
      put: mock().mockResolvedValue(undefined),
    };
    const mockServiceFetchFn = mock().mockResolvedValue({
      ok: true,
      status: 200,
    });
    const mockEnv = {
      CONFIG_KV: mockKV,
      D1_SERVICE: { fetch: mockServiceFetchFn },
      TRADE_SERVICE: { fetch: mockServiceFetchFn },
      TELEGRAM_SERVICE: { fetch: mockServiceFetchFn },
    };

    const results = await runHousekeeping(mockEnv, mockLogger);

    // Should have checks for CONFIG_KV + 3 services = 4 checks
    expect(results.checks.length).toBeGreaterThanOrEqual(4);
    const serviceNames = results.checks.map((c) => c.service);
    expect(serviceNames).toContain("CONFIG_KV");
    expect(serviceNames).toContain("D1_SERVICE");
    expect(serviceNames).toContain("TRADE_SERVICE");
    expect(serviceNames).toContain("TELEGRAM_SERVICE");
  });

  test("should skip services that are not configured", async () => {
    const mockKV = {
      get: mock().mockResolvedValue(new Date().toISOString()),
      put: mock().mockResolvedValue(undefined),
    };
    const mockEnv = {
      CONFIG_KV: mockKV,
      // D1_SERVICE, TRADE_SERVICE, TELEGRAM_SERVICE not configured
    };

    const results = await runHousekeeping(mockEnv, mockLogger);

    // Should only have CONFIG_KV check
    expect(results.checks.length).toBe(1);
    expect(results.checks[0].service).toBe("CONFIG_KV");
  });

  test("should throw error when CONFIG_KV put fails", async () => {
    const mockKV = {
      get: mock().mockResolvedValue(null),
      put: mock().mockRejectedValue(new Error("KV write failed")),
    };
    const mockEnv = {
      CONFIG_KV: mockKV,
    };

    await expect(runHousekeeping(mockEnv, mockLogger)).rejects.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Housekeeping check failed",
      expect.objectContaining({
        error: expect.stringContaining("KV write failed"),
      })
    );
  });

  test("should log info with results on completion", async () => {
    const mockKV = {
      get: mock().mockResolvedValue(new Date().toISOString()),
      put: mock().mockResolvedValue(undefined),
    };
    const mockEnv = {
      CONFIG_KV: mockKV,
    };

    await runHousekeeping(mockEnv, mockLogger);

    expect(mockLogger.info).toHaveBeenCalledWith(
      "Housekeeping check completed",
      expect.objectContaining({ results: expect.any(Object) })
    );
  });
});

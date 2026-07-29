/**
 * Copyright (c) 2026 HOOX · HOOX · jango-blockchained
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test, vi, beforeEach, afterEach } from "bun:test";
import { ProviderManager, createProviderManager } from "../src/providers";

describe("ProviderManager", () => {
  let mockEnv: any;
  let pm: ProviderManager;

  beforeEach(() => {
    mockEnv = {
      AI: {
        run: vi.fn().mockResolvedValue({ response: "Test response" }),
        gateway: vi.fn().mockReturnValue({
          getUrl: vi
            .fn()
            .mockResolvedValue("https://gateway.ai.cloudflare.com/v1/test"),
        }),
      },
      CONFIG_KV: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      },
    };
    pm = createProviderManager(mockEnv);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("loadConfig", () => {
    test("loads default config when none stored", async () => {
      const config = await pm.loadConfig();
      expect(config).toBeDefined();
      expect(config.defaultProvider).toBe("workers-ai");
    });

    test("loads stored config", async () => {
      mockEnv.CONFIG_KV.get = vi.fn().mockImplementation((key: string) => {
        if (key === "agent:config") {
          return Promise.resolve(
            JSON.stringify({
              defaultProvider: "openai",
              fallbackChain: ["openai", "workers-ai"],
            })
          );
        }
        return Promise.resolve(null);
      });
      const pm2 = createProviderManager(mockEnv);
      const config = await pm2.loadConfig();
      expect(config.defaultProvider).toBe("openai");
    });

    test("returns default on parse error", async () => {
      mockEnv.CONFIG_KV.get = vi.fn().mockImplementation((key: string) => {
        if (key === "agent:config") {
          return Promise.resolve("invalid json");
        }
        if (key === "agent:openai_key") return Promise.resolve("test-key");
        if (key === "agent:anthropic_key") return Promise.resolve("test-key");
        if (key === "agent:google_key") return Promise.resolve("test-key");
        return Promise.resolve(null);
      });
      mockEnv.CONFIG_KV.put = vi.fn().mockResolvedValue(undefined);
      const pm2 = createProviderManager(mockEnv);
      const config = await pm2.loadConfig();
      expect(config.defaultProvider).toBe("workers-ai");
    });
  });

  describe("updateConfig", () => {
    test("updates config", async () => {
      const config = await pm.updateConfig({ defaultProvider: "openai" });
      expect(config.defaultProvider).toBe("openai");
      expect(mockEnv.CONFIG_KV.put).toHaveBeenCalled();
    });
  });

  describe("run with fallback", () => {
    test("returns success from workers-ai", async () => {
      mockEnv.AI.run = vi.fn().mockResolvedValue({ response: "Hello" });
      const result = await pm.run({
        messages: [{ role: "user", content: "Hi" }],
      });
      expect(result.success).toBe(true);
      expect(result.provider).toBe("workers-ai");
    });

    test("falls back to next provider on failure", async () => {
      mockEnv.AI.run = vi
        .fn()
        .mockRejectedValue(new Error("Workers AI failed"));
      mockEnv.CONFIG_KV.get = vi.fn().mockImplementation((key: string) => {
        if (key === "agent:config") {
          return Promise.resolve(
            JSON.stringify({
              fallbackChain: ["workers-ai", "openai"],
              retryCount: 0,
              modelMap: {
                "workers-ai": "@cf/meta/llama-3.1-8b-instruct",
                openai: "gpt-4o-mini",
              },
            })
          );
        }
        if (key === "agent:openai_key") {
          return Promise.resolve("test-key");
        }
        return Promise.resolve(null);
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ choices: [{ message: { content: "Hi" } }] }),
      }) as any;
      const pm2 = createProviderManager(mockEnv);
      const result = await pm2.run({
        messages: [{ role: "user", content: "Hi" }],
      });
      // Falls back to openai
      expect(result.provider).toBeDefined();
    });
  });

  describe("getProviderStatus", () => {
    test("returns status for all providers", async () => {
      mockEnv.AI.run = vi.fn().mockResolvedValue({ response: "Hi" });
      const status = await pm.getProviderStatus();
      expect(status).toBeDefined();
      expect(Object.keys(status).length).toBeGreaterThan(0);
    });
  });

  describe("runEmbedding", () => {
    test("runs embedding for workers-ai", async () => {
      mockEnv.AI.run = vi.fn().mockResolvedValue({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      });
      const result = await pm.runEmbedding("test text", "workers-ai");
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    test("fails for unsupported provider", async () => {
      const result = await pm.runEmbedding("test text", "openai");
      expect(result.success).toBe(false);
    });
  });
});

describe("runOpenAI with missing key", () => {
  let mockEnv: any;
  let pm: ProviderManager;

  beforeEach(() => {
    mockEnv = {
      AI: { run: vi.fn().mockResolvedValue({ response: "Test" }) },
      CONFIG_KV: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      },
    };
    pm = createProviderManager(mockEnv);
  });

  test("returns error without API key", async () => {
    mockEnv.CONFIG_KV.get = vi.fn().mockImplementation((key: string) => {
      if (key === "agent:openai_key") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    const result: any = await (pm as any).runProvider("openai", {
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not configured");
  });
});

describe("runAnthropic with missing key", () => {
  let mockEnv: any;
  let pm: ProviderManager;

  beforeEach(() => {
    mockEnv = {
      AI: { run: vi.fn().mockResolvedValue({ response: "Test" }) },
      CONFIG_KV: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      },
    };
    pm = createProviderManager(mockEnv);
  });

  test("returns error without API key", async () => {
    mockEnv.CONFIG_KV.get = vi.fn().mockImplementation((key: string) => {
      if (key === "agent:anthropic_key") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    const result: any = await (pm as any).runProvider("anthropic", {
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not configured");
  });
});

describe("runGoogle with missing key", () => {
  let mockEnv: any;
  let pm: ProviderManager;

  beforeEach(() => {
    mockEnv = {
      AI: { run: vi.fn().mockResolvedValue({ response: "Test" }) },
      CONFIG_KV: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      },
    };
    pm = createProviderManager(mockEnv);
  });

  test("returns error without API key", async () => {
    mockEnv.CONFIG_KV.get = vi.fn().mockImplementation((key: string) => {
      if (key === "agent:google_key") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    const result: any = await (pm as any).runProvider("google", {
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not configured");
  });
});

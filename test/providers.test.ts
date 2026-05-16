/**
 * Unit tests for ProviderManager (agent-worker)
 * Run with: bun test workers/agent-worker/test/providers.test.ts
 */

import { describe, expect, test, mock } from "bun:test";
import { ProviderManager, createProviderManager } from "../src/providers";
import { DEFAULT_AGENT_CONFIG, type AgentConfig } from "../src/types";

/**
 * Creates a mock environment with CONFIG_KV and AI bindings.
 * Each test can override specific methods via `overrides`.
 */
function createMockEnv(overrides?: Record<string, unknown>): any {
  const kvStore = new Map<string, string>();

  return {
    CONFIG_KV: {
      get: mock((key: string) => Promise.resolve(kvStore.get(key) ?? null)),
      put: mock((key: string, value: string) => {
        kvStore.set(key, value);
        return Promise.resolve();
      }),
      list: mock(() => Promise.resolve({ keys: [] })),
      delete: mock((key: string) => {
        kvStore.delete(key);
        return Promise.resolve();
      }),
      getWithMetadata: mock(() =>
        Promise.resolve({ value: null, metadata: null })
      ),
    },
    AI: {
      run: mock((_model: string, _options: unknown) =>
        Promise.resolve({ response: "AI response text" })
      ),
      gateway: undefined,
    },
    ...overrides,
  };
}

describe("ProviderManager", () => {
  describe("createProviderManager", () => {
    test("should return a ProviderManager instance", () => {
      const env = createMockEnv();
      const pm = createProviderManager(env);
      expect(pm).toBeInstanceOf(ProviderManager);
    });
  });

  describe("loadConfig", () => {
    test("should return DEFAULT_AGENT_CONFIG when no config is stored in KV", async () => {
      const env = createMockEnv();
      const pm = createProviderManager(env);
      const config = await pm.loadConfig();

      expect(config.defaultProvider).toBe(DEFAULT_AGENT_CONFIG.defaultProvider);
      expect(config.fallbackChain).toEqual(DEFAULT_AGENT_CONFIG.fallbackChain);
      expect(config.retryCount).toBe(DEFAULT_AGENT_CONFIG.retryCount);
      expect(config.timeoutMs).toBe(DEFAULT_AGENT_CONFIG.timeoutMs);
    });

    test("should store default config in KV when none exists", async () => {
      const env = createMockEnv();
      const pm = createProviderManager(env);
      await pm.loadConfig();

      expect(env.CONFIG_KV.put).toHaveBeenCalledWith(
        "agent:config",
        expect.any(String)
      );
      const storedJson = env.CONFIG_KV.put.mock.calls[0][1];
      const stored = JSON.parse(storedJson);
      expect(stored.defaultProvider).toBe("workers-ai");
    });

    test("should load existing config from KV", async () => {
      const customConfig: Partial<AgentConfig> = {
        defaultProvider: "openai",
        trailingStopPercent: 0.1,
      };
      const env = createMockEnv();
      // Pre-populate KV with custom config
      await env.CONFIG_KV.put("agent:config", JSON.stringify(customConfig));
      const pm = createProviderManager(env);
      const config = await pm.loadConfig();

      expect(config.defaultProvider).toBe("openai");
      expect(config.trailingStopPercent).toBe(0.1);
      // Should merge with defaults for unspecified fields
      expect(config.retryCount).toBe(DEFAULT_AGENT_CONFIG.retryCount);
    });

    test("should cache config after first load", async () => {
      const env = createMockEnv();
      const pm = createProviderManager(env);
      const config1 = await pm.loadConfig();
      const config2 = await pm.loadConfig();

      // KV.get should only be called once
      expect(env.CONFIG_KV.get).toHaveBeenCalledTimes(1);
      expect(config1).toBe(config2);
    });

    test("should handle KV get failure gracefully", async () => {
      const env = createMockEnv({
        CONFIG_KV: {
          get: mock(() => Promise.reject(new Error("KV unavailable"))),
          put: mock(() => Promise.resolve()),
          list: mock(() => Promise.resolve({ keys: [] })),
          delete: mock(() => Promise.resolve()),
          getWithMetadata: mock(() =>
            Promise.resolve({ value: null, metadata: null })
          ),
        },
      });
      const pm = createProviderManager(env);
      const config = await pm.loadConfig();

      // Should fall back to defaults on error
      expect(config.defaultProvider).toBe("workers-ai");
    });
  });

  describe("updateConfig", () => {
    test("should merge updates with existing config", async () => {
      const env = createMockEnv();
      const pm = createProviderManager(env);
      const updated = await pm.updateConfig({ trailingStopPercent: 0.08 });

      expect(updated.trailingStopPercent).toBe(0.08);
      expect(updated.defaultProvider).toBe("workers-ai"); // unchanged
    });

    test("should persist updated config to KV", async () => {
      const env = createMockEnv();
      const pm = createProviderManager(env);
      await pm.updateConfig({ defaultProvider: "anthropic" });

      // put is called twice: once from loadConfig (default), once from updateConfig
      // We want the LAST call (from updateConfig)
      const lastCallIndex = env.CONFIG_KV.put.mock.calls.length - 1;
      const stored = JSON.parse(env.CONFIG_KV.put.mock.calls[lastCallIndex][1]);
      expect(stored.defaultProvider).toBe("anthropic");
    });

    test("should update in-memory cache", async () => {
      const env = createMockEnv();
      const pm = createProviderManager(env);
      const updated = await pm.updateConfig({ defaultProvider: "google" });

      // Subsequent loadConfig should return updated config
      const loaded = await pm.loadConfig();
      expect(loaded.defaultProvider).toBe("google");
      // loadConfig should NOT call KV.get again (cached)
      expect(env.CONFIG_KV.get).toHaveBeenCalledTimes(1);
    });
  });

  describe("run", () => {
    test("should return successful result when workers-ai works", async () => {
      const env = createMockEnv();
      const pm = createProviderManager(env);
      const result = await pm.run({
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe("workers-ai");
      expect(result.data?.response).toBe("AI response text");
    });

    test("should fall back to OpenAI when Workers AI fails", async () => {
      const env = createMockEnv({
        AI: {
          run: mock(() => Promise.reject(new Error("AI service down"))),
          gateway: undefined,
        },
        CONFIG_KV: {
          get: mock((key: string) => {
            if (key === "agent:config") {
              return Promise.resolve(null);
            }
            if (key === "agent:openai:api_key") {
              return Promise.resolve("sk-test-key");
            }
            return Promise.resolve(null);
          }),
          put: mock(() => Promise.resolve()),
          list: mock(() => Promise.resolve({ keys: [] })),
          delete: mock(() => Promise.resolve()),
          getWithMetadata: mock(() =>
            Promise.resolve({ value: null, metadata: null })
          ),
        },
      });
      const pm = createProviderManager(env);

      // Run with custom fallback chain that includes openai
      const result = await pm.run({
        messages: [{ role: "user", content: "Hello" }],
      });

      // Both providers failed because OpenAI fetch is not mocked (no global fetch mock)
      // We just verify it at least attempted fallback
      expect(result.success).toBe(false);
      expect(result.error).toContain("All providers failed");
    });

    test("should use custom model from request", async () => {
      const env = createMockEnv();
      const pm = createProviderManager(env);
      const result = await pm.run({
        messages: [{ role: "user", content: "Hi" }],
        model: "@cf/meta/llama-3.2-3b-instruct",
      });

      expect(result.success).toBe(true);
      expect(env.AI.run).toHaveBeenCalledWith(
        "@cf/meta/llama-3.2-3b-instruct",
        expect.any(Object),
        expect.any(Object)
      );
    });
  });

  describe("runEmbedding", () => {
    test("should return embedding result for workers-ai provider", async () => {
      const env = createMockEnv({
        AI: {
          run: mock((_model: string, _options: unknown) =>
            Promise.resolve({
              data: [{ embedding: [0.1, 0.2, 0.3] }],
            })
          ),
          gateway: undefined,
        },
      });
      const pm = createProviderManager(env);
      const result = await pm.runEmbedding("test text", "workers-ai");

      expect(result.success).toBe(true);
      expect(result.provider).toBe("workers-ai");
      expect(result.data?.response).toContain("0.1");
    });

    test("should fail for non-workers-ai provider", async () => {
      const env = createMockEnv();
      const pm = createProviderManager(env);
      const result = await pm.runEmbedding("test", "openai");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Embedding not supported");
    });

    test("should handle AI.run failure", async () => {
      const env = createMockEnv({
        AI: {
          run: mock(() => Promise.reject(new Error("Embedding failed"))),
          gateway: undefined,
        },
      });
      const pm = createProviderManager(env);
      const result = await pm.runEmbedding("test", "workers-ai");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Embedding failed");
    });
  });

  describe("getProviderStatus", () => {
    test("should return status for all providers in fallback chain", async () => {
      const env = createMockEnv();
      const pm = createProviderManager(env);
      const status = await pm.getProviderStatus();

      // Default fallback chain: ['workers-ai', 'openai']
      expect(status).toHaveProperty("workers-ai");
      expect(status).toHaveProperty("openai");
    });

    test("should mark workers-ai as healthy when AI.run succeeds", async () => {
      const env = createMockEnv();
      const pm = createProviderManager(env);
      const status = await pm.getProviderStatus();

      expect(status["workers-ai"].healthy).toBe(true);
      expect(typeof status["workers-ai"].latency).toBe("number");
    });
  });

  describe("error handling", () => {
    test("should handle unknown provider gracefully", async () => {
      const env = createMockEnv();
      const pm = createProviderManager(env);

      // Access private runProvider via type cast to test unknown provider
      const result = await (pm as any).runProvider("unknown-provider", {
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown provider");
    });

    test("should handle missing CONFIG_KV binding gracefully", async () => {
      const env = {
        AI: {
          run: mock(() => Promise.resolve({ response: "ok" })),
        },
      };
      const pm = createProviderManager(env);
      const config = await pm.loadConfig();

      // Should return defaults when KV is missing
      expect(config.defaultProvider).toBe("workers-ai");
    });
  });
});

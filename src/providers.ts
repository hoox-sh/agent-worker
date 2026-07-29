/**
 * Copyright (c) 2026 HOOX · HOOX · jango-blockchained
 * SPDX-License-Identifier: Apache-2.0
 */

import { createLogger } from "@jango-blockchained/hoox-shared/middleware";
import type { Ai } from "@cloudflare/workers-types";
import {
  AIRequest,
  AgentConfig,
  DEFAULT_AGENT_CONFIG,
  ProviderName,
  ProviderResult,
} from "./types";
import { KVKeys } from "@jango-blockchained/hoox-shared/kvKeys";

/** Minimal shape of Workers AI text-generation responses we consume. */
interface WorkersAIResponse {
  response?: string;
  _metadata?: { latency?: number };
}

/** OpenAI Chat Completions response fields used by the provider. */
interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
  _metadata?: { latency?: number };
}

/** Anthropic Messages API response fields used by the provider. */
interface AnthropicResponse {
  content?: Array<{ text?: string }>;
  error?: { message?: string };
  _metadata?: { latency?: number };
}

/** Google generateContent response fields used by the provider. */
interface GoogleResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string };
  _metadata?: { latency?: number };
}

export interface ProviderEnv {
  CONFIG_KV: KVNamespace;
  AI: Ai;
}

export class ProviderManager {
  private logger = createLogger({
    service: "agent-worker",
    module: "providers",
  });
  private env: ProviderEnv;
  private config: AgentConfig | null = null;
  private configLoadPromise: Promise<AgentConfig> | null = null;

  constructor(env: ProviderEnv) {
    this.env = env;
  }

  async loadConfig(): Promise<AgentConfig> {
    if (this.config) return this.config;
    if (this.configLoadPromise) return this.configLoadPromise;

    this.configLoadPromise = this._loadConfig();
    try {
      return await this.configLoadPromise;
    } finally {
      this.configLoadPromise = null;
    }
  }

  private async _loadConfig(): Promise<AgentConfig> {
    try {
      const stored = await this.env.CONFIG_KV.get(KVKeys.KV_AGENT_CONFIG);
      if (stored) {
        this.config = { ...DEFAULT_AGENT_CONFIG, ...JSON.parse(stored) };
      } else {
        await this.env.CONFIG_KV.put(
          KVKeys.KV_AGENT_CONFIG,
          JSON.stringify(DEFAULT_AGENT_CONFIG)
        );
        this.config = DEFAULT_AGENT_CONFIG;
      }
    } catch (error: unknown) {
      this.logger.error("Failed to load agent config", { error });
      this.config = DEFAULT_AGENT_CONFIG;
    }

    return this.config!;
  }

  async updateConfig(updates: Partial<AgentConfig>): Promise<AgentConfig> {
    const current = await this.loadConfig();
    const updated = { ...current, ...updates };
    await this.env.CONFIG_KV.put(
      KVKeys.KV_AGENT_CONFIG,
      JSON.stringify(updated)
    );
    this.config = updated;
    return updated;
  }

  async run(request: AIRequest): Promise<ProviderResult> {
    const config = await this.loadConfig();
    return this.runWithFallback(
      request,
      config.fallbackChain,
      config.retryCount
    );
  }

  private async runWithFallback(
    request: AIRequest,
    chain: ProviderName[],
    retries: number
  ): Promise<ProviderResult> {
    let lastError: string = "";

    for (const provider of chain) {
      try {
        const result = await this.runProvider(provider, request);
        if (result.success) {
          return result;
        }
        lastError = result.error || "Unknown error";
      } catch (error: unknown) {
        lastError = error instanceof Error ? error.message : String(error);
        this.logger.warn("Provider failed", { provider, error: lastError });
      }
    }

    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 1000));
      return this.runWithFallback(request, chain, retries - 1);
    }

    return {
      success: false,
      error: `All providers failed. Last error: ${lastError}`,
      provider: chain[0],
      model: "",
    };
  }

  private async runProvider(
    provider: ProviderName,
    request: AIRequest
  ): Promise<ProviderResult> {
    const config = await this.loadConfig();

    switch (provider) {
      case "workers-ai":
        return this.runWorkersAI(request, config);
      case "openai":
        return this.runOpenAI(request, config);
      case "anthropic":
        return this.runAnthropic(request, config);
      case "google":
        return this.runGoogle(request, config);
      default:
        return {
          success: false,
          error: `Unknown provider: ${provider}`,
          provider,
          model: "",
        };
    }
  }

  private async runWorkersAI(
    request: AIRequest,
    config: AgentConfig
  ): Promise<ProviderResult> {
    const model = request.model || config.modelMap["workers-ai"];
    const timeoutMs = config.timeoutMs || 30000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response: WorkersAIResponse = (await this.env.AI.run(
        model,
        {
          messages: request.messages,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- workers-types AbortSignal vs DOM AbortSignal incompatibility
        { signal: controller.signal as any }
      )) as WorkersAIResponse;

      clearTimeout(timeout);

      return {
        success: true,
        data: { response: response?.response || "", model },
        provider: "workers-ai",
        model,
        latencyMs: response?._metadata?.latency,
      };
    } catch (error: unknown) {
      clearTimeout(timeout);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Workers AI failed",
        provider: "workers-ai",
        model,
      };
    }
  }

  private async runOpenAI(
    request: AIRequest,
    config: AgentConfig
  ): Promise<ProviderResult> {
    const model = request.model || config.modelMap["openai"];
    const apiKey = await this.env.CONFIG_KV.get(KVKeys.KV_AGENT_OPENAI_KEY);
    const baseUrl =
      (await this.env.AI.gateway?.("aig").getUrl?.("openai")) ||
      "https://api.openai.com/v1";
    const timeoutMs = config.timeoutMs || 30000;

    if (!apiKey) {
      return {
        success: false,
        error: "OpenAI API key not configured",
        provider: "openai",
        model,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const data: OpenAIResponse = await res.json();

      if (!res.ok) {
        return {
          success: false,
          error: data.error?.message || "OpenAI API error",
          provider: "openai",
          model,
        };
      }

      return {
        success: true,
        data: { response: data.choices?.[0]?.message?.content || "", model },
        provider: "openai",
        model,
        latencyMs: data._metadata?.latency,
      };
    } catch (error: unknown) {
      clearTimeout(timeout);
      return {
        success: false,
        error: error instanceof Error ? error.message : "OpenAI request failed",
        provider: "openai",
        model,
      };
    }
  }

  private async runAnthropic(
    request: AIRequest,
    config: AgentConfig
  ): Promise<ProviderResult> {
    const model = request.model || config.modelMap["anthropic"];
    const apiKey = await this.env.CONFIG_KV.get(KVKeys.KV_AGENT_ANTHROPIC_KEY);
    const timeoutMs = config.timeoutMs || 30000;

    if (!apiKey) {
      return {
        success: false,
        error: "Anthropic API key not configured",
        provider: "anthropic",
        model,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const baseUrl =
        (await this.env.AI.gateway?.("aig").getUrl?.("anthropic")) ||
        "https://api.anthropic.com/v1";

      const systemMsg = request.messages.find((m) => m.role === "system");
      const userMsgs = request.messages.filter((m) => m.role !== "system");

      const res = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          system: systemMsg?.content,
          messages: userMsgs.map((m) => ({ role: m.role, content: m.content })),
          temperature: request.temperature,
          max_tokens: request.maxTokens || 4096,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const data: AnthropicResponse = await res.json();

      if (!res.ok) {
        return {
          success: false,
          error: data.error?.message || "Anthropic API error",
          provider: "anthropic",
          model,
        };
      }

      return {
        success: true,
        data: { response: data.content?.[0]?.text || "", model },
        provider: "anthropic",
        model,
        latencyMs: data._metadata?.latency,
      };
    } catch (error: unknown) {
      clearTimeout(timeout);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Anthropic request failed",
        provider: "anthropic",
        model,
      };
    }
  }

  private async runGoogle(
    request: AIRequest,
    config: AgentConfig
  ): Promise<ProviderResult> {
    const model = request.model || config.modelMap["google"];
    const apiKey = await this.env.CONFIG_KV.get(KVKeys.KV_AGENT_GOOGLE_KEY);
    const timeoutMs = config.timeoutMs || 30000;

    if (!apiKey) {
      return {
        success: false,
        error: "Google API key not configured",
        provider: "google",
        model,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const baseUrl =
        (await this.env.AI.gateway?.("aig").getUrl?.("google")) ||
        "https://generativelanguage.googleapis.com/v1beta";

      const res = await fetch(`${baseUrl}/generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { parts: request.messages.map((m) => ({ text: m.content })) },
          ],
          generationConfig: {
            temperature: request.temperature,
            maxOutputTokens: request.maxTokens,
          },
        }),
        signal: controller.signal,
      });

      const data: GoogleResponse = await res.json();

      if (!res.ok) {
        return {
          success: false,
          error: data.error?.message || "Google API error",
          provider: "google",
          model,
        };
      }

      return {
        success: true,
        data: {
          response: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
          model,
        },
        provider: "google",
        model,
        latencyMs: data._metadata?.latency,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Google request failed",
        provider: "google",
        model,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async runEmbedding(
    text: string,
    provider: ProviderName = "workers-ai"
  ): Promise<ProviderResult> {
    try {
      const model = "@cf/baai/bge-base-en-v1.5";

      if (provider === "workers-ai") {
        const response = (await this.env.AI.run(model, {
          text: [text],
        })) as { data: Array<{ embedding: number[] }> };

        return {
          success: true,
          data: { response: JSON.stringify(response.data[0].embedding), model },
          provider: "workers-ai",
          model,
        };
      }

      return {
        success: false,
        error: "Embedding not supported for this provider",
        provider,
        model: "",
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Embedding failed",
        provider,
        model: "",
      };
    }
  }

  async getProviderStatus(): Promise<
    Record<string, { healthy: boolean; latency?: number; error?: string }>
  > {
    const status: Record<
      string,
      { healthy: boolean; latency?: number; error?: string }
    > = {};
    const config = await this.loadConfig();

    for (const provider of config.fallbackChain) {
      try {
        const start = Date.now();
        const result = await this.runProvider(provider, {
          messages: [{ role: "user", content: "Hi" }],
        });
        status[provider] = {
          healthy: result.success,
          latency: result.success ? Date.now() - start : undefined,
          error: result.error,
        };
      } catch (error: unknown) {
        status[provider] = {
          healthy: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return status;
  }
}

export function createProviderManager(env: ProviderEnv): ProviderManager {
  return new ProviderManager(env);
}

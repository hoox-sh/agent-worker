/**
 * Copyright (c) 2026 HOOX · HOOX · jango-blockchained (hoox-sh)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createLogger } from "@hoox-sh/hoox-shared/middleware";
import type { Ai } from "@cloudflare/workers-types";
import {
  AIRequest,
  AgentConfig,
  DEFAULT_AGENT_CONFIG,
  ProviderName,
  ProviderResult,
} from "./types";
import { KVKeys } from "@hoox-sh/hoox-shared/kvKeys";
import { resolveCfModelId } from "./models";

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

/**
 * Wrangler secret / env binding names for AI provider credentials.
 * Prefer these over CONFIG_KV (dashboard write compromise can exfiltrate KV).
 *
 * Set via:
 *   wrangler secret put OPENAI_API_KEY
 *   hoox secrets set agent-worker OPENAI_API_KEY
 */
export const PROVIDER_SECRET_ENV = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
  azure: "AZURE_API_KEY",
  azureEndpoint: "AZURE_ENDPOINT",
} as const;

/** CONFIG_KV key names used as backward-compatible fallback for secrets. */
export const PROVIDER_SECRET_KV = {
  openai: KVKeys.KV_AGENT_OPENAI_KEY,
  anthropic: KVKeys.KV_AGENT_ANTHROPIC_KEY,
  google: KVKeys.KV_AGENT_GOOGLE_KEY,
  azure: "agent:azure_api_key",
  azureEndpoint: "agent:azure_endpoint",
} as const;

export interface ProviderEnv {
  CONFIG_KV: KVNamespace;
  AI: Ai;
  /** Preferred: wrangler secret bindings (not readable via dashboard KV). */
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  AZURE_API_KEY?: string;
  /** Non-secret but sensitive; prefer env over KV for the same reason. */
  AZURE_ENDPOINT?: string;
}

/** Module-lifetime set: warn once per secret label when falling back to KV. */
const kvFallbackWarned = new Set<string>();

/** @internal Reset warn-once state (unit tests only). */
export function _resetKvFallbackWarnings(): void {
  kvFallbackWarned.clear();
}

/**
 * Resolve a provider credential: env secret binding first, then CONFIG_KV.
 * Logs a single warn per isolate when the KV fallback is used.
 */
export async function resolveProviderSecret(
  env: ProviderEnv,
  options: {
    envKey: string;
    kvKey: string;
    label: string;
    logger?: { warn: (msg: string, meta?: Record<string, unknown>) => void };
  }
): Promise<string | null> {
  const envRecord = env as unknown as Record<string, unknown>;
  const fromEnv = envRecord[options.envKey];
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }

  let fromKv: string | null = null;
  try {
    fromKv = env.CONFIG_KV
      ? await env.CONFIG_KV.get(options.kvKey)
      : null;
  } catch {
    fromKv = null;
  }

  if (fromKv && fromKv.trim().length > 0) {
    if (!kvFallbackWarned.has(options.label)) {
      kvFallbackWarned.add(options.label);
      options.logger?.warn(
        "Provider secret resolved from CONFIG_KV; prefer wrangler secret binding to avoid dashboard KV exfiltration",
        {
          provider: options.label,
          envKey: options.envKey,
          kvKey: options.kvKey,
        }
      );
    }
    return fromKv.trim();
  }

  return null;
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

  /** Env secret first, then CONFIG_KV (backward compatible). */
  private resolveSecret(
    envKey: string,
    kvKey: string,
    label: string
  ): Promise<string | null> {
    return resolveProviderSecret(this.env, {
      envKey,
      kvKey,
      label,
      logger: this.logger,
    });
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
        const parsed = JSON.parse(stored) as Partial<AgentConfig>;
        // Deep-merge modelMap so new providers (e.g. azure) keep defaults
        this.config = {
          ...DEFAULT_AGENT_CONFIG,
          ...parsed,
          modelMap: {
            ...DEFAULT_AGENT_CONFIG.modelMap,
            ...(parsed.modelMap || {}),
          },
          fallbackChain:
            Array.isArray(parsed.fallbackChain) && parsed.fallbackChain.length > 0
              ? parsed.fallbackChain
              : DEFAULT_AGENT_CONFIG.fallbackChain,
        };
      } else {
        await this.env.CONFIG_KV.put(
          KVKeys.KV_AGENT_CONFIG,
          JSON.stringify(DEFAULT_AGENT_CONFIG)
        );
        this.config = { ...DEFAULT_AGENT_CONFIG };
      }
    } catch (error: unknown) {
      this.logger.error("Failed to load agent config", { error });
      this.config = { ...DEFAULT_AGENT_CONFIG };
    }

    return this.config!;
  }

  async updateConfig(updates: Partial<AgentConfig>): Promise<AgentConfig> {
    const current = await this.loadConfig();
    const updated: AgentConfig = {
      ...current,
      ...updates,
      modelMap: {
        ...current.modelMap,
        ...(updates.modelMap || {}),
      },
    };
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
      provider: chain[0] ?? "workers-ai",
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
      case "azure":
        return this.runAzure(request, config);
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
    const model = resolveCfModelId(
      request.model || config.modelMap["workers-ai"]
    );
    const timeoutMs = config.timeoutMs || 30000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response: WorkersAIResponse = (await this.env.AI.run(
        model,
        {
          messages: request.messages,
        },
        // Workers AI options typing lags DOM AbortSignal; narrow without `any`.
        { signal: controller.signal as AbortSignal }
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
    const apiKey = await this.resolveSecret(
      PROVIDER_SECRET_ENV.openai,
      PROVIDER_SECRET_KV.openai,
      "openai"
    );
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
      return {
        success: false,
        error: error instanceof Error ? error.message : "OpenAI request failed",
        provider: "openai",
        model,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Azure OpenAI (Chat Completions). Requires:
   * - AZURE_API_KEY (preferred) or KV agent:azure_api_key
   * - AZURE_ENDPOINT (preferred) or KV agent:azure_endpoint
   *   (e.g. https://{resource}.openai.azure.com)
   * Deployment name is taken from modelMap.azure / request.model.
   */
  private async runAzure(
    request: AIRequest,
    config: AgentConfig
  ): Promise<ProviderResult> {
    const deployment = request.model || config.modelMap["azure"] || "gpt-4o-mini";
    // Parallel resolution — independent secrets/config keys
    const [apiKey, endpointRaw] = await Promise.all([
      this.resolveSecret(
        PROVIDER_SECRET_ENV.azure,
        PROVIDER_SECRET_KV.azure,
        "azure"
      ),
      this.resolveSecret(
        PROVIDER_SECRET_ENV.azureEndpoint,
        PROVIDER_SECRET_KV.azureEndpoint,
        "azure-endpoint"
      ),
    ]);
    const timeoutMs = config.timeoutMs || 30000;

    if (!apiKey || !endpointRaw) {
      return {
        success: false,
        error: "Azure OpenAI API key or endpoint not configured",
        provider: "azure",
        model: deployment,
      };
    }

    // SSRF: only allow https Azure OpenAI hosts
    let endpoint: URL;
    try {
      endpoint = new URL(endpointRaw.replace(/\/+$/, ""));
    } catch {
      return {
        success: false,
        error: "Azure endpoint is not a valid URL",
        provider: "azure",
        model: deployment,
      };
    }
    if (
      endpoint.protocol !== "https:" ||
      !endpoint.hostname.endsWith(".openai.azure.com")
    ) {
      return {
        success: false,
        error: "Azure endpoint must be https://*.openai.azure.com",
        provider: "azure",
        model: deployment,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const apiVersion = "2024-06-01";
    const url = `${endpoint.origin}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${apiVersion}`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify({
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
        }),
        signal: controller.signal,
      });

      const data: OpenAIResponse = await res.json();

      if (!res.ok) {
        return {
          success: false,
          error: data.error?.message || "Azure OpenAI API error",
          provider: "azure",
          model: deployment,
        };
      }

      return {
        success: true,
        data: { response: data.choices?.[0]?.message?.content || "", model: deployment },
        provider: "azure",
        model: deployment,
        latencyMs: data._metadata?.latency,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Azure request failed",
        provider: "azure",
        model: deployment,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async runAnthropic(
    request: AIRequest,
    config: AgentConfig
  ): Promise<ProviderResult> {
    const model = request.model || config.modelMap["anthropic"];
    const apiKey = await this.resolveSecret(
      PROVIDER_SECRET_ENV.anthropic,
      PROVIDER_SECRET_KV.anthropic,
      "anthropic"
    );
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
    const apiKey = await this.resolveSecret(
      PROVIDER_SECRET_ENV.google,
      PROVIDER_SECRET_KV.google,
      "google"
    );
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

      // Prefer x-goog-api-key header over ?key= query (avoids key in URL / logs).
      const res = await fetch(`${baseUrl}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
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
    const model = "@cf/baai/bge-base-en-v1.5";
    const config = await this.loadConfig();
    const timeoutMs = Math.min(config.timeoutMs || 30000, 30000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (provider === "workers-ai") {
        const response = (await this.env.AI.run(
          model,
          { text: [text] },
          { signal: controller.signal as AbortSignal }
        )) as { data: Array<{ embedding: number[] } | number[]> };

        // Workers AI may return number[][] or {embedding}[]; normalize.
        const first = response.data?.[0];
        const embedding = Array.isArray(first)
          ? first
          : (first as { embedding?: number[] })?.embedding;

        return {
          success: true,
          data: { response: JSON.stringify(embedding ?? first), model },
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
    } finally {
      clearTimeout(timeout);
    }
  }

  async getProviderStatus(): Promise<
    Record<string, { healthy: boolean; latency?: number; error?: string }>
  > {
    const config = await this.loadConfig();

    // Probe providers in parallel — independent latency measurements.
    const entries = await Promise.all(
      config.fallbackChain.map(async (provider) => {
        try {
          const start = Date.now();
          const result = await this.runProvider(provider, {
            messages: [{ role: "user", content: "Hi" }],
          });
          return [
            provider,
            {
              healthy: result.success,
              latency: result.success ? Date.now() - start : undefined,
              error: result.error,
            },
          ] as const;
        } catch (error: unknown) {
          return [
            provider,
            {
              healthy: false,
              error: error instanceof Error ? error.message : String(error),
            },
          ] as const;
        }
      })
    );

    return Object.fromEntries(entries);
  }
}

export function createProviderManager(env: ProviderEnv): ProviderManager {
  return new ProviderManager(env);
}

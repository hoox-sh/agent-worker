/**
 * Copyright (c) 2026 HOOX · HOOX · jango-blockchained (hoox-sh)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelInfo, ProviderName, TaskType } from "./types";

/**
 * Workers AI models deprecated by Cloudflare → current drop-in.
 * CONFIG_KV agent:config may still store the old id; remap before AI.run.
 * @see https://developers.cloudflare.com/workers-ai/models/
 */
export const DEPRECATED_CF_MODEL_ALIASES: Readonly<Record<string, string>> = {
  // Deprecated 2026-05-30 (error 5028 / "infire-llama" catalog string)
  "@cf/meta/llama-3.1-8b-instruct": "@cf/meta/llama-3.1-8b-instruct-fp8",
};

/** Resolve a model id, rewriting known deprecated Workers AI models. */
export function resolveCfModelId(modelId: string): string {
  return DEPRECATED_CF_MODEL_ALIASES[modelId] ?? modelId;
}

export const DEFAULT_WORKERS_AI_CHAT_MODEL =
  "@cf/meta/llama-3.1-8b-instruct-fp8" as const;

export const CF_MODELS: Record<string, ModelInfo> = {
  [DEFAULT_WORKERS_AI_CHAT_MODEL]: {
    id: DEFAULT_WORKERS_AI_CHAT_MODEL,
    provider: "workers-ai",
    taskType: "chat",
    contextLength: 128000,
    supportsStreaming: true,
  },
  "@cf/meta/llama-3-8b-instruct": {
    id: "@cf/meta/llama-3-8b-instruct",
    provider: "workers-ai",
    taskType: "chat",
    contextLength: 8192,
    supportsStreaming: true,
  },
  "@cf/meta/llama-3.2-3b-instruct": {
    id: "@cf/meta/llama-3.2-3b-instruct",
    provider: "workers-ai",
    taskType: "chat",
    contextLength: 128000,
    supportsStreaming: true,
  },
  "@cf/meta/llama-3.2-11b-vision-instruct": {
    id: "@cf/meta/llama-3.2-11b-vision-instruct",
    provider: "workers-ai",
    taskType: "vision",
    contextLength: 128000,
    supportsStreaming: true,
  },
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": {
    id: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    provider: "workers-ai",
    taskType: "reasoning",
    contextLength: 64000,
    supportsStreaming: true,
  },
  "@cf/qwen/qwen2.5-coder-32b-instruct": {
    id: "@cf/qwen/qwen2.5-coder-32b-instruct",
    provider: "workers-ai",
    taskType: "code",
    contextLength: 32000,
    supportsStreaming: true,
  },
  "@cf/qwen/qwq-32b": {
    id: "@cf/qwen/qwq-32b",
    provider: "workers-ai",
    taskType: "reasoning",
    contextLength: 32000,
    supportsStreaming: true,
  },
  "@cf/google/gemma-3-12b-it": {
    id: "@cf/google/gemma-3-12b-it",
    provider: "workers-ai",
    taskType: "chat",
    contextLength: 8192,
    supportsStreaming: true,
  },
  "@cf/meta/llama-guard-3-8b": {
    id: "@cf/meta/llama-guard-3-8b",
    provider: "workers-ai",
    taskType: "text-generation",
    contextLength: 128000,
    supportsStreaming: true,
  },
  "@cf/mistralai/mistral-small-3.1-24b-instruct": {
    id: "@cf/mistralai/mistral-small-3.1-24b-instruct",
    provider: "workers-ai",
    taskType: "chat",
    contextLength: 128000,
    supportsStreaming: true,
  },
  "@cf/baai/bge-base-en-v1.5": {
    id: "@cf/baai/bge-base-en-v1.5",
    provider: "workers-ai",
    taskType: "embedding",
  },
  "@cf/baai/bge-large-en-v1.5": {
    id: "@cf/baai/bge-large-en-v1.5",
    provider: "workers-ai",
    taskType: "embedding",
  },
  "@cf/baai/bge-m3": {
    id: "@cf/baai/bge-m3",
    provider: "workers-ai",
    taskType: "embedding",
  },
  "@cf/baai/bge-reranker-base": {
    id: "@cf/baai/bge-reranker-base",
    provider: "workers-ai",
    taskType: "embedding",
  },
  "@cf/facebook/bart-large-cnn": {
    id: "@cf/facebook/bart-large-cnn",
    provider: "workers-ai",
    taskType: "summarization",
  },
  "@cf/black-forest-labs/flux-1-schnell": {
    id: "@cf/black-forest-labs/flux-1-schnell",
    provider: "workers-ai",
    taskType: "text-generation",
  },
};

export const EXTERNAL_MODELS: Record<string, ModelInfo> = {
  "gpt-4o-mini-2024-07-18": {
    id: "gpt-4o-mini-2024-07-18",
    provider: "openai",
    taskType: "chat",
    contextLength: 128000,
    supportsStreaming: true,
  },
  "gpt-4o-2024-08-06": {
    id: "gpt-4o-2024-08-06",
    provider: "openai",
    taskType: "chat",
    contextLength: 128000,
    supportsStreaming: true,
  },
  "gpt-4-turbo": {
    id: "gpt-4-turbo",
    provider: "openai",
    taskType: "chat",
    contextLength: 128000,
    supportsStreaming: true,
  },
  "claude-3-haiku-20240307": {
    id: "claude-3-haiku-20240307",
    provider: "anthropic",
    taskType: "chat",
    contextLength: 200000,
    supportsStreaming: true,
  },
  "claude-3.5-sonnet-20241022": {
    id: "claude-3.5-sonnet-20241022",
    provider: "anthropic",
    taskType: "chat",
    contextLength: 200000,
    supportsStreaming: true,
  },
  "claude-3-opus-20240229": {
    id: "claude-3-opus-20240229",
    provider: "anthropic",
    taskType: "chat",
    contextLength: 200000,
    supportsStreaming: true,
  },
  "gemini-1.5-flash-002": {
    id: "gemini-1.5-flash-002",
    provider: "google",
    taskType: "chat",
    contextLength: 1000000,
    supportsStreaming: true,
  },
  "gemini-1.5-pro-002": {
    id: "gemini-1.5-pro-002",
    provider: "google",
    taskType: "chat",
    contextLength: 1000000,
    supportsStreaming: true,
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    provider: "azure",
    taskType: "chat",
    contextLength: 128000,
    supportsStreaming: true,
  },
  "gpt-4o": {
    id: "gpt-4o",
    provider: "azure",
    taskType: "chat",
    contextLength: 128000,
    supportsStreaming: true,
  },
};

export const ALL_MODELS: Record<string, ModelInfo> = {
  ...CF_MODELS,
  ...EXTERNAL_MODELS,
};

export function getModelInfo(modelId: string): ModelInfo | undefined {
  return ALL_MODELS[modelId];
}

export function getModelsByTask(taskType: TaskType): ModelInfo[] {
  return Object.values(ALL_MODELS).filter((m) => m.taskType === taskType);
}

export function getModelsByProvider(provider: ProviderName): ModelInfo[] {
  return Object.values(ALL_MODELS).filter((m) => m.provider === provider);
}

export function getRecommendedModel(
  taskType: TaskType,
  preferredProvider?: ProviderName
): string {
  const byTask = getModelsByTask(taskType);
  if (preferredProvider) {
    const preferred = byTask.find((m) => m.provider === preferredProvider);
    if (preferred) return preferred.id;
  }
  return byTask[0]?.id || DEFAULT_WORKERS_AI_CHAT_MODEL;
}

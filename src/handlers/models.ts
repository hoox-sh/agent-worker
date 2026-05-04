import type { ModelInfo, ProviderName, TaskType } from '../types';

const CF_MODELS: Record<string, ModelInfo> = {
  '@cf/meta/llama-3.1-8b-instruct': {
    id: '@cf/meta/llama-3.1-8b-instruct',
    provider: 'workers-ai' as ProviderName,
    taskType: 'chat' as TaskType,
    contextLength: 128000,
    supportsStreaming: true,
  },
  '@cf/meta/llama-3.2-3b-instruct': {
    id: '@cf/meta/llama-3.2-3b-instruct',
    provider: 'workers-ai' as ProviderName,
    taskType: 'chat' as TaskType,
    contextLength: 128000,
    supportsStreaming: true,
  },
  '@cf/meta/llama-3.2-11b-vision-instruct': {
    id: '@cf/meta/llama-3.2-11b-vision-instruct',
    provider: 'workers-ai' as ProviderName,
    taskType: 'vision' as TaskType,
    contextLength: 128000,
    supportsStreaming: true,
  },
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b': {
    id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    provider: 'workers-ai' as ProviderName,
    taskType: 'reasoning' as TaskType,
    contextLength: 64000,
    supportsStreaming: true,
  },
  '@cf/qwen/qwen2.5-coder-32b-instruct': {
    id: '@cf/qwen/qwen2.5-coder-32b-instruct',
    provider: 'workers-ai' as ProviderName,
    taskType: 'code' as TaskType,
    contextLength: 32000,
    supportsStreaming: true,
  },
  '@cf/qwen/qwq-32b': {
    id: '@cf/qwen/qwq-32b',
    provider: 'workers-ai' as ProviderName,
    taskType: 'reasoning' as TaskType,
    contextLength: 32000,
    supportsStreaming: true,
  },
  '@cf/google/gemma-3-12b-it': {
    id: '@cf/google/gemma-3-12b-it',
    provider: 'workers-ai' as ProviderName,
    taskType: 'chat' as TaskType,
    contextLength: 8192,
    supportsStreaming: true,
  },
  '@cf/meta/llama-guard-3-8b': {
    id: '@cf/meta/llama-guard-3-8b',
    provider: 'workers-ai' as ProviderName,
    taskType: 'text-generation' as TaskType,
    contextLength: 128000,
    supportsStreaming: true,
  },
  '@cf/mistralai/mistral-small-3.1-24b-instruct': {
    id: '@cf/mistralai/mistral-small-3.1-24b-instruct',
    provider: 'workers-ai' as ProviderName,
    taskType: 'chat' as TaskType,
    contextLength: 128000,
    supportsStreaming: true,
  },
  '@cf/baai/bge-base-en-v1.5': {
    id: '@cf/baai/bge-base-en-v1.5',
    provider: 'workers-ai' as ProviderName,
    taskType: 'embedding' as TaskType,
  },
  '@cf/baai/bge-large-en-v1.5': {
    id: '@cf/baai/bge-large-en-v1.5',
    provider: 'workers-ai' as ProviderName,
    taskType: 'embedding' as TaskType,
  },
  '@cf/baai/bge-m3': {
    id: '@cf/baai/bge-m3',
    provider: 'workers-ai' as ProviderName,
    taskType: 'embedding' as TaskType,
  },
  '@cf/baai/bge-reranker-base': {
    id: '@cf/baai/bge-reranker-base',
    provider: 'workers-ai' as ProviderName,
    taskType: 'embedding' as TaskType,
  },
  '@cf/facebook/bart-large-cnn': {
    id: '@cf/facebook/bart-large-cnn',
    provider: 'workers-ai' as ProviderName,
    taskType: 'summarization' as TaskType,
  },
  '@cf/black-forest-labs/flux-1-schnell': {
    id: '@cf/black-forest-labs/flux-1-schnell',
    provider: 'workers-ai' as ProviderName,
    taskType: 'text-generation' as TaskType,
  },
};

const EXTERNAL_MODELS: Record<string, ModelInfo> = {
  'gpt-4o-mini-2024-07-18': {
    id: 'gpt-4o-mini-2024-07-18',
    provider: 'openai' as ProviderName,
    taskType: 'chat' as TaskType,
    contextLength: 128000,
    supportsStreaming: true,
  },
  'gpt-4o-2024-08-06': {
    id: 'gpt-4o-2024-08-06',
    provider: 'openai' as ProviderName,
    taskType: 'chat' as TaskType,
    contextLength: 128000,
    supportsStreaming: true,
  },
  'o1-preview-2024-09-12': {
    id: 'o1-preview-2024-09-12',
    provider: 'openai' as ProviderName,
    taskType: 'reasoning' as TaskType,
    contextLength: 128000,
  },
  'o1-mini-2024-09-12': {
    id: 'o1-mini-2024-09-12',
    provider: 'openai' as ProviderName,
    taskType: 'reasoning' as TaskType,
    contextLength: 128000,
  },
  'claude-3-haiku-20240307': {
    id: 'claude-3-haiku-20240307',
    provider: 'anthropic' as ProviderName,
    taskType: 'chat' as TaskType,
    contextLength: 200000,
    supportsStreaming: true,
  },
  'claude-3-sonnet-20240229': {
    id: 'claude-3-sonnet-20240229',
    provider: 'anthropic' as ProviderName,
    taskType: 'chat' as TaskType,
    contextLength: 200000,
    supportsStreaming: true,
  },
  'claude-3-opus-20240229': {
    id: 'claude-3-opus-20240229',
    provider: 'anthropic' as ProviderName,
    taskType: 'chat' as TaskType,
    contextLength: 200000,
    supportsStreaming: true,
  },
  'gemini-1.5-flash-002': {
    id: 'gemini-1.5-flash-002',
    provider: 'google' as ProviderName,
    taskType: 'chat' as TaskType,
    contextLength: 1000000,
    supportsStreaming: true,
  },
  'gemini-1.5-pro-002': {
    id: 'gemini-1.5-pro-002',
    provider: 'google' as ProviderName,
    taskType: 'chat' as TaskType,
    contextLength: 2000000,
    supportsStreaming: true,
  },
};

export const ALL_MODELS: Record<string, ModelInfo> = { ...CF_MODELS, ...EXTERNAL_MODELS };

export function getModelInfo(modelId: string): ModelInfo | undefined {
  return ALL_MODELS[modelId];
}

export function getModelsByTask(taskType: TaskType): ModelInfo[] {
  return Object.values(ALL_MODELS).filter((m) => m.taskType === taskType);
}

export function getModelsByProvider(provider: ProviderName): ModelInfo[] {
  return Object.values(ALL_MODELS).filter((m) => m.provider === provider);
}

export function getRecommendedModel(taskType: TaskType, preferredProvider?: ProviderName): string {
  const byTask = getModelsByTask(taskType);
  if (preferredProvider) {
    const preferred = byTask.find((m) => m.provider === preferredProvider);
    if (preferred) return preferred.id;
  }
  return byTask[0]?.id || '@cf/meta/llama-3.1-8b-instruct';
}

export async function handleModels(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const providerFilter = url.searchParams.get('provider');
  const taskTypeFilter = url.searchParams.get('taskType');

  let models = Object.values(ALL_MODELS) as ModelInfo[];

  if (providerFilter) {
    models = models.filter(m => m.provider === providerFilter);
  }

  if (taskTypeFilter) {
    models = models.filter(m => m.taskType === taskTypeFilter);
  }

  return new Response(JSON.stringify({ models, total: models.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

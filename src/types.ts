export type ProviderName = "workers-ai" | "openai" | "anthropic" | "google";

export type TaskType =
  | "chat"
  | "embedding"
  | "vision"
  | "reasoning"
  | "code"
  | "summarization"
  | "text-generation";

export interface ModelInfo {
  id: string;
  provider: ProviderName;
  taskType: TaskType;
  contextLength?: number;
  supportsStreaming?: boolean;
}

export interface AgentConfig {
  defaultProvider: ProviderName;
  fallbackChain: ProviderName[];
  modelMap: Record<ProviderName, string>;
  timeoutMs: number;
  retryCount: number;
  maxDailyDrawdownPercent: number;
  trailingStopPercent: number;
  takeProfitPercent: number;
}

export interface AIRequest {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface AIResponse {
  response: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ProviderResult {
  success: boolean;
  data?: AIResponse;
  error?: string;
  provider: ProviderName;
  model: string;
  latencyMs?: number;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  defaultProvider: "workers-ai",
  fallbackChain: ["workers-ai", "openai"],
  modelMap: {
    "workers-ai": "@cf/meta/llama-3.1-8b-instruct",
    openai: "gpt-4o-mini-2024-07-18",
    anthropic: "claude-3-haiku-20240307",
    google: "gemini-1.5-flash-002",
  },
  timeoutMs: 30000,
  retryCount: 3,
  maxDailyDrawdownPercent: -5,
  trailingStopPercent: 0.05,
  takeProfitPercent: 0.1,
};

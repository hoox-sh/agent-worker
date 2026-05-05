export type Result<T, E = string> =
	| { ok: true; value: T }
	| { ok: false; error: E };

export type ProviderName = 'workers-ai' | 'openai' | 'anthropic' | 'google' | 'azure';

export type TaskType = 'chat' | 'embedding' | 'vision' | 'reasoning' | 'code' | 'summarization' | 'text-generation';

export interface ProviderConfig {
	name: ProviderName;
	enabled: boolean;
	apiUrl?: string;
	apiKey?: string;
	defaultModel: string;
	timeoutMs?: number;
	maxRetries?: number;
}

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
	messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
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

// Result pattern for typed error handling - imported from shared types
// Local definition removed, using shared Result<T> type

// Request body types for handlers
export interface ChatRequestBody {
	[key: string]: unknown;
	messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
	prompt?: string;
	systemPrompt?: string;
	temperature?: number;
	maxTokens?: number;
}

export interface TestModelRequestBody {
	[key: string]: unknown;
	provider?: string;
	model?: string;
	prompt?: string;
}

export interface EmbeddingRequestBody {
	[key: string]: unknown;
	text: string;
	provider?: ProviderName;
}

export interface RiskOverrideRequestBody {
	trailingStopPercent?: number;
}

export interface ConfigUpdateRequestBody {
	defaultProvider?: ProviderName;
	fallbackChain?: ProviderName[];
	modelMap?: Record<ProviderName, string>;
	timeoutMs?: number;
	retryCount?: number;
	maxDailyDrawdownPercent?: number;
	trailingStopPercent?: number;
	takeProfitPercent?: number;
}

// Position type for risk management
export interface Position {
	symbol: string;
	side: 'LONG' | 'SHORT';
	size: number;
	entry_price: number;
	exchange: string;
}

// Environment bindings (from wrangler.jsonc)
export interface Env {
  AI: Ai;
  CONFIG_KV: KVNamespace;
  D1_SERVICE: Fetcher;
  TRADE_SERVICE: Fetcher;
  TELEGRAM_SERVICE: Fetcher;
  ANALYTICS_SERVICE?: Fetcher;
  INTERNAL_API_KEY: string;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
	defaultProvider: 'workers-ai',
	fallbackChain: ['workers-ai', 'openai'],
	modelMap: {
		'workers-ai': '@cf/meta/llama-3.1-8b-instruct',
		openai: 'gpt-4o-mini-2024-07-18',
		anthropic: 'claude-3-haiku-20240307',
		google: 'gemini-1.5-flash-002',
		azure: 'gpt-4o-mini',
	},
	timeoutMs: 30000,
	retryCount: 3,
	maxDailyDrawdownPercent: -5,
	trailingStopPercent: 0.05,
	takeProfitPercent: 0.1,
};

import type { ProviderName, Result } from '../../types';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	name?: string;
}

export interface ChatRequest {
	messages: ChatMessage[];
	model: string;
	temperature?: number;
	maxTokens?: number;
	topP?: number;
	stopSequences?: string[];
	stream?: boolean;
	systemPrompt?: string;
}

export interface ChatUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
}

export interface ChatResult {
	response: string;
	model: string;
	provider: ProviderName;
	usage?: ChatUsage;
	finishReason?: string;
}

export interface StreamChunk {
	content: string;
	model: string;
	provider: ProviderName;
	done: boolean;
}

export interface AIProvider {
	name: ProviderName;
	chat(request: ChatRequest): Promise<ChatResult>;
	chatStream?(request: ChatRequest): AsyncGenerator<StreamChunk>;
	isHealthy(): Promise<boolean>;
}

export function validateChatRequest(request: ChatRequest): Result<void> {
	if (!request.model) {
		return { ok: false, error: 'Model is required' };
	}

	if (!request.messages || request.messages.length === 0) {
		return { ok: false, error: 'At least one message is required' };
	}

	if (request.temperature !== undefined && (request.temperature < 0 || request.temperature > 2)) {
		return { ok: false, error: 'Temperature must be between 0 and 2' };
	}

	if (request.maxTokens !== undefined && request.maxTokens <= 0) {
		return { ok: false, error: 'maxTokens must be positive' };
	}

	return { ok: true, value: undefined };
}

export function mergeMessages(
	messages: ChatMessage[],
	systemPrompt?: string,
): ChatMessage[] {
	if (!systemPrompt) {
		return messages;
	}

	const result = [...messages];
	const existingSystemIndex = result.findIndex((m) => m.role === 'system');

	if (existingSystemIndex >= 0) {
		result[existingSystemIndex] = { role: 'system', content: systemPrompt };
	} else {
		result.unshift({ role: 'system', content: systemPrompt });
	}

	return result;
}

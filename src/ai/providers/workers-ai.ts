import type { Env, ProviderName } from '../../../types';
import type { AIProvider, ChatRequest, ChatResult, StreamChunk } from './base';
import { validateChatRequest, mergeMessages } from './base';

export class WorkersAIProvider implements AIProvider {
	name: ProviderName = 'workers-ai';

	constructor(private ai: Env['AI']) {}

	async chat(request: ChatRequest): Promise<ChatResult> {
		const validation = validateChatRequest(request);
		if (!validation.ok) {
			throw new Error(validation.error);
		}

		const messages = mergeMessages(request.messages, request.systemPrompt);

		const result = await this.ai.run(request.model, {
			messages,
			temperature: request.temperature ?? 0.7,
			max_tokens: request.maxTokens ?? 1024,
			top_p: request.topP,
		});

		const raw = result as {
			response: string;
			usage?: { prompt_tokens: number; completion_tokens: number };
		};

		return {
			response: raw.response,
			model: request.model,
			provider: this.name,
			usage: raw.usage
				? {
						promptTokens: raw.usage.prompt_tokens,
						completionTokens: raw.usage.completion_tokens,
						totalTokens: raw.usage.prompt_tokens + raw.usage.completion_tokens,
					}
				: undefined,
		};
	}

	async isHealthy(): Promise<boolean> {
		try {
			await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
				messages: [{ role: 'user', content: 'ping' }],
				max_tokens: 1,
			});
			return true;
		} catch {
			return false;
		}
	}
}

import type { ProviderName } from '../../types';
import type { AIProvider, ChatRequest, ChatResult, ChatMessage, StreamChunk } from './base';
import { validateChatRequest } from './base';

export class AnthropicProvider implements AIProvider {
	name: ProviderName = 'anthropic';
	private baseUrl = 'https://api.anthropic.com/v1';

	constructor(
		private apiKey: string,
		private fetchFn: typeof fetch = fetch,
	) {}

	async chat(request: ChatRequest): Promise<ChatResult> {
		const validation = validateChatRequest(request);
		if (!validation.ok) {
			throw new Error(validation.error);
		}

		// Extract system prompt and user messages
		const systemMessage = request.messages.find(m => m.role === 'system');
		const messages = request.messages
			.filter(m => m.role !== 'system')
			.map(m => ({ role: m.role, content: m.content }));

		const response = await this.fetchFn(
			`${this.baseUrl}/messages`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': this.apiKey,
					'anthropic-version': '2023-06-01',
				},
				body: JSON.stringify({
					model: request.model,
					messages,
					system: systemMessage?.content || request.systemPrompt,
					max_tokens: request.maxTokens ?? 1024,
					temperature: request.temperature ?? 0.7,
					top_p: request.topP,
					stop_sequences: request.stopSequences,
				}),
			},
		);

		if (!response.ok) {
			const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
			throw new Error(`Anthropic API error: ${error.error?.message || response.statusText}`);
		}

		const data = await response.json() as {
			content: Array<{ type: string; text: string }>;
			usage?: { input_tokens: number; output_tokens: number };
			stop_reason?: string;
			model: string;
		};

		return {
			response: data.content?.[0]?.text || '',
			model: data.model || request.model,
			provider: this.name,
			usage: data.usage
				? {
							promptTokens: data.usage.input_tokens,
							completionTokens: data.usage.output_tokens,
							totalTokens: data.usage.input_tokens + data.usage.output_tokens,
						}
				: undefined,
			finishReason: data.stop_reason,
		};
	}

	async isHealthy(): Promise<boolean> {
		try {
			const response = await this.fetchFn(
				`${this.baseUrl}/messages`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'x-api-key': this.apiKey,
						'anthropic-version': '2023-06-01',
					},
					body: JSON.stringify({
						model: 'claude-3-haiku-20240307',
						messages: [{ role: 'user', content: 'ping' }],
						max_tokens: 1,
					}),
				},
			);
			return response.ok;
		} catch {
			return false;
		}
	}
}

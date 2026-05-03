import type { ProviderName } from '../../types';
import type { AIProvider, ChatRequest, ChatResult, StreamChunk } from './base';
import { validateChatRequest, mergeMessages } from './base';

export class OpenAIProvider implements AIProvider {
	name: ProviderName = 'openai';
	private baseUrl = 'https://api.openai.com/v1';

	constructor(
		private apiKey: string,
		private fetchFn: typeof fetch = fetch,
	) {}

	async chat(request: ChatRequest): Promise<ChatResult> {
		const validation = validateChatRequest(request);
		if (!validation.ok) {
			throw new Error(validation.error);
		}

		const messages = mergeMessages(request.messages, request.systemPrompt);

		const response = await this.fetchFn(
			`${this.baseUrl}/chat/completions`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({
					model: request.model,
					messages,
					temperature: request.temperature ?? 0.7,
					max_tokens: request.maxTokens ?? 1024,
					top_p: request.topP,
					stop: request.stopSequences,
					stream: false,
				}),
			},
		);

if (!response.ok) {
  const errorBody = await response.json().catch(() => ({ error: 'Unknown error' }));
  const errorMessage = typeof errorBody === 'object' && errorBody !== null && 'error' in errorBody
    ? String((errorBody as Record<string, unknown>).error)
    : response.statusText;
  throw new Error(`OpenAI API error: ${errorMessage}`);
}

		const data = await response.json() as {
			choices: Array<{ message: { content: string }; finish_reason: string }>;
			usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
			model: string;
		};

		return {
			response: data.choices[0]?.message?.content || '',
			model: data.model || request.model,
			provider: this.name,
			usage: data.usage
				? {
							promptTokens: data.usage.prompt_tokens,
							completionTokens: data.usage.completion_tokens,
							totalTokens: data.usage.total_tokens,
						}
				: undefined,
			finishReason: data.choices[0]?.finish_reason,
		};
	}

	async isHealthy(): Promise<boolean> {
		try {
			const response = await this.fetchFn(
				`${this.baseUrl}/chat/completions`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': `Bearer ${this.apiKey}`,
					},
					body: JSON.stringify({
						model: 'gpt-4o-mini',
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

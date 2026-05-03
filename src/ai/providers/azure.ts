import type { ProviderName } from '../../types';
import type { AIProvider, ChatRequest, ChatResult, StreamChunk } from './base';
import { validateChatRequest, mergeMessages } from './base';

interface AzureChatResponse {
	choices: Array<{
		message?: { content: string; role: string };
		delta?: { content?: string; role?: string };
		finish_reason: string | null;
	}>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

export class AzureProvider implements AIProvider {
	name: ProviderName = 'azure';
	private apiVersion = '2024-02-15-preview';

	constructor(
		private endpoint: string, // e.g. https://my-resource.openai.azure.com
		private apiKey: string,
		private deploymentName: string,
		private fetchFn: typeof fetch = fetch,
	) {}

	async chat(request: ChatRequest): Promise<ChatResult> {
		const validation = validateChatRequest(request);
		if (!validation.ok) {
			throw new Error(validation.error);
		}

		const messages = mergeMessages(request.messages, request.systemPrompt);

		const url = `${this.endpoint}/openai/deployments/${this.deploymentName}/chat/completions?api-version=${this.apiVersion}`;

		const body: Record<string, unknown> = {
			messages,
			temperature: request.temperature ?? 0.7,
			max_tokens: request.maxTokens ?? 1024,
			top_p: request.topP,
			stop: request.stopSequences,
			stream: request.stream ?? false,
		};

		const res = await this.fetchFn(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'api-key': this.apiKey,
			},
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			const error = await res.json().catch(() => ({ error: { message: 'Unknown error' } }));
			throw new Error(`Azure OpenAI error: ${error.error?.message || res.statusText}`);
		}

		const data = await res.json() as AzureChatResponse;

		// Handle streaming response
		if (request.stream) {
			const content = data.choices?.[0]?.delta?.content || '';
			return {
				response: content,
				model: this.deploymentName,
				provider: this.name,
				finishReason: data.choices?.[0]?.finish_reason || undefined,
			};
		}

		// Handle non-streaming response
		return {
			response: data.choices?.[0]?.message?.content || '',
			model: this.deploymentName,
			provider: this.name,
			usage: data.usage
				? {
							promptTokens: data.usage.prompt_tokens,
							completionTokens: data.usage.completion_tokens,
							totalTokens: data.usage.total_tokens,
						}
				: undefined,
			finishReason: data.choices?.[0]?.finish_reason || undefined,
		};
	}

	async isHealthy(): Promise<boolean> {
		try {
			const url = `${this.endpoint}/openai/deployments/${this.deploymentName}/chat/completions?api-version=${this.apiVersion}`;
			const res = await this.fetchFn(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'api-key': this.apiKey,
				},
				body: JSON.stringify({
					messages: [{ role: 'user', content: 'ping' }],
					max_tokens: 1,
				}),
			});
			return res.ok;
		} catch {
			return false;
		}
	}
}

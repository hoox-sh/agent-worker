import type { ProviderName } from '../../types';
import type { AIProvider, ChatRequest, ChatResult, StreamChunk } from './base';
import { validateChatRequest } from './base';

export class GoogleProvider implements AIProvider {
	name: ProviderName = 'google';
	private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';

	constructor(
		private apiKey: string,
		private fetchFn: typeof fetch = fetch,
	) {}

	async chat(request: ChatRequest): Promise<ChatResult> {
		const validation = validateChatRequest(request);
		if (!validation.ok) {
			throw new Error(validation.error);
		}

		const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
		let systemInstruction: { parts: Array<{ text: string }> } | undefined;

		for (const msg of request.messages) {
			if (msg.role === 'system') {
				systemInstruction = { parts: [{ text: msg.content }] };
			} else if (msg.role === 'user') {
				contents.push({ role: 'user', parts: [{ text: msg.content }] });
			} else if (msg.role === 'assistant') {
				contents.push({ role: 'model', parts: [{ text: msg.content }] });
			}
		}

		// Override system instruction if explicit systemPrompt provided
		if (request.systemPrompt) {
			systemInstruction = { parts: [{ text: request.systemPrompt }] };
		}

		const body: Record<string, unknown> = {
			contents,
			generationConfig: {
				temperature: request.temperature ?? 0.7,
				maxOutputTokens: request.maxTokens ?? 1024,
				topP: request.topP,
				stopSequences: request.stopSequences,
			},
		};

		if (systemInstruction) {
			body.systemInstruction = systemInstruction;
		}

		const url = `${this.baseUrl}/${request.model}:generateContent?key=${this.apiKey}`;

		const res = await this.fetchFn(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			const error = await res.json().catch(() => ({ error: { message: 'Unknown error' } }));
			throw new Error(`Google API error: ${error.error?.message || res.statusText}`);
		}

		const data = await res.json() as {
			candidates: Array<{ content: { parts: Array<{ text: string }> }; finishReason: string }>;
			usageMetadata?: {
				promptTokenCount: number;
				candidatesTokenCount: number;
				totalTokenCount: number;
			};
			model: string;
		};

		return {
			response: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
			model: data.model || request.model,
			provider: this.name,
			usage: data.usageMetadata
				? {
							promptTokens: data.usageMetadata.promptTokenCount,
							completionTokens: data.usageMetadata.candidatesTokenCount,
							totalTokens: data.usageMetadata.totalTokenCount,
						}
				: undefined,
			finishReason: data.candidates?.[0]?.finishReason,
		};
	}

	async isHealthy(): Promise<boolean> {
		try {
			const url = `${this.baseUrl}/gemini-1.5-flash-002:generateContent?key=${this.apiKey}`;
			const res = await this.fetchFn(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
					generationConfig: { maxOutputTokens: 1 },
				}),
			});
			return res.ok;
		} catch {
			return false;
		}
	}
}

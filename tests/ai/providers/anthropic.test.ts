import { describe, expect, test, mock } from 'bun:test';
import { AnthropicProvider } from '../../../src/ai/providers/anthropic';

describe('AnthropicProvider', () => {
	test('chat sends correct request to Anthropic API', async () => {
		const mockFetch = mock(async (url: string, init: RequestInit) => {
			expect(url).toBe('https://api.anthropic.com/v1/messages');
			expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test');
			expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
			const body = JSON.parse(init.body as string);
			expect(body.model).toBe('claude-3-haiku-20240307');
			expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
			expect(body.max_tokens).toBe(1024);
			return new Response(JSON.stringify({
				content: [{ type: 'text', text: 'Hello back!' }],
				usage: { input_tokens: 5, output_tokens: 3 },
				stop_reason: 'end_turn',
			}));
		});

		const provider = new AnthropicProvider('sk-ant-test', mockFetch as typeof fetch);
		const result = await provider.chat({
			messages: [{ role: 'user', content: 'Hello' }],
			model: 'claude-3-haiku-20240307',
		});

		expect(result.response).toBe('Hello back!');
		expect(result.provider).toBe('anthropic');
		expect(result.usage?.promptTokens).toBe(5);
		expect(result.usage?.completionTokens).toBe(3);
		expect(result.finishReason).toBe('end_turn');
	});

	test('chat extracts system prompt from messages', async () => {
		let capturedBody: string | undefined;
		const mockFetch = mock(async (_url: string, init: RequestInit) => {
			capturedBody = init.body as string;
			return new Response(JSON.stringify({
				content: [{ type: 'text', text: 'ok' }],
				stop_reason: 'end_turn',
			}));
		});

		const provider = new AnthropicProvider('sk-ant-test', mockFetch as typeof fetch);
		await provider.chat({
			messages: [
				{ role: 'system', content: 'You are helpful' },
				{ role: 'user', content: 'Hello' },
			],
			model: 'claude-3-haiku-20240307',
		});

		const body = JSON.parse(capturedBody!);
		expect(body.system).toBe('You are helpful');
		expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
	});

	test('chat applies temperature', async () => {
		let capturedBody: string | undefined;
		const mockFetch = mock(async (_url: string, init: RequestInit) => {
			capturedBody = init.body as string;
			return new Response(JSON.stringify({
				content: [{ type: 'text', text: 'ok' }],
				stop_reason: 'end_turn',
			}));
		});

		const provider = new AnthropicProvider('sk-ant-test', mockFetch as typeof fetch);
		await provider.chat({
			messages: [{ role: 'user', content: 'Hello' }],
			model: 'claude-3-haiku-20240307',
			temperature: 0.5,
		});

		const body = JSON.parse(capturedBody!);
		expect(body.temperature).toBe(0.5);
	});

	test('chat handles API error', async () => {
		const mockFetch = mock(async () =>
			new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 })
		);

		const provider = new AnthropicProvider('sk-ant-invalid', mockFetch as typeof fetch);
		await expect(
			provider.chat({
				messages: [{ role: 'user', content: 'Hello' }],
				model: 'claude-3-haiku-20240307',
			}),
		).rejects.toThrow('Invalid API key');
	});

	test('isHealthy returns true on success', async () => {
		const mockFetch = mock(async () =>
			new Response(JSON.stringify({
				content: [{ type: 'text', text: 'pong' }],
				stop_reason: 'end_turn',
			}))
		);

		const provider = new AnthropicProvider('sk-ant-test', mockFetch as typeof fetch);
		const healthy = await provider.isHealthy();
		expect(healthy).toBe(true);
	});

	test('isHealthy returns false on failure', async () => {
		const mockFetch = mock(async () => new Response('error', { status: 500 }));

		const provider = new AnthropicProvider('sk-ant-test', mockFetch as typeof fetch);
		const healthy = await provider.isHealthy();
		expect(healthy).toBe(false);
	});
});

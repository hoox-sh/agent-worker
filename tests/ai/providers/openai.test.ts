import { describe, expect, test, mock, afterEach } from 'bun:test';
import { OpenAIProvider } from '../../../src/ai/providers/openai';

describe('OpenAIProvider', () => {
	afterEach(() => {
		// Restore global fetch if mocked
	});

	test('chat sends correct request to OpenAI API', async () => {
		const mockFetch = mock(async (url: string, init: RequestInit) => {
			expect(url).toBe('https://api.openai.com/v1/chat/completions');
			expect((init.headers as Record<string, string>)['Authorization']).toContain('Bearer sk-test');
			const body = JSON.parse(init.body as string);
			expect(body.model).toBe('gpt-4o-mini');
			expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
			return new Response(JSON.stringify({
				choices: [{ message: { content: 'Hello back!' }, finish_reason: 'stop' }],
				usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
			}));
		});

		const provider = new OpenAIProvider('sk-test', mockFetch as typeof fetch);
		const result = await provider.chat({
			messages: [{ role: 'user', content: 'Hello' }],
			model: 'gpt-4o-mini',
		});

		expect(result.response).toBe('Hello back!');
		expect(result.provider).toBe('openai');
		expect(result.model).toBe('gpt-4o-mini');
		expect(result.usage?.totalTokens).toBe(8);
		expect(result.finishReason).toBe('stop');
	});

	test('chat applies system prompt', async () => {
		let capturedBody: string | undefined;
		const mockFetch = mock(async (_url: string, init: RequestInit) => {
			capturedBody = init.body as string;
			return new Response(JSON.stringify({
				choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
			}));
		});

		const provider = new OpenAIProvider('sk-test', mockFetch as typeof fetch);
		await provider.chat({
			messages: [{ role: 'user', content: 'Hello' }],
			model: 'gpt-4o-mini',
			systemPrompt: 'You are a trading assistant',
		});

		const body = JSON.parse(capturedBody!);
		expect(body.messages[0].role).toBe('system');
		expect(body.messages[0].content).toBe('You are a trading assistant');
	});

	test('chat applies temperature and maxTokens', async () => {
		let capturedBody: string | undefined;
		const mockFetch = mock(async (_url: string, init: RequestInit) => {
			capturedBody = init.body as string;
			return new Response(JSON.stringify({
				choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
			}));
		});

		const provider = new OpenAIProvider('sk-test', mockFetch as typeof fetch);
		await provider.chat({
			messages: [{ role: 'user', content: 'Hello' }],
			model: 'gpt-4o-mini',
			temperature: 0.5,
			maxTokens: 512,
		});

		const body = JSON.parse(capturedBody!);
		expect(body.temperature).toBe(0.5);
		expect(body.max_tokens).toBe(512);
	});

	test('isHealthy returns true when API responds', async () => {
		const mockFetch = mock(async () => {
			return new Response(JSON.stringify({
				choices: [{ message: { content: 'pong' } }],
			}));
		});

		const provider = new OpenAIProvider('sk-test', mockFetch as typeof fetch);
		const healthy = await provider.isHealthy();
		expect(healthy).toBe(true);
	});

	test('isHealthy returns false when API fails', async () => {
		const mockFetch = mock(async () => {
			return new Response(null, { status: 401 });
		});

		const provider = new OpenAIProvider('sk-test', mockFetch as typeof fetch);
		const healthy = await provider.isHealthy();
		expect(healthy).toBe(false);
	});

	test('chat throws on API error', async () => {
		const mockFetch = mock(async () => {
			return new Response(JSON.stringify({ error: 'Invalid API key' }), { status: 401 });
		});

		const provider = new OpenAIProvider('sk-test', mockFetch as typeof fetch);
		await expect(
			provider.chat({
				messages: [{ role: 'user', content: 'Hello' }],
				model: 'gpt-4o-mini',
			}),
		).rejects.toThrow('OpenAI API error');
	});
});

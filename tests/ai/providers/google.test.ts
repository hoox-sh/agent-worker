import { describe, expect, test, mock } from 'bun:test';
import { GoogleProvider } from '../../../src/ai/providers/google';

describe('GoogleProvider', () => {
	test('chat sends correct request to Google API', async () => {
		const mockFetch = mock(async (url: string, init: RequestInit) => {
			expect(url).toContain('generativelanguage.googleapis.com');
			expect(url).toContain('key=');
			const body = JSON.parse(init.body as string);
			expect(body.contents).toBeDefined();
			expect(body.contents.length).toBeGreaterThan(0);
			return new Response(JSON.stringify({
				candidates: [{ content: { parts: [{ text: 'Hello back!' }] }, finishReason: 'STOP' }],
				usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
			}));
		});

		const provider = new GoogleProvider('google-api-key', mockFetch as typeof fetch);
		const result = await provider.chat({
			messages: [{ role: 'user', content: 'Hello' }],
			model: 'gemini-1.5-flash-002',
		});

		expect(result.response).toBe('Hello back!');
		expect(result.provider).toBe('google');
		expect(result.usage?.totalTokens).toBe(8);
		expect(result.finishReason).toBe('STOP');
	});

	test('chat converts messages to Google format', async () => {
		let capturedBody: string | undefined;
		const mockFetch = mock(async (_url: string, init: RequestInit) => {
			capturedBody = init.body as string;
			return new Response(JSON.stringify({
				candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
			}));
		});

		const provider = new GoogleProvider('google-api-key', mockFetch as typeof fetch);
		await provider.chat({
			messages: [
				{ role: 'user', content: 'Hello' },
				{ role: 'assistant', content: 'Hi there' },
				{ role: 'user', content: 'How are you?' },
			],
			model: 'gemini-1.5-flash-002',
		});

		const body = JSON.parse(capturedBody!);
		expect(body.contents.length).toBe(3);
		expect(body.contents[0].role).toBe('user');
		expect(body.contents[1].role).toBe('model');
		expect(body.contents[2].role).toBe('user');
	});

	test('chat applies system instruction', async () => {
		let capturedBody: string | undefined;
		const mockFetch = mock(async (_url: string, init: RequestInit) => {
			capturedBody = init.body as string;
			return new Response(JSON.stringify({
				candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
			}));
		});

		const provider = new GoogleProvider('google-api-key', mockFetch as typeof fetch);
		await provider.chat({
			messages: [{ role: 'user', content: 'Hello' }],
			model: 'gemini-1.5-flash-002',
			systemPrompt: 'You are a trading assistant',
		});

		const body = JSON.parse(capturedBody!);
		expect(body.systemInstruction).toBeDefined();
		expect(body.systemInstruction.parts[0].text).toBe('You are a trading assistant');
	});

	test('chat handles API error', async () => {
		const mockFetch = mock(async () =>
			new Response(JSON.stringify({ error: { message: 'API key not valid', status: 'INVALID_ARGUMENT' } }), { status: 400 })
		);

		const provider = new GoogleProvider('invalid-key', mockFetch as typeof fetch);
		await expect(
			provider.chat({
				messages: [{ role: 'user', content: 'Hello' }],
				model: 'gemini-1.5-flash-002',
			}),
		).rejects.toThrow('API key not valid');
	});

	test('isHealthy returns true on success', async () => {
		const mockFetch = mock(async () =>
			new Response(JSON.stringify({
				candidates: [{ content: { parts: [{ text: 'pong' }] }, finishReason: 'STOP' }],
			}))
		);

		const provider = new GoogleProvider('google-api-key', mockFetch as typeof fetch);
		const healthy = await provider.isHealthy();
		expect(healthy).toBe(true);
	});

	test('isHealthy returns false on failure', async () => {
		const mockFetch = mock(async () => new Response('error', { status: 500 }));

		const provider = new GoogleProvider('google-api-key', mockFetch as typeof fetch);
		const healthy = await provider.isHealthy();
		expect(healthy).toBe(false);
	});
});

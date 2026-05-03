import { describe, expect, test, mock } from 'bun:test';
import { AzureProvider } from '../../../src/ai/providers/azure';

describe('AzureProvider', () => {
	test('chat sends correct request to Azure OpenAI', async () => {
		const mockFetch = mock(async (url: string, init: RequestInit) => {
			expect(url).toContain('openai.azure.com');
			expect(url).toContain('deployments/gpt-4o-mini');
			expect(url).toContain('api-version=2024-02-15-preview');
			expect((init.headers as Record<string, string>)['api-key']).toBe('azure-api-key');
			const body = JSON.parse(init.body as string);
			expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
			return new Response(JSON.stringify({
				choices: [{ message: { content: 'Hello from Azure!' }, finish_reason: 'stop' }],
				usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
			}));
		});

		const provider = new AzureProvider(
			'https://my-resource.openai.azure.com',
			'azure-api-key',
			'gpt-4o-mini',
			mockFetch as typeof fetch,
		);
		const result = await provider.chat({
			messages: [{ role: 'user', content: 'Hello' }],
			model: 'gpt-4o-mini',
		});

		expect(result.response).toBe('Hello from Azure!');
		expect(result.provider).toBe('azure');
		expect(result.usage?.totalTokens).toBe(8);
	});

	test('chat uses deployment name as model', async () => {
		let capturedUrl: string | undefined;
		const mockFetch = mock(async (url: string) => {
			capturedUrl = url;
			return new Response(JSON.stringify({
				choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
			}));
		});

		const provider = new AzureProvider(
			'https://my-resource.openai.azure.com',
			'azure-api-key',
			'my-gpt4-deployment',
			mockFetch as typeof fetch,
		);
		await provider.chat({
			messages: [{ role: 'user', content: 'Hello' }],
			model: 'my-gpt4-deployment',
		});

		expect(capturedUrl).toContain('deployments/my-gpt4-deployment');
	});

	test('chat applies system prompt', async () => {
		let capturedBody: string | undefined;
		const mockFetch = mock(async (_url: string, init: RequestInit) => {
			capturedBody = init.body as string;
			return new Response(JSON.stringify({
				choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
			}));
		});

		const provider = new AzureProvider(
			'https://my-resource.openai.azure.com',
			'azure-api-key',
			'gpt-4o-mini',
			mockFetch as typeof fetch,
		);
		await provider.chat({
			messages: [{ role: 'user', content: 'Hello' }],
			model: 'gpt-4o-mini',
			systemPrompt: 'You are helpful',
		});

		const body = JSON.parse(capturedBody!);
		expect(body.messages[0].role).toBe('system');
		expect(body.messages[0].content).toBe('You are helpful');
	});

	test('chat handles API error', async () => {
		const mockFetch = mock(async () =>
			new Response(JSON.stringify({ error: { message: 'Resource not found' } }), { status: 404 })
		);

		const provider = new AzureProvider(
			'https://my-resource.openai.azure.com',
			'azure-api-key',
			'gpt-4o-mini',
			mockFetch as typeof fetch,
		);
		await expect(
			provider.chat({
				messages: [{ role: 'user', content: 'Hello' }],
				model: 'gpt-4o-mini',
			}),
		).rejects.toThrow('Resource not found');
	});

	test('isHealthy returns true on success', async () => {
		const mockFetch = mock(async () =>
			new Response(JSON.stringify({
				choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }],
			}))
		);

		const provider = new AzureProvider(
			'https://my-resource.openai.azure.com',
			'azure-api-key',
			'gpt-4o-mini',
			mockFetch as typeof fetch,
		);
		const healthy = await provider.isHealthy();
		expect(healthy).toBe(true);
	});

	test('isHealthy returns false on failure', async () => {
		const mockFetch = mock(async () => new Response('error', { status: 500 }));

		const provider = new AzureProvider(
			'https://my-resource.openai.azure.com',
			'azure-api-key',
			'gpt-4o-mini',
			mockFetch as typeof fetch,
		);
		const healthy = await provider.isHealthy();
		expect(healthy).toBe(false);
	});

	test('supports streaming', async () => {
		const mockFetch = mock(async (_url: string, init: RequestInit) => {
			const body = JSON.parse(init.body as string);
			expect(body.stream).toBe(true);
			return new Response(JSON.stringify({
				choices: [{ delta: { content: 'Hello' }, finish_reason: null }],
			}));
		});

		const provider = new AzureProvider(
			'https://my-resource.openai.azure.com',
			'azure-api-key',
			'gpt-4o-mini',
			mockFetch as typeof fetch,
		);
		const result = await provider.chat({
			messages: [{ role: 'user', content: 'Hello' }],
			model: 'gpt-4o-mini',
			stream: true,
		});

		expect(result.response).toBe('Hello');
	});
});

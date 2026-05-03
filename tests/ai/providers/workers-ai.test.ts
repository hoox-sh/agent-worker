import { describe, expect, test, mock } from 'bun:test';
import { WorkersAIProvider } from '../../../src/ai/providers/workers-ai';
import type { Env } from '../../../src/types';

function makeMockAI(responses: Record<string, unknown> = {}): any {
	return {
		run: mock(async (model: string, _input: unknown) => {
			const key = model as string;
			if (responses[key]) return responses[key];
			return { response: 'Workers AI response' };
		}),
	} as unknown as unknown as Env['AI'];
}

describe('WorkersAIProvider', () => {
	test('chat returns response from Workers AI', async () => {
		const ai = makeMockAI();
		const provider = new WorkersAIProvider(ai);
		const result = await provider.chat({
			messages: [{ role: 'user', content: 'Hello' }],
			model: '@cf/meta/llama-3.1-8b-instruct',
		});
		expect(result.response).toBe('Workers AI response');
		expect(result.provider).toBe('workers-ai');
		expect(result.model).toBe('@cf/meta/llama-3.1-8b-instruct');
	});

	test('chat includes usage when available', async () => {
		const ai = makeMockAI({
			'@cf/meta/llama-3.1-8b-instruct': {
				response: 'Hello back',
				usage: { prompt_tokens: 10, completion_tokens: 5 },
			},
		});
		const provider = new WorkersAIProvider(ai);
		const result = await provider.chat({
			messages: [{ role: 'user', content: 'Hello' }],
			model: '@cf/meta/llama-3.1-8b-instruct',
		});
		expect(result.usage).toBeDefined();
		expect(result.usage?.promptTokens).toBe(10);
		expect(result.usage?.completionTokens).toBe(5);
		expect(result.usage?.totalTokens).toBe(15);
	});

	test('chat applies temperature and maxTokens', async () => {
		let capturedInput: unknown;
		const ai = {
			run: mock(async (_model: string, input: unknown) => {
				capturedInput = input;
				return { response: 'ok' };
			}),
		} as unknown as Env['AI'];
		const provider = new WorkersAIProvider(ai);
		await provider.chat({
			messages: [{ role: 'user', content: 'Hello' }],
			model: '@cf/meta/llama-3.1-8b-instruct',
			temperature: 0.5,
			maxTokens: 512,
		});
		expect((capturedInput as any).temperature).toBe(0.5);
		expect((capturedInput as any).max_tokens).toBe(512);
	});

	test('isHealthy returns true when AI binding responds', async () => {
		const ai = makeMockAI();
		const provider = new WorkersAIProvider(ai);
		const healthy = await provider.isHealthy();
		expect(healthy).toBe(true);
	});

	test('isHealthy returns false when AI binding throws', async () => {
		const ai = {
			run: mock(async () => { throw new Error('AI unavailable'); }),
		} as unknown as Env['AI'];
		const provider = new WorkersAIProvider(ai);
		const healthy = await provider.isHealthy();
		expect(healthy).toBe(false);
	});

	test('chat throws on AI failure', async () => {
		const ai = {
			run: mock(async () => { throw new Error('Model error'); }),
		} as unknown as Env['AI'];
		const provider = new WorkersAIProvider(ai);
		await expect(
			provider.chat({
				messages: [{ role: 'user', content: 'Hello' }],
				model: '@cf/meta/llama-3.1-8b-instruct',
			}),
		).rejects.toThrow('Model error');
	});
});

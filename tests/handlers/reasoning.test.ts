import { describe, expect, test, mock } from 'bun:test';
import { handleReasoning } from '../../src/handlers/reasoning';
import type { Env } from '../../src/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
	return {
		AI: {
			run: mock(async () => ({
				reasoning: 'Step 1: Analyze the problem...\nStep 2: Consider options...\nStep 3: Conclude...',
				response: 'Final answer after reasoning',
			})),
		} as unknown as Env['AI'],
		CONFIG_KV: { get: mock(async () => null), put: mock(async () => {}) } as unknown as Env['CONFIG_KV'],
		D1_SERVICE: {} as unknown as Env['D1_SERVICE'],
		TRADE_SERVICE: {} as unknown as Env['TRADE_SERVICE'],
		TELEGRAM_SERVICE: {} as unknown as Env['TELEGRAM_SERVICE'],
		...overrides,
	} as Env;
}

describe('handleReasoning', () => {
	test('returns reasoning and answer for valid request', async () => {
		const env = makeEnv();
		const req = new Request('http://localhost/agent/reasoning', {
			method: 'POST',
			body: JSON.stringify({ prompt: 'Solve this problem...' }),
		});
		const res = await handleReasoning(req, env);
		expect(res.status).toBe(200);
		const body = await res.json() as any;
		expect(body.reasoning).toBeDefined();
		expect(body.answer).toBe('Final answer after reasoning');
		expect(body.model).toBeDefined();
	});

	test('uses custom model when specified', async () => {
		let capturedModel: string | undefined;
		const env = makeEnv({
			AI: {
				run: mock(async (model: string) => {
					capturedModel = model;
					return {
						reasoning: 'Thinking...',
						response: 'Answer',
					};
				}),
			} as unknown as Env['AI'],
		});
		const req = new Request('http://localhost/agent/reasoning', {
			method: 'POST',
			body: JSON.stringify({
				prompt: 'Solve this',
				model: 'o1-preview',
			}),
		});
		await handleReasoning(req, env);
		expect(capturedModel).toBe('o1-preview');
	});

	test('returns 400 for missing prompt', async () => {
		const env = makeEnv();
		const req = new Request('http://localhost/agent/reasoning', {
			method: 'POST',
			body: JSON.stringify({}),
		});
		const res = await handleReasoning(req, env);
		expect(res.status).toBe(400);
	});

	test('supports reasoningEffort parameter', async () => {
		let capturedInput: unknown;
		const env = makeEnv({
			AI: {
				run: mock(async (_model: string, input: unknown) => {
					capturedInput = input;
					return {
						reasoning: 'Thinking...',
						response: 'Answer',
					};
				}),
			} as unknown as Env['AI'],
		});
		const req = new Request('http://localhost/agent/reasoning', {
			method: 'POST',
			body: JSON.stringify({
				prompt: 'Solve this',
				reasoningEffort: 'high',
			}),
		});
		await handleReasoning(req, env);
		expect((capturedInput as any).reasoning_effort).toBe('high');
	});

	test('handles API errors gracefully', async () => {
		const env = makeEnv({
			AI: {
				run: mock(async () => { throw new Error('Model error'); }),
			} as unknown as Env['AI'],
		});
		const req = new Request('http://localhost/agent/reasoning', {
			method: 'POST',
			body: JSON.stringify({ prompt: 'Solve this' }),
		});
		const res = await handleReasoning(req, env);
		expect(res.status).toBe(500);
		const body = await res.json() as any;
		expect(body.error).toBeDefined();
	});
});

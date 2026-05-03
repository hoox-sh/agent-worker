import { describe, expect, test, mock } from 'bun:test';
import worker from '../../src/index';
import type { Env } from '../../src/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
	return {
		AI: {
			run: mock(async (model: string, input?: unknown) => {
				// Handle different AI request types
				const inputObj = input as Record<string, unknown>;
				if (inputObj?.images) {
					return { response: 'Vision analysis complete' };
				}
				if (inputObj?.reasoning_effort) {
					return { reasoning: 'Thinking...', response: 'Reasoning answer' };
				}
				return { response: 'AI response from ' + model };
			}),
		} as unknown as Env['AI'],
		CONFIG_KV: {
			get: mock(async () => null),
			put: mock(async () => {}),
		} as unknown as Env['CONFIG_KV'],
		D1_SERVICE: {} as unknown as Env['D1_SERVICE'],
		TRADE_SERVICE: {} as unknown as Env['TRADE_SERVICE'],
		TELEGRAM_SERVICE: {} as unknown as Env['TELEGRAM_SERVICE'],
		INTERNAL_API_KEY: 'test-key',
		...overrides,
	} as Env;
}

describe('Integration Tests', () => {
	test('Chat request → Workers AI → response', async () => {
		const env = makeEnv();
		const req = new Request('http://localhost/agent/chat', {
			method: 'POST',
			headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
			body: JSON.stringify({ prompt: 'Hello' }),
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);
		expect(res.status).toBe(200);
		const body = await res.json() as any;
		expect(body.response).toBeDefined();
		expect(body.response).toContain('AI response');
	});

	test('Streaming request → SSE chunks received', async () => {
		const env = makeEnv();
		const req = new Request('http://localhost/agent/chat?stream=true', {
			method: 'POST',
			headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
			body: JSON.stringify({ prompt: 'Hello' }),
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('text/event-stream');

		// Read the stream
		const reader = res.body?.getReader();
		expect(reader).toBeDefined();

		if (reader) {
			const decoder = new TextDecoder();
			let chunks = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks += decoder.decode(value);
			}
			expect(chunks).toContain('"content"');
			expect(chunks).toContain('"done":true');
		}
	});

	test('Vision request → image analysis response', async () => {
		const env = makeEnv();
		const req = new Request('http://localhost/agent/vision', {
			method: 'POST',
			headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				imageUrl: 'https://example.com/chart.png',
				prompt: 'What does this show?',
			}),
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);
		expect(res.status).toBe(200);
		const body = await res.json() as any;
		expect(body.response).toBe('Vision analysis complete');
	});

	test('Reasoning request → reasoning + answer', async () => {
		const env = makeEnv();
		const req = new Request('http://localhost/agent/reasoning', {
			method: 'POST',
			headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
			body: JSON.stringify({ prompt: 'Solve this problem' }),
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);
		expect(res.status).toBe(200);
		const body = await res.json() as any;
		expect(body.reasoning).toBeDefined();
		expect(body.answer).toBeDefined();
	});

	test('Usage endpoint returns data', async () => {
		const env = makeEnv();
		const req = new Request('http://localhost/agent/usage', {
			headers: { Authorization: 'Bearer test-key' },
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);
		expect(res.status).toBe(200);
		const body = await res.json() as any;
		expect(body.period).toBe('today');
		expect(body.providers).toBeDefined();
		expect(body.total).toBeDefined();
	});

	test('Prompts endpoint returns templates', async () => {
		const env = makeEnv();
		const req = new Request('http://localhost/agent/prompts', {
			headers: { Authorization: 'Bearer test-key' },
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);
		expect(res.status).toBe(200);
		const body = await res.json() as any;
		expect(Array.isArray(body)).toBe(true);
		expect(body.length).toBeGreaterThan(0);
	});

	test('All providers down → proper error response', async () => {
		const env = makeEnv({
			AI: {
				run: mock(async () => { throw new Error('AI unavailable'); }),
			} as unknown as Env['AI'],
		});
		const req = new Request('http://localhost/agent/chat', {
			method: 'POST',
			headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
			body: JSON.stringify({ prompt: 'Hello' }),
		});
		const res = await worker.fetch(req, env, {} as ExecutionContext);
		expect(res.status).toBe(500);
		const body = await res.json() as any;
		expect(body.error).toBeDefined();
	});
});

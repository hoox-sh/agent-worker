import { describe, expect, test, mock } from 'bun:test';
import { handleVision } from '../../src/handlers/vision';
import type { Env } from '../../src/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
	return {
		AI: {
			run: mock(async () => ({ response: 'I see a chart showing an uptrend' })),
		} as unknown as Env['AI'],
		CONFIG_KV: { get: mock(async () => null), put: mock(async () => {}) } as unknown as Env['CONFIG_KV'],
		D1_SERVICE: {} as unknown as Env['D1_SERVICE'],
		TRADE_SERVICE: {} as unknown as Env['TRADE_SERVICE'],
		TELEGRAM_SERVICE: {} as unknown as Env['TELEGRAM_SERVICE'],
		...overrides,
	} as Env;
}

describe('handleVision', () => {
	test('returns vision analysis for valid request with imageUrl', async () => {
		const env = makeEnv();
		const req = new Request('http://localhost/agent/vision', {
			method: 'POST',
			body: JSON.stringify({
				imageUrl: 'https://example.com/chart.png',
				prompt: 'What does this chart show?',
			}),
		});
		const res = await handleVision(req, env);
		expect(res.status).toBe(200);
		const body = await res.json() as any;
		expect(body.response).toBe('I see a chart showing an uptrend');
	});

	test('returns 400 for missing imageUrl and imageBase64', async () => {
		const env = makeEnv();
		const req = new Request('http://localhost/agent/vision', {
			method: 'POST',
			body: JSON.stringify({ prompt: 'What is this?' }),
		});
		const res = await handleVision(req, env);
		expect(res.status).toBe(400);
	});

	test('returns 400 for missing prompt', async () => {
		const env = makeEnv();
		const req = new Request('http://localhost/agent/vision', {
			method: 'POST',
			body: JSON.stringify({ imageUrl: 'https://example.com/chart.png' }),
		});
		const res = await handleVision(req, env);
		expect(res.status).toBe(400);
	});

	test('accepts base64 image data', async () => {
		const env = makeEnv();
		const req = new Request('http://localhost/agent/vision', {
			method: 'POST',
			body: JSON.stringify({
				imageBase64: 'data:image/png;base64,iVBORw0KGgo=',
				prompt: 'Describe this image',
			}),
		});
		const res = await handleVision(req, env);
		expect(res.status).toBe(200);
	});

	test('uses custom model when specified', async () => {
		let capturedModel: string | undefined;
		const env = makeEnv({
			AI: {
				run: mock(async (model: string) => {
					capturedModel = model;
					return { response: 'ok' };
				}),
			} as unknown as Env['AI'],
		});
		const req = new Request('http://localhost/agent/vision', {
			method: 'POST',
			body: JSON.stringify({
				imageUrl: 'https://example.com/chart.png',
				prompt: 'Describe',
				model: '@cf/meta/llama-3.2-11b-vision-instruct',
			}),
		});
		await handleVision(req, env);
		expect(capturedModel).toBe('@cf/meta/llama-3.2-11b-vision-instruct');
	});
});

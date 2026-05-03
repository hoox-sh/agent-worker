import { describe, expect, test, mock } from 'bun:test';
import { handleUsage } from '../../src/handlers/usage';
import type { Env } from '../../src/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
	return {
		AI: {} as Env['AI'],
		CONFIG_KV: { get: mock(async () => null), put: mock(async () => {}) } as Env['CONFIG_KV'],
		D1_SERVICE: {} as Env['D1_SERVICE'],
		TRADE_SERVICE: {} as Env['TRADE_SERVICE'],
		TELEGRAM_SERVICE: {} as Env['TELEGRAM_SERVICE'],
		...overrides,
	} as Env;
}

describe('handleUsage', () => {
	test('returns usage data for today by default', async () => {
		const env = makeEnv();
		const req = new Request('http://localhost/agent/usage');
		const res = await handleUsage(req, env);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.period).toBe('today');
		expect(body.providers).toBeDefined();
		expect(body.total).toBeDefined();
	});

	test('accepts period parameter', async () => {
		const env = makeEnv();
		const req = new Request('http://localhost/agent/usage?period=week');
		const res = await handleUsage(req, env);
		const body = await res.json();
		expect(body.period).toBe('week');
	});

	test('returns 400 for invalid period', async () => {
		const env = makeEnv();
		const req = new Request('http://localhost/agent/usage?period=invalid');
		const res = await handleUsage(req, env);
		expect(res.status).toBe(400);
	});

	test('includes provider statistics', async () => {
		const env = makeEnv();
		const req = new Request('http://localhost/agent/usage');
		const res = await handleUsage(req, env);
		const body = await res.json();
		expect(body.providers).toBeDefined();
		// Providers may be empty initially
		expect(body.providers).toBeInstanceOf(Object);
	});

	test('calculates totals correctly', async () => {
		const env = makeEnv();
		const req = new Request('http://localhost/agent/usage');
		const res = await handleUsage(req, env);
		const body = await res.json();
		expect(body.total).toBeDefined();
		expect(body.total.requests).toBeGreaterThanOrEqual(0);
	});
});

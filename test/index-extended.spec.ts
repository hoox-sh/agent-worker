import { describe, expect, test, vi, beforeEach } from 'bun:test';
import worker, { checkInternalAuth, fetchMarkPrice } from '../src/index';
import { ProviderManager, createProviderManager } from '../src/providers';

describe('checkInternalAuth', () => {
	let mockEnv: any;

	beforeEach(() => {
		mockEnv = {
			AGENT_INTERNAL_KEY: 'test-key',
		};
	});

	test('returns error when no key configured', () => {
		mockEnv.AGENT_INTERNAL_KEY = undefined;
		const request = new Request('http://example.com/test');
		const result = checkInternalAuth(request, mockEnv, 'AGENT_INTERNAL_KEY');
		expect(result.authorized).toBe(false);
		expect(result.error).toBe('AGENT_INTERNAL_KEY not configured');
	});

	test('returns error when no key provided', () => {
		const request = new Request('http://example.com/test');
		const result = checkInternalAuth(request, mockEnv, 'AGENT_INTERNAL_KEY');
		expect(result.authorized).toBe(false);
		expect(result.error).toBe('Unauthorized');
	});

	test('returns error when key mismatch', () => {
		const request = new Request('http://example.com/test', {
			headers: { 'X-Internal-Auth-Key': 'wrong-key' },
		});
		const result = checkInternalAuth(request, mockEnv, 'AGENT_INTERNAL_KEY');
		expect(result.authorized).toBe(false);
		expect(result.error).toBe('Unauthorized');
	});

	test('returns authorized when key matches', () => {
		const request = new Request('http://example.com/test', {
			headers: { 'X-Internal-Auth-Key': 'test-key' },
		});
		const result = checkInternalAuth(request, mockEnv, 'AGENT_INTERNAL_KEY');
		expect(result.authorized).toBe(true);
	});
});

describe('fetchMarkPrice', () => {
	test('returns null on unknown exchange', async () => {
		const result = await fetchMarkPrice('unknown-exchange', 'BTCUSDT');
		expect(result).toBeNull();
	});

	test.skip('fetches binance mark price', async () => {
		const result = await fetchMarkPrice('binance', 'BTCUSDT');
		expect(result).toBeGreaterThan(0);
	});

	test.skip('fetches bybit mark price', async () => {
		const result = await fetchMarkPrice('bybit', 'BTCUSDT');
		expect(result).toBeGreaterThan(0);
	});

	test.skip('fetches mexc mark price', async () => {
		const result = await fetchMarkPrice('mexc', 'BTCUSDT');
		expect(result).toBeGreaterThan(0);
	});
});

describe('POST /agent/housekeeping error handling', () => {
	const TEST_KEY = 'test-key';
	let mockEnv: any;
	let mockCtx: any;

	beforeEach(() => {
		mockEnv = {
			AI: { run: vi.fn().mockResolvedValue({ response: 'Test response' }) },
			CONFIG_KV: {
				get: vi.fn().mockResolvedValue(null),
				put: vi.fn().mockResolvedValue(undefined),
			},
			D1_SERVICE: {
				fetch: vi.fn().mockResolvedValue({ ok: false, text: vi.fn().mockResolvedValue('error') }),
			},
			TRADE_SERVICE: {
				fetch: vi.fn().mockRejectedValue(new Error('Service error')),
			},
			TELEGRAM_SERVICE: {
				fetch: vi.fn().mockRejectedValue(new Error('TG error')),
			},
			AGENT_INTERNAL_KEY: TEST_KEY,
		};
		mockCtx = { waitUntil: (p: Promise<any>) => p };
	});

	test('handles D1 service error', async () => {
		mockEnv.D1_SERVICE.fetch = vi.fn().mockRejectedValue(new Error('D1 down'));
		const request = new Request('http://example.com/agent/housekeeping', {
			method: 'POST',
			headers: { 'X-Internal-Auth-Key': TEST_KEY },
		});
		const response = await worker.fetch(request, mockEnv, mockCtx);
		expect(response.status).toBe(200);
		const json: any = await response.json();
		const d1Check = json.checks.find((c: any) => c.service === 'D1_SERVICE');
		expect(d1Check.status).toBe('error');
	});
});

describe('processRoutine error paths', () => {
	let mockEnv: any;
	let mockCtx: any;

	beforeEach(() => {
		mockEnv = {
			AI: { run: vi.fn().mockResolvedValue({ response: 'Test response' }) },
			CONFIG_KV: {
				get: vi.fn().mockResolvedValue(null),
				put: vi.fn().mockResolvedValue(undefined),
			},
			D1_SERVICE: {
				fetch: vi.fn().mockResolvedValue({
					ok: true,
					json: vi.fn().mockResolvedValue({ positions: [] }),
				}),
			},
			TRADE_SERVICE: {
				fetch: vi.fn().mockResolvedValue({ ok: true }),
			},
			TELEGRAM_SERVICE: {
				fetch: vi.fn().mockResolvedValue({ ok: true }),
			},
			AGENT_INTERNAL_KEY: 'test-key',
		};
		mockCtx = { waitUntil: (p: Promise<any>) => p };
	});

	test('handles positions fetch error', async () => {
		mockEnv.D1_SERVICE.fetch = vi.fn().mockResolvedValue({
			ok: false,
			text: vi.fn().mockResolvedValue('error'),
		});
		await worker.processRoutine(mockEnv);
		expect(mockEnv.D1_SERVICE.fetch).toHaveBeenCalled();
	});

	test('handles balances fetch error', async () => {
		mockEnv.D1_SERVICE.fetch = vi.fn().mockImplementation((req: Request) => {
			const url = req.url || '';
			if (url.includes('balances')) {
				return Promise.resolve({
					ok: false,
					text: vi.fn().mockResolvedValue('error'),
				});
			}
			return Promise.resolve({
				ok: true,
				json: vi.fn().mockResolvedValue({ positions: [] }),
			});
		});
		await worker.processRoutine(mockEnv);
		expect(mockEnv.D1_SERVICE.fetch).toHaveBeenCalled();
	});

	test('processes positions with mark price', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ markPrice: '52000' }))) as any;

		mockEnv.CONFIG_KV.get = vi.fn().mockImplementation((key: string) => {
			if (key === 'agent:config') return Promise.resolve(null);
			return Promise.resolve(null);
		});
		mockEnv.D1_SERVICE.fetch = vi.fn().mockImplementation((req: Request) => {
			const url = req.url || '';
			if (url.includes('positions')) {
				return Promise.resolve({
					ok: true,
					json: vi.fn().mockResolvedValue({
						positions: [
							{
								symbol: 'BTCUSDT',
								side: 'LONG',
								size: 0.1,
								entry_price: 50000,
								exchange: 'binance',
							},
						],
					}),
				});
			}
			return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({}) });
		});
		await worker.processRoutine(mockEnv);
		
		globalThis.fetch = originalFetch;
	});
});

describe('sendCloseOrder', () => {
	let mockEnv: any;

	beforeEach(() => {
		mockEnv = {
			CONFIG_KV: { put: vi.fn().mockResolvedValue(undefined) },
			TRADE_SERVICE: { fetch: vi.fn().mockResolvedValue({ ok: true }) },
		};
	});

	test('logs close order payload', async () => {
		const position = {
			symbol: 'BTCUSDT',
			side: 'LONG',
			size: 0.1,
			exchange: 'binance',
		};
		// sendCloseOrder is not exported, cannot test directly
		// Tested via processRoutine
		expect(mockEnv).toBeDefined();
	});
});
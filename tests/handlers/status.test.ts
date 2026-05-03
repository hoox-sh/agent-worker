import { describe, expect, test, mock } from 'bun:test';
import { handleStatus } from '../../src/handlers/status';
import type { Env } from '../../src/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    AI: {} as Env['AI'],
    CONFIG_KV: {
      get: mock(async () => JSON.stringify({
        defaultProvider: 'openai',
        fallbackChain: ['openai', 'anthropic'],
        modelMap: {
          'workers-ai': '@cf/meta/llama-3.1-8b-instruct',
          openai: 'gpt-4o-mini',
          anthropic: 'claude-3-haiku',
          google: 'gemini-1.5-flash',
          azure: 'gpt-4o-mini',
        },
        timeoutMs: 30000,
        retryCount: 3,
        maxDailyDrawdownPercent: -5,
        trailingStopPercent: 0.05,
        takeProfitPercent: 0.1,
      })),
      put: mock(async () => {}),
    } as Env['CONFIG_KV'],
    D1_SERVICE: {} as Env['D1_SERVICE'],
    TRADE_SERVICE: {} as Env['TRADE_SERVICE'],
    TELEGRAM_SERVICE: {} as Env['TELEGRAM_SERVICE'],
    ...overrides,
  } as Env;
}

describe('handleStatus', () => {
  test('returns comprehensive status overview', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/status');
    const res = await handleStatus(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service).toBe('agent-worker');
    expect(body.config).toBeDefined();
    expect(body.providers).toBeDefined();
    expect(body.timestamp).toBeDefined();
  });

  test('includes active provider info', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/status');
    const res = await handleStatus(req, env);
    const body = await res.json();
    expect(body.config.defaultProvider).toBe('openai');
  });

  test('includes fallback chain', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/status');
    const res = await handleStatus(req, env);
    const body = await res.json();
    expect(Array.isArray(body.config.fallbackChain)).toBe(true);
    expect(body.config.fallbackChain.length).toBeGreaterThan(0);
  });

  test('returns 500 when config unavailable', async () => {
    const env = makeEnv({
      CONFIG_KV: {
        get: mock(async () => { throw new Error('KV unavailable'); }),
        put: mock(async () => {}),
      } as Env['CONFIG_KV'],
    });
    const req = new Request('http://localhost/agent/status');
    const res = await handleStatus(req, env);
    expect(res.status).toBe(500);
  });
});
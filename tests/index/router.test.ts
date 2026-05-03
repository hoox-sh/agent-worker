import { describe, expect, test, mock } from 'bun:test';
import worker from '../../src/index';
import type { Env } from '../../src/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    AI: { run: mock(async () => ({ response: 'ok' })) } as Env['AI'],
    CONFIG_KV: {
      get: mock(async () => null),
      put: mock(async () => {}),
    } as Env['CONFIG_KV'],
    D1_SERVICE: {} as Env['D1_SERVICE'],
    TRADE_SERVICE: {} as Env['TRADE_SERVICE'],
    TELEGRAM_SERVICE: {} as Env['TELEGRAM_SERVICE'],
    INTERNAL_API_KEY: 'test-key',
    ...overrides,
  } as Env;
}

describe('Router', () => {
  test('routes GET /agent/health to health handler', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/health', {
      headers: { Authorization: 'Bearer test-key' },
    });
    const res = await worker.fetch(req, env, {} as ExecutionContext);
    expect(res.status).toBe(200);
  });

  test('routes POST /agent/chat to chat handler', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/chat', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Hello' }),
    });
    const res = await worker.fetch(req, env, {} as ExecutionContext);
    expect(res.status).toBe(200);
  });

  test('routes GET /agent/models to models handler', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/models', {
      headers: { Authorization: 'Bearer test-key' },
    });
    const res = await worker.fetch(req, env, {} as ExecutionContext);
    expect(res.status).toBe(200);
  });

  test('returns 404 for unknown routes', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/unknown', {
      headers: { Authorization: 'Bearer test-key' },
    });
    const res = await worker.fetch(req, env, {} as ExecutionContext);
    expect(res.status).toBe(404);
  });

  test('returns 401 without auth header', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/health');
    const res = await worker.fetch(req, env, {} as ExecutionContext);
    expect(res.status).toBe(401);
  });

  test('handles scheduled cron trigger', async () => {
    const env = makeEnv();
    // Mock fetch to prevent real HTTP requests
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response(JSON.stringify([])));
    
    // scheduled returns void, so just verify it doesn't throw
    await worker.scheduled?.({ cron: '*/5 * * * *' } as ScheduledController, env, {} as ExecutionContext);
    
    globalThis.fetch = originalFetch;
  });
});

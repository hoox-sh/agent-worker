import { describe, expect, test, mock } from 'bun:test';
import { handleTestModel } from '../../src/handlers/test-model';
import type { Env } from '../../src/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    AI: {
      run: mock(async () => ({ response: 'Test response' })),
    } as unknown as Env['AI'],
    CONFIG_KV: { get: mock(async () => null), put: mock(async () => {}) } as unknown as Env['CONFIG_KV'],
    D1_SERVICE: {} as unknown as Env['D1_SERVICE'],
    TRADE_SERVICE: {} as unknown as Env['TRADE_SERVICE'],
    TELEGRAM_SERVICE: {} as unknown as Env['TELEGRAM_SERVICE'],
    ...overrides,
  } as Env;
}

describe('handleTestModel', () => {
  test('tests Workers AI model successfully', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/test-model', {
      method: 'POST',
      body: JSON.stringify({ provider: 'workers-ai', model: '@cf/meta/llama-3.1-8b-instruct', prompt: 'Hello' }),
    });
    const res = await handleTestModel(req, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.response).toBe('Test response');
  });

  test('returns 400 for missing prompt', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/test-model', {
      method: 'POST',
      body: JSON.stringify({ provider: 'workers-ai' }),
    });
    const res = await handleTestModel(req, env);
    expect(res.status).toBe(400);
  });

  test('returns 500 when model fails', async () => {
    const env = makeEnv({
      AI: { run: mock(async () => { throw new Error('Model error'); }) } as unknown as Env['AI'],
    });
    const req = new Request('http://localhost/agent/test-model', {
      method: 'POST',
      body: JSON.stringify({ provider: 'workers-ai', prompt: 'Hello' }),
    });
    const res = await handleTestModel(req, env);
    expect(res.status).toBe(500);
  });

  test('measures latency', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/test-model', {
      method: 'POST',
      body: JSON.stringify({ provider: 'workers-ai', prompt: 'Hello' }),
    });
    const res = await handleTestModel(req, env);
    const body = await res.json() as any;
    expect(typeof body.latencyMs).toBe('number');
  });
});

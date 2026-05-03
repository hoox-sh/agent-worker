import { describe, expect, test } from 'bun:test';
import { requireAuth } from '../../src/middleware/auth';
import type { Env } from '../../src/types';

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/agent/health', { headers });
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    AI: {} as Env['AI'],
    CONFIG_KV: {} as Env['CONFIG_KV'],
    D1_SERVICE: {} as Env['D1_SERVICE'],
    TRADE_SERVICE: {} as Env['TRADE_SERVICE'],
    TELEGRAM_SERVICE: {} as Env['TELEGRAM_SERVICE'],
    ...overrides,
  } as Env;
}

describe('requireAuth', () => {
  test('returns 401 when no Authorization header', async () => {
    const req = makeRequest();
    const env = makeEnv();
    const result = await requireAuth(req, env);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(401);
  });

  test('returns 401 when header does not match INTERNAL_API_KEY', async () => {
    const req = makeRequest({ Authorization: 'Bearer wrong-key' });
    const env = makeEnv({ INTERNAL_API_KEY: 'correct-key' });
    const result = await requireAuth(req, env);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(401);
  });

  test('returns null when header matches INTERNAL_API_KEY', async () => {
    const req = makeRequest({ Authorization: 'Bearer correct-key' });
    const env = makeEnv({ INTERNAL_API_KEY: 'correct-key' });
    const result = await requireAuth(req, env);
    expect(result).toBeNull();
  });

  test('returns 401 when INTERNAL_API_KEY not set', async () => {
    const req = makeRequest({ Authorization: 'Bearer any-key' });
    const env = makeEnv();
    const result = await requireAuth(req, env);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(401);
  });
});

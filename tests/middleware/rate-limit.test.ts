import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { createRateLimiter } from '../../src/middleware/rate-limit';

function makeMockKV(): Env['CONFIG_KV'] {
  const store = new Map<string, string>();
  return {
    get: mock(async (key: string) => store.get(key) ?? null),
    put: mock(async (key: string, value: string) => { store.set(key, value); }),
    delete: mock(async (key: string) => { store.delete(key); }),
  } as unknown as unknown as Env['CONFIG_KV'];
}

describe('createRateLimiter', () => {
  let kv: Env['CONFIG_KV'];

  beforeEach(() => {
    kv = makeMockKV();
  });

  test('allows request under limit', async () => {
    const limiter = createRateLimiter(kv, { maxRequests: 5, windowSeconds: 60 });
    const req = new Request('http://localhost', {
      headers: { 'X-Forwarded-For': '1.2.3.4' },
    });
    const result = await limiter.check(req);
    expect(result.allowed).toBe(true);
  });

  test('blocks request over limit', async () => {
    const limiter = createRateLimiter(kv, { maxRequests: 2, windowSeconds: 60 });
    const req = (ip: string) =>
      new Request('http://localhost', { headers: { 'X-Forwarded-For': ip } });

    expect((await limiter.check(req('1.1.1.1'))).allowed).toBe(true);
    expect((await limiter.check(req('1.1.1.1'))).allowed).toBe(true);
    const third = await limiter.check(req('1.1.1.1'));
    expect(third.allowed).toBe(false);
    expect(third.retryAfter).toBeDefined();
  });

  test('returns 429 response when blocked', async () => {
    const limiter = createRateLimiter(kv, { maxRequests: 1, windowSeconds: 60 });
    const req = new Request('http://localhost', {
      headers: { 'X-Forwarded-For': '2.2.2.2' },
    });

    await limiter.check(req);
    const response = await limiter.enforce(req);
    expect(response).not.toBeNull();

    const response2 = await limiter.enforce(req);
    expect(response2?.status).toBe(429);
    expect(response2?.headers.get('Retry-After')).toBeDefined();
  });

  test('uses CF-Connecting-IP as fallback', async () => {
    const limiter = createRateLimiter(kv, { maxRequests: 1, windowSeconds: 60 });
    const req = new Request('http://localhost', {
      headers: { 'CF-Connecting-IP': '3.3.3.3' },
    });

    expect((await limiter.check(req)).allowed).toBe(true);
    expect((await limiter.check(req)).allowed).toBe(false);
  });
});

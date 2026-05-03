import { describe, expect, test, mock } from 'bun:test';
import { handleEmbedding } from '../../src/handlers/embedding';
import type { Env } from '../../src/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    AI: {
      run: mock(async () => ({ shape: [1, 768], data: [0.1, 0.2, 0.3] })),
    } as Env['AI'],
    CONFIG_KV: { get: mock(async () => null), put: mock(async () => {}) } as Env['CONFIG_KV'],
    D1_SERVICE: {} as Env['D1_SERVICE'],
    TRADE_SERVICE: {} as Env['TRADE_SERVICE'],
    TELEGRAM_SERVICE: {} as Env['TELEGRAM_SERVICE'],
    ...overrides,
  } as Env;
}

describe('handleEmbedding', () => {
  test('returns embedding for valid text', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/embedding', {
      method: 'POST',
      body: JSON.stringify({ text: 'Hello world' }),
    });
    const res = await handleEmbedding(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.embedding).toBeDefined();
    expect(body.model).toBeDefined();
  });

  test('returns 400 for missing text', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/embedding', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await handleEmbedding(req, env);
    expect(res.status).toBe(400);
  });

  test('uses default embedding model', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/embedding', {
      method: 'POST',
      body: JSON.stringify({ text: 'test' }),
    });
    const res = await handleEmbedding(req, env);
    const body = await res.json();
    expect(body.model).toBe('@cf/baai/bge-base-en-v1.5');
  });

  test('accepts custom model', async () => {
    let capturedModel: string | undefined;
    const env = makeEnv({
      AI: {
        run: mock(async (model: string) => {
          capturedModel = model;
          return { shape: [1, 768], data: [] };
        }),
      } as Env['AI'],
    });
    const req = new Request('http://localhost/agent/embedding', {
      method: 'POST',
      body: JSON.stringify({ text: 'test', model: '@cf/baai/bge-large-en-v1.5' }),
    });
    await handleEmbedding(req, env);
    expect(capturedModel).toBe('@cf/baai/bge-large-en-v1.5');
  });
});

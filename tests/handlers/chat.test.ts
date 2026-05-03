import { describe, expect, test, mock } from 'bun:test';
import { handleChat } from '../../src/handlers/chat';
import type { Env } from '../../src/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    AI: {
      run: mock(async () => ({ response: 'Hello from Workers AI' })),
    } as unknown as Env['AI'],
    CONFIG_KV: {
      get: mock(async () => null),
      put: mock(async () => {}),
    } as unknown as Env['CONFIG_KV'],
    D1_SERVICE: {} as unknown as Env['D1_SERVICE'],
    TRADE_SERVICE: {} as unknown as Env['TRADE_SERVICE'],
    TELEGRAM_SERVICE: {} as unknown as Env['TELEGRAM_SERVICE'],
    ...overrides,
  } as Env;
}

describe('handleChat', () => {
  test('returns chat response for valid request', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/chat', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Hello' }),
    });
    const res = await handleChat(req, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.response).toBe('Hello from Workers AI');
  });

  test('returns 400 for missing prompt/messages', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/chat', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await handleChat(req, env);
    expect(res.status).toBe(400);
  });

  test('accepts messages array format', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hi' },
        ],
      }),
    });
    const res = await handleChat(req, env);
    expect(res.status).toBe(200);
  });

  test('returns 500 when AI binding fails', async () => {
    const env = makeEnv({
      AI: {
        run: mock(async () => { throw new Error('AI service unavailable'); }),
      } as unknown as Env['AI'],
    });
    const req = new Request('http://localhost/agent/chat', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Hello' }),
    });
    const res = await handleChat(req, env);
    expect(res.status).toBe(500);
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
    const req = new Request('http://localhost/agent/chat', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Hello', model: '@cf/meta/llama-3.1-70b-instruct' }),
    });
    await handleChat(req, env);
    expect(capturedModel).toBe('@cf/meta/llama-3.1-70b-instruct');
  });

  test('returns SSE response when stream=true', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/chat?stream=true', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Hello' }),
    });
    const res = await handleChat(req, env);
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

  test('returns JSON response when no stream param', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/chat', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Hello' }),
    });
    const res = await handleChat(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = await res.json() as any;
    expect(body.response).toBe('Hello from Workers AI');
  });
});

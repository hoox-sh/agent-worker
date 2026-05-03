import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { handleGetConfig, handleUpdateConfig } from '../../src/handlers/config';
import type { Env, AgentConfig } from '../../src/types';

function makeMockKV(initialData?: Record<string, string>): Env['CONFIG_KV'] {
  const store = new Map<string, string>(Object.entries(initialData ?? {}));
  return {
    get: mock(async (key: string) => store.get(key) ?? null),
    put: mock(async (key: string, value: string) => { store.set(key, value); }),
  } as unknown as Env['CONFIG_KV'];
}

function makeEnv(kv: Env['CONFIG_KV']): Env {
  return {
    AI: {} as Env['AI'],
    CONFIG_KV: kv,
    D1_SERVICE: {} as Env['D1_SERVICE'],
    TRADE_SERVICE: {} as Env['TRADE_SERVICE'],
    TELEGRAM_SERVICE: {} as Env['TELEGRAM_SERVICE'],
  } as Env;
}

describe('handleGetConfig', () => {
  test('returns default config when no stored config', async () => {
    const kv = makeMockKV();
    const env = makeEnv(kv);
    const req = new Request('http://localhost/agent/config');
    const res = await handleGetConfig(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.defaultProvider).toBe('workers-ai');
  });

  test('returns stored config when available', async () => {
    const storedConfig: AgentConfig = {
      defaultProvider: 'openai',
      fallbackChain: ['openai', 'anthropic'],
      modelMap: {
        'workers-ai': '@cf/meta/llama-3.1-8b-instruct',
        openai: 'gpt-4',
        anthropic: 'claude-3-opus',
        google: 'gemini-1.5-pro',
        azure: 'gpt-4o',
      },
      timeoutMs: 60000,
      retryCount: 5,
      maxDailyDrawdownPercent: -3,
      trailingStopPercent: 0.03,
      takeProfitPercent: 0.08,
    };
    const kv = makeMockKV({ 'agent:config': JSON.stringify(storedConfig) });
    const env = makeEnv(kv);
    const req = new Request('http://localhost/agent/config');
    const res = await handleGetConfig(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.defaultProvider).toBe('openai');
    expect(body.retryCount).toBe(5);
  });
});

describe('handleUpdateConfig', () => {
  test('updates config with valid body', async () => {
    const kv = makeMockKV();
    const env = makeEnv(kv);
    const req = new Request('http://localhost/agent/config', {
      method: 'POST',
      body: JSON.stringify({ defaultProvider: 'anthropic', retryCount: 2 }),
    });
    const res = await handleUpdateConfig(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.defaultProvider).toBe('anthropic');
    expect(body.retryCount).toBe(2);
  });

  test('returns 400 for invalid provider', async () => {
    const kv = makeMockKV();
    const env = makeEnv(kv);
    const req = new Request('http://localhost/agent/config', {
      method: 'POST',
      body: JSON.stringify({ defaultProvider: 'invalid-provider' }),
    });
    const res = await handleUpdateConfig(req, env);
    expect(res.status).toBe(400);
  });
});

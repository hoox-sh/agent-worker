import { describe, expect, test, mock } from 'bun:test';
import { handleRiskOverride } from '../../src/handlers/risk-override';
import type { Env } from '../../src/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    AI: {} as Env['AI'],
    CONFIG_KV: {
      get: mock(async () => JSON.stringify({ trailingStopPercent: 0.05 })),
      put: mock(async () => {}),
    } as Env['CONFIG_KV'],
    D1_SERVICE: {} as Env['D1_SERVICE'],
    TRADE_SERVICE: {} as Env['TRADE_SERVICE'],
    TELEGRAM_SERVICE: {} as Env['TELEGRAM_SERVICE'],
    ...overrides,
  } as Env;
}

describe('handleRiskOverride', () => {
  test('updates trailing stop percent', async () => {
    const kv = {
      get: mock(async () => JSON.stringify({ trailingStopPercent: 0.05 })),
      put: mock(async () => {}),
    } as Env['CONFIG_KV'];
    const env = makeEnv({ CONFIG_KV: kv });
    const req = new Request('http://localhost/agent/risk-override', {
      method: 'POST',
      body: JSON.stringify({ trailingStopPercent: 0.08 }),
    });
    const res = await handleRiskOverride(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trailingStopPercent).toBe(0.08);
  });

  test('returns 400 for invalid trailing stop value', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/risk-override', {
      method: 'POST',
      body: JSON.stringify({ trailingStopPercent: -0.01 }),
    });
    const res = await handleRiskOverride(req, env);
    expect(res.status).toBe(400);
  });

  test('returns 400 for missing body', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/agent/risk-override', { method: 'POST' });
    const res = await handleRiskOverride(req, env);
    expect(res.status).toBe(400);
  });
});

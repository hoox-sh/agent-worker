import { describe, expect, test, mock } from 'bun:test';
import { handleHousekeeping } from '../../src/handlers/housekeeping';

describe('handleHousekeeping', () => {
  test('runs housekeeping and returns results', async () => {
    // Mock the global fetch to prevent real HTTP requests
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      mock(async () => new Response(JSON.stringify([]))),
      { preconnect: mock(() => {}) }
    ) as typeof fetch;

    const req = new Request('http://localhost/agent/housekeeping', { method: 'POST' });
    const res = await handleHousekeeping(req, {} as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.timestamp).toBeDefined();

    globalThis.fetch = originalFetch;
  });
});

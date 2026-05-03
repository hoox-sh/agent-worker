import { describe, expect, test } from 'bun:test';
import { handleHealth } from '../../src/handlers/health';

describe('handleHealth', () => {
  test('returns 200 with status ok', async () => {
    const req = new Request('http://localhost/agent/health');
    const res = await handleHealth(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('ok');
    expect(body.service).toBe('agent-worker');
    expect(body.timestamp).toBeDefined();
  });

  test('includes uptime in response', async () => {
    const req = new Request('http://localhost/agent/health');
    const res = await handleHealth(req);
    const body = await res.json() as any;
    expect(typeof body.uptime).toBe('number');
  });
});

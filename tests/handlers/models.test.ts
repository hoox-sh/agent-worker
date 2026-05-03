import { describe, expect, test } from 'bun:test';
import { handleModels } from '../../src/handlers/models';

describe('handleModels', () => {
  test('returns list of available models', async () => {
    const req = new Request('http://localhost/agent/models');
    const res = await handleModels(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models.length).toBeGreaterThan(0);
  });

  test('each model has required fields', async () => {
    const req = new Request('http://localhost/agent/models');
    const res = await handleModels(req);
    const body = await res.json();

    for (const model of body.models) {
      expect(model.id).toBeDefined();
      expect(model.provider).toBeDefined();
      expect(model.taskType).toBeDefined();
    }
  });

  test('filters by provider query param', async () => {
    const req = new Request('http://localhost/agent/models?provider=openai');
    const res = await handleModels(req);
    const body = await res.json();

    for (const model of body.models) {
      expect(model.provider).toBe('openai');
    }
  });

  test('filters by taskType query param', async () => {
    const req = new Request('http://localhost/agent/models?taskType=chat');
    const res = await handleModels(req);
    const body = await res.json();

    for (const model of body.models) {
      expect(model.taskType).toBe('chat');
    }
  });

  test('returns empty array for unknown provider', async () => {
    const req = new Request('http://localhost/agent/models?provider=unknown');
    const res = await handleModels(req);
    const body = await res.json();
    expect(body.models).toEqual([]);
  });
});

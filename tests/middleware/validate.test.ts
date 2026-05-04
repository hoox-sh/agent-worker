import { describe, expect, test } from 'bun:test';
import { validateJson, requireField, optionalField } from '@hoox/shared/middleware/validate';

describe('validateJson', () => {
  test('returns parsed body for valid JSON', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ name: 'test' }),
    });
    const result = await validateJson(req);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: 'test' });
  });

  test('returns error for invalid JSON', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      body: 'not json',
    });
    const result = await validateJson(req);
    expect(result.ok).toBe(false);
  });

  test('returns error for empty body', async () => {
    const req = new Request('http://localhost', { method: 'POST' });
    const result = await validateJson(req);
    expect(result.ok).toBe(false);
  });
});

describe('requireField', () => {
  test('returns value when field exists', () => {
    const body = { text: 'hello' };
    const result = requireField<string>(body, 'text');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('hello');
  });

  test('returns error when field missing', () => {
    const body = { other: 'value' };
    const result = requireField<string>(body, 'text');
    expect(result.ok).toBe(false);
  });
});

describe('optionalField', () => {
  test('returns value when field exists', () => {
    const body = { text: 'hello' };
    const result = optionalField<string>(body, 'text', 'default');
    expect(result).toBe('hello');
  });

  test('returns default when field missing', () => {
    const body = { other: 'value' };
    const result = optionalField<string>(body, 'text', 'default');
    expect(result).toBe('default');
  });
});

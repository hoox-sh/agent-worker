import { describe, expect, test } from 'bun:test';
import type {
  Result,
  ChatRequestBody,
  TestModelRequestBody,
  EmbeddingRequestBody,
  RiskOverrideRequestBody,
  ConfigUpdateRequestBody,
  Position,
  AgentConfig,
} from '../src/types';
import { DEFAULT_AGENT_CONFIG } from '../src/types';

describe('types', () => {
  test('Result type works for success case', () => {
    const result: Result<string> = { ok: true, value: 'test' };
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('test');
    }
  });

  test('Result type works for error case', () => {
    const result: Result<string, string> = { ok: false, error: 'something went wrong' };
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('something went wrong');
    }
  });

  test('ChatRequestBody accepts messages array', () => {
    const body: ChatRequestBody = {
      messages: [{ role: 'user', content: 'Hello' }],
    };
    expect(body.messages).toBeDefined();
  });

  test('ChatRequestBody accepts prompt string', () => {
    const body: ChatRequestBody = {
      prompt: 'Hello',
    };
    expect(body.prompt).toBe('Hello');
  });

  test('TestModelRequestBody has correct fields', () => {
    const body: TestModelRequestBody = {
      provider: 'openai',
      model: 'gpt-4',
      prompt: 'test',
    };
    expect(body.provider).toBe('openai');
  });

  test('EmbeddingRequestBody has correct fields', () => {
    const body: EmbeddingRequestBody = {
      text: 'embed this',
      provider: 'workers-ai',
    };
    expect(body.text).toBe('embed this');
  });

  test('RiskOverrideRequestBody has trailingStopPercent', () => {
    const body: RiskOverrideRequestBody = {
      trailingStopPercent: 0.05,
    };
    expect(body.trailingStopPercent).toBe(0.05);
  });

  test('ConfigUpdateRequestBody accepts partial config', () => {
    const body: ConfigUpdateRequestBody = {
      defaultProvider: 'openai',
      timeoutMs: 60000,
    };
    expect(body.defaultProvider).toBe('openai');
  });

  test('Position interface has required fields', () => {
    const position: Position = {
      symbol: 'BTCUSDT',
      side: 'LONG',
      size: 1,
      entry_price: 50000,
      exchange: 'binance',
    };
    expect(position.symbol).toBe('BTCUSDT');
    expect(position.side).toBe('LONG');
  });

  test('DEFAULT_AGENT_CONFIG has required fields', () => {
    expect(DEFAULT_AGENT_CONFIG.defaultProvider).toBe('workers-ai');
    expect(DEFAULT_AGENT_CONFIG.fallbackChain).toBeDefined();
    expect(DEFAULT_AGENT_CONFIG.modelMap).toBeDefined();
  });
});

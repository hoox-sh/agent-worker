import { describe, expect, test, mock } from 'bun:test';
import { RiskExecutor } from '../../src/risk/executor';
import type { Position } from '../../src/types';

describe('RiskExecutor', () => {
  test('closePosition calls trade service', async () => {
    const mockTrade = mock(async () => new Response(JSON.stringify({ success: true })));
    const executor = new RiskExecutor(mockTrade as unknown as typeof fetch);
    const position: Position = { symbol: 'BTCUSDT', side: 'LONG', size: 1, entry_price: 50000, exchange: 'binance' };

    const result = await executor.closePosition(position);
    expect(result.ok).toBe(true);
  });

  test('closePosition returns error on failure', async () => {
    const mockTrade = mock(async () => new Response('error', { status: 500 }));
    const executor = new RiskExecutor(mockTrade as unknown as typeof fetch);
    const position: Position = { symbol: 'BTCUSDT', side: 'LONG', size: 1, entry_price: 50000, exchange: 'binance' };

    const result = await executor.closePosition(position);
    expect(result.ok).toBe(false);
  });

  test('notifyTelegram sends notification', async () => {
    const mockTelegram = mock(async () => new Response(JSON.stringify({ ok: true })));
    const executor = new RiskExecutor(undefined, mockTelegram as unknown as typeof fetch);

    const result = await executor.notifyTelegram('Stop loss triggered for BTCUSDT');
    expect(result.ok).toBe(true);
  });

  test('notifyTelegram returns error on failure', async () => {
    const mockTelegram = mock(async () => new Response('error', { status: 500 }));
    const executor = new RiskExecutor(undefined, mockTelegram as unknown as typeof fetch);

    const result = await executor.notifyTelegram('Test message');
    expect(result.ok).toBe(false);
  });
});
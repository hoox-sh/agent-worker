import { describe, expect, test } from 'bun:test';
import { RiskManager } from '../../src/risk/manager';
import type { Position, AgentConfig } from '../../src/types';

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    defaultProvider: 'workers-ai',
    fallbackChain: ['workers-ai'],
    modelMap: { 'workers-ai': 'test', openai: 'test', anthropic: 'test', google: 'test', azure: 'test' },
    timeoutMs: 30000,
    retryCount: 3,
    maxDailyDrawdownPercent: -5,
    trailingStopPercent: 0.05,
    takeProfitPercent: 0.1,
    ...overrides,
  };
}

describe('RiskManager', () => {
  test('checkKillSwitch returns true when enabled', () => {
    const manager = new RiskManager(makeConfig(), true);
    expect(manager.checkKillSwitch()).toBe(true);
  });

  test('checkKillSwitch returns false when disabled', () => {
    const manager = new RiskManager(makeConfig(), false);
    expect(manager.checkKillSwitch()).toBe(false);
  });

  test('checkDrawdown triggers when below threshold', () => {
    const manager = new RiskManager(makeConfig({ maxDailyDrawdownPercent: -5 }), false);
    manager.recordPnl(-6);
    expect(manager.checkDrawdown()).toBe(true);
  });

  test('checkDrawdown passes when above threshold', () => {
    const manager = new RiskManager(makeConfig({ maxDailyDrawdownPercent: -5 }), false);
    manager.recordPnl(-3);
    expect(manager.checkDrawdown()).toBe(false);
  });

  test('checkTrailingStop triggers on LONG position drop', () => {
    const manager = new RiskManager(makeConfig({ trailingStopPercent: 0.05 }), false);
    const position: Position = { symbol: 'BTCUSDT', side: 'LONG', size: 1, entry_price: 50000, exchange: 'binance' };
    manager.updateHighWatermark(position, 55000);
    expect(manager.checkTrailingStop(position, 51000)).toBe(true); // 55000 * 0.95 = 52250, 51000 < 52250
  });

  test('checkTrailingStop passes when above threshold', () => {
    const manager = new RiskManager(makeConfig({ trailingStopPercent: 0.05 }), false);
    const position: Position = { symbol: 'BTCUSDT', side: 'LONG', size: 1, entry_price: 50000, exchange: 'binance' };
    manager.updateHighWatermark(position, 55000);
    expect(manager.checkTrailingStop(position, 53000)).toBe(false); // 53000 > 52250
  });

  test('checkTakeProfit triggers on LONG position gain', () => {
    const manager = new RiskManager(makeConfig({ takeProfitPercent: 0.1 }), false);
    const position: Position = { symbol: 'BTCUSDT', side: 'LONG', size: 1, entry_price: 50000, exchange: 'binance' };
    expect(manager.checkTakeProfit(position, 56000)).toBe(true); // 50000 * 1.1 = 55000, 56000 > 55000
  });
});

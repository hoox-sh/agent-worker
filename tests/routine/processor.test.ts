import { describe, expect, test, mock } from 'bun:test';
import { processRoutine } from '../../src/routine/processor';
import type { Position } from '../../src/types';

describe('processRoutine', () => {
  test('closes position when kill switch active', async () => {
    const mockRiskManager = {
      checkKillSwitch: mock(() => true),
      checkDrawdown: mock(() => false),
      checkTrailingStop: mock(() => false),
      checkTakeProfit: mock(() => false),
      recordPnl: mock(),
      updateHighWatermark: mock(),
    };
    const mockExecutor = {
      closePosition: mock(async () => ({ ok: true, value: undefined })),
      notifyTelegram: mock(async () => ({ ok: true, value: undefined })),
    };
    const mockExchanges = [{
      name: 'binance',
      fetchPositions: mock(async () => [
        { symbol: 'BTCUSDT', side: 'LONG' as const, size: 1, entry_price: 50000, exchange: 'binance' },
      ]),
    }];
    const mockLogger = { info: mock(), warn: mock(), error: mock() };

    const result = await processRoutine(
      mockRiskManager as any,
      mockExecutor as any,
      mockExchanges as any,
      mockLogger as any,
    );

    expect(mockExecutor.closePosition).toHaveBeenCalled();
    expect(mockExecutor.notifyTelegram).toHaveBeenCalled();
    expect(result.positionsChecked).toBe(1);
    expect(result.positionsClosed).toBe(1);
  });

  test('closes position on trailing stop trigger', async () => {
    const mockRiskManager = {
      checkKillSwitch: mock(() => false),
      checkDrawdown: mock(() => false),
      checkTrailingStop: mock(() => true),
      checkTakeProfit: mock(() => false),
      recordPnl: mock(),
      updateHighWatermark: mock(),
    };
    const mockExecutor = {
      closePosition: mock(async () => ({ ok: true, value: undefined })),
      notifyTelegram: mock(async () => ({ ok: true, value: undefined })),
    };
    const mockExchanges = [{
      name: 'binance',
      fetchPositions: mock(async () => [
        { symbol: 'ETHUSDT', side: 'SHORT' as const, size: 2, entry_price: 3000, exchange: 'binance' },
      ]),
    }];
    const mockLogger = { info: mock(), warn: mock(), error: mock() };

    const result = await processRoutine(
      mockRiskManager as any,
      mockExecutor as any,
      mockExchanges as any,
      mockLogger as any,
    );

    expect(mockExecutor.closePosition).toHaveBeenCalled();
    expect(result.positionsClosed).toBe(1);
  });

  test('returns zero counts when no positions', async () => {
    const mockRiskManager = {
      checkKillSwitch: mock(() => false),
      checkDrawdown: mock(() => false),
      checkTrailingStop: mock(() => false),
      checkTakeProfit: mock(() => false),
      recordPnl: mock(),
      updateHighWatermark: mock(),
    };
    const mockExecutor = {
      closePosition: mock(async () => ({ ok: true, value: undefined })),
      notifyTelegram: mock(async () => ({ ok: true, value: undefined })),
    };
    const mockExchanges = [{
      name: 'binance',
      fetchPositions: mock(async () => []),
    }];
    const mockLogger = { info: mock(), warn: mock(), error: mock() };

    const result = await processRoutine(
      mockRiskManager as any,
      mockExecutor as any,
      mockExchanges as any,
      mockLogger as any,
    );

    expect(result.positionsChecked).toBe(0);
    expect(result.positionsClosed).toBe(0);
  });
});
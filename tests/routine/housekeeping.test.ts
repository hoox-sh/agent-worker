import { describe, expect, test, mock } from 'bun:test';
import { runHousekeeping } from '../../src/routine/housekeeping';

describe('runHousekeeping', () => {
  test('resets daily PnL at midnight UTC', async () => {
    const mockRiskManager = {
      resetDailyPnl: mock(),
      getDailyPnl: mock(() => 100),
    };
    const mockLogger = { info: mock(), warn: mock(), error: mock() };

    await runHousekeeping(mockRiskManager as any, mockLogger as any, '00:00');

    expect(mockRiskManager.resetDailyPnl).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith('Daily PnL reset executed');
  });

  test('skips reset when not midnight', async () => {
    const mockRiskManager = {
      resetDailyPnl: mock(),
      getDailyPnl: mock(() => 100),
    };
    const mockLogger = { info: mock(), warn: mock(), error: mock() };

    await runHousekeeping(mockRiskManager as any, mockLogger as any, '12:00');

    expect(mockRiskManager.resetDailyPnl).not.toHaveBeenCalled();
  });

  test('logs current PnL status', async () => {
    const mockRiskManager = {
      resetDailyPnl: mock(),
      getDailyPnl: mock(() => -3.5),
    };
    const mockLogger = { info: mock(), warn: mock(), error: mock() };

    await runHousekeeping(mockRiskManager as any, mockLogger as any, '12:00');

    expect(mockLogger.info).toHaveBeenCalledWith('Housekeeping: daily PnL status', { dailyPnl: -3.5 });
  });
});

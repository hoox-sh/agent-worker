import type { RiskManager } from '../risk/manager';
import type { Logger } from '../middleware/logger';

export async function runHousekeeping(
  riskManager: RiskManager,
  logger: Logger,
  currentTimeUTC: string,
): Promise<void> {
  const [hours] = currentTimeUTC.split(':').map(Number);

  // Reset daily PnL at midnight UTC
  if (hours === 0) {
    riskManager.resetDailyPnl();
    logger.info('Daily PnL reset executed');
  }

  logger.info('Housekeeping: daily PnL status', {
    dailyPnl: riskManager.getDailyPnl(),
  });
}

import type { Env } from '../types';
import type { RiskManager } from '../risk/manager';
import type { Logger } from '../middleware/logger';
import { DEFAULT_AGENT_CONFIG } from '../types';
import { createExchangeClients } from '../market/exchanges';
import { RiskExecutor } from '../risk/executor';
import { createLogger } from '../middleware/logger';
import { processRoutine } from './processor';

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

export async function handleHousekeeping(_request: Request, env: Env): Promise<Response> {
  const logger = createLogger({ service: 'agent-worker', module: 'housekeeping' });
  const config = DEFAULT_AGENT_CONFIG;
  const riskManager = new RiskManager(config, false);
  const executor = new RiskExecutor();
  const exchanges = createExchangeClients();

  const now = new Date();
  const currentTimeUTC = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;

  // Run housekeeping (PnL reset at midnight)
  await runHousekeeping(riskManager, logger, currentTimeUTC);

  // Run risk processing routine
  const routineResult = await processRoutine(riskManager, executor, exchanges, logger);

  return new Response(JSON.stringify({
    success: true,
    timestamp: now.toISOString(),
    housekeeping: { dailyPnl: riskManager.getDailyPnl() },
    routine: routineResult,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

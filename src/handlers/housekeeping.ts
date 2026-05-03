import type { Env } from '../types';
import { DEFAULT_AGENT_CONFIG } from '../types';
import { createLogger } from '../middleware/logger';
import { RiskManager } from '../risk/manager';
import { RiskExecutor } from '../risk/executor';
import { createExchangeClients } from '../market/exchanges';
import { runHousekeeping } from '../routine/housekeeping';
import { processRoutine } from '../routine/processor';

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

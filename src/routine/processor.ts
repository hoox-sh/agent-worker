import type { RiskManager } from '../risk/manager';
import type { RiskExecutor } from '../risk/executor';
import type { ExchangeClient } from '../market/exchanges';
import type { Logger } from '@hoox/shared/middleware';

export interface RoutineResult {
  positionsChecked: number;
  positionsClosed: number;
  errors: string[];
}

export async function processRoutine(
  riskManager: RiskManager,
  executor: RiskExecutor,
  exchanges: ExchangeClient[],
  logger: Logger,
): Promise<RoutineResult> {
  const result: RoutineResult = { positionsChecked: 0, positionsClosed: 0, errors: [] };

  // Kill switch: close all positions immediately
  if (riskManager.checkKillSwitch()) {
    logger.warn('Kill switch active — closing all positions');
    for (const exchange of exchanges) {
      try {
        const positions = await exchange.fetchPositions();
        for (const position of positions) {
          const closeResult = await executor.closePosition(position);
          if (closeResult.ok) {
            result.positionsClosed++;
            await executor.notifyTelegram(
              `[KILL SWITCH] Closed ${position.symbol} on ${exchange.name}`,
            );
          } else {
            result.errors.push(closeResult.error);
          }
        }
        result.positionsChecked += positions.length;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Failed to fetch from ${exchange.name}: ${msg}`);
        logger.error(`Exchange fetch failed: ${exchange.name}`, { error: msg });
      }
    }
    return result;
  }

  // Check drawdown
  if (riskManager.checkDrawdown()) {
    logger.warn('Daily drawdown limit reached — closing all positions');
    for (const exchange of exchanges) {
      try {
        const positions = await exchange.fetchPositions();
        for (const position of positions) {
          const closeResult = await executor.closePosition(position);
          if (closeResult.ok) {
            result.positionsClosed++;
            await executor.notifyTelegram(
              `[DRAWDOWN] Closed ${position.symbol} on ${exchange.name} (PnL: ${riskManager.getDailyPnl()}%)`,
            );
          } else {
            result.errors.push(closeResult.error);
          }
        }
        result.positionsChecked += positions.length;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Failed to fetch from ${exchange.name}: ${msg}`);
      }
    }
    return result;
  }

  // Normal processing: check each position for trailing stop / take profit
  for (const exchange of exchanges) {
    try {
      const positions = await exchange.fetchPositions();
      result.positionsChecked += positions.length;

      for (const position of positions) {
        // Fetch current price (simplified — in production use market data feed)
        const currentPrice = position.entry_price; // TODO: fetch live price

        riskManager.updateHighWatermark(position, currentPrice);

        if (riskManager.checkTrailingStop(position, currentPrice)) {
          logger.info('Trailing stop triggered', { symbol: position.symbol, exchange: exchange.name });
          const closeResult = await executor.closePosition(position);
          if (closeResult.ok) {
            result.positionsClosed++;
            await executor.notifyTelegram(
              `[TRAILING STOP] Closed ${position.symbol} on ${exchange.name}`,
            );
          } else {
            result.errors.push(closeResult.error);
          }
          continue;
        }

        if (riskManager.checkTakeProfit(position, currentPrice)) {
          logger.info('Take profit triggered', { symbol: position.symbol, exchange: exchange.name });
          const closeResult = await executor.closePosition(position);
          if (closeResult.ok) {
            result.positionsClosed++;
            await executor.notifyTelegram(
              `[TAKE PROFIT] Closed ${position.symbol} on ${exchange.name}`,
            );
          } else {
            result.errors.push(closeResult.error);
          }
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push(`Failed to fetch from ${exchange.name}: ${msg}`);
      logger.error(`Exchange fetch failed: ${exchange.name}`, { error: msg });
    }
  }

  return result;
}

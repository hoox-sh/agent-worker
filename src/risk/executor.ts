import type { Position, Result } from '../types';

export class RiskExecutor {
  constructor(
    private tradeService?: typeof fetch,
    private telegramService?: typeof fetch,
  ) {}

  async closePosition(position: Position): Promise<Result<void>> {
    try {
      const side = position.side === 'LONG' ? 'SELL' : 'BUY';
      const res = await (this.tradeService ?? fetch)(
        '/close-position',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: position.symbol,
            side,
            size: position.size,
            exchange: position.exchange,
          }),
        },
      );

      if (!res.ok) {
        return { ok: false, error: `Failed to close position: ${res.status}` };
      }

      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error closing position',
      };
    }
  }

  async notifyTelegram(message: string): Promise<Result<void>> {
    try {
      const res = await (this.telegramService ?? fetch)(
        '/notify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        },
      );

      if (!res.ok) {
        return { ok: false, error: `Telegram notification failed: ${res.status}` };
      }

      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error sending notification',
      };
    }
  }
}

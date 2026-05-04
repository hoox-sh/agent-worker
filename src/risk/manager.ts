import type { Position, AgentConfig, DEFAULT_AGENT_CONFIG } from '../types';

export class RiskManager {
  private highWatermarks = new Map<string, number>();
  private dailyPnl = 0;

  constructor(
    private config: AgentConfig,
    private killSwitchActive: boolean,
  ) {}

  checkKillSwitch(): boolean {
    return this.killSwitchActive;
  }

  recordPnl(pnl: number): void {
    this.dailyPnl += pnl;
  }

  checkDrawdown(): boolean {
    return this.dailyPnl <= this.config.maxDailyDrawdownPercent;
  }

  updateHighWatermark(position: Position, currentPrice: number): void {
    const key = position.symbol;
    const existing = this.highWatermarks.get(key);
    if (!existing || currentPrice > existing) {
      this.highWatermarks.set(key, currentPrice);
    }
  }

  checkTrailingStop(position: Position, currentPrice: number): boolean {
    const watermark = this.highWatermarks.get(position.symbol);
    if (!watermark) return false;

    if (position.side === 'LONG') {
      const threshold = watermark * (1 - this.config.trailingStopPercent);
      return currentPrice < threshold;
    } else {
      const threshold = watermark * (1 + this.config.trailingStopPercent);
      return currentPrice > threshold;
    }
  }

  checkTakeProfit(position: Position, currentPrice: number): boolean {
    const entry = position.entry_price;
    if (position.side === 'LONG') {
      const target = entry * (1 + this.config.takeProfitPercent);
      return currentPrice >= target;
    } else {
      const target = entry * (1 - this.config.takeProfitPercent);
      return currentPrice <= target;
    }
  }

  getDailyPnl(): number {
    return this.dailyPnl;
  }

  resetDailyPnl(): void {
    this.dailyPnl = 0;
    this.highWatermarks.clear();
  }
}

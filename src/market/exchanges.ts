import type { Position } from '../types';

export interface ExchangeClient {
  name: string;
  fetchPositions(): Promise<Position[]>;
  closePosition(symbol: string, side: 'LONG' | 'SHORT'): Promise<void>;
}

export class BinanceClient implements ExchangeClient {
  name = 'binance';

  constructor(private fetchFn: typeof fetch = fetch) {}

  async fetchPositions(): Promise<Position[]> {
    const res = await this.fetchFn('https://fapi.binance.com/fapi/v2/positionRisk');
    if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
    const data = await res.json() as Array<{
      symbol: string;
      positionAmt: string;
      entryPrice: string;
    }>;
    return data
      .filter(p => parseFloat(p.positionAmt) !== 0)
      .map(p => ({
        symbol: p.symbol,
        side: parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT',
        size: Math.abs(parseFloat(p.positionAmt)),
        entry_price: parseFloat(p.entryPrice),
        exchange: this.name,
      }));
  }

  async closePosition(_symbol: string, _side: 'LONG' | 'SHORT'): Promise<void> {
    // Implemented via TRADE_SERVICE binding in production
    throw new Error('Not implemented — use TRADE_SERVICE binding');
  }
}

export class BybitClient implements ExchangeClient {
  name = 'bybit';

  constructor(private fetchFn: typeof fetch = fetch) {}

  async fetchPositions(): Promise<Position[]> {
    const res = await this.fetchFn('https://api.bybit.com/v5/position/list');
    if (!res.ok) throw new Error(`Bybit API error: ${res.status}`);
    const data = await res.json() as {
      result: { list: Array<{ symbol: string; size: string; avgPrice: string }> };
    };
    return data.result.list
      .filter(p => parseFloat(p.size) !== 0)
      .map(p => ({
        symbol: p.symbol,
        side: parseFloat(p.size) > 0 ? 'LONG' : 'SHORT',
        size: Math.abs(parseFloat(p.size)),
        entry_price: parseFloat(p.avgPrice),
        exchange: this.name,
      }));
  }

  async closePosition(_symbol: string, _side: 'LONG' | 'SHORT'): Promise<void> {
    throw new Error('Not implemented — use TRADE_SERVICE binding');
  }
}

export class MexcClient implements ExchangeClient {
  name = 'mexc';

  constructor(private fetchFn: typeof fetch = fetch) {}

  async fetchPositions(): Promise<Position[]> {
    const res = await this.fetchFn('https://contract.mexc.com/api/v1/private/position/open');
    if (!res.ok) throw new Error(`Mexc API error: ${res.status}`);
    const data = await res.json() as {
      data: Array<{ symbol: string; position: string; openPrice: string }>;
    };
    return (data.data ?? [])
      .filter(p => parseFloat(p.position) !== 0)
      .map(p => ({
        symbol: p.symbol,
        side: parseFloat(p.position) > 0 ? 'LONG' : 'SHORT',
        size: Math.abs(parseFloat(p.position)),
        entry_price: parseFloat(p.openPrice),
        exchange: this.name,
      }));
  }

  async closePosition(_symbol: string, _side: 'LONG' | 'SHORT'): Promise<void> {
    throw new Error('Not implemented — use TRADE_SERVICE binding');
  }
}

export function createExchangeClients(): ExchangeClient[] {
  return [new BinanceClient(), new BybitClient(), new MexcClient()];
}

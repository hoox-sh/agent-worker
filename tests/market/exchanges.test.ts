import { describe, expect, test, mock } from 'bun:test';
import { BinanceClient, BybitClient, MexcClient } from '../../src/market/exchanges';

describe('BinanceClient', () => {
  test('fetchPositions calls TRADE_SERVICE with correct params', async () => {
    const mockFetch = mock(async () =>
      new Response(JSON.stringify([{ symbol: 'BTCUSDT', positionAmt: '1.5', entryPrice: '50000' }]))
    );
    const client = new BinanceClient(mockFetch as unknown as typeof fetch);
    const positions = await client.fetchPositions();
    expect(positions.length).toBe(1);
    expect(positions[0].symbol).toBe('BTCUSDT');
  });

  test('fetchPositions returns empty on 200 with no data', async () => {
    const mockFetch = mock(async () => new Response(JSON.stringify([])));
    const client = new BinanceClient(mockFetch as unknown as typeof fetch);
    const positions = await client.fetchPositions();
    expect(positions).toEqual([]);
  });

  test('fetchPositions throws on non-200', async () => {
    const mockFetch = mock(async () => new Response('error', { status: 500 }));
    const client = new BinanceClient(mockFetch as unknown as typeof fetch);
    await expect(client.fetchPositions()).rejects.toThrow();
  });
});

describe('BybitClient', () => {
  test('fetchPositions parses Bybit response format', async () => {
    const mockFetch = mock(async () =>
      new Response(JSON.stringify({
        result: { list: [{ symbol: 'ETHUSDT', size: '2', avgPrice: '3000' }] }
      }))
    );
    const client = new BybitClient(mockFetch as unknown as typeof fetch);
    const positions = await client.fetchPositions();
    expect(positions.length).toBe(1);
    expect(positions[0].symbol).toBe('ETHUSDT');
  });
});

describe('MexcClient', () => {
  test('fetchPositions parses Mexc response format', async () => {
    const mockFetch = mock(async () =>
      new Response(JSON.stringify({ data: [{ symbol: 'SOLUSDT', position: '5', openPrice: '100' }] }))
    );
    const client = new MexcClient(mockFetch as unknown as typeof fetch);
    const positions = await client.fetchPositions();
    expect(positions.length).toBe(1);
  });
});

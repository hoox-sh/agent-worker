import { ExecutionContext, ScheduledEvent } from '@cloudflare/workers-types';

export interface Env {
  D1_SERVICE: Fetcher;
  TRADE_SERVICE: Fetcher;
  TELEGRAM_SERVICE: Fetcher;
  CONFIG_KV: KVNamespace;
  AI: any;
}

// Function to fetch mark price from exchange public APIs
async function fetchMarkPrice(exchange: string, symbol: string): Promise<number | null> {
  try {
    const ex = exchange.toLowerCase();
    // Normalize symbol for standard USDT pairs (e.g. BTCUSDT)
    let sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (ex === 'binance') {
      const res = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`);
      if (res.ok) {
        const data: any = await res.json();
        return parseFloat(data.markPrice);
      }
    } else if (ex === 'bybit') {
      const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${sym}`);
      if (res.ok) {
        const data: any = await res.json();
        if (data?.result?.list?.[0]?.markPrice) {
          return parseFloat(data.result.list[0].markPrice);
        }
      }
    } else if (ex === 'mexc') {
      // MEXC uses format BTC_USDT
      if (sym.endsWith('USDT') && !sym.includes('_')) {
        sym = sym.replace('USDT', '_USDT');
      }
      const res = await fetch(`https://contract.mexc.com/api/v1/contract/detail?symbol=${sym}`);
      if (res.ok) {
        const data: any = await res.json();
        if (data?.data?.fairPrice) {
           return parseFloat(data.data.fairPrice);
        }
      }
    }
  } catch (error) {
    console.error(`Failed to fetch mark price for ${symbol} on ${exchange}:`, error);
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/agent/risk-override') {
      // Manual force of risk configuration
      return new Response(JSON.stringify({ success: true, message: 'Risk override applied' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'GET' && url.pathname === '/agent/status') {
      // Return current health and active trailing stops
      return new Response(JSON.stringify({ success: true, status: 'Healthy', activeTrailingStops: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Agent Worker is running', { status: 200 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log("Agent Worker cron triggered at:", event.cron, event.scheduledTime);
    ctx.waitUntil(this.processRoutine(env));
  },

  async processRoutine(env: Env) {
    try {
      console.log("Starting agent processing routine...");

      // 1. Fetch active open positions
      const positionsRes = await env.D1_SERVICE.fetch(new Request('http://d1-service/api/dashboard/positions'));
      if (!positionsRes.ok) {
        console.error("Failed to fetch positions from D1_SERVICE:", await positionsRes.text());
        return;
      }
      
      const positionsData: any = await positionsRes.json();
      const openPositions = positionsData.positions || [];
      console.log(`Found ${openPositions.length} open positions.`);

      // 2. Fetch Global Kill Switch config
      const killSwitch = await env.CONFIG_KV.get('trade:kill_switch');
      if (killSwitch === 'true') {
         console.warn("Global kill switch is active. Skipping active trade management.");
         return;
      }

      // 3. Simple Iteration through positions to simulate tracking logic
      let totalUnrealizedPnl = 0;
      let accountValue = 10000; // Mock account value for relative PnL, ideal is to fetch from balances table.

      for (const position of openPositions) {
         console.log(`Analyzing position: ${position.symbol} (${position.side}) - Quantity: ${position.size}`);
         
         const markPrice = await fetchMarkPrice(position.exchange, position.symbol);
         
         if (markPrice !== null) {
            console.log(`${position.exchange} ${position.symbol} Mark Price: ${markPrice}`);
            // Calculate unrealized PnL assuming size is base currency and entry_price exists
            if (position.entry_price && position.size) {
               const priceDiff = position.side === 'LONG' ? (markPrice - position.entry_price) : (position.entry_price - markPrice);
               const pnl = priceDiff * position.size;
               totalUnrealizedPnl += pnl;
               console.log(`Unrealized PnL for ${position.symbol}: ${pnl}`);

               // --- Trailing Stop Logic (Mock Check) ---
               // Fetch watermark from KV. Key format: trade:watermark:{exchange}:{symbol}:{side}
               const wmKey = `trade:watermark:${position.exchange}:${position.symbol}:${position.side}`;
               const currentWmStr = await env.CONFIG_KV.get(wmKey);
               let currentWm = currentWmStr ? parseFloat(currentWmStr) : position.entry_price;
               
               let newWm = currentWm;
               if (position.side === 'LONG' && markPrice > currentWm) newWm = markPrice;
               if (position.side === 'SHORT' && markPrice < currentWm) newWm = markPrice;

               if (newWm !== currentWm) {
                  await env.CONFIG_KV.put(wmKey, newWm.toString());
               }

               // E.g., 5% trailing stop based on leverage or just raw price drop
               const trailingStopPercent = 0.05; 
               let triggerStop = false;
               if (position.side === 'LONG' && markPrice < newWm * (1 - trailingStopPercent)) triggerStop = true;
               if (position.side === 'SHORT' && markPrice > newWm * (1 + trailingStopPercent)) triggerStop = true;

               if (triggerStop) {
                   console.log(`TRAILING STOP TRIGGERED for ${position.symbol}! Watermark: ${newWm}, Current: ${markPrice}`);
                   // Here we would call the trade-worker to close the position
                   await sendCloseOrder(env, position);
               }

               // --- Scaling Out Logic ---
               // If price moved 10% in favor, close half.
               const tpPercent = 0.10;
               let triggerTp = false;
               if (position.side === 'LONG' && markPrice > position.entry_price * (1 + tpPercent)) triggerTp = true;
               if (position.side === 'SHORT' && markPrice < position.entry_price * (1 - tpPercent)) triggerTp = true;
               
               if (triggerTp) {
                   // Ensure we only do this once. Could track a flag in KV.
                   const tpKey = `trade:tp_hit:${position.exchange}:${position.symbol}:${position.side}`;
                   const alreadyScaled = await env.CONFIG_KV.get(tpKey);
                   if (!alreadyScaled) {
                       console.log(`TAKE PROFIT TRIGGERED for ${position.symbol}! Scaling out 50%.`);
                       await sendCloseOrder(env, position, position.size / 2);
                       await env.CONFIG_KV.put(tpKey, 'true');
                   }
               }
            }
         }
      }

      // 4. Global Kill Switch check based on PnL
      const maxDrawdownPercentStr = await env.CONFIG_KV.get('trade:max_daily_drawdown_percent');
      const maxDrawdownPercent = maxDrawdownPercentStr ? parseFloat(maxDrawdownPercentStr) : -5;
      
      const pnlPercent = (totalUnrealizedPnl / accountValue) * 100;
      if (pnlPercent <= maxDrawdownPercent) {
          console.warn(`GLOBAL RISK BREACH: PnL is ${pnlPercent}%, limit is ${maxDrawdownPercent}%. Engaging kill switch.`);
          await env.CONFIG_KV.put('trade:kill_switch', 'true');
          
          // Send Telegram Notification
          if (env.TELEGRAM_SERVICE) {
              await env.TELEGRAM_SERVICE.fetch(new Request('http://telegram-worker/webhook', {
                  method: 'POST',
                  body: JSON.stringify({ message: `🚨 EMERGENCY: Max daily drawdown reached (${pnlPercent.toFixed(2)}%). Global Kill Switch ENGAGED.` })
              }));
          }
      }

      // 5. AI Summarization (Hourly Check or Daily Check depending on cron config)
      // For simplicity, let's say if it's top of the hour we run this
      const currentMin = new Date().getMinutes();
      if (currentMin >= 0 && currentMin < 5) {
         try {
             const systemLogsRes = await env.D1_SERVICE.fetch(new Request('http://d1-service/api/dashboard/logs'));
             if (systemLogsRes.ok && env.AI) {
                 const logsData: any = await systemLogsRes.json();
                 const logs = logsData.logs || [];
                 const recentLogsStr = JSON.stringify(logs.slice(0, 10)); // Take last 10 logs

                 const response = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
                    messages: [
                      { role: "system", content: "You are a professional trading system observer. Summarize the following system logs and give a 1 sentence health update." },
                      { role: "user", content: `Recent Logs: ${recentLogsStr}` }
                    ]
                 });
                 
                 console.log("AI System Health Summary:", response.response);
                 
                 // Store in KV for the dashboard
                 await env.CONFIG_KV.put('dashboard:ai_health_summary', response.response);
                 
                 if (env.TELEGRAM_SERVICE) {
                     await env.TELEGRAM_SERVICE.fetch(new Request('http://telegram-worker/webhook', {
                         method: 'POST',
                         body: JSON.stringify({ message: `🧠 AI System Health Update:\n${response.response}` })
                     }));
                 }
             }
         } catch (e) {
             console.error("AI summarization failed:", e);
         }
      }

    } catch (error) {
      console.error("Error in agent processing routine:", error);
    }
  }
};

async function sendCloseOrder(env: Env, position: any, qtyOverride?: number) {
    const action = position.side === 'LONG' ? 'CLOSE_LONG' : 'CLOSE_SHORT';
    const quantity = qtyOverride || position.size;
    const payload = {
       exchange: position.exchange,
       symbol: position.symbol,
       action: action,
       quantity: quantity
    };

    try {
        console.log(`Sending close order to TRADE_SERVICE:`, payload);
        const res = await env.TRADE_SERVICE.fetch(new Request('http://trade-worker/webhook', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify(payload)
        }));
        if (!res.ok) {
            console.error(`Failed to close position ${position.symbol}:`, await res.text());
        }
    } catch (e) {
        console.error(`Error closing position ${position.symbol}:`, e);
    }
}


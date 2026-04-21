import { ExecutionContext, ScheduledEvent } from '@cloudflare/workers-types';
import { ProviderManager, createProviderManager } from './providers';
import { AIRequest } from './types';
import { ALL_MODELS, getModelInfo } from './models';

export interface Env {
  D1_SERVICE: Fetcher;
  TRADE_SERVICE: Fetcher;
  TELEGRAM_SERVICE: Fetcher;
  CONFIG_KV: KVNamespace;
  AI: any;
}

let providerManager: ProviderManager | null = null;

function getProviderManager(env: Env): ProviderManager {
  if (!providerManager) {
    providerManager = createProviderManager(env);
  }
  return providerManager;
}

async function fetchMarkPrice(exchange: string, symbol: string): Promise<number | null> {
  try {
    const ex = exchange.toLowerCase();
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
    const pm = getProviderManager(env);

    if (request.method === 'POST' && url.pathname === '/agent/risk-override') {
      const body: any = await request.json();
      if (body.trailingStopPercent !== undefined) {
        await env.CONFIG_KV.put('trade:trailing_stop_percent', body.trailingStopPercent.toString());
      }
      return new Response(JSON.stringify({ success: true, message: 'Risk override applied' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'GET' && url.pathname === '/agent/status') {
      const config = await pm.loadConfig();
      return new Response(JSON.stringify({
        success: true,
        status: 'Healthy',
        config: {
          defaultProvider: config.defaultProvider,
          fallbackChain: config.fallbackChain,
          modelMap: config.modelMap
        },
        activeTrailingStops: []
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'GET' && url.pathname === '/agent/config') {
      const config = await pm.loadConfig();
      return new Response(JSON.stringify({
        success: true,
        config
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'POST' && url.pathname === '/agent/config') {
      const body: any = await request.json();
      const updated = await pm.updateConfig(body);
      return new Response(JSON.stringify({ success: true, config: updated }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'POST' && url.pathname === '/agent/test-model') {
      const body: any = await request.json();
      const provider = body.provider || 'workers-ai';
      const model = body.model;

      const testRequest: AIRequest = {
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: body.prompt || 'Say "Hello" if you can hear me.' }
        ],
        model
      };

      const result = await pm.run(testRequest);
      return new Response(JSON.stringify({
        success: result.success,
        provider: result.provider,
        model: result.model,
        response: result.data?.response,
        error: result.error,
        latencyMs: result.latencyMs
      }), {
        status: result.success ? 200 : 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'GET' && url.pathname === '/agent/health') {
      const status = await pm.getProviderStatus();
      return new Response(JSON.stringify({
        success: true,
        providers: status
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'GET' && url.pathname === '/agent/models') {
      return new Response(JSON.stringify({
        success: true,
        models: ALL_MODELS
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'POST' && url.pathname === '/agent/chat') {
      const body: any = await request.json();
      const testRequest: AIRequest = {
        messages: body.messages || [
          { role: 'system', content: body.systemPrompt || 'You are a helpful trading assistant.' },
          { role: 'user', content: body.prompt }
        ],
        temperature: body.temperature,
        maxTokens: body.maxTokens
      };

      const result = await pm.run(testRequest);
      return new Response(JSON.stringify({
        success: result.success,
        response: result.data?.response,
        model: result.model,
        provider: result.provider,
        error: result.error
      }), {
        status: result.success ? 200 : 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'POST' && url.pathname === '/agent/embedding') {
      const body: any = await request.json();
      const result = await pm.runEmbedding(body.text, body.provider);
      return new Response(JSON.stringify({
        success: result.success,
        embedding: result.data?.response,
        model: result.model,
        error: result.error
      }), {
        status: result.success ? 200 : 502,
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

      const positionsRes = await env.D1_SERVICE.fetch(new Request('http://d1-service/api/dashboard/positions'));
      if (!positionsRes.ok) {
        console.error("Failed to fetch positions from D1_SERVICE:", await positionsRes.text());
        return;
      }

      const positionsData: any = await positionsRes.json();
      const openPositions = positionsData.positions || [];
      console.log(`Found ${openPositions.length} open positions.`);

      const killSwitch = await env.CONFIG_KV.get('trade:kill_switch');
      if (killSwitch === 'true') {
         console.warn("Global kill switch is active. Skipping active trade management.");
         return;
      }

      const pm = getProviderManager(env);
      const config = await pm.loadConfig();

      let totalUnrealizedPnl = 0;
      let accountValue = 10000;

      for (const position of openPositions) {
         console.log(`Analyzing position: ${position.symbol} (${position.side}) - Quantity: ${position.size}`);

         const markPrice = await fetchMarkPrice(position.exchange, position.symbol);

         if (markPrice !== null) {
            console.log(`${position.exchange} ${position.symbol} Mark Price: ${markPrice}`);
            if (position.entry_price && position.size) {
               const priceDiff = position.side === 'LONG' ? (markPrice - position.entry_price) : (position.entry_price - markPrice);
               const pnl = priceDiff * position.size;
               totalUnrealizedPnl += pnl;
               console.log(`Unrealized PnL for ${position.symbol}: ${pnl}`);

               const wmKey = `trade:watermark:${position.exchange}:${position.symbol}:${position.side}`;
               const currentWmStr = await env.CONFIG_KV.get(wmKey);
               let currentWm = currentWmStr ? parseFloat(currentWmStr) : position.entry_price;

               let newWm = currentWm;
               if (position.side === 'LONG' && markPrice > currentWm) newWm = markPrice;
               if (position.side === 'SHORT' && markPrice < currentWm) newWm = markPrice;

               if (newWm !== currentWm) {
                  await env.CONFIG_KV.put(wmKey, newWm.toString());
               }

               const trailingStopPercent = config.trailingStopPercent;
               let triggerStop = false;
               if (position.side === 'LONG' && markPrice < newWm * (1 - trailingStopPercent)) triggerStop = true;
               if (position.side === 'SHORT' && markPrice > newWm * (1 + trailingStopPercent)) triggerStop = true;

               if (triggerStop) {
                   console.log(`TRAILING STOP TRIGGERED for ${position.symbol}! Watermark: ${newWm}, Current: ${markPrice}`);
                   await sendCloseOrder(env, position);
               }

               const tpPercent = config.takeProfitPercent;
               let triggerTp = false;
               if (position.side === 'LONG' && markPrice > position.entry_price * (1 + tpPercent)) triggerTp = true;
               if (position.side === 'SHORT' && markPrice < position.entry_price * (1 - tpPercent)) triggerTp = true;

               if (triggerTp) {
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

      const maxDrawdownPercentStr = await env.CONFIG_KV.get('trade:max_daily_drawdown_percent');
      const maxDrawdownPercent = maxDrawdownPercentStr ? parseFloat(maxDrawdownPercentStr) : config.maxDailyDrawdownPercent;

      const pnlPercent = (totalUnrealizedPnl / accountValue) * 100;
      if (pnlPercent <= maxDrawdownPercent) {
          console.warn(`GLOBAL RISK BREACH: PnL is ${pnlPercent}%, limit is ${maxDrawdownPercent}%. Engaging kill switch.`);
          await env.CONFIG_KV.put('trade:kill_switch', 'true');

          if (env.TELEGRAM_SERVICE) {
              await env.TELEGRAM_SERVICE.fetch(new Request('http://telegram-worker/webhook', {
                  method: 'POST',
                  body: JSON.stringify({ message: `🚨 EMERGENCY: Max daily drawdown reached (${pnlPercent.toFixed(2)}%). Global Kill Switch ENGAGED.` })
              }));
          }
      }

      const currentMin = new Date().getMinutes();
      if (currentMin >= 0 && currentMin < 5) {
         try {
             const systemLogsRes = await env.D1_SERVICE.fetch(new Request('http://d1-service/api/dashboard/logs'));
             if (systemLogsRes.ok && env.AI) {
                 const logsData: any = await systemLogsRes.json();
                 const logs = logsData.logs || [];
                 const recentLogsStr = JSON.stringify(logs.slice(0, 10));

                 const systemPrompt = 'You are a professional trading system observer. Summarize the following system logs and give a 1 sentence health update.';
                 const aiRequest: AIRequest = {
                   messages: [
                     { role: 'system', content: systemPrompt },
                     { role: 'user', content: `Recent Logs: ${recentLogsStr}` }
                   ]
                 };

                 const result = await pm.run(aiRequest);
                 if (result.success && result.data?.response) {
                   console.log("AI System Health Summary:", result.data.response);
                   await env.CONFIG_KV.put('dashboard:ai_health_summary', result.data.response);

                   if (env.TELEGRAM_SERVICE) {
                       await env.TELEGRAM_SERVICE.fetch(new Request('http://telegram-worker/webhook', {
                           method: 'POST',
                           body: JSON.stringify({ message: `🧠 AI System Health Update:\n${result.data.response}` })
                       }));
                   }
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
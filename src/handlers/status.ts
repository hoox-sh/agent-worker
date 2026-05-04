import type { Env, AgentConfig } from '../types';
import { DEFAULT_AGENT_CONFIG } from '../types';
import { createLogger } from '@hoox/shared/middleware';

export async function handleStatus(_request: Request, env: Env): Promise<Response> {
  try {
    const stored = await env.CONFIG_KV.get('agent:config');
    const config: AgentConfig = stored ? JSON.parse(stored) : { ...DEFAULT_AGENT_CONFIG };

    return new Response(JSON.stringify({
      service: 'agent-worker',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      config: {
        defaultProvider: config.defaultProvider,
        fallbackChain: config.fallbackChain,
        modelMap: config.modelMap,
        timeoutMs: config.timeoutMs,
        retryCount: config.retryCount,
        risk: {
          maxDailyDrawdownPercent: config.maxDailyDrawdownPercent,
          trailingStopPercent: config.trailingStopPercent,
          takeProfitPercent: config.takeProfitPercent,
        },
      },
      providers: ['workers-ai', 'openai', 'anthropic', 'google', 'azure'],
      endpoints: [
        'GET  /agent/health',
        'GET  /agent/status',
        'GET  /agent/config',
        'POST /agent/config',
        'POST /agent/chat',
        'GET  /agent/models',
        'POST /agent/test-model',
        'POST /agent/embedding',
        'POST /agent/housekeeping',
        'POST /agent/risk-override',
      ],
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Failed to retrieve status',
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
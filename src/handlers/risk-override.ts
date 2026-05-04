import type { Env, AgentConfig, RiskOverrideRequestBody } from '../types';
import { DEFAULT_AGENT_CONFIG } from '../types';
import { validateJson } from '@hoox/shared/middleware';

const CONFIG_KEY = 'agent:config';

export async function handleRiskOverride(request: Request, env: Env): Promise<Response> {
  const parsed = await validateJson(request);
  if (!parsed.ok) {
    return new Response(JSON.stringify({ error: parsed.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = parsed.value as RiskOverrideRequestBody;

  // Validate trailing stop percent
  if (body.trailingStopPercent !== undefined) {
    if (body.trailingStopPercent <= 0 || body.trailingStopPercent > 1) {
      return new Response(
        JSON.stringify({ error: 'trailingStopPercent must be between 0 and 1' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  try {
    const stored = await env.CONFIG_KV.get(CONFIG_KEY);
    const existing: AgentConfig = stored ? JSON.parse(stored) : { ...DEFAULT_AGENT_CONFIG };
    const updated: AgentConfig = { ...existing, ...body };

    await env.CONFIG_KV.put(CONFIG_KEY, JSON.stringify(updated));

    return new Response(JSON.stringify(updated), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to update risk config', details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

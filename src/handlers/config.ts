import type { Env, AgentConfig, ConfigUpdateRequestBody, ProviderName } from '../types';
import { DEFAULT_AGENT_CONFIG } from '../types';
import { validateJson } from '../middleware/validate';

const VALID_PROVIDERS: ProviderName[] = ['workers-ai', 'openai', 'anthropic', 'google', 'azure'];
const CONFIG_KEY = 'agent:config';

export async function handleGetConfig(_request: Request, env: Env): Promise<Response> {
  try {
    const stored = await env.CONFIG_KV.get(CONFIG_KEY);
    if (stored) {
      const config = JSON.parse(stored) as AgentConfig;
      return new Response(JSON.stringify(config), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(DEFAULT_AGENT_CONFIG), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to read config', details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

export async function handleUpdateConfig(request: Request, env: Env): Promise<Response> {
  const parsed = await validateJson(request);
  if (!parsed.ok) {
    return new Response(JSON.stringify({ error: parsed.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = parsed.value as Partial<ConfigUpdateRequestBody>;

  // Validate provider if present
  if (body.defaultProvider && !VALID_PROVIDERS.includes(body.defaultProvider)) {
    return new Response(
      JSON.stringify({ error: `Invalid provider: ${body.defaultProvider}. Must be one of: ${VALID_PROVIDERS.join(', ')}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Validate fallback chain if present
  if (body.fallbackChain) {
    const invalid = body.fallbackChain.filter(p => !VALID_PROVIDERS.includes(p));
    if (invalid.length > 0) {
      return new Response(
        JSON.stringify({ error: `Invalid providers in fallback chain: ${invalid.join(', ')}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  try {
    // Load existing config, merge updates
    const stored = await env.CONFIG_KV.get(CONFIG_KEY);
    const existing: AgentConfig = stored ? JSON.parse(stored) : { ...DEFAULT_AGENT_CONFIG };
    const updated: AgentConfig = { ...existing, ...body };

    await env.CONFIG_KV.put(CONFIG_KEY, JSON.stringify(updated));

    return new Response(JSON.stringify(updated), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to update config', details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

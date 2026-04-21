import { AIRequest, AIResponse, AgentConfig, DEFAULT_AGENT_CONFIG, ProviderName, ProviderResult } from './types';

export class ProviderManager {
  private env: any;
  private config: AgentConfig | null = null;
  private configLoading = false;

  constructor(env: any) {
    this.env = env;
  }

  async loadConfig(): Promise<AgentConfig> {
    if (this.config) return this.config;
    if (this.configLoading) {
      await new Promise(r => setTimeout(r, 100));
      return this.loadConfig();
    }
    this.configLoading = true;

    try {
      const stored = await this.env.CONFIG_KV.get('agent:config');
      if (stored) {
        this.config = { ...DEFAULT_AGENT_CONFIG, ...JSON.parse(stored) };
      } else {
        await this.env.CONFIG_KV.put('agent:config', JSON.stringify(DEFAULT_AGENT_CONFIG));
        this.config = DEFAULT_AGENT_CONFIG;
      }
    } catch (e) {
      console.error('Failed to load agent config:', e);
      this.config = DEFAULT_AGENT_CONFIG;
    }

    this.configLoading = false;
    return this.config!;
  }

  async updateConfig(updates: Partial<AgentConfig>): Promise<AgentConfig> {
    const current = await this.loadConfig();
    const updated = { ...current, ...updates };
    await this.env.CONFIG_KV.put('agent:config', JSON.stringify(updated));
    this.config = updated;
    return updated;
  }

  async run(request: AIRequest): Promise<ProviderResult> {
    const config = await this.loadConfig();
    return this.runWithFallback(request, config.fallbackChain, config.retryCount);
  }

  private async runWithFallback(request: AIRequest, chain: ProviderName[], retries: number): Promise<ProviderResult> {
    let lastError: string = '';

    for (const provider of chain) {
      try {
        const result = await this.runProvider(provider, request);
        if (result.success) {
          return result;
        }
        lastError = result.error || 'Unknown error';
      } catch (e: any) {
        lastError = e.message || String(e);
        console.warn(`Provider ${provider} failed:`, lastError);
      }
    }

    if (retries > 0) {
      await new Promise(r => setTimeout(r, 1000));
      return this.runWithFallback(request, chain, retries - 1);
    }

    return {
      success: false,
      error: `All providers failed. Last error: ${lastError}`,
      provider: chain[0],
      model: ''
    };
  }

  private async runProvider(provider: ProviderName, request: AIRequest): Promise<ProviderResult> {
    const config = await this.loadConfig();
    const startTime = Date.now();

    switch (provider) {
      case 'workers-ai':
        return this.runWorkersAI(request, config);
      case 'openai':
        return this.runOpenAI(request, config);
      case 'anthropic':
        return this.runAnthropic(request, config);
      case 'google':
        return this.runGoogle(request, config);
      default:
        return { success: false, error: `Unknown provider: ${provider}`, provider, model: '' };
    }
  }

  private async runWorkersAI(request: AIRequest, config: AgentConfig): Promise<ProviderResult> {
    const model = request.model || config.modelMap['workers-ai'];
    const timeoutMs = config.timeoutMs || 30000;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response: any = await this.env.AI.run(model, {
        messages: request.messages
      }, { signal: controller.signal as any });

      clearTimeout(timeout);

      return {
        success: true,
        data: { response: response?.response || '', model },
        provider: 'workers-ai',
        model,
        latencyMs: response?._metadata?.latency
      };
    } catch (e: any) {
      return {
        success: false,
        error: e.message || 'Workers AI failed',
        provider: 'workers-ai',
        model
      };
    }
  }

  private async runOpenAI(request: AIRequest, config: AgentConfig): Promise<ProviderResult> {
    const model = request.model || config.modelMap['openai'];
    const apiKey = await this.env.CONFIG_KV.get('agent:openai_key');
    const baseUrl = await this.env.AI.gateway?.('aig').getUrl?.('openai') || 'https://gateway.ai.cloudflare.com/v1/workers-ai';

    if (!apiKey) {
      return { success: false, error: 'OpenAI API key not configured', provider: 'openai', model };
    }

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens
        })
      });

      const data: any = await res.json();

      if (!res.ok) {
        return { success: false, error: data.error?.message || 'OpenAI API error', provider: 'openai', model };
      }

      return {
        success: true,
        data: { response: data.choices?.[0]?.message?.content || '', model },
        provider: 'openai',
        model,
        latencyMs: data._metadata?.latency
      };
    } catch (e: any) {
      return { success: false, error: e.message || 'OpenAI request failed', provider: 'openai', model };
    }
  }

  private async runAnthropic(request: AIRequest, config: AgentConfig): Promise<ProviderResult> {
    const model = request.model || config.modelMap['anthropic'];
    const apiKey = await this.env.CONFIG_KV.get('agent:anthropic_key');

    if (!apiKey) {
      return { success: false, error: 'Anthropic API key not configured', provider: 'anthropic', model };
    }

    try {
      const baseUrl = await this.env.AI.gateway?.('aig').getUrl?.('anthropic') || 'https://gateway.ai.cloudflare.com/v1/workers-ai/anthropic';

      const systemMsg = request.messages.find(m => m.role === 'system');
      const userMsgs = request.messages.filter(m => m.role !== 'system');

      const res = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          system: systemMsg?.content,
          messages: userMsgs.map(m => ({ role: m.role, content: m.content })),
          temperature: request.temperature,
          max_tokens: request.maxTokens || 4096
        })
      });

      const data: any = await res.json();

      if (!res.ok) {
        return { success: false, error: data.error?.message || 'Anthropic API error', provider: 'anthropic', model };
      }

      return {
        success: true,
        data: { response: data.content?.[0]?.text || '', model },
        provider: 'anthropic',
        model,
        latencyMs: data._metadata?.latency
      };
    } catch (e: any) {
      return { success: false, error: e.message || 'Anthropic request failed', provider: 'anthropic', model };
    }
  }

  private async runGoogle(request: AIRequest, config: AgentConfig): Promise<ProviderResult> {
    const model = request.model || config.modelMap['google'];
    const apiKey = await this.env.CONFIG_KV.get('agent:google_key');

    if (!apiKey) {
      return { success: false, error: 'Google API key not configured', provider: 'google', model };
    }

    try {
      const baseUrl = await this.env.AI.gateway?.('aig').getUrl?.('google') || 'https://gateway.ai.cloudflare.com/v1/workers-ai/google';

      const res = await fetch(`${baseUrl}/generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: request.messages.map(m => ({ text: m.content })) }],
          generationConfig: {
            temperature: request.temperature,
            maxOutputTokens: request.maxTokens
          }
        })
      });

      const data: any = await res.json();

      if (!res.ok) {
        return { success: false, error: data.error?.message || 'Google API error', provider: 'google', model };
      }

      return {
        success: true,
        data: { response: data.candidates?.[0]?.content?.parts?.[0]?.text || '', model },
        provider: 'google',
        model,
        latencyMs: data._metadata?.latency
      };
    } catch (e: any) {
      return { success: false, error: e.message || 'Google request failed', provider: 'google', model };
    }
  }

  async runEmbedding(text: string, provider: ProviderName = 'workers-ai'): Promise<ProviderResult> {
    const config = await this.loadConfig();

    try {
      const model = '@cf/baai/bge-base-en-v1.5';

      if (provider === 'workers-ai') {
        const response = await this.env.AI.run(model, {
          texts: [text]
        });

        return {
          success: true,
          data: { response: JSON.stringify(response.data[0].embedding), model },
          provider: 'workers-ai',
          model
        };
      }

      return { success: false, error: 'Embedding not supported for this provider', provider, model: '' };
    } catch (e: any) {
      return { success: false, error: e.message || 'Embedding failed', provider, model: '' };
    }
  }

  async getProviderStatus(): Promise<Record<string, { healthy: boolean; latency?: number; error?: string }>> {
    const status: Record<string, { healthy: boolean; latency?: number; error?: string }> = {};
    const config = await this.loadConfig();

    for (const provider of config.fallbackChain) {
      try {
        const start = Date.now();
        const result = await this.runProvider(provider, {
          messages: [{ role: 'user', content: 'Hi' }]
        });
        status[provider] = {
          healthy: result.success,
          latency: result.success ? Date.now() - start : undefined,
          error: result.error
        };
      } catch (e: any) {
        status[provider] = { healthy: false, error: e.message };
      }
    }

    return status;
  }
}

export function createProviderManager(env: any): ProviderManager {
  return new ProviderManager(env);
}
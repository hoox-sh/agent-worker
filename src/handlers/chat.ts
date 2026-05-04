import type { Env, ChatRequestBody, AIResponse } from '../types';
import { validateJson, requireField, optionalField } from '@hoox/shared/middleware';
import { AIGateway } from '../ai/gateway';
import { createStreamResponse } from '../ai/streaming';

function createGateway(env: Env): AIGateway {
  const providers = [
    {
      name: 'workers-ai' as const,
      chat: async (req: { model?: string; messages: Array<{ role: string; content: string }>; temperature?: number; maxTokens?: number }) => {
        const result = await env.AI.run(req.model as string, {
          messages: req.messages,
          temperature: req.temperature,
          max_tokens: req.maxTokens,
        });
        return { response: (result as { response: string }).response, model: req.model || '', provider: 'workers-ai' as const };
      },
      isHealthy: async () => true,
    } as unknown as import('../ai/providers/base').AIProvider,
  ];
  return new AIGateway(providers as import('../ai/providers/base').AIProvider[], 'workers-ai', ['workers-ai']);
}

export async function handleChat(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const shouldStream = url.searchParams.get('stream') === 'true';

  const parsed = await validateJson(request);
  if (!parsed.ok) {
    return new Response(JSON.stringify({ error: parsed.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = parsed.value as ChatRequestBody;

  // Require either messages or prompt
  const messagesResult = body.messages
    ? { ok: true as const, value: body.messages }
    : (() => {
          const result = requireField<string>(body, 'prompt');
          if (!result.ok) return result;
          return { ok: true as const, value: [{ role: 'user' as const, content: result.value }] };
        })();

  if (!messagesResult.ok) {
    return new Response(JSON.stringify({ error: messagesResult.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const messages = messagesResult.value;
  const model = optionalField<string>(body, 'model', '@cf/meta/llama-3.1-8b-instruct');
  const temperature = optionalField<number>(body, 'temperature', 0.7);
  const maxTokens = optionalField<number>(body, 'maxTokens', 1024);

  // Streaming support
  if (shouldStream) {
    const generateStream = async function* () {
      // For now, simulate streaming by yielding the full response as one chunk
      // In production, this would use actual streaming from the AI provider
      try {
        const result = await env.AI.run(model as string, {
          messages,
          temperature,
          max_tokens: maxTokens,
        });

        const response = (result as { response: string }).response;
        yield { content: response, model, provider: 'workers-ai' as const, done: true };
      } catch (error) {
        yield { content: '', model, provider: 'workers-ai' as const, done: true };
        throw error;
      }
    };

    return createStreamResponse(generateStream());
  }

  // Non-streaming path
  try {
    const result = await env.AI.run(model as string, {
      messages,
      temperature,
      max_tokens: maxTokens,
    });

    const response: AIResponse = {
      response: (result as { response: string }).response,
      model,
      usage: (result as { usage?: { prompt_tokens: number; completion_tokens: number } }).usage
        ? {
              promptTokens: (result as any).usage.prompt_tokens,
              completionTokens: (result as any).usage.completion_tokens,
              totalTokens:
                (result as any).usage.prompt_tokens + (result as any).usage.completion_tokens,
            }
        : undefined,
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'AI request failed',
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

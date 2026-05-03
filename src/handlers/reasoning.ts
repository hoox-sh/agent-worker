import type { Env, AIResponse } from '../../src/types';
import { validateJson, requireField, optionalField } from '../middleware/validate';

export interface ReasoningRequestBody {
  [key: string]: unknown;
  prompt: string;
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
}

export interface ReasoningResponse {
  reasoning: string;
  answer: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function handleReasoning(request: Request, env: Env): Promise<Response> {
  const parsed = await validateJson(request);
  if (!parsed.ok) {
    return new Response(JSON.stringify({ error: parsed.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = parsed.value as ReasoningRequestBody;

  const promptResult = requireField<string>(body, 'prompt');
  if (!promptResult.ok) {
    return new Response(JSON.stringify({ error: promptResult.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const model = optionalField<string>(body, 'model', 'o1-preview');
  const reasoningEffort = optionalField<'low' | 'medium' | 'high'>(body, 'reasoningEffort', 'medium');
  const maxTokens = optionalField<number>(body, 'maxTokens', 4096);

  try {
    const result = await env.AI.run(model, {
      messages: [{ role: 'user', content: promptResult.value }],
      reasoning_effort: reasoningEffort,
      max_tokens: maxTokens,
    }) as AIResponse & { reasoning: string };

    const response: ReasoningResponse = {
      reasoning: result.reasoning || '',
      answer: result.response,
      model,
      usage: result.usage,
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Reasoning request failed',
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

import type { Env, TestModelRequestBody } from '../types';
import { validateJson, requireField, optionalField } from '../middleware/validate';

export async function handleTestModel(request: Request, env: Env): Promise<Response> {
  const parsed = await validateJson(request);
  if (!parsed.ok) {
    return new Response(JSON.stringify({ error: parsed.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = parsed.value as TestModelRequestBody;
  const promptResult = requireField<string>(body, 'prompt');
  if (!promptResult.ok) {
    return new Response(JSON.stringify({ error: promptResult.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const provider = optionalField<string>(body, 'provider', 'workers-ai');
  const model = optionalField<string>(body, 'model', '@cf/meta/llama-3.1-8b-instruct');
  const prompt = promptResult.value;

  const start = Date.now();

  try {
    const result = await env.AI.run(model, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 256,
    });

    const latency = Date.now() - start;

    const response = {
      success: true,
      response: (result as { response: string }).response,
      model,
      provider: provider as any,
      latencyMs: latency,
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const latency = Date.now() - start;
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        provider,
        model,
        latencyMs: latency,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

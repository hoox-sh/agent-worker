import type { Env, EmbeddingRequestBody } from '../types';
import { validateJson, requireField, optionalField } from '@hoox/shared/middleware';

export async function handleEmbedding(request: Request, env: Env): Promise<Response> {
  const parsed = await validateJson(request);
  if (!parsed.ok) {
    return new Response(JSON.stringify({ error: parsed.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = parsed.value as EmbeddingRequestBody;
  const textResult = requireField<string>(body, 'text');
  if (!textResult.ok) {
    return new Response(JSON.stringify({ error: textResult.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const model = optionalField<string>(body, 'model', '@cf/baai/bge-base-en-v1.5');

  try {
    const result = await env.AI.run(model, { text: textResult.value });
    const embeddingResult = result as { shape: number[]; data: number[] };

    return new Response(JSON.stringify({
      embedding: embeddingResult.data,
      dimensions: embeddingResult.shape[1],
      model,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Embedding generation failed',
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

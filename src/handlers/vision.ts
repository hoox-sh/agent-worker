import type { Env, AIResponse } from '../types';
import { validateJson, requireField, optionalField } from '../middleware/validate';

export interface VisionRequestBody {
  imageUrl?: string;
  imageBase64?: string;
  prompt?: string;
  model?: string;
  maxTokens?: number;
}

interface ImageSource {
  ok: boolean;
  value: string;
  source: 'url' | 'base64';
  error?: string;
}

export async function handleVision(request: Request, env: Env): Promise<Response> {
  const parsed = await validateJson(request);
  if (!parsed.ok) {
    return new Response(JSON.stringify({ error: parsed.error }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const body = parsed.value as VisionRequestBody;

  let imageResult: ImageSource;

  if (body.imageUrl) {
    imageResult = { ok: true, value: body.imageUrl, source: 'url' };
  } else if (body.imageBase64) {
    imageResult = { ok: true, value: body.imageBase64, source: 'base64' };
  } else {
    imageResult = { ok: false, error: 'Either imageUrl or imageBase64 is required' };
  }

  if (!imageResult.ok) {
    return new Response(JSON.stringify({ error: imageResult.error }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const promptResult = requireField<string>(body, 'prompt');
  if (!promptResult.ok) {
    return new Response(JSON.stringify({ error: promptResult.error }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const model = optionalField<string>(body, 'model', '@cf/meta/llama-3.2-11b-vision-instruct');
  const maxTokens = optionalField<number>(body, 'maxTokens', 1024);

  try {
    const result = await env.AI.run(model, {
      images: [imageResult.value],
      prompt: promptResult.value,
      max_tokens: maxTokens,
    }) as AIResponse;

    return new Response(JSON.stringify({ response: result.response, model }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Vision analysis failed', details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

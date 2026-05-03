import type { ModelInfo } from '../types';
import { ALL_MODELS } from '../models';

export async function handleModels(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const providerFilter = url.searchParams.get('provider');
  const taskTypeFilter = url.searchParams.get('taskType');

  let models = Object.values(ALL_MODELS) as ModelInfo[];

  if (providerFilter) {
    models = models.filter(m => m.provider === providerFilter);
  }

  if (taskTypeFilter) {
    models = models.filter(m => m.taskType === taskTypeFilter);
  }

  return new Response(JSON.stringify({ models, total: models.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

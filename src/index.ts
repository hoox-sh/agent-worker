import type { Env } from './types';
import { requireAuth } from '@hoox/shared/middleware';
import { withRequestLog, createLogger } from '@hoox/shared/middleware';
import { handleHealth } from './handlers/health';
import { handleGetConfig, handleUpdateConfig } from './handlers/config';
import { handleChat } from './handlers/chat';
import { handleModels } from './handlers/models';
import { handleTestModel } from './handlers/test-model';
import { handleEmbedding } from './handlers/embedding';
import { handleHousekeeping } from './handlers/housekeeping';
import { handleRiskOverride } from './handlers/risk-override';
import { handleStatus } from './handlers/status';
import { handleVision } from './handlers/vision';
import { handleReasoning } from './handlers/reasoning';
import { handleUsage } from './handlers/usage';
import { listPromptTemplates } from './ai/prompts';

const logger = createLogger({ service: 'agent-worker', module: 'router' });

async function route(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  // Auth check (skip for health in some deployments — adjust as needed)
  const authResponse = await requireAuth(request, env);
  if (authResponse) return authResponse;

  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Route matching
  if (path === '/agent/health' && method === 'GET') {
    return handleHealth(request);
  }

  if (path === '/agent/status' && method === 'GET') {
    return handleStatus(request, env);
  }

  if (path === '/agent/config' && method === 'GET') {
    return handleGetConfig(request, env);
  }

  if (path === '/agent/config' && method === 'POST') {
    return handleUpdateConfig(request, env);
  }

  if (path === '/agent/chat' && method === 'POST') {
    return handleChat(request, env);
  }

  if (path === '/agent/models' && method === 'GET') {
    return handleModels(request);
  }

  if (path === '/agent/test-model' && method === 'POST') {
    return handleTestModel(request, env);
  }

  if (path === '/agent/embedding' && method === 'POST') {
    return handleEmbedding(request, env);
  }

  if (path === '/agent/housekeeping' && method === 'POST') {
    return handleHousekeeping(request, env);
  }

  if (path === '/agent/risk-override' && method === 'POST') {
    return handleRiskOverride(request, env);
  }

  // New routes from Phase 2
  if (path === '/agent/vision' && method === 'POST') {
    return handleVision(request, env);
  }

  if (path === '/agent/reasoning' && method === 'POST') {
    return handleReasoning(request, env);
  }

  if (path === '/agent/usage' && method === 'GET') {
    return handleUsage(request, env);
  }

  if (path === '/agent/prompts' && method === 'GET') {
    const templates = listPromptTemplates();
    return new Response(JSON.stringify(templates), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  fetch: withRequestLog(route, { service: 'agent-worker', module: 'router' }),

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    logger.info('Scheduled cron trigger received');
    // Delegate to housekeeping handler internally
    const req = new Request('http://localhost/agent/housekeeping', { method: 'POST' });
    await handleHousekeeping(req, env);
  },
};

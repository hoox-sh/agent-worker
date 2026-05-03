const startTime = Date.now();

export async function handleHealth(_request: Request): Promise<Response> {
  return new Response(
    JSON.stringify({
      status: 'ok',
      service: 'agent-worker',
      timestamp: new Date().toISOString(),
      uptime: Date.now() - startTime,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}

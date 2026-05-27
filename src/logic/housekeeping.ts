import { toError } from "@jango-blockchained/hoox-shared/errors";
import { KVKeys } from "@jango-blockchained/hoox-shared/kvKeys";
import { serviceFetch } from "@jango-blockchained/hoox-shared/service-bindings";

/**
 * Runs system-wide housekeeping checks.
 */
export async function runHousekeeping(
  env: any,
  logger: any
): Promise<Record<string, unknown>> {
  const results: {
    timestamp: string;
    checks: Array<{ service: string; status: string; detail: unknown }>;
  } = {
    timestamp: new Date().toISOString(),
    checks: [],
  };

  try {
    // CONFIG_KV write/read test
    await env.CONFIG_KV.put(KVKeys.KV_HEALTH_CHECK, new Date().toISOString());
    const kvTest = await env.CONFIG_KV.get(KVKeys.KV_HEALTH_CHECK);
    results.checks.push({
      service: "CONFIG_KV",
      status: "ok",
      detail: kvTest ? "readable" : "empty",
    });

    if (env.D1_SERVICE) {
      try {
        const d1Res = await serviceFetch(env.D1_SERVICE, "/health", undefined, {
          method: "GET",
        });
        results.checks.push({
          service: "D1_SERVICE",
          status: d1Res.ok ? "ok" : "error",
          detail: d1Res.status,
        });
      } catch (error: unknown) {
        results.checks.push({
          service: "D1_SERVICE",
          status: "error",
          detail: String(error),
        });
      }
    }

    if (env.TRADE_SERVICE) {
      try {
        const tradeRes = await serviceFetch(
          env.TRADE_SERVICE,
          "/health",
          undefined,
          { method: "GET" }
        );
        results.checks.push({
          service: "TRADE_SERVICE",
          status: tradeRes.ok ? "ok" : "error",
          detail: tradeRes.status,
        });
      } catch (error: unknown) {
        results.checks.push({
          service: "TRADE_SERVICE",
          status: "error",
          detail: String(error),
        });
      }
    }

    if (env.TELEGRAM_SERVICE) {
      try {
        const tgRes = await serviceFetch(
          env.TELEGRAM_SERVICE,
          "/health",
          undefined,
          { method: "GET" }
        );
        results.checks.push({
          service: "TELEGRAM_SERVICE",
          status: tgRes.ok ? "ok" : "error",
          detail: tgRes.status,
        });
      } catch (error: unknown) {
        results.checks.push({
          service: "TELEGRAM_SERVICE",
          status: "error",
          detail: String(error),
        });
      }
    }

    await env.CONFIG_KV.put(
      KVKeys.KV_HOUSEKEEPING_LAST_CHECK,
      JSON.stringify(results)
    );
    logger.info("Housekeeping check completed", { results });
  } catch (error: unknown) {
    logger.error("Housekeeping check failed", { error: toError(error) });
    throw error;
  }

  return results;
}

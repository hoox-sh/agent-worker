import { toError } from "@jango-blockchained/hoox-shared/errors";
import { KVKeys } from "@jango-blockchained/hoox-shared/kvKeys";
import { serviceFetch } from "@jango-blockchained/hoox-shared/service-bindings";
import { trackAnalytics } from "@jango-blockchained/hoox-shared/analytics";
import type { Logger } from "@jango-blockchained/hoox-shared/middleware";

// --- Minimal env interface for runHousekeeping ---
export interface HousekeepingEnv {
  CONFIG_KV: KVNamespace;
  D1_SERVICE?: Fetcher;
  TRADE_SERVICE?: Fetcher;
  TELEGRAM_SERVICE?: Fetcher;
  ANALYTICS_SERVICE?: Fetcher;
}

type ServiceCheck = {
  service: string;
  status: string;
  detail: unknown;
};

async function checkServiceHealth(
  service: string,
  fetcher: Fetcher
): Promise<ServiceCheck> {
  try {
    const res = await serviceFetch(fetcher, "/health", undefined, {
      method: "GET",
    });
    return {
      service,
      status: res.ok ? "ok" : "error",
      detail: res.status,
    };
  } catch (error: unknown) {
    return {
      service,
      status: "error",
      detail: String(error),
    };
  }
}

/**
 * Runs system-wide housekeeping checks.
 */
export async function runHousekeeping(
  env: HousekeepingEnv,
  logger: Logger
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

    const serviceChecks = await Promise.all(
      (
        [
          env.D1_SERVICE
            ? checkServiceHealth("D1_SERVICE", env.D1_SERVICE)
            : null,
          env.TRADE_SERVICE
            ? checkServiceHealth("TRADE_SERVICE", env.TRADE_SERVICE)
            : null,
          env.TELEGRAM_SERVICE
            ? checkServiceHealth("TELEGRAM_SERVICE", env.TELEGRAM_SERVICE)
            : null,
        ] as Array<Promise<ServiceCheck> | null>
      ).filter((check): check is Promise<ServiceCheck> => check !== null)
    );
    results.checks.push(...serviceChecks);

    await env.CONFIG_KV.put(
      KVKeys.KV_HOUSEKEEPING_LAST_CHECK,
      JSON.stringify(results)
    );
    logger.info("Housekeeping check completed", { results });

    // Non-blocking analytics tracking (fire-and-forget, errors handled internally)
    void trackAnalytics(env, "/track/housekeeping", {
      worker: "agent-worker",
      checks: results.checks.length,
      healthy: results.checks.filter((c) => c.status === "ok").length,
      unhealthy: results.checks.filter((c) => c.status !== "ok").length,
    });
  } catch (error: unknown) {
    logger.error("Housekeeping check failed", { error: toError(error) });
    throw error;
  }

  return results;
}

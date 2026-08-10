/**
 * Copyright (c) 2026 HOOX · HOOX · jango-blockchained (hoox-sh)
 * SPDX-License-Identifier: Apache-2.0
 */

import { toError } from "@hoox-sh/hoox-shared/errors";
import { KVKeys } from "@hoox-sh/hoox-shared/kvKeys";
import {
  authenticatedServiceFetch,
  serviceFetch,
  TRADE_EXECUTE_AUTH_KEY_FIELDS,
  resolveInternalAuthKey,
} from "@hoox-sh/hoox-shared/service-bindings";
import { trackAnalytics } from "@hoox-sh/hoox-shared/analytics";
import type { Logger } from "@hoox-sh/hoox-shared/middleware";

// --- Minimal env interface for runHousekeeping ---
export interface HousekeepingEnv {
  CONFIG_KV: KVNamespace;
  D1_SERVICE?: Fetcher;
  TRADE_SERVICE?: Fetcher;
  TELEGRAM_SERVICE?: Fetcher;
  ANALYTICS_SERVICE?: Fetcher;
  INTERNAL_KEY_BINDING?: string;
  TRADE_EXECUTE_KEY_BINDING?: string;
  AGENT_INTERNAL_KEY?: string;
  [key: string]: unknown;
}

type ServiceCheck = {
  service: string;
  status: string;
  detail: unknown;
};

const HEALTH_CHECK_TIMEOUT_MS = 5000;

async function checkServiceHealth(
  service: string,
  fetcher: Fetcher
): Promise<ServiceCheck> {
  try {
    const res = await Promise.race([
      serviceFetch(fetcher, "/health", undefined, {
        method: "GET",
      }),
      new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(`Health check timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`)
            ),
          HEALTH_CHECK_TIMEOUT_MS
        );
      }),
    ]);
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

    // Exchange ↔ D1 position reconciliation (mitigates waitUntil ledger lag)
    let reconcile: unknown = null;
    if (env.TRADE_SERVICE) {
      if (!resolveInternalAuthKey(env, TRADE_EXECUTE_AUTH_KEY_FIELDS)) {
        results.checks.push({
          service: "position_reconcile",
          status: "skipped",
          detail: "trade execute auth key not configured",
        });
      } else {
        try {
          const res = await authenticatedServiceFetch(
            env.TRADE_SERVICE,
            env,
            "/api/positions/reconcile",
            { dryRun: false },
            {
              method: "POST",
              internalKeyFields: TRADE_EXECUTE_AUTH_KEY_FIELDS,
              timeout: 25_000,
            }
          );
          const body = (await res.json().catch(() => null)) as unknown;
          reconcile = body;
          results.checks.push({
            service: "position_reconcile",
            status: res.ok ? "ok" : "error",
            detail: res.ok
              ? (body as { result?: { totals?: unknown } })?.result?.totals ??
                res.status
              : res.status,
          });
        } catch (error: unknown) {
          logger.warn("Position reconcile failed during housekeeping", {
            error: toError(error),
          });
          results.checks.push({
            service: "position_reconcile",
            status: "error",
            detail: toError(error),
          });
        }
      }
    }

    const payload = { ...results, reconcile };
    await env.CONFIG_KV.put(
      KVKeys.KV_HOUSEKEEPING_LAST_CHECK,
      JSON.stringify(payload)
    );
    logger.info("Housekeeping check completed", { results: payload });

    // Non-blocking analytics tracking (fire-and-forget, errors handled internally)
    void trackAnalytics(env, "/track/housekeeping", {
      worker: "agent-worker",
      checks: results.checks.length,
      healthy: results.checks.filter((c) => c.status === "ok").length,
      unhealthy: results.checks.filter((c) => c.status !== "ok").length,
    });

    return payload;
  } catch (error: unknown) {
    logger.error("Housekeeping check failed", { error: toError(error) });
    throw error;
  }
}

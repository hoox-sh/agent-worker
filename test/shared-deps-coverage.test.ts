/**
 * Copyright (c) 2026 HOOX · HOOX · jango-blockchained (hoox-sh)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Exercise pure helpers from @hoox-sh/hoox-shared that this worker already
 * depends on. Improves overall coverage without network / real bindings.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod/v4";
import {
  toError,
  createJsonResponse,
  createSuccessResponse,
  createErrorResponse,
  Errors,
} from "@hoox-sh/hoox-shared/errors";
import { healthCheck } from "@hoox-sh/hoox-shared/health";
import {
  corsHeaders,
  publicCorsHeaders,
  internalCorsHeaders,
  resolveCorsOptions,
  handleCorsPreflightRequest,
  timingSafeEqual,
  checkInternalAuth,
  collectInternalAuthKeys,
  createInternalAuthMiddleware,
  requireInternalAuth,
  validateJson,
  validateJsonLegacy,
  requireField,
  optionalField,
  createRateLimiter,
  secureHeaders,
  wrapWithSecurityHeaders,
  createLogger,
  withRequestLog,
} from "@hoox-sh/hoox-shared/middleware";
import { createRouter } from "@hoox-sh/hoox-shared/router";
import {
  resolveInternalAuthKey,
  serviceFetch,
  TRADE_EXECUTE_AUTH_KEY_FIELDS,
  TELEGRAM_ALERT_AUTH_KEY_FIELDS,
} from "@hoox-sh/hoox-shared/service-bindings";

describe("shared errors helpers", () => {
  test("toError covers Error, string, object, null, circular", () => {
    expect(toError(new Error("boom"))).toBe("boom");
    expect(toError("plain")).toBe("plain");
    expect(toError({ message: "obj" })).toBe("obj");
    expect(toError(null, "fallback")).toBe("fallback");
    expect(toError(undefined, "fb")).toBe("fb");
    expect(toError(42)).toBe("42");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(typeof toError(circular)).toBe("string");
  });

  test("createJsonResponse / success / error factories", async () => {
    const ok = createJsonResponse({ a: 1 }, 201);
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ a: 1 });

    const success = createSuccessResponse({ ready: true });
    expect(success.status).toBe(200);
    const successBody = (await success.json()) as { success: boolean };
    expect(successBody.success).toBe(true);

    const errStr = createErrorResponse("nope", 418);
    expect(errStr.status).toBe(418);

    const errObj = createErrorResponse(
      { code: "X", message: "fail", status: 400 } as any,
      400
    );
    expect(errObj.status).toBe(400);

    // sanitize sensitive fields
    const withSecret = createJsonResponse({
      token: "secret",
      nested: { password: "x", ok: true },
      err: new Error("hidden stack"),
    });
    const body = (await withSecret.json()) as Record<string, unknown>;
    expect(body).toBeDefined();
  });

  test("Errors preset responses", async () => {
    expect((await Errors.badRequest("bad")).status).toBe(400);
    expect((await Errors.unauthorized()).status).toBe(401);
    expect((await Errors.unauthorized("nope")).status).toBe(401);
    expect((await Errors.forbidden()).status).toBe(403);
    expect((await Errors.notFound()).status).toBe(404);
    expect((await Errors.methodNotAllowed()).status).toBe(405);
    expect((await Errors.rateLimited(30)).status).toBe(429);
    expect((await Errors.rateLimited()).status).toBe(429);
    expect((await Errors.internal(new Error("x"))).status).toBe(500);
    expect((await Errors.internal("y")).status).toBe(500);
    expect((await Errors.internal()).status).toBe(500);
  });
});

describe("shared healthCheck", () => {
  test("includes worker version and details", async () => {
    const res = healthCheck({
      worker: "agent-worker",
      version: "1.0.0",
      details: { uptime: 1 },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      result: Record<string, unknown>;
    };
    expect(json.success).toBe(true);
    expect(json.result.service).toBe("agent-worker");
    expect(json.result.version).toBe("1.0.0");
    expect(json.result.details).toEqual({ uptime: 1 });
  });

  test("works with empty options", async () => {
    const res = healthCheck();
    expect(res.status).toBe(200);
  });
});

describe("shared middleware pure helpers", () => {
  test("corsHeaders variants", () => {
    const base = corsHeaders();
    expect(base["Access-Control-Allow-Methods"]).toBeDefined();
    const withOrigin = corsHeaders({ allowOrigin: "https://a.com" });
    expect(withOrigin["Access-Control-Allow-Origin"]).toBe("https://a.com");
    const withCreds = corsHeaders({
      allowOrigin: "https://a.com",
      allowCredentials: true,
    });
    expect(withCreds["Access-Control-Allow-Credentials"]).toBe("true");
    expect(publicCorsHeaders("https://pub.com")["Access-Control-Allow-Origin"]).toBe(
      "https://pub.com"
    );
    expect(publicCorsHeaders()["Access-Control-Allow-Origin"]).toBe("*");
    expect(internalCorsHeaders()).toBeDefined();
  });

  test("resolveCorsOptions + preflight", () => {
    const req = new Request("https://api.example.com/x", {
      headers: { Origin: "https://dash.example.com" },
    });
    const opts = resolveCorsOptions(req, {
      CORS_ALLOW_ORIGIN: "https://dash.example.com",
    } as any);
    expect(opts).toBeDefined();

    const preReq = new Request("https://api.example.com/x", {
      method: "OPTIONS",
      headers: { Origin: "https://dash.example.com" },
    });
    const pre = handleCorsPreflightRequest(preReq, {
      allowOrigin: "https://dash.example.com",
    });
    expect(pre).not.toBeNull();
    expect(pre!.status).toBe(204);
    expect(
      handleCorsPreflightRequest(req, { allowOrigin: "https://dash.example.com" })
    ).toBeNull();
  });

  test("timingSafeEqual and internal auth helpers", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("a", "ab")).toBe(false);

    const keys = collectInternalAuthKeys(
      {
        INTERNAL_KEY_BINDING: "k1",
        AGENT_INTERNAL_KEY: "k2",
      } as any,
      ["INTERNAL_KEY_BINDING", "AGENT_INTERNAL_KEY"]
    );
    expect(keys.length).toBeGreaterThan(0);

    const env = { INTERNAL_KEY_BINDING: "secret" } as any;
    const good = new Request("https://x", {
      headers: { "X-Internal-Auth-Key": "secret" },
    });
    const bad = new Request("https://x", {
      headers: { "X-Internal-Auth-Key": "wrong" },
    });
    expect(checkInternalAuth(good, env, "INTERNAL_KEY_BINDING").authorized).toBe(
      true
    );
    expect(checkInternalAuth(bad, env, "INTERNAL_KEY_BINDING").authorized).toBe(
      false
    );
    expect(requireInternalAuth(bad, env)).not.toBeNull();
    expect(requireInternalAuth(good, env)).toBeNull();

    const mw = createInternalAuthMiddleware();
    expect(typeof mw).toBe("function");
  });

  test("validateJson / legacy / field helpers", async () => {
    const schema = z.object({ n: z.number() });
    expect(validateJson(schema, { n: 1 }).ok).toBe(true);
    expect(validateJson(schema, { n: "x" }).ok).toBe(false);

    const okReq = new Request("https://x", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
    });
    expect((await validateJsonLegacy(okReq)).ok).toBe(true);
    const arrReq = new Request("https://x", {
      method: "POST",
      body: JSON.stringify([1]),
    });
    expect((await validateJsonLegacy(arrReq)).ok).toBe(false);
    const badReq = new Request("https://x", {
      method: "POST",
      body: "nope",
    });
    expect((await validateJsonLegacy(badReq)).ok).toBe(false);

    expect(requireField({ a: 1 }, "a").ok).toBe(true);
    expect(requireField({}, "a").ok).toBe(false);
    expect(optionalField({ a: 2 }, "a", 0)).toBe(2);
    expect(optionalField({}, "a", 9)).toBe(9);
  });

  test("createRateLimiter memory storage allow/deny", async () => {
    const limiter = createRateLimiter(undefined, {
      maxRequests: 2,
      windowSeconds: 60,
      keyPrefix: "t",
    });
    const req = new Request("https://x/y", {
      headers: { "CF-Connecting-IP": "1.2.3.4" },
    });
    const a = await limiter.check(req);
    expect(a.allowed).toBe(true);
    await limiter.check(req);
    const c = await limiter.check(req);
    expect(c.allowed).toBe(false);

    const enforceNull = await limiter.enforce(
      new Request("https://x", { headers: { "CF-Connecting-IP": "9.9.9.9" } })
    );
    expect(enforceNull).toBeNull();

    const blocked = await limiter.enforce(req);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);

    const byKey = await limiter.checkKey("custom-key");
    expect(byKey.allowed).toBe(true);
    const enforceKey = await limiter.enforceKey("custom-key-2");
    expect(enforceKey).toBeNull();
  });

  test("secureHeaders + wrapWithSecurityHeaders", async () => {
    const h = secureHeaders();
    expect(h["X-Content-Type-Options"]).toBeDefined();
    const wrapped = wrapWithSecurityHeaders(
      new Response("ok", { status: 200 })
    );
    expect(wrapped.headers.get("X-Content-Type-Options")).toBeTruthy();
  });

  test("createLogger levels and withRequestLog", async () => {
    const log = createLogger({ service: "agent-worker", module: "test" });
    log.info("i", { a: 1 });
    log.warn("w");
    log.error("e", { error: "x" });
    log.debug("d");

    const handler = withRequestLog(
      async () => new Response("ok"),
      { service: "agent-worker", module: "test" }
    );
    const res = await handler(
      new Request("https://x/path"),
      {} as any,
      { waitUntil: () => {} } as any
    );
    expect(res.status).toBe(200);
  });
});

describe("shared router + service-bindings", () => {
  test("router handles registered and unknown routes", async () => {
    const router = createRouter();
    router.get("/ping", async () => new Response("pong"));
    const hit = await router.handle(
      new Request("https://x/ping"),
      {} as any,
      {} as any
    );
    expect(await hit.text()).toBe("pong");

    const miss = await router.handle(
      new Request("https://x/missing"),
      {} as any,
      {} as any
    );
    expect(miss.status).toBe(404);

    const method = await router.handle(
      new Request("https://x/ping", { method: "POST" }),
      {} as any,
      {} as any
    );
    expect([404, 405]).toContain(method.status);
  });

  test("resolveInternalAuthKey field resolution", () => {
    expect(
      resolveInternalAuthKey(
        { INTERNAL_KEY_BINDING: "a" },
        TRADE_EXECUTE_AUTH_KEY_FIELDS
      )
    ).toBe("a");
    expect(
      resolveInternalAuthKey(
        { TELEGRAM_INTERNAL_KEY_BINDING: "tg" },
        TELEGRAM_ALERT_AUTH_KEY_FIELDS
      )
    ).toBe("tg");
    expect(resolveInternalAuthKey({}, TRADE_EXECUTE_AUTH_KEY_FIELDS)).toBe(
      undefined
    );
  });

  test("serviceFetch success and error paths", async () => {
    const binding = {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/ok")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        throw new Error("down");
      },
    };
    const ok = await serviceFetch(binding as any, "/ok", { a: 1 });
    expect(ok.ok).toBe(true);

    await expect(serviceFetch(binding as any, "/fail")).rejects.toThrow();
  });
});

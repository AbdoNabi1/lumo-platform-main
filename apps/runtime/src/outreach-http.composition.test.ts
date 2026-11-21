import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createAdminHttpApi } from "@platform/admin";
import { RoleTableAccessControl } from "@platform/auth";
import type { Cache, IdempotencyKeyStore, RateLimiter } from "@platform/contracts";
import { JsonEventSerializer } from "@platform/domain-events";
import { createMetaFetchHarness } from "@platform/outreach/testing";
import { buildRuntimeCore } from "./composition";
import { loadRuntimeConfig } from "./config";

/**
 * Runtime → HTTP: the SAME `outreach` value `startApi` forwards into `createAdminHttpApi` (`core.outreach`, built from
 * the environment by `outreachReadiness`), driven through the real routes. Only persistence is in-memory (no database
 * in the test) and HTTP to Meta goes through a recording fake fetch — never the network.
 */
const baseEnv = {
  APP_ENV: "local",
  DATABASE_URL: "postgresql://lumo:***@localhost:5432/lumo",
  REDIS_URL: "redis://localhost:6379",
  KAFKA_BROKERS: "localhost:19092",
  AUTH_ISSUER_URL: "https://auth.morbeh.local",
  AUTH_JWKS_URL: "https://auth.morbeh.local/.well-known/jwks.json",
  KETO_WRITE_URL: "https://keto.morbeh.local:4467",
  KRATOS_PUBLIC_URL: "https://kratos.morbeh.local:4433",
  KRATOS_ADMIN_URL: "https://kratos.morbeh.local:4434",
} as NodeJS.ProcessEnv;
const whatsappEnv = {
  META_APP_ID: "1234567890",
  META_APP_SECRET: "s".repeat(16),
  META_WHATSAPP_CONFIG_ID: "cfg-1",
  META_WEBHOOK_VERIFY_TOKEN: "v".repeat(16),
  OUTREACH_CREDENTIALS_KEK_REF: "k".repeat(32),
} as NodeJS.ProcessEnv;

const SHOP = "t-1";
const headers = { authorization: "Bearer admin", "x-tenant-id": SHOP };

const apps: FastifyInstance[] = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});

async function boot(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch) {
  const core = buildRuntimeCore(loadRuntimeConfig({ ...baseEnv, ...env }), {
    outreachFetch: fetchImpl,
  });
  const cacheData = new Map<string, unknown>();
  const cache: Cache = {
    get: <T>(key: string) => Promise.resolve((cacheData.get(key) as T | undefined) ?? null),
    set: (key, value) => {
      cacheData.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => {
      cacheData.delete(key);
      return Promise.resolve();
    },
    has: (key) => Promise.resolve(cacheData.has(key)),
  };
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: (key) => Promise.resolve({ key, token: "t", release: () => Promise.resolve(true) }),
  };
  const rateLimiter: RateLimiter = {
    consume: () => Promise.resolve({ allowed: true, remaining: 99, retryAfterMs: 0 }),
  };
  const app = await createAdminHttpApi({
    serializer: new JsonEventSerializer(),
    idGenerator: core.idGenerator,
    clock: core.clock,
    accessControl: new RoleTableAccessControl(),
    authenticator: {
      verify: (token) =>
        Promise.resolve(
          token === "admin" ? { id: "admin-1", kind: "staff", roles: ["admin"] } : null,
        ),
    },
    rateLimiter,
    idempotencyKeys,
    responseCache: cache,
    tenantId: SHOP,
    outreach: core.outreach,
  });
  apps.push(app);
  return { app, core };
}

describe("runtime → HTTP: Outreach composition", () => {
  it("configured env: POST /outreach/whatsapp/connect reaches the Meta port over the injected fetch", async () => {
    expect.hasAssertions();
    const harness = createMetaFetchHarness([
      { status: 200, json: { access_token: "tok-secret-1" } },
      { status: 200, json: { data: [{ id: "1001" }] } },
      { status: 200, json: { success: true } },
      { status: 200, json: { success: true } },
      {
        status: 200,
        json: {
          id: "1001",
          display_phone_number: "+20 101 234 5678",
          verified_name: "Shop",
          quality_rating: "GREEN",
          whatsapp_business_manager_messaging_limit: "TIER_250",
        },
      },
    ]);
    const { app, core } = await boot(whatsappEnv, harness.fetchImpl);
    expect(core.outreach.whatsapp).toBeDefined();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/outreach/whatsapp/connect",
      headers: { ...headers, "idempotency-key": "connect-1" },
      payload: { code: "auth-code", wabaId: "2002", phoneNumberId: "1001" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string; messagingLimitTier: string }>()).toMatchObject({
      status: "connected",
      messagingLimitTier: "TIER_250",
    });
    expect(harness.calls).toHaveLength(5);
    expect(harness.calls.every((c) => c.url.startsWith("https://graph.facebook.com/v24.0/"))).toBe(
      true,
    );
    // The merchant token is never echoed back.
    expect(res.body).not.toContain("tok-secret-1");

    const status = await app.inject({ method: "GET", url: "/api/v1/outreach/whatsapp", headers });
    expect(status.json<{ available: boolean; signup: unknown }>()).toMatchObject({
      available: true,
      signup: { appId: "1234567890", configId: "cfg-1", graphApiVersion: "v24.0" },
    });
  });

  it("unconfigured env: GET /outreach/whatsapp is available:false and connect is WHATSAPP_NOT_CONFIGURED with zero fetches", async () => {
    expect.hasAssertions();
    const harness = createMetaFetchHarness([]);
    const { app, core } = await boot({}, harness.fetchImpl);
    expect(core.outreach.whatsapp).toBeUndefined();
    expect(core.outreach.vault).toBeUndefined();

    const status = await app.inject({ method: "GET", url: "/api/v1/outreach/whatsapp", headers });
    expect(status.json<Record<string, unknown>>()).toMatchObject({ available: false });
    expect(Object.keys(status.json<Record<string, unknown>>())).not.toContain("signup");

    const connect = await app.inject({
      method: "POST",
      url: "/api/v1/outreach/whatsapp/connect",
      headers: { ...headers, "idempotency-key": "connect-2" },
      payload: { code: "auth-code", wabaId: "2002", phoneNumberId: "1001" },
    });
    expect(connect.statusCode).toBe(409);
    expect(connect.json()).toMatchObject({ code: "CONFLICT", message: "WHATSAPP_NOT_CONFIGURED" });
    expect(harness.calls).toHaveLength(0);

    const delivery = await app.inject({
      method: "POST",
      url: "/api/v1/public/outreach/whatsapp/webhook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=" + "0".repeat(64),
      },
      payload: "{}",
    });
    expect(delivery.statusCode).toBe(401);
  });

  it("buildRuntimeCore always exposes the recovery wiring and tenant listing, whatever the readiness", () => {
    expect.hasAssertions();
    const core = buildRuntimeCore(loadRuntimeConfig({ ...baseEnv }));
    expect(typeof core.outreachRecovery?.reconcileUnresolved).toBe("function");
    expect(typeof core.listTenants.execute).toBe("function");
    expect(core.outreach.emailCaps).toEqual({ perHour: 200, perDay: 2000 });
  });
});

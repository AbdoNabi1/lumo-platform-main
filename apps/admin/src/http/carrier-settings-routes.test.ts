import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  Authenticator,
  Cache,
  Clock,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { RoleTableAccessControl } from "@platform/auth";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryCarrierCredentialVault } from "@platform/shipping";
import { fakeRegistration } from "@platform/shipping/testing";
import { InMemoryAuditTrail } from "../infrastructure/in-memory-audit-trail";
import { createAdminHttpApi } from "./server";

beforeEach(() => {
  expect.hasAssertions();
});

const clock: Clock = { now: () => new Date("2026-11-12T00:00:00.000Z") };
const authed = {
  authorization: "Bearer admin",
  "x-tenant-id": "t-1",
  "content-type": "application/json",
};
const operator = { ...authed, authorization: "Bearer operator" };
const otherTenant = { ...authed, "x-tenant-id": "t-2" };
const registration = fakeRegistration().registration;
const webhookSecret = "stored-webhook-secret-test-value";

function buildApp(reject = false): Promise<FastifyInstance> {
  const claims = new Set<string>();
  const cacheData = new Map<string, unknown>();
  const cache: Cache = {
    get: <T>(key: string) => Promise.resolve((cacheData.get(key) as T | undefined) ?? null),
    set: (key, value) => {
      cacheData.set(key, JSON.parse(JSON.stringify(value)));
      return Promise.resolve();
    },
    delete: (key) => {
      cacheData.delete(key);
      return Promise.resolve();
    },
    has: (key) => Promise.resolve(cacheData.has(key)),
  };
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: (key) => {
      if (claims.has(key)) return Promise.resolve(null);
      claims.add(key);
      return Promise.resolve({
        key,
        token: "t",
        release: () => Promise.resolve(claims.delete(key)),
      });
    },
  };
  const rateLimiter: RateLimiter = {
    consume: () => Promise.resolve({ allowed: true, remaining: 99, retryAfterMs: 0 }),
  };
  const authenticator: Authenticator = {
    verify: (token) =>
      Promise.resolve(
        token === "admin" || token === "operator"
          ? { id: token, kind: "staff", roles: [token] }
          : null,
      ),
  };
  return createAdminHttpApi({
    serializer: new InMemoryEventSerializer(),
    idGenerator: { generate: () => crypto.randomUUID() },
    clock,
    auditTrail: new InMemoryAuditTrail(),
    authenticator,
    accessControl: new RoleTableAccessControl(),
    rateLimiter,
    idempotencyKeys,
    responseCache: cache,
    carrierRegistrations: [
      reject
        ? fakeRegistration({ script: { verify: "credentials_rejected" } }).registration
        : registration,
    ],
    carrierCredentialVault: new InMemoryCarrierCredentialVault(),
    randomSecret: () => webhookSecret,
  });
}

let keys = 0;
function put(
  app: FastifyInstance,
  key: string,
  payload: Record<string, unknown>,
  headers = authed,
) {
  keys += 1;
  return app.inject({
    method: "PUT",
    url: `/api/v1/shipping/carriers/${key}`,
    headers: { ...headers, "idempotency-key": `carrier-${keys}` },
    payload,
  });
}
function get(app: FastifyInstance, suffix = "", headers = authed) {
  return app.inject({ method: "GET", url: `/api/v1/shipping/carriers${suffix}`, headers });
}

describe("carrier settings routes", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("PUT stores, GET never returns credentials or the webhook secret", async () => {
    const saved = await put(app, "bosta", {
      credentials: { apiKey: "bosta-key-123" },
      enabled: true,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain("bosta-key-123");
    expect(saved.body).not.toContain(webhookSecret);
    const listed = await get(app);
    expect(listed.statusCode).toBe(200);
    expect(listed.body).not.toContain("bosta-key-123");
    expect(listed.body).not.toContain(webhookSecret);
    expect(listed.json()).toMatchObject({
      carriers: [{ key: "bosta", configured: true, enabled: true }],
    });
  });

  it("GET returns the webhook URL", async () => {
    const res = await get(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      carriers: [{ key: "bosta", webhookUrl: registration.webhookUrl }],
    });
  });

  it("rejects malformed or unsupported bodies", async () => {
    for (const body of [
      { credentials: { apiKey: "a".repeat(513) } },
      {},
      { disconnect: true, enabled: true },
      { cod: 1 },
    ]) {
      expect((await put(app, "bosta", body)).statusCode).toBe(400);
    }
  });

  it("rejects unknown or malformed carrier keys", async () => {
    const unknown = await put(app, "aramex", { enabled: true });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json()).toMatchObject({ code: "CARRIER_UNKNOWN" });
    expect((await put(app, "Bad%20Key", { enabled: true })).statusCode).toBe(400);
  });

  it("tenant t-2 reads its own empty settings", async () => {
    const res = await get(app, "", otherTenant);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      version: 0,
      carriers: [{ key: "bosta", configured: false }],
    });
  });

  it("enabled lists only enabled carriers and no config", async () => {
    const res = await get(app, "/enabled");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      carriers: [{ key: "bosta", displayName: registration.displayName }],
    });
    expect(
      Object.keys((res.json() as { carriers: Record<string, unknown>[] }).carriers[0] ?? {}).sort(),
    ).toEqual(["displayName", "key"]);
  });

  it("operators cannot read or change settings but may list enabled carriers", async () => {
    expect((await get(app, "", operator)).statusCode).toBe(403);
    expect((await put(app, "bosta", { enabled: false }, operator)).statusCode).toBe(403);
    expect((await get(app, "/enabled", operator)).statusCode).toBe(200);
  });

  it("rotates the webhook secret without exposing either secret", async () => {
    keys += 1;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/shipping/carriers/bosta/webhook-secret",
      headers: { ...authed, "idempotency-key": `carrier-${keys}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(webhookSecret);
    expect(res.body).not.toContain("bosta-key-123");
  });
});

describe("carrier settings rejected credentials", () => {
  it("returns 409 CARRIER_CREDENTIALS_REJECTED", async () => {
    const app = await buildApp(true);
    try {
      const res = await put(app, "bosta", { credentials: { apiKey: "bad" }, enabled: true });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: "CARRIER_CREDENTIALS_REJECTED" });
    } finally {
      await app.close();
    }
  });
});

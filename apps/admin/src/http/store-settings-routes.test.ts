import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  AccessControl,
  Authenticator,
  AuthenticatedIdentity,
  Cache,
  Clock,
  IdGenerator,
  IdempotencyClaim,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryAuditTrail } from "../infrastructure/in-memory-audit-trail";
import { createAdminHttpApi } from "./server";

/**
 * Plan 3C — Settings → General: `GET`/`PUT /store/settings` (staff, `settings:read`/`settings:update`)
 * and the public `GET /public/store` (name and currency only). Changing the currency relabels the
 * shop's variants without touching their amounts. Drives the real HTTP stack.
 */

const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const clock: Clock = { now: () => new Date("2026-10-11T00:00:00.000Z") };
const authed = {
  authorization: "Bearer good",
  "x-tenant-id": "t-1",
  "content-type": "application/json",
};

function buildApp(accessControl?: AccessControl): Promise<FastifyInstance> {
  const claims = new Set<string>();
  const store = new Map<string, unknown>();
  const cache: Cache = {
    get: async <T>(k: string) => (store.get(k) as T | undefined) ?? null,
    set: async (k, v) => void store.set(k, JSON.parse(JSON.stringify(v))),
    delete: async (k) => void store.delete(k),
    has: async (k) => store.has(k),
  };
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: async (key): Promise<IdempotencyClaim | null> => {
      if (claims.has(key)) return null;
      claims.add(key);
      return { key, token: "t", release: async () => claims.delete(key) };
    },
  };
  const rateLimiter: RateLimiter = {
    consume: async () => ({ allowed: true, remaining: 99, retryAfterMs: 0 }),
  };
  const authenticator: Authenticator = {
    verify: async (token) => (token === "good" ? staff : null),
  };
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => crypto.randomUUID() + `-${(n += 1)}` };
  return createAdminHttpApi({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    auditTrail: new InMemoryAuditTrail(),
    authenticator,
    rateLimiter,
    idempotencyKeys,
    responseCache: cache,
    ...(accessControl === undefined ? {} : { accessControl }),
  });
}

const settings = {
  storeName: "Lumo",
  contactEmail: "hello@lumo.test",
  currency: "SAR",
  timezone: "Asia/Riyadh",
  weightUnit: "g",
};

let keyCounter = 0;
function put(app: FastifyInstance, payload: Record<string, unknown>, headers = authed) {
  keyCounter += 1;
  return app.inject({
    method: "PUT",
    url: "/api/v1/store/settings",
    headers: { ...headers, "idempotency-key": `settings-${keyCounter}` },
    payload,
  });
}

describe("store settings API (Plan 3C)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("answers the defaults before anything is saved", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/store/settings", headers: authed });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      storeName: "",
      contactEmail: null,
      currency: "EGP",
      timezone: "Africa/Cairo",
      weightUnit: "kg",
    });
  });

  it("saves and reads back, and the public route shows only name and currency", async () => {
    const saved = await put(app, settings);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual(settings);

    const read = await app.inject({
      method: "GET",
      url: "/api/v1/store/settings",
      headers: authed,
    });
    expect(read.json()).toEqual(settings);

    const pub = await app.inject({
      method: "GET",
      url: "/api/v1/public/store",
      headers: { "x-tenant-id": "t-1" },
    });
    expect(pub.statusCode).toBe(200);
    expect(pub.json()).toEqual({ name: "Lumo", currency: "SAR" });
  });

  it("rejects an invalid currency with 422 and keeps the saved settings", async () => {
    const res = await put(app, { ...settings, currency: "XXX" });
    expect(res.statusCode).toBe(422);
    const pub = await app.inject({
      method: "GET",
      url: "/api/v1/public/store",
      headers: { "x-tenant-id": "t-1" },
    });
    expect(pub.json()).toEqual({ name: "Lumo", currency: "SAR" });
  });

  it("relabels the variants to the new currency and keeps their amounts", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      headers: authed,
      payload: {
        sku: "REL-1",
        name: "Relabel me",
        slug: "relabel-me",
        variants: [{ sku: "REL-1-V1", priceAmountMinor: 12_500, currency: "USD" }],
      },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;

    expect((await put(app, { ...settings, currency: "AED" })).statusCode).toBe(200);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/products/${id}`,
      headers: authed,
    });
    const variant = (
      detail.json() as { variants: { priceAmountMinor: number; currency: string }[] }
    ).variants[0];
    expect(variant).toMatchObject({ priceAmountMinor: 12_500, currency: "AED" });
  });
});

describe("store settings API — permissions (Plan 3C)", () => {
  function denying(...denied: string[]): AccessControl {
    return { authorize: async (_principal, permission) => !denied.includes(permission) };
  }

  it("refuses a read without settings:read and a write without settings:update", async () => {
    const app = await buildApp(denying("settings:read", "settings:update"));
    try {
      const read = await app.inject({
        method: "GET",
        url: "/api/v1/store/settings",
        headers: authed,
      });
      expect(read.statusCode).toBe(403);
      const write = await put(app, settings);
      expect(write.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("lets a reader read but not write", async () => {
    const app = await buildApp(denying("settings:update"));
    try {
      const read = await app.inject({
        method: "GET",
        url: "/api/v1/store/settings",
        headers: authed,
      });
      expect(read.statusCode).toBe(200);
      expect((await put(app, settings)).statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("serves the public store route with no credentials at all", async () => {
    const app = await buildApp(denying("settings:read", "settings:update", "tenancy:read"));
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/public/store",
        headers: { "x-tenant-id": "t-1" },
      });
      expect(res.statusCode).toBe(200);
      expect(Object.keys(res.json() as object).sort()).toEqual(["currency", "name"]);
    } finally {
      await app.close();
    }
  });
});

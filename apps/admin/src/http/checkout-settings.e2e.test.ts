import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  AuthenticatedContext,
  AuthenticatedIdentity,
  Cache,
  ClaimsAuthenticator,
  Clock,
  IdempotencyClaim,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { createAdminHttpApi } from "./server";

/**
 * Wave 2a (D33/D34): the shop's checkout and customer-account switches, driven over the REAL admin
 * pipeline (`createAdminHttpApi`, multi-tenant, real tenant resolvers and error mapping) exactly as
 * the storefront and the admin page would. Every rule is shown twice: at its DEFAULT (today's
 * behaviour, unchanged) and switched on (refused by the server, whatever the page shows).
 */

const clock: Clock = { now: () => new Date("2026-09-21T00:00:00.000Z") };
const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const sessions: Record<string, AuthenticatedContext> = {
  "tok-a": { principal: staff, claims: { tenant_id: "tenant-a" } },
  "tok-b": { principal: staff, claims: { tenant_id: "tenant-b" } },
};

function infra() {
  const kv = new Map<string, unknown>();
  const cache: Cache = {
    get: async <T>(k: string) => (kv.get(`cache:${k}`) as T | undefined) ?? null,
    set: async (k, v) => void kv.set(`cache:${k}`, JSON.parse(JSON.stringify(v))),
    delete: async (k) => void kv.delete(`cache:${k}`),
    has: async (k) => kv.has(`cache:${k}`),
  };
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: async (key): Promise<IdempotencyClaim | null> => {
      if (kv.has(`idem:${key}`)) return null;
      kv.set(`idem:${key}`, true);
      return { key, token: "t", release: async () => kv.delete(`idem:${key}`) };
    },
  };
  const rateLimiter: RateLimiter = {
    consume: async () => ({ allowed: true, remaining: 999, retryAfterMs: 0 }),
  };
  const authenticator: ClaimsAuthenticator = {
    verify: async (token) => sessions[token]?.principal ?? null,
    verifyWithClaims: async (token) => sessions[token] ?? null,
  };
  return { cache, idempotencyKeys, rateLimiter, authenticator };
}

let n = 0;
const idGenerator = { generate: () => `id-${(n += 1)}` };

describe("checkout and customer-account settings, enforced through the real HTTP pipeline (Wave 2a)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const fx = infra();
    app = await createAdminHttpApi({
      tenantMode: "multi",
      tenantGate: { availability: async () => "active" as const }, // fixture tenants have no Tenant row (T10.6)
      serializer: new InMemoryEventSerializer(),
      idGenerator,
      clock,
      authenticator: fx.authenticator,
      rateLimiter: fx.rateLimiter,
      idempotencyKeys: fx.idempotencyKeys,
      responseCache: fx.cache,
    });
  });
  afterEach(async () => {
    await app.close();
  });

  const admin = (token: string) => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  });
  const storefront = (tenant: string, extra: Record<string, string> = {}) => ({
    "x-tenant-id": tenant,
    "content-type": "application/json",
    ...extra,
  });

  async function post(url: string, headers: Record<string, string>, payload: unknown) {
    return app.inject({
      method: "POST",
      url: `/api/v1${url}`,
      headers,
      payload: payload as object,
    });
  }
  async function get(url: string, headers: Record<string, string>) {
    return app.inject({ method: "GET", url: `/api/v1${url}`, headers });
  }

  const defaults = {
    nameMode: "required",
    phoneMode: "required",
    line2Mode: "optional",
    marketingEmailPrompt: "hidden",
    cartLineLimit: null,
    requireLogin: false,
    accountsMode: "optional",
    showAccountLink: true,
  };

  /** Staff saves the settings document for `token`'s shop, exactly as the admin page posts it. */
  function saveSettings(
    token: string,
    patch: Record<string, unknown>,
    expectedVersion: number | null,
  ) {
    return post("/checkout/settings", admin(token), { ...defaults, ...patch, expectedVersion });
  }

  function fieldsOf(res: { json: () => unknown }): { field: string; message: string }[] {
    return (res.json() as { fields: { field: string; message: string }[] }).fields;
  }

  describe("the settings document (admin + public read)", () => {
    it("a shop that never saved gets today's defaults and a null version", async () => {
      const res = await get("/checkout/settings", admin("tok-a"));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ...defaults, version: null });
    });

    it("saves the first row at version 1, then updates at the version it read", async () => {
      const first = await saveSettings("tok-a", { phoneMode: "optional", cartLineLimit: 5 }, null);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ phoneMode: "optional", cartLineLimit: 5, version: 1 });
      const second = await saveSettings("tok-a", { line2Mode: "hidden" }, 1);
      expect(second.json()).toMatchObject({ line2Mode: "hidden", version: 2 });
      const read = await get("/checkout/settings", admin("tok-a"));
      expect(read.json()).toMatchObject({ line2Mode: "hidden", phoneMode: "required", version: 2 });
    });

    it("a stale save is 409 CONFLICT 'These settings were changed by someone else'", async () => {
      await saveSettings("tok-a", {}, null);
      await saveSettings("tok-a", { phoneMode: "optional" }, 1);
      const stale = await saveSettings("tok-a", { cartLineLimit: 3 }, 1);
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({
        code: "CONFLICT",
        message: "These settings were changed by someone else",
      });
      const firstAgain = await saveSettings("tok-a", {}, null);
      expect(firstAgain.statusCode).toBe(409);
    });

    it("requiring login while accounts are off is 422 on requireLogin with the reason (D37)", async () => {
      const res = await saveSettings(
        "tok-a",
        { requireLogin: true, accountsMode: "disabled" },
        null,
      );
      expect(res.statusCode).toBe(422);
      expect(fieldsOf(res)).toEqual([
        { field: "requireLogin", message: "Customer accounts must be on to require login" },
      ]);
      expect((await get("/checkout/settings", admin("tok-a"))).json()).toMatchObject({
        version: null,
      });
    });

    it("an out-of-range limit and an unknown mode are 422 naming the fields", async () => {
      const res = await saveSettings("tok-a", { cartLineLimit: 0, phoneMode: "hidden" }, null);
      expect(res.statusCode).toBe(422);
      expect(
        fieldsOf(res)
          .map((f) => f.field)
          .sort(),
      ).toEqual(["cartLineLimit", "phoneMode"]);
    });

    it("the body is strict: an unknown key is refused, a missing one too", async () => {
      const extra = await post("/checkout/settings", admin("tok-a"), {
        ...defaults,
        expectedVersion: null,
        tenantId: "tenant-b",
      });
      expect(extra.statusCode).toBe(422);
      const { showAccountLink: _omitted, ...rest } = defaults;
      const missing = await post("/checkout/settings", admin("tok-a"), {
        ...rest,
        expectedVersion: null,
      });
      expect(missing.statusCode).toBe(422);
    });

    it("needs a signed-in staff member", async () => {
      expect((await get("/checkout/settings", storefront("tenant-a"))).statusCode).toBe(401);
      const anon = await post("/checkout/settings", storefront("tenant-a"), {
        ...defaults,
        expectedVersion: null,
      });
      expect(anon.statusCode).toBe(401);
    });

    it("the public read is open, returns exactly the eight switches and follows the saved values", async () => {
      const before = await get("/public/checkout-settings", storefront("tenant-a"));
      expect(before.statusCode).toBe(200);
      expect(before.json()).toEqual(defaults);
      await saveSettings("tok-a", { line2Mode: "required", marketingEmailPrompt: "show" }, null);
      const after = (await get("/public/checkout-settings", storefront("tenant-a"))).json();
      expect(after).toEqual({ ...defaults, line2Mode: "required", marketingEmailPrompt: "show" });
      expect(Object.keys(after as object)).not.toContain("version");
    });

    it("settings are per shop", async () => {
      await saveSettings("tok-a", { cartLineLimit: 2, phoneMode: "optional" }, null);
      const b = await get("/public/checkout-settings", storefront("tenant-b"));
      expect(b.json()).toEqual(defaults);
      expect((await get("/checkout/settings", admin("tok-b"))).json()).toMatchObject({
        version: null,
      });
    });
  });
});

import type {
  AuthenticatedIdentity,
  Cache,
  ClaimsAuthenticator,
  IdGenerator,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createAdminHttpApi, type AdminHttpDeps } from "./server";

/**
 * WP-14 T14.3 (operability): the five billing-coupon routes through the REAL HTTP pipeline — auth,
 * tenant resolution, the licensing controller and the in-memory licensing composition — so a wrong
 * status, a dropped `context.tenantId`, or a missing platform-only refusal shows up as a wrong
 * response here, not just as a wrong argument to a spy.
 *
 * ONE app, TWO bearer tokens: `operator` resolves to the platform tenant, `merchant` to a merchant
 * tenant. Both are the same staff identity and both pass the permission guard (the default
 * `AllowAllAccessControl` models a merchant that has been GRANTED `licensing:billing:manage`), so a
 * 403 can only be the tenant refusal — and because they share state, the coupon the merchant probes
 * really exists, so a 403 is never masked as a 404.
 */
const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const clock = { now: () => new Date("2026-10-01T00:00:00.000Z") };
const PLATFORM = "platform-tenant";
const MERCHANT = "t-merchant";
const CLAIMS: Record<string, string> = { operator: PLATFORM, merchant: MERCHANT };

function harness(): AdminHttpDeps {
  const cache: Cache = {
    get: async () => null,
    set: async () => undefined,
    delete: async () => undefined,
    has: async () => false,
  };
  const replays = new Map<string, unknown>();
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: async (key) => ({ key, token: "t", release: async () => true }),
  };
  const rateLimiter: RateLimiter = {
    consume: async () => ({ allowed: true, remaining: 99, retryAfterMs: 0 }),
  };
  const authenticator: ClaimsAuthenticator = {
    verify: async (token) => (token in CLAIMS ? staff : null),
    verifyWithClaims: async (token) =>
      token in CLAIMS ? { principal: staff, claims: { tenant_id: CLAIMS[token] } } : null,
  };
  const idGenerator: IdGenerator = { generate: () => crypto.randomUUID() };
  return {
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    authenticator,
    rateLimiter,
    idempotencyKeys,
    // A real replay store, so a duplicate Idempotency-Key is actually replayed.
    responseCache: {
      ...cache,
      get: async <T>(key: string) => (replays.get(key) as T | undefined) ?? null,
      set: async <T>(key: string, value: T) => {
        replays.set(key, value);
      },
    },
    tenantMode: "multi",
    tenantGate: { availability: async () => "active" as const },
    tenantId: PLATFORM,
  };
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});

async function boot() {
  const app = await createAdminHttpApi(harness());
  apps.push(app);
  return app;
}

let keys = 0;
function call(
  app: FastifyInstance,
  token: "operator" | "merchant",
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
  idempotencyKey: string | null = method === "POST" ? `k-${(keys += 1)}` : null,
) {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: {
      authorization: `Bearer ${token}`,
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
      ...(idempotencyKey === null ? {} : { "idempotency-key": idempotencyKey }),
    },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

const EXPIRES = "2026-11-01T00:00:00.000Z";
const percent20 = (code: string, extra: object = {}) => ({
  code,
  value: { kind: "percentage", basisPoints: 2000 },
  expiresAt: EXPIRES,
  ...extra,
});

async function issue(app: FastifyInstance, code = "LAUNCH20", extra: object = {}) {
  const res = await call(app, "operator", "POST", "/billing/coupons", percent20(code, extra));
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

async function draftInvoice(app: FastifyInstance) {
  const res = await call(app, "operator", "POST", "/invoices", {
    tenantRef: "merchant-1",
    subscriptionRef: "sub-1",
    currency: "EGP",
    lineItems: [{ description: "Growth plan", amountMinor: 2900 }],
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

const read = (app: FastifyInstance, id: string, token: "operator" | "merchant" = "operator") =>
  call(app, token, "GET", `/billing/coupons/${id}`);

describe("an operator can issue, see, redeem, expire and revoke a coupon over HTTP", () => {
  it("issue -> read shows `issued` with its value, expiry and addressee", async () => {
    const app = await boot();
    const id = await issue(app, "LAUNCH20", { merchantRef: "merchant-1" });
    const res = await read(app, id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id,
      code: "LAUNCH20",
      value: { kind: "percentage", basisPoints: 2000 },
      expiresAt: EXPIRES,
      merchantRef: "merchant-1",
      status: "issued",
      pastExpiry: false,
    });
  });

  it("redeem -> read shows `redeemed` and names the invoice", async () => {
    const app = await boot();
    const id = await issue(app);
    const invoiceId = await draftInvoice(app);
    const redeemed = await call(app, "operator", "POST", "/billing/coupons/redeem", {
      code: "launch20", // the code is normalised, as the controller's redeem does
      invoiceId,
    });
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json()).toMatchObject({
      couponId: id,
      invoiceId,
      discountMinor: 580,
      totalMinor: 2320,
    });

    expect((await read(app, id)).json()).toMatchObject({
      status: "redeemed",
      redemption: { invoiceRef: invoiceId, redeemedAt: "2026-10-01T00:00:00.000Z" },
    });
  });

  it("a second redeem of the same coupon is 409 over HTTP, and the invoice is discounted once", async () => {
    const app = await boot();
    await issue(app);
    const first = await draftInvoice(app);
    const second = await draftInvoice(app);
    const body = (invoiceId: string) => ({ code: "LAUNCH20", invoiceId });
    expect(
      (await call(app, "operator", "POST", "/billing/coupons/redeem", body(first))).statusCode,
    ).toBe(200);
    const again = await call(app, "operator", "POST", "/billing/coupons/redeem", body(second));
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("a retry with the SAME Idempotency-Key replays the 200; a fresh key is still 409", async () => {
    const app = await boot();
    await issue(app);
    const invoiceId = await draftInvoice(app);
    const payload = { code: "LAUNCH20", invoiceId };
    const url = "/billing/coupons/redeem";
    const first = await call(app, "operator", "POST", url, payload, "redeem-1");
    const retry = await call(app, "operator", "POST", url, payload, "redeem-1");
    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    expect((await call(app, "operator", "POST", url, payload, "redeem-2")).statusCode).toBe(409);
  });

  it("revoke -> read shows `revoked` with its reason; a revoked coupon cannot then be redeemed", async () => {
    const app = await boot();
    const id = await issue(app);
    const revoked = await call(app, "operator", "POST", `/billing/coupons/${id}/revoke`, {
      reason: "issued in error",
    });
    expect(revoked.statusCode).toBe(200);
    expect((await read(app, id)).json()).toMatchObject({
      status: "revoked",
      revokedReason: "issued in error",
    });
    const invoiceId = await draftInvoice(app);
    expect(
      (
        await call(app, "operator", "POST", "/billing/coupons/redeem", {
          code: "LAUNCH20",
          invoiceId,
        })
      ).statusCode,
    ).toBe(409);
  });

  it("a redeemed coupon cannot be revoked (409): its discount is already on an invoice", async () => {
    const app = await boot();
    const id = await issue(app);
    const invoiceId = await draftInvoice(app);
    await call(app, "operator", "POST", "/billing/coupons/redeem", { code: "LAUNCH20", invoiceId });
    const res = await call(app, "operator", "POST", `/billing/coupons/${id}/revoke`, {
      reason: "x",
    });
    expect(res.statusCode).toBe(409);
  });

  it("expire before the expiry is refused 409 and leaves the coupon `issued`", async () => {
    const app = await boot();
    const id = await issue(app);
    const res = await call(app, "operator", "POST", `/billing/coupons/${id}/expire`);
    expect(res.statusCode).toBe(409);
    expect((await read(app, id)).json()).toMatchObject({ status: "issued" });
  });

  it("issuing the same code twice is 409", async () => {
    const app = await boot();
    await issue(app);
    const dup = await call(app, "operator", "POST", "/billing/coupons", percent20("launch20"));
    expect(dup.statusCode).toBe(409);
  });

  it("an unknown coupon reads 404, and an unknown code redeems 404", async () => {
    const app = await boot();
    expect((await read(app, "no-such-coupon")).statusCode).toBe(404);
    const invoiceId = await draftInvoice(app);
    const res = await call(app, "operator", "POST", "/billing/coupons/redeem", {
      code: "NOSUCHCODE",
      invoiceId,
    });
    expect(res.statusCode).toBe(404);
  });

  it("a read is never replayed from a stale Idempotency-Key", async () => {
    const app = await boot();
    const id = await issue(app);
    expect(
      (await call(app, "operator", "GET", `/billing/coupons/${id}`, undefined, "g-1")).json(),
    ).toMatchObject({ status: "issued" });
    await call(app, "operator", "POST", `/billing/coupons/${id}/revoke`, { reason: "r" });
    expect(
      (await call(app, "operator", "GET", `/billing/coupons/${id}`, undefined, "g-1")).json(),
    ).toMatchObject({ status: "revoked" });
  });
});

describe("a merchant tenant is refused 403 on every coupon route, including the read", () => {
  it("cannot issue, redeem, expire, revoke or read — and none of it takes effect", async () => {
    const app = await boot();
    const id = await issue(app, "REALCODE");
    const invoiceId = await draftInvoice(app);

    const attempts = {
      issue: await call(app, "merchant", "POST", "/billing/coupons", percent20("SELFMADE100")),
      redeem: await call(app, "merchant", "POST", "/billing/coupons/redeem", {
        code: "REALCODE",
        invoiceId,
      }),
      expire: await call(app, "merchant", "POST", `/billing/coupons/${id}/expire`),
      revoke: await call(app, "merchant", "POST", `/billing/coupons/${id}/revoke`, { reason: "x" }),
      read: await read(app, id, "merchant"),
    };
    for (const [name, res] of Object.entries(attempts)) {
      expect(res.statusCode, name).toBe(403);
    }
    expect(attempts.read.body).toMatch(/platform-owned/);

    // Nothing happened: the real coupon is still issued and unspent, and the self-made code was
    // never written (the platform can still issue it — a duplicate would be 409).
    expect((await read(app, id)).json()).toMatchObject({ status: "issued" });
    expect(
      (await call(app, "operator", "POST", "/billing/coupons", percent20("SELFMADE100")))
        .statusCode,
    ).toBe(201);
  });
});

describe("a malformed request is refused by the schema before any controller call", () => {
  it.each([
    [
      "issue without a code",
      "/billing/coupons",
      { value: { kind: "percentage", basisPoints: 100 }, expiresAt: EXPIRES },
    ],
    [
      "issue with a mistyped merchantRef key",
      "/billing/coupons",
      percent20("MISTYPED", { merchantref: "m-1" }),
    ],
    ["redeem without an invoice", "/billing/coupons/redeem", { code: "LAUNCH20" }],
    ["revoke without a reason", "/billing/coupons/some-id/revoke", {}],
  ])("%s -> 422", async (_name, url, payload) => {
    const app = await boot();
    const res = await call(app, "operator", "POST", url, payload);
    expect(res.statusCode).toBe(422);
  });

  it("writes nothing when the body is refused", async () => {
    const app = await boot();
    await call(
      app,
      "operator",
      "POST",
      "/billing/coupons",
      percent20("MISTYPED", { merchantref: "m-1" }),
    );
    // A duplicate would be 409; 201 proves the refused request never reached the use case.
    expect(
      (await call(app, "operator", "POST", "/billing/coupons", percent20("MISTYPED"))).statusCode,
    ).toBe(201);
  });
});

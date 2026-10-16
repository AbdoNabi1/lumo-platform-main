import { describe, expect, it, vi } from "vitest";
import type { Principal } from "@platform/contracts";
import type { RequestContext, RouteDefinition } from "@platform/http";
import { licensingRoutes } from "./licensing-routes";
import type { WiredAdmin } from "../composition";

/**
 * WP-14 T14.3: the five operator routes over `LicensingController`'s coupon actions. These pin the
 * ROUTE's job — which permission, which arguments (the principal AND the tenant), which status it
 * passes through, and which body it refuses — with the controller replaced by a spy. The real HTTP
 * pipeline, the platform-only refusal and the redeem-once 409 are in `licensing-coupons.e2e.test.ts`.
 */
const principal: Principal = {
  id: "staff-1",
  kind: "staff",
  roles: ["admin"],
  tenantId: "platform-tenant",
};
const context: RequestContext = {
  tenantId: "platform-tenant",
  principal,
  requestId: "req-1",
  correlationId: "req-1",
  headers: {},
};

const ACTIONS = [
  "issueCoupon",
  "redeemCoupon",
  "expireCoupon",
  "revokeCoupon",
  "getCoupon",
] as const;

function fakeAdmin(responses: Partial<Record<(typeof ACTIONS)[number], unknown>> = {}) {
  const licensing = Object.fromEntries(
    ACTIONS.map((name) => [
      name,
      vi.fn().mockResolvedValue(responses[name] ?? { status: 200, body: {} }),
    ]),
  ) as Record<(typeof ACTIONS)[number], ReturnType<typeof vi.fn>>;
  return { licensing, admin: { licensing } as unknown as WiredAdmin };
}

function route(admin: WiredAdmin, method: string, path: string): RouteDefinition {
  const found = licensingRoutes(admin).find((r) => r.method === method && r.path === path);
  if (found === undefined) throw new Error(`no route ${method} ${path}`);
  return found;
}

const ISSUE = "/billing/coupons";
const REDEEM = "/billing/coupons/redeem";
const READ = "/billing/coupons/:couponId";
const EXPIRE = "/billing/coupons/:couponId/expire";
const REVOKE = "/billing/coupons/:couponId/revoke";

describe("billing-coupon routes: table", () => {
  it("are all gated by licensing:billing:manage (no new permission is introduced)", () => {
    const { admin } = fakeAdmin();
    for (const [method, path] of [
      ["POST", ISSUE],
      ["POST", REDEEM],
      ["GET", READ],
      ["POST", EXPIRE],
      ["POST", REVOKE],
    ] as const) {
      expect(route(admin, method, path).permission).toBe("licensing:billing:manage");
    }
  });

  it("replays a duplicate Idempotency-Key on the four writes, but never on the read", () => {
    const { admin } = fakeAdmin();
    for (const path of [ISSUE, REDEEM, EXPIRE, REVOKE]) {
      expect(route(admin, "POST", path).idempotent).toBe(true);
    }
    // A cached GET would keep answering `issued` for a coupon that has since been redeemed.
    expect(route(admin, "GET", READ).idempotent).not.toBe(true);
  });

  it("stay off the store-coupon paths (/coupons is the merchant's own promotions surface)", () => {
    const { admin } = fakeAdmin();
    const storeCouponPaths = ["/coupons", "/coupons/redeem", "/coupons/:couponId/transitions"];
    for (const r of licensingRoutes(admin)) expect(storeCouponPaths).not.toContain(r.path);
  });
});

describe("billing-coupon routes: delegation", () => {
  it("issue passes the principal, the body and the tenant, and keeps the controller's 201", async () => {
    const { admin, licensing } = fakeAdmin({ issueCoupon: { status: 201, body: { id: "c-1" } } });
    const body = {
      code: "LAUNCH20",
      value: { kind: "percentage", basisPoints: 2000 },
      expiresAt: new Date("2026-11-01T00:00:00.000Z"),
      merchantRef: "merchant-1",
    };
    const res = await route(admin, "POST", ISSUE).handle({ body, params: {}, query: {}, context });
    expect(res).toEqual({ status: 201, body: { id: "c-1" } });
    expect(licensing.issueCoupon).toHaveBeenCalledWith(principal, {
      ...body,
      tenantId: "platform-tenant",
    });
  });

  it("redeem passes the principal, code, invoice and tenant, and keeps the controller's 409", async () => {
    const refused = { status: 409, body: { code: "BUSINESS_RULE" } };
    const { admin, licensing } = fakeAdmin({ redeemCoupon: refused });
    const res = await route(admin, "POST", REDEEM).handle({
      body: { code: "LAUNCH20", invoiceId: "inv-1" },
      params: {},
      query: {},
      context,
    });
    expect(res).toEqual(refused);
    expect(licensing.redeemCoupon).toHaveBeenCalledWith(principal, {
      code: "LAUNCH20",
      invoiceId: "inv-1",
      tenantId: "platform-tenant",
    });
  });

  it("expire passes the coupon id from the path, the principal and the tenant", async () => {
    const { admin, licensing } = fakeAdmin();
    await route(admin, "POST", EXPIRE).handle({
      body: undefined,
      params: { couponId: "c-1" },
      query: {},
      context,
    });
    expect(licensing.expireCoupon).toHaveBeenCalledWith(principal, {
      couponId: "c-1",
      tenantId: "platform-tenant",
    });
  });

  it("revoke passes the coupon id, the reason, the principal and the tenant", async () => {
    const { admin, licensing } = fakeAdmin();
    await route(admin, "POST", REVOKE).handle({
      body: { reason: "issued in error" },
      params: { couponId: "c-1" },
      query: {},
      context,
    });
    expect(licensing.revokeCoupon).toHaveBeenCalledWith(principal, {
      couponId: "c-1",
      reason: "issued in error",
      tenantId: "platform-tenant",
    });
  });

  it("read passes the coupon id from the path, the principal and the tenant, and keeps a 404", async () => {
    const missing = { status: 404, body: { code: "NOT_FOUND" } };
    const { admin, licensing } = fakeAdmin({ getCoupon: missing });
    const res = await route(admin, "GET", READ).handle({
      body: undefined,
      params: { couponId: "nope" },
      query: {},
      context,
    });
    expect(res).toEqual(missing);
    expect(licensing.getCoupon).toHaveBeenCalledWith(principal, {
      couponId: "nope",
      tenantId: "platform-tenant",
    });
  });
});

describe("billing-coupon routes: schemas refuse before any controller call", () => {
  const { admin } = fakeAdmin();
  const issue = route(admin, "POST", ISSUE).schema.body!;
  const redeem = route(admin, "POST", REDEEM).schema.body!;
  const revoke = route(admin, "POST", REVOKE).schema.body!;
  const valid = {
    code: "LAUNCH20",
    value: { kind: "percentage", basisPoints: 2000 },
    expiresAt: "2026-11-01T00:00:00.000Z",
  };

  it("accepts a well-formed percentage and fixed issue body", () => {
    expect(issue.safeParse(valid).success).toBe(true);
    expect(
      issue.safeParse({
        ...valid,
        value: { kind: "fixed", amountMinor: 500, currency: "EGP" },
      }).success,
    ).toBe(true);
  });

  it.each([
    ["missing code", { ...valid, code: undefined }],
    ["missing value", { ...valid, value: undefined }],
    ["missing expiresAt", { ...valid, expiresAt: undefined }],
    ["unknown value kind", { ...valid, value: { kind: "free" } }],
    ["fixed value without a currency", { ...valid, value: { kind: "fixed", amountMinor: 5 } }],
    ["non-integer basisPoints", { ...valid, value: { kind: "percentage", basisPoints: 1.5 } }],
    ["unparseable expiresAt", { ...valid, expiresAt: "soon" }],
    // A mistyped `merchantRef` must not be silently stripped: that would issue a BEARER coupon.
    ["misspelt merchantRef", { ...valid, merchantref: "merchant-1" }],
  ])("refuses an issue body with %s", (_name, body) => {
    expect(issue.safeParse(body).success).toBe(false);
  });

  it("refuses a redeem body missing the code or the invoice, or with an extra key", () => {
    expect(redeem.safeParse({ code: "LAUNCH20" }).success).toBe(false);
    expect(redeem.safeParse({ invoiceId: "inv-1" }).success).toBe(false);
    expect(redeem.safeParse({ code: "LAUNCH20", invoiceId: "inv-1", tenantId: "x" }).success).toBe(
      false,
    );
  });

  it("refuses a revoke body with no reason or an empty one", () => {
    expect(revoke.safeParse({}).success).toBe(false);
    expect(revoke.safeParse({ reason: "" }).success).toBe(false);
  });
});

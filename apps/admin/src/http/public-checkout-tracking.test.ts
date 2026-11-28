import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { type RouteDefinition } from "@platform/http";
import {
  InMemoryAttributionSnapshotStore,
  type AttributionSnapshotWrite,
} from "@platform/tracking";
import { wireAdmin, type WiredAdmin } from "../composition";
import { publicCartRoutes } from "./public-cart-routes";
import { publicCheckoutRoutes, type PublicCheckoutSessionDto } from "./public-checkout-routes";
import { checkoutSnapshotRecorder, checkoutTrackingBody } from "./public-checkout-tracking";
import { controllerDriver, seedSingleVariantProduct } from "./testing/seed-catalog";
import { controllerStockDriver, seedStock } from "./testing/seed-stock";

/**
 * Tracking P2-D8: the optional `tracking` object of the public checkout `complete` route. Drives the REAL `wireAdmin()`
 * composition (in-memory branch) through the actual `RouteDefinition.handle()` boundary, like
 * `public-checkout-routes.test.ts`, with the in-memory snapshot store behind the recorder.
 */
beforeEach(() => {
  expect.hasAssertions();
});

const NOW = new Date("2026-12-01T10:00:00.000Z");
const clock: Clock = { now: () => NOW };
const staff: Principal = {
  id: "staff-1",
  kind: "staff",
  roles: ["admin"],
  tenantId: "tenant-local",
};
const VISITOR = "0b9f4c1e-3d2a-4f55-8a77-1c2d3e4f5a6b";

interface Response {
  readonly status: number;
  readonly body: unknown;
}

const byPathAndMethod = (
  routes: readonly RouteDefinition[],
  method: string,
  path: string,
): RouteDefinition => {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (route === undefined) throw new Error(`no route ${method} ${path}`);
  return route;
};

const publicContext = () => ({
  tenantId: "tenant-local",
  principal: { id: "public", kind: "customer", roles: [] },
  requestId: "req-1",
  headers: {},
});

function buildAdmin(): WiredAdmin {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  return wireAdmin({ serializer: new InMemoryEventSerializer(), idGenerator, clock });
}

const address = { line1: "1 Main St", city: "Springfield", postalCode: "00000", country: "US" };

async function ready(
  rawAdmin: WiredAdmin,
  checkout: readonly RouteDefinition[],
  sessionRef: string,
) {
  const cartRoutes = publicCartRoutes(rawAdmin);
  const call = async (
    routes: readonly RouteDefinition[],
    method: string,
    path: string,
    body: unknown,
    params: Record<string, string> = {},
  ): Promise<Response> =>
    (await byPathAndMethod(routes, method, path).handle({
      body,
      params,
      query: {},
      context: publicContext(),
    } as never)) as Response;
  const ok = <T>(response: Response, what: string): T => {
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`${what} failed (${response.status}): ${JSON.stringify(response.body)}`);
    }
    return response.body as T;
  };

  const product = await seedSingleVariantProduct(
    controllerDriver(rawAdmin.publicReads.products, "tenant-local"),
    "P-1",
    1999,
  );
  await seedStock(controllerStockDriver(rawAdmin.inventory, staff, "tenant-local"), {
    productId: product.productId,
    variantId: product.variantId,
    quantity: 100,
  });
  const cart = ok<{ id: string }>(
    await call(cartRoutes, "POST", "/public/carts", { sessionRef, currency: "USD" }),
    "cart",
  );
  await call(
    cartRoutes,
    "POST",
    "/public/carts/:cartId/items",
    {
      sessionRef,
      productId: product.productId,
      quantity: 1,
    },
    { cartId: cart.id },
  );
  const started = ok<PublicCheckoutSessionDto>(
    await call(checkout, "POST", "/public/checkouts", {
      sessionRef,
      cartRef: cart.id,
      currency: "USD",
    }),
    "start",
  );
  const id = { checkoutSessionId: started.id };
  const step = (path: string, body: unknown) =>
    call(checkout, "POST", `/public/checkouts/:checkoutSessionId/${path}`, body, id);
  await step("items", { sessionRef, cartId: cart.id });
  await step("billing-address", { sessionRef, ...address });
  await step("shipping-address", { sessionRef, ...address });
  await step("shipping-selection", { sessionRef, method: "standard" });
  await step("payment-selection", { sessionRef, paymentMethodRef: "pm_1", provider: "stripe" });
  ok(await step("contact", { sessionRef, email: "guest@example.com" }), "contact");
  await step("recalculate", { sessionRef });
  const complete = (body: unknown, tenantId = "tenant-local"): Promise<Response> =>
    byPathAndMethod(checkout, "POST", "/public/checkouts/:checkoutSessionId/complete").handle({
      body,
      params: id,
      query: {},
      context: { ...publicContext(), tenantId },
    } as never) as Promise<Response>;
  return { checkoutId: started.id, complete };
}

const tracking = {
  visitorId: VISITOR,
  sessionId: "sess-1",
  ip: "203.0.113.9",
  userAgent: "Mozilla/5.0",
  pageUrl: "https://shop.example/checkout",
  cookies: { fbp: "fb.1.1.2", ga: "GA1.1.123.456" },
  clickIds: [
    { name: "gclid", value: "Cj0KCQ-abc", capturedAt: "2026-11-29T10:00:00.000Z" },
    { name: "scclid", value: "too-old", capturedAt: "2026-09-01T10:00:00.000Z" },
  ],
  utm: { source: "facebook" },
};

async function setup(
  options: { recorder?: boolean; store?: InMemoryAttributionSnapshotStore } = {},
) {
  const rawAdmin = buildAdmin();
  const store = options.store ?? new InMemoryAttributionSnapshotStore();
  const checkout = publicCheckoutRoutes(
    rawAdmin,
    options.recorder === false
      ? {}
      : { attributionSnapshots: checkoutSnapshotRecorder(store, clock) },
  );
  const flow = await ready(rawAdmin, checkout, "session-1");
  return { rawAdmin, store, checkout, ...flow };
}

describe("complete with a tracking object (P2-D8)", () => {
  it("stores the sanitised snapshot under the checkout session id, BEFORE the order is created", async () => {
    const { rawAdmin, store, checkoutId, complete } = await setup();
    const order: string[] = [];
    const real = rawAdmin.publicReads.checkout.complete.bind(rawAdmin.publicReads.checkout);
    const spy = vi
      .spyOn(rawAdmin.publicReads.checkout, "complete")
      .mockImplementation(async (input) => {
        order.push(
          `complete; snapshot stored: ${String((await store.find("tenant-local", "checkout", checkoutId)) !== null)}`,
        );
        return real(input);
      });

    const response = await complete({
      sessionRef: "session-1",
      idempotencyKey: "idem-1",
      tracking,
    });

    expect(response.status).toBe(200);
    expect((response.body as PublicCheckoutSessionDto).status).toBe("completed");
    expect(order).toEqual(["complete; snapshot stored: true"]);
    spy.mockRestore();
    expect(await store.find("tenant-local", "checkout", checkoutId)).toEqual({
      visitorId: VISITOR,
      sessionId: "sess-1",
      ip: "203.0.113.9",
      userAgent: "Mozilla/5.0",
      pageUrl: "https://shop.example/checkout",
      cookies: { fbp: "fb.1.1.2", ga: "GA1.1.123.456" },
      // Snapchat's 28-day window had passed: dropped, the Google click kept
      clickIds: [{ name: "gclid", value: "Cj0KCQ-abc", capturedAt: "2026-11-29T10:00:00.000Z" }],
      utm: { source: "facebook" },
    });
  });

  it("is backward compatible: a body without `tracking` completes as before and stores nothing", async () => {
    const { store, checkoutId, complete } = await setup();
    const response = await complete({ sessionRef: "session-1", idempotencyKey: "idem-1" });
    expect(response.status).toBe(200);
    expect(await store.find("tenant-local", "checkout", checkoutId)).toBeNull();
  });

  it("first write wins: a second complete with other tracking data keeps the first snapshot", async () => {
    const { store, checkoutId, complete } = await setup();
    await complete({ sessionRef: "session-1", idempotencyKey: "idem-1", tracking });
    await complete({
      sessionRef: "session-1",
      idempotencyKey: "idem-1",
      tracking: { visitorId: "ffffffff-ffff-4fff-8fff-ffffffffffff", ip: "198.51.100.77" },
    });
    expect(await store.find("tenant-local", "checkout", checkoutId)).toMatchObject({
      visitorId: VISITOR,
      ip: "203.0.113.9",
    });
  });

  it("a snapshot store failure never blocks the order (logged by name only)", async () => {
    const failing = new InMemoryAttributionSnapshotStore();
    vi.spyOn(failing, "putIfAbsent").mockRejectedValue(new Error("connect ECONNREFUSED db.secret"));
    const { complete } = await setup({ store: failing });
    const response = await complete({
      sessionRef: "session-1",
      idempotencyKey: "idem-1",
      tracking,
    });
    expect(response.status).toBe(200);
    expect((response.body as PublicCheckoutSessionDto).status).toBe("completed");
  });

  it("a caller that does not own the session stores nothing", async () => {
    const { store, checkoutId, complete } = await setup();
    const response = await complete({
      sessionRef: "someone-else",
      idempotencyKey: "idem-1",
      tracking,
    });
    expect(response.status).toBe(404);
    expect(await store.find("tenant-local", "checkout", checkoutId)).toBeNull();
  });

  it("is keyed by the request's tenant: another shop's id space never sees it", async () => {
    const { store, checkoutId, complete } = await setup();
    await complete({ sessionRef: "session-1", idempotencyKey: "idem-1", tracking });
    expect(await store.find("tenant-other", "checkout", checkoutId)).toBeNull();
    expect(await store.find("tenant-local", "lead", checkoutId)).toBeNull();
  });

  it("without a recorder wired the object is accepted and ignored", async () => {
    const { complete } = await setup({ recorder: false });
    const response = await complete({
      sessionRef: "session-1",
      idempotencyKey: "idem-1",
      tracking,
    });
    expect(response.status).toBe(200);
  });

  it("an object with nothing usable stores nothing", async () => {
    const { store, checkoutId, complete } = await setup();
    await complete({
      sessionRef: "session-1",
      idempotencyKey: "idem-1",
      tracking: { visitorId: "bad", ip: "not-an-ip", pageUrl: "javascript:alert(1)" },
    });
    expect(await store.find("tenant-local", "checkout", checkoutId)).toBeNull();
  });

  it("the stored snapshot is exactly the shape the order read model consumes", async () => {
    const { store, checkoutId, complete } = await setup();
    await complete({ sessionRef: "session-1", idempotencyKey: "idem-1", tracking });
    const stored: AttributionSnapshotWrite["snapshot"] | null = await store.find(
      "tenant-local",
      "checkout",
      checkoutId,
    );
    expect(Object.keys(stored ?? {}).sort()).toEqual(
      ["clickIds", "cookies", "ip", "pageUrl", "sessionId", "userAgent", "utm", "visitorId"].sort(),
    );
  });
});

describe("the complete body schema (strict, capped, optional)", () => {
  const rawAdmin = buildAdmin();
  const route = byPathAndMethod(
    publicCheckoutRoutes(rawAdmin),
    "POST",
    "/public/checkouts/:checkoutSessionId/complete",
  );
  const body = route.schema.body as {
    safeParse(value: unknown): { success: boolean };
  };
  const base = { sessionRef: "s", idempotencyKey: "k" };

  it("accepts the old body (no tracking) and the new one", () => {
    expect(body.safeParse(base).success).toBe(true);
    expect(body.safeParse({ ...base, tracking }).success).toBe(true);
    expect(body.safeParse({ ...base, tracking: {} }).success).toBe(true);
  });

  it("refuses unknown keys inside tracking, including a tenant or a customer", () => {
    for (const extra of [{ tenantId: "t-2" }, { customerRef: "c-1" }, { email: "a@b.co" }]) {
      expect(body.safeParse({ ...base, tracking: { ...tracking, ...extra } }).success).toBe(false);
    }
    expect(
      body.safeParse({ ...base, tracking: { ...tracking, cookies: { fbp: "x", sid: "y" } } })
        .success,
    ).toBe(false);
    expect(
      body.safeParse({
        ...base,
        tracking: { clickIds: [{ name: "gclid", value: "v", capturedAt: "t", extra: 1 }] },
      }).success,
    ).toBe(false);
  });

  it("caps every string and the click id count; nothing is truncated", () => {
    const tooLong: Record<string, unknown>[] = [
      { visitorId: "v".repeat(49) },
      { sessionId: "s".repeat(65) },
      { ip: "1".repeat(65) },
      { userAgent: "u".repeat(513) },
      { pageUrl: `https://x.example/${"a".repeat(2040)}` },
      { referrer: "r".repeat(2049) },
      { cookies: { fbp: "f".repeat(513) } },
      { utm: { source: "s".repeat(201) } },
      {
        clickIds: [
          { name: "ttclid", value: "t".repeat(1001), capturedAt: "2026-11-29T10:00:00.000Z" },
        ],
      },
      {
        clickIds: Array.from({ length: 11 }, () => ({
          name: "gclid",
          value: "v",
          capturedAt: "2026-11-29T10:00:00.000Z",
        })),
      },
    ];
    for (const override of tooLong) {
      expect(body.safeParse({ ...base, tracking: override }).success).toBe(false);
    }
    expect(
      body.safeParse({
        ...base,
        tracking: {
          clickIds: [
            { name: "ttclid", value: "t".repeat(1000), capturedAt: "2026-11-29T10:00:00.000Z" },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it("the exported schema is the one the route uses", () => {
    expect(checkoutTrackingBody.safeParse(tracking).success).toBe(true);
    expect(checkoutTrackingBody.safeParse({ ...tracking, junk: 1 }).success).toBe(false);
  });
});

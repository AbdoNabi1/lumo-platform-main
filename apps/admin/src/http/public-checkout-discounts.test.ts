import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import type { Coupon } from "@platform/coupons";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import type { Order } from "@platform/orders";
import type { Paginated } from "@platform/types";
import { wireAdmin, type WiredAdmin } from "../composition";
import { publicCartRoutes } from "./public-cart-routes";
import { publicCheckoutRoutes, type PublicCheckoutSessionDto } from "./public-checkout-routes";
import { controllerDriver, seedSingleVariantProduct } from "./testing/seed-catalog";
import { controllerStockDriver, seedStock } from "./testing/seed-stock";

const TENANT = "tenant-local";
const clock: Clock = { now: () => new Date("2026-10-16T12:00:00.000Z") };
const staff: Principal = { id: "staff-1", kind: "staff", roles: ["admin"], tenantId: TENANT };

interface Response {
  readonly status: number;
  readonly body: unknown;
}

function buildAdmin(): WiredAdmin {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  return wireAdmin({ serializer: new InMemoryEventSerializer(), idGenerator, clock });
}

function route(routes: readonly RouteDefinition[], method: string, path: string): RouteDefinition {
  const found = routes.find((r) => r.method === method && r.path === path);
  if (found === undefined) throw new Error(`no route ${method} ${path}`);
  return found;
}

function context(sessionRef?: string) {
  return {
    tenantId: TENANT,
    principal: { id: "public", kind: "customer", roles: [] },
    requestId: "req-1",
    headers: sessionRef === undefined ? {} : { "x-cart-session": sessionRef },
  };
}

function unwrap<T>(response: Response, action: string): T {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${action} failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return response.body as T;
}

/** A 10%-off-the-order code, created the way the admin facade will (promotion + coupon + activation). */
async function createCode(admin: WiredAdmin, code: string): Promise<void> {
  const created = unwrap<{ promotionId: string }>(
    await admin.promotions.create(staff, {
      tenantId: TENANT,
      name: code,
      ruleType: "automatic",
      scope: "cart",
      targetRefs: [],
      rewardType: "percentage",
      rewardValue: 10,
      stackable: false,
      priority: 0,
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      method: "code",
    }),
    "create promotion",
  );
  unwrap(
    await admin.coupons.create(staff, {
      tenantId: TENANT,
      code,
      promotionRef: created.promotionId,
      multiUse: true,
    }),
    "create coupon",
  );
  unwrap(
    await admin.promotions.advance(staff, {
      tenantId: TENANT,
      promotionId: created.promotionId,
      toStatus: "active",
    }),
    "activate",
  );
}

/** A guest checkout with one 19.99 line, both addresses, shipping and payment chosen. */
async function readyCheckout(admin: WiredAdmin, sessionRef: string) {
  const product = await seedSingleVariantProduct(
    controllerDriver(admin.publicReads.products, TENANT),
    "P-1",
    1999,
  );
  await seedStock(controllerStockDriver(admin.inventory, staff, TENANT), {
    productId: product.productId,
    variantId: product.variantId,
    quantity: 100,
  });
  const cartRoutes = publicCartRoutes(admin);
  const checkoutRoutes = publicCheckoutRoutes(admin);
  const call = (
    routes: readonly RouteDefinition[],
    method: string,
    path: string,
    params: Record<string, string>,
    body?: unknown,
    query: Record<string, string> = {},
  ) =>
    route(routes, method, path).handle({
      body,
      params,
      query,
      context: context(sessionRef),
    } as never) as Promise<Response>;

  const cart = unwrap<{ id: string }>(
    await call(cartRoutes, "POST", "/public/carts", {}, { sessionRef, currency: "USD" }),
    "cart",
  );
  await call(
    cartRoutes,
    "POST",
    "/public/carts/:cartId/items",
    { cartId: cart.id },
    { sessionRef, productId: product.productId, quantity: 1 },
  );
  const started = unwrap<PublicCheckoutSessionDto>(
    await call(
      checkoutRoutes,
      "POST",
      "/public/checkouts",
      {},
      { sessionRef, cartRef: cart.id, currency: "USD" },
    ),
    "start",
  );
  const id = { checkoutSessionId: started.id };
  const address = {
    sessionRef,
    line1: "1 Main St",
    city: "Springfield",
    postalCode: "00000",
    country: "US",
  };
  await call(checkoutRoutes, "POST", "/public/checkouts/:checkoutSessionId/items", id, {
    sessionRef,
    cartId: cart.id,
  });
  await call(
    checkoutRoutes,
    "POST",
    "/public/checkouts/:checkoutSessionId/billing-address",
    id,
    address,
  );
  await call(
    checkoutRoutes,
    "POST",
    "/public/checkouts/:checkoutSessionId/shipping-address",
    id,
    address,
  );
  await call(
    checkoutRoutes,
    "POST",
    "/public/checkouts/:checkoutSessionId/shipping-selection",
    id,
    { sessionRef, method: "standard" },
  );
  await call(checkoutRoutes, "POST", "/public/checkouts/:checkoutSessionId/payment-selection", id, {
    sessionRef,
    paymentMethodRef: "pm_1",
    provider: "stripe",
  });
  await call(checkoutRoutes, "POST", "/public/checkouts/:checkoutSessionId/contact", id, {
    sessionRef,
    email: "guest@example.com",
  });
  await call(checkoutRoutes, "POST", "/public/checkouts/:checkoutSessionId/recalculate", id, {
    sessionRef,
  });

  return {
    id,
    addCode: (code: string, ref = sessionRef) =>
      route(checkoutRoutes, "POST", "/public/checkouts/:checkoutSessionId/discount-codes").handle({
        body: { sessionRef: ref, code },
        params: id,
        query: {},
        context: context(ref),
      } as never) as Promise<Response>,
    removeCode: (code: string) =>
      call(checkoutRoutes, "DELETE", "/public/checkouts/:checkoutSessionId/discount-codes/:code", {
        ...id,
        code,
      }),
    complete: () =>
      call(checkoutRoutes, "POST", "/public/checkouts/:checkoutSessionId/complete", id, {
        sessionRef,
        idempotencyKey: "k-1",
      }),
  };
}

describe("public checkout — discount codes (Phase 2)", () => {
  it("applies a code: the session shows it and the total drops", async () => {
    const admin = buildAdmin();
    await createCode(admin, "SALE10");
    const checkout = await readyCheckout(admin, "s-1");

    const session = unwrap<PublicCheckoutSessionDto>(await checkout.addCode("sale10"), "add code");

    expect(session.discount.codes).toEqual([{ code: "SALE10", applicable: true, reason: null }]);
    expect(session.discount.applied).toEqual([
      { title: "SALE10", code: "SALE10", discountClass: "order", amountMinor: 199 },
    ]);
    expect(session.totals?.discountMinor).toBe(199);
  });

  it("refuses an unknown code with 422 and the reason", async () => {
    const admin = buildAdmin();
    const checkout = await readyCheckout(admin, "s-1");
    const response = await checkout.addCode("NOPE");
    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain("not_found");
  });

  it("removes a code and its discount", async () => {
    const admin = buildAdmin();
    await createCode(admin, "SALE10");
    const checkout = await readyCheckout(admin, "s-1");
    await checkout.addCode("SALE10");
    const session = unwrap<PublicCheckoutSessionDto>(await checkout.removeCode("SALE10"), "remove");
    expect(session.discount.codes).toEqual([]);
    expect(session.totals?.discountMinor).toBe(0);
  });

  it("does not let another session add a code to this checkout", async () => {
    const admin = buildAdmin();
    await createCode(admin, "SALE10");
    const checkout = await readyCheckout(admin, "s-1");
    expect((await checkout.addCode("SALE10", "someone-else")).status).toBe(404);
  });

  it("places the order with the discount and counts the code's use", async () => {
    const admin = buildAdmin();
    await createCode(admin, "SALE10");
    const checkout = await readyCheckout(admin, "s-1");
    await checkout.addCode("SALE10");

    const completed = unwrap<PublicCheckoutSessionDto>(await checkout.complete(), "complete");

    const order = unwrap<Order>(
      (await admin.orders.getOrder(staff, {
        tenantId: TENANT,
        orderId: completed.orderRef ?? "",
      })) as Response,
      "order",
    );
    expect(order.totals?.discountMinor).toBe(199);
    expect(order.totals?.discounts.map((d) => d.code)).toEqual(["SALE10"]);
    const coupons = unwrap<Paginated<Coupon>>(
      (await admin.coupons.list(staff, { tenantId: TENANT, first: 10 })) as Response,
      "coupons",
    );
    expect(coupons.items[0]?.usageCount).toBe(1);
  });
});

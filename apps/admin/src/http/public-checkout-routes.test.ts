import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { CheckoutSession } from "@platform/checkout";
import { mapError, type RouteDefinition } from "@platform/http";
import type { Customer } from "@platform/identity";
import type { Order } from "@platform/orders";
import { ValidationError } from "@platform/utils";
import { wireAdmin, type WiredAdmin } from "../composition";
import { publicAuthRoutes } from "./public-auth-routes";
import { publicCartRoutes } from "./public-cart-routes";
import { publicLoyaltyRoutes } from "./public-loyalty-routes";
import { publicWishlistRoutes } from "./public-wishlist-routes";
import { publicCheckoutRoutes, type PublicCheckoutSessionDto } from "./public-checkout-routes";

/**
 * Public Checkout HTTP surface (Phase 2 — Public checkout). Drives the REAL `wireAdmin()`
 * composition (in-memory branch) through the actual `RouteDefinition.handle()` boundary — same
 * technique `public-cart-routes.test.ts` and `cart-checkout-pricing-security.e2e.test.ts` use.
 * `wireAdmin` is used (rather than `wireCheckout`/`wireCart` standalone) because the `items` route
 * re-derives line items from a real Cart, whose price in turn comes from a real, published Price —
 * exercising the same server-side price resolution the guest cart surface already relies on.
 *
 * `complete()` for a guest session is a real success path since WP-1 (G-52): the session carries a
 * contact email, `OrderCreationAdapter` resolves a guest customer from it, and an order exists
 * afterwards. (Before WP-1 this suite documented the C-2 rejection instead — see the
 * `docs/plans/BLOCKERS.md` T2.3 entry for the history.)
 */

const clock: Clock = { now: () => new Date("2026-08-29T00:00:00.000Z") };
const staff: Principal = {
  id: "staff-1",
  kind: "staff",
  roles: ["admin"],
  tenantId: "tenant-local",
};

function buildAdmin(): WiredAdmin {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  return wireAdmin({ serializer: new InMemoryEventSerializer(), idGenerator, clock });
}

async function seedPublishedPrice(
  admin: WiredAdmin,
  productId: string,
  amountMinor: number,
  currency = "USD",
): Promise<void> {
  const created = await admin.pricing.createPrice(staff, {
    tenantId: "tenant-local",
    priceListId: "price-list-1",
    productId,
    amountMinor,
    currency,
  });
  if (created.status < 200 || created.status >= 300) {
    throw new Error(
      `seedPublishedPrice: create failed (${created.status}): ${JSON.stringify(created.body)}`,
    );
  }
  const { id } = created.body as { id: string };
  const published = await admin.pricing.publishPrice(staff, {
    tenantId: "tenant-local",
    priceId: id,
  });
  if (published.status < 200 || published.status >= 300) {
    throw new Error(
      `seedPublishedPrice: publish failed (${published.status}): ${JSON.stringify(published.body)}`,
    );
  }
}

interface Response {
  readonly status: number;
  readonly body: unknown;
}

function byPathAndMethod(
  routes: readonly RouteDefinition[],
  method: string,
  path: string,
): RouteDefinition {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (route === undefined) throw new Error(`no route ${method} ${path}`);
  return route;
}

function publicContext(sessionRef?: string) {
  return {
    tenantId: "tenant-local",
    principal: { id: "public", kind: "customer", roles: [] },
    requestId: "req-1",
    headers: sessionRef === undefined ? {} : { "x-cart-session": sessionRef },
  };
}

function routesFor(admin: WiredAdmin) {
  const cart = publicCartRoutes(admin);
  const checkout = publicCheckoutRoutes(admin);

  const createCart = (sessionRef: string, currency = "USD"): Promise<Response> =>
    byPathAndMethod(cart, "POST", "/public/carts").handle({
      body: { sessionRef, currency },
      params: {},
      query: {},
      context: publicContext(),
    } as never) as Promise<Response>;

  const addCartItem = (
    cartId: string,
    sessionRef: string,
    productId: string,
    quantity: number,
  ): Promise<Response> =>
    byPathAndMethod(cart, "POST", "/public/carts/:cartId/items").handle({
      body: { sessionRef, productId, quantity },
      params: { cartId },
      query: {},
      context: publicContext(),
    } as never) as Promise<Response>;

  const start = (body: unknown): Promise<Response> =>
    byPathAndMethod(checkout, "POST", "/public/checkouts").handle({
      body,
      params: {},
      query: {},
      context: publicContext(),
    } as never) as Promise<Response>;

  const get = (checkoutSessionId: string, sessionRef: string | undefined): Promise<Response> =>
    byPathAndMethod(checkout, "GET", "/public/checkouts/:checkoutSessionId").handle({
      body: undefined,
      params: { checkoutSessionId },
      query: {},
      context: publicContext(sessionRef),
    } as never) as Promise<Response>;

  const items = (checkoutSessionId: string, body: unknown): Promise<Response> =>
    byPathAndMethod(checkout, "POST", "/public/checkouts/:checkoutSessionId/items").handle({
      body,
      params: { checkoutSessionId },
      query: {},
      context: publicContext(),
    } as never) as Promise<Response>;

  const billingAddress = (checkoutSessionId: string, body: unknown): Promise<Response> =>
    byPathAndMethod(
      checkout,
      "POST",
      "/public/checkouts/:checkoutSessionId/billing-address",
    ).handle({
      body,
      params: { checkoutSessionId },
      query: {},
      context: publicContext(),
    } as never) as Promise<Response>;

  const shippingAddress = (checkoutSessionId: string, body: unknown): Promise<Response> =>
    byPathAndMethod(
      checkout,
      "POST",
      "/public/checkouts/:checkoutSessionId/shipping-address",
    ).handle({
      body,
      params: { checkoutSessionId },
      query: {},
      context: publicContext(),
    } as never) as Promise<Response>;

  const contact = (checkoutSessionId: string, body: unknown): Promise<Response> =>
    byPathAndMethod(checkout, "POST", "/public/checkouts/:checkoutSessionId/contact").handle({
      body,
      params: { checkoutSessionId },
      query: {},
      context: publicContext(),
    } as never) as Promise<Response>;

  const shippingQuote = (checkoutSessionId: string, body: unknown): Promise<Response> =>
    byPathAndMethod(checkout, "POST", "/public/checkouts/:checkoutSessionId/shipping-quote").handle(
      {
        body,
        params: { checkoutSessionId },
        query: {},
        context: publicContext(),
      } as never,
    ) as Promise<Response>;

  const shippingSelection = (checkoutSessionId: string, body: unknown): Promise<Response> =>
    byPathAndMethod(
      checkout,
      "POST",
      "/public/checkouts/:checkoutSessionId/shipping-selection",
    ).handle({
      body,
      params: { checkoutSessionId },
      query: {},
      context: publicContext(),
    } as never) as Promise<Response>;

  const tax = (checkoutSessionId: string, body: unknown): Promise<Response> =>
    byPathAndMethod(checkout, "POST", "/public/checkouts/:checkoutSessionId/tax").handle({
      body,
      params: { checkoutSessionId },
      query: {},
      context: publicContext(),
    } as never) as Promise<Response>;

  const paymentSelection = (checkoutSessionId: string, body: unknown): Promise<Response> =>
    byPathAndMethod(
      checkout,
      "POST",
      "/public/checkouts/:checkoutSessionId/payment-selection",
    ).handle({
      body,
      params: { checkoutSessionId },
      query: {},
      context: publicContext(),
    } as never) as Promise<Response>;

  const recalculate = (checkoutSessionId: string, body: unknown): Promise<Response> =>
    byPathAndMethod(checkout, "POST", "/public/checkouts/:checkoutSessionId/recalculate").handle({
      body,
      params: { checkoutSessionId },
      query: {},
      context: publicContext(),
    } as never) as Promise<Response>;

  const complete = (checkoutSessionId: string, body: unknown): Promise<Response> =>
    byPathAndMethod(checkout, "POST", "/public/checkouts/:checkoutSessionId/complete").handle({
      body,
      params: { checkoutSessionId },
      query: {},
      context: publicContext(),
    } as never) as Promise<Response>;

  const paymentIntentRequest = (
    checkoutSessionId: string,
    sessionRef: string | undefined,
  ): Promise<Response> =>
    byPathAndMethod(
      checkout,
      "GET",
      "/public/checkouts/:checkoutSessionId/payment-intent-request",
    ).handle({
      body: undefined,
      params: { checkoutSessionId },
      query: {},
      context: publicContext(sessionRef),
    } as never) as Promise<Response>;

  return {
    routes: checkout,
    schemaOf: (method: string, path: string) => byPathAndMethod(checkout, method, path).schema.body,
    createCart,
    addCartItem,
    start,
    get,
    items,
    billingAddress,
    shippingAddress,
    contact,
    shippingQuote,
    shippingSelection,
    tax,
    paymentSelection,
    recalculate,
    complete,
    paymentIntentRequest,
  };
}

function unwrap<T>(response: Response, action: string): T {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${action} failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return response.body as T;
}

const address = {
  line1: "1 Main St",
  city: "Springfield",
  postalCode: "00000",
  country: "US",
};

const seededAdmins = new WeakSet<WiredAdmin>();

/**
 * Drives a guest session all the way to "ready to complete" (items, both addresses, shipping,
 * payment, totals) and — when `email` is given — a contact email. Seeds the one published price the
 * cart needs, once per admin.
 */
async function readyGuestCheckout(rawAdmin: WiredAdmin, sessionRef: string, email?: string) {
  if (!seededAdmins.has(rawAdmin)) {
    await seedPublishedPrice(rawAdmin, "product-1", 1999);
    seededAdmins.add(rawAdmin);
  }
  const admin = routesFor(rawAdmin);
  const cart = unwrap<{ id: string }>(await admin.createCart(sessionRef), "create cart");
  await admin.addCartItem(cart.id, sessionRef, "product-1", 1);
  const started = unwrap<PublicCheckoutSessionDto>(
    await admin.start({ sessionRef, cartRef: cart.id, currency: "USD" }),
    "start checkout",
  );
  const checkoutId = started.id;
  await admin.items(checkoutId, { sessionRef, cartId: cart.id });
  await admin.billingAddress(checkoutId, { sessionRef, ...address });
  await admin.shippingAddress(checkoutId, { sessionRef, ...address });
  await admin.shippingSelection(checkoutId, { sessionRef, method: "standard" });
  await admin.paymentSelection(checkoutId, {
    sessionRef,
    paymentMethodRef: "pm_1",
    provider: "stripe",
  });
  if (email !== undefined)
    unwrap(await admin.contact(checkoutId, { sessionRef, email }), "contact");
  await admin.recalculate(checkoutId, { sessionRef });
  return { admin, checkoutId, sessionRef };
}

async function orderOf(rawAdmin: WiredAdmin, orderId: string): Promise<Order> {
  const response = await rawAdmin.orders.getOrder(staff, { tenantId: "tenant-local", orderId });
  if (response.status !== 200) {
    throw new Error(
      `order ${orderId} not found (${response.status}): ${JSON.stringify(response.body)}`,
    );
  }
  return response.body as Order;
}

async function customerOf(rawAdmin: WiredAdmin, customerId: string): Promise<Customer> {
  const response = await rawAdmin.publicReads.customers.getCustomer({
    tenantId: "tenant-local",
    customerId,
  });
  if (response.status !== 200) {
    throw new Error(`customer ${customerId} not found (${response.status})`);
  }
  return response.body as Customer;
}

function callAuth(
  rawAdmin: WiredAdmin,
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const route = byPathAndMethod(publicAuthRoutes(rawAdmin), method, path);
  return route.handle({
    body: options.body ?? {},
    params: {},
    query: {},
    context: {
      tenantId: "tenant-local",
      principal: { id: "public", kind: "customer", roles: [] },
      requestId: "req-1",
      headers: options.headers ?? {},
    },
  } as never) as Promise<Response>;
}

describe("public checkout routes — route inventory", () => {
  it("exposes exactly the 15 guest-completable routes, all public", () => {
    const admin = routesFor(buildAdmin());
    const paths = admin.routes.map((r) => `${r.method} ${r.path}`).sort();

    expect(paths).toEqual(
      [
        "POST /public/checkouts",
        "GET /public/checkouts/:checkoutSessionId",
        "POST /public/checkouts/:checkoutSessionId/items",
        "POST /public/checkouts/:checkoutSessionId/billing-address",
        "POST /public/checkouts/:checkoutSessionId/shipping-address",
        "POST /public/checkouts/:checkoutSessionId/contact",
        "POST /public/checkouts/:checkoutSessionId/shipping-quote",
        "POST /public/checkouts/:checkoutSessionId/shipping-selection",
        "POST /public/checkouts/:checkoutSessionId/tax",
        "POST /public/checkouts/:checkoutSessionId/payment-selection",
        "POST /public/checkouts/:checkoutSessionId/recalculate",
        "POST /public/checkouts/:checkoutSessionId/complete",
        "GET /public/checkouts/:checkoutSessionId/payment-intent-request",
        // WP-13: which methods the merchant offers, and opening payment for the selected one.
        "GET /public/payment-methods",
        "POST /public/checkouts/:checkoutSessionId/payment",
      ].sort(),
    );
    expect(admin.routes.every((r) => r.public === true)).toBe(true);
    // validate / promotion / lock / expire / fail / order-draft must never appear here.
    expect(
      admin.routes.some((r) =>
        ["validate", "promotion", "lock", "expire", "fail", "order-draft"].some((excluded) =>
          r.path.includes(excluded),
        ),
      ),
    ).toBe(false);
  });
});

describe("public checkout routes — full guest lifecycle", () => {
  it("start → items → addresses → shipping → tax → payment → recalculate → payment-intent-request", async () => {
    const rawAdmin = buildAdmin();
    await seedPublishedPrice(rawAdmin, "product-1", 1999);
    const admin = routesFor(rawAdmin);
    const sessionRef = "session-guest";

    const cart = unwrap<{ id: string }>(await admin.createCart(sessionRef), "create cart");
    await admin.addCartItem(cart.id, sessionRef, "product-1", 2);

    const started = unwrap<PublicCheckoutSessionDto>(
      await admin.start({ sessionRef, cartRef: cart.id, currency: "USD" }),
      "start checkout",
    );
    expect(started.status).toBe("started");
    expect(started.items).toEqual([]);
    expect(started.totals).toBeNull();

    const fetched = unwrap<PublicCheckoutSessionDto>(
      await admin.get(started.id, sessionRef),
      "get checkout",
    );
    expect(fetched.id).toBe(started.id);

    const withItems = unwrap<PublicCheckoutSessionDto>(
      await admin.items(started.id, { sessionRef, cartId: cart.id }),
      "load items",
    );
    expect(withItems.items).toEqual([
      { productId: "product-1", quantity: 2, unitPriceAmountMinor: 1999 },
    ]);

    await admin.billingAddress(started.id, { sessionRef, ...address });
    const withShippingAddress = unwrap<PublicCheckoutSessionDto>(
      await admin.shippingAddress(started.id, { sessionRef, ...address }),
      "set shipping address",
    );
    expect(withShippingAddress.billingAddress).toEqual(address);
    expect(withShippingAddress.shippingAddress).toEqual(address);

    const quoted = unwrap<{ quotes: readonly { method: string; rateAmountMinor: number }[] }>(
      await admin.shippingQuote(started.id, { sessionRef }),
      "shipping quote",
    );
    expect(quoted.quotes).toContainEqual({ method: "standard", rateAmountMinor: 500 });

    const withShipping = unwrap<PublicCheckoutSessionDto>(
      await admin.shippingSelection(started.id, { sessionRef, method: "standard" }),
      "select shipping",
    );
    expect(withShipping.selectedShippingMethod).toBe("standard");

    const taxed = unwrap<{ taxMinor: number }>(await admin.tax(started.id, { sessionRef }), "tax");
    expect(taxed.taxMinor).toBe(400); // 10% of the 3998 subtotal, InMemoryTaxCalculationAdapter

    const withPayment = unwrap<PublicCheckoutSessionDto>(
      await admin.paymentSelection(started.id, {
        sessionRef,
        paymentMethodRef: "pm_1",
        provider: "stripe",
      }),
      "select payment",
    );
    expect(withPayment.status).toBe("started");

    const recalculated = unwrap<PublicCheckoutSessionDto>(
      await admin.recalculate(started.id, { sessionRef }),
      "recalculate",
    );
    expect(recalculated.totals).toEqual({
      subtotalMinor: 3998,
      shippingMinor: 500,
      taxMinor: 400,
      grandTotalMinor: 4898,
    });

    const paymentIntent = unwrap<{ amountMinor: number; currency: string; provider: string }>(
      await admin.paymentIntentRequest(started.id, sessionRef),
      "payment intent request",
    );
    expect(paymentIntent.amountMinor).toBe(4898);
    expect(paymentIntent.currency).toBe("USD");
    expect(paymentIntent.provider).toBe("stripe");
  });

  /**
   * WP-1 (G-52): the pre-WP-1 version of this test asserted `complete()` REJECTED for a guest — the
   * documented C-2 limitation. Guest checkout now completes: the adapter resolves a guest customer
   * from the session's contact email and the order is placed against it.
   */
  it("complete() succeeds for a guest: an order exists, attached to a guest customer resolved from the contact email", async () => {
    const rawAdmin = buildAdmin();
    const { admin, checkoutId, sessionRef } = await readyGuestCheckout(
      rawAdmin,
      "session-guest-complete",
      "guest@example.com",
    );

    const completed = unwrap<PublicCheckoutSessionDto>(
      await admin.complete(checkoutId, { sessionRef, idempotencyKey: "idem-1" }),
      "complete",
    );

    expect(completed.status).toBe("completed");
    expect(completed.orderRef).not.toBeNull();
    const order = await orderOf(rawAdmin, completed.orderRef as string);
    const customer = await customerOf(rawAdmin, order.customerRef);
    expect(customer.isGuest).toBe(true);
    expect(customer.email.value).toBe("guest@example.com");
    expect(customer.consents).toHaveLength(0);
  });

  it("a returning guest reusing the same email attaches to the same customer id", async () => {
    const rawAdmin = buildAdmin();
    const first = await readyGuestCheckout(rawAdmin, "session-return-1", "again@example.com");
    const second = await readyGuestCheckout(rawAdmin, "session-return-2", "AGAIN@example.com");

    const a = unwrap<PublicCheckoutSessionDto>(
      await first.admin.complete(first.checkoutId, {
        sessionRef: first.sessionRef,
        idempotencyKey: "idem-a",
      }),
      "complete first",
    );
    const b = unwrap<PublicCheckoutSessionDto>(
      await second.admin.complete(second.checkoutId, {
        sessionRef: second.sessionRef,
        idempotencyKey: "idem-b",
      }),
      "complete second",
    );

    const orderA = await orderOf(rawAdmin, a.orderRef as string);
    const orderB = await orderOf(rawAdmin, b.orderRef as string);
    expect(a.orderRef).not.toBe(b.orderRef);
    expect(orderB.customerRef).toBe(orderA.customerRef);
  });

  it("complete() without a contact email fails as a ValidationError, which the transport maps to 422 — not a 500", async () => {
    const rawAdmin = buildAdmin();
    const { admin, checkoutId, sessionRef } = await readyGuestCheckout(
      rawAdmin,
      "session-no-email",
    );

    const attempt = admin.complete(checkoutId, { sessionRef, idempotencyKey: "idem-1" });

    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    const thrown = await attempt.catch((error: unknown) => error);
    expect(mapError(thrown).status).toBe(422);
    // ...and no order was created for the failed attempt.
    const fetched = unwrap<PublicCheckoutSessionDto>(
      await admin.get(checkoutId, sessionRef),
      "get checkout",
    );
    expect(fetched.status).toBe("started");
    expect(fetched.orderRef).toBeNull();
  });
});

/**
 * T1.8 — the security half of the WP-1 decision. Resolving a guest's email to an EXISTING customer
 * attaches the order to that customer; it must never confer session access to it. The guest still
 * has no customer identity, and no route starts answering as that customer. The transport-level
 * half of this (the real pipeline's anonymous, tenant-bound principal, ADR-0015) is in
 * `guest-checkout.e2e.test.ts`.
 */
describe("public checkout routes — a guest cannot escalate through a registered customer's email (T1.8)", () => {
  const VICTIM = { email: "victim@example.com", name: "Vera Victim", password: "correct-horse" };

  async function registerVictim(rawAdmin: WiredAdmin): Promise<string> {
    const registered = (await callAuth(rawAdmin, "POST", "/public/auth/register", {
      body: VICTIM,
    })) as Response;
    if (registered.status < 200 || registered.status >= 300) {
      throw new Error(`register failed (${registered.status}): ${JSON.stringify(registered.body)}`);
    }
    const found = await rawAdmin.publicReads.customers.listCustomers({
      tenantId: "tenant-local",
      search: VICTIM.email,
    });
    const items = (found.body as { items: readonly Customer[] }).items;
    const id = items[0]?.id.toString();
    if (id === undefined) throw new Error("victim was not registered");
    return id;
  }

  it("the order attaches to the victim, but the guest session gains no identity and every customer-scoped route stays 401", async () => {
    const rawAdmin = buildAdmin();
    const victimId = await registerVictim(rawAdmin);
    const { admin, checkoutId, sessionRef } = await readyGuestCheckout(
      rawAdmin,
      "session-attacker",
      VICTIM.email,
    );

    const completed = unwrap<PublicCheckoutSessionDto>(
      await admin.complete(checkoutId, { sessionRef, idempotencyKey: "idem-1" }),
      "complete",
    );

    // Attached to the existing customer — and the registered customer was not touched.
    const order = await orderOf(rawAdmin, completed.orderRef as string);
    expect(order.customerRef).toBe(victimId);
    const victim = await customerOf(rawAdmin, victimId);
    expect(victim.isGuest).toBe(false);
    expect(victim.name).toBe(VICTIM.name);

    // The guest checkout session itself still has no customer identity.
    const session = (
      await rawAdmin.publicReads.checkout.get({
        tenantId: "tenant-local",
        checkoutSessionId: checkoutId,
      })
    ).body as CheckoutSession;
    expect(session.customerRef).toBeUndefined();
    expect(session.isGuest).toBe(true);

    // Every way of presenting itself as that customer is still refused.
    const attempts: Record<string, string>[] = [
      { "x-cart-session": sessionRef },
      { "x-customer-session": sessionRef },
      { "x-customer-session": checkoutId },
      { "x-customer-session": completed.orderRef as string },
      { "x-customer-session": victimId },
      { "x-customer-session": VICTIM.email },
    ];
    for (const headers of attempts) {
      const me = await callAuth(rawAdmin, "GET", "/public/auth/me", { headers });
      expect(me.status).toBe(401);
    }
    // Customer-scoped surfaces beyond /me are equally closed to that session.
    for (const [routes, path] of [
      [publicLoyaltyRoutes(rawAdmin), "/public/loyalty/accounts/me"],
      [publicWishlistRoutes(rawAdmin), "/public/wishlists/me"],
    ] as const) {
      const route = byPathAndMethod(routes, "GET", path);
      const response = (await route.handle({
        body: undefined,
        params: {},
        query: {},
        context: publicContext(sessionRef),
      } as never)) as Response;
      expect(response.status).toBe(401);
    }
  });

  it("nothing on the completed session's wire shape exposes the victim's customer id, name or history", async () => {
    const rawAdmin = buildAdmin();
    const victimId = await registerVictim(rawAdmin);
    const { admin, checkoutId, sessionRef } = await readyGuestCheckout(
      rawAdmin,
      "session-attacker-2",
      VICTIM.email,
    );

    const completed = await admin.complete(checkoutId, { sessionRef, idempotencyKey: "idem-1" });
    const fetched = await admin.get(checkoutId, sessionRef);

    for (const response of [completed, fetched]) {
      const wire = JSON.stringify(response.body);
      expect(wire).not.toContain(victimId);
      expect(wire).not.toContain(VICTIM.name);
      expect(Object.keys(response.body as object)).not.toContain("customerRef");
    }
  });

  it("knowing the victim's email grants no access to their checkout sessions — ownership stays sessionRef-based", async () => {
    const rawAdmin = buildAdmin();
    await registerVictim(rawAdmin);
    const victimCheckout = await readyGuestCheckout(rawAdmin, "session-victim", VICTIM.email);
    const attacker = await readyGuestCheckout(rawAdmin, "session-attacker-3", VICTIM.email);

    expect((await attacker.admin.get(victimCheckout.checkoutId, attacker.sessionRef)).status).toBe(
      404,
    );
  });
});

describe("public checkout routes — ownership", () => {
  async function startedSession(admin: WiredAdmin, sessionRef: string): Promise<string> {
    const routes = routesFor(admin);
    const cart = unwrap<{ id: string }>(await routes.createCart(sessionRef), "create cart");
    const started = unwrap<PublicCheckoutSessionDto>(
      await routes.start({ sessionRef, cartRef: cart.id, currency: "USD" }),
      "start checkout",
    );
    return started.id;
  }

  it("session B cannot read session A's checkout — resolves to 404, not 403", async () => {
    const rawAdmin = buildAdmin();
    const checkoutSessionId = await startedSession(rawAdmin, "session-a");
    const admin = routesFor(rawAdmin);

    const response = await admin.get(checkoutSessionId, "session-b");

    expect(response.status).toBe(404);
  });

  it("session B cannot mutate session A's checkout — every write route 404s", async () => {
    const rawAdmin = buildAdmin();
    const checkoutSessionId = await startedSession(rawAdmin, "session-a");
    const admin = routesFor(rawAdmin);

    const results = await Promise.all([
      admin.items(checkoutSessionId, { sessionRef: "session-b", cartId: "any" }),
      admin.billingAddress(checkoutSessionId, { sessionRef: "session-b", ...address }),
      admin.shippingAddress(checkoutSessionId, { sessionRef: "session-b", ...address }),
      admin.contact(checkoutSessionId, { sessionRef: "session-b", email: "a@example.com" }),
      admin.shippingQuote(checkoutSessionId, { sessionRef: "session-b" }),
      admin.shippingSelection(checkoutSessionId, { sessionRef: "session-b", method: "standard" }),
      admin.tax(checkoutSessionId, { sessionRef: "session-b" }),
      admin.paymentSelection(checkoutSessionId, {
        sessionRef: "session-b",
        paymentMethodRef: "pm_1",
        provider: "stripe",
      }),
      admin.recalculate(checkoutSessionId, { sessionRef: "session-b" }),
      admin.complete(checkoutSessionId, { sessionRef: "session-b", idempotencyKey: "idem-1" }),
    ]);

    for (const result of results) {
      expect(result.status).toBe(404);
    }
  });

  it("an unknown checkoutSessionId and a cross-owned id return byte-identical 404 envelopes", async () => {
    const rawAdmin = buildAdmin();
    const checkoutSessionId = await startedSession(rawAdmin, "session-a");
    const admin = routesFor(rawAdmin);

    const unknown = await admin.get("no-such-session", "session-b");
    const crossOwned = await admin.get(checkoutSessionId, "session-b");

    expect(unknown.status).toBe(404);
    expect(crossOwned.status).toBe(404);
    expect(JSON.stringify(unknown.body)).toBe(JSON.stringify(crossOwned.body));
  });

  it("a cart owned by another session cannot be loaded into the caller's checkout session", async () => {
    const rawAdmin = buildAdmin();
    await seedPublishedPrice(rawAdmin, "product-1", 500);
    const admin = routesFor(rawAdmin);
    const victimCart = unwrap<{ id: string }>(
      await admin.createCart("session-victim"),
      "victim cart",
    );
    await admin.addCartItem(victimCart.id, "session-victim", "product-1", 1);
    const attackerCart = unwrap<{ id: string }>(
      await admin.createCart("session-attacker"),
      "attacker cart",
    );
    const started = unwrap<PublicCheckoutSessionDto>(
      await admin.start({
        sessionRef: "session-attacker",
        cartRef: attackerCart.id,
        currency: "USD",
      }),
      "start checkout",
    );

    const response = await admin.items(started.id, {
      sessionRef: "session-attacker",
      cartId: victimCart.id,
    });

    expect(response.status).toBe(404);
  });
});

describe("public checkout routes — sessionRef is required", () => {
  it("GET without a sessionRef (header or query) rejects", async () => {
    const rawAdmin = buildAdmin();
    const checkoutSessionId = await (async () => {
      const admin = routesFor(rawAdmin);
      const cart = unwrap<{ id: string }>(await admin.createCart("session-a"), "create cart");
      const started = unwrap<PublicCheckoutSessionDto>(
        await admin.start({ sessionRef: "session-a", cartRef: cart.id, currency: "USD" }),
        "start checkout",
      );
      return started.id;
    })();
    const admin = routesFor(rawAdmin);

    await expect(admin.get(checkoutSessionId, undefined)).rejects.toThrow();
  });

  it("the sessionRefOnlyBody-backed schema (e.g. tax) rejects a body with no sessionRef", () => {
    const admin = routesFor(buildAdmin());
    const schema = admin.schemaOf("POST", "/public/checkouts/:checkoutSessionId/tax");

    const result = schema?.safeParse({}) as { success: boolean } | undefined;

    expect(result?.success).toBe(false);
  });
});

describe("public checkout routes — no forged amounts or spoofed identity (.strict())", () => {
  it("POST /public/checkouts rejects a body carrying customerRef", () => {
    const admin = routesFor(buildAdmin());
    const schema = admin.schemaOf("POST", "/public/checkouts");

    const result = schema?.safeParse({
      sessionRef: "session-a",
      cartRef: "cart-1",
      currency: "USD",
      customerRef: "someone-elses-customer-id",
    }) as { success: boolean } | undefined;

    expect(result?.success).toBe(false);
  });

  it("POST /public/checkouts still accepts the legitimate guest shape", () => {
    const admin = routesFor(buildAdmin());
    const schema = admin.schemaOf("POST", "/public/checkouts");

    const result = schema?.safeParse({
      sessionRef: "session-a",
      cartRef: "cart-1",
      currency: "USD",
    }) as { success: boolean } | undefined;

    expect(result?.success).toBe(true);
  });

  it("items rejects a body carrying line items or prices", () => {
    const admin = routesFor(buildAdmin());
    const schema = admin.schemaOf("POST", "/public/checkouts/:checkoutSessionId/items");

    const result = schema?.safeParse({
      sessionRef: "session-a",
      cartId: "cart-1",
      items: [{ productId: "p1", quantity: 1, unitPriceAmountMinor: 1, currency: "USD" }],
    }) as { success: boolean } | undefined;

    expect(result?.success).toBe(false);
  });

  it("shipping-selection rejects a body carrying rateAmountMinor", () => {
    const admin = routesFor(buildAdmin());
    const schema = admin.schemaOf(
      "POST",
      "/public/checkouts/:checkoutSessionId/shipping-selection",
    );

    const result = schema?.safeParse({
      sessionRef: "session-a",
      method: "standard",
      rateAmountMinor: 1,
    }) as { success: boolean } | undefined;

    expect(result?.success).toBe(false);
  });

  it("shipping-selection still accepts the legitimate shape (method only)", () => {
    const admin = routesFor(buildAdmin());
    const schema = admin.schemaOf(
      "POST",
      "/public/checkouts/:checkoutSessionId/shipping-selection",
    );

    const result = schema?.safeParse({ sessionRef: "session-a", method: "standard" }) as
      { success: boolean } | undefined;

    expect(result?.success).toBe(true);
  });
});

describe("public checkout routes — DTO boundary", () => {
  it("never puts aggregate internals or sessionRef on the wire", async () => {
    const rawAdmin = buildAdmin();
    const admin = routesFor(rawAdmin);
    const cart = unwrap<{ id: string }>(await admin.createCart("session-1"), "create cart");
    const started = unwrap<PublicCheckoutSessionDto>(
      await admin.start({ sessionRef: "session-1", cartRef: cart.id, currency: "USD" }),
      "start checkout",
    );

    const serialized = JSON.stringify(await admin.get(started.id, "session-1"));

    for (const leak of ["props", "_id", "_domainEvents", "_version", "sessionRef"]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("returns 404 for a checkout session that doesn't exist", async () => {
    const admin = routesFor(buildAdmin());

    const response = await admin.get("missing-session", "any-session");

    expect(response.status).toBe(404);
  });
});

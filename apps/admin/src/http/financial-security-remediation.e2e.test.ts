import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RefundVerificationPort } from "@platform/returns";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin, type AdminWiringDeps, type WiredAdmin } from "../composition";
import { adminRoutes } from "./admin-routes";
import { cartRoutes } from "./cart-routes";
import { checkoutRoutes } from "./checkout-routes";
import { paymentsRoutes } from "./payments-routes";

/**
 * Phase A.1 — Financial Security Audit exploit-proof + regression suite.
 *
 * Covers the 4 authenticated privilege-boundary defects confirmed by the audit: F-01 (shipping
 * rate tampering), F-02 (order total tampering), F-03 (payment-intent amount tampering), F-04
 * (refund amount tampering). Drives the REAL `wireAdmin()` composition (in-memory branch) through
 * the actual `RouteDefinition.handle()` boundary — same technique
 * `cart-checkout-pricing-security.e2e.test.ts` used for Phase 17.2. Every attack authenticates as
 * an ordinary `kind: "customer"` principal for F-01/F-02/F-03 (Checkout/Orders/Payments have no
 * staff-only gate under `AllowAllAccessControl`); F-04 uses a `kind: "staff"` principal since
 * `returns:resolution` is, by its own domain comments, a staff decision — the point of F-04 is
 * that even a *privileged* caller must not be able to assert an arbitrary refund amount.
 */

const clock: Clock = { now: () => new Date("2026-08-10T00:00:00.000Z") };

function buildAdmin(extra?: Partial<AdminWiringDeps>): WiredAdmin {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  return wireAdmin({ serializer: new InMemoryEventSerializer(), idGenerator, clock, ...extra });
}

const customer: Principal = { id: "customer-1", kind: "customer", roles: [] };
const staff: Principal = { id: "staff-1", kind: "staff", roles: ["admin"] };

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

function call(
  route: RouteDefinition,
  principal: Principal,
  params: Record<string, string>,
  body: unknown,
): Promise<Response> {
  return route.handle({
    body,
    params,
    query: {},
    context: { tenantId: "tenant-local", principal, requestId: "req-1" },
  } as never) as Promise<Response>;
}

function unwrap<T>(response: Response, action: string): T {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${action} failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return response.body as T;
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
  const published = await admin.pricing.publishPrice(staff, {
    tenantId: "tenant-local",
    priceId: (created.body as { id: string }).id,
  });
  if (published.status < 200 || published.status >= 300) {
    throw new Error(
      `seedPublishedPrice: publish failed (${published.status}): ${JSON.stringify(published.body)}`,
    );
  }
}

const ADDRESS = { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" };

/** Builds a real checkout session through `recalculate` (items loaded from a real Cart, both addresses set) — everything F-01/F-02's setup needs, short of shipping/payment selection. */
async function buildRecalculatedCheckout(
  admin: WiredAdmin,
  productId: string,
  quantity: number,
): Promise<{ checkoutSessionId: string }> {
  // Cart's own price-forgery boundary was already closed by Phase 17.2 — `addItem` there resolves
  // price server-side (`resolvePrice()`) only at the HTTP-route layer, not on the admin-controller
  // method directly, so this setup goes through the real `cart-routes.ts` route handlers.
  const cart = cartRoutes(admin);
  const createCart = byPathAndMethod(cart, "POST", "/carts");
  const addItem = byPathAndMethod(cart, "POST", "/carts/:cartId/items");
  const cartCreated = unwrap<{ cartId: string }>(
    await call(createCart, customer, {}, { sessionRef: "session-1", currency: "USD" }),
    "create cart",
  );
  unwrap(
    await call(addItem, customer, { cartId: cartCreated.cartId }, { productId, quantity }),
    "add item",
  );

  // Checkout's own price-forgery boundary was already closed by Phase 17.2 — `loadItems` re-derives
  // items from the named Cart only at the HTTP-route layer, so this setup goes through the real
  // `checkout-routes.ts` route handlers for `start`/`loadItems` too.
  const checkout = checkoutRoutes(admin);
  const start = byPathAndMethod(checkout, "POST", "/checkouts");
  const loadItems = byPathAndMethod(checkout, "POST", "/checkouts/:checkoutSessionId/items");
  const started = unwrap<{ checkoutSessionId: string }>(
    await call(
      start,
      customer,
      {},
      {
        cartRef: cartCreated.cartId,
        sessionRef: "session-1",
        currency: "USD",
      },
    ),
    "start checkout",
  );
  const checkoutSessionId = started.checkoutSessionId;
  unwrap(
    await call(loadItems, customer, { checkoutSessionId }, { cartId: cartCreated.cartId }),
    "load items",
  );
  unwrap(
    await admin.checkout.setBillingAddress(customer, { checkoutSessionId, ...ADDRESS }),
    "set billing address",
  );
  unwrap(
    await admin.checkout.setShippingAddress(customer, { checkoutSessionId, ...ADDRESS }),
    "set shipping address",
  );
  return { checkoutSessionId };
}

describe("Phase A.1 — F-01: Checkout shipping rate is always re-derived from a real quote", () => {
  it("legitimate flow: the standard-method rate (500) is the one applied to totals", async () => {
    const admin = buildAdmin();
    await seedPublishedPrice(admin, "product-1", 1999, "USD");
    const { checkoutSessionId } = await buildRecalculatedCheckout(admin, "product-1", 1);

    const selected = unwrap<{ checkoutSessionId: string }>(
      await admin.checkout.selectShipping(customer, { checkoutSessionId, method: "standard" }),
      "select shipping",
    );
    expect(selected.checkoutSessionId).toBe(checkoutSessionId);

    unwrap(await admin.checkout.recalculateTotals(customer, { checkoutSessionId }), "recalculate");
    const draft = unwrap<{ totals: { shippingMinor: number; totalMinor: number } }>(
      await admin.checkout.generateOrderDraft(customer, { checkoutSessionId }),
      "generate order draft",
    );
    expect(draft.totals.shippingMinor).toBe(500);
    expect(draft.totals.totalMinor).toBe(1999 + 500);
  });

  it("Attack (F-01): a forged rateAmountMinor smuggled past Zod is ignored — the real quoted rate is used instead", async () => {
    const admin = buildAdmin();
    await seedPublishedPrice(admin, "product-1", 1999, "USD");
    const { checkoutSessionId } = await buildRecalculatedCheckout(admin, "product-1", 1);
    const routes = checkoutRoutes(admin);
    const selectShipping = byPathAndMethod(
      routes,
      "POST",
      "/checkouts/:checkoutSessionId/shipping-selection",
    );
    const recalc = byPathAndMethod(routes, "POST", "/checkouts/:checkoutSessionId/recalculate");
    const orderDraft = byPathAndMethod(routes, "GET", "/checkouts/:checkoutSessionId/order-draft");

    // Bypasses Zod entirely — the real HTTP boundary would 422 this (see the schema-level test
    // below); this proves the *handler/use-case* itself never reads a caller-supplied rate.
    const selected = await call(
      selectShipping,
      customer,
      { checkoutSessionId },
      {
        method: "standard",
        rateAmountMinor: 1,
        currency: "USD",
      },
    );
    expect(selected.status).toBe(200);

    unwrap(await call(recalc, customer, { checkoutSessionId }, undefined), "recalculate");
    const draft = unwrap<{ totals: { shippingMinor: number; totalMinor: number } }>(
      await call(orderDraft, customer, { checkoutSessionId }, undefined),
      "order draft",
    );

    // PROOF: the forged 1-cent shipping rate never reached totals — the real quoted rate (500) did.
    expect(draft.totals.shippingMinor).toBe(500);
    expect(draft.totals.shippingMinor).not.toBe(1);
    expect(draft.totals.totalMinor).toBe(1999 + 500);
  });

  it("an unknown/unavailable shipping method is rejected (422), never silently priced at 0", async () => {
    const admin = buildAdmin();
    await seedPublishedPrice(admin, "product-1", 1999, "USD");
    const { checkoutSessionId } = await buildRecalculatedCheckout(admin, "product-1", 1);

    const selected = await admin.checkout.selectShipping(customer, {
      checkoutSessionId,
      method: "teleportation",
    });
    expect(selected.status).toBe(422);
  });

  it("schema-level rejection: a real HTTP request carrying rateAmountMinor/currency fails Zod validation", () => {
    const routes = checkoutRoutes(buildAdmin());
    const schema = byPathAndMethod(
      routes,
      "POST",
      "/checkouts/:checkoutSessionId/shipping-selection",
    ).schema?.body;
    expect(
      schema?.safeParse({ method: "standard", rateAmountMinor: 1, currency: "USD" }).success,
    ).toBe(false);
    expect(schema?.safeParse({ method: "standard" }).success).toBe(true);
  });
});

describe("Phase A.1 — F-02: order total is always re-derived from Checkout's order draft", () => {
  async function buildOrderDraftReadyCheckout(admin: WiredAdmin) {
    await seedPublishedPrice(admin, "product-1", 1999, "USD");
    const { checkoutSessionId } = await buildRecalculatedCheckout(admin, "product-1", 2);
    unwrap(
      await admin.checkout.selectShipping(customer, { checkoutSessionId, method: "standard" }),
      "select shipping",
    );
    unwrap(await admin.checkout.recalculateTotals(customer, { checkoutSessionId }), "recalculate");
    return checkoutSessionId;
  }

  const REAL_TOTAL = 1999 * 2 + 500;

  it("legitimate flow: the created order's total matches Checkout's real, recalculated total", async () => {
    const admin = buildAdmin();
    const checkoutSessionId = await buildOrderDraftReadyCheckout(admin);
    const createFromCheckout = byPathAndMethod(adminRoutes(admin), "POST", "/orders/from-checkout");

    const created = unwrap<{ orderId: string }>(
      await call(
        createFromCheckout,
        customer,
        {},
        {
          checkoutRef: checkoutSessionId,
          customerRef: "customer-1",
          currency: "USD",
          items: [{ productId: "product-1", name: "Toy", unitPriceAmountMinor: 1999, quantity: 2 }],
          billingAddress: ADDRESS,
          shippingAddress: ADDRESS,
        },
      ),
      "create order from checkout",
    );

    const fetched = unwrap<{ totalAmount(): { amountMinor: number; currency: string } }>(
      await admin.orders.getOrder(customer, { tenantId: "tenant-local", orderId: created.orderId }),
      "get order",
    );
    expect(fetched.totalAmount().amountMinor).toBe(REAL_TOTAL);
  });

  it("Attack (F-02): a forged totals.totalMinor smuggled past Zod never becomes the order's captured amount", async () => {
    const admin = buildAdmin();
    const checkoutSessionId = await buildOrderDraftReadyCheckout(admin);
    const routes = adminRoutes(admin);
    const createFromCheckout = byPathAndMethod(routes, "POST", "/orders/from-checkout");

    // Bypasses Zod entirely (the field no longer even exists in the accepted schema — see the
    // schema-level test below) — proves the handler itself never reads a caller-supplied totals.
    const created = await call(
      createFromCheckout,
      customer,
      {},
      {
        checkoutRef: checkoutSessionId,
        customerRef: "customer-1",
        currency: "USD",
        items: [{ productId: "product-1", name: "Toy", unitPriceAmountMinor: 1999, quantity: 2 }],
        billingAddress: ADDRESS,
        shippingAddress: ADDRESS,
        totals: {
          subtotalMinor: 1,
          taxMinor: 0,
          shippingMinor: 0,
          discountMinor: 0,
          totalMinor: 1,
        },
      },
    );
    expect(created.status).toBe(201);
    const orderId = (created.body as { orderId: string }).orderId;

    const fetched = unwrap<{ totalAmount(): { amountMinor: number; currency: string } }>(
      await admin.orders.getOrder(customer, { tenantId: "tenant-local", orderId }),
      "get order",
    );

    // PROOF: the forged 1-cent total never reached the order's captured amount.
    expect(fetched.totalAmount().amountMinor).toBe(REAL_TOTAL);
    expect(fetched.totalAmount().amountMinor).not.toBe(1);
  });

  it("schema-level rejection: a real HTTP request carrying totals fails Zod validation", () => {
    const routes = adminRoutes(buildAdmin());
    const schema = byPathAndMethod(routes, "POST", "/orders/from-checkout").schema?.body;
    expect(
      schema?.safeParse({
        checkoutRef: "c-1",
        customerRef: "cust-1",
        currency: "USD",
        items: [{ productId: "p-1", name: "Toy", unitPriceAmountMinor: 1999, quantity: 1 }],
        billingAddress: ADDRESS,
        shippingAddress: ADDRESS,
        totals: {
          subtotalMinor: 1,
          taxMinor: 0,
          shippingMinor: 0,
          discountMinor: 0,
          totalMinor: 1,
        },
      }).success,
    ).toBe(false);
  });
});

describe("Phase A.1 — F-03: payment-intent amount is always re-derived from the Order", () => {
  async function buildRealOrder(
    admin: WiredAdmin,
  ): Promise<{ orderId: string; realAmountMinor: number }> {
    await seedPublishedPrice(admin, "product-1", 1999, "USD");
    const { checkoutSessionId } = await buildRecalculatedCheckout(admin, "product-1", 1);
    unwrap(
      await admin.checkout.selectShipping(customer, { checkoutSessionId, method: "standard" }),
      "select shipping",
    );
    unwrap(await admin.checkout.recalculateTotals(customer, { checkoutSessionId }), "recalculate");

    const createFromCheckout = byPathAndMethod(adminRoutes(admin), "POST", "/orders/from-checkout");
    const created = unwrap<{ orderId: string }>(
      await call(
        createFromCheckout,
        customer,
        {},
        {
          checkoutRef: checkoutSessionId,
          customerRef: "customer-1",
          currency: "USD",
          items: [{ productId: "product-1", name: "Toy", unitPriceAmountMinor: 1999, quantity: 1 }],
          billingAddress: ADDRESS,
          shippingAddress: ADDRESS,
        },
      ),
      "create order from checkout",
    );
    return { orderId: created.orderId, realAmountMinor: 1999 + 500 };
  }

  it("legitimate flow: the opened intent's amount matches the order's real total", async () => {
    const admin = buildAdmin();
    const { orderId, realAmountMinor } = await buildRealOrder(admin);
    const createIntent = byPathAndMethod(paymentsRoutes(admin), "POST", "/payment-intents");

    const opened = unwrap<{ paymentIntentId: string }>(
      await call(createIntent, customer, {}, { orderRef: orderId }),
      "create intent",
    );
    const fetched = unwrap<{ amount: { amountMinor: number; currency: string } }>(
      await admin.payments.getPaymentIntent(customer, {
        tenantId: "tenant-local",
        paymentIntentId: opened.paymentIntentId,
      }),
      "get intent",
    );
    expect(fetched.amount.amountMinor).toBe(realAmountMinor);
    expect(fetched.amount.currency).toBe("USD");
  });

  it("Attack (F-03): a forged amountMinor/currency smuggled past Zod never determines the intent's amount", async () => {
    const admin = buildAdmin();
    const { orderId, realAmountMinor } = await buildRealOrder(admin);
    const routes = paymentsRoutes(admin);
    const createIntent = byPathAndMethod(routes, "POST", "/payment-intents");

    // Bypasses Zod entirely (the fields no longer exist in the accepted schema — see the
    // schema-level test below) — proves the handler itself never reads a caller-supplied amount.
    const opened = await call(
      createIntent,
      customer,
      {},
      {
        orderRef: orderId,
        amountMinor: 1,
        currency: "EUR",
      },
    );
    expect(opened.status).toBe(201);
    const paymentIntentId = (opened.body as { paymentIntentId: string }).paymentIntentId;

    const fetched = unwrap<{ amount: { amountMinor: number; currency: string } }>(
      await admin.payments.getPaymentIntent(customer, {
        tenantId: "tenant-local",
        paymentIntentId,
      }),
      "get intent",
    );

    // PROOF: the forged 1-cent EUR amount never reached the payment intent.
    expect(fetched.amount.amountMinor).toBe(realAmountMinor);
    expect(fetched.amount.currency).toBe("USD");
  });

  it("schema-level rejection: a real HTTP request carrying amountMinor/currency fails Zod validation", () => {
    const routes = paymentsRoutes(buildAdmin());
    const schema = byPathAndMethod(routes, "POST", "/payment-intents").schema?.body;
    expect(
      schema?.safeParse({ orderRef: "order-1", amountMinor: 1, currency: "USD" }).success,
    ).toBe(false);
    expect(schema?.safeParse({ orderRef: "order-1" }).success).toBe(true);
  });
});

describe("Phase A.1 — F-04: Returns refund amount is bounded when a refundable-ceiling check is wired", () => {
  async function buildAcceptedReturn(admin: WiredAdmin): Promise<string> {
    const created = unwrap<{ returnId: string }>(
      await admin.returns.create(staff, {
        orderRef: "order-1",
        items: [
          {
            orderItemRef: "order-item-1",
            productRef: "product-1",
            quantity: 1,
            reasonCode: "defective",
          },
        ],
      }),
      "create return",
    );
    const returnId = created.returnId;
    unwrap(await admin.returns.decision(staff, { returnId, approved: true }), "decision");
    unwrap(await admin.returns.rma(staff, { returnId, rmaNumber: "RMA-1" }), "rma");
    unwrap(
      await admin.returns.receive(staff, { returnId, source: "warehouse-1", callbackId: "cb-1" }),
      "receive",
    );
    unwrap(
      await admin.returns.inspection(staff, { returnId, itemRef: "order-item-1", passed: true }),
      "inspection",
    );
    unwrap(
      await admin.returns.advance(staff, { returnId, toStatus: "inspection_completed" }),
      "advance to inspection_completed",
    );
    unwrap(
      await admin.returns.accept(staff, {
        returnId,
        items: [{ orderItemRef: "order-item-1", disposition: "restock" }],
      }),
      "accept",
    );
    return returnId;
  }

  const REFUNDABLE_CEILING_MINOR = 1999;

  /** A strict fake standing in for a real Payments/Orders-backed refundable-amount check. */
  const strictRefundVerification: RefundVerificationPort = {
    isRefundable: async (_orderRef, amountMinor, currency) =>
      amountMinor <= REFUNDABLE_CEILING_MINOR && currency === "USD",
  };

  it("Attack (F-04, documented residual risk): with no refundable-ceiling check wired (this repo's default composition, since no real Payments adapter exists yet), an unbounded refund amount is still accepted", async () => {
    const admin = buildAdmin(); // no refundVerification supplied
    const returnId = await buildAcceptedReturn(admin);

    const resolved = await admin.returns.resolution(staff, {
      returnId,
      outcome: "refund",
      amountMinor: 999_999_999,
      currency: "USD",
    });

    // This is the trust-boundary defect: DecideResolution forwards whatever amount the caller
    // asserts. See the report's F-04 remediation + Remaining Risks — the fix adds the hook and
    // proves it works (below), but does not itself change the *default*, unwired behavior.
    expect(resolved.status).toBe(200);
    expect((resolved.body as { status: string }).status).toBe("refund_requested");
  });

  it("Regression (F-04): with a refundable-ceiling check wired, a refund above the ceiling is rejected before Payments is ever asked", async () => {
    const admin = buildAdmin({ refundVerification: strictRefundVerification });
    const returnId = await buildAcceptedReturn(admin);

    const resolved = await admin.returns.resolution(staff, {
      returnId,
      outcome: "refund",
      amountMinor: REFUNDABLE_CEILING_MINOR + 1,
      currency: "USD",
    });

    expect(resolved.status).toBe(422);
  });

  it("Regression (F-04): with a refundable-ceiling check wired, a refund at or under the ceiling still succeeds", async () => {
    const admin = buildAdmin({ refundVerification: strictRefundVerification });
    const returnId = await buildAcceptedReturn(admin);

    const resolved = await admin.returns.resolution(staff, {
      returnId,
      outcome: "refund",
      amountMinor: REFUNDABLE_CEILING_MINOR,
      currency: "USD",
    });

    expect(resolved.status).toBe(200);
    expect((resolved.body as { status: string }).status).toBe("refund_requested");
  });

  it("non-refund outcomes (replacement/repair) are never gated by the refundable-ceiling check", async () => {
    const admin = buildAdmin({ refundVerification: strictRefundVerification });
    const returnId = await buildAcceptedReturn(admin);

    const resolved = await admin.returns.resolution(staff, { returnId, outcome: "replacement" });
    expect(resolved.status).toBe(200);
  });
});

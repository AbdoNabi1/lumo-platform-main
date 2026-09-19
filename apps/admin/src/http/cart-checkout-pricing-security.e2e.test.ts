import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import type { OrderCreationPort } from "@platform/checkout";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireAdmin, type AdminWiringDeps, type WiredAdmin } from "../composition";
import { cartRoutes } from "./cart-routes";
import { checkoutRoutes } from "./checkout-routes";
import type { RouteDefinition } from "@platform/http";

/**
 * Phase 17.2 — Authenticated Cart & Checkout pricing-manipulation regression suite.
 *
 * Drives the REAL `wireAdmin()` composition (in-memory branch) through the actual
 * `RouteDefinition.handle()` boundary for `cart-routes.ts` and `checkout-routes.ts` — same
 * technique `public-cart-routes.test.ts` used for H-01, extended to the admin-authenticated
 * surface and to Checkout's `loadItems` → `recalculateTotals` → `generatePaymentIntentRequest`
 * chain. Every attack authenticates as an ordinary `kind: "customer"` principal (never `"staff"`),
 * since `AllowAllAccessControl` (ADR-0007, permissive until Phase 2) does not currently
 * distinguish an admin/backoffice operator from any other authenticated caller — see the Phase
 * 17.2 security audit report for the full trust-boundary analysis.
 *
 * Every "attack" test below calls the route handler directly, bypassing Zod (this repo's own
 * established pattern — `public-cart-routes.test.ts` does the same) — so these tests prove the
 * *handler* ignores forged monetary fields, not merely that Zod's `.strict()` would reject them
 * over real HTTP. A companion schema-level test proves the `.strict()` rejection too.
 */

const clock: Clock = { now: () => new Date("2026-08-10T00:00:00.000Z") };

function buildAdmin(overrides: Partial<AdminWiringDeps> = {}): WiredAdmin {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  return wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    tenantId: "tenant-local",
    ...overrides,
  });
}

/** Records calls and returns a fixed `orderRef` — proves the C-2 wiring without a real Orders adapter (a separate task). */
class FakeOrderCreationPort implements OrderCreationPort {
  callCount = 0;

  async create(): Promise<{ readonly orderRef: string }> {
    this.callCount += 1;
    return { orderRef: "order-fake-1" };
  }
}

/** The attacker: an ordinary authenticated customer — never granted any staff/admin role. */
const attacker: Principal = { id: "customer-attacker", kind: "customer", roles: [] };
/** A second, distinct customer identity — used for the cross-user cart-access check. */
const victim: Principal = { id: "customer-victim", kind: "customer", roles: [] };
/** Used only to seed price fixtures — any principal works under the current stub guard. */
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

async function createPrice(
  admin: WiredAdmin,
  productId: string,
  amountMinor: number,
  currency = "USD",
): Promise<string> {
  const created = await admin.pricing.createPrice(staff, {
    tenantId: "tenant-local",
    priceListId: "price-list-1",
    productId,
    amountMinor,
    currency,
  });
  if (created.status < 200 || created.status >= 300) {
    throw new Error(`createPrice failed (${created.status}): ${JSON.stringify(created.body)}`);
  }
  return (created.body as { id: string }).id;
}

/** Creates and publishes a real `Price` through the admin Pricing facade (never fabricated repository state). */
async function seedPublishedPrice(
  admin: WiredAdmin,
  productId: string,
  amountMinor: number,
  currency = "USD",
): Promise<void> {
  const id = await createPrice(admin, productId, amountMinor, currency);
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

/**
 * Registers a warehouse and receives stock through the admin Inventory facade (Phase 3 Task 10) —
 * `validate` below now runs the REAL `InventoryValidationAdapter`, which requires exactly one
 * warehouse to be registered (the adapter's disclosed single-warehouse-tenant limitation) before
 * it will check any product's stock at all. Never fabricates repository state directly, same
 * convention as `seedPublishedPrice` above.
 */
async function seedInventory(
  admin: WiredAdmin,
  productId: string,
  quantity: number,
): Promise<void> {
  const registered = await admin.inventory.registerWarehouse(staff, {
    tenantId: "tenant-local",
    code: "wh-1",
    name: "Warehouse 1",
  });
  if (registered.status < 200 || registered.status >= 300) {
    throw new Error(
      `seedInventory: registerWarehouse failed (${registered.status}): ${JSON.stringify(registered.body)}`,
    );
  }
  const { warehouseId } = registered.body as { warehouseId: string };
  const received = await admin.inventory.receiveStock(staff, {
    tenantId: "tenant-local",
    productId,
    warehouseId,
    quantity,
  });
  if (received.status < 200 || received.status >= 300) {
    throw new Error(
      `seedInventory: receiveStock failed (${received.status}): ${JSON.stringify(received.body)}`,
    );
  }
}

function unwrap<T>(response: Response, action: string): T {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${action} failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return response.body as T;
}

describe("Phase 17.2 — authenticated Cart admin route: forged pricing is ignored", () => {
  it("legitimate request: real published price is used", async () => {
    const admin = buildAdmin();
    await seedPublishedPrice(admin, "product-1", 1999, "USD");
    const routes = cartRoutes(admin);
    const create = byPathAndMethod(routes, "POST", "/carts");
    const addItem = byPathAndMethod(routes, "POST", "/carts/:cartId/items");

    const created = unwrap<{ cartId: string }>(
      await call(create, attacker, {}, { sessionRef: "session-attacker", currency: "USD" }),
      "create cart",
    );
    const added = unwrap<{ totalAmountMinor: number }>(
      await call(
        addItem,
        attacker,
        { cartId: created.cartId },
        { productId: "product-1", quantity: 1 },
      ),
      "add item",
    );
    expect(added.totalAmountMinor).toBe(1999);
  });

  it("Attack A (cheap price) — a forged 1-cent price is ignored; the real seeded price is used", async () => {
    const admin = buildAdmin();
    const REAL_PRICE = 1999;
    await seedPublishedPrice(admin, "product-1", REAL_PRICE, "USD");
    const routes = cartRoutes(admin);
    const create = byPathAndMethod(routes, "POST", "/carts");
    const addItem = byPathAndMethod(routes, "POST", "/carts/:cartId/items");

    const created = unwrap<{ cartId: string }>(
      await call(create, attacker, {}, { sessionRef: "session-attacker", currency: "USD" }),
      "create cart",
    );
    // Bypasses Zod entirely (handler invoked directly) — proves the handler itself never reads these fields.
    const added = await call(
      addItem,
      attacker,
      { cartId: created.cartId },
      {
        productId: "product-1",
        quantity: 1,
        unitPriceAmountMinor: 1,
        currency: "USD",
      },
    );

    expect(added.status).toBe(200);
    expect((added.body as { totalAmountMinor: number }).totalAmountMinor).toBe(REAL_PRICE);
  });

  it("Attack B (inflated price) — a forged huge price is ignored; the real seeded price is used", async () => {
    const admin = buildAdmin();
    const REAL_PRICE = 1999;
    await seedPublishedPrice(admin, "product-1", REAL_PRICE, "USD");
    const routes = cartRoutes(admin);
    const create = byPathAndMethod(routes, "POST", "/carts");
    const addItem = byPathAndMethod(routes, "POST", "/carts/:cartId/items");

    const created = unwrap<{ cartId: string }>(
      await call(create, attacker, {}, { sessionRef: "session-attacker", currency: "USD" }),
      "create cart",
    );
    const added = await call(
      addItem,
      attacker,
      { cartId: created.cartId },
      {
        productId: "product-1",
        quantity: 1,
        unitPriceAmountMinor: 999_999_999,
        currency: "USD",
      },
    );

    expect(added.status).toBe(200);
    expect((added.body as { totalAmountMinor: number }).totalAmountMinor).toBe(REAL_PRICE);
  });

  it("Attack C (currency forgery) — a forged currency cannot smuggle a price past Pricing; mismatched cart currency 409s instead", async () => {
    const admin = buildAdmin();
    // The product is only ever published in USD.
    await seedPublishedPrice(admin, "product-1", 1999, "USD");
    const routes = cartRoutes(admin);
    const create = byPathAndMethod(routes, "POST", "/carts");
    const addItem = byPathAndMethod(routes, "POST", "/carts/:cartId/items");

    const created = unwrap<{ cartId: string }>(
      await call(create, attacker, {}, { sessionRef: "session-attacker", currency: "EUR" }),
      "create cart",
    );
    const added = await call(
      addItem,
      attacker,
      { cartId: created.cartId },
      {
        productId: "product-1",
        quantity: 1,
        unitPriceAmountMinor: 1,
        currency: "EUR",
      },
    );

    // The resolved price is USD 19.99; the cart is EUR — Cart's pre-existing currency-match
    // invariant (unrelated to this fix) rejects it with 409, never with the forged EUR amount.
    expect(added.status).toBe(409);
  });

  it("unknown product (no price at all) → 422, no item persisted", async () => {
    const admin = buildAdmin();
    const routes = cartRoutes(admin);
    const create = byPathAndMethod(routes, "POST", "/carts");
    const addItem = byPathAndMethod(routes, "POST", "/carts/:cartId/items");

    const created = unwrap<{ cartId: string }>(
      await call(create, attacker, {}, { sessionRef: "session-attacker", currency: "USD" }),
      "create cart",
    );
    const added = await call(
      addItem,
      attacker,
      { cartId: created.cartId },
      {
        productId: "does-not-exist",
        quantity: 1,
      },
    );
    expect(added.status).toBe(422);
  });

  it("draft (unpublished) price → 422, treated as unavailable", async () => {
    const admin = buildAdmin();
    await createPrice(admin, "product-draft", 999, "USD"); // created but never published
    const routes = cartRoutes(admin);
    const create = byPathAndMethod(routes, "POST", "/carts");
    const addItem = byPathAndMethod(routes, "POST", "/carts/:cartId/items");

    const created = unwrap<{ cartId: string }>(
      await call(create, attacker, {}, { sessionRef: "session-attacker", currency: "USD" }),
      "create cart",
    );
    const added = await call(
      addItem,
      attacker,
      { cartId: created.cartId },
      {
        productId: "product-draft",
        quantity: 1,
      },
    );
    expect(added.status).toBe(422);
  });

  it("ambiguous price (two published rows for one product) → 422, never guessed at", async () => {
    const admin = buildAdmin();
    await seedPublishedPrice(admin, "product-ambiguous", 500, "USD");
    await seedPublishedPrice(admin, "product-ambiguous", 700, "USD");
    const routes = cartRoutes(admin);
    const create = byPathAndMethod(routes, "POST", "/carts");
    const addItem = byPathAndMethod(routes, "POST", "/carts/:cartId/items");

    const created = unwrap<{ cartId: string }>(
      await call(create, attacker, {}, { sessionRef: "session-attacker", currency: "USD" }),
      "create cart",
    );
    const added = await call(
      addItem,
      attacker,
      { cartId: created.cartId },
      {
        productId: "product-ambiguous",
        quantity: 1,
      },
    );
    expect(added.status).toBe(422);
  });

  it("schema-level rejection: a real HTTP request carrying unitPriceAmountMinor/currency fails Zod validation", () => {
    const routes = cartRoutes(buildAdmin());
    const addItemSchema = byPathAndMethod(routes, "POST", "/carts/:cartId/items").schema?.body;
    const replaceSchema = byPathAndMethod(routes, "POST", "/carts/:cartId/items/replace").schema
      ?.body;
    expect(
      addItemSchema?.safeParse({
        productId: "p-1",
        quantity: 1,
        unitPriceAmountMinor: 1,
        currency: "USD",
      }).success,
    ).toBe(false);
    expect(addItemSchema?.safeParse({ productId: "p-1", quantity: 1 }).success).toBe(true);
    expect(
      replaceSchema?.safeParse({
        oldProductId: "p-1",
        newProductId: "p-2",
        quantity: 1,
        unitPriceAmountMinor: 1,
        currency: "USD",
      }).success,
    ).toBe(false);
  });

  it("cross-cart access: an authenticated customer can still act on another customer's cart id (unchanged, pre-existing admin-facade characteristic), but the price is always authoritative", async () => {
    const admin = buildAdmin();
    const REAL_PRICE = 1999;
    await seedPublishedPrice(admin, "product-1", REAL_PRICE, "USD");
    const routes = cartRoutes(admin);
    const create = byPathAndMethod(routes, "POST", "/carts");
    const addItem = byPathAndMethod(routes, "POST", "/carts/:cartId/items");

    const victimCart = unwrap<{ cartId: string }>(
      await call(create, victim, {}, { sessionRef: "session-victim", currency: "USD" }),
      "victim creates cart",
    );
    const added = await call(
      addItem,
      attacker,
      { cartId: victimCart.cartId },
      {
        productId: "product-1",
        quantity: 1,
        unitPriceAmountMinor: 1,
        currency: "USD",
      },
    );

    // Object-level cart access is unchanged by this fix (see the audit report's Remaining Risks) —
    // what this fix guarantees is that whichever cart is touched, the price is never forgeable.
    expect(added.status).toBe(200);
    expect((added.body as { totalAmountMinor: number }).totalAmountMinor).toBe(REAL_PRICE);
  });
});

describe("Phase 17.2 — Checkout: the payment-intent amount is always re-derived from Cart, never client-supplied", () => {
  it("legitimate flow: payment-intent-request amount matches the real Cart total", async () => {
    const admin = buildAdmin();
    const REAL_PRICE = 1999;
    await seedPublishedPrice(admin, "product-1", REAL_PRICE, "USD");

    const cart = cartRoutes(admin);
    const createCart = byPathAndMethod(cart, "POST", "/carts");
    const addItem = byPathAndMethod(cart, "POST", "/carts/:cartId/items");
    const createdCart = unwrap<{ cartId: string }>(
      await call(createCart, attacker, {}, { sessionRef: "session-attacker", currency: "USD" }),
      "create cart",
    );
    unwrap(
      await call(
        addItem,
        attacker,
        { cartId: createdCart.cartId },
        { productId: "product-1", quantity: 2 },
      ),
      "add item",
    );

    const checkout = checkoutRoutes(admin);
    const start = byPathAndMethod(checkout, "POST", "/checkouts");
    const loadItems = byPathAndMethod(checkout, "POST", "/checkouts/:checkoutSessionId/items");
    const setBilling = byPathAndMethod(
      checkout,
      "POST",
      "/checkouts/:checkoutSessionId/billing-address",
    );
    const setShipping = byPathAndMethod(
      checkout,
      "POST",
      "/checkouts/:checkoutSessionId/shipping-address",
    );
    const recalc = byPathAndMethod(checkout, "POST", "/checkouts/:checkoutSessionId/recalculate");
    const selectPayment = byPathAndMethod(
      checkout,
      "POST",
      "/checkouts/:checkoutSessionId/payment-selection",
    );
    const paymentIntentRequest = byPathAndMethod(
      checkout,
      "GET",
      "/checkouts/:checkoutSessionId/payment-intent-request",
    );

    const started = unwrap<{ checkoutSessionId: string }>(
      await call(
        start,
        attacker,
        {},
        {
          cartRef: createdCart.cartId,
          sessionRef: "session-attacker",
          currency: "USD",
        },
      ),
      "start checkout",
    );
    const params = { checkoutSessionId: started.checkoutSessionId };

    unwrap(await call(loadItems, attacker, params, { cartId: createdCart.cartId }), "load items");
    const address = { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" };
    unwrap(await call(setBilling, attacker, params, address), "set billing address");
    unwrap(await call(setShipping, attacker, params, address), "set shipping address");
    unwrap(await call(recalc, attacker, params, undefined), "recalculate");
    unwrap(
      await call(selectPayment, attacker, params, { paymentMethodRef: "pm-1", provider: "stripe" }),
      "select payment",
    );

    const intentReq = unwrap<{ amountMinor: number; currency: string }>(
      await call(paymentIntentRequest, attacker, params, undefined),
      "generate payment intent request",
    );
    expect(intentReq.amountMinor).toBe(REAL_PRICE * 2);
    expect(intentReq.currency).toBe("USD");
  });

  it("completing the session materializes the order via OrderCreationPort and is idempotent per idempotencyKey (C-2)", async () => {
    const orderCreation = new FakeOrderCreationPort();
    const admin = buildAdmin({ orderCreation });
    const REAL_PRICE = 1999;
    await seedPublishedPrice(admin, "product-1", REAL_PRICE, "USD");

    const cart = cartRoutes(admin);
    const createCart = byPathAndMethod(cart, "POST", "/carts");
    const addItem = byPathAndMethod(cart, "POST", "/carts/:cartId/items");
    const createdCart = unwrap<{ cartId: string }>(
      await call(createCart, attacker, {}, { sessionRef: "session-attacker", currency: "USD" }),
      "create cart",
    );
    unwrap(
      await call(
        addItem,
        attacker,
        { cartId: createdCart.cartId },
        { productId: "product-1", quantity: 2 },
      ),
      "add item",
    );

    const checkout = checkoutRoutes(admin);
    const start = byPathAndMethod(checkout, "POST", "/checkouts");
    const loadItems = byPathAndMethod(checkout, "POST", "/checkouts/:checkoutSessionId/items");
    const setBilling = byPathAndMethod(
      checkout,
      "POST",
      "/checkouts/:checkoutSessionId/billing-address",
    );
    const setShipping = byPathAndMethod(
      checkout,
      "POST",
      "/checkouts/:checkoutSessionId/shipping-address",
    );
    const recalc = byPathAndMethod(checkout, "POST", "/checkouts/:checkoutSessionId/recalculate");
    const selectPayment = byPathAndMethod(
      checkout,
      "POST",
      "/checkouts/:checkoutSessionId/payment-selection",
    );
    const complete = byPathAndMethod(checkout, "POST", "/checkouts/:checkoutSessionId/complete");

    const started = unwrap<{ checkoutSessionId: string }>(
      await call(
        start,
        attacker,
        {},
        {
          cartRef: createdCart.cartId,
          sessionRef: "session-attacker",
          currency: "USD",
        },
      ),
      "start checkout",
    );
    const params = { checkoutSessionId: started.checkoutSessionId };

    unwrap(await call(loadItems, attacker, params, { cartId: createdCart.cartId }), "load items");
    const address = { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" };
    unwrap(await call(setBilling, attacker, params, address), "set billing address");
    unwrap(await call(setShipping, attacker, params, address), "set shipping address");
    unwrap(await call(recalc, attacker, params, undefined), "recalculate");
    unwrap(
      await call(selectPayment, attacker, params, { paymentMethodRef: "pm-1", provider: "stripe" }),
      "select payment",
    );

    const completed = unwrap<{ orderRef: string; state: string }>(
      await call(complete, attacker, params, { idempotencyKey: "idem-1" }),
      "complete checkout",
    );
    expect(completed.orderRef).toBe("order-fake-1");
    expect(completed.state).toBe("completed");
    expect(orderCreation.callCount).toBe(1);

    // Repeated call with the same idempotencyKey returns the same orderRef without calling the
    // port again — the session's own recorded orderRef short-circuits the retry (C-2).
    const repeated = unwrap<{ orderRef: string }>(
      await call(complete, attacker, params, { idempotencyKey: "idem-1" }),
      "repeat complete checkout",
    );
    expect(repeated.orderRef).toBe("order-fake-1");
    expect(orderCreation.callCount).toBe(1);
  });

  /**
   * C-2 regression pin — this test exists to DOCUMENT A GAP HONESTLY, not to prove a feature works.
   *
   * Every other test touching `/complete` overrides `orderCreation` with `FakeOrderCreationPort`,
   * so `wireAdmin`'s REAL default (`new OrderCreationAdapter(orders.orders)` over the real
   * `wireOrders` slice) had zero coverage — which is precisely why the gap asserted below survived
   * three task-level reviews unnoticed. This test passes NO `orderCreation` override.
   *
   * What it pins: completing a checkout session creates a real, persisted `Order`, and that order's
   * status is `created` — NOT `paid`. `Order.createFromCheckout` raises
   * `OrderTransitioned(created→created)`; `OrderPaid` (topic `orders.order.paid`) is raised only by
   * `markPaid`/`completePayment`, reachable from the legacy `placed` state or after a walk to
   * `payment_received` that nothing in this codebase drives a checkout-created order through. So
   * the four `orders.order.paid` consumers registered in `apps/runtime/src/worker.ts`
   * (Finance/Loyalty/Customer 360/Notifications) never fire for the checkout flow.
   *
   * That is an OPEN C-2 sub-gap, not a fixed one: closing it needs a product decision about how
   * payment capture integrates with checkout completion (`CheckoutSession` has no way to record a
   * captured payment reference — `generatePaymentIntentRequest()` is a one-way DTO export), and
   * fabricating a `paymentRef` to force the transition would put wrong-but-plausible entries into
   * Finance's ledger. Asserting today's behavior here means a future fix must consciously update
   * this test rather than silently changing what money-touching consumers see.
   */
  it("C-2 open gap, pinned: the REAL default composition creates an order at status `created` and never publishes orders.order.paid", async () => {
    // No `orderCreation` override — this resolves to the real `OrderCreationAdapter`.
    const admin = buildAdmin();
    const REAL_PRICE = 1999;
    await seedPublishedPrice(admin, "product-1", REAL_PRICE, "USD");

    const cart = cartRoutes(admin);
    const createCart = byPathAndMethod(cart, "POST", "/carts");
    const addItem = byPathAndMethod(cart, "POST", "/carts/:cartId/items");
    const createdCart = unwrap<{ cartId: string }>(
      await call(createCart, attacker, {}, { sessionRef: "session-attacker", currency: "USD" }),
      "create cart",
    );
    unwrap(
      await call(
        addItem,
        attacker,
        { cartId: createdCart.cartId },
        { productId: "product-1", quantity: 2 },
      ),
      "add item",
    );

    const checkout = checkoutRoutes(admin);
    const start = byPathAndMethod(checkout, "POST", "/checkouts");
    const loadItems = byPathAndMethod(checkout, "POST", "/checkouts/:checkoutSessionId/items");
    const setBilling = byPathAndMethod(
      checkout,
      "POST",
      "/checkouts/:checkoutSessionId/billing-address",
    );
    const setShipping = byPathAndMethod(
      checkout,
      "POST",
      "/checkouts/:checkoutSessionId/shipping-address",
    );
    const recalc = byPathAndMethod(checkout, "POST", "/checkouts/:checkoutSessionId/recalculate");
    const selectPayment = byPathAndMethod(
      checkout,
      "POST",
      "/checkouts/:checkoutSessionId/payment-selection",
    );
    const complete = byPathAndMethod(checkout, "POST", "/checkouts/:checkoutSessionId/complete");

    // A real `customerRef` is required: `OrderCreationAdapter` throws for guest checkout rather
    // than fabricating one (its own documented C-2 limitation).
    const started = unwrap<{ checkoutSessionId: string }>(
      await call(
        start,
        attacker,
        {},
        {
          cartRef: createdCart.cartId,
          customerRef: attacker.id,
          sessionRef: "session-attacker",
          currency: "USD",
        },
      ),
      "start checkout",
    );
    const params = { checkoutSessionId: started.checkoutSessionId };

    unwrap(await call(loadItems, attacker, params, { cartId: createdCart.cartId }), "load items");
    const address = { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" };
    unwrap(await call(setBilling, attacker, params, address), "set billing address");
    unwrap(await call(setShipping, attacker, params, address), "set shipping address");
    unwrap(await call(recalc, attacker, params, undefined), "recalculate");
    unwrap(
      await call(selectPayment, attacker, params, { paymentMethodRef: "pm-1", provider: "stripe" }),
      "select payment",
    );

    const completed = unwrap<{ orderRef: string; state: string }>(
      await call(complete, attacker, params, { idempotencyKey: "idem-real-1" }),
      "complete checkout",
    );
    expect(completed.state).toBe("completed");

    // A REAL aggregate now exists behind that ref — read back through the real Orders controller,
    // never through a fake or a repository poke.
    const order = unwrap<{ status: string; orderNumber: { value: string } }>(
      await admin.orders.getOrder(staff, { orderId: completed.orderRef }),
      "read back the created order",
    );
    expect(order.status).toBe("created");
    expect(order.status).not.toBe("paid");

    // ...and no `orders.order.paid` was published for it. `orders.order.created` is what the
    // checkout flow actually emits; the four Task 17b consumers subscribe to the former.
    await admin.drainOutbox();
    expect(admin.deliveredEventTypes).toContain("orders.order.created");
    expect(admin.deliveredEventTypes).not.toContain("orders.order.paid");
  });

  it("Attack D — a forged raw items[] body is ignored; items are always re-derived from the named Cart", async () => {
    const admin = buildAdmin();
    const REAL_PRICE = 1999;
    await seedPublishedPrice(admin, "product-1", REAL_PRICE, "USD");
    await seedInventory(admin, "product-1", 10);

    const cart = cartRoutes(admin);
    const createCart = byPathAndMethod(cart, "POST", "/carts");
    const addItem = byPathAndMethod(cart, "POST", "/carts/:cartId/items");
    const createdCart = unwrap<{ cartId: string }>(
      await call(createCart, attacker, {}, { sessionRef: "session-attacker", currency: "USD" }),
      "create cart",
    );
    unwrap(
      await call(
        addItem,
        attacker,
        { cartId: createdCart.cartId },
        { productId: "product-1", quantity: 1 },
      ),
      "add item",
    );

    const checkout = checkoutRoutes(admin);
    const start = byPathAndMethod(checkout, "POST", "/checkouts");
    const loadItems = byPathAndMethod(checkout, "POST", "/checkouts/:checkoutSessionId/items");
    const setBilling = byPathAndMethod(
      checkout,
      "POST",
      "/checkouts/:checkoutSessionId/billing-address",
    );
    const setShipping = byPathAndMethod(
      checkout,
      "POST",
      "/checkouts/:checkoutSessionId/shipping-address",
    );
    const validate = byPathAndMethod(checkout, "POST", "/checkouts/:checkoutSessionId/validate");
    const recalc = byPathAndMethod(checkout, "POST", "/checkouts/:checkoutSessionId/recalculate");
    const selectPayment = byPathAndMethod(
      checkout,
      "POST",
      "/checkouts/:checkoutSessionId/payment-selection",
    );
    const paymentIntentRequest = byPathAndMethod(
      checkout,
      "GET",
      "/checkouts/:checkoutSessionId/payment-intent-request",
    );

    const started = unwrap<{ checkoutSessionId: string }>(
      await call(
        start,
        attacker,
        {},
        {
          cartRef: createdCart.cartId,
          sessionRef: "session-attacker",
          currency: "USD",
        },
      ),
      "start checkout",
    );
    const params = { checkoutSessionId: started.checkoutSessionId };

    // Bypasses Zod directly: smuggles a legacy-shaped forged `items` array alongside the real
    // `cartId` — the handler no longer reads `body.items` under any circumstance.
    unwrap(
      await call(loadItems, attacker, params, {
        cartId: createdCart.cartId,
        items: [{ productId: "product-1", quantity: 1, unitPriceAmountMinor: 1, currency: "USD" }],
      }),
      "load items (with smuggled forged items[])",
    );

    const address = { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" };
    unwrap(await call(setBilling, attacker, params, address), "set billing address");
    unwrap(await call(setShipping, attacker, params, address), "set shipping address");

    const validated = unwrap<{ valid: boolean }>(
      await call(validate, attacker, params, undefined),
      "validate",
    );
    // Phase 3 Task 9/10: `validate` now runs the REAL PricingValidationAdapter (H-1) AND the REAL
    // InventoryValidationAdapter (C-3), not the offline stubs — still `true` here because
    // `loadItems` re-derives every item's price from Cart (never the smuggled forged `items[]`
    // above, so the snapshot legitimately matches the published price) and `seedInventory` above
    // stocked enough of `product-1` at the test's single registered warehouse.
    expect(validated.valid).toBe(true);

    unwrap(await call(recalc, attacker, params, undefined), "recalculate");
    unwrap(
      await call(selectPayment, attacker, params, { paymentMethodRef: "pm-1", provider: "stripe" }),
      "select payment",
    );

    const intentReq = unwrap<{ amountMinor: number }>(
      await call(paymentIntentRequest, attacker, params, undefined),
      "generate payment intent request",
    );

    // PROOF: the smuggled forged 1-cent line never reached the payment-intent amount.
    expect(intentReq.amountMinor).toBe(REAL_PRICE);
    expect(intentReq.amountMinor).not.toBe(1);
  });

  it("schema-level rejection: a real HTTP request carrying a raw items[] body fails Zod validation", () => {
    const routes = checkoutRoutes(buildAdmin());
    const schema = byPathAndMethod(routes, "POST", "/checkouts/:checkoutSessionId/items").schema
      ?.body;
    expect(
      schema?.safeParse({
        items: [{ productId: "p-1", quantity: 1, unitPriceAmountMinor: 1, currency: "USD" }],
      }).success,
    ).toBe(false);
    expect(schema?.safeParse({ cartId: "cart-1" }).success).toBe(true);
  });
});

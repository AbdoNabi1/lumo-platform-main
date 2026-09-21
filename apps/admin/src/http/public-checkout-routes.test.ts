import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin, type WiredAdmin } from "../composition";
import { publicCartRoutes } from "./public-cart-routes";
import { publicCheckoutRoutes, type PublicCheckoutSessionDto } from "./public-checkout-routes";

/**
 * Public Checkout HTTP surface (Phase 2 — Public checkout). Drives the REAL `wireAdmin()`
 * composition (in-memory branch) through the actual `RouteDefinition.handle()` boundary — same
 * technique `public-cart-routes.test.ts` and `cart-checkout-pricing-security.e2e.test.ts` use.
 * `wireAdmin` is used (rather than `wireCheckout`/`wireCart` standalone) because the `items` route
 * re-derives line items from a real Cart, whose price in turn comes from a real, published Price —
 * exercising the same server-side price resolution the guest cart surface already relies on.
 *
 * `complete()` for a genuine guest session is documented, not exercised as a success path — see
 * the `docs/plans/BLOCKERS.md` T2.3 entry: `OrderCreationAdapter` (the real `OrderCreationPort`
 * `wireAdmin` always wires in) throws for a session with no `customerRef`, which every session
 * this public surface creates has, by design (guest-only, `customerRef` dropped at `start`).
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

describe("public checkout routes — route inventory", () => {
  it("exposes exactly the 13 guest-completable routes, all public", () => {
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

  // See docs/plans/BLOCKERS.md T2.3: OrderCreationAdapter requires a customerRef, which a guest
  // session (this surface's only kind) never has — documents current behavior rather than a
  // success path.
  it("complete() rejects for a guest session — pre-existing C-2 limitation, not fixed by this phase", async () => {
    const rawAdmin = buildAdmin();
    await seedPublishedPrice(rawAdmin, "product-1", 1999);
    const admin = routesFor(rawAdmin);
    const sessionRef = "session-guest-complete";

    const cart = unwrap<{ id: string }>(await admin.createCart(sessionRef), "create cart");
    await admin.addCartItem(cart.id, sessionRef, "product-1", 1);
    const started = unwrap<PublicCheckoutSessionDto>(
      await admin.start({ sessionRef, cartRef: cart.id, currency: "USD" }),
      "start checkout",
    );
    await admin.items(started.id, { sessionRef, cartId: cart.id });
    await admin.billingAddress(started.id, { sessionRef, ...address });
    await admin.shippingAddress(started.id, { sessionRef, ...address });
    await admin.shippingSelection(started.id, { sessionRef, method: "standard" });
    await admin.paymentSelection(started.id, {
      sessionRef,
      paymentMethodRef: "pm_1",
      provider: "stripe",
    });
    await admin.recalculate(started.id, { sessionRef });

    await expect(
      admin.complete(started.id, { sessionRef, idempotencyKey: "idem-1" }),
    ).rejects.toThrow(/customerRef/);
  });
});

describe("public checkout routes — contact email (WP-1, T1.3)", () => {
  async function startedGuest(rawAdmin: WiredAdmin, sessionRef: string): Promise<string> {
    const routes = routesFor(rawAdmin);
    const cart = unwrap<{ id: string }>(await routes.createCart(sessionRef), "create cart");
    const started = unwrap<PublicCheckoutSessionDto>(
      await routes.start({ sessionRef, cartRef: cart.id, currency: "USD" }),
      "start checkout",
    );
    return started.id;
  }

  it("records the normalised email and reflects it in the DTO", async () => {
    const rawAdmin = buildAdmin();
    const id = await startedGuest(rawAdmin, "session-contact");
    const admin = routesFor(rawAdmin);

    const response = await admin.contact(id, {
      sessionRef: "session-contact",
      email: "  Guest@Example.COM ",
    });

    expect(response.status).toBe(200);
    expect((response.body as PublicCheckoutSessionDto).contactEmail).toBe("guest@example.com");
    const fetched = unwrap<PublicCheckoutSessionDto>(
      await admin.get(id, "session-contact"),
      "get checkout",
    );
    expect(fetched.contactEmail).toBe("guest@example.com");
  });

  it("is null until one is provided", async () => {
    const rawAdmin = buildAdmin();
    const id = await startedGuest(rawAdmin, "session-none");
    const fetched = unwrap<PublicCheckoutSessionDto>(
      await routesFor(rawAdmin).get(id, "session-none"),
      "get checkout",
    );
    expect(fetched.contactEmail).toBeNull();
  });

  it("rejects a malformed email with a 4xx", async () => {
    const rawAdmin = buildAdmin();
    const id = await startedGuest(rawAdmin, "session-bad");

    const response = await routesFor(rawAdmin).contact(id, {
      sessionRef: "session-bad",
      email: "not-an-email",
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("body schema requires sessionRef and rejects extra fields such as customerRef", () => {
    const schema = routesFor(buildAdmin()).schemaOf(
      "POST",
      "/public/checkouts/:checkoutSessionId/contact",
    ) as { safeParse: (v: unknown) => { success: boolean } };
    expect(schema.safeParse({ email: "a@example.com" }).success).toBe(false);
    expect(
      schema.safeParse({ sessionRef: "s", email: "a@example.com", customerRef: "c-1" }).success,
    ).toBe(false);
    expect(schema.safeParse({ sessionRef: "s", email: "a@example.com" }).success).toBe(true);
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

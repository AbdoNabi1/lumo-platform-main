import { describe, expect, it } from "vitest";
import { wireCart, type WiredCart } from "@platform/cart";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wirePricing, type WiredPricing } from "@platform/pricing";
import { ValidationError } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import { publicCartRoutes, type PublicCartDto } from "./public-cart-routes";

/**
 * Public Cart HTTP surface (Phase 17.1 — Guest Cart Foundation; H-01 security remediation).
 * Drives the REAL `wireCart` composition (in-memory branch) through the actual
 * `RouteDefinition.handle()` boundary — same technique the pre-existing Phase 3 test used,
 * extended to cover every guest write route this phase adds plus the ownership matrix Task 10
 * requires. Two independent `wireCart()`/`wirePricing()` instances simulate two tenants (the
 * in-memory branch has no tenant field of its own — see `in-memory-cart-repository.test.ts`'s doc
 * comment — so tenant isolation for the guest-cart flow is exercised here, at the composition
 * boundary, rather than inside the repository).
 *
 * Since H-01, `POST .../items` resolves its price server-side from a REAL `wirePricing()`
 * composition rather than trusting the request body — every test that adds an item now seeds a
 * published `Price` first via {@link seedPublishedPrice}, and assertions compare against that
 * seeded amount rather than a value the test merely hopes the route echoes back.
 */

const clock: Clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };

function cartFixture(): WiredCart {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  return wireCart({ serializer: new InMemoryEventSerializer(), idGenerator, clock });
}

function pricingFixture(): WiredPricing {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `price-id-${(n += 1)}` };
  return wirePricing({ serializer: new InMemoryEventSerializer(), idGenerator, clock });
}

/** Creates and publishes a real `Price` through `wirePricing`'s own use cases (never fabricated repository state) — the only way a product's price becomes `"ok"`-resolvable by the route under test. */
async function seedPublishedPrice(
  pricing: WiredPricing,
  productId: string,
  amountMinor: number,
  currency = "USD",
): Promise<void> {
  const created = await pricing.prices.create({
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
  const published = await pricing.prices.publish({ priceId: id });
  if (published.status < 200 || published.status >= 300) {
    throw new Error(
      `seedPublishedPrice: publish failed (${published.status}): ${JSON.stringify(published.body)}`,
    );
  }
}

function stubAdmin(cart: WiredCart, pricing: WiredPricing): WiredAdmin {
  return { publicReads: { cart: cart.cart, prices: pricing.prices } } as unknown as WiredAdmin;
}

interface Response {
  readonly status: number;
  readonly body: unknown;
}

function routesFor(admin: WiredAdmin) {
  const routes = publicCartRoutes(admin);
  const byPathAndMethod = (method: string, path: string) => {
    const route = routes.find((r) => r.method === method && r.path === path);
    if (route === undefined) throw new Error(`no route ${method} ${path}`);
    return route;
  };
  const context = {
    tenantId: "tenant-local",
    principal: { id: "public", kind: "customer", roles: [] },
    requestId: "req-1",
  };

  return {
    routes,
    createCart: (body: unknown): Promise<Response> =>
      byPathAndMethod("POST", "/public/carts").handle({
        body,
        params: {},
        query: {},
        context,
      } as never) as Promise<Response>,
    getCurrent: (sessionRef: string): Promise<Response> =>
      byPathAndMethod("GET", "/public/carts/current").handle({
        body: undefined,
        params: {},
        query: { sessionRef },
        context,
      } as never) as Promise<Response>,
    getById: (cartId: string, sessionRef: string): Promise<Response> =>
      byPathAndMethod("GET", "/public/carts/:cartId").handle({
        body: undefined,
        params: { cartId },
        query: { sessionRef },
        context,
      } as never) as Promise<Response>,
    addItem: (cartId: string, body: unknown): Promise<Response> =>
      byPathAndMethod("POST", "/public/carts/:cartId/items").handle({
        body,
        params: { cartId },
        query: {},
        context,
      } as never) as Promise<Response>,
    addItemSchema: () => byPathAndMethod("POST", "/public/carts/:cartId/items").schema.body,
    changeQuantity: (cartId: string, body: unknown): Promise<Response> =>
      byPathAndMethod("POST", "/public/carts/:cartId/items/quantity").handle({
        body,
        params: { cartId },
        query: {},
        context,
      } as never) as Promise<Response>,
    removeItem: (cartId: string, body: unknown): Promise<Response> =>
      byPathAndMethod("POST", "/public/carts/:cartId/items/remove").handle({
        body,
        params: { cartId },
        query: {},
        context,
      } as never) as Promise<Response>,
    clear: (cartId: string, body: unknown): Promise<Response> =>
      byPathAndMethod("POST", "/public/carts/:cartId/clear").handle({
        body,
        params: { cartId },
        query: {},
        context,
      } as never) as Promise<Response>,
  };
}

function unwrap<T>(response: Response, action: string): T {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${action} failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return response.body as T;
}

async function createGuestCart(
  admin: ReturnType<typeof routesFor>,
  sessionRef: string,
): Promise<PublicCartDto> {
  return unwrap<PublicCartDto>(
    await admin.createCart({ sessionRef, currency: "USD" }),
    "create cart",
  );
}

describe("public cart routes — route inventory", () => {
  it("exposes exactly the guest-safe surface — no lock/unlock/checkout/expire/abandon/save/restore/merge/replaceVariant/assignCustomer", () => {
    const admin = routesFor(stubAdmin(cartFixture(), pricingFixture()));
    const paths = admin.routes.map((r) => `${r.method} ${r.path}`).sort();

    expect(paths).toEqual(
      [
        "GET /public/carts/:cartId",
        "GET /public/carts/current",
        "POST /public/carts",
        "POST /public/carts/:cartId/clear",
        "POST /public/carts/:cartId/items",
        "POST /public/carts/:cartId/items/quantity",
        "POST /public/carts/:cartId/items/remove",
      ].sort(),
    );
    expect(admin.routes.every((r) => r.public === true)).toBe(true);
  });
});

describe("public cart routes — full guest lifecycle (Task 12 flow)", () => {
  it("create → current → add → current → quantity → current → remove → current → clear", async () => {
    const pricing = pricingFixture();
    await seedPublishedPrice(pricing, "product-1", 1500);
    await seedPublishedPrice(pricing, "product-2", 500);
    const admin = routesFor(stubAdmin(cartFixture(), pricing));
    const sessionRef = "session-flow";

    const created = await createGuestCart(admin, sessionRef);
    expect(created.items).toEqual([]);
    expect(created.isGuest).toBe(true);

    const empty = unwrap<{ cart: PublicCartDto | null }>(
      await admin.getCurrent(sessionRef),
      "current (empty)",
    );
    expect(empty.cart?.id).toBe(created.id);

    const added = unwrap<PublicCartDto>(
      await admin.addItem(created.id, { sessionRef, productId: "product-1", quantity: 2 }),
      "add item",
    );
    expect(added.items).toHaveLength(1);
    expect(added.items[0]?.unitPriceAmountMinor).toBe(1500);
    expect(added.subtotalAmountMinor).toBe(3000);

    const afterAdd = unwrap<{ cart: PublicCartDto | null }>(
      await admin.getCurrent(sessionRef),
      "current (after add)",
    );
    expect(afterAdd.cart?.items).toHaveLength(1);

    const requantified = unwrap<PublicCartDto>(
      await admin.changeQuantity(created.id, { sessionRef, productId: "product-1", quantity: 5 }),
      "change quantity",
    );
    expect(requantified.items[0]?.quantity).toBe(5);

    const removed = unwrap<PublicCartDto>(
      await admin.removeItem(created.id, { sessionRef, productId: "product-1" }),
      "remove item",
    );
    expect(removed.items).toEqual([]);

    const readded = unwrap<PublicCartDto>(
      await admin.addItem(created.id, { sessionRef, productId: "product-2", quantity: 1 }),
      "re-add item",
    );
    expect(readded.items).toHaveLength(1);
    expect(readded.items[0]?.unitPriceAmountMinor).toBe(500);

    const cleared = unwrap<PublicCartDto>(await admin.clear(created.id, { sessionRef }), "clear");
    expect(cleared.items).toEqual([]);

    const final = unwrap<{ cart: PublicCartDto | null }>(
      await admin.getCurrent(sessionRef),
      "current (final)",
    );
    expect(final.cart?.items).toEqual([]);
  });

  it("current cart is a clean empty state (never a fabricated cart) when the session has never shopped", async () => {
    const admin = routesFor(stubAdmin(cartFixture(), pricingFixture()));

    const response = unwrap<{ cart: PublicCartDto | null }>(
      await admin.getCurrent("session-never-seen"),
      "current (no session)",
    );

    expect(response.cart).toBeNull();
  });
});

describe("public cart routes — server-side price resolution (H-01)", () => {
  it("resolves the real published price for productId + quantity — never a hardcoded assumption", async () => {
    const pricing = pricingFixture();
    const EXPECTED_AMOUNT_MINOR = 4321;
    const EXPECTED_CURRENCY = "USD";
    await seedPublishedPrice(pricing, "p1", EXPECTED_AMOUNT_MINOR, EXPECTED_CURRENCY);
    const admin = routesFor(stubAdmin(cartFixture(), pricing));
    const cart = await createGuestCart(admin, "session-a");

    const added = unwrap<PublicCartDto>(
      await admin.addItem(cart.id, { sessionRef: "session-a", productId: "p1", quantity: 3 }),
      "add item",
    );

    expect(added.items[0]?.unitPriceAmountMinor).toBe(EXPECTED_AMOUNT_MINOR);
    expect(added.items[0]?.currency).toBe(EXPECTED_CURRENCY);
    expect(added.items[0]?.lineTotalAmountMinor).toBe(EXPECTED_AMOUNT_MINOR * 3);
  });

  it("a direct HTTP caller supplying unitPriceAmountMinor/currency cannot influence the resulting cart item price", async () => {
    const pricing = pricingFixture();
    const REAL_AMOUNT_MINOR = 1999;
    await seedPublishedPrice(pricing, "p1", REAL_AMOUNT_MINOR, "USD");
    const admin = routesFor(stubAdmin(cartFixture(), pricing));
    const cart = await createGuestCart(admin, "session-a");

    // `handle()` is called directly here (bypassing zod, same as every other test in this file —
    // see the empty-sessionRef test's own note), so this is the defense-in-depth check: even if a
    // tampered body somehow reached the handler, the fields below must have zero effect.
    const added = unwrap<PublicCartDto>(
      await admin.addItem(cart.id, {
        sessionRef: "session-a",
        productId: "p1",
        quantity: 1,
        unitPriceAmountMinor: 1,
        currency: "USD",
      }),
      "add item with tampered price",
    );

    expect(added.items[0]?.unitPriceAmountMinor).toBe(REAL_AMOUNT_MINOR);
    expect(added.items[0]?.unitPriceAmountMinor).not.toBe(1);
  });

  it.each([0, 1, 999_999_999])(
    "tampered unitPriceAmountMinor=%i never reaches the cart item",
    async (tamperedAmount) => {
      const pricing = pricingFixture();
      const REAL_AMOUNT_MINOR = 2500;
      await seedPublishedPrice(pricing, "p1", REAL_AMOUNT_MINOR, "USD");
      const admin = routesFor(stubAdmin(cartFixture(), pricing));
      const cart = await createGuestCart(admin, "session-a");

      const added = unwrap<PublicCartDto>(
        await admin.addItem(cart.id, {
          sessionRef: "session-a",
          productId: "p1",
          quantity: 1,
          unitPriceAmountMinor: tamperedAmount,
          currency: "USD",
        }),
        "add item with tampered price",
      );

      expect(added.items[0]?.unitPriceAmountMinor).toBe(REAL_AMOUNT_MINOR);
    },
  );

  it.each(["EUR", "GBP"])(
    "a tampered currency=%s never overrides the resolved currency",
    async (tamperedCurrency) => {
      const pricing = pricingFixture();
      await seedPublishedPrice(pricing, "p1", 1000, "USD");
      const admin = routesFor(stubAdmin(cartFixture(), pricing));
      const cart = await createGuestCart(admin, "session-a");

      const added = unwrap<PublicCartDto>(
        await admin.addItem(cart.id, {
          sessionRef: "session-a",
          productId: "p1",
          quantity: 1,
          unitPriceAmountMinor: 1000,
          currency: tamperedCurrency,
        }),
        "add item with tampered currency",
      );

      expect(added.items[0]?.currency).toBe("USD");
    },
  );

  it("the addItem schema rejects unitPriceAmountMinor/currency outright (.strict()) rather than silently stripping them", () => {
    const admin = routesFor(stubAdmin(cartFixture(), pricingFixture()));
    const schema = admin.addItemSchema();

    const result = schema?.safeParse({
      sessionRef: "session-a",
      productId: "p1",
      quantity: 1,
      unitPriceAmountMinor: 1,
      currency: "USD",
    }) as { success: boolean } | undefined;

    expect(result?.success).toBe(false);
  });

  it("the addItem schema still accepts the legitimate shape (productId + quantity, no price fields)", () => {
    const admin = routesFor(stubAdmin(cartFixture(), pricingFixture()));
    const schema = admin.addItemSchema();

    const result = schema?.safeParse({
      sessionRef: "session-a",
      productId: "p1",
      quantity: 1,
    }) as { success: boolean } | undefined;

    expect(result?.success).toBe(true);
  });

  it("no published price for the product ⇒ 422, no cart item created", async () => {
    const admin = routesFor(stubAdmin(cartFixture(), pricingFixture()));
    const cart = await createGuestCart(admin, "session-a");

    const response = await admin.addItem(cart.id, {
      sessionRef: "session-a",
      productId: "no-such-product",
      quantity: 1,
    });

    expect(response.status).toBe(422);
    const afterAttempt = unwrap<PublicCartDto>(
      await admin.getById(cart.id, "session-a"),
      "read after failed add",
    );
    expect(afterAttempt.items).toEqual([]);
  });

  it("a draft (unpublished) price is not resolvable — behaves the same as no price at all", async () => {
    const pricing = pricingFixture();
    await pricing.prices.create({
      priceListId: "price-list-1",
      productId: "p1",
      amountMinor: 1000,
      currency: "USD",
    }); // created but never published
    const admin = routesFor(stubAdmin(cartFixture(), pricing));
    const cart = await createGuestCart(admin, "session-a");

    const response = await admin.addItem(cart.id, {
      sessionRef: "session-a",
      productId: "p1",
      quantity: 1,
    });

    expect(response.status).toBe(422);
  });

  it("more than one published price for the same product resolves as ambiguous ⇒ 422, never guessed at", async () => {
    const pricing = pricingFixture();
    await seedPublishedPrice(pricing, "p1", 1000, "USD");
    await seedPublishedPrice(pricing, "p1", 2000, "USD");
    const admin = routesFor(stubAdmin(cartFixture(), pricing));
    const cart = await createGuestCart(admin, "session-a");

    const response = await admin.addItem(cart.id, {
      sessionRef: "session-a",
      productId: "p1",
      quantity: 1,
    });

    expect(response.status).toBe(422);
  });

  it("a resolved price whose currency differs from the cart's currency is rejected via the existing currency-mismatch error, not silently coerced", async () => {
    const pricing = pricingFixture();
    await seedPublishedPrice(pricing, "p1", 1000, "EUR");
    const admin = routesFor(stubAdmin(cartFixture(), pricing));
    const cart = await createGuestCart(admin, "session-a"); // created with currency "USD"

    const response = await admin.addItem(cart.id, {
      sessionRef: "session-a",
      productId: "p1",
      quantity: 1,
    });

    expect(response.status).toBe(409);
    const afterAttempt = unwrap<PublicCartDto>(
      await admin.getById(cart.id, "session-a"),
      "read after mismatch",
    );
    expect(afterAttempt.items).toEqual([]);
  });
});

describe("public cart routes — ownership (Task 10)", () => {
  it("session A can create, read, and mutate its own cart", async () => {
    const pricing = pricingFixture();
    await seedPublishedPrice(pricing, "p1", 100);
    const admin = routesFor(stubAdmin(cartFixture(), pricing));
    const cart = await createGuestCart(admin, "session-a");

    expect((await admin.getById(cart.id, "session-a")).status).toBe(200);
    expect(
      (await admin.addItem(cart.id, { sessionRef: "session-a", productId: "p1", quantity: 1 }))
        .status,
    ).toBe(200);
  });

  it("session B cannot read session A's cart — resolves to 404, not 403", async () => {
    const admin = routesFor(stubAdmin(cartFixture(), pricingFixture()));
    const cart = await createGuestCart(admin, "session-a");

    const response = await admin.getById(cart.id, "session-b");

    expect(response.status).toBe(404);
  });

  it("session B cannot mutate session A's cart (add/quantity/remove/clear all 404)", async () => {
    const pricing = pricingFixture();
    await seedPublishedPrice(pricing, "p1", 100);
    const admin = routesFor(stubAdmin(cartFixture(), pricing));
    const cart = await createGuestCart(admin, "session-a");
    await admin.addItem(cart.id, { sessionRef: "session-a", productId: "p1", quantity: 1 });

    const addAttempt = await admin.addItem(cart.id, {
      sessionRef: "session-b",
      productId: "p2",
      quantity: 1,
    });
    const quantityAttempt = await admin.changeQuantity(cart.id, {
      sessionRef: "session-b",
      productId: "p1",
      quantity: 9,
    });
    const removeAttempt = await admin.removeItem(cart.id, {
      sessionRef: "session-b",
      productId: "p1",
    });
    const clearAttempt = await admin.clear(cart.id, { sessionRef: "session-b" });

    expect(addAttempt.status).toBe(404);
    expect(quantityAttempt.status).toBe(404);
    expect(removeAttempt.status).toBe(404);
    expect(clearAttempt.status).toBe(404);

    // the cart is untouched — session B's attempts never executed
    const stillOwnedByA = unwrap<PublicCartDto>(
      await admin.getById(cart.id, "session-a"),
      "final read",
    );
    expect(stillOwnedByA.items).toHaveLength(1);
    expect(stillOwnedByA.items[0]?.quantity).toBe(1);
  });

  it("a forged/random session cannot mutate a real cart", async () => {
    const admin = routesFor(stubAdmin(cartFixture(), pricingFixture()));
    const cart = await createGuestCart(admin, "session-a");

    const response = await admin.addItem(cart.id, {
      sessionRef: "totally-made-up-session-id",
      productId: "p1",
      quantity: 1,
    });

    expect(response.status).toBe(404);
  });

  it("knowing a cart id alone is insufficient — an empty sessionRef never matches a real cart's ownership", async () => {
    // This harness drives `route.handle()` directly (same technique the pre-existing Phase 3 test
    // used), bypassing the Fastify pipeline's zod validation in `executeRoute` — so a real request
    // with an empty `sessionRef` 422s there (`sessionRefQuery`/`addItemBody` both require
    // `.min(1)`) before it would ever reach `requireOwnedCart`.
    //
    // GET (`getById`): H-05 moved sessionRef resolution onto `resolveSessionRef` (x-cart-session
    // header, querystring as a deprecated fallback), which now treats an empty string the same as
    // "absent" and throws `ValidationError` directly — a stronger, explicit rejection of the
    // missing proof-of-ownership, reached before `requireOwnedCart`'s own comparison ever runs.
    // `handle()` is `async`, so this surfaces as a rejected promise at this direct-call layer
    // (the real Fastify pipeline's error handler is what turns it into a 422 response — see
    // packages/http/src/server.ts's `executeRoute`/`setErrorHandler`, not exercised by this
    // harness, which calls `route.handle()` directly).
    //
    // POST (`addItem`): unchanged by H-05 (`body.sessionRef` was never the header/query
    // exposure this fix targeted) — what's verified here is still the original defense-in-depth
    // backstop: even if an empty string somehow reached the ownership check, it still can't match
    // any real cart's `sessionRef` and still 404s, never granting access.
    const admin = routesFor(stubAdmin(cartFixture(), pricingFixture()));
    const cart = await createGuestCart(admin, "session-a");

    await expect(admin.getById(cart.id, "")).rejects.toThrow(ValidationError);
    const missingOnAdd = await admin.addItem(cart.id, {
      sessionRef: "",
      productId: "p1",
      quantity: 1,
    });

    expect(missingOnAdd.status).toBe(404);
  });

  it("an unknown cart id and a cross-owned cart id return byte-identical 404 envelopes (no existence leak)", async () => {
    const admin = routesFor(stubAdmin(cartFixture(), pricingFixture()));
    const cart = await createGuestCart(admin, "session-a");

    const unknown = await admin.getById("no-such-cart", "session-b");
    const crossOwned = await admin.getById(cart.id, "session-b");

    expect(unknown.status).toBe(404);
    expect(crossOwned.status).toBe(404);
    expect(JSON.stringify(unknown.body)).toBe(JSON.stringify(crossOwned.body));
  });
});

describe("public cart routes — customerRef cannot be spoofed (Task 10)", () => {
  it("a client-supplied customerRef on create is ignored — the cart is still a guest cart", async () => {
    const admin = routesFor(stubAdmin(cartFixture(), pricingFixture()));

    const created = unwrap<PublicCartDto>(
      await admin.createCart({
        sessionRef: "session-a",
        currency: "USD",
        customerRef: "someone-elses-customer-id",
      }),
      "create with spoofed customerRef",
    );

    expect(created.isGuest).toBe(true);
  });

  it("no mutation route accepts a customerRef field at all (assignCustomer is not exposed)", () => {
    const admin = routesFor(stubAdmin(cartFixture(), pricingFixture()));
    expect(
      admin.routes.some(
        (r) => r.path.includes("assign") || r.summary.toLowerCase().includes("customer"),
      ),
    ).toBe(false);
  });
});

describe("public cart routes — tenant isolation", () => {
  it("a cart created under one tenant's composition is invisible to another tenant's composition, even with the correct sessionRef", async () => {
    const tenantAAdmin = routesFor(stubAdmin(cartFixture(), pricingFixture()));
    const tenantBAdmin = routesFor(stubAdmin(cartFixture(), pricingFixture()));
    const cart = await createGuestCart(tenantAAdmin, "session-shared-id");

    const crossTenantRead = await tenantBAdmin.getById(cart.id, "session-shared-id");

    expect(crossTenantRead.status).toBe(404);
  });

  it("the same sessionRef colliding across two tenants does not bypass isolation", async () => {
    const tenantAPricing = pricingFixture();
    await seedPublishedPrice(tenantAPricing, "tenant-a-only-product", 100);
    const tenantAAdmin = routesFor(stubAdmin(cartFixture(), tenantAPricing));
    const tenantBAdmin = routesFor(stubAdmin(cartFixture(), pricingFixture()));
    const cartA = await createGuestCart(tenantAAdmin, "session-collide");
    await tenantAAdmin.addItem(cartA.id, {
      sessionRef: "session-collide",
      productId: "tenant-a-only-product",
      quantity: 1,
    });

    // Tenant B never created a cart for this session — its own composition has nothing under it,
    // regardless of the colliding sessionRef string (each tenant is its own isolated store).
    const tenantBCurrent = unwrap<{ cart: PublicCartDto | null }>(
      await tenantBAdmin.getCurrent("session-collide"),
      "tenant B current",
    );

    expect(tenantBCurrent.cart).toBeNull();
  });
});

describe("public cart routes — DTO boundary (regression, carried from Productization Phase 3)", () => {
  it("projects a cart with items to a flat, primitive-only DTO", async () => {
    const pricing = pricingFixture();
    await seedPublishedPrice(pricing, "product-1", 1500);
    const admin = routesFor(stubAdmin(cartFixture(), pricing));
    const created = await createGuestCart(admin, "session-1");

    const response = await admin.addItem(created.id, {
      sessionRef: "session-1",
      productId: "product-1",
      quantity: 2,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: created.id,
      status: "active",
      currency: "USD",
      isGuest: true,
      items: [
        {
          productId: "product-1",
          quantity: 2,
          unitPriceAmountMinor: 1500,
          currency: "USD",
          lineTotalAmountMinor: 3000,
          metadata: undefined,
        },
      ],
      subtotalAmountMinor: 3000,
    });
  });

  it("never puts aggregate internals on the wire (props / _id / _domainEvents / _version)", async () => {
    const admin = routesFor(stubAdmin(cartFixture(), pricingFixture()));
    const created = await createGuestCart(admin, "session-1");

    const serialized = JSON.stringify(await admin.getById(created.id, "session-1"));

    for (const leak of ["props", "_id", "_domainEvents", "_version"]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("returns 404 for a cart that doesn't exist — never a fabricated empty cart", async () => {
    const admin = routesFor(stubAdmin(cartFixture(), pricingFixture()));

    const response = await admin.getById("missing-cart", "any-session");

    expect(response.status).toBe(404);
  });
});

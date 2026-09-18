import { beforeEach, describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireCart, type WiredCart } from "@platform/cart";
import { wireIdentity, type WiredIdentity } from "@platform/identity";
import { wirePricing, type WiredPricing } from "@platform/pricing";
import { wireSecurity, type WiredSecurity } from "@platform/security";
import { wireWishlist, type WiredWishlist } from "@platform/wishlist";
import type { WiredAdmin } from "../composition";
import { CustomerAuthAdminController } from "../interfaces/customer-auth.admin-controller";
import type { CustomerCredentialsPort } from "../interfaces/customer-credentials.port";
import { CustomerGuard } from "../interfaces/customer-guard";
import { publicAuthRoutes } from "./public-auth-routes";
import { publicWishlistRoutes, type PublicWishlistDto } from "./public-wishlist-routes";

/**
 * The customer wishlist surface (T5.17 Part B) over REAL compositions, reached through real
 * customer sessions established by Part A's own routes — no stubbed guard, no fabricated session.
 * That is the point of this file: it is the end-to-end proof that the auth foundation actually
 * scopes a feature's data.
 *
 * The dominant risk on this surface is horizontal privilege escalation (customer A reaching
 * customer B's wishlist), so most of what follows tries to do exactly that and asserts it fails.
 */

const clock: Clock = { now: () => new Date("2026-08-31T00:00:00.000Z") };

function sequentialIds(prefix: string): IdGenerator {
  let counter = 0;
  return { generate: () => `${prefix}-${(counter += 1)}` };
}

interface Harness {
  readonly admin: WiredAdmin;
  readonly cart: WiredCart;
  readonly pricing: WiredPricing;
  readonly wishlist: WiredWishlist;
}

function harness(): Harness {
  const deps = {
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds("id"),
    clock,
  };
  const security: WiredSecurity = wireSecurity(deps);
  const identity: WiredIdentity = wireIdentity(deps);
  const cart = wireCart(deps);
  const pricing = wirePricing(deps);
  const wishlist = wireWishlist(deps);

  const credentials: CustomerCredentialsPort = {
    registerSubject: async (subjectRef) => {
      security.identityDirectory.register(subjectRef);
    },
    setPassword: async (identifier, password, principalExternalId) => {
      security.passwordProvider.register(identifier, password, principalExternalId);
    },
  };
  const customerAuth = new CustomerAuthAdminController({
    security: security.security,
    customers: identity.customers,
    credentials,
    guard: new CustomerGuard({ security: security.security, customers: identity.customers }),
    idGenerator: sequentialIds("refresh"),
    sessionTtlSeconds: 3600,
  });

  const admin = {
    customerAuth,
    publicReads: {
      cart: cart.cart,
      prices: pricing.prices,
      security: security.security,
      customers: identity.customers,
      wishlist: wishlist.wishlist,
    },
  } as unknown as WiredAdmin;

  return { admin, cart, pricing, wishlist };
}

interface Response {
  readonly status: number;
  readonly body: unknown;
}

function callRoute(
  routes: readonly { method: string; path: string; handle: (i: unknown) => unknown }[],
  method: string,
  path: string,
  options: { body?: unknown; sessionId?: string } = {},
): Promise<Response> {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (route === undefined) throw new Error(`no route ${method} ${path}`);
  return route.handle({
    body: options.body ?? {},
    params: {},
    query: {},
    context: {
      tenantId: "tenant-local",
      requestId: "req-1",
      headers: options.sessionId !== undefined ? { "x-customer-session": options.sessionId } : {},
    },
  }) as Promise<Response>;
}

let h: Harness;
beforeEach(() => {
  h = harness();
});

function wish(method: string, path: string, options: { body?: unknown; sessionId?: string } = {}) {
  return callRoute(publicWishlistRoutes(h.admin) as never, method, path, options);
}

/** Registers + signs in a customer through Part A's OWN routes, returning a real session id. */
async function signIn(email: string): Promise<{ sessionId: string; customerRef: string }> {
  const auth = publicAuthRoutes(h.admin) as never;
  const registered = await callRoute(auth, "POST", "/public/auth/register", {
    body: { email, name: "Shopper", password: "correct-horse" },
  });
  expect(registered.status).toBe(201);
  const loggedIn = await callRoute(auth, "POST", "/public/auth/login", {
    body: { email, password: "correct-horse" },
  });
  expect(loggedIn.status).toBe(200);
  return loggedIn.body as { sessionId: string; customerRef: string };
}

describe("GET /public/wishlists/me", () => {
  it("creates the wishlist on first access and returns it empty (not a 404)", async () => {
    const { sessionId } = await signIn("a@example.com");

    const response = await wish("GET", "/public/wishlists/me", { sessionId });

    expect(response.status).toBe(200);
    expect((response.body as PublicWishlistDto).items).toEqual([]);
    expect((response.body as PublicWishlistDto).status).toBe("active");
  });

  it("returns the SAME wishlist on a second access — first access creates exactly one", async () => {
    const { sessionId } = await signIn("a@example.com");

    const first = (await wish("GET", "/public/wishlists/me", { sessionId }))
      .body as PublicWishlistDto;
    const second = (await wish("GET", "/public/wishlists/me", { sessionId }))
      .body as PublicWishlistDto;

    expect(second.id).toBe(first.id);
  });

  it("401s without a session — never an empty wishlist for an anonymous caller", async () => {
    const response = await wish("GET", "/public/wishlists/me");

    expect(response.status).toBe(401);
    // T5.16 §3: an empty list would assert "you have zero items", which is false for someone who
    // is not signed in at all.
    expect(JSON.stringify(response.body)).not.toContain("items");
  });

  it("never puts the customerRef on the wire", async () => {
    const { sessionId, customerRef } = await signIn("a@example.com");

    const response = await wish("GET", "/public/wishlists/me", { sessionId });

    expect(JSON.stringify(response.body)).not.toContain(customerRef);
    expect(Object.keys(response.body as object).sort()).toEqual(["id", "items", "status"]);
  });

  it("returns a flat DTO — no Wishlist aggregate internals reach the wire", async () => {
    const { sessionId } = await signIn("a@example.com");
    await wish("POST", "/public/wishlists/me/items", { sessionId, body: { productRef: "prod-1" } });

    const serialized = JSON.stringify(
      (await wish("GET", "/public/wishlists/me", { sessionId })).body,
    );
    for (const leak of ["props", "_id", "_domainEvents", "_version"]) {
      expect(serialized).not.toContain(leak);
    }
  });
});

describe("wishlist items are scoped to the session's own customer", () => {
  it("keeps two customers' wishlists completely separate", async () => {
    const a = await signIn("a@example.com");
    const b = await signIn("b@example.com");

    await wish("POST", "/public/wishlists/me/items", {
      sessionId: a.sessionId,
      body: { productRef: "prod-A" },
    });
    await wish("POST", "/public/wishlists/me/items", {
      sessionId: b.sessionId,
      body: { productRef: "prod-B" },
    });

    const aList = (await wish("GET", "/public/wishlists/me", { sessionId: a.sessionId }))
      .body as PublicWishlistDto;
    const bList = (await wish("GET", "/public/wishlists/me", { sessionId: b.sessionId }))
      .body as PublicWishlistDto;

    expect(aList.items.map((i) => i.productRef)).toEqual(["prod-A"]);
    expect(bList.items.map((i) => i.productRef)).toEqual(["prod-B"]);
    expect(aList.id).not.toBe(bList.id);
  });

  it("offers no wishlistId or customerRef input anywhere — there is nothing to tamper with", async () => {
    const a = await signIn("a@example.com");
    const b = await signIn("b@example.com");
    const bList = (await wish("GET", "/public/wishlists/me", { sessionId: b.sessionId }))
      .body as PublicWishlistDto;

    // A tries to write into B's wishlist by naming it explicitly. The handler reads neither field.
    await wish("POST", "/public/wishlists/me/items", {
      sessionId: a.sessionId,
      body: { productRef: "prod-INTRUDER", wishlistId: bList.id, customerRef: b.customerRef },
    });

    const bAfter = (await wish("GET", "/public/wishlists/me", { sessionId: b.sessionId }))
      .body as PublicWishlistDto;
    expect(bAfter.items).toEqual([]);
    const aAfter = (await wish("GET", "/public/wishlists/me", { sessionId: a.sessionId }))
      .body as PublicWishlistDto;
    expect(aAfter.items.map((i) => i.productRef)).toEqual(["prod-INTRUDER"]);
  });

  it("stops reaching a wishlist the moment the session is revoked", async () => {
    const a = await signIn("a@example.com");
    await callRoute(publicAuthRoutes(h.admin) as never, "POST", "/public/auth/logout", {
      sessionId: a.sessionId,
    });

    expect((await wish("GET", "/public/wishlists/me", { sessionId: a.sessionId })).status).toBe(
      401,
    );
  });
});

describe("POST /public/wishlists/me/items", () => {
  it("adds a product and returns the updated wishlist", async () => {
    const { sessionId } = await signIn("a@example.com");

    const response = await wish("POST", "/public/wishlists/me/items", {
      sessionId,
      body: { productRef: "prod-1" },
    });

    expect(response.status).toBe(200);
    expect((response.body as PublicWishlistDto).items.map((i) => i.productRef)).toEqual(["prod-1"]);
  });

  it("is idempotent — adding twice leaves one item", async () => {
    const { sessionId } = await signIn("a@example.com");
    const body = { productRef: "prod-1" };

    await wish("POST", "/public/wishlists/me/items", { sessionId, body });
    const second = await wish("POST", "/public/wishlists/me/items", { sessionId, body });

    expect((second.body as PublicWishlistDto).items).toHaveLength(1);
  });

  it("401s for an anonymous caller", async () => {
    const response = await wish("POST", "/public/wishlists/me/items", {
      body: { productRef: "prod-1" },
    });
    expect(response.status).toBe(401);
  });
});

describe("POST /public/wishlists/me/items/remove", () => {
  it("removes the product from the caller's own wishlist", async () => {
    const { sessionId } = await signIn("a@example.com");
    await wish("POST", "/public/wishlists/me/items", { sessionId, body: { productRef: "prod-1" } });

    const response = await wish("POST", "/public/wishlists/me/items/remove", {
      sessionId,
      body: { productRef: "prod-1" },
    });

    expect(response.status).toBe(200);
    expect((response.body as PublicWishlistDto).items).toEqual([]);
  });

  it("404s rather than creating a wishlist for a customer who never had one", async () => {
    const { sessionId } = await signIn("a@example.com");

    const response = await wish("POST", "/public/wishlists/me/items/remove", {
      sessionId,
      body: { productRef: "prod-1" },
    });

    expect(response.status).toBe(404);
  });

  it("401s for an anonymous caller", async () => {
    expect(
      (await wish("POST", "/public/wishlists/me/items/remove", { body: { productRef: "p" } }))
        .status,
    ).toBe(401);
  });
});

describe("POST /public/wishlists/me/items/share", () => {
  it("returns a real, persisted share token for the caller's own item", async () => {
    const { sessionId } = await signIn("a@example.com");
    await wish("POST", "/public/wishlists/me/items", { sessionId, body: { productRef: "prod-1" } });

    const response = await wish("POST", "/public/wishlists/me/items/share", {
      sessionId,
      body: { productRef: "prod-1" },
    });

    expect(response.status).toBe(200);
    const shared = response.body as PublicWishlistDto & { shareToken: string };
    expect(shared.shareToken).toBeTruthy();
    // Persisted, not merely returned — a re-read carries it too.
    const reread = (await wish("GET", "/public/wishlists/me", { sessionId }))
      .body as PublicWishlistDto;
    expect(reread.items[0]?.shareToken).toBe(shared.shareToken);
  });

  it("replays the SAME token on a second share — an already-shared link never breaks", async () => {
    const { sessionId } = await signIn("a@example.com");
    await wish("POST", "/public/wishlists/me/items", { sessionId, body: { productRef: "prod-1" } });
    const body = { productRef: "prod-1" };

    const first = await wish("POST", "/public/wishlists/me/items/share", { sessionId, body });
    const second = await wish("POST", "/public/wishlists/me/items/share", { sessionId, body });

    expect((second.body as { shareToken: string }).shareToken).toBe(
      (first.body as { shareToken: string }).shareToken,
    );
  });

  it("401s for an anonymous caller", async () => {
    expect(
      (await wish("POST", "/public/wishlists/me/items/share", { body: { productRef: "p" } }))
        .status,
    ).toBe(401);
  });
});

describe("POST /public/wishlists/me/items/move-to-cart", () => {
  /** Same real create-then-publish path `public-cart-routes.test.ts`'s `seedPublishedPrice` uses. */
  async function publishedPrice(productRef: string, amountMinor: number): Promise<void> {
    const created = await h.pricing.prices.create({
      tenantId: "tenant-local",
      priceListId: "price-list-1",
      productId: productRef,
      amountMinor,
      currency: "USD",
    });
    expect(created.status).toBeLessThan(300);
    const { id } = created.body as { id: string };
    const published = await h.pricing.prices.publish({ tenantId: "tenant-local", priceId: id });
    expect(published.status).toBeLessThan(300);
  }

  async function guestCart(sessionRef: string): Promise<void> {
    const created = await h.cart.cart.create({ sessionRef, currency: "USD" });
    expect(created.status).toBe(201);
  }

  it("adds the item to the REAL cart and only then removes it from the wishlist", async () => {
    const { sessionId } = await signIn("a@example.com");
    await publishedPrice("prod-1", 1500);
    await guestCart("guest-1");
    await wish("POST", "/public/wishlists/me/items", { sessionId, body: { productRef: "prod-1" } });

    const response = await wish("POST", "/public/wishlists/me/items/move-to-cart", {
      sessionId,
      body: { productRef: "prod-1", sessionRef: "guest-1" },
    });

    expect(response.status).toBe(200);
    expect((response.body as PublicWishlistDto).items).toEqual([]);
    // The cart genuinely holds it — this is what routing through the stub `CartPort` would NOT do.
    const cart = await h.cart.cart.getCurrent({ sessionRef: "guest-1" });
    const items = (cart.body as { items: readonly { productRef: { value: string } }[] }).items;
    expect(items.map((i) => i.productRef.value)).toEqual(["prod-1"]);
  });

  it("re-derives the price server-side — the caller never chooses it (H-01)", async () => {
    const { sessionId } = await signIn("a@example.com");
    await publishedPrice("prod-1", 1500);
    await guestCart("guest-1");
    await wish("POST", "/public/wishlists/me/items", { sessionId, body: { productRef: "prod-1" } });

    await wish("POST", "/public/wishlists/me/items/move-to-cart", {
      sessionId,
      // A price the caller would love to pay. The schema is `.strict()` and the handler reads
      // neither field; the authoritative published price is used regardless.
      body: {
        productRef: "prod-1",
        sessionRef: "guest-1",
        unitPriceAmountMinor: 1,
        currency: "USD",
      },
    });

    const cart = await h.cart.cart.getCurrent({ sessionRef: "guest-1" });
    const items = (cart.body as { items: readonly { unitPrice: { amountMinor: number } }[] }).items;
    expect(items[0]?.unitPrice.amountMinor).toBe(1500);
  });

  it("keeps the item on the wishlist when no price can be resolved (no silent loss)", async () => {
    const { sessionId } = await signIn("a@example.com");
    await guestCart("guest-1");
    await wish("POST", "/public/wishlists/me/items", { sessionId, body: { productRef: "prod-1" } });

    const response = await wish("POST", "/public/wishlists/me/items/move-to-cart", {
      sessionId,
      body: { productRef: "prod-1", sessionRef: "guest-1" },
    });

    expect(response.status).toBe(422);
    const still = (await wish("GET", "/public/wishlists/me", { sessionId }))
      .body as PublicWishlistDto;
    expect(still.items.map((i) => i.productRef)).toEqual(["prod-1"]);
  });

  it("keeps the item on the wishlist when the caller has no cart", async () => {
    const { sessionId } = await signIn("a@example.com");
    await publishedPrice("prod-1", 1500);
    await wish("POST", "/public/wishlists/me/items", { sessionId, body: { productRef: "prod-1" } });

    const response = await wish("POST", "/public/wishlists/me/items/move-to-cart", {
      sessionId,
      body: { productRef: "prod-1", sessionRef: "guest-none" },
    });

    expect(response.status).toBe(404);
    const still = (await wish("GET", "/public/wishlists/me", { sessionId }))
      .body as PublicWishlistDto;
    expect(still.items).toHaveLength(1);
  });

  it("401s for an anonymous caller before touching any cart", async () => {
    await guestCart("guest-1");
    const response = await wish("POST", "/public/wishlists/me/items/move-to-cart", {
      body: { productRef: "prod-1", sessionRef: "guest-1" },
    });

    expect(response.status).toBe(401);
    const cart = await h.cart.cart.getCurrent({ sessionRef: "guest-1" });
    expect((cart.body as { items: readonly unknown[] }).items).toEqual([]);
  });
});

describe("route declarations", () => {
  it("declares every route public and scoped to /me — no id or customerRef in any path", () => {
    for (const route of publicWishlistRoutes(h.admin)) {
      expect(route.public).toBe(true);
      expect(route.path.startsWith("/public/wishlists/me")).toBe(true);
      expect(route.path).not.toContain(":wishlistId");
      expect(route.path).not.toContain(":customerRef");
    }
  });
});

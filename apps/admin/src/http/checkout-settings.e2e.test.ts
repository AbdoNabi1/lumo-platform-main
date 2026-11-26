import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  AuthenticatedContext,
  AuthenticatedIdentity,
  Cache,
  ClaimsAuthenticator,
  Clock,
  IdempotencyClaim,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { createAdminHttpApi } from "./server";
import { httpDriver, seedSingleVariantProduct, type SeededProduct } from "./testing/seed-catalog";
import { httpStockDriver, seedStock } from "./testing/seed-stock";

/**
 * Wave 2a (D33/D34): the shop's checkout and customer-account switches, driven over the REAL admin
 * pipeline (`createAdminHttpApi`, multi-tenant, real tenant resolvers and error mapping) exactly as
 * the storefront and the admin page would. Every rule is shown twice: at its DEFAULT (today's
 * behaviour, unchanged) and switched on (refused by the server, whatever the page shows).
 */

const clock: Clock = { now: () => new Date("2026-09-21T00:00:00.000Z") };
const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const sessions: Record<string, AuthenticatedContext> = {
  "tok-a": { principal: staff, claims: { tenant_id: "tenant-a" } },
  "tok-b": { principal: staff, claims: { tenant_id: "tenant-b" } },
};

function infra() {
  const kv = new Map<string, unknown>();
  const cache: Cache = {
    get: async <T>(k: string) => (kv.get(`cache:${k}`) as T | undefined) ?? null,
    set: async (k, v) => void kv.set(`cache:${k}`, JSON.parse(JSON.stringify(v))),
    delete: async (k) => void kv.delete(`cache:${k}`),
    has: async (k) => kv.has(`cache:${k}`),
  };
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: async (key): Promise<IdempotencyClaim | null> => {
      if (kv.has(`idem:${key}`)) return null;
      kv.set(`idem:${key}`, true);
      return { key, token: "t", release: async () => kv.delete(`idem:${key}`) };
    },
  };
  const rateLimiter: RateLimiter = {
    consume: async () => ({ allowed: true, remaining: 999, retryAfterMs: 0 }),
  };
  const authenticator: ClaimsAuthenticator = {
    verify: async (token) => sessions[token]?.principal ?? null,
    verifyWithClaims: async (token) => sessions[token] ?? null,
  };
  return { cache, idempotencyKeys, rateLimiter, authenticator };
}

let n = 0;
const idGenerator = { generate: () => `id-${(n += 1)}` };

describe("checkout and customer-account settings, enforced through the real HTTP pipeline (Wave 2a)", () => {
  let app: FastifyInstance;
  let seeded: Map<string, SeededProduct>;

  beforeEach(async () => {
    seeded = new Map();
    const fx = infra();
    app = await createAdminHttpApi({
      tenantMode: "multi",
      tenantGate: { availability: async () => "active" as const }, // fixture tenants have no Tenant row (T10.6)
      serializer: new InMemoryEventSerializer(),
      idGenerator,
      clock,
      authenticator: fx.authenticator,
      rateLimiter: fx.rateLimiter,
      idempotencyKeys: fx.idempotencyKeys,
      responseCache: fx.cache,
    });
  });
  afterEach(async () => {
    await app.close();
  });

  const admin = (token: string) => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  });
  const storefront = (tenant: string, extra: Record<string, string> = {}) => ({
    "x-tenant-id": tenant,
    "content-type": "application/json",
    ...extra,
  });

  async function post(url: string, headers: Record<string, string>, payload: unknown) {
    return app.inject({
      method: "POST",
      url: `/api/v1${url}`,
      headers,
      payload: payload as object,
    });
  }
  async function get(url: string, headers: Record<string, string>) {
    return app.inject({ method: "GET", url: `/api/v1${url}`, headers });
  }
  function ok<T>(res: { statusCode: number; body: string; json: () => unknown }, what: string): T {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`${what} failed (${res.statusCode}): ${res.body}`);
    }
    return res.json() as T;
  }

  /**
   * A published product (1999) in one tenant, made by that tenant's staff through the real product
   * routes — the cart prices a line from this variant (Plan 2A), not from a Pricing row.
   */
  async function seedProduct(token: string): Promise<void> {
    const tenant = sessions[token]?.claims?.["tenant_id"];
    if (typeof tenant !== "string") throw new Error(`no tenant for token ${token}`);
    const driver = httpDriver(async (method, url, payload) =>
      method === "GET" ? get(url, admin(token)) : post(url, admin(token), payload ?? {}),
    );
    const product = await seedSingleVariantProduct(driver, "P-1", 1999);
    // Completing a checkout needs stock somewhere (Plan 2B-3): the shared helper puts it there.
    await seedStock(stockDriverFor(token), {
      productId: product.productId,
      variantId: product.variantId,
      quantity: 100,
    });
    seeded.set(tenant, product);
  }

  /** The shared stock helper (Plan 2B-3), driven as the tenant that owns `token`. */
  function stockDriverFor(token: string) {
    return httpStockDriver(async (method, url, payload) =>
      method === "GET" ? get(url, admin(token)) : post(url, admin(token), payload ?? {}),
    );
  }

  const address = { line1: "1 Main St", city: "Springfield", postalCode: "00000", country: "US" };
  const defaults = {
    nameMode: "required",
    phoneMode: "required",
    line2Mode: "optional",
    marketingEmailPrompt: "hidden",
    cartLineLimit: null,
    requireLogin: false,
    accountsMode: "optional",
    showAccountLink: true,
  };

  /** Staff saves the settings document for `token`'s shop, exactly as the admin page posts it. */
  function saveSettings(
    token: string,
    patch: Record<string, unknown>,
    expectedVersion: number | null,
  ) {
    return post("/checkout/settings", admin(token), { ...defaults, ...patch, expectedVersion });
  }

  async function newCart(tenant: string, sessionRef: string, extra: Record<string, string> = {}) {
    return ok<{ id: string }>(
      await post("/public/carts", storefront(tenant, extra), { sessionRef, currency: "USD" }),
      "create cart",
    );
  }
  function addToCart(
    tenant: string,
    cartId: string,
    sessionRef: string,
    quantity: number,
    extra: Record<string, string> = {},
  ) {
    return post(`/public/carts/${cartId}/items`, storefront(tenant, extra), {
      sessionRef,
      productId: seeded.get(tenant)?.productId ?? "not-seeded",
      quantity,
    });
  }
  function setQuantity(tenant: string, cartId: string, sessionRef: string, quantity: number) {
    return post(`/public/carts/${cartId}/items/quantity`, storefront(tenant), {
      sessionRef,
      productId: seeded.get(tenant)?.productId ?? "not-seeded",
      quantity,
    });
  }

  /** cart → started checkout with items loaded; returns the pieces the tests keep driving. */
  async function startedCheckout(
    tenant: string,
    sessionRef: string,
    quantity = 1,
    extra: Record<string, string> = {},
  ) {
    const h = storefront(tenant, extra);
    const cart = await newCart(tenant, sessionRef, extra);
    ok(await addToCart(tenant, cart.id, sessionRef, quantity, extra), "add item");
    const started = ok<{ id: string }>(
      await post("/public/checkouts", h, { sessionRef, cartRef: cart.id, currency: "USD" }),
      "start checkout",
    );
    const base = `/public/checkouts/${started.id}`;
    ok(await post(`${base}/items`, h, { sessionRef, cartId: cart.id }), "load items");
    const finish = async (
      shipping: Record<string, string> = {},
      contact: { email?: string; marketingOptIn?: boolean } = {},
    ) => {
      ok(await post(`${base}/billing-address`, h, { sessionRef, ...address }), "billing");
      ok(
        await post(`${base}/shipping-address`, h, { sessionRef, ...address, ...shipping }),
        "ship",
      );
      ok(await post(`${base}/shipping-selection`, h, { sessionRef, method: "standard" }), "method");
      ok(
        await post(`${base}/payment-selection`, h, {
          sessionRef,
          paymentMethodRef: "pm_1",
          provider: "stripe",
        }),
        "payment",
      );
      ok(
        await post(`${base}/contact`, h, { sessionRef, email: "shopper@example.com", ...contact }),
        "contact",
      );
      ok(await post(`${base}/recalculate`, h, { sessionRef }), "recalculate");
    };
    return {
      cart,
      checkoutId: started.id,
      contact: (body: Record<string, unknown>) =>
        post(`${base}/contact`, h, { sessionRef, email: "shopper@example.com", ...body }),
      shipTo: (shipping: Record<string, string>) =>
        post(`${base}/shipping-address`, h, { sessionRef, ...address, ...shipping }),
      finish,
      complete: () =>
        post(`${base}/complete`, h, { sessionRef, idempotencyKey: `idem-${sessionRef}` }),
      session: async () =>
        ok<{ shippingAddress: Record<string, unknown> | null }>(
          await get(`${base}`, { ...h, "x-cart-session": sessionRef }),
          "get checkout",
        ),
    };
  }

  function fieldsOf(res: { json: () => unknown }): { field: string; message: string }[] {
    return (res.json() as { fields: { field: string; message: string }[] }).fields;
  }

  async function registerAndLogin(tenant: string, email: string): Promise<string> {
    const h = storefront(tenant);
    const registered = await post("/public/auth/register", h, {
      email,
      name: "Sara",
      password: "fake-password-1",
    });
    expect(registered.statusCode).toBe(201);
    const login = ok<{ sessionId: string }>(
      await post("/public/auth/login", h, { email, password: "fake-password-1" }),
      "login",
    );
    return login.sessionId;
  }

  describe("the settings document (admin + public read)", () => {
    it("a shop that never saved gets today's defaults and a null version", async () => {
      const res = await get("/checkout/settings", admin("tok-a"));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ...defaults, version: null });
    });

    it("saves the first row at version 1, then updates at the version it read", async () => {
      const first = await saveSettings("tok-a", { phoneMode: "optional", cartLineLimit: 5 }, null);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ phoneMode: "optional", cartLineLimit: 5, version: 1 });
      const second = await saveSettings("tok-a", { line2Mode: "hidden" }, 1);
      expect(second.json()).toMatchObject({ line2Mode: "hidden", version: 2 });
      const read = await get("/checkout/settings", admin("tok-a"));
      expect(read.json()).toMatchObject({ line2Mode: "hidden", phoneMode: "required", version: 2 });
    });

    it("a stale save is 409 CONFLICT 'These settings were changed by someone else'", async () => {
      await saveSettings("tok-a", {}, null);
      await saveSettings("tok-a", { phoneMode: "optional" }, 1);
      const stale = await saveSettings("tok-a", { cartLineLimit: 3 }, 1);
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({
        code: "CONFLICT",
        message: "These settings were changed by someone else",
      });
      const firstAgain = await saveSettings("tok-a", {}, null);
      expect(firstAgain.statusCode).toBe(409);
    });

    it("requiring login while accounts are off is 422 on requireLogin with the reason (D37)", async () => {
      const res = await saveSettings(
        "tok-a",
        { requireLogin: true, accountsMode: "disabled" },
        null,
      );
      expect(res.statusCode).toBe(422);
      expect(fieldsOf(res)).toEqual([
        { field: "requireLogin", message: "Customer accounts must be on to require login" },
      ]);
      expect((await get("/checkout/settings", admin("tok-a"))).json()).toMatchObject({
        version: null,
      });
    });

    it("an out-of-range limit and an unknown mode are 422 naming the fields", async () => {
      const res = await saveSettings("tok-a", { cartLineLimit: 0, phoneMode: "hidden" }, null);
      expect(res.statusCode).toBe(422);
      expect(
        fieldsOf(res)
          .map((f) => f.field)
          .sort(),
      ).toEqual(["cartLineLimit", "phoneMode"]);
    });

    it("the body is strict: an unknown key is refused, a missing one too", async () => {
      const extra = await post("/checkout/settings", admin("tok-a"), {
        ...defaults,
        expectedVersion: null,
        tenantId: "tenant-b",
      });
      expect(extra.statusCode).toBe(422);
      const { showAccountLink: _omitted, ...rest } = defaults;
      const missing = await post("/checkout/settings", admin("tok-a"), {
        ...rest,
        expectedVersion: null,
      });
      expect(missing.statusCode).toBe(422);
    });

    it("needs a signed-in staff member", async () => {
      expect((await get("/checkout/settings", storefront("tenant-a"))).statusCode).toBe(401);
      const anon = await post("/checkout/settings", storefront("tenant-a"), {
        ...defaults,
        expectedVersion: null,
      });
      expect(anon.statusCode).toBe(401);
    });

    it("the public read is open, returns exactly the eight switches and follows the saved values", async () => {
      const before = await get("/public/checkout-settings", storefront("tenant-a"));
      expect(before.statusCode).toBe(200);
      expect(before.json()).toEqual(defaults);
      await saveSettings("tok-a", { line2Mode: "required", marketingEmailPrompt: "show" }, null);
      const after = (await get("/public/checkout-settings", storefront("tenant-a"))).json();
      expect(after).toEqual({ ...defaults, line2Mode: "required", marketingEmailPrompt: "show" });
      expect(Object.keys(after as object)).not.toContain("version");
    });

    it("settings are per shop", async () => {
      await saveSettings("tok-a", { cartLineLimit: 2, phoneMode: "optional" }, null);
      const b = await get("/public/checkout-settings", storefront("tenant-b"));
      expect(b.json()).toEqual(defaults);
      expect((await get("/checkout/settings", admin("tok-b"))).json()).toMatchObject({
        version: null,
      });
    });
  });

  describe("name, phone and address line 2 (server side)", () => {
    beforeEach(async () => {
      await seedProduct("tok-a");
    });

    it("DEFAULT: an address with no name or phone is accepted and the order completes (unchanged)", async () => {
      const checkout = await startedCheckout("tenant-a", "s-default");
      await checkout.finish();
      expect((await checkout.complete()).statusCode).toBe(200);
    });

    it("saved with name and phone required: a missing name is 422 on `name`, a missing phone on `phone`", async () => {
      await saveSettings("tok-a", {}, null);
      const checkout = await startedCheckout("tenant-a", "s-required");
      const noName = await checkout.shipTo({ phone: "01012345678" });
      expect(noName.statusCode).toBe(422);
      expect(fieldsOf(noName).map((f) => f.field)).toEqual(["name"]);
      const noPhone = await checkout.shipTo({ name: "Mona Ali" });
      expect(noPhone.statusCode).toBe(422);
      expect(fieldsOf(noPhone).map((f) => f.field)).toEqual(["phone"]);
      const neither = await checkout.shipTo({});
      expect(fieldsOf(neither).map((f) => f.field)).toEqual(["name", "phone"]);
      const both = await checkout.shipTo({ name: "Mona Ali", phone: "01012345678" });
      expect(both.statusCode).toBe(200);
    });

    it("name and phone optional: the same address without them is accepted", async () => {
      await saveSettings("tok-a", { nameMode: "optional", phoneMode: "optional" }, null);
      const checkout = await startedCheckout("tenant-a", "s-optional");
      expect((await checkout.shipTo({})).statusCode).toBe(200);
      await checkout.finish();
      expect((await checkout.complete()).statusCode).toBe(200);
    });

    it("line 2 required: empty is 422 on `line2`; filled is accepted", async () => {
      await saveSettings(
        "tok-a",
        { nameMode: "optional", phoneMode: "optional", line2Mode: "required" },
        null,
      );
      const checkout = await startedCheckout("tenant-a", "s-line2");
      const empty = await checkout.shipTo({});
      expect(empty.statusCode).toBe(422);
      expect(fieldsOf(empty).map((f) => f.field)).toEqual(["line2"]);
      expect((await checkout.shipTo({ line2: "Flat 4" })).statusCode).toBe(200);
    });

    it("line 2 hidden: whatever the request sends is dropped", async () => {
      await saveSettings(
        "tok-a",
        { nameMode: "optional", phoneMode: "optional", line2Mode: "hidden" },
        null,
      );
      const checkout = await startedCheckout("tenant-a", "s-hidden");
      expect((await checkout.shipTo({ line2: "Flat 4" })).statusCode).toBe(200);
      const session = await checkout.session();
      expect(session.shippingAddress?.["line2"] ?? null).toBeNull();
    });

    it("line 2 optional (default) keeps what is sent", async () => {
      const checkout = await startedCheckout("tenant-a", "s-line2-default");
      expect((await checkout.shipTo({ line2: "Flat 4" })).statusCode).toBe(200);
      expect((await checkout.session()).shippingAddress).toMatchObject({ line2: "Flat 4" });
    });

    it("a setting changed MID-checkout binds `complete`: phone becomes required -> 422 phone, no order; relaxing it lets the same checkout complete", async () => {
      await saveSettings("tok-a", { phoneMode: "optional" }, null); // v1: phone optional
      const checkout = await startedCheckout("tenant-a", "s-stale");
      await checkout.finish({ name: "Mona Ali" }); // address typed while phone was optional
      await saveSettings("tok-a", { phoneMode: "required" }, 1); // v2: merchant tightens it

      const refused = await checkout.complete();
      expect(refused.statusCode).toBe(422);
      expect(fieldsOf(refused).map((f) => f.field)).toEqual(["phone"]);

      await saveSettings("tok-a", { phoneMode: "optional" }, 2); // v3: relaxed again
      const done = await checkout.complete();
      expect(done.statusCode).toBe(200);
      expect((done.json() as { orderRef: string | null }).orderRef).not.toBeNull();
    });
  });

  describe("the add-to-cart limit (server side)", () => {
    beforeEach(async () => {
      await seedProduct("tok-a");
    });

    it("DEFAULT (no limit): a large quantity is added and changed freely (unchanged)", async () => {
      const cart = await newCart("tenant-a", "s-nolimit");
      expect((await addToCart("tenant-a", cart.id, "s-nolimit", 50)).statusCode).toBe(200);
      expect((await setQuantity("tenant-a", cart.id, "s-nolimit", 80)).statusCode).toBe(200);
    });

    it("limit 3: adding 4 is 422 `You can add up to 3 of this item`; 3 is fine; one more is refused", async () => {
      await saveSettings("tok-a", { cartLineLimit: 3 }, null);
      const cart = await newCart("tenant-a", "s-limit");
      const over = await addToCart("tenant-a", cart.id, "s-limit", 4);
      expect(over.statusCode).toBe(422);
      expect(fieldsOf(over)).toEqual([
        { field: "quantity", message: "You can add up to 3 of this item" },
      ]);
      expect((await addToCart("tenant-a", cart.id, "s-limit", 3)).statusCode).toBe(200);
      const more = await addToCart("tenant-a", cart.id, "s-limit", 1);
      expect(more.statusCode).toBe(422);
      expect(fieldsOf(more)[0]?.field).toBe("quantity");
    });

    it("limit 3: changing a line to 4 is refused and to 2 is accepted", async () => {
      await saveSettings("tok-a", { cartLineLimit: 3 }, null);
      const cart = await newCart("tenant-a", "s-change");
      await addToCart("tenant-a", cart.id, "s-change", 1);
      const over = await setQuantity("tenant-a", cart.id, "s-change", 4);
      expect(over.statusCode).toBe(422);
      expect(fieldsOf(over)).toEqual([
        { field: "quantity", message: "You can add up to 3 of this item" },
      ]);
      expect((await setQuantity("tenant-a", cart.id, "s-change", 2)).statusCode).toBe(200);
    });

    it("a CUSTOMER's cart (claimed on sign-in) is held to the same limit", async () => {
      await saveSettings("tok-a", { cartLineLimit: 3 }, null);
      const customer = await registerAndLogin("tenant-a", "sara@example.com");
      const cart = await newCart("tenant-a", "s-customer");
      expect((await addToCart("tenant-a", cart.id, "s-customer", 2)).statusCode).toBe(200);
      const claimed = await post(
        "/public/auth/claim-cart",
        storefront("tenant-a", { "x-customer-session": customer }),
        { cartId: cart.id, sessionRef: "s-customer" },
      );
      expect(claimed.statusCode).toBe(200);
      const over = await addToCart("tenant-a", cart.id, "s-customer", 2, {
        "x-customer-session": customer,
      });
      expect(over.statusCode).toBe(422);
      expect(fieldsOf(over)[0]?.message).toBe("You can add up to 3 of this item");
      expect((await setQuantity("tenant-a", cart.id, "s-customer", 3)).statusCode).toBe(200);
    });

    it("lowering the limit after the cart was filled: checkout START re-checks the cart (422), and so does item loading", async () => {
      const cart = await newCart("tenant-a", "s-lowered");
      await addToCart("tenant-a", cart.id, "s-lowered", 5);
      const h = storefront("tenant-a");
      // A checkout started before the limit was set ...
      const early = ok<{ id: string }>(
        await post("/public/checkouts", h, {
          sessionRef: "s-lowered",
          cartRef: cart.id,
          currency: "USD",
        }),
        "early start",
      );
      await saveSettings("tok-a", { cartLineLimit: 3 }, null);
      // ... can no longer load the over-limit line,
      const load = await post(`/public/checkouts/${early.id}/items`, h, {
        sessionRef: "s-lowered",
        cartId: cart.id,
      });
      expect(load.statusCode).toBe(422);
      expect(fieldsOf(load)).toEqual([
        { field: "quantity", message: "You can add up to 3 of this item" },
      ]);
      // and a new checkout cannot start from it.
      const start = await post("/public/checkouts", h, {
        sessionRef: "s-lowered",
        cartRef: cart.id,
        currency: "USD",
      });
      expect(start.statusCode).toBe(422);
      expect(fieldsOf(start)[0]?.field).toBe("quantity");
      // Bringing the line down to the limit makes it work again.
      expect((await setQuantity("tenant-a", cart.id, "s-lowered", 3)).statusCode).toBe(200);
      const restart = await post("/public/checkouts", h, {
        sessionRef: "s-lowered",
        cartRef: cart.id,
        currency: "USD",
      });
      expect(restart.statusCode).toBe(201);
    });
  });

  describe("require login before checkout (server side)", () => {
    beforeEach(async () => {
      await seedProduct("tok-a");
    });

    it("DEFAULT: a guest starts and completes a checkout (unchanged)", async () => {
      const checkout = await startedCheckout("tenant-a", "s-guest-ok");
      await checkout.finish();
      expect((await checkout.complete()).statusCode).toBe(200);
    });

    it("on: a guest cannot START a checkout -> 403 LOGIN_REQUIRED 'Sign in to check out'", async () => {
      await saveSettings("tok-a", { requireLogin: true }, null);
      const cart = await newCart("tenant-a", "s-guest");
      ok(await addToCart("tenant-a", cart.id, "s-guest", 1), "add");
      const res = await post("/public/checkouts", storefront("tenant-a"), {
        sessionRef: "s-guest",
        cartRef: cart.id,
        currency: "USD",
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: "LOGIN_REQUIRED", message: "Sign in to check out" });
    });

    it("on: a guest cannot COMPLETE a checkout that was started before the switch; a made-up session id does not count", async () => {
      const checkout = await startedCheckout("tenant-a", "s-midway");
      await checkout.finish();
      await saveSettings("tok-a", { requireLogin: true }, null);
      const guest = await checkout.complete();
      expect(guest.statusCode).toBe(403);
      expect(guest.json()).toMatchObject({ code: "LOGIN_REQUIRED" });
      const forged = await post(
        `/public/checkouts/${checkout.checkoutId}/complete`,
        storefront("tenant-a", { "x-customer-session": "not-a-real-session" }),
        { sessionRef: "s-midway", idempotencyKey: "idem-forged" },
      );
      expect(forged.statusCode).toBe(403);
    });

    it("on: a signed-in customer starts and completes", async () => {
      await saveSettings("tok-a", { requireLogin: true }, null);
      const customer = await registerAndLogin("tenant-a", "sara@example.com");
      const checkout = await startedCheckout("tenant-a", "s-member", 1, {
        "x-customer-session": customer,
      });
      await checkout.finish({ name: "Sara", phone: "01012345678" });
      const done = await post(
        `/public/checkouts/${checkout.checkoutId}/complete`,
        storefront("tenant-a", { "x-customer-session": customer }),
        { sessionRef: "s-member", idempotencyKey: "idem-member" },
      );
      expect(done.statusCode).toBe(200);
    });

    it("another shop's switch does not bind this shop", async () => {
      await saveSettings("tok-b", { requireLogin: true }, null);
      const checkout = await startedCheckout("tenant-a", "s-other-shop");
      await checkout.finish();
      expect((await checkout.complete()).statusCode).toBe(200);
    });
  });

  describe("customer accounts off (server side)", () => {
    beforeEach(async () => {
      await seedProduct("tok-a");
    });

    it("DEFAULT: register, login, me and logout all work (unchanged)", async () => {
      const session = await registerAndLogin("tenant-a", "sara@example.com");
      const me = await get(
        "/public/auth/me",
        storefront("tenant-a", { "x-customer-session": session }),
      );
      expect(me.statusCode).toBe(200);
    });

    it("off: register, signup/complete and login are 403 ACCOUNTS_DISABLED with the store message", async () => {
      await saveSettings("tok-a", { accountsMode: "disabled" }, null);
      const h = storefront("tenant-a");
      const register = await post("/public/auth/register", h, {
        email: "new@example.com",
        name: "New",
        password: "fake-password-1",
      });
      const complete = await post("/public/auth/signup/complete", h, {
        token: "t".repeat(32),
        name: "New",
        password: "fake-password-1",
      });
      const login = await post("/public/auth/login", h, {
        email: "new@example.com",
        password: "fake-password-1",
      });
      for (const res of [register, complete, login]) {
        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({
          code: "ACCOUNTS_DISABLED",
          message: "Customer accounts are turned off for this store",
        });
      }
    });

    it("off: nobody was registered by the refused sign-up", async () => {
      await saveSettings("tok-a", { accountsMode: "disabled" }, null);
      await post("/public/auth/register", storefront("tenant-a"), {
        email: "ghost@example.com",
        name: "Ghost",
        password: "fake-password-1",
      });
      await saveSettings("tok-a", { accountsMode: "optional" }, 1);
      const login = await post("/public/auth/login", storefront("tenant-a"), {
        email: "ghost@example.com",
        password: "fake-password-1",
      });
      expect(login.statusCode).toBe(401);
    });

    it("off: a customer already signed in keeps me, refresh, claim-cart and logout; guest checkout still completes (D37)", async () => {
      const session = await registerAndLogin("tenant-a", "sara@example.com");
      await saveSettings("tok-a", { accountsMode: "disabled" }, null);
      const h = storefront("tenant-a", { "x-customer-session": session });

      expect((await get("/public/auth/me", h)).statusCode).toBe(200);
      expect((await post("/public/auth/refresh", h, {})).statusCode).toBe(200);
      const cart = await newCart("tenant-a", "s-claim");
      await addToCart("tenant-a", cart.id, "s-claim", 1);
      const claimed = await post("/public/auth/claim-cart", h, {
        cartId: cart.id,
        sessionRef: "s-claim",
      });
      expect(claimed.statusCode).toBe(200);
      expect((await post("/public/auth/logout", h, {})).statusCode).toBe(200);

      const guest = await startedCheckout("tenant-a", "s-guest-after");
      await guest.finish({ name: "Guest", phone: "01012345678" });
      expect((await guest.complete()).statusCode).toBe(200);
    });

    it("logout and me without a session answer as they always did while accounts are off", async () => {
      await saveSettings("tok-a", { accountsMode: "disabled" }, null);
      const h = storefront("tenant-a");
      expect((await post("/public/auth/logout", h, {})).statusCode).toBe(200);
      expect((await get("/public/auth/me", h)).statusCode).toBe(401);
    });

    it("turning accounts off is refused while login is required, with the reason", async () => {
      await saveSettings("tok-a", { requireLogin: true }, null);
      const res = await saveSettings("tok-a", { requireLogin: true, accountsMode: "disabled" }, 1);
      expect(res.statusCode).toBe(422);
      expect(fieldsOf(res)[0]).toEqual({
        field: "requireLogin",
        message: "Customer accounts must be on to require login",
      });
    });
  });

  describe("marketing opt-in at checkout (D35, server side)", () => {
    const shopper = { name: "Mona Ali", phone: "01012345678" };

    beforeEach(async () => {
      await seedProduct("tok-a");
    });

    /** Whether the shop's customer with this email currently agrees to marketing email (staff view). */
    async function agrees(token: string, email: string): Promise<boolean | undefined> {
      const page = ok<{ items: { email: string; emailMarketing: boolean }[] }>(
        await get("/customers/export-rows?limit=50", admin(token)),
        "customers",
      );
      return page.items.find((row) => row.email === email)?.emailMarketing;
    }

    it("prompt shown and ticked: completing the order records the shopper's marketing consent", async () => {
      await saveSettings("tok-a", { marketingEmailPrompt: "show" }, null);
      const checkout = await startedCheckout("tenant-a", "s-ticked");
      await checkout.finish(shopper, { marketingOptIn: true });
      expect(await agrees("tok-a", "shopper@example.com")).toBeUndefined(); // nobody yet
      expect((await checkout.complete()).statusCode).toBe(200);
      expect(await agrees("tok-a", "shopper@example.com")).toBe(true);
    });

    it("prompt preselect: a ticked box is recorded the same way", async () => {
      await saveSettings("tok-a", { marketingEmailPrompt: "preselect" }, null);
      const checkout = await startedCheckout("tenant-a", "s-pre");
      await checkout.finish(shopper, { marketingOptIn: true });
      expect((await checkout.complete()).statusCode).toBe(200);
      expect(await agrees("tok-a", "shopper@example.com")).toBe(true);
    });

    it("prompt shown but unticked, or never answered: the order completes and nothing is recorded", async () => {
      await saveSettings("tok-a", { marketingEmailPrompt: "show" }, null);
      const unticked = await startedCheckout("tenant-a", "s-unticked");
      await unticked.finish(shopper, { marketingOptIn: false });
      expect((await unticked.complete()).statusCode).toBe(200);
      expect(await agrees("tok-a", "shopper@example.com")).toBe(false);
      const silent = await startedCheckout("tenant-a", "s-silent");
      await silent.finish(shopper);
      expect((await silent.complete()).statusCode).toBe(200);
      expect(await agrees("tok-a", "shopper@example.com")).toBe(false);
    });

    it("prompt hidden (the DEFAULT, no settings row): a sent marketingOptIn is ignored and nothing is recorded", async () => {
      const checkout = await startedCheckout("tenant-a", "s-hidden");
      await checkout.finish(shopper, { marketingOptIn: true });
      expect((await checkout.complete()).statusCode).toBe(200);
      expect(await agrees("tok-a", "shopper@example.com")).toBe(false);
    });

    it("prompt saved as hidden: a forged marketingOptIn is ignored too", async () => {
      await saveSettings("tok-a", { marketingEmailPrompt: "hidden" }, null);
      const checkout = await startedCheckout("tenant-a", "s-forged");
      await checkout.finish(shopper, { marketingOptIn: true });
      expect((await checkout.complete()).statusCode).toBe(200);
      expect(await agrees("tok-a", "shopper@example.com")).toBe(false);
    });

    it("a signed-in customer checks out with their account email: the consent lands on THEIR account", async () => {
      await saveSettings("tok-a", { marketingEmailPrompt: "show" }, null);
      const session = await registerAndLogin("tenant-a", "sara@example.com");
      const checkout = await startedCheckout("tenant-a", "s-member-mkt", 1, {
        "x-customer-session": session,
      });
      await checkout.finish(shopper, { email: "sara@example.com", marketingOptIn: true });
      const done = await post(
        `/public/checkouts/${checkout.checkoutId}/complete`,
        storefront("tenant-a", { "x-customer-session": session }),
        { sessionRef: "s-member-mkt", idempotencyKey: "idem-member-mkt" },
      );
      expect(done.statusCode).toBe(200);
      expect(await agrees("tok-a", "sara@example.com")).toBe(true);
    });

    it("another shop's prompt does not apply to this shop", async () => {
      await saveSettings("tok-b", { marketingEmailPrompt: "show" }, null);
      const checkout = await startedCheckout("tenant-a", "s-other-shop-mkt");
      await checkout.finish(shopper, { marketingOptIn: true });
      expect((await checkout.complete()).statusCode).toBe(200);
      expect(await agrees("tok-a", "shopper@example.com")).toBe(false);
    });

    it("the contact body stays strict: marketingOptIn must be a boolean, and unknown keys are refused", async () => {
      await saveSettings("tok-a", { marketingEmailPrompt: "show" }, null);
      const checkout = await startedCheckout("tenant-a", "s-strict");
      expect((await checkout.contact({ marketingOptIn: "yes" })).statusCode).toBe(422);
      expect((await checkout.contact({ customerRef: "someone-else" })).statusCode).toBe(422);
      expect((await checkout.contact({ marketingOptIn: true })).statusCode).toBe(200);
    });
  });
});

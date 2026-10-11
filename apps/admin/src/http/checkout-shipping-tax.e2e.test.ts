import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  Authenticator,
  AuthenticatedIdentity,
  Cache,
  Clock,
  IdempotencyClaim,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryAuditTrail } from "../infrastructure/in-memory-audit-trail";
import { createAdminHttpApi } from "./server";
import { httpDriver, seedCatalogProduct, type SeededProduct } from "./testing/seed-catalog";
import { httpStockDriver, seedStock } from "./testing/seed-stock";

/**
 * Plan 3C — the real shipping and tax in the checkout, through the real HTTP pipeline. The merchant's
 * zones and tax settings are set up with the staff routes; the shopper's flow is the public one. The
 * browser never sends a price, rate or tax: the quote and the tax come from the shop's own settings,
 * with each line's weight and `taxable` read from Catalog.
 */

const clock: Clock = { now: () => new Date("2026-10-11T00:00:00.000Z") };
const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const TENANT = "t-1";

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
  const authenticator: Authenticator = {
    verify: async (token) => (token === "good" ? staff : null),
  };
  return { cache, idempotencyKeys, rateLimiter, authenticator };
}

let counter = 0;
const idGenerator = { generate: () => `id-${(counter += 1)}` };

interface Rate {
  /** The shipping rate's id; the checkout selects by it. */
  method: string;
  name: string;
  rateAmountMinor: number;
  description?: string;
}

describe("checkout with the shop's real shipping zones and taxes (Plan 3C)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const fx = infra();
    app = await createAdminHttpApi({
      serializer: new InMemoryEventSerializer(),
      idGenerator,
      clock,
      auditTrail: new InMemoryAuditTrail(),
      authenticator: fx.authenticator,
      rateLimiter: fx.rateLimiter,
      idempotencyKeys: fx.idempotencyKeys,
      responseCache: fx.cache,
      realShippingAndTax: true,
    });
  });
  afterEach(async () => {
    await app.close();
  });

  let keys = 0;
  const staffHeaders = (tenant = TENANT) => ({
    authorization: "Bearer good",
    "x-tenant-id": tenant,
    "content-type": "application/json",
  });
  const shopper = (tenant = TENANT) => ({
    "x-tenant-id": tenant,
    "content-type": "application/json",
  });

  async function send(
    method: "GET" | "POST" | "PUT",
    url: string,
    headers: Record<string, string>,
    payload?: unknown,
  ) {
    keys += 1;
    return app.inject({
      method,
      url: `/api/v1${url}`,
      headers: method === "GET" ? headers : { ...headers, "idempotency-key": `e2e-${keys}` },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  }
  async function ok<T>(
    res: { statusCode: number; body: string; json: () => unknown },
    what: string,
  ): Promise<T> {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`${what} failed (${res.statusCode}): ${res.body}`);
    }
    return res.json() as T;
  }

  async function zone(
    name: string,
    countries: { code: string; provinces: string[] | null }[],
    rates: { name: string; priceMinor: number; condition?: unknown }[],
    tenant = TENANT,
  ): Promise<void> {
    const made = await ok<{ id: string }>(
      await send("POST", "/shipping/zones", staffHeaders(tenant), { name, countries }),
      "create zone",
    );
    for (const rate of rates) {
      await ok(
        await send("POST", `/shipping/zones/${made.id}/rates`, staffHeaders(tenant), rate),
        "add rate",
      );
    }
  }

  /** Cairo at 50.00 (free over 1000.00), the rest of Egypt at 75.00. */
  async function setUpZones(tenant = TENANT): Promise<void> {
    await zone(
      "Cairo",
      [{ code: "EG", provinces: ["EG-C"] }],
      [
        { name: "Standard", priceMinor: 5000 },
        {
          name: "Free over 1000",
          priceMinor: 0,
          condition: { type: "orderPrice", minMinor: 100_000 },
        },
      ],
      tenant,
    );
    await zone(
      "Rest of Egypt",
      [{ code: "EG", provinces: ["EG-GZ", "EG-ALX"] }],
      [{ name: "Standard", priceMinor: 7500 }],
      tenant,
    );
  }

  async function setUpTax(includes: boolean, ratePercentBp = 1400): Promise<void> {
    await ok(
      await send("PUT", "/taxes/settings", staffHeaders(), {
        pricesIncludeTax: includes,
        chargeTaxOnShipping: false,
      }),
      "tax settings",
    );
    await ok(
      await send("PUT", "/taxes/regions/EG", staffHeaders(), {
        rateBasisPoints: ratePercentBp,
        provinces: [],
      }),
      "tax region",
    );
  }

  async function product(sku: string, priceMinor: number): Promise<SeededProduct> {
    const driver = httpDriver(async (method, url, payload) =>
      method === "GET"
        ? send("GET", url, staffHeaders())
        : send("POST", url, staffHeaders(), payload ?? {}),
    );
    return seedCatalogProduct(driver, {
      sku,
      currency: "EGP",
      variants: [{ sku: `${sku}-V1`, priceAmountMinor: priceMinor }],
    });
  }

  /** cart → checkout → items → shipping address, as the anonymous storefront. */
  async function checkoutAt(
    sessionRef: string,
    seeded: SeededProduct,
    address: Record<string, string>,
    quantity = 1,
    tenant = TENANT,
  ) {
    const h = shopper(tenant);
    const cart = await ok<{ id: string }>(
      await send("POST", "/public/carts", h, { sessionRef, currency: "EGP" }),
      "create cart",
    );
    await ok(
      await send("POST", `/public/carts/${cart.id}/items`, h, {
        sessionRef,
        productId: seeded.productId,
        variantId: seeded.variantId,
        quantity,
      }),
      "add item",
    );
    const started = await ok<{ id: string }>(
      await send("POST", "/public/checkouts", h, { sessionRef, cartRef: cart.id, currency: "EGP" }),
      "start checkout",
    );
    const base = `/public/checkouts/${started.id}`;
    await ok(await send("POST", `${base}/items`, h, { sessionRef, cartId: cart.id }), "load items");
    const shipping = await send("POST", `${base}/shipping-address`, h, { sessionRef, ...address });
    return { base, h, sessionRef, shipping };
  }

  const cairo = {
    line1: "1 Tahrir St",
    city: "Cairo",
    postalCode: "11511",
    country: "EG",
    province: "EG-C",
  };
  const giza = { ...cairo, city: "Giza", province: "EG-GZ" };

  async function quotes(c: {
    base: string;
    h: Record<string, string>;
    sessionRef: string;
  }): Promise<Rate[]> {
    const res = await ok<{ quotes: Rate[] }>(
      await send("POST", `${c.base}/shipping-quote`, c.h, { sessionRef: c.sessionRef }),
      "quote",
    );
    return res.quotes;
  }

  it("a Cairo address quotes 50.00 and a Giza address quotes 75.00", async () => {
    await setUpZones();
    const mug = await product("MUG", 20_000);

    const inCairo = await checkoutAt("s-cairo", mug, cairo);
    const inGiza = await checkoutAt("s-giza", mug, giza);

    expect((await quotes(inCairo)).map((q) => [q.name, q.rateAmountMinor])).toEqual([
      ["Standard", 5000],
    ]);
    expect((await quotes(inGiza)).map((q) => [q.name, q.rateAmountMinor])).toEqual([
      ["Standard", 7500],
    ]);
  });

  it('"Free over 1000" appears only for an order of 1000 or more', async () => {
    await setUpZones();
    const mug = await product("MUG", 60_000);

    const small = await checkoutAt("s-small", mug, cairo, 1); // 600.00
    const big = await checkoutAt("s-big", mug, cairo, 2); // 1,200.00

    expect((await quotes(small)).map((q) => q.name)).toEqual(["Standard"]);
    expect((await quotes(big)).map((q) => [q.name, q.rateAmountMinor])).toEqual([
      ["Free over 1000", 0],
      ["Standard", 5000],
    ]);
  });

  it("selecting a rate snapshots its name and price, and the totals follow it", async () => {
    await setUpZones();
    const mug = await product("MUG", 20_000);
    const c = await checkoutAt("s-pick", mug, cairo);
    const [standard] = await quotes(c);

    const picked = await ok<{ selectedShippingMethod: string }>(
      await send("POST", `${c.base}/shipping-selection`, c.h, {
        sessionRef: c.sessionRef,
        method: standard?.method ?? "",
      }),
      "select",
    );
    const totals = await ok<{ totals: { shippingMinor: number; shippingName: string | null } }>(
      await send("POST", `${c.base}/recalculate`, c.h, { sessionRef: c.sessionRef }),
      "recalculate",
    );

    expect(picked.selectedShippingMethod).toBe(standard?.method);
    expect(totals.totals).toMatchObject({ shippingMinor: 5000, shippingName: "Standard" });
  });

  it("an address outside every zone has no rates, and a forged rate id is refused (422)", async () => {
    await setUpZones();
    const mug = await product("MUG", 20_000);
    const c = await checkoutAt("s-france", mug, {
      line1: "1 Rue",
      city: "Paris",
      postalCode: "75001",
      country: "FR",
    });

    expect(await quotes(c)).toEqual([]);

    const forged = await send("POST", `${c.base}/shipping-selection`, c.h, {
      sessionRef: c.sessionRef,
      method: "forged-rate-id",
    });
    expect(forged.statusCode).toBe(422);
  });

  it("a rate id from another shop's zones is refused too", async () => {
    await setUpZones();
    await zone(
      "Their Egypt",
      [{ code: "EG", provinces: null }],
      [{ name: "Theirs", priceMinor: 1 }],
      "t-2",
    );
    const theirs = await ok<{ items: { rates: { id: string }[] }[] }>(
      await send("GET", "/shipping/zones", staffHeaders("t-2")),
      "their zones",
    );
    const mug = await product("MUG", 20_000);
    const c = await checkoutAt("s-cross", mug, cairo);

    const res = await send("POST", `${c.base}/shipping-selection`, c.h, {
      sessionRef: c.sessionRef,
      method: theirs.items[0]?.rates[0]?.id ?? "",
    });

    expect(res.statusCode).toBe(422);
  });

  it("refuses an Egyptian address with no governorate, or one from another country (422)", async () => {
    await setUpZones();
    const mug = await product("MUG", 20_000);

    const none = await checkoutAt("s-none", mug, { ...cairo, province: "" });
    const wrong = await checkoutAt("s-wrong", mug, { ...cairo, province: "SA-01" });

    expect(none.shipping.statusCode).toBe(422);
    expect(wrong.shipping.statusCode).toBe(422);
  });

  it("with prices that include tax at 14%: tax is shown, and the grand total is subtotal + shipping", async () => {
    await setUpZones();
    await setUpTax(true);
    const mug = await product("MUG", 11_400);
    const c = await checkoutAt("s-incl", mug, cairo);
    const [standard] = await quotes(c);
    await send("POST", `${c.base}/shipping-selection`, c.h, {
      sessionRef: c.sessionRef,
      method: standard?.method ?? "",
    });

    await ok(await send("POST", `${c.base}/tax`, c.h, { sessionRef: c.sessionRef }), "tax");
    const done = await ok<{
      totals: {
        subtotalMinor: number;
        shippingMinor: number;
        taxMinor: number;
        grandTotalMinor: number;
        taxIncluded: boolean;
      };
    }>(
      await send("POST", `${c.base}/recalculate`, c.h, { sessionRef: c.sessionRef }),
      "recalculate",
    );

    expect(done.totals.taxMinor).toBeGreaterThan(0);
    expect(done.totals.taxMinor).toBe(1400);
    expect(done.totals.taxIncluded).toBe(true);
    expect(done.totals.grandTotalMinor).toBe(done.totals.subtotalMinor + done.totals.shippingMinor);
  });

  it("with prices that exclude tax: the tax is added to the grand total", async () => {
    await setUpZones();
    await setUpTax(false);
    const mug = await product("MUG", 10_000);
    const c = await checkoutAt("s-excl", mug, cairo);
    const [standard] = await quotes(c);
    await send("POST", `${c.base}/shipping-selection`, c.h, {
      sessionRef: c.sessionRef,
      method: standard?.method ?? "",
    });

    await ok(await send("POST", `${c.base}/tax`, c.h, { sessionRef: c.sessionRef }), "tax");
    const done = await ok<{
      totals: {
        subtotalMinor: number;
        shippingMinor: number;
        taxMinor: number;
        grandTotalMinor: number;
        taxIncluded: boolean;
      };
    }>(
      await send("POST", `${c.base}/recalculate`, c.h, { sessionRef: c.sessionRef }),
      "recalculate",
    );

    expect(done.totals).toMatchObject({ taxMinor: 1400, taxIncluded: false });
    expect(done.totals.grandTotalMinor).toBe(10_000 + 5000 + 1400);
  });

  it("with no tax region, the tax is zero — not 10%", async () => {
    await setUpZones();
    const mug = await product("MUG", 10_000);
    const c = await checkoutAt("s-notax", mug, cairo);
    const [standard] = await quotes(c);
    await send("POST", `${c.base}/shipping-selection`, c.h, {
      sessionRef: c.sessionRef,
      method: standard?.method ?? "",
    });

    await ok(await send("POST", `${c.base}/tax`, c.h, { sessionRef: c.sessionRef }), "tax");
    const done = await ok<{ totals: { taxMinor: number; grandTotalMinor: number } }>(
      await send("POST", `${c.base}/recalculate`, c.h, { sessionRef: c.sessionRef }),
      "recalculate",
    );

    expect(done.totals.taxMinor).toBe(0);
    expect(done.totals.grandTotalMinor).toBe(10_000 + 5000);
  });

  it("the shipping country list is the countries of the shop's zones, and nothing else", async () => {
    expect((await send("GET", "/public/shipping/countries", shopper())).json()).toEqual({
      countries: [],
      restOfWorld: false,
    });

    await setUpZones();
    await zone("Gulf", [{ code: "SA", provinces: null }], [{ name: "Gulf", priceMinor: 20_000 }]);
    await zone("World", [{ code: "*", provinces: null }], [{ name: "World", priceMinor: 90_000 }]);

    const res = await send("GET", "/public/shipping/countries", shopper());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ countries: ["EG", "SA"], restOfWorld: true });
    expect(await send("GET", "/public/shipping/countries", shopper("t-2"))).toMatchObject({
      statusCode: 200,
    });
    expect((await send("GET", "/public/shipping/countries", shopper("t-2"))).json()).toEqual({
      countries: [],
      restOfWorld: false,
    });
  });

  it("the placed order records the province, the rate's name and how its tax was worked out", async () => {
    await setUpZones();
    await setUpTax(true);
    const mug = await product("MUG", 11_400);
    await seedStock(
      httpStockDriver(async (method, url, payload) =>
        method === "GET"
          ? send("GET", url, staffHeaders())
          : send("POST", url, staffHeaders(), payload ?? {}),
      ),
      { productId: mug.productId, variantId: mug.variantId, quantity: 10 },
    );
    const c = await checkoutAt("s-order", mug, cairo);
    const [standard] = await quotes(c);
    const ref = { sessionRef: c.sessionRef };
    await ok(
      await send("POST", `${c.base}/shipping-selection`, c.h, {
        ...ref,
        method: standard?.method ?? "",
      }),
      "select shipping",
    );
    await ok(await send("POST", `${c.base}/billing-address`, c.h, { ...ref, ...cairo }), "billing");
    await ok(
      await send("POST", `${c.base}/contact`, c.h, { ...ref, email: "mona@example.com" }),
      "contact",
    );
    await ok(
      await send("POST", `${c.base}/payment-selection`, c.h, {
        ...ref,
        paymentMethodRef: "pm_1",
        provider: "stripe",
      }),
      "payment",
    );
    await ok(await send("POST", `${c.base}/tax`, c.h, ref), "tax");
    await ok(await send("POST", `${c.base}/recalculate`, c.h, ref), "recalculate");
    const placed = await ok<{ orderRef: string }>(
      await send("POST", `${c.base}/complete`, c.h, { ...ref, idempotencyKey: "idem-order" }),
      "complete",
    );

    const order = await ok<{
      shippingAddress: { province: string | null };
      billingAddress: { province: string | null } | null;
      totals: {
        taxMinor: number;
        taxIncluded: boolean;
        shippingName: string | null;
        totalMinor: number;
      };
    }>(await send("GET", `/orders/${placed.orderRef}`, staffHeaders()), "order");

    expect(order.shippingAddress.province).toBe("EG-C");
    expect(order.billingAddress?.province).toBe("EG-C");
    expect(order.totals).toMatchObject({
      taxMinor: 1400,
      taxIncluded: true,
      shippingName: "Standard",
      totalMinor: 11_400 + 5000,
    });
  });

  it("the storefront cannot send a price, rate or tax: the selection body takes only a method", async () => {
    await setUpZones();
    const mug = await product("MUG", 20_000);
    const c = await checkoutAt("s-strict", mug, cairo);

    const res = await send("POST", `${c.base}/shipping-selection`, c.h, {
      sessionRef: c.sessionRef,
      method: "x",
      rateAmountMinor: 1,
    });

    expect(res.statusCode).toBe(422);
  });
});

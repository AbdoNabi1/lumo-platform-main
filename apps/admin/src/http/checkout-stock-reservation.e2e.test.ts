import { afterEach, describe, expect, it } from "vitest";
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
import type { InventoryValidationPort } from "@platform/checkout";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryAuditTrail } from "../infrastructure/in-memory-audit-trail";
import { createAdminHttpApi } from "./server";
import { httpDriver, seedSingleVariantProduct, type SeededProduct } from "./testing/seed-catalog";
import { httpStockDriver, seedStock } from "./testing/seed-stock";

/**
 * Plan 3C (G-114) — the stock is reserved the moment an order is placed, through the real HTTP
 * pipeline and the real Inventory / Orders / Checkout wiring. What only the whole stack shows:
 *  - placing an order moves stock from available to reserved;
 *  - when validation passes but the reservation then fails (another shopper took the last units
 *    in between), the order is cancelled, the stock is untouched and the answer is 409 `OUT_OF_STOCK:`;
 *  - cancelling an order gives its stock back;
 *  - requesting fulfillment afterwards reuses the reservation instead of reserving a second time.
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

interface StockRow {
  readonly variantId: string | null;
  readonly onHand: number;
  readonly reserved: number;
  readonly available: number;
}

describe("the stock is reserved when the order is placed (Plan 3C, G-114)", () => {
  let app: FastifyInstance;
  let keys = 0;

  afterEach(async () => {
    await app.close();
  });

  async function start(options: { inventoryValidation?: InventoryValidationPort } = {}) {
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
      ...(options.inventoryValidation === undefined
        ? {}
        : { inventoryValidation: options.inventoryValidation }),
    });
  }

  const staffHeaders = {
    authorization: "Bearer good",
    "x-tenant-id": TENANT,
    "content-type": "application/json",
  };
  const shopper = { "x-tenant-id": TENANT, "content-type": "application/json" };

  async function send(
    method: "GET" | "POST",
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
  function ok<T>(res: { statusCode: number; body: string; json: () => unknown }, what: string): T {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`${what} failed (${res.statusCode}): ${res.body}`);
    }
    return res.json() as T;
  }

  async function productWithStock(quantity: number): Promise<SeededProduct> {
    const catalog = httpDriver(async (method, url, payload) =>
      method === "GET"
        ? send("GET", url, staffHeaders)
        : send("POST", url, staffHeaders, payload ?? {}),
    );
    const product = await seedSingleVariantProduct(catalog, "MUG", 2000);
    await seedStock(
      httpStockDriver(async (method, url, payload) =>
        method === "GET"
          ? send("GET", url, staffHeaders)
          : send("POST", url, staffHeaders, payload ?? {}),
      ),
      { productId: product.productId, variantId: product.variantId, quantity },
    );
    return product;
  }

  async function stock(product: SeededProduct): Promise<StockRow> {
    const rows = ok<StockRow[]>(
      await send("GET", `/products/${product.productId}/inventory`, staffHeaders),
      "read stock",
    );
    const row = rows.find((r) => r.variantId === product.variantId) ?? rows[0];
    if (row === undefined) throw new Error("no stock row");
    return row;
  }

  const address = { line1: "1 Main St", city: "Springfield", postalCode: "00000", country: "US" };

  async function checkout(sessionRef: string, product: SeededProduct, quantity: number) {
    const cart = ok<{ id: string }>(
      await send("POST", "/public/carts", shopper, { sessionRef, currency: "USD" }),
      "create cart",
    );
    ok(
      await send("POST", `/public/carts/${cart.id}/items`, shopper, {
        sessionRef,
        productId: product.productId,
        variantId: product.variantId,
        quantity,
      }),
      "add item",
    );
    const started = ok<{ id: string }>(
      await send("POST", "/public/checkouts", shopper, {
        sessionRef,
        cartRef: cart.id,
        currency: "USD",
      }),
      "start checkout",
    );
    const base = `/public/checkouts/${started.id}`;
    ok(await send("POST", `${base}/items`, shopper, { sessionRef, cartId: cart.id }), "items");
    ok(await send("POST", `${base}/billing-address`, shopper, { sessionRef, ...address }), "bill");
    ok(await send("POST", `${base}/shipping-address`, shopper, { sessionRef, ...address }), "ship");
    ok(
      await send("POST", `${base}/shipping-selection`, shopper, { sessionRef, method: "standard" }),
      "method",
    );
    ok(
      await send("POST", `${base}/payment-selection`, shopper, {
        sessionRef,
        paymentMethodRef: "pm_1",
        provider: "stripe",
      }),
      "payment",
    );
    ok(
      await send("POST", `${base}/contact`, shopper, { sessionRef, email: "guest@example.com" }),
      "contact",
    );
    ok(await send("POST", `${base}/recalculate`, shopper, { sessionRef }), "recalculate");
    return {
      id: started.id,
      complete: () =>
        send("POST", `${base}/complete`, shopper, {
          sessionRef,
          idempotencyKey: `k-${sessionRef}`,
        }),
      read: async () =>
        ok<{ status: string; orderRef: string | null }>(
          await send("GET", base, { ...shopper, "x-cart-session": sessionRef }),
          "read checkout",
        ),
    };
  }

  it("placing an order moves its quantity from available to reserved", async () => {
    await start();
    const mug = await productWithStock(5);

    const done = await (await checkout("s-1", mug, 2)).complete();

    expect(done.statusCode).toBe(200);
    expect(await stock(mug)).toMatchObject({ onHand: 5, reserved: 2, available: 3 });
  });

  it("the lost race: validation passes, the reservation fails, the order is cancelled, the stock is unchanged and the answer is 409 OUT_OF_STOCK", async () => {
    // Another shopper took the units between the first check and the order: the cheap validation
    // still says yes (it is replaced by one that always does), only the reservation tells the truth.
    await start({ inventoryValidation: { validate: async () => ({ valid: true }) } });
    const mug = await productWithStock(2);
    const c = await checkout("s-race", mug, 3);

    const done = await c.complete();

    expect(done.statusCode).toBe(409);
    const body = done.json() as { code: string; message: string };
    expect(body.code).toBe("BUSINESS_RULE");
    expect(body.message.startsWith("OUT_OF_STOCK:")).toBe(true);
    expect(await stock(mug)).toMatchObject({ onHand: 2, reserved: 0, available: 2 });
    const orders = ok<{ items: { status: string }[] }>(
      await send("GET", "/orders?first=50", staffHeaders),
      "list orders",
    );
    expect(orders.items.map((o) => o.status)).toEqual(["cancelled"]);
    // The session is untouched and still open, so the shopper can fix the cart and complete again.
    expect(await c.read()).toMatchObject({ status: "started", orderRef: null });
  });

  it("cancelling the order gives its stock back", async () => {
    await start();
    const mug = await productWithStock(5);
    const done = await (await checkout("s-cancel", mug, 2)).complete();
    const orderRef = (done.json() as { orderRef: string }).orderRef;
    expect(await stock(mug)).toMatchObject({ reserved: 2, available: 3 });

    ok(
      await send("POST", `/orders/${orderRef}/advance`, staffHeaders, { toStatus: "cancelled" }),
      "cancel",
    );

    expect(await stock(mug)).toMatchObject({ onHand: 5, reserved: 0, available: 5 });
  });

  it("requesting fulfillment later reuses the reservation: it does not reserve a second time", async () => {
    await start();
    const mug = await productWithStock(5);
    const done = await (await checkout("s-fulfil", mug, 2)).complete();
    const orderRef = (done.json() as { orderRef: string }).orderRef;
    expect(await stock(mug)).toMatchObject({ reserved: 2, available: 3 });
    // created -> confirmed -> awaiting payment -> payment requested, then paid, then ready.
    for (const toStatus of ["confirmed", "awaiting_payment", "payment_requested"]) {
      ok(await send("POST", `/orders/${orderRef}/advance`, staffHeaders, { toStatus }), toStatus);
    }
    ok(
      await send("POST", `/orders/${orderRef}/mark-paid`, staffHeaders, { paymentRef: "pay-1" }),
      "mark paid",
    );
    ok(
      await send("POST", `/orders/${orderRef}/advance`, staffHeaders, {
        toStatus: "ready_for_fulfillment",
      }),
      "ready for fulfillment",
    );

    ok(
      await send("POST", `/orders/${orderRef}/request-fulfillment`, staffHeaders, {}),
      "request fulfillment",
    );

    expect(await stock(mug)).toMatchObject({ onHand: 5, reserved: 2, available: 3 });
  });

  it("a variant that does not track quantity reserves nothing and never fails the order", async () => {
    await start();
    const catalog = httpDriver(async (method, url, payload) =>
      method === "GET"
        ? send("GET", url, staffHeaders)
        : send("POST", url, staffHeaders, payload ?? {}),
    );
    const digital = await seedSingleVariantProduct(catalog, "DIGI", 900);
    ok(
      await send(
        "POST",
        `/products/${digital.productId}/variants/${digital.variantId}`,
        staffHeaders,
        {
          sku: "DIGI-STD",
          priceAmountMinor: 900,
          currency: "USD",
          tracksInventory: false,
        },
      ),
      "stop tracking quantity",
    );

    const done = await (await checkout("s-digital", digital, 4)).complete();

    expect(done.statusCode).toBe(200);
  });
});

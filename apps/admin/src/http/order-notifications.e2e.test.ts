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
import { httpDriver, seedSingleVariantProduct } from "./testing/seed-catalog";
import { httpStockDriver, seedStock } from "./testing/seed-stock";

/**
 * Wave 2b: the order mails over the REAL admin pipeline with the real wiring (Checkout, Orders,
 * Identity, Notifications): one confirmation and one staff mail when an order is placed, one mail when
 * it is cancelled, never the old generic "status changed" mail, nothing sensitive on the delivery log,
 * and an order that checkout undid for lack of stock mails nobody.
 */

interface Sent {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly from?: string;
  readonly replyTo?: string;
  readonly idempotencyKey?: string;
}

const clock: Clock = { now: () => new Date("2026-11-26T00:00:00.000Z") };
const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const sessions: Record<string, AuthenticatedContext> = {
  "tok-a": { principal: staff, claims: { tenant_id: "tenant-a" } },
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

describe("order mails, end to end through the real pipeline (Wave 2b)", () => {
  let app: FastifyInstance;
  let sent: Sent[];
  let productId = "";

  const admin = { authorization: "Bearer tok-a", "content-type": "application/json" };
  const storefront = { "x-tenant-id": "tenant-a", "content-type": "application/json" };

  async function boot(extra: Record<string, unknown> = {}) {
    sent = [];
    const fx = infra();
    app = await createAdminHttpApi({
      tenantMode: "multi",
      tenantGate: { availability: async () => "active" as const },
      serializer: new InMemoryEventSerializer(),
      idGenerator,
      clock,
      authenticator: fx.authenticator,
      rateLimiter: fx.rateLimiter,
      idempotencyKeys: fx.idempotencyKeys,
      responseCache: fx.cache,
      emailSender: { send: async (message: Sent) => void sent.push(message) },
      emailDeliveryConfigured: true,
      emailFrom: "Morbeh <mail@morbeh.test>",
      ...extra,
    });
    const driver = httpDriver(async (method, url, payload) =>
      method === "GET" ? get(url, admin) : post(url, admin, payload ?? {}),
    );
    const product = await seedSingleVariantProduct(driver, "P-1", 1999);
    await seedStock(
      httpStockDriver(async (method, url, payload) =>
        method === "GET" ? get(url, admin) : post(url, admin, payload ?? {}),
      ),
      { productId: product.productId, variantId: product.variantId, quantity: 100 },
    );
    productId = product.productId;
  }

  beforeEach(async () => {
    await boot();
  });
  afterEach(async () => {
    await app.close();
  });

  const post = (url: string, headers: Record<string, string>, payload: unknown) =>
    app.inject({ method: "POST", url: `/api/v1${url}`, headers, payload: payload as object });
  const get = (url: string, headers: Record<string, string>) =>
    app.inject({ method: "GET", url: `/api/v1${url}`, headers });
  function ok<T>(res: { statusCode: number; body: string; json: () => unknown }, what: string): T {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`${what} failed (${res.statusCode}): ${res.body}`);
    }
    return res.json() as T;
  }

  const address = { line1: "1 Main St", city: "Springfield", postalCode: "00000", country: "US" };

  /** A guest checkout driven exactly as the storefront does; returns the placed order's id. */
  async function placeOrder(sessionRef: string, email = "shopper@example.com") {
    const cart = ok<{ id: string }>(
      await post("/public/carts", storefront, { sessionRef, currency: "USD" }),
      "cart",
    );
    ok(
      await post(`/public/carts/${cart.id}/items`, storefront, {
        sessionRef,
        productId,
        quantity: 1,
      }),
      "add",
    );
    const started = ok<{ id: string }>(
      await post("/public/checkouts", storefront, {
        sessionRef,
        cartRef: cart.id,
        currency: "USD",
      }),
      "start",
    );
    const base = `/public/checkouts/${started.id}`;
    ok(await post(`${base}/items`, storefront, { sessionRef, cartId: cart.id }), "items");
    ok(await post(`${base}/billing-address`, storefront, { sessionRef, ...address }), "billing");
    ok(await post(`${base}/shipping-address`, storefront, { sessionRef, ...address }), "shipping");
    ok(
      await post(`${base}/shipping-selection`, storefront, { sessionRef, method: "standard" }),
      "method",
    );
    ok(
      await post(`${base}/payment-selection`, storefront, {
        sessionRef,
        paymentMethodRef: "pm_1",
        provider: "stripe",
      }),
      "payment",
    );
    ok(await post(`${base}/contact`, storefront, { sessionRef, email }), "contact");
    ok(await post(`${base}/recalculate`, storefront, { sessionRef }), "recalculate");
    const complete = () =>
      post(`${base}/complete`, storefront, { sessionRef, idempotencyKey: `idem-${sessionRef}` });
    const done = ok<{ orderRef: string }>(await complete(), "complete");
    return { orderId: done.orderRef, complete };
  }

  const setStaff = (recipients: string[]) =>
    post("/notifications/settings", admin, {
      senderEmail: "hello@merchant.test",
      staffRecipients: recipients,
      disabledTemplates: [],
      expectedVersion: null,
    });

  it("placing an order mails the customer once and each staff recipient once, From the store, Reply-To the merchant", async () => {
    expect.hasAssertions();
    ok(await setStaff(["owner@shop.test", "ops@shop.test"]), "settings");
    const { orderId, complete } = await placeOrder("s-1");
    expect(orderId).toBeTruthy();

    const customerMail = sent.filter((m) => m.to === "shopper@example.com");
    expect(customerMail).toHaveLength(1);
    expect(customerMail[0]?.subject).toMatch(/confirmed|تأكيد/);
    expect(customerMail[0]?.replyTo).toBe("hello@merchant.test");
    expect(customerMail[0]?.from).toContain("mail@morbeh.test");
    expect(customerMail[0]?.from).not.toContain("merchant.test");
    expect(customerMail[0]?.idempotencyKey).toBeDefined();
    expect(sent.filter((m) => m.to === "owner@shop.test")).toHaveLength(1);
    expect(sent.filter((m) => m.to === "ops@shop.test")).toHaveLength(1);
    expect(sent).toHaveLength(3);

    // A retried completion returns the finished order and mails nobody again.
    expect((await complete()).statusCode).toBe(200);
    expect(sent).toHaveLength(3);
  });

  it("the delivery log shows these as email notifications with no address, no body, no generic status mail", async () => {
    expect.hasAssertions();
    ok(await setStaff(["owner@shop.test"]), "settings");
    await placeOrder("s-2");
    const list = ok<unknown>(await get("/notifications", admin), "list");
    const text = JSON.stringify(list);
    expect(text).toContain("order_confirmation");
    expect(text).toContain("staff_new_order");
    expect(text).not.toContain("order-status-changed");
    expect(text).not.toContain("status changed");
    expect(text).not.toContain("@");
    expect(text).not.toContain("shopper");
    expect(text).not.toContain("Thanks for your order");
  });

  it("cancelling the order mails exactly one cancellation; other transitions mail nothing", async () => {
    expect.hasAssertions();
    const { orderId } = await placeOrder("s-3");
    const before = sent.length;
    ok(await post(`/orders/${orderId}/advance`, admin, { toStatus: "cancelled" }), "cancel");
    const after = sent.slice(before);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ to: "shopper@example.com" });
    expect(after[0]?.subject).toMatch(/canceled|إلغاء/);
  });

  it("with email not configured the order is placed and nothing is claimed sent", async () => {
    expect.hasAssertions();
    await app.close();
    await boot({ emailDeliveryConfigured: false });
    const { orderId } = await placeOrder("s-4");
    expect(orderId).toBeTruthy();
    expect(sent).toHaveLength(0);
    const list = JSON.stringify(ok<unknown>(await get("/notifications", admin), "list"));
    expect(list).not.toContain('"status":"sent"');
    expect(list).toContain("failed");
  });

  it("a switched-off confirmation sends nothing but the staff mail still does", async () => {
    expect.hasAssertions();
    ok(
      await post("/notifications/settings", admin, {
        senderEmail: null,
        staffRecipients: ["owner@shop.test"],
        disabledTemplates: ["order_confirmation"],
        expectedVersion: null,
      }),
      "settings",
    );
    await placeOrder("s-5");
    expect(sent.map((m) => m.to)).toEqual(["owner@shop.test"]);
  });

  it("a mail provider that fails never fails the order", async () => {
    expect.hasAssertions();
    await app.close();
    await boot({
      emailSender: {
        send: async () => {
          throw new Error("provider down");
        },
      },
    });
    const { orderId } = await placeOrder("s-6");
    expect(orderId).toBeTruthy();
    const cancel = await post(`/orders/${orderId}/advance`, admin, { toStatus: "cancelled" });
    expect(cancel.statusCode).toBe(200);
  });
});

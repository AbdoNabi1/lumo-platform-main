import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  AuthenticatedContext,
  AuthenticatedIdentity,
  Cache,
  ClaimsAuthenticator,
  Clock,
  IdempotencyClaim,
  IdempotencyKeyStore,
  PaymentIntentRequest,
  PaymentProvider,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { ProviderRegistration } from "@platform/payments";
import {
  concatenateSignedFields,
  parsePaymobConfig,
  verifyPaymobSignature,
} from "@platform/psp-paymob";
import { logger } from "@platform/utils";
import { createAdminHttpApi } from "./server";

/**
 * WP-13 through the REAL admin pipeline (`createAdminHttpApi`, `tenantMode: "multi"` — so
 * `assertMultiTenantReady` walks the composed graph, resolver included, on every boot here).
 * Only the outside world is doubled: the PSPs. The Paymob double verifies webhooks with the REAL
 * `verifyPaymobSignature` against the merchant's own HMAC secret, and every double records which
 * merchant's credential served each call.
 */

const clock: Clock = { now: () => new Date("2026-09-23T00:00:00.000Z") };
const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const sessions: Record<string, AuthenticatedContext> = {
  "tok-a": { principal: staff, claims: { tenant_id: "tenant-a" } },
  "tok-b": { principal: staff, claims: { tenant_id: "tenant-b" } },
};

interface Call {
  readonly provider: string;
  readonly op: "createIntent" | "refund" | "capture";
  readonly tenantId?: string;
  readonly secretKey?: string;
  readonly reference?: string;
}
let calls: Call[] = [];
let paymobOrderSeq = 900_000;

function stripeDouble(): PaymentProvider {
  let n = 0;
  return {
    createIntent: (request: PaymentIntentRequest) => {
      n += 1;
      calls.push({ provider: "stripe", op: "createIntent", tenantId: request.tenantId });
      return Promise.resolve({ providerIntentId: `pi_stripe_${n}`, clientHandle: `cs_${n}` });
    },
    capture: (reference: string) => {
      calls.push({ provider: "stripe", op: "capture", reference });
      return Promise.resolve();
    },
    cancel: () => Promise.resolve(),
    refund: (reference: string) => {
      calls.push({ provider: "stripe", op: "refund", reference });
      return Promise.resolve();
    },
    verifyWebhook: () => Promise.resolve(true),
  };
}

function paymobDouble(config: {
  secretKey: string;
  hmacSecret: string;
  publicKey: string;
}): PaymentProvider {
  return {
    createIntent: (request: PaymentIntentRequest) => {
      calls.push({
        provider: "paymob",
        op: "createIntent",
        tenantId: request.tenantId,
        secretKey: config.secretKey,
      });
      paymobOrderSeq += 1;
      return Promise.resolve({
        providerIntentId: String(paymobOrderSeq),
        clientHandle: `https://pay.example.test/?publicKey=${config.publicKey}`,
      });
    },
    capture: () => Promise.reject(new Error("Paymob does not capture")),
    cancel: () => Promise.reject(new Error("Paymob does not cancel")),
    refund: (reference: string) => {
      calls.push({ provider: "paymob", op: "refund", secretKey: config.secretKey, reference });
      return Promise.resolve();
    },
    verifyWebhook: (payload: Uint8Array, signature: string) =>
      Promise.resolve(verifyPaymobSignature({ payload, signature, secret: config.hmacSecret })),
  };
}

/** Paymob as the runtime registers it (same declarations, real config parser) over the doubled PSP. */
const paymobRegistration: ProviderRegistration = {
  key: "paymob",
  capabilities: {
    settlesAtPayTime: true,
    deliversWebhooks: true,
    requiresMerchantCredentials: true,
    chargesOffSession: false,
  },
  backing: "real",
  credentialFields: ["secretKey", "hmacSecret", "publicKey"],
  parseConfig: (raw) => {
    const parsed = parsePaymobConfig(raw);
    return parsed.ok ? { ok: true, value: { ...parsed.value } } : parsed;
  },
  create: ({ credentials }) =>
    paymobDouble({
      secretKey: credentials.secretKey ?? "",
      hmacSecret: credentials.hmacSecret ?? "",
      publicKey: credentials.publicKey ?? "",
    }),
};

/**
 * A provider that exists nowhere in this repository outside this test: its own key, credentials,
 * routing config and capabilities. Registered exactly the way Paymob is — that is the point.
 */
const ACME_KEY = "acme-pay";
const acmeRegistration: ProviderRegistration = {
  key: ACME_KEY,
  capabilities: {
    settlesAtPayTime: false,
    deliversWebhooks: true,
    requiresMerchantCredentials: true,
    chargesOffSession: true,
  },
  backing: "real",
  credentialFields: ["apiKey"],
  parseConfig: (raw) => {
    const code = (raw as { merchantCode?: unknown } | null)?.merchantCode;
    return typeof code === "string" && /^M\d+$/.test(code)
      ? { ok: true, value: { merchantCode: code } }
      : { ok: false, reason: "merchantCode must look like M123" };
  },
  create: ({ config, credentials }) => ({
    createIntent: (request: PaymentIntentRequest) => {
      calls.push({
        provider: ACME_KEY,
        op: "createIntent",
        tenantId: request.tenantId,
        secretKey: credentials.apiKey,
      });
      return Promise.resolve({
        providerIntentId: `acme_${String(config.merchantCode)}_${request.orderRef}`,
        clientHandle: `https://pay.acme.example.test/${String(config.merchantCode)}`,
      });
    },
    capture: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
    refund: () => Promise.resolve(),
    verifyWebhook: () => Promise.resolve(true),
    // Declared off-session above, so it must implement the port (the registration type requires it).
    chargeStoredMethod: () => Promise.resolve({ providerReference: "acme-charge" }),
  }),
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

const CREDS = {
  a: { secretKey: "SK-MERCHANT-A-secret", hmacSecret: "HMAC-MERCHANT-A", publicKey: "PK-A" },
  b: { secretKey: "SK-MERCHANT-B-secret", hmacSecret: "HMAC-MERCHANT-B", publicKey: "PK-B" },
};
const ALL_SECRETS = [CREDS.a.secretKey, CREDS.a.hmacSecret, CREDS.b.secretKey, CREDS.b.hmacSecret];

describe("merchant payments through the real HTTP pipeline (WP-13)", () => {
  let app: FastifyInstance;
  let logLines: string[];
  let seeded: Set<string>;

  beforeEach(async () => {
    calls = [];
    logLines = [];
    seeded = new Set();
    for (const level of ["debug", "info", "warn", "error"] as const) {
      vi.spyOn(logger, level).mockImplementation((message: string, context?: object) => {
        logLines.push(`${message} ${JSON.stringify(context ?? {})}`);
      });
    }
    const fx = infra();
    app = await createAdminHttpApi({
      tenantMode: "multi",
      serializer: new InMemoryEventSerializer(),
      idGenerator,
      clock,
      authenticator: fx.authenticator,
      rateLimiter: fx.rateLimiter,
      idempotencyKeys: fx.idempotencyKeys,
      responseCache: fx.cache,
      paymentProvider: stripeDouble(),
      providerRegistrations: [paymobRegistration, acmeRegistration],
    });
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
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
  const send = (method: "POST" | "GET" | "PUT", url: string, headers: object, payload?: unknown) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: headers as Record<string, string>,
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const post = (url: string, headers: object, payload: unknown) =>
    send("POST", url, headers, payload);
  const get = (url: string, headers: object) => send("GET", url, headers);
  function ok<T>(res: { statusCode: number; body: string; json: () => unknown }, what: string): T {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`${what} failed (${res.statusCode}): ${res.body}`);
    }
    return res.json() as T;
  }

  async function seedPrice(token: string): Promise<void> {
    // One published price per merchant is enough (a second would make the product ambiguous).
    if (seeded.has(token)) return;
    seeded.add(token);
    const created = ok<{ id: string }>(
      await post("/prices", admin(token), {
        priceListId: "price-list-1",
        productId: "product-1",
        amountMinor: 1999,
        currency: "USD",
      }),
      "create price",
    );
    ok(await post(`/prices/${created.id}/publish`, admin(token), {}), "publish price");
  }

  async function configureMerchant(
    token: string,
    body: unknown,
  ): Promise<{ statusCode: number; body: string; json: () => unknown }> {
    return send("PUT", "/payments/settings", admin(token), body);
  }

  const address = { line1: "1 Main St", city: "Springfield", postalCode: "00000", country: "US" };

  /** cart → checkout → everything up to (not including) complete, as the anonymous storefront. */
  async function readyCheckout(tenant: string, sessionRef: string, provider: string) {
    const h = storefront(tenant);
    const cart = ok<{ id: string }>(
      await post("/public/carts", h, { sessionRef, currency: "USD" }),
      "create cart",
    );
    ok(
      await post(`/public/carts/${cart.id}/items`, h, {
        sessionRef,
        productId: "product-1",
        quantity: 1,
      }),
      "add item",
    );
    const started = ok<{ id: string }>(
      await post("/public/checkouts", h, { sessionRef, cartRef: cart.id, currency: "USD" }),
      "start checkout",
    );
    const base = `/public/checkouts/${started.id}`;
    ok(await post(`${base}/items`, h, { sessionRef, cartId: cart.id }), "load items");
    ok(await post(`${base}/billing-address`, h, { sessionRef, ...address }), "billing");
    ok(await post(`${base}/shipping-address`, h, { sessionRef, ...address }), "shipping");
    ok(
      await post(`${base}/shipping-selection`, h, { sessionRef, method: "standard" }),
      "shipping method",
    );
    const selection = await post(`${base}/payment-selection`, h, {
      sessionRef,
      paymentMethodRef: `pm_${provider}`,
      provider,
    });
    ok(
      await post(`${base}/contact`, h, { sessionRef, email: `${sessionRef}@example.com` }),
      "contact",
    );
    ok(await post(`${base}/recalculate`, h, { sessionRef }), "recalculate");
    return {
      base,
      h,
      selection,
      totals: async () =>
        ok<{ totals: { grandTotalMinor: number }; currency: string }>(
          await get(base, storefront(tenant, { "x-cart-session": sessionRef })),
          "get checkout",
        ),
      complete: () =>
        post(`${base}/complete`, h, { sessionRef, idempotencyKey: `idem-${sessionRef}` }),
      pay: (body: object = { sessionRef }) => post(`${base}/payment`, h, body),
    };
  }

  /** A completed checkout whose payment has been opened — returns the intent id and the amount due. */
  async function paid(tenant: string, sessionRef: string, provider: string) {
    const checkout = await readyCheckout(tenant, sessionRef, provider);
    expect(checkout.selection.statusCode).toBe(200);
    ok(await checkout.complete(), "complete");
    const summary = await checkout.totals();
    const opened = ok<{
      paymentIntentId: string;
      provider: string;
      status: string;
      clientHandle?: string;
    }>(await checkout.pay(), "pay");
    return { checkout, opened, amountMinor: summary.totals.grandTotalMinor };
  }

  const intentOf = async (token: string, id: string) =>
    ok<{ status: string; provider: string; amountMinor: number; currency: string }>(
      await get(`/payment-intents/${id}`, admin(token)),
      "get intent",
    );

  /** A Paymob "transaction processed" callback, signed the way Paymob signs it, for the given merchant secret. */
  function signedCallback(input: {
    orderId: string;
    transactionId: number;
    amountCents: number;
    currency: string;
    secret: string;
    overrides?: Record<string, unknown>;
  }) {
    const obj: Record<string, unknown> = {
      id: input.transactionId,
      pending: false,
      amount_cents: input.amountCents,
      success: true,
      is_auth: false,
      is_capture: false,
      is_standalone_payment: true,
      is_voided: false,
      is_refunded: false,
      is_3d_secure: true,
      integration_id: 4097558,
      has_parent_transaction: false,
      order: { id: Number(input.orderId), merchant_order_id: "unsigned-ignored" },
      created_at: "2026-09-23T00:00:00.000000",
      currency: input.currency,
      source_data: { pan: "2346", type: "card", sub_type: "MasterCard" },
      error_occured: false,
      owner: 302852,
      ...input.overrides,
    };
    const raw = JSON.stringify({ type: "TRANSACTION", obj });
    const hmac = createHmac("sha512", input.secret)
      .update(concatenateSignedFields(obj) as string)
      .digest("hex");
    return { raw, hmac };
  }
  const deliver = (tenant: string, cb: { raw: string; hmac: string }, hmac = cb.hmac) =>
    app.inject({
      method: "POST",
      url: `/api/v1/payments/webhook/paymob?hmac=${hmac}`,
      headers: { "x-tenant-id": tenant, "content-type": "application/json" },
      payload: cb.raw,
    });

  const enableAll = (token: string, creds = CREDS.a) =>
    configureMerchant(token, {
      // Listed with the shopper's likely pick LAST on purpose — order is not a priority.
      enabledMethods: ["stripe", "cod", "paymob"],
      providerSettings: {
        paymob: { config: { region: "egy", integrationId: 4097558 }, credentials: creds },
      },
    });

  // ─────────────────────────────────────────────────────────────────────────────────────────────

  it("the merchant configures methods; the shopper is offered exactly those, with no credential anywhere", async () => {
    await seedPrice("tok-a");
    const configured = await enableAll("tok-a");
    expect(configured.statusCode).toBe(200);

    const offered = ok<{ methods: string[] }>(
      await get("/public/payment-methods", storefront("tenant-a")),
      "list methods",
    );
    const settings = await get("/payments/settings", admin("tok-a"));

    expect([...offered.methods].sort()).toEqual(["cod", "paymob", "stripe"]);
    for (const secret of ALL_SECRETS) {
      expect(configured.body).not.toContain(secret);
      expect(settings.body).not.toContain(secret);
    }
    expect(JSON.parse(settings.body)).toMatchObject({
      methods: {
        paymob: { configured: true, config: { region: "egy", integrationId: 4097558 } },
      },
    });
  });

  it.each(["stripe", "paymob", "cod"] as const)(
    "the shopper selecting %s at checkout invokes THAT adapter — through the checkout API",
    async (selected) => {
      await seedPrice("tok-a");
      await enableAll("tok-a");

      const { opened } = await paid("tenant-a", `sess-${selected}`, selected);

      expect(opened.provider).toBe(selected);
      const intent = await intentOf("tok-a", opened.paymentIntentId);
      expect(intent.provider).toBe(selected);
      const creates = calls.filter((c) => c.op === "createIntent").map((c) => c.provider);
      expect(creates).toEqual(selected === "cod" ? [] : [selected]);
      // COD is unpaid on creation; the online methods hand the shopper somewhere to pay.
      if (selected === "cod") expect(opened.clientHandle).toBeUndefined();
      else expect(opened.clientHandle).toBeDefined();
      expect(intent.status).toBe("created");
    },
  );

  it("a provider registered at composition time with NO core edit reaches the shopper end to end — configured, offered, selected, paid through, with that merchant's own credential", async () => {
    await seedPrice("tok-a");
    const configured = await configureMerchant("tok-a", {
      enabledMethods: ["stripe", ACME_KEY],
      providerSettings: {
        [ACME_KEY]: { config: { merchantCode: "M42" }, credentials: { apiKey: "ACME-KEY-OF-A" } },
      },
    });
    expect(configured.statusCode).toBe(200);
    expect(configured.body).not.toContain("ACME-KEY-OF-A");

    const offered = ok<{ methods: string[] }>(
      await get("/public/payment-methods", storefront("tenant-a")),
      "list methods",
    );
    expect([...offered.methods].sort()).toEqual([ACME_KEY, "stripe"]);

    const { opened } = await paid("tenant-a", "sess-acme", ACME_KEY);

    expect(opened.provider).toBe(ACME_KEY);
    expect(opened.clientHandle).toBe("https://pay.acme.example.test/M42");
    expect((await intentOf("tok-a", opened.paymentIntentId)).provider).toBe(ACME_KEY);
    expect(calls.filter((c) => c.op === "createIntent")).toEqual([
      { provider: ACME_KEY, op: "createIntent", tenantId: "tenant-a", secretKey: "ACME-KEY-OF-A" },
    ]);
    const settings = await get("/payments/settings", admin("tok-a"));
    expect(settings.body).not.toContain("ACME-KEY-OF-A");
    expect(JSON.parse(settings.body)).toMatchObject({
      methods: { [ACME_KEY]: { configured: true, config: { merchantCode: "M42" } } },
    });
  });

  it("a merchant cannot enable a method nobody registered, and the provider's own validation rules apply at the route", async () => {
    const unknown = await configureMerchant("tok-a", { enabledMethods: ["never-registered"] });
    const badConfig = await configureMerchant("tok-a", {
      enabledMethods: [ACME_KEY],
      providerSettings: {
        [ACME_KEY]: { config: { merchantCode: "nope" }, credentials: { apiKey: "k" } },
      },
    });

    expect(unknown.statusCode).toBe(422);
    expect(badConfig.statusCode).toBe(422);
  });

  it("a method the merchant has not enabled cannot be selected — and nothing is chosen in its place", async () => {
    await seedPrice("tok-a");
    await configureMerchant("tok-a", { enabledMethods: ["stripe"] });

    const checkout = await readyCheckout("tenant-a", "sess-unoffered", "cod");

    expect(checkout.selection.statusCode).toBe(422);
    const session = await checkout.totals();
    expect(
      (session as unknown as { selectedPaymentMethod: string | null }).selectedPaymentMethod,
    ).toBeNull();
    expect(calls).toEqual([]);
  });

  it("initiating payment accepts no method or amount of its own — the body is strict", async () => {
    await seedPrice("tok-a");
    await enableAll("tok-a");
    const checkout = await readyCheckout("tenant-a", "sess-strict", "cod");
    ok(await checkout.complete(), "complete");

    const withProvider = await checkout.pay({ sessionRef: "sess-strict", provider: "stripe" });
    const withAmount = await checkout.pay({ sessionRef: "sess-strict", amountMinor: 1 });

    expect(withProvider.statusCode).toBe(422);
    expect(withAmount.statusCode).toBe(422);
    expect(calls).toEqual([]);
    // The one legitimate call opens COD — the method the shopper selected.
    const real = ok<{ provider: string }>(await checkout.pay(), "pay");
    expect(real.provider).toBe("cod");
  });

  it("cannot open payment before the checkout is completed, nor for someone else's session", async () => {
    await seedPrice("tok-a");
    await enableAll("tok-a");
    const checkout = await readyCheckout("tenant-a", "sess-early", "cod");

    const early = await checkout.pay();
    expect(early.statusCode).toBe(409);

    ok(await checkout.complete(), "complete");
    const stranger = await checkout.pay({ sessionRef: "someone-else" });
    expect(stranger.statusCode).toBe(404);
  });

  it("initiating twice resumes the same payment intent — no second charge is opened", async () => {
    await seedPrice("tok-a");
    await enableAll("tok-a");
    const { checkout, opened } = await paid("tenant-a", "sess-twice", "paymob");

    const again = ok<{ paymentIntentId: string }>(await checkout.pay(), "pay again");

    expect(again.paymentIntentId).toBe(opened.paymentIntentId);
    expect(calls.filter((c) => c.op === "createIntent")).toHaveLength(1);
  });

  describe("two merchants, two Paymob credentials", () => {
    it("each charge uses its own merchant's credential; a merchant cannot see the other's methods", async () => {
      await seedPrice("tok-a");
      await seedPrice("tok-b");
      await enableAll("tok-a", CREDS.a);
      await enableAll("tok-b", CREDS.b);

      await paid("tenant-a", "sess-a1", "paymob");
      await paid("tenant-b", "sess-b1", "paymob");
      await paid("tenant-a", "sess-a2", "paymob");

      expect(calls.filter((c) => c.op === "createIntent")).toEqual([
        expect.objectContaining({ tenantId: "tenant-a", secretKey: CREDS.a.secretKey }),
        expect.objectContaining({ tenantId: "tenant-b", secretKey: CREDS.b.secretKey }),
        expect.objectContaining({ tenantId: "tenant-a", secretKey: CREDS.a.secretKey }),
      ]);
    });

    it("a merchant that never configured Paymob cannot use it, however the request is shaped", async () => {
      await seedPrice("tok-a");
      await seedPrice("tok-b");
      await enableAll("tok-a", CREDS.a); // tenant-b has only the default (Stripe)

      const checkout = await readyCheckout("tenant-b", "sess-b-paymob", "paymob");

      expect(checkout.selection.statusCode).toBe(422);
      expect(calls).toEqual([]);
    });
  });

  describe("cash on delivery", () => {
    it("is unpaid until an explicit confirmed collection — and only that marks it paid", async () => {
      await seedPrice("tok-a");
      await enableAll("tok-a");
      const { opened, amountMinor } = await paid("tenant-a", "sess-cod", "cod");
      const id = opened.paymentIntentId;
      expect((await intentOf("tok-a", id)).status).toBe("created");

      // Neither a capture request nor a forged provider webhook settles it.
      expect((await post(`/payment-intents/${id}/capture`, admin("tok-a"), {})).statusCode).toBe(
        409,
      );
      const forged = await app.inject({
        method: "POST",
        url: "/api/v1/payments/webhook",
        headers: { "x-tenant-id": "tenant-a", "content-type": "application/json" },
        payload: { id: "evt_1", type: "payment_intent.succeeded", data: { object: { id } } },
      });
      expect(forged.statusCode).not.toBe(200);
      expect((await intentOf("tok-a", id)).status).toBe("created");

      // A wrong amount is refused.
      const short = await post(`/payment-intents/${id}/cod-collection`, admin("tok-a"), {
        collectedAmountMinor: amountMinor - 1,
        currency: "USD",
      });
      expect(short.statusCode).toBe(409);
      expect((await intentOf("tok-a", id)).status).toBe("created");

      // The explicit confirmation is what settles it.
      const collected = await post(`/payment-intents/${id}/cod-collection`, admin("tok-a"), {
        collectedAmountMinor: amountMinor,
        currency: "USD",
      });
      expect(collected.statusCode).toBe(200);
      expect((await intentOf("tok-a", id)).status).toBe("captured");
    });

    it("another merchant's staff cannot confirm a collection for it", async () => {
      await seedPrice("tok-a");
      await enableAll("tok-a");
      const { opened, amountMinor } = await paid("tenant-a", "sess-cod-x", "cod");

      const attempt = await post(
        `/payment-intents/${opened.paymentIntentId}/cod-collection`,
        admin("tok-b"),
        { collectedAmountMinor: amountMinor, currency: "USD" },
      );

      expect(attempt.statusCode).toBe(404);
      expect((await intentOf("tok-a", opened.paymentIntentId)).status).toBe("created");
    });
  });

  describe("Paymob webhook: signature and idempotency", () => {
    async function paidPaymob(tenant: string, token: string, creds: typeof CREDS.a, ref: string) {
      await seedPrice(token);
      await enableAll(token, creds);
      const { opened, amountMinor } = await paid(tenant, ref, "paymob");
      const order = calls.filter((c) => c.op === "createIntent").length; // placeholder for clarity
      void order;
      // The provider id Paymob would later sign as `order.id` is the double's last-issued order id.
      const orderId = String(paymobOrderSeq);
      return { opened, amountMinor, orderId };
    }

    it("a genuinely signed callback captures the payment; a redelivery is a recorded duplicate", async () => {
      const { opened, amountMinor, orderId } = await paidPaymob(
        "tenant-a",
        "tok-a",
        CREDS.a,
        "sess-wh1",
      );
      const cb = signedCallback({
        orderId,
        transactionId: 192036465,
        amountCents: amountMinor,
        currency: "USD",
        secret: CREDS.a.hmacSecret,
      });

      const first = await deliver("tenant-a", cb);
      const second = await deliver("tenant-a", cb);

      expect(first.statusCode).toBe(200);
      expect((first.json() as { duplicate: boolean }).duplicate).toBe(false);
      expect((second.json() as { duplicate: boolean }).duplicate).toBe(true);
      expect((await intentOf("tok-a", opened.paymentIntentId)).status).toBe("captured");
    });

    it("rejects a wrong signature, a tampered body, and a missing hmac — before recording anything", async () => {
      const { opened, amountMinor, orderId } = await paidPaymob(
        "tenant-a",
        "tok-a",
        CREDS.a,
        "sess-wh2",
      );
      const cb = signedCallback({
        orderId,
        transactionId: 1,
        amountCents: amountMinor,
        currency: "USD",
        secret: CREDS.a.hmacSecret,
      });
      const tampered = { raw: cb.raw.replace('"success":true', '"success":false'), hmac: cb.hmac };

      expect((await deliver("tenant-a", cb, "0".repeat(128))).statusCode).toBe(401);
      expect((await deliver("tenant-a", tampered)).statusCode).toBe(401);
      const missing = await app.inject({
        method: "POST",
        url: "/api/v1/payments/webhook/paymob",
        headers: { "x-tenant-id": "tenant-a", "content-type": "application/json" },
        payload: cb.raw,
      });
      expect(missing.statusCode).toBeGreaterThanOrEqual(400);
      expect((await intentOf("tok-a", opened.paymentIntentId)).status).toBe("created");
    });

    it("a callback signed with merchant A's secret is rejected when delivered to merchant B", async () => {
      await seedPrice("tok-b");
      await enableAll("tok-b", CREDS.b);
      const a = await paidPaymob("tenant-a", "tok-a", CREDS.a, "sess-wh-a");
      const cb = signedCallback({
        orderId: a.orderId,
        transactionId: 2,
        amountCents: a.amountMinor,
        currency: "USD",
        secret: CREDS.a.hmacSecret,
      });

      const replayedAtB = await deliver("tenant-b", cb);

      expect(replayedAtB.statusCode).toBe(401);
      expect((await intentOf("tok-a", a.opened.paymentIntentId)).status).toBe("created");
    });

    it("rejects a validly signed callback whose signed amount is not the intent's amount", async () => {
      const { opened, amountMinor, orderId } = await paidPaymob(
        "tenant-a",
        "tok-a",
        CREDS.a,
        "sess-wh3",
      );
      const cb = signedCallback({
        orderId,
        transactionId: 3,
        amountCents: amountMinor - 1,
        currency: "USD",
        secret: CREDS.a.hmacSecret,
      });

      const response = await deliver("tenant-a", cb);

      expect(response.statusCode).toBe(409);
      expect((await intentOf("tok-a", opened.paymentIntentId)).status).toBe("created");
    });

    it("correlates on the SIGNED order id, never the unsigned merchant_order_id", async () => {
      const first = await paidPaymob("tenant-a", "tok-a", CREDS.a, "sess-wh4a");
      const second = await paidPaymob("tenant-a", "tok-a", CREDS.a, "sess-wh4b");
      // A callback for the FIRST order, with the unsigned merchant_order_id pointed at the second.
      const cb = signedCallback({
        orderId: first.orderId,
        transactionId: 4,
        amountCents: first.amountMinor,
        currency: "USD",
        secret: CREDS.a.hmacSecret,
        overrides: { order: { id: Number(first.orderId), merchant_order_id: second.orderId } },
      });

      expect((await deliver("tenant-a", cb)).statusCode).toBe(200);

      expect((await intentOf("tok-a", first.opened.paymentIntentId)).status).toBe("captured");
      expect((await intentOf("tok-a", second.opened.paymentIntentId)).status).toBe("created");
    });

    it("a failed attempt is recorded but leaves the intent open for the customer to retry", async () => {
      const { opened, amountMinor, orderId } = await paidPaymob(
        "tenant-a",
        "tok-a",
        CREDS.a,
        "sess-wh5",
      );
      const failed = signedCallback({
        orderId,
        transactionId: 5,
        amountCents: amountMinor,
        currency: "USD",
        secret: CREDS.a.hmacSecret,
        overrides: { success: false },
      });

      expect((await deliver("tenant-a", failed)).statusCode).toBe(200);
      expect((await intentOf("tok-a", opened.paymentIntentId)).status).toBe("created");
    });

    it("a refund reaches Paymob under the merchant's own credential, addressed by the signed transaction id", async () => {
      const { opened, amountMinor, orderId } = await paidPaymob(
        "tenant-a",
        "tok-a",
        CREDS.a,
        "sess-wh6",
      );
      await deliver(
        "tenant-a",
        signedCallback({
          orderId,
          transactionId: 777,
          amountCents: amountMinor,
          currency: "USD",
          secret: CREDS.a.hmacSecret,
        }),
      );

      const refund = await send(
        "POST",
        `/payment-intents/${opened.paymentIntentId}/refund`,
        { ...admin("tok-a"), "idempotency-key": "refund-1" },
        { amountMinor: 100, currency: "USD" },
      );

      expect(refund.statusCode).toBe(200);
      expect(calls.filter((c) => c.op === "refund")).toEqual([
        expect.objectContaining({ secretKey: CREDS.a.secretKey, reference: "777" }),
      ]);
    });
  });

  it("no merchant credential appears in any log line the pipeline emitted", async () => {
    await seedPrice("tok-a");
    await enableAll("tok-a");
    await configureMerchant("tok-a", {
      providerSettings: {
        paymob: { config: { region: "atlantis", integrationId: 1 }, credentials: CREDS.a },
      },
    });
    await paid("tenant-a", "sess-logs", "paymob");
    await deliver(
      "tenant-a",
      signedCallback({
        orderId: String(paymobOrderSeq),
        transactionId: 9,
        amountCents: 1,
        currency: "USD",
        secret: CREDS.a.hmacSecret,
      }),
    );

    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      for (const secret of [...ALL_SECRETS, CREDS.a.publicKey]) expect(line).not.toContain(secret);
    }
  });
});

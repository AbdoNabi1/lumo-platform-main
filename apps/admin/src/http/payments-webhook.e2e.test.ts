import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  Authenticator,
  Cache,
  Clock,
  IdGenerator,
  IdempotencyClaim,
  IdempotencyKeyStore,
  PaymentProvider,
  AuthenticatedIdentity,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { verifyStripeSignature } from "@platform/psp-stripe";
import { createAdminHttpApi } from "./server";

/**
 * C2-2/C2-6, end to end: proves `POST /api/v1/payments/webhook` is reachable through the REAL
 * server, without the Authorization header every other Payments route requires — a PSP has no
 * admin Bearer token to present — and that a GENUINELY signed Stripe-shaped webhook (real HMAC over
 * the real raw request bytes, verified via the same `verifyStripeSignature` the production
 * `StripePaymentProvider` uses) drives the EXISTING `RecordWebhook` use case for real. Also proves
 * the failure modes Task 8 requires at the transport layer: wrong signature, tampered body, and
 * stale timestamp (replay protection) are all rejected with 401 before `recordWebhook` ever runs.
 */

const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const clock: Clock = { now: () => new Date("2026-08-05T00:00:00.000Z") };
const WEBHOOK_SECRET = "whsec_e2e_test_secret";

/**
 * A real signature verifier (the production code path) paired with the SAME offline no-op money
 * operations `InMemoryPaymentProvider` uses — `POST /payment-intents` (`PaymentController.
 * createIntent`) drives `CreatePaymentIntentLifecycle`, which calls `paymentProvider.createIntent`
 * as part of the normal (non-webhook) admin flow this test also exercises, so those methods must
 * behave, not throw. Only `verifyWebhook` needs to be genuinely real for this suite's purpose.
 */
let intentCounter = 0;
const testPaymentProvider: PaymentProvider = {
  createIntent: async (request) => {
    intentCounter += 1;
    return { providerIntentId: `psp-intent-${request.orderRef}-${intentCounter}` };
  },
  capture: async () => undefined,
  cancel: async () => undefined,
  refund: async () => undefined,
  // `now` is pinned to the fixed test `clock` (not real wall-clock) — the signed timestamps below
  // are computed against that same fixed instant, so the tolerance check is deterministic
  // regardless of when this suite actually runs.
  verifyWebhook: async (payload, signature) =>
    verifyStripeSignature({
      payload,
      signatureHeader: signature,
      secret: WEBHOOK_SECRET,
      now: () => clock.now().getTime(),
    }),
};

function stripeSignatureHeader(rawBody: string, timestampSeconds: number): string {
  const sig = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${timestampSeconds}.${rawBody}`)
    .digest("hex");
  return `t=${timestampSeconds},v1=${sig}`;
}

function fakes() {
  const cacheStore = new Map<string, unknown>();
  const claims = new Set<string>();
  const cache: Cache = {
    get: async <T>(k: string) => (cacheStore.get(k) as T | undefined) ?? null,
    set: async (k, v) => void cacheStore.set(k, JSON.parse(JSON.stringify(v))),
    delete: async (k) => void cacheStore.delete(k),
    has: async (k) => cacheStore.has(k),
  };
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: async (key): Promise<IdempotencyClaim | null> => {
      if (claims.has(key)) return null;
      claims.add(key);
      return { key, token: "t", release: async () => claims.delete(key) };
    },
  };
  const rateLimiter: RateLimiter = {
    consume: async () => ({ allowed: true, remaining: 99, retryAfterMs: 0 }),
  };
  const authenticator: Authenticator = {
    verify: async (token) => (token === "good" ? staff : null),
  };
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => crypto.randomUUID() + `-${(n += 1)}` };
  return { cache, idempotencyKeys, rateLimiter, authenticator, idGenerator };
}

describe("PSP webhook ingress, end to end (C2-2/C2-6)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const f = fakes();
    app = await createAdminHttpApi({
      serializer: new InMemoryEventSerializer(),
      idGenerator: f.idGenerator,
      clock,
      authenticator: f.authenticator,
      rateLimiter: f.rateLimiter,
      idempotencyKeys: f.idempotencyKeys,
      responseCache: f.cache,
      paymentProvider: testPaymentProvider,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("records a genuinely signature-verified webhook with NO Authorization header — unlike every other Payments route", async () => {
    // Phase A.1 (F-03): `POST /payment-intents` no longer accepts a caller-supplied
    // amountMinor/currency — it re-derives them from the real, authoritative Order named by
    // `orderRef`. Create that order first, the normal (authenticated, staff-guarded) way.
    const order = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: {
        authorization: "Bearer good",
        "x-tenant-id": "t-1",
        "content-type": "application/json",
      },
      payload: {
        customerRef: "customer-1",
        currency: "USD",
        items: [
          { productId: "product-1", name: "Widget", unitPriceAmountMinor: 3500, quantity: 1 },
        ],
        shippingAddress: { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" },
      },
    });
    expect(order.statusCode).toBe(201);
    const orderId = order.json().orderId as string;

    // Create the intent the normal (authenticated, staff-guarded) way.
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/payment-intents",
      headers: {
        authorization: "Bearer good",
        "x-tenant-id": "t-1",
        "content-type": "application/json",
      },
      payload: { orderRef: orderId },
    });
    expect(created.statusCode).toBe(201);
    const paymentIntentId = created.json().paymentIntentId as string;

    // Confirm the contrast: the same-shaped request WITHOUT a webhook route requires auth.
    const unauthorizedCapture = await app.inject({
      method: "POST",
      url: `/api/v1/payment-intents/${paymentIntentId}/capture`,
      headers: { "x-tenant-id": "t-1" },
    });
    expect(unauthorizedCapture.statusCode).toBe(401);

    // The webhook route: NO Authorization header, only a tenant (public routes still resolve one).
    // `payment_intent.canceled` maps to kind "cancelled" — a fresh intent's status is "created"
    // (Sprint 4.8 full lifecycle), whose transition table only allows created -> processing/
    // cancelled; a PSP cancellation webhook is exactly this case and needs no other admin action
    // first (authorize/capture go through a separate lifecycle this route does not touch).
    const rawBody = JSON.stringify({
      id: "evt-1",
      type: "payment_intent.canceled",
      data: { object: { id: paymentIntentId } },
    });
    const now = Math.floor(clock.now().getTime() / 1000);

    const webhook = await app.inject({
      method: "POST",
      url: "/api/v1/payments/webhook",
      headers: {
        "x-tenant-id": "t-1",
        "content-type": "application/json",
        "stripe-signature": stripeSignatureHeader(rawBody, now),
      },
      payload: rawBody,
    });
    expect(webhook.statusCode).toBe(200);
    expect(webhook.json()).toMatchObject({
      paymentIntentId,
      status: "cancelled",
      duplicate: false,
    });

    // Replay is idempotent (ProcessedWebhookStore, existing RecordWebhook behavior — unchanged) —
    // the SAME signed request, resent verbatim (a genuine PSP-retry scenario, Task 8).
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/payments/webhook",
      headers: {
        "x-tenant-id": "t-1",
        "content-type": "application/json",
        "stripe-signature": stripeSignatureHeader(rawBody, now),
      },
      payload: rawBody,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().duplicate).toBe(true);
  });

  it("rejects an invalid signature with 401 (Task 8: invalid signature)", async () => {
    const rawBody = JSON.stringify({
      id: "evt-invalid-sig",
      type: "payment_intent.canceled",
      data: { object: { id: "pi-x" } },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/payments/webhook",
      headers: {
        "x-tenant-id": "t-1",
        "content-type": "application/json",
        "stripe-signature": `t=${Math.floor(clock.now().getTime() / 1000)},v1=0000not-a-real-signature`,
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a tampered body against a signature computed for different bytes with 401 (Task 8: integrity)", async () => {
    const signedBody = JSON.stringify({
      id: "evt-tampered",
      type: "payment_intent.canceled",
      data: { object: { id: "pi-x" } },
    });
    const now = Math.floor(clock.now().getTime() / 1000);
    const signature = stripeSignatureHeader(signedBody, now);

    const tamperedBody = JSON.stringify({
      id: "evt-tampered",
      type: "payment_intent.canceled",
      data: { object: { id: "pi-DIFFERENT" } },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/payments/webhook",
      headers: {
        "x-tenant-id": "t-1",
        "content-type": "application/json",
        "stripe-signature": signature,
      },
      payload: tamperedBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a stale timestamp with 401 (Task 8: replay protection)", async () => {
    const rawBody = JSON.stringify({
      id: "evt-stale",
      type: "payment_intent.canceled",
      data: { object: { id: "pi-x" } },
    });
    const staleTimestamp = Math.floor(clock.now().getTime() / 1000) - 10_000; // far outside the 300s tolerance

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/payments/webhook",
      headers: {
        "x-tenant-id": "t-1",
        "content-type": "application/json",
        "stripe-signature": stripeSignatureHeader(rawBody, staleTimestamp),
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a request with no Stripe-Signature header at all with 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/payments/webhook",
      headers: { "x-tenant-id": "t-1", "content-type": "application/json" },
      payload: JSON.stringify({
        id: "evt-no-sig",
        type: "payment_intent.canceled",
        data: { object: { id: "pi-x" } },
      }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("still requires a tenant — public does not mean unscoped", async () => {
    const rawBody = JSON.stringify({
      id: "evt-x",
      type: "payment_intent.canceled",
      data: { object: { id: "pi-x" } },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/payments/webhook",
      headers: {
        "content-type": "application/json",
        "stripe-signature": stripeSignatureHeader(
          rawBody,
          Math.floor(clock.now().getTime() / 1000),
        ),
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a malformed body at the boundary (zod) — no id, no type, no data.object.id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/payments/webhook",
      headers: {
        "x-tenant-id": "t-1",
        "content-type": "application/json",
        "stripe-signature": stripeSignatureHeader("{}", Math.floor(clock.now().getTime() / 1000)),
      },
      payload: {},
    });
    expect(res.statusCode).toBe(422);
  });
});

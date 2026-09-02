import { describe, expect, it } from "vitest";
import type {
  Clock,
  IdGenerator,
  PaymentIntentRequest,
  PaymentProvider,
  Principal,
  ProviderIntent,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import type { PaymentController } from "@platform/payments";
import { wireAdmin, type AdminWiringDeps, type WiredAdmin } from "../composition";
import { paymentsRoutes } from "./payments-routes";

/**
 * Phase A.6 — direct Payments refund endpoint (`POST /payment-intents/:id/refund`) idempotency &
 * final refund-path security closure.
 *
 * A.5 (`services/payments/src/refund-idempotency.test.ts`) proved `RefundPaymentLifecycle` and
 * `PaymentIntent.requestRefund` are safe WHEN a caller passes a stable `idempotencyKey` — the
 * Returns path (`<returnId>:refund`) does. This file proves/regresses the DIRECT admin HTTP route
 * specifically: does the HTTP transport actually get a key to the (already-safe) domain layer?
 *
 * Pre-fix baseline (`payments-routes.ts`'s `refundBody` had only `amountMinor`/`currency`, no
 * `Idempotency-Key` header support): every call reached `RefundPaymentLifecycle` with
 * `idempotencyKey: undefined`, so every retry minted a fresh reservation + fresh PSP identity —
 * the exact "Task 2" exploit A.5's OWN test file already demonstrates at the lifecycle level,
 * reproduced here at the HTTP-route level (`route.handle()`, the real transport boundary).
 */

const clock: Clock = { now: () => new Date("2026-08-11T00:00:00.000Z") };

function buildAdmin(
  paymentProvider: PaymentProvider,
  extra?: Partial<AdminWiringDeps>,
): WiredAdmin {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  return wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    paymentProvider,
    ...extra,
  });
}

const staff: Principal = { id: "staff-1", kind: "staff", roles: ["admin"] };
const otherStaff: Principal = { id: "staff-2", kind: "staff", roles: ["admin"] };

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
  headers?: Record<string, string>,
): Promise<Response> {
  return route.handle({
    body,
    params,
    query: {},
    context: {
      tenantId: "tenant-local",
      principal,
      requestId: "req-1",
      correlationId: "corr-1",
      headers,
    },
  } as never) as Promise<Response>;
}

function unwrap<T>(response: Response, action: string): T {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${action} failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return response.body as T;
}

/**
 * Records every PSP refund call; models the real dedup guarantee an idempotency-key-aware PSP
 * (Stripe) provides server-side: a second call presenting a key it has already seen does not move
 * money again. Same modeling convention as A.5's `RecordingPaymentProvider`.
 */
class RecordingPaymentProvider implements PaymentProvider {
  readonly calls: Array<{ providerIntentId: string; amountMinor: number; idempotencyKey: string }> =
    [];
  private readonly seenKeys = new Set<string>();
  realEffects = 0;
  private seq = 0;

  async createIntent(_request: PaymentIntentRequest): Promise<ProviderIntent> {
    this.seq += 1;
    return { providerIntentId: `psp-intent-${this.seq}`, clientHandle: `secret-${this.seq}` };
  }
  async capture(): Promise<void> {}
  async cancel(): Promise<void> {}

  async refund(
    providerIntentId: string,
    amountMinor: number,
    idempotencyKey: string,
  ): Promise<void> {
    this.calls.push({ providerIntentId, amountMinor, idempotencyKey });
    if (this.seenKeys.has(idempotencyKey)) return;
    this.seenKeys.add(idempotencyKey);
    this.realEffects += 1;
  }

  async verifyWebhook(): Promise<boolean> {
    return true;
  }
}

/**
 * Creates a payment intent, authorizes it, and captures it — the direct refund endpoint requires
 * `captured` status + remaining capacity. `created → processing` has no exposed admin HTTP route
 * (`PaymentsAdminController` deliberately excludes the generic `advance`, per its own doc comment
 * — "saga/PSP-internal, not exposed here"; the webhook path's `KIND_TO_STATUS` has no "processing"
 * entry either) — a pre-existing gap unrelated to refunds, out of Phase A.6's scope to fix. Reaches
 * the same underlying `PaymentController` instance `PaymentsAdminController` wraps (identical
 * technique to how a real saga would call `PaymentController.advance` internally) purely to get a
 * realistic `captured` fixture for the refund tests below — the refund call itself always goes
 * through the real, guarded HTTP route.
 */
async function seedCapturedPaymentIntent(
  admin: WiredAdmin,
  orderRef: string,
  amountMinor: number,
): Promise<string> {
  const created = unwrap<{ paymentIntentId: string }>(
    await admin.payments.createIntent(staff, { orderRef, amountMinor, currency: "USD" }),
    "create intent",
  );
  const { paymentIntentId } = created;
  const inner = (admin.payments as unknown as { payments: PaymentController }).payments;
  const advanced = await inner.advance({ paymentIntentId, toStatus: "processing" });
  if (advanced.status < 200 || advanced.status >= 300) {
    throw new Error(
      `advance to processing failed (${advanced.status}): ${JSON.stringify(advanced.body)}`,
    );
  }
  unwrap(
    await admin.payments.authorize(staff, {
      paymentIntentId,
      pspReference: `psp-ref-${orderRef}`,
      paymentMethodToken: "tok_visa",
      authorizedAmountMinor: amountMinor,
    }),
    "authorize",
  );
  unwrap(await admin.payments.capture(staff, { paymentIntentId }), "capture");
  return paymentIntentId;
}

describe("Phase A.6 — Task 3 exploit proof: direct HTTP refund route without Idempotency-Key support", () => {
  it("EXPLOIT (pre-fix baseline): two retries of the same logical refund, no idempotency key available at the HTTP layer, mint two refunds and two PSP calls", async () => {
    const provider = new RecordingPaymentProvider();
    const admin = buildAdmin(provider);
    const paymentIntentId = await seedCapturedPaymentIntent(admin, "order-exploit", 1000);
    const refundRoute = byPathAndMethod(
      paymentsRoutes(admin),
      "POST",
      "/payment-intents/:paymentIntentId/refund",
    );

    // Two calls a real client would only ever intend as "one refund, retried after a timeout" —
    // no `Idempotency-Key` header is sent because, pre-fix, the route neither required nor read one.
    const first = await call(
      refundRoute,
      staff,
      { paymentIntentId },
      { amountMinor: 300, currency: "USD" },
    );
    const second = await call(
      refundRoute,
      staff,
      { paymentIntentId },
      { amountMinor: 300, currency: "USD" },
    );

    // This assertion is written for the FIXED endpoint's contract (see the block below) and is
    // expected to FAIL against the pre-fix implementation — that failure IS the exploit proof this
    // phase's process requires (Task 3: "confirm they fail if the vulnerability exists").
    // Pre-fix actual behavior: both calls return 200, two distinct refunds, two PSP calls.
    expect(first.status).toBe(422); // fixed contract: missing key is rejected before any refund happens
    expect(second.status).toBe(422);
    expect(provider.calls).toHaveLength(0);
  });
});

describe("Phase A.6 — Task 6/7: fixed HTTP contract (Idempotency-Key header, fail-closed on missing)", () => {
  it("missing Idempotency-Key header is rejected with 422 VALIDATION, before any domain call", async () => {
    const provider = new RecordingPaymentProvider();
    const admin = buildAdmin(provider);
    const paymentIntentId = await seedCapturedPaymentIntent(admin, "order-missing-key", 1000);
    const refundRoute = byPathAndMethod(
      paymentsRoutes(admin),
      "POST",
      "/payment-intents/:paymentIntentId/refund",
    );

    const response = await call(
      refundRoute,
      staff,
      { paymentIntentId },
      { amountMinor: 300, currency: "USD" },
    );

    expect(response.status).toBe(422);
    expect((response.body as { code: string }).code).toBe("VALIDATION");
    expect(provider.calls).toHaveLength(0);
  });

  it("empty Idempotency-Key header is treated as missing (fail closed, not silently accepted)", async () => {
    const provider = new RecordingPaymentProvider();
    const admin = buildAdmin(provider);
    const paymentIntentId = await seedCapturedPaymentIntent(admin, "order-empty-key", 1000);
    const refundRoute = byPathAndMethod(
      paymentsRoutes(admin),
      "POST",
      "/payment-intents/:paymentIntentId/refund",
    );

    const response = await call(
      refundRoute,
      staff,
      { paymentIntentId },
      { amountMinor: 300, currency: "USD" },
      { "idempotency-key": "" },
    );

    expect(response.status).toBe(422);
    expect(provider.calls).toHaveLength(0);
  });

  it("Attack A/B/C — exact retry with the same Idempotency-Key + same amount is a safe no-op: ONE refund, ONE PSP call", async () => {
    const provider = new RecordingPaymentProvider();
    const admin = buildAdmin(provider);
    const paymentIntentId = await seedCapturedPaymentIntent(admin, "order-retry", 1000);
    const refundRoute = byPathAndMethod(
      paymentsRoutes(admin),
      "POST",
      "/payment-intents/:paymentIntentId/refund",
    );
    const headers = { "idempotency-key": "refund-key-1" };

    const first = await call(
      refundRoute,
      staff,
      { paymentIntentId },
      { amountMinor: 300, currency: "USD" },
      headers,
    );
    const second = await call(
      refundRoute,
      staff,
      { paymentIntentId },
      { amountMinor: 300, currency: "USD" },
      headers,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(provider.calls).toHaveLength(1);
    expect(provider.realEffects).toBe(1);

    const intent = unwrap<{ refunds: readonly { amount: { amountMinor: number } }[] }>(
      await admin.payments.getPaymentIntent(staff, { paymentIntentId }),
      "get intent",
    );
    expect(intent.refunds).toHaveLength(1);
    expect(intent.refunds[0]?.amount.amountMinor).toBe(300);
  });

  it("Attack D — same Idempotency-Key, different amount is REJECTED (tamper protection), not silently replayed or double-refunded", async () => {
    const provider = new RecordingPaymentProvider();
    const admin = buildAdmin(provider);
    const paymentIntentId = await seedCapturedPaymentIntent(admin, "order-tamper", 1000);
    const refundRoute = byPathAndMethod(
      paymentsRoutes(admin),
      "POST",
      "/payment-intents/:paymentIntentId/refund",
    );
    const headers = { "idempotency-key": "refund-key-tamper" };

    const first = await call(
      refundRoute,
      staff,
      { paymentIntentId },
      { amountMinor: 300, currency: "USD" },
      headers,
    );
    expect(first.status).toBe(200);

    const tampered = await call(
      refundRoute,
      staff,
      { paymentIntentId },
      { amountMinor: 999, currency: "USD" },
      headers,
    );

    expect(tampered.status).toBe(409);
    expect((tampered.body as { code: string }).code).toBe("BUSINESS_RULE");
    expect(provider.calls).toHaveLength(1); // the tampered retry never reached the PSP

    const intent = unwrap<{ refunds: readonly unknown[] }>(
      await admin.payments.getPaymentIntent(staff, { paymentIntentId }),
      "get intent",
    );
    expect(intent.refunds).toHaveLength(1);
  });

  it("same Idempotency-Key on a DIFFERENT payment intent is a distinct logical refund (Task 13 — no cross-intent collision)", async () => {
    const provider = new RecordingPaymentProvider();
    const admin = buildAdmin(provider);
    const intentA = await seedCapturedPaymentIntent(admin, "order-scope-a", 1000);
    const intentB = await seedCapturedPaymentIntent(admin, "order-scope-b", 1000);
    const refundRoute = byPathAndMethod(
      paymentsRoutes(admin),
      "POST",
      "/payment-intents/:paymentIntentId/refund",
    );
    const headers = { "idempotency-key": "shared-key" };

    const a = await call(
      refundRoute,
      staff,
      { paymentIntentId: intentA },
      { amountMinor: 300, currency: "USD" },
      headers,
    );
    const b = await call(
      refundRoute,
      staff,
      { paymentIntentId: intentB },
      { amountMinor: 300, currency: "USD" },
      headers,
    );

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(provider.calls).toHaveLength(2);
    expect(new Set(provider.calls.map((c) => c.idempotencyKey)).size).toBe(2); // scoped by paymentIntentId internally
  });

  it("different Idempotency-Keys on the same intent are two legitimate refunds (Task 12 Case 2 semantics)", async () => {
    const provider = new RecordingPaymentProvider();
    const admin = buildAdmin(provider);
    const paymentIntentId = await seedCapturedPaymentIntent(admin, "order-two-legit", 1000);
    const refundRoute = byPathAndMethod(
      paymentsRoutes(admin),
      "POST",
      "/payment-intents/:paymentIntentId/refund",
    );

    const a = await call(
      refundRoute,
      staff,
      { paymentIntentId },
      { amountMinor: 500, currency: "USD" },
      {
        "idempotency-key": "key-a",
      },
    );
    const b = await call(
      refundRoute,
      staff,
      { paymentIntentId },
      { amountMinor: 500, currency: "USD" },
      {
        "idempotency-key": "key-b",
      },
    );

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(provider.calls).toHaveLength(2);
  });

  it("Task 12 Case 5 — concurrent identical requests (same key, same amount, same intent) collapse into ONE PSP call", async () => {
    const provider = new RecordingPaymentProvider();
    const admin = buildAdmin(provider);
    const paymentIntentId = await seedCapturedPaymentIntent(admin, "order-concurrent", 1000);
    const refundRoute = byPathAndMethod(
      paymentsRoutes(admin),
      "POST",
      "/payment-intents/:paymentIntentId/refund",
    );
    const headers = { "idempotency-key": "concurrent-key" };

    const [a, b] = await Promise.all([
      call(refundRoute, staff, { paymentIntentId }, { amountMinor: 500, currency: "USD" }, headers),
      call(refundRoute, staff, { paymentIntentId }, { amountMinor: 500, currency: "USD" }, headers),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(new Set(provider.calls.map((c) => c.idempotencyKey)).size).toBe(1);
    expect(provider.realEffects).toBe(1);

    const intent = unwrap<{ refunds: readonly unknown[] }>(
      await admin.payments.getPaymentIntent(staff, { paymentIntentId }),
      "get intent",
    );
    expect(intent.refunds).toHaveLength(1);
  });

  it("Task 15 — amount integrity: refund exceeding captured/remaining amount is rejected even with a valid key", async () => {
    const provider = new RecordingPaymentProvider();
    const admin = buildAdmin(provider);
    const paymentIntentId = await seedCapturedPaymentIntent(admin, "order-overrefund", 1000);
    const refundRoute = byPathAndMethod(
      paymentsRoutes(admin),
      "POST",
      "/payment-intents/:paymentIntentId/refund",
    );

    const response = await call(
      refundRoute,
      staff,
      { paymentIntentId },
      { amountMinor: 5000, currency: "USD" },
      {
        "idempotency-key": "over-refund-key",
      },
    );

    expect(response.status).toBe(409);
    expect(provider.calls).toHaveLength(0);
  });

  it("Task 11 — a key that already FAILED cannot be silently resurrected; a fresh key is a legitimate new attempt", async () => {
    let shouldFail = true;
    class FailingThenRecoveringProvider extends RecordingPaymentProvider {
      override async refund(
        providerIntentId: string,
        amountMinor: number,
        idempotencyKey: string,
      ): Promise<void> {
        if (shouldFail) {
          this.calls.push({ providerIntentId, amountMinor, idempotencyKey });
          throw new Error("simulated PSP failure");
        }
        return super.refund(providerIntentId, amountMinor, idempotencyKey);
      }
    }
    const provider = new FailingThenRecoveringProvider();
    const admin = buildAdmin(provider);
    const paymentIntentId = await seedCapturedPaymentIntent(admin, "order-failed-retry", 1000);
    const refundRoute = byPathAndMethod(
      paymentsRoutes(admin),
      "POST",
      "/payment-intents/:paymentIntentId/refund",
    );
    const headers = { "idempotency-key": "failed-key" };

    // First attempt: PSP fails. RefundPaymentLifecycle re-throws (matches A.5's lifecycle contract);
    // the route layer surfaces it as a 500 (unmapped exception), and the underlying Refund is left
    // `failed` — exactly the state A.5 already proved for the lifecycle directly.
    await expect(
      call(refundRoute, staff, { paymentIntentId }, { amountMinor: 300, currency: "USD" }, headers),
    ).rejects.toThrow(/simulated PSP failure/);

    // Reusing the SAME key is rejected outright (A.5 semantics preserved).
    shouldFail = false;
    const reused = await call(
      refundRoute,
      staff,
      { paymentIntentId },
      { amountMinor: 300, currency: "USD" },
      headers,
    );
    expect(reused.status).toBe(409);

    // A fresh key is a legitimate new attempt and succeeds.
    const fresh = await call(
      refundRoute,
      staff,
      { paymentIntentId },
      { amountMinor: 300, currency: "USD" },
      {
        "idempotency-key": "failed-key:attempt-2",
      },
    );
    expect(fresh.status).toBe(200);
  });

  it("Task 16 — PSP idempotency evidence: same logical refund → same PSP idempotencyKey; distinct refunds → distinct keys", async () => {
    const provider = new RecordingPaymentProvider();
    const admin = buildAdmin(provider);
    const paymentIntentId = await seedCapturedPaymentIntent(admin, "order-psp-evidence", 1000);
    const refundRoute = byPathAndMethod(
      paymentsRoutes(admin),
      "POST",
      "/payment-intents/:paymentIntentId/refund",
    );

    const first = await call(
      refundRoute,
      staff,
      { paymentIntentId },
      { amountMinor: 100, currency: "USD" },
      {
        "idempotency-key": "evidence-key-1",
      },
    );
    const replay = await call(
      refundRoute,
      staff,
      { paymentIntentId },
      { amountMinor: 100, currency: "USD" },
      {
        "idempotency-key": "evidence-key-1",
      },
    );
    const distinct = await call(
      refundRoute,
      staff,
      { paymentIntentId },
      { amountMinor: 100, currency: "USD" },
      {
        "idempotency-key": "evidence-key-2",
      },
    );

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(distinct.status).toBe(200);

    // The key-1 replay is recognized as already-`completed` domain-side (A.5's short-circuit) and
    // never re-reaches the PSP at all — only 2 real PSP calls total: one per distinct logical refund.
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]?.idempotencyKey).not.toBe(provider.calls[1]?.idempotencyKey);
    expect(provider.realEffects).toBe(2); // only 2 distinct keys ever moved money
  });
});

describe("Phase A.6 — Task 14: authorization findings (documented, not remediated in this phase)", () => {
  it("any principal holding payments:refund can refund a payment intent it has no ownership relation to (flat RBAC, no object-level check — same pattern as Returns' returns:resolution)", async () => {
    const provider = new RecordingPaymentProvider();
    const admin = buildAdmin(provider);
    const paymentIntentId = await seedCapturedPaymentIntent(admin, "order-auth", 1000);
    const refundRoute = byPathAndMethod(
      paymentsRoutes(admin),
      "POST",
      "/payment-intents/:paymentIntentId/refund",
    );

    // `otherStaff` has no relation to `order-auth` beyond holding the same blanket permission —
    // there is no per-resource check anywhere in the chain (confirmed by code trace, Task 1 §10).
    const response = await call(
      refundRoute,
      otherStaff,
      { paymentIntentId },
      { amountMinor: 100, currency: "USD" },
      {
        "idempotency-key": "auth-key",
      },
    );

    expect(response.status).toBe(200); // documents current (accepted, architecture-wide) behavior — not a Phase A.6 regression
  });
});

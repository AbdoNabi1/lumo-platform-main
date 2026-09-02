import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wirePayments } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-06-30T00:00:00.000Z") };

function wire() {
  return wirePayments({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

async function newIntentId(app: ReturnType<typeof wire>): Promise<string> {
  const created = await app.payments.createIntent({
    orderRef: "order-1",
    amountMinor: 3500,
    currency: "USD",
  });
  expect(created.status).toBe(201);
  return (created.body as { paymentIntentId: string }).paymentIntentId;
}

describe("payments (end to end)", () => {
  it("creates, captures, and refunds an intent, publishing the events", async () => {
    const app = wire();
    const id = await newIntentId(app);

    const captured = await app.payments.capture({ paymentIntentId: id, pspToken: "tok_123" });
    expect(captured.status).toBe(200);
    expect((captured.body as { status: string }).status).toBe("captured");

    const refunded = await app.payments.refund({
      paymentIntentId: id,
      amountMinor: 3500,
      currency: "USD",
    });
    expect(refunded.status).toBe(200);
    expect((refunded.body as { status: string }).status).toBe("refunded");

    expect(await app.drainOutbox()).toBe(2);
    expect(app.deliveredEventTypes).toEqual([
      "payments.payment_intent.captured",
      "payments.payment_intent.refunded",
    ]);
  });

  it("fails a payment intent (200) and publishes payment.failed", async () => {
    const app = wire();
    const id = await newIntentId(app);
    const failed = await app.payments.fail({ paymentIntentId: id, reason: "card_declined" });
    expect(failed.status).toBe(200);
    expect((failed.body as { status: string }).status).toBe("failed");
    expect(await app.drainOutbox()).toBe(1);
    expect(app.deliveredEventTypes).toContain("payments.payment_intent.failed");
  });

  it("rejects a refund greater than captured (409)", async () => {
    const app = wire();
    const id = await newIntentId(app);
    await app.payments.capture({ paymentIntentId: id, pspToken: "tok_123" });
    const response = await app.payments.refund({
      paymentIntentId: id,
      amountMinor: 9999,
      currency: "USD",
    });
    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown intent", async () => {
    const app = wire();
    const response = await app.payments.capture({ paymentIntentId: "missing", pspToken: "tok_1" });
    expect(response.status).toBe(404);
  });

  it("rejects an invalid amount at creation (422)", async () => {
    const app = wire();
    const response = await app.payments.createIntent({
      orderRef: "order-1",
      amountMinor: -1,
      currency: "USD",
    });
    expect(response.status).toBe(422);
  });

  it("runs the full Sprint 4.8 lifecycle: create -> authorize -> capture -> refund, with an illegal-transition 409", async () => {
    const app = wire();

    const created = await app.payments.createIntentLifecycle({
      orderRef: "order-2",
      amountMinor: 5000,
      currency: "USD",
    });
    expect(created.status).toBe(201);
    const id = (created.body as { paymentIntentId: string }).paymentIntentId;
    expect((created.body as { status: string }).status).toBe("created");

    expect(
      (await app.payments.advance({ paymentIntentId: id, toStatus: "processing" })).status,
    ).toBe(200);

    const authorized = await app.payments.authorize({
      paymentIntentId: id,
      pspReference: "psp-ref-1",
      paymentMethodToken: "tok_abc",
      paymentMethodBrand: "visa",
      authorizedAmountMinor: 5000,
    });
    expect(authorized.status).toBe(200);
    expect((authorized.body as { status: string }).status).toBe("authorized");

    const captured = await app.payments.captureLifecycle({ paymentIntentId: id });
    expect(captured.status).toBe(200);
    expect((captured.body as { status: string }).status).toBe("captured");

    const refunded = await app.payments.refundLifecycle({
      paymentIntentId: id,
      amountMinor: 5000,
      currency: "USD",
    });
    expect(refunded.status).toBe(200);
    expect((refunded.body as { status: string }).status).toBe("refunded");

    // Illegal: refunded has no outgoing transitions.
    const illegal = await app.payments.advance({ paymentIntentId: id, toStatus: "processing" });
    expect(illegal.status).toBe(409);
  });

  it("webhook idempotency: first processed, replay deduped", async () => {
    const app = wire();
    const created = await app.payments.createIntentLifecycle({
      orderRef: "order-3",
      amountMinor: 1000,
      currency: "USD",
    });
    const id = (created.body as { paymentIntentId: string }).paymentIntentId;
    await app.payments.advance({ paymentIntentId: id, toStatus: "processing" });

    const first = await app.payments.recordWebhook({
      paymentIntentId: id,
      provider: "stripe",
      eventId: "evt-webhook-1",
      kind: "authorized",
    });
    expect(first.status).toBe(200);
    expect((first.body as { duplicate: boolean }).duplicate).toBe(false);
    expect((first.body as { status: string }).status).toBe("authorized");

    const replay = await app.payments.recordWebhook({
      paymentIntentId: id,
      provider: "stripe",
      eventId: "evt-webhook-1",
      kind: "authorized",
    });
    expect(replay.status).toBe(200);
    expect((replay.body as { duplicate: boolean }).duplicate).toBe(true);
  });

  it("returns a single payment intent by id", async () => {
    const app = wire();
    const id = await newIntentId(app);
    const response = await app.payments.getPaymentIntent({ paymentIntentId: id });
    expect(response.status).toBe(200);
  });

  /**
   * Phase A.3, Phase E (concurrency audit). `RefundPaymentLifecycle` (`payment-lifecycle.use-
   * cases.ts`) checks the `totalRefunded <= totalCaptured` invariant in `requestRefund()`, THEN
   * awaits the PSP call (`paymentProvider.refund`), and only AFTER that mutates durable state in
   * `completeRefund()` — a real time-of-check-to-time-of-use gap around an external network call.
   * That gap is a genuine defect IN THE CODE (see the audit report's Concurrency Audit section for
   * the cross-process argument, which is the actually-dangerous case: two application replicas each
   * holding their own independently-read `PaymentIntent`, each passing their own invariant check,
   * each calling the PSP for real, with only the LOSING replica's final `save()` rejected by
   * `PrismaPaymentIntentRepository`'s optimistic lock — after its PSP call already happened).
   *
   * This test tried to reproduce that race WITHIN one Node process (`Promise.all` over two
   * `refundLifecycle` calls, first with the default zero-latency in-memory PSP stub, then with a
   * `setTimeout`-delayed one to simulate realistic PSP network latency) and could NOT: in both
   * cases, Node's own event-loop scheduling (full microtask drainage between successive timer/macro-
   * task callbacks) serializes the two calls' completions, so the second request's invariant check
   * always observes the first's already-completed state and is correctly rejected (409). This is
   * NOT a designed protection (no lock, no transaction, no queue anywhere in this path) — it is
   * incidental to how ONE event loop happens to interleave THIS specific `await` shape, and it says
   * nothing about two SEPARATE processes each running their own event loop against the same
   * Postgres row, which is what this codebase actually deploys (k8s HPA — multiple pod replicas).
   * Recorded as observed, honest evidence either way: intra-process concurrency in this codebase, as
   * tested, does not reproduce the race; the cross-process case could not be tested here (no Docker
   * host in this sandbox) and remains a code-level finding, not a runtime-proven one.
   */
  it("Phase E: two concurrent refunds of 700 against a 1000 capture, zero-latency PSP — the second is correctly rejected (intra-process only; see report for the cross-process risk)", async () => {
    const app = wire();
    const created = await app.payments.createIntentLifecycle({
      orderRef: "order-race-2",
      amountMinor: 1000,
      currency: "USD",
    });
    const id = (created.body as { paymentIntentId: string }).paymentIntentId;
    await app.payments.advance({ paymentIntentId: id, toStatus: "processing" });
    await app.payments.authorize({
      paymentIntentId: id,
      pspReference: "psp-ref-race-2",
      paymentMethodToken: "tok_abc",
      paymentMethodBrand: "visa",
      authorizedAmountMinor: 1000,
    });
    await app.payments.captureLifecycle({ paymentIntentId: id });

    const [a, b] = await Promise.all([
      app.payments.refundLifecycle({ paymentIntentId: id, amountMinor: 700, currency: "USD" }),
      app.payments.refundLifecycle({ paymentIntentId: id, amountMinor: 700, currency: "USD" }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});

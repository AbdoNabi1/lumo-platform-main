import { describe, expect, it } from "vitest";
import { BusinessRuleError, Money, UniqueEntityId } from "@platform/domain";
import { PaymentIntent } from "./payment-intent";
import { PaymentMethod, PspReference } from "./value-objects/payment-references";
import { PspToken } from "./value-objects/psp-token";

function usd(amountMinor: number): Money {
  const result = Money.create(amountMinor, "USD");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function token(): PspToken {
  const result = PspToken.create("tok_123");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function intent(): PaymentIntent {
  return PaymentIntent.create(UniqueEntityId.from("pi-1"), "order-1", usd(3500), "stripe");
}

describe("PaymentIntent", () => {
  it("captures and emits payment.captured", () => {
    const pi = intent();
    pi.capture(token(), "evt-1", new Date(0));
    expect(pi.status.value).toBe("captured");
    const events = pi.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("payment.captured");
  });

  it("fails from requires_payment and emits payment.failed", () => {
    const pi = intent();
    pi.fail("card_declined", "evt-1", new Date(0));
    expect(pi.status.value).toBe("failed");
    expect(pi.pullDomainEvents()[0]?.eventName).toBe("payment.failed");
  });

  it("rejects capturing a failed payment", () => {
    const pi = intent();
    pi.fail("card_declined", "evt-1", new Date(0));
    expect(() => pi.capture(token(), "evt-2", new Date(0))).toThrow(BusinessRuleError);
  });

  it("refunds up to the captured amount, then marks refunded", () => {
    const pi = intent();
    pi.capture(token(), "evt-1", new Date(0));
    pi.pullDomainEvents();

    pi.refund(usd(1500), "evt-2", new Date(0));
    expect(pi.status.value).toBe("captured"); // partial
    expect(pi.pullDomainEvents()[0]?.eventName).toBe("payment.refunded");

    pi.refund(usd(2000), "evt-3", new Date(0));
    expect(pi.status.value).toBe("refunded"); // fully refunded
  });

  it("rejects refunding more than captured", () => {
    const pi = intent();
    pi.capture(token(), "evt-1", new Date(0));
    expect(() => pi.refund(usd(4000), "evt-2", new Date(0))).toThrow(BusinessRuleError);
  });

  it("rejects refunding before capture", () => {
    const pi = intent();
    expect(() => pi.refund(usd(100), "evt-1", new Date(0))).toThrow(BusinessRuleError);
  });

  it("runs the full Sprint 4.8 lifecycle: created -> processing -> authorized -> capture_requested -> captured -> refund requested+completed -> closed", () => {
    const pi = PaymentIntent.createIntent(
      UniqueEntityId.from("pi-full"),
      "order-2",
      usd(5000),
      "stripe",
    );
    expect(pi.status.value).toBe("created");

    pi.markProcessing("evt-1", new Date(0));
    expect(pi.status.value).toBe("processing");

    const pspRef = PspReference.create("psp-ref-1");
    const method = PaymentMethod.create("tok_abc", "visa");
    if (!pspRef.ok || !method.ok) throw new Error("invalid fixture");
    pi.authorize(pspRef.value, method.value, 5000, "evt-2", new Date(0));
    expect(pi.status.value).toBe("authorized");
    expect(pi.pspReference?.value).toBe("psp-ref-1");

    pi.requestCapture("evt-3", new Date(0));
    expect(pi.status.value).toBe("capture_requested");
    pi.markCaptured("evt-4", new Date(0));
    expect(pi.status.value).toBe("captured");

    pi.requestRefund(usd(5000), "evt-5", new Date(0));
    pi.completeRefund("evt-5", "evt-6", new Date(0));
    expect(pi.status.value).toBe("refunded");

    pi.close("evt-7", new Date(0));
    expect(pi.status.value).toBe("closed");

    const events = pi.pullDomainEvents();
    expect(events.some((e) => e.eventName === "refund.transitioned")).toBe(true);
  });

  it("rejects an illegal transition (e.g. created -> captured directly, 409)", () => {
    const pi = PaymentIntent.createIntent(
      UniqueEntityId.from("pi-illegal"),
      "order-3",
      usd(1000),
      "stripe",
    );
    expect(() => pi.transition("captured", "evt-1", new Date(0))).toThrow(BusinessRuleError);
  });

  it("records a webhook receipt, emitting payment.webhook_received", () => {
    const pi = PaymentIntent.createIntent(
      UniqueEntityId.from("pi-webhook"),
      "order-4",
      usd(1000),
      "stripe",
    );
    pi.recordWebhook("stripe", "authorized", "evt-1", new Date(0));
    expect(pi.pullDomainEvents().some((e) => e.eventName === "payment.webhook_received")).toBe(
      true,
    );
  });
});

/**
 * Phase A.2 — Task 5: proves `totalRefunded <= totalCaptured` at the domain layer itself
 * (`requestRefund`'s `amount.isGreaterThan(this.remaining())` guard). captured=1000,
 * alreadyRefunded=200 (one completed refund) ⇒ remaining=800 for every case below. This invariant
 * protects any caller that routes through `PaymentIntent.requestRefund` (the legacy `refund()`
 * carries the identical guard) — i.e. `RefundPaymentLifecycle` /
 * `POST /payment-intents/:id/refund`. It does NOT protect Returns' `DecideResolution` /
 * `POST /returns/:id/resolution`, which never touches a `PaymentIntent` at all (see
 * PHASE_A2_REFUND_SECURITY_CLOSURE_AUDIT.md, Task 5).
 */
describe("PaymentIntent.requestRefund — totalRefunded <= totalCaptured invariant", () => {
  /** captured=1000, one already-completed refund of 200 ⇒ remaining()=800. */
  function capturedAndPartiallyRefunded(): PaymentIntent {
    const pi = PaymentIntent.create(
      UniqueEntityId.from("pi-invariant"),
      "order-1",
      usd(1000),
      "stripe",
    );
    pi.capture(token(), "evt-capture", new Date(0));
    pi.requestRefund(usd(200), "evt-refund-1", new Date(0));
    pi.completeRefund("evt-refund-1", "evt-refund-1-complete", new Date(0));
    pi.pullDomainEvents();
    return pi;
  }

  it("valid: a refund request of 300 (within the 800 remaining) succeeds", () => {
    const pi = capturedAndPartiallyRefunded();
    expect(() => pi.requestRefund(usd(300), "evt-refund-2", new Date(0))).not.toThrow();
  });

  it("boundary: a refund request of exactly 800 (the full remaining) succeeds", () => {
    const pi = capturedAndPartiallyRefunded();
    expect(() => pi.requestRefund(usd(800), "evt-refund-2", new Date(0))).not.toThrow();
  });

  it("invalid: a refund request of 801 (one cent over remaining) fails", () => {
    const pi = capturedAndPartiallyRefunded();
    expect(() => pi.requestRefund(usd(801), "evt-refund-2", new Date(0))).toThrow(
      BusinessRuleError,
    );
  });

  it("extreme (Task 4 exploit scenario): a refund request of 5000 against remaining=800 fails", () => {
    const pi = capturedAndPartiallyRefunded();
    expect(() => pi.requestRefund(usd(5000), "evt-refund-2", new Date(0))).toThrow(
      BusinessRuleError,
    );
  });

  it('the legacy refund() method carries the identical invariant (its own captured=1000/refunded=200 fixture — legacy refund() keeps status "captured" on a partial refund, unlike completeRefund\'s "partially_refunded")', () => {
    const pi = PaymentIntent.create(
      UniqueEntityId.from("pi-legacy-invariant"),
      "order-1",
      usd(1000),
      "stripe",
    );
    pi.capture(token(), "evt-capture", new Date(0));
    pi.refund(usd(200), "evt-refund-1", new Date(0));
    expect(pi.status.value).toBe("captured");

    expect(() => pi.refund(usd(801), "evt-refund-2", new Date(0))).toThrow(BusinessRuleError);
    expect(() => pi.refund(usd(800), "evt-refund-2", new Date(0))).not.toThrow();
    expect(pi.status.value).toBe("refunded");
  });
});

describe("PaymentIntent attempt ids (payment_attempts.id is @db.Uuid)", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const INTENT_ID = "6f1c2a9e-3b4d-4e5f-8a7b-1234567890ab";

  function lifecycle(): PaymentIntent {
    const pi = PaymentIntent.createIntent(
      UniqueEntityId.from(INTENT_ID),
      "order-3",
      usd(5000),
      "stripe",
    );
    const pspRef = PspReference.create("psp-ref-3");
    const method = PaymentMethod.create("tok_abc", "visa");
    if (!pspRef.ok || !method.ok) throw new Error("invalid fixture");
    pi.markProcessing("evt-1", new Date(0));
    pi.authorize(pspRef.value, method.value, 5000, "evt-2", new Date(0));
    pi.requestCapture("evt-3", new Date(0));
    pi.markCaptured("evt-4", new Date(0));
    pi.requestRefund(usd(1000), "evt-5", new Date(0));
    pi.failRefund("evt-5", "evt-6", new Date(0), "psp_down");
    pi.requestRefund(usd(1000), "evt-7", new Date(0));
    pi.completeRefund("evt-7", "evt-8", new Date(0));
    pi.recordWebhook("stripe", "charge.refunded", "evt-9", new Date(0));
    return pi;
  }

  it("gives every attempt a distinct, valid UUID (never `${intentId}${index}`)", () => {
    const ids = lifecycle().attempts.map((a) => a.id.toString());
    expect(ids).toHaveLength(5); // authorize, capture, refund failed, refund succeeded, webhook
    for (const id of ids) expect(id).toMatch(UUID);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => id.startsWith(INTENT_ID))).toBe(false);
  });

  it("derives ids deterministically from (intent id, position) so re-saves stay idempotent", () => {
    const first = lifecycle().attempts.map((a) => a.id.toString());
    const second = lifecycle().attempts.map((a) => a.id.toString());
    expect(second).toEqual(first);
    // Pinned: SHA-256(`${intentId}:attempt:0`), first 16 bytes, version 5 / variant 10 — the same
    // derivation as `deterministicEntityId` on morbeh/local-carriers, so the two never diverge.
    expect(first[0]).toBe("cb4832a0-d9e9-5d32-8a50-c1f47ae086f8");
  });

  it("continues the sequence after rehydration instead of reusing a persisted id", () => {
    const original = lifecycle();
    const rehydrated = PaymentIntent.reconstitute(
      original.id,
      original.orderRef,
      original.amount,
      original.status,
      [...original.charges],
      [...original.refunds],
      original.version,
      { provider: original.provider, attempts: original.attempts },
    );
    rehydrated.recordWebhook("stripe", "charge.updated", "evt-10", new Date(1));
    const ids = rehydrated.attempts.map((a) => a.id.toString());
    expect(ids.slice(0, 5)).toEqual(original.attempts.map((a) => a.id.toString()));
    expect(ids[5]).toMatch(UUID);
    expect(new Set(ids).size).toBe(6);
  });
});

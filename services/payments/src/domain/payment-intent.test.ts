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
  return PaymentIntent.create(UniqueEntityId.from("pi-1"), "order-1", usd(3500));
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
    const pi = PaymentIntent.createIntent(UniqueEntityId.from("pi-full"), "order-2", usd(5000));
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
    const pi = PaymentIntent.createIntent(UniqueEntityId.from("pi-illegal"), "order-3", usd(1000));
    expect(() => pi.transition("captured", "evt-1", new Date(0))).toThrow(BusinessRuleError);
  });

  it("records a webhook receipt, emitting payment.webhook_received", () => {
    const pi = PaymentIntent.createIntent(UniqueEntityId.from("pi-webhook"), "order-4", usd(1000));
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
    const pi = PaymentIntent.create(UniqueEntityId.from("pi-invariant"), "order-1", usd(1000));
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
    );
    pi.capture(token(), "evt-capture", new Date(0));
    pi.refund(usd(200), "evt-refund-1", new Date(0));
    expect(pi.status.value).toBe("captured");

    expect(() => pi.refund(usd(801), "evt-refund-2", new Date(0))).toThrow(BusinessRuleError);
    expect(() => pi.refund(usd(800), "evt-refund-2", new Date(0))).not.toThrow();
    expect(pi.status.value).toBe("refunded");
  });
});

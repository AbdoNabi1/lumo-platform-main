import { describe, expect, it } from "vitest";
import { PaymentStatus } from "./payment-status";
import { PspToken } from "./psp-token";

describe("PspToken", () => {
  it("rejects blank tokens", () => {
    expect(PspToken.create("tok_123").ok).toBe(true);
    expect(PspToken.create("  ").ok).toBe(false);
  });
});

describe("PaymentStatus", () => {
  it("exposes lifecycle states and predicates", () => {
    expect(PaymentStatus.requiresPayment().isRequiresPayment).toBe(true);
    expect(PaymentStatus.captured().isCaptured).toBe(true);
    expect(PaymentStatus.failed().value).toBe("failed");
    expect(PaymentStatus.refunded().value).toBe("refunded");
  });
});

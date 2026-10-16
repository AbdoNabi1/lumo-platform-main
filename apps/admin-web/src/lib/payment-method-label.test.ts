import { describe, expect, it } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { paymentMethodLabel } from "./payment-method-label";

describe("paymentMethodLabel", () => {
  it("names the methods a shop can take, in the page language", () => {
    expect(paymentMethodLabel("cod", en)).toBe("Cash on delivery");
    expect(paymentMethodLabel("stripe", en)).toBe("Card (Stripe)");
    expect(paymentMethodLabel("paymob", en)).toBe("Card (Paymob)");
    expect(paymentMethodLabel("cod", ar)).toBe("الدفع عند الاستلام");
  });

  it("shows a method it has no name for as it was recorded", () => {
    expect(paymentMethodLabel("bank-transfer", en)).toBe("bank-transfer");
  });

  it("is a dash when no payment is linked yet", () => {
    expect(paymentMethodLabel(null, en)).toBe("—");
  });
});

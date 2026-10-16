import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { CheckoutSession } from "./checkout-session";
import { CheckoutAddress } from "./value-objects/checkout-address";
import { CheckoutItem } from "./value-objects/checkout-item";
import type { DiscountSnapshot } from "./value-objects/discount-snapshot";
import { ShippingSelection } from "./value-objects/selections";

function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function sessionWithShipping(): CheckoutSession {
  const s = CheckoutSession.start(UniqueEntityId.from("cs-1"), "cart-1", undefined, "s-1", "EGP");
  s.loadItems([must(CheckoutItem.create("prod-1", 2, 5_000, "EGP"))]);
  const address = must(
    CheckoutAddress.create({ line1: "1 Main St", city: "Cairo", postalCode: "", country: "EG" }),
  );
  s.setShippingAddress(address);
  s.setBillingAddress(address);
  s.selectShipping(must(ShippingSelection.create("std", 6_000, "EGP", { name: "Standard" })));
  return s;
}

const snapshot = (overrides: Partial<DiscountSnapshot> = {}): DiscountSnapshot => ({
  applied: [
    {
      promotionId: "p-1",
      couponId: "c-1",
      code: "SALE10",
      title: "SALE10",
      discountClass: "order",
      amountMinor: 1_000,
    },
  ],
  orderDiscountMinor: 1_000,
  shippingDiscountMinor: 0,
  codeStatuses: [{ code: "SALE10", applicable: true }],
  lineAllocations: [{ lineRef: "0", amountMinor: 1_000 }],
  ...overrides,
});

describe("CheckoutSession — discount codes (Phase 2)", () => {
  it("stores codes normalised and once", () => {
    const s = sessionWithShipping();
    s.enterDiscountCode(" sale10 ");
    s.enterDiscountCode("SALE10");
    expect(s.discountCodes).toEqual(["SALE10"]);
    s.removeDiscountCode("sale10");
    expect(s.discountCodes).toEqual([]);
  });

  it("refuses a sixth code", () => {
    const s = sessionWithShipping();
    for (const code of ["AAA", "BBB", "CCC", "DDD", "EEE"]) s.enterDiscountCode(code);
    expect(() => s.enterDiscountCode("FFF")).toThrow(BusinessRuleError);
  });

  it("takes the order discount and the shipping discount off the total", () => {
    const s = sessionWithShipping();
    s.applyDiscountSnapshot(snapshot({ shippingDiscountMinor: 6_000 }));
    s.recalculateTotals("evt-1", new Date(0));
    expect(s.discountMinor).toBe(1_000);
    expect(s.totals?.shippingDiscountMinor).toBe(6_000);
    // 10,000 + 6,000 shipping − 6,000 free shipping − 1,000 discount
    expect(s.totals?.totalMinor).toBe(9_000);
  });

  it("never discounts shipping beyond its price", () => {
    const s = sessionWithShipping();
    s.applyDiscountSnapshot(snapshot({ shippingDiscountMinor: 99_000 }));
    s.recalculateTotals("evt-1", new Date(0));
    expect(s.totals?.shippingDiscountMinor).toBe(6_000);
  });

  it("locks code entry after ten rejected codes for fifteen minutes", () => {
    const s = sessionWithShipping();
    const start = new Date("2026-10-16T12:00:00.000Z");
    for (let i = 0; i < 10; i += 1) s.recordRejectedDiscountCode(start);
    expect(s.isDiscountCodeEntryLocked(new Date(start.getTime() + 60_000))).toBe(true);
    expect(s.isDiscountCodeEntryLocked(new Date(start.getTime() + 15 * 60_000))).toBe(false);
  });

  it("hands the applied discounts to the order draft", () => {
    const s = sessionWithShipping();
    s.applyDiscountSnapshot(snapshot());
    s.recalculateTotals("evt-1", new Date(0));
    expect(s.generateOrderDraft().discounts).toEqual(snapshot().applied);
  });

  it("has no discount state until a code or a discount arrives", () => {
    const s = sessionWithShipping();
    expect(s.hasDiscountState).toBe(false);
    s.enterDiscountCode("SALE10");
    expect(s.hasDiscountState).toBe(true);
  });
});

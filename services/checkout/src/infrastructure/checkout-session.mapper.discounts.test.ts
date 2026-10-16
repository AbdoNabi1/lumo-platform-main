import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { CheckoutSession } from "../domain/checkout-session";
import { CheckoutAddress } from "../domain/value-objects/checkout-address";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import { ShippingSelection } from "../domain/value-objects/selections";
import { CheckoutSessionMapper } from "./checkout-session.mapper";

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

describe("CheckoutSessionMapper — discounts (Phase 2)", () => {
  it("round-trips codes, the snapshot, attempts and the shipping discount", () => {
    const s = sessionWithShipping();
    s.enterDiscountCode("SALE10");
    s.applyDiscountSnapshot({
      applied: [
        {
          promotionId: "p-1",
          code: "SALE10",
          title: "SALE10",
          discountClass: "shipping",
          amountMinor: 6_000,
        },
      ],
      orderDiscountMinor: 0,
      shippingDiscountMinor: 6_000,
      codeStatuses: [{ code: "SALE10", applicable: true }],
      lineAllocations: [],
    });
    s.recordRejectedDiscountCode(new Date("2026-10-16T12:00:00.000Z"));
    s.recalculateTotals("evt-1", new Date(0));

    const back = CheckoutSessionMapper.toDomain({
      ...CheckoutSessionMapper.toRow(s, "t1"),
      version: 1,
    } as never);

    expect(back.discountCodes).toEqual(["SALE10"]);
    expect(back.discountSnapshot).toEqual(s.discountSnapshot);
    expect(back.totals?.shippingDiscountMinor).toBe(6_000);
    expect(back.rejectedCodeAttempts).toBe(1);
  });

  it("reads a row saved before Phase 2 as having no discount state", () => {
    const row = {
      ...CheckoutSessionMapper.toRow(sessionWithShipping(), "t1"),
      discounts: {},
      version: 1,
    };
    expect(CheckoutSessionMapper.toDomain(row as never).hasDiscountState).toBe(false);
  });
});

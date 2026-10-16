import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { Order } from "../domain/order";
import { OrderItem } from "../domain/order-item";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { OrderTotalsSnapshot } from "../domain/value-objects/order-totals-snapshot";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import { OrderMapper } from "./order.mapper";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function order(totalsExtra: Partial<Parameters<typeof OrderTotalsSnapshot.create>[0]> = {}) {
  const line = OrderItem.create(
    UniqueEntityId.from("item-1"),
    must(ProductSnapshot.create("p-shirt", "Shirt", must(Money.create(5_000, "EGP")))),
    2,
  );
  const address = must(AddressSnapshot.create("1 Main St", "Cairo", "", "EG"));
  const totals = OrderTotalsSnapshot.create({
    subtotalMinor: 10_000,
    taxMinor: 0,
    shippingMinor: 6_000,
    discountMinor: 1_000,
    totalMinor: 9_000,
    currency: "EGP",
    ...totalsExtra,
  });
  return Order.createFromCheckout(
    UniqueEntityId.from("order-1"),
    must(OrderNumber.create("1001")),
    "customer-1",
    "EGP",
    [line],
    address,
    address,
    totals,
    "checkout-1",
    "evt-1",
    new Date(0),
  );
}

function roundTrip(o: Order): Order {
  return OrderMapper.toDomain(
    { ...OrderMapper.toOrderRow(o, "t1"), version: 1 } as never,
    OrderMapper.toItemRows(o, "t1"),
    OrderMapper.toEventRows(o, "t1"),
    OrderMapper.toAddressRow(o, "t1"),
  );
}

describe("OrderMapper — discounts (Phase 2)", () => {
  it("keeps the discounts and the shipping discount the order was placed with", () => {
    const discounts = [
      { title: "SALE10", code: "SALE10", discountClass: "order", amountMinor: 1_000 },
      { title: "Free shipping", discountClass: "shipping", amountMinor: 6_000 },
    ];
    const back = roundTrip(order({ discounts, shippingDiscountMinor: 6_000 }));
    expect(back.totals?.discounts).toEqual(discounts);
    expect(back.totals?.shippingDiscountMinor).toBe(6_000);
  });

  it("reads an order placed before Phase 2 as having no discount lines", () => {
    const back = roundTrip(order());
    expect(back.totals?.discounts).toEqual([]);
    expect(back.totals?.shippingDiscountMinor).toBe(0);
  });
});

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

function order(options: { province?: string; taxIncluded?: boolean; shippingName?: string } = {}) {
  const line = OrderItem.create(
    UniqueEntityId.from("item-1"),
    must(ProductSnapshot.create("p-shirt", "Shirt", must(Money.create(5700, "EGP")))),
    2,
  );
  const shipping = must(
    AddressSnapshot.create("1 Main St", "Cairo", "11511", "EG", {
      ...(options.province === undefined ? {} : { province: options.province }),
    }),
  );
  const totals = OrderTotalsSnapshot.create({
    subtotalMinor: 11_400,
    taxMinor: 1400,
    shippingMinor: 5000,
    discountMinor: 0,
    totalMinor: 16_400,
    currency: "EGP",
    shippingMethod: "rate-1",
    ...(options.taxIncluded === undefined ? {} : { taxIncluded: options.taxIncluded }),
    ...(options.shippingName === undefined ? {} : { shippingName: options.shippingName }),
  });
  return Order.createFromCheckout(
    UniqueEntityId.from("order-1"),
    must(OrderNumber.create("1001")),
    "customer-1",
    "EGP",
    [line],
    shipping,
    shipping,
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

describe("AddressSnapshot — province (Plan 3C)", () => {
  it("is optional and absent by default", () => {
    expect(must(AddressSnapshot.create("1 Main St", "Cairo", "", "EG")).province).toBeUndefined();
  });

  it("keeps the province it was given", () => {
    const address = must(
      AddressSnapshot.create("1 Main St", "Cairo", "", "EG", { province: "EG-C" }),
    );

    expect(address.province).toBe("EG-C");
  });
});

describe("OrderMapper — province, tax included and the shipping rate's name (Plan 3C)", () => {
  it("writes the province into the shipping address row, null when there is none", () => {
    expect(OrderMapper.toAddressRow(order({ province: "EG-C" }), "t1").province).toBe("EG-C");
    expect(OrderMapper.toAddressRow(order(), "t1").province).toBeNull();
  });

  it("reads the province back from the row, and an older row without the column as none", () => {
    const withProvince = order({ province: "EG-GZ" });
    expect(roundTrip(withProvince).shippingAddress.province).toBe("EG-GZ");

    const oldRow = { ...OrderMapper.toAddressRow(order(), "t1") } as Record<string, unknown>;
    delete oldRow["province"];
    const back = OrderMapper.toDomain(
      { ...OrderMapper.toOrderRow(order(), "t1"), version: 1 } as never,
      OrderMapper.toItemRows(order(), "t1"),
      OrderMapper.toEventRows(order(), "t1"),
      oldRow as never,
    );
    expect(back.shippingAddress.province).toBeUndefined();
  });

  it("keeps the province on the billing address JSON too", () => {
    const row = OrderMapper.toOrderRow(order({ province: "EG-C" }), "t1");

    expect(row.billingAddress).toMatchObject({ province: "EG-C" });
    expect(roundTrip(order({ province: "EG-C" })).billingAddress?.province).toBe("EG-C");
  });

  it("round-trips taxIncluded and the shipping rate's name in the totals JSON", () => {
    const o = order({ taxIncluded: true, shippingName: "Standard" });

    expect(OrderMapper.toOrderRow(o, "t1").totals).toMatchObject({
      taxIncluded: true,
      shippingName: "Standard",
    });
    expect(roundTrip(o).totals).toMatchObject({ taxIncluded: true, shippingName: "Standard" });
  });

  it("reads totals saved before 3C as tax added to the total, with no rate name", () => {
    const o = order();
    const row = OrderMapper.toOrderRow(o, "t1");
    const {
      taxIncluded: _flag,
      shippingName: _name,
      ...legacy
    } = row.totals as Record<string, unknown>;

    const back = OrderMapper.toDomain(
      { ...row, totals: legacy, version: 1 } as never,
      OrderMapper.toItemRows(o, "t1"),
      OrderMapper.toEventRows(o, "t1"),
      OrderMapper.toAddressRow(o, "t1"),
    );

    expect(back.totals?.taxIncluded).toBe(false);
    expect(back.totals?.shippingName).toBeUndefined();
  });
});

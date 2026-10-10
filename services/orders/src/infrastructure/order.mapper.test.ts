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

function orderWithLines(): Order {
  const price = must(Money.create(12000, "EGP"));
  const variantLine = OrderItem.create(
    UniqueEntityId.from("item-1"),
    must(
      ProductSnapshot.create("p-shirt", "Shirt", price, {
        variantRef: "v-l",
        sku: "SHIRT-L",
        variantTitle: "L",
      }),
    ),
    1,
  );
  const legacyLine = OrderItem.create(
    UniqueEntityId.from("item-2"),
    must(ProductSnapshot.create("p-mug", "Mug", must(Money.create(5000, "EGP")))),
    1,
  );
  return Order.place(
    UniqueEntityId.from("order-1"),
    must(OrderNumber.create("ORD-1")),
    "customer-1",
    "EGP",
    [variantLine, legacyLine],
    must(AddressSnapshot.create("1 Main St", "Cairo", "11511", "EG")),
    "evt-1",
    new Date(0),
  );
}

describe("OrderMapper — variant lines (Plan 2A)", () => {
  it("writes the three nullable columns: values for a variant line, null for a legacy line", () => {
    const rows = OrderMapper.toItemRows(orderWithLines(), "t1");
    expect(rows[0]).toMatchObject({ variantRef: "v-l", sku: "SHIRT-L", variantTitle: "L" });
    expect(rows[1]).toMatchObject({ variantRef: null, sku: null, variantTitle: null });
  });

  it("round-trips both kinds of line through the row shape", () => {
    const order = orderWithLines();
    const back = OrderMapper.toDomain(
      { ...OrderMapper.toOrderRow(order, "t1"), version: 1 },
      OrderMapper.toItemRows(order, "t1"),
      OrderMapper.toEventRows(order, "t1"),
      OrderMapper.toAddressRow(order, "t1"),
    );
    expect(
      back.items.map((i) => [
        i.snapshot.name,
        i.snapshot.variantRef,
        i.snapshot.sku,
        i.snapshot.variantTitle,
      ]),
    ).toEqual([
      ["Shirt", "v-l", "SHIRT-L", "L"],
      ["Mug", undefined, undefined, undefined],
    ]);
  });

  it("reads a row written before the columns existed (no keys at all) as a legacy line", () => {
    const order = orderWithLines();
    const legacyRows = OrderMapper.toItemRows(order, "t1").map(
      ({ variantRef: _v, sku: _s, variantTitle: _t, ...rest }) => rest,
    );
    const back = OrderMapper.toDomain(
      { ...OrderMapper.toOrderRow(order, "t1"), version: 1 },
      legacyRows,
      OrderMapper.toEventRows(order, "t1"),
      OrderMapper.toAddressRow(order, "t1"),
    );
    expect(back.items[0]?.snapshot.variantRef).toBeUndefined();
  });
});

function orderWithRecipient(): Order {
  const recipient = must(
    AddressSnapshot.create("1 Main St", "Cairo", "", "EG", {
      recipientName: "Mona Ali",
      phone: "+201012345678",
      line2: "Flat 4",
    }),
  );
  return Order.createFromCheckout(
    UniqueEntityId.from("order-2"),
    must(OrderNumber.create("ORD-2")),
    "customer-1",
    "EGP",
    [
      OrderItem.create(
        UniqueEntityId.from("item-3"),
        must(ProductSnapshot.create("p-mug", "Mug", must(Money.create(5000, "EGP")))),
        1,
      ),
    ],
    recipient,
    recipient,
    OrderTotalsSnapshot.create({
      subtotalMinor: 5000,
      taxMinor: 0,
      shippingMinor: 0,
      discountMinor: 0,
      totalMinor: 5000,
      currency: "EGP",
    }),
    "checkout-1",
    "evt-2",
    new Date(0),
  );
}

describe("OrderMapper — recipient name, phone and line 2 (Plan 3A)", () => {
  it("writes the three columns on the shipping address row", () => {
    expect(OrderMapper.toAddressRow(orderWithRecipient(), "t1")).toMatchObject({
      recipientName: "Mona Ali",
      phone: "+201012345678",
      line2: "Flat 4",
      postalCode: "",
    });
  });

  it("carries the same three keys in the billing address JSON", () => {
    expect(OrderMapper.toOrderRow(orderWithRecipient(), "t1").billingAddress).toMatchObject({
      recipientName: "Mona Ali",
      phone: "+201012345678",
      line2: "Flat 4",
    });
  });

  it("writes null for all three when the address has none", () => {
    expect(OrderMapper.toAddressRow(orderWithLines(), "t1")).toMatchObject({
      recipientName: null,
      phone: null,
      line2: null,
    });
  });

  it("round-trips the shipping and billing recipient through the row shapes", () => {
    const order = orderWithRecipient();
    const back = OrderMapper.toDomain(
      { ...OrderMapper.toOrderRow(order, "t1"), version: 1 },
      OrderMapper.toItemRows(order, "t1"),
      OrderMapper.toEventRows(order, "t1"),
      OrderMapper.toAddressRow(order, "t1"),
    );
    for (const address of [back.shippingAddress, back.billingAddress]) {
      expect(address?.recipientName).toBe("Mona Ali");
      expect(address?.phone).toBe("+201012345678");
      expect(address?.line2).toBe("Flat 4");
    }
  });

  it("reads an order placed before this plan (all three columns null) unchanged", () => {
    const order = orderWithLines();
    const legacyAddress = {
      ...OrderMapper.toAddressRow(order, "t1"),
      recipientName: null,
      phone: null,
      line2: null,
    };
    const back = OrderMapper.toDomain(
      { ...OrderMapper.toOrderRow(order, "t1"), version: 1 },
      OrderMapper.toItemRows(order, "t1"),
      OrderMapper.toEventRows(order, "t1"),
      legacyAddress,
    );
    expect(back.shippingAddress.recipientName).toBeUndefined();
    expect(back.shippingAddress.phone).toBeUndefined();
    expect(back.shippingAddress.line2).toBeUndefined();
    expect(back.shippingAddress.line1).toBe("1 Main St");
  });

  it("reads a legacy billing JSON that has none of the three keys", () => {
    const order = orderWithLines();
    const back = OrderMapper.toDomain(
      {
        ...OrderMapper.toOrderRow(order, "t1"),
        version: 1,
        billingAddress: { line1: "2 Side St", city: "Giza", postalCode: "12511", country: "EG" },
      },
      OrderMapper.toItemRows(order, "t1"),
      OrderMapper.toEventRows(order, "t1"),
      OrderMapper.toAddressRow(order, "t1"),
    );
    expect(back.billingAddress?.line1).toBe("2 Side St");
    expect(back.billingAddress?.phone).toBeUndefined();
  });
});

function orderWithShippingMethod(shippingMethod?: string): Order {
  const address = must(AddressSnapshot.create("1 Main St", "Cairo", "", "EG"));
  return Order.createFromCheckout(
    UniqueEntityId.from("order-3"),
    must(OrderNumber.create("1001")),
    "customer-1",
    "EGP",
    [
      OrderItem.create(
        UniqueEntityId.from("item-4"),
        must(ProductSnapshot.create("p-mug", "Mug", must(Money.create(5000, "EGP")))),
        1,
      ),
    ],
    address,
    address,
    OrderTotalsSnapshot.create({
      subtotalMinor: 5000,
      taxMinor: 0,
      shippingMinor: 3000,
      discountMinor: 0,
      totalMinor: 8000,
      currency: "EGP",
      ...(shippingMethod === undefined ? {} : { shippingMethod }),
    }),
    "checkout-3",
    "evt-3",
    new Date(0),
  );
}

describe("OrderMapper — shipping method in the totals JSON (Plan 3B)", () => {
  it("writes the selected shipping method into the totals JSON (no migration: it is a JSON key)", () => {
    expect(OrderMapper.toOrderRow(orderWithShippingMethod("standard"), "t1").totals).toMatchObject({
      shippingMinor: 3000,
      shippingMethod: "standard",
    });
  });

  it("round-trips the shipping method", () => {
    const order = orderWithShippingMethod("express");
    const back = OrderMapper.toDomain(
      { ...OrderMapper.toOrderRow(order, "t1"), version: 1 },
      OrderMapper.toItemRows(order, "t1"),
      OrderMapper.toEventRows(order, "t1"),
      OrderMapper.toAddressRow(order, "t1"),
    );
    expect(back.totals?.shippingMethod).toBe("express");
  });

  it("reads totals written before the key existed as having no shipping method", () => {
    const order = orderWithShippingMethod();
    const row = OrderMapper.toOrderRow(order, "t1");
    const legacyTotals = { ...row.totals } as Record<string, unknown>;
    delete legacyTotals["shippingMethod"];
    const back = OrderMapper.toDomain(
      { ...row, totals: legacyTotals as unknown as NonNullable<typeof row.totals>, version: 1 },
      OrderMapper.toItemRows(order, "t1"),
      OrderMapper.toEventRows(order, "t1"),
      OrderMapper.toAddressRow(order, "t1"),
    );
    expect(back.totals?.shippingMethod).toBeUndefined();
    expect(back.totals?.totalMinor).toBe(8000);
  });

  it("an order with no shipping method writes no key at all", () => {
    const totals = OrderMapper.toOrderRow(orderWithShippingMethod(), "t1").totals;
    expect(totals).not.toBeNull();
    expect(Object.keys(totals ?? {})).not.toContain("shippingMethod");
  });
});

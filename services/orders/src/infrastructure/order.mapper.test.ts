import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { Order } from "../domain/order";
import { OrderItem } from "../domain/order-item";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
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

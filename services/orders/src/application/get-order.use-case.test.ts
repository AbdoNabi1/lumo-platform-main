import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { Order } from "../domain/order";
import { OrderItem } from "../domain/order-item";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import { GetOrder } from "./get-order.use-case";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function order(): Order {
  const snapshot = must(
    ProductSnapshot.create("product-1", "Widget", must(Money.create(1000, "USD"))),
  );
  const item = OrderItem.create(UniqueEntityId.from("item-1"), snapshot, 1);
  const address = must(AddressSnapshot.create("1 Main St", "Springfield", "00000", "US"));
  return Order.place(
    UniqueEntityId.from("order-1"),
    must(OrderNumber.create("ORD-1")),
    "customer-1",
    "USD",
    [item],
    address,
    "evt-1",
    new Date(0),
  );
}

const notListed = async () => {
  throw new Error("list() not used by GetOrder");
};

describe("GetOrder", () => {
  it("returns the order when found", async () => {
    const repo = { findById: async () => order(), save: async () => {}, list: notListed };
    const useCase = new GetOrder({ orders: repo });
    const result = await useCase.execute({ orderId: "order-1" });
    expect(result.ok).toBe(true);
  });

  it("returns 404 when not found", async () => {
    const repo = { findById: async () => null, save: async () => {}, list: notListed };
    const useCase = new GetOrder({ orders: repo });
    const result = await useCase.execute({ orderId: "missing" });
    expect(result.ok).toBe(false);
  });
});

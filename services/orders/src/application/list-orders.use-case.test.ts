import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import type { Paginated } from "@platform/types";
import { Order } from "../domain/order";
import { OrderItem } from "../domain/order-item";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import { ListOrders } from "./list-orders.use-case";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function order(id: string): Order {
  const snapshot = must(
    ProductSnapshot.create("product-1", "Widget", must(Money.create(1000, "USD"))),
  );
  const item = OrderItem.create(UniqueEntityId.from("item-1"), snapshot, 1);
  const address = must(AddressSnapshot.create("1 Main St", "Springfield", "00000", "US"));
  return Order.place(
    UniqueEntityId.from(id),
    must(OrderNumber.create(`ORD-${id}`)),
    "customer-1",
    "USD",
    [item],
    address,
    "evt-1",
    new Date(0),
  );
}

const notCalled = async (): Promise<never> => {
  throw new Error("unexpected repository call");
};

describe("ListOrders", () => {
  it("returns an empty page as-is", async () => {
    const empty: Paginated<Order> = {
      items: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
    const repo = { findById: notCalled, save: notCalled, list: async () => empty };
    const useCase = new ListOrders({ orders: repo });

    const result = await useCase.execute({ tenantId: "tenant-a" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(empty);
  });

  it("passes the cursor page input straight through to the repository", async () => {
    const page: Paginated<Order> = {
      items: [order("order-1"), order("order-2")],
      pageInfo: { hasNextPage: true, endCursor: "order-2" },
    };
    let received: unknown;
    const repo = {
      findById: notCalled,
      save: notCalled,
      list: async (input: unknown) => {
        received = input;
        return page;
      },
    };
    const useCase = new ListOrders({ orders: repo });

    const result = await useCase.execute({ tenantId: "tenant-a", first: 2, after: "order-0" });
    expect(result.ok).toBe(true);
    expect(received).toEqual({ first: 2, after: "order-0" });
  });

  it("does not swallow a persistence failure — it propagates for the transport to map", async () => {
    const repo = {
      findById: notCalled,
      save: notCalled,
      list: async () => {
        throw new Error("connection reset");
      },
    };
    const useCase = new ListOrders({ orders: repo });

    await expect(useCase.execute({ tenantId: "tenant-a" })).rejects.toThrow("connection reset");
  });
});

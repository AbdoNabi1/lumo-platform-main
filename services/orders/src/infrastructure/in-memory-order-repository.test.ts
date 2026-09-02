import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Order } from "../domain/order";
import { OrderItem } from "../domain/order-item";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import { OrderEventTranslator } from "./order-event-translator";
import { InMemoryOrderRepository } from "./in-memory-order-repository";

function unwrap<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok || result.value === undefined) throw new Error("test setup: invalid VO");
  return result.value;
}

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

describe("InMemoryOrderRepository.list", () => {
  function wire() {
    const nextId = monotonicIds();
    const outboxStore = new InMemoryOutboxStore();
    const outbox = new OutboxWriter({
      store: outboxStore,
      translator: new OrderEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date("2026-07-05T00:00:00.000Z") },
      producer: "orders",
    });
    const context = rootEventContext({ generate: nextId });
    const repository = new InMemoryOrderRepository({ outbox, context });
    return { repository, nextId };
  }

  function placeOrder(
    nextId: () => string,
    overrides: { readonly customerRef?: string; readonly orderNumber?: string } = {},
  ): Order {
    const unitPrice = unwrap(Money.create(1999, "USD"));
    const snapshot = unwrap(ProductSnapshot.create(nextId(), "Toy Wagon", unitPrice));
    const item = OrderItem.create(UniqueEntityId.from(nextId()), snapshot, 1);
    return Order.place(
      UniqueEntityId.from(nextId()),
      unwrap(OrderNumber.create(overrides.orderNumber ?? `ORD-${nextId()}`)),
      overrides.customerRef ?? "customer-1",
      "USD",
      [item],
      unwrap(AddressSnapshot.create("1 Main St", "Town", "12345", "US")),
      nextId(),
      new Date(0),
    );
  }

  it("returns an empty page when no orders have been saved", async () => {
    const { repository } = wire();
    const page = await repository.list({});
    expect(page).toEqual({ items: [], pageInfo: { hasNextPage: false, endCursor: null } });
  });

  it("pages most-recently-saved first", async () => {
    const { repository, nextId } = wire();
    const first = placeOrder(nextId);
    await repository.save(first);
    const second = placeOrder(nextId);
    await repository.save(second);
    const third = placeOrder(nextId);
    await repository.save(third);

    const page1 = await repository.list({ first: 2 });
    expect(page1.items.map((o) => o.id.toString())).toEqual([
      third.id.toString(),
      second.id.toString(),
    ]);
    expect(page1.pageInfo.hasNextPage).toBe(true);

    const page2 = await repository.list({ first: 2, after: page1.pageInfo.endCursor ?? undefined });
    expect(page2.items.map((o) => o.id.toString())).toEqual([first.id.toString()]);
    expect(page2.pageInfo.hasNextPage).toBe(false);
  });

  it("filters by status", async () => {
    const { repository, nextId } = wire();
    const placed = placeOrder(nextId);
    await repository.save(placed);
    const paidOrder = placeOrder(nextId);
    paidOrder.markPaid("payment-ref", nextId(), new Date(1));
    await repository.save(paidOrder);

    const page = await repository.list({ status: "paid" });
    expect(page.items.map((o) => o.id.toString())).toEqual([paidOrder.id.toString()]);
  });

  it("filters by search, matching order number or customer ref (case-insensitive)", async () => {
    const { repository, nextId } = wire();
    const target = placeOrder(nextId, {
      customerRef: "customer-target",
      orderNumber: "ORD-FINDME",
    });
    await repository.save(target);
    const other = placeOrder(nextId, { customerRef: "customer-other", orderNumber: "ORD-OTHER" });
    await repository.save(other);

    const byOrderNumber = await repository.list({ search: "findme" });
    expect(byOrderNumber.items.map((o) => o.id.toString())).toEqual([target.id.toString()]);

    const byCustomerRef = await repository.list({ search: "TARGET" });
    expect(byCustomerRef.items.map((o) => o.id.toString())).toEqual([target.id.toString()]);

    const noMatch = await repository.list({ search: "nonexistent" });
    expect(noMatch.items).toEqual([]);
  });
});

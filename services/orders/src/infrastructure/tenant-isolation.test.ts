import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { Order } from "../domain/order";
import { OrderItem } from "../domain/order-item";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import { InMemoryOrderRepository } from "./in-memory-order-repository";
import { InMemoryInventoryAdapter, InMemoryShippingAdapter } from "./in-memory-port-adapters";
import { OrderEventTranslator } from "./order-event-translator";

/** ADR-0014 (WP-10, T10.3): one Orders repository / port stub serves every tenant. */
function unwrap<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok || result.value === undefined) throw new Error("test setup: invalid VO");
  return result.value;
}

function placeOrder(id: string): Order {
  const snapshot = unwrap(
    ProductSnapshot.create("product-1", "Toy", unwrap(Money.create(500, "USD"))),
  );
  return Order.place(
    UniqueEntityId.from(id),
    unwrap(OrderNumber.create("ORD-1")),
    "customer-1",
    "USD",
    [OrderItem.create(UniqueEntityId.from("item-1"), snapshot, 1)],
    unwrap(AddressSnapshot.create("1 Main St", "Town", "12345", "US")),
    "evt-1",
    new Date(0),
  );
}

function repository(outbox?: OutboxWriter) {
  const writer =
    outbox ??
    new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new OrderEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "orders",
    });
  return new InMemoryOrderRepository({
    outbox: writer,
    context: rootEventContext({ generate: () => "evt-x" }),
  });
}

describe("orders tenant isolation (ADR-0014)", () => {
  it("two tenants sharing one repository and an identical order id never see each other's orders", async () => {
    const repo = repository();
    await repo.save(placeOrder("order-1"), "tenant-a");

    expect(await repo.findById("order-1", "tenant-b")).toBeNull();
    expect((await repo.list({ first: 10 }, "tenant-b")).items).toHaveLength(0);
    expect((await repo.list({ first: 10 }, "tenant-a")).items).toHaveLength(1);
  });

  it("the offline reservation/shipment stubs dedupe per (tenant, order), not per order alone", async () => {
    const inventory = new InMemoryInventoryAdapter();
    const shipping = new InMemoryShippingAdapter();

    const a = await inventory.requestReservation("order-1", "tenant-a");
    const b = await inventory.requestReservation("order-1", "tenant-b");
    const aAgain = await inventory.requestReservation("order-1", "tenant-a");
    const sa = await shipping.requestShipment("order-1", "tenant-a");
    const sb = await shipping.requestShipment("order-1", "tenant-b");

    expect(b.reservationRef).not.toBe(a.reservationRef);
    expect(aAgain).toEqual(a);
    expect(sb.shipmentRef).not.toBe(sa.shipmentRef);
  });

  it("merges the per-call tenantId into the outbox event context at write time", async () => {
    await assertWriteTimeTenant("orders", async (outbox, tenantId) => {
      await repository(outbox).save(placeOrder("order-1"), tenantId);
    });
  });
});

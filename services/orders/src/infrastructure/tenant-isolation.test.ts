import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import {
  assertWriteTimeTenant,
  tenantRowIsolationCases,
  type TenantRowStore,
} from "@platform/messaging/testing";
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

function placeOrder(id: string, customerRef = "customer-1"): Order {
  const snapshot = unwrap(
    ProductSnapshot.create("product-1", "Toy", unwrap(Money.create(500, "USD"))),
  );
  return Order.place(
    UniqueEntityId.from(id),
    unwrap(OrderNumber.create("ORD-1")),
    customerRef,
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

// ── T10.5 row isolation (shared harness) ─────────────────────────────────────────────────────────
// Orders: money and PII. In-memory adapter ONLY — the Prisma repository reads through `include`
// (items/events relations) which the fake-prisma does not model, so its tenant scoping is covered
// solely by the DATABASE_URL_TEST-gated integration suite (which does not run in CI here). That is
// a stated coverage limit of this case, recorded in the gap register.
function orderStore(): TenantRowStore {
  const repo = repository();
  return {
    insert: (tenantId, key, marker) => repo.save(placeOrder(key, marker), tenantId),
    find: async (tenantId, key) => (await repo.findById(key, tenantId))?.customerRef ?? null,
    list: async (tenantId) =>
      (await repo.list({ first: 100 }, tenantId)).items.map((order) => order.customerRef),
    // The attacker addresses the victim's order id under its own tenant.
    update: (tenantId, key, marker) => repo.save(placeOrder(key, marker), tenantId),
  };
}

describe("orders tenant isolation via the shared harness (T10.5)", () => {
  for (const c of tenantRowIsolationCases({
    context: "orders/order",
    layer: "in-memory adapter (Prisma: integration suite only)",
    make: orderStore,
  }))
    it(c.name, c.run);
});

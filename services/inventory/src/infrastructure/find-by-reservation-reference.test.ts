import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@platform/contracts";
import { ProductRef, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { InventoryItem } from "../domain/inventory-item";
import { Quantity } from "../domain/value-objects/quantity";
import { WarehouseId } from "../domain/value-objects/warehouse-id";
import { InventoryEventTranslator } from "./inventory-event-translator";
import { InMemoryInventoryItemRepository } from "./in-memory-inventory-item-repository";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function buildRepo(): InMemoryInventoryItemRepository {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new InventoryEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-07-26T00:00:00.000Z") },
    producer: "inventory",
  });
  return new InMemoryInventoryItemRepository({
    outbox,
    context: rootEventContext(sequentialIds()),
  });
}

// Sprint A0 precondition scaffolding for A3's saga-activity idempotency — dormant until A3 wires a
// use case to call it, but exercised here so the port + adapters are proven correct now.
describe("InventoryItemRepository.findByReservationReference (Sprint A0 precondition)", () => {
  it("finds the item owning a reservation with the matching (itemId, reference)", async () => {
    const repo = buildRepo();
    const item = InventoryItem.create(
      UniqueEntityId.from("item-1"),
      must(ProductRef.create("product-1")),
      must(WarehouseId.create("wh-1")),
    );
    item.receive(must(Quantity.create(10)), "evt-receive", new Date("2026-07-26T00:00:00.000Z"));
    item.reserve(
      UniqueEntityId.from("res-1"),
      must(Quantity.create(3)),
      "order-42",
      "evt-reserve",
      new Date("2026-07-26T00:00:00.000Z"),
    );
    await repo.save(item);

    const found = await repo.findByReservationReference("item-1", "order-42");
    expect(found?.id.toString()).toBe("item-1");

    expect(await repo.findByReservationReference("item-1", "order-does-not-exist")).toBeNull();
    expect(await repo.findByReservationReference("item-does-not-exist", "order-42")).toBeNull();
  });
});

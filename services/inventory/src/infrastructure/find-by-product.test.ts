import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@platform/contracts";
import { ProductRef, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { InventoryItem } from "../domain/inventory-item";
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
    clock: { now: () => new Date("2026-08-15T00:00:00.000Z") },
    producer: "inventory",
  });
  return new InMemoryInventoryItemRepository({
    outbox,
    context: rootEventContext(sequentialIds()),
  });
}

// Phase A.30 admin Products screen — "stock by product, across every warehouse".
describe("InventoryItemRepository.findByProduct", () => {
  it("returns every warehouse's item for the product, and none of another product's", async () => {
    const repo = buildRepo();
    const productA = must(ProductRef.create("product-a"));
    const productB = must(ProductRef.create("product-b"));

    const itemA1 = InventoryItem.create(
      UniqueEntityId.from("item-a1"),
      productA,
      must(WarehouseId.create("wh-1")),
    );
    const itemA2 = InventoryItem.create(
      UniqueEntityId.from("item-a2"),
      productA,
      must(WarehouseId.create("wh-2")),
    );
    const itemB1 = InventoryItem.create(
      UniqueEntityId.from("item-b1"),
      productB,
      must(WarehouseId.create("wh-1")),
    );
    await repo.save(itemA1);
    await repo.save(itemA2);
    await repo.save(itemB1);

    const found = await repo.findByProduct("product-a");
    expect(found.map((item) => item.id.toString()).sort()).toEqual(["item-a1", "item-a2"]);
  });

  it("returns an empty array when the product has no stock rows anywhere", async () => {
    const repo = buildRepo();
    expect(await repo.findByProduct("no-such-product")).toEqual([]);
  });
});

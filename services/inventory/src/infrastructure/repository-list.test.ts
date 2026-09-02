import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@platform/contracts";
import { ProductRef, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { InventoryItem } from "../domain/inventory-item";
import { Warehouse } from "../domain/warehouse";
import { WarehouseId } from "../domain/value-objects/warehouse-id";
import { InMemoryInventoryItemRepository } from "./in-memory-inventory-item-repository";
import { InMemoryWarehouseRepository } from "./in-memory-warehouse-repository";
import { InventoryEventTranslator } from "./inventory-event-translator";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function outboxWriter() {
  return new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new InventoryEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date(0) },
    producer: "inventory",
  });
}

describe("InventoryItemRepository.list (cursor pagination contract, Sprint 7.0)", () => {
  it("pages through items and reports hasNextPage/endCursor", async () => {
    const repo = new InMemoryInventoryItemRepository({
      outbox: outboxWriter(),
      context: rootEventContext(sequentialIds()),
    });

    for (let i = 0; i < 5; i += 1) {
      const item = InventoryItem.create(
        UniqueEntityId.from(`item-${i}`),
        must(ProductRef.create(`product-${i}`)),
        must(WarehouseId.create("wh-1")),
      );
      await repo.save(item);
    }

    const firstPage = await repo.list({ first: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.pageInfo.hasNextPage).toBe(true);
    expect(firstPage.pageInfo.endCursor).not.toBeNull();

    const secondPage = await repo.list({
      first: 2,
      after: firstPage.pageInfo.endCursor ?? undefined,
    });
    expect(secondPage.items).toHaveLength(2);
    expect(secondPage.pageInfo.hasNextPage).toBe(true);

    const thirdPage = await repo.list({
      first: 2,
      after: secondPage.pageInfo.endCursor ?? undefined,
    });
    expect(thirdPage.items).toHaveLength(1);
    expect(thirdPage.pageInfo.hasNextPage).toBe(false);
  });
});

describe("WarehouseRepository.list (cursor pagination contract, Sprint 7.0)", () => {
  it("pages through warehouses and reports hasNextPage/endCursor", async () => {
    const repo = new InMemoryWarehouseRepository({
      outbox: outboxWriter(),
      context: rootEventContext(sequentialIds()),
    });

    for (let i = 0; i < 3; i += 1) {
      const warehouse = Warehouse.register(
        UniqueEntityId.from(`wh-${i}`),
        `CODE-${i}`,
        `Warehouse ${i}`,
        `evt-${i}`,
        new Date(0),
      );
      await repo.save(warehouse);
    }

    const firstPage = await repo.list({ first: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.pageInfo.hasNextPage).toBe(true);

    const secondPage = await repo.list({
      first: 2,
      after: firstPage.pageInfo.endCursor ?? undefined,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.pageInfo.hasNextPage).toBe(false);
  });
});

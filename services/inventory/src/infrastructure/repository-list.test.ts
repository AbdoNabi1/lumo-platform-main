import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@platform/contracts";
import { ProductRef, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { InventoryItem } from "../domain/inventory-item";
import { Quantity } from "../domain/value-objects/quantity";
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
      await repo.save(item, "tenant-a");
    }

    const firstPage = await repo.list({ first: 2 }, "tenant-a");
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.pageInfo.hasNextPage).toBe(true);
    expect(firstPage.pageInfo.endCursor).not.toBeNull();

    const secondPage = await repo.list(
      {
        first: 2,
        after: firstPage.pageInfo.endCursor ?? undefined,
      },
      "tenant-a",
    );
    expect(secondPage.items).toHaveLength(2);
    expect(secondPage.pageInfo.hasNextPage).toBe(true);

    const thirdPage = await repo.list(
      {
        first: 2,
        after: secondPage.pageInfo.endCursor ?? undefined,
      },
      "tenant-a",
    );
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
      await repo.save(warehouse, "tenant-a");
    }

    const firstPage = await repo.list({ first: 2 }, "tenant-a");
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.pageInfo.hasNextPage).toBe(true);

    const secondPage = await repo.list(
      {
        first: 2,
        after: firstPage.pageInfo.endCursor ?? undefined,
      },
      "tenant-a",
    );
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.pageInfo.hasNextPage).toBe(false);
  });
});

// ADR-0014 (WP-10, T10.3): one instance of each in-memory repository serves every tenant.
describe("inventory repositories tenant isolation (ADR-0014)", () => {
  function newItem(id = "item-1"): InventoryItem {
    return InventoryItem.create(
      UniqueEntityId.from(id),
      must(ProductRef.create("product-1")),
      must(WarehouseId.create("wh-1")),
    );
  }

  function newWarehouse(id = "wh-1"): Warehouse {
    return Warehouse.register(UniqueEntityId.from(id), "CODE-1", "Main", "evt-1", new Date(0));
  }

  it("two tenants sharing one item repository and identical ids never see each other's rows", async () => {
    const repo = new InMemoryInventoryItemRepository({
      outbox: outboxWriter(),
      context: rootEventContext(sequentialIds()),
    });
    await repo.save(newItem(), "tenant-a");

    expect(await repo.findById("item-1", "tenant-b")).toBeNull();
    expect(await repo.findByProduct("product-1", "tenant-b")).toEqual([]);
    expect(await repo.findByProductAndWarehouse("product-1", "wh-1", "tenant-b")).toBeNull();
    expect((await repo.list({ first: 10 }, "tenant-b")).items).toHaveLength(0);

    await repo.save(newItem(), "tenant-b");
    expect((await repo.list({ first: 10 }, "tenant-a")).items).toHaveLength(1);
    expect((await repo.list({ first: 10 }, "tenant-b")).items).toHaveLength(1);
  });

  it("two tenants sharing one warehouse repository never see each other's warehouses or codes", async () => {
    const repo = new InMemoryWarehouseRepository({
      outbox: outboxWriter(),
      context: rootEventContext(sequentialIds()),
    });
    await repo.save(newWarehouse(), "tenant-a");

    expect(await repo.findById("wh-1", "tenant-b")).toBeNull();
    expect(await repo.findByCode("CODE-1", "tenant-b")).toBeNull();
    expect((await repo.list({ first: 10 }, "tenant-b")).items).toHaveLength(0);
  });

  it("merges the per-call tenantId into the outbox event context at write time", async () => {
    await assertWriteTimeTenant("inventory (items)", async (outbox, tenantId) => {
      const repo = new InMemoryInventoryItemRepository({
        outbox,
        context: rootEventContext(sequentialIds()),
      });
      const item = newItem();
      item.receive(must(Quantity.create(5)), "evt-receive", new Date(0));
      await repo.save(item, tenantId);
    });
    await assertWriteTimeTenant("inventory (warehouses)", async (outbox, tenantId) => {
      const repo = new InMemoryWarehouseRepository({
        outbox,
        context: rootEventContext(sequentialIds()),
      });
      await repo.save(newWarehouse(), tenantId);
    });
  });
});

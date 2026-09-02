import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { ProductRef, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import { InventoryItem } from "../domain/inventory-item";
import { Quantity } from "../domain/value-objects/quantity";
import { WarehouseId } from "../domain/value-objects/warehouse-id";
import { InventoryEventTranslator } from "./inventory-event-translator";
import { PrismaInventoryItemRepository } from "./prisma-inventory-item-repository";

/**
 * Phase A.22 (Task 10) — real PostgreSQL integration coverage for Inventory, selected as a
 * highest-risk context per the Task 9 inventory (the write-hot stock-reservation path; oversell
 * is a direct production-risk failure mode) that previously had zero `*.integration.test.ts`
 * coverage. Follows the same reference pattern as
 * `services/orders/src/infrastructure/prisma-order-repository.integration.test.ts`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/inventory test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

function unwrap<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok || result.value === undefined) throw new Error("test setup: invalid VO");
  return result.value;
}

describe.runIf(Boolean(databaseUrl))("PrismaInventoryItemRepository (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-14T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire(tenantId = "tenant-itest-inventory") {
    const prisma = createTestPrismaClient(databaseUrl);
    const outboxStore = new PrismaOutboxStore(prisma);
    const outbox = new OutboxWriter({
      store: outboxStore,
      translator: new InventoryEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "inventory",
    });
    const context = rootEventContext(ids, tenantId);
    const repository = new PrismaInventoryItemRepository({ prisma, outbox, context, tenantId });
    return { prisma, repository, unitOfWork: new PrismaUnitOfWork(prisma), outboxStore, tenantId };
  }

  function newItem(warehouse = "wh-main"): InventoryItem {
    const product = unwrap(ProductRef.create(crypto.randomUUID()));
    const warehouseId = unwrap(WarehouseId.create(warehouse));
    return InventoryItem.create(UniqueEntityId.from(ids.generate()), product, warehouseId);
  }

  it("round-trips the aggregate exactly: stock level, version", async () => {
    const { prisma, repository, unitOfWork } = wire();
    const item = newItem();
    item.receive(unwrap(Quantity.create(100)), ids.generate(), clock.now());

    await unitOfWork.run(async (tx) => repository.save(item, tx));
    const loaded = await repository.findById(item.id.toString());

    expect(loaded).not.toBeNull();
    expect(loaded?.stockLevel.onHand).toBe(100);
    expect(loaded?.stockLevel.reserved).toBe(0);
    expect(loaded?.version).toBe(1);
    await prisma.$disconnect();
  });

  it("writes the outbox row in the SAME transaction as the aggregate", async () => {
    // Queries the outbox row directly by key rather than through `fetchPending(100)`: `lumo_test`
    // accumulates pending rows across every integration suite run (C-08 — CDC never marks rows
    // published, so nothing prunes them), and `fetchPending` orders oldest-first, so a freshly
    // written row can fall outside a fixed-size page once the backlog exceeds it.
    const { prisma, repository, unitOfWork } = wire();
    const item = newItem();
    item.receive(unwrap(Quantity.create(50)), ids.generate(), clock.now());
    await unitOfWork.run(async (tx) => repository.save(item, tx));

    const rows = await prisma.outboxEntry.findMany({ where: { key: item.id.toString() } });
    expect(rows.length).toBeGreaterThan(0);
    await prisma.$disconnect();
  });

  it("enforces the (tenantId, productRef, warehouseId) unique constraint", async () => {
    const { prisma, tenantId } = wire();
    const productRef = crypto.randomUUID();

    await prisma.inventoryItem.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        productRef,
        warehouseId: "wh-dup-test",
        onHand: 10,
        reserved: 0,
      },
    });

    await expect(
      prisma.inventoryItem.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          productRef,
          warehouseId: "wh-dup-test",
          onHand: 5,
          reserved: 0,
        },
      }),
    ).rejects.toThrow();
    await prisma.$disconnect();
  });

  it("rejects a stale write with ConcurrencyError (no retry, no silent overwrite)", async () => {
    const { prisma, repository, unitOfWork } = wire();
    const item = newItem();
    item.receive(unwrap(Quantity.create(20)), ids.generate(), clock.now());
    await unitOfWork.run(async (tx) => repository.save(item, tx));

    const first = await repository.findById(item.id.toString());
    const second = await repository.findById(item.id.toString());
    if (first === null || second === null) throw new Error("setup failed");
    first.receive(unwrap(Quantity.create(5)), ids.generate(), clock.now());
    second.receive(unwrap(Quantity.create(7)), ids.generate(), clock.now());

    await unitOfWork.run(async (tx) => repository.save(first, tx));
    await expect(unitOfWork.run(async (tx) => repository.save(second, tx))).rejects.toBeInstanceOf(
      ConcurrencyError,
    );

    const reloaded = await repository.findById(item.id.toString());
    expect(reloaded?.stockLevel.onHand).toBe(25); // only the winner's +5 applied, not +7
    await prisma.$disconnect();
  });

  it("BEGIN/ROLLBACK: an aborted transaction leaves no trace in a fresh session", async () => {
    const { prisma, repository } = wire();
    const item = newItem();

    await expect(
      prisma.$transaction(async (tx) => {
        await repository.save(item, tx as unknown as Parameters<typeof repository.save>[1]);
        throw new Error("forced rollback");
      }),
    ).rejects.toThrow("forced rollback");

    const freshSession = createTestPrismaClient(databaseUrl);
    const found = await freshSession.inventoryItem.findUnique({
      where: { id: item.id.toString() },
    });
    expect(found).toBeNull();
    await freshSession.$disconnect();
    await prisma.$disconnect();
  });

  it("BEGIN/COMMIT: a committed transaction is durable in a fresh session", async () => {
    const { prisma, repository, unitOfWork } = wire();
    const item = newItem();
    await unitOfWork.run(async (tx) => repository.save(item, tx));

    const freshSession = createTestPrismaClient(databaseUrl);
    const found = await freshSession.inventoryItem.findUnique({
      where: { id: item.id.toString() },
    });
    expect(found).not.toBeNull();
    await freshSession.$disconnect();
    await prisma.$disconnect();
  });

  describe("concurrency: no oversell under real concurrent reservation attempts", () => {
    it("two sessions racing a reserve() against the same version: exactly one wins", async () => {
      const { prisma, repository, unitOfWork } = wire();
      const item = newItem();
      item.receive(unwrap(Quantity.create(10)), ids.generate(), clock.now());
      await unitOfWork.run(async (tx) => repository.save(item, tx));

      const sessionA = createTestPrismaClient(databaseUrl);
      const sessionB = createTestPrismaClient(databaseUrl);
      try {
        const [a, b] = await Promise.all([
          sessionA.inventoryItem.updateMany({
            where: { id: item.id.toString(), version: 1 },
            data: { reserved: { increment: 10 }, version: { increment: 1 } },
          }),
          sessionB.inventoryItem.updateMany({
            where: { id: item.id.toString(), version: 1 },
            data: { reserved: { increment: 10 }, version: { increment: 1 } },
          }),
        ]);
        const totalUpdated = a.count + b.count;
        expect(totalUpdated).toBe(1); // exactly one racing reservation applied — no double-reserve

        const final = await prisma.inventoryItem.findUnique({ where: { id: item.id.toString() } });
        expect(final?.reserved).toBe(10); // not 20 — no lost-update / no oversell
        expect(final?.version).toBe(2);
      } finally {
        await sessionA.$disconnect();
        await sessionB.$disconnect();
        await prisma.$disconnect();
      }
    });

    it("concurrent creation of the same (tenantId, productRef, warehouseId): exactly one succeeds", async () => {
      const { prisma, tenantId } = wire(`tenant-itest-concurrent-inv-${crypto.randomUUID()}`);
      const productRef = crypto.randomUUID();
      const sessionA = createTestPrismaClient(databaseUrl);
      const sessionB = createTestPrismaClient(databaseUrl);
      try {
        const attempt = (client: typeof sessionA) =>
          client.inventoryItem.create({
            data: {
              id: crypto.randomUUID(),
              tenantId,
              productRef,
              warehouseId: "wh-race",
              onHand: 1,
              reserved: 0,
            },
          });

        const results = await Promise.allSettled([attempt(sessionA), attempt(sessionB)]);
        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
      } finally {
        await sessionA.$disconnect();
        await sessionB.$disconnect();
        await prisma.$disconnect();
      }
    });
  });
});

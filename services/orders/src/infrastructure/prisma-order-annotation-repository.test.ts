import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import type { TransactionClient } from "@platform/db";
import { PrismaOrderAnnotationRepository } from "./prisma-order-annotation-repository";

const TENANT = "tenant-a";
const ORDER = "01900000-0000-7000-8000-00000000000a";
const FIRST = new Date("2026-07-01T00:00:00.000Z");
const SECOND = new Date("2026-07-02T00:00:00.000Z");

async function seeded(archivedAt: Date | null) {
  const fake = createFakePrisma();
  // fake-prisma has no column defaults: seed archivedAt explicitly.
  await fake.database.order.create({ data: { id: ORDER, tenantId: TENANT, archivedAt } as never });
  const repository = new PrismaOrderAnnotationRepository({ prisma: fake.database });
  const archivedAtNow = async () =>
    (await repository.annotationsOf([ORDER], TENANT, fake.database)).get(ORDER)?.archivedAt;
  return { fake, repository, archivedAtNow };
}

describe("PrismaOrderAnnotationRepository.setArchived (over fake-prisma)", () => {
  it("archives a live order once and reports it changed", async () => {
    const { fake, repository, archivedAtNow } = await seeded(null);
    expect(await repository.setArchived([ORDER], FIRST, TENANT, fake.database)).toEqual([ORDER]);
    expect(await archivedAtNow()).toEqual(FIRST);
  });

  it("archiving an already-archived order is a no-op: not changed, timestamp untouched", async () => {
    const { fake, repository, archivedAtNow } = await seeded(FIRST);
    expect(await repository.setArchived([ORDER], SECOND, TENANT, fake.database)).toEqual([]);
    expect(await archivedAtNow()).toEqual(FIRST);
  });

  it("unarchiving an order that is not archived is a no-op: not changed", async () => {
    const { fake, repository, archivedAtNow } = await seeded(null);
    expect(await repository.setArchived([ORDER], null, TENANT, fake.database)).toEqual([]);
    expect(await archivedAtNow()).toBeNull();
  });

  it("unarchives an archived order and reports it changed", async () => {
    const { fake, repository, archivedAtNow } = await seeded(FIRST);
    expect(await repository.setArchived([ORDER], null, TENANT, fake.database)).toEqual([ORDER]);
    expect(await archivedAtNow()).toBeNull();
  });

  it("a concurrent archive that lands first wins: ours reports unchanged and keeps its timestamp", async () => {
    const { fake, repository, archivedAtNow } = await seeded(null);
    // The other transaction commits between our read of the state and our write: the target-state
    // condition must live in the UPDATE itself, not in an earlier SELECT.
    const racing = new Proxy(fake.database, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (prop !== "order") return value;
        const order = value as { updateMany: (args: unknown) => Promise<unknown> };
        return new Proxy(order, {
          get(orderTarget, method, orderReceiver) {
            if (method !== "updateMany") return Reflect.get(orderTarget, method, orderReceiver);
            return async (args: unknown) => {
              await order.updateMany({ where: { id: ORDER }, data: { archivedAt: FIRST } });
              return order.updateMany(args);
            };
          },
        });
      },
    }) as unknown as TransactionClient;

    expect(await repository.setArchived([ORDER], SECOND, TENANT, racing)).toEqual([]);
    expect(await archivedAtNow()).toEqual(FIRST);
  });
});

import { describe, expect, it } from "vitest";
import type { TransactionClient } from "@platform/db";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { CatalogEventTranslator } from "./catalog-event-translator";
import { PrismaProductRepository } from "./prisma-catalog-repositories";

function repo() {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new CatalogEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-10-11T00:00:00.000Z") },
    producer: "catalog",
  });
  return new PrismaProductRepository({
    prisma: {} as never,
    outbox: outbox as never,
    context: rootEventContext({ generate: () => "id" }),
  });
}

describe("PrismaProductRepository.relabelCurrency (Plan 3C)", () => {
  it("updates only the calling tenant's variants that are not already in the currency", async () => {
    const calls: { where: unknown; data: unknown }[] = [];
    const tx = {
      productVariant: {
        updateMany: async (args: { where: unknown; data: unknown }) => {
          calls.push(args);
          return { count: 3 };
        },
      },
    } as unknown as TransactionClient;

    const changed = await repo().relabelCurrency("EGP", "tenant-a", tx);

    expect(changed).toBe(3);
    expect(calls).toEqual([
      { where: { tenantId: "tenant-a", NOT: { currency: "EGP" } }, data: { currency: "EGP" } },
    ]);
  });

  it("refuses to run outside a transaction", async () => {
    await expect(repo().relabelCurrency("EGP", "tenant-a")).rejects.toThrow();
  });
});

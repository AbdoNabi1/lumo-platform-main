import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaOutboxDeliveryQueue } from "./prisma-outbox-delivery-queue";

/**
 * No database: the queries themselves are the contract. `OutboxDeliveryQueue` requires that a row
 * waiting on a retry is excluded BEFORE the limit applies, and that every write touches only rows
 * still pending — both are properties of the WHERE clause, so that is what is pinned here.
 */
function fakePrisma(rows: unknown[] = []) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const updateMany = vi.fn().mockResolvedValue({ count: 0 });
  const prisma = { outboxEntry: { findMany, updateMany } } as unknown as PrismaClient;
  return { prisma, findMany, updateMany };
}

const NOW = "2026-09-30T12:00:00.000Z";

describe("PrismaOutboxDeliveryQueue", () => {
  it("takes only pending rows that are due, oldest first, filtering BEFORE the limit", async () => {
    const { prisma, findMany } = fakePrisma();

    await new PrismaOutboxDeliveryQueue(prisma).fetchDue(50, NOW);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: "pending",
        OR: [{ availableAt: null }, { availableAt: { lte: new Date(NOW) } }],
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
  });

  it("maps a row to the entry the relay delivers, with its failed-round count", async () => {
    const payload = new Uint8Array([1, 2, 3]);
    const { prisma } = fakePrisma([
      {
        id: "m1",
        topic: "orders.order.paid.v1",
        key: "order-1",
        contentType: "application/json",
        payload,
        headers: { messageId: "m1", tenantId: "t-1" },
        status: "pending",
        tenantId: "t-1",
        producer: "orders",
        createdAt: new Date("2026-09-30T11:00:00.000Z"),
        publishedAt: null,
        attempts: 2,
        availableAt: new Date("2026-09-30T11:59:00.000Z"),
      },
    ]);

    expect(await new PrismaOutboxDeliveryQueue(prisma).fetchDue(50, NOW)).toEqual([
      {
        entry: {
          id: "m1",
          topic: "orders.order.paid.v1",
          key: "order-1",
          contentType: "application/json",
          payload,
          headers: { messageId: "m1", tenantId: "t-1" },
          status: "pending",
          createdAt: "2026-09-30T11:00:00.000Z",
          publishedAt: null,
        },
        attempts: 2,
      },
    ]);
  });

  it("marks delivered only rows that are still pending", async () => {
    const { prisma, updateMany } = fakePrisma();

    await new PrismaOutboxDeliveryQueue(prisma).markDelivered(["m1", "m2"], NOW);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1", "m2"] }, status: "pending" },
      data: { status: "published", publishedAt: new Date(NOW) },
    });
  });

  it("sends no query for an empty id list", async () => {
    const { prisma, updateMany } = fakePrisma();

    await new PrismaOutboxDeliveryQueue(prisma).markDelivered([], NOW);

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("defers a row by recording the failed rounds and its next due time, leaving it pending", async () => {
    const { prisma, updateMany } = fakePrisma();

    await new PrismaOutboxDeliveryQueue(prisma).defer("m1", 3, "2026-09-30T12:02:00.000Z");

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "m1", status: "pending" },
      data: { attempts: 3, availableAt: new Date("2026-09-30T12:02:00.000Z") },
    });
  });
});

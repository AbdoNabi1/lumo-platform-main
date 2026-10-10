import type { Database, TransactionClient } from "@platform/db";
import type { OutboxWriter } from "@platform/messaging";
import { describe, expect, it, vi } from "vitest";
import { PrismaFulfillmentOrderRepository } from "./prisma-fulfillment-order-repository";

interface FindManyArgs {
  readonly where: { readonly tenantId?: string; readonly orderRef?: { readonly in: string[] } };
  readonly orderBy?: unknown;
}

function row(id: string, orderRef: string, status: string) {
  return {
    id,
    tenantId: "tenant-a",
    orderRef,
    items: [{ productRef: "product-1", quantity: 1 }],
    status,
    carrierReference: {},
    trackingNumber: null,
    packages: [],
    deliveredAt: null,
    version: 1,
    attempts: [],
  };
}

function repo() {
  return new PrismaFulfillmentOrderRepository({
    prisma: {} as unknown as Database,
    outbox: {} as unknown as OutboxWriter<TransactionClient>,
    context: {} as never,
  });
}

function txReturning(rows: ReturnType<typeof row>[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const tx = { fulfillmentOrder: { findMany } } as unknown as TransactionClient;
  return { tx, findMany };
}

describe("PrismaFulfillmentOrderRepository.findByOrderRefs", () => {
  it("reads every requested order in ONE query, scoped to the tenant", async () => {
    const { tx, findMany } = txReturning([row("fo-1", "order-1", "confirmed")]);

    await repo().findByOrderRefs(["order-1", "order-2", "order-3"], "tenant-a", tx);

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0]?.[0] as FindManyArgs;
    expect(args.where.tenantId).toBe("tenant-a");
    expect(args.where.orderRef).toEqual({ in: ["order-1", "order-2", "order-3"] });
  });

  it("returns the most recently opened fulfillment order per order, keyed by order ref", async () => {
    // Newest first, as the query orders them: the first row seen for an order ref wins.
    const { tx, findMany } = txReturning([
      row("fo-new", "order-1", "picking_started"),
      row("fo-old", "order-1", "cancelled"),
      row("fo-2", "order-2", "delivered"),
    ]);

    const found = await repo().findByOrderRefs(["order-1", "order-2"], "tenant-a", tx);

    expect((findMany.mock.calls[0]?.[0] as FindManyArgs).orderBy).toEqual({ createdAt: "desc" });
    expect(found.get("order-1")?.id.toString()).toBe("fo-new");
    expect(found.get("order-2")?.status.value).toBe("delivered");
    expect(found.size).toBe(2);
  });

  it("does not touch the database for an empty list", async () => {
    const { tx, findMany } = txReturning([]);

    const found = await repo().findByOrderRefs([], "tenant-a", tx);

    expect(found.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});

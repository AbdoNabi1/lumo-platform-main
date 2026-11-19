import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { beforeEach, describe, expect, it } from "vitest";
import { PrismaShipmentRepository } from "./prisma-shipment-repository";

type Args = Record<string, unknown>;

const ROW = {
  id: "019a0000-0000-7000-8000-000000000001",
  tenantId: "t-1",
  fulfillmentRef: "fulfillment-1",
  packages: [{ reference: "pkg-1", itemRefs: ["item-1"], weightGrams: 1 }],
  status: "label_created",
  carrier: "bosta",
  carrierService: "standard",
  label: { labelId: "del-1", trackingNumber: "5108002", carrierDeliveryId: "del-1" },
  trackingNumber: "5108002",
  trackingEvents: [],
  deliveryEstimate: {},
  deliveredAt: null,
  version: 2,
  attempts: [
    {
      id: "1da18c11-b021-5497-a582-20e8571a10c6",
      kind: "label",
      outcome: "pending",
      reference: "1001-1",
      occurredAt: new Date("2026-11-12T10:00:00.000Z"),
    },
  ],
};

/** A transaction client whose `shipment.findFirst` records its arguments and answers `row`. */
function fakeTx(row: typeof ROW | null) {
  const calls: Args[] = [];
  const client = {
    shipment: {
      findFirst: (args: Args) => {
        calls.push(args);
        return Promise.resolve(row);
      },
    },
  };
  return { tx: client as unknown as TransactionClient, calls };
}

const repository = () =>
  new PrismaShipmentRepository({
    prisma: {} as unknown as Database,
    outbox: {} as unknown as OutboxWriter<TransactionClient>,
    context: {} as unknown as EventContext,
  });

beforeEach(() => {
  expect.hasAssertions();
});

describe("PrismaShipmentRepository finders (local carriers)", () => {
  it("counts shipments with an explicit tenant and fulfillment filter", async () => {
    const calls: Args[] = [];
    const tx = {
      shipment: {
        count: (args: Args) => {
          calls.push(args);
          return Promise.resolve(2);
        },
      },
    } as unknown as TransactionClient;
    expect(await repository().countByFulfillmentRef("f-1", "t-1", tx)).toBe(2);
    expect(calls).toEqual([{ where: { tenantId: "t-1", fulfillmentRef: "f-1" } }]);
  });
  it("findByTrackingNumber scopes by tenant, carrier and tracking number, newest first", async () => {
    const { tx, calls } = fakeTx(ROW);

    const found = await repository().findByTrackingNumber("bosta", "5108002", "t-1", tx);

    expect(calls).toEqual([
      {
        where: { tenantId: "t-1", carrier: "bosta", trackingNumber: "5108002" },
        include: { attempts: { orderBy: { occurredAt: "asc" } } },
        orderBy: { createdAt: "desc" },
      },
    ]);
    expect(found?.id.toString()).toBe(ROW.id);
    expect(found?.label?.carrierDeliveryId).toBe("del-1");
    expect(found?.pendingLabelAttempt()?.reference).toBe("1001-1");
  });

  it("findByFulfillmentRef returns the newest shipment (F4)", async () => {
    const { tx, calls } = fakeTx(ROW);

    await repository().findByFulfillmentRef("fulfillment-1", "t-1", tx);

    expect(calls[0]).toEqual({
      where: { fulfillmentRef: "fulfillment-1", tenantId: "t-1" },
      include: { attempts: { orderBy: { occurredAt: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("answers null when no row matches", async () => {
    const { tx } = fakeTx(null);
    expect(await repository().findByTrackingNumber("bosta", "nope", "t-1", tx)).toBeNull();
    expect(await repository().findById("nope", "t-1", tx)).toBeNull();
  });
});

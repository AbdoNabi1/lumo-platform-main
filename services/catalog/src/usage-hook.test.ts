import type { Database } from "@platform/db";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { PublishRecord } from "@platform/messaging";
import { describe, expect, it } from "vitest";
import { wireCatalog } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-09-29T10:00:00.000Z") };

const product = {
  sku: "P-1",
  name: "Toy Wagon",
  slug: "toy-wagon",
  variants: [{ sku: "P-1-RED", priceAmountMinor: 1999, currency: "USD" }],
  tenantId: "tenant-1",
};

describe("wireCatalog onUsageRecorded (test seam, in-memory branch only)", () => {
  it("delivers the platform.usage.recorded record to the hook when the outbox is drained", async () => {
    const delivered: PublishRecord[] = [];
    const serializer = new InMemoryEventSerializer();
    const app = wireCatalog({
      serializer,
      idGenerator: sequentialIds(),
      clock,
      onUsageRecorded: async (record) => {
        delivered.push(record);
      },
    });

    await app.products.create(product);
    expect(delivered).toEqual([]); // nothing leaves the outbox until it is drained
    await app.drainOutbox();

    expect(delivered).toHaveLength(1);
    const event = serializer.deserialize<{ tenant: string; resource: string; amount: number }>({
      type: delivered[0]?.headers["type"] ?? "",
      eventVersion: Number(delivered[0]?.headers["eventVersion"] ?? "1"),
      contentType: delivered[0]?.headers["contentType"] ?? serializer.contentType,
      data: delivered[0]?.value ?? new Uint8Array(),
    });
    expect(event.type).toBe("platform.usage.recorded");
    expect(event.tenantId).toBe("tenant-1");
    expect(event.payload).toMatchObject({ tenant: "tenant-1", resource: "PRODUCT", amount: 1 });
  });

  it("does not hand the hook a catalog event, only the usage record", async () => {
    const types: string[] = [];
    const app = wireCatalog({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
      onUsageRecorded: async (record) => {
        types.push(record.headers["type"] ?? "");
      },
    });

    await app.products.create(product);
    await app.drainOutbox();

    expect(types).toEqual(["platform.usage.recorded"]);
  });

  it("has no effect in the Prisma branch: the hook is never called and nothing is relayed in-process", async () => {
    // The Prisma branch builds no in-memory bus, relay or subscriber list, so there is nothing for the
    // hook to attach to. A client that fails on any use proves wiring alone touches no database, and
    // `drainOutbox` is the Prisma branch's constant 0 (Debezium/the runtime relay drain the table).
    let called = false;
    const untouchable = new Proxy(
      {},
      {
        get(_target, property) {
          throw new Error(`the Prisma client was used: ${String(property)}`);
        },
      },
    ) as unknown as Database;

    const app = wireCatalog({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
      prisma: untouchable,
      onUsageRecorded: async () => {
        called = true;
      },
    });

    expect(await app.drainOutbox()).toBe(0);
    expect(app.deliveredEventTypes).toEqual([]);
    expect(called).toBe(false);
  });
});

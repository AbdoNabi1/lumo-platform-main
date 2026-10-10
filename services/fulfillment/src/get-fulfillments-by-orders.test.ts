import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireFulfillment } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-10-09T00:00:00.000Z") };

function wire() {
  return wireFulfillment({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

type App = ReturnType<typeof wire>;

async function open(app: App, tenantId: string, orderRef: string): Promise<string> {
  const created = await app.fulfillment.create({
    tenantId,
    orderRef,
    items: [{ productRef: "product-1", quantity: 1 }],
  });
  expect(created.status).toBe(201);
  return (created.body as { fulfillmentOrderId: string }).fulfillmentOrderId;
}

interface Found {
  readonly orderRef: string;
  readonly id: { toString(): string };
  readonly status: { value: string };
}

async function lookup(app: App, tenantId: string, orderRefs: readonly string[]) {
  const response = await app.fulfillment.getByOrders({ tenantId, orderRefs });
  expect(response.status).toBe(200);
  return response.body as readonly Found[];
}

describe("getByOrders — the fulfillment orders of a page of orders, in one read (Plan 3B)", () => {
  it("returns the fulfillment order of each order that has one, and nothing for the rest", async () => {
    const app = wire();
    const first = await open(app, "tenant-a", "order-1");
    const third = await open(app, "tenant-a", "order-3");

    const found = await lookup(app, "tenant-a", ["order-1", "order-2", "order-3"]);

    expect(found.map((f) => [f.orderRef, f.id.toString()]).sort()).toEqual(
      [
        ["order-1", first],
        ["order-3", third],
      ].sort(),
    );
  });

  it("is tenant-scoped: another shop's fulfillment for the same order ref is never returned", async () => {
    const app = wire();
    await open(app, "tenant-a", "order-1");

    expect(await lookup(app, "tenant-b", ["order-1"])).toEqual([]);
    expect(await lookup(app, "tenant-a", ["order-1"])).toHaveLength(1);
  });

  it("returns one fulfillment order per order: the most recently opened", async () => {
    const app = wire();
    await open(app, "tenant-a", "order-1");
    const latest = await open(app, "tenant-a", "order-1");

    const found = await lookup(app, "tenant-a", ["order-1"]);

    expect(found).toHaveLength(1);
    expect(found[0]?.id.toString()).toBe(latest);
  });

  it("carries the real lifecycle status", async () => {
    const app = wire();
    const id = await open(app, "tenant-a", "order-1");
    await app.fulfillment.reserve({ tenantId: "tenant-a", fulfillmentOrderId: id });

    const found = await lookup(app, "tenant-a", ["order-1"]);

    expect(found[0]?.status.value).toBe("confirmed");
  });

  it("an empty list of orders is an empty answer, not an error", async () => {
    const app = wire();

    expect(await lookup(app, "tenant-a", [])).toEqual([]);
  });
});

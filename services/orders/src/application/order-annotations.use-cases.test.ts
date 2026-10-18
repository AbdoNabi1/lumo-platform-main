import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Order } from "../domain/order";
import { OrderItem } from "../domain/order-item";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import { InMemoryOrderAnnotationRepository } from "../infrastructure/in-memory-order-annotation-repository";
import { InMemoryOrderRepository } from "../infrastructure/in-memory-order-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { OrderEventTranslator } from "../infrastructure/order-event-translator";
import { ArchiveOrders, GetOrderAnnotations, UnarchiveOrders } from "./order-annotations.use-cases";

const TENANT = "tenant-a";
const FIRST = new Date("2026-10-18T09:00:00.000Z");
const LATER = new Date("2026-10-18T10:00:00.000Z");

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function placed(id: string): Order {
  const item = OrderItem.create(
    UniqueEntityId.from(`${id}-item`),
    must(ProductSnapshot.create("p-1", "Toy", must(Money.create(500, "EGP")))),
    1,
  );
  return Order.place(
    UniqueEntityId.from(id),
    must(OrderNumber.create(id)),
    "customer-1",
    "EGP",
    [item],
    must(AddressSnapshot.create("1 Nile St", "Cairo", "11511", "EG")),
    `${id}-evt`,
    new Date(0),
  );
}

async function wire(orderIds: readonly string[] = ["o-1", "o-2"]) {
  const orders = new InMemoryOrderRepository({
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new OrderEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "orders",
    }),
    context: rootEventContext({ generate: () => "evt" }),
  });
  for (const id of orderIds) await orders.save(placed(id), TENANT);
  await orders.save(placed("theirs"), "tenant-b");
  const annotations = new InMemoryOrderAnnotationRepository({ orders });
  let now = FIRST;
  const deps = { annotations, unitOfWork: new InMemoryUnitOfWork(), clock: { now: () => now } };
  return {
    orders,
    archive: new ArchiveOrders(deps),
    unarchive: new UnarchiveOrders(deps),
    read: new GetOrderAnnotations({ annotations }),
    setNow: (instant: Date) => {
      now = instant;
    },
  };
}

const input = (orderIds: readonly string[]) => ({
  tenantId: TENANT,
  orderIds,
  actorRef: "staff-1",
});

describe("ArchiveOrders / UnarchiveOrders (order operations Part 1)", () => {
  it("archives each order and reports it changed, with the archive time", async () => {
    const { archive } = await wire();
    const result = await archive.execute(input(["o-1", "o-2"]));
    expect(result).toEqual({
      ok: true,
      value: {
        results: [
          { orderId: "o-1", outcome: "changed", archivedAt: FIRST },
          { orderId: "o-2", outcome: "changed", archivedAt: FIRST },
        ],
      },
    });
  });

  it("archiving an archived order is a no-op that keeps its first timestamp (idempotent)", async () => {
    const { archive, setNow, orders } = await wire();
    await archive.execute(input(["o-1"]));
    setNow(LATER);
    const again = await archive.execute(input(["o-1"]));
    expect(again.ok && again.value.results).toEqual([
      { orderId: "o-1", outcome: "unchanged", archivedAt: FIRST },
    ]);
    expect(orders.archivedAtOf("o-1", TENANT)).toEqual(FIRST);
  });

  it("unarchive clears the timestamp; unarchiving an order that is not archived is unchanged", async () => {
    const { archive, unarchive, orders } = await wire();
    await archive.execute(input(["o-1"]));
    const result = await unarchive.execute(input(["o-1", "o-2"]));
    expect(result.ok && result.value.results).toEqual([
      { orderId: "o-1", outcome: "changed", archivedAt: null },
      { orderId: "o-2", outcome: "unchanged", archivedAt: null },
    ]);
    expect(orders.archivedAtOf("o-1", TENANT)).toBeNull();
  });

  it("an id this shop does not have (or another shop's) is not_found, and the others still archive", async () => {
    const { archive, orders } = await wire();
    const result = await archive.execute(input(["o-1", "missing", "theirs"]));
    expect(result.ok && result.value.results.map((r) => r.outcome)).toEqual([
      "changed",
      "not_found",
      "not_found",
    ]);
    expect(orders.archivedAtOf("theirs", "tenant-b")).toBeNull();
  });

  it("collapses duplicate ids into one result", async () => {
    const { archive } = await wire();
    const result = await archive.execute(input(["o-1", "o-1"]));
    expect(result.ok && result.value.results).toHaveLength(1);
  });

  it("refuses 0 or 51 ids with a validation error and writes nothing", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `o-${i}`);
    const { archive, orders } = await wire(ids);
    for (const orderIds of [[], ids]) {
      const result = await archive.execute(input(orderIds));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    }
    expect(orders.archivedAtOf("o-0", TENANT)).toBeNull();
  });

  it("answers an unchanged order's real archive time when a concurrent writer won the race", async () => {
    const { orders } = await wire();
    const CONCURRENT = new Date("2026-10-18T09:30:00.000Z");
    const real = new InMemoryOrderAnnotationRepository({ orders });
    // Between this call's read and its guarded update, another request archives o-1 first.
    const racing = {
      annotationsOf: real.annotationsOf.bind(real),
      setArchived: async (...args: Parameters<typeof real.setArchived>) => {
        orders.writeArchivedAt("o-1", TENANT, CONCURRENT);
        return real.setArchived(...args);
      },
    };
    const archive = new ArchiveOrders({
      annotations: racing,
      unitOfWork: new InMemoryUnitOfWork(),
      clock: { now: () => LATER },
    });

    const result = await archive.execute(input(["o-1", "o-2"]));

    expect(result.ok && result.value.results).toEqual([
      { orderId: "o-1", outcome: "unchanged", archivedAt: CONCURRENT },
      { orderId: "o-2", outcome: "changed", archivedAt: LATER },
    ]);
  });

  it("never touches the Order aggregate: same version, same history", async () => {
    const { archive, orders } = await wire();
    const before = await orders.findById("o-1", TENANT);
    await archive.execute(input(["o-1"]));
    const after = await orders.findById("o-1", TENANT);
    expect(after?.version).toBe(before?.version);
    expect(after?.history).toHaveLength(before?.history.length ?? -1);
  });
});

describe("GetOrderAnnotations", () => {
  it("answers each known order's archive timestamp and leaves unknown ids out", async () => {
    const { archive, read } = await wire();
    await archive.execute(input(["o-1"]));
    const result = await read.execute({ tenantId: TENANT, orderIds: ["o-1", "o-2", "missing"] });
    expect(result.ok && [...result.value]).toEqual([
      ["o-1", { archivedAt: FIRST }],
      ["o-2", { archivedAt: null }],
    ]);
  });

  it("refuses more than 250 ids", async () => {
    const { read } = await wire([]);
    const ids = Array.from({ length: 251 }, (_, i) => `o-${i}`);
    const result = await read.execute({ tenantId: TENANT, orderIds: ids });
    expect(result.ok).toBe(false);
  });
});

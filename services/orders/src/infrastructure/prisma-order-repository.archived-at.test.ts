import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { rootEventContext } from "@platform/messaging";
import { Order } from "../domain/order";
import { OrderEvent } from "../domain/order-event";
import { OrderItem } from "../domain/order-item";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import { OrderMapper } from "./order.mapper";
import { PrismaOrderRepository } from "./prisma-order-repository";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function order(version: number): Order {
  const item = OrderItem.create(
    UniqueEntityId.from("item-1"),
    must(ProductSnapshot.create("p-1", "Toy", must(Money.create(500, "EGP")))),
    1,
  );
  return Order.reconstitute(
    UniqueEntityId.from("0192f3a1-0000-7000-8000-000000000001"),
    must(OrderNumber.create("1001")),
    "customer-1",
    "EGP",
    [item],
    must(AddressSnapshot.create("1 Nile St", "Cairo", "11511", "EG")),
    [OrderEvent.create(UniqueEntityId.from("e-1"), "placed", new Date(0))],
    version,
  );
}

/** A transaction client that records every delegate call and answers enough for `save()`. */
function recordingTx() {
  const calls: { readonly model: string; readonly method: string; readonly args: unknown }[] = [];
  const delegate = (model: string) =>
    new Proxy(
      {},
      {
        get: (_target, method: string) => async (args: unknown) => {
          calls.push({ model, method, args });
          return method === "updateMany" ? { count: 1 } : {};
        },
      },
    );
  const tx = new Proxy({}, { get: (_target, model: string) => delegate(model) });
  return { tx, calls };
}

const repository = () =>
  new PrismaOrderRepository({
    prisma: {} as never,
    outbox: { write: async () => undefined } as never,
    context: rootEventContext({ generate: () => "evt" }),
  });

describe("archive stays outside the Order aggregate (order operations Part 1)", () => {
  it("OrderMapper.toOrderRow carries no archivedAt", () => {
    expect(OrderMapper.toOrderRow(order(0), "t-1")).not.toHaveProperty("archivedAt");
  });

  it("save() of a new order writes no archivedAt", async () => {
    const { tx, calls } = recordingTx();
    await repository().save(order(0), "t-1", tx);
    expect(JSON.stringify(calls)).not.toContain("archivedAt");
  });

  it("save() of an existing order never writes (and so never clears) archivedAt", async () => {
    const { tx, calls } = recordingTx();
    const existing = order(1);
    existing.markPaid("pay-1", "e-2", new Date(1));
    await repository().save(existing, "t-1", tx);
    expect(calls.some((call) => call.model === "order" && call.method === "updateMany")).toBe(true);
    expect(JSON.stringify(calls)).not.toContain("archivedAt");
  });

  it("OrderMapper.toOrderRow carries no note (Part 2)", () => {
    expect(OrderMapper.toOrderRow(order(0), "t-1")).not.toHaveProperty("note");
  });

  it("save() never writes the note and never touches order_tags or order_timeline_entries (Part 2)", async () => {
    for (const version of [0, 1]) {
      const { tx, calls } = recordingTx();
      const saved = order(version);
      if (version === 1) saved.markPaid("pay-1", "e-2", new Date(1));
      await repository().save(saved, "t-1", tx);
      expect(JSON.stringify(calls)).not.toContain('"note"');
      expect(calls.map((call) => call.model)).not.toContain("orderTag");
      expect(calls.map((call) => call.model)).not.toContain("orderTimelineEntry");
    }
  });
});

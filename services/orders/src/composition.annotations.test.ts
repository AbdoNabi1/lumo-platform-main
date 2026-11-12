import { describe, expect, it } from "vitest";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireOrders } from "./composition";
import type { OrderTimelineEntry } from "./domain/order-timeline";
import { InMemoryStaffDirectory } from "./infrastructure/in-memory-port-adapters";

describe("wireOrders — notes, tags and the timeline (order operations Part 2)", () => {
  it("records annotation activity and comments under the actor's name in the in-memory composition", async () => {
    let n = 0;
    const { orders } = wireOrders({
      serializer: new InMemoryEventSerializer(),
      idGenerator: {
        generate: () => `00000000-0000-7000-8000-${(n += 1).toString().padStart(12, "0")}`,
      },
      clock: { now: () => new Date("2026-10-19T09:00:00.000Z") },
      staffDirectory: new InMemoryStaffDirectory({ "staff-1": "Ahmed" }),
    });
    const placed = await orders.place({
      tenantId: "t-1",
      customerRef: "c-1",
      currency: "EGP",
      items: [{ productId: "p-1", name: "Toy", unitPriceAmountMinor: 1000, quantity: 1 }],
      shippingAddress: { line1: "1 Nile St", city: "Cairo", postalCode: "11511", country: "EG" },
    });
    const orderId = (placed.body as { orderId: string }).orderId;
    const actor = { tenantId: "t-1", actorRef: "staff-1" };

    expect((await orders.archiveOrders({ ...actor, orderIds: [orderId] })).status).toBe(200);
    expect((await orders.updateOrderNote({ ...actor, orderId, note: "Ring twice" })).status).toBe(
      200,
    );
    expect(
      (await orders.addOrderTags({ ...actor, orderIds: [orderId], tags: ["VIP"] })).status,
    ).toBe(200);
    expect((await orders.addOrderComment({ ...actor, orderId, body: "Called" })).status).toBe(201);

    const timeline = await orders.orderTimeline({ tenantId: "t-1", orderId });
    expect(timeline.status).toBe(200);
    expect(
      (timeline.body as readonly OrderTimelineEntry[]).map((entry) => [
        entry.kind,
        entry.authorName,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["archived", "Ahmed"],
        ["note_changed", "Ahmed"],
        ["tags_added", "Ahmed"],
        ["comment", "Ahmed"],
      ]),
    );
    const suggestions = await orders.suggestOrderTags({ tenantId: "t-1", prefix: "v" });
    expect(suggestions.body).toEqual({ tags: [{ tag: "VIP", count: 1 }] });
  });

  it("answers 404 for a comment on another shop's order and 422 past the 250-tag cap", async () => {
    let n = 0;
    const { orders } = wireOrders({
      serializer: new InMemoryEventSerializer(),
      idGenerator: {
        generate: () => `00000000-0000-7000-8000-${(n += 1).toString().padStart(12, "0")}`,
      },
      clock: { now: () => new Date("2026-10-19T09:00:00.000Z") },
    });
    const placed = await orders.place({
      tenantId: "t-1",
      customerRef: "c-1",
      currency: "EGP",
      items: [{ productId: "p-1", name: "Toy", unitPriceAmountMinor: 1000, quantity: 1 }],
      shippingAddress: { line1: "1 Nile St", city: "Cairo", postalCode: "11511", country: "EG" },
    });
    const orderId = (placed.body as { orderId: string }).orderId;
    const elsewhere = await orders.addOrderComment({
      tenantId: "t-2",
      orderId,
      body: "hi",
      actorRef: "staff-1",
    });
    expect(elsewhere.status).toBe(404);
    expect((await orders.orderTimeline({ tenantId: "t-2", orderId })).body).toEqual([]);

    const actor = { tenantId: "t-1", actorRef: "staff-1" };
    const full = Array.from({ length: 250 }, (_, i) => `t${i}`);
    expect((await orders.addOrderTags({ ...actor, orderIds: [orderId], tags: full })).status).toBe(
      200,
    );
    const over = await orders.addOrderTags({ ...actor, orderIds: [orderId], tags: ["one-more"] });
    expect(over.status).toBe(422);
  });
});

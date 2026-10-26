import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import type { OrderTimelineEntry, OrderTimelineRepository } from "../domain/order-timeline";
import { InMemoryOrderTimelineRepository } from "./in-memory-order-timeline-repository";
import { PrismaOrderTimelineRepository } from "./prisma-order-timeline-repository";

const TENANT = "tenant-a";
const ORDER = "01900000-0000-7000-8000-00000000000a";
const id = (n: number) => `01900000-0000-7000-8000-0000000001${n.toString().padStart(2, "0")}`;

function comment(n: number, overrides: Partial<OrderTimelineEntry> = {}): OrderTimelineEntry {
  return {
    id: id(n),
    orderId: ORDER,
    kind: "comment",
    authorRef: "staff-1",
    authorName: "Ahmed",
    body: `comment ${n}`,
    data: {},
    createdAt: new Date(Date.UTC(2026, 9, 19, 9, n)),
    editedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function layers(): readonly [string, OrderTimelineRepository, unknown][] {
  const fake = createFakePrisma();
  return [
    [
      "prisma over fake-prisma",
      new PrismaOrderTimelineRepository({ prisma: fake.database }),
      fake.database,
    ],
    ["in-memory", new InMemoryOrderTimelineRepository(), undefined],
  ];
}

describe("order timeline repositories (Part 2)", () => {
  it("lists one order's entries newest first, and finds one by id", async () => {
    for (const [layer, timeline, tx] of layers()) {
      await timeline.append(comment(1), TENANT, tx);
      await timeline.append(
        comment(3, { kind: "tags_added", body: null, data: { tags: ["VIP"] } }),
        TENANT,
        tx,
      );
      await timeline.append(comment(2), TENANT, tx);
      const listed = await timeline.listForOrder(ORDER, TENANT, { first: 200 }, tx);
      expect(
        listed.map((entry) => entry.id),
        layer,
      ).toEqual([id(3), id(2), id(1)]);
      expect(listed[0]?.data, layer).toEqual({ tags: ["VIP"] });
      expect(await timeline.findById(id(2), TENANT, tx), layer).toEqual(comment(2));
    }
  });

  it("keeps the draft number and id of a created_from_draft line", async () => {
    for (const [layer, timeline, tx] of layers()) {
      const data = { draftNumber: "D3", draftId: "01900000-0000-7000-8000-0000000002aa" };
      await timeline.append(
        comment(1, {
          kind: "created_from_draft",
          authorRef: null,
          authorName: null,
          body: null,
          data,
        }),
        TENANT,
        tx,
      );
      expect((await timeline.findById(id(1), TENANT, tx))?.data, layer).toEqual(data);
    }
  });

  it("update writes only body, editedAt and deletedAt", async () => {
    for (const [layer, timeline, tx] of layers()) {
      await timeline.append(comment(1), TENANT, tx);
      const edited = new Date(Date.UTC(2026, 9, 19, 10, 0));
      await timeline.update(
        {
          ...comment(1),
          body: "edited",
          editedAt: edited,
          authorName: "Someone else",
          kind: "archived",
        },
        TENANT,
        tx,
      );
      expect(await timeline.findById(id(1), TENANT, tx), layer).toEqual({
        ...comment(1),
        body: "edited",
        editedAt: edited,
      });
    }
  });

  it("an id that is not a uuid finds nothing and lists nothing (no query error)", async () => {
    for (const [layer, timeline, tx] of layers()) {
      expect(await timeline.findById("nope", TENANT, tx), layer).toBeNull();
      expect(await timeline.listForOrder("nope", TENANT, { first: 200 }, tx), layer).toEqual([]);
    }
  });

  it("the Prisma writes need the unit of work's transaction", async () => {
    const fake = createFakePrisma();
    const timeline = new PrismaOrderTimelineRepository({ prisma: fake.database });
    await expect(timeline.append(comment(1), TENANT)).rejects.toThrow(/transaction/);
    await expect(timeline.update(comment(1), TENANT)).rejects.toThrow(/transaction/);
  });
});

import { describe, expect, it } from "vitest";
import type { OrderTimelineEntry } from "@platform/orders";
import { toTimelineEntryDto } from "./order-timeline-dto";

const AT = new Date("2026-10-19T09:00:00.000Z");

function entry(overrides: Partial<OrderTimelineEntry> = {}): OrderTimelineEntry {
  return {
    id: "e-1",
    orderId: "o-1",
    kind: "comment",
    authorRef: "staff-1",
    authorName: "Ahmed",
    body: "Called — no answer",
    data: {},
    createdAt: AT,
    editedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("toTimelineEntryDto (order operations Part 2)", () => {
  it("lets the author edit and delete their own live comment", () => {
    expect(toTimelineEntryDto(entry(), { actorRef: "staff-1", canModerate: false })).toEqual({
      id: "e-1",
      kind: "comment",
      authorName: "Ahmed",
      body: "Called — no answer",
      data: {},
      createdAt: AT.toISOString(),
      editedAt: null,
      deleted: false,
      canEdit: true,
      canDelete: true,
    });
  });

  it("someone else's comment: no edit; delete only for a moderator", () => {
    expect(toTimelineEntryDto(entry(), { actorRef: "staff-2", canModerate: false })).toMatchObject({
      canEdit: false,
      canDelete: false,
    });
    expect(toTimelineEntryDto(entry(), { actorRef: "staff-2", canModerate: true })).toMatchObject({
      canEdit: false,
      canDelete: true,
    });
  });

  it("never serves a deleted comment's text and offers nothing on it (Review Focus 4)", () => {
    const dto = toTimelineEntryDto(entry({ deletedAt: AT }), {
      actorRef: "staff-1",
      canModerate: true,
    });
    expect(dto).toMatchObject({ body: null, deleted: true, canEdit: false, canDelete: false });
    expect(JSON.stringify(dto)).not.toContain("Called");
  });

  it("an activity line carries its data and can be neither edited nor deleted", () => {
    const dto = toTimelineEntryDto(
      entry({ kind: "tags_added", body: null, data: { tags: ["VIP"] } }),
      { actorRef: "staff-1", canModerate: true },
    );
    expect(dto).toMatchObject({ data: { tags: ["VIP"] }, canEdit: false, canDelete: false });
  });
});

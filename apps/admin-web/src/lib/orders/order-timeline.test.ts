import { describe, expect, it } from "vitest";
import type { TimelineEntryDto } from "@/lib/api/orders";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { activityLabel, isolateName, mergeTimeline } from "./order-timeline";

/** The FSI … PDI isolation `activityLabel` puts around staff-written text. */
const iso = (text: string): string => isolateName(text);

function line(overrides: Partial<TimelineEntryDto> = {}): TimelineEntryDto {
  return {
    id: "e-1",
    kind: "comment",
    authorName: "Ahmed",
    body: "Called",
    data: {},
    createdAt: "2026-10-19T08:00:00.000Z",
    editedAt: null,
    deleted: false,
    canEdit: false,
    canDelete: false,
    ...overrides,
  };
}

describe("mergeTimeline", () => {
  it("lists lifecycle events and staff lines newest first, grouped by the shop's calendar day", () => {
    const days = mergeTimeline(
      [
        { type: "created", occurredAt: "2026-10-18T20:00:00.000Z" }, // Cairo: Oct 18, 23:00
        { type: "confirmed", occurredAt: "2026-10-18T22:30:00.000Z" }, // Cairo: Oct 19, 01:30
      ],
      [line({ createdAt: "2026-10-19T08:00:00.000Z" })],
      "Africa/Cairo",
    );
    expect(days.map((day) => [day.day, day.items.map((item) => item.kind)])).toEqual([
      ["2026-10-19", ["entry", "event"]],
      ["2026-10-18", ["event"]],
    ]);
  });

  it("puts a staff line above a lifecycle event at the same instant, and keeps events' own newest-first order", () => {
    const at = "2026-10-19T08:00:00.000Z";
    const [day] = mergeTimeline(
      [
        { type: "created", occurredAt: at },
        { type: "confirmed", occurredAt: at },
      ],
      [line({ createdAt: at })],
      "UTC",
    );
    expect(
      day?.items.map((item) => (item.kind === "event" ? item.event.type : item.entry.kind)),
    ).toEqual(["comment", "confirmed", "created"]);
  });
});

describe("activityLabel", () => {
  it("says who did what, with Staff for an unknown author", () => {
    expect(activityLabel(line({ kind: "archived", body: null }), en)).toBe(
      `${iso("Ahmed")} archived this order`,
    );
    expect(activityLabel(line({ kind: "unarchived", body: null, authorName: null }), en)).toBe(
      `${iso("Staff")} unarchived this order`,
    );
    expect(
      activityLabel(line({ kind: "note_changed", body: null, data: { cleared: true } }), en),
    ).toBe(`${iso("Ahmed")} removed the note`);
    expect(
      activityLabel(line({ kind: "note_changed", body: null, data: { cleared: false } }), en),
    ).toBe(`${iso("Ahmed")} edited the note`);
    expect(
      activityLabel(
        line({ kind: "tags_added", body: null, data: { tags: ["VIP", "urgent"] } }),
        en,
      ),
    ).toBe(`${iso("Ahmed")} added tags ${iso("VIP")}, ${iso("urgent")}`);
    expect(
      activityLabel(
        line({ kind: "created_from_draft", body: null, data: { draftNumber: "D3" } }),
        en,
      ),
    ).toBe("Order created from draft #D3");
    expect(activityLabel(line({ deleted: true, body: null }), en)).toBe("Comment deleted");
  });

  it("is in Arabic, with the Arabic list separator", () => {
    expect(
      activityLabel(
        line({ kind: "tags_removed", body: null, data: { tags: ["VIP", "عاجل"] } }),
        ar,
      ),
    ).toBe(`${iso("Ahmed")} أزال العلامات ${iso("VIP")}، ${iso("عاجل")}`);
  });

  it("never returns a blank line for a staff-entry kind this build does not know", () => {
    const unknown = line({ kind: "future_kind" as TimelineEntryDto["kind"], body: null });
    expect(activityLabel(unknown, en)).toBe("Staff activity");
    expect(activityLabel(unknown, ar)).toBe(ar.orderTimeline.staffActivity);
    expect(ar.orderTimeline.staffActivity.length).toBeGreaterThan(2);
  });

  it("puts staff-written text in literally (no $-pattern or {placeholder} surprises)", () => {
    expect(
      activityLabel(
        line({ kind: "tags_added", authorName: "A$&B {tags}", data: { tags: ["$1", "{author}"] } }),
        en,
      ),
    ).toBe(`${iso("A$&B {tags}")} added tags ${iso("$1")}, ${iso("{author}")}`);
  });
});

describe("activityLabel isolates staff-written text", () => {
  it("wraps the author and every tag in FSI/PDI so their direction cannot reorder the line", () => {
    expect(
      activityLabel(
        line({
          kind: "tags_added",
          authorName: "أحمد",
          body: null,
          data: { tags: ["VIP", "عاجل"] },
        }),
        en,
      ),
    ).toBe(`${iso("أحمد")} added tags ${iso("VIP")}, ${iso("عاجل")}`);
    expect(activityLabel(line({ kind: "archived", body: null, authorName: "Ahmed" }), en)).toBe(
      `${iso("Ahmed")} archived this order`,
    );
  });

  it("isolates the fallback Staff name too, and stays literal for $ patterns", () => {
    expect(activityLabel(line({ kind: "unarchived", body: null, authorName: null }), en)).toBe(
      `${iso("Staff")} unarchived this order`,
    );
    expect(activityLabel(line({ kind: "archived", body: null, authorName: "$&x" }), en)).toBe(
      `${iso("$&x")} archived this order`,
    );
  });
});

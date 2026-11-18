import { describe, expect, it } from "vitest";
import {
  isOrderTimelineKind,
  MAX_COMMENT_LENGTH,
  normalizeCommentBody,
  ORDER_TIMELINE_KINDS,
} from "./order-timeline";

describe("normalizeCommentBody", () => {
  it("trims the ends and keeps inner line breaks", () => {
    expect(normalizeCommentBody("  Called — no answer\nTry tomorrow ")).toEqual({
      ok: true,
      value: "Called — no answer\nTry tomorrow",
    });
  });

  it("refuses an empty or whitespace-only comment", () => {
    for (const raw of ["", "  \n "]) {
      const result = normalizeCommentBody(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    }
  });

  it("allows 5,000 characters and refuses 5,001", () => {
    expect(normalizeCommentBody("a".repeat(MAX_COMMENT_LENGTH)).ok).toBe(true);
    expect(normalizeCommentBody("a".repeat(MAX_COMMENT_LENGTH + 1)).ok).toBe(false);
  });
});

describe("isOrderTimelineKind", () => {
  it("knows exactly the seven kinds the migration's CHECK allows", () => {
    expect([...ORDER_TIMELINE_KINDS]).toEqual([
      "comment",
      "archived",
      "unarchived",
      "note_changed",
      "tags_added",
      "tags_removed",
      "created_from_draft",
    ]);
    for (const kind of ORDER_TIMELINE_KINDS) expect(isOrderTimelineKind(kind)).toBe(true);
    expect(isOrderTimelineKind("deleted")).toBe(false);
  });
});

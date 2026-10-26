import { describe, expect, it } from "vitest";
import {
  canEditDrafts,
  canMarkDraftPaid,
  conflictCodeOf,
  draftsHref,
  parseDraftStatus,
} from "./draft-orders";

describe("draft list helpers", () => {
  it("parses only known statuses", () => {
    expect(parseDraftStatus("invoice_sent")).toBe("invoice_sent");
    expect(parseDraftStatus("archived")).toBeUndefined();
    expect(parseDraftStatus(undefined)).toBeUndefined();
  });

  it("builds tab hrefs that keep the search and drop the cursor", () => {
    expect(draftsHref({ status: undefined, q: undefined })).toBe("/draft-orders");
    expect(draftsHref({ status: "open", q: "#D3" })).toBe("/draft-orders?status=open&q=%23D3");
  });

  it("operators and admins edit; only admins mark paid", () => {
    expect([canEditDrafts("viewer"), canEditDrafts("operator"), canEditDrafts("admin")]).toEqual([
      false,
      true,
      true,
    ]);
    expect([canMarkDraftPaid("operator"), canMarkDraftPaid("admin")]).toEqual([false, true]);
    expect(canEditDrafts(undefined)).toBe(false);
  });

  it("reads the CODE: prefix of a 409 message (Ruling 19)", () => {
    expect(conflictCodeOf("OUT_OF_STOCK: insufficient stock")).toBe("OUT_OF_STOCK");
    expect(conflictCodeOf("Conflict")).toBeNull();
  });
});

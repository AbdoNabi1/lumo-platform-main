import { UnexpectedError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import { draftFromRow, type DraftOrderRow } from "./draft-order-rows";

const ROW: DraftOrderRow = {
  id: "33333333-3333-7333-8333-333333333333",
  draftNumber: "D1",
  status: "open",
  currency: "EGP",
  customerRef: null,
  contactEmail: null,
  contactPhone: null,
  shippingAddress: {},
  billingAddress: {},
  lines: [],
  discount: {},
  shipping: {},
  note: null,
  tags: ["vip"],
  checkoutRef: null,
  checkoutVersion: null,
  orderRef: null,
  invoiceSentAt: null,
  completedAt: null,
  deletedAt: null,
  createdBy: "staff",
  version: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe("draftFromRow", () => {
  it("reads the unset JSON columns back as null and the tags as strings", () => {
    const draft = draftFromRow(ROW);
    expect(draft.shippingAddress).toBeNull();
    expect(draft.discount).toBeNull();
    expect(draft.shipping).toBeNull();
    expect(draft.tags).toEqual(["vip"]);
  });

  it.each([
    ["a non-string tag", { tags: ["vip", 7] }],
    ["tags that are not a list", { tags: { vip: true } }],
    ["an unknown status", { status: "archived" }],
    ["lines that are not a list", { lines: {} }],
  ])("throws UnexpectedError for %s instead of dropping it", (_name, over) => {
    expect(() => draftFromRow({ ...ROW, ...over })).toThrow(UnexpectedError);
  });
});

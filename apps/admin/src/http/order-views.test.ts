import { describe, expect, it } from "vitest";
import { viewFilters } from "./order-views";

describe("viewFilters (each tab as repository predicates)", () => {
  it("lets the Unfulfilled tab exclude cancelled and closed orders in SQL, before the scan", () => {
    expect(viewFilters("unfulfilled")).toEqual({ archived: false, open: true });
  });

  it("keeps the other tabs' predicates", () => {
    expect(viewFilters("all")).toEqual({});
    expect(viewFilters("open")).toEqual({ archived: false, open: true });
    expect(viewFilters("unpaid")).toEqual({
      archived: false,
      open: true,
      paymentStatus: "pending",
    });
    expect(viewFilters("archived")).toEqual({ archived: true });
  });
});

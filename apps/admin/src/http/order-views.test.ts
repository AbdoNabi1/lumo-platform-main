import { describe, expect, it } from "vitest";
import { tagFilterParam, viewFilters } from "./order-views";

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

describe("tagFilterParam (order operations Part 2)", () => {
  const schema = tagFilterParam();

  it("reads one tag or a repeated tag as a list, trimmed", () => {
    expect(schema.parse("vip")).toEqual(["vip"]);
    expect(schema.parse(["vip", " urgent "])).toEqual(["vip", "urgent"]);
  });

  it("refuses only blanks, and more than 10 tags", () => {
    expect(schema.safeParse(" ").success).toBe(false);
    expect(schema.safeParse(Array.from({ length: 11 }, (_, i) => `t${i}`)).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  NO_ORDER_ACTIONS,
  ORDER_VIEWS,
  orderActionPermissionsFor,
  ordersExportContextFor,
  ordersViewHref,
  parseOrderIds,
  parseOrderView,
} from "./order-views";

describe("parseOrderView", () => {
  it("reads a known view, maps Home's legacy fulfillment link, and defaults to all", () => {
    expect(parseOrderView({ view: "unpaid" })).toBe("unpaid");
    expect(parseOrderView({ fulfillment: "unfulfilled" })).toBe("unfulfilled");
    expect(parseOrderView({ view: "archived", fulfillment: "unfulfilled" })).toBe("archived");
    expect(parseOrderView({ view: "bogus" })).toBe("all");
    expect(parseOrderView({})).toBe("all");
  });

  it("lists Shopify's tabs in Shopify's order", () => {
    expect(ORDER_VIEWS).toEqual(["all", "unfulfilled", "unpaid", "open", "archived"]);
  });
});

describe("ordersViewHref", () => {
  it("keeps the search and status, drops the cursor, and leaves All without a view param", () => {
    expect(ordersViewHref("all", {})).toBe("/orders");
    expect(ordersViewHref("unpaid", { q: "mona", status: "placed" })).toBe(
      "/orders?view=unpaid&q=mona&status=placed",
    );
    expect(ordersViewHref("all", { q: "mona" })).toBe("/orders?q=mona");
  });
});

describe("parseOrderIds", () => {
  it("splits, trims and dedupes a comma list", () => {
    expect(parseOrderIds(" a, b ,a,,", 50)).toEqual(["a", "b"]);
  });

  it("refuses nothing or more than the cap", () => {
    expect(parseOrderIds(undefined, 50)).toBeNull();
    expect(parseOrderIds(" , ", 50)).toBeNull();
    expect(parseOrderIds(Array.from({ length: 51 }, (_, i) => `o-${i}`).join(","), 50)).toBeNull();
  });
});

describe("ordersExportContextFor", () => {
  const params = { q: "mona", status: "placed", after: "cur-1" };

  it("builds the export context for operators and admins, carrying what the list shows", () => {
    for (const role of ["operator", "admin"]) {
      expect(ordersExportContextFor(role, "unpaid", params)).toEqual({
        view: "unpaid",
        q: "mona",
        status: "placed",
        after: "cur-1",
        hasFilters: true,
      });
    }
    expect(ordersExportContextFor("admin", "all", {})).toEqual({ view: "all", hasFilters: false });
  });

  it("gives viewers (no orders:export) and unknown roles no export at all", () => {
    expect(ordersExportContextFor("viewer", "all", {})).toBeUndefined();
    expect(ordersExportContextFor(undefined, "all", {})).toBeUndefined();
  });
});

describe("orderActionPermissionsFor (the role table, decided on the server)", () => {
  it("lets operators archive, fulfill and capture, and only admins mark cash as received", () => {
    expect(orderActionPermissionsFor("operator")).toEqual({
      canArchive: true,
      canFulfill: true,
      canCapture: true,
      canMarkCashReceived: false,
    });
    expect(orderActionPermissionsFor("admin")).toEqual({
      canArchive: true,
      canFulfill: true,
      canCapture: true,
      canMarkCashReceived: true,
    });
  });

  it("gives viewers and unknown roles none of the actions the API would refuse", () => {
    expect(orderActionPermissionsFor("viewer")).toEqual(NO_ORDER_ACTIONS);
    expect(orderActionPermissionsFor(undefined)).toEqual(NO_ORDER_ACTIONS);
    expect(Object.values(NO_ORDER_ACTIONS).every((allowed) => !allowed)).toBe(true);
  });
});

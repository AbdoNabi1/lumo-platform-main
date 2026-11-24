import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { SegmentView } from "@/lib/api/customer-segments";
import { formatMediumDate } from "@/lib/format";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { SegmentsTable } from "./segments-table";

beforeEach(() => {
  expect.hasAssertions();
});

const defaults: SegmentView[] = [
  {
    id: "default:purchased_at_least_once",
    kind: "default",
    key: "purchasedAtLeastOnce",
    name: null,
    version: null,
    conditions: [{ field: "orders_count", op: "gte", value: 1 }],
    updatedAt: null,
  },
  {
    id: "default:not_purchased",
    kind: "default",
    key: "notPurchased",
    name: null,
    version: null,
    conditions: [{ field: "orders_count", op: "eq", value: 0 }],
    updatedAt: null,
  },
];
const custom: SegmentView = {
  id: "7c1f0f6e-0000-4000-8000-000000000001",
  kind: "custom",
  key: null,
  name: "عملاء VIP",
  version: 2,
  conditions: [{ field: "orders_count", op: "gte", value: 3 }],
  updatedAt: "2026-11-20T10:00:00.000Z",
};

describe("SegmentsTable", () => {
  it("lists defaults by their localized label, then custom by name, with type and last edited", () => {
    render(<SegmentsTable segments={[...defaults, custom]} t={en} locale="en" />);

    const table = screen.getByRole("table", { name: en.segments.listLabel });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ["Purchased at least once", "Default", "—"],
      ["Haven't purchased", "Default", "—"],
      ["عملاء VIP", "Custom", formatMediumDate("en", "2026-11-20T10:00:00.000Z")],
    ]);
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Name", "Type", "Last edited"]);
  });

  it("links each name to its segment page, encoding the id; names sit in bdi dir=auto", () => {
    render(<SegmentsTable segments={[...defaults, custom]} t={en} locale="en" />);

    expect(screen.getByRole("link", { name: "Open segment Haven't purchased" })).toHaveAttribute(
      "href",
      "/customers/segments/default%3Anot_purchased",
    );
    const link = screen.getByRole("link", { name: "Open segment عملاء VIP" });
    expect(link).toHaveAttribute("href", `/customers/segments/${custom.id}`);
    const name = within(link).getByText("عملاء VIP");
    expect(name.tagName).toBe("BDI");
    expect(name).toHaveAttribute("dir", "auto");
  });

  it("renders in Arabic: defaults in Arabic labels, Arabic type and headers", () => {
    render(<SegmentsTable segments={[...defaults, custom]} t={ar} locale="ar" />);

    expect(screen.getByText(ar.segments.defaults.notPurchased)).toBeVisible();
    expect(screen.getByText(ar.segments.types.custom)).toBeVisible();
    expect(screen.getAllByText(ar.segments.types.default)).toHaveLength(2);
    expect(
      screen.getByRole("columnheader", { name: ar.segments.columns.lastEdited }),
    ).toBeVisible();
    expect(screen.queryByText(en.segments.defaults.notPurchased)).toBeNull();
  });
});

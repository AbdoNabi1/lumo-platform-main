import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { SegmentMemberRow } from "@/lib/api/customer-segments";
import { formatCurrency, formatMediumDate } from "@/lib/format";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { SegmentMembersTable } from "./segment-members-table";

beforeEach(() => {
  expect.hasAssertions();
});

const member: SegmentMemberRow = {
  id: "c-1",
  name: "نور حسن",
  email: "nour@example.com",
  isGuest: false,
  ordersCount: 3,
  amountSpentMinor: 29,
  lastOrderAt: "2026-11-20T10:00:00.000Z",
  emailSubscribed: true,
  smsSubscribed: false,
};
const never: SegmentMemberRow = {
  ...member,
  id: "c-2",
  name: "Sam",
  email: "sam@example.com",
  ordersCount: 0,
  amountSpentMinor: 0,
  lastOrderAt: null,
  emailSubscribed: false,
};

describe("SegmentMembersTable", () => {
  it("shows name, email, orders, amount spent, last order and the email subscription", () => {
    render(<SegmentMembersTable members={[member, never]} currency="EGP" t={en} locale="en" />);

    const table = screen.getByRole("table", { name: en.segments.members.tableLabel });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Name", "Email", "Orders", "Amount spent", "Last order", "Email subscription"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(
      within(rows[0]!)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([
      "نور حسن",
      "nour@example.com",
      "3",
      formatCurrency("en", 29, "EGP"),
      formatMediumDate("en", "2026-11-20T10:00:00.000Z"),
      "Subscribed",
    ]);
    expect(
      within(rows[1]!)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([
      "Sam",
      "sam@example.com",
      "0",
      formatCurrency("en", 0, "EGP"),
      "—",
      "Not subscribed",
    ]);
  });

  it.each([
    ["EGP", "EGP 0.29"],
    ["JPY", "¥29"],
    ["KWD", "KWD 0.029"],
  ])(
    "shows 29 minor units in %s as %s (the page's own currency, never EGP by default)",
    (currency, text) => {
      render(<SegmentMembersTable members={[member]} currency={currency} t={en} locale="en" />);

      expect(screen.getByText((content) => content.replace(/\u00a0/g, " ") === text)).toBeVisible();
    },
  );

  it("links the name to the customer, with names and emails in bdi dir=auto", () => {
    render(<SegmentMembersTable members={[member]} currency="EGP" t={ar} locale="ar" />);

    const link = screen.getByRole("link", {
      name: ar.customersPage.viewCustomer.replace("{name}", "نور حسن"),
    });
    expect(link).toHaveAttribute("href", "/customers/c-1");
    for (const text of ["نور حسن", "nour@example.com"]) {
      const node = screen.getByText(text);
      expect(node.tagName).toBe("BDI");
      expect(node).toHaveAttribute("dir", "auto");
    }
    expect(
      screen.getByRole("columnheader", { name: ar.segments.members.columns.amountSpent }),
    ).toBeVisible();
    expect(screen.getByText(ar.segments.members.subscribed)).toBeVisible();
  });
});

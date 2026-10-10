import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { OrderListItemDto } from "@/lib/api/orders";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { OrdersTable } from "./orders-table";

// Built from local calendar fields: "today" is the runtime's own calendar day.
const at = (month: number, day: number, hour: number, minute: number) =>
  new Date(2026, month - 1, day, hour, minute).toISOString();
const NOW = new Date(2026, 9, 9, 21, 0);

function order(overrides: Partial<OrderListItemDto> = {}): OrderListItemDto {
  return {
    id: "order-1",
    orderNumber: "1001",
    customerRef: "0192f3a1-aaaa-bbbb-cccc-dddd149f27ee",
    status: "payment_requested",
    currency: "EGP",
    totalMinor: 45000,
    createdAt: at(10, 9, 20, 27),
    customerName: "Mona Ali",
    itemCount: 3,
    shippingMethod: "standard",
    paymentStatus: "pending",
    fulfillmentStatus: "unfulfilled",
    ...overrides,
  };
}

function renderTable(orders: OrderListItemDto[], locale: "en" | "ar" = "en") {
  render(<OrdersTable orders={orders} t={locale === "en" ? en : ar} locale={locale} now={NOW} />);
}

const rowOf = (name: string | RegExp) => {
  const row = screen.getByRole("link", { name }).closest("tr");
  if (row === null) throw new Error("no row");
  return row;
};

describe("OrdersTable — like Shopify's orders list (Plan 3B)", () => {
  it("has the columns in Shopify's order, and no single Status column", () => {
    renderTable([order()]);

    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([
      "Order",
      "Date",
      "Customer",
      "Total",
      "Payment status",
      "Fulfillment status",
      "Items",
      "Delivery method",
    ]);
    expect(headers).not.toContain("Status");
  });

  it("shows the short number, bold, linking to the order", () => {
    renderTable([order()]);

    const link = screen.getByRole("link", { name: "View order 1001" });
    expect(link).toHaveAttribute("href", "/orders/order-1");
    expect(link).toHaveTextContent("#1001");
    expect(link.closest("td")).toHaveClass("font-semibold");
  });

  it("makes the whole row clickable through that one keyboard-accessible link, with a row hover", () => {
    renderTable([order()]);

    const row = rowOf("View order 1001");
    expect(within(row).getAllByRole("link")).toHaveLength(1);
    // The link's own box is stretched over the row (a positioned row + an absolutely positioned ::after).
    expect(within(row).getByRole("link").className).toContain("after:absolute");
    expect(within(row).getByRole("link").className).toContain("after:inset-0");
    expect(row).toHaveClass("relative");
    expect(row.className).toContain("hover:bg-");
  });

  describe("date", () => {
    it("says Today at the time, and keeps the full date in the tooltip", () => {
      renderTable([order({ createdAt: at(10, 9, 20, 27) })]);

      const cell = screen.getByText("Today at 8:27 pm");
      expect(cell.closest("td")).toHaveAttribute("title", expect.stringContaining("Oct 9, 2026"));
    });

    it("says Yesterday at the time", () => {
      renderTable([order({ createdAt: at(10, 8, 9, 5) })]);

      expect(screen.getByText("Yesterday at 9:05 am")).toBeInTheDocument();
    });

    it("gives the short date for older orders", () => {
      renderTable([order({ createdAt: at(10, 7, 9, 5) })]);

      expect(screen.getByText("Oct 7 at 9:05 am")).toBeInTheDocument();
    });
  });

  describe("customer", () => {
    it("shows the customer's name instead of a code made from their id", () => {
      renderTable([order()]);

      expect(screen.getByText("Mona Ali")).toBeInTheDocument();
      expect(screen.queryByText(/Customer 149F27/i)).toBeNull();
    });

    it("shows No customer, muted, when the order has no name", () => {
      renderTable([order({ customerName: null })]);

      const none = screen.getByText("No customer");
      expect(none).toHaveClass("text-muted-foreground");
      expect(screen.queryByText(/Customer [0-9A-F]{6}/)).toBeNull();
    });
  });

  it("formats the total in the order's currency", () => {
    renderTable([order({ totalMinor: 45000, currency: "EGP" })]);

    expect(screen.getByText(/450\.00/)).toBeInTheDocument();
  });

  describe("payment status badge", () => {
    it.each([
      ["pending", "Payment pending"],
      ["paid", "Paid"],
      ["refunded", "Refunded"],
      ["voided", "Voided"],
    ] as const)("%s reads %s", (status, label) => {
      renderTable([order({ paymentStatus: status })]);

      expect(within(rowOf("View order 1001")).getByText(label)).toBeInTheDocument();
    });

    it("warns while payment is pending and stays neutral once paid", () => {
      renderTable([
        order({ id: "a", orderNumber: "1001", paymentStatus: "pending" }),
        order({ id: "b", orderNumber: "1002", paymentStatus: "paid" }),
      ]);

      const pending = within(rowOf("View order 1001")).getByText("Payment pending");
      const paid = within(rowOf("View order 1002")).getByText("Paid");
      expect(pending.className).not.toBe(paid.className);
    });
  });

  describe("fulfillment status badge", () => {
    it.each([
      ["unfulfilled", "Unfulfilled"],
      ["in_progress", "In progress"],
      ["fulfilled", "Fulfilled"],
      ["delivered", "Delivered"],
    ] as const)("%s reads %s", (status, label) => {
      renderTable([order({ fulfillmentStatus: status })]);

      expect(within(rowOf("View order 1001")).getByText(label)).toBeInTheDocument();
    });
  });

  describe("items", () => {
    it.each([
      [1, "1 item"],
      [3, "3 items"],
    ])("%i reads %s in English", (count, label) => {
      renderTable([order({ itemCount: count })]);

      expect(screen.getByText(label)).toBeInTheDocument();
    });

    // Arabic has its own plural forms; the digits are the runtime locale's, the word form is pinned.
    it.each([
      [1, /^منتج واحد$/],
      [2, /^منتجين$/],
      [3, /^\S+ منتجات$/],
      [11, /^\S+ منتج$/],
    ])("%i takes the right Arabic form", (count, pattern) => {
      renderTable([order({ itemCount: count })], "ar");

      const cell = within(
        rowOf(ar.ordersPage.viewOrder.replace("{orderNumber}", "1001")),
      ).getAllByRole("cell")[6];
      expect(cell?.textContent).toMatch(pattern);
    });
  });

  describe("delivery method", () => {
    it("shows the localized label", () => {
      renderTable([order({ shippingMethod: "standard" })]);

      expect(screen.getByText("Standard shipping")).toBeInTheDocument();
    });

    it("localizes it into Arabic", () => {
      renderTable([order({ shippingMethod: "standard" })], "ar");

      expect(screen.getByText("شحن عادي")).toBeInTheDocument();
    });

    it("shows a dash for an order placed before the method was captured", () => {
      renderTable([order({ shippingMethod: null })]);

      expect(within(rowOf("View order 1001")).getByText("—")).toBeInTheDocument();
    });

    it("falls back to the raw value for a method it has no label for", () => {
      renderTable([order({ shippingMethod: "same-day" })]);

      expect(screen.getByText("same-day")).toBeInTheDocument();
    });
  });

  it("on a phone shows only Order, Customer, Total and Payment status", () => {
    renderTable([order()]);

    const visibleOnPhone = (el: Element) => !/\bhidden\b/.test(el.className);
    const headers = screen.getAllByRole("columnheader");
    expect(headers.filter(visibleOnPhone).map((h) => h.textContent)).toEqual([
      "Order",
      "Customer",
      "Total",
      "Payment status",
    ]);
    // The hidden ones come back from the medium breakpoint up.
    for (const header of headers.filter((h) => !visibleOnPhone(h))) {
      expect(header.className).toContain("md:table-cell");
    }
    const cells = within(rowOf("View order 1001")).getAllByRole("cell");
    expect(cells.filter(visibleOnPhone)).toHaveLength(4);
  });

  it("renders in Arabic with Arabic headers and statuses", () => {
    renderTable([order({ paymentStatus: "paid", fulfillmentStatus: "in_progress" })], "ar");

    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      ar.ordersPage.columns.order,
      ar.ordersPage.columns.date,
      ar.ordersPage.columns.customer,
      ar.ordersPage.columns.total,
      ar.ordersPage.columns.paymentStatus,
      ar.ordersPage.columns.fulfillmentStatus,
      ar.ordersPage.columns.items,
      ar.ordersPage.columns.deliveryMethod,
    ]);
    expect(screen.getByText("مدفوع")).toBeInTheDocument();
    expect(screen.getByText("قيد التجهيز")).toBeInTheDocument();
    expect(screen.getByText(/النهارده الساعة/)).toBeInTheDocument();
  });
});

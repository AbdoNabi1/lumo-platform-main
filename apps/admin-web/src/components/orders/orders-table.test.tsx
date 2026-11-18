import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { OrderListItemDto } from "@/lib/api/orders";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { orderActionPermissionsFor } from "@/lib/orders/order-views";
import { OrdersTable } from "./orders-table";

const OPERATOR = orderActionPermissionsFor("operator");
const ADMIN = orderActionPermissionsFor("admin");
const VIEWER = orderActionPermissionsFor("viewer");

const actions = vi.hoisted(() => ({ runBulkOrderAction: vi.fn() }));
vi.mock("@/app/orders/actions", () => actions);
vi.mock("@/app/orders/annotation-actions", () => ({
  suggestOrderTagsAction: vi.fn().mockResolvedValue([]),
}));

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
  render(
    <OrdersTable
      orders={orders}
      t={locale === "en" ? en : ar}
      locale={locale}
      now={NOW}
      permissions={OPERATOR}
    />,
  );
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
      "",
      "Order",
      "Date",
      "Customer",
      "Total",
      "Payment status",
      "Fulfillment status",
      "Items",
      "Delivery method",
      "Tags",
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
      ).getAllByRole("cell")[7];
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
      "",
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
    expect(cells.filter(visibleOnPhone)).toHaveLength(5);
  });

  it("renders in Arabic with Arabic headers and statuses", () => {
    renderTable([order({ paymentStatus: "paid", fulfillmentStatus: "in_progress" })], "ar");

    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "",
      ar.ordersPage.columns.order,
      ar.ordersPage.columns.date,
      ar.ordersPage.columns.customer,
      ar.ordersPage.columns.total,
      ar.ordersPage.columns.paymentStatus,
      ar.ordersPage.columns.fulfillmentStatus,
      ar.ordersPage.columns.items,
      ar.ordersPage.columns.deliveryMethod,
      ar.ordersPage.columns.tags,
    ]);
    expect(screen.getByText("مدفوع")).toBeInTheDocument();
    expect(screen.getByText("قيد التجهيز")).toBeInTheDocument();
    expect(screen.getByText(/النهارده الساعة/)).toBeInTheDocument();
  });
});

describe("OrdersTable selection and bulk bar (order operations Part 1)", () => {
  const two = () => [
    order(),
    order({ id: "order-2", orderNumber: "1002", archivedAt: "2026-10-18T09:00:00.000Z" }),
  ];

  it("shows an Archived badge next to an archived order's number", () => {
    renderTable(two());
    expect(within(rowOf(/1002/)).getByText("Archived")).toBeInTheDocument();
    expect(within(rowOf(/1001/)).queryByText("Archived")).toBeNull();
  });

  it("replaces the header with 'N selected' and the actions once a row is selected", () => {
    renderTable(two());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select order 1001" }));

    expect(screen.getByRole("toolbar", { name: "Bulk actions" })).toHaveTextContent("1 selected");
    for (const name of ["Fulfill items", "Capture payments", "Print packing slips"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("columnheader", { name: "Customer" })).toBeNull();
  });

  it("select-all selects the whole page, and again clears it", () => {
    renderTable(two());
    const all = screen.getByRole("checkbox", { name: "Select all orders on this page" });
    fireEvent.click(all);
    expect(screen.getByRole("toolbar")).toHaveTextContent("2 selected");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all orders on this page" }));
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("offers Mark cash as received only to admins", () => {
    const { rerender } = render(
      <OrdersTable orders={two()} t={en} locale="en" now={NOW} permissions={OPERATOR} />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select order 1001" }));
    expect(screen.queryByRole("button", { name: "Mark cash as received" })).toBeNull();
    rerender(<OrdersTable orders={two()} t={en} locale="en" now={NOW} permissions={ADMIN} />);
    expect(screen.getByRole("button", { name: "Mark cash as received" })).toBeInTheDocument();
  });

  it("offers a viewer only Print packing slips — no action the API would refuse", () => {
    render(<OrdersTable orders={two()} t={en} locale="en" now={NOW} permissions={VIEWER} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select order 1001" }));
    expect(screen.getByRole("button", { name: "Print packing slips" })).toBeInTheDocument();
    for (const name of [
      "Fulfill items",
      "Capture payments",
      "Archive orders",
      "Unarchive orders",
      "Mark cash as received",
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    expect(screen.queryByText("More actions")).toBeNull();
  });

  it("shows no actions without permissions (the safe default)", () => {
    render(<OrdersTable orders={two()} t={en} locale="en" now={NOW} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select order 1001" }));
    expect(screen.queryByRole("button", { name: "Fulfill items" })).toBeNull();
    expect(screen.getByRole("button", { name: "Print packing slips" })).toBeInTheDocument();
  });

  it("clears the selection when the page changes (Review Focus 5)", () => {
    const { rerender } = render(
      <OrdersTable orders={two()} t={en} locale="en" now={NOW} permissions={OPERATOR} />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select order 1001" }));
    rerender(
      <OrdersTable
        orders={[order({ id: "order-3", orderNumber: "1003" })]}
        t={en}
        locale="en"
        now={NOW}
      />,
    );
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Select order 1003" })).not.toBeChecked();
  });

  it("runs the action on the selection and reports updated, skipped and why", async () => {
    actions.runBulkOrderAction.mockResolvedValue({
      status: "done",
      results: [
        { orderId: "order-1", outcome: "ok" },
        { orderId: "order-2", outcome: "skipped", reason: "already_archived" },
      ],
    });
    renderTable(two());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all orders on this page" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive orders" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("1 orders updated · 1 skipped"),
    );
    expect(actions.runBulkOrderAction).toHaveBeenCalledWith("archive", ["order-1", "order-2"]);
    expect(screen.getByText("#1002 — Already archived")).toBeInTheDocument();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("says a refunded order was skipped by Fulfill items, in English and Arabic", async () => {
    expect(ar.ordersPage.bulk.reasons.payment_refunded).toBe("تم استرداد مبلغ الطلب");
    actions.runBulkOrderAction.mockResolvedValue({
      status: "done",
      results: [{ orderId: "order-1", outcome: "skipped", reason: "payment_refunded" }],
    });
    renderTable(two());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select order 1001" }));
    fireEvent.click(screen.getByRole("button", { name: "Fulfill items" }));

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByText("#1001 — Order was refunded")).toBeInTheDocument();
  });

  it("opens the packing slips of the selection in a new tab", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderTable(two());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all orders on this page" }));
    fireEvent.click(screen.getByRole("button", { name: "Print packing slips" }));
    expect(open).toHaveBeenCalledWith(
      "/orders/packing-slips?ids=order-1,order-2",
      "_blank",
      "noopener",
    );
  });

  it("names an unknown or missing reason with the generic text, never a raw token or an empty dash", async () => {
    actions.runBulkOrderAction.mockResolvedValue({
      status: "done",
      results: [
        { orderId: "order-1", outcome: "failed", reason: "some_future_reason" },
        { orderId: "order-2", outcome: "skipped" },
      ],
    });
    renderTable(two());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all orders on this page" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive orders" }));

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByText("#1001 — Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("#1002 — Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText(/some_future_reason/)).toBeNull();
  });

  it('shows the error state, not a stuck "Working…", when the action throws (network)', async () => {
    actions.runBulkOrderAction.mockRejectedValue(new Error("fetch failed"));
    renderTable(two());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all orders on this page" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive orders" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(en.formErrors.unexpected),
    );
    expect(screen.queryByText("Working…")).toBeNull();
  });

  it("offers Export selected when the page passes its export context, preselecting the selection", () => {
    render(
      <OrdersTable
        orders={two()}
        t={en}
        locale="en"
        now={NOW}
        exportContext={{ view: "all", hasFilters: false }}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select order 1001" }));
    fireEvent.click(screen.getByRole("button", { name: "Export selected" }));
    expect(screen.getByRole("radio", { name: "Selected: 1 orders" })).toBeChecked();
  });

  it("has no Export selected without the export context", () => {
    renderTable(two());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select order 1001" }));
    expect(screen.queryByRole("button", { name: "Export selected" })).toBeNull();
  });

  it("shows the first three tags and how many more (Part 2)", () => {
    renderTable([order({ tags: ["a", "b", "c", "d", "e"] })]);
    const row = rowOf(/1001/);
    for (const tag of ["a", "b", "c"]) expect(within(row).getByText(tag)).toBeInTheDocument();
    expect(within(row).queryByText("d")).toBeNull();
    expect(within(row).getByText("+2 more")).toBeInTheDocument();
  });

  it("adds tags to the selection through the dialog and reports the skipped ones (Part 2)", async () => {
    actions.runBulkOrderAction.mockResolvedValue({
      status: "done",
      results: [
        { orderId: "order-1", outcome: "ok" },
        { orderId: "order-2", outcome: "skipped", reason: "already_tagged" },
      ],
    });
    renderTable(two());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all orders on this page" }));
    fireEvent.click(screen.getByRole("button", { name: "Add tags" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Add tags to 2 orders");
    const input = screen.getByLabelText("Tags");
    fireEvent.change(input, { target: { value: "VIP" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(actions.runBulkOrderAction).toHaveBeenCalledWith(
        "add_tags",
        ["order-1", "order-2"],
        ["VIP"],
      ),
    );
    expect(await screen.findByText("#1002 — Already has these tags")).toBeInTheDocument();
  });

  it("offers no tag actions without orders:tag", () => {
    render(
      <OrdersTable
        orders={two()}
        t={en}
        locale="en"
        now={NOW}
        permissions={{ ...OPERATOR, canTag: false }}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all orders on this page" }));
    expect(screen.queryByRole("button", { name: "Add tags" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove tags" })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { en } from "@/messages/en";
import { ar } from "@/messages/ar";
import { DraftOrdersTable } from "./draft-orders-table";

const row = (over = {}) => ({
  id: "d-1",
  draftNumber: "D3",
  createdAt: "2026-10-25T10:00:00.000Z",
  customerName: "Mona Ali",
  status: "open" as const,
  totalMinor: 57100,
  currency: "EGP",
  orderRef: null,
  orderNumber: null,
  ...over,
});

describe("DraftOrdersTable", () => {
  it("shows #D3 linking to the draft, the customer, the status badge and the total", () => {
    render(<DraftOrdersTable drafts={[row()]} t={en} locale="en" />);
    expect(screen.getByRole("link", { name: "#D3" })).toHaveAttribute("href", "/draft-orders/d-1");
    expect(screen.getByText("Mona Ali")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    const cells = within(screen.getAllByRole("row")[1] as HTMLElement).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("Oct 25");
    expect(cells[4]).toHaveTextContent(/EGP\s571\.00/);
  });

  it("writes the date and total the Arabic way", () => {
    render(<DraftOrdersTable drafts={[row()]} t={ar} locale="ar" />);
    const cells = within(screen.getAllByRole("row")[1] as HTMLElement).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("أكتوبر");
    expect(cells[4]).toHaveTextContent(/571/);
    expect(cells[4]).toHaveTextContent("ج.م.");
  });

  it("links a completed draft's order number", () => {
    render(
      <DraftOrdersTable
        drafts={[row({ status: "completed", orderRef: "o-1", orderNumber: "1001" })]}
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByRole("link", { name: "Order #1001" })).toHaveAttribute(
      "href",
      "/orders/o-1",
    );
  });

  it("says 'No customer' when none was given", () => {
    render(<DraftOrdersTable drafts={[row({ customerName: null })]} t={en} locale="en" />);
    expect(screen.getByText("No customer")).toBeInTheDocument();
  });

  it("keeps a customer's own direction (dir=auto) and speaks Egyptian Arabic", () => {
    render(<DraftOrdersTable drafts={[row({ customerName: "منى علي" })]} t={ar} locale="ar" />);
    expect(screen.getByText("منى علي")).toHaveAttribute("dir", "auto");
    expect(screen.getByText("مفتوحة")).toBeInTheDocument();
  });
});

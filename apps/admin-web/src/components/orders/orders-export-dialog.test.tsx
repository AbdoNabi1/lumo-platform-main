import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { OrdersExportDialog, type OrdersExportContext } from "./orders-export-dialog";

const context: OrdersExportContext = { view: "unpaid", q: "mona", after: "c-1", hasFilters: true };

function renderDialog(props: Partial<Parameters<typeof OrdersExportDialog>[0]> = {}) {
  return render(
    <OrdersExportDialog
      open
      onOpenChange={vi.fn()}
      context={context}
      selectedIds={[]}
      t={en}
      {...props}
    />,
  );
}

describe("OrdersExportDialog (Shopify's Export orders)", () => {
  it("offers the five scopes and one format, with Selected disabled when nothing is selected", () => {
    renderDialog();
    for (const name of [
      "Current page",
      "All orders",
      "Orders matching your search",
      "Orders by date",
    ]) {
      expect(screen.getByRole("radio", { name })).toBeEnabled();
    }
    expect(screen.getByRole("radio", { name: "Selected: 0 orders" })).toBeDisabled();
    expect(screen.getByText("CSV for Excel")).toBeInTheDocument();
  });

  it("hides 'matching your search' when no search or filter is active", () => {
    renderDialog({ context: { view: "all", hasFilters: false } });
    expect(screen.queryByRole("radio", { name: "Orders matching your search" })).toBeNull();
  });

  it("submits a GET to /orders/export carrying the list's view, search, cursor and the selection", () => {
    const { container } = renderDialog({ selectedIds: ["o-1", "o-2"], defaultScope: "selected" });
    const form = container.ownerDocument.querySelector("form");
    expect(form).toHaveAttribute("action", "/orders/export");
    expect(form).toHaveAttribute("method", "get");
    expect(screen.getByRole("radio", { name: "Selected: 2 orders" })).toBeChecked();
    const hidden = Object.fromEntries(
      [...(form?.querySelectorAll("input[type=hidden]") ?? [])].map((input) => [
        input.getAttribute("name"),
        input.getAttribute("value"),
      ]),
    );
    expect(hidden).toEqual({ view: "unpaid", q: "mona", after: "c-1", ids: "o-1,o-2" });
  });

  it("asks for both dates, in order, before exporting by date", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: "Orders by date" }));
    const submit = screen.getByRole("button", { name: "Export orders" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-31" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-01" } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-01" } });
    expect(submit).toBeEnabled();
  });
});

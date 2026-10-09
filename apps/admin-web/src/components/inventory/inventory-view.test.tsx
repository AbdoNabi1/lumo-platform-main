import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { InventoryView } from "./inventory-view";

vi.mock("@/app/inventory/actions", () => ({
  addLocationAction: vi.fn(),
  deactivateLocationAction: vi.fn(),
  transferStockAction: vi.fn(),
  reserveStockAction: vi.fn(),
  releaseReservationAction: vi.fn(),
  commitReservationAction: vi.fn(),
}));

afterEach(cleanup);

const t = en.inventoryPage;
const warehouses = [{ id: "w1", code: "SHOP", name: "Main shop", status: "active" }];

describe("InventoryView", () => {
  it("shows the Locations card first, then the id-based tools under a collapsed Advanced section", () => {
    const { container } = render(
      <InventoryView t={en} warehouses={{ outcome: "ok", items: warehouses }} />,
    );

    const locationsTitle = screen.getByText(t.locationsTitle);
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(details!.querySelector("summary")).toHaveTextContent(t.advanced);
    // Locations come before the Advanced section in the page.
    expect(
      locationsTitle.compareDocumentPosition(details!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The transfer and reservation forms are inside Advanced, unchanged.
    expect(details!.textContent).toContain(t.transferTitle);
    expect(details!.textContent).toContain(t.reservationsTitle);
  });

  it("no longer offers the id-typed register and deactivate forms", () => {
    render(<InventoryView t={en} warehouses={{ outcome: "ok", items: warehouses }} />);

    expect(screen.queryByText("Register warehouse")).not.toBeInTheDocument();
    expect(screen.queryByText("Deactivate warehouse")).not.toBeInTheDocument();
  });

  it("shows an error state, still with Advanced, when the locations could not be loaded", () => {
    const { container } = render(<InventoryView t={en} warehouses={{ outcome: "error" }} />);

    expect(screen.getByText(t.locationsError)).toBeInTheDocument();
    expect(container.querySelector("details")).not.toBeNull();
  });

  it("shows a not-allowed state when the staff member cannot read locations", () => {
    render(<InventoryView t={en} warehouses={{ outcome: "unauthorized" }} />);

    expect(screen.getByText(t.locationsUnauthorized)).toBeInTheDocument();
  });
});

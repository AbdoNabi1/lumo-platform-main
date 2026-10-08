import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { ProductVariantDto } from "@/lib/api/products";
import type { StockView } from "@/lib/products/stock";
import { InventoryCard } from "./inventory-card";

const t = en.productEditor;

const variant: ProductVariantDto = {
  id: "v1",
  sku: "SKU-1",
  priceAmountMinor: 1999,
  currency: "USD",
  selection: null,
  compareAtAmountMinor: null,
  costAmountMinor: null,
  barcode: "999",
  weightGrams: null,
  requiresShipping: true,
  taxable: true,
  tracksInventory: true,
  inventoryPolicy: "deny",
};

const stock = (overrides: Partial<StockView> = {}): StockView => ({
  location: { id: "w1", name: "Cairo warehouse" },
  multipleLocations: false,
  readOnlyReason: null,
  byVariant: { v1: { onHand: 9, reserved: 2, available: 7 } },
  ...overrides,
});

describe("InventoryCard", () => {
  it("shows the location, the available quantity and continue selling while tracking", () => {
    render(<InventoryCard variant={variant} stock={stock()} t={en} errors={{}} mode="edit" />);

    expect(screen.getByLabelText(t.trackQuantity)).toBeChecked();
    expect(screen.getByText("Cairo warehouse")).toBeInTheDocument();
    const available = screen.getByLabelText(t.quantity);
    expect(available).toHaveAttribute("name", "available");
    expect(available).toHaveAttribute("form", "product-editor");
    expect(available).toHaveValue(7);
    expect(screen.getByLabelText(t.continueSelling)).not.toBeChecked();
  });

  it("names the location after the shop when none exists yet", () => {
    render(
      <InventoryCard
        variant={variant}
        stock={stock({ location: null, byVariant: {} })}
        t={en}
        errors={{}}
        mode="edit"
      />,
    );

    expect(screen.getByText(t.shopLocation)).toBeInTheDocument();
    expect(screen.getByLabelText(t.quantity)).toHaveValue(null);
  });

  it("hides the quantity row when tracking is switched off, but keeps what was typed", () => {
    render(<InventoryCard variant={variant} stock={stock()} t={en} errors={{}} mode="edit" />);
    const quantity = screen.getByLabelText(t.quantity);
    fireEvent.change(quantity, { target: { value: "12" } });

    fireEvent.click(screen.getByLabelText(t.trackQuantity));

    expect(screen.getByLabelText(t.trackQuantity)).not.toBeChecked();
    expect(quantity.closest("[hidden]")).not.toBeNull();
    expect(screen.getByLabelText(t.continueSelling).closest("[hidden]")).not.toBeNull();

    fireEvent.click(screen.getByLabelText(t.trackQuantity));
    expect(screen.getByLabelText(t.quantity)).toHaveValue(12);
    expect(screen.getByLabelText(t.quantity).closest("[hidden]")).toBeNull();
  });

  it("shows continue selling as checked when the variant keeps selling", () => {
    render(
      <InventoryCard
        variant={{ ...variant, inventoryPolicy: "continue" }}
        stock={stock()}
        t={en}
        errors={{}}
        mode="edit"
      />,
    );
    expect(screen.getByLabelText(t.continueSelling)).toBeChecked();
    expect(screen.getByLabelText(t.continueSelling)).toHaveAttribute("name", "continueSelling");
  });

  it("makes the quantity read-only, with the reason, for several locations", () => {
    render(
      <InventoryCard
        variant={variant}
        stock={stock({ multipleLocations: true })}
        t={en}
        errors={{}}
        mode="edit"
      />,
    );

    expect(screen.queryByLabelText(t.quantity)).not.toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText(t.multipleLocations)).toBeInTheDocument();
  });

  it("makes the quantity read-only when stock could not be loaded, never showing zero", () => {
    render(
      <InventoryCard
        variant={variant}
        stock={stock({ readOnlyReason: "unavailable", byVariant: {}, location: null })}
        t={en}
        errors={{}}
        mode="edit"
      />,
    );

    expect(screen.queryByLabelText(t.quantity)).not.toBeInTheDocument();
    expect(screen.getByText(t.stockUnavailable)).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("keeps SKU and barcode, with the same names as before", () => {
    render(<InventoryCard variant={variant} stock={stock()} t={en} errors={{}} mode="edit" />);

    expect(screen.getByLabelText(t.sku)).toHaveAttribute("name", "sku");
    expect(screen.getByLabelText(t.sku)).toHaveValue("SKU-1");
    expect(screen.getByLabelText(t.barcode)).toHaveAttribute("name", "barcode");
    expect(screen.getByLabelText(t.barcode)).toHaveValue("999");
  });

  it("starts a new product tracked, on the shop location, with a blank quantity", () => {
    render(
      <InventoryCard
        variant={undefined}
        stock={stock({ location: null, byVariant: {} })}
        t={en}
        errors={{}}
        mode="create"
      />,
    );

    expect(screen.getByLabelText(t.trackQuantity)).toBeChecked();
    expect(screen.getByText(t.shopLocation)).toBeInTheDocument();
    expect(screen.getByLabelText(t.quantity)).toHaveValue(null);
    expect(screen.getByLabelText(t.sku)).toHaveAttribute("placeholder", t.skuAuto);
  });

  it("marks the quantity the server rejected", () => {
    render(
      <InventoryCard
        variant={variant}
        stock={stock()}
        t={en}
        errors={{ available: "Check the highlighted fields." }}
        mode="edit"
      />,
    );
    expect(screen.getByLabelText(t.quantity)).toHaveAttribute("aria-invalid", "true");
  });
});

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

function renderCard(props: Partial<Parameters<typeof InventoryCard>[0]> = {}) {
  return render(
    <form id="product-editor">
      <InventoryCard variant={variant} stock={stock()} t={en} errors={{}} mode="edit" {...props} />
    </form>,
  );
}

const formData = (container: HTMLElement) => new FormData(container.querySelector("form")!);
// `hidden: true` so a chip the card hides (tracking off) can still be found and asserted on.
const chip = (label: string) =>
  screen.getByRole("button", { name: (name) => name.startsWith(label), hidden: true });
const tracked = () => screen.getByRole("switch", { name: t.inventoryTracked });

describe("InventoryCard", () => {
  it("has the 'inventory tracked' switch in its header, on while the variant is tracked", () => {
    const { container } = renderCard();

    expect(tracked()).toBeChecked();
    expect(tracked()).toHaveAttribute("name", "tracksInventory");
    expect(tracked()).toHaveAttribute("form", "product-editor");
    expect(formData(container).get("tracksInventory")).toBe("on");
  });

  it("shows the location and the available quantity in a table headed 'Quantity' while tracking", () => {
    renderCard();

    expect(screen.getByText("Cairo warehouse")).toBeInTheDocument();
    const available = screen.getByLabelText(t.quantity);
    expect(available).toHaveAttribute("name", "available");
    expect(available).toHaveAttribute("form", "product-editor");
    expect(available).toHaveValue(7);
    expect(available).toBeVisible();
  });

  it("names the location after the shop when none exists yet", () => {
    renderCard({ stock: stock({ location: null, byVariant: {} }) });

    expect(screen.getByText(t.shopLocation)).toBeInTheDocument();
    expect(screen.getByLabelText(t.quantity)).toHaveValue(null);
  });

  it("hides the quantity table when tracking is switched off, keeps what was typed, and posts no tracksInventory", () => {
    const { container } = renderCard();
    fireEvent.change(screen.getByLabelText(t.quantity), { target: { value: "12" } });

    fireEvent.click(tracked());

    expect(tracked()).not.toBeChecked();
    expect(formData(container).get("tracksInventory")).toBeNull();
    expect(screen.getByLabelText(t.quantity)).not.toBeVisible();
    expect(chip(t.sellWhenOutOfStock)).not.toBeVisible();

    fireEvent.click(tracked());
    expect(screen.getByLabelText(t.quantity)).toHaveValue(12);
    expect(screen.getByLabelText(t.quantity)).toBeVisible();
    expect(chip(t.sellWhenOutOfStock)).toBeVisible();
  });

  it("shows the SKU and barcode values on their chips, opened because they are set", () => {
    renderCard();

    expect(chip(t.sku)).toHaveTextContent("· SKU-1");
    expect(chip(t.sku)).toHaveAttribute("aria-expanded", "true");
    expect(chip(t.barcode)).toHaveTextContent("· 999");
    expect(screen.getByLabelText(t.sku)).toHaveAttribute("name", "sku");
    expect(screen.getByLabelText(t.sku)).toHaveValue("SKU-1");
    expect(screen.getByLabelText(t.barcode)).toHaveAttribute("name", "barcode");
    expect(screen.getByLabelText(t.barcode)).toHaveValue("999");
  });

  it("follows a typed SKU on its chip", () => {
    renderCard();

    fireEvent.change(screen.getByLabelText(t.sku), { target: { value: "NEW-7" } });

    expect(chip(t.sku)).toHaveTextContent("· NEW-7");
  });

  it("shows a dash on the SKU chip while it is blank, and keeps its closed panel in the form", () => {
    const { container } = renderCard({ variant: { ...variant, sku: "", barcode: null } });

    expect(chip(t.sku)).toHaveTextContent("· —");
    expect(chip(t.sku)).toHaveAttribute("aria-expanded", "false");
    expect(chip(t.barcode)).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText(t.sku)).not.toBeVisible();
    expect(formData(container).get("sku")).toBe("");
    expect(formData(container).get("barcode")).toBe("");
  });

  it("keeps 'sell when out of stock' behind its chip, as a switch named continueSelling", () => {
    const { container } = renderCard();

    expect(chip(t.sellWhenOutOfStock)).toHaveTextContent(`· ${t.off}`);
    expect(chip(t.sellWhenOutOfStock)).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(chip(t.sellWhenOutOfStock));
    const sell = screen.getByRole("switch", { name: t.sellWhenOutOfStock });
    expect(sell).toHaveAttribute("name", "continueSelling");
    expect(sell).not.toBeChecked();
    expect(formData(container).get("continueSelling")).toBeNull();

    fireEvent.click(sell);
    expect(formData(container).get("continueSelling")).toBe("on");
    expect(chip(t.sellWhenOutOfStock)).toHaveTextContent(`· ${t.on}`);
  });

  it("opens 'sell when out of stock' from the start when the variant keeps selling", () => {
    renderCard({ variant: { ...variant, inventoryPolicy: "continue" } });

    expect(chip(t.sellWhenOutOfStock)).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("switch", { name: t.sellWhenOutOfStock })).toBeChecked();
  });

  it("makes the quantity read-only, with the reason, for several locations", () => {
    renderCard({ stock: stock({ multipleLocations: true }) });

    expect(screen.queryByLabelText(t.quantity)).not.toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText(t.multipleLocations)).toBeInTheDocument();
  });

  it("makes the quantity read-only when stock could not be loaded, never showing zero", () => {
    renderCard({ stock: stock({ readOnlyReason: "unavailable", byVariant: {}, location: null }) });

    expect(screen.queryByLabelText(t.quantity)).not.toBeInTheDocument();
    expect(screen.getByText(t.stockUnavailable)).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("starts a new product tracked, on the shop location, with a blank quantity and an auto SKU", () => {
    renderCard({
      variant: undefined,
      stock: stock({ location: null, byVariant: {} }),
      mode: "create",
    });

    expect(tracked()).toBeChecked();
    expect(screen.getByText(t.shopLocation)).toBeInTheDocument();
    expect(screen.getByLabelText(t.quantity)).toHaveValue(null);
    expect(screen.getByLabelText(t.sku)).toHaveAttribute("placeholder", t.skuAuto);
  });

  it("marks the quantity the server rejected", () => {
    renderCard({ errors: { available: "Check the highlighted fields." } });

    expect(screen.getByLabelText(t.quantity)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Check the highlighted fields.")).toBeInTheDocument();
  });
});

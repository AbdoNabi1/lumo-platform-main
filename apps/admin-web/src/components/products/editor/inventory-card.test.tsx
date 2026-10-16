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
  locations: [{ id: "w1", name: "Cairo warehouse" }],
  defaultLocationId: "w1",
  readOnlyReason: null,
  byLocation: { w1: { v1: { onHand: 9, reserved: 2, available: 7 } } },
  ...overrides,
});

const noLocation = { locations: [], defaultLocationId: null, byLocation: {} } as const;

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
/** The quantity input of one named location (Plan 2B-3: one per location). */
const qty = (location: string) => screen.getByLabelText(`${t.quantity}: ${location}`);

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
    const available = qty("Cairo warehouse");
    expect(available).toHaveAttribute("name", "available-w1");
    expect(available).toHaveAttribute("form", "product-editor");
    expect(available).toHaveValue(7);
    expect(available).toBeVisible();
  });

  it("names the location after the shop when none exists yet", () => {
    renderCard({ stock: stock(noLocation) });

    expect(screen.getByText(t.shopLocation)).toBeInTheDocument();
    expect(screen.getByLabelText(t.quantity)).toHaveValue(null);
    expect(screen.getByLabelText(t.quantity)).toHaveAttribute("name", "available");
  });

  it("hides the quantity table when tracking is switched off, keeps what was typed, and posts no tracksInventory", () => {
    const { container } = renderCard();
    fireEvent.change(qty("Cairo warehouse"), { target: { value: "12" } });

    fireEvent.click(tracked());

    expect(tracked()).not.toBeChecked();
    expect(formData(container).get("tracksInventory")).toBeNull();
    expect(qty("Cairo warehouse")).not.toBeVisible();
    expect(chip(t.sellWhenOutOfStock)).not.toBeVisible();

    fireEvent.click(tracked());
    expect(qty("Cairo warehouse")).toHaveValue(12);
    expect(qty("Cairo warehouse")).toBeVisible();
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

  it("with two locations, shows a row and a field per location, each with its own quantity", () => {
    const { container } = renderCard({
      stock: stock({
        locations: [
          { id: "w1", name: "Cairo warehouse" },
          { id: "w2", name: "Alex warehouse" },
        ],
        byLocation: {
          w1: { v1: { onHand: 9, reserved: 2, available: 7 } },
          w2: { v1: { onHand: 3, reserved: 0, available: 3 } },
        },
      }),
    });

    expect(screen.getByText("Cairo warehouse")).toBeInTheDocument();
    expect(screen.getByText("Alex warehouse")).toBeInTheDocument();
    expect(qty("Cairo warehouse")).toHaveAttribute("name", "available-w1");
    expect(qty("Cairo warehouse")).toHaveValue(7);
    expect(qty("Alex warehouse")).toHaveAttribute("name", "available-w2");
    expect(qty("Alex warehouse")).toHaveValue(3);
    expect(formData(container).get("available")).toBeNull();
  });

  it("a location with no stock row yet starts blank", () => {
    renderCard({
      stock: stock({
        locations: [
          { id: "w1", name: "Cairo warehouse" },
          { id: "w2", name: "Alex warehouse" },
        ],
      }),
    });

    expect(qty("Alex warehouse")).toHaveValue(null);
  });

  it("makes the quantity read-only when stock could not be loaded, never showing zero", () => {
    renderCard({ stock: stock({ readOnlyReason: "unavailable", ...noLocation }) });

    expect(screen.queryByLabelText(t.quantity)).not.toBeInTheDocument();
    expect(screen.getByText(t.stockUnavailable)).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("starts a new product tracked, on the shop location, with a blank quantity and an auto SKU", () => {
    renderCard({
      variant: undefined,
      stock: stock(noLocation),
      mode: "create",
    });

    expect(tracked()).toBeChecked();
    expect(screen.getByText(t.shopLocation)).toBeInTheDocument();
    expect(screen.getByLabelText(t.quantity)).toHaveValue(null);
    expect(screen.getByLabelText(t.sku)).toHaveAttribute("placeholder", t.skuAuto);
  });

  it("marks the quantity the server rejected", () => {
    renderCard({ errors: { "available-w1": "Check the highlighted fields." } });

    expect(qty("Cairo warehouse")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Check the highlighted fields.")).toBeInTheDocument();
  });
});

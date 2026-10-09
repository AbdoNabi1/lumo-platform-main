import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import type { ProductDetailDto, ProductVariantDto } from "@/lib/api/products";
import type { StockView } from "@/lib/products/stock";
import { VariantsCard } from "./variants-card";

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;
const updateVariantDetailsAction = vi.fn<Action>();
const removeProductVariantAction = vi.fn<Action>();

vi.mock("@/app/products/actions", () => ({
  updateVariantDetailsAction: (previous: FormState, formData: FormData) =>
    updateVariantDetailsAction(previous, formData),
  removeProductVariantAction: (previous: FormState, formData: FormData) =>
    removeProductVariantAction(previous, formData),
}));

const t = en.productEditor;

const variant = (overrides: Partial<ProductVariantDto> = {}): ProductVariantDto => ({
  id: "v1",
  sku: "SKU-1",
  priceAmountMinor: 1999,
  currency: "USD",
  selection: null,
  compareAtAmountMinor: null,
  costAmountMinor: null,
  barcode: null,
  weightGrams: null,
  requiresShipping: true,
  taxable: true,
  tracksInventory: true,
  inventoryPolicy: "deny",
  ...overrides,
});

const product = (overrides: Partial<ProductDetailDto> = {}): ProductDetailDto => ({
  id: "p1",
  sku: "P-1",
  name: "Tee",
  slug: "tee",
  status: "draft",
  scheduledAt: null,
  brandId: null,
  categoryIds: [],
  options: [],
  seoTitle: null,
  seoDescription: null,
  description: null,
  productType: null,
  tags: [],
  mediaAssetIds: [],
  variants: [variant()],
  ...overrides,
});

const sized = product({
  options: [{ name: "Size", values: ["S", "M", "L"] }],
  variants: [
    variant({ id: "s", sku: "SKU-S", selection: { Size: "S" } }),
    variant({ id: "m", sku: "SKU-M", selection: { Size: "M" }, priceAmountMinor: 2500 }),
    variant({ id: "l", sku: "SKU-L", selection: { Size: "L" } }),
  ],
});

const level = (available: number) => ({ onHand: available, reserved: 0, available });

const stockView = (overrides: Partial<StockView> = {}): StockView => ({
  location: { id: "w1", name: "Shop" },
  multipleLocations: false,
  readOnlyReason: null,
  byVariant: { s: level(4), m: level(5), l: level(6) },
  ...overrides,
});

function renderCard(
  p: ProductDetailDto,
  extra: {
    stock?: StockView;
    onPlanChange?: (summary: { adds: number; removes: number }) => void;
    errors?: Record<string, string>;
  } = {},
) {
  const onPlanChange = extra.onPlanChange ?? vi.fn();
  return {
    onPlanChange,
    ...render(
      <VariantsCard
        product={p}
        stock={extra.stock ?? stockView()}
        t={en}
        locale="en"
        onPlanChange={onPlanChange}
        errors={extra.errors ?? {}}
      />,
    ),
  };
}

const rowsOf = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);
const field = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLInputElement>(`input[name="${name}"]`);

beforeEach(() => {
  updateVariantDetailsAction.mockReset().mockResolvedValue({ status: "success" });
  removeProductVariantAction.mockReset().mockResolvedValue({ status: "success" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VariantsCard", () => {
  it("shows only the options editor for a product with no options", () => {
    const { container } = renderCard(product());

    expect(screen.getByRole("button", { name: t.addOptions })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(field(container, "optionsPresent")).toHaveValue("1");
    expect(field(container, "optionsPresent")).toHaveAttribute("form", "product-editor");
  });

  it("builds the table live as options are typed: existing price kept, new rows marked New", () => {
    const { container } = renderCard(product());
    fireEvent.click(screen.getByRole("button", { name: t.addOptions }));
    fireEvent.change(screen.getByLabelText(t.optionName), { target: { value: "Size" } });
    fireEvent.change(screen.getAllByLabelText(t.optionValue)[0]!, { target: { value: "S" } });
    fireEvent.change(screen.getAllByLabelText(t.optionValue)[1]!, { target: { value: "M" } });

    const rows = rowsOf();
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("S")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("M")).toBeInTheDocument();
    // S is the existing variant; M copies its price and is flagged New.
    expect(field(container, "row-0-price")).toHaveValue("19.99");
    expect(field(container, "row-1-price")).toHaveValue("19.99");
    expect(within(rows[0]!).queryByText(t.newVariant)).not.toBeInTheDocument();
    expect(within(rows[1]!).getByText(t.newVariant)).toBeInTheDocument();
  });

  it("joins every row field to the page form, with a hidden key per row", () => {
    const { container } = renderCard(sized);

    for (const row of [0, 1, 2]) {
      expect(field(container, `row-${row}-key`)).toHaveAttribute("type", "hidden");
      expect(field(container, `row-${row}-key`)).toHaveAttribute("form", "product-editor");
      expect(field(container, `row-${row}-price`)).toHaveAttribute("form", "product-editor");
      expect(field(container, `row-${row}-available`)).toHaveAttribute("form", "product-editor");
    }
    expect(field(container, "row-1-key")).toHaveValue("Size=M");
    expect(field(container, "row-1-price")).toHaveValue("25.00");
    expect(field(container, "row-1-available")).toHaveValue(5);
  });

  it("offers no quantity for an untracked variant", () => {
    const { container } = renderCard(
      product({
        options: [{ name: "Size", values: ["S", "M"] }],
        variants: [
          variant({ id: "s", selection: { Size: "S" }, tracksInventory: false }),
          variant({ id: "m", sku: "SKU-M", selection: { Size: "M" } }),
        ],
      }),
    );

    expect(field(container, "row-0-available")).toBeNull();
    expect(within(rowsOf()[0]!).getByText(t.notTracked)).toBeInTheDocument();
    expect(field(container, "row-1-available")).not.toBeNull();
  });

  it("shows read-only quantities, with the reason, for several locations", () => {
    const { container } = renderCard(sized, { stock: stockView({ multipleLocations: true }) });

    expect(field(container, "row-0-available")).toBeNull();
    expect(within(rowsOf()[0]!).getByText("4")).toBeInTheDocument();
    expect(screen.getByText(t.multipleLocations)).toBeInTheDocument();
  });

  it("shows read-only dashes, not zeros, when stock could not be loaded", () => {
    const { container } = renderCard(sized, {
      stock: stockView({ readOnlyReason: "unavailable", byVariant: {}, location: null }),
    });

    expect(field(container, "row-0-available")).toBeNull();
    expect(within(rowsOf()[0]!).getByText("—")).toBeInTheDocument();
    expect(screen.getByText(t.stockUnavailable)).toBeInTheDocument();
  });

  it("reports the variants a removed value takes away, for the Save confirmation", () => {
    const { onPlanChange } = renderCard(sized);
    expect(onPlanChange).toHaveBeenLastCalledWith({ adds: 0, removes: 0 });

    // The option's own Edit comes before the table's.
    fireEvent.click(screen.getAllByRole("button", { name: t.edit })[0]!);
    fireEvent.click(screen.getByRole("button", { name: t.removeValue.replace("{value}", "M") }));

    expect(onPlanChange).toHaveBeenLastCalledWith({ adds: 0, removes: 1 });
    expect(rowsOf()).toHaveLength(2);
  });

  it("keeps a typed price when other rows appear", () => {
    const { container } = renderCard(sized);
    fireEvent.change(field(container, "row-0-price")!, { target: { value: "30" } });

    fireEvent.click(screen.getAllByRole("button", { name: t.edit })[0]!);
    const inputs = screen.getAllByLabelText(t.optionValue);
    fireEvent.change(inputs[inputs.length - 1]!, { target: { value: "XL" } });

    expect(rowsOf()).toHaveLength(4);
    expect(field(container, "row-0-key")).toHaveValue("Size=S");
    expect(field(container, "row-0-price")).toHaveValue("30");
    expect(field(container, "row-3-key")).toHaveValue("Size=XL");
  });

  it("explains an invalid option set", () => {
    renderCard(sized);
    fireEvent.click(screen.getAllByRole("button", { name: t.edit })[0]!);
    const inputs = screen.getAllByLabelText(t.optionValue);
    fireEvent.change(inputs[inputs.length - 1]!, { target: { value: "S" } });
    expect(screen.getByRole("note")).toHaveTextContent(t.invalidOptions);
  });

  it("does not complain while a new option has a name but no value yet", () => {
    renderCard(product());
    fireEvent.click(screen.getByRole("button", { name: t.addOptions }));
    fireEvent.change(screen.getByLabelText(t.optionName), { target: { value: "Size" } });

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("marks the price and quantity the server rejected", () => {
    const { container } = renderCard(sized, {
      errors: { "row-0-price": "Enter a valid price", "row-1-available": "Whole number" },
    });

    expect(screen.getByText("Enter a valid price")).toBeInTheDocument();
    expect(field(container, "row-0-price")).toHaveAttribute("aria-invalid", "true");
    expect(field(container, "row-1-available")).toHaveAttribute("aria-invalid", "true");
  });

  it("offers Edit only for existing rows, and edits one in a dialog with the inventory switches", async () => {
    renderCard(
      product({
        options: [{ name: "Size", values: ["S"] }],
        variants: [variant({ selection: { Size: "S" } })],
      }),
    );
    fireEvent.click(screen.getAllByRole("button", { name: t.edit })[0]!);
    fireEvent.change(screen.getAllByLabelText(t.optionValue)[1]!, { target: { value: "M" } });

    const rows = rowsOf();
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole("button", { name: t.edit })).toBeInTheDocument();
    expect(within(rows[1]!).queryByRole("button", { name: t.edit })).not.toBeInTheDocument();

    fireEvent.click(within(rows[0]!).getByRole("button", { name: t.edit }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("switch", { name: t.inventoryTracked })).toBeChecked();
    fireEvent.click(
      within(dialog).getByRole("button", { name: (name) => name.startsWith(t.sellWhenOutOfStock) }),
    );
    expect(within(dialog).getByRole("switch", { name: t.sellWhenOutOfStock })).not.toBeChecked();

    fireEvent.click(within(dialog).getByRole("switch", { name: t.sellWhenOutOfStock }));
    fireEvent.click(
      within(dialog).getByRole("button", { name: (name) => name.startsWith(t.barcode) }),
    );
    fireEvent.change(within(dialog).getByLabelText(t.barcode), { target: { value: "999" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t.save }));

    await waitFor(() => expect(updateVariantDetailsAction).toHaveBeenCalledTimes(1));
    const formData = updateVariantDetailsAction.mock.calls[0]![1];
    expect(formData.get("productId")).toBe("p1");
    expect(formData.get("variantId")).toBe("v1");
    expect(formData.get("barcode")).toBe("999");
    expect(formData.get("requiresShipping")).toBe("on");
    expect(formData.get("taxable")).toBe("on");
    expect(formData.get("tracksInventory")).toBe("on");
    expect(formData.get("continueSelling")).toBe("on");
    // Every other field the dialog posted before still goes out, closed chips included.
    for (const name of ["price", "compareAtPrice", "costPerItem", "sku", "weight", "weightUnit"]) {
      expect(formData.has(name)).toBe(true);
    }
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opens the cost chip in the dialog when the variant has a cost, and the price field is a money input", async () => {
    renderCard(
      product({
        options: [{ name: "Size", values: ["S"] }],
        variants: [variant({ selection: { Size: "S" }, costAmountMinor: 700 })],
      }),
    );
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: t.edit }));

    const dialog = await screen.findByRole("dialog");
    const cost = within(dialog).getByRole("button", {
      name: (name) => name.startsWith(t.costPerItem),
    });
    expect(cost).toHaveAttribute("aria-expanded", "true");
    expect(cost).toHaveTextContent("· $7.00");
    expect(within(dialog).getByLabelText(t.costPerItem)).toHaveValue("7.00");
    expect(within(dialog).getByLabelText(t.price)).toHaveAttribute("name", "price");
    // Price, compare-at and cost are each a money input with the currency symbol as a prefix.
    expect(within(dialog).getAllByText("$")).toHaveLength(3);
  });

  it("switches the dialog off physical with the physical-product switch, and posts nothing for it", async () => {
    renderCard(
      product({
        options: [{ name: "Size", values: ["S"] }],
        variants: [variant({ selection: { Size: "S" } })],
      }),
    );
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: t.edit }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("switch", { name: t.physicalProduct }));
    fireEvent.click(within(dialog).getByRole("button", { name: t.save }));

    await waitFor(() => expect(updateVariantDetailsAction).toHaveBeenCalledTimes(1));
    expect(updateVariantDetailsAction.mock.calls[0]![1].get("requiresShipping")).toBeNull();
  });

  it("offers Remove in the dialog only when the product has more than one variant", async () => {
    const single = product({
      options: [{ name: "Size", values: ["S"] }],
      variants: [variant({ selection: { Size: "S" } })],
    });
    const { unmount } = renderCard(single);
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: t.edit }));
    const alone = await screen.findByRole("dialog");
    expect(
      within(alone).queryByRole("button", { name: en.productVariantsForm.remove }),
    ).not.toBeInTheDocument();
    unmount();

    renderCard(sized);
    fireEvent.click(within(rowsOf()[0]!).getByRole("button", { name: t.edit }));
    const several = await screen.findByRole("dialog");
    expect(
      within(several).getByRole("button", { name: en.productVariantsForm.remove }),
    ).toBeInTheDocument();
  });
});

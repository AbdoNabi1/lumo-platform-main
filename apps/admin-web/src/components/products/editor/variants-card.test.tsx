import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import type { ProductDetailDto, ProductVariantDto } from "@/lib/api/products";
import { formatCurrency } from "@/lib/format";
import { VariantsCard } from "./variants-card";

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;
const saveProductOptionsAction = vi.fn<Action>();
const updateVariantDetailsAction = vi.fn<Action>();
const removeProductVariantAction = vi.fn<Action>();

vi.mock("@/app/products/actions", () => ({
  saveProductOptionsAction: (previous: FormState, formData: FormData) =>
    saveProductOptionsAction(previous, formData),
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
    variant({ id: "m", sku: "SKU-M", selection: { Size: "M" } }),
    variant({ id: "l", sku: "SKU-L", selection: { Size: "L" } }),
  ],
});

beforeEach(() => {
  saveProductOptionsAction.mockReset().mockResolvedValue({ status: "success" });
  updateVariantDetailsAction.mockReset().mockResolvedValue({ status: "success" });
  removeProductVariantAction.mockReset().mockResolvedValue({ status: "success" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VariantsCard", () => {
  it("starts with an invitation to add options, then shows one option row", () => {
    render(<VariantsCard product={product()} t={en} locale="en" />);

    fireEvent.click(screen.getByRole("button", { name: t.addOptions }));

    expect(screen.getAllByLabelText(t.optionName)).toHaveLength(1);
    expect(screen.getAllByLabelText(t.optionValues)).toHaveLength(1);
  });

  it("previews how many variants the typed options add and remove", () => {
    render(<VariantsCard product={product()} t={en} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: t.addOptions }));

    fireEvent.change(screen.getByLabelText(t.optionName), { target: { value: "Size" } });
    fireEvent.change(screen.getByLabelText(t.optionValues), { target: { value: "S, M, L" } });

    expect(
      screen.getByText(t.matrixPreview.replace("{adds}", "2").replace("{removes}", "0")),
    ).toBeInTheDocument();
  });

  it("confirms before removing variants, and does not submit when cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<VariantsCard product={sized} t={en} locale="en" />);

    fireEvent.change(screen.getByLabelText(t.optionValues), { target: { value: "S, L" } });
    fireEvent.click(screen.getByRole("button", { name: t.saveOptions }));

    expect(confirm).toHaveBeenCalledWith(t.confirmRemoveVariants.replace("{count}", "1"));
    expect(saveProductOptionsAction).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: t.saveOptions }));
    await waitFor(() => expect(saveProductOptionsAction).toHaveBeenCalledTimes(1));
    const formData = saveProductOptionsAction.mock.calls[0]![1];
    expect(formData.get("productId")).toBe("p1");
    expect(formData.getAll("optionName")).toEqual(["Size"]);
    expect(formData.getAll("optionValues")).toEqual(["S, L"]);
  });

  it("lists one row per variant with its title, price, SKU and an edit button", () => {
    render(<VariantsCard product={sized} t={en} locale="en" />);

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText("S")).toBeInTheDocument();
    expect(within(rows[0]!).getByText(formatCurrency("en", 1999, "USD"))).toBeInTheDocument();
    expect(within(rows[0]!).getByText("SKU-S")).toBeInTheDocument();
    expect(within(rows[0]!).getByRole("button", { name: t.editVariant })).toBeInTheDocument();
  });

  it("calls a plain variant Default", () => {
    render(<VariantsCard product={product()} t={en} locale="en" />);
    expect(within(screen.getByRole("table")).getByText(t.defaultVariant)).toBeInTheDocument();
  });

  it("edits a variant in a dialog and closes it on success", async () => {
    render(<VariantsCard product={sized} t={en} locale="en" />);

    fireEvent.click(screen.getAllByRole("button", { name: t.editVariant })[1]!);
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText(t.price), { target: { value: "25.50" } });
    fireEvent.change(within(dialog).getByLabelText(t.barcode), { target: { value: "999" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t.save }));

    await waitFor(() => expect(updateVariantDetailsAction).toHaveBeenCalledTimes(1));
    const formData = updateVariantDetailsAction.mock.calls[0]![1];
    expect(formData.get("productId")).toBe("p1");
    expect(formData.get("variantId")).toBe("m");
    expect(formData.get("price")).toBe("25.50");
    expect(formData.get("barcode")).toBe("999");
    expect(formData.get("sku")).toBe("SKU-M");
    expect(formData.get("requiresShipping")).toBe("on");
    expect(formData.get("taxable")).toBe("on");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("offers Remove in the dialog only when the product has more than one variant", async () => {
    const { unmount } = render(<VariantsCard product={product()} t={en} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: t.editVariant }));
    const single = await screen.findByRole("dialog");
    expect(
      within(single).queryByRole("button", { name: en.productVariantsForm.remove }),
    ).not.toBeInTheDocument();
    unmount();

    render(<VariantsCard product={sized} t={en} locale="en" />);
    fireEvent.click(screen.getAllByRole("button", { name: t.editVariant })[0]!);
    const several = await screen.findByRole("dialog");
    expect(
      within(several).getByRole("button", { name: en.productVariantsForm.remove }),
    ).toBeInTheDocument();
  });

  it("stops offering more option rows at the limit of three", () => {
    const three = product({
      options: [
        { name: "A", values: ["1"] },
        { name: "B", values: ["1"] },
        { name: "C", values: ["1"] },
      ],
    });
    render(<VariantsCard product={three} t={en} locale="en" />);

    expect(screen.getByRole("button", { name: t.addAnotherOption })).toBeDisabled();
  });
});

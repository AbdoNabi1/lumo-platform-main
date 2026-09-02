import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import type { ProductVariantDto } from "@/lib/api/products";
import { ProductVariantsCard } from "./product-variants-card";

const addProductVariantAction =
  vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
const removeProductVariantAction =
  vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
const updateProductVariantAction =
  vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();

vi.mock("@/app/products/actions", () => ({
  addProductVariantAction: (previous: FormState, formData: FormData) =>
    addProductVariantAction(previous, formData),
  removeProductVariantAction: (previous: FormState, formData: FormData) =>
    removeProductVariantAction(previous, formData),
  updateProductVariantAction: (previous: FormState, formData: FormData) =>
    updateProductVariantAction(previous, formData),
}));

const variants: readonly ProductVariantDto[] = [
  { id: "variant-1", sku: "SKU-1", priceAmountMinor: 1999, currency: "USD", selection: null },
];

beforeEach(() => {
  addProductVariantAction.mockReset();
  removeProductVariantAction.mockReset();
  updateProductVariantAction.mockReset();
});

describe("ProductVariantsCard", () => {
  it("submits the add-variant form with the product id and typed fields", async () => {
    addProductVariantAction.mockResolvedValue({ status: "success" });
    render(<ProductVariantsCard productId="product-1" variants={[]} t={en} locale="en" />);

    fireEvent.change(screen.getByLabelText(en.productVariantsForm.sku), {
      target: { value: "SKU-2" },
    });
    fireEvent.change(screen.getByLabelText(en.productVariantsForm.price), {
      target: { value: "2500" },
    });
    fireEvent.change(screen.getByLabelText(en.productVariantsForm.currency), {
      target: { value: "USD" },
    });
    fireEvent.click(screen.getByRole("button", { name: en.productVariantsForm.add }));

    await waitFor(() => expect(addProductVariantAction).toHaveBeenCalledTimes(1));
    const [, formData] = addProductVariantAction.mock.calls[0] as [FormState, FormData];
    expect(formData.get("productId")).toBe("product-1");
    expect(formData.get("sku")).toBe("SKU-2");
  });

  it("renders a field error from the action next to the add-variant form", async () => {
    addProductVariantAction.mockResolvedValue({
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: { sku: "must not be empty" },
    });
    render(<ProductVariantsCard productId="product-1" variants={[]} t={en} locale="en" />);

    fireEvent.click(screen.getByRole("button", { name: en.productVariantsForm.add }));

    expect(await screen.findByText("Check the highlighted fields.")).toBeInTheDocument();
  });

  it("asks for confirmation before submitting a variant removal", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <ProductVariantsCard productId="product-1" variants={variants} t={en} locale="en" />,
    );

    fireEvent.click(screen.getByRole("button", { name: en.productVariantsForm.remove }));

    expect(confirmSpy).toHaveBeenCalledWith(en.productVariantsForm.confirmRemove);
    expect(removeProductVariantAction).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("toggles an inline edit row and submits the updated sku/price/currency", async () => {
    updateProductVariantAction.mockResolvedValue({ status: "success" });
    render(
      <ProductVariantsCard productId="product-1" variants={variants} t={en} locale="en" />,
    );

    fireEvent.click(screen.getByRole("button", { name: en.productVariantsForm.edit }));
    fireEvent.click(screen.getByRole("button", { name: en.productVariantsForm.save }));

    await waitFor(() => expect(updateProductVariantAction).toHaveBeenCalledTimes(1));
    const [, formData] = updateProductVariantAction.mock.calls[0] as [FormState, FormData];
    expect(formData.get("productId")).toBe("product-1");
    expect(formData.get("variantId")).toBe("variant-1");
    expect(formData.get("sku")).toBe("SKU-1");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import type { ProductDetailDto } from "@/lib/api/products";
import { ProductEditor } from "./product-editor";

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;
const saveProductAction = vi.fn<Action>();
const createProductAction = vi.fn<Action>();

vi.mock("@/app/products/actions", () => ({
  saveProductAction: (previous: FormState, formData: FormData) =>
    saveProductAction(previous, formData),
  createProductAction: (previous: FormState, formData: FormData) =>
    createProductAction(previous, formData),
}));

const single: ProductDetailDto = {
  id: "p1",
  sku: "P-ABC123",
  name: "Plush Bear",
  slug: "plush-bear",
  status: "draft",
  scheduledAt: null,
  brandId: null,
  categoryIds: [],
  options: [],
  seoTitle: null,
  seoDescription: null,
  description: "Soft and cuddly",
  productType: null,
  tags: ["toys"],
  mediaAssetIds: [],
  variants: [
    {
      id: "v1",
      sku: "SKU-1",
      priceAmountMinor: 15050,
      currency: "EGP",
      selection: null,
      compareAtAmountMinor: null,
      costAmountMinor: null,
      barcode: null,
      weightGrams: null,
      requiresShipping: true,
      taxable: true,
    },
  ],
};

const multi: ProductDetailDto = {
  ...single,
  options: [{ name: "Size", values: ["S", "M"] }],
  variants: [
    { ...single.variants[0]!, selection: { Size: "S" } },
    { ...single.variants[0]!, id: "v2", sku: "SKU-2", selection: { Size: "M" } },
  ],
};

const base = {
  brands: [],
  categories: [],
  defaultCurrency: "EGP",
  t: en,
  locale: "en",
  slots: {},
} as const;

const t = en.productEditor;

beforeEach(() => {
  saveProductAction.mockReset();
  createProductAction.mockReset();
  saveProductAction.mockResolvedValue({ status: "success" });
  createProductAction.mockResolvedValue({ status: "success" });
});

describe("ProductEditor", () => {
  it("submits every input joined to the one form, through the form= attribute", async () => {
    render(<ProductEditor mode="edit" product={single} {...base} />);

    fireEvent.change(screen.getByLabelText(t.title), { target: { value: "Plush Bear XL" } });
    fireEvent.click(screen.getByRole("button", { name: t.save }));

    await waitFor(() => expect(saveProductAction).toHaveBeenCalledTimes(1));
    const formData = saveProductAction.mock.calls[0]![1];
    expect(formData.get("title")).toBe("Plush Bear XL");
    expect(formData.get("price")).toBe("150.50");
    expect(formData.get("productId")).toBe("p1");
    expect(formData.get("variantId")).toBe("v1");
    expect(formData.get("hasVariantFields")).toBe("1");
    expect(formData.get("tags")).toBe("toys");
  });

  it("shows a note instead of the price cards when the product has variants", () => {
    const { container } = render(<ProductEditor mode="edit" product={multi} {...base} />);

    expect(screen.queryByLabelText(t.price)).not.toBeInTheDocument();
    expect(container.querySelector('input[name="hasVariantFields"]')).toBeNull();
    expect(screen.getByText(t.pricesOnVariants)).toBeInTheDocument();
  });

  it("marks the field the server rejected and shows its message next to it", async () => {
    saveProductAction.mockResolvedValue({
      status: "error",
      message: "Please check the highlighted fields.",
      fieldErrors: { price: "Enter a valid price" },
    });
    render(<ProductEditor mode="edit" product={single} {...base} />);

    fireEvent.click(screen.getByRole("button", { name: t.save }));

    expect(await screen.findByText("Enter a valid price")).toBeInTheDocument();
    expect(screen.getByLabelText(t.price)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the highlighted fields.");
  });

  it("flags unsaved changes once anything is typed", () => {
    render(<ProductEditor mode="edit" product={single} {...base} />);
    expect(screen.queryByText(t.unsaved)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(t.barcode), { target: { value: "123" } });

    expect(screen.getByText(t.unsaved)).toBeInTheDocument();
  });

  it("ignores typing in cards that submit their own forms", () => {
    render(
      <ProductEditor
        mode="edit"
        product={single}
        {...base}
        slots={{ variants: <input aria-label="option values" /> }}
      />,
    );

    fireEvent.change(screen.getByLabelText("option values"), { target: { value: "S, M" } });

    expect(screen.queryByText(t.unsaved)).not.toBeInTheDocument();
  });

  it("creates through createProductAction with its own button label", async () => {
    render(<ProductEditor mode="create" product={null} {...base} />);

    fireEvent.change(screen.getByLabelText(t.title), { target: { value: "New thing" } });
    fireEvent.change(screen.getByLabelText(t.price), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: t.create }));

    await waitFor(() => expect(createProductAction).toHaveBeenCalledTimes(1));
    expect(saveProductAction).not.toHaveBeenCalled();
    const formData = createProductAction.mock.calls[0]![1];
    expect(formData.get("title")).toBe("New thing");
    expect(formData.get("hasVariantFields")).toBe("1");
    expect(formData.get("productId")).toBeNull();
    expect(formData.get("status")).toBe("draft");
  });
});

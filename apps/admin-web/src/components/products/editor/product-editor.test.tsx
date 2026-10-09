import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import type { ProductDetailDto } from "@/lib/api/products";
import type { StockView } from "@/lib/products/stock";
import { ProductEditor } from "./product-editor";

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;
const saveProductAction = vi.fn<Action>();
const createProductAction = vi.fn<Action>();
const duplicateProductAction = vi.fn<Action>();

vi.mock("@/app/products/actions", () => ({
  saveProductAction: (previous: FormState, formData: FormData) =>
    saveProductAction(previous, formData),
  createProductAction: (previous: FormState, formData: FormData) =>
    createProductAction(previous, formData),
  duplicateProductAction: (previous: FormState, formData: FormData) =>
    duplicateProductAction(previous, formData),
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
      tracksInventory: true,
      inventoryPolicy: "deny",
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

const stock: StockView = {
  locations: [{ id: "w1", name: "Shop" }],
  defaultLocationId: "w1",
  readOnlyReason: null,
  byLocation: { w1: { v1: { onHand: 5, reserved: 0, available: 5 } } },
};

const base = {
  brands: [],
  categories: [],
  defaultCurrency: "EGP",
  t: en,
  locale: "en",
  stock,
  storefrontUrl: null,
  slots: {},
} as const;

const t = en.productEditor;

beforeEach(() => {
  saveProductAction.mockReset();
  createProductAction.mockReset();
  duplicateProductAction.mockReset();
  duplicateProductAction.mockResolvedValue({ status: "success" });
  saveProductAction.mockResolvedValue({ status: "success" });
  createProductAction.mockResolvedValue({ status: "success" });
});

afterEach(() => {
  vi.restoreAllMocks();
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
    // The options section and the inventory card join the same Save.
    expect(formData.get("optionsPresent")).toBe("1");
    expect(formData.get("tracksInventory")).toBe("on");
    expect(formData.get("available-w1")).toBe("5");
  });

  it("shows the variants table instead of the single-variant cards when the product has options", () => {
    const { container } = render(<ProductEditor mode="edit" product={multi} {...base} />);

    expect(screen.queryByLabelText(t.price)).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: t.inventoryTracked })).not.toBeInTheDocument();
    expect(screen.queryByText(t.shippingCard)).not.toBeInTheDocument();
    expect(container.querySelector('input[name="hasVariantFields"]')).toBeNull();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("shows the inventory card, and no separate stock card, for a product without options", () => {
    render(<ProductEditor mode="edit" product={single} {...base} />);

    expect(screen.getByRole("switch", { name: t.inventoryTracked })).toBeInTheDocument();
    expect(screen.getByLabelText(`${t.quantity}: Shop`)).toHaveValue(5);
    expect(screen.getAllByText(t.inventoryCard)).toHaveLength(1);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("swaps the single-variant cards for the table as soon as an option is typed", () => {
    const { container } = render(<ProductEditor mode="edit" product={single} {...base} />);

    fireEvent.click(screen.getByRole("button", { name: t.addOptions }));
    fireEvent.change(screen.getByLabelText(t.optionName), { target: { value: "Size" } });
    fireEvent.change(screen.getAllByLabelText(t.optionValue)[0]!, { target: { value: "S" } });

    expect(screen.queryByLabelText(t.price)).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: t.inventoryTracked })).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    // The server decides by the options it receives; the static marker stays harmless.
    expect(container.querySelector('input[name="hasVariantFields"]')).not.toBeNull();
  });

  it("has only the page's form and the Duplicate form, never nested, while no dialog is open", () => {
    const { container } = render(<ProductEditor mode="edit" product={multi} {...base} />);

    expect(container.querySelectorAll("form")).toHaveLength(2);
    expect(container.querySelector("form form")).toBeNull();
  });

  it("asks before saving a change that removes variants, and submits nothing when declined", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ProductEditor mode="edit" product={multi} {...base} />);
    fireEvent.click(screen.getAllByRole("button", { name: t.edit })[0]!);
    fireEvent.click(screen.getByRole("button", { name: t.removeValue.replace("{value}", "M") }));

    fireEvent.click(screen.getByRole("button", { name: t.save }));

    expect(confirm).toHaveBeenCalledWith(t.confirmRemoveVariants.replace("{count}", "1"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(saveProductAction).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    await waitFor(() => expect(saveProductAction).toHaveBeenCalledTimes(1));
    const formData = saveProductAction.mock.calls[0]![1];
    // The value being edited ends with a blank field; the server ignores blanks.
    expect(formData.getAll("optionValue-0").filter((value) => value !== "")).toEqual(["S"]);
    expect(formData.get("row-0-key")).toBe("Size=S");
  });

  it("does not ask when nothing is removed", async () => {
    const confirm = vi.spyOn(window, "confirm");
    render(<ProductEditor mode="edit" product={multi} {...base} />);

    fireEvent.click(screen.getByRole("button", { name: t.save }));

    await waitFor(() => expect(saveProductAction).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();
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
        slots={{ media: <input aria-label="media caption" /> }}
      />,
    );

    fireEvent.change(screen.getByLabelText("media caption"), { target: { value: "front" } });

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
    // A new product is tracked by default and can start with a quantity.
    expect(formData.get("tracksInventory")).toBe("on");
  });

  it("lets a new product start with a quantity on the shop location", () => {
    render(
      <ProductEditor
        mode="create"
        product={null}
        {...base}
        stock={{ locations: [], defaultLocationId: null, readOnlyReason: null, byLocation: {} }}
      />,
    );
    expect(screen.getByText(t.shopLocation)).toBeInTheDocument();
    expect(screen.getByLabelText(t.quantity)).toHaveValue(null);
    expect(screen.getByText(t.optionsAfterCreate)).toBeInTheDocument();
  });

  describe("Preview", () => {
    const previewOf = (status: string, storefrontUrl: string | null) =>
      render(
        <ProductEditor
          mode="edit"
          product={{ ...single, status }}
          {...base}
          storefrontUrl={storefrontUrl}
        />,
      );

    it.each(["published", "unlisted"])(
      "links a %s product to its page in the store, in a new tab",
      (status) => {
        previewOf(status, "https://shop.example.com");

        const link = screen.getByRole("link", { name: t.preview });
        expect(link).toHaveAttribute("href", "https://shop.example.com/products/plush-bear");
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
      },
    );

    it.each(["draft", "scheduled", "archived"])("is absent for a %s product", (status) => {
      previewOf(status, "https://shop.example.com");

      expect(screen.queryByRole("link", { name: t.preview })).not.toBeInTheDocument();
    });

    it("is absent when the store's address is not set", () => {
      previewOf("published", null);

      expect(screen.queryByRole("link", { name: t.preview })).not.toBeInTheDocument();
    });

    it("does not double the slash after a store address that ends with one", () => {
      previewOf("published", "https://shop.example.com/");

      expect(screen.getByRole("link", { name: t.preview })).toHaveAttribute(
        "href",
        "https://shop.example.com/products/plush-bear",
      );
    });

    it("is absent while creating", () => {
      render(
        <ProductEditor
          mode="create"
          product={null}
          {...base}
          storefrontUrl="https://shop.example.com"
        />,
      );

      expect(screen.queryByRole("link", { name: t.preview })).not.toBeInTheDocument();
    });
  });

  describe("Duplicate", () => {
    it("is a small form of its own, outside the page's form, that posts the product id", async () => {
      render(<ProductEditor mode="edit" product={single} {...base} />);

      const button = screen.getByRole("button", { name: t.duplicate });
      const form = button.closest("form");
      expect(form).not.toBeNull();
      expect(form!.id).not.toBe("product-editor");
      expect(form!.querySelector('input[name="productId"]')).toHaveValue("p1");

      fireEvent.click(button);

      await waitFor(() => expect(duplicateProductAction).toHaveBeenCalledTimes(1));
      expect(duplicateProductAction.mock.calls[0]![1].get("productId")).toBe("p1");
      expect(saveProductAction).not.toHaveBeenCalled();
    });

    it("shows the message when the copy could not be made", async () => {
      duplicateProductAction.mockResolvedValue({
        status: "error",
        message: "Something went wrong.",
        fieldErrors: {},
      });
      render(<ProductEditor mode="edit" product={single} {...base} />);

      fireEvent.click(screen.getByRole("button", { name: t.duplicate }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    });

    it("is absent while creating", () => {
      render(<ProductEditor mode="create" product={null} {...base} />);

      expect(screen.queryByRole("button", { name: t.duplicate })).not.toBeInTheDocument();
    });

    it("does not count as an unsaved change", () => {
      render(<ProductEditor mode="edit" product={single} {...base} />);

      fireEvent.click(screen.getByRole("button", { name: t.duplicate }));

      expect(screen.queryByText(t.unsaved)).not.toBeInTheDocument();
    });
  });
});

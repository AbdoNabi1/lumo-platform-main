import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import type { CartActionResult } from "@/app/cart/actions";
import type { ProductSummary } from "@/lib/runtime-api";
import { VariantPicker } from "./variant-picker";

const addToCart =
  vi.fn<
    (
      productId: string,
      quantity: number,
      variantId: string | undefined,
      currency: string,
    ) => Promise<CartActionResult>
  >();
vi.mock("@/app/cart/actions", () => ({
  addToCart: (
    productId: string,
    quantity: number,
    variantId: string | undefined,
    currency: string,
  ) => addToCart(productId, quantity, variantId, currency),
}));

beforeEach(() => {
  addToCart.mockReset();
  addToCart.mockResolvedValue({ ok: true });
});

function shirt(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: "prod-shirt",
    sku: "SHIRT",
    name: "Shirt",
    slug: "shirt",
    status: "published",
    description: null,
    productType: null,
    tags: [],
    options: [{ name: "Size", values: ["S", "L"] }],
    variants: [
      {
        id: "v-s",
        sku: "SHIRT-S",
        priceAmountMinor: 10000,
        currency: "USD",
        selection: { Size: "S" },
        title: "S",
        compareAtAmountMinor: 14000,
      },
      {
        id: "v-l",
        sku: "SHIRT-L",
        priceAmountMinor: 12000,
        currency: "USD",
        selection: { Size: "L" },
        title: "L",
        compareAtAmountMinor: null,
      },
    ],
    ...overrides,
  };
}

describe("VariantPicker", () => {
  it("starts on each option's first value, follows the choice for the price, and adds THAT variant", async () => {
    render(<VariantPicker product={shirt()} outOfStock={false} t={en} locale="en" />);

    expect(screen.getByText("$100.00")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Choose Size"), { target: { value: "L" } });

    expect(screen.getByText("$120.00")).toBeInTheDocument();
    expect(screen.queryByText("$100.00")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: en.product.addToCart }));
    await waitFor(() => expect(addToCart).toHaveBeenCalledWith("prod-shirt", 1, "v-l", "USD"));
  });

  it("strikes through the chosen variant's own compare-at price, and only that one (Plan 2C-1)", () => {
    render(<VariantPicker product={shirt()} outOfStock={false} t={en} locale="en" />);

    // S has a compare-at price, L does not.
    expect(screen.getByText("$140.00").tagName).toBe("S");
    fireEvent.change(screen.getByLabelText("Choose Size"), { target: { value: "L" } });
    expect(screen.queryByText("$140.00")).not.toBeInTheDocument();
  });

  it("adds the default (first) variant without any interaction", async () => {
    render(<VariantPicker product={shirt()} outOfStock={false} t={en} locale="en" />);

    fireEvent.click(screen.getByRole("button", { name: en.product.addToCart }));

    await waitFor(() => expect(addToCart).toHaveBeenCalledWith("prod-shirt", 1, "v-s", "USD"));
  });

  it("a combination with no variant says so and disables add-to-cart", () => {
    const product = shirt({
      options: [
        { name: "Size", values: ["S", "L"] },
        { name: "Color", values: ["Red", "Blue"] },
      ],
      variants: [
        {
          id: "v-s-red",
          sku: "SHIRT-S-RED",
          priceAmountMinor: 10000,
          currency: "USD",
          selection: { Size: "S", Color: "Red" },
          title: "S / Red",
          compareAtAmountMinor: null,
        },
      ],
    });
    render(<VariantPicker product={product} outOfStock={false} t={en} locale="en" />);

    fireEvent.change(screen.getByLabelText("Choose Color"), { target: { value: "Blue" } });

    expect(screen.getByText(en.product.unavailableCombination)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: en.product.addToCart });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(addToCart).not.toHaveBeenCalled();
  });

  it("a product with no options shows its one price and adds that variant's id", async () => {
    const mug = shirt({
      id: "prod-mug",
      options: [],
      variants: [
        {
          id: "v-mug",
          sku: "MUG-STD",
          priceAmountMinor: 5000,
          currency: "USD",
          selection: null,
          title: null,
          compareAtAmountMinor: null,
        },
      ],
    });
    render(<VariantPicker product={mug} outOfStock={false} t={en} locale="en" />);

    expect(screen.getByText("$50.00")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en.product.addToCart }));
    await waitFor(() => expect(addToCart).toHaveBeenCalledWith("prod-mug", 1, "v-mug", "USD"));
  });

  it("takes its labels from the Arabic dictionary", () => {
    render(<VariantPicker product={shirt()} outOfStock={false} t={ar} locale="ar" />);

    expect(screen.getByLabelText("اختر Size")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ar.product.addToCart })).toBeInTheDocument();
  });

  it("is disabled when the product is out of stock", () => {
    render(<VariantPicker product={shirt()} outOfStock t={en} locale="en" />);

    expect(screen.getByRole("button", { name: en.product.addToCart })).toBeDisabled();
  });

  it("asks the shopper to choose when the server answers choose-variant", async () => {
    addToCart.mockResolvedValue({ ok: false, reason: "choose-variant" });
    render(<VariantPicker product={shirt()} outOfStock={false} t={en} locale="en" />);

    fireEvent.click(screen.getByRole("button", { name: en.product.addToCart }));

    expect(await screen.findByText(en.product.chooseVariant)).toBeInTheDocument();
  });
});

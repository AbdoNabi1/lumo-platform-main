import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { PublishedProduct } from "@/lib/catalog";
import type { CartActionResult } from "@/app/cart/actions";
import { ProductCard } from "./product-card";

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

const product: PublishedProduct = {
  id: "prod-1",
  sku: "SKU-1",
  name: "Wooden Blocks",
  slug: "wooden-blocks",
  status: "published",
  description: null,
  productType: null,
  tags: [],
  options: [],
  variants: [],
};

describe("ProductCard", () => {
  it("links to the product's own detail page (Home → Product Detail navigation)", () => {
    render(
      <ProductCard
        product={product}
        price={{
          status: "ok",
          amountMinor: 1999,
          currency: "USD",
          compareAtMinor: null,
          varies: false,
        }}
        availability={{ status: "ok", available: 4 }}
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByRole("link", { name: /wooden blocks/i })).toHaveAttribute(
      "href",
      "/products/wooden-blocks",
    );
  });

  it("renders the real resolved price, formatted as currency", () => {
    render(
      <ProductCard
        product={product}
        price={{
          status: "ok",
          amountMinor: 1999,
          currency: "USD",
          compareAtMinor: null,
          varies: false,
        }}
        availability={{ status: "unknown" }}
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByText("$19.99")).toBeInTheDocument();
  });

  it("shows an explicit 'unavailable' label rather than a fabricated price when none is published", () => {
    render(
      <ProductCard
        product={product}
        price={{ status: "unavailable" }}
        availability={{ status: "unknown" }}
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByText(en.product.priceUnavailable)).toBeInTheDocument();
    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
  });

  it("does not fabricate a price when the resolution is ambiguous (CPI-3)", () => {
    render(
      <ProductCard
        product={product}
        price={{ status: "ambiguous" }}
        availability={{ status: "unknown" }}
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByText(en.product.priceUnavailable)).toBeInTheDocument();
  });

  it("shows out-of-stock rather than hiding availability when the count is zero", () => {
    render(
      <ProductCard
        product={product}
        price={{ status: "unavailable" }}
        availability={{ status: "ok", available: 0 }}
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByText(en.product.outOfStock)).toBeInTheDocument();
  });

  it("shows an add-to-cart action when a price is resolved", () => {
    render(
      <ProductCard
        product={product}
        price={{
          status: "ok",
          amountMinor: 1999,
          currency: "USD",
          compareAtMinor: null,
          varies: false,
        }}
        availability={{ status: "ok", available: 4 }}
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByRole("button", { name: en.product.addToCart })).toBeEnabled();
  });

  it("omits the add-to-cart action entirely when no price is published — nothing to purchase at", () => {
    render(
      <ProductCard
        product={product}
        price={{ status: "unavailable" }}
        availability={{ status: "ok", available: 4 }}
        t={en}
        locale="en"
      />,
    );
    expect(screen.queryByRole("button", { name: en.product.addToCart })).not.toBeInTheDocument();
  });

  it("disables the add-to-cart action when out of stock", () => {
    render(
      <ProductCard
        product={product}
        price={{
          status: "ok",
          amountMinor: 1999,
          currency: "USD",
          compareAtMinor: null,
          varies: false,
        }}
        availability={{ status: "ok", available: 0 }}
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByRole("button", { name: en.product.addToCart })).toBeDisabled();
  });

  it("the product title link is not nested inside the add-to-cart button (no invalid interactive nesting)", () => {
    render(
      <ProductCard
        product={product}
        price={{
          status: "ok",
          amountMinor: 1999,
          currency: "USD",
          compareAtMinor: null,
          varies: false,
        }}
        availability={{ status: "ok", available: 4 }}
        t={en}
        locale="en"
      />,
    );
    const link = screen.getByRole("link", { name: /wooden blocks/i });
    const button = screen.getByRole("button", { name: en.product.addToCart });
    expect(link.contains(button)).toBe(false);
    expect(button.closest("a")).toBeNull();
  });

  it("shows 'From …' when the variants are priced differently (Plan 2C-1)", () => {
    render(
      <ProductCard
        product={product}
        price={{
          status: "ok",
          amountMinor: 10000,
          currency: "USD",
          compareAtMinor: null,
          varies: true,
        }}
        availability={{ status: "unknown" }}
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByText("From $100.00")).toBeInTheDocument();
  });

  it("strikes the compare-at price through beside the price (Plan 2C-1)", () => {
    render(
      <ProductCard
        product={product}
        price={{
          status: "ok",
          amountMinor: 1999,
          currency: "USD",
          compareAtMinor: 2999,
          varies: false,
        }}
        availability={{ status: "unknown" }}
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByText("$19.99")).toBeInTheDocument();
    expect(screen.getByText("$29.99").tagName).toBe("S");
  });
});

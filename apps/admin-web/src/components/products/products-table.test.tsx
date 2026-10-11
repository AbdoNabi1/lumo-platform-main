import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ProductListItemDto } from "@/lib/api/products";
import { en } from "@/messages/en";
import { ProductsTable } from "./products-table";

const row = (overrides: Partial<ProductListItemDto> = {}): ProductListItemDto => ({
  id: "p1",
  sku: "P-1",
  name: "Plush Bear",
  slug: "plush-bear",
  status: "published",
  variantCount: 1,
  priceAmountMinor: 15000,
  currency: "EGP",
  ...overrides,
});

const rowOf = (name: string) => screen.getByRole("row", { name: new RegExp(name) });

describe("ProductsTable thumbnails (Plan 2C-3)", () => {
  it("shows the featured image before the title, described by its alt text", () => {
    render(
      <ProductsTable
        products={[
          row({
            featuredImage: {
              id: "m1",
              url: "https://cdn.example.test/bear.webp",
              alt: "A brown bear",
              width: 10,
              height: 10,
            },
          }),
        ]}
        t={en}
        locale="en"
      />,
    );
    const img = within(rowOf("Plush Bear")).getByRole("img", { name: "A brown bear" });
    expect(img).toHaveAttribute("src", "https://cdn.example.test/bear.webp");
  });

  it("falls back to the product title when the image has no alt text", () => {
    render(
      <ProductsTable
        products={[
          row({
            featuredImage: {
              id: "m1",
              url: "https://cdn.example.test/b.webp",
              alt: null,
              width: null,
              height: null,
            },
          }),
        ]}
        t={en}
        locale="en"
      />,
    );
    expect(
      within(rowOf("Plush Bear")).getByRole("img", { name: "Plush Bear" }),
    ).toBeInTheDocument();
  });

  it("shows a placeholder, not an img, for a product without pictures — including an older API", () => {
    render(
      <ProductsTable
        products={[row({ featuredImage: null }), row({ id: "p2", name: "Plain Cup", sku: "P-2" })]}
        t={en}
        locale="en"
      />,
    );
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });
});

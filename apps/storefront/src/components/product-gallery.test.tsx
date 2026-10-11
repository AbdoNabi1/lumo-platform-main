import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { en } from "@/messages/en";
import type { ProductSummary } from "@/lib/runtime-api";
import { ProductGallery } from "./product-gallery";
import { ProductSelectionProvider } from "./product-selection";
import { VariantPicker } from "./variant-picker";

vi.mock("@/app/cart/actions", () => ({ addToCart: vi.fn() }));

const image = (id: string, alt: string | null = null) => ({
  id,
  url: `https://cdn.example.test/${id}.webp`,
  alt,
  width: 800,
  height: 800,
});
const media = [image("a", "Front"), image("b"), image("c", "Back")];

const main = () => screen.getByTestId("gallery-main");
const mainImage = () => within(main()).getByRole("img");
const thumbs = () => screen.queryAllByTestId(/^gallery-thumb-/);

describe("ProductGallery (Plan 2C-3)", () => {
  it("shows the first image large, server-rendered, and eagerly loaded", () => {
    render(<ProductGallery media={media} productName="Plush Bear" t={en} />);
    expect(mainImage()).toHaveAttribute("src", "https://cdn.example.test/a.webp");
    expect(mainImage()).toHaveAttribute("alt", "Front");
    expect(mainImage()).not.toHaveAttribute("loading", "lazy");
    expect(main().className).toContain("aspect-square");
    expect(mainImage().className).toContain("object-contain");
  });

  it("describes a picture with no alt text by the product name", () => {
    render(<ProductGallery media={[image("b")]} productName="Plush Bear" t={en} />);
    expect(mainImage()).toHaveAttribute("alt", "Plush Bear");
  });

  it("lists thumbnails below, lazily loaded, with the selected one ringed", () => {
    render(<ProductGallery media={media} productName="Plush Bear" t={en} />);
    expect(thumbs()).toHaveLength(3);
    for (const thumb of thumbs()) {
      expect(within(thumb).getByRole("img")).toHaveAttribute("loading", "lazy");
    }
    expect(screen.getByTestId("gallery-thumb-a")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("gallery-thumb-b")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("gallery-thumb-a").className).toContain("ring-2");
    expect(screen.getByTestId("gallery-thumbs").className).toContain("overflow-x-auto");
  });

  it("changes the large image when a thumbnail is clicked", () => {
    render(<ProductGallery media={media} productName="Plush Bear" t={en} />);
    fireEvent.click(screen.getByTestId("gallery-thumb-c"));
    expect(mainImage()).toHaveAttribute("src", "https://cdn.example.test/c.webp");
    expect(mainImage()).toHaveAttribute("alt", "Back");
    expect(screen.getByTestId("gallery-thumb-c")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("gallery-thumb-a")).not.toHaveAttribute("aria-current");
  });

  it("names each thumbnail button for screen readers", () => {
    render(<ProductGallery media={media} productName="Plush Bear" t={en} />);
    expect(
      screen.getByRole("button", {
        name: en.product.gallery.showImage.replace("{n}", "2").replace("{total}", "3"),
      }),
    ).toBeInTheDocument();
  });

  it("draws no thumbnail strip for a single picture", () => {
    render(<ProductGallery media={[media[0]!]} productName="Plush Bear" t={en} />);
    expect(thumbs()).toHaveLength(0);
  });

  it("draws a placeholder, not a broken image, when the product has no pictures", () => {
    render(<ProductGallery media={[]} productName="Plush Bear" t={en} />);
    expect(
      screen.queryAllByRole("img", { hidden: false }).filter((i) => i.tagName === "IMG"),
    ).toHaveLength(0);
    expect(screen.getByLabelText(en.product.gallery.noImage)).toBeInTheDocument();
    expect(thumbs()).toHaveLength(0);
  });
});

describe("ProductGallery follows the variant picker (Plan 2C-3)", () => {
  const product: ProductSummary = {
    id: "p1",
    sku: "P-1",
    name: "Plush Bear",
    slug: "plush-bear",
    status: "published",
    description: null,
    productType: null,
    tags: [],
    options: [{ name: "Size", values: ["S", "L"] }],
    variants: [
      {
        id: "v-s",
        sku: "S",
        priceAmountMinor: 1000,
        currency: "USD",
        selection: { Size: "S" },
        title: "S",
        compareAtAmountMinor: null,
        sellableWhenOutOfStock: true,
        imageId: null,
      },
      {
        id: "v-l",
        sku: "L",
        priceAmountMinor: 1200,
        currency: "USD",
        selection: { Size: "L" },
        title: "L",
        compareAtAmountMinor: null,
        sellableWhenOutOfStock: true,
        imageId: "c",
      },
    ],
    media,
  };

  function renderBoth() {
    return render(
      <ProductSelectionProvider>
        <ProductGallery media={media} productName="Plush Bear" t={en} />
        <VariantPicker product={product} availabilityByVariant={{}} t={en} locale="en" />
      </ProductSelectionProvider>,
    );
  }

  it("switches the large image to the picked variant's own picture", () => {
    renderBoth();
    expect(mainImage()).toHaveAttribute("src", "https://cdn.example.test/a.webp");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "L" } });

    expect(mainImage()).toHaveAttribute("src", "https://cdn.example.test/c.webp");
    expect(screen.getByTestId("gallery-thumb-c")).toHaveAttribute("aria-current", "true");
  });

  it("keeps the current image when the picked variant has none of its own", () => {
    renderBoth();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "L" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "S" } });
    expect(mainImage()).toHaveAttribute("src", "https://cdn.example.test/c.webp");
  });

  it("ignores a variant image that is not in the gallery", () => {
    const stale = {
      ...product,
      variants: [product.variants[0]!, { ...product.variants[1]!, imageId: "gone" }],
    };
    render(
      <ProductSelectionProvider>
        <ProductGallery media={media} productName="Plush Bear" t={en} />
        <VariantPicker product={stale} availabilityByVariant={{}} t={en} locale="en" />
      </ProductSelectionProvider>,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "L" } });
    expect(mainImage()).toHaveAttribute("src", "https://cdn.example.test/a.webp");
  });
});

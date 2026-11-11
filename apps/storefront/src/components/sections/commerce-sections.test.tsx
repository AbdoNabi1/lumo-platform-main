import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { PublicSection } from "@platform/storefront-content";
import type { SectionData } from "@/lib/section-data";
import { ar } from "@/messages/ar";
import { formatNumber } from "@/lib/format";
import { en } from "@/messages/en";

vi.mock("@/app/(store)/cart/actions", () => ({ addToCart: vi.fn() }));
vi.mock("@/lib/catalog", () => ({
  priceOf: () => ({ status: "unavailable" }),
  AvailabilityBook: { load: async () => null },
}));
const { Sections } = await import("./sections");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const lt = (text: string) => ({ ar: text, en: text });
const product = (n: number, slug = `product-${n}`) => ({
  id: `prod-${n}`,
  sku: `S${n}`,
  name: `Product ${n}`,
  slug,
  status: "published" as const,
  description: null,
  productType: null,
  tags: [],
  options: [],
  variants: [],
});
const coll = (n: number, over = {}) => ({
  id: id(100 + n),
  slug: `coll-${n}`,
  name: `Collection ${n}`,
  productCount: 3,
  image: null,
  ...over,
});

function show(
  section: PublicSection,
  data: SectionData | "error",
  opts: { mode?: "live" | "preview"; locale?: "ar" | "en" } = {},
) {
  const mode = opts.mode ?? "live";
  const locale = opts.locale ?? "ar";
  return render(
    <Sections
      sections={[section]}
      data={new Map([[section.id, data]])}
      availability={null}
      t={locale === "ar" ? ar : en}
      locale={locale}
      previewToken={mode === "preview" ? "tok" : null}
      mode={mode}
      eagerHeroId={null}
    />,
  );
}

const featuredProducts = (settings: object): PublicSection =>
  ({ id: id(1), type: "featured_products", settings }) as PublicSection;
const featuredCollection = (over = {}): PublicSection =>
  ({
    id: id(2),
    type: "featured_collection",
    settings: {
      collection: { id: id(50), slug: "summer", name: "Summer" },
      heading: lt("Summer picks"),
      productCount: 4,
      columns: 3,
      showViewAll: true,
      ...over,
    },
  }) as PublicSection;
const collectionList = (settings: object): PublicSection =>
  ({ id: id(3), type: "collection_list", settings }) as PublicSection;

beforeEach(() => {
  expect.hasAssertions();
});

describe("featured_products", () => {
  const newestSettings = { source: "newest", count: 4, heading: lt("Fresh"), columns: 3 };

  it("renders cards in the columnsClass grid under an h2 with dir=auto, in ar and en", () => {
    for (const locale of ["ar", "en"] as const) {
      const { container, unmount } = show(
        featuredProducts(newestSettings),
        { kind: "products", products: [product(1), product(2)] },
        { locale },
      );
      const h2 = screen.getByRole("heading", { level: 2, name: "Fresh" });
      expect(h2).toHaveAttribute("dir", "auto");
      const grid = container.querySelector(".grid");
      expect(grid).toHaveClass("grid-cols-2", "md:grid-cols-3");
      expect(within(grid as HTMLElement).getAllByRole("heading", { level: 3 })).toHaveLength(2);
      unmount();
    }
  });

  it("newest with no products shows the empty message (Ruling 14)", () => {
    show(featuredProducts(newestSettings), { kind: "products", products: [] });
    expect(screen.getByText(ar.home.productsEmpty)).toBeInTheDocument();
  });

  it("manual renders in the order given, and tolerates a repeated product", () => {
    const settings = { source: "manual", productIds: ["a"], heading: lt("Picks"), columns: 2 };
    show(featuredProducts(settings), {
      kind: "products",
      products: [product(2), product(1), product(2)],
    });
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Product 2",
      "Product 1",
      "Product 2",
    ]);
  });

  it("a manual grid with no products is omitted live and a placeholder in preview", () => {
    const settings = { source: "manual", productIds: ["a"], heading: lt("Picks"), columns: 2 };
    const empty: SectionData = { kind: "products", products: [] };
    const live = show(featuredProducts(settings), empty);
    expect(live.container).toBeEmptyDOMElement();
    live.unmount();
    const { container } = show(featuredProducts(settings), empty, { mode: "preview" });
    expect(container.querySelector(`[data-section-id="${id(1)}"]`)).toHaveTextContent(
      ar.sections.incompletePlaceholder,
    );
    expect(screen.queryByText(ar.home.productsEmpty)).toBeNull();
  });

  it("a heading only in Arabic shows in English too, and no heading renders no h2", () => {
    show(
      featuredProducts({ ...newestSettings, heading: { ar: "عنوان" } }),
      { kind: "products", products: [product(1)] },
      { locale: "en" },
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("عنوان");
    cleanup();
    show(featuredProducts({ ...newestSettings, heading: {} }), {
      kind: "products",
      products: [product(1)],
    });
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("product links are encoded: a hostile slug never makes an off-site or protocol-relative link", () => {
    const { container } = show(featuredProducts(newestSettings), {
      kind: "products",
      products: [product(1, "../..//evil.example"), product(2, "//evil.example")],
    });
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/products\/[^/]+$/);
    }
  });

  it("cards render with no image, an empty image url or a broken one without crashing", () => {
    show(featuredProducts(newestSettings), {
      kind: "products",
      products: [
        { ...product(1), featuredImage: { url: "", alt: null } },
        { ...product(2), featuredImage: { url: "javascript:alert(1)", alt: null } },
        { ...product(3), media: [] },
      ] as never,
    });
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);
    expect(document.querySelectorAll("img")).toHaveLength(0);
  });
});

describe("featured_collection", () => {
  const data: SectionData = { kind: "products", products: [product(1)] };

  it("shows View all linking to the collection only when showViewAll", () => {
    show(featuredCollection(), data);
    expect(screen.getByRole("link", { name: ar.sections.viewAll })).toHaveAttribute(
      "href",
      "/collections/summer",
    );
    cleanup();
    show(featuredCollection({ showViewAll: false }), data);
    expect(screen.queryByRole("link", { name: ar.sections.viewAll })).toBeNull();
  });

  it("keeps ?preview= on View all in preview", () => {
    show(featuredCollection(), data, { mode: "preview" });
    expect(screen.getByRole("link", { name: ar.sections.viewAll })).toHaveAttribute(
      "href",
      "/collections/summer?preview=tok",
    );
  });

  it("encodes the collection slug: no off-site link", () => {
    show(
      featuredCollection({ collection: { id: id(50), slug: "../..//evil.example", name: "X" } }),
      data,
    );
    const href = screen.getByRole("link", { name: ar.sections.viewAll }).getAttribute("href") ?? "";
    expect(href).toMatch(/^\/collections\/[^/]+$/);
  });
});

describe("featured_collection with no products", () => {
  it("is omitted live and an incomplete placeholder in preview", () => {
    const empty: SectionData = { kind: "products", products: [] };
    const live = show(featuredCollection(), empty);
    expect(live.container).toBeEmptyDOMElement();
    live.unmount();
    const { container } = show(featuredCollection(), empty, { mode: "preview" });
    expect(container.querySelector(`[data-section-id="${id(2)}"]`)).toHaveTextContent(
      ar.sections.incompletePlaceholder,
    );
    expect(screen.queryByText(ar.home.productsEmpty)).toBeNull();
  });
});

describe("collection_list", () => {
  it("all with no collections shows the empty message", () => {
    show(collectionList({ source: "all", heading: lt("All"), columns: 2 }), {
      kind: "collections",
      collections: [],
    });
    expect(screen.getByText(ar.home.collectionsEmpty)).toBeInTheDocument();
  });

  it("manual items show the image when given, omit the count when null, and may repeat", () => {
    const settings = { source: "manual", items: [], heading: lt("Chosen"), columns: 2 };
    const image = { url: "https://cdn.example/c.png", alt: "Cover", width: 10, height: 10 };
    const { container } = show(collectionList(settings), {
      kind: "collections",
      collections: [coll(1, { image, productCount: null }), coll(1, { productCount: 2 })],
    });
    expect(screen.getAllByRole("heading", { level: 3, name: "Collection 1" })).toHaveLength(2);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(
      screen.getAllByText(ar.collection.productCount.replace("{count}", formatNumber("ar", 2))),
    ).toHaveLength(1);
  });

  it("a collection with a hostile slug or a broken image still renders safely", () => {
    const { container } = show(collectionList({ source: "all", heading: lt("All"), columns: 2 }), {
      kind: "collections",
      collections: [coll(1, { slug: "../..//evil.example", image: { url: "", alt: null } })],
    });
    const href = container.querySelector("a")?.getAttribute("href") ?? "";
    expect(href).toMatch(/^\/collections\/[^/]+$/);
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });
});

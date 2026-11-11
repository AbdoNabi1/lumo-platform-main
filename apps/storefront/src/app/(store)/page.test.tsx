import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { PublicSection } from "@platform/storefront-content";
import type * as Homepage from "@/lib/homepage";
import type { SectionData } from "@/lib/section-data";
import { FALLBACK_SHELL, type StorefrontShell } from "@/lib/online-store";
import { ar } from "@/messages/ar";

const request = vi.hoisted(() => ({
  shell: null as StorefrontShell | null,
  token: null as string | null,
}));
vi.mock("@/lib/request-locale", () => ({
  getRequestShell: async () => request.shell,
  getRequestLocale: async () => "ar",
  getPreviewToken: async () => request.token,
}));

const book = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/catalog", () => ({
  AvailabilityBook: book,
  priceOf: () => ({ status: "unavailable" }),
}));
vi.mock("@/app/(store)/cart/actions", () => ({ addToCart: vi.fn() }));

const home = vi.hoisted(() => ({ getHomepage: vi.fn() }));
vi.mock("@/lib/homepage", async (original) => ({
  ...(await original<typeof Homepage>()),
  getHomepage: home.getHomepage,
}));

const sectionData = vi.hoisted(() => ({ loadSectionData: vi.fn() }));
vi.mock("@/lib/section-data", () => sectionData);
vi.mock("@/lib/runtime-api", () => ({ currentShopId: async () => "shop-1" }));

const { DEFAULT_HOME } = await import("@/lib/homepage");
const { default: Home } = await import("./page");

const product = (n: number) => ({
  id: `prod-${n}`,
  sku: `S${n}`,
  name: `Product ${n}`,
  slug: `product-${n}`,
  status: "published" as const,
  description: null,
  productType: null,
  tags: [],
  options: [],
  variants: [],
});
const collection = { id: "c-1", slug: "toys", name: "Toys", productCount: 2, image: null };

function defaultData(): Map<string, SectionData | "error"> {
  const [first, second] = DEFAULT_HOME.sections;
  return new Map<string, SectionData | "error">([
    [first!.id, { kind: "products", products: [product(1), product(2)] }],
    [second!.id, { kind: "collections", collections: [collection] }],
  ]);
}

async function renderHome(storeName: string, token: string | null = null) {
  request.shell = { ...FALLBACK_SHELL, storeName };
  request.token = token;
  return render(await Home());
}

beforeEach(() => {
  expect.hasAssertions();
  home.getHomepage.mockReset().mockResolvedValue(DEFAULT_HOME);
  sectionData.loadSectionData.mockReset().mockImplementation(async () => defaultData());
  book.load.mockReset().mockResolvedValue(null);
});

describe("Home page heading (review M-1)", () => {
  it("has one visually hidden h1 with the store name", async () => {
    await renderHome("متجر النور");
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("متجر النور");
    expect(heading).toHaveClass("sr-only");
    expect(heading.querySelector("bdi")).toHaveAttribute("dir", "auto");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("falls back to the page title when the shop has no name yet", async () => {
    await renderHome("");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(ar.home.title);
  });
});

describe("Home page sections", () => {
  it("the default homepage equals today's layout", async () => {
    const { container } = await renderHome("متجر النور");
    expect(container.querySelector("main")).toHaveClass("max-w-5xl", "gap-10");
    const headings = screen.getAllByRole("heading").map((h) => [h.tagName, h.textContent]);
    expect(headings.filter(([tag]) => tag !== "H3")).toEqual([
      ["H1", "متجر النور"],
      ["H2", "المنتجات"],
      ["H2", "المجموعات"],
    ]);
    const grids = container.querySelectorAll(".grid");
    expect(grids).toHaveLength(2);
    for (const grid of grids) expect(grid).toHaveClass("grid-cols-1", "sm:grid-cols-2");
    expect(within(grids[0] as HTMLElement).getAllByRole("heading", { level: 3 })).toHaveLength(2);
    expect(within(grids[1] as HTMLElement).getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(container.querySelector("[data-section-id]")).toBeNull();
  });

  it("has no Shop card and no Categories heading (Ruling 3)", async () => {
    await renderHome("متجر النور");
    expect(screen.queryByText("الفئات")).toBeNull();
    expect(screen.queryByText(ar.home.title)).toBeNull();
  });

  it("passes the preview token to getHomepage in a preview shell, and null in a live one", async () => {
    await renderHome("n", null);
    expect(home.getHomepage).toHaveBeenLastCalledWith(null);
    request.shell = { ...FALLBACK_SHELL, mode: "preview", storeName: "n" };
    request.token = "tok";
    render(await Home());
    expect(home.getHomepage).toHaveBeenLastCalledWith("tok");
  });

  it("a token the shell did not honour is not passed on", async () => {
    await renderHome("n", "tok");
    expect(home.getHomepage).toHaveBeenLastCalledWith(null);
  });

  it("loads the section data for this shop and the availability book once each", async () => {
    await renderHome("n");
    expect(sectionData.loadSectionData).toHaveBeenCalledTimes(1);
    expect(sectionData.loadSectionData).toHaveBeenCalledWith("shop-1", DEFAULT_HOME.sections);
    expect(book.load).toHaveBeenCalledTimes(1);
  });

  it("renders the preview frames when the home is a preview", async () => {
    const sections = DEFAULT_HOME.sections as readonly PublicSection[];
    home.getHomepage.mockResolvedValue({ mode: "preview", sections });
    request.shell = { ...FALLBACK_SHELL, mode: "preview", storeName: "n" };
    request.token = "tok";
    const { container } = render(await Home());
    expect(container.querySelectorAll("[data-section-id]")).toHaveLength(2);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SECTION_TYPES, type PublicSection } from "@platform/storefront-content";
import type { SectionData } from "@/lib/section-data";
import { ar } from "@/messages/ar";
import { GRID_COLUMNS, columnsClass } from "./section-styles";

vi.mock("@/app/(store)/cart/actions", () => ({ addToCart: vi.fn() }));
vi.mock("@/lib/catalog", () => ({
  priceOf: () => ({ status: "unavailable" }),
  AvailabilityBook: { load: async () => null },
}));
const { Sections } = await import("./sections");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const heading = (text: string) => ({ ar: text, en: text });
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
const newest = (n: number, extra: Partial<PublicSection> = {}): PublicSection =>
  ({
    id: id(n),
    type: "featured_products",
    settings: { source: "newest", count: 4, heading: heading(`Grid ${n}`), columns: 2 },
    ...extra,
  }) as PublicSection;
const productsData: SectionData = { kind: "products", products: [product(1)] };
const incompleteSection = (n: number): PublicSection =>
  ({ id: id(n), type: "featured_collection", incomplete: true }) as unknown as PublicSection;

function renderSections(
  sections: PublicSection[],
  data: Map<string, SectionData | "error">,
  mode: "live" | "preview" = "live",
) {
  return render(
    <Sections
      sections={sections}
      data={data}
      availability={null}
      t={ar}
      locale="ar"
      previewToken={mode === "preview" ? "tok" : null}
      mode={mode}
      eagerHeroId={null}
    />,
  );
}

beforeEach(() => {
  expect.hasAssertions();
});

describe("section styles (Ruling 16)", () => {
  it("are fixed class lookups that fall back to 2 columns", () => {
    expect(GRID_COLUMNS[2]).toBe("grid-cols-1 sm:grid-cols-2");
    expect(GRID_COLUMNS[3]).toBe("grid-cols-2 md:grid-cols-3");
    expect(GRID_COLUMNS[4]).toBe("grid-cols-2 md:grid-cols-4");
    expect(columnsClass(4)).toBe(GRID_COLUMNS[4]);
    for (const bad of [0, 1, 5, 2.5, Number.NaN, -3]) {
      expect(columnsClass(bad)).toBe(GRID_COLUMNS[2]);
    }
  });
});

describe("Sections", () => {
  it("renders nothing for a type it does not handle", () => {
    const unknown = {
      id: id(1),
      type: "announcement_bar",
      settings: {},
    } as unknown as PublicSection;
    const { container } = renderSections([unknown], new Map([[id(1), { kind: "none" }]]));
    expect(container).toBeEmptyDOMElement();
  });

  it("omits a section whose data is an error and still renders the others", () => {
    renderSections(
      [newest(1), newest(2)],
      new Map<string, SectionData | "error">([
        [id(1), "error"],
        [id(2), productsData],
      ]),
    );
    expect(screen.queryByRole("heading", { name: "Grid 1" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Grid 2" })).toBeInTheDocument();
  });

  it("in preview every section carries data-section-id and a hidden one shows only the placeholder", () => {
    const { container } = renderSections(
      [newest(1), newest(2, { hidden: true })],
      new Map([
        [id(1), productsData],
        [id(2), productsData],
      ]),
      "preview",
    );
    const frames = container.querySelectorAll("[data-section-id]");
    expect([...frames].map((f) => f.getAttribute("data-section-id"))).toEqual([id(1), id(2)]);
    expect(frames[1]).toHaveTextContent("قسم مخفي");
    expect(screen.queryByRole("heading", { name: "Grid 2" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Grid 1" })).toBeInTheDocument();
  });

  it("in preview a section whose data failed keeps its frame as a placeholder; live omits it", () => {
    const failed = new Map<string, SectionData | "error">([[id(1), "error"]]);
    const view = renderSections([newest(1)], failed, "preview");
    const frame = view.container.querySelector(`[data-section-id="${id(1)}"]`);
    expect(frame).toHaveTextContent(ar.sections.incompletePlaceholder);
    view.unmount();
    expect(renderSections([newest(1)], failed).container).toBeEmptyDOMElement();
  });

  it("labels a section by its heading", () => {
    const { container } = renderSections([newest(1)], new Map([[id(1), productsData]]));
    const labelled = container.querySelector("section");
    expect(labelled).toHaveAttribute("aria-labelledby", `${id(1)}-heading`);
    expect(container.querySelector(`#${CSS.escape(id(1))}-heading`)).not.toBeNull();
  });

  it("in preview an incomplete section is a dashed placeholder that keeps data-section-id (F2)", () => {
    const { container } = renderSections(
      [incompleteSection(3)],
      new Map([[id(3), { kind: "none" }]]),
      "preview",
    );
    const frame = container.querySelector(`[data-section-id="${id(3)}"]`);
    expect(frame).not.toBeNull();
    expect(frame).toHaveTextContent(ar.sections.incompletePlaceholder);
    expect(container.querySelector(".border-dashed")).not.toBeNull();
  });

  it("live shows no data-section-id and no placeholder, and drops hidden or incomplete ones", () => {
    const { container } = renderSections(
      [newest(1), newest(2, { hidden: true }), incompleteSection(3)],
      new Map<string, SectionData | "error">([
        [id(1), productsData],
        [id(2), productsData],
        [id(3), { kind: "none" }],
      ]),
    );
    expect(container.querySelector("[data-section-id]")).toBeNull();
    expect(container.textContent).not.toContain("قسم مخفي");
    expect(container.textContent).not.toContain(ar.sections.incompletePlaceholder);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
  });

  it("dispatches every Task 8 type to its own component: no type is silently dropped", () => {
    for (const type of ["featured_collection", "featured_products", "collection_list"]) {
      expect(SECTION_TYPES).toContain(type);
    }
    const sections = [
      newest(1),
      {
        id: id(2),
        type: "featured_collection",
        settings: {
          collection: { id: id(9), slug: "toys", name: "Toys" },
          heading: heading("FC"),
          productCount: 4,
          columns: 3,
          showViewAll: false,
        },
      },
      {
        id: id(3),
        type: "collection_list",
        settings: { source: "all", heading: heading("CL"), columns: 2 },
      },
    ] as PublicSection[];
    renderSections(
      sections,
      new Map<string, SectionData | "error">([
        [id(1), productsData],
        [id(2), productsData],
        [id(3), { kind: "collections", collections: [] }],
      ]),
    );
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Grid 1",
      "FC",
      "CL",
    ]);
  });
});

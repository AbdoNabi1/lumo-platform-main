import { beforeEach, describe, expect, it } from "vitest";
import { newSection, type KnownSection } from "@platform/storefront-content";
import type { ThemeTargetsDto } from "@/lib/api/online-store";
import { sectionProblems } from "./section-problems";

beforeEach(() => expect.hasAssertions());

type Bucket = Record<string, { title: string; live: boolean }>;
const ID = "00000000-0000-4000-8000-000000000901";
const targets = (
  over: Partial<Record<"collection" | "product" | "page", Bucket>> = {},
): ThemeTargetsDto => ({ collection: {}, product: {}, page: {}, ...over });

const withSettings = (type: KnownSection["type"], patch: Record<string, unknown>): KnownSection => {
  const s = newSection(type as "hero", ID);
  return { ...s, settings: { ...s.settings, ...patch } } as KnownSection;
};

describe("sectionProblems", () => {
  it("flags a removed collection, product, page and image", () => {
    expect(
      sectionProblems(withSettings("featured_collection", { collection: "c1" }), targets(), {}),
    ).toEqual(["removed_collection"]);
    expect(
      sectionProblems(
        withSettings("featured_products", { source: "manual", products: ["p1"] }),
        targets(),
        {},
      ),
    ).toEqual(["removed_product"]);
    expect(
      sectionProblems(
        withSettings("hero", { buttonLink: { type: "page", id: "pg" } }),
        targets(),
        {},
      ),
    ).toEqual(["removed_page"]);
    expect(sectionProblems(withSettings("hero", { image: "img-1" }), targets(), {})).toEqual([
      "removed_image",
    ]);
  });

  it("is quiet when everything resolves and is live", () => {
    const s = withSettings("hero", { image: "img-1", buttonLink: { type: "page", id: "pg" } });
    expect(
      sectionProblems(s, targets({ page: { pg: { title: "About", live: true } } }), {
        "img-1": { url: "u" },
      }),
    ).toEqual([]);
  });

  it("flags an unpublished target, distinct and in a fixed order", () => {
    const s = withSettings("featured_products", {
      source: "manual",
      products: ["p1", "p2", "p3"],
    });
    const t = targets({
      product: { p1: { title: "A", live: false }, p2: { title: "B", live: false } },
    });
    expect(sectionProblems(s, t, {})).toEqual(["removed_product", "unpublished_target"]);
    const both = withSettings("hero", { image: "i", buttonLink: { type: "collection", id: "c" } });
    expect(
      sectionProblems(both, targets({ collection: { c: { title: "C", live: true } } }), {}),
    ).toEqual(["removed_image"]);
    expect(sectionProblems(both, targets(), {})).toEqual(["removed_collection", "removed_image"]);
  });

  it("gives image problems only when targets is null", () => {
    const s = withSettings("hero", { image: "i", buttonLink: { type: "page", id: "pg" } });
    expect(sectionProblems(s, null, {})).toEqual(["removed_image"]);
  });

  it("never treats an inherited key as present", () => {
    const s = withSettings("hero", {
      image: "__proto__",
      buttonLink: { type: "page", id: "__proto__" },
    });
    expect(sectionProblems(s, targets(), {})).toEqual(["removed_page", "removed_image"]);
    const col = withSettings("featured_collection", { collection: "constructor" });
    expect(sectionProblems(col, targets(), {})).toEqual(["removed_collection"]);
  });

  it("ignores an unsupported section", () => {
    expect(
      sectionProblems(
        { id: ID, type: "future", hidden: false, settings: { image: "x" } },
        targets(),
        {},
      ),
    ).toEqual([]);
  });
});

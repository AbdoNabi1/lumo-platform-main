import { isKnownSection, sectionRefsOf, type Section } from "@platform/storefront-content";
import type { ThemeTargetsDto } from "@/lib/api/online-store";

/**
 * What is wrong with a section's references, for the editor's flags (Ruling 21). A pure function of
 * its inputs: the editor passes a `targets` map it has merged new picks into. Types only from
 * `lib/api`.
 *
 * Residual (F20): a product that exists but is not listed on the storefront still reads as present
 * and live here, though it will not appear in a grid; the editor cannot know that.
 */
export type SectionProblem =
  | "removed_collection"
  | "removed_product"
  | "removed_page"
  | "removed_image"
  | "unpublished_target";

const ORDER: readonly SectionProblem[] = [
  "removed_collection",
  "removed_product",
  "removed_page",
  "removed_image",
  "unpublished_target",
];

type TargetKind = "collection" | "product" | "page";

/** `Object.hasOwn`: an id may be `__proto__` or `constructor`, which are never present. */
function lookup<V>(record: Readonly<Record<string, V>>, id: string): V | undefined {
  return Object.hasOwn(record, id) ? record[id] : undefined;
}

/** Distinct, in the order of {@link ORDER}. A `null` targets gives no target problems. */
export function sectionProblems(
  section: Section,
  targets: ThemeTargetsDto | null,
  images: Readonly<Record<string, unknown>>,
): readonly SectionProblem[] {
  if (!isKnownSection(section)) return [];
  const refs = sectionRefsOf([section], "s");
  const found = new Set<SectionProblem>();
  if (targets !== null) {
    const removed: Readonly<Record<TargetKind, SectionProblem>> = {
      collection: "removed_collection",
      product: "removed_product",
      page: "removed_page",
    };
    for (const kind of ["collection", "product", "page"] as const) {
      for (const { id } of refs[kind]) {
        const target = lookup(targets[kind], id);
        if (target === undefined) found.add(removed[kind]);
        else if (!target.live) found.add("unpublished_target");
      }
    }
  }
  for (const { id } of refs.image) {
    if (lookup(images, id) === undefined) found.add("removed_image");
  }
  return ORDER.filter((problem) => found.has(problem));
}

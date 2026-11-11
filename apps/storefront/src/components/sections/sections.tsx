import type { ReactNode } from "react";
import type { PublicSection } from "@platform/storefront-content";
import type { AvailabilityBook } from "@/lib/catalog";
import type { Locale } from "@/lib/i18n";
import type { SectionData } from "@/lib/section-data";
import type { Dictionary } from "@/messages/en";
import { CollectionList } from "./collection-list";
import { FeaturedCollection } from "./featured-collection";
import { FeaturedProducts } from "./featured-products";
import { SectionFrame } from "./section-frame";

interface SectionsProps {
  readonly sections: readonly PublicSection[];
  readonly data: ReadonlyMap<string, SectionData | "error">;
  readonly availability: AvailabilityBook | null;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly previewToken: string | null;
  readonly mode: "live" | "preview";
  /** The first hero id: its picture loads eagerly (Task 9 uses it). */
  readonly eagerHeroId: string | null;
}

const NO_DATA: SectionData = { kind: "none" };
const HANDLED: ReadonlySet<string> = new Set([
  "featured_products",
  "featured_collection",
  "collection_list",
]);

/** The content of one complete section of a handled type. */
function contentOf(section: PublicSection, data: SectionData, props: SectionsProps): ReactNode {
  if (section.incomplete === true) return null;
  const { availability, t, locale, previewToken } = props;
  switch (section.type) {
    case "featured_products":
      return (
        <FeaturedProducts
          id={section.id}
          settings={section.settings}
          products={data.kind === "products" ? data.products : []}
          availability={availability}
          t={t}
          locale={locale}
        />
      );
    case "featured_collection":
      return (
        <FeaturedCollection
          id={section.id}
          settings={section.settings}
          products={data.kind === "products" ? data.products : []}
          availability={availability}
          t={t}
          locale={locale}
          previewToken={previewToken}
        />
      );
    case "collection_list":
      return (
        <CollectionList
          id={section.id}
          settings={section.settings}
          collections={data.kind === "collections" ? data.collections : []}
          t={t}
          locale={locale}
        />
      );
    default:
      return null;
  }
}

/**
 * A manual products grid whose picks are all unlisted has nothing to show: live omits it, preview
 * says it is unfinished (T6 carry).
 */
function isEmptyManualGrid(section: PublicSection, data: SectionData): boolean {
  return (
    section.incomplete !== true &&
    section.type === "featured_products" &&
    section.settings.source === "manual" &&
    data.kind === "products" &&
    data.products.length === 0
  );
}

/**
 * The homepage sections in order. A section whose data read failed is omitted and the rest still
 * render (Ruling 14). A type this renderer does not handle renders nothing. Task 9 extends the map.
 */
export function Sections(props: SectionsProps) {
  const { sections, data, t, mode } = props;
  const preview = mode === "preview";
  return (
    <>
      {sections.map((section) => {
        if (!HANDLED.has(section.type)) return null;
        const sectionData = data.get(section.id) ?? NO_DATA;
        if (sectionData === "error") return null;
        const emptyManual = isEmptyManualGrid(section, sectionData);
        if (emptyManual && !preview) return null;
        return (
          <SectionFrame
            key={section.id}
            id={section.id}
            hidden={section.hidden === true}
            incomplete={section.incomplete === true || emptyManual}
            preview={preview}
            t={t}
          >
            {contentOf(section, sectionData, props)}
          </SectionFrame>
        );
      })}
    </>
  );
}

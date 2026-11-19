import type { ReactNode } from "react";
import { isWhatsAppDigits, pickText, type PublicSection } from "@platform/storefront-content";
import type { AvailabilityBook } from "@/lib/catalog";
import type { Locale } from "@/lib/i18n";
import type { SectionData } from "@/lib/section-data";
import type { Dictionary } from "@/messages/en";
import { CollectionList } from "./collection-list";
import { FeaturedCollection } from "./featured-collection";
import { FeaturedProducts } from "./featured-products";
import { FeaturesSection } from "./features";
import { HeroSection } from "./hero";
import { ImageWithTextSection } from "./image-with-text";
import { RichTextSection } from "./rich-text-section";
import { SectionFrame } from "./section-frame";
import { TestimonialsSection } from "./testimonials";
import { WhatsAppCtaSection } from "./whatsapp-cta";

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
  "hero",
  "image_with_text",
  "rich_text",
  "testimonials",
  "features",
  "whatsapp_cta",
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
    case "hero":
      return (
        <HeroSection
          section={section}
          locale={locale}
          previewToken={previewToken}
          eager={section.id === props.eagerHeroId}
          t={t}
        />
      );
    case "image_with_text":
      return (
        <ImageWithTextSection section={section} locale={locale} previewToken={previewToken} t={t} />
      );
    case "rich_text":
      return (
        <RichTextSection section={section} locale={locale} previewToken={previewToken} t={t} />
      );
    case "testimonials":
      return <TestimonialsSection section={section} locale={locale} t={t} />;
    case "features":
      return <FeaturesSection section={section} locale={locale} t={t} />;
    case "whatsapp_cta":
      return <WhatsAppCtaSection section={section} locale={locale} t={t} />;
    default:
      return null;
  }
}

/**
 * A grid with nothing to show because of what the merchant picked: a manual products grid whose
 * picks are all unlisted, or a featured collection with no published products. Live omits it,
 * preview says it is unfinished (T6 carry). Shop-wide sources (newest, all collections) show their
 * empty message instead (Ruling 14).
 */
function isEmptyPickedGrid(section: PublicSection, data: SectionData): boolean {
  if (section.incomplete === true || data.kind !== "products" || data.products.length > 0) {
    return false;
  }
  return (
    section.type === "featured_collection" ||
    (section.type === "featured_products" && section.settings.source === "manual")
  );
}

/** The id of the heading this section renders, if it renders one. */
function headingIdOf(section: PublicSection, locale: Locale): string | undefined {
  if (section.incomplete === true) return undefined;
  switch (section.type) {
    case "featured_products":
    case "featured_collection":
    case "collection_list":
    case "image_with_text":
    case "rich_text":
    case "testimonials":
    case "features":
    case "whatsapp_cta":
      return pickText(section.settings.heading, locale) === null
        ? undefined
        : `${section.id}-heading`;
    default:
      return undefined;
  }
}

/**
 * The homepage sections in order. A section whose data read failed is omitted and the rest still
 * render (Ruling 14). A type this renderer does not handle renders nothing: the announcement bar
 * lives in the store chrome. An incomplete or hidden section of a handled type keeps its frame in
 * preview, so the editor can still focus it.
 */
export function Sections(props: SectionsProps) {
  const { sections, data, t, mode } = props;
  const preview = mode === "preview";
  return (
    <>
      {sections.map((section) => {
        if (!HANDLED.has(section.type)) return null;
        const sectionData = data.get(section.id) ?? NO_DATA;
        const failed = sectionData === "error";
        if (failed && !preview) return null;
        const shown = failed ? NO_DATA : sectionData;
        // Preview keeps the frame of a failed section so the editor can still focus it.
        const unfinished = failed || isEmptyPickedGrid(section, shown) || isUnrenderable(section);
        if (unfinished && !preview) return null;
        return (
          <SectionFrame
            key={section.id}
            id={section.id}
            hidden={section.hidden === true}
            incomplete={section.incomplete === true || unfinished}
            labelledBy={headingIdOf(section, props.locale)}
            preview={preview}
            t={t}
          >
            {contentOf(section, shown, props)}
          </SectionFrame>
        );
      })}
    </>
  );
}

/** A WhatsApp section whose digits fail the check: live drops it, preview says it is unfinished. */
function isUnrenderable(section: PublicSection): boolean {
  return (
    section.type === "whatsapp_cta" &&
    section.incomplete !== true &&
    !isWhatsAppDigits(section.settings.phone)
  );
}

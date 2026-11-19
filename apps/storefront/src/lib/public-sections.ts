import {
  CATALOG_REF_TEXT_MAX,
  CATALOG_SLUG_PATTERN,
  emptyFieldValue,
  HOMEPAGE_SECTIONS_MAX,
  isWhatsAppDigits,
  LINK_TARGET_ID_PATTERN,
  normalizePlainText,
  pickText,
  safeHref,
  SECTION_ID_PATTERN,
  sectionDefinition,
  type CompletePublicSection,
  type FeatureIcon,
  type FieldDescriptor,
  type LocalizedText,
  type PublicAnnouncement,
  type PublicButton,
  type PublicCollectionRef,
  type PublicLink,
  type PublicSection,
  type SectionType,
} from "@platform/storefront-content";
import { clip, imageOf, textOf } from "./sanitize";

/**
 * Part 3 (spec Security "Content", Ruling 13): the storefront re-validates every section the
 * Runtime sends, whatever it claims. Texts are normalised and capped, links pass `safeHref` with
 * `external` recomputed, images must be `https:`, collection slugs must be catalog slugs (F5),
 * WhatsApp digits are re-checked, and numbers and enums are checked against the section's own
 * descriptors, falling back to its defaults (F15). Every limit comes from the package (GC 7).
 *
 * A section whose required content is gone after the re-check is null live; in preview it becomes
 * the `incomplete` placeholder (F2), so the editor's focus message still finds it.
 */

type Mode = "live" | "preview";
type Raw = Record<string, unknown>;
type PublicSettings = CompletePublicSection["settings"];

const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/** An own property only: an inherited `constructor` or `__proto__` is never a value. */
const own = (raw: Raw, key: string): unknown => (Object.hasOwn(raw, key) ? raw[key] : undefined);
/** "No text" means neither locale has any (Ruling 13). */
const hasText = (text: LocalizedText): boolean => pickText(text, "ar") !== null;

function descriptor(fields: readonly FieldDescriptor[], key: string): FieldDescriptor {
  const found = fields.find((field) => field.key === key);
  if (found === undefined) throw new Error(`storefront sections: no field "${key}"`);
  return found;
}

/** A field's `max` from its descriptor: never a hand copy (GC 7, F12). */
function maxOf(fields: readonly FieldDescriptor[], key: string): number {
  const field = descriptor(fields, key);
  if (!("max" in field)) throw new Error(`storefront sections: field "${key}" has no max`);
  return field.max;
}

/** Reads one settings object against its descriptors; an invalid value is the fallback's. */
class SettingsReader {
  constructor(
    readonly fields: readonly FieldDescriptor[],
    private readonly raw: Raw,
    private readonly fallback: Raw,
  ) {}

  value(key: string): unknown {
    return own(this.raw, key);
  }

  private fallbackOf(key: string): unknown {
    return Object.hasOwn(this.fallback, key)
      ? this.fallback[key]
      : emptyFieldValue(descriptor(this.fields, key));
  }

  text(key: string, multiline = false): LocalizedText {
    return textOf(this.value(key), maxOf(this.fields, key), multiline);
  }

  number(key: string): number {
    const field = descriptor(this.fields, key);
    const value = this.value(key);
    const valid =
      field.kind === "number" &&
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= field.min &&
      value <= field.max &&
      (value - field.min) % field.step === 0;
    return valid ? value : (this.fallbackOf(key) as number);
  }

  select<T extends string>(key: string): T {
    const field = descriptor(this.fields, key);
    const value = this.value(key);
    return field.kind === "select" && typeof value === "string" && field.options.includes(value)
      ? (value as T)
      : (this.fallbackOf(key) as T);
  }

  boolean(key: string): boolean {
    const value = this.value(key);
    return typeof value === "boolean" ? value : (this.fallbackOf(key) as boolean);
  }

  /** An `items` field: at most its `max` entries, each read against the item descriptors. */
  items(key: string): SettingsReader[] {
    const field = descriptor(this.fields, key);
    const value = this.value(key);
    if (field.kind !== "items" || !Array.isArray(value)) return [];
    const empty = Object.fromEntries(field.fields.map((f) => [f.key, emptyFieldValue(f)]));
    return value
      .slice(0, field.max)
      .map((entry) => new SettingsReader(field.fields, isRecord(entry) ? entry : {}, empty));
  }

  /** A plain-text field (the testimonial author): normalised and capped, else "". */
  plain(key: string): string {
    const value = this.value(key);
    return typeof value === "string"
      ? clip(normalizePlainText(value), maxOf(this.fields, key))
      : "";
  }
}

/** `{ href, external }` through `safeHref`: the href canonical, `external` recomputed; else null. */
function linkOf(raw: unknown): PublicLink | null {
  if (!isRecord(raw)) return null;
  const safe = safeHref(own(raw, "href"));
  return safe === null ? null : { href: safe.href, external: safe.external };
}

/** A label with text and a safe link: both, or no button. */
function buttonOf(raw: unknown, labelMax: number): PublicButton | null {
  if (!isRecord(raw)) return null;
  const label = textOf(own(raw, "label"), labelMax);
  if (!hasText(label)) return null;
  const link = linkOf(own(raw, "link"));
  return link === null ? null : { label, link };
}

/** A catalog id, a catalog slug (F5) and a name; the name is normalised and clipped. */
function collectionRefOf(raw: unknown): PublicCollectionRef | null {
  if (!isRecord(raw)) return null;
  const id = own(raw, "id");
  const slug = own(raw, "slug");
  const name = own(raw, "name");
  if (typeof id !== "string" || !LINK_TARGET_ID_PATTERN.test(id)) return null;
  if (
    typeof slug !== "string" ||
    slug.length > CATALOG_REF_TEXT_MAX ||
    !CATALOG_SLUG_PATTERN.test(slug)
  ) {
    return null;
  }
  if (typeof name !== "string") return null;
  return { id, slug, name: clip(normalizePlainText(name), CATALOG_REF_TEXT_MAX) };
}

/**
 * Malformed ids are dropped. A list longer than the field's `max`, or with a duplicate, falls back
 * whole to no ids: it is never silently cut (T1).
 */
function productIdsOf(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw) || raw.length > max) return [];
  const ids = raw.filter(
    (id): id is string => typeof id === "string" && LINK_TARGET_ID_PATTERN.test(id),
  );
  return new Set(ids).size === ids.length ? ids : [];
}

/** Ruling 13, type by type, on the re-checked values: the public settings, or null to drop it. */
function settingsOf(type: SectionType, raw: Raw): PublicSettings | null {
  const definition = sectionDefinition(type);
  if (definition === null) return null;
  const fields = definition.fields;
  const r = new SettingsReader(fields, raw, definition.defaults() as unknown as Raw);
  const button = (): PublicButton | null =>
    buttonOf(r.value("button"), maxOf(fields, "buttonLabel"));
  switch (type) {
    case "announcement_bar": {
      const text = r.text("text");
      if (!hasText(text)) return null;
      return { text, link: linkOf(r.value("link")), style: r.select("style") };
    }
    case "hero": {
      const image = imageOf(r.value("image"));
      const heading = r.text("heading");
      const subheading = r.text("subheading");
      const cta = button();
      if (image === null && !hasText(heading) && !hasText(subheading) && cta === null) return null;
      return {
        image,
        mobileImage: imageOf(r.value("mobileImage")),
        heading,
        subheading,
        button: cta,
        height: r.select("height"),
        contentAlign: r.select("contentAlign"),
        overlay: r.number("overlay"),
      };
    }
    case "featured_collection": {
      const collection = collectionRefOf(r.value("collection"));
      if (collection === null) return null;
      return {
        collection,
        heading: r.text("heading"),
        productCount: r.number("productCount"),
        columns: r.number("columns"),
        showViewAll: r.boolean("showViewAll"),
      };
    }
    case "featured_products": {
      const heading = r.text("heading");
      const columns = r.number("columns");
      // Ruling 7: an unknown source reads as the default one (newest).
      if (r.select("source") !== "manual") {
        return { source: "newest", count: r.number("count"), heading, columns };
      }
      const productIds = productIdsOf(r.value("productIds"), maxOf(fields, "products"));
      if (productIds.length === 0) return null;
      return { source: "manual", productIds, heading, columns };
    }
    case "collection_list": {
      const heading = r.text("heading");
      const columns = r.number("columns");
      if (r.select("source") !== "manual") return { source: "all", heading, columns };
      const items = r.items("items").flatMap((item) => {
        const collection = collectionRefOf(item.value("collection"));
        return collection === null ? [] : [{ collection, image: imageOf(item.value("image")) }];
      });
      if (items.length === 0) return null;
      return { source: "manual", items, heading, columns };
    }
    case "image_with_text": {
      const image = imageOf(r.value("image"));
      const heading = r.text("heading");
      const body = r.text("body", true);
      const cta = button();
      if (image === null && !hasText(heading) && !hasText(body) && cta === null) return null;
      return { image, heading, body, button: cta, imagePosition: r.select("imagePosition") };
    }
    case "rich_text": {
      const heading = r.text("heading");
      const body = r.text("body", true);
      const cta = button();
      if (!hasText(heading) && !hasText(body) && cta === null) return null;
      return { heading, body, button: cta, align: r.select("align") };
    }
    case "testimonials": {
      const items = r
        .items("items")
        .map((item) => ({
          quote: item.text("quote"),
          author: item.plain("author"),
          rating: item.number("rating"),
        }))
        .filter((item) => hasText(item.quote));
      if (items.length === 0) return null;
      return { heading: r.text("heading"), items };
    }
    case "features": {
      const items = r
        .items("items")
        .map((item) => ({
          icon: item.select<FeatureIcon>("icon"),
          title: item.text("title"),
          text: item.text("text"),
        }))
        .filter((item) => hasText(item.title) || hasText(item.text));
      if (items.length === 0) return null;
      return { heading: r.text("heading"), items };
    }
    case "whatsapp_cta": {
      const phone = r.value("phone");
      if (!isWhatsAppDigits(phone)) return null;
      return {
        heading: r.text("heading"),
        text: r.text("text"),
        buttonLabel: r.text("buttonLabel"),
        phone,
        message: r.text("message"),
      };
    }
  }
}

/**
 * One section as the storefront may render it, or null.
 * - The envelope: a uuid `id` and a known `type`; anything else is null.
 * - Live: a section labelled `hidden` or `incomplete` is null, and `hidden` is never kept.
 * - Preview: `hidden` is kept, as `hidden === true` (T6 always sends a boolean); an `incomplete`
 *   section, or one that fails the re-check, is the `{ id, type, hidden, incomplete }` placeholder.
 */
export function readPublicSection(raw: unknown, mode: Mode): PublicSection | null {
  if (!isRecord(raw)) return null;
  const id = own(raw, "id");
  const type = own(raw, "type");
  if (typeof id !== "string" || !SECTION_ID_PATTERN.test(id) || typeof type !== "string") {
    return null;
  }
  const definition = sectionDefinition(type);
  if (definition === null) return null;
  const known = definition.type;
  const hidden = own(raw, "hidden") === true;
  const incomplete = own(raw, "incomplete") === true;
  const rawSettings = own(raw, "settings");
  const settings =
    incomplete || !isRecord(rawSettings) || (mode === "live" && hidden)
      ? null
      : settingsOf(known, rawSettings);
  if (mode === "live") {
    return settings === null ? null : ({ id, type: known, settings } as PublicSection);
  }
  return (
    settings === null
      ? { id, type: known, hidden, incomplete: true }
      : { id, type: known, hidden, settings }
  ) as PublicSection;
}

/** The header's bar: a complete `announcement_bar` read in the body's mode, else null. */
export function readPublicAnnouncement(raw: unknown, mode: Mode): PublicAnnouncement | null {
  const section = readPublicSection(raw, mode);
  return section !== null && section.type === "announcement_bar" && section.incomplete !== true
    ? section
    : null;
}

/**
 * The homepage's sections, in order: at most `HOMEPAGE_SECTIONS_MAX`, homepage types only (an
 * unknown or header type is skipped), each id once, and each type within its `maxPerPage`.
 */
export function readPublicSections(raw: unknown, mode: Mode): readonly PublicSection[] {
  if (!Array.isArray(raw)) return [];
  const sections: PublicSection[] = [];
  const seen = new Set<string>();
  const perType = new Map<string, number>();
  for (const entry of raw.slice(0, HOMEPAGE_SECTIONS_MAX)) {
    const section = readPublicSection(entry, mode);
    if (section === null || seen.has(section.id)) continue;
    const definition = sectionDefinition(section.type);
    if (definition === null || definition.placement !== "homepage") continue;
    const used = perType.get(section.type) ?? 0;
    if (definition.maxPerPage !== null && used >= definition.maxPerPage) continue;
    seen.add(section.id);
    perType.set(section.type, used + 1);
    sections.push(section);
  }
  return sections;
}

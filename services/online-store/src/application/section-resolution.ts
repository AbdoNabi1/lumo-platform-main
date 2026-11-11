import {
  isKnownSection,
  isWhatsAppDigits,
  pickText,
  sectionDefinition,
  sectionRefsOf,
  type CompletePublicSection,
  type FieldDescriptor,
  type KnownSection,
  type LinkRef,
  type LocalizedText,
  type PolicyType,
  type PublicButton,
  type PublicCollectionRef,
  type PublicImage,
  type PublicSection,
  type Section,
  type SectionRef,
} from "@platform/storefront-content";
import { logger } from "@platform/utils";
import type { OnlineStoreDeps } from "./deps";
import { emptyTargets, resolveLinkRef, targetOf } from "./menu-resolution";
import type { CatalogLinkType, ImageDto, LinkTargetMap } from "./ports";

/** Everything a section's references resolve against: one read of each, for the whole page. */
export interface ResolutionContext {
  /** Look up with `Object.hasOwn` only: an image id may be `__proto__`. */
  readonly images: Readonly<Record<string, ImageDto>>;
  readonly targets: LinkTargetMap;
  readonly setPolicies: ReadonlySet<PolicyType>;
}

export type ResolutionMode = "live" | "preview";

type Raw = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const distinct = (refs: readonly SectionRef[]): string[] => [...new Set(refs.map((ref) => ref.id))];

/** Whether any link field (items included) of these settings names a policy. */
function namesPolicy(fields: readonly FieldDescriptor[], values: Raw): boolean {
  return fields.some((field) => {
    const value = Object.hasOwn(values, field.key) ? values[field.key] : undefined;
    if (field.kind === "link") {
      return isRecord(value) && Object.hasOwn(value, "type") && value.type === "policy";
    }
    if (field.kind === "items" && Array.isArray(value)) {
      return value.some((entry) => isRecord(entry) && namesPolicy(field.fields, entry));
    }
    return false;
  });
}

/**
 * What resolving these sections needs: distinct image ids, distinct target ids per kind, and
 * whether any link is a policy link. Known sections only: an unknown type is never looked up.
 */
export function resolutionInputsOf(sections: readonly Section[]): {
  readonly imageIds: readonly string[];
  readonly targets: Readonly<Record<CatalogLinkType, readonly string[]>>;
  readonly needsPolicies: boolean;
} {
  const refs = sectionRefsOf(sections, "homepage.sections");
  const needsPolicies = sections.some((section) => {
    const definition = sectionDefinition(section.type);
    return definition !== null && namesPolicy(definition.fields, section.settings as Raw);
  });
  return {
    imageIds: distinct(refs.image),
    targets: {
      collection: distinct(refs.collection),
      product: distinct(refs.product),
      page: distinct(refs.page),
    },
    needsPolicies,
  };
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * One image read, one target read and one policy list, in parallel, each with the request's
 * tenant and each only when something needs it. Each degrades on its own and is logged with the
 * tenant and the message only: a failed image read is no images, a failed target read is no
 * targets, and a failed policy list is no set policy.
 */
export async function loadResolutionContext(
  deps: Pick<OnlineStoreDeps, "imageRefs" | "linkTargets" | "policies">,
  sections: readonly Section[],
  tenantId: string,
): Promise<ResolutionContext> {
  const inputs = resolutionInputsOf(sections);
  const warn = (what: string, error: unknown): void => {
    logger.warn(`storefront home: ${what} unavailable`, { tenantId, error: messageOf(error) });
  };
  const loadImages = async (): Promise<Readonly<Record<string, ImageDto>>> => {
    if (inputs.imageIds.length === 0) return {};
    try {
      return await deps.imageRefs.resolve(inputs.imageIds, tenantId);
    } catch (error) {
      warn("images", error);
      return {};
    }
  };
  const loadTargetMap = async (): Promise<LinkTargetMap> => {
    const ids = inputs.targets;
    if (ids.collection.length + ids.product.length + ids.page.length === 0) return emptyTargets();
    try {
      return await deps.linkTargets.resolve(ids, tenantId);
    } catch (error) {
      warn("link targets", error);
      return emptyTargets();
    }
  };
  const loadPolicies = async (): Promise<ReadonlySet<PolicyType>> => {
    if (!inputs.needsPolicies) return new Set();
    try {
      const policies = await deps.policies.list(tenantId);
      return new Set(
        policies.filter((policy) => policy.isSet).map((policy) => policy.snapshot().type),
      );
    } catch (error) {
      warn("policies", error);
      return new Set();
    }
  };
  const [images, targets, setPolicies] = await Promise.all([
    loadImages(),
    loadTargetMap(),
    loadPolicies(),
  ]);
  return { images, targets, setPolicies };
}

// --- copies: every output object is built field by field, never spread from stored settings ---

function textOf(text: LocalizedText): LocalizedText {
  const ar = typeof text.ar === "string" && text.ar.length > 0 ? text.ar : undefined;
  const en = typeof text.en === "string" && text.en.length > 0 ? text.en : undefined;
  return { ...(ar === undefined ? {} : { ar }), ...(en === undefined ? {} : { en }) };
}

/** "No text" means neither locale has any (Ruling 13). */
const hasText = (text: LocalizedText): boolean => pickText(text, "ar") !== null;

function imageOf(id: string | null, ctx: ResolutionContext): PublicImage | null {
  if (id === null || !Object.hasOwn(ctx.images, id)) return null;
  const image = ctx.images[id];
  if (image === undefined) return null;
  return { url: image.url, alt: image.alt, width: image.width, height: image.height };
}

/** Present, published and with a slug to link to: else no collection. */
function collectionOf(id: string | null, ctx: ResolutionContext): PublicCollectionRef | null {
  if (id === null) return null;
  const target = targetOf(ctx.targets, "collection", id);
  if (target === null || !target.published) return null;
  const slug = target.slug;
  if (typeof slug !== "string" || slug.length === 0) return null;
  return { id, slug, name: target.title };
}

/** Live products only, case-sensitive distinct, in the merchant's order. */
function liveProductIds(ids: readonly string[], ctx: ResolutionContext): string[] {
  const out: string[] = [];
  for (const id of new Set(ids)) {
    const target = targetOf(ctx.targets, "product", id);
    if (target !== null && target.published) out.push(id);
  }
  return out;
}

function linkOf(link: LinkRef | null, ctx: ResolutionContext) {
  return link === null ? null : resolveLinkRef(link, ctx.targets, ctx.setPolicies);
}

/** A label with text in either locale, and a live link: both, or no button. */
function buttonOf(
  label: LocalizedText,
  link: LinkRef | null,
  ctx: ResolutionContext,
): PublicButton | null {
  if (!hasText(label)) return null;
  const resolved = linkOf(link, ctx);
  return resolved === null ? null : { label: textOf(label), link: resolved };
}

type PublicSettings = CompletePublicSection["settings"];

/** Ruling 13, type by type: the public settings, or null when the live page drops the section. */
function settingsOf(section: KnownSection, ctx: ResolutionContext): PublicSettings | null {
  switch (section.type) {
    case "announcement_bar": {
      const s = section.settings;
      if (!hasText(s.text)) return null;
      return { text: textOf(s.text), link: linkOf(s.link, ctx), style: s.style };
    }
    case "hero": {
      const s = section.settings;
      const image = imageOf(s.image, ctx);
      const button = buttonOf(s.buttonLabel, s.buttonLink, ctx);
      // The picture is drawn from the desktop image; a mobile image alone shows nothing.
      if (image === null && !hasText(s.heading) && !hasText(s.subheading) && button === null) {
        return null;
      }
      return {
        image,
        mobileImage: imageOf(s.mobileImage, ctx),
        heading: textOf(s.heading),
        subheading: textOf(s.subheading),
        button,
        height: s.height,
        contentAlign: s.contentAlign,
        overlay: s.overlay,
      };
    }
    case "featured_collection": {
      const s = section.settings;
      const collection = collectionOf(s.collection, ctx);
      if (collection === null) return null;
      return {
        collection,
        heading: textOf(s.heading),
        productCount: s.productCount,
        columns: s.columns,
        showViewAll: s.showViewAll,
      };
    }
    case "featured_products": {
      const s = section.settings;
      if (s.source !== "manual") {
        return { source: "newest", count: s.count, heading: textOf(s.heading), columns: s.columns };
      }
      const productIds = liveProductIds(s.products, ctx);
      if (productIds.length === 0) return null;
      return { source: "manual", productIds, heading: textOf(s.heading), columns: s.columns };
    }
    case "collection_list": {
      const s = section.settings;
      if (s.source !== "manual") {
        return { source: "all", heading: textOf(s.heading), columns: s.columns };
      }
      const items = s.items.flatMap((item) => {
        const collection = collectionOf(item.collection, ctx);
        return collection === null ? [] : [{ collection, image: imageOf(item.image, ctx) }];
      });
      if (items.length === 0) return null;
      return { source: "manual", items, heading: textOf(s.heading), columns: s.columns };
    }
    case "image_with_text": {
      const s = section.settings;
      const image = imageOf(s.image, ctx);
      const button = buttonOf(s.buttonLabel, s.buttonLink, ctx);
      if (image === null && !hasText(s.heading) && !hasText(s.body) && button === null) {
        return null;
      }
      return {
        image,
        heading: textOf(s.heading),
        body: textOf(s.body),
        button,
        imagePosition: s.imagePosition,
      };
    }
    case "rich_text": {
      const s = section.settings;
      const button = buttonOf(s.buttonLabel, s.buttonLink, ctx);
      if (!hasText(s.heading) && !hasText(s.body) && button === null) return null;
      return { heading: textOf(s.heading), body: textOf(s.body), button, align: s.align };
    }
    case "testimonials": {
      const s = section.settings;
      const items = s.items
        .filter((item) => hasText(item.quote))
        .map((item) => ({ quote: textOf(item.quote), author: item.author, rating: item.rating }));
      if (items.length === 0) return null;
      return { heading: textOf(s.heading), items };
    }
    case "features": {
      const s = section.settings;
      const items = s.items
        .filter((item) => hasText(item.title) || hasText(item.text))
        .map((item) => ({ icon: item.icon, title: textOf(item.title), text: textOf(item.text) }));
      if (items.length === 0) return null;
      return { heading: textOf(s.heading), items };
    }
    case "whatsapp_cta": {
      const s = section.settings;
      if (!isWhatsAppDigits(s.phone)) return null;
      return {
        heading: textOf(s.heading),
        text: textOf(s.text),
        buttonLabel: textOf(s.buttonLabel),
        phone: s.phone,
        message: textOf(s.message),
      };
    }
    default:
      return null;
  }
}

/**
 * The public form of one section (spec 3.4, Ruling 13 with F2):
 * - an unknown type is never served, in either mode;
 * - live: a hidden section, or one the drop rules remove, is null; `hidden` is never sent;
 * - preview: every known section is kept and flagged `hidden`; one the live rules would drop is
 *   `{ id, type, hidden, incomplete: true }`, so the editor's focus still finds it.
 */
export function resolveSection(
  section: Section,
  ctx: ResolutionContext,
  mode: ResolutionMode,
): PublicSection | null {
  if (!isKnownSection(section)) return null;
  if (mode === "live" && section.hidden) return null;
  const settings = settingsOf(section, ctx);
  if (mode === "live") {
    return settings === null
      ? null
      : ({ id: section.id, type: section.type, settings } as PublicSection);
  }
  const base = { id: section.id, type: section.type, hidden: section.hidden };
  return (
    settings === null ? { ...base, incomplete: true } : { ...base, settings }
  ) as PublicSection;
}

/** In order; the dropped ones are skipped. */
export function resolveSections(
  sections: readonly Section[],
  ctx: ResolutionContext,
  mode: ResolutionMode,
): PublicSection[] {
  return sections.flatMap((section) => {
    const resolved = resolveSection(section, ctx, mode);
    return resolved === null ? [] : [resolved];
  });
}

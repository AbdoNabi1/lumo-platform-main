import { MAX_ISSUES, pathSegment } from "./issues";
import { pickText, type ContentIssue, type Locale, type LocalizedText } from "./locale";
import { ITEM_ID_PATTERN, SECTION_LIMITS } from "./limits";
import type { LinkRef } from "./menus";
import { RICH_TEXT_MAX } from "./rich-text";
import {
  collectFieldRefs,
  emptySectionRefs,
  readFields,
  validateFields,
  type FieldDescriptor,
  type SectionRefs,
} from "./section-fields";

type LT = LocalizedText;

export const SECTION_TYPES = [
  "announcement_bar",
  "hero",
  "featured_collection",
  "featured_products",
  "collection_list",
  "image_with_text",
  "rich_text",
  "testimonials",
  "features",
  "whatsapp_cta",
  "lead_form",
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

/**
 * The sections that sell products. A lead site's editor does not offer them (the add list only:
 * a section already on a page is never removed). Shared so the admin and the storefront agree.
 */
export const COMMERCE_SECTION_TYPES = [
  "featured_collection",
  "featured_products",
  "collection_list",
] as const satisfies readonly SectionType[];

export const FEATURE_ICONS = [
  "cod",
  "shipping",
  "returns",
  "support",
  "secure",
  "quality",
  "gift",
] as const;
export type FeatureIcon = (typeof FEATURE_ICONS)[number];

export interface AnnouncementBarSettings {
  readonly text: LT;
  readonly link: LinkRef | null;
  readonly style: "accent" | "primary" | "dark";
}
export interface HeroSettings {
  readonly image: string | null;
  readonly mobileImage: string | null;
  readonly heading: LT;
  readonly subheading: LT;
  readonly buttonLabel: LT;
  readonly buttonLink: LinkRef | null;
  readonly height: "small" | "medium" | "large";
  readonly contentAlign: "start" | "center";
  readonly overlay: number;
}
export interface FeaturedCollectionSettings {
  readonly collection: string | null;
  readonly heading: LT;
  readonly productCount: number;
  readonly columns: number;
  readonly showViewAll: boolean;
}
export interface FeaturedProductsSettings {
  readonly source: "newest" | "manual";
  readonly products: readonly string[];
  readonly count: number;
  readonly heading: LT;
  readonly columns: number;
}
export interface CollectionListSettings {
  readonly source: "all" | "manual";
  readonly items: readonly { readonly collection: string | null; readonly image: string | null }[];
  readonly heading: LT;
  readonly columns: number;
}
export interface ImageWithTextSettings {
  readonly image: string | null;
  readonly heading: LT;
  readonly body: LT;
  readonly buttonLabel: LT;
  readonly buttonLink: LinkRef | null;
  readonly imagePosition: "start" | "end";
}
export interface RichTextSettings {
  readonly heading: LT;
  readonly body: LT;
  readonly buttonLabel: LT;
  readonly buttonLink: LinkRef | null;
  readonly align: "start" | "center";
}
export interface TestimonialsSettings {
  readonly heading: LT;
  readonly items: readonly {
    readonly quote: LT;
    readonly author: string;
    readonly rating: number;
  }[];
}
export interface FeaturesSettings {
  readonly heading: LT;
  readonly items: readonly {
    readonly icon: FeatureIcon;
    readonly title: LT;
    readonly text: LT;
  }[];
}
export interface WhatsAppCtaSettings {
  readonly heading: LT;
  readonly text: LT;
  readonly buttonLabel: LT;
  readonly phone: string;
  readonly message: LT;
}
export interface LeadFormSettings {
  // key order = fields order = defaults order
  readonly heading: LT;
  readonly text: LT;
  readonly submitLabel: LT;
  readonly successMessage: LT;
  readonly showEmail: boolean;
  readonly showMessage: boolean;
}

export interface SettingsByType {
  announcement_bar: AnnouncementBarSettings;
  hero: HeroSettings;
  featured_collection: FeaturedCollectionSettings;
  featured_products: FeaturedProductsSettings;
  collection_list: CollectionListSettings;
  image_with_text: ImageWithTextSettings;
  rich_text: RichTextSettings;
  testimonials: TestimonialsSettings;
  features: FeaturesSettings;
  whatsapp_cta: WhatsAppCtaSettings;
  lead_form: LeadFormSettings;
}

export type KnownSection = {
  [T in SectionType]: {
    readonly id: string;
    readonly type: T;
    readonly hidden: boolean;
    readonly settings: SettingsByType[T];
  };
}[SectionType];
export type AnnouncementSection = Extract<KnownSection, { type: "announcement_bar" }>;

/** A type this build does not know: kept verbatim so a newer build's section survives a save. */
export interface UnsupportedSection {
  readonly id: string;
  readonly type: string;
  readonly hidden: boolean;
  readonly settings: Readonly<Record<string, unknown>>;
}
export type Section = KnownSection | UnsupportedSection;

export type SectionPlacement = "header" | "homepage";
export type SectionIcon =
  | "megaphone"
  | "image"
  | "star"
  | "grid"
  | "folders"
  | "image-text"
  | "text"
  | "quote"
  | "badge-check"
  | "message-circle";

export interface SectionDefinition<T extends SectionType = SectionType> {
  readonly type: T;
  readonly labels: { readonly en: string; readonly ar: string };
  readonly icon: SectionIcon;
  readonly placement: SectionPlacement;
  readonly maxPerPage: number | null;
  readonly fields: readonly FieldDescriptor[];
  defaults(): SettingsByType[T];
  validate(raw: unknown, path: string, issues: ContentIssue[]): SettingsByType[T] | null;
}

/** The menu item id rule. */
export const SECTION_ID_PATTERN = ITEM_ID_PATTERN;
export const UNSUPPORTED_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
export const HOMEPAGE_SECTIONS_MAX = 25;
/** The `type` of the editor's `postMessage` that scrolls the preview to a section (Ruling 18). */
export const SECTION_FOCUS_MESSAGE = "morbeh:focus-section";
/** The `type` of the message a framed preview posts to its parent when it can take focus messages. */
export const SECTION_PREVIEW_READY_MESSAGE = "morbeh:preview-ready";

const L = SECTION_LIMITS;

// Each fields list is in the settings interface's order, and defaults() builds its keys in that
// order too: the canonical document form depends on key order (F11).
const localized = (key: string, max: number): FieldDescriptor => ({
  kind: "localizedText",
  key,
  max,
});
const heading: FieldDescriptor = localized("heading", L.heading);
const button = (): FieldDescriptor[] => [
  localized("buttonLabel", L.buttonLabel),
  { kind: "link", key: "buttonLink" },
];
const image = (key: string): FieldDescriptor => ({ kind: "image", key, purpose: "section_image" });
const columns: FieldDescriptor = { kind: "number", key: "columns", ...L.columns, step: 1 };
const count = (key: string): FieldDescriptor => ({ kind: "number", key, ...L.count, step: 1 });

function define<T extends SectionType>(
  spec: Omit<SectionDefinition<T>, "validate">,
): SectionDefinition<T> {
  return Object.freeze({
    ...spec,
    validate: (raw: unknown, path: string, issues: ContentIssue[]) =>
      validateFields(spec.fields, raw, path, issues) as SettingsByType[T] | null,
  });
}

const announcementBar = define({
  type: "announcement_bar",
  labels: { en: "Announcement bar", ar: "شريط إعلانات" },
  icon: "megaphone",
  placement: "header",
  maxPerPage: 1,
  fields: [
    localized("text", L.announcementText),
    { kind: "link", key: "link" },
    { kind: "select", key: "style", options: ["accent", "primary", "dark"] },
  ],
  defaults: () => ({
    text: { ar: "شحن مجاني للطلبات فوق 500 جنيه", en: "Free shipping on orders over EGP 500" },
    link: null,
    style: "accent",
  }),
});

const hero = define({
  type: "hero",
  labels: { en: "Image banner", ar: "بانر بصورة" },
  icon: "image",
  placement: "homepage",
  maxPerPage: L.heroPerPage,
  fields: [
    image("image"),
    image("mobileImage"),
    heading,
    localized("subheading", L.heroSubheading),
    ...button(),
    { kind: "select", key: "height", options: ["small", "medium", "large"] },
    { kind: "select", key: "contentAlign", options: ["start", "center"] },
    { kind: "number", key: "overlay", ...L.overlay },
  ],
  defaults: () => ({
    image: null,
    mobileImage: null,
    heading: { ar: "أهلًا بك في متجرنا", en: "Welcome to our store" },
    subheading: { ar: "اكتشف أحدث منتجاتنا", en: "Discover our latest products" },
    buttonLabel: { ar: "تسوّق الآن", en: "Shop now" },
    buttonLink: { type: "search" },
    height: "medium",
    contentAlign: "center",
    overlay: 30,
  }),
});

const featuredCollection = define({
  type: "featured_collection",
  labels: { en: "Featured collection", ar: "مجموعة مميزة" },
  icon: "star",
  placement: "homepage",
  maxPerPage: null,
  fields: [
    { kind: "collection", key: "collection" },
    heading,
    count("productCount"),
    columns,
    { kind: "boolean", key: "showViewAll" },
  ],
  defaults: () => ({
    collection: null,
    heading: { ar: "مجموعة مميزة", en: "Featured collection" },
    productCount: 8,
    columns: 4,
    showViewAll: true,
  }),
});

const featuredProducts = define({
  type: "featured_products",
  labels: { en: "Products", ar: "منتجات" },
  icon: "grid",
  placement: "homepage",
  maxPerPage: null,
  fields: [
    { kind: "select", key: "source", options: ["newest", "manual"] },
    { kind: "products", key: "products", max: L.products },
    count("count"),
    heading,
    columns,
  ],
  defaults: () => ({
    source: "newest",
    products: [],
    count: 8,
    heading: { ar: "المنتجات", en: "Products" },
    columns: 4,
  }),
});

const collectionList = define({
  type: "collection_list",
  labels: { en: "Collection list", ar: "قائمة المجموعات" },
  icon: "folders",
  placement: "homepage",
  maxPerPage: null,
  fields: [
    { kind: "select", key: "source", options: ["all", "manual"] },
    {
      kind: "items",
      key: "items",
      min: 0,
      max: L.collectionItems,
      fields: [{ kind: "collection", key: "collection" }, image("image")],
    },
    heading,
    columns,
  ],
  defaults: () => ({
    source: "all",
    items: [],
    heading: { ar: "المجموعات", en: "Collections" },
    columns: 3,
  }),
});

const imageWithText = define({
  type: "image_with_text",
  labels: { en: "Image with text", ar: "صورة مع نص" },
  icon: "image-text",
  placement: "homepage",
  maxPerPage: null,
  fields: [
    image("image"),
    heading,
    { kind: "richText", key: "body", max: L.imageWithTextBody },
    ...button(),
    { kind: "select", key: "imagePosition", options: ["start", "end"] },
  ],
  defaults: () => ({
    image: null,
    heading: { ar: "صورة مع نص", en: "Image with text" },
    body: {
      ar: "عرّف عملاءك بمتجرك وما يميّز منتجاتك.",
      en: "Tell customers about your store and what makes your products special.",
    },
    buttonLabel: {},
    buttonLink: null,
    imagePosition: "start",
  }),
});

const richText = define({
  type: "rich_text",
  labels: { en: "Rich text", ar: "نص" },
  icon: "text",
  placement: "homepage",
  maxPerPage: null,
  fields: [
    heading,
    { kind: "richText", key: "body", max: RICH_TEXT_MAX.section },
    ...button(),
    { kind: "select", key: "align", options: ["start", "center"] },
  ],
  defaults: () => ({
    heading: { ar: "عن متجرنا", en: "About our store" },
    body: { ar: "اكتب هنا قصة متجرك.", en: "Share your store's story here." },
    buttonLabel: {},
    buttonLink: null,
    align: "center",
  }),
});

const testimonials = define({
  type: "testimonials",
  labels: { en: "Testimonials", ar: "آراء العملاء" },
  icon: "quote",
  placement: "homepage",
  maxPerPage: null,
  fields: [
    heading,
    {
      kind: "items",
      key: "items",
      ...L.testimonials,
      fields: [
        localized("quote", L.quote),
        { kind: "text", key: "author", max: L.author },
        { kind: "number", key: "rating", ...L.rating, step: 1 },
      ],
    },
  ],
  defaults: () => ({
    heading: { ar: "آراء العملاء", en: "What our customers say" },
    items: [
      {
        quote: { ar: "منتجات رائعة وتوصيل سريع.", en: "Great products and fast delivery." },
        author: "",
        rating: 5,
      },
    ],
  }),
});

const features = define({
  type: "features",
  labels: { en: "Store highlights", ar: "مميزات المتجر" },
  icon: "badge-check",
  placement: "homepage",
  maxPerPage: null,
  fields: [
    heading,
    {
      kind: "items",
      key: "items",
      ...L.features,
      fields: [
        { kind: "select", key: "icon", options: FEATURE_ICONS },
        localized("title", L.featureTitle),
        localized("text", L.featureText),
      ],
    },
  ],
  defaults: () => ({
    heading: {},
    items: [
      {
        icon: "cod",
        title: { ar: "الدفع عند الاستلام", en: "Cash on delivery" },
        text: { ar: "ادفع نقدًا عند استلام طلبك.", en: "Pay in cash when your order arrives." },
      },
      {
        icon: "shipping",
        title: { ar: "شحن سريع", en: "Fast shipping" },
        text: { ar: "توصيل إلى جميع المحافظات.", en: "Delivery across the country." },
      },
      {
        icon: "returns",
        title: { ar: "إرجاع سهل", en: "Easy returns" },
        text: { ar: "إرجاع خلال 14 يومًا.", en: "Returns within 14 days." },
      },
    ],
  }),
});

const whatsappCta = define({
  type: "whatsapp_cta",
  labels: { en: "WhatsApp button", ar: "زرار واتساب" },
  icon: "message-circle",
  placement: "homepage",
  maxPerPage: L.whatsAppPerPage,
  fields: [
    heading,
    localized("text", L.ctaText),
    localized("buttonLabel", L.buttonLabel),
    { kind: "phone", key: "phone" },
    localized("message", L.ctaMessage),
  ],
  defaults: () => ({
    heading: { ar: "تواصل معنا عبر واتساب", en: "Chat with us on WhatsApp" },
    text: { ar: "نرد على أسئلتك بسرعة.", en: "We answer your questions quickly." },
    buttonLabel: { ar: "راسلنا على واتساب", en: "Message us on WhatsApp" },
    phone: "",
    message: {
      ar: "مرحبًا، لدي سؤال عن منتج.",
      en: "Hello, I have a question about a product.",
    },
  }),
});

const leadForm = define({
  type: "lead_form",
  labels: { en: "Lead form", ar: "فورم العملاء" },
  icon: "message-circle",
  placement: "homepage",
  maxPerPage: L.leadFormPerPage,
  fields: [
    heading,
    localized("text", L.ctaText),
    localized("submitLabel", L.buttonLabel),
    localized("successMessage", L.leadSuccess),
    { kind: "boolean", key: "showEmail" },
    { kind: "boolean", key: "showMessage" },
  ],
  defaults: () => ({
    heading: { ar: "اطلب استشارة", en: "Get in touch" },
    text: {
      ar: "سيب بياناتك وهنكلمك في أقرب وقت",
      en: "Leave your details and we will call you back",
    },
    submitLabel: { ar: "ابعت", en: "Send" },
    successMessage: {
      ar: "وصلتنا بياناتك، هنتواصل معاك قريب",
      en: "Thanks! We will contact you soon",
    },
    showEmail: true,
    showMessage: true,
  }),
});

export const SECTION_DEFINITIONS: readonly SectionDefinition[] = Object.freeze([
  announcementBar,
  hero,
  featuredCollection,
  featuredProducts,
  collectionList,
  imageWithText,
  richText,
  testimonials,
  features,
  whatsappCta,
  leadForm,
] as SectionDefinition[]);

/** Scans the list: an untrusted string is never used as an index. */
export function sectionDefinition(type: string): SectionDefinition | null {
  return SECTION_DEFINITIONS.find((definition) => definition.type === type) ?? null;
}

export function isKnownSection(section: Section): section is KnownSection {
  return sectionDefinition(section.type) !== null;
}

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(raw: Raw, key: string): unknown {
  return Object.hasOwn(raw, key) ? raw[key] : undefined;
}

const ENVELOPE_KEYS = ["id", "type", "hidden", "settings"] as const;

export function validateSection(
  raw: unknown,
  path: string,
  issues: ContentIssue[],
  placement: SectionPlacement,
): Section | null {
  let ok = true;
  const report = (at: string, code: string): void => {
    ok = false;
    if (issues.length < MAX_ISSUES) issues.push({ path: at, code });
  };
  if (!isRecord(raw)) {
    report(path, "INVALID_VALUE");
    return null;
  }
  for (const key of Object.keys(raw)) {
    if (!(ENVELOPE_KEYS as readonly string[]).includes(key)) {
      report(`${path}.${pathSegment(key)}`, "UNKNOWN_KEY");
    }
  }
  for (const key of ENVELOPE_KEYS) {
    if (own(raw, key) === undefined) report(`${path}.${key}`, "MISSING");
  }
  const id = own(raw, "id");
  const type = own(raw, "type");
  const hidden = own(raw, "hidden");
  const settings = own(raw, "settings");
  if (id !== undefined && (typeof id !== "string" || !SECTION_ID_PATTERN.test(id))) {
    report(`${path}.id`, "INVALID_VALUE");
  }
  if (hidden !== undefined && typeof hidden !== "boolean") {
    report(`${path}.hidden`, "INVALID_VALUE");
  }
  let checked: unknown = null;
  if (type !== undefined) {
    const definition = typeof type === "string" ? sectionDefinition(type) : null;
    if (typeof type !== "string") {
      report(`${path}.type`, "INVALID_VALUE");
    } else if (definition !== null) {
      if (definition.placement !== placement) {
        report(`${path}.type`, "SECTION_NOT_ALLOWED_HERE");
      } else if (settings !== undefined) {
        const before = issues.length;
        checked = definition.validate(settings, `${path}.settings`, issues);
        if (checked === null || issues.length > before) ok = false;
      }
    } else if (placement === "header") {
      report(`${path}.type`, "SECTION_NOT_ALLOWED_HERE");
    } else if (!UNSUPPORTED_TYPE_PATTERN.test(type)) {
      report(`${path}.type`, "INVALID_VALUE");
    } else if (settings !== undefined) {
      if (isRecord(settings)) checked = settings;
      else report(`${path}.settings`, "INVALID_VALUE");
    }
  }
  if (!ok) return null;
  return { id, type, hidden, settings: checked } as Section;
}

/**
 * Lenient: the same envelope rules, never reports. A known type's bad field becomes its default
 * and an unknown setting is dropped; an unreadable envelope is null.
 */
export function readSection(raw: unknown, placement: SectionPlacement): Section | null {
  if (!isRecord(raw)) return null;
  const id = own(raw, "id");
  const type = own(raw, "type");
  const hidden = own(raw, "hidden");
  const settings = own(raw, "settings");
  if (typeof id !== "string" || !SECTION_ID_PATTERN.test(id)) return null;
  if (typeof hidden !== "boolean" || typeof type !== "string") return null;
  const definition = sectionDefinition(type);
  if (definition !== null) {
    if (definition.placement !== placement || !isRecord(settings)) return null;
    const read = readFields(
      definition.fields,
      settings,
      definition.defaults() as unknown as Readonly<Record<string, unknown>>,
    );
    // What this read returns must pass the strict write. A bad field became its default above, but
    // a list below its minimum (testimonials/features with too few items) has no default that
    // helps, so that section is unreadable and dropped like any other.
    const strict: ContentIssue[] = [];
    if (definition.validate(read, "", strict) === null || strict.length > 0) return null;
    return { id, type, hidden, settings: read };
  }
  if (placement === "header" || !UNSUPPORTED_TYPE_PATTERN.test(type) || !isRecord(settings)) {
    return null;
  }
  // Settings verbatim; only the four envelope keys survive, so the read always passes the write.
  return { id, type, hidden, settings };
}

export function newSection<T extends SectionType>(
  type: T,
  id: string,
): Extract<KnownSection, { type: T }> {
  const definition = sectionDefinition(type) as unknown as SectionDefinition<T>;
  return { id, type, hidden: false, settings: definition.defaults() } as unknown as Extract<
    KnownSection,
    { type: T }
  >;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const DEFAULT_HOMEPAGE_SECTION_IDS = [
  "00000000-0000-4000-8000-000000000101",
  "00000000-0000-4000-8000-000000000102",
] as const;

export const DEFAULT_HOMEPAGE_SECTIONS: readonly KnownSection[] = deepFreeze([
  {
    id: DEFAULT_HOMEPAGE_SECTION_IDS[0],
    type: "featured_products",
    hidden: false,
    settings: { ...featuredProducts.defaults(), columns: 2 },
  },
  {
    id: DEFAULT_HOMEPAGE_SECTION_IDS[1],
    type: "collection_list",
    hidden: false,
    settings: { ...collectionList.defaults(), columns: 2 },
  },
] satisfies KnownSection[]);

/** Known sections only, hidden ones too: a hidden section's references still count. */
export function sectionRefsOf(sections: readonly Section[], basePath: string): SectionRefs {
  const refs = emptySectionRefs();
  for (const [index, section] of sections.entries()) {
    const definition = sectionDefinition(section.type);
    if (definition === null) continue;
    collectFieldRefs(
      definition.fields,
      section.settings as Readonly<Record<string, unknown>>,
      `${basePath}.${index}.settings`,
      refs,
    );
  }
  return refs;
}

export function sectionHeading(section: Section, locale: Locale): string | null {
  if (!isKnownSection(section)) return null;
  const settings: unknown = section.settings;
  if (!isRecord(settings)) return null;
  const text = own(settings, section.type === "announcement_bar" ? "text" : "heading");
  return isRecord(text) ? pickText(text, locale) : null;
}

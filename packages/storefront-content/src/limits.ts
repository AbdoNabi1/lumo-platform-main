/**
 * Spec numbers that the admin, the services and the storefront all enforce. One copy here, so the
 * hops cannot drift apart (final review, minor 2).
 */

/** A page's title, per locale. */
export const PAGE_TITLE_MAX = 255;
/** A page's meta description, per locale. */
export const PAGE_META_DESCRIPTION_MAX = 320;
/** The longest link-picker query the API reads (plan Rulings). */
export const LINK_TARGET_QUERY_MAX = 100;

/** The policy template generator's input bounds (`[min, max]` for the whole-number fields). */
export const POLICY_TEMPLATE_LIMITS = Object.freeze({
  text: Object.freeze({
    storeName: 120,
    contactEmail: 254,
    contactPhone: 30,
    businessAddress: 500,
  }),
  returnWindowDays: Object.freeze([0, 365] as const),
  deliveryMin: Object.freeze([1, 60] as const),
  deliveryMaxCap: 90,
});

/** The id rule for menu items and sections: a UUID, any case. */
export const ITEM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Spec 3.2 limits, in one place so the API, the editor and the storefront share them. */
export const SECTION_LIMITS = Object.freeze({
  heading: 80,
  announcementText: 120,
  heroSubheading: 200,
  buttonLabel: 30,
  imageWithTextBody: 2_000,
  quote: 400,
  author: 60,
  featureTitle: 40,
  featureText: 140,
  ctaText: 300,
  ctaMessage: 300,
  products: 12,
  collectionItems: 8,
  testimonials: Object.freeze({ min: 1, max: 8 }),
  features: Object.freeze({ min: 1, max: 6 }),
  count: Object.freeze({ min: 2, max: 12 }),
  columns: Object.freeze({ min: 2, max: 4 }),
  overlay: Object.freeze({ min: 0, max: 80, step: 10 }),
  rating: Object.freeze({ min: 0, max: 5 }),
  heroPerPage: 3,
  whatsAppPerPage: 2,
  leadFormPerPage: 1,
  leadSuccess: 200,
} as const);

/** An image reference: an asset id, never a path or a URL. */
export const IMAGE_REF_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** The longest image alt text the storefront renders (the admin's own cap; F12). */
export const IMAGE_ALT_MAX = 300;

/** The catalog's slug rule: lower-case words joined by single hyphens (catalog `Slug`; F5). */
export const CATALOG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The longest catalog slug or name the storefront accepts from the Runtime in a section (F12). */
export const CATALOG_REF_TEXT_MAX = 200;

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

/**
 * Canonical event → vendor event name (lead-site plan D1, Task 3).
 *
 * One table, one place: the vendor builders read it to name an event, and the ad-platform
 * destination wiring reads it to decide which events a vendor's routing rule admits. A missing
 * entry means the vendor does not receive that event from the server (for example TikTok has no
 * PageView; Snap has no LEAD).
 */

import type { MatchPlatform } from "../pipeline/platform-identity";

export type VendorBuilderKey = "meta.capi.v27" | "tiktok.events.v1_3" | "snap.capi.v3" | "ga4.mp";

export const VENDOR_BUILDER_KEYS: readonly VendorBuilderKey[] = [
  "meta.capi.v27",
  "tiktok.events.v1_3",
  "snap.capi.v3",
  "ga4.mp",
];

export function isVendorBuilderKey(value: string): value is VendorBuilderKey {
  return (VENDOR_BUILDER_KEYS as readonly string[]).includes(value);
}

/** Which per-platform match-key format a builder consumes. */
export const MATCH_PLATFORM_OF: Readonly<Record<VendorBuilderKey, MatchPlatform>> = {
  "meta.capi.v27": "meta",
  "tiktok.events.v1_3": "tiktok",
  "snap.capi.v3": "snap",
  "ga4.mp": "ga4",
};

export const CANONICAL_EVENTS = [
  "page_viewed",
  "form_submitted",
  "contact_clicked",
  "product_viewed",
  "view_item_list",
  "add_to_cart",
  "add_to_wishlist",
  "checkout_started",
  "add_payment_info",
  "search",
  "signup",
  "login",
  "purchase",
  "order_delivered",
  "order_cancelled",
] as const;

export type CanonicalEvent = (typeof CANONICAL_EVENTS)[number];

/** Exactly the plan table; a missing entry = the vendor does not receive that event by server. */
export const VENDOR_EVENT_NAMES: Readonly<
  Record<VendorBuilderKey, Readonly<Partial<Record<CanonicalEvent, string>>>>
> = {
  "meta.capi.v27": {
    page_viewed: "PageView",
    form_submitted: "Lead",
    contact_clicked: "Contact",
    product_viewed: "ViewContent",
    view_item_list: "ViewCategory",
    add_to_cart: "AddToCart",
    add_to_wishlist: "AddToWishlist",
    checkout_started: "InitiateCheckout",
    add_payment_info: "AddPaymentInfo",
    search: "Search",
    signup: "CompleteRegistration",
    login: "Login",
    purchase: "Purchase",
    order_delivered: "OrderDelivered",
    order_cancelled: "OrderCancelled",
  },
  "tiktok.events.v1_3": {
    form_submitted: "Lead",
    contact_clicked: "Contact",
    product_viewed: "ViewContent",
    add_to_cart: "AddToCart",
    add_to_wishlist: "AddToWishlist",
    checkout_started: "InitiateCheckout",
    add_payment_info: "AddPaymentInfo",
    search: "Search",
    signup: "CompleteRegistration",
    login: "Login",
    purchase: "Purchase",
    order_delivered: "OrderDelivered",
    order_cancelled: "OrderCancelled",
  },
  "snap.capi.v3": {
    page_viewed: "PAGE_VIEW",
    form_submitted: "SIGN_UP",
    contact_clicked: "CUSTOM_EVENT_2",
    product_viewed: "VIEW_CONTENT",
    view_item_list: "LIST_VIEW",
    add_to_cart: "ADD_CART",
    add_to_wishlist: "SAVE",
    checkout_started: "START_CHECKOUT",
    add_payment_info: "ADD_BILLING",
    search: "SEARCH",
    signup: "SIGN_UP",
    login: "LOGIN",
    purchase: "PURCHASE",
    order_delivered: "CUSTOM_EVENT_1",
    order_cancelled: "CUSTOM_EVENT_5",
  },
  "ga4.mp": {
    page_viewed: "page_view",
    form_submitted: "generate_lead",
    contact_clicked: "contact",
    product_viewed: "view_item",
    view_item_list: "view_item_list",
    add_to_cart: "add_to_cart",
    add_to_wishlist: "add_to_wishlist",
    checkout_started: "begin_checkout",
    add_payment_info: "add_payment_info",
    search: "search",
    signup: "sign_up",
    login: "login",
    purchase: "purchase",
    order_delivered: "order_delivered",
    order_cancelled: "refund",
  },
};

/** The vendor's name for a canonical event, or null when that vendor does not receive it. */
export function vendorEventName(builder: VendorBuilderKey, event: string): string | null {
  const names: Readonly<Record<string, string | undefined>> = VENDOR_EVENT_NAMES[builder];
  return Object.prototype.hasOwnProperty.call(names, event) ? (names[event] ?? null) : null;
}

/** Which canonical events a shop's site type may emit at all. */
export const SITE_TYPE_EVENTS: {
  readonly lead_site: readonly CanonicalEvent[];
  readonly store: readonly CanonicalEvent[];
} = {
  lead_site: ["page_viewed", "form_submitted", "contact_clicked"],
  store: CANONICAL_EVENTS.filter((event) => event !== "form_submitted"),
};

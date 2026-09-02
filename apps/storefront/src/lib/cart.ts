import {
  getCurrentCart,
  getProducts,
  type CartItemSummary,
  type CartSummary,
  type ProductSummary,
} from "./runtime-api";

/**
 * Storefront-facing Cart resolution (Phase 17.1 — Guest Cart Foundation).
 *
 * Cart identity is now session-derived, not a `?cartId=` link or a `cartId`-holding cookie: the
 * guest session cookie (`GUEST_SESSION_COOKIE`, written by `app/cart/actions.ts`) is the only
 * client-held reference, and the Runtime API resolves "the current cart" from it via
 * `GET /public/carts/current`. This supersedes the old `CART_COOKIE` (`lumo-storefront-cart-id`)
 * design from Productization Phase 3, which stored a bare cart id with no ownership check at all
 * — anyone holding that cookie's value (or guessing a `?cartId=`) could read any cart. See the
 * Phase 17.1 report for the removed surface.
 */
export const GUEST_SESSION_COOKIE = "lumo-storefront-guest-session";

/**
 * Shared cookie properties for the guest session (Task 1). `httpOnly` so client JS can never read
 * or forge the value; `secure` only in production (a plain-HTTP local dev server can't set a
 * Secure cookie the browser will accept back); `sameSite: "lax"` matches the existing
 * `LOCALE_COOKIE` convention (`lib/i18n.ts`) — a top-level guest cart doesn't need `"strict"`, and
 * `"lax"` still blocks cross-site POSTs; a bounded 30-day lifetime, not a session-only cookie, so
 * an abandoned cart survives a browser restart the way a real e-commerce cart is expected to.
 */
export const GUEST_SESSION_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * 30,
};

/**
 * Holds the active checkout session id (Phase 2 — Public checkout), set by `startCheckout` and
 * read back by `/checkout` (and briefly by `/checkout/confirmation`, which clears it once the
 * confirmation has rendered — see that page's own comment). Defined here, beside
 * `GUEST_SESSION_COOKIE`, so both guest-flow cookies live in one place. Same `httpOnly`/`secure`
 * reasoning as `GUEST_SESSION_COOKIE_OPTIONS` — no `maxAge`: a checkout is a short, single-sitting
 * flow, not something that should still be resumable a browser restart later.
 */
export const CHECKOUT_SESSION_COOKIE = "lumo_checkout_session";

export const CHECKOUT_SESSION_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
};

export interface ResolvedCartLine {
  readonly productId: string;
  /** `null` when no Catalog product/variant with this id could be resolved — never fabricated. */
  readonly name: string | null;
  readonly slug: string | null;
  readonly quantity: number;
  readonly unitPriceAmountMinor: number;
  readonly currency: string;
  readonly lineTotalAmountMinor: number;
}

export type CurrentCartResult =
  | {
      readonly status: "ok";
      readonly cart: CartSummary;
      readonly lines: readonly ResolvedCartLine[];
    }
  /** No session cookie, or a session with no cart yet — the ordinary first-visit state, not an error. */
  | { readonly status: "empty" }
  | { readonly status: "error" };

/** Finds a cart line's product by product id, falling back to a variant id match (Cart's `productRef` is opaque — it may be either, see `services/cart`'s domain doc comments). */
function resolveProduct(
  productId: string,
  products: readonly ProductSummary[],
): ProductSummary | undefined {
  return (
    products.find((product) => product.id === productId) ??
    products.find((product) => product.variants.some((variant) => variant.id === productId))
  );
}

function resolveLine(item: CartItemSummary, products: readonly ProductSummary[]): ResolvedCartLine {
  const product = resolveProduct(item.productId, products);
  return {
    productId: item.productId,
    name: product?.name ?? null,
    slug: product?.slug ?? null,
    quantity: item.quantity,
    unitPriceAmountMinor: item.unitPriceAmountMinor,
    currency: item.currency,
    lineTotalAmountMinor: item.lineTotalAmountMinor,
  };
}

/**
 * Resolves the caller's current cart for a guest session and enriches each line with its Catalog
 * product name/slug for display. `sessionRef === undefined` (no cookie yet) short-circuits to
 * `"empty"` without calling the Runtime API at all — a bare page view must never create a session
 * or a cart (Task 4: "do not create a Cart merely because /cart was visited").
 *
 * Product resolution reads the same unfiltered `getProducts()` list `lib/catalog.ts` filters to
 * "published" — deliberately NOT filtered here, since a line added while a product was published
 * should still show its name after the product is later unpublished or archived.
 */
export async function resolveCurrentCart(
  sessionRef: string | undefined,
): Promise<CurrentCartResult> {
  if (sessionRef === undefined || sessionRef.length === 0) {
    return { status: "empty" };
  }

  const [cartResponse, products] = await Promise.all([getCurrentCart(sessionRef), getProducts()]);

  if (cartResponse.status < 200 || cartResponse.status >= 300 || cartResponse.body === null) {
    return { status: "error" };
  }
  if (cartResponse.body.cart === null) {
    return { status: "empty" };
  }

  const cart = cartResponse.body.cart;
  const lines = cart.items.map((item) => resolveLine(item, products ?? []));
  return { status: "ok", cart, lines };
}

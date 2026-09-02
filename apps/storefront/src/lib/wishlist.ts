import { getMyWishlist, getProducts, type ProductSummary, type WishlistSummary } from "./runtime-api";

/**
 * Storefront-facing wishlist resolution (T5.17 Part B). Mirrors `lib/cart.ts`'s `resolveCurrentCart`
 * in shape and discipline: the API returns bare `productRef`s, and a list of opaque ids is not a
 * page a shopper can read, so each line is joined to its Catalog product for a name and a link.
 *
 * Unlike the cart, there is no session to mint here and nothing to create client-side: the wishlist
 * is created server-side on first access, so a signed-in customer always has one.
 */

export interface ResolvedWishlistLine {
  readonly productRef: string;
  /** `null` when no Catalog product resolves this ref — rendered as an explicit unavailable line, never invented. */
  readonly name: string | null;
  readonly slug: string | null;
  readonly addedAt: string;
  readonly shareToken: string | null;
}

export type WishlistResult =
  | {
      readonly status: "ok";
      readonly wishlist: WishlistSummary;
      readonly lines: readonly ResolvedWishlistLine[];
    }
  /** Signed in, wishlist exists, nothing on it yet — the ordinary first-visit state. */
  | { readonly status: "empty" }
  /** No valid customer session. The page redirects to sign-in rather than rendering an empty list. */
  | { readonly status: "signed-out" }
  | { readonly status: "error" };

/**
 * Resolves a wishlist product the same way `lib/cart.ts` does — by id, then by variant id, since a
 * `productRef` is opaque and may be either. Deliberately matched against the UNFILTERED product
 * list: an item saved while a product was published should still show its name if the product is
 * later unpublished, exactly as a cart line does.
 */
function resolveProduct(
  productRef: string,
  products: readonly ProductSummary[],
): ProductSummary | undefined {
  return (
    products.find((product) => product.id === productRef) ??
    products.find((product) => product.variants.some((variant) => variant.id === productRef))
  );
}

export async function resolveMyWishlist(sessionId: string | undefined): Promise<WishlistResult> {
  if (sessionId === undefined || sessionId.length === 0) {
    return { status: "signed-out" };
  }

  const [response, products] = await Promise.all([getMyWishlist(sessionId), getProducts()]);

  // A 401 is the guard's single fail-closed answer — expired, revoked, forged, or no session.
  if (response.status === 401) return { status: "signed-out" };
  if (response.status < 200 || response.status >= 300 || response.body === null) {
    return { status: "error" };
  }
  if (response.body.items.length === 0) return { status: "empty" };

  const lines = response.body.items.map((item) => {
    const product = resolveProduct(item.productRef, products ?? []);
    return {
      productRef: item.productRef,
      name: product?.name ?? null,
      slug: product?.slug ?? null,
      addedAt: item.addedAt,
      shareToken: item.shareToken,
    };
  });
  return { status: "ok", wishlist: response.body, lines };
}

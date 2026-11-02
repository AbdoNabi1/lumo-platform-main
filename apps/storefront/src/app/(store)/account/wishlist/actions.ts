"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { GUEST_SESSION_COOKIE } from "@/lib/cart";
import { CUSTOMER_SESSION_COOKIE } from "@/lib/customer-session";
import {
  addWishlistItem,
  moveWishlistItemToCart,
  removeWishlistItem,
  shareWishlistItem,
} from "@/lib/runtime-api";

/**
 * Wishlist Server Actions (T5.17 Part B). Same discipline as `app/account/actions.ts`: the customer
 * session cookie is read here, server-side, and never reaches a Client Component. No action takes a
 * `wishlistId` or a `customerRef` — the routes address `/me` and derive the owner from the session,
 * so there is simply no identifier for a caller to supply or tamper with.
 *
 * Each write carries one `Idempotency-Key` per user-initiated submit.
 */

export type WishlistActionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** `"signed-out"`: no valid customer session (the guard's 401). `"cart"`: the item could not be
       * moved because there is no cart or no resolvable price — the item is deliberately still on
       * the wishlist. `"network"`: unreachable or an unexpected status. */
      readonly reason: "signed-out" | "cart" | "network";
    };

async function customerSession(): Promise<string | undefined> {
  const jar = await cookies();
  const value = jar.get(CUSTOMER_SESSION_COOKIE)?.value;
  return value !== undefined && value.length > 0 ? value : undefined;
}

function mapFailure(status: number): WishlistActionResult {
  if (status === 401) return { ok: false, reason: "signed-out" };
  if (status === 404 || status === 422) return { ok: false, reason: "cart" };
  return { ok: false, reason: "network" };
}

export async function addToWishlist(productRef: string): Promise<WishlistActionResult> {
  const sessionId = await customerSession();
  if (sessionId === undefined) return { ok: false, reason: "signed-out" };

  const response = await addWishlistItem(sessionId, productRef, crypto.randomUUID());
  if (response.status < 200 || response.status >= 300) return mapFailure(response.status);

  revalidatePath("/account/wishlist");
  return { ok: true };
}

export async function removeFromWishlist(productRef: string): Promise<WishlistActionResult> {
  const sessionId = await customerSession();
  if (sessionId === undefined) return { ok: false, reason: "signed-out" };

  const response = await removeWishlistItem(sessionId, productRef, crypto.randomUUID());
  if (response.status < 200 || response.status >= 300) return mapFailure(response.status);

  revalidatePath("/account/wishlist");
  return { ok: true };
}

/**
 * Generates (or replays) a share token. The token is returned for display only — **there is no page
 * that resolves one yet**, because the Wishlist context has no share-token lookup at all (no
 * `findByShareToken`, no use case taking a token). The UI must therefore present this as a
 * reference, never as a working link; see `docs/plans/BLOCKERS.md`'s T5.17 entry.
 */
export async function shareWishlistProduct(
  productRef: string,
): Promise<WishlistActionResult & { readonly shareToken?: string }> {
  const sessionId = await customerSession();
  if (sessionId === undefined) return { ok: false, reason: "signed-out" };

  const response = await shareWishlistItem(sessionId, productRef, crypto.randomUUID());
  if (response.status < 200 || response.status >= 300 || response.body === null) {
    return mapFailure(response.status);
  }

  revalidatePath("/account/wishlist");
  return { ok: true, shareToken: response.body.shareToken };
}

/**
 * Moves an item into the shopper's cart. Needs BOTH tokens: the customer session (who owns the
 * wishlist) and the guest `sessionRef` (which cart to add to) — a customer's cart is still keyed by
 * `sessionRef`, since `CartRepository` has no `findByCustomerRef`.
 *
 * With no guest session there is no cart to move into, so this reports `"cart"` rather than
 * pretending to succeed. The backend removes the item from the wishlist only after the cart add
 * actually succeeded, so a failure here never loses the item.
 */
export async function moveToCart(productRef: string): Promise<WishlistActionResult> {
  const sessionId = await customerSession();
  if (sessionId === undefined) return { ok: false, reason: "signed-out" };

  const jar = await cookies();
  const sessionRef = jar.get(GUEST_SESSION_COOKIE)?.value;
  if (sessionRef === undefined || sessionRef.length === 0) return { ok: false, reason: "cart" };

  const response = await moveWishlistItemToCart(
    sessionId,
    productRef,
    sessionRef,
    crypto.randomUUID(),
  );
  if (response.status < 200 || response.status >= 300) return mapFailure(response.status);

  revalidatePath("/account/wishlist");
  revalidatePath("/cart");
  return { ok: true };
}

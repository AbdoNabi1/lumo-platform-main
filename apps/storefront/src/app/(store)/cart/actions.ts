"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { AvailabilityBook } from "@/lib/catalog";
import { GUEST_SESSION_COOKIE, GUEST_SESSION_COOKIE_OPTIONS } from "@/lib/cart";
import { currentOrNewSessionRef } from "@/lib/guest-session";
import {
  addCartItem,
  changeCartItemQuantity,
  clearCart as clearCartApi,
  createCart,
  getCurrentCart,
  getPublicStore,
  removeCartItem,
} from "@/lib/runtime-api";

/**
 * Guest Cart mutations (Task 2/5/9 — Guest Cart Foundation). Every action is a Next.js Server
 * Action: it runs on the server, so it is the only place the guest session cookie is ever read or
 * written. A Client Component calls these directly; it never sees or supplies a `sessionRef` —
 * ownership is derived here, from the HttpOnly cookie, and passed to the Runtime API, exactly as
 * Task 6 requires ("the server derives ownership from the session cookie").
 */

export type CartActionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** Wave 2a: with `"limit"`, the server's own sentence ("You can add up to 3 of this item"). */
      readonly message?: string;
      /** `"limit"` (Wave 2a): the shop caps one cart line and this quantity is above it (422 field `quantity`).
       * `"unavailable"`: the product is not for sale (the server could not resolve a price). `"choose-variant"`
       * (Plan 2A): the product has several variants and none was named (API `VARIANT_REQUIRED`).
       * `"ownership"`: the
       * Runtime API 404'd — a stale/cleared session cookie no longer matches any cart it can
       * resolve. `"network"`: the Runtime API is unreachable or returned an unexpected status. */
      readonly reason: "unavailable" | "choose-variant" | "ownership" | "network" | "limit";
    };

/**
 * The server's refusal of a cart line above the shop's add-to-cart limit: a 422 whose field error
 * names `quantity` (`apps/admin/src/http/public-cart-routes.ts`). Returns its message, else `null`.
 */
function limitMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { fields } = body as { readonly fields?: unknown };
  if (!Array.isArray(fields)) return null;
  for (const entry of fields as readonly unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { field, message } = entry as { readonly field?: unknown; readonly message?: unknown };
    if (field === "quantity" && typeof message === "string" && message !== "") return message;
  }
  return null;
}

/** Starts a new guest session: a fresh opaque id in the cookie. The old session's cart is left behind. */
async function replaceSessionRef(): Promise<string> {
  const jar = await cookies();
  const sessionRef = crypto.randomUUID();
  jar.set(GUEST_SESSION_COOKIE, sessionRef, GUEST_SESSION_COOKIE_OPTIONS);
  return sessionRef;
}

/** The existing guest session, if any — mutations on an already-rendered cart must never mint a new session out from under it. */
async function existingSessionRef(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(GUEST_SESSION_COOKIE)?.value;
}

/** The Runtime API answers a multi-variant add with no variant as 422 with code VARIANT_REQUIRED. */
function isVariantRequired(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { code?: unknown }).code === "VARIANT_REQUIRED"
  );
}

/**
 * Adds one product to the caller's guest cart, creating the session/cart if this is their first
 * add (Task 9's flow: session → cart-if-necessary → item added → cookie persists → `/cart` shows
 * it).
 *
 * Plan 3C: a new cart is opened in the STORE currency (`GET /public/store`), never one the browser
 * names or one inferred from the product. A cart left over in another currency (the merchant changed
 * the store currency) is replaced by a fresh cart on a new session. The currency is never a price.
 * Plan 2C-1: the Pricing screen is not consulted here. The H-01 rule stands:
 * no price is sent to the Cart API, which resolves it server-side from the Catalog variant and
 * rejects any request that tries to supply one. A product the server will not sell answers 422,
 * which surfaces here as `"unavailable"`.
 */
export async function addToCart(
  productId: string,
  quantity: number,
  variantId: string | undefined,
  sellableWhenOutOfStock = false,
): Promise<CartActionResult> {
  const store = await getPublicStore();
  if (store === null) return { ok: false, reason: "network" };

  // Plan 2B-1: the stock snapshot is the VARIANT's, and is left out for a variant that sells past
  // zero (it has no meaningful "available"). Still a display hint only — the server never trusts it.
  const availabilityBook = sellableWhenOutOfStock ? null : await AvailabilityBook.load();
  const availability = availabilityBook?.resolve(productId, variantId);
  const inventoryAvailable = availability?.status === "ok" ? availability.available : undefined;

  let sessionRef = await currentOrNewSessionRef();

  const current = await getCurrentCart(sessionRef);
  if (current.status < 200 || current.status >= 300 || current.body === null) {
    return { ok: false, reason: "network" };
  }

  let cartId = current.body.cart?.id;
  if (cartId !== undefined && current.body.cart?.currency !== store.currency) {
    sessionRef = await replaceSessionRef();
    cartId = undefined;
  }
  if (cartId === undefined) {
    const created = await createCart(sessionRef, store.currency);
    if (created.status < 200 || created.status >= 300 || created.body === null) {
      return { ok: false, reason: "network" };
    }
    cartId = created.body.id;
  }

  const added = await addCartItem(cartId, {
    sessionRef,
    productId,
    ...(variantId === undefined ? {} : { variantId }),
    quantity,
    inventoryAvailable,
  });
  if (added.status === 404) return { ok: false, reason: "ownership" };
  if (added.status === 422 && isVariantRequired(added.body)) {
    return { ok: false, reason: "choose-variant" };
  }
  // Wave 2a: the shop's add-to-cart limit is a 422 naming `quantity`, which is not "unavailable".
  if (added.status === 422) {
    const message = limitMessage(added.body);
    if (message !== null) return { ok: false, reason: "limit", message };
  }
  // Any other 422 is the server refusing to sell this product (draft, archived, unknown variant).
  if (added.status === 422) return { ok: false, reason: "unavailable" };
  if (added.status < 200 || added.status >= 300) return { ok: false, reason: "network" };

  revalidatePath("/cart");
  return { ok: true };
}

export async function changeQuantity(
  cartId: string,
  productId: string,
  quantity: number,
  variantId?: string,
): Promise<CartActionResult> {
  const sessionRef = await existingSessionRef();
  if (sessionRef === undefined) return { ok: false, reason: "ownership" };

  const result = await changeCartItemQuantity(cartId, sessionRef, productId, quantity, variantId);
  if (result.status === 404) return { ok: false, reason: "ownership" };
  const message = result.status === 422 ? limitMessage(result.body) : null;
  if (message !== null) return { ok: false, reason: "limit", message };
  if (result.status < 200 || result.status >= 300) return { ok: false, reason: "network" };

  revalidatePath("/cart");
  return { ok: true };
}

export async function removeItem(
  cartId: string,
  productId: string,
  variantId?: string,
): Promise<CartActionResult> {
  const sessionRef = await existingSessionRef();
  if (sessionRef === undefined) return { ok: false, reason: "ownership" };

  const result = await removeCartItem(cartId, sessionRef, productId, variantId);
  if (result.status === 404) return { ok: false, reason: "ownership" };
  if (result.status < 200 || result.status >= 300) return { ok: false, reason: "network" };

  revalidatePath("/cart");
  return { ok: true };
}

export async function clearCart(cartId: string): Promise<CartActionResult> {
  const sessionRef = await existingSessionRef();
  if (sessionRef === undefined) return { ok: false, reason: "ownership" };

  const result = await clearCartApi(cartId, sessionRef);
  if (result.status === 404) return { ok: false, reason: "ownership" };
  if (result.status < 200 || result.status >= 300) return { ok: false, reason: "network" };

  revalidatePath("/cart");
  return { ok: true };
}

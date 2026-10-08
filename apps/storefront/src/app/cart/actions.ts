"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { AvailabilityBook } from "@/lib/catalog";
import { GUEST_SESSION_COOKIE, GUEST_SESSION_COOKIE_OPTIONS } from "@/lib/cart";
import {
  addCartItem,
  changeCartItemQuantity,
  clearCart as clearCartApi,
  createCart,
  getCurrentCart,
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
      /** `"unavailable"`: the product is not for sale (the server could not resolve a price). `"choose-variant"`
       * (Plan 2A): the product has several variants and none was named (API `VARIANT_REQUIRED`).
       * `"ownership"`: the
       * Runtime API 404'd — a stale/cleared session cookie no longer matches any cart it can
       * resolve. `"network"`: the Runtime API is unreachable or returned an unexpected status. */
      readonly reason: "unavailable" | "choose-variant" | "ownership" | "network";
    };

/** Reads the guest session cookie, minting and persisting a new opaque id if none exists yet. Never called from a read path — only from a mutation that is about to need one. */
async function currentOrNewSessionRef(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(GUEST_SESSION_COOKIE)?.value;
  if (existing !== undefined && existing.length > 0) return existing;

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
 * Plan 2C-1: the Pricing screen is no longer consulted here. `currency` is the currency of the
 * variant being bought — only used to open a new cart; it is NEVER a price. The H-01 rule stands:
 * no price is sent to the Cart API, which resolves it server-side from the Catalog variant and
 * rejects any request that tries to supply one. A product the server will not sell answers 422,
 * which surfaces here as `"unavailable"`.
 */
export async function addToCart(
  productId: string,
  quantity: number,
  variantId: string | undefined,
  currency: string,
  sellableWhenOutOfStock = false,
): Promise<CartActionResult> {
  if (currency.length === 0) return { ok: false, reason: "unavailable" };

  // Plan 2B-1: the stock snapshot is the VARIANT's, and is left out for a variant that sells past
  // zero (it has no meaningful "available"). Still a display hint only — the server never trusts it.
  const availabilityBook = sellableWhenOutOfStock ? null : await AvailabilityBook.load();
  const availability = availabilityBook?.resolve(productId, variantId);
  const inventoryAvailable = availability?.status === "ok" ? availability.available : undefined;

  const sessionRef = await currentOrNewSessionRef();

  const current = await getCurrentCart(sessionRef);
  if (current.status < 200 || current.status >= 300 || current.body === null) {
    return { ok: false, reason: "network" };
  }

  let cartId = current.body.cart?.id;
  if (cartId === undefined) {
    const created = await createCart(sessionRef, currency);
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

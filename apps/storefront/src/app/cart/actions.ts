"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { AvailabilityBook, PriceBook } from "@/lib/catalog";
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
      /** `"unavailable"`: no authoritative Pricing snapshot for this product. `"ownership"`: the
       * Runtime API 404'd — a stale/cleared session cookie no longer matches any cart it can
       * resolve. `"network"`: the Runtime API is unreachable or returned an unexpected status. */
      readonly reason: "unavailable" | "ownership" | "network";
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

/**
 * Adds one product to the caller's guest cart, creating the session/cart if this is their first
 * add (Task 9's flow: session → cart-if-necessary → item added → cookie persists → `/cart` shows
 * it). `PriceBook` is still consulted here first — purely as an availability pre-check, so an
 * unpriced/ambiguous product fails fast with a clean UX message instead of a round trip — but
 * (H-01 remediation, Phase 17.1 security follow-up) its resolved amount/currency is no longer
 * sent to the Cart API: the public HTTP route now re-resolves the price itself, server-side, from
 * Pricing's published-price data, and rejects any request that tries to supply one.
 */
export async function addToCart(productId: string, quantity: number): Promise<CartActionResult> {
  const [priceBook, availabilityBook] = await Promise.all([
    PriceBook.load(),
    AvailabilityBook.load(),
  ]);
  const price = priceBook?.resolve(productId);
  if (price === undefined || price.status !== "ok") {
    return { ok: false, reason: "unavailable" };
  }
  const availability = availabilityBook?.resolve(productId);
  const inventoryAvailable = availability?.status === "ok" ? availability.available : undefined;

  const sessionRef = await currentOrNewSessionRef();

  const current = await getCurrentCart(sessionRef);
  if (current.status < 200 || current.status >= 300 || current.body === null) {
    return { ok: false, reason: "network" };
  }

  let cartId = current.body.cart?.id;
  if (cartId === undefined) {
    const created = await createCart(sessionRef, price.currency);
    if (created.status < 200 || created.status >= 300 || created.body === null) {
      return { ok: false, reason: "network" };
    }
    cartId = created.body.id;
  }

  const added = await addCartItem(cartId, {
    sessionRef,
    productId,
    quantity,
    inventoryAvailable,
  });
  if (added.status === 404) return { ok: false, reason: "ownership" };
  if (added.status < 200 || added.status >= 300) return { ok: false, reason: "network" };

  revalidatePath("/cart");
  return { ok: true };
}

export async function changeQuantity(
  cartId: string,
  productId: string,
  quantity: number,
): Promise<CartActionResult> {
  const sessionRef = await existingSessionRef();
  if (sessionRef === undefined) return { ok: false, reason: "ownership" };

  const result = await changeCartItemQuantity(cartId, sessionRef, productId, quantity);
  if (result.status === 404) return { ok: false, reason: "ownership" };
  if (result.status < 200 || result.status >= 300) return { ok: false, reason: "network" };

  revalidatePath("/cart");
  return { ok: true };
}

export async function removeItem(cartId: string, productId: string): Promise<CartActionResult> {
  const sessionRef = await existingSessionRef();
  if (sessionRef === undefined) return { ok: false, reason: "ownership" };

  const result = await removeCartItem(cartId, sessionRef, productId);
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

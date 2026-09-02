"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { GUEST_SESSION_COOKIE } from "@/lib/cart";
import {
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_SESSION_COOKIE_CLEARED,
  CUSTOMER_SESSION_COOKIE_OPTIONS,
} from "@/lib/customer-session";
import {
  claimGuestCart,
  getCurrentCart,
  loginCustomer,
  logoutCustomer,
  logoutCustomerEverywhere,
  registerCustomer,
} from "@/lib/runtime-api";

/**
 * Customer authentication Server Actions (T5.17 Part A). Same discipline as `app/cart/actions.ts`
 * and `app/checkout/actions.ts`: every one of these runs on the server, and this file is the ONLY
 * place `CUSTOMER_SESSION_COOKIE` is ever written or cleared. A Client Component calls these
 * directly and never sees a session id, a `customerRef`, or anything but the small result unions
 * below — which is what lets the cookie stay `httpOnly`.
 *
 * **Passwords pass through and are never retained.** They go from the submitted form straight into
 * one Runtime API call and are never logged, never put in a cookie, never revalidated into a cache,
 * and never returned. No action here echoes its own input back to the caller.
 */

export type AuthActionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** `"credentials"`: the Runtime API 401'd — wrong password OR no such account, deliberately
       * indistinguishable (the backend returns one identical envelope for both; preserving that
       * here is the whole point — a storefront that split them back apart would re-create the
       * account-enumeration oracle the backend just closed). `"conflict"`: the email is already
       * registered. `"validation"`: the Runtime API 422'd. `"mfa"`: an additional factor is
       * required and this surface cannot yet collect one. `"network"`: unreachable/unexpected. */
      readonly reason: "credentials" | "conflict" | "validation" | "mfa" | "network";
    };

function mapAuthFailure(status: number): AuthActionResult {
  if (status === 401) return { ok: false, reason: "credentials" };
  if (status === 403) return { ok: false, reason: "mfa" };
  if (status === 409) return { ok: false, reason: "conflict" };
  if (status === 422) return { ok: false, reason: "validation" };
  return { ok: false, reason: "network" };
}

/**
 * Establishes the browser-side half of a session that the Runtime API has ALREADY established
 * server-side. The cookie stores the opaque session id and nothing else — never the `customerRef`
 * the login response also carries, which is used for rendering on the server and then discarded.
 */
async function persistSession(sessionId: string): Promise<void> {
  const jar = await cookies();
  jar.set(CUSTOMER_SESSION_COOKIE, sessionId, CUSTOMER_SESSION_COOKIE_OPTIONS);
}

/**
 * Login-time cart continuity (T5.16 §2). Best-effort by design: the shopper IS signed in at this
 * point, and a cart that could not be promoted must never turn a successful login into a failed one.
 *
 * **The guest cookie is deliberately NOT cleared here, and that is a documented deviation from
 * T5.16 §2's design**, which called for clearing it. The design assumed a customer's cart could be
 * found by `customerRef`; it cannot — `CartRepository` exposes `findBySessionRef` and `findById`
 * only, with no `findByCustomerRef` (verified by reading `services/cart/src/domain/
 * cart-repository.ts`). `sessionRef` is therefore still the ONLY key that resolves "my current
 * cart", including after promotion, so clearing the cookie would strand the customer's freshly
 * claimed cart and silently empty their cart on login — the exact data loss the promotion exists to
 * prevent. See `docs/plans/BLOCKERS.md`'s T5.17 entry for the repository gap this is waiting on.
 */
async function claimGuestCartIfAny(sessionId: string): Promise<void> {
  const jar = await cookies();
  const sessionRef = jar.get(GUEST_SESSION_COOKIE)?.value;
  if (sessionRef === undefined || sessionRef.length === 0) return;

  const current = await getCurrentCart(sessionRef);
  const cartId = current.body?.cart?.id;
  if (cartId === undefined) return;

  await claimGuestCart(sessionId, cartId, sessionRef, crypto.randomUUID());
}

/**
 * Registers an account and signs the new customer straight in.
 *
 * Registration and login are two calls rather than one because each route does one thing (and
 * `/login` must not be idempotent while `/register` must be). The login here is a REAL
 * authentication round trip with the just-submitted credential — the session is never synthesized
 * from the registration response, so a registration that somehow produced an account that cannot
 * authenticate surfaces immediately rather than as a broken session later.
 */
export async function registerAccount(
  email: string,
  name: string,
  password: string,
): Promise<AuthActionResult> {
  const registered = await registerCustomer(email, name, password, crypto.randomUUID());
  if (registered.status < 200 || registered.status >= 300) {
    return mapAuthFailure(registered.status);
  }
  return signIn(email, password);
}

/** Authenticates, persists the session cookie, and folds the guest cart into the account. */
export async function signIn(email: string, password: string): Promise<AuthActionResult> {
  const response = await loginCustomer(email, password);
  if (response.status < 200 || response.status >= 300 || response.body === null) {
    return mapAuthFailure(response.status);
  }

  await persistSession(response.body.sessionId);
  await claimGuestCartIfAny(response.body.sessionId);

  revalidatePath("/account");
  revalidatePath("/cart");
  return { ok: true };
}

/**
 * Revokes the session server-side, THEN clears the cookie. The order matters: clearing first and
 * failing to revoke would leave a live session behind that the shopper believes is closed. Because
 * `POST /public/auth/logout` answers 200 for an already-invalid session too, the cookie is cleared
 * on every non-network outcome — a session that no longer exists is, correctly, logged out.
 */
export async function signOut(): Promise<AuthActionResult> {
  const jar = await cookies();
  const sessionId = jar.get(CUSTOMER_SESSION_COOKIE)?.value;

  if (sessionId !== undefined && sessionId.length > 0) {
    const response = await logoutCustomer(sessionId, crypto.randomUUID());
    if (response.status === 0) return { ok: false, reason: "network" };
  }

  jar.set(CUSTOMER_SESSION_COOKIE, "", CUSTOMER_SESSION_COOKIE_CLEARED);
  revalidatePath("/account");
  return { ok: true };
}

/**
 * "Sign out of all devices" — `RevokeAllSessions`, already built and already proven on the admin
 * console, reused verbatim (T5.16 §2 predicted no new use case would be needed, and none was).
 */
export async function signOutEverywhere(): Promise<AuthActionResult> {
  const jar = await cookies();
  const sessionId = jar.get(CUSTOMER_SESSION_COOKIE)?.value;
  if (sessionId === undefined || sessionId.length === 0) {
    return { ok: false, reason: "credentials" };
  }

  const response = await logoutCustomerEverywhere(sessionId, crypto.randomUUID());
  if (response.status < 200 || response.status >= 300) return mapAuthFailure(response.status);

  jar.set(CUSTOMER_SESSION_COOKIE, "", CUSTOMER_SESSION_COOKIE_CLEARED);
  revalidatePath("/account");
  return { ok: true };
}

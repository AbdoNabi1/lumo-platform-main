import { getCustomerProfile, type CustomerProfile } from "./runtime-api";

/**
 * Storefront-facing **customer session** (T5.17, implementing T5.16 §2).
 *
 * This cookie is deliberately a THIRD, separate cookie, not an extension of either existing one:
 *
 * - `GUEST_SESSION_COOKIE` (`lib/cart.ts`) is a bare `crypto.randomUUID()` minted client-side-of-the-
 *   server with no credential and no server-side identity check behind it. It proves *cart
 *   ownership* and nothing else. Reusing or upgrading it for identity would mean anyone who guessed
 *   or replayed a cart token could read another person's orders, wishlist and loyalty balance —
 *   the exact vulnerability class H-05/H-01 were fixed against for the far less sensitive cart data.
 * - `CHECKOUT_SESSION_COOKIE` is a single-sitting flow token with no lifetime at all.
 *
 * What this one carries is Security's opaque `Session.id` and nothing else — never the
 * `customerRef`, never an email, never a signed token with embedded claims. The opacity is what
 * makes `RevokeSession`/`RevokeAllSessions` take effect on the very next request: the value is only
 * a lookup key, so the server re-resolves (and can refuse) it every single time. A self-contained
 * JWT would keep validating locally until its own expiry no matter what the server had recorded.
 */
export const CUSTOMER_SESSION_COOKIE = "lumo-storefront-customer-session";

/**
 * Same `httpOnly`/`secure`-in-prod/`sameSite: "lax"` shape as `GUEST_SESSION_COOKIE_OPTIONS`, and
 * for the same reasons (client JS must never read or forge it; a plain-HTTP dev server cannot set a
 * Secure cookie the browser will send back; `lax` still blocks cross-site POSTs).
 *
 * The one deliberate difference is `maxAge`: **one hour, not the cart's thirty days.** This cookie
 * carries a real identity rather than an anonymous convenience token, so it gets a short sliding
 * window (T5.16 §2's 30-120 minute recommendation) refreshed on activity, not a month-long one. The
 * value is kept in step with the backend's own `CUSTOMER_SESSION_TTL_SECONDS`
 * (`apps/admin/src/composition.ts`) so the cookie and the `Session` it points at expire together —
 * a cookie outliving its session would produce a "signed in" UI whose every request 401s, and a
 * session outliving its cookie would leave a valid session stranded and unrevoked.
 */
export const CUSTOMER_SESSION_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 60 * 60,
};

/** Clearing shape for the same cookie — `maxAge: 0` expires it immediately on logout. */
export const CUSTOMER_SESSION_COOKIE_CLEARED = {
  ...CUSTOMER_SESSION_COOKIE_OPTIONS,
  maxAge: 0,
};

export type CurrentCustomerResult =
  /** A valid session resolved, server-side, to a real customer. */
  | { readonly status: "signed-in"; readonly customer: CustomerProfile }
  /** No cookie, or a cookie the server refused (expired/revoked/forged). The ordinary signed-out state. */
  | { readonly status: "signed-out" }
  /** The Runtime API could not be reached — distinct from "signed out", so the UI never claims either way. */
  | { readonly status: "error" };

/**
 * Resolves the caller's signed-in customer, if any. Every branch is a REAL round trip: the storefront
 * cannot tell whether a session cookie is valid on its own — only the Runtime API can, via
 * `CustomerGuard`'s session → principal → customer resolution — so a present cookie is never treated
 * as proof of anything here.
 *
 * `sessionId === undefined` short-circuits to `"signed-out"` without a network call, the same
 * discipline `resolveCurrentCart` uses for a missing guest cookie: a signed-out page view must not
 * cost a round trip or create anything.
 *
 * A failed call is reported as `"error"`, never folded into `"signed-out"`. Collapsing them would
 * silently sign a customer out of the UI whenever the API hiccuped, and — worse — is the kind of
 * "absence means anonymous" assumption that leads to rendering an empty account page as though the
 * customer genuinely had no data.
 */
export async function resolveCurrentCustomer(
  sessionId: string | undefined,
): Promise<CurrentCustomerResult> {
  if (sessionId === undefined || sessionId.length === 0) {
    return { status: "signed-out" };
  }

  const response = await getCustomerProfile(sessionId);
  if (response.status === 401) return { status: "signed-out" };
  if (response.status < 200 || response.status >= 300 || response.body === null) {
    return { status: "error" };
  }
  return { status: "signed-in", customer: response.body };
}

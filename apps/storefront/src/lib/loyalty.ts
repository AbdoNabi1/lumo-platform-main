import { getMyLoyaltyBalance, type LoyaltyAccountSummary } from "./runtime-api";

/**
 * Storefront-facing loyalty-balance resolution (T5.19). Mirrors `lib/customer-session.ts`'s
 * `resolveCurrentCustomer` in shape and discipline: every branch is a REAL round trip through
 * `apps/admin/src/http/public-loyalty-routes.ts`, and a present session cookie is never treated as
 * proof of anything on its own.
 *
 * Unlike the wishlist (created on first access), a loyalty account is opened by an admin/system
 * action — a customer does not self-open one by visiting this page. So "no account yet" is its own
 * real state, kept apart from both "signed out" and "error": a customer who has simply never had one
 * opened is not the same as one whose request failed, and neither is the same as an anonymous
 * caller. Never collapse "no account" into a fabricated zero-balance account (Global constraint 3).
 */

export type LoyaltyBalanceResult =
  | { readonly status: "ok"; readonly account: LoyaltyAccountSummary }
  /** Signed in, but no loyalty account has been opened for this customer yet. */
  | { readonly status: "no-account" }
  /** No valid customer session. The page redirects to sign-in rather than rendering any balance state. */
  | { readonly status: "signed-out" }
  | { readonly status: "error" };

export async function resolveMyLoyaltyBalance(
  sessionId: string | undefined,
): Promise<LoyaltyBalanceResult> {
  if (sessionId === undefined || sessionId.length === 0) {
    return { status: "signed-out" };
  }

  const response = await getMyLoyaltyBalance(sessionId);
  // A 401 is the guard's single fail-closed answer — expired, revoked, forged, or no session.
  if (response.status === 401) return { status: "signed-out" };
  if (response.status === 404) return { status: "no-account" };
  if (response.status < 200 || response.status >= 300 || response.body === null) {
    return { status: "error" };
  }
  return { status: "ok", account: response.body };
}

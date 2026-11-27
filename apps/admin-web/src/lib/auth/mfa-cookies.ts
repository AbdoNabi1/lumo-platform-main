import type { NextResponse } from "next/server";
import { MAX_CHALLENGE_SECONDS, MAX_SETUP_CHALLENGE_SECONDS } from "./mfa-challenge";

/**
 * Wave 1e — the two short-lived cookies that carry a sign-in from the password step to the code step.
 * The signed challenge lives ONLY in the first (httpOnly): never in a URL, a form field, a log or
 * rendered HTML. The second remembers which sign-in path issued it (`merchant` | `staff`), because the
 * two have different verify routes. Server-only (route handlers and the verify page).
 *
 * Host-only (no `domain`): nothing else on the parent domain has any use for these. `secure` and
 * `path` match the session cookie; `sameSite` is `lax` (the code step is a same-site form post).
 */
export const MFA_CHALLENGE_COOKIE = "morbeh_mfa_challenge";
export const MFA_VIA_COOKIE = "morbeh_mfa_via";
/**
 * Wave 1f — the SETUP challenge (a right password, no two-step yet, the platform requires it). Same
 * rules as the code challenge: httpOnly, never in a URL, a form field, a log or rendered HTML. It
 * shares the `via` cookie (which sign-in path issued it).
 */
export const MFA_SETUP_COOKIE = "morbeh_mfa_setup";

export type MfaVia = "merchant" | "staff";

export function isMfaVia(value: string | undefined): value is MfaVia {
  return value === "merchant" || value === "staff";
}

const BASE = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;

/** A cookie that is gone (same attributes as the one it replaces, `maxAge: 0`). */
function expire(response: NextResponse, name: string): void {
  response.cookies.set(name, "", { ...BASE, maxAge: 0 });
}

/** Sets both cookies; the lifetime is the challenge's own (`challengeExpiresIn`), capped. */
export function setMfaCookies(
  response: NextResponse,
  input: { readonly challenge: string; readonly via: MfaVia; readonly expiresIn: number },
): NextResponse {
  const maxAge = Math.max(1, Math.min(Math.floor(input.expiresIn), MAX_CHALLENGE_SECONDS));
  response.cookies.set(MFA_CHALLENGE_COOKIE, input.challenge, { ...BASE, maxAge });
  response.cookies.set(MFA_VIA_COOKIE, input.via, { ...BASE, maxAge });
  // A fresh code step supersedes any setup step left over from an earlier attempt.
  expire(response, MFA_SETUP_COOKIE);
  return response;
}

/** Wave 1f: sets the setup challenge cookie and the path cookie; the lifetime is the challenge's own, capped. */
export function setSetupCookies(
  response: NextResponse,
  input: { readonly setupChallenge: string; readonly via: MfaVia; readonly expiresIn: number },
): NextResponse {
  const maxAge = Math.max(1, Math.min(Math.floor(input.expiresIn), MAX_SETUP_CHALLENGE_SECONDS));
  response.cookies.set(MFA_SETUP_COOKIE, input.setupChallenge, { ...BASE, maxAge });
  response.cookies.set(MFA_VIA_COOKIE, input.via, { ...BASE, maxAge });
  expire(response, MFA_CHALLENGE_COOKIE);
  return response;
}

/** Expires the setup challenge cookie and the path cookie. */
export function clearSetupCookies(response: NextResponse): NextResponse {
  expire(response, MFA_SETUP_COOKIE);
  expire(response, MFA_VIA_COOKIE);
  return response;
}

/** Expires both cookies (same attributes, `maxAge: 0`). */
export function clearMfaCookies(response: NextResponse): NextResponse {
  expire(response, MFA_CHALLENGE_COOKIE);
  expire(response, MFA_VIA_COOKIE);
  return response;
}

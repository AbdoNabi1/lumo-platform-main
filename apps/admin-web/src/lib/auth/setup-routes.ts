import { NextResponse, type NextRequest } from "next/server";
import { clearSetupCookies, isMfaVia, MFA_SETUP_COOKIE, MFA_VIA_COOKIE } from "./mfa-cookies";
import type { MfaVia } from "./mfa-cookies";
import type { SetupFailure } from "./mfa-setup";

/**
 * Wave 1f — what the two setup-at-sign-in route handlers (`app/auth/native-login/setup/{start,confirm}`)
 * share. Server-only. The signed setup challenge lives ONLY in an httpOnly cookie; the screen's fetches
 * carry nothing secret in, and what comes back (the key, the backup codes) is `no-store`.
 */

/** The wire the screen reads: `error` is one of these, the HTTP status says the same thing. */
export type SetupErrorKind = SetupFailure | "invalid" | "unsupported";

const STATUS: Readonly<Record<SetupErrorKind, number>> = {
  code: 401,
  expired: 401,
  limited: 429,
  unavailable: 503,
  invalid: 400,
  unsupported: 415,
};

/** A JSON answer that is never cached. */
export function noStoreJson(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("cache-control", "no-store");
  return response;
}

/**
 * A refusal. `expired` ends the setup (the cookies are cleared: start over from the sign-in form); every
 * other kind leaves the cookies so the screen can try again.
 */
export function setupError(kind: SetupErrorKind): NextResponse {
  const response = noStoreJson({ error: kind }, STATUS[kind]);
  return kind === "expired" ? clearSetupCookies(response) : response;
}

/** The setup challenge and the path that issued it, from the httpOnly cookies; `null` = nothing to continue. */
export function readSetupCookies(
  request: NextRequest,
): { readonly setupChallenge: string; readonly via: MfaVia } | null {
  const setupChallenge = request.cookies.get(MFA_SETUP_COOKIE)?.value;
  const via = request.cookies.get(MFA_VIA_COOKIE)?.value;
  if (setupChallenge === undefined || setupChallenge.length === 0 || !isMfaVia(via)) return null;
  return { setupChallenge, via };
}

/** Only a JSON request may reach these handlers (a cross-site form post cannot send one). */
export function isJsonRequest(request: NextRequest): boolean {
  return (request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}

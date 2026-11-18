import type { NextResponse } from "next/server";
import { authConfig, SESSION_COOKIE } from "./config";

/**
 * The one place the admin session cookie is written after a successful sign-in (native login and
 * the "Open your store" sign-up share it, so the two can never drift apart). Server-only.
 */
export function setSessionCookie(
  response: NextResponse,
  result: { readonly token: string; readonly expiresIn: number },
): NextResponse {
  response.cookies.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    secure: true,
    sameSite: authConfig.cookieSameSite,
    domain: authConfig.cookieDomain,
    path: "/",
    maxAge: result.expiresIn,
  });
  return response;
}

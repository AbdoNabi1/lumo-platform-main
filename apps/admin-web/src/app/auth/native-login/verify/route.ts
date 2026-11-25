import { NextResponse, type NextRequest } from "next/server";
import {
  clearMfaCookies,
  isMfaVia,
  MFA_CHALLENGE_COOKIE,
  MFA_VIA_COOKIE,
} from "@/lib/auth/mfa-cookies";
import { verifyLoginCode } from "@/lib/auth/mfa-verify";
import { isNativeAuth, nativeTenantId } from "@/lib/auth/native";
import { safeReturnTo } from "@/lib/auth/safe-return-to";
import { setSessionCookie } from "@/lib/auth/session-cookie";
import { requireProdEnv } from "@/lib/env";
import { publicOrigin } from "@/lib/public-origin";

/** The runtime refuses a code longer than this (`code: z.string().min(1).max(32)`). */
const MAX_CODE_LENGTH = 32;

function redirectTo(url: URL): NextResponse {
  const response = NextResponse.redirect(url, 303);
  response.headers.set("cache-control", "no-store");
  return response;
}

/** Back to the code form with a reason, keeping a safe `return_to`. The challenge cookie stays. */
function codeFormAgain(reason: string, returnTo: string, origin: string): NextResponse {
  const back = new URL("/login/verify", origin);
  back.searchParams.set("error", reason);
  if (returnTo !== "/") back.searchParams.set("return_to", returnTo);
  return redirectTo(back);
}

/** Start over: both cookies are cleared and the form says the sign-in expired. */
function startOver(returnTo: string, origin: string): NextResponse {
  const back = new URL("/login", origin);
  back.searchParams.set("error", "expired");
  if (returnTo !== "/") back.searchParams.set("return_to", returnTo);
  return clearMfaCookies(redirectTo(back));
}

/**
 * Wave 1e: the code step of a native sign-in. The signed challenge comes from the httpOnly cookie the
 * password step set; the typed code (or a backup code) from the form. Success clears both cookies and
 * sets the session cookie exactly like the password route; a wrong code stays on the form; an expired
 * or spent challenge sends the person back to the start; a rate limit says to wait.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = publicOrigin(request);
  if (!isNativeAuth()) return redirectTo(new URL("/login", origin));
  const form = await request.formData();
  const rawCode = form.get("code");
  const rawReturnTo = form.get("return_to");
  const returnTo = safeReturnTo(typeof rawReturnTo === "string" ? rawReturnTo : "/", origin);

  const challenge = request.cookies.get(MFA_CHALLENGE_COOKIE)?.value;
  if (challenge === undefined || challenge.length === 0) {
    return redirectTo(new URL("/login", origin));
  }
  const via = request.cookies.get(MFA_VIA_COOKIE)?.value;
  if (!isMfaVia(via)) return startOver(returnTo, origin);

  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  if (code.length === 0 || code.length > MAX_CODE_LENGTH) {
    return codeFormAgain("code", returnTo, origin);
  }

  const result = await verifyLoginCode({
    runtimeUrl: requireProdEnv("RUNTIME_API_URL", "http://localhost:3080"),
    tenantId: nativeTenantId(),
    via,
    challenge,
    code,
  });
  if (result.ok) {
    const response = redirectTo(new URL(returnTo, origin));
    return setSessionCookie(clearMfaCookies(response), result);
  }
  if (result.reason === "expired") return startOver(returnTo, origin);
  return codeFormAgain(result.reason, returnTo, origin);
}

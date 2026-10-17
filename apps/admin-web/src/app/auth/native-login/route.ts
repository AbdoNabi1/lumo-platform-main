import { NextResponse, type NextRequest } from "next/server";
import { exchangeMerchantPassword } from "@/lib/auth/merchant";
import { exchangePassword, isNativeAuth, nativeTenantId } from "@/lib/auth/native";
import { safeReturnTo } from "@/lib/auth/safe-return-to";
import { setSessionCookie } from "@/lib/auth/session-cookie";
import { requireProdEnv } from "@/lib/env";
import { publicOrigin } from "@/lib/public-origin";

/** A form field as a string; a missing field or an uploaded file is treated as empty. */
function field(form: FormData, name: string, fallback: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : fallback;
}

/** Plan 1B-2: the native login form posts here; on success the session cookie holds the token. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = publicOrigin(request);
  if (!isNativeAuth()) return NextResponse.redirect(new URL("/login", origin), 303);
  const form = await request.formData();
  const email = field(form, "email", "");
  const password = field(form, "password", "");
  const returnTo = safeReturnTo(field(form, "return_to", "/"), origin);
  const credentials = {
    runtimeUrl: requireProdEnv("RUNTIME_API_URL", "http://localhost:3080"),
    tenantId: nativeTenantId(),
    email,
    password,
  };
  // Merchants first (the store directory), then the platform team's own staff directory: the two
  // never overlap, so the first success wins. `mfa` from either stops here; of two failures the
  // "worse" one (unavailable) is reported so a transient outage never reads as a wrong password.
  const merchant = await exchangeMerchantPassword(credentials);
  if (merchant.ok) return signedIn(merchant, returnTo, origin);
  if (merchant.reason === "mfa") return signInFailed("mfa", returnTo, origin);
  const staff = await exchangePassword(credentials);
  if (staff.ok) return signedIn(staff, returnTo, origin);
  if (staff.reason === "mfa") return signInFailed("mfa", returnTo, origin);
  const unavailable = merchant.reason === "unavailable" || staff.reason === "unavailable";
  return signInFailed(unavailable ? "unavailable" : "invalid", returnTo, origin);
}

function signInFailed(reason: string, returnTo: string, origin: string): NextResponse {
  const back = new URL("/login", origin);
  back.searchParams.set("error", reason);
  if (returnTo !== "/") back.searchParams.set("return_to", returnTo);
  return NextResponse.redirect(back, 303);
}

/** The one place the session cookie is set after a successful sign-in. */
function signedIn(
  result: { readonly token: string; readonly expiresIn: number },
  returnTo: string,
  origin: string,
): NextResponse {
  return setSessionCookie(NextResponse.redirect(new URL(returnTo, origin), 303), result);
}

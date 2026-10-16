import { NextResponse, type NextRequest } from "next/server";
import { authConfig, SESSION_COOKIE } from "@/lib/auth/config";
import { exchangePassword, isNativeAuth, nativeTenantId } from "@/lib/auth/native";
import { safeReturnTo } from "@/lib/auth/safe-return-to";
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
  const result = await exchangePassword({
    runtimeUrl: requireProdEnv("RUNTIME_API_URL", "http://localhost:3080"),
    tenantId: nativeTenantId(),
    email,
    password,
  });
  if (!result.ok) {
    const back = new URL("/login", origin);
    back.searchParams.set("error", result.reason);
    if (returnTo !== "/") back.searchParams.set("return_to", returnTo);
    return NextResponse.redirect(back, 303);
  }
  const response = NextResponse.redirect(new URL(returnTo, origin), 303);
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

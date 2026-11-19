import { NextResponse, type NextRequest } from "next/server";
import { signUpMerchant, signupEnabled, type SignupCountry } from "@/lib/auth/merchant";
import { isNativeAuth, nativeTenantId } from "@/lib/auth/native";
import { setSessionCookie } from "@/lib/auth/session-cookie";
import { requireProdEnv } from "@/lib/env";
import { publicOrigin } from "@/lib/public-origin";

const COUNTRIES: readonly SignupCountry[] = ["EG", "SA", "AE"];

/** A form field as a string; a missing field or an uploaded file is treated as empty. */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function back(origin: string, error: string): NextResponse {
  return NextResponse.redirect(new URL(`/signup?error=${error}`, origin), 303);
}

/**
 * The "Open your store" form posts here. The checks mirror the form's own (so a browser that skips
 * them still gets the same answer) and run before the runtime is called. Neither the email, the
 * store name nor the password is ever put in a redirect URL: failures carry only an error code.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = publicOrigin(request);
  if (!isNativeAuth() || !signupEnabled()) {
    return NextResponse.redirect(new URL("/login", origin), 303);
  }
  const form = await request.formData();
  const storeName = field(form, "storeName").trim();
  const email = field(form, "email").trim();
  const password = field(form, "password");
  const country = COUNTRIES.find((code) => code === field(form, "country"));
  if (
    storeName.length < 2 ||
    storeName.length > 60 ||
    !email.includes("@") ||
    password.length < 8 ||
    country === undefined
  ) {
    return back(origin, "invalid");
  }
  const result = await signUpMerchant({
    runtimeUrl: requireProdEnv("RUNTIME_API_URL", "http://localhost:3080"),
    tenantId: nativeTenantId(),
    storeName,
    email,
    password,
    country,
  });
  if (!result.ok) return back(origin, result.reason);
  if ("signInRequired" in result) {
    return NextResponse.redirect(new URL("/login?signup=done", origin), 303);
  }
  return setSessionCookie(NextResponse.redirect(new URL("/?welcome=1", origin), 303), result);
}

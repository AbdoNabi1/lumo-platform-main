import { NextResponse, type NextRequest } from "next/server";
import { isNativeAuth, nativeTenantId } from "@/lib/auth/native";
import { requestReset } from "@/lib/auth/password-reset";
import { requireProdEnv } from "@/lib/env";
import { publicOrigin } from "@/lib/public-origin";

/** A form field as a string; a missing field or an uploaded file is treated as empty. */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Plan 1C: the "forgot password" form posts here. The answer never depends on whether the email has
 * an account (the runtime answers 202 either way), so the redirect is the same neutral "sent" notice;
 * only a rate-limit refusal differs. The email address is never put in the redirect URL.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = publicOrigin(request);
  if (!isNativeAuth()) return NextResponse.redirect(new URL("/login", origin), 303);
  const email = field(await request.formData(), "email").trim();
  if (email.length < 3) return NextResponse.redirect(new URL("/forgot-password", origin), 303);
  const result = await requestReset({
    runtimeUrl: requireProdEnv("RUNTIME_API_URL", "http://localhost:3080"),
    tenantId: nativeTenantId(),
    email,
  });
  if (result === "limited") {
    return NextResponse.redirect(new URL("/forgot-password?error=limited", origin), 303);
  }
  // "sent" and "unavailable" look the same to the visitor: nothing here confirms an account.
  return NextResponse.redirect(new URL("/login?reset=sent", origin), 303);
}

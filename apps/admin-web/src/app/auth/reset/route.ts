import { NextResponse, type NextRequest } from "next/server";
import { isNativeAuth, nativeTenantId } from "@/lib/auth/native";
import { completeReset } from "@/lib/auth/password-reset";
import { requireProdEnv } from "@/lib/env";
import { publicOrigin } from "@/lib/public-origin";

/** A form field as a string; a missing field or an uploaded file is treated as empty. */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Plan 1C: the "set a new password" form posts here. The token only travels in the form body and
 * back into the same page's own query string on a retryable error (it is already in the visitor's
 * address bar); the password never appears in any URL. Nothing here is logged.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = publicOrigin(request);
  if (!isNativeAuth()) return NextResponse.redirect(new URL("/login", origin), 303);
  const form = await request.formData();
  const token = field(form, "token");
  const password = field(form, "password");
  const confirm = field(form, "confirm");

  const back = (reason: string): NextResponse => {
    const url = new URL("/reset-password", origin);
    if (token.length > 0) url.searchParams.set("token", token);
    url.searchParams.set("error", reason);
    return NextResponse.redirect(url, 303);
  };

  if (token.length === 0) return back("invalid");
  if (password !== confirm) return back("mismatch");

  const result = await completeReset({
    runtimeUrl: requireProdEnv("RUNTIME_API_URL", "http://localhost:3080"),
    tenantId: nativeTenantId(),
    token,
    password,
  });
  if (result === "done") return NextResponse.redirect(new URL("/login?reset=done", origin), 303);
  return back(result);
}

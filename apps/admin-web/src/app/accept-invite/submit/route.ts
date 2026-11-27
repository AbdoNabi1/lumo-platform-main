import { NextResponse, type NextRequest } from "next/server";
import { acceptInvitation } from "@/lib/auth/invitation";
import { isNativeAuth, nativeTenantId } from "@/lib/auth/native";
import { requireProdEnv } from "@/lib/env";
import { publicOrigin } from "@/lib/public-origin";

/** A form field as a string; a missing field or an uploaded file is treated as empty. */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 256;

/**
 * Wave 1d: the "choose a password" form of an invitation posts here. The token only travels in the
 * form body and, on a retryable error, back into the same page's own query string (it is already in
 * the visitor's address bar). A link that is dead (410) is NOT echoed back: the page shows the
 * invalid-link state with no token at all. The password never appears in any URL; nothing is logged.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = publicOrigin(request);
  if (!isNativeAuth()) return NextResponse.redirect(new URL("/login", origin), 303);
  const form = await request.formData();
  const token = field(form, "token");
  const store = field(form, "store");
  const password = field(form, "password");
  const confirm = field(form, "confirm");

  const back = (reason: string, keepLink: boolean): NextResponse => {
    const url = new URL("/accept-invite", origin);
    if (keepLink && token.length > 0) {
      url.searchParams.set("token", token);
      if (store.length > 0) url.searchParams.set("store", store);
    }
    url.searchParams.set("error", reason);
    return NextResponse.redirect(url, 303);
  };

  if (token.length === 0) return back("invalid", false);
  if (password !== confirm) return back("mismatch", true);
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) return back("weak", true);

  const result = await acceptInvitation({
    runtimeUrl: requireProdEnv("RUNTIME_API_URL", "http://localhost:3080"),
    tenantId: nativeTenantId(),
    ...(store.length > 0 ? { store } : {}),
    token,
    password,
  });
  if (result === "done") return NextResponse.redirect(new URL("/login?invited=1", origin), 303);
  return back(result, result !== "invalid");
}

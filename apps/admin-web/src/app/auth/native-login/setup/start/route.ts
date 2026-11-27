import { type NextRequest, type NextResponse } from "next/server";
import { startLoginSetup } from "@/lib/auth/mfa-setup";
import { isNativeAuth, nativeTenantId } from "@/lib/auth/native";
import { isJsonRequest, noStoreJson, readSetupCookies, setupError } from "@/lib/auth/setup-routes";
import { requireProdEnv } from "@/lib/env";

/**
 * Wave 1f: step 1 of setup at sign-in. The screen posts an empty JSON object; the signed setup
 * challenge comes from the httpOnly cookie the password step set. The setup key and the `otpauth://`
 * link come back ONCE in a `no-store` answer, to the screen's state only: never a URL, a cookie or a log.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isNativeAuth()) return setupError("expired");
  if (!isJsonRequest(request)) return setupError("unsupported");
  const cookies = readSetupCookies(request);
  if (cookies === null) return setupError("expired");

  const result = await startLoginSetup({
    runtimeUrl: requireProdEnv("RUNTIME_API_URL", "http://localhost:3080"),
    tenantId: nativeTenantId(),
    via: cookies.via,
    setupChallenge: cookies.setupChallenge,
  });
  if (!result.ok) return setupError(result.reason);
  const { enrollmentId, manualKey, provisioningUri } = result.setup;
  return noStoreJson({ enrollmentId, manualKey, provisioningUri });
}

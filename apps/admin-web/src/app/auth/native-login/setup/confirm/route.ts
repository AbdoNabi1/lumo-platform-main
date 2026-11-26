import { type NextRequest, type NextResponse } from "next/server";
import { clearSetupCookies } from "@/lib/auth/mfa-cookies";
import { confirmLoginSetup } from "@/lib/auth/mfa-setup";
import { isNativeAuth, nativeTenantId } from "@/lib/auth/native";
import { setSessionCookie } from "@/lib/auth/session-cookie";
import { isJsonRequest, noStoreJson, readSetupCookies, setupError } from "@/lib/auth/setup-routes";
import { requireProdEnv } from "@/lib/env";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A TOTP code is six digits (the runtime itself accepts up to 32 characters; this route is stricter). */
const TOTP_CODE = /^\d{6}$/;

/**
 * Wave 1f: step 2 of setup at sign-in. The screen posts `{ enrollmentId, code }`; the signed setup
 * challenge comes from the httpOnly cookie. On success THIS handler sets the session cookie and clears the
 * setup cookies: the access token never reaches client JS. The answer carries only the backup codes,
 * once, `no-store`. A wrong code keeps the cookies (try again); an expired challenge clears them.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isNativeAuth()) return setupError("expired");
  if (!isJsonRequest(request)) return setupError("unsupported");
  const cookies = readSetupCookies(request);
  if (cookies === null) return setupError("expired");

  const body: unknown = await request.json().catch(() => null);
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const enrollmentId = record["enrollmentId"];
  const rawCode = record["code"];
  if (typeof enrollmentId !== "string" || !UUID.test(enrollmentId)) return setupError("invalid");
  const code = typeof rawCode === "string" ? rawCode.replace(/\s+/g, "") : "";
  if (!TOTP_CODE.test(code)) return setupError("code");

  const result = await confirmLoginSetup({
    runtimeUrl: requireProdEnv("RUNTIME_API_URL", "http://localhost:3080"),
    tenantId: nativeTenantId(),
    via: cookies.via,
    setupChallenge: cookies.setupChallenge,
    enrollmentId,
    code,
  });
  if (!result.ok) return setupError(result.reason);
  const response = noStoreJson({ backupCodes: result.backupCodes });
  return setSessionCookie(clearSetupCookies(response), result);
}

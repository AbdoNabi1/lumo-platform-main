import { errorCodeOf } from "./mfa-challenge";
import type { MfaVia } from "./mfa-cookies";

/**
 * Wave 1e — the code step of a native sign-in: posts the cookie's challenge and the typed code to the
 * runtime. Pure and never throwing, like `exchangePassword`. The challenge and the code travel only in
 * the POST body; neither is ever logged or put in a URL.
 *
 * Error shapes differ on the wire: `INVALID_CODE` and `CHALLENGE_EXPIRED` are nested
 * `{ error: { code, message } }`, `RATE_LIMITED` (429) is flat — so the code is read as
 * `body.error?.code ?? body.code`.
 */
export type VerifyCodeResult =
  | { readonly ok: true; readonly token: string; readonly expiresIn: number }
  | {
      readonly ok: false;
      /** `code` = try again here; `expired` = start over; `limited` = wait; `unavailable` = outage. */
      readonly reason: "code" | "expired" | "limited" | "unavailable";
    };

const VERIFY_PATH: Readonly<Record<MfaVia, string>> = {
  merchant: "/api/v1/public/auth/merchant/login/verify",
  staff: "/api/v1/public/auth/staff/login/verify",
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export { errorCodeOf };

export async function verifyLoginCode(input: {
  readonly runtimeUrl: string;
  /** The platform / shop tenant the sign-in started on (`nativeTenantId()`). */
  readonly tenantId: string;
  readonly via: MfaVia;
  readonly challenge: string;
  readonly code: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<VerifyCodeResult> {
  const doFetch = input.fetchImpl ?? fetch;
  try {
    const response = await doFetch(`${input.runtimeUrl}${VERIFY_PATH[input.via]}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": input.tenantId },
      body: JSON.stringify({ challenge: input.challenge, code: input.code }),
      cache: "no-store",
    });
    if (response.status === 429) return { ok: false, reason: "limited" };
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 401) {
      // Only a wrong code is retried in place; every other refusal (expired, spent, forged, the member
      // lost access between the two steps) means "start again".
      return { ok: false, reason: errorCodeOf(body) === "INVALID_CODE" ? "code" : "expired" };
    }
    // A malformed code the runtime refuses on shape is still just "that code didn't work".
    if (response.status === 422) return { ok: false, reason: "code" };
    if (!response.ok) return { ok: false, reason: "unavailable" };
    const record = asRecord(body);
    const token = record["accessToken"];
    const expiresIn = record["expiresIn"];
    if (typeof token !== "string" || typeof expiresIn !== "number") {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, token, expiresIn };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

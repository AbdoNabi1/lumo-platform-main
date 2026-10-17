/**
 * Merchant (store owner) sign-up and sign-in helpers for the public Create-a-store flow. Pure and
 * never throwing, like `exchangePassword` in native.ts. Every call goes to the runtime with the
 * PLATFORM tenant in `x-tenant-id` (the store does not exist yet at sign-up; at sign-in the runtime
 * resolves the store from the account). Passwords and reset tokens are only ever sent in a POST body:
 * never in a URL we build, never logged.
 */
import type { ExchangeResult } from "./native";

export type SignupCountry = "EG" | "SA" | "AE";

export type SignupResult =
  | { readonly ok: true; readonly token: string; readonly expiresIn: number }
  | { readonly ok: true; readonly signInRequired: true }
  | {
      readonly ok: false;
      readonly reason: "taken" | "invalid" | "limited" | "unavailable";
      readonly fields?: readonly { field: string; message: string }[];
    };

export type MerchantResetRequestResult = "sent" | "limited" | "unavailable";
export type MerchantResetCompleteResult = "done" | "invalid" | "weak" | "limited" | "unavailable";

const PUBLIC = "/api/v1/public";

/** The public "Create a store" sign-up is shown only when the operator opts in. */
export function signupEnabled(): boolean {
  const value = process.env["ADMIN_SIGNUP_ENABLED"];
  return value === "1" || value === "true";
}

interface Reply {
  readonly status: number;
  readonly body: unknown;
}

/** POSTs JSON; `null` on a network failure. The reply body is parsed leniently (unparseable is `null`). */
async function post(
  url: string,
  tenantId: string,
  body: unknown,
  fetchImpl: typeof fetch | undefined,
): Promise<Reply | null> {
  const doFetch = fetchImpl ?? fetch;
  try {
    const response = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": tenantId },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const parsed: unknown = await response.json().catch(() => null);
    return { status: response.status, body: parsed };
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function fieldIssues(value: unknown): { field: string; message: string }[] {
  if (!Array.isArray(value)) return [];
  const issues: { field: string; message: string }[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const field = record["field"];
    const message = record["message"];
    if (typeof field === "string" && typeof message === "string") issues.push({ field, message });
  }
  return issues;
}

export async function signUpMerchant(input: {
  readonly runtimeUrl: string;
  readonly tenantId: string;
  readonly storeName: string;
  readonly email: string;
  readonly password: string;
  readonly country: SignupCountry;
  readonly fetchImpl?: typeof fetch;
}): Promise<SignupResult> {
  const reply = await post(
    `${input.runtimeUrl}${PUBLIC}/merchant-signup`,
    input.tenantId,
    {
      storeName: input.storeName,
      email: input.email,
      password: input.password,
      country: input.country,
    },
    input.fetchImpl,
  );
  if (reply === null) return { ok: false, reason: "unavailable" };
  if (reply.status === 201) {
    const body = asRecord(reply.body);
    const token = body["accessToken"];
    const expiresIn = body["expiresIn"];
    if (typeof token === "string" && typeof expiresIn === "number") {
      return { ok: true, token, expiresIn };
    }
    if (body["signInRequired"] === true) return { ok: true, signInRequired: true };
    return { ok: false, reason: "unavailable" };
  }
  if (reply.status === 409) return { ok: false, reason: "taken" };
  if (reply.status === 400 || reply.status === 422) {
    const fields = fieldIssues(asRecord(reply.body)["fields"]);
    return fields.length > 0
      ? { ok: false, reason: "invalid", fields }
      : { ok: false, reason: "invalid" };
  }
  if (reply.status === 429) return { ok: false, reason: "limited" };
  return { ok: false, reason: "unavailable" };
}

export async function exchangeMerchantPassword(input: {
  readonly runtimeUrl: string;
  readonly tenantId: string;
  readonly email: string;
  readonly password: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<ExchangeResult> {
  const reply = await post(
    `${input.runtimeUrl}${PUBLIC}/auth/merchant/login`,
    input.tenantId,
    { email: input.email, password: input.password },
    input.fetchImpl,
  );
  if (reply === null) return { ok: false, reason: "unavailable" };
  if (reply.status === 401) return { ok: false, reason: "invalid" };
  if (reply.status === 403) {
    // The runtime passes the staff MFA response through as `{ error: { code }, mfaRequirement }`;
    // a flat `{ code }` envelope is accepted too.
    const body = asRecord(reply.body);
    const code = body["code"] ?? asRecord(body["error"])["code"];
    return code === "MFA_REQUIRED"
      ? { ok: false, reason: "mfa" }
      : { ok: false, reason: "unavailable" };
  }
  if (reply.status !== 200) return { ok: false, reason: "unavailable" };
  const body = asRecord(reply.body);
  const token = body["accessToken"];
  const expiresIn = body["expiresIn"];
  if (typeof token !== "string" || typeof expiresIn !== "number") {
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, token, expiresIn };
}

export async function requestMerchantReset(input: {
  readonly runtimeUrl: string;
  readonly tenantId: string;
  readonly email: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<MerchantResetRequestResult> {
  const reply = await post(
    `${input.runtimeUrl}${PUBLIC}/auth/merchant/password-reset/request`,
    input.tenantId,
    { email: input.email },
    input.fetchImpl,
  );
  if (reply?.status === 202) return "sent";
  if (reply?.status === 429) return "limited";
  return "unavailable";
}

export async function completeMerchantReset(input: {
  readonly runtimeUrl: string;
  readonly tenantId: string;
  readonly store: string;
  readonly token: string;
  readonly password: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<MerchantResetCompleteResult> {
  const reply = await post(
    `${input.runtimeUrl}${PUBLIC}/auth/merchant/password-reset/complete`,
    input.tenantId,
    { store: input.store, token: input.token, password: input.password },
    input.fetchImpl,
  );
  if (reply === null) return "unavailable";
  if (reply.status === 200) return "done";
  if (reply.status === 400) return "invalid";
  if (reply.status === 422) return "weak";
  if (reply.status === 429) return "limited";
  return "unavailable";
}

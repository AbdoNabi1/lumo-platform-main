import { errorCodeOf } from "./mfa-challenge";
import type { MfaVia } from "./mfa-cookies";
import { isBackupCodesBody, isTwoStepSetup, type TwoStepSetup } from "@/lib/staff/two-step";

/**
 * Wave 1f — two-step setup at sign-in: the server side of the `/login/setup` screen. Posts the SETUP
 * challenge (from its httpOnly cookie) to the runtime and never throws, like `verifyLoginCode`. The
 * challenge, the setup key and the code travel only in POST bodies and responses: never in a URL, a
 * log or a cookie other than the httpOnly challenge cookie.
 *
 * The wire (committed backend, `staff-login-verify.ts`): start → 201 `{ enrollmentId, manualKey,
 * provisioningUri }`; confirm → 200 `{ accessToken, tokenType, expiresIn, backupCodes }`. A wrong code
 * is 401 `{ error: { code: "INVALID_CODE" } }`; a spent/expired/foreign challenge is 401
 * `{ error: { code: "CHALLENGE_EXPIRED" } }`; both read as `body.error?.code ?? body.code`. 429 is the
 * flat `RATE_LIMITED`; 5xx is an outage.
 */
const SETUP_PATH: Readonly<Record<MfaVia, string>> = {
  merchant: "/api/v1/public/auth/merchant/login/setup",
  staff: "/api/v1/public/auth/staff/login/setup",
};

/** `code` = try again here; `expired` = start over; `limited` = wait; `unavailable` = outage. */
export type SetupFailure = "code" | "expired" | "limited" | "unavailable";

export type StartSetupResult =
  | { readonly ok: true; readonly setup: TwoStepSetup }
  | { readonly ok: false; readonly reason: SetupFailure };

export type ConfirmSetupResult =
  | {
      readonly ok: true;
      readonly token: string;
      readonly expiresIn: number;
      readonly backupCodes: readonly string[];
    }
  | { readonly ok: false; readonly reason: SetupFailure };

interface Reply {
  readonly status: number;
  readonly body: unknown;
}

async function post(
  input: {
    readonly runtimeUrl: string;
    readonly tenantId: string;
    readonly via: MfaVia;
    readonly fetchImpl?: typeof fetch;
  },
  step: "start" | "confirm",
  body: unknown,
): Promise<Reply | null> {
  const doFetch = input.fetchImpl ?? fetch;
  try {
    const response = await doFetch(`${input.runtimeUrl}${SETUP_PATH[input.via]}/${step}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": input.tenantId },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const parsed: unknown = await response.json().catch(() => null);
    return { status: response.status, body: parsed };
  } catch {
    return null;
  }
}

/** The failure for a non-2xx answer: only a wrong code is retried in place; every other 401 starts over. */
function failureOf(reply: Reply, step: "start" | "confirm"): SetupFailure {
  if (reply.status === 429) return "limited";
  if (reply.status === 401) {
    return step === "confirm" && errorCodeOf(reply.body) === "INVALID_CODE" ? "code" : "expired";
  }
  // A malformed code the runtime refuses on shape is still just "that code didn't work".
  if (reply.status === 422 && step === "confirm") return "code";
  return "unavailable";
}

export async function startLoginSetup(input: {
  readonly runtimeUrl: string;
  readonly tenantId: string;
  readonly via: MfaVia;
  readonly setupChallenge: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<StartSetupResult> {
  const reply = await post(input, "start", { setupChallenge: input.setupChallenge });
  if (reply === null) return { ok: false, reason: "unavailable" };
  if (reply.status !== 201 && reply.status !== 200) {
    return { ok: false, reason: failureOf(reply, "start") };
  }
  if (!isTwoStepSetup(reply.body)) return { ok: false, reason: "unavailable" };
  const { enrollmentId, manualKey, provisioningUri } = reply.body;
  return { ok: true, setup: { enrollmentId, manualKey, provisioningUri } };
}

export async function confirmLoginSetup(input: {
  readonly runtimeUrl: string;
  readonly tenantId: string;
  readonly via: MfaVia;
  readonly setupChallenge: string;
  readonly enrollmentId: string;
  readonly code: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<ConfirmSetupResult> {
  const reply = await post(input, "confirm", {
    setupChallenge: input.setupChallenge,
    enrollmentId: input.enrollmentId,
    code: input.code,
  });
  if (reply === null) return { ok: false, reason: "unavailable" };
  if (reply.status !== 200) return { ok: false, reason: failureOf(reply, "confirm") };
  const record =
    typeof reply.body === "object" && reply.body !== null
      ? (reply.body as Record<string, unknown>)
      : {};
  const token = record["accessToken"];
  const expiresIn = record["expiresIn"];
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    typeof expiresIn !== "number" ||
    !isBackupCodesBody(reply.body)
  ) {
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, token, expiresIn, backupCodes: reply.body.backupCodes };
}

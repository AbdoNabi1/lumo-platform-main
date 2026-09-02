"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  authenticate,
  blockDevice,
  decideMfa,
  enrollMfa,
  establishSession,
  evaluateRisk,
  generateBackupCodes,
  recordDeviceSignal,
  refreshSession,
  registerAuthMethod,
  registerDevice,
  registerMfaMethod,
  revokeAllSessions,
  revokeMfa,
  revokeSession,
  trustDevice,
  verifyMfaEnrollment,
  type AuthenticationOutcomeDto,
  type AuthMethodKind,
  type BackupCodesOutputDto,
  type DeviceSignalSeverity,
  type MfaDecisionDto,
  type MfaMethodKind,
  type RiskBand,
  type RiskEvaluationDto,
} from "@/lib/api/security";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.12e — Sessions & Authentication's write actions: the plan's named "session revocation"
 * high-blast-radius category. Same `apps/admin-web/README.md` write-screen recipe every prior
 * Phase 5 security task uses: parse `FormData` defensively, mint one `Idempotency-Key` per
 * invocation (constraint #8), call the typed `lib/api/security.ts` function,
 * `revalidatePath("/security/sessions")` on `ok` (except `authenticateAction`/`decideMfaAction`/
 * `evaluateRiskAction` — simulation/preview tools per their own doc comments in `lib/api/security.ts`,
 * matching T5.12a/d's `checkAiActionAction`/`checkThreatIndicatorAction`/`evaluateComplianceAction`),
 * otherwise project through `toFormState`.
 */

const AUTH_METHOD_KINDS: readonly AuthMethodKind[] = [
  "password",
  "passkey",
  "magic_link",
  "otp",
  "email_verification",
  "phone_verification",
  "oauth",
  "oidc",
  "saml",
  "ldap",
  "enterprise_sso",
];

function isAuthMethodKind(value: string): value is AuthMethodKind {
  return (AUTH_METHOD_KINDS as readonly string[]).includes(value);
}

const MFA_METHOD_KINDS: readonly MfaMethodKind[] = [
  "totp",
  "webauthn",
  "sms_otp",
  "email_otp",
  "backup_code",
];

function isMfaMethodKind(value: string): value is MfaMethodKind {
  return (MFA_METHOD_KINDS as readonly string[]).includes(value);
}

const SIGNAL_SEVERITIES: readonly DeviceSignalSeverity[] = ["low", "medium", "high"];

function isSignalSeverity(value: string): value is DeviceSignalSeverity {
  return (SIGNAL_SEVERITIES as readonly string[]).includes(value);
}

const RISK_BANDS: readonly RiskBand[] = ["low", "moderate", "elevated", "high"];

function isRiskBand(value: string): value is RiskBand {
  return (RISK_BANDS as readonly string[]).includes(value);
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Empty string -> `undefined` (an omitted optional field), not a validation failure. */
function optionalStringField(formData: FormData, name: string): string | undefined {
  const value = stringField(formData, name).trim();
  return value.length === 0 ? undefined : value;
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

// ── Sessions ─────────────────────────────────────────────────────────────────────────────────────

/** Establishes a session for a principal — a standalone create form. */
export async function establishSessionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const principalExternalId = stringField(formData, "principalExternalId").trim();
  const refreshFingerprint = stringField(formData, "refreshFingerprint").trim();
  const externalRef = optionalStringField(formData, "externalRef");
  const deviceRef = optionalStringField(formData, "deviceRef");
  const ttlSecondsRaw = optionalStringField(formData, "ttlSeconds");
  const ttlSeconds = ttlSecondsRaw === undefined ? Number.NaN : Number.parseInt(ttlSecondsRaw, 10);

  const fieldErrors: Record<string, string> = {};
  if (principalExternalId.length === 0) fieldErrors["principalExternalId"] = t.invalid;
  if (refreshFingerprint.length === 0) fieldErrors["refreshFingerprint"] = t.invalid;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) fieldErrors["ttlSeconds"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await establishSession(
    { principalExternalId, refreshFingerprint, externalRef, deviceRef, ttlSeconds },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/sessions");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Rotates the refresh token and extends a session — a per-row control on the session explorer.
 * `sessionId` is re-derived from the submitted `FormData` (a per-row hidden field), same discipline
 * `triageIncidentAction` (T5.12d) documents for its own per-row field.
 */
export async function refreshSessionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const sessionId = stringField(formData, "sessionId").trim();
  const newRefreshFingerprint = stringField(formData, "newRefreshFingerprint").trim();
  const ttlSecondsRaw = optionalStringField(formData, "ttlSeconds");
  const ttlSeconds = ttlSecondsRaw === undefined ? Number.NaN : Number.parseInt(ttlSecondsRaw, 10);

  const fieldErrors: Record<string, string> = {};
  if (sessionId.length === 0) fieldErrors["sessionId"] = t.invalid;
  if (newRefreshFingerprint.length === 0) fieldErrors["newRefreshFingerprint"] = t.invalid;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) fieldErrors["ttlSeconds"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await refreshSession(
    sessionId,
    { newRefreshFingerprint, ttlSeconds },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/sessions");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Revokes a single session — the literal "session revocation" control, a per-row control on the
 * session explorer. Confirmed client-side before submit (constraint #10) — see
 * `RevokeSessionRowForm`.
 */
export async function revokeSessionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const sessionId = stringField(formData, "sessionId").trim();
  if (sessionId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: { sessionId: t.invalid } };
  }

  const result = await revokeSession(sessionId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/sessions");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * "Force logout everywhere" for a principal — the plan's single highest-blast-radius control in
 * this part. The client component (`RevokeAllSessionsForm`) confirms with an explicit dialog
 * naming the exact `principalExternalId` typed into the form, not the generic confirm text this
 * screen's other destructive controls use (constraint #10).
 */
export async function revokeAllSessionsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const principalExternalId = stringField(formData, "principalExternalId").trim();
  if (principalExternalId.length === 0) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: { principalExternalId: t.invalid },
    };
  }

  const result = await revokeAllSessions(principalExternalId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/sessions");
    return { status: "success" };
  }
  return toFormState(result, t);
}

// ── Auth methods & authenticate ─────────────────────────────────────────────────────────────────

/** Registers/updates an authentication method — a standalone form. `kind` is a fixed 11-value enum. */
export async function registerAuthMethodAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const kindRaw = stringField(formData, "kind").trim();
  const displayName = stringField(formData, "displayName").trim();
  const enabled = formData.get("enabled") === "on";

  const fieldErrors: Record<string, string> = {};
  if (!isAuthMethodKind(kindRaw)) fieldErrors["kind"] = t.invalid;
  if (displayName.length === 0) fieldErrors["displayName"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await registerAuthMethod(
    { kind: kindRaw as AuthMethodKind, displayName, enabled },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/sessions");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** What the "Authenticate" preview panel renders — never routed through `toFormState`. */
export type AuthenticateFormState =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly outcome: AuthenticationOutcomeDto }
  | { readonly status: "error"; readonly message: string };

/**
 * Runs the provider-agnostic `authenticate()` flow — a simulation/testing tool for this console
 * (real authentication happens outside the admin app) per the task brief, so it's treated as a
 * "try it" preview panel: never `revalidatePath`s, even though it may establish a real session
 * server-side (see `authenticate`'s doc comment in `lib/api/security.ts`).
 */
export async function authenticateAction(
  _previous: AuthenticateFormState,
  formData: FormData,
): Promise<AuthenticateFormState> {
  const t = await formErrorDictionary();

  const methodRaw = stringField(formData, "method").trim();
  const identifier = stringField(formData, "identifier").trim();
  if (!isAuthMethodKind(methodRaw) || identifier.length === 0) {
    return { status: "error", message: t.invalid };
  }
  const credential = optionalStringField(formData, "credential");
  const deviceFingerprint = optionalStringField(formData, "deviceFingerprint");
  const ip = optionalStringField(formData, "ip");
  const sensitiveAction = formData.get("sensitiveAction") === "on";
  const rememberDevice = formData.get("rememberDevice") === "on";
  const mfaSatisfied = formData.get("mfaSatisfied") === "on";
  const sessionTtlSecondsRaw = optionalStringField(formData, "sessionTtlSeconds");
  const sessionTtlSeconds =
    sessionTtlSecondsRaw === undefined ? undefined : Number.parseInt(sessionTtlSecondsRaw, 10);

  const result = await authenticate(
    {
      method: methodRaw,
      identifier,
      credential,
      deviceFingerprint,
      ip,
      sensitiveAction,
      rememberDevice,
      mfaSatisfied,
      sessionTtlSeconds:
        sessionTtlSeconds !== undefined && Number.isInteger(sessionTtlSeconds) && sessionTtlSeconds > 0
          ? sessionTtlSeconds
          : undefined,
    },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") return { status: "success", outcome: result.data };
  if (result.outcome === "unauthorized") return { status: "error", message: t.unauthorized };
  if (result.outcome === "forbidden") return { status: "error", message: t.forbidden };
  if (result.outcome === "not_found") return { status: "error", message: t.notFound };
  if (result.outcome === "conflict") return { status: "error", message: result.message };
  if (result.outcome === "invalid") return { status: "error", message: result.message };
  return { status: "error", message: t.unexpected };
}

// ── Devices ──────────────────────────────────────────────────────────────────────────────────────

/** Registers a device — a standalone form (idempotent per fingerprint; starts untrusted). */
export async function registerDeviceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const fingerprint = stringField(formData, "fingerprint").trim();
  const principalExternalId = optionalStringField(formData, "principalExternalId");
  const tenantRef = optionalStringField(formData, "tenantRef");

  if (fingerprint.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: { fingerprint: t.invalid } };
  }

  const result = await registerDevice(
    { fingerprint, principalExternalId, tenantRef },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/sessions");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Records a device security signal — a per-row control on the device explorer. **Not**
 * `idempotent` on the backend (each call lowers reputation and counts another anomaly), so this
 * still revalidates on success (a real, visible mutation), unlike this file's pure preview panels.
 */
export async function recordDeviceSignalAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const fingerprint = stringField(formData, "fingerprint").trim();
  const type = stringField(formData, "type").trim();
  const severityRaw = stringField(formData, "severity").trim();

  const fieldErrors: Record<string, string> = {};
  if (fingerprint.length === 0) fieldErrors["fingerprint"] = t.invalid;
  if (type.length === 0) fieldErrors["type"] = t.invalid;
  if (!isSignalSeverity(severityRaw)) fieldErrors["severity"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await recordDeviceSignal(
    fingerprint,
    { type, severity: severityRaw as DeviceSignalSeverity },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/sessions");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Explicitly trusts a device (remember-device) — a per-row control on the device explorer. */
export async function trustDeviceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const fingerprint = stringField(formData, "fingerprint").trim();
  if (fingerprint.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: { fingerprint: t.invalid } };
  }

  const result = await trustDevice(fingerprint, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/sessions");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Blocks a device — a per-row control on the device explorer. Confirmed client-side before submit
 * (constraint #10) — see `BlockDeviceRowForm`.
 */
export async function blockDeviceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const fingerprint = stringField(formData, "fingerprint").trim();
  if (fingerprint.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: { fingerprint: t.invalid } };
  }

  const result = await blockDevice(fingerprint, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/sessions");
    return { status: "success" };
  }
  return toFormState(result, t);
}

// ── MFA ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Enrolls a principal in an MFA method — a standalone form (no MFA-enrollment explorer is wired on
 * this page, see `enrollMfa`'s doc comment in `lib/api/security.ts`). `method` is a fixed 5-value
 * enum.
 */
export async function enrollMfaAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const principalExternalId = stringField(formData, "principalExternalId").trim();
  const methodRaw = stringField(formData, "method").trim();

  const fieldErrors: Record<string, string> = {};
  if (principalExternalId.length === 0) fieldErrors["principalExternalId"] = t.invalid;
  if (!isMfaMethodKind(methodRaw)) fieldErrors["method"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await enrollMfa(
    { principalExternalId, method: methodRaw as MfaMethodKind },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/sessions");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Verifies a submitted MFA code and activates a pending enrollment — a standalone form. */
export async function verifyMfaEnrollmentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const enrollmentId = stringField(formData, "enrollmentId").trim();
  const code = stringField(formData, "code").trim();

  const fieldErrors: Record<string, string> = {};
  if (enrollmentId.length === 0) fieldErrors["enrollmentId"] = t.invalid;
  if (code.length === 0) fieldErrors["code"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await verifyMfaEnrollment(enrollmentId, code, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/sessions");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** What the "Generate backup codes" panel renders. `codes` is shown exactly once — never persisted. */
export type GenerateBackupCodesFormState =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly codes: BackupCodesOutputDto["codes"] }
  | {
      readonly status: "error";
      readonly message: string;
      readonly fieldErrors: Readonly<Record<string, string>>;
    };

/**
 * Generates one-time backup codes for an MFA enrollment. **Not** `idempotent` on the backend —
 * every call replaces the existing codes (see `generateBackupCodes`'s doc comment in
 * `lib/api/security.ts`). The codes are returned exactly once in this response; this action never
 * logs them and the success state is the only place they render (constraint #10) — see
 * `GenerateBackupCodesPanel`.
 */
export async function generateBackupCodesAction(
  _previous: GenerateBackupCodesFormState,
  formData: FormData,
): Promise<GenerateBackupCodesFormState> {
  const t = await formErrorDictionary();

  const enrollmentId = stringField(formData, "enrollmentId").trim();
  const countRaw = optionalStringField(formData, "count");
  const count = countRaw === undefined ? undefined : Number.parseInt(countRaw, 10);

  if (enrollmentId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: { enrollmentId: t.invalid } };
  }
  if (count !== undefined && (!Number.isInteger(count) || count <= 0)) {
    return { status: "error", message: t.invalid, fieldErrors: { count: t.invalid } };
  }

  const result = await generateBackupCodes(enrollmentId, count, newIdempotencyKey());
  if (result.outcome === "ok") {
    // A real mutation (not a preview/simulation tool), so this still revalidates like every other
    // write in this file — but never logs `result.data.codes` anywhere: the plaintext must reach
    // only this response's success state, never a log line or a persisted store.
    revalidatePath("/security/sessions");
    return { status: "success", codes: result.data.codes };
  }
  // `result.outcome !== "ok"` here, so `toFormState` always takes one of its error branches —
  // every one of which returns `{ status: "error", message, fieldErrors }`, the exact shape this
  // function's own error variant needs.
  const formState = toFormState(result, t);
  return formState as Extract<GenerateBackupCodesFormState, { readonly status: "error" }>;
}

/**
 * Revokes an MFA enrollment — a standalone form. Confirmed client-side before submit
 * (constraint #10) — see `RevokeMfaForm`.
 */
export async function revokeMfaAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const enrollmentId = stringField(formData, "enrollmentId").trim();
  if (enrollmentId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: { enrollmentId: t.invalid } };
  }

  const result = await revokeMfa(enrollmentId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/sessions");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** What the "Decide MFA" preview panel renders — never routed through `toFormState`. */
export type DecideMfaFormState =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly decision: MfaDecisionDto }
  | { readonly status: "error"; readonly message: string };

/**
 * Decides the MFA requirement a given context would produce — "read-only" per the route's own
 * summary despite being a POST, a simulation/preview panel per the task brief. Never
 * `revalidatePath`s.
 */
export async function decideMfaAction(
  _previous: DecideMfaFormState,
  formData: FormData,
): Promise<DecideMfaFormState> {
  const t = await formErrorDictionary();

  const principalExternalId = stringField(formData, "principalExternalId").trim();
  const riskBandRaw = stringField(formData, "riskBand").trim();
  if (principalExternalId.length === 0 || !isRiskBand(riskBandRaw)) {
    return { status: "error", message: t.invalid };
  }
  const deviceFingerprint = optionalStringField(formData, "deviceFingerprint");
  const sensitiveAction = formData.get("sensitiveAction") === "on";
  const rememberDevice = formData.get("rememberDevice") === "on";

  const result = await decideMfa(
    { principalExternalId, deviceFingerprint, riskBand: riskBandRaw, sensitiveAction, rememberDevice },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") return { status: "success", decision: result.data };
  if (result.outcome === "unauthorized") return { status: "error", message: t.unauthorized };
  if (result.outcome === "forbidden") return { status: "error", message: t.forbidden };
  if (result.outcome === "not_found") return { status: "error", message: t.notFound };
  if (result.outcome === "conflict") return { status: "error", message: result.message };
  if (result.outcome === "invalid") return { status: "error", message: result.message };
  return { status: "error", message: t.unexpected };
}

/** Registers/updates an MFA method definition — a standalone form. `kind` is a fixed 5-value enum. */
export async function registerMfaMethodAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const kindRaw = stringField(formData, "kind").trim();
  const displayName = stringField(formData, "displayName").trim();
  const enabled = formData.get("enabled") === "on";

  const fieldErrors: Record<string, string> = {};
  if (!isMfaMethodKind(kindRaw)) fieldErrors["kind"] = t.invalid;
  if (displayName.length === 0) fieldErrors["displayName"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await registerMfaMethod(
    { kind: kindRaw as MfaMethodKind, displayName, enabled },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/sessions");
    return { status: "success" };
  }
  return toFormState(result, t);
}

// ── Risk ─────────────────────────────────────────────────────────────────────────────────────────

/** What the "Evaluate risk" preview panel renders — never routed through `toFormState`. */
export type EvaluateRiskFormState =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly evaluation: RiskEvaluationDto }
  | { readonly status: "error"; readonly message: string };

/**
 * Evaluates request risk via the Risk Engine ("explainable factors") — a preview/explainer tool
 * per the task brief, not a mutation. Never `revalidatePath`s.
 */
export async function evaluateRiskAction(
  _previous: EvaluateRiskFormState,
  formData: FormData,
): Promise<EvaluateRiskFormState> {
  const t = await formErrorDictionary();

  const principalExternalId = optionalStringField(formData, "principalExternalId");
  const ip = optionalStringField(formData, "ip");
  const deviceFingerprint = optionalStringField(formData, "deviceFingerprint");

  const result = await evaluateRisk(
    { principalExternalId, ip, deviceFingerprint },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") return { status: "success", evaluation: result.data };
  if (result.outcome === "unauthorized") return { status: "error", message: t.unauthorized };
  if (result.outcome === "forbidden") return { status: "error", message: t.forbidden };
  if (result.outcome === "not_found") return { status: "error", message: t.notFound };
  if (result.outcome === "conflict") return { status: "error", message: result.message };
  if (result.outcome === "invalid") return { status: "error", message: result.message };
  return { status: "error", message: t.unexpected };
}

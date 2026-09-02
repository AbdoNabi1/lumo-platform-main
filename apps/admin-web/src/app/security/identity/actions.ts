"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  governMachineIdentity,
  issueCredential,
  registerPrincipal,
  revokeCredential,
  rotateCredential,
  suspendMachineIdentity,
  transitionPrincipal,
  type CredentialKind,
  type PrincipalKind,
  type PrincipalTransitionTarget,
} from "@/lib/api/security";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.12b — Identity's non-credential write actions (register/transition a principal, govern/
 * suspend a machine identity), following the same `apps/admin-web/README.md` write-screen recipe
 * T5.12a's AI Governance actions already use: parse `FormData` defensively, mint one
 * `Idempotency-Key` per invocation (constraint #8), call the typed `lib/api/security.ts` function,
 * `revalidatePath("/security/identity")` on `ok`, otherwise project through `toFormState`.
 *
 * T5.12c adds this file's 3 credential actions (issue/rotate/revoke) at the bottom — same recipe,
 * but they `revalidatePath("/security/secrets")` instead: credential state renders on the secrets
 * screen (secret explorer + lineage lookup), not here, even though the brief places these forms on
 * this page.
 */

const PRINCIPAL_KINDS: readonly PrincipalKind[] = [
  "human",
  "service_account",
  "machine",
  "api_key",
  "robot",
  "partner",
  "marketplace",
  "ai",
];

function isPrincipalKind(value: string): value is PrincipalKind {
  return (PRINCIPAL_KINDS as readonly string[]).includes(value);
}

function isTransitionTarget(value: string): value is PrincipalTransitionTarget {
  return value === "suspended" || value === "active" || value === "disabled";
}

const CREDENTIAL_KINDS: readonly CredentialKind[] = [
  "api_key",
  "secret",
  "certificate",
  "signing_key",
  "oauth_client",
];

function isCredentialKind(value: string): value is CredentialKind {
  return (CREDENTIAL_KINDS as readonly string[]).includes(value);
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

/** `"a, b, c"` -> `["a", "b", "c"]`, empty/blank -> `undefined` (an omitted optional array field). */
function optionalStringListField(formData: FormData, name: string): readonly string[] | undefined {
  const raw = stringField(formData, name).trim();
  if (raw.length === 0) return undefined;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return values.length === 0 ? undefined : values;
}

/**
 * `maxCredentialTtlSeconds`/`rotationIntervalDays` are `int().positive().nullable().optional()` on
 * the backend: omitted means "leave unchanged" (this is a patch), `null` means "clear it", a
 * number sets it. Same "unlimited" checkbox pairing `governAiIdentityAction`'s `nullableIntField`
 * uses, since a bare empty number input can only mean "omitted" here.
 */
function nullableIntField(
  formData: FormData,
  name: string,
  clearName: string,
): { readonly value: number | null | undefined; readonly invalid: boolean } {
  if (formData.get(clearName) === "on") return { value: null, invalid: false };
  const raw = optionalStringField(formData, name);
  if (raw === undefined) return { value: undefined, invalid: false };
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed <= 0
    ? { value: undefined, invalid: true }
    : { value: parsed, invalid: false };
}

/**
 * Empty/blank -> omitted. Otherwise parses a `datetime-local` input's local-time value into an ISO
 * string for the backend's `z.string().datetime().nullable().optional()` (which requires a strict
 * `Z`/offset-suffixed ISO string a raw `datetime-local` value never has). An unparsable value is
 * flagged as invalid rather than silently dropped.
 */
function optionalDateTimeField(
  formData: FormData,
  name: string,
): { readonly value: string | undefined; readonly invalid: boolean } {
  const raw = optionalStringField(formData, name);
  if (raw === undefined) return { value: undefined, invalid: false };
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime())
    ? { value: undefined, invalid: true }
    : { value: parsed.toISOString(), invalid: false };
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

/** Registers a principal. `kind` gates whether `subjectRef` is required — enforced server-side (`Principal.register`); a mismatch surfaces as a normal form error. */
export async function registerPrincipalAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const externalId = stringField(formData, "externalId").trim();
  const kindRaw = stringField(formData, "kind").trim();
  const displayName = stringField(formData, "displayName").trim();
  const subjectRef = optionalStringField(formData, "subjectRef");
  const tenantRef = optionalStringField(formData, "tenantRef");

  const fieldErrors: Record<string, string> = {};
  if (externalId.length === 0) fieldErrors["externalId"] = t.invalid;
  if (!isPrincipalKind(kindRaw)) fieldErrors["kind"] = t.invalid;
  if (displayName.length === 0) fieldErrors["displayName"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await registerPrincipal(
    {
      externalId,
      kind: kindRaw as PrincipalKind,
      displayName,
      subjectRef,
      tenantRef,
    },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/identity");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Advances a principal's lifecycle. `externalId` is re-derived from the submitted `FormData`
 * (a per-row hidden field, not a trusted closure variable) and `to` is validated to be one of the
 * three backend enum values; whether it's actually legal *from the principal's current status* is
 * gated client-side by `PRINCIPAL_STATUS_TRANSITIONS` (the per-row control only offers legal
 * options) and re-enforced authoritatively by `Principal.transition` — an illegal one still
 * surfaces here as a normal form error, never silently dropped.
 */
export async function transitionPrincipalAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const externalId = stringField(formData, "externalId").trim();
  const toRaw = stringField(formData, "to").trim();

  const fieldErrors: Record<string, string> = {};
  if (externalId.length === 0) fieldErrors["externalId"] = t.invalid;
  if (!isTransitionTarget(toRaw)) fieldErrors["to"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await transitionPrincipal(
    externalId,
    toRaw as PrincipalTransitionTarget,
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/identity");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Governs (creates or patches) a non-human principal's machine-identity profile. Every field but
 * `externalId` is optional — a blank input omits that field from the patch rather than sending an
 * empty/zero value, same discipline as `governAiIdentityAction`.
 */
export async function governMachineIdentityAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const externalId = stringField(formData, "externalId").trim();
  const owner = optionalStringField(formData, "owner");
  const purpose = optionalStringField(formData, "purpose");
  const allowedEnvironments = optionalStringListField(formData, "allowedEnvironments");
  const allowedScopes = optionalStringListField(formData, "allowedScopes");
  const maxCredentialTtlSeconds = nullableIntField(
    formData,
    "maxCredentialTtlSeconds",
    "maxCredentialTtlSecondsUnlimited",
  );
  const rotationIntervalDays = nullableIntField(
    formData,
    "rotationIntervalDays",
    "rotationIntervalDaysUnlimited",
  );

  const fieldErrors: Record<string, string> = {};
  if (externalId.length === 0) fieldErrors["externalId"] = t.invalid;
  if (maxCredentialTtlSeconds.invalid) fieldErrors["maxCredentialTtlSeconds"] = t.invalid;
  if (rotationIntervalDays.invalid) fieldErrors["rotationIntervalDays"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await governMachineIdentity(
    externalId,
    {
      owner,
      purpose,
      allowedEnvironments,
      allowedScopes,
      maxCredentialTtlSeconds: maxCredentialTtlSeconds.value,
      rotationIntervalDays: rotationIntervalDays.value,
    },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/identity");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * The kill-switch. `MachineIdentityExplorerDto`'s rows expose `principalRef` (the profile's
 * internal principal id, not the `externalId` the route needs — see `MachineIdentityOutputDto`'s
 * doc comment in `lib/api/security.ts`), so there's no id to attach this to per-row; the form
 * takes a manual `externalId` field instead, confirmed client-side before submit (constraint #10).
 */
export async function suspendMachineIdentityAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const externalId = stringField(formData, "externalId").trim();
  if (externalId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: { externalId: t.invalid } };
  }

  const result = await suspendMachineIdentity(externalId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/identity");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Issues a credential for a principal (T5.12c). `material` is a handle to the secret value that's
 * fingerprinted server-side and never persisted or returned (`issueCredential`'s doc comment in
 * `lib/api/security.ts`) — this form does not echo it back after a successful submit. `expiresAt`
 * is optional; a `datetime-local` input converted to an ISO string by `optionalDateTimeField`.
 * Credential state renders on the secrets screen, so this revalidates that path, not this one.
 */
export async function issueCredentialAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const principalExternalId = stringField(formData, "principalExternalId").trim();
  const kindRaw = stringField(formData, "kind").trim();
  const material = stringField(formData, "material");
  const expiresAt = optionalDateTimeField(formData, "expiresAt");

  const fieldErrors: Record<string, string> = {};
  if (principalExternalId.length === 0) fieldErrors["principalExternalId"] = t.invalid;
  if (!isCredentialKind(kindRaw)) fieldErrors["kind"] = t.invalid;
  if (material.length === 0) fieldErrors["material"] = t.invalid;
  if (expiresAt.invalid) fieldErrors["expiresAt"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await issueCredential(
    {
      principalExternalId,
      kind: kindRaw as CredentialKind,
      material,
      expiresAt: expiresAt.value,
    },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/secrets");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Rotates a credential (T5.12c). `credentialId` is a manual field — neither `IdentityOverviewDto`
 * nor `MachineIdentityExplorerDto` (the two read models this page renders) list credentials at all,
 * so there's no row to attach this to; same standalone shape `suspendMachineIdentityAction` already
 * uses for the same reason. Marks the current credential rotated and issues a superseding one.
 */
export async function rotateCredentialAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const credentialId = stringField(formData, "credentialId").trim();
  const newMaterial = stringField(formData, "newMaterial");

  const fieldErrors: Record<string, string> = {};
  if (credentialId.length === 0) fieldErrors["credentialId"] = t.invalid;
  if (newMaterial.length === 0) fieldErrors["newMaterial"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await rotateCredential(credentialId, newMaterial, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/secrets");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Revokes a credential immediately (T5.12c) — no "un-revoke" route exists, so this is irreversible
 * from this screen; confirmed client-side before submit (constraint #10). Standalone with a manual
 * `credentialId` field, same reasoning as `rotateCredentialAction`.
 */
export async function revokeCredentialAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const credentialId = stringField(formData, "credentialId").trim();
  if (credentialId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: { credentialId: t.invalid } };
  }

  const result = await revokeCredential(credentialId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/secrets");
    return { status: "success" };
  }
  return toFormState(result, t);
}

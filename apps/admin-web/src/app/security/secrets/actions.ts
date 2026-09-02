"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  emergencyRevokeCredentials,
  rotateDueCredentials,
  scheduleCredentialRotation,
} from "@/lib/api/security";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.12c — Secrets' credential-rotation write actions (schedule a rotation policy, force the
 * scheduler-driven bulk rotation to run now, and the breach-response emergency revoke), following
 * the same `apps/admin-web/README.md` write-screen recipe every prior Phase 5 security task uses:
 * parse `FormData` defensively, mint one `Idempotency-Key` per invocation (constraint #8), call the
 * typed `lib/api/security.ts` function, `revalidatePath("/security/secrets")` on `ok`, otherwise
 * project through `toFormState`. The other 3 credential routes in this task (issue/rotate/revoke)
 * are `apps/admin-web/src/app/security/identity/actions.ts`'s — that's where the brief places their
 * forms — even though they also revalidate this path.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function optionalStringField(formData: FormData, name: string): string | undefined {
  const value = stringField(formData, name).trim();
  return value.length === 0 ? undefined : value;
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

/**
 * Attaches a rotation policy to a credential. `credentialId` is a manual field — investigated fresh
 * for this task: `SecretExplorerDto`'s rows (`lib/api/security.ts`'s `SecretRowDto`) expose only
 * `principalRef`/`kind`/`status`/`rotationDueAt`/`autoRotate`, no credential id at all, so there's
 * nothing to attach a per-row form to — same conclusion, same reason, `suspendMachineIdentityAction`
 * and `suspendAiIdentityAction` already documented for their own explorers in T5.12a/b.
 */
export async function scheduleCredentialRotationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const credentialId = stringField(formData, "credentialId").trim();
  const intervalDaysRaw = optionalStringField(formData, "intervalDays");
  const graceSecondsRaw = optionalStringField(formData, "graceSeconds");
  const autoRotate = formData.get("autoRotate") === "on";

  const intervalDays = intervalDaysRaw === undefined ? Number.NaN : Number.parseInt(intervalDaysRaw, 10);
  const graceSeconds = graceSecondsRaw === undefined ? Number.NaN : Number.parseInt(graceSecondsRaw, 10);

  const fieldErrors: Record<string, string> = {};
  if (credentialId.length === 0) fieldErrors["credentialId"] = t.invalid;
  if (!Number.isInteger(intervalDays) || intervalDays <= 0) fieldErrors["intervalDays"] = t.invalid;
  if (!Number.isInteger(graceSeconds) || graceSeconds < 0) fieldErrors["graceSeconds"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await scheduleCredentialRotation(
    credentialId,
    { intervalDays, graceSeconds, autoRotate },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/secrets");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Forces the scheduler-driven bulk rotation to run now — rotates every credential whose scheduled
 * rotation is due. **Not** `idempotent` on the backend (route table): unlike this file's other two
 * actions, a resubmit isn't a guaranteed no-op (a credential that rotates mid-flight could be picked
 * up twice in an unlucky race), so it's confirmed client-side before submit (constraint #10) same as
 * every other bulk/destructive action in this task.
 */
export async function rotateDueCredentialsAction(
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const result = await rotateDueCredentials(newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/secrets");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * The breach-response kill-switch — revokes every non-terminal credential a principal holds, in one
 * call. The plan's named "credential rotation" high-blast-radius category's single
 * highest-blast-radius action (`EmergencyRevokeCredentials.execute`'s own doc comment calls it out:
 * "breach response"). The client component confirms this with an explicit dialog naming the exact
 * `principalExternalId` submitted and stating the full blast radius, not a generic "are you sure?"
 * (constraint #10) — see `EmergencyRevokeCredentialsForm` in `components/security/secrets-actions.tsx`.
 */
export async function emergencyRevokeCredentialsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const principalExternalId = stringField(formData, "principalExternalId").trim();
  const reason = stringField(formData, "reason").trim();

  const fieldErrors: Record<string, string> = {};
  if (principalExternalId.length === 0) fieldErrors["principalExternalId"] = t.invalid;
  if (reason.length === 0) fieldErrors["reason"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await emergencyRevokeCredentials(
    { principalExternalId, reason },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/secrets");
    return { status: "success" };
  }
  return toFormState(result, t);
}

"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addFeatureFlagRule,
  advanceFeatureFlag,
  createFeatureFlag,
  setFeatureFlagEnvironmentOverride,
  setFeatureFlagRollout,
  type FeatureFlagStatus,
} from "@/lib/api/feature-flags";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.11b — the Feature Flags screens' write actions (`app/feature-flags/new/page.tsx`,
 * `app/feature-flags/[flagId]/page.tsx`). Same shape every write action in this app follows
 * (`apps/admin-web/README.md`'s recipe): parse `FormData` defensively (never trust a hidden field
 * or a closure variable — re-derive `flagId` from the submission itself), mint exactly one
 * idempotency key per submit for the routes the route table marks idempotent, call the typed
 * `lib/api/feature-flags.ts` function, and project any non-`ok` outcome through `toFormState`.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Empty string -> `undefined` (an omitted optional zod field), not a validation failure. */
function optionalStringField(formData: FormData, name: string): string | undefined {
  const value = stringField(formData, name).trim();
  return value.length === 0 ? undefined : value;
}

function isFeatureFlagStatus(value: string): value is FeatureFlagStatus {
  return value === "active" || value === "killed" || value === "archived";
}

/** Splits a comma-separated text input into a trimmed, non-empty string array — same technique `notificationCreateForm`'s `channels` field uses. */
function parseCommaSeparated(value: string): readonly string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

/** Both screens that show one feature flag's data. */
function revalidateFeatureFlagScreens(flagId: string): void {
  revalidatePath("/feature-flags");
  revalidatePath(`/feature-flags/${flagId}`);
}

/** Creates a feature flag (`FeatureFlagCreateForm`, `app/feature-flags/new/page.tsx`) — always active at 0% rollout. */
export async function createFeatureFlagAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const key = stringField(formData, "key");
  const name = stringField(formData, "name");
  const description = optionalStringField(formData, "description");

  const fieldErrors: Record<string, string> = {};
  if (key.length === 0) fieldErrors["key"] = t.invalid;
  if (name.length === 0) fieldErrors["name"] = t.invalid;
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await createFeatureFlag({ key, name, description }, newIdempotencyKey());

  if (result.outcome === "ok") {
    revalidatePath("/feature-flags");
    redirect(`/feature-flags/${result.data.id}`);
  }
  return toFormState(result, t);
}

/** `POST /feature-flags/:flagId/transitions` (`AdvanceForm`) — the only status-changing route on this domain. */
export async function advanceFeatureFlagAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const flagId = stringField(formData, "flagId");
  const toStatus = stringField(formData, "toStatus");
  const changedBy = stringField(formData, "changedBy");

  const fieldErrors: Record<string, string> = {};
  if (!isFeatureFlagStatus(toStatus)) fieldErrors["toStatus"] = t.invalid;
  if (changedBy.length === 0) fieldErrors["changedBy"] = t.invalid;
  if (flagId.length === 0 || !isFeatureFlagStatus(toStatus) || Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await advanceFeatureFlag(flagId, toStatus, changedBy, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateFeatureFlagScreens(flagId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** `POST /feature-flags/:flagId/rollout` (`RolloutForm`). */
export async function setFeatureFlagRolloutAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const flagId = stringField(formData, "flagId");
  const percentage = Number.parseFloat(stringField(formData, "percentage"));
  const changedBy = stringField(formData, "changedBy");

  const fieldErrors: Record<string, string> = {};
  if (Number.isNaN(percentage) || percentage < 0 || percentage > 100) {
    fieldErrors["percentage"] = t.invalid;
  }
  if (changedBy.length === 0) fieldErrors["changedBy"] = t.invalid;
  if (flagId.length === 0 || Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await setFeatureFlagRollout(flagId, percentage, changedBy, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateFeatureFlagScreens(flagId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * `POST /feature-flags/:flagId/rules` (`AddRuleForm`) — **not** idempotent, per the route table:
 * no `newIdempotencyKey()` call, so no `Idempotency-Key` header is sent (same precedent
 * `sendNotificationAction`/`reportReviewAction` follow for their own non-idempotent routes).
 */
export async function addFeatureFlagRuleAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const flagId = stringField(formData, "flagId");
  const type = stringField(formData, "type");
  const values = parseCommaSeparated(stringField(formData, "values"));
  const enabled = formData.get("enabled") === "on";
  const attribute = optionalStringField(formData, "attribute");
  const changedBy = stringField(formData, "changedBy");

  const fieldErrors: Record<string, string> = {};
  if (type !== "tenant" && type !== "user" && type !== "attribute") {
    fieldErrors["type"] = t.invalid;
  }
  if (values.length === 0) fieldErrors["values"] = t.invalid;
  if (changedBy.length === 0) fieldErrors["changedBy"] = t.invalid;
  if (flagId.length === 0 || Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await addFeatureFlagRule(flagId, {
    type: type as "tenant" | "user" | "attribute",
    values,
    enabled,
    attribute,
    changedBy,
  });
  if (result.outcome === "ok") {
    revalidateFeatureFlagScreens(flagId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** `POST /feature-flags/:flagId/environment-overrides` (`EnvironmentOverrideForm`). */
export async function setFeatureFlagEnvironmentOverrideAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const flagId = stringField(formData, "flagId");
  const environment = stringField(formData, "environment");
  const enabled = formData.get("enabled") === "on";
  const rolloutPercentageRaw = stringField(formData, "rolloutPercentage").trim();
  const rolloutPercentage =
    rolloutPercentageRaw.length === 0 ? undefined : Number.parseFloat(rolloutPercentageRaw);
  const changedBy = stringField(formData, "changedBy");

  const fieldErrors: Record<string, string> = {};
  if (environment.length === 0) fieldErrors["environment"] = t.invalid;
  if (rolloutPercentage !== undefined && (Number.isNaN(rolloutPercentage) || rolloutPercentage < 0 || rolloutPercentage > 100)) {
    fieldErrors["rolloutPercentage"] = t.invalid;
  }
  if (changedBy.length === 0) fieldErrors["changedBy"] = t.invalid;
  if (flagId.length === 0 || Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await setFeatureFlagEnvironmentOverride(
    flagId,
    { environment, enabled, rolloutPercentage, changedBy },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidateFeatureFlagScreens(flagId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

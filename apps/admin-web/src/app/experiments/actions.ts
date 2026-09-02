"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  advanceExperiment,
  createExperiment,
  declareExperimentWinner,
  recordExperimentResult,
  type CreateExperimentVariantInput,
  type ExperimentStatus,
} from "@/lib/api/experimentation";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.11b — the Experiments screens' write actions (`app/experiments/new/page.tsx`,
 * `app/experiments/[experimentId]/page.tsx`). Same shape every write action in this app follows
 * (`apps/admin-web/README.md`'s recipe): parse `FormData` defensively (never trust a hidden field
 * or a closure variable — re-derive `experimentId` from the submission itself), mint exactly one
 * idempotency key per submit for the routes the route table marks idempotent, call the typed
 * `lib/api/experimentation.ts` function, and project any non-`ok` outcome through `toFormState`.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function stringFieldValues(formData: FormData, name: string): readonly string[] {
  return formData.getAll(name).map((value) => (typeof value === "string" ? value : ""));
}

/** Empty string -> `undefined` (an omitted optional zod field), not a validation failure. */
function optionalStringField(formData: FormData, name: string): string | undefined {
  const value = stringField(formData, name).trim();
  return value.length === 0 ? undefined : value;
}

function parseCommaSeparated(value: string): readonly string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isExperimentStatus(value: string): value is ExperimentStatus {
  return (
    value === "draft" ||
    value === "running" ||
    value === "paused" ||
    value === "completed" ||
    value === "archived"
  );
}

/**
 * Parses the `variants` row group's parallel `variantKey`/`variantAllocationPercentage`/
 * `variantIsControl` repeated inputs — same array-field pattern as `app/components-library/
 * actions.ts`'s `parseProperties`. A row whose key is blank is dropped rather than rejected.
 * Returns `null` only for a genuinely malformed row (a non-numeric allocation).
 */
function parseVariants(formData: FormData): readonly CreateExperimentVariantInput[] | null {
  const keys = stringFieldValues(formData, "variantKey");
  const allocations = stringFieldValues(formData, "variantAllocationPercentage");
  const controls = stringFieldValues(formData, "variantIsControl");
  const variants: CreateExperimentVariantInput[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = (keys[index] ?? "").trim();
    if (key.length === 0) continue;
    const allocationPercentage = Number.parseFloat(allocations[index] ?? "");
    if (Number.isNaN(allocationPercentage)) return null;
    const isControl = (controls[index] ?? "false") === "true";
    variants.push({ key, allocationPercentage, isControl });
  }
  return variants;
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

/** Both screens that show one experiment's data. */
function revalidateExperimentScreens(experimentId: string): void {
  revalidatePath("/experiments");
  revalidatePath(`/experiments/${experimentId}`);
}

/**
 * Creates an experiment (`ExperimentCreateForm`, `app/experiments/new/page.tsx`). Per the task
 * brief, variant allocations must sum to 100 — the client checks this first for a fast error
 * (`ExperimentCreateForm`'s `handleSubmit`), and this action re-checks it as defense in depth; the
 * backend remains authoritative either way.
 */
export async function createExperimentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const name = stringField(formData, "name");
  const hypothesis = optionalStringField(formData, "hypothesis");
  const goalMetricRef = stringField(formData, "goalMetricRef");
  const audiencePercentageRaw = stringField(formData, "audiencePercentage").trim();
  const audiencePercentage =
    audiencePercentageRaw.length === 0 ? undefined : Number.parseFloat(audiencePercentageRaw);
  const audienceSegmentRefs = parseCommaSeparated(
    stringField(formData, "audienceSegmentRefs"),
  );
  const featureFlagRef = optionalStringField(formData, "featureFlagRef");
  const variants = parseVariants(formData);

  const fieldErrors: Record<string, string> = {};
  if (name.length === 0) fieldErrors["name"] = t.invalid;
  if (goalMetricRef.length === 0) fieldErrors["goalMetricRef"] = t.invalid;
  if (
    audiencePercentage !== undefined &&
    (Number.isNaN(audiencePercentage) || audiencePercentage < 0 || audiencePercentage > 100)
  ) {
    fieldErrors["audiencePercentage"] = t.invalid;
  }
  if (variants === null || variants.length === 0) {
    fieldErrors["variants"] = t.invalid;
  } else {
    const sum = variants.reduce((total, variant) => total + variant.allocationPercentage, 0);
    if (Math.abs(sum - 100) > 0.001) {
      fieldErrors["variants"] = t.invalid;
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await createExperiment(
    {
      name,
      hypothesis,
      variants: variants as readonly CreateExperimentVariantInput[],
      goalMetricRef,
      audiencePercentage,
      audienceSegmentRefs: audienceSegmentRefs.length > 0 ? audienceSegmentRefs : undefined,
      featureFlagRef,
    },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/experiments");
    redirect(`/experiments/${result.data.id}`);
  }
  return toFormState(result, t);
}

/** `POST /experiments/:experimentId/transitions` (`AdvanceForm`) — the only status-changing route on this domain; no `changedBy` field, unlike Feature Flags. */
export async function advanceExperimentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const experimentId = stringField(formData, "experimentId");
  const toStatus = stringField(formData, "toStatus");

  if (experimentId.length === 0 || !isExperimentStatus(toStatus)) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: isExperimentStatus(toStatus) ? {} : { toStatus: t.invalid },
    };
  }

  const result = await advanceExperiment(experimentId, toStatus, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateExperimentScreens(experimentId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * `POST /experiments/:experimentId/results` (`RecordResultForm`) — **not** idempotent, per the
 * route table: no `newIdempotencyKey()` call, so no `Idempotency-Key` header is sent.
 */
export async function recordExperimentResultAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const experimentId = stringField(formData, "experimentId");
  const variantKey = stringField(formData, "variantKey");
  const metricValue = Number.parseFloat(stringField(formData, "metricValue"));
  const sampleSize = Number.parseInt(stringField(formData, "sampleSize"), 10);

  const fieldErrors: Record<string, string> = {};
  if (variantKey.length === 0) fieldErrors["variantKey"] = t.invalid;
  if (Number.isNaN(metricValue)) fieldErrors["metricValue"] = t.invalid;
  if (Number.isNaN(sampleSize) || sampleSize < 0) fieldErrors["sampleSize"] = t.invalid;
  if (experimentId.length === 0 || Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await recordExperimentResult(experimentId, { variantKey, metricValue, sampleSize });
  if (result.outcome === "ok") {
    revalidateExperimentScreens(experimentId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** `POST /experiments/:experimentId/winner` (`DeclareWinnerForm`). */
export async function declareExperimentWinnerAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const experimentId = stringField(formData, "experimentId");
  const variantKey = stringField(formData, "variantKey");

  if (experimentId.length === 0 || variantKey.length === 0) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: variantKey.length === 0 ? { variantKey: t.invalid } : {},
    };
  }

  const result = await declareExperimentWinner(experimentId, variantKey, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateExperimentScreens(experimentId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

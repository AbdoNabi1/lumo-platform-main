"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  checkAiAction,
  governAiIdentity,
  suspendAiIdentity,
  type AiActionDecisionDto,
  type AiIsolationLevel,
} from "@/lib/api/security";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.12a — the AI Governance write actions, following `apps/admin-web/README.md`'s write-screen
 * recipe: parse `FormData` defensively, mint one `Idempotency-Key` per invocation (constraint #8),
 * call the typed `lib/api/security.ts` function, `revalidatePath` on `ok` (except
 * `checkAiActionAction` — see its own doc comment), otherwise project through `toFormState`.
 */

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
 * `tokenBudget`/`callQuota` are `int().min(0).nullable().optional()` on the backend: omitted means
 * "leave unchanged" (this is a patch), `null` means "clear it -> unlimited", a number sets it. The
 * form pairs each field with an "unlimited" checkbox (`clearName`) to reach the `null` case, since
 * a bare empty number input can only mean "omitted" here.
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
  return Number.isNaN(parsed) ? { value: undefined, invalid: true } : { value: parsed, invalid: false };
}

function isIsolationLevel(value: string): value is AiIsolationLevel {
  return value === "none" || value === "sandboxed" || value === "isolated";
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

/**
 * Governs (creates or patches) an AI principal's budgets/quotas/sandboxing/isolation. Every
 * `config` field but `externalId` itself is optional — a blank input omits that field from the
 * patch rather than sending an empty/zero value.
 */
export async function governAiIdentityAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const externalId = stringField(formData, "externalId").trim();
  const tokenBudget = nullableIntField(formData, "tokenBudget", "tokenBudgetUnlimited");
  const callQuota = nullableIntField(formData, "callQuota", "callQuotaUnlimited");
  const windowSecondsRaw = optionalStringField(formData, "windowSeconds");
  const windowSeconds = windowSecondsRaw === undefined ? undefined : Number.parseInt(windowSecondsRaw, 10);
  const allowedTools = optionalStringListField(formData, "allowedTools");
  const allowedResources = optionalStringListField(formData, "allowedResources");
  const isolationLevelRaw = optionalStringField(formData, "isolationLevel");

  const fieldErrors: Record<string, string> = {};
  if (externalId.length === 0) fieldErrors["externalId"] = t.invalid;
  if (tokenBudget.invalid) fieldErrors["tokenBudget"] = t.invalid;
  if (callQuota.invalid) fieldErrors["callQuota"] = t.invalid;
  if (
    windowSecondsRaw !== undefined &&
    (windowSeconds === undefined || Number.isNaN(windowSeconds) || windowSeconds <= 0)
  ) {
    fieldErrors["windowSeconds"] = t.invalid;
  }
  if (isolationLevelRaw !== undefined && !isIsolationLevel(isolationLevelRaw)) {
    fieldErrors["isolationLevel"] = t.invalid;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await governAiIdentity(
    externalId,
    {
      tokenBudget: tokenBudget.value,
      callQuota: callQuota.value,
      windowSeconds,
      allowedTools,
      allowedResources,
      isolationLevel:
        isolationLevelRaw !== undefined && isIsolationLevel(isolationLevelRaw)
          ? isolationLevelRaw
          : undefined,
    },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/security/ai-governance");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * The kill-switch. `AiGovernanceExplorerDto`'s rows expose `principalRef` (the profile's internal
 * principal id, not the `externalId` the route needs — see `AiGovernanceProfile.govern`'s call
 * site in `ai-governance.use-cases.ts`), so there's no id to attach this to per-row; the form
 * takes a manual `externalId` field instead, confirmed client-side before submit (constraint #10).
 */
export async function suspendAiIdentityAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const externalId = stringField(formData, "externalId").trim();
  if (externalId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: { externalId: t.invalid } };
  }

  const result = await suspendAiIdentity(externalId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/security/ai-governance");
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** What the "Check AI action" panel renders — a preview result, never routed through `toFormState`. */
export type CheckAiActionFormState =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly decision: AiActionDecisionDto }
  | { readonly status: "error"; readonly message: string };

/**
 * Runs the AI action gate against one identity — a "try it" simulation/check tool, per the task
 * brief's ruling (matches T5.8's `evaluatePromotionsAction`): its result is a preview to render,
 * not a record to navigate to, so this never calls `revalidatePath`. Note this still records real
 * consumption server-side when allowed (`CheckAiAction`'s own doc comment) — the explorer table
 * just won't reflect it until the operator reloads that page themselves.
 */
export async function checkAiActionAction(
  _previous: CheckAiActionFormState,
  formData: FormData,
): Promise<CheckAiActionFormState> {
  const t = await formErrorDictionary();

  const externalId = stringField(formData, "externalId").trim();
  if (externalId.length === 0) {
    return { status: "error", message: t.invalid };
  }

  const tool = optionalStringField(formData, "tool");
  const resource = optionalStringField(formData, "resource");
  const tokensRaw = optionalStringField(formData, "tokens");
  const callsRaw = optionalStringField(formData, "calls");
  const tokens = tokensRaw === undefined ? undefined : Number.parseInt(tokensRaw, 10);
  const calls = callsRaw === undefined ? undefined : Number.parseInt(callsRaw, 10);

  if (
    (tokensRaw !== undefined && (tokens === undefined || Number.isNaN(tokens))) ||
    (callsRaw !== undefined && (calls === undefined || Number.isNaN(calls)))
  ) {
    return { status: "error", message: t.invalid };
  }

  const result = await checkAiAction(externalId, { tool, resource, tokens, calls }, newIdempotencyKey());

  if (result.outcome === "ok") {
    return { status: "success", decision: result.data };
  }
  if (result.outcome === "unauthorized") return { status: "error", message: t.unauthorized };
  if (result.outcome === "forbidden") return { status: "error", message: t.forbidden };
  if (result.outcome === "not_found") return { status: "error", message: t.notFound };
  if (result.outcome === "conflict") return { status: "error", message: result.message };
  if (result.outcome === "invalid") return { status: "error", message: result.message };
  return { status: "error", message: t.unexpected };
}

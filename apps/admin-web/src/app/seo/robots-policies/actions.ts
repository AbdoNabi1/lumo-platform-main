"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setRobotsPolicy, type RobotsRuleType } from "@/lib/api/seo";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.9b — the Robots Policies write action. `POST /seo/robots-policies` is create-or-update keyed
 * by `userAgent` (`seo-routes.ts`'s `setRobotsPolicyBody`), so this one action serves both the
 * create screen and, via the list page's row link (pre-filled with the same `userAgent`), a
 * re-submission that updates the existing policy's `rules`.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function stringFieldValues(formData: FormData, name: string): readonly string[] {
  return formData.getAll(name).map((value) => (typeof value === "string" ? value : ""));
}

function isRuleType(value: string): value is RobotsRuleType {
  return value === "allow" || value === "disallow";
}

/**
 * Parses the repeated `ruleType`/`rulePath` rows (same array-field technique
 * `OrderLineItemsField`/`parseVariants` established) into `rules`. `null` for a malformed row (a
 * path left blank while its type is set, or vice versa) so the caller can report a field error
 * instead of silently dropping data; a wholly blank row is dropped rather than rejected.
 */
function parseRules(
  formData: FormData,
): readonly { readonly type: RobotsRuleType; readonly path: string }[] | null {
  const types = stringFieldValues(formData, "ruleType");
  const paths = stringFieldValues(formData, "rulePath");
  if (types.length !== paths.length) return null;

  const rules: { readonly type: RobotsRuleType; readonly path: string }[] = [];
  for (let index = 0; index < types.length; index += 1) {
    const type = types[index] ?? "";
    const path = (paths[index] ?? "").trim();
    if (type.length === 0 && path.length === 0) continue;
    if (!isRuleType(type) || path.length === 0) return null;
    rules.push({ type, path });
  }
  return rules;
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

export async function setRobotsPolicyAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const userAgent = stringField(formData, "userAgent");
  const rules = parseRules(formData);

  if (userAgent.length === 0 || rules === null) {
    const fieldErrors: Record<string, string> = {};
    if (userAgent.length === 0) fieldErrors["userAgent"] = t.invalid;
    if (rules === null) fieldErrors["rules"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await setRobotsPolicy({ userAgent, rules }, newIdempotencyKey());

  if (result.outcome === "ok") {
    revalidatePath("/seo/robots-policies");
    redirect("/seo/robots-policies");
  }

  return toFormState(result, t);
}

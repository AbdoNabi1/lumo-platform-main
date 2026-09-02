"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { advanceTheme, createTheme, updateThemeVariables } from "@/lib/api/theme";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.9c — the Theme write actions. Same shape as `app/pages/actions.ts`: parse `FormData`
 * defensively, mint one `Idempotency-Key` per invocation, call the typed `lib/api/theme.ts`
 * function, `revalidatePath` the stale surfaces on `ok`, otherwise `toFormState`.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function stringFieldValues(formData: FormData, name: string): readonly string[] {
  return formData.getAll(name).map((value) => (typeof value === "string" ? value : ""));
}

function isThemeStatus(value: string): value is "draft" | "active" | "archived" {
  return value === "draft" || value === "active" || value === "archived";
}

/**
 * Parses a variable group's parallel `nameField`/`valueField` repeated inputs back into a
 * `Record<string,string>` — same array-field pattern as `app/products/actions.ts`'s
 * `parseVariants`. Rows with an empty name are dropped rather than rejected, since the row
 * array always renders at least one (possibly blank) row.
 */
function parseVariableGroup(
  formData: FormData,
  nameField: string,
  valueField: string,
): Readonly<Record<string, string>> {
  const names = stringFieldValues(formData, nameField);
  const values = stringFieldValues(formData, valueField);
  const record: Record<string, string> = {};
  for (let index = 0; index < names.length; index += 1) {
    const name = (names[index] ?? "").trim();
    if (name.length === 0) continue;
    record[name] = values[index] ?? "";
  }
  return record;
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

export async function createThemeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const name = stringField(formData, "name");
  const presetKey = stringField(formData, "presetKey");

  if (name.length === 0 || presetKey.length === 0) {
    const fieldErrors: Record<string, string> = {};
    if (name.length === 0) fieldErrors["name"] = t.invalid;
    if (presetKey.length === 0) fieldErrors["presetKey"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await createTheme({ name, presetKey }, newIdempotencyKey());

  if (result.outcome === "ok") {
    revalidatePath("/theme");
    const id = result.data.id;
    redirect(id.length > 0 ? `/theme/${id}` : "/theme");
  }

  return toFormState(result, t);
}

export async function advanceThemeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const themeId = stringField(formData, "themeId");
  const toStatus = stringField(formData, "toStatus");

  if (themeId.length === 0 || !isThemeStatus(toStatus)) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await advanceTheme(themeId, toStatus, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/theme");
    revalidatePath(`/theme/${themeId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function updateThemeVariablesAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const themeId = stringField(formData, "themeId");
  if (themeId.length === 0) return { status: "error", message: t.invalid, fieldErrors: {} };

  const colors = parseVariableGroup(formData, "colorsKey", "colorsValue");
  const typography = parseVariableGroup(formData, "typographyKey", "typographyValue");
  const spacing = parseVariableGroup(formData, "spacingKey", "spacingValue");

  const result = await updateThemeVariables(
    themeId,
    { colors, typography, spacing },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidatePath("/theme");
    revalidatePath(`/theme/${themeId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

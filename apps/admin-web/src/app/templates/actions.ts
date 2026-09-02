"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { archiveTemplate, createTemplate } from "@/lib/api/pages";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.9a Part B — the Templates write actions. Same shape as `app/pages/actions.ts`.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

export async function createTemplateAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const name = stringField(formData, "name");
  const experienceRef = stringField(formData, "experienceRef");

  if (name.length === 0 || experienceRef.length === 0) {
    const fieldErrors: Record<string, string> = {};
    if (name.length === 0) fieldErrors["name"] = t.invalid;
    if (experienceRef.length === 0) fieldErrors["experienceRef"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await createTemplate({ name, experienceRef }, newIdempotencyKey());

  if (result.outcome === "ok") {
    revalidatePath("/templates");
    const id = result.data.id;
    redirect(id.length > 0 ? `/templates/${id}` : "/templates");
  }

  return toFormState(result, t);
}

export async function archiveTemplateAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const templateId = stringField(formData, "templateId");
  if (templateId.length === 0) return { status: "error", message: t.invalid, fieldErrors: {} };

  const result = await archiveTemplate(templateId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/templates");
    revalidatePath(`/templates/${templateId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

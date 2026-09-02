"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  advanceContentBlock,
  createContentBlock,
  updateContentBlockBody,
} from "@/lib/api/content";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.9a Part A — the Content Blocks write actions. Same shape as `app/products/actions.ts`'s
 * reference actions: parse `FormData` defensively, mint one `Idempotency-Key` per invocation, call
 * the typed `lib/api/content.ts` function, `revalidatePath("/content")` on `ok` (there is no
 * detail page — no `GET /content-blocks/:id` route exists on the backend — so the list is the only
 * stale surface), otherwise `toFormState`.
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

function isContentFormat(value: string): value is "html" | "markdown" | "json" {
  return value === "html" || value === "markdown" || value === "json";
}

function isContentStatus(
  value: string,
): value is "draft" | "scheduled" | "published" | "archived" {
  return value === "draft" || value === "scheduled" || value === "published" || value === "archived";
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

export async function createContentBlockAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const name = stringField(formData, "name");
  const blockType = stringField(formData, "blockType");
  const format = stringField(formData, "format");
  const content = stringField(formData, "content");
  const locale = optionalStringField(formData, "locale");

  if (name.length === 0 || blockType.length === 0 || !isContentFormat(format) || content.length === 0) {
    const fieldErrors: Record<string, string> = {};
    if (name.length === 0) fieldErrors["name"] = t.invalid;
    if (blockType.length === 0) fieldErrors["blockType"] = t.invalid;
    if (!isContentFormat(format)) fieldErrors["format"] = t.invalid;
    if (content.length === 0) fieldErrors["content"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await createContentBlock(
    { name, blockType, format, content, locale },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/content");
    redirect("/content");
  }

  return toFormState(result, t);
}

export async function advanceContentBlockAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const contentBlockId = stringField(formData, "contentBlockId");
  const toStatus = stringField(formData, "toStatus");
  const scheduledAt = optionalStringField(formData, "scheduledAt");

  if (contentBlockId.length === 0 || !isContentStatus(toStatus)) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await advanceContentBlock(
    contentBlockId,
    { toStatus, scheduledAt },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidatePath("/content");
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function updateContentBlockBodyAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const contentBlockId = stringField(formData, "contentBlockId");
  const format = stringField(formData, "format");
  const content = stringField(formData, "content");

  if (contentBlockId.length === 0 || !isContentFormat(format) || content.length === 0) {
    const fieldErrors: Record<string, string> = {};
    if (!isContentFormat(format)) fieldErrors["format"] = t.invalid;
    if (content.length === 0) fieldErrors["content"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await updateContentBlockBody(
    contentBlockId,
    { format, content },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidatePath("/content");
    return { status: "success" };
  }
  return toFormState(result, t);
}

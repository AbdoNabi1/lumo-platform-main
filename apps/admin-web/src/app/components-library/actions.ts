"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  advanceComponent,
  createComponent,
  type ComponentPropertyInput,
  type ComponentPropertyType,
} from "@/lib/api/component-library";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.9c — the Component Library write actions. Same shape as `app/theme/actions.ts`: parse
 * `FormData` defensively, mint one `Idempotency-Key` per invocation, call the typed
 * `lib/api/component-library.ts` function, `revalidatePath` the stale surfaces on `ok`, otherwise
 * `toFormState`.
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

function isComponentPropertyType(value: string): value is ComponentPropertyType {
  return (
    value === "string" ||
    value === "number" ||
    value === "boolean" ||
    value === "object" ||
    value === "array"
  );
}

function isComponentStatus(
  value: string,
): value is "draft" | "published" | "deprecated" | "archived" {
  return value === "draft" || value === "published" || value === "deprecated" || value === "archived";
}

/**
 * Parses the `properties` row group's parallel `propertyName`/`propertyType`/`propertyRequired`
 * repeated inputs — same array-field pattern as `app/products/actions.ts`'s `parseVariants`. A
 * row whose name is blank is dropped rather than rejected (the row array always renders at least
 * one, possibly-blank, row, and the backend's own schema allows an empty `properties` array).
 * Returns `null` only for a genuinely malformed row (an unrecognized `type`).
 */
function parseProperties(formData: FormData): readonly ComponentPropertyInput[] | null {
  const names = stringFieldValues(formData, "propertyName");
  const types = stringFieldValues(formData, "propertyType");
  const requireds = stringFieldValues(formData, "propertyRequired");
  const properties: ComponentPropertyInput[] = [];
  for (let index = 0; index < names.length; index += 1) {
    const name = (names[index] ?? "").trim();
    if (name.length === 0) continue;
    const type = types[index] ?? "";
    if (!isComponentPropertyType(type)) return null;
    const required = (requireds[index] ?? "false") === "true";
    properties.push({ name, type, required });
  }
  return properties;
}

/** Drops blank entries — same reasoning as `parseProperties`. */
function parseStringRows(formData: FormData, name: string): readonly string[] {
  return stringFieldValues(formData, name)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/**
 * Parses the `defaults` JSON textarea. Returns `undefined` for a blank input (an omitted optional
 * zod field), `null` for a value that doesn't parse as a JSON object — the client-side check in
 * `ComponentCreateForm` should already have caught this, but the server action re-validates
 * defensively rather than trusting the client.
 */
function parseDefaults(formData: FormData): Readonly<Record<string, unknown>> | undefined | null {
  const raw = stringField(formData, "defaults").trim();
  if (raw.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

export async function createComponentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const key = stringField(formData, "key");
  const name = stringField(formData, "name");
  const properties = parseProperties(formData);
  const defaults = parseDefaults(formData);
  const slots = parseStringRows(formData, "slotValue");
  const events = parseStringRows(formData, "eventValue");
  const responsive = stringField(formData, "responsive") === "on";
  const permission = optionalStringField(formData, "permission");
  const featureFlagKey = optionalStringField(formData, "featureFlagKey");

  if (key.length === 0 || name.length === 0 || properties === null || defaults === null) {
    const fieldErrors: Record<string, string> = {};
    if (key.length === 0) fieldErrors["key"] = t.invalid;
    if (name.length === 0) fieldErrors["name"] = t.invalid;
    if (properties === null) fieldErrors["properties"] = t.invalid;
    if (defaults === null) fieldErrors["defaults"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await createComponent(
    { key, name, properties, defaults, slots, events, responsive, permission, featureFlagKey },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/components-library");
    const id = result.data.id;
    redirect(id.length > 0 ? `/components-library/${id}` : "/components-library");
  }

  return toFormState(result, t);
}

export async function advanceComponentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const componentDefinitionId = stringField(formData, "componentDefinitionId");
  const toStatus = stringField(formData, "toStatus");

  if (componentDefinitionId.length === 0 || !isComponentStatus(toStatus)) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await advanceComponent(componentDefinitionId, toStatus, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/components-library");
    revalidatePath(`/components-library/${componentDefinitionId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

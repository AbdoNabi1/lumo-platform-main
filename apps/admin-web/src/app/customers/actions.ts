"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  changeMarketingConsent,
  createCustomer,
  setCustomerNote,
  setCustomerTags,
  updateCustomerProfile,
  type CreateCustomerBody,
  type CustomerLanguage,
} from "@/lib/api/customers";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * Shopify parity Wave 1b — the Customers write actions, in the shape of `app/collections/actions.ts`:
 * parse `FormData` defensively, mint one `Idempotency-Key` per invocation, call
 * `lib/api/customers.ts`, then — for EVERY write that reached the API, whatever its outcome —
 * revalidate the list and the customer's own page (a conflict or a 403 may still mean the screen is
 * stale), and finally map the result with `toFormState`. Every semantic limit (name length, phone
 * digits, note 5000, tag length and count) belongs to the API, which answers 422 with the failing
 * field names; nothing here re-implements it.
 */

/** The API's own message for a duplicate email (`CreateCustomer`); it carries no code of its own. */
const DUPLICATE_EMAIL_MESSAGE = "A customer with this email already exists";

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** The trimmed text of a field, or `undefined` when it is blank. */
function optionalText(formData: FormData, name: string): string | undefined {
  const value = stringField(formData, name).trim();
  return value === "" ? undefined : value;
}

/** `""` is "not set"; anything but `en` / `ar` is malformed. */
function languageField(formData: FormData): CustomerLanguage | null | "invalid" {
  const value = stringField(formData, "language").trim();
  if (value === "") return null;
  return value === "en" || value === "ar" ? value : "invalid";
}

async function dictionary(): Promise<Dictionary> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

function invalid(t: Dictionary, fieldErrors: Record<string, string> = {}): FormState {
  return { status: "error", message: t.formErrors.invalid, fieldErrors };
}

/** The list and the customer's own page — what any write to one customer makes stale. */
function revalidateCustomer(customerId: string): void {
  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
}

export async function createCustomerAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const language = languageField(formData);
  if (language === "invalid") return invalid(t, { language: t.formErrors.invalid });

  const phone = optionalText(formData, "phone");
  const note = optionalText(formData, "note");
  const tags = optionalText(formData, "tags");
  const body: CreateCustomerBody = {
    name: stringField(formData, "name"),
    email: stringField(formData, "email"),
    ...(phone === undefined ? {} : { phone }),
    ...(language === null ? {} : { language }),
    ...(note === undefined ? {} : { note }),
    // The server splits the comma-separated text itself (Latin and Arabic commas).
    ...(tags === undefined ? {} : { tags: [tags] }),
    marketingEmail: stringField(formData, "marketingEmail") === "on",
    marketingSms: stringField(formData, "marketingSms") === "on",
  };

  const result = await createCustomer(body, newIdempotencyKey());
  revalidatePath("/customers");
  if (result.outcome === "ok") {
    revalidatePath(`/customers/${result.data.customerId}`);
    redirect(`/customers/${encodeURIComponent(result.data.customerId)}`);
  }
  if (result.outcome === "conflict" && result.message === DUPLICATE_EMAIL_MESSAGE) {
    return {
      status: "error",
      message: t.customerForm.duplicateEmail,
      fieldErrors: { email: t.customerForm.duplicateEmail },
    };
  }
  return toFormState(result, t.formErrors);
}

/** Bound with `.bind(null, customerId)`; fields `name`, `phone` (`""` → null), `language` (`""` → null). */
export async function updateCustomerProfileAction(
  customerId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const language = languageField(formData);
  if (customerId === "" || language === "invalid") {
    return invalid(t, language === "invalid" ? { language: t.formErrors.invalid } : {});
  }
  const phone = stringField(formData, "phone").trim();

  const result = await updateCustomerProfile(
    customerId,
    { name: stringField(formData, "name"), phone: phone === "" ? null : phone, language },
    newIdempotencyKey(),
  );
  revalidateCustomer(customerId);
  return toFormState(result, t.formErrors);
}

/** Bound with `.bind(null, customerId)`; field `note` (`""` → null clears it). */
export async function setCustomerNoteAction(
  customerId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  if (customerId === "") return invalid(t);
  const note = stringField(formData, "note");

  const result = await setCustomerNote(
    customerId,
    note.trim() === "" ? null : note,
    newIdempotencyKey(),
  );
  revalidateCustomer(customerId);
  return toFormState(result, t.formErrors);
}

/** Replaces the customer's whole tag set; `[]` clears it. Called from a client component, so the list is re-checked. */
export async function setCustomerTagsAction(
  customerId: string,
  tags: readonly string[],
): Promise<FormState> {
  const t = await dictionary();
  if (customerId === "" || !Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
    return invalid(t);
  }

  const result = await setCustomerTags(customerId, tags, newIdempotencyKey());
  revalidateCustomer(customerId);
  return toFormState(result, t.formErrors);
}

/** Records the staff-asserted marketing choice of ONE channel (the other is left as it is). */
export async function changeMarketingConsentAction(
  customerId: string,
  channel: "email" | "sms",
  subscribed: boolean,
): Promise<FormState> {
  const t = await dictionary();
  if (
    customerId === "" ||
    (channel !== "email" && channel !== "sms") ||
    typeof subscribed !== "boolean"
  ) {
    return invalid(t);
  }

  const result = await changeMarketingConsent(
    customerId,
    channel === "email" ? { email: subscribed } : { sms: subscribed },
    newIdempotencyKey(),
  );
  revalidateCustomer(customerId);
  return toFormState(result, t.formErrors);
}

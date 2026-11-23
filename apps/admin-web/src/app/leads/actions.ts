"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { changeLeadStatus } from "@/lib/api/leads";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { isLeadStatus } from "@/lib/leads/lead-status";

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Moves a lead to the chosen status (`LeadStatusForm`). Re-derives the id and status from the
 * submission, mints exactly one idempotency key per submit and calls the API once. After EVERY call
 * that reached the API — ok, 409, 422, 403, a network failure, even a throw — `/leads` and
 * `/leads/{id}` are revalidated (the write may have landed even when the response did not say so);
 * a local validation failure never reaches the API and revalidates nothing.
 */
export async function changeLeadStatusAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const t = dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE).formErrors;

  const leadId = stringField(formData, "leadId");
  const status = stringField(formData, "status");
  if (leadId.length === 0 || !isLeadStatus(status)) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  let attempted = false;
  try {
    attempted = true;
    const result = await changeLeadStatus(leadId, status, newIdempotencyKey());
    return toFormState(result, t);
  } finally {
    if (attempted) {
      revalidatePath("/leads");
      revalidatePath(`/leads/${leadId}`);
    }
  }
}

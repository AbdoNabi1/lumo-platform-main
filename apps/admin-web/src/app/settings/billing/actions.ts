"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { changeMyPlan, payMyInvoice } from "@/lib/api/store-billing";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Settings → Plan and billing. Same shape every write action follows: parse the form defensively,
 * mint one idempotency key per submit, call the typed `lib/api/store-billing.ts` function and project
 * any non-`ok` outcome through `toFormState` — except a 409, whose server sentence is English: each
 * action replaces it with its own localized copy (as the domain actions do).
 */

const PATH = "/settings/billing";

async function dictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Only an absolute `https:` URL is somewhere we are willing to send the merchant. */
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Moves the shop's subscription to another published plan. */
export async function changeMyPlanAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const planKey = text(formData, "planKey");
  if (planKey.length === 0) {
    return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
  }

  const result = await changeMyPlan(planKey, newIdempotencyKey());
  if (result.outcome === "conflict") {
    return { status: "error", message: t.billingPage.errorPlanConflict, fieldErrors: {} };
  }
  if (result.outcome !== "ok") return toFormState(result, t.formErrors);

  revalidatePath(PATH);
  return { status: "success" };
}

/**
 * Starts the card checkout for one invoice and sends the merchant there. The runtime's pay route is
 * not idempotent, so the button that posts here disables itself while submitting. The checkout URL
 * comes from a third party's API: it is followed only if it is an absolute `https:` URL — never a
 * `javascript:`/`data:` URL or a plain `http:` one.
 */
export async function payMyInvoiceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const invoiceId = text(formData, "invoiceId");
  if (invoiceId.length === 0) {
    return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
  }

  const result = await payMyInvoice(invoiceId, newIdempotencyKey());
  if (result.outcome === "not_found") {
    return { status: "error", message: t.billingPage.errorInvoiceGone, fieldErrors: {} };
  }
  if (result.outcome === "conflict") {
    return { status: "error", message: t.billingPage.errorInvoiceConflict, fieldErrors: {} };
  }
  if (result.outcome !== "ok") return toFormState(result, t.formErrors);

  if (!isHttpsUrl(result.data.checkoutUrl)) {
    return { status: "error", message: t.billingPage.errorCheckout, fieldErrors: {} };
  }
  // `redirect` throws, so nothing after it runs.
  redirect(result.data.checkoutUrl);
}

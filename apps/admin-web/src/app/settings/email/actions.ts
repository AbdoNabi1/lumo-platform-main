"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { sendTestEmail } from "@/lib/api/outreach";
import type { MutationResult } from "@/lib/api/client";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { emailErrorMessage, isKnownEmailCode, isPlausibleEmail } from "@/lib/outreach/email";
import { testSendOutcome, type TestSendOutcome } from "@/lib/outreach/whatsapp";
import type { Dictionary } from "@/messages/en";

/**
 * Settings → Email server action. The write revalidates `/settings/email` in a `finally`, after `unstable_rethrow`,
 * whatever the outcome once it reached the API. Messages come from the dictionary only: an allowlisted 409 `message`
 * code (`EMAIL_CAP_REACHED`, `EMAIL_NOT_CONFIGURED`, …) maps to its copy, anything else to generic copy. Provider
 * text is never shown, and an HTTP 200 never reads as "sent": the copy is about the delivery STATUS.
 */

const PAGE = "/settings/email";
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,200}$/;

/**
 * `result`: the API answered with a delivery status (definitive). `refused`: the API refused before any dispatch
 * (a 409/403/422/404 — definitive, nothing was sent). `error`: a network failure, a 5xx or an unreadable answer — the
 * submission is UNRESOLVED, so the form keeps its payload and key.
 */
export type EmailTestState =
  | { readonly status: "result"; readonly outcome: TestSendOutcome; readonly message: string }
  | { readonly status: "refused"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

async function dictionary(): Promise<Dictionary> {
  const locale = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(locale) ? locale : DEFAULT_LOCALE);
}

function refusal(
  result: Exclude<MutationResult<unknown>, { outcome: "ok" | "error" }>,
  t: Dictionary,
): string {
  switch (result.outcome) {
    case "unauthorized":
      return t.formErrors.unauthorized;
    case "forbidden":
      return t.formErrors.forbidden;
    case "not_found":
      return t.formErrors.notFound;
    case "invalid":
      return t.emailSettings.test.toInvalid;
    case "conflict":
      return emailErrorMessage(result.message, t);
  }
}

/**
 * Sends the fixed bilingual test email. `idempotencyKey` is the form's per-submission key (≤200 characters; it must
 * survive a retry of the same request, so the browser makes it).
 */
export async function sendTestEmailAction(input: {
  readonly to: string;
  readonly idempotencyKey: string;
}): Promise<EmailTestState> {
  const t = await dictionary();
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.to !== "string" ||
    !isPlausibleEmail(input.to) ||
    typeof input.idempotencyKey !== "string" ||
    !IDEMPOTENCY_KEY.test(input.idempotencyKey)
  ) {
    return { status: "refused", message: t.emailSettings.test.toInvalid };
  }
  try {
    const result = await sendTestEmail(input.to, input.idempotencyKey);
    if (result.outcome === "error") {
      return { status: "error", message: t.emailSettings.errors.generic };
    }
    if (result.outcome !== "ok") return { status: "refused", message: refusal(result, t) };
    const outcome = testSendOutcome(result.data.status);
    const copy = t.emailSettings.test;
    const message =
      outcome === "accepted"
        ? copy.resultAccepted
        : outcome === "suppressed"
          ? copy.resultSuppressed
          : outcome === "unknown"
            ? copy.resultUnknown
            : isKnownEmailCode(result.data.errorCode, t)
              ? `${copy.resultFailed} ${emailErrorMessage(result.data.errorCode, t)}`
              : copy.resultFailed;
    return { status: "result", outcome, message };
  } catch (caught) {
    unstable_rethrow(caught);
    return { status: "error", message: t.emailSettings.errors.generic };
  } finally {
    revalidatePath(PAGE);
  }
}

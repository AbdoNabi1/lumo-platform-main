"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import {
  abandonWhatsAppOnboarding,
  connectWhatsApp,
  disconnectWhatsApp,
  refreshWhatsApp,
  sendWhatsAppTest,
  type TestSendInput,
} from "@/lib/api/outreach";
import type { MutationResult } from "@/lib/api/client";
import { newIdempotencyKey } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import {
  isKnownWhatsAppCode,
  META_ID_PATTERN,
  PHONE_PATTERN,
  testSendOutcome,
  type TestSendOutcome,
  whatsappErrorMessage,
} from "@/lib/outreach/whatsapp";
import type { Dictionary } from "@/messages/en";

/**
 * Settings → WhatsApp server actions. Every write that reached the API revalidates the page in a `finally`, after
 * `unstable_rethrow`, so a redirect still propagates and a failed write never leaves the screen stale. Messages come
 * from the dictionary only: an allowlisted 409 `message` code maps to its copy, anything else to generic copy.
 * Provider text is never shown.
 */

const PAGE = "/settings/whatsapp";
const TEMPLATES_PAGE = "/settings/whatsapp/templates";

/** The Embedded Signup `code` bound (the route's zod caps it the same way). */
const MAX_CODE_LENGTH = 8192;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

export type WhatsAppActionState =
  { readonly status: "success" } | { readonly status: "error"; readonly message: string };

export type TestSendActionState =
  | { readonly status: "result"; readonly outcome: TestSendOutcome; readonly message: string }
  | { readonly status: "error"; readonly message: string };

async function dictionary(): Promise<Dictionary> {
  const locale = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(locale) ? locale : DEFAULT_LOCALE);
}

function error(message: string): { readonly status: "error"; readonly message: string } {
  return { status: "error", message };
}

/**
 * The copy for a refused write. A feature rejection is `409 {code:"CONFLICT", message:"<CODE>"}`, so the CODE is the
 * envelope's `message`; a stale version is `409 {code:"CONCURRENCY"}`.
 */
function failureMessage(
  result: Exclude<MutationResult<unknown>, { outcome: "ok" }>,
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
      return t.formErrors.invalid;
    case "conflict":
      if (result.code === "CONCURRENCY") return t.whatsappSettings.errors.stale;
      return isKnownWhatsAppCode(result.message, t)
        ? whatsappErrorMessage(result.message, t)
        : t.whatsappSettings.errors.generic;
    case "error":
      return t.whatsappSettings.errors.generic;
  }
}

/** Runs one write that reaches the API; revalidates every listed path whatever the outcome. */
async function write(
  paths: readonly string[],
  call: () => Promise<MutationResult<unknown>>,
  t: Dictionary,
): Promise<WhatsAppActionState> {
  try {
    const result = await call();
    return result.outcome === "ok" ? { status: "success" } : error(failureMessage(result, t));
  } catch (caught) {
    unstable_rethrow(caught);
    return error(t.whatsappSettings.errors.generic);
  } finally {
    for (const path of paths) revalidatePath(path);
  }
}

export async function connectWhatsAppAction(input: {
  readonly code: string;
  readonly wabaId: string;
  readonly phoneNumberId: string;
}): Promise<WhatsAppActionState> {
  const t = await dictionary();
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.code !== "string" ||
    input.code.length < 1 ||
    input.code.length > MAX_CODE_LENGTH ||
    typeof input.wabaId !== "string" ||
    !META_ID_PATTERN.test(input.wabaId) ||
    typeof input.phoneNumberId !== "string" ||
    !META_ID_PATTERN.test(input.phoneNumberId)
  ) {
    return error(t.whatsappSettings.signupFailed);
  }
  const body = { code: input.code, wabaId: input.wabaId, phoneNumberId: input.phoneNumberId };
  return write([PAGE, TEMPLATES_PAGE], () => connectWhatsApp(body, newIdempotencyKey()), t);
}

export async function refreshWhatsAppAction(): Promise<WhatsAppActionState> {
  const t = await dictionary();
  return write([PAGE], () => refreshWhatsApp(newIdempotencyKey()), t);
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export async function disconnectWhatsAppAction(
  expectedVersion: number,
): Promise<WhatsAppActionState> {
  const t = await dictionary();
  if (!isVersion(expectedVersion)) return error(t.formErrors.invalid);
  return write(
    [PAGE, TEMPLATES_PAGE],
    () => disconnectWhatsApp(expectedVersion, newIdempotencyKey()),
    t,
  );
}

/** Stops an unfinished setup (Cancel setup, after its confirmation). */
export async function abandonOnboardingAction(
  expectedVersion: number,
): Promise<WhatsAppActionState> {
  const t = await dictionary();
  if (!isVersion(expectedVersion)) return error(t.formErrors.invalid);
  return write([PAGE], () => abandonWhatsAppOnboarding(expectedVersion, newIdempotencyKey()), t);
}

function isTestInput(input: unknown): input is TestSendInput & { idempotencyKey: string } {
  if (typeof input !== "object" || input === null) return false;
  const v = input as Record<string, unknown>;
  const values = v["values"] as Record<string, unknown> | null | undefined;
  if (typeof values !== "object" || values === null) return false;
  const body = values["body"];
  const header = values["header"];
  const suffixes = values["urlSuffixes"];
  return (
    typeof v["to"] === "string" &&
    PHONE_PATTERN.test(v["to"]) &&
    typeof v["templateName"] === "string" &&
    /^[a-z0-9_]{1,512}$/.test(v["templateName"]) &&
    typeof v["language"] === "string" &&
    /^[A-Za-z_]{2,16}$/.test(v["language"]) &&
    typeof v["idempotencyKey"] === "string" &&
    IDEMPOTENCY_KEY.test(v["idempotencyKey"]) &&
    (v["attestConsent"] === undefined || typeof v["attestConsent"] === "boolean") &&
    Array.isArray(body) &&
    body.length <= 10 &&
    body.every((x: unknown) => typeof x === "string" && x.length <= 1024) &&
    (header === undefined || (typeof header === "string" && header.length <= 1024)) &&
    (suffixes === undefined ||
      (typeof suffixes === "object" &&
        suffixes !== null &&
        Object.entries(suffixes).every(
          ([k, s]) => /^\d{1,2}$/.test(k) && typeof s === "string" && s.length <= 256,
        )))
  );
}

/**
 * Sends one approved template to a number the merchant owns. `idempotencyKey` is the form's per-submission key (it must
 * survive a retry, so it is generated in the browser). The result is the DELIVERY STATUS, never "sent" because the
 * request returned 200.
 */
export async function testSendAction(
  input: TestSendInput & { readonly idempotencyKey: string },
): Promise<TestSendActionState> {
  const t = await dictionary();
  if (!isTestInput(input)) return error(t.formErrors.invalid);
  const { idempotencyKey, ...body } = input;
  const request: TestSendInput = {
    to: body.to,
    templateName: body.templateName,
    language: body.language,
    values: body.values,
    ...(body.attestConsent === undefined ? {} : { attestConsent: body.attestConsent }),
  };
  try {
    const result = await sendWhatsAppTest(request, idempotencyKey);
    if (result.outcome !== "ok") return error(failureMessage(result, t));
    const outcome = testSendOutcome(result.data.status);
    const copy = t.whatsappSettings.test;
    const message =
      outcome === "accepted"
        ? copy.resultAccepted
        : outcome === "suppressed"
          ? copy.resultSuppressed
          : outcome === "unknown"
            ? copy.resultUnknown
            : isKnownWhatsAppCode(result.data.errorCode, t)
              ? `${copy.resultFailed} ${whatsappErrorMessage(result.data.errorCode, t)}`
              : copy.resultFailed;
    return { status: "result", outcome, message };
  } catch (caught) {
    unstable_rethrow(caught);
    return error(t.whatsappSettings.errors.generic);
  } finally {
    revalidatePath(PAGE);
  }
}

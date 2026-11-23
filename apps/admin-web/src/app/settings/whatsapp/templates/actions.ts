"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import {
  createWhatsAppTemplate,
  deleteWhatsAppTemplate,
  syncWhatsAppTemplates,
  type TemplateDraftBody,
} from "@/lib/api/outreach";
import type { MutationResult } from "@/lib/api/client";
import { newIdempotencyKey } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { isKnownWhatsAppCode, whatsappErrorMessage } from "@/lib/outreach/whatsapp";
import { templateIssueMessage, toTemplateDraftBody } from "@/lib/outreach/templates";
import type { Dictionary } from "@/messages/en";
import type { WhatsAppActionState } from "../actions";

/**
 * Settings → WhatsApp → Templates server actions. Every write that reached the API revalidates BOTH the templates
 * page and the connection page (its test-send selector lists the same templates) in a `finally`, after
 * `unstable_rethrow`, so a redirect still propagates and a failed write never leaves either screen stale. Messages
 * come from the dictionary only: an allowlisted 409 `message` code maps to its copy, a 422 issue code to its field
 * copy, anything else to generic copy. Provider text is never shown.
 */

const TEMPLATES_PAGE = "/settings/whatsapp/templates";
const PAGE = "/settings/whatsapp";
const PATHS = [TEMPLATES_PAGE, PAGE] as const;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;
const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;

/**
 * A create's outcome. `success` and `invalid`/`refused` are DEFINITIVE (the template was, or was not, submitted); only
 * `error` (a network failure, a 5xx, an unreadable answer) leaves the submission unresolved, so the form keeps its
 * payload and key and a retry is the same request.
 */
export type CreateTemplateState =
  | { readonly status: "success" }
  | {
      readonly status: "invalid";
      readonly message: string;
      /** Localised copy keyed by the draft field (`name`, `body.examples`, `buttons[0].text`, …). */
      readonly fieldErrors: Readonly<Record<string, string>>;
    }
  | { readonly status: "refused"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

async function dictionary(): Promise<Dictionary> {
  const locale = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(locale) ? locale : DEFAULT_LOCALE);
}

function error(message: string): { readonly status: "error"; readonly message: string } {
  return { status: "error", message };
}

function conflictMessage(code: unknown, t: Dictionary): string {
  const own: Readonly<Record<string, string>> = t.whatsappTemplates.errors;
  if (typeof code === "string" && code !== "generic" && Object.hasOwn(own, code)) {
    return own[code] ?? t.whatsappTemplates.errors.generic;
  }
  return isKnownWhatsAppCode(code, t)
    ? whatsappErrorMessage(code, t)
    : t.whatsappTemplates.errors.generic;
}

/**
 * A create's 409 is only a definitive refusal when it is a known pre-dispatch / Meta-side refusal and not the
 * transport's in-flight answer for the same key (`retryable: true`): a known dictionary code, a stale version, or a
 * Meta refusal (`META_<code>`). An arbitrary 409 is not proof that nothing was submitted.
 */
function isDefinitiveConflict(
  result: Extract<MutationResult<unknown>, { outcome: "conflict" }>,
  t: Dictionary,
): boolean {
  if (result.retryable === true) return false;
  if (result.code === "CONCURRENCY") return true;
  const code: unknown = result.message;
  if (typeof code !== "string") return false;
  if (code.startsWith("META_")) return true;
  const own: Readonly<Record<string, string>> = t.whatsappTemplates.errors;
  return (code !== "generic" && Object.hasOwn(own, code)) || isKnownWhatsAppCode(code, t);
}

/** The copy for a refused write (everything but a 5xx / network failure, which is `generic`). */
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
      return conflictMessage(result.message, t);
    case "error":
      return t.whatsappTemplates.errors.generic;
  }
}

async function write(
  call: () => Promise<MutationResult<unknown>>,
  t: Dictionary,
): Promise<WhatsAppActionState> {
  try {
    const result = await call();
    return result.outcome === "ok" ? { status: "success" } : error(failureMessage(result, t));
  } catch (caught) {
    unstable_rethrow(caught);
    return error(t.whatsappTemplates.errors.generic);
  } finally {
    for (const path of PATHS) revalidatePath(path);
  }
}

/** Pulls the latest template statuses from Meta (Sync from Meta). */
export async function syncTemplatesAction(): Promise<WhatsAppActionState> {
  const t = await dictionary();
  return write(() => syncWhatsAppTemplates(newIdempotencyKey()), t);
}

/** Deletes a template by name, in every language, on the active WhatsApp account (after its confirmation). */
export async function deleteTemplateAction(name: string): Promise<WhatsAppActionState> {
  const t = await dictionary();
  if (typeof name !== "string" || !TEMPLATE_NAME.test(name)) return error(t.formErrors.invalid);
  return write(() => deleteWhatsAppTemplate(name, newIdempotencyKey()), t);
}

/**
 * Submits a new template to Meta. `idempotencyKey` is the form's per-submission key (it has to survive a retry of the
 * same request, so the browser makes it). The draft is rebuilt field by field before it travels, because the API
 * rejects unknown keys.
 */
export async function createTemplateAction(input: {
  readonly draft: TemplateDraftBody;
  readonly idempotencyKey: string;
}): Promise<CreateTemplateState> {
  const t = await dictionary();
  const body =
    typeof input === "object" && input !== null ? toTemplateDraftBody(input.draft) : null;
  if (
    body === null ||
    typeof input.idempotencyKey !== "string" ||
    !IDEMPOTENCY_KEY.test(input.idempotencyKey)
  ) {
    return { status: "refused", message: t.formErrors.invalid };
  }
  try {
    const result = await createWhatsAppTemplate(body, input.idempotencyKey);
    if (result.outcome === "ok") return { status: "success" };
    if (result.outcome === "error") return error(failureMessage(result, t));
    if (result.outcome === "conflict" && !isDefinitiveConflict(result, t)) {
      return error(t.whatsappTemplates.errors.generic);
    }
    if (result.outcome === "invalid") {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.fields) {
        if (issue.field.length === 0 || Object.hasOwn(fieldErrors, issue.field)) continue;
        fieldErrors[issue.field] = templateIssueMessage(issue.message, t);
      }
      return { status: "invalid", message: t.formErrors.invalid, fieldErrors };
    }
    return { status: "refused", message: failureMessage(result, t) };
  } catch (caught) {
    unstable_rethrow(caught);
    return error(t.whatsappTemplates.errors.generic);
  } finally {
    for (const path of PATHS) revalidatePath(path);
  }
}

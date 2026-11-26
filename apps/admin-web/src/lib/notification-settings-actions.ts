import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  fetchNotificationSettings,
  previewTemplateCopy,
  revertTemplateCopy,
  saveNotificationSettings,
  saveTemplateCopy,
  sendTemplateTest,
  type startSenderDomain,
  type verifySenderDomain,
} from "@/lib/api/notification-settings";
import type { MutationResult } from "@/lib/api/client";
import { newIdempotencyKey, toFormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import {
  isTemplateKey,
  isTemplateLocale,
  type NotificationSettingsPatch,
  type NotificationSettingsSaveResult,
  type PreviewActionResult,
  type SenderDomainActionResult,
  type TemplateActionResult,
  type TemplateKey,
  type TemplateLocale,
  type TestEmailActionResult,
} from "@/lib/notification-settings-model";
import type { Dictionary } from "@/messages/en";

/** What the notifications pages show: refreshed after anything that reached the API. */
export const NOTIFICATION_SETTINGS_PATH = "/settings/notifications";
export function templatePagePath(key: TemplateKey): string {
  return `${NOTIFICATION_SETTINGS_PATH}/${key}`;
}

const DOMAIN_USED_BY_ANOTHER_STORE = "This domain is used by another store";

export async function currentDictionary(): Promise<Dictionary> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

type Errors = Readonly<Record<string, string>>;

/** Whatever the API refused, in the page's language: a sentence and, per field, a short reason. */
function failure(
  result: MutationResult<unknown>,
  dictionary: Dictionary,
  localize: (field: string, message: string) => string | undefined = () => undefined,
): { readonly status: "error"; readonly message: string; readonly fieldErrors: Errors } {
  const state = toFormState(result, dictionary.formErrors);
  if (state.status !== "error") {
    return { status: "error", message: dictionary.formErrors.unexpected, fieldErrors: {} };
  }
  if (result.outcome !== "invalid") return { ...state, fieldErrors: state.fieldErrors };
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.fields) {
    fieldErrors[issue.field] =
      localize(issue.field, issue.message) ?? dictionary.formErrors.invalid;
  }
  return { status: "error", message: dictionary.formErrors.invalid, fieldErrors };
}

function refreshSettings(): void {
  revalidatePath(NOTIFICATION_SETTINGS_PATH);
}

/**
 * Saves one part of the settings document. The API takes the whole document, so the other parts are
 * read fresh and sent back unchanged; the version is the one the page LOADED (never the fresh one),
 * so a page that is out of date gets the 409 instead of overwriting someone else's save. Every
 * outcome that reached the API refreshes the page.
 */
export async function savePatch(
  patch: NotificationSettingsPatch,
  expectedVersion: number | null,
  dictionary: Dictionary,
): Promise<NotificationSettingsSaveResult> {
  const copy = dictionary.notificationSettings;
  const current = await fetchNotificationSettings();
  if (current.outcome !== "ok") {
    refreshSettings();
    return {
      status: "error",
      message:
        current.outcome === "unauthorized"
          ? dictionary.formErrors.unauthorized
          : dictionary.formErrors.unexpected,
      fieldErrors: {},
    };
  }

  const result = await saveNotificationSettings(
    { ...current.settings.values, ...patch },
    expectedVersion,
    newIdempotencyKey(),
  );
  refreshSettings();

  if (result.outcome === "ok") return { status: "success", settings: result.data };
  if (result.outcome === "conflict") {
    return { status: "error", message: copy.conflict, fieldErrors: {} };
  }
  return failure(result, dictionary, (field, message) => {
    if (field === "senderEmail") return copy.senderInvalid;
    if (field === "staffRecipients") {
      return message.startsWith("at most")
        ? copy.recipientsFull.replace("{max}", "10")
        : copy.recipientInvalid;
    }
    return undefined;
  });
}

/**
 * The server's refusals for the domain calls are plain English sentences. The two the page can
 * explain in either language are mapped; anything else (one domain per store, no usable email) is
 * shown as the server wrote it rather than guessed at.
 */
function localizeDomainRefusal(message: string, copy: Dictionary["notificationSettings"]): string {
  if (message === DOMAIN_USED_BY_ANOTHER_STORE) return copy.domainUsedByAnotherStore;
  const freeMail = /^Emails from (\S+) can't be authenticated\./.exec(message);
  if (freeMail?.[1] !== undefined) return copy.domainFreeMail.replace("{domain}", freeMail[1]);
  return message;
}

type DomainCall = typeof startSenderDomain | typeof verifySenderDomain;

/** Authenticate / verify: the domain as the server now has it, or a plain reason in the page's language. */
export async function runDomainAction(
  call: DomainCall,
  dictionary: Dictionary,
): Promise<SenderDomainActionResult> {
  const copy = dictionary.notificationSettings;
  const result = await call(newIdempotencyKey());
  refreshSettings();

  switch (result.outcome) {
    case "ok":
      return { status: "success", domain: result.data };
    case "error":
      if (result.status === 503) return { status: "unavailable" };
      if (result.status === 502) return { status: "error", message: copy.domainProviderError };
      return { status: "error", message: dictionary.formErrors.unexpected };
    case "conflict":
    case "invalid":
      return { status: "error", message: localizeDomainRefusal(result.message, copy) };
    default:
      return { status: "error", message: failure(result, dictionary).message };
  }
}

export interface TemplateDraft {
  readonly key: TemplateKey;
  readonly locale: TemplateLocale;
  readonly subject: string;
  readonly body: string;
}

/** A client call is untrusted: the key, language and both texts are checked before anything is sent. */
export function parseDraft(input: unknown): TemplateDraft | null {
  if (typeof input !== "object" || input === null) return null;
  const draft = input as Record<string, unknown>;
  const { key, locale, subject, body } = draft;
  if (!isTemplateKey(key) || !isTemplateLocale(locale)) return null;
  if (typeof subject !== "string" || typeof body !== "string") return null;
  return { key, locale, subject, body };
}

export function parseRef(input: unknown): { key: TemplateKey; locale: TemplateLocale } | null {
  if (typeof input !== "object" || input === null) return null;
  const { key, locale } = input as Record<string, unknown>;
  return isTemplateKey(key) && isTemplateLocale(locale) ? { key, locale } : null;
}

function localizeTemplateField(dictionary: Dictionary) {
  const copy = dictionary.notificationSettings.editor;
  return (field: string): string | undefined =>
    field === "subject" ? copy.subjectInvalid : field === "body" ? copy.bodyInvalid : undefined;
}

function invalidInput(dictionary: Dictionary): {
  readonly status: "error";
  readonly message: string;
  readonly fieldErrors: Errors;
} {
  return { status: "error", message: dictionary.formErrors.invalid, fieldErrors: {} };
}

export async function saveTemplate(
  draft: TemplateDraft | null,
  dictionary: Dictionary,
): Promise<TemplateActionResult> {
  if (draft === null) return invalidInput(dictionary);
  const result = await saveTemplateCopy(draft.key, draft.locale, draft, newIdempotencyKey());
  refreshSettings();
  revalidatePath(templatePagePath(draft.key));
  if (result.outcome === "ok") return { status: "success", template: result.data };
  return failure(result, dictionary, localizeTemplateField(dictionary));
}

export async function revertTemplate(
  ref: { key: TemplateKey; locale: TemplateLocale } | null,
  dictionary: Dictionary,
): Promise<TemplateActionResult> {
  if (ref === null) return invalidInput(dictionary);
  const result = await revertTemplateCopy(ref.key, ref.locale);
  refreshSettings();
  revalidatePath(templatePagePath(ref.key));
  if (result.outcome === "ok") return { status: "success", template: result.data };
  return failure(result, dictionary);
}

/** Read-only on the server (nothing is stored), so nothing is refreshed. */
export async function previewTemplate(
  draft: TemplateDraft | null,
  dictionary: Dictionary,
): Promise<PreviewActionResult> {
  if (draft === null) return invalidInput(dictionary);
  const result = await previewTemplateCopy(draft.key, draft);
  if (result.outcome === "ok") return { status: "success", preview: result.data };
  return failure(result, dictionary, localizeTemplateField(dictionary));
}

/** Sends nothing that is stored either: a test mail to the signed-in member's own address. */
export async function sendTest(
  draft: TemplateDraft | null,
  dictionary: Dictionary,
): Promise<TestEmailActionResult> {
  if (draft === null) return { status: "error", message: dictionary.formErrors.invalid };
  const result = await sendTemplateTest(draft.key, draft);
  switch (result.outcome) {
    case "ok":
      return { status: "sent" };
    case "error":
      if (result.status === 503) return { status: "unavailable" };
      if (result.status === 429) return { status: "rate_limited" };
      return { status: "error", message: dictionary.formErrors.unexpected };
    default:
      return { status: "error", message: failure(result, dictionary).message };
  }
}

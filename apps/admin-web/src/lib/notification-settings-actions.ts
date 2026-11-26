import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  deleteEmailConnection,
  fetchNotificationSettings,
  previewTemplateCopy,
  revertTemplateCopy,
  saveEmailConnection,
  saveNotificationSettings,
  saveTemplateCopy,
  sendTemplateTest,
  setEmailConnectionEnabled,
  testEmailConnection,
} from "@/lib/api/notification-settings";
import type { MutationResult } from "@/lib/api/client";
import { newIdempotencyKey, toFormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import {
  CUSTOM_SMTP_PORTS,
  isEmailConnectionKind,
  isPlausibleEmail,
  isSmtpPresetId,
  isSmtpSecurity,
  isTemplateKey,
  isTemplateLocale,
  normalizeEmail,
  type EmailConnectionActionResult,
  type EmailConnectionKind,
  type EmailConnectionSnapshot,
  type EmailSaveSmtp,
  type NotificationSettingsPatch,
  type NotificationSettingsSaveResult,
  type PreviewActionResult,
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

/** The page that shows whether the store can email customers: its sign-up warning reads the same state. */
export const CUSTOMER_ACCOUNTS_PATH = "/settings/customer-accounts";
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
    if (field === "staffRecipients") {
      return message.startsWith("at most")
        ? copy.recipientsFull.replace("{max}", "10")
        : copy.recipientInvalid;
    }
    return undefined;
  });
}

/** Every page that shows the state of the store's email account. */
function refreshEmailConnection(): void {
  revalidatePath(NOTIFICATION_SETTINGS_PATH);
  revalidatePath(CUSTOMER_ACCOUNTS_PATH);
}

export interface EmailSaveInput {
  readonly kind: EmailConnectionKind;
  readonly fromEmail: string;
  /** Resend: null = keep the stored key. */
  readonly apiKey: string | null;
  /** Mailbox only. */
  readonly smtp: EmailSaveSmtp | null;
  /** Mailbox only: null = keep the stored password. */
  readonly password: string | null;
  readonly expectedVersion: number | null;
}

const MAX_KEY_LENGTH = 256;
const MAX_HOST_LENGTH = 253;
const MAX_USERNAME_LENGTH = 254;
const SAVE_FIELDS = ["kind", "fromEmail", "apiKey", "smtp", "password", "expectedVersion"];
const SMTP_FIELDS = ["preset", "username", "host", "port", "security"];
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;

/** The mailbox part of a save: a known preset, a plain username and, for "other", a real server. */
function parseSmtp(input: unknown): EmailSaveSmtp | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  for (const field of Object.keys(raw)) if (!SMTP_FIELDS.includes(field)) return null;
  const { preset, username, host, port, security } = raw;
  if (!isSmtpPresetId(preset) || typeof username !== "string") return null;
  const user = username.trim();
  if (user === "" || user.length > MAX_USERNAME_LENGTH || CONTROL.test(user) || /\s/.test(user)) {
    return null;
  }
  if (preset !== "custom") {
    // A preset decides the server: details for one are not accepted at all.
    return host === undefined && port === undefined && security === undefined
      ? { preset, username: user }
      : null;
  }
  if (typeof host !== "string" || typeof port !== "number" || !isSmtpSecurity(security))
    return null;
  const name = host.trim().toLowerCase();
  if (name.length > MAX_HOST_LENGTH || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(name)) return null;
  if (!CUSTOM_SMTP_PORTS.includes(port)) return null;
  return { preset, username: user, host: name, port, security };
}

/**
 * A client call is untrusted: only the known fields, a known provider, a plausible From address
 * and a version the page really had are let through. A blank secret means "keep the stored one".
 * The key or password is never echoed into an error.
 */
export function parseEmailSave(input: unknown): EmailSaveInput | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  for (const field of Object.keys(raw)) if (!SAVE_FIELDS.includes(field)) return null;
  const { kind, fromEmail, apiKey, smtp, password, expectedVersion } = raw;
  if (!isEmailConnectionKind(kind)) return null;
  if (typeof fromEmail !== "string" || !isPlausibleEmail(fromEmail)) return null;
  const version = parseVersion(expectedVersion);
  if (version === undefined) return null;
  const secret = (value: unknown): string | null | undefined => {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") return undefined;
    const text = value.trim();
    return text.length > MAX_KEY_LENGTH ? undefined : text === "" ? null : text;
  };
  const base = { kind, fromEmail: normalizeEmail(fromEmail), expectedVersion: version };
  if (kind === "smtp") {
    // A mailbox has a password and a server, never an API key.
    const parsedSmtp = parseSmtp(smtp);
    const parsedPassword = secret(password);
    if (parsedSmtp === null || parsedPassword === undefined) return null;
    if (apiKey !== undefined && apiKey !== null && apiKey !== "") return null;
    return { ...base, apiKey: null, smtp: parsedSmtp, password: parsedPassword };
  }
  if (smtp !== undefined && smtp !== null) return null;
  if (password !== undefined && password !== null && password !== "") return null;
  const parsedKey = secret(apiKey);
  if (parsedKey === undefined) return null;
  return { ...base, apiKey: parsedKey, smtp: null, password: null };
}

function parseVersion(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined;
}

/** What an email-account call answered with, in the page's language. A refused test mail is a success. */
function emailOutcome(
  result: MutationResult<EmailConnectionSnapshot>,
  dictionary: Dictionary,
): EmailConnectionActionResult {
  const copy = dictionary.notificationSettings;
  switch (result.outcome) {
    case "ok":
      return { status: "success", snapshot: result.data };
    case "conflict":
      return { status: "conflict", message: copy.conflict };
    case "error":
      if (result.status === 503) return { status: "unavailable" };
      if (result.status === 429) return { status: "rate_limited" };
      return { status: "error", message: dictionary.formErrors.unexpected, fieldErrors: {} };
    default: {
      const refused = failure(result, dictionary, (field, message) => {
        if (field === "fromEmail") {
          return message.includes("same address")
            ? copy.email.fromMustMatch
            : copy.email.fromInvalid;
        }
        if (field === "apiKey") return copy.email.keyInvalid;
        if (field === "password") return copy.email.passwordInvalid;
        if (field === "smtp.username") return copy.email.usernameInvalid;
        if (field === "smtp.host") return copy.email.hostInvalid;
        if (field === "smtp.port") return copy.email.portInvalid;
        if (field === "smtp.security" || field === "smtp.preset" || field === "smtp") {
          return copy.email.presetInvalid;
        }
        if (field === "kind") return copy.email.kindInvalid;
        if (field === "actor") return copy.email.noAddress;
        return undefined;
      });
      return refused.fieldErrors["actor"] === undefined
        ? refused
        : { ...refused, message: copy.email.noAddress };
    }
  }
}

function invalidEmailInput(dictionary: Dictionary): EmailConnectionActionResult {
  return { status: "error", message: dictionary.formErrors.invalid, fieldErrors: {} };
}

/** "Save": connects the account and sends a test mail to the signed-in member. */
export async function runEmailSave(
  input: unknown,
  dictionary: Dictionary,
): Promise<EmailConnectionActionResult> {
  const parsed = parseEmailSave(input);
  if (parsed === null) return invalidEmailInput(dictionary);
  const result = await saveEmailConnection(
    {
      kind: parsed.kind,
      fromEmail: parsed.fromEmail,
      apiKey: parsed.apiKey,
      smtp: parsed.smtp,
      password: parsed.password,
    },
    parsed.expectedVersion,
    newIdempotencyKey(),
  );
  refreshEmailConnection();
  return emailOutcome(result, dictionary);
}

/** The on/off switch: the version the page loaded, never a guessed one. */
export async function runEmailEnabled(
  input: unknown,
  dictionary: Dictionary,
): Promise<EmailConnectionActionResult> {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const version = parseVersion(raw["expectedVersion"]);
  if (typeof raw["enabled"] !== "boolean" || typeof version !== "number") {
    return invalidEmailInput(dictionary);
  }
  const result = await setEmailConnectionEnabled(raw["enabled"], version, newIdempotencyKey());
  refreshEmailConnection();
  return emailOutcome(result, dictionary);
}

/** "Send test": a test mail to the signed-in member through the saved account. */
export async function runEmailTest(dictionary: Dictionary): Promise<EmailConnectionActionResult> {
  const result = await testEmailConnection(newIdempotencyKey());
  refreshEmailConnection();
  return emailOutcome(result, dictionary);
}

/** "Disconnect": the server deletes the sealed key. */
export async function runEmailDisconnect(
  dictionary: Dictionary,
): Promise<EmailConnectionActionResult> {
  const result = await deleteEmailConnection();
  refreshEmailConnection();
  return emailOutcome(result, dictionary);
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

import {
  isEmailConnectionKind,
  isEmailConnectionState,
  isSmtpErrorCode,
  isSmtpPresetId,
  isSmtpSecurity,
  isTemplateKey,
  isTemplateLocale,
  TEMPLATE_LOCALES,
  type EmailConnectionDto,
  type EmailConnectionKind,
  type EmailConnectionSnapshot,
  type EmailSaveSmtp,
  type NotificationSettingsSnapshot,
  type NotificationSettingsValues,
  type PreviewDto,
  type TemplateDetailDto,
  type TemplateDto,
  type TemplateKey,
  type TemplateLocale,
} from "@/lib/notification-settings-model";
import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

/**
 * Wave 2b - Settings > Notifications. Server-only calls to the committed routes
 * (`apps/admin/src/http/notification-settings-routes.ts` and `email-connection-routes.ts`):
 * settings, templates, preview, test send and the store's own email account. Client components take the
 * shapes from `lib/notification-settings-model.ts` (pure data), never from here.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isSettingsValues(value: unknown): value is NotificationSettingsValues {
  return (
    isRecord(value) &&
    isNullableString(value["senderEmail"]) &&
    isStringArray(value["staffRecipients"]) &&
    isStringArray(value["disabledTemplates"])
  );
}

function isSettingsSnapshot(value: unknown): value is NotificationSettingsSnapshot {
  if (!isRecord(value)) return false;
  const sender = value["sender"];
  return (
    isSettingsValues(value["values"]) &&
    (value["version"] === null || typeof value["version"] === "number") &&
    typeof value["deliveryConfigured"] === "boolean" &&
    typeof value["storeName"] === "string" &&
    isNullableString(value["contactEmail"]) &&
    isRecord(sender) &&
    isEmailConnectionState(value["emailConnection"]) &&
    (sender["mode"] === "store_connection" || sender["mode"] === "not_connected") &&
    isNullableString(sender["effectiveEmail"]) &&
    typeof sender["freeMail"] === "boolean"
  );
}

function isTemplateLocaleDto(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["subject"] === "string" &&
    typeof value["body"] === "string" &&
    typeof value["customized"] === "boolean"
  );
}

function isTemplate(value: unknown): value is TemplateDto {
  if (!isRecord(value)) return false;
  const locales = value["locales"];
  return (
    isTemplateKey(value["key"]) &&
    (value["audience"] === "customer" || value["audience"] === "staff") &&
    typeof value["enabled"] === "boolean" &&
    Array.isArray(value["variables"]) &&
    value["variables"].every(
      (variable) =>
        isRecord(variable) &&
        typeof variable["name"] === "string" &&
        (variable["kind"] === "text" || variable["kind"] === "url" || variable["kind"] === "block"),
    ) &&
    isRecord(locales) &&
    TEMPLATE_LOCALES.every((locale) => isTemplateLocaleDto(locales[locale]))
  );
}

function isTemplateDetail(value: unknown): value is TemplateDetailDto {
  return (
    isTemplate(value) &&
    isTemplateLocale((value as unknown as Record<string, unknown>)["locale"]) &&
    isRecord((value as unknown as Record<string, unknown>)["defaults"]) &&
    typeof ((value as unknown as Record<string, unknown>)["defaults"] as Record<string, unknown>)[
      "subject"
    ] === "string"
  );
}

function isTemplateList(value: unknown): value is { readonly templates: readonly TemplateDto[] } {
  return (
    isRecord(value) && Array.isArray(value["templates"]) && value["templates"].every(isTemplate)
  );
}

function isPreview(value: unknown): value is PreviewDto {
  return (
    isRecord(value) &&
    typeof value["subject"] === "string" &&
    typeof value["html"] === "string" &&
    isStringArray(value["unknownVariables"])
  );
}

function isEmailConnection(value: unknown): value is EmailConnectionDto {
  return (
    isRecord(value) &&
    isEmailConnectionKind(value["kind"]) &&
    typeof value["fromEmail"] === "string" &&
    typeof value["secretLast4"] === "string" &&
    typeof value["enabled"] === "boolean" &&
    (value["status"] === "connected" || value["status"] === "failed") &&
    isEmailConnectionState(value["state"]) &&
    isNullableString(value["lastError"]) &&
    (value["lastErrorCode"] === null || isSmtpErrorCode(value["lastErrorCode"])) &&
    isNullableString(value["lastErrorAt"]) &&
    isNullableString(value["verifiedAt"]) &&
    typeof value["version"] === "number" &&
    (value["smtp"] === null || isSmtpConnection(value["smtp"]))
  );
}

function isSmtpConnection(value: unknown): boolean {
  return (
    isRecord(value) &&
    isSmtpPresetId(value["preset"]) &&
    typeof value["host"] === "string" &&
    typeof value["port"] === "number" &&
    isSmtpSecurity(value["security"]) &&
    typeof value["username"] === "string"
  );
}

function isEmailConnectionSnapshot(value: unknown): value is EmailConnectionSnapshot {
  return (
    isRecord(value) &&
    typeof value["credentialsConfigured"] === "boolean" &&
    typeof value["smtpAvailable"] === "boolean" &&
    (value["connection"] === null || isEmailConnection(value["connection"]))
  );
}

function isSent(value: unknown): value is { readonly sent: true } {
  return isRecord(value) && value["sent"] === true;
}

export type FetchResult<T, K extends string> =
  | ({ readonly outcome: "ok" } & { readonly [P in K]: T })
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /notifications/settings`: the document, its version, the sender summary, delivery honesty. */
export async function fetchNotificationSettings(): Promise<
  FetchResult<NotificationSettingsSnapshot, "settings">
> {
  const result = await getAdminApi("/api/v1/notifications/settings", isSettingsSnapshot);
  if (result.outcome === "ok") return { outcome: "ok", settings: result.data };
  if (result.outcome === "error") return { outcome: "error", message: result.message };
  return result;
}

/**
 * `POST /notifications/settings`: saves the whole document. `expectedVersion` is the version the
 * page loaded (null when it loaded the defaults): a stale one is a 409, never an overwrite.
 */
export function saveNotificationSettings(
  values: NotificationSettingsValues,
  expectedVersion: number | null,
  idempotencyKey: string,
): Promise<MutationResult<NotificationSettingsSnapshot>> {
  return mutateAdminApi(
    "/api/v1/notifications/settings",
    { method: "POST", body: { ...values, expectedVersion }, idempotencyKey },
    isSettingsSnapshot,
  );
}

/** `GET /notifications/templates`: every template with its current copy in both languages. */
export async function fetchNotificationTemplates(): Promise<
  FetchResult<readonly TemplateDto[], "templates">
> {
  const result = await getAdminApi("/api/v1/notifications/templates", isTemplateList);
  if (result.outcome === "ok") return { outcome: "ok", templates: result.data.templates };
  if (result.outcome === "error") return { outcome: "error", message: result.message };
  return result;
}

function templatePath(key: TemplateKey, locale?: TemplateLocale): string {
  const base = `/api/v1/notifications/templates/${encodeURIComponent(key)}`;
  return locale === undefined ? base : `${base}/${encodeURIComponent(locale)}`;
}

/** `PUT /notifications/templates/:key/:locale`: the merchant's own subject and body. */
export function saveTemplateCopy(
  key: TemplateKey,
  locale: TemplateLocale,
  copy: { readonly subject: string; readonly body: string },
  idempotencyKey: string,
): Promise<MutationResult<TemplateDetailDto>> {
  return mutateAdminApi(
    templatePath(key, locale),
    { method: "PUT", body: { subject: copy.subject, body: copy.body }, idempotencyKey },
    isTemplateDetail,
  );
}

/** `DELETE /notifications/templates/:key/:locale`: back to the shipped copy. */
export function revertTemplateCopy(
  key: TemplateKey,
  locale: TemplateLocale,
): Promise<MutationResult<TemplateDetailDto>> {
  return mutateAdminApi(templatePath(key, locale), { method: "DELETE" }, isTemplateDetail);
}

/** The route's body is strict: exactly the language, subject and body, never the key or anything else. */
function draftBody(draft: {
  readonly locale: TemplateLocale;
  readonly subject: string;
  readonly body: string;
}) {
  return { locale: draft.locale, subject: draft.subject, body: draft.body };
}

/** `POST /notifications/templates/:key/preview`: the unsaved draft rendered with sample data. */
export function previewTemplateCopy(
  key: TemplateKey,
  draft: { readonly locale: TemplateLocale; readonly subject: string; readonly body: string },
): Promise<MutationResult<PreviewDto>> {
  return mutateAdminApi(
    `${templatePath(key)}/preview`,
    { method: "POST", body: draftBody(draft) },
    isPreview,
  );
}

/**
 * `POST /notifications/templates/:key/test`: sends the draft to the signed-in member's OWN address.
 * There is no recipient in the request; the server resolves it from the session.
 */
export function sendTemplateTest(
  key: TemplateKey,
  draft: { readonly locale: TemplateLocale; readonly subject: string; readonly body: string },
): Promise<MutationResult<{ readonly sent: true }>> {
  return mutateAdminApi(
    `${templatePath(key)}/test`,
    { method: "POST", body: draftBody(draft) },
    isSent,
  );
}

const EMAIL_CONNECTION_PATH = "/api/v1/notifications/email-connection";

/** `GET /notifications/email-connection`: the store's own email account (never its key). */
export async function fetchEmailConnection(): Promise<
  FetchResult<EmailConnectionSnapshot, "emailConnection">
> {
  const result = await getAdminApi(EMAIL_CONNECTION_PATH, isEmailConnectionSnapshot);
  if (result.outcome === "ok") return { outcome: "ok", emailConnection: result.data };
  if (result.outcome === "error") return { outcome: "error", message: result.message };
  return result;
}

/**
 * `PUT /notifications/email-connection`: connects (or updates) the account and sends a test mail to
 * the signed-in member. The key is write-only: an omitted `apiKey` keeps the stored one, and it is
 * never read back. A refused test mail is still a 200 whose connection has `status: "failed"`.
 */
export function saveEmailConnection(
  input: {
    readonly kind: EmailConnectionKind;
    readonly fromEmail: string;
    /** Resend: the API key. null = keep the stored one. */
    readonly apiKey: string | null;
    /** Mailbox: which server and as whom (custom adds host, port, security). */
    readonly smtp?: EmailSaveSmtp | null;
    /** Mailbox: the app password, write-only. null = keep the stored one. */
    readonly password?: string | null;
  },
  expectedVersion: number | null,
  idempotencyKey: string,
): Promise<MutationResult<EmailConnectionSnapshot>> {
  return mutateAdminApi(
    EMAIL_CONNECTION_PATH,
    {
      method: "PUT",
      body: {
        kind: input.kind,
        fromEmail: input.fromEmail,
        ...(input.apiKey === null ? {} : { apiKey: input.apiKey }),
        ...(input.smtp === undefined || input.smtp === null ? {} : { smtp: input.smtp }),
        ...(input.password === undefined || input.password === null
          ? {}
          : { password: input.password }),
        expectedVersion,
      },
      idempotencyKey,
    },
    isEmailConnectionSnapshot,
  );
}

/** `POST /notifications/email-connection/enabled`: switches customer email on or off. */
export function setEmailConnectionEnabled(
  enabled: boolean,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<MutationResult<EmailConnectionSnapshot>> {
  return mutateAdminApi(
    `${EMAIL_CONNECTION_PATH}/enabled`,
    { method: "POST", body: { enabled, expectedVersion }, idempotencyKey },
    isEmailConnectionSnapshot,
  );
}

/** `POST /notifications/email-connection/test`: a test mail to the signed-in member's own address. */
export function testEmailConnection(
  idempotencyKey: string,
): Promise<MutationResult<EmailConnectionSnapshot>> {
  return mutateAdminApi(
    `${EMAIL_CONNECTION_PATH}/test`,
    { method: "POST", body: {}, idempotencyKey },
    isEmailConnectionSnapshot,
  );
}

/** `DELETE /notifications/email-connection`: disconnects; the server deletes the sealed key. */
export function deleteEmailConnection(): Promise<MutationResult<EmailConnectionSnapshot>> {
  return mutateAdminApi(EMAIL_CONNECTION_PATH, { method: "DELETE" }, isEmailConnectionSnapshot);
}

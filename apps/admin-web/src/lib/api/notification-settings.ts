import {
  isDomainStatus,
  isTemplateKey,
  isTemplateLocale,
  TEMPLATE_LOCALES,
  type DnsRecordDto,
  type NotificationSettingsSnapshot,
  type NotificationSettingsValues,
  type PreviewDto,
  type SenderDomainDto,
  type SenderDomainViewDto,
  type TemplateDetailDto,
  type TemplateDto,
  type TemplateKey,
  type TemplateLocale,
} from "@/lib/notification-settings-model";
import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

/**
 * Wave 2b - Settings > Notifications. Server-only calls to the committed routes
 * (`apps/admin/src/http/notification-settings-routes.ts` and `sender-domain-routes.ts`):
 * settings, templates, preview, test send and the sender domain. Client components take the
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
    (sender["mode"] === "own_domain" ||
      sender["mode"] === "reply_to" ||
      sender["mode"] === "platform_only") &&
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

function isDnsRecord(value: unknown): value is DnsRecordDto {
  return (
    isRecord(value) &&
    typeof value["record"] === "string" &&
    typeof value["name"] === "string" &&
    typeof value["type"] === "string" &&
    typeof value["value"] === "string" &&
    typeof value["ttl"] === "string" &&
    typeof value["status"] === "string" &&
    (value["priority"] === null || typeof value["priority"] === "number")
  );
}

function isDomainView(value: unknown): value is SenderDomainViewDto {
  return (
    isRecord(value) &&
    typeof value["domain"] === "string" &&
    isDomainStatus(value["status"]) &&
    typeof value["verified"] === "boolean" &&
    Array.isArray(value["records"]) &&
    value["records"].every(isDnsRecord) &&
    isNullableString(value["verifiedAt"])
  );
}

function isSenderDomain(value: unknown): value is SenderDomainDto {
  if (!isRecord(value)) return false;
  const suggestion = value["suggestion"];
  return (
    typeof value["available"] === "boolean" &&
    (value["domain"] === null || isDomainView(value["domain"])) &&
    (suggestion === null ||
      (isRecord(suggestion) &&
        typeof suggestion["domain"] === "string" &&
        typeof suggestion["freeMail"] === "boolean"))
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

/** `GET /notifications/sender-domain`: the stored domain (no provider call) and whether it can be set up. */
export async function fetchSenderDomain(): Promise<FetchResult<SenderDomainDto, "senderDomain">> {
  const result = await getAdminApi("/api/v1/notifications/sender-domain", isSenderDomain);
  if (result.outcome === "ok") return { outcome: "ok", senderDomain: result.data };
  if (result.outcome === "error") return { outcome: "error", message: result.message };
  return result;
}

/** `POST /notifications/sender-domain`: "Authenticate domain" (idempotent; the domain is never client-chosen). */
export function startSenderDomain(
  idempotencyKey: string,
): Promise<MutationResult<SenderDomainDto>> {
  return mutateAdminApi(
    "/api/v1/notifications/sender-domain",
    { method: "POST", body: {}, idempotencyKey },
    isSenderDomain,
  );
}

/** `POST /notifications/sender-domain/verify`: asks the provider to check the DNS records. */
export function verifySenderDomain(
  idempotencyKey: string,
): Promise<MutationResult<SenderDomainDto>> {
  return mutateAdminApi(
    "/api/v1/notifications/sender-domain/verify",
    { method: "POST", body: {}, idempotencyKey },
    isSenderDomain,
  );
}

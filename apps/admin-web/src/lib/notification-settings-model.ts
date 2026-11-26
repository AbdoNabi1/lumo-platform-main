/**
 * Wave 2b - the vocabulary of Settings > Notifications, shared by the server actions and the
 * client cards. Pure data: it never imports the API client, so a "use client" component may take
 * values from it (see `lib/client-boundary.test.ts`). Mirrors the committed backend
 * (`services/notifications/src/domain/messaging/*`).
 */

export const TEMPLATE_KEYS = [
  "order_confirmation",
  "order_canceled",
  "order_refunded",
  "shipping_confirmation",
  "draft_order_invoice",
  "staff_new_order",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** The templates customers receive; `staff_new_order` goes to the shop's own recipients. */
export const CUSTOMER_TEMPLATE_KEYS = TEMPLATE_KEYS.filter((key) => key !== "staff_new_order");

export const TEMPLATE_LOCALES = ["en", "ar"] as const;
export type TemplateLocale = (typeof TEMPLATE_LOCALES)[number];

export const MAX_STAFF_RECIPIENTS = 10;
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 20_000;

export function isTemplateKey(value: unknown): value is TemplateKey {
  return typeof value === "string" && (TEMPLATE_KEYS as readonly string[]).includes(value);
}

export function isTemplateLocale(value: unknown): value is TemplateLocale {
  return typeof value === "string" && (TEMPLATE_LOCALES as readonly string[]).includes(value);
}

export type SenderMode = "own_domain" | "reply_to" | "platform_only";

/** The three things the page edits; the API takes them as one document. */
export interface NotificationSettingsValues {
  /** The Sender email; null = the store contact email is used. */
  readonly senderEmail: string | null;
  /** Who gets "New order" (the merchant's own addresses). */
  readonly staffRecipients: readonly string[];
  /** Template keys that are switched off. */
  readonly disabledTemplates: readonly string[];
}

/** An edit to one part of the document; the other parts are sent back as they were read. */
export type NotificationSettingsPatch = Partial<NotificationSettingsValues>;

export interface SenderSummary {
  readonly mode: SenderMode;
  /** The merchant address in effect: the Sender email, else the store contact email. */
  readonly effectiveEmail: string | null;
  /** A free-mail address can never be authenticated, so it is always Reply-To. */
  readonly freeMail: boolean;
}

/** What the page shows: `GET /notifications/settings`, and what a save answers with. */
export interface NotificationSettingsSnapshot {
  readonly values: NotificationSettingsValues;
  /** The version a save must send back; null while the shop has never saved any (no row yet). */
  readonly version: number | null;
  /** Whether the server really delivers email (D40). */
  readonly deliveryConfigured: boolean;
  readonly storeName: string;
  readonly contactEmail: string | null;
  readonly sender: SenderSummary;
}

/** A settings save's outcome: the saved document, or why it was refused. */
export type NotificationSettingsSaveResult =
  | { readonly status: "success"; readonly settings: NotificationSettingsSnapshot }
  | {
      readonly status: "error";
      readonly message: string;
      readonly fieldErrors: Readonly<Record<string, string>>;
    };

/** The address typed in a box, trimmed and lower-cased the way the server stores it. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** The server's rule (`isValidEmail`): one `@`, a dot in the domain, no spaces or list punctuation. */
const EMAIL_PATTERN = /^[^\s@<>",;:\\()[\]]+@[^\s@<>",;:\\()[\]]+\.[^\s@<>",;:\\()[\]]{2,}$/;

export function isPlausibleEmail(value: string): boolean {
  const email = value.trim();
  return email.length > 0 && email.length <= 254 && EMAIL_PATTERN.test(email);
}

/**
 * `text` with `{{name}}` put where the caret (or selection) was, and where the caret goes next.
 * Out-of-range positions are clamped, so a stale selection can never throw or lose text.
 */
export function insertVariable(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  name: string,
): { readonly text: string; readonly caret: number } {
  const start = Math.max(0, Math.min(selectionStart, text.length));
  const end = Math.max(start, Math.min(selectionEnd, text.length));
  const token = `{{${name}}}`;
  return { text: text.slice(0, start) + token + text.slice(end), caret: start + token.length };
}

/** Provider domain statuses (`services/notifications/src/domain/messaging/sender-domain.ts`). */
export const DOMAIN_STATUSES = [
  "not_started",
  "pending",
  "verified",
  "failed",
  "temporary_failure",
] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export function isDomainStatus(value: unknown): value is DomainStatus {
  return typeof value === "string" && (DOMAIN_STATUSES as readonly string[]).includes(value);
}

/** One DNS record the merchant adds at their DNS host. */
export interface DnsRecordDto {
  readonly record: string;
  readonly name: string;
  readonly type: string;
  readonly value: string;
  readonly ttl: string;
  readonly status: string;
  readonly priority: number | null;
}

export interface SenderDomainViewDto {
  readonly domain: string;
  readonly status: DomainStatus;
  readonly verified: boolean;
  readonly records: readonly DnsRecordDto[];
  readonly verifiedAt: string | null;
}

/** `GET/POST /notifications/sender-domain`. */
export interface SenderDomainDto {
  /** false when the server has no provider key: the page says "Not available yet". */
  readonly available: boolean;
  readonly domain: SenderDomainViewDto | null;
  /** The domain the sender email (else the contact email) would authenticate. */
  readonly suggestion: { readonly domain: string; readonly freeMail: boolean } | null;
}

/** What a domain action answers with. `unavailable` is the 503 (no provider key on the server). */
export type SenderDomainActionResult =
  | { readonly status: "success"; readonly domain: SenderDomainDto }
  | { readonly status: "unavailable" }
  | { readonly status: "error"; readonly message: string };

/** The badge tone for a domain status: verified is healthy, failed is failed, the rest is waiting. */
export function domainStatusTone(status: DomainStatus): "success" | "warning" | "destructive" {
  if (status === "verified") return "success";
  if (status === "failed") return "destructive";
  return "warning";
}

/** One template as the list and the editor read it. */
export interface TemplateLocaleDto {
  readonly subject: string;
  readonly body: string;
  /** true when the merchant saved their own copy for this language. */
  readonly customized: boolean;
}

export interface TemplateVariableDto {
  readonly name: string;
  readonly kind: "text" | "url" | "block";
}

export interface TemplateDto {
  readonly key: TemplateKey;
  readonly audience: "customer" | "staff";
  readonly enabled: boolean;
  readonly variables: readonly TemplateVariableDto[];
  readonly locales: Readonly<Record<TemplateLocale, TemplateLocaleDto>>;
}

/** The one-language view a save or revert answers with, with the shipped defaults. */
export interface TemplateDetailDto extends TemplateDto {
  readonly locale: TemplateLocale;
  readonly defaults: { readonly subject: string; readonly body: string };
}

export interface PreviewDto {
  readonly subject: string;
  /** Rendered HTML: only ever shown in a sandboxed iframe, never injected into the page. */
  readonly html: string;
  readonly unknownVariables: readonly string[];
}

export type TemplateActionResult =
  | { readonly status: "success"; readonly template: TemplateDetailDto }
  | {
      readonly status: "error";
      readonly message: string;
      readonly fieldErrors: Readonly<Record<string, string>>;
    };

export type PreviewActionResult =
  | { readonly status: "success"; readonly preview: PreviewDto }
  | {
      readonly status: "error";
      readonly message: string;
      readonly fieldErrors: Readonly<Record<string, string>>;
    };

/** A test mail: sent, or why not (503 = email isn't set up, 429 = too many test mails). */
export type TestEmailActionResult =
  | { readonly status: "sent" }
  | { readonly status: "unavailable" }
  | { readonly status: "rate_limited" }
  | { readonly status: "error"; readonly message: string };

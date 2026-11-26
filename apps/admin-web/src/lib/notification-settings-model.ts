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

/** `store_connection`: customer mail goes out through the store's own email account. */
export type SenderMode = "store_connection" | "not_connected";

/** What the store's email account is doing right now (`GET /notifications/settings`). */
export const EMAIL_CONNECTION_STATES = ["none", "disabled", "failed", "connected"] as const;
export type EmailConnectionState = (typeof EMAIL_CONNECTION_STATES)[number];

export function isEmailConnectionState(value: unknown): value is EmailConnectionState {
  return (
    typeof value === "string" && (EMAIL_CONNECTION_STATES as readonly string[]).includes(value)
  );
}

/** The document the page edits; the API takes it as one document. */
export interface NotificationSettingsValues {
  /**
   * Kept by the server, validated, but no longer edited here: the From address is the email
   * account's. It is sent back exactly as it was read.
   */
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
  /** The From address of the store's email account; null while none is connected. */
  readonly effectiveEmail: string | null;
  /** A free-mail address (Gmail, Yahoo...) cannot send through an API provider such as Resend. */
  readonly freeMail: boolean;
}

/** What the page shows: `GET /notifications/settings`, and what a save answers with. */
export interface NotificationSettingsSnapshot {
  readonly values: NotificationSettingsValues;
  /** The version a save must send back; null while the shop has never saved any (no row yet). */
  readonly version: number | null;
  /** True only while the store has a connected, switched-on email account (D46). */
  readonly deliveryConfigured: boolean;
  /** none | disabled | failed | connected: so the banner can say which. */
  readonly emailConnection: EmailConnectionState;
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

/** The email providers a store can connect: a Resend API key, or its own mailbox over SMTP. */
export const EMAIL_CONNECTION_KINDS = ["resend", "smtp"] as const;
export type EmailConnectionKind = (typeof EMAIL_CONNECTION_KINDS)[number];

/**
 * Every provider the picker lists, in order. `kind` is what the server can connect; `null` means
 * "Coming soon" (shown, disabled). `needsSmtp` marks a provider that also needs the server's
 * `EMAIL_SMTP_ENABLED` switch (`smtpAvailable` on the account): without it the option is disabled
 * and says "Needs a server upgrade". Adding a provider is a change to this list plus its
 * `EMAIL_CONNECTION_KINDS` entry, never to the component. Brand names are not translated.
 */
export interface EmailProviderChoice {
  readonly id: string;
  readonly label: string;
  readonly kind: EmailConnectionKind | null;
  readonly needsSmtp: boolean;
}

export const EMAIL_PROVIDER_CHOICES: readonly EmailProviderChoice[] = [
  { id: "resend", label: "Resend", kind: "resend", needsSmtp: false },
  { id: "smtp", label: "Gmail / other mailbox (SMTP)", kind: "smtp", needsSmtp: true },
  { id: "sendgrid", label: "SendGrid", kind: null, needsSmtp: false },
  { id: "brevo", label: "Brevo", kind: null, needsSmtp: false },
];

export function isEmailConnectionKind(value: unknown): value is EmailConnectionKind {
  return typeof value === "string" && (EMAIL_CONNECTION_KINDS as readonly string[]).includes(value);
}

export const SMTP_PRESET_IDS = ["gmail", "outlook", "zoho", "custom"] as const;
export type SmtpPresetId = (typeof SMTP_PRESET_IDS)[number];
export type SmtpSecurity = "tls" | "starttls";

export function isSmtpPresetId(value: unknown): value is SmtpPresetId {
  return typeof value === "string" && (SMTP_PRESET_IDS as readonly string[]).includes(value);
}

export function isSmtpSecurity(value: unknown): value is SmtpSecurity {
  return value === "tls" || value === "starttls";
}

/**
 * The mailbox presets, mirroring the server's (it is the authority: it pins the server for a preset
 * and ignores what we send). `host` is null for "other mail server": the person types it. Brand
 * names are not translated.
 */
export interface SmtpPresetChoice {
  readonly id: SmtpPresetId;
  readonly label: string | null;
  readonly host: string | null;
  readonly port: number | null;
  readonly security: SmtpSecurity | null;
  /** The From address must be the mailbox itself (the server refuses anything else for a preset). */
  readonly fromIsUsername: boolean;
}

export const SMTP_PRESET_CHOICES: readonly SmtpPresetChoice[] = [
  {
    id: "gmail",
    label: "Gmail",
    host: "smtp.gmail.com",
    port: 465,
    security: "tls",
    fromIsUsername: true,
  },
  {
    id: "outlook",
    label: "Outlook / Hotmail",
    host: "smtp-mail.outlook.com",
    port: 587,
    security: "starttls",
    fromIsUsername: true,
  },
  {
    id: "zoho",
    label: "Zoho Mail",
    host: "smtp.zoho.com",
    port: 465,
    security: "tls",
    fromIsUsername: true,
  },
  { id: "custom", label: null, host: null, port: null, security: null, fromIsUsername: false },
];

/** The ports a custom mail server may use: the SMTP submission ports (the server checks this too). */
export const CUSTOM_SMTP_PORTS: readonly number[] = [25, 465, 587, 2525];

/** The fixed failure a mailbox can report; the page words each one itself, in both languages. */
export const SMTP_ERROR_CODES = [
  "AUTH_FAILED",
  "DAILY_LIMIT",
  "CONNECTION_FAILED",
  "TLS_FAILED",
  "REJECTED",
] as const;
export type SmtpErrorCode = (typeof SMTP_ERROR_CODES)[number];

export function isSmtpErrorCode(value: unknown): value is SmtpErrorCode {
  return typeof value === "string" && (SMTP_ERROR_CODES as readonly string[]).includes(value);
}

/** Where a mailbox connection goes and as whom. Never the password. */
export interface SmtpConnectionDto {
  readonly preset: SmtpPresetId;
  readonly host: string;
  readonly port: number;
  readonly security: SmtpSecurity;
  readonly username: string;
}

/** What the page sends for a mailbox: the preset and username; a custom server adds its own details. */
export interface EmailSaveSmtp {
  readonly preset: SmtpPresetId;
  readonly username: string;
  readonly host?: string;
  readonly port?: number;
  readonly security?: SmtpSecurity;
}

/** The store's own email account as the server shows it. Never the key: only its last four. */
export interface EmailConnectionDto {
  readonly kind: EmailConnectionKind;
  readonly fromEmail: string;
  readonly secretLast4: string;
  readonly enabled: boolean;
  /** The result of the last test send. */
  readonly status: "connected" | "failed";
  readonly state: EmailConnectionState;
  /** The provider's refusal, sanitized by the server (no addresses, no keys). */
  readonly lastError: string | null;
  /** A mailbox's fixed failure, so the page can use its own sentence; null for anything else. */
  readonly lastErrorCode: SmtpErrorCode | null;
  readonly lastErrorAt: string | null;
  readonly verifiedAt: string | null;
  readonly version: number;
  /** Mailbox (SMTP) connections only; null for Resend. */
  readonly smtp: SmtpConnectionDto | null;
}

/** `GET /notifications/email-connection` and what every write answers with. */
export interface EmailConnectionSnapshot {
  /** false: the server cannot store keys, so the page says "Not available yet". */
  readonly credentialsConfigured: boolean;
  /** false: the server's `EMAIL_SMTP_ENABLED` is off, so mailbox accounts say "Needs a server upgrade". */
  readonly smtpAvailable: boolean;
  /** null while the store has not connected an email account. */
  readonly connection: EmailConnectionDto | null;
}

/** The state banners and warnings go by: no account at all is `none`. */
export function connectionStateOf(snapshot: EmailConnectionSnapshot): EmailConnectionState {
  return snapshot.connection?.state ?? "none";
}

/** What an email-account action answers with. A refused test mail is still `success` (status failed). */
export type EmailConnectionActionResult =
  | { readonly status: "success"; readonly snapshot: EmailConnectionSnapshot }
  | { readonly status: "unavailable" }
  | { readonly status: "rate_limited" }
  | { readonly status: "conflict"; readonly message: string }
  | {
      readonly status: "error";
      readonly message: string;
      readonly fieldErrors: Readonly<Record<string, string>>;
    };

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

import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";
import { isValidEmail, normalizeEmail } from "./sender-resolution";

/**
 * Wave 2b2 (D46-D49): a store's customer mail is sent ONLY through the merchant's own email account.
 * This is the domain side of that connection: kinds, statuses, validation and the one sanitizer every
 * provider message passes through before it is stored or shown.
 */

export const EMAIL_CONNECTION_KINDS = ["resend", "smtp"] as const;
export type EmailConnectionKind = (typeof EMAIL_CONNECTION_KINDS)[number];

export const EMAIL_CONNECTION_STATUSES = ["connected", "failed"] as const;
export type EmailConnectionStatus = (typeof EMAIL_CONNECTION_STATUSES)[number];

export function isEmailConnectionKind(value: unknown): value is EmailConnectionKind {
  return typeof value === "string" && (EMAIL_CONNECTION_KINDS as readonly string[]).includes(value);
}

export function isEmailConnectionStatus(value: unknown): value is EmailConnectionStatus {
  return (
    typeof value === "string" && (EMAIL_CONNECTION_STATUSES as readonly string[]).includes(value)
  );
}

/** What is stored per store. `sealedCredentials` is the vault's output: the key is never in clear. */
export interface StoredEmailConnection {
  readonly kind: EmailConnectionKind;
  readonly fromEmail: string;
  readonly sealedCredentials: string;
  /** The last four characters of the key: the only part of it that is ever shown. */
  readonly secretLast4: string;
  readonly enabled: boolean;
  readonly status: EmailConnectionStatus;
  /** A sanitized provider message: no address, no body, no key. */
  readonly lastError: string | null;
  readonly lastErrorAt: Date | null;
  readonly verifiedAt: Date | null;
  readonly version: number;
}

/** Mail goes out only through a connection that is switched on AND passed its last test. */
export function isUsableConnection(
  connection: StoredEmailConnection | null,
): connection is StoredEmailConnection {
  return connection !== null && connection.enabled && connection.status === "connected";
}

export type ConnectionState = "none" | "disabled" | "failed" | "connected";

export function connectionState(connection: StoredEmailConnection | null): ConnectionState {
  if (connection === null) return "none";
  if (!connection.enabled) return "disabled";
  return connection.status === "connected" ? "connected" : "failed";
}

/** Resend keys: `re_` then URL-safe characters. A length floor catches pasted fragments. */
const RESEND_KEY_PATTERN = /^re_[A-Za-z0-9_-]{16,128}$/;

export function isValidApiKey(kind: EmailConnectionKind, apiKey: string): boolean {
  switch (kind) {
    case "resend":
      return RESEND_KEY_PATTERN.test(apiKey);
    case "smtp":
      return isValidSmtpPassword(apiKey);
  }
}

/** The part of the secret that may be shown: the last four of an API key; nothing of a password. */
export function secretLast4(secret: string, kind: EmailConnectionKind = "resend"): string {
  return kind === "smtp" ? "" : secret.slice(-4);
}

// ---------------------------------------------------------------------------------------------
// SMTP (Wave 2b2 Task 3, D52)
// ---------------------------------------------------------------------------------------------

export const SMTP_SECURITIES = ["tls", "starttls"] as const;
export type SmtpSecurity = (typeof SMTP_SECURITIES)[number];

export const SMTP_PRESET_KEYS = ["gmail", "outlook", "zoho", "custom"] as const;
export type SmtpPreset = (typeof SMTP_PRESET_KEYS)[number];

/** What is stored next to the sealed secret: where to connect and as whom (never the password). */
export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  readonly security: SmtpSecurity;
  readonly username: string;
}

interface FixedPreset {
  readonly host: string;
  readonly port: number;
  readonly security: SmtpSecurity;
}

/** The presets pin host, port and security; the user only types a mailbox and an app password. */
export const SMTP_PRESETS: Readonly<Record<Exclude<SmtpPreset, "custom">, FixedPreset>> = {
  gmail: { host: "smtp.gmail.com", port: 465, security: "tls" },
  outlook: { host: "smtp-mail.outlook.com", port: 587, security: "starttls" },
  zoho: { host: "smtp.zoho.com", port: 465, security: "tls" },
};

/** Ports a custom server may use: the SMTP submission ports. Anything else is not a mail server. */
export const CUSTOM_SMTP_PORTS: readonly number[] = [25, 465, 587, 2525];

export function isSmtpPreset(value: unknown): value is SmtpPreset {
  return typeof value === "string" && (SMTP_PRESET_KEYS as readonly string[]).includes(value);
}

export function isSmtpSecurity(value: unknown): value is SmtpSecurity {
  return typeof value === "string" && (SMTP_SECURITIES as readonly string[]).includes(value);
}

/** Which preset these settings are (`custom` when none matches). */
export function presetOf(settings: Pick<SmtpSettings, "host" | "port" | "security">): SmtpPreset {
  for (const key of ["gmail", "outlook", "zoho"] as const) {
    const preset = SMTP_PRESETS[key];
    if (
      preset.host === settings.host &&
      preset.port === settings.port &&
      preset.security === settings.security
    ) {
      return key;
    }
  }
  return "custom";
}

const HOSTNAME_PATTERN =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** A real DNS name: at least one dot, letters in the last label. No IP literals, no `localhost`. */
export function isValidSmtpHost(host: string): boolean {
  return HOSTNAME_PATTERN.test(host);
}

export const SMTP_ERROR_CODES = [
  "AUTH_FAILED",
  "DAILY_LIMIT",
  "CONNECTION_FAILED",
  "TLS_FAILED",
  "REJECTED",
] as const;
export type SmtpErrorCode = (typeof SMTP_ERROR_CODES)[number];

/** The code at the front of a stored SMTP `last_error` (`CODE: sentence`), or null. */
export function smtpErrorCodeOf(lastError: string | null): SmtpErrorCode | null {
  if (lastError === null) return null;
  const code = /^([A-Z_]+): /.exec(lastError)?.[1];
  return SMTP_ERROR_CODES.find((candidate) => candidate === code) ?? null;
}

// eslint-disable-next-line no-control-regex
const HAS_CONTROL = /[\u0000-\u001F\u007F]/;

function isValidSmtpPassword(password: string): boolean {
  return password.length >= 1 && password.length <= 256 && !HAS_CONTROL.test(password);
}

export function smtpSecrets(
  settings: SmtpSettings,
  password: string,
): Readonly<Record<string, string>> {
  return {
    host: settings.host,
    port: String(settings.port),
    security: settings.security,
    username: settings.username,
    password,
  };
}

/** Reads sealed SMTP secrets back into settings plus password; null for anything malformed. */
export function readSmtpSecrets(
  secrets: Readonly<Record<string, string>>,
): { readonly settings: SmtpSettings; readonly password: string } | null {
  const { host, port, security, username, password } = secrets;
  const portNumber = Number(port);
  if (
    typeof host !== "string" ||
    host === "" ||
    typeof username !== "string" ||
    username === "" ||
    typeof password !== "string" ||
    password === "" ||
    !Number.isInteger(portNumber) ||
    portNumber < 1 ||
    portNumber > 65535 ||
    !isSmtpSecurity(security)
  ) {
    return null;
  }
  return { settings: { host, port: portNumber, security, username }, password };
}

export interface EmailConnectionDraft {
  readonly kind: EmailConnectionKind;
  readonly fromEmail: string;
  /** The secret: the Resend API key, or the SMTP password. null = keep the stored one. */
  readonly apiKey: string | null;
  /** Present exactly when `kind` is `smtp`. */
  readonly smtp: SmtpSettings | null;
}

type Issue = { readonly field: string; readonly message: string };

function validateSmtp(input: unknown, fromEmail: string, issues: Issue[]): SmtpSettings | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    issues.push({ field: "smtp", message: "choose a mailbox provider" });
    return null;
  }
  const raw = input as Record<string, unknown>;
  if (!isSmtpPreset(raw["preset"])) {
    issues.push({ field: "smtp.preset", message: "choose a mailbox provider" });
    return null;
  }
  const preset = raw["preset"];
  const username = typeof raw["username"] === "string" ? raw["username"].trim() : "";
  let usernameOk = true;
  if (username === "") {
    issues.push({ field: "smtp.username", message: "must not be empty" });
    usernameOk = false;
  } else if (username.length > 254 || HAS_CONTROL.test(username) || /\s/.test(username)) {
    issues.push({ field: "smtp.username", message: "doesn't look like a username" });
    usernameOk = false;
  }

  let host: string;
  let port: number;
  let security: SmtpSecurity;
  let serverOk = true;
  if (preset === "custom") {
    host = typeof raw["host"] === "string" ? raw["host"].trim().toLowerCase() : "";
    if (!isValidSmtpHost(host)) {
      issues.push({
        field: "smtp.host",
        message: "must be a mail server name like smtp.example.com",
      });
      serverOk = false;
    }
    const rawPort = raw["port"];
    port = typeof rawPort === "number" && Number.isInteger(rawPort) ? rawPort : 0;
    if (!CUSTOM_SMTP_PORTS.includes(port)) {
      issues.push({ field: "smtp.port", message: "must be 25, 465, 587 or 2525" });
      serverOk = false;
    }
    if (isSmtpSecurity(raw["security"])) {
      security = raw["security"];
    } else {
      issues.push({ field: "smtp.security", message: "choose a connection security" });
      security = "tls";
      serverOk = false;
    }
  } else {
    // A preset decides the server: anything else the request carried about it is ignored.
    ({ host, port, security } = SMTP_PRESETS[preset]);
    if (usernameOk && fromEmail !== "" && username.toLowerCase() !== fromEmail.toLowerCase()) {
      issues.push({
        field: "fromEmail",
        message: "must be the same address as the mailbox username",
      });
    }
  }
  return usernameOk && serverOk ? { host, port, security, username } : null;
}

/** Structure is zod's job; the rules are here. Never echoes the key or password in a message. */
export function validateEmailConnectionDraft(input: {
  readonly kind: unknown;
  readonly fromEmail: unknown;
  readonly apiKey: unknown;
  readonly smtp?: unknown;
  readonly password?: unknown;
}): Result<EmailConnectionDraft, ValidationError> {
  const issues: Issue[] = [];
  if (!isEmailConnectionKind(input.kind)) {
    issues.push({ field: "kind", message: "unsupported email provider" });
  }
  let fromEmail = "";
  if (typeof input.fromEmail !== "string" || input.fromEmail.trim() === "") {
    issues.push({ field: "fromEmail", message: "must not be empty" });
  } else if (!isValidEmail(input.fromEmail)) {
    issues.push({ field: "fromEmail", message: "must be a valid email address" });
  } else {
    fromEmail = normalizeEmail(input.fromEmail);
  }

  let apiKey: string | null = null;
  let smtp: SmtpSettings | null = null;
  if (input.kind === "smtp") {
    smtp = validateSmtp(input.smtp, fromEmail, issues);
    const password = input.password;
    if (password !== null && password !== undefined && password !== "") {
      if (typeof password !== "string") {
        issues.push({ field: "password", message: "must be text" });
      } else {
        // Google shows app passwords in groups of four: the spaces are not part of it.
        const cleaned =
          smtp !== null && presetOf(smtp) === "gmail"
            ? password.replace(/\s+/g, "")
            : password.trim();
        if (isValidSmtpPassword(cleaned)) apiKey = cleaned;
        else issues.push({ field: "password", message: "doesn't look like a valid password" });
      }
    }
  } else {
    if (input.smtp !== undefined && input.smtp !== null) {
      issues.push({ field: "smtp", message: "is only used for a mailbox (SMTP) account" });
    }
    if (input.apiKey !== null && input.apiKey !== undefined && input.apiKey !== "") {
      if (typeof input.apiKey !== "string") {
        issues.push({ field: "apiKey", message: "must be text" });
      } else {
        apiKey = input.apiKey.trim();
        if (isEmailConnectionKind(input.kind) && !isValidApiKey(input.kind, apiKey)) {
          issues.push({ field: "apiKey", message: "doesn't look like a Resend API key" });
        }
      }
    }
  }
  if (issues.length > 0) {
    return err(new ValidationError("Invalid email account", [...issues]));
  }
  return ok({ kind: input.kind as EmailConnectionKind, fromEmail, apiKey, smtp });
}

const MAX_ERROR_LENGTH = 200;

/**
 * Makes a provider's own text safe to store and show: no control characters, no key-looking token,
 * no email address (a recipient could be echoed), no secret we hold, bounded length. An empty result
 * becomes the fallback.
 */
export function sanitizeProviderMessage(
  raw: unknown,
  fallback: string,
  secrets: readonly string[] = [],
): string {
  if (typeof raw !== "string") return fallback;
  let text = raw;
  for (const secret of secrets) {
    if (secret.length >= 4) text = text.split(secret).join("[hidden]");
  }
  text = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\bre_[A-Za-z0-9_-]{8,}/g, "[hidden]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[hidden]")
    .replace(/[^\s<>"',;()]+@[^\s<>"',;()]+/g, "[address]")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") return fallback;
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH - 1)}…` : text;
}

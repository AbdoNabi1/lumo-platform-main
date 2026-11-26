import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";
import { isValidEmail, normalizeEmail } from "./sender-resolution";

/**
 * Wave 2b2 (D46-D49): a store's customer mail is sent ONLY through the merchant's own email account.
 * This is the domain side of that connection: kinds, statuses, validation and the one sanitizer every
 * provider message passes through before it is stored or shown.
 */

export const EMAIL_CONNECTION_KINDS = ["resend"] as const;
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
  }
}

export function secretLast4(apiKey: string): string {
  return apiKey.slice(-4);
}

export interface EmailConnectionDraft {
  readonly kind: EmailConnectionKind;
  readonly fromEmail: string;
  /** null = keep the stored key (only allowed when the store already has one of the same kind). */
  readonly apiKey: string | null;
}

type Issue = { readonly field: string; readonly message: string };

/** Structure is zod's job; the rules are here. Never echoes the key in a message. */
export function validateEmailConnectionDraft(input: {
  readonly kind: unknown;
  readonly fromEmail: unknown;
  readonly apiKey: unknown;
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
  if (issues.length > 0) {
    return err(new ValidationError("Invalid email account", [...issues]));
  }
  return ok({ kind: input.kind as EmailConnectionKind, fromEmail, apiKey });
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

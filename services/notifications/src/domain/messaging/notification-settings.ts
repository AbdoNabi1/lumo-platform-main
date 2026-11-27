import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";
import { isValidEmail, normalizeEmail } from "./sender-resolution";
import { isTemplateKey, TEMPLATE_KEYS, isTemplateLocale } from "./template-catalogue";

/**
 * Wave 2b: the shop's notification settings. One row per tenant; a shop that never saved any gets the
 * defaults: no explicit sender (the store contact email is used), no staff recipients, every template on.
 */

export const MAX_STAFF_RECIPIENTS = 10;
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 20_000;
export const SETTINGS_STALE_MESSAGE = "These settings were changed by someone else";

export interface NotificationSettingsValues {
  /** The merchant's Sender email; null = use the store contact email. */
  readonly senderEmail: string | null;
  /** Who gets "New order" (the merchant's own addresses). */
  readonly staffRecipients: readonly string[];
  /** Template keys that are switched off. */
  readonly disabledTemplates: readonly string[];
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettingsValues = Object.freeze({
  senderEmail: null,
  staffRecipients: [],
  disabledTemplates: [],
});

export interface StoredNotificationSettings {
  readonly values: NotificationSettingsValues;
  readonly version: number;
}

export function effectiveNotificationSettings(
  stored: StoredNotificationSettings | null,
): NotificationSettingsValues {
  return stored === null ? DEFAULT_NOTIFICATION_SETTINGS : stored.values;
}

type Issue = { readonly field: string; readonly message: string };

function fail(issues: readonly Issue[]): Result<never, ValidationError> {
  return err(new ValidationError("Invalid notification settings", [...issues]));
}

/** Checks the whole settings document (structure is zod's job; the rules are here). */
export function validateNotificationSettings(
  input: unknown,
): Result<NotificationSettingsValues, ValidationError> {
  if (typeof input !== "object" || input === null) {
    return fail([{ field: "settings", message: "must be an object" }]);
  }
  const raw = input as Record<string, unknown>;
  const issues: Issue[] = [];

  let senderEmail: string | null = null;
  if (raw["senderEmail"] !== null && raw["senderEmail"] !== undefined) {
    if (typeof raw["senderEmail"] !== "string") {
      issues.push({ field: "senderEmail", message: "must be an email address" });
    } else if (raw["senderEmail"].trim() !== "") {
      if (!isValidEmail(raw["senderEmail"])) {
        issues.push({ field: "senderEmail", message: "must be a valid email address" });
      } else {
        senderEmail = normalizeEmail(raw["senderEmail"]);
      }
    }
  }

  const staffRecipients: string[] = [];
  const recipients = raw["staffRecipients"];
  if (!Array.isArray(recipients)) {
    issues.push({ field: "staffRecipients", message: "must be a list of email addresses" });
  } else {
    if (recipients.length > MAX_STAFF_RECIPIENTS) {
      issues.push({
        field: "staffRecipients",
        message: `at most ${MAX_STAFF_RECIPIENTS} recipients`,
      });
    }
    for (const entry of recipients) {
      if (typeof entry !== "string" || !isValidEmail(entry)) {
        issues.push({ field: "staffRecipients", message: "every recipient must be a valid email" });
        break;
      }
      const email = normalizeEmail(entry);
      if (!staffRecipients.includes(email)) staffRecipients.push(email);
    }
  }

  const disabledTemplates: string[] = [];
  const disabled = raw["disabledTemplates"];
  if (!Array.isArray(disabled)) {
    issues.push({ field: "disabledTemplates", message: "must be a list of template keys" });
  } else {
    for (const entry of disabled) {
      if (!isTemplateKey(entry)) {
        issues.push({ field: "disabledTemplates", message: "unknown template" });
        break;
      }
      if (!disabledTemplates.includes(entry)) disabledTemplates.push(entry);
    }
  }

  if (issues.length > 0) return fail(issues);
  disabledTemplates.sort(
    (a, b) => TEMPLATE_KEYS.indexOf(a as never) - TEMPLATE_KEYS.indexOf(b as never),
  );
  return ok({ senderEmail, staffRecipients, disabledTemplates });
}

export interface TemplateCopyInput {
  readonly subject: unknown;
  readonly body: unknown;
}

/** A merchant's subject and body: non-empty, bounded, the subject on one line. */
export function validateTemplateCopy(
  input: TemplateCopyInput,
): Result<{ readonly subject: string; readonly body: string }, ValidationError> {
  const issues: Issue[] = [];
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const body = typeof input.body === "string" ? input.body.replace(/\r\n?/g, "\n").trim() : "";
  if (subject === "") issues.push({ field: "subject", message: "must not be empty" });
  else if (subject.length > MAX_SUBJECT_LENGTH) {
    issues.push({ field: "subject", message: `at most ${MAX_SUBJECT_LENGTH} characters` });
  } else if (/[\r\n]/.test(subject)) {
    issues.push({ field: "subject", message: "must be a single line" });
  }
  if (body === "") issues.push({ field: "body", message: "must not be empty" });
  else if (body.length > MAX_BODY_LENGTH) {
    issues.push({ field: "body", message: `at most ${MAX_BODY_LENGTH} characters` });
  }
  if (issues.length > 0) return fail(issues);
  return ok({ subject, body });
}

/** Refuses an unknown template key or locale with a 422 naming the field. */
export function validateTemplateRef(
  key: unknown,
  locale: unknown,
): Result<
  { readonly key: (typeof TEMPLATE_KEYS)[number]; readonly locale: "en" | "ar" },
  ValidationError
> {
  const issues: Issue[] = [];
  if (!isTemplateKey(key)) issues.push({ field: "key", message: "unknown template" });
  if (locale !== undefined && !isTemplateLocale(locale)) {
    issues.push({ field: "locale", message: "must be en or ar" });
  }
  if (issues.length > 0) return fail(issues);
  return ok({
    key: key as (typeof TEMPLATE_KEYS)[number],
    locale: (locale ?? "en") as "en" | "ar",
  });
}

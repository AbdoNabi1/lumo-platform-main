"use server";

import { startSenderDomain, verifySenderDomain } from "@/lib/api/notification-settings";
import { currentDictionary, runDomainAction, savePatch } from "@/lib/notification-settings-actions";
import {
  isTemplateKey,
  isPlausibleEmail,
  MAX_STAFF_RECIPIENTS,
  normalizeEmail,
  type NotificationSettingsPatch,
  type NotificationSettingsSaveResult,
  type SenderDomainActionResult,
} from "@/lib/notification-settings-model";

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** The edit a card sends: a client call is untrusted, so anything unexpected is refused, never guessed. */
function parsePatch(value: unknown): NotificationSettingsPatch | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const patch: {
    senderEmail?: string | null;
    staffRecipients?: readonly string[];
    disabledTemplates?: readonly string[];
  } = {};
  for (const field of Object.keys(raw)) {
    if (!["senderEmail", "staffRecipients", "disabledTemplates"].includes(field)) return null;
  }
  if ("senderEmail" in raw) {
    const email = raw["senderEmail"];
    if (email !== null && typeof email !== "string") return null;
    // Blank means "use the store email"; anything else must look like an address.
    if (typeof email === "string" && email.trim() !== "" && !isPlausibleEmail(email)) return null;
    patch.senderEmail =
      typeof email === "string" && email.trim() !== "" ? normalizeEmail(email) : null;
  }
  if ("staffRecipients" in raw) {
    const list = raw["staffRecipients"];
    if (!isStringList(list) || list.length > MAX_STAFF_RECIPIENTS) return null;
    if (!list.every(isPlausibleEmail)) return null;
    patch.staffRecipients = [...new Set(list.map(normalizeEmail))];
  }
  if ("disabledTemplates" in raw) {
    const list = raw["disabledTemplates"];
    if (!isStringList(list) || !list.every(isTemplateKey)) return null;
    patch.disabledTemplates = [...new Set(list)];
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

function parseVersion(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined;
}

/**
 * Settings > Notifications. Saves one part of the document (the sender email, the template
 * switches or the staff recipients) with the version the page loaded; the other parts are read
 * fresh and sent back unchanged. A malformed call is refused before it reaches the API.
 */
export async function saveNotificationSettingsAction(
  input: unknown,
): Promise<NotificationSettingsSaveResult> {
  const dictionary = await currentDictionary();
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const expectedVersion = parseVersion(raw["expectedVersion"]);
  const patch = parsePatch(raw["patch"]);
  if (expectedVersion === undefined || patch === null) {
    return { status: "error", message: dictionary.formErrors.invalid, fieldErrors: {} };
  }
  return savePatch(patch, expectedVersion, dictionary);
}

/** "Authenticate domain": registers the sender email's domain and returns the DNS records to add. */
export async function startSenderDomainAction(): Promise<SenderDomainActionResult> {
  return runDomainAction(startSenderDomain, await currentDictionary());
}

/** "Verify": asks the provider to check the DNS records. */
export async function verifySenderDomainAction(): Promise<SenderDomainActionResult> {
  return runDomainAction(verifySenderDomain, await currentDictionary());
}

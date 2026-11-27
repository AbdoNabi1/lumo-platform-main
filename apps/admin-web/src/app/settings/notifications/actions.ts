"use server";

import {
  currentDictionary,
  runEmailDisconnect,
  runEmailEnabled,
  runEmailSave,
  runEmailTest,
  savePatch,
} from "@/lib/notification-settings-actions";
import {
  isPlausibleEmail,
  isTemplateKey,
  MAX_STAFF_RECIPIENTS,
  normalizeEmail,
  type EmailConnectionActionResult,
  type NotificationSettingsPatch,
  type NotificationSettingsSaveResult,
} from "@/lib/notification-settings-model";

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * The edit a card sends: a client call is untrusted, so anything unexpected is refused, never
 * guessed. The sender email is no longer editable here (the From address belongs to the email
 * account), so it is not an accepted field.
 */
function parsePatch(value: unknown): NotificationSettingsPatch | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const patch: {
    staffRecipients?: readonly string[];
    disabledTemplates?: readonly string[];
  } = {};
  for (const field of Object.keys(raw)) {
    if (!["staffRecipients", "disabledTemplates"].includes(field)) return null;
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
 * Settings > Notifications. Saves one part of the document (the template switches or the staff
 * recipients) with the version the page loaded; the other parts are read fresh and sent back
 * unchanged. A malformed call is refused before it reaches the API.
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

/**
 * "Save" on the Email account card: connects the store's own account (or updates it) and sends a
 * test email to the signed-in member. `{ kind, fromEmail, apiKey?, expectedVersion }`; an empty
 * key keeps the stored one.
 */
export async function saveEmailConnectionAction(
  input: unknown,
): Promise<EmailConnectionActionResult> {
  return runEmailSave(input, await currentDictionary());
}

/** The on/off switch: `{ enabled, expectedVersion }`. */
export async function setEmailConnectionEnabledAction(
  input: unknown,
): Promise<EmailConnectionActionResult> {
  return runEmailEnabled(input, await currentDictionary());
}

/** "Send test": a test email to the signed-in member's own address. */
export async function testEmailConnectionAction(): Promise<EmailConnectionActionResult> {
  return runEmailTest(await currentDictionary());
}

/** "Disconnect": removes the email account and its stored key. */
export async function disconnectEmailConnectionAction(): Promise<EmailConnectionActionResult> {
  return runEmailDisconnect(await currentDictionary());
}

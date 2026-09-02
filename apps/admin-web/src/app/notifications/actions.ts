"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  advanceNotification,
  createNotification,
  queueNotification,
  recordNotificationCallback,
  retryNotification,
  sendNotification,
} from "@/lib/api/notifications";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.11a — the Notifications screens' write actions (`app/notifications/new/page.tsx`,
 * `app/notifications/[notificationId]/page.tsx`). Same shape every write action in this app
 * follows (`apps/admin-web/README.md`'s recipe): parse `FormData` defensively (never trust a
 * hidden field or a closure variable — re-derive `notificationId` from the submission itself),
 * mint exactly one idempotency key per submit, call the typed `lib/api/notifications.ts` function,
 * and project any non-`ok` outcome through `toFormState`.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function stringFieldValues(formData: FormData, name: string): readonly string[] {
  return formData.getAll(name).map((value) => (typeof value === "string" ? value : ""));
}

/** Empty string -> `undefined` (an omitted optional zod field), not a validation failure. */
function optionalStringField(formData: FormData, name: string): string | undefined {
  const value = stringField(formData, name).trim();
  return value.length === 0 ? undefined : value;
}

function parseVariableRows(formData: FormData): Readonly<Record<string, string>> {
  const names = stringFieldValues(formData, "variablesKey");
  const values = stringFieldValues(formData, "variablesValue");
  const record: Record<string, string> = {};
  for (let index = 0; index < names.length; index += 1) {
    const name = (names[index] ?? "").trim();
    if (name.length === 0) continue;
    record[name] = values[index] ?? "";
  }
  return record;
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

/** Both screens that show one notification's data. */
function revalidateNotificationScreens(notificationId: string): void {
  revalidatePath("/notifications");
  revalidatePath(`/notifications/${notificationId}`);
}

/** Creates a notification (`NotificationCreateForm`, `app/notifications/new/page.tsx`). */
export async function createNotificationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const sourceRef = stringField(formData, "sourceRef");
  const recipientRef = stringField(formData, "recipientRef");
  const channelsRaw = stringField(formData, "channels");
  const templateId = stringField(formData, "templateId");
  const bodyPattern = stringField(formData, "bodyPattern");
  const subjectPattern = optionalStringField(formData, "subjectPattern");
  const maxAttemptsRaw = stringField(formData, "maxAttempts");
  const expiresAt = optionalStringField(formData, "expiresAt");

  const channels = channelsRaw
    .split(",")
    .map((channel) => channel.trim())
    .filter((channel) => channel.length > 0);
  const maxAttempts = Number.parseInt(maxAttemptsRaw, 10);

  const fieldErrors: Record<string, string> = {};
  if (sourceRef.length === 0) fieldErrors["sourceRef"] = t.invalid;
  if (recipientRef.length === 0) fieldErrors["recipientRef"] = t.invalid;
  if (channels.length === 0) fieldErrors["channels"] = t.invalid;
  if (templateId.length === 0) fieldErrors["templateId"] = t.invalid;
  if (bodyPattern.length === 0) fieldErrors["bodyPattern"] = t.invalid;
  if (Number.isNaN(maxAttempts) || maxAttempts <= 0) fieldErrors["maxAttempts"] = t.invalid;
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const variables = parseVariableRows(formData);

  const result = await createNotification(
    {
      sourceRef,
      recipientRef,
      channels,
      templateId,
      bodyPattern,
      subjectPattern,
      variables,
      maxAttempts,
      expiresAt,
    },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/notifications");
    redirect(`/notifications/${result.data.id}`);
  }
  return toFormState(result, t);
}

/** `created` -> `queued` (`QueueForm`, offered only at `created`). */
export async function queueNotificationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const notificationId = stringField(formData, "notificationId");
  if (notificationId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await queueNotification(notificationId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateNotificationScreens(notificationId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** `queued`/`retrying` -> `sent` (`SendForm`) — **not** idempotent, no key minted. */
export async function sendNotificationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const notificationId = stringField(formData, "notificationId");
  if (notificationId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await sendNotification(notificationId);
  if (result.outcome === "ok") {
    revalidateNotificationScreens(notificationId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** `failed` -> `retrying` (`RetryForm`, offered only at `failed`). */
export async function retryNotificationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const notificationId = stringField(formData, "notificationId");
  if (notificationId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await retryNotification(notificationId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateNotificationScreens(notificationId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Advances the notification via the generic transitions route (`AdvanceForm`) — the fallback for
 * whatever `lib/notification-lifecycle.ts`'s `advanceableNotificationStatusesFrom` reports as
 * residual at the current status.
 */
export async function advanceNotificationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const notificationId = stringField(formData, "notificationId");
  const toStatus = stringField(formData, "toStatus");
  if (notificationId.length === 0 || toStatus.length === 0) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: toStatus.length === 0 ? { toStatus: t.invalid } : {},
    };
  }

  const result = await advanceNotification(notificationId, toStatus, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateNotificationScreens(notificationId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Records a provider callback (`CallbackForm`) — **not** idempotent, no key minted. Normally
 * provider-initiated; offered here mostly for completeness/testing, per the task brief.
 */
export async function recordNotificationCallbackAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const notificationId = stringField(formData, "notificationId");
  const provider = stringField(formData, "provider");
  const callbackId = stringField(formData, "callbackId");
  const kind = stringField(formData, "kind");
  if (
    notificationId.length === 0 ||
    provider.length === 0 ||
    callbackId.length === 0 ||
    kind.length === 0
  ) {
    const fieldErrors: Record<string, string> = {};
    if (provider.length === 0) fieldErrors["provider"] = t.invalid;
    if (callbackId.length === 0) fieldErrors["callbackId"] = t.invalid;
    if (kind.length === 0) fieldErrors["kind"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await recordNotificationCallback(notificationId, { provider, callbackId, kind });
  if (result.outcome === "ok") {
    revalidateNotificationScreens(notificationId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

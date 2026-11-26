"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { AlertTriangleIcon } from "lucide-react";
import {
  connectionStateOf,
  type EmailConnectionSnapshot,
  type EmailConnectionState,
  type NotificationSettingsSnapshot,
  type TemplateDto,
} from "@/lib/notification-settings-model";
import type { Dictionary } from "@/messages/en";
import { CustomerNotificationsCard } from "./customer-notifications-card";
import { EmailAccountCard } from "./email-account-card";
import { StaffNotificationsCard } from "./staff-notifications-card";

/** Same rule as the settings document: only a different version (or a different shape) replaces local state. */
function sameConnection(a: EmailConnectionSnapshot | null, b: EmailConnectionSnapshot | null) {
  if (a === null || b === null) return a === b;
  return (
    a.credentialsConfigured === b.credentialsConfigured &&
    a.connection?.version === b.connection?.version
  );
}

/**
 * Settings > Notifications. The cards edit ONE document, so they share its version here: a save in
 * one card moves the version for the others, and a newer version from the server (someone else
 * saved; a reload) replaces what the cards show. The Email account is its own record with its own
 * version, also held here so the banner above it tells the truth the moment it changes.
 */
export function NotificationSettingsPanel({
  settings,
  templates,
  emailConnection,
  t,
}: {
  readonly settings: NotificationSettingsSnapshot;
  readonly templates: readonly TemplateDto[];
  /** null when the account could not be read: the card then says so instead of guessing. */
  readonly emailConnection: EmailConnectionSnapshot | null;
  readonly t: Dictionary;
}) {
  const copy = t.notificationSettings;
  const [document, setDocument] = useState(settings);
  const [seen, setSeen] = useState(settings);
  const [email, setEmail] = useState(emailConnection);
  const [seenEmail, setSeenEmail] = useState(emailConnection);

  if (settings !== seen) {
    setSeen(settings);
    if (settings.version !== document.version) setDocument(settings);
  }
  if (emailConnection !== seenEmail) {
    setSeenEmail(emailConnection);
    if (!sameConnection(emailConnection, email)) setEmail(emailConnection);
  }

  // The banner follows the live account; when it could not be read, the settings' own summary.
  const emailState: EmailConnectionState =
    email === null ? settings.emailConnection : connectionStateOf(email);
  const bannerText =
    emailState === "connected"
      ? null
      : emailState === "disabled"
        ? copy.deliveryOffDisabled
        : emailState === "failed"
          ? copy.deliveryOffFailed
          : copy.deliveryOff;

  const onSaved = useCallback((next: NotificationSettingsSnapshot) => setDocument(next), []);

  return (
    <div className="flex flex-col gap-4">
      {bannerText !== null && (
        <div
          role="status"
          className="border-border bg-warning-subtle text-warning-foreground flex items-start gap-2 rounded-lg border p-3 text-sm"
        >
          <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>{bannerText}</p>
        </div>
      )}

      <EmailAccountCard email={email} onChange={setEmail} t={t} />
      <CustomerNotificationsCard
        document={document}
        templates={templates}
        onSaved={onSaved}
        t={t}
      />
      <StaffNotificationsCard document={document} templates={templates} onSaved={onSaved} t={t} />

      <p className="text-muted-foreground text-sm">
        <Link href="/notifications" className="text-foreground font-medium hover:underline">
          {copy.deliveryLogLink}
        </Link>
        {" — "}
        {copy.deliveryLogHint}
      </p>
    </div>
  );
}

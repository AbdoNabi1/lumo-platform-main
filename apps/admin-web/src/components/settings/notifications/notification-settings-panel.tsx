"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { AlertTriangleIcon } from "lucide-react";
import type {
  NotificationSettingsSnapshot,
  SenderDomainDto,
  TemplateDto,
} from "@/lib/notification-settings-model";
import type { Dictionary } from "@/messages/en";
import { CustomerNotificationsCard } from "./customer-notifications-card";
import { SenderDomainCard } from "./sender-domain-card";
import { SenderEmailCard } from "./sender-email-card";
import { StaffNotificationsCard } from "./staff-notifications-card";

/**
 * Settings > Notifications. The cards edit ONE document, so they share its version here: a save in
 * one card moves the version for the others, and a newer version from the server (someone else
 * saved; a reload) replaces what the cards show.
 */
export function NotificationSettingsPanel({
  settings,
  templates,
  senderDomain,
  t,
}: {
  readonly settings: NotificationSettingsSnapshot;
  readonly templates: readonly TemplateDto[];
  /** null when the domain state could not be read: the card then says so instead of guessing. */
  readonly senderDomain: SenderDomainDto | null;
  readonly t: Dictionary;
}) {
  const copy = t.notificationSettings;
  const [document, setDocument] = useState(settings);
  const [seen, setSeen] = useState(settings);

  if (settings !== seen) {
    setSeen(settings);
    if (settings.version !== document.version) setDocument(settings);
  }

  const onSaved = useCallback((next: NotificationSettingsSnapshot) => setDocument(next), []);

  return (
    <div className="flex flex-col gap-4">
      {!document.deliveryConfigured && (
        <div
          role="status"
          className="border-border bg-warning-subtle text-warning-foreground flex items-start gap-2 rounded-lg border p-3 text-sm"
        >
          <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>{copy.deliveryOff}</p>
        </div>
      )}

      <SenderEmailCard document={document} onSaved={onSaved} t={t} />
      <SenderDomainCard senderDomain={senderDomain} t={t} />
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

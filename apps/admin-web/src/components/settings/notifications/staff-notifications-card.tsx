"use client";

import { useState } from "react";
import { XIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@platform/ui";
import { Field } from "@/components/products/editor/field";
import {
  isPlausibleEmail,
  MAX_STAFF_RECIPIENTS,
  normalizeEmail,
  type NotificationSettingsSnapshot,
  type TemplateDto,
} from "@/lib/notification-settings-model";
import type { Dictionary } from "@/messages/en";
import { fillText } from "./bdi-text";
import { TemplateRow } from "./customer-notifications-card";
import { useSettingsSave } from "./use-settings-save";

/**
 * Staff notifications: "New order" goes to the recipients listed here (up to ten). Adding or
 * removing an address saves at once, with the version the page loaded.
 */
export function StaffNotificationsCard({
  document,
  templates,
  onSaved,
  t,
}: {
  readonly document: NotificationSettingsSnapshot;
  readonly templates: readonly TemplateDto[];
  readonly onSaved: (settings: NotificationSettingsSnapshot) => void;
  readonly t: Dictionary;
}) {
  const copy = t.notificationSettings;
  const saver = useSettingsSave(document, onSaved, t.formErrors.unexpected);
  const [typed, setTyped] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const staff = templates.filter((template) => template.audience === "staff");
  const recipients = document.values.staffRecipients;
  const error = localError ?? saver.fieldErrors["staffRecipients"];

  const add = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const value = typed.trim();
    if (!isPlausibleEmail(value)) {
      setLocalError(copy.recipientInvalid);
      return;
    }
    const email = normalizeEmail(value);
    if (recipients.includes(email)) {
      setLocalError(copy.recipientDuplicate);
      return;
    }
    if (recipients.length >= MAX_STAFF_RECIPIENTS) {
      setLocalError(fillText(copy.recipientsFull, { max: String(MAX_STAFF_RECIPIENTS) }));
      return;
    }
    setLocalError(null);
    if (await saver.save({ staffRecipients: [...recipients, email] })) setTyped("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.staffTitle}</CardTitle>
        <p className="text-muted-foreground text-sm">{copy.staffHint}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="divide-border divide-y">
          {staff.map((template) => (
            <TemplateRow
              key={template.key}
              template={template}
              document={document}
              saver={saver}
              t={t}
            />
          ))}
        </ul>

        <section aria-label={copy.recipientsLabel} className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">{copy.recipientsLabel}</h3>
          {recipients.length === 0 ? (
            <p className="text-muted-foreground text-sm">{copy.recipientsEmpty}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {recipients.map((email) => (
                <li
                  key={email}
                  className="border-border flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm"
                >
                  <bdi dir="auto">{email}</bdi>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={fillText(copy.recipientRemove, { email })}
                    disabled={saver.pending}
                    onClick={() => {
                      setLocalError(null);
                      void saver.save({
                        staffRecipients: recipients.filter((current) => current !== email),
                      });
                    }}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <form
            onSubmit={(event) => void add(event)}
            noValidate
            className="flex flex-wrap items-start gap-2"
          >
            <Field label={copy.recipientLabel} name="staffRecipient" error={error}>
              {(control) => (
                <Input
                  {...control}
                  type="email"
                  dir="ltr"
                  autoComplete="off"
                  className="w-72 max-w-full text-start"
                  value={typed}
                  onChange={(event) => {
                    setTyped(event.target.value);
                    setLocalError(null);
                  }}
                />
              )}
            </Field>
            <Button
              type="submit"
              variant="outline"
              className="mt-6"
              loading={saver.pending}
              disabled={saver.pending}
            >
              {copy.recipientAdd}
            </Button>
          </form>
        </section>

        {saver.error !== null && (
          <p role="alert" className="text-destructive text-sm">
            {saver.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

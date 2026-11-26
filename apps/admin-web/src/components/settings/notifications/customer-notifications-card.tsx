"use client";

import Link from "next/link";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { Switch } from "@/components/products/editor/controls";
import type { NotificationSettingsSnapshot, TemplateDto } from "@/lib/notification-settings-model";
import type { Dictionary } from "@/messages/en";
import { fillText } from "./bdi-text";
import { useSettingsSave } from "./use-settings-save";

/** The switch and the Edit link of one template: shared by the customer list and the staff card. */
export function TemplateRow({
  template,
  document,
  saver,
  t,
}: {
  readonly template: TemplateDto;
  readonly document: NotificationSettingsSnapshot;
  readonly saver: ReturnType<typeof useSettingsSave>;
  readonly t: Dictionary;
}) {
  const copy = t.notificationSettings;
  const name = copy.templateNames[template.key];
  const enabled = !document.values.disabledTemplates.includes(template.key);
  const customized = template.locales.en.customized || template.locales.ar.customized;

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {name}
          {customized && <Badge variant="accent">{copy.customized}</Badge>}
        </p>
        <p className="text-muted-foreground text-sm">{copy.templateHints[template.key]}</p>
      </div>
      <Switch
        label={enabled ? copy.templateOn : copy.templateOff}
        aria-label={fillText(copy.toggleLabel, { name })}
        checked={enabled}
        disabled={saver.pending}
        onCheckedChange={(on) => {
          const without = document.values.disabledTemplates.filter((key) => key !== template.key);
          void saver.save({ disabledTemplates: on ? without : [...without, template.key] });
        }}
      />
      <Link
        href={`/settings/notifications/${template.key}`}
        aria-label={`${copy.edit}: ${name}`}
        className="text-foreground text-sm font-medium hover:underline"
      >
        {copy.edit}
      </Link>
    </li>
  );
}

/** Customer notifications: every email a customer can get, with an on/off switch and Edit. */
export function CustomerNotificationsCard({
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
  const customer = templates.filter((template) => template.audience === "customer");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.customerTitle}</CardTitle>
        <p className="text-muted-foreground text-sm">{copy.customerHint}</p>
      </CardHeader>
      <CardContent>
        <ul className="divide-border divide-y">
          {customer.map((template) => (
            <TemplateRow
              key={template.key}
              template={template}
              document={document}
              saver={saver}
              t={t}
            />
          ))}
        </ul>
        {saver.error !== null && (
          <p role="alert" className="text-destructive mt-3 text-sm">
            {saver.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

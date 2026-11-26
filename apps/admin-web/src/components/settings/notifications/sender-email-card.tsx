"use client";

import { useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@platform/ui";
import { Field } from "@/components/products/editor/field";
import {
  isPlausibleEmail,
  normalizeEmail,
  type NotificationSettingsSnapshot,
} from "@/lib/notification-settings-model";
import type { Dictionary } from "@/messages/en";
import { BdiText } from "./bdi-text";
import { useSettingsSave } from "./use-settings-save";

function typedOf(document: NotificationSettingsSnapshot): string {
  return document.values.senderEmail ?? "";
}

/** The status sentence under the input: who customers see, and where replies go. */
function SenderStatus({
  document,
  t,
}: {
  readonly document: NotificationSettingsSnapshot;
  readonly t: Dictionary;
}) {
  const copy = t.notificationSettings;
  const { sender, storeName } = document;
  if (sender.mode === "own_domain" && sender.effectiveEmail !== null) {
    return (
      <BdiText template={copy.senderStatusOwnDomain} values={{ email: sender.effectiveEmail }} />
    );
  }
  if (sender.mode === "reply_to" && sender.effectiveEmail !== null) {
    return (
      <BdiText
        template={copy.senderStatusReplyTo}
        values={{ store: storeName, email: sender.effectiveEmail }}
      />
    );
  }
  return <BdiText template={copy.senderStatusNone} values={{ store: storeName }} />;
}

/**
 * Sender email (Shopify's first section): the address customers reply to, and the one emails come
 * from once its domain is authenticated. Blank means the store's contact email. A free-mail address
 * (Gmail, Hotmail, Yahoo) can never be the literal From, and the note says so.
 */
export function SenderEmailCard({
  document,
  onSaved,
  t,
}: {
  readonly document: NotificationSettingsSnapshot;
  readonly onSaved: (settings: NotificationSettingsSnapshot) => void;
  readonly t: Dictionary;
}) {
  const copy = t.notificationSettings;
  const saver = useSettingsSave(document, onSaved, t.formErrors.unexpected);
  const [typed, setTyped] = useState(() => typedOf(document));
  const [seenVersion, setSeenVersion] = useState(document.version);
  const [localError, setLocalError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // A newer version (someone else saved; a reload) replaces what is typed.
  if (document.version !== seenVersion) {
    setSeenVersion(document.version);
    setTyped(typedOf(document));
  }

  const dirty = normalizeEmail(typed) !== normalizeEmail(typedOf(document));
  const error = localError ?? saver.fieldErrors["senderEmail"];

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setJustSaved(false);
    const value = typed.trim();
    if (value !== "" && !isPlausibleEmail(value)) {
      setLocalError(copy.senderInvalid);
      return;
    }
    setLocalError(null);
    const ok = await saver.save({ senderEmail: value === "" ? null : normalizeEmail(value) });
    setJustSaved(ok);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.senderTitle}</CardTitle>
        <p className="text-muted-foreground text-sm">{copy.senderHint}</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-3">
          <Field
            label={copy.senderLabel}
            name="senderEmail"
            error={error}
            hint={copy.senderBlankHint}
          >
            {(control) => (
              <Input
                {...control}
                type="email"
                dir="ltr"
                autoComplete="off"
                placeholder={document.contactEmail ?? ""}
                className="max-w-md text-start"
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value);
                  setLocalError(null);
                  setJustSaved(false);
                }}
              />
            )}
          </Field>

          <p data-testid="sender-status" className="text-sm">
            <SenderStatus document={document} t={t} />
          </p>
          {document.sender.freeMail && (
            <p className="text-muted-foreground text-sm">{copy.senderFreeMail}</p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {saver.error !== null && (
              <p role="alert" className="text-destructive me-auto text-sm">
                {saver.error}
              </p>
            )}
            {justSaved && !dirty && saver.error === null && (
              <p role="status" className="text-muted-foreground me-auto text-sm">
                {copy.saved}
              </p>
            )}
            {dirty && <span className="text-muted-foreground text-sm">{copy.unsaved}</span>}
            <Button type="submit" loading={saver.pending} disabled={!dirty || saver.pending}>
              {saver.pending ? copy.saving : copy.save}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

"use client";

import { useState } from "react";
import { ExternalLinkIcon, FileTextIcon } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import {
  policyPath,
  RICH_TEXT_MAX,
  type LocalizedText,
  type PolicyType,
} from "@platform/storefront-content";
import { savePolicyAction, type PolicySaveState } from "@/app/settings/policies/actions";
import type { PolicyDto, PolicyTemplateInputsDto } from "@/lib/api/online-store";
import { formatLongDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { settleAction } from "@/lib/online-store/settle-action";
import type { Dictionary } from "@/messages/en";
import { PolicyTemplateDialog } from "./policy-template-dialog";
import { RichTextEditor } from "./rich-text-editor";
import { SaveStatus } from "./save-status";

/**
 * One store policy (spec 2.3, 2.7): whether it is set and when it last changed, a link to it on the
 * store, and its text in the Morbeh editor. **Create from template** fills the chosen language
 * (asking first when that tab already has text) and shows the "not legal advice" reminder until
 * the next save. **Save** sends the text with the version the card holds, and takes the new one
 * from the answer, so the next save is guarded too. A viewer sees it read-only.
 */
export function PolicyCard({
  t,
  locale,
  type,
  title,
  policy,
  set,
  canEdit,
  defaults,
  storefrontUrl,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly type: PolicyType;
  readonly title: string;
  readonly policy: PolicyDto;
  readonly set: boolean;
  readonly canEdit: boolean;
  readonly defaults: PolicyTemplateInputsDto;
  readonly storefrontUrl: string | null;
}) {
  const p = t.policies;
  const [body, setBody] = useState<LocalizedText>(policy.body);
  const [version, setVersion] = useState(policy.version);
  // A newer version from a server refresh is adopted (review M-7); a late, older one never wins.
  const [seenVersion, setSeenVersion] = useState(policy.version);
  if (seenVersion !== policy.version) {
    setSeenVersion(policy.version);
    setVersion(Math.max(version, policy.version));
  }
  const [tab, setTab] = useState<"ar" | "en">(locale);
  const [dialog, setDialog] = useState<{ open: boolean; key: number }>({ open: false, key: 0 });
  const [reminder, setReminder] = useState(false);
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<PolicySaveState>({ status: "idle" });
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  const onGenerated = (language: "ar" | "en", text: string) => {
    const existing = body[language] ?? "";
    if (existing.trim() !== "" && !window.confirm(p.replaceConfirm)) return;
    setBody((before) => ({ ...before, [language]: text }));
    setTab(language);
    setReminder(true);
    setState({ status: "idle" });
  };

  const save = async () => {
    setPending(true);
    setState({ status: "idle" });
    try {
      const result = await settleAction(
        () => savePolicyAction(type, { body, expectedVersion: version }),
        { status: "error", message: t.formErrors.unexpected, fieldErrors: {} },
      );
      if (result.status === "success") {
        if (result.version !== undefined) setVersion(result.version);
        setReminder(false);
      }
      setState(result);
    } finally {
      setPending(false);
    }
  };

  const base = storefrontUrl?.replace(/\/+$/, "") ?? "";
  const editorName = "body";

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <FileTextIcon aria-hidden="true" className="text-muted-foreground size-4" />
            <CardTitle as="h2" className="text-base">
              {title}
            </CardTitle>
            <Badge variant={set ? "success" : "neutral"}>{set ? p.set : p.notSet}</Badge>
          </div>
          {policy.updatedAt === null ? null : (
            <p className="text-muted-foreground text-xs">
              {p.lastUpdated.replace("{date}", formatLongDate(locale, policy.updatedAt))}
            </p>
          )}
        </div>
        {set && base !== "" ? (
          <a
            href={`${base}${policyPath(type)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
          >
            {p.viewOnStore}
            <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
          </a>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {reminder ? (
          <p
            role="note"
            className="bg-warning-subtle text-warning-foreground rounded-xl px-3 py-2 text-sm"
          >
            {p.reminder}
          </p>
        ) : null}
        <RichTextEditor
          t={t}
          locale={locale}
          name={editorName}
          label={p.body}
          value={body}
          max={RICH_TEXT_MAX.body}
          disabled={!canEdit || pending}
          errors={fieldErrors}
          onChange={setBody}
          tab={tab}
          onTabChange={setTab}
          previewBase={storefrontUrl}
        />
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" loading={pending} disabled={pending} onClick={() => void save()}>
              {pending ? t.onlineStorePreferences.saving : t.onlineStorePreferences.save}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setDialog((before) => ({ open: true, key: before.key + 1 }))}
            >
              {p.createFromTemplate}
            </Button>
            <SaveStatus t={t} state={state} />
          </div>
        ) : null}
        {canEdit ? (
          <PolicyTemplateDialog
            key={dialog.key}
            t={t}
            locale={locale}
            type={type}
            defaults={defaults}
            open={dialog.open}
            initialLocale={tab}
            onOpenChange={(open) => setDialog((before) => ({ ...before, open }))}
            onGenerated={onGenerated}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

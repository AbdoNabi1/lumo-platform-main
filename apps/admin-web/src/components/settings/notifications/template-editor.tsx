"use client";

import { useRef, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Textarea,
} from "@platform/ui";
import {
  previewTemplateAction,
  revertTemplateAction,
  saveTemplateAction,
  sendTestEmailAction,
} from "@/app/settings/notifications/[key]/actions";
import { Field } from "@/components/products/editor/field";
import {
  insertVariable,
  TEMPLATE_LOCALES,
  type PreviewDto,
  type TemplateDto,
  type TemplateLocale,
} from "@/lib/notification-settings-model";
import type { Dictionary } from "@/messages/en";
import { fillText } from "./bdi-text";

interface Copy {
  readonly subject: string;
  readonly body: string;
}

interface SavedCopy extends Copy {
  readonly customized: boolean;
}

type Target = "subject" | "body";

type PreviewState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly preview: PreviewDto }
  | { readonly status: "error"; readonly message: string };

const NO_ERRORS: Readonly<Record<string, string>> = {};

/**
 * Edits one template, one language at a time: subject, message, the variables the server allows as
 * chips that insert `{{name}}` at the caret, a server-rendered Preview in a sandboxed frame, "Send
 * test to me" (always to your own address), and "Revert to default" behind a confirm dialog.
 */
export function TemplateEditor({
  template,
  initialLocale,
  t,
}: {
  readonly template: TemplateDto;
  readonly initialLocale: TemplateLocale;
  readonly t: Dictionary;
}) {
  const copy = t.notificationSettings.editor;
  const name = t.notificationSettings.templateNames[template.key];
  const [locale, setLocale] = useState<TemplateLocale>(initialLocale);
  const [saved, setSaved] = useState<Record<TemplateLocale, SavedCopy>>(() => ({
    en: { ...template.locales.en },
    ar: { ...template.locales.ar },
  }));
  const [drafts, setDrafts] = useState<Record<TemplateLocale, Copy>>(() => ({
    en: { subject: template.locales.en.subject, body: template.locales.en.body },
    ar: { subject: template.locales.ar.subject, body: template.locales.ar.body },
  }));
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState(NO_ERRORS);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastTarget = useRef<Target>("body");
  const cancelRef = useRef<HTMLButtonElement>(null);

  const draft = drafts[locale];
  const current = saved[locale];
  const dirty = draft.subject !== current.subject || draft.body !== current.body;
  const languageName = copy.languageNames[locale];

  const edit = (patch: Partial<Copy>) => {
    setDrafts((all) => ({ ...all, [locale]: { ...all[locale], ...patch } }));
    setJustSaved(false);
    setPreview({ status: "idle" });
    setTestMessage(null);
  };

  const insert = (variable: string) => {
    const target = lastTarget.current;
    const element = target === "subject" ? subjectRef.current : bodyRef.current;
    const text = draft[target];
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    const next = insertVariable(text, start, end, variable);
    edit({ [target]: next.text });
    // The caret goes right after the inserted token once React has put the new text in the box.
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(next.caret, next.caret);
    });
  };

  const switchLocale = (next: TemplateLocale) => {
    setLocale(next);
    setPreview({ status: "idle" });
    setTestMessage(null);
    setJustSaved(false);
    setError(null);
    setFieldErrors(NO_ERRORS);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setFieldErrors(NO_ERRORS);
    try {
      const result = await saveTemplateAction({ key: template.key, locale, ...draft });
      if (result.status === "success") {
        const own = result.template.locales[locale];
        setSaved((all) => ({ ...all, [locale]: { ...own } }));
        setJustSaved(true);
      } else {
        setError(result.message);
        setFieldErrors(result.fieldErrors);
      }
    } catch {
      setError(t.formErrors.unexpected);
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async () => {
    setPreview({ status: "loading" });
    try {
      const result = await previewTemplateAction({ key: template.key, locale, ...draft });
      setPreview(
        result.status === "success"
          ? { status: "ready", preview: result.preview }
          : { status: "error", message: result.message },
      );
      if (result.status === "error") setFieldErrors(result.fieldErrors);
    } catch {
      setPreview({ status: "error", message: t.formErrors.unexpected });
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestMessage(null);
    try {
      const result = await sendTestEmailAction({ key: template.key, locale, ...draft });
      switch (result.status) {
        case "sent":
          setTestMessage({ ok: true, text: copy.testSentOwn });
          break;
        case "unavailable":
          setTestMessage({ ok: false, text: copy.testUnavailable });
          break;
        case "rate_limited":
          setTestMessage({ ok: false, text: copy.testRateLimited });
          break;
        case "error":
          setTestMessage({ ok: false, text: result.message });
          break;
      }
    } catch {
      setTestMessage({ ok: false, text: t.formErrors.unexpected });
    } finally {
      setTesting(false);
    }
  };

  const revert = async () => {
    setReverting(true);
    setRevertError(null);
    try {
      const result = await revertTemplateAction({ key: template.key, locale });
      if (result.status === "success") {
        const own = result.template.locales[locale];
        setSaved((all) => ({ ...all, [locale]: { ...own } }));
        setDrafts((all) => ({ ...all, [locale]: { subject: own.subject, body: own.body } }));
        setPreview({ status: "idle" });
        setJustSaved(false);
        setConfirmOpen(false);
      } else {
        setRevertError(result.message);
      }
    } catch {
      setRevertError(t.formErrors.unexpected);
    } finally {
      setReverting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label={copy.languagesLabel} className="flex flex-wrap gap-2">
        {TEMPLATE_LOCALES.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={option === locale ? "primary" : "outline"}
            aria-pressed={option === locale}
            onClick={() => switchLocale(option)}
          >
            {copy.languageNames[option]}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{name}</CardTitle>
          <p className="text-muted-foreground text-sm">
            {current.customized ? copy.usingCustom : copy.usingDefault}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label={copy.subjectLabel} name="subject" error={fieldErrors["subject"]}>
            {(control) => (
              <Input
                {...control}
                ref={subjectRef}
                dir={locale === "ar" ? "rtl" : "ltr"}
                value={draft.subject}
                onFocus={() => {
                  lastTarget.current = "subject";
                }}
                onChange={(event) => edit({ subject: event.target.value })}
              />
            )}
          </Field>
          <Field label={copy.bodyLabel} name="body" error={fieldErrors["body"]}>
            {(control) => (
              <Textarea
                {...control}
                ref={bodyRef}
                rows={12}
                dir={locale === "ar" ? "rtl" : "ltr"}
                value={draft.body}
                onFocus={() => {
                  lastTarget.current = "body";
                }}
                onChange={(event) => edit({ body: event.target.value })}
              />
            )}
          </Field>

          <section aria-label={copy.variablesTitle} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{copy.variablesTitle}</h3>
            <p className="text-muted-foreground text-sm">{copy.variablesHint}</p>
            <ul className="flex flex-wrap gap-2">
              {template.variables.map((variable) => (
                <li key={variable.name}>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={fillText(copy.insertVariable, { name: variable.name })}
                    onClick={() => insert(variable.name)}
                  >
                    <bdi dir="ltr">{`{{${variable.name}}}`}</bdi>
                  </Button>
                </li>
              ))}
            </ul>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            {error !== null && (
              <p role="alert" className="text-destructive me-auto text-sm">
                {error}
              </p>
            )}
            {justSaved && !dirty && error === null && (
              <p role="status" className="text-muted-foreground me-auto text-sm">
                {copy.saved}
              </p>
            )}
            {dirty && <span className="text-muted-foreground text-sm">{copy.unsaved}</span>}

            <Dialog
              open={confirmOpen}
              onOpenChange={(next) => {
                // The trigger stays on the page (so focus has somewhere to return to) but only
                // opens the dialog when there is a saved copy to revert.
                if (next && !current.customized) return;
                setConfirmOpen(next);
                if (!next) setRevertError(null);
              }}
            >
              <DialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  aria-disabled={!current.customized}
                  className={current.customized ? undefined : "opacity-50"}
                >
                  {copy.revert}
                </Button>
              </DialogTrigger>
              <DialogContent
                onOpenAutoFocus={(event) => {
                  event.preventDefault();
                  cancelRef.current?.focus();
                }}
              >
                <DialogHeader>
                  <DialogTitle>{copy.revertTitle}</DialogTitle>
                  <DialogDescription>
                    {fillText(copy.revertBody, { language: languageName })}
                  </DialogDescription>
                </DialogHeader>
                {revertError !== null && (
                  <p role="alert" className="text-destructive text-sm">
                    {revertError}
                  </p>
                )}
                <DialogFooter>
                  <Button
                    ref={cancelRef}
                    type="button"
                    variant="outline"
                    onClick={() => setConfirmOpen(false)}
                  >
                    {copy.cancel}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    loading={reverting}
                    disabled={reverting}
                    onClick={() => void revert()}
                  >
                    {reverting ? copy.reverting : copy.revertConfirm}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button
              type="button"
              loading={saving}
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {saving ? copy.saving : copy.save}
            </Button>
          </div>
          {!confirmOpen && revertError !== null && (
            <p role="alert" className="text-destructive text-sm">
              {revertError}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.previewTitle}</CardTitle>
          <p className="text-muted-foreground text-sm">{copy.previewNote}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              loading={preview.status === "loading"}
              disabled={preview.status === "loading"}
              onClick={() => void runPreview()}
            >
              {preview.status === "loading" ? copy.previewing : copy.preview}
            </Button>
            <Button
              type="button"
              variant="outline"
              loading={testing}
              disabled={testing}
              onClick={() => void runTest()}
            >
              {testing ? copy.testing : copy.testButton}
            </Button>
            <span className="text-muted-foreground text-sm">{copy.testHint}</span>
          </div>

          {testMessage !== null && (
            <p
              role={testMessage.ok ? "status" : "alert"}
              className={testMessage.ok ? "text-sm" : "text-destructive text-sm"}
            >
              {testMessage.text}
            </p>
          )}

          {preview.status === "error" && (
            <p role="alert" className="text-destructive text-sm">
              {preview.message}
            </p>
          )}

          {preview.status === "ready" && (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                {fillText(copy.previewSubject, { subject: preview.preview.subject })}
              </p>
              {preview.preview.unknownVariables.length > 0 && (
                <p role="status" className="text-warning-foreground text-sm">
                  {fillText(copy.unknownVariables, {
                    names: preview.preview.unknownVariables.map((v) => `{{${v}}}`).join(", "),
                  })}
                </p>
              )}
              {/* The server renders this HTML. `sandbox=""` blocks scripts, forms, popups and
                  same-origin access, so it can never touch the admin page. */}
              <iframe
                title={copy.previewFrameTitle}
                sandbox=""
                srcDoc={preview.preview.html}
                className="border-border h-96 w-full rounded-md border bg-white"
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon, Trash2Icon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  NativeSelect,
  Textarea,
} from "@platform/ui";
import {
  createTemplateAction,
  type CreateTemplateState,
} from "@/app/settings/whatsapp/templates/actions";
import type { TemplateDraftBody } from "@/lib/api/outreach";
import {
  bodyVariableCount,
  FORM_LIMITS,
  nextVariableToken,
  parseVariables,
  slugifyLabel,
  TEMPLATE_LANGUAGES,
  validateTemplateDraft,
  type TemplateCategory,
} from "@/lib/outreach/template-rules";
import { languageLabel, templateIssueMessage } from "@/lib/outreach/templates";
import { newClientKey } from "@/lib/outreach/whatsapp";
import type { Dictionary } from "@/messages/en";
import { BrandText } from "./brand-text";
import { TemplatePreview } from "./template-preview";

/**
 * The new-template form. It mirrors the Task 2 rules in the browser (`lib/outreach/template-rules.ts`) for instant
 * feedback; the API stays authoritative and its 422 issue codes map to the same copy.
 *
 * Submission identity: the form makes ONE idempotency key per submission. A transport failure (the answer was lost)
 * leaves the submission UNRESOLVED: the form keeps the exact payload and key, locks every field, and "Submit again"
 * sends that same request, so it can never create a second template. A definitive answer (submitted, a 422 or a
 * refusal) releases the lock and the next submission gets a new key.
 */

interface UrlButton {
  text: string;
  url: string;
  example: string;
}

type Group = "name" | "language" | "category" | "header" | "body" | "footer" | "buttons";

/** The input group an issue's field belongs to (`buttons[1].url` → `buttons`). */
function groupOf(field: string): Group {
  if (field.startsWith("header")) return "header";
  if (field.startsWith("body")) return "body";
  if (field.startsWith("footer")) return "footer";
  if (field.startsWith("buttons")) return "buttons";
  if (field === "language" || field === "category") return field;
  return "name";
}

const URL_VARIABLE = /\{\{1\}\}$/;

interface Submission {
  readonly payload: TemplateDraftBody;
  readonly key: string;
}

export function TemplateForm({ t, locale }: { readonly t: Dictionary; readonly locale: string }) {
  const copy = t.whatsappTemplates.form;
  const router = useRouter();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [holder] = useState(() => ({ key: newClientKey() }));
  const inFlight = useRef(false);

  const [label, setLabel] = useState("");
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [language, setLanguage] = useState(locale === "ar" ? "ar" : "en");
  const [category, setCategory] = useState<TemplateCategory>("UTILITY");
  const [header, setHeader] = useState("");
  const [headerExample, setHeaderExample] = useState("");
  const [body, setBody] = useState("");
  const [examples, setExamples] = useState<readonly string[]>([]);
  const [footer, setFooter] = useState("");
  const [quickReplies, setQuickReplies] = useState<readonly string[]>([]);
  const [urlButtons, setUrlButtons] = useState<readonly UrlButton[]>([]);

  const [touched, setTouched] = useState<ReadonlySet<Group>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Readonly<Record<string, string>>>({});
  const [outcome, setOutcome] = useState<CreateTemplateState | null>(null);
  const [unresolved, setUnresolved] = useState<Submission | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const variableCount = bodyVariableCount(body);
  const exampleValues = Array.from({ length: variableCount }, (_, i) => examples[i] ?? "");
  const headerHasVariable = parseVariables(header).indices.length > 0;

  const draft: TemplateDraftBody = {
    name,
    language,
    category,
    ...(header.length > 0
      ? {
          header: {
            format: "TEXT" as const,
            text: header,
            ...(headerHasVariable ? { example: headerExample } : {}),
          },
        }
      : {}),
    body: { text: body, examples: exampleValues },
    ...(footer.length > 0 ? { footer: { text: footer } } : {}),
    ...(quickReplies.length + urlButtons.length > 0
      ? {
          buttons: [
            ...quickReplies.map((text) => ({ type: "QUICK_REPLY" as const, text })),
            ...urlButtons.map((button) => ({
              type: "URL" as const,
              text: button.text,
              url: button.url,
              ...(URL_VARIABLE.test(button.url) ? { example: button.example } : {}),
            })),
          ],
        }
      : {}),
  };
  const issues = validateTemplateDraft(draft);

  function touch(group: Group) {
    setTouched((previous) => (previous.has(group) ? previous : new Set(previous).add(group)));
    // A server message about a group goes away once the merchant edits that group.
    setServerErrors((previous) => {
      const remaining = Object.entries(previous).filter(([field]) => groupOf(field) !== group);
      return remaining.length === Object.keys(previous).length
        ? previous
        : Object.fromEntries(remaining);
    });
    setOutcome((previous) => (previous?.status === "invalid" ? null : previous));
  }

  /** Every message for one input group: local issues first, then what the API said (never the same twice). */
  function messages(group: Group): readonly string[] {
    const shown = attempted || touched.has(group);
    const local = shown
      ? issues.filter((issue) => groupOf(issue.field) === group).map((issue) => issue.code)
      : [];
    const out = local.map((code) => templateIssueMessage(code, t));
    for (const [field, message] of Object.entries(serverErrors)) {
      if (groupOf(field) === group && !out.includes(message)) out.push(message);
    }
    return Array.from(new Set(out));
  }

  const locked = unresolved !== null || pending || done;

  function changeLabel(next: string) {
    setLabel(next);
    if (!nameEdited) setName(slugifyLabel(next));
    touch("name");
  }

  function addVariable() {
    const token = nextVariableToken(body);
    const element = bodyRef.current;
    const start = element?.selectionStart ?? body.length;
    const end = element?.selectionEnd ?? body.length;
    const next = `${body.slice(0, start)}${token}${body.slice(end)}`;
    setBody(next);
    touch("body");
    const caret = start + token.length;
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(caret, caret);
    });
  }

  function send(submission: Submission) {
    inFlight.current = true;
    setUnresolved(submission);
    setOutcome(null);
    startTransition(async () => {
      let result: CreateTemplateState;
      try {
        result = await createTemplateAction({
          draft: submission.payload,
          idempotencyKey: submission.key,
        });
      } catch {
        result = { status: "error", message: t.whatsappTemplates.errors.generic };
      } finally {
        inFlight.current = false;
      }
      setOutcome(result);
      if (result.status === "error") return; // unresolved: same payload, same key, locked
      setUnresolved(null);
      holder.key = newClientKey(); // a definitive answer: the next submission is a new one
      if (result.status === "success") {
        setDone(true);
        router.push("/settings/whatsapp/templates");
      } else if (result.status === "invalid") {
        setServerErrors(result.fieldErrors);
      }
    });
  }

  function submit() {
    if (inFlight.current || pending || done) return;
    if (unresolved !== null) {
      send(unresolved); // retry the exact request that was lost
      return;
    }
    setAttempted(true);
    if (issues.length > 0) return;
    send({ payload: draft, key: holder.key });
  }

  const nameMessages = messages("name");
  const languageMessages = messages("language");
  const headerMessages = messages("header");
  const bodyMessages = messages("body");
  const footerMessages = messages("footer");
  const buttonMessages = messages("buttons");

  const errorList = (list: readonly string[], id: string) =>
    list.length > 0 && (
      <ul id={id} className="text-destructive flex flex-col gap-0.5 text-sm">
        {list.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    );

  const previewValues = {
    header,
    headerExample,
    body,
    examples: exampleValues,
    footer,
    buttons: [...quickReplies, ...urlButtons.map((b) => b.text)],
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <form
        className="flex flex-col gap-6"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={locked} className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">{copy.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <p className="text-muted-foreground text-sm">
                <BrandText text={copy.description} />
              </p>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="template-label">{copy.label}</Label>
                <Input
                  id="template-label"
                  dir="auto"
                  className="text-start"
                  value={label}
                  onChange={(event) => changeLabel(event.target.value)}
                />
                <p className="text-muted-foreground text-sm">{copy.labelHint}</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="template-name">{copy.name}</Label>
                <Input
                  id="template-name"
                  dir="ltr"
                  className="text-start"
                  autoComplete="off"
                  spellCheck={false}
                  value={name}
                  aria-invalid={nameMessages.length > 0}
                  aria-describedby="template-name-hint template-name-errors"
                  onChange={(event) => {
                    setName(event.target.value);
                    setNameEdited(true);
                    touch("name");
                  }}
                />
                <p id="template-name-hint" className="text-muted-foreground text-sm">
                  {copy.nameHint}
                  {name.length > 0 && (
                    <>
                      {" "}
                      {copy.finalName} <bdi dir="ltr">{name}</bdi>
                    </>
                  )}
                </p>
                {errorList(nameMessages, "template-name-errors")}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="template-language">{copy.language}</Label>
                <NativeSelect
                  id="template-language"
                  value={language}
                  aria-invalid={languageMessages.length > 0}
                  onChange={(event) => {
                    setLanguage(event.target.value);
                    touch("language");
                  }}
                >
                  {TEMPLATE_LANGUAGES.map((code) => (
                    <option key={code} value={code}>
                      {languageLabel(code, t)}
                    </option>
                  ))}
                </NativeSelect>
                {errorList(languageMessages, "template-language-errors")}
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">{copy.category}</legend>
                {(
                  [
                    ["UTILITY", copy.categoryUtility, copy.categoryUtilityHint],
                    ["MARKETING", copy.categoryMarketing, copy.categoryMarketingHint],
                  ] as const
                ).map(([value, title, hint]) => (
                  <label
                    key={value}
                    htmlFor={`template-category-${value}`}
                    className="border-border grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-3 rounded-xl border p-3"
                  >
                    <input
                      id={`template-category-${value}`}
                      type="radio"
                      name="template-category"
                      value={value}
                      className="accent-primary row-span-2 mt-1 size-4"
                      checked={category === value}
                      onChange={() => {
                        setCategory(value);
                        touch("category");
                      }}
                    />
                    <span className="text-sm font-medium">{title}</span>
                    <span className="text-muted-foreground text-sm">{hint}</span>
                  </label>
                ))}
              </fieldset>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-5 pt-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="template-header">{copy.header}</Label>
                <Input
                  id="template-header"
                  dir="auto"
                  className="text-start"
                  value={header}
                  aria-invalid={headerMessages.length > 0}
                  aria-describedby="template-header-hint template-header-errors"
                  onChange={(event) => {
                    setHeader(event.target.value);
                    touch("header");
                  }}
                />
                <p id="template-header-hint" className="text-muted-foreground text-sm">
                  {copy.headerHint}
                </p>
              </div>
              {headerHasVariable && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="template-header-example">{copy.headerExample}</Label>
                  <Input
                    id="template-header-example"
                    dir="auto"
                    className="text-start"
                    value={headerExample}
                    aria-required="true"
                    onChange={(event) => {
                      setHeaderExample(event.target.value);
                      touch("header");
                    }}
                  />
                </div>
              )}
              {errorList(headerMessages, "template-header-errors")}

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="template-body">{copy.body}</Label>
                  <span className="text-muted-foreground text-xs">
                    {copy.count
                      .replace("{count}", String(body.length))
                      .replace("{max}", String(FORM_LIMITS.body))}
                  </span>
                </div>
                <Textarea
                  id="template-body"
                  ref={bodyRef}
                  dir="auto"
                  className="text-start"
                  rows={5}
                  value={body}
                  aria-invalid={bodyMessages.length > 0}
                  aria-describedby="template-body-hint template-body-errors"
                  onChange={(event) => {
                    setBody(event.target.value);
                    touch("body");
                  }}
                />
                <p id="template-body-hint" className="text-muted-foreground text-sm">
                  {copy.bodyHint}
                </p>
                <div>
                  <Button type="button" variant="outline" size="sm" onClick={addVariable}>
                    <PlusIcon aria-hidden="true" />
                    {copy.addVariable}
                  </Button>
                </div>
                {errorList(bodyMessages, "template-body-errors")}
              </div>

              {variableCount > 0 && (
                <div className="flex flex-col gap-3" role="group" aria-label={copy.examples}>
                  <p className="text-sm font-medium">{copy.examples}</p>
                  <p className="text-muted-foreground -mt-2 text-sm">
                    <BrandText text={copy.examplesHint} />
                  </p>
                  {exampleValues.map((value, index) => (
                    <div key={index} className="flex flex-col gap-1.5">
                      <Label htmlFor={`template-example-${index}`}>
                        {copy.example.replace("{index}", String(index + 1))}
                      </Label>
                      <Input
                        id={`template-example-${index}`}
                        dir="auto"
                        className="text-start"
                        value={value}
                        onChange={(event) => {
                          const next = [...exampleValues];
                          next[index] = event.target.value;
                          setExamples(next);
                          touch("body");
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="template-footer">{copy.footer}</Label>
                <Input
                  id="template-footer"
                  dir="auto"
                  className="text-start"
                  value={footer}
                  aria-invalid={footerMessages.length > 0}
                  aria-describedby="template-footer-hint template-footer-errors"
                  onChange={(event) => {
                    setFooter(event.target.value);
                    touch("footer");
                  }}
                />
                <p id="template-footer-hint" className="text-muted-foreground text-sm">
                  {copy.footerHint}
                </p>
                {errorList(footerMessages, "template-footer-errors")}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">{copy.buttons}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">{copy.quickReplies}</p>
                {quickReplies.map((text, index) => (
                  <div key={index} className="flex items-end gap-2">
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Label htmlFor={`template-qr-${index}`}>
                        {copy.quickReplyText.replace("{index}", String(index + 1))}
                      </Label>
                      <Input
                        id={`template-qr-${index}`}
                        dir="auto"
                        className="text-start"
                        value={text}
                        onChange={(event) => {
                          setQuickReplies((previous) =>
                            previous.map((v, i) => (i === index ? event.target.value : v)),
                          );
                          touch("buttons");
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`${copy.remove}: ${copy.quickReplyText.replace("{index}", String(index + 1))}`}
                      onClick={() => {
                        setQuickReplies((previous) => previous.filter((_, i) => i !== index));
                        touch("buttons");
                      }}
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={quickReplies.length >= FORM_LIMITS.quickReplies}
                    onClick={() => {
                      setQuickReplies((previous) => [...previous, ""]);
                      touch("buttons");
                    }}
                  >
                    <PlusIcon aria-hidden="true" />
                    {copy.addQuickReply}
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">{copy.urlButtons}</p>
                {urlButtons.map((button, index) => {
                  const position = String(index + 1);
                  const update = (patch: Partial<UrlButton>) => {
                    setUrlButtons((previous) =>
                      previous.map((v, i) => (i === index ? { ...v, ...patch } : v)),
                    );
                    touch("buttons");
                  };
                  return (
                    <div
                      key={index}
                      className="border-border flex flex-col gap-3 rounded-xl border p-3"
                    >
                      <div className="flex items-end gap-2">
                        <div className="flex flex-1 flex-col gap-1.5">
                          <Label htmlFor={`template-url-text-${index}`}>
                            {copy.urlButtonText.replace("{index}", position)}
                          </Label>
                          <Input
                            id={`template-url-text-${index}`}
                            dir="auto"
                            className="text-start"
                            value={button.text}
                            onChange={(event) => update({ text: event.target.value })}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`${copy.remove}: ${copy.urlButtonText.replace("{index}", position)}`}
                          onClick={() => {
                            setUrlButtons((previous) => previous.filter((_, i) => i !== index));
                            touch("buttons");
                          }}
                        >
                          <Trash2Icon aria-hidden="true" />
                        </Button>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`template-url-${index}`}>
                          {copy.urlButtonUrl.replace("{index}", position)}
                        </Label>
                        <Input
                          id={`template-url-${index}`}
                          dir="ltr"
                          className="text-start"
                          inputMode="url"
                          spellCheck={false}
                          value={button.url}
                          onChange={(event) => update({ url: event.target.value })}
                        />
                        <p className="text-muted-foreground text-sm">{copy.urlButtonUrlHint}</p>
                      </div>
                      {URL_VARIABLE.test(button.url) && (
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`template-url-example-${index}`}>
                            {copy.urlButtonExample.replace("{index}", position)}
                          </Label>
                          <Input
                            id={`template-url-example-${index}`}
                            dir="ltr"
                            className="text-start"
                            inputMode="url"
                            spellCheck={false}
                            value={button.example}
                            aria-required="true"
                            onChange={(event) => update({ example: event.target.value })}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={urlButtons.length >= FORM_LIMITS.urlButtons}
                    onClick={() => {
                      setUrlButtons((previous) => [
                        ...previous,
                        { text: "", url: "", example: "" },
                      ]);
                      touch("buttons");
                    }}
                  >
                    <PlusIcon aria-hidden="true" />
                    {copy.addUrlButton}
                  </Button>
                </div>
              </div>
              {errorList(buttonMessages, "template-buttons-errors")}
            </CardContent>
          </Card>
        </fieldset>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || done} loading={pending}>
              <BrandText
                text={pending ? copy.submitting : unresolved !== null ? copy.retry : copy.submit}
              />
            </Button>
            <Link
              href="/settings/whatsapp/templates"
              className="text-muted-foreground text-sm hover:underline"
            >
              {copy.back}
            </Link>
          </div>
          {attempted && issues.length > 0 && unresolved === null && !done && (
            <p role="alert" className="text-destructive text-sm">
              {copy.fixIssues}
            </p>
          )}
          {outcome?.status === "error" && (
            <p role="alert" className="text-destructive text-sm">
              <BrandText text={copy.lostResponse} />
            </p>
          )}
          {outcome?.status === "refused" && (
            <p role="alert" className="text-destructive text-sm">
              <BrandText text={outcome.message} />
            </p>
          )}
          {outcome?.status === "invalid" && (
            <p role="alert" className="text-destructive text-sm">
              {copy.fixIssues}
            </p>
          )}
          {outcome?.status === "success" && (
            <p role="status" className="text-sm">
              <BrandText text={copy.submitted} />
            </p>
          )}
        </div>
      </form>

      <aside
        aria-labelledby="template-preview-title"
        className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start"
      >
        <h2 id="template-preview-title" className="text-base font-semibold">
          {t.whatsappTemplates.preview.title}
        </h2>
        <p className="text-muted-foreground text-sm">
          <BrandText text={t.whatsappTemplates.preview.description} />
        </p>
        <TemplatePreview values={previewValues} t={t} />
      </aside>
    </div>
  );
}

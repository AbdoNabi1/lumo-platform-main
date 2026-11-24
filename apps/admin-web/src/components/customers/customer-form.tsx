"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button, Card, CardContent, Input, Label, NativeSelect, Textarea } from "@platform/ui";
import { createCustomerAction } from "@/app/customers/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";
import { CustomerTagsEditor } from "./customer-tags-editor";

const INITIAL_STATE: FormState = { status: "idle" };

/** A labelled field with its error (or hint) wired through `aria-describedby`. */
function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly error: string | undefined;
  readonly hint?: string;
  readonly children: (props: {
    readonly invalid: boolean;
    readonly describedBy: string | undefined;
  }) => ReactNode;
}) {
  const ids = [
    ...(hint !== undefined ? [`${id}-hint`] : []),
    ...(error !== undefined ? [`${id}-error`] : []),
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({
        invalid: error !== undefined,
        describedBy: ids.length > 0 ? ids.join(" ") : undefined,
      })}
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-muted-foreground text-sm">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={`${id}-error`} className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Shopify's "New customer": name, email, phone, language, the two marketing statements, notes and
 * tags. Every input is controlled, so a failed save keeps what was typed (React resets an
 * uncontrolled form after its action runs). The marketing boxes record what staff assert — they are
 * not proof that the shopper opted in, and the copy says so. Saving creates the customer and opens it.
 */
export function CustomerForm({ t }: { readonly t: Dictionary }) {
  const k = t.customerForm;
  const [state, formAction, isPending] = useActionState(createCustomerAction, INITIAL_STATE);
  const formId = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [marketingEmail, setMarketingEmail] = useState(false);
  const [marketingSms, setMarketingSms] = useState(false);
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};
  const shown = new Set(["name", "email", "phone", "language", "note", "tags"]);
  const hasUnshownError =
    state.status === "error" && !Object.keys(fieldErrors).some((f) => shown.has(f));

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4 pt-5">
          <Field id={`${formId}-name`} label={k.name} error={fieldErrors["name"]}>
            {({ invalid, describedBy }) => (
              <Input
                id={`${formId}-name`}
                name="name"
                dir="auto"
                autoComplete="off"
                value={name}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Field id={`${formId}-email`} label={k.email} error={fieldErrors["email"]}>
            {({ invalid, describedBy }) => (
              <Input
                id={`${formId}-email`}
                name="email"
                type="email"
                dir="ltr"
                autoComplete="off"
                className="text-start"
                value={email}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${formId}-phone`} label={k.phone} error={fieldErrors["phone"]}>
              {({ invalid, describedBy }) => (
                <Input
                  id={`${formId}-phone`}
                  name="phone"
                  type="tel"
                  dir="ltr"
                  autoComplete="off"
                  className="text-start"
                  value={phone}
                  aria-invalid={invalid || undefined}
                  aria-describedby={describedBy}
                  onChange={(event) => setPhone(event.target.value)}
                />
              )}
            </Field>
            <Field id={`${formId}-language`} label={k.language} error={fieldErrors["language"]}>
              {({ invalid, describedBy }) => (
                <NativeSelect
                  id={`${formId}-language`}
                  name="language"
                  value={language}
                  aria-invalid={invalid || undefined}
                  aria-describedby={describedBy}
                  onChange={(event) => setLanguage(event.target.value)}
                >
                  <option value="">{k.languageNone}</option>
                  <option value="en">{k.languageEnglish}</option>
                  <option value="ar">{k.languageArabic}</option>
                </NativeSelect>
              )}
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-5">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="marketingEmail"
              className="mt-0.5"
              checked={marketingEmail}
              onChange={(event) => setMarketingEmail(event.target.checked)}
            />
            <span>{k.marketingEmail}</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="marketingSms"
              className="mt-0.5"
              checked={marketingSms}
              onChange={(event) => setMarketingSms(event.target.checked)}
            />
            <span>{k.marketingSms}</span>
          </label>
          <p className="text-muted-foreground text-sm">{k.marketingNote}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-5">
          <Field id={`${formId}-note`} label={k.notes} error={fieldErrors["note"]}>
            {({ invalid, describedBy }) => (
              <Textarea
                id={`${formId}-note`}
                name="note"
                dir="auto"
                rows={3}
                value={note}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
          <Field id={`${formId}-tags`} label={k.tags} hint={k.tagsHint} error={fieldErrors["tags"]}>
            {({ invalid, describedBy }) => (
              <CustomerTagsEditor
                tags={tags}
                onChange={setTags}
                inputId={`${formId}-tags`}
                describedBy={describedBy}
                invalid={invalid}
                name="tags"
                t={t}
              />
            )}
          </Field>
          {hasUnshownError && state.status === "error" && (
            <p role="alert" className="text-destructive text-sm">
              {state.message}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href="/customers">{k.cancel}</Link>
        </Button>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? k.saving : k.save}
        </Button>
      </div>
    </form>
  );
}

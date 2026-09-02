"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { setSeoProfileAction } from "@/app/seo/profiles/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

interface SeoProfileFormDefaults {
  readonly pageRef?: string;
  readonly title?: string;
  readonly description?: string;
  readonly canonicalUrl?: string;
  readonly ogImageRef?: string;
}

/**
 * The SEO Profiles create/set form (T5.9b). `POST /seo/profiles` create-or-updates keyed by
 * `pageRef`, so this same form doubles as the edit UI: the detail page links here with the record's
 * current values pre-filled via `defaultValues`, and re-submitting updates the existing profile.
 * `pageRef` is a plain text input — no page picker in scope (see the task brief: cross-domain
 * pickers are out of scope even though T5.9a builds a Pages screen).
 */
export function SeoProfileForm({
  t,
  defaultValues,
}: {
  readonly t: Dictionary;
  readonly defaultValues?: SeoProfileFormDefaults;
}) {
  const [state, formAction, isPending] = useActionState(setSeoProfileAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.status === "error" && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground flex items-center gap-2 rounded-xl border px-4 py-3 text-sm"
        >
          <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-pageRef`}
          name="pageRef"
          label={t.seoProfileForm.pageRef}
          defaultValue={defaultValues?.pageRef}
          error={fieldErrors["pageRef"]}
        />
        <Field
          id={`${formId}-title`}
          name="title"
          label={t.seoProfileForm.titleField}
          defaultValue={defaultValues?.title}
          error={fieldErrors["title"]}
        />
        <Field
          id={`${formId}-description`}
          name="description"
          label={t.seoProfileForm.description}
          defaultValue={defaultValues?.description}
          error={fieldErrors["description"]}
        />
        <Field
          id={`${formId}-canonicalUrl`}
          name="canonicalUrl"
          label={t.seoProfileForm.canonicalUrl}
          defaultValue={defaultValues?.canonicalUrl}
          error={fieldErrors["canonicalUrl"]}
          placeholder="https://example.com/page"
        />
        <Field
          id={`${formId}-ogImageRef`}
          name="ogImageRef"
          label={t.seoProfileForm.ogImageRef}
          defaultValue={defaultValues?.ogImageRef}
          error={fieldErrors["ogImageRef"]}
        />
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.seoProfileForm.submitting : t.seoProfileForm.submit}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  name,
  label,
  defaultValue,
  error,
  placeholder,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly defaultValue?: string;
  readonly error?: string;
  readonly placeholder?: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
      />
      {error !== undefined && (
        <p id={errorId} className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { createPageAction } from "@/app/pages/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * The Pages create form (T5.9a Part B). `templateRef`/`experienceRef`/`seoProfileRef`/`localeRef`
 * are plain text ids — no picker source exists in this task's scope (no `lib/api/experiences.ts`
 * or similar in the repo to back a `<select>`, per the task brief).
 */
export function PageCreateForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(createPageAction, INITIAL_STATE);
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
          id={`${formId}-name`}
          name="name"
          label={t.pageCreate.name}
          error={fieldErrors["name"]}
        />
        <Field
          id={`${formId}-routePath`}
          name="routePath"
          label={t.pageCreate.routePath}
          error={fieldErrors["routePath"]}
          placeholder="/example"
        />
        <Field
          id={`${formId}-templateRef`}
          name="templateRef"
          label={t.pageCreate.templateRef}
          error={fieldErrors["templateRef"]}
        />
        <Field
          id={`${formId}-experienceRef`}
          name="experienceRef"
          label={t.pageCreate.experienceRef}
          error={fieldErrors["experienceRef"]}
        />
        <Field
          id={`${formId}-seoProfileRef`}
          name="seoProfileRef"
          label={t.pageCreate.seoProfileRef}
          error={fieldErrors["seoProfileRef"]}
        />
        <Field
          id={`${formId}-localeRef`}
          name="localeRef"
          label={t.pageCreate.localeRef}
          error={fieldErrors["localeRef"]}
        />
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.pageCreate.submitting : t.pageCreate.submit}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  name,
  label,
  error,
  placeholder,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
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

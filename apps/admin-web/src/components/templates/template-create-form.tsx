"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { createTemplateAction } from "@/app/templates/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/** The Templates create form (T5.9a Part B). `experienceRef` is a plain text id — same reasoning as `PageCreateForm`'s ref fields (no picker source in this task's scope). */
export function TemplateCreateForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(createTemplateAction, INITIAL_STATE);
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-name`}>{t.templateCreate.name}</Label>
          <Input
            id={`${formId}-name`}
            name="name"
            aria-invalid={fieldErrors["name"] !== undefined || undefined}
            aria-describedby={fieldErrors["name"] !== undefined ? `${formId}-name-error` : undefined}
          />
          {fieldErrors["name"] !== undefined && (
            <p id={`${formId}-name-error`} className="text-destructive text-sm">
              {fieldErrors["name"]}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-experienceRef`}>{t.templateCreate.experienceRef}</Label>
          <Input
            id={`${formId}-experienceRef`}
            name="experienceRef"
            aria-invalid={fieldErrors["experienceRef"] !== undefined || undefined}
            aria-describedby={
              fieldErrors["experienceRef"] !== undefined ? `${formId}-experienceRef-error` : undefined
            }
          />
          {fieldErrors["experienceRef"] !== undefined && (
            <p id={`${formId}-experienceRef-error`} className="text-destructive text-sm">
              {fieldErrors["experienceRef"]}
            </p>
          )}
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.templateCreate.submitting : t.templateCreate.submit}
        </Button>
      </div>
    </form>
  );
}

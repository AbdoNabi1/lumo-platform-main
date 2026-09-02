"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { createTranslationSetAction } from "@/app/translation-sets/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/** The translation set create form (`app/translation-sets/new/page.tsx`, T5.11a). */
export function TranslationSetCreateForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(
    createTranslationSetAction,
    INITIAL_STATE,
  );
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
          <Label htmlFor={`${formId}-localeRef`}>{t.translationSetCreateForm.localeRef}</Label>
          <Input
            id={`${formId}-localeRef`}
            name="localeRef"
            aria-invalid={fieldErrors["localeRef"] !== undefined || undefined}
          />
          {fieldErrors["localeRef"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["localeRef"]}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-namespace`}>{t.translationSetCreateForm.namespace}</Label>
          <Input
            id={`${formId}-namespace`}
            name="namespace"
            aria-invalid={fieldErrors["namespace"] !== undefined || undefined}
          />
          {fieldErrors["namespace"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["namespace"]}</p>
          )}
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending
            ? t.translationSetCreateForm.submitting
            : t.translationSetCreateForm.submit}
        </Button>
      </div>
    </form>
  );
}

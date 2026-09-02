"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { createLocaleAction } from "@/app/locales/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/** The locale create form (`app/locales/new/page.tsx`, T5.11a). */
export function LocaleCreateForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(createLocaleAction, INITIAL_STATE);
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
          <Label htmlFor={`${formId}-code`}>{t.localeCreateForm.code}</Label>
          <Input
            id={`${formId}-code`}
            name="code"
            aria-invalid={fieldErrors["code"] !== undefined || undefined}
          />
          {fieldErrors["code"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["code"]}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-name`}>{t.localeCreateForm.name}</Label>
          <Input
            id={`${formId}-name`}
            name="name"
            aria-invalid={fieldErrors["name"] !== undefined || undefined}
          />
          {fieldErrors["name"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["name"]}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`${formId}-fallbackLocaleRef`}>
            {t.localeCreateForm.fallbackLocaleRef}
          </Label>
          <Input id={`${formId}-fallbackLocaleRef`} name="fallbackLocaleRef" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input type="checkbox" id={`${formId}-isDefault`} name="isDefault" className="mt-0.5" />
        <Label htmlFor={`${formId}-isDefault`}>{t.localeCreateForm.isDefault}</Label>
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.localeCreateForm.submitting : t.localeCreateForm.submit}
        </Button>
      </div>
    </form>
  );
}

"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { createThemeAction } from "@/app/theme/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * The Theme create form (T5.9c). `presetKey` is a plain text input — no preset catalog/picker
 * exists in this task's scope, per the task brief.
 */
export function ThemeCreateForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(createThemeAction, INITIAL_STATE);
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
          <Label htmlFor={`${formId}-name`}>{t.themeCreate.name}</Label>
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
          <Label htmlFor={`${formId}-presetKey`}>{t.themeCreate.presetKey}</Label>
          <Input
            id={`${formId}-presetKey`}
            name="presetKey"
            aria-invalid={fieldErrors["presetKey"] !== undefined || undefined}
            aria-describedby={
              fieldErrors["presetKey"] !== undefined ? `${formId}-presetKey-error` : undefined
            }
          />
          {fieldErrors["presetKey"] !== undefined && (
            <p id={`${formId}-presetKey-error`} className="text-destructive text-sm">
              {fieldErrors["presetKey"]}
            </p>
          )}
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.themeCreate.submitting : t.themeCreate.submit}
        </Button>
      </div>
    </form>
  );
}

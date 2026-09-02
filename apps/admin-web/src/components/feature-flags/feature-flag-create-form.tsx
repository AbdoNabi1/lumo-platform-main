"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { createFeatureFlagAction } from "@/app/feature-flags/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/** The feature flag create form (`app/feature-flags/new/page.tsx`, T5.11b) — always created active at 0% rollout, per the route table. */
export function FeatureFlagCreateForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(createFeatureFlagAction, INITIAL_STATE);
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

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-key`}>{t.featureFlagCreateForm.key}</Label>
        <Input
          id={`${formId}-key`}
          name="key"
          aria-invalid={fieldErrors["key"] !== undefined || undefined}
        />
        {fieldErrors["key"] !== undefined && (
          <p className="text-destructive text-sm">{fieldErrors["key"]}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-name`}>{t.featureFlagCreateForm.name}</Label>
        <Input
          id={`${formId}-name`}
          name="name"
          aria-invalid={fieldErrors["name"] !== undefined || undefined}
        />
        {fieldErrors["name"] !== undefined && (
          <p className="text-destructive text-sm">{fieldErrors["name"]}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-description`}>
          {t.featureFlagCreateForm.description}
        </Label>
        <Input id={`${formId}-description`} name="description" />
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.featureFlagCreateForm.submitting : t.featureFlagCreateForm.submit}
        </Button>
      </div>
    </form>
  );
}

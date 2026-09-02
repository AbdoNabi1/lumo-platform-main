"use client";

import { useActionState, useId } from "react";
import { CheckIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import { createBrandAction } from "@/app/brands/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

export function BrandCreateForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(createBrandAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.brandCreateForm.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${formId}-name`}>{t.brandCreateForm.name}</Label>
            <Input
              id={`${formId}-name`}
              name="name"
              className="h-9 w-48"
              aria-invalid={fieldErrors["name"] !== undefined || undefined}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${formId}-slug`}>{t.brandCreateForm.slug}</Label>
            <Input
              id={`${formId}-slug`}
              name="slug"
              className="h-9 w-48"
              aria-invalid={fieldErrors["slug"] !== undefined || undefined}
            />
          </div>
          <Button type="submit" loading={isPending} disabled={isPending}>
            {isPending ? t.brandCreateForm.submitting : t.brandCreateForm.submit}
          </Button>
          {state.status === "success" && (
            <p role="status" className="text-muted-foreground flex items-center gap-1 text-xs">
              <CheckIcon aria-hidden="true" className="size-3.5" />
              {t.brandRowActions.saved}
            </p>
          )}
        </form>
        {state.status === "error" && (
          <p role="alert" className="text-destructive mt-2 text-xs">
            {state.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

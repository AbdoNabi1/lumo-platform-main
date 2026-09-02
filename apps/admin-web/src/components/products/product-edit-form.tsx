"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon, CheckIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { updateProductAction } from "@/app/products/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/** The reference edit-screen form (Phase 1 T1.4) — same `useActionState`/field-error/pending treatment as `ProductCreateForm`, kept deliberately small (name/slug only; the full editor is Phase 5). */
export function ProductEditForm({
  productId,
  name,
  slug,
  t,
}: {
  readonly productId: string;
  readonly name: string;
  readonly slug: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(updateProductAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="productId" value={productId} />

      {state.status === "error" && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground flex items-center gap-2 rounded-xl border px-4 py-3 text-sm"
        >
          <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}
      {state.status === "success" && (
        <div
          role="status"
          className="border-border bg-secondary text-secondary-foreground flex items-center gap-2 rounded-xl border px-4 py-3 text-sm"
        >
          <CheckIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>{t.productEdit.success}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-name`}>{t.productEdit.name}</Label>
          <Input
            id={`${formId}-name`}
            name="name"
            defaultValue={name}
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
          <Label htmlFor={`${formId}-slug`}>{t.productEdit.slug}</Label>
          <Input
            id={`${formId}-slug`}
            name="slug"
            defaultValue={slug}
            aria-invalid={fieldErrors["slug"] !== undefined || undefined}
            aria-describedby={fieldErrors["slug"] !== undefined ? `${formId}-slug-error` : undefined}
          />
          {fieldErrors["slug"] !== undefined && (
            <p id={`${formId}-slug-error`} className="text-destructive text-sm">
              {fieldErrors["slug"]}
            </p>
          )}
        </div>
      </div>

      <div>
        <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
          {isPending ? t.productEdit.submitting : t.productEdit.submit}
        </Button>
      </div>
    </form>
  );
}

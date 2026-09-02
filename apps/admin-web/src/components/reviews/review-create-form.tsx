"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { createReviewAction } from "@/app/reviews/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

const TEXTAREA_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) min-h-32 w-full rounded-xl border px-3.5 py-2.5 text-sm transition-colors ease-out";

/**
 * The review create form (`app/reviews/new/page.tsx`, T5.10) — same `useActionState` shape as
 * `ContentCreateForm`. Normally a customer leaves a review from the storefront (T5.18); this admin
 * console can also create one directly (e.g. for support/testing), per the task brief.
 * `verifiedPurchase` is not a form field — the backend decides it via `OrdersPort`, never
 * operator-supplied.
 */
export function ReviewCreateForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(createReviewAction, INITIAL_STATE);
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
          <Label htmlFor={`${formId}-productRef`}>{t.reviewCreateForm.productRef}</Label>
          <Input
            id={`${formId}-productRef`}
            name="productRef"
            aria-invalid={fieldErrors["productRef"] !== undefined || undefined}
            aria-describedby={
              fieldErrors["productRef"] !== undefined ? `${formId}-productRef-error` : undefined
            }
          />
          {fieldErrors["productRef"] !== undefined && (
            <p id={`${formId}-productRef-error`} className="text-destructive text-sm">
              {fieldErrors["productRef"]}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-customerRef`}>{t.reviewCreateForm.customerRef}</Label>
          <Input
            id={`${formId}-customerRef`}
            name="customerRef"
            aria-invalid={fieldErrors["customerRef"] !== undefined || undefined}
            aria-describedby={
              fieldErrors["customerRef"] !== undefined ? `${formId}-customerRef-error` : undefined
            }
          />
          {fieldErrors["customerRef"] !== undefined && (
            <p id={`${formId}-customerRef-error`} className="text-destructive text-sm">
              {fieldErrors["customerRef"]}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-rating`}>{t.reviewCreateForm.rating}</Label>
          <Input
            id={`${formId}-rating`}
            name="rating"
            type="number"
            min={1}
            max={5}
            step={1}
            aria-invalid={fieldErrors["rating"] !== undefined || undefined}
            aria-describedby={
              fieldErrors["rating"] !== undefined ? `${formId}-rating-error` : undefined
            }
          />
          {fieldErrors["rating"] !== undefined && (
            <p id={`${formId}-rating-error`} className="text-destructive text-sm">
              {fieldErrors["rating"]}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-assetRefs`}>{t.reviewCreateForm.assetRefs}</Label>
          <Input id={`${formId}-assetRefs`} name="assetRefs" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-bodyText`}>{t.reviewCreateForm.bodyText}</Label>
        <textarea
          id={`${formId}-bodyText`}
          name="bodyText"
          rows={6}
          aria-invalid={fieldErrors["bodyText"] !== undefined || undefined}
          aria-describedby={
            fieldErrors["bodyText"] !== undefined ? `${formId}-bodyText-error` : undefined
          }
          className={TEXTAREA_CLASS}
        />
        {fieldErrors["bodyText"] !== undefined && (
          <p id={`${formId}-bodyText-error`} className="text-destructive text-sm">
            {fieldErrors["bodyText"]}
          </p>
        )}
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.reviewCreateForm.submitting : t.reviewCreateForm.submit}
        </Button>
      </div>
    </form>
  );
}

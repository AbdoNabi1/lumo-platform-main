"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { createCouponAction } from "@/app/discounts/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * The Coupons create form (T5.8 Part A). `promotionRef` is a plain text id — no promotions
 * picker source is wired here; the Promotions list screen (built by this same task) is where an
 * operator would go look one up, same "plain text ref, no picker" discipline `PageCreateForm`
 * uses for `templateRef`/`experienceRef`.
 */
export function CouponCreateForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(createCouponAction, INITIAL_STATE);
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
          <Label htmlFor={`${formId}-code`}>{t.couponCreate.code}</Label>
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
          <Label htmlFor={`${formId}-promotionRef`}>{t.couponCreate.promotionRef}</Label>
          <Input
            id={`${formId}-promotionRef`}
            name="promotionRef"
            aria-invalid={fieldErrors["promotionRef"] !== undefined || undefined}
          />
          {fieldErrors["promotionRef"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["promotionRef"]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-usageLimit`}>{t.couponCreate.usageLimit}</Label>
          <Input
            id={`${formId}-usageLimit`}
            name="usageLimit"
            type="number"
            min={1}
            step={1}
            aria-invalid={fieldErrors["usageLimit"] !== undefined || undefined}
          />
          {fieldErrors["usageLimit"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["usageLimit"]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-customerRef`}>{t.couponCreate.customerRef}</Label>
          <Input id={`${formId}-customerRef`} name="customerRef" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-expiresAt`}>{t.couponCreate.expiresAt}</Label>
          <Input id={`${formId}-expiresAt`} name="expiresAt" type="datetime-local" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-campaignRef`}>{t.couponCreate.campaignRef}</Label>
          <Input id={`${formId}-campaignRef`} name="campaignRef" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input type="checkbox" id={`${formId}-multiUse`} name="multiUse" className="mt-0.5" />
        <Label htmlFor={`${formId}-multiUse`}>{t.couponCreate.multiUse}</Label>
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.couponCreate.submitting : t.couponCreate.submit}
        </Button>
      </div>
    </form>
  );
}

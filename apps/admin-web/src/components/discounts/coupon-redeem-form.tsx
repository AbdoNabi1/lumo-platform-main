"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon, CheckCircleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { redeemCouponAction } from "@/app/discounts/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * The coupon redeem form (T5.8 Part A) — a customer-facing/POS-style action rather than a typical
 * admin write screen (see the task brief), included here as its own small panel since it's one of
 * the 4 coupon routes. Mints its own `Idempotency-Key` per submit, threaded into both the header
 * and the body's own `idempotencyKey` field by `redeemCouponAction` (see that action's doc
 * comment).
 */
export function CouponRedeemForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(redeemCouponAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.status === "success" && (
        <p role="status" className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <CheckCircleIcon aria-hidden="true" className="size-4" />
          {t.couponRedeem.success}
        </p>
      )}
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
          <Label htmlFor={`${formId}-code`}>{t.couponRedeem.code}</Label>
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
          <Label htmlFor={`${formId}-customerRef`}>{t.couponRedeem.customerRef}</Label>
          <Input
            id={`${formId}-customerRef`}
            name="customerRef"
            aria-invalid={fieldErrors["customerRef"] !== undefined || undefined}
          />
          {fieldErrors["customerRef"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["customerRef"]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-orderRef`}>{t.couponRedeem.orderRef}</Label>
          <Input id={`${formId}-orderRef`} name="orderRef" />
        </div>
      </div>

      <div>
        <Button type="submit" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.couponRedeem.submitting : t.couponRedeem.submit}
        </Button>
      </div>
    </form>
  );
}

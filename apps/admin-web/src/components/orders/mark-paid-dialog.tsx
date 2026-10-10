"use client";

import { useActionState, useEffect, useId, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
} from "@platform/ui";
import { markOrderPaidAction } from "@/app/orders/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * "Mark as paid" for an order with NO payment linked: a small dialog asking for the reference of the
 * payment that was received, then the existing `markOrderPaidAction`. That action is only authoritative
 * for an order still at `placed` and it is checked against Payments (a captured payment must exist for
 * the reference), so the page offers this only where it can succeed. Any refusal is shown in the dialog.
 */
export function MarkPaidDialog({
  orderId,
  t,
}: {
  readonly orderId: string;
  readonly t: Dictionary;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(markOrderPaidAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state.status]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" className="self-start">
          {t.orderPage.markAsPaid}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.orderPage.markAsPaidDialogTitle}</DialogTitle>
          <DialogDescription>{t.orderPage.markAsPaidDialogBody}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="orderId" value={orderId} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-paymentRef`}>{t.orderLifecycle.paymentRefLabel}</Label>
            <Input
              id={`${formId}-paymentRef`}
              name="paymentRef"
              aria-invalid={fieldErrors["paymentRef"] !== undefined || undefined}
              aria-describedby={
                fieldErrors["paymentRef"] !== undefined ? `${formId}-paymentRef-error` : undefined
              }
            />
            {fieldErrors["paymentRef"] !== undefined && (
              <p id={`${formId}-paymentRef-error`} className="text-destructive text-sm">
                {fieldErrors["paymentRef"]}
              </p>
            )}
          </div>
          {state.status === "error" && fieldErrors["paymentRef"] === undefined && (
            <p role="alert" className="text-destructive text-sm">
              {state.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t.orderPage.cancel}
            </Button>
            <Button type="submit" loading={isPending} disabled={isPending}>
              {isPending ? t.orderPage.markingAsPaid : t.orderPage.markAsPaidSubmit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

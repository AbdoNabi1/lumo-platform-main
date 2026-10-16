"use client";

import { useActionState } from "react";
import { Button } from "@platform/ui";
import { confirmCodCollectionAction } from "@/app/orders/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * Plan 3A — marking a cash-on-delivery payment as received (Plan 3B words the button "Mark as paid"). It posts only the two ids; the
 * amount and currency are read from the payment intent on the server (`confirmCodCollectionAction`).
 * `confirmMessage` is the whole question, amount included, formatted by the server component that
 * renders this — a native `window.confirm` guards the submit, the same as refund on this page.
 */
export function CodCollectionForm({
  orderId,
  paymentIntentId,
  confirmMessage,
  t,
}: {
  readonly orderId: string;
  readonly paymentIntentId: string;
  readonly confirmMessage: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(confirmCodCollectionAction, INITIAL_STATE);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) event.preventDefault();
      }}
      className="flex flex-col items-start gap-1"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="paymentIntentId" value={paymentIntentId} />
      <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
        {isPending ? t.orderPage.markingAsPaid : t.orderPage.markAsPaid}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

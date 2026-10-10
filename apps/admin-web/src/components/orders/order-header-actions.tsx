"use client";

import { useActionState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@platform/ui";
import { advanceOrderAction, refundOrderAction } from "@/app/orders/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * "Refund" in the order page header — the existing refund flow (`refundOrderAction`, with its confirm).
 * `enabled` is true only when the backend would accept the refund; otherwise the button is shown but
 * disabled, with the reason as its tooltip, so it is never a button that can only fail.
 */
export function OrderRefundButton({
  orderId,
  enabled,
  t,
}: {
  readonly orderId: string;
  readonly enabled: boolean;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(refundOrderAction, INITIAL_STATE);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t.orderLifecycle.confirmRefund)) event.preventDefault();
      }}
      className="flex flex-col items-start gap-1"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <Button
        type="submit"
        variant="outline"
        loading={isPending}
        disabled={!enabled || isPending}
        title={enabled ? undefined : t.orderPage.refundUnavailable}
      >
        {isPending ? t.orderLifecycle.refunding : t.orderPage.refund}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

/**
 * "More actions ▾": Cancel order (behind a confirm, offered only when the lifecycle's transition table
 * allows it — `canCancel` — through the same `advanceOrderAction` the Advanced section uses) and Print
 * packing slip (`window.print()`). A native `<details>` menu: it needs no script to open and every
 * item is reachable by keyboard.
 */
export function OrderMoreActions({
  orderId,
  canCancel,
  t,
}: {
  readonly orderId: string;
  readonly canCancel: boolean;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(advanceOrderAction, INITIAL_STATE);
  return (
    <details className="relative">
      <summary className="border-input bg-card text-foreground hover:border-foreground/40 focus-visible:ring-ring inline-flex h-10 cursor-pointer list-none items-center gap-2 rounded-xl border px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
        {t.orderPage.moreActions}
        <ChevronDownIcon aria-hidden="true" className="size-4" />
      </summary>
      <div className="border-border bg-card absolute end-0 z-20 mt-2 flex min-w-56 flex-col gap-1 rounded-xl border p-2 shadow-lg">
        {canCancel && (
          <form
            action={formAction}
            onSubmit={(event) => {
              if (!window.confirm(t.orderPage.confirmCancelOrder)) event.preventDefault();
            }}
            className="flex flex-col items-start gap-1"
          >
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="toStatus" value="cancelled" />
            <Button
              type="submit"
              variant="ghost"
              className="text-destructive w-full justify-start"
              loading={isPending}
              disabled={isPending}
            >
              {isPending ? t.orderPage.cancellingOrder : t.orderPage.cancelOrder}
            </Button>
            {state.status === "error" && (
              <p role="alert" className="text-destructive px-3 text-xs">
                {state.message}
              </p>
            )}
          </form>
        )}
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start"
          onClick={() => window.print()}
        >
          {t.orderPage.printPackingSlip}
        </Button>
      </div>
    </details>
  );
}

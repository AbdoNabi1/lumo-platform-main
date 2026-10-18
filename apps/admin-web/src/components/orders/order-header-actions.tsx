"use client";

import { useActionState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@platform/ui";
import {
  advanceOrderAction,
  archiveOrderAction,
  refundOrderAction,
  unarchiveOrderAction,
} from "@/app/orders/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * "Refund" in the order page header — the existing refund flow (`refundOrderAction`) behind a
 * confirmation that names the amount ("Refund $39.98 to the customer?"). The money moves through
 * Payments on the backend; this button only asks. `enabled` is the backend's own answer
 * (`order.refundable`); otherwise the button is shown but disabled, with the reason as its tooltip, so
 * it is never a button that can only fail.
 */
export function OrderRefundButton({
  orderId,
  enabled,
  confirmMessage,
  t,
}: {
  readonly orderId: string;
  readonly enabled: boolean;
  /** What the confirm dialog says, built by the page (amount, and the cash line for cash on delivery). */
  readonly confirmMessage: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(refundOrderAction, INITIAL_STATE);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) event.preventDefault();
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
 * allows it — `canCancel` — through the same `advanceOrderAction` the Advanced section uses), Archive /
 * Unarchive (order operations Part 1) and Print packing slip (a link to the print page, in a new tab). A native `<details>` menu: it needs no script to open and every
 * item is reachable by keyboard.
 */
export function OrderMoreActions({
  orderId,
  canCancel,
  archived,
  t,
}: {
  readonly orderId: string;
  readonly canCancel: boolean;
  /** Whether the order is archived: offers Unarchive instead of Archive. */
  readonly archived: boolean;
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
        {archived ? (
          <OrderArchiveForm
            orderId={orderId}
            action={unarchiveOrderAction}
            label={t.orderPage.unarchive}
            t={t}
          />
        ) : (
          <OrderArchiveForm
            orderId={orderId}
            action={archiveOrderAction}
            label={t.orderPage.archive}
            t={t}
          />
        )}
        <Button asChild variant="ghost" className="w-full justify-start">
          <a
            href={`/orders/packing-slips?ids=${encodeURIComponent(orderId)}`}
            target="_blank"
            rel="noreferrer"
          >
            {t.orderPage.printPackingSlip}
          </a>
        </Button>
      </div>
    </details>
  );
}

/** Archive / Unarchive (order operations Part 1): one form per action, each with its own pending state. */
function OrderArchiveForm({
  orderId,
  action,
  label,
  t,
}: {
  readonly orderId: string;
  readonly action: (previous: FormState, formData: FormData) => Promise<FormState>;
  readonly label: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <Button
        type="submit"
        variant="ghost"
        className="w-full justify-start"
        loading={isPending}
        disabled={isPending}
      >
        {isPending ? t.orderPage.archiving : label}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive px-3 text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

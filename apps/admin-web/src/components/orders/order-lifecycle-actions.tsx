"use client";

import { useActionState, useId } from "react";
import { Button, Input, Label } from "@platform/ui";
import {
  advanceOrderAction,
  markOrderPaidAction,
  refundOrderAction,
  requestFulfillmentAction,
  requestPaymentCaptureAction,
} from "@/app/orders/actions";
import type { FormState } from "@/lib/api/mutation";
import { advanceableStatusesFrom, canRefundFrom } from "@/lib/order-lifecycle";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

type ActionFn = (previous: FormState, formData: FormData) => Promise<FormState>;

/**
 * One order-detail lifecycle action button that needs nothing but the order id — refund, request
 * payment capture, request fulfillment. Same shell as `product-lifecycle-actions.tsx`'s
 * `LifecycleActionButton` (T5.1): `confirmMessage`, when set, guards the submit with a native
 * `window.confirm` since refund is a hard-to-undo action.
 */
function LifecycleActionButton({
  orderId,
  action,
  label,
  pendingLabel,
  variant,
  confirmMessage,
}: {
  readonly orderId: string;
  readonly action: ActionFn;
  readonly label: string;
  readonly pendingLabel: string;
  readonly variant?: "outline" | "destructive";
  readonly confirmMessage?: string;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (confirmMessage !== undefined && !window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col items-start gap-1"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <Button
        type="submit"
        size="sm"
        variant={variant ?? "outline"}
        loading={isPending}
        disabled={isPending}
      >
        {isPending ? pendingLabel : label}
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
 * The "advance to…" dropdown + submit — only rendered by the caller when `statuses` is non-empty
 * (`lib/order-lifecycle.ts`'s `advanceableStatusesFrom`), so this component itself never needs to
 * handle the empty-list case. Same native-`<select>` styling as `OrdersToolbar`'s status filter.
 */
function AdvanceOrderForm({
  orderId,
  statuses,
  t,
}: {
  readonly orderId: string;
  readonly statuses: readonly string[];
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(advanceOrderAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-toStatus`} className="text-muted-foreground text-xs">
            {t.orderLifecycle.advanceToLabel}
          </Label>
          <select
            id={`${formId}-toStatus`}
            name="toStatus"
            aria-invalid={fieldErrors["toStatus"] !== undefined || undefined}
            className="border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out"
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {(t.orderStatus as Record<string, string>)[status] ?? status}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.orderLifecycle.advancing : t.orderLifecycle.advance}
        </Button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

/** The "Mark paid" paymentRef text input + submit — the one authoritative payment-completion path. */
function MarkPaidForm({ orderId, t }: { readonly orderId: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(markOrderPaidAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-paymentRef`} className="text-muted-foreground text-xs">
            {t.orderLifecycle.paymentRefLabel}
          </Label>
          <Input
            id={`${formId}-paymentRef`}
            name="paymentRef"
            className="h-8 text-xs"
            aria-invalid={fieldErrors["paymentRef"] !== undefined || undefined}
            aria-describedby={
              fieldErrors["paymentRef"] !== undefined ? `${formId}-paymentRef-error` : undefined
            }
          />
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.orderLifecycle.markingPaid : t.orderLifecycle.markPaid}
        </Button>
      </div>
      {fieldErrors["paymentRef"] !== undefined && (
        <p id={`${formId}-paymentRef-error`} className="text-destructive text-xs">
          {fieldErrors["paymentRef"]}
        </p>
      )}
      {state.status === "error" && fieldErrors["paymentRef"] === undefined && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

/**
 * The order-detail lifecycle action bar (T5.2). "Advance to…" is gated to the current status's
 * allowed next states, excluding `paid`/`payment_received` (only ever asserted via mark-paid) —
 * rendered as no control at all when there are none (e.g. `refunded`, `closed`), not a disabled
 * empty one. "Refund" is gated the same way (`canRefundFrom`). "Mark paid", "Request payment
 * capture", and "Request fulfillment" are always offered — an invalid transition surfaces as a
 * normal form error (`toFormState`) rather than being silently blocked here, same discipline
 * `ProductLifecycleActions`' own doc comment describes for product transitions.
 */
export function OrderLifecycleActions({
  orderId,
  status,
  t,
}: {
  readonly orderId: string;
  readonly status: string;
  readonly t: Dictionary;
}) {
  const advanceTargets = advanceableStatusesFrom(status);
  const showRefund = canRefundFrom(status);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t.orderLifecycle.title}</h2>
      <div className="flex flex-wrap items-start gap-4">
        {advanceTargets.length > 0 && (
          <AdvanceOrderForm orderId={orderId} statuses={advanceTargets} t={t} />
        )}
        <MarkPaidForm orderId={orderId} t={t} />
        {showRefund && (
          <LifecycleActionButton
            orderId={orderId}
            action={refundOrderAction}
            label={t.orderLifecycle.refund}
            pendingLabel={t.orderLifecycle.refunding}
            variant="destructive"
            confirmMessage={t.orderLifecycle.confirmRefund}
          />
        )}
        <LifecycleActionButton
          orderId={orderId}
          action={requestPaymentCaptureAction}
          label={t.orderLifecycle.requestPaymentCapture}
          pendingLabel={t.orderLifecycle.requestingPaymentCapture}
        />
        <LifecycleActionButton
          orderId={orderId}
          action={requestFulfillmentAction}
          label={t.orderLifecycle.requestFulfillment}
          pendingLabel={t.orderLifecycle.requestingFulfillment}
        />
      </div>
    </div>
  );
}

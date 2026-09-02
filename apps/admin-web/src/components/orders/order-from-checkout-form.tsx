"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { createOrderFromCheckoutAction } from "@/app/orders/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";
import { OrderAddressFields } from "./order-address-fields";
import { OrderLineItemsField } from "./order-line-items-field";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * The "create order from checkout session" recovery form (`app/orders/from-checkout`, T5.2) — for
 * a checkout session whose saga did not auto-create its order. Same repeated-line-item-array and
 * address-block technique as `OrderCreateForm`, plus `checkoutRef` and a second (billing) address
 * block. There is no checkout-session admin screen in this codebase to launch this from
 * contextually, so it is its own small screen, linked from the Orders list.
 */
export function OrderFromCheckoutForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(createOrderFromCheckoutAction, INITIAL_STATE);
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

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-checkoutRef`}>{t.orderFromCheckout.checkoutRef}</Label>
          <Input
            id={`${formId}-checkoutRef`}
            name="checkoutRef"
            aria-invalid={fieldErrors["checkoutRef"] !== undefined || undefined}
            aria-describedby={
              fieldErrors["checkoutRef"] !== undefined ? `${formId}-checkoutRef-error` : undefined
            }
          />
          {fieldErrors["checkoutRef"] !== undefined && (
            <p id={`${formId}-checkoutRef-error`} className="text-destructive text-sm">
              {fieldErrors["checkoutRef"]}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-customerRef`}>{t.orderFromCheckout.customerRef}</Label>
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
          <Label htmlFor={`${formId}-currency`}>{t.orderFromCheckout.currency}</Label>
          <Input
            id={`${formId}-currency`}
            name="currency"
            maxLength={3}
            aria-invalid={fieldErrors["currency"] !== undefined || undefined}
            aria-describedby={
              fieldErrors["currency"] !== undefined ? `${formId}-currency-error` : undefined
            }
          />
          {fieldErrors["currency"] !== undefined && (
            <p id={`${formId}-currency-error`} className="text-destructive text-sm">
              {fieldErrors["currency"]}
            </p>
          )}
        </div>
      </div>

      <OrderLineItemsField t={t} fieldErrors={fieldErrors} />

      <OrderAddressFields
        t={t}
        prefix="billing"
        title={t.orderFromCheckout.billingAddress}
        fieldErrors={fieldErrors}
      />

      <OrderAddressFields
        t={t}
        prefix="shipping"
        title={t.orderFromCheckout.shippingAddress}
        fieldErrors={fieldErrors}
      />

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.orderFromCheckout.submitting : t.orderFromCheckout.submit}
        </Button>
      </div>
    </form>
  );
}

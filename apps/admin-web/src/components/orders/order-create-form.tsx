"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { placeOrderAction } from "@/app/orders/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";
import { OrderAddressFields } from "./order-address-fields";
import { OrderLineItemsField } from "./order-line-items-field";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * The backoffice place-order form (`app/orders/new`, T5.2) — mirrors `ProductCreateForm`'s
 * structure (Phase 1 T1.3): `useActionState` drives `placeOrderAction`, a repeated-row field array
 * for line items, one address block. Unit prices are operator-entered here on purpose — this is a
 * manual backoffice order-creation screen, not the storefront checkout path that never trusts a
 * client-supplied price.
 */
export function OrderCreateForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(placeOrderAction, INITIAL_STATE);
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
          <Label htmlFor={`${formId}-customerRef`}>{t.orderCreate.customerRef}</Label>
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
          <Label htmlFor={`${formId}-currency`}>{t.orderCreate.currency}</Label>
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
        prefix="shipping"
        title={t.orderCreate.shippingAddress}
        fieldErrors={fieldErrors}
      />

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.orderCreate.submitting : t.orderCreate.submit}
        </Button>
      </div>
    </form>
  );
}

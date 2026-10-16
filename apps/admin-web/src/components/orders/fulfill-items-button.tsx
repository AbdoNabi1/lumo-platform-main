"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon } from "lucide-react";
import { Button } from "@platform/ui";
import { createFulfillmentAction } from "@/app/orders/[orderId]/fulfillment/actions";
import type { OrderDetailItemDto } from "@/lib/api/orders";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * "Fulfill items" — opens a fulfillment for EVERY item on the order through the existing
 * open-fulfillment action (`createFulfillmentAction`, the one behind the fulfillment page's form), then
 * goes to the existing fulfillment page where the work continues. The hidden fields are exactly the
 * ones that form submits, so the action is reused unchanged: it re-reads nothing from here but ids and
 * quantities, and the backend remains the judge of what is allowed.
 */
export function FulfillItemsButton({
  orderId,
  items,
  t,
}: {
  readonly orderId: string;
  readonly items: readonly OrderDetailItemDto[];
  readonly t: Dictionary;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(createFulfillmentAction, INITIAL_STATE);

  useEffect(() => {
    if (state.status === "success") router.push(`/orders/${orderId}/fulfillment`);
  }, [state.status, router, orderId]);

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="orderRef" value={orderId} />
      {items.map((item) => (
        <span key={item.id}>
          <input type="hidden" name="includeItem" value={item.id} />
          <input type="hidden" name={`productRef_${item.id}`} value={item.productId} />
          <input type="hidden" name={`quantity_${item.id}`} value={item.quantity} />
        </span>
      ))}
      <Button type="submit" loading={isPending} disabled={isPending || items.length === 0}>
        {isPending ? t.orderPage.fulfillingItems : t.orderPage.fulfillItems}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive flex items-center gap-1.5 text-sm">
          <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
          {state.message}
        </p>
      )}
    </form>
  );
}

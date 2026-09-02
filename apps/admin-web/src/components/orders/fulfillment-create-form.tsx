"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import { createFulfillmentAction } from "@/app/orders/[orderId]/fulfillment/actions";
import type { OrderDetailItemDto } from "@/lib/api/orders";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * The "open a fulfillment order" form (T5.4), shown on `app/orders/[orderId]/fulfillment/page.tsx`
 * whenever `fetchFulfillmentByOrder` comes back `not_found`. `orderRef` is the page's own
 * `orderId` param (hidden field, re-derived by the action from `FormData`, never trusted from a
 * closure). Items are picked from the order's real line items (`fetchOrder`, passed in as
 * `items`) — same item-picker discipline as `ReturnCreateForm` (T5.3): the operator can never
 * free-type a `productRef`, only toggle which real order items are included and adjust quantity
 * per item, up to the item's own ordered quantity.
 *
 * One checkbox per order item drives inclusion (`includeItem`, value = the item's id — reading
 * `getAll("includeItem")` in the action gives the included item ids directly). The item's
 * `productRef` and the operator's quantity are each read back by a field name keyed on that same
 * id (`productRef_<id>`/`quantity_<id>`), robust to items being reordered or a row being left
 * unchecked.
 */
export function FulfillmentCreateForm({
  orderId,
  items,
  t,
}: {
  readonly orderId: string;
  readonly items: readonly OrderDetailItemDto[];
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(createFulfillmentAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.fulfillmentCreateForm.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.fulfillmentCreateForm.noItems}</p>
        ) : (
          <form action={formAction} className="flex flex-col gap-6">
            <input type="hidden" name="orderRef" value={orderId} />
            <p className="text-muted-foreground text-sm">{t.fulfillmentCreateForm.subtitle}</p>

            {state.status === "error" && (
              <div
                role="alert"
                className="border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground flex items-center gap-2 rounded-xl border px-4 py-3 text-sm"
              >
                <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
                <span>{state.message}</span>
              </div>
            )}
            {fieldErrors["items"] !== undefined && (
              <p className="text-destructive text-sm">{fieldErrors["items"]}</p>
            )}

            <div className="flex flex-col gap-4">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="border-border grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_1fr]"
                >
                  <div className="flex items-start gap-2 sm:col-span-2">
                    <input
                      type="checkbox"
                      id={`${formId}-include-${item.id}`}
                      name="includeItem"
                      value={item.id}
                      className="mt-0.5"
                    />
                    <input type="hidden" name={`productRef_${item.id}`} value={item.productId} />
                    <Label htmlFor={`${formId}-include-${item.id}`} className="font-medium">
                      {t.fulfillmentCreateForm.includeItem} — {item.name} × {item.quantity}
                    </Label>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${formId}-quantity-${item.id}`} className="text-xs">
                      {t.fulfillmentCreateForm.quantityLabel}
                    </Label>
                    <Input
                      id={`${formId}-quantity-${item.id}`}
                      name={`quantity_${item.id}`}
                      type="number"
                      min={1}
                      max={item.quantity}
                      defaultValue={item.quantity}
                      inputMode="numeric"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div>
              <Button type="submit" loading={isPending} disabled={isPending}>
                {isPending ? t.fulfillmentCreateForm.submitting : t.fulfillmentCreateForm.submit}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

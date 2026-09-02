"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import { createReturnAction } from "@/app/orders/[orderId]/returns/actions";
import type { OrderDetailItemDto } from "@/lib/api/orders";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * The "open a return request" form (T5.3), shown on `app/orders/[orderId]/returns/page.tsx`
 * whenever `fetchReturnByOrder` comes back `not_found`. `orderRef` is the page's own `orderId`
 * param (hidden field, re-derived by the action from `FormData` rather than trusted from a closure
 * — same discipline every other write action in this app follows). Items are picked from the
 * order's real line items (`fetchOrder`, passed in as `items`) — the operator can never free-type
 * an `orderItemRef`/`productRef`, only toggle which real order items are included and adjust
 * quantity/reason per item, per the brief's own instruction.
 *
 * One checkbox per order item drives inclusion (`includeItem`, value = the item's id — reading
 * `getAll("includeItem")` in the action gives the included `orderItemRef`s directly, no positional
 * array alignment needed). The item's `productRef` and the operator's quantity/reasonCode/
 * reasonNote are each read back by a field name keyed on that same id
 * (`productRef_<id>`/`quantity_<id>`/...), so every field is looked up explicitly rather than by
 * array position — robust to items being reordered or a row's checkbox being left unchecked.
 */
export function ReturnCreateForm({
  orderId,
  items,
  t,
}: {
  readonly orderId: string;
  readonly items: readonly OrderDetailItemDto[];
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(createReturnAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.returnCreateForm.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.returnCreateForm.noItems}</p>
        ) : (
          <form action={formAction} className="flex flex-col gap-6">
            <input type="hidden" name="orderRef" value={orderId} />
            <p className="text-muted-foreground text-sm">{t.returnCreateForm.subtitle}</p>

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
                <div key={item.id} className="border-border grid gap-3 rounded-xl border p-4 sm:grid-cols-[auto_1fr_1fr_1fr]">
                  <div className="flex items-start gap-2 sm:col-span-4">
                    <input
                      type="checkbox"
                      id={`${formId}-include-${item.id}`}
                      name="includeItem"
                      value={item.id}
                      className="mt-0.5"
                    />
                    <input type="hidden" name={`productRef_${item.id}`} value={item.productId} />
                    <Label htmlFor={`${formId}-include-${item.id}`} className="font-medium">
                      {t.returnCreateForm.includeItem} — {item.name} × {item.quantity}
                    </Label>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${formId}-quantity-${item.id}`} className="text-xs">
                      {t.returnCreateForm.quantityLabel}
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
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${formId}-reasonCode-${item.id}`} className="text-xs">
                      {t.returnCreateForm.reasonCodeLabel}
                    </Label>
                    <Input id={`${formId}-reasonCode-${item.id}`} name={`reasonCode_${item.id}`} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${formId}-reasonNote-${item.id}`} className="text-xs">
                      {t.returnCreateForm.reasonNoteLabel}
                    </Label>
                    <Input id={`${formId}-reasonNote-${item.id}`} name={`reasonNote_${item.id}`} />
                  </div>
                </div>
              ))}
            </div>

            <div>
              <Button type="submit" loading={isPending} disabled={isPending}>
                {isPending ? t.returnCreateForm.submitting : t.returnCreateForm.submit}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

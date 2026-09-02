"use client";

import { useActionState, useId, useState } from "react";
import { AlertTriangleIcon, PlusIcon, XIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import { createShipmentAction } from "@/app/orders/[orderId]/shipment/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

interface PackageRow {
  readonly key: string;
}

let nextPackageRowKey = 0;
function newPackageRowKey(): string {
  nextPackageRowKey += 1;
  return `shipment-package-row-${nextPackageRowKey}`;
}

/**
 * The "open a shipment" form (T5.4), shown on `app/orders/[orderId]/shipment/page.tsx` whenever
 * `fetchShipmentByFulfillment` comes back `not_found` (and a fulfillment order does exist —
 * checked by the page before this renders at all, per the ruling: "if there is no fulfillment yet,
 * there cannot be a shipment either"). `fulfillmentRef` is the fulfillment order's own id (hidden
 * field, re-derived by the action from `FormData`, never trusted from a closure).
 *
 * `POST /shipments`'s body (`packages: { reference, itemRefs: string[], weightGrams }[]`) has no
 * natural picker source the way Fulfillment's/Returns' item pickers do — a shipment's packages are
 * an operator-defined packing plan (which order-item refs went in which box, and its weight), not a
 * 1:1 reflection of the order's line items. Per the brief ("build a simple repeated-package-row
 * form, reference/itemRefs/weightGrams"), this is a plain repeated-row array, same technique
 * `OrderLineItemsField` (T5.2) uses: one `name="packageReference"`/`"packageItemRefs"`/
 * `"packageWeightGrams"` per row, read back positionally by `parsePackages` in `actions.ts`.
 * `itemRefs` is entered as a comma-separated list and split on submit.
 */
export function ShipmentCreateForm({
  orderId,
  fulfillmentOrderId,
  t,
}: {
  readonly orderId: string;
  readonly fulfillmentOrderId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(createShipmentAction, INITIAL_STATE);
  const [rows, setRows] = useState<readonly PackageRow[]>([{ key: newPackageRowKey() }]);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  function addRow(): void {
    setRows((current) => [...current, { key: newPackageRowKey() }]);
  }

  function removeRow(key: string): void {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.key !== key) : current));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.shipmentCreateForm.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-6">
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="fulfillmentRef" value={fulfillmentOrderId} />
          <p className="text-muted-foreground text-sm">{t.shipmentCreateForm.subtitle}</p>

          {state.status === "error" && (
            <div
              role="alert"
              className="border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground flex items-center gap-2 rounded-xl border px-4 py-3 text-sm"
            >
              <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
              <span>{state.message}</span>
            </div>
          )}
          {fieldErrors["packages"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["packages"]}</p>
          )}

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t.shipmentCreateForm.packages}</h2>
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                <PlusIcon aria-hidden="true" />
                {t.shipmentCreateForm.addPackage}
              </Button>
            </div>

            <div className="flex flex-col gap-3">
              {rows.map((row, index) => (
                <div
                  key={row.key}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.4fr_8rem_2.5rem]"
                >
                  <div className="flex flex-col gap-1.5">
                    <Label
                      htmlFor={`${formId}-package-reference-${index}`}
                      className={index > 0 ? "sr-only" : undefined}
                    >
                      {t.shipmentCreateForm.referenceLabel}
                    </Label>
                    <Input id={`${formId}-package-reference-${index}`} name="packageReference" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label
                      htmlFor={`${formId}-package-itemRefs-${index}`}
                      className={index > 0 ? "sr-only" : undefined}
                    >
                      {t.shipmentCreateForm.itemRefsLabel}
                    </Label>
                    <Input
                      id={`${formId}-package-itemRefs-${index}`}
                      name="packageItemRefs"
                      placeholder={t.shipmentCreateForm.itemRefsPlaceholder}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label
                      htmlFor={`${formId}-package-weight-${index}`}
                      className={index > 0 ? "sr-only" : undefined}
                    >
                      {t.shipmentCreateForm.weightGramsLabel}
                    </Label>
                    <Input
                      id={`${formId}-package-weight-${index}`}
                      name="packageWeightGrams"
                      inputMode="numeric"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={index === 0 ? "mt-6" : undefined}
                    disabled={rows.length === 1}
                    onClick={() => removeRow(row.key)}
                    aria-label={t.shipmentCreateForm.removePackage}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <Button type="submit" loading={isPending} disabled={isPending}>
              {isPending ? t.shipmentCreateForm.submitting : t.shipmentCreateForm.submit}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

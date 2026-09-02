"use client";

import { useId, useState, type ComponentProps } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

interface ItemRow {
  readonly key: string;
}

let nextItemRowKey = 0;
function newItemRowKey(): string {
  nextItemRowKey += 1;
  return `order-item-row-${nextItemRowKey}`;
}

/**
 * The repeated-field-group form array for order line items (`itemProductId`/`itemName`/
 * `itemUnitPriceAmountMinor`/`itemQuantity`, one set of inputs per row) — the same technique
 * `app/products/actions.ts`'s `parseVariants` / `ProductCreateForm`'s variant rows use, reused
 * here for `placeOrderAction`/`createOrderFromCheckoutAction`'s `parseLineItems`. Shared by both
 * `OrderCreateForm` and `OrderFromCheckoutForm` since `placeOrderBody`/`createOrderFromCheckoutBody`
 * declare identical per-item fields.
 */
export function OrderLineItemsField({
  t,
  fieldErrors,
}: {
  readonly t: Dictionary;
  readonly fieldErrors: Readonly<Record<string, string>>;
}) {
  const [rows, setRows] = useState<readonly ItemRow[]>([{ key: newItemRowKey() }]);
  const formId = useId();

  function addRow(): void {
    setRows((current) => [...current, { key: newItemRowKey() }]);
  }

  function removeRow(key: string): void {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.key !== key) : current));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t.orderLineItemForm.items}</h2>
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <PlusIcon aria-hidden="true" />
          {t.orderLineItemForm.addItem}
        </Button>
      </div>

      {fieldErrors["items"] !== undefined && (
        <p className="text-destructive text-sm">{fieldErrors["items"]}</p>
      )}

      <div className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <div
            key={row.key}
            className="grid grid-cols-1 gap-3 sm:grid-cols-[1.2fr_1.2fr_1fr_6rem_2.5rem]"
          >
            <ItemField
              id={`${formId}-item-productId-${index}`}
              name="itemProductId"
              label={t.orderLineItemForm.productId}
              hideLabel={index > 0}
            />
            <ItemField
              id={`${formId}-item-name-${index}`}
              name="itemName"
              label={t.orderLineItemForm.name}
              hideLabel={index > 0}
            />
            <ItemField
              id={`${formId}-item-price-${index}`}
              name="itemUnitPriceAmountMinor"
              label={t.orderLineItemForm.unitPrice}
              hideLabel={index > 0}
              inputMode="numeric"
            />
            <ItemField
              id={`${formId}-item-quantity-${index}`}
              name="itemQuantity"
              label={t.orderLineItemForm.quantity}
              hideLabel={index > 0}
              inputMode="numeric"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={index === 0 ? "mt-6" : undefined}
              disabled={rows.length === 1}
              onClick={() => removeRow(row.key)}
              aria-label={t.orderLineItemForm.removeItem}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ItemField({
  id,
  name,
  label,
  hideLabel = false,
  ...inputProps
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly hideLabel?: boolean;
} & Omit<ComponentProps<"input">, "id" | "name">) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
        {label}
      </Label>
      <Input id={id} name={name} {...inputProps} />
    </div>
  );
}

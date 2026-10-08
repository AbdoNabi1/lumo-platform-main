"use client";

import { Card, CardContent, CardHeader, CardTitle, Input } from "@platform/ui";
import type { Dictionary } from "@/messages/en";
import { Field, PRODUCT_FORM_ID } from "./field";

/** SKU and barcode. Stock quantities live in the stock card (Plan 2B), not here. */
export function InventoryIdentifiersCard({
  sku,
  barcode,
  isCreate,
  errors,
  t,
}: {
  readonly sku: string;
  readonly barcode: string;
  readonly isCreate: boolean;
  readonly errors: Readonly<Record<string, string>>;
  readonly t: Dictionary;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.productEditor.inventoryCard}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label={t.productEditor.sku} name="sku" error={errors["sku"]} form={PRODUCT_FORM_ID}>
          {(control) => (
            <Input
              {...control}
              defaultValue={sku}
              placeholder={isCreate ? t.productEditor.skuAuto : undefined}
            />
          )}
        </Field>
        <Field
          label={t.productEditor.barcode}
          name="barcode"
          error={errors["barcode"]}
          form={PRODUCT_FORM_ID}
        >
          {(control) => <Input {...control} defaultValue={barcode} />}
        </Field>
      </CardContent>
    </Card>
  );
}

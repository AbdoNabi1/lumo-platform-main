"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Input } from "@platform/ui";
import { fromMinorUnits } from "@/lib/products/money";
import type { Dictionary } from "@/messages/en";
import { Switch } from "./controls";
import { Field, NativeSelect, PRODUCT_FORM_ID } from "./field";

/** A stored weight of 1000 g or more reads better in kg ("1.5"); anything lighter stays in g. */
export function weightDefaults(grams: number | null): { value: string; unit: "g" | "kg" } {
  if (grams === null) return { value: "", unit: "g" };
  if (grams < 1000) return { value: String(grams), unit: "g" };
  // Three decimals in kg is exactly grams; drop the trailing zeros ("1.500" → "1.5", "2.000" → "2").
  const kilograms = fromMinorUnits(grams, "KWD").replace(/0+$/, "").replace(/\.$/, "");
  return { value: kilograms, unit: "kg" };
}

/**
 * What follows the "Physical product" switch: the weight and its unit while it is on, a hint while
 * it is off. The weight row is hidden, not unmounted, so the stored weight survives toggling the
 * switch off and on, and is still posted.
 */
export function ShippingBody({
  physical,
  weightGrams,
  errors,
  t,
  form,
}: {
  readonly physical: boolean;
  readonly weightGrams: number | null;
  readonly errors: Readonly<Record<string, string>>;
  readonly t: Dictionary;
  readonly form: string | undefined;
}) {
  const weight = weightDefaults(weightGrams);
  return (
    <>
      <div hidden={!physical} className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field label={t.productEditor.weight} name="weight" error={errors["weight"]} form={form}>
          {(control) => <Input {...control} inputMode="decimal" defaultValue={weight.value} />}
        </Field>
        <Field label={t.productEditor.weightUnit} name="weightUnit" form={form}>
          {(control) => (
            <NativeSelect {...control} defaultValue={weight.unit}>
              <option value="g">{t.productEditor.grams}</option>
              <option value="kg">{t.productEditor.kilograms}</option>
            </NativeSelect>
          )}
        </Field>
      </div>
      {!physical && (
        <p className="text-muted-foreground text-sm">{t.productEditor.notPhysicalHint}</p>
      )}
    </>
  );
}

export function ShippingCard({
  requiresShipping,
  weightGrams,
  errors,
  t,
}: {
  readonly requiresShipping: boolean;
  readonly weightGrams: number | null;
  readonly errors: Readonly<Record<string, string>>;
  readonly t: Dictionary;
}) {
  const [physical, setPhysical] = useState(requiresShipping);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.productEditor.shippingCard}</CardTitle>
        <Switch
          name="requiresShipping"
          form={PRODUCT_FORM_ID}
          label={t.productEditor.physicalProduct}
          checked={physical}
          onCheckedChange={setPhysical}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ShippingBody
          physical={physical}
          weightGrams={weightGrams}
          errors={errors}
          t={t}
          form={PRODUCT_FORM_ID}
        />
      </CardContent>
    </Card>
  );
}

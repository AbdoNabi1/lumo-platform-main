"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Input } from "@platform/ui";
import { fromMinorUnits } from "@/lib/products/money";
import type { Dictionary } from "@/messages/en";
import { CheckboxRow, Field, NativeSelect, PRODUCT_FORM_ID } from "./field";

/** A stored weight of 1000 g or more reads better in kg ("1.5"); anything lighter stays in g. */
export function weightDefaults(grams: number | null): { value: string; unit: "g" | "kg" } {
  if (grams === null) return { value: "", unit: "g" };
  if (grams < 1000) return { value: String(grams), unit: "g" };
  // Three decimals in kg is exactly grams; drop the trailing zeros ("1.500" → "1.5", "2.000" → "2").
  const kilograms = fromMinorUnits(grams, "KWD").replace(/0+$/, "").replace(/\.$/, "");
  return { value: kilograms, unit: "kg" };
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
  const weight = weightDefaults(weightGrams);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.productEditor.shippingCard}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <CheckboxRow
          name="requiresShipping"
          form={PRODUCT_FORM_ID}
          label={t.productEditor.physicalProduct}
          checked={physical}
          onChange={(event) => setPhysical(event.target.checked)}
        />
        {/* Hidden, not unmounted: the stored weight must survive toggling the checkbox off and on. */}
        <div hidden={!physical} className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <Field
            label={t.productEditor.weight}
            name="weight"
            error={errors["weight"]}
            form={PRODUCT_FORM_ID}
          >
            {(control) => <Input {...control} inputMode="decimal" defaultValue={weight.value} />}
          </Field>
          <Field label={t.productEditor.weightUnit} name="weightUnit" form={PRODUCT_FORM_ID}>
            {(control) => (
              <NativeSelect {...control} defaultValue={weight.unit}>
                <option value="g">{t.productEditor.grams}</option>
                <option value="kg">{t.productEditor.kilograms}</option>
              </NativeSelect>
            )}
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}

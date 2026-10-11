"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Input } from "@platform/ui";
import type { WeightUnit } from "@/lib/api/store-settings";
import { fromGrams } from "@/lib/products/weight";
import type { Dictionary } from "@/messages/en";
import { Switch } from "./controls";
import { Field, PRODUCT_FORM_ID } from "./field";

function unitLabel(unit: WeightUnit, t: Dictionary): string {
  const editor = t.productEditor;
  return { g: editor.grams, kg: editor.kilograms, lb: editor.pounds, oz: editor.ounces }[unit];
}

/**
 * What follows the "Physical product" switch: the weight while it is on, a hint while it is off. The
 * weight is typed and shown in the store's weight unit (Settings → General) and stored as grams; the
 * unit travels in a hidden `weightUnit` field. The weight row is hidden, not unmounted, so the stored
 * weight survives toggling the switch off and on, and is still posted.
 */
export function ShippingBody({
  physical,
  weightGrams,
  weightUnit,
  errors,
  t,
  form,
}: {
  readonly physical: boolean;
  readonly weightGrams: number | null;
  readonly weightUnit: WeightUnit;
  readonly errors: Readonly<Record<string, string>>;
  readonly t: Dictionary;
  readonly form: string | undefined;
}) {
  return (
    <>
      <div hidden={!physical}>
        <Field
          label={`${t.productEditor.weight} (${unitLabel(weightUnit, t)})`}
          name="weight"
          error={errors["weight"]}
          form={form}
        >
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              defaultValue={fromGrams(weightGrams, weightUnit)}
            />
          )}
        </Field>
        <input type="hidden" name="weightUnit" value={weightUnit} form={form} />
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
  weightUnit,
  errors,
  t,
}: {
  readonly requiresShipping: boolean;
  readonly weightGrams: number | null;
  readonly weightUnit: WeightUnit;
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
          weightUnit={weightUnit}
          errors={errors}
          t={t}
          form={PRODUCT_FORM_ID}
        />
      </CardContent>
    </Card>
  );
}

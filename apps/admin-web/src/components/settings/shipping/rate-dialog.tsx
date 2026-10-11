"use client";

import { useActionState, useEffect, useState } from "react";
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from "@platform/ui";
import { saveRateAction } from "@/app/settings/shipping/actions";
import { MoneyInput } from "@/components/products/editor/controls";
import { Field } from "@/components/products/editor/field";
import type { FormState } from "@/lib/api/mutation";
import type { WeightUnit } from "@/lib/api/store-settings";
import type { Locale } from "@/lib/i18n";
import { fromMinorUnits } from "@/lib/products/money";
import { fromGrams } from "@/lib/products/weight";
import type { RateDto } from "@/lib/shipping/zones";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

type ConditionType = "none" | "weight" | "orderPrice";

function unitLabel(unit: WeightUnit, editor: Dictionary["productEditor"]): string {
  return { g: editor.grams, kg: editor.kilograms, lb: editor.pounds, oz: editor.ounces }[unit];
}

/** The bounds as the inputs show them: grams in the store's unit, minor units in the store currency. */
function initialBounds(
  rate: RateDto | null,
  currency: string,
  weightUnit: WeightUnit,
): { min: string; max: string } {
  const condition = rate?.condition;
  if (condition?.type === "weight") {
    return {
      min: condition.minGrams === undefined ? "" : fromGrams(condition.minGrams, weightUnit),
      max: condition.maxGrams === undefined ? "" : fromGrams(condition.maxGrams, weightUnit),
    };
  }
  if (condition?.type === "orderPrice") {
    return {
      min: condition.minMinor === undefined ? "" : fromMinorUnits(condition.minMinor, currency),
      max: condition.maxMinor === undefined ? "" : fromMinorUnits(condition.maxMinor, currency),
    };
  }
  return { min: "", max: "" };
}

/**
 * Plan 3C — add or edit a shipping rate (Shopify: "Add rate"): the name customers see, an optional
 * description, the price (with a "Free" shortcut) and optional conditions — by item weight (in the
 * store's unit) or by order price (in the store currency). Amounts travel as typed text; the server
 * action reads them in the store's currency and unit.
 */
export function RateDialogContent({
  zoneId,
  rate,
  currency,
  weightUnit,
  onClose,
  t,
  locale,
}: {
  readonly zoneId: string;
  readonly rate: RateDto | null;
  readonly currency: string;
  readonly weightUnit: WeightUnit;
  readonly onClose: () => void;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const copy = t.shippingSettings;
  const [state, formAction, isPending] = useActionState(saveRateAction, INITIAL_STATE);
  const errors = state.status === "error" ? state.fieldErrors : {};
  const [name, setName] = useState(rate?.name ?? "");
  const [description, setDescription] = useState(rate?.description ?? "");
  const [price, setPrice] = useState(
    rate === null ? "" : fromMinorUnits(rate.priceMinor, currency),
  );
  const [type, setType] = useState<ConditionType>(
    rate?.condition.type === "weight" || rate?.condition.type === "orderPrice"
      ? rate.condition.type
      : "none",
  );
  const [bounds, setBounds] = useState(() => initialBounds(rate, currency, weightUnit));

  useEffect(() => {
    if (state.status === "success") onClose();
  }, [state, onClose]);

  const unit = unitLabel(weightUnit, t.productEditor);
  const options: readonly { readonly value: ConditionType; readonly label: string }[] = [
    { value: "none", label: copy.conditionNone },
    { value: "weight", label: copy.conditionWeight },
    { value: "orderPrice", label: copy.conditionPrice },
  ];

  return (
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{rate === null ? copy.addRate : copy.editRate}</DialogTitle>
        <DialogDescription className="sr-only">{copy.rates}</DialogDescription>
      </DialogHeader>

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="zoneId" value={zoneId} />
        {rate !== null && <input type="hidden" name="rateId" value={rate.id} />}

        <Field label={copy.rateName} name="name" hint={copy.rateNameHint} error={errors["name"]}>
          {(control) => (
            <Input
              {...control}
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>

        <Field
          label={copy.description}
          name="description"
          hint={copy.descriptionHint}
          error={errors["description"]}
        >
          {(control) => (
            <Input
              {...control}
              maxLength={200}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>

        <div className="flex items-end gap-2">
          <Field label={copy.price} name="price" error={errors["price"]} className="flex-1">
            {(control) => (
              <MoneyInput
                id={control.id}
                name={control.name}
                invalid={control["aria-invalid"] === true}
                describedBy={control["aria-describedby"]}
                label={copy.price}
                currency={currency}
                locale={locale}
                value={price}
                onValueChange={setPrice}
              />
            )}
          </Field>
          <Button
            type="button"
            variant="outline"
            onClick={() => setPrice(fromMinorUnits(0, currency))}
          >
            {copy.free}
          </Button>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{copy.addConditions}</legend>
          {options.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="conditionType"
                value={option.value}
                checked={type === option.value}
                onChange={() => setType(option.value)}
                className="accent-primary size-4"
              />
              {option.label}
            </label>
          ))}
          {errors["condition"] !== undefined && (
            <p role="alert" className="text-destructive text-xs">
              {errors["condition"]}
            </p>
          )}
        </fieldset>

        {type !== "none" && (
          <div className="grid gap-4 sm:grid-cols-2">
            {(["min", "max"] as const).map((bound) => {
              const label = bound === "min" ? copy.minimum : copy.maximum;
              return (
                <Field
                  key={bound}
                  label={type === "weight" ? `${label} (${unit})` : label}
                  name={bound}
                  error={errors[bound]}
                >
                  {(control) =>
                    type === "weight" ? (
                      <Input
                        {...control}
                        inputMode="decimal"
                        value={bounds[bound]}
                        onChange={(event) =>
                          setBounds((current) => ({ ...current, [bound]: event.target.value }))
                        }
                      />
                    ) : (
                      <MoneyInput
                        id={control.id}
                        name={control.name}
                        invalid={control["aria-invalid"] === true}
                        describedBy={control["aria-describedby"]}
                        label={label}
                        currency={currency}
                        locale={locale}
                        value={bounds[bound]}
                        onValueChange={(value) =>
                          setBounds((current) => ({ ...current, [bound]: value }))
                        }
                      />
                    )
                  }
                </Field>
              );
            })}
          </div>
        )}

        {state.status === "error" && (
          <p role="alert" className="text-destructive text-sm">
            {state.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button type="submit" loading={isPending}>
            {isPending ? copy.saving : copy.save}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

"use client";

import { Button, Input } from "@platform/ui";
import { MoneyInput } from "@/components/products/editor/controls";
import { Field, NativeSelect } from "@/components/products/editor/field";
import type { Locale } from "@/lib/i18n";
import { fromMinorUnits } from "@/lib/products/money";
import {
  RATE_PRESETS,
  looksLikePrice,
  ratePreset,
  type RatePresetId,
} from "@/lib/shipping/quick-setup";
import type { RateDto } from "@/lib/shipping/zones";
import type { Dictionary } from "@/messages/en";

/** What the rate form holds while it is being filled; amounts stay as typed text. */
export interface RateFieldsValue {
  readonly preset: RatePresetId;
  readonly name: string;
  readonly description: string;
  readonly price: string;
}

/** A new rate starts as Standard; an existing one keeps its own values (Custom). */
export function initialRateFields(
  rate: RateDto | null,
  currency: string,
  locale: Locale,
): RateFieldsValue {
  if (rate === null) return { preset: "standard", ...ratePreset("standard", locale), price: "" };
  return {
    preset: "custom",
    name: rate.name,
    description: rate.description ?? "",
    price: fromMinorUnits(rate.priceMinor, currency),
  };
}

/** The input names the fields post under, so a dialog can keep them apart from its own. */
export interface RateFieldNames {
  readonly name: string;
  readonly description: string;
  readonly price: string;
}

const DEFAULT_NAMES: RateFieldNames = { name: "name", description: "description", price: "price" };

/**
 * Plan 3E — the preset, name, description and price of a shipping rate, shared by the rate dialog and
 * the zone dialog's first rate. A preset fills the name and the transit time in the admin's locale (as
 * editable text); a name that is only a number gets a warning, never a block.
 */
export function RateFields({
  value,
  onChange,
  currency,
  locale,
  t,
  errors,
  names = DEFAULT_NAMES,
}: {
  readonly value: RateFieldsValue;
  readonly onChange: (next: RateFieldsValue) => void;
  readonly currency: string;
  readonly locale: Locale;
  readonly t: Dictionary;
  readonly errors: Readonly<Record<string, string>>;
  readonly names?: RateFieldNames;
}) {
  const copy = t.shippingSettings;
  const presetLabels: Readonly<Record<RatePresetId, string>> = {
    standard: copy.presetStandard,
    express: copy.presetExpress,
    custom: copy.presetCustom,
  };

  return (
    <>
      <Field label={copy.ratePresetLabel} name="preset">
        {(control) => (
          <NativeSelect
            id={control.id}
            value={value.preset}
            onChange={(event) => {
              const preset = event.target.value as RatePresetId;
              onChange({ ...value, preset, ...ratePreset(preset, locale) });
            }}
          >
            {RATE_PRESETS.map((id) => (
              <option key={id} value={id}>
                {presetLabels[id]}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>

      <Field
        label={copy.rateName}
        name={names.name}
        hint={copy.rateNameHint}
        error={errors[names.name]}
      >
        {(control) => (
          <Input
            {...control}
            maxLength={80}
            value={value.name}
            onChange={(event) => onChange({ ...value, name: event.target.value })}
          />
        )}
      </Field>
      {looksLikePrice(value.name) && (
        <p role="status" className="text-muted-foreground -mt-2 text-xs">
          {copy.rateNameLooksLikePrice}
        </p>
      )}

      <Field
        label={copy.description}
        name={names.description}
        hint={copy.descriptionHint}
        error={errors[names.description]}
      >
        {(control) => (
          <Input
            {...control}
            maxLength={200}
            value={value.description}
            onChange={(event) => onChange({ ...value, description: event.target.value })}
          />
        )}
      </Field>

      <div className="flex items-end gap-2">
        <Field label={copy.price} name={names.price} error={errors[names.price]} className="flex-1">
          {(control) => (
            <MoneyInput
              id={control.id}
              name={control.name}
              invalid={control["aria-invalid"] === true}
              describedBy={control["aria-describedby"]}
              label={copy.price}
              currency={currency}
              locale={locale}
              value={value.price}
              onValueChange={(price) => onChange({ ...value, price })}
            />
          )}
        </Field>
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange({ ...value, price: fromMinorUnits(0, currency) })}
        >
          {copy.free}
        </Button>
      </div>
    </>
  );
}

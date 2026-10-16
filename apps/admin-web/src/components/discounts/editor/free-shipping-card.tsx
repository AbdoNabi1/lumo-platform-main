"use client";

import { useId } from "react";
import { COUNTRY_CODES } from "@platform/regions";
import { MoneyInput } from "@/components/products/editor/controls";
import { CheckboxRow } from "@/components/products/editor/field";
import type { Locale } from "@/lib/i18n";
import { countryName } from "@/lib/shipping/display";
import { ErrorText, FormCard, RadioRow, type CardProps } from "./inputs";
import { ResourcePicker } from "./resource-picker";

/** Free shipping: all countries or chosen ones, and an optional cap on the shipping rate. */
export function FreeShippingCard({
  values,
  set,
  errors,
  t,
  currency,
  locale,
}: CardProps & { readonly currency: string; readonly locale: Locale }) {
  const copy = t.discounts.form;
  const group = useId();
  const capId = useId();
  const searchCountries = (query: string) => {
    const needle = query.trim().toLocaleLowerCase(locale);
    const items = COUNTRY_CODES.map((code) => ({
      id: code,
      label: countryName(code, locale),
      detail: code,
    }))
      .filter(
        (item) =>
          needle === "" ||
          item.label.toLocaleLowerCase(locale).includes(needle) ||
          item.id.toLowerCase() === needle,
      )
      .sort((a, b) => a.label.localeCompare(b.label, locale));
    return Promise.resolve({ outcome: "ok" as const, items });
  };

  return (
    <>
      <FormCard title={copy.countries}>
        <RadioRow
          name={group}
          label={copy.allCountries}
          checked={values.allCountries}
          onChange={() => set({ allCountries: true })}
        />
        <RadioRow
          name={group}
          label={copy.selectedCountries}
          checked={!values.allCountries}
          onChange={() => set({ allCountries: false })}
        >
          <ResourcePicker
            title={copy.selectedCountries}
            searchLabel={copy.searchCountries}
            selected={values.countries}
            onChange={(countries) => set({ countries })}
            search={searchCountries}
            t={t}
            error={errors["countries"]}
          />
        </RadioRow>
      </FormCard>

      <FormCard title={copy.shippingRates}>
        <CheckboxRow
          label={copy.excludeRatesOver}
          checked={values.excludeRatesOver}
          onChange={(event) => set({ excludeRatesOver: event.target.checked })}
        />
        {values.excludeRatesOver && (
          <div className="flex flex-col gap-1.5 ps-6">
            <MoneyInput
              id={capId}
              name="maxShippingRate"
              label={copy.excludeRatesOver}
              currency={currency}
              locale={locale}
              value={values.maxShippingRate}
              onValueChange={(maxShippingRate) => set({ maxShippingRate })}
              invalid={errors["maxShippingRateMinor"] !== undefined}
              describedBy={
                errors["maxShippingRateMinor"] === undefined ? undefined : `${capId}-error`
              }
            />
            <ErrorText id={`${capId}-error`} message={errors["maxShippingRateMinor"]} />
          </div>
        )}
      </FormCard>
    </>
  );
}

"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Input } from "@platform/ui";
import { formatCurrency, formatPercent } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { SUPPORTED_CURRENCIES, toMinorUnits } from "@/lib/products/money";
import type { Dictionary } from "@/messages/en";
import { CheckboxRow, Field, NativeSelect, PRODUCT_FORM_ID } from "./field";

export interface PricingInitial {
  readonly price: string;
  readonly compareAtPrice: string;
  readonly costPerItem: string;
  readonly currency: string;
  readonly taxable: boolean;
}

/** Price, compare-at, cost and tax, with the profit and margin worked out live as you type. */
export function PricingCard({
  initial,
  errors,
  t,
  locale,
}: {
  readonly initial: PricingInitial;
  readonly errors: Readonly<Record<string, string>>;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const [price, setPrice] = useState(initial.price);
  const [cost, setCost] = useState(initial.costPerItem);
  const [currency, setCurrency] = useState(initial.currency);

  const priceMinor = toMinorUnits(price, currency);
  const costMinor = toMinorUnits(cost, currency);
  const profit = priceMinor !== null && costMinor !== null ? priceMinor - costMinor : null;
  const margin =
    profit !== null && priceMinor !== null && priceMinor > 0 ? profit / priceMinor : null;

  const currencies: readonly string[] = SUPPORTED_CURRENCIES.includes(
    initial.currency as (typeof SUPPORTED_CURRENCIES)[number],
  )
    ? SUPPORTED_CURRENCIES
    : [...SUPPORTED_CURRENCIES, initial.currency];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.productEditor.pricingCard}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_8rem]">
          <Field
            label={t.productEditor.price}
            name="price"
            error={errors["price"]}
            form={PRODUCT_FORM_ID}
          >
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            )}
          </Field>
          <Field
            label={t.productEditor.compareAtPrice}
            name="compareAtPrice"
            error={errors["compareAtPrice"]}
            hint={t.productEditor.compareAtHint}
            form={PRODUCT_FORM_ID}
          >
            {(control) => (
              <Input {...control} inputMode="decimal" defaultValue={initial.compareAtPrice} />
            )}
          </Field>
          <Field
            label={t.productEditor.currency}
            name="currency"
            error={errors["currency"]}
            form={PRODUCT_FORM_ID}
          >
            {(control) => (
              <NativeSelect
                {...control}
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              >
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>

        <CheckboxRow
          name="taxable"
          form={PRODUCT_FORM_ID}
          label={t.productEditor.chargeTax}
          defaultChecked={initial.taxable}
        />

        <div className="grid items-start gap-4 sm:grid-cols-3">
          <Field
            label={t.productEditor.costPerItem}
            name="costPerItem"
            error={errors["costPerItem"]}
            hint={t.productEditor.costHint}
            form={PRODUCT_FORM_ID}
          >
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-base font-medium leading-none">{t.productEditor.profit}</span>
            <span data-testid="profit" className="text-sm">
              {profit === null ? "—" : formatCurrency(locale, profit, currency)}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-base font-medium leading-none">{t.productEditor.margin}</span>
            <span data-testid="margin" className="text-sm">
              {margin === null ? "—" : formatPercent(locale, margin, 1)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

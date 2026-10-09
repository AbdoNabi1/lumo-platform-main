"use client";

import { useId, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { formatCurrency, formatPercent } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { SUPPORTED_CURRENCIES, toMinorUnits } from "@/lib/products/money";
import type { Dictionary } from "@/messages/en";
import { Chip, ChipPanel, ChipRow, MoneyInput, Switch } from "./controls";
import { Field, NativeSelect, PRODUCT_FORM_ID } from "./field";

export interface PricingInitial {
  readonly price: string;
  readonly compareAtPrice: string;
  readonly costPerItem: string;
  readonly currency: string;
  readonly taxable: boolean;
}

function formatted(locale: Locale, text: string, currency: string): string | undefined {
  const minor = toMinorUnits(text, currency);
  return minor === null ? undefined : formatCurrency(locale, minor, currency);
}

/**
 * The price, then Shopify's chips: compare-at, charge tax and cost per item, each showing its
 * value and opening its field. A chip starts open when its field holds a non-default value (and
 * while the server rejects it), so a merchant never has a value they cannot see. A closed chip's
 * field is hidden, not removed: it is still in the form and still saved.
 *
 * `currencyEditable` is false in the variant dialog, whose currency is the variant's own.
 */
export function PricingFields({
  initial,
  errors,
  t,
  locale,
  form,
  currencyEditable,
}: {
  readonly initial: PricingInitial;
  readonly errors: Readonly<Record<string, string>>;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly form: string | undefined;
  readonly currencyEditable: boolean;
}) {
  const editor = t.productEditor;
  const base = useId();
  // Controlled, so a failed Save does not reset what was typed (React 19 resets uncontrolled
  // inputs when a form action finishes).
  const [price, setPrice] = useState(initial.price);
  const [compareAt, setCompareAt] = useState(initial.compareAtPrice);
  const [cost, setCost] = useState(initial.costPerItem);
  const [currency, setCurrency] = useState(initial.currency);
  const [taxable, setTaxable] = useState(initial.taxable);
  const [open, setOpen] = useState(() => ({
    compareAt: initial.compareAtPrice !== "",
    tax: !initial.taxable,
    cost: initial.costPerItem !== "",
  }));
  const toggle = (key: keyof typeof open) =>
    setOpen((current) => ({ ...current, [key]: !current[key] }));
  const compareAtOpen = open.compareAt || errors["compareAtPrice"] !== undefined;
  const costOpen = open.cost || errors["costPerItem"] !== undefined;

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
    <div className="flex flex-col gap-4">
      <div className={currencyEditable ? "grid gap-3 sm:grid-cols-[1fr_8rem]" : undefined}>
        <Field label={editor.price} name="price" error={errors["price"]} form={form}>
          {(control) => (
            <MoneyInput
              id={control.id}
              name={control.name}
              form={control.form}
              invalid={control["aria-invalid"] === true}
              describedBy={control["aria-describedby"]}
              label={editor.price}
              currency={currency}
              locale={locale}
              value={price}
              onValueChange={setPrice}
            />
          )}
        </Field>
        {currencyEditable && (
          <Field label={editor.currency} name="currency" error={errors["currency"]} form={form}>
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
        )}
      </div>

      <ChipRow>
        <Chip
          label={editor.compareAtPrice}
          value={formatted(locale, compareAt, currency)}
          expanded={compareAtOpen}
          onToggle={() => toggle("compareAt")}
          controls={`${base}-compare-at`}
        />
        <Chip
          label={editor.chargeTax}
          value={taxable ? editor.yes : editor.no}
          expanded={open.tax}
          onToggle={() => toggle("tax")}
          controls={`${base}-tax`}
        />
        <Chip
          label={editor.costPerItem}
          value={formatted(locale, cost, currency)}
          expanded={costOpen}
          onToggle={() => toggle("cost")}
          controls={`${base}-cost`}
        />
      </ChipRow>

      <ChipPanel id={`${base}-compare-at`} open={compareAtOpen}>
        <Field
          label={editor.compareAtPrice}
          name="compareAtPrice"
          error={errors["compareAtPrice"]}
          hint={editor.compareAtHint}
          form={form}
        >
          {(control) => (
            <MoneyInput
              id={control.id}
              name={control.name}
              form={control.form}
              invalid={control["aria-invalid"] === true}
              describedBy={control["aria-describedby"]}
              label={editor.compareAtPrice}
              currency={currency}
              locale={locale}
              value={compareAt}
              onValueChange={setCompareAt}
            />
          )}
        </Field>
      </ChipPanel>

      <ChipPanel id={`${base}-tax`} open={open.tax}>
        <Switch
          name="taxable"
          form={form}
          label={editor.chargeTax}
          checked={taxable}
          onCheckedChange={setTaxable}
        />
      </ChipPanel>

      <ChipPanel id={`${base}-cost`} open={costOpen}>
        <div className="grid items-start gap-4 sm:grid-cols-3">
          <Field
            label={editor.costPerItem}
            name="costPerItem"
            error={errors["costPerItem"]}
            hint={editor.costHint}
            form={form}
            className="sm:col-span-3"
          >
            {(control) => (
              <MoneyInput
                id={control.id}
                name={control.name}
                form={control.form}
                invalid={control["aria-invalid"] === true}
                describedBy={control["aria-describedby"]}
                label={editor.costPerItem}
                currency={currency}
                locale={locale}
                value={cost}
                onValueChange={setCost}
              />
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-base font-medium leading-none">{editor.profit}</span>
            <span data-testid="profit" className="text-sm">
              {profit === null ? "—" : formatCurrency(locale, profit, currency)}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-base font-medium leading-none">{editor.margin}</span>
            <span data-testid="margin" className="text-sm">
              {margin === null ? "—" : formatPercent(locale, margin, 1)}
            </span>
          </div>
        </div>
      </ChipPanel>
    </div>
  );
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.productEditor.pricingCard}</CardTitle>
      </CardHeader>
      <CardContent>
        <PricingFields
          initial={initial}
          errors={errors}
          t={t}
          locale={locale}
          form={PRODUCT_FORM_ID}
          currencyEditable
        />
      </CardContent>
    </Card>
  );
}

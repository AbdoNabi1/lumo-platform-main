"use client";

import { useId } from "react";
import { Label } from "@platform/ui";
import { searchDiscountTargetsAction } from "@/app/discounts/actions";
import { MoneyInput } from "@/components/products/editor/controls";
import { CheckboxRow, NativeSelect } from "@/components/products/editor/field";
import type { Locale } from "@/lib/i18n";
import { ErrorText, FormCard, RadioRow, type CardProps } from "./inputs";
import { ResourcePicker } from "./resource-picker";

/** "Discount value" for amount off products / order: percentage or fixed amount, and for products, what it applies to. */
export function ValueCard({
  values,
  set,
  errors,
  t,
  currency,
  locale,
}: CardProps & { readonly currency: string; readonly locale: Locale }) {
  const copy = t.discounts.form;
  const valueId = useId();
  const groupName = useId();
  const forProducts = values.type === "amount_off_products";
  return (
    <FormCard title={copy.value}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={valueId}>{copy.value}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label={copy.valueType}
            value={values.valueKind}
            onChange={(event) =>
              set({
                valueKind: event.target.value === "fixed_amount" ? "fixed_amount" : "percentage",
              })
            }
          >
            <option value="percentage">{copy.percentage}</option>
            <option value="fixed_amount">{copy.fixedAmount}</option>
          </NativeSelect>
          <div className="min-w-32 flex-1">
            {values.valueKind === "percentage" ? (
              <div className="flex items-center gap-2">
                <input
                  id={valueId}
                  inputMode="decimal"
                  className="border-input bg-card h-9 w-full rounded-md border px-3 text-sm"
                  value={values.valueAmount}
                  aria-invalid={errors["value"] === undefined ? undefined : true}
                  aria-describedby={errors["value"] === undefined ? undefined : `${valueId}-error`}
                  onChange={(event) => set({ valueAmount: event.target.value })}
                />
                <span aria-hidden="true" className="text-muted-foreground text-sm">
                  %
                </span>
              </div>
            ) : (
              <MoneyInput
                id={valueId}
                name="valueAmount"
                label={copy.value}
                currency={currency}
                locale={locale}
                value={values.valueAmount}
                onValueChange={(valueAmount) => set({ valueAmount })}
                invalid={errors["value"] !== undefined}
                describedBy={errors["value"] === undefined ? undefined : `${valueId}-error`}
              />
            )}
          </div>
        </div>
        <ErrorText id={`${valueId}-error`} message={errors["value"]} />
      </div>

      {forProducts && (
        <div className="flex flex-col gap-2">
          <span className="text-sm">{copy.appliesTo}</span>
          <div className="flex flex-wrap gap-4">
            <RadioRow
              name={groupName}
              label={copy.specificCategories}
              checked={values.appliesToKind === "categories"}
              onChange={() => set({ appliesToKind: "categories", appliesToItems: [] })}
            />
            <RadioRow
              name={groupName}
              label={copy.specificProducts}
              checked={values.appliesToKind === "products"}
              onChange={() => set({ appliesToKind: "products", appliesToItems: [] })}
            />
          </div>
          <ResourcePicker
            title={
              values.appliesToKind === "categories"
                ? copy.specificCategories
                : copy.specificProducts
            }
            searchLabel={
              values.appliesToKind === "categories" ? copy.searchCategories : copy.searchProducts
            }
            selected={values.appliesToItems}
            onChange={(appliesToItems) => set({ appliesToItems })}
            search={(query) => searchDiscountTargetsAction(values.appliesToKind, query)}
            t={t}
            error={errors["appliesTo"]}
          />
          {values.valueKind === "fixed_amount" && (
            <div className="flex flex-col gap-1">
              <CheckboxRow
                label={copy.oncePerOrder}
                checked={values.appliesOncePerOrder}
                onChange={(event) => set({ appliesOncePerOrder: event.target.checked })}
              />
              <p className="text-muted-foreground ps-6 text-xs">{copy.oncePerOrderHint}</p>
            </div>
          )}
        </div>
      )}
    </FormCard>
  );
}

"use client";

import { useId } from "react";
import { searchDiscountTargetsAction } from "@/app/discounts/actions";
import { MoneyInput } from "@/components/products/editor/controls";
import { CheckboxRow, NativeSelect } from "@/components/products/editor/field";
import type { TargetScope } from "@/lib/discounts/model";
import type { Locale } from "@/lib/i18n";
import { ErrorText, FormCard, RadioGroup, RadioRow, TextField, type CardProps } from "./inputs";
import { ResourcePicker } from "./resource-picker";

/** Buy X get Y: "Customer buys" and "Customer gets", as two cards in Shopify's order. */
export function BuysGetsCard({
  values,
  set,
  errors,
  t,
  currency,
  locale,
}: CardProps & { readonly currency: string; readonly locale: Locale }) {
  const copy = t.discounts.form;
  const buysGroup = useId();
  const effectGroup = useId();
  const buysValueId = useId();
  const scopeOf = (value: string): TargetScope =>
    value === "categories" ? "categories" : "products";

  return (
    <>
      <FormCard title={copy.customerBuys}>
        <RadioGroup label={copy.customerBuys}>
          <RadioRow
            name={buysGroup}
            label={copy.minQuantityOfItems}
            checked={values.buysKind === "quantity"}
            onChange={() => set({ buysKind: "quantity", buysValue: "" })}
          />
          <RadioRow
            name={buysGroup}
            label={copy.minPurchaseAmount}
            checked={values.buysKind === "amount"}
            onChange={() => set({ buysKind: "amount", buysValue: "" })}
          />
        </RadioGroup>
        <div className="grid gap-3 sm:grid-cols-2">
          {values.buysKind === "quantity" ? (
            <TextField
              label={copy.quantity}
              inputMode="numeric"
              value={values.buysValue}
              onValueChange={(buysValue) => set({ buysValue })}
              error={errors["buys"]}
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={buysValueId} className="text-sm font-medium">
                {copy.amount}
              </label>
              <MoneyInput
                id={buysValueId}
                name="buysValue"
                label={copy.amount}
                currency={currency}
                locale={locale}
                value={values.buysValue}
                onValueChange={(buysValue) => set({ buysValue })}
                invalid={errors["buys"] !== undefined}
                describedBy={errors["buys"] === undefined ? undefined : `${buysValueId}-error`}
              />
              <ErrorText id={`${buysValueId}-error`} message={errors["buys"]} />
            </div>
          )}
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {copy.anyItemsFrom}
            <NativeSelect
              value={values.buysScope}
              onChange={(event) => set({ buysScope: scopeOf(event.target.value), buysItems: [] })}
            >
              <option value="products">{copy.specificProducts}</option>
              <option value="categories">{copy.specificCategories}</option>
            </NativeSelect>
          </label>
        </div>
        <ResourcePicker
          title={
            values.buysScope === "categories" ? copy.specificCategories : copy.specificProducts
          }
          searchLabel={
            values.buysScope === "categories" ? copy.searchCategories : copy.searchProducts
          }
          selected={values.buysItems}
          onChange={(buysItems) => set({ buysItems })}
          search={(query) => searchDiscountTargetsAction(values.buysScope, query)}
          t={t}
          error={errors["buysItems"]}
        />
      </FormCard>

      <FormCard title={copy.customerGets}>
        <p className="text-muted-foreground text-xs">{copy.getsHint}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label={copy.quantity}
            inputMode="numeric"
            value={values.getsQuantity}
            onValueChange={(getsQuantity) => set({ getsQuantity })}
            error={errors["gets"]}
          />
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {copy.anyItemsFrom}
            <NativeSelect
              value={values.getsScope}
              onChange={(event) => set({ getsScope: scopeOf(event.target.value), getsItems: [] })}
            >
              <option value="products">{copy.specificProducts}</option>
              <option value="categories">{copy.specificCategories}</option>
            </NativeSelect>
          </label>
        </div>
        <ResourcePicker
          title={
            values.getsScope === "categories" ? copy.specificCategories : copy.specificProducts
          }
          searchLabel={
            values.getsScope === "categories" ? copy.searchCategories : copy.searchProducts
          }
          selected={values.getsItems}
          onChange={(getsItems) => set({ getsItems })}
          search={(query) => searchDiscountTargetsAction(values.getsScope, query)}
          t={t}
          error={errors["getsItems"]}
        />
        <RadioGroup label={copy.atDiscountedValue} visible>
          <RadioRow
            name={effectGroup}
            label={copy.percentage}
            checked={values.getsEffect === "percentage"}
            onChange={() => set({ getsEffect: "percentage" })}
          >
            <TextField
              label={copy.percentage}
              inputMode="decimal"
              value={values.getsPercentage}
              onValueChange={(getsPercentage) => set({ getsPercentage })}
              error={errors["getsEffect"]}
              end={
                <span aria-hidden="true" className="text-muted-foreground text-sm">
                  %
                </span>
              }
            />
          </RadioRow>
          <RadioRow
            name={effectGroup}
            label={copy.free}
            checked={values.getsEffect === "free"}
            onChange={() => set({ getsEffect: "free" })}
          />
        </RadioGroup>
        <div className="flex flex-col gap-2">
          <CheckboxRow
            label={copy.maxUsesPerOrder}
            checked={values.limitUsesPerOrder}
            onChange={(event) => set({ limitUsesPerOrder: event.target.checked })}
          />
          {values.limitUsesPerOrder && (
            <TextField
              label={copy.maxUsesPerOrder}
              inputMode="numeric"
              className="ps-6"
              value={values.maxUsesPerOrder}
              onValueChange={(maxUsesPerOrder) => set({ maxUsesPerOrder })}
              error={errors["maxUsesPerOrder"]}
            />
          )}
        </div>
      </FormCard>
    </>
  );
}

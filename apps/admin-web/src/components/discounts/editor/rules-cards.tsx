"use client";

import { useId } from "react";
import { searchDiscountTargetsAction } from "@/app/discounts/actions";
import { MoneyInput } from "@/components/products/editor/controls";
import { CheckboxRow } from "@/components/products/editor/field";
import { discountClassOf, type DiscountClass } from "@/lib/api/discounts";
import type { Locale } from "@/lib/i18n";
import { ErrorText, FormCard, RadioGroup, RadioRow, TextField, type CardProps } from "./inputs";
import { ResourcePicker } from "./resource-picker";

/** "Minimum purchase requirements": none, an amount, or a quantity of items. Not for buy X get Y. */
export function MinimumCard({
  values,
  set,
  errors,
  t,
  currency,
  locale,
}: CardProps & { readonly currency: string; readonly locale: Locale }) {
  const copy = t.discounts.form;
  const group = useId();
  const amountId = useId();
  const error = errors["minimumRequirement"];
  return (
    <FormCard title={copy.minimumRequirements}>
      <RadioGroup label={copy.minimumRequirements}>
        <RadioRow
          name={group}
          label={copy.noMinimum}
          checked={values.minimumKind === "none"}
          onChange={() => set({ minimumKind: "none" })}
        />
        <RadioRow
          name={group}
          label={copy.minimumAmount.replace("{currency}", currency)}
          checked={values.minimumKind === "amount"}
          onChange={() => set({ minimumKind: "amount" })}
        >
          <div className="flex flex-col gap-1.5">
            <MoneyInput
              id={amountId}
              name="minimumAmount"
              label={copy.minimumAmount.replace("{currency}", currency)}
              currency={currency}
              locale={locale}
              value={values.minimumAmount}
              onValueChange={(minimumAmount) => set({ minimumAmount })}
              invalid={error !== undefined}
              describedBy={error === undefined ? undefined : `${amountId}-error`}
            />
            {values.type === "amount_off_products" && (
              <p className="text-muted-foreground text-xs">{copy.minimumProductsHint}</p>
            )}
            <ErrorText id={`${amountId}-error`} message={error} />
          </div>
        </RadioRow>
        <RadioRow
          name={group}
          label={copy.minimumQuantity}
          checked={values.minimumKind === "quantity"}
          onChange={() => set({ minimumKind: "quantity" })}
        >
          <TextField
            label={copy.minimumQuantity}
            inputMode="numeric"
            value={values.minimumQuantity}
            onValueChange={(minimumQuantity) => set({ minimumQuantity })}
            error={error}
            hint={values.type === "amount_off_products" ? copy.minimumProductsHint : undefined}
          />
        </RadioRow>
      </RadioGroup>
    </FormCard>
  );
}

/** "Customer eligibility": everyone, or customers picked from Customers. */
export function EligibilityCard({ values, set, errors, t }: CardProps) {
  const copy = t.discounts.form;
  const group = useId();
  return (
    <FormCard title={copy.eligibility}>
      <RadioGroup label={copy.eligibility}>
        <RadioRow
          name={group}
          label={copy.allCustomers}
          checked={values.allCustomers}
          onChange={() => set({ allCustomers: true })}
        />
        <RadioRow
          name={group}
          label={copy.specificCustomers}
          checked={!values.allCustomers}
          onChange={() => set({ allCustomers: false })}
        >
          <ResourcePicker
            title={copy.specificCustomers}
            searchLabel={copy.searchCustomers}
            selected={values.customers}
            onChange={(customers) => set({ customers })}
            search={(query) => searchDiscountTargetsAction("customers", query)}
            t={t}
            error={errors["customerEligibility"]}
          />
        </RadioRow>
      </RadioGroup>
    </FormCard>
  );
}

/** "Maximum discount uses" — codes only, as in Shopify. */
export function MaxUsesCard({ values, set, errors, t }: CardProps) {
  const copy = t.discounts.form;
  return (
    <FormCard title={copy.maxUses}>
      <CheckboxRow
        label={copy.limitTotal}
        checked={values.limitTotalUses}
        onChange={(event) => set({ limitTotalUses: event.target.checked })}
      />
      {values.limitTotalUses && (
        <TextField
          label={copy.limitTotal}
          inputMode="numeric"
          className="ps-6"
          value={values.usageLimit}
          onValueChange={(usageLimit) => set({ usageLimit })}
          error={errors["usageLimit"]}
        />
      )}
      <CheckboxRow
        label={copy.limitPerCustomer}
        checked={values.oncePerCustomer}
        onChange={(event) => set({ oncePerCustomer: event.target.checked })}
      />
    </FormCard>
  );
}

/** "Combinations": which classes this discount can be combined with; its own class reads "Other …". */
export function CombinationsCard({ values, set, t }: CardProps) {
  const copy = t.discounts.form;
  const own = discountClassOf(values.type);
  const labels: Readonly<Record<DiscountClass, readonly [string, string]>> = {
    product: [copy.combineProduct, copy.combineOtherProduct],
    order: [copy.combineOrder, copy.combineOtherOrder],
    shipping: [copy.combineShipping, copy.combineOtherShipping],
  };
  return (
    <FormCard title={copy.combinations}>
      <p className="text-muted-foreground text-sm">{copy.combinationsHint}</p>
      {(["product", "order", "shipping"] as const).map((kind) => (
        <CheckboxRow
          key={kind}
          label={labels[kind][kind === own ? 1 : 0]}
          checked={values.combinesWith[kind]}
          onChange={(event) =>
            set({ combinesWith: { ...values.combinesWith, [kind]: event.target.checked } })
          }
        />
      ))}
    </FormCard>
  );
}

/** "Active dates": start (required) and an optional end, in the store's time zone. */
export function ActiveDatesCard({
  values,
  set,
  errors,
  t,
  zone,
}: CardProps & { readonly zone: string }) {
  const copy = t.discounts.form;
  return (
    <FormCard title={copy.activeDates}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          type="date"
          label={copy.startDate}
          value={values.startDate}
          onValueChange={(startDate) => set({ startDate })}
          error={errors["startsAt"]}
        />
        <TextField
          type="time"
          label={copy.startTime.replace("{zone}", zone)}
          value={values.startTime}
          onValueChange={(startTime) => set({ startTime })}
        />
      </div>
      <CheckboxRow
        label={copy.setEndDate}
        checked={values.hasEndDate}
        onChange={(event) =>
          set(
            event.target.checked
              ? {
                  hasEndDate: true,
                  endDate: values.endDate === "" ? values.startDate : values.endDate,
                  endTime: values.endTime === "" ? "23:59" : values.endTime,
                }
              : { hasEndDate: false },
          )
        }
      />
      {values.hasEndDate && (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            type="date"
            label={copy.endDate}
            value={values.endDate}
            onValueChange={(endDate) => set({ endDate })}
            error={errors["endsAt"]}
          />
          <TextField
            type="time"
            label={copy.endTime.replace("{zone}", zone)}
            value={values.endTime}
            onValueChange={(endTime) => set({ endTime })}
          />
        </div>
      )}
    </FormCard>
  );
}

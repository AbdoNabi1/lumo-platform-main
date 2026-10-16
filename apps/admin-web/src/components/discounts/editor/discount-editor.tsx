"use client";

import { startTransition, useActionState, useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@platform/ui";
import { saveDiscountAction } from "@/app/discounts/actions";
import type { DiscountDto } from "@/lib/discounts/model";
import type { FormState } from "@/lib/api/mutation";
import { toDiscountInput, type DiscountFormValues } from "@/lib/discounts/form";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { BuysGetsCard } from "./buys-gets-card";
import { DiscountLifecycleActions } from "./discount-lifecycle-actions";
import { FreeShippingCard } from "./free-shipping-card";
import { MethodCard } from "./method-card";
import {
  ActiveDatesCard,
  CombinationsCard,
  EligibilityCard,
  MaxUsesCard,
  MinimumCard,
} from "./rules-cards";
import { PerformanceCard, SummaryCard } from "./summary-card";
import { ValueCard } from "./value-card";

const INITIAL_STATE: FormState = { status: "idle" };
const FORM_ID = "discount-editor";

/**
 * Phase 2 Part 2 — Shopify's discount form, for one type. Left: the type card, then the type's own
 * cards, minimum requirements, eligibility, maximum uses (codes only), combinations, active dates.
 * Right: the live Summary and, once saved, Performance. One `<form>` posts the whole form as JSON
 * (`payload`) to `saveDiscountAction`; the save bar says "Unsaved changes" while the form differs
 * from its starting point, and Discard puts every field back. The starting point is what was loaded,
 * then what was last saved: the page remounts the editor (by `key`) only when the saved discount
 * reads back differently, so a successful save also moves the starting point to the values it sent
 * ("10.00" saved as 10 is no longer "unsaved"). While there are unsaved changes the lifecycle
 * actions are hidden — their remount would drop the edits.
 */
export function DiscountEditor({
  mode,
  discount,
  initialValues,
  currency,
  timeZone,
  zone,
  t,
  locale,
}: {
  readonly mode: "create" | "edit";
  /** The saved discount; null in create mode. */
  readonly discount: DiscountDto | null;
  readonly initialValues: DiscountFormValues;
  readonly currency: string;
  /** The store's IANA zone; dates are typed in it. */
  readonly timeZone: string;
  /** Its short name for labels ("EET"). */
  readonly zone: string;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const [values, setValues] = useState(initialValues);
  /** What "Unsaved changes" compares against: what was loaded, then what was last saved. */
  const [baseline, setBaseline] = useState(initialValues);
  /** The values the pending submit sent, captured when the form is submitted. */
  const submitted = useRef<DiscountFormValues | null>(null);
  const save = useCallback(async (previous: FormState, formData: FormData): Promise<FormState> => {
    const sent = submitted.current;
    const next = await saveDiscountAction(previous, formData);
    // After an `await`, a state update needs its own transition to land with the action's result.
    if (next.status === "success" && sent !== null) startTransition(() => setBaseline(sent));
    return next;
  }, []);
  const [state, formAction, isPending] = useActionState(save, INITIAL_STATE);
  const set = useCallback(
    (patch: Partial<DiscountFormValues>) => setValues((current) => ({ ...current, ...patch })),
    [],
  );
  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(baseline),
    [values, baseline],
  );
  const { input } = useMemo(
    () => toDiscountInput(values, currency, timeZone),
    [values, currency, timeZone],
  );
  const errors: Readonly<Record<string, string>> =
    state.status === "error" ? state.fieldErrors : {};
  const copy = t.discounts.form;
  const cardProps = { values, set, errors, t };
  const moneyProps = { currency, locale };
  const amountOff = values.type === "amount_off_products" || values.type === "amount_off_order";

  return (
    <div className="flex flex-col gap-6">
      <form
        id={FORM_ID}
        action={formAction}
        onSubmit={() => {
          submitted.current = values;
        }}
      >
        <input type="hidden" name="payload" value={JSON.stringify(values)} />
        {discount !== null && <input type="hidden" name="discountId" value={discount.id} />}
      </form>

      {/* top-16: below the app shell's sticky header, as on the product page. */}
      <div className="bg-background/95 sticky top-16 z-20 flex flex-wrap items-center justify-end gap-3 py-2 backdrop-blur">
        {discount !== null && !dirty && (
          <div className="me-auto">
            <DiscountLifecycleActions discount={discount} t={t} />
          </div>
        )}
        {state.status === "error" && (
          <p role="alert" className="text-destructive text-sm">
            {state.message}
          </p>
        )}
        {dirty && <span className="text-muted-foreground text-sm">{copy.unsaved}</span>}
        {dirty && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setValues(baseline)}
            disabled={isPending}
          >
            {copy.discard}
          </Button>
        )}
        <Button
          type="submit"
          form={FORM_ID}
          loading={isPending}
          disabled={isPending || (mode === "edit" && !dirty)}
        >
          {isPending ? copy.saving : copy.save}
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <MethodCard {...cardProps} mode={mode} />
          {amountOff && <ValueCard {...cardProps} {...moneyProps} />}
          {values.type === "buy_x_get_y" && <BuysGetsCard {...cardProps} {...moneyProps} />}
          {values.type === "free_shipping" && <FreeShippingCard {...cardProps} {...moneyProps} />}
          {values.type !== "buy_x_get_y" && <MinimumCard {...cardProps} {...moneyProps} />}
          <EligibilityCard {...cardProps} />
          {values.method === "code" && <MaxUsesCard {...cardProps} />}
          <CombinationsCard {...cardProps} />
          <ActiveDatesCard {...cardProps} zone={zone} />
        </div>
        <div className="flex flex-col gap-6">
          <SummaryCard
            values={values}
            input={input}
            status={discount?.status ?? null}
            t={t}
            locale={locale}
            currency={currency}
            timeZone={timeZone}
          />
          {discount !== null && (
            <PerformanceCard usageCount={discount.usageCount} t={t} locale={locale} />
          )}
        </div>
      </div>
    </div>
  );
}

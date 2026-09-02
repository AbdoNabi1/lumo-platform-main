"use client";

import { useActionState, useId } from "react";
import { Button, Input, Label } from "@platform/ui";
import {
  activatePriceListAction,
  changePriceAction,
  createPriceAction,
  createPriceListAction,
  createPricingRuleAction,
  createTaxClassAction,
  publishPriceAction,
  type CreateFormState,
} from "@/app/pricing/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };
const INITIAL_CREATE_STATE: CreateFormState = { status: "idle" };

/**
 * T5.6 — the Pricing operations console's 7 independent forms (`app/pricing/page.tsx`). No
 * `GET` route exists anywhere in this domain (`docs/plans/BLOCKERS.md`'s T5.6 entry), so this
 * screen is a pure operations console, same discipline `inventory-operations-forms.tsx`'s T5.5
 * forms use — every `priceListId`/`productId`/`priceId`/`taxClassRef` field below is a plain text
 * input, not a picker, for the same reason. `CreatePriceListForm`/`CreatePriceForm`/
 * `CreateTaxClassForm`/`CreatePricingRuleForm` additionally render the created record's id after a
 * successful submit — the only way an operator will ever see it, since there is no list to browse
 * back to it later (the task brief's ruling).
 */

function FormError({ state }: { readonly state: FormState | CreateFormState }) {
  if (state.status !== "error") return null;
  return (
    <p role="alert" className="text-destructive text-xs">
      {state.message}
    </p>
  );
}

function FormSuccess({ state, t }: { readonly state: FormState; readonly t: Dictionary }) {
  if (state.status !== "success") return null;
  return (
    <p role="status" className="text-muted-foreground text-xs">
      {t.productWriteCommon.saved}
    </p>
  );
}

/**
 * Renders the id of a just-created record as selectable monospace text — `@platform/ui` has no
 * copy-button component (see its exports in `packages/ui/src/index.ts`), so this is the plain
 * "selectable text" fallback the task brief calls for.
 */
function CreatedIdNotice({ state, t }: { readonly state: CreateFormState; readonly t: Dictionary }) {
  if (state.status !== "success") return null;
  return (
    <p role="status" className="text-xs">
      <span className="text-muted-foreground">{t.pricingPage.createdIdLabel}: </span>
      <span className="select-all font-mono">{state.createdId}</span>
    </p>
  );
}

const selectClassName =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out";

export function CreatePriceListForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(
    createPriceListAction,
    INITIAL_CREATE_STATE,
  );
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t.pricingPage.createPriceListTitle}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-name`} className="text-xs">
            {t.pricingPage.nameLabel}
          </Label>
          <Input
            id={`${formId}-name`}
            name="name"
            className="h-9 w-56 text-sm"
            aria-invalid={fieldErrors["name"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-currency`} className="text-xs">
            {t.pricingPage.currencyLabel}
          </Label>
          <Input
            id={`${formId}-currency`}
            name="currency"
            maxLength={3}
            className="h-9 w-24 text-sm"
            aria-invalid={fieldErrors["currency"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
          {isPending ? t.pricingPage.creating : t.pricingPage.create}
        </Button>
      </div>
      <FormError state={state} />
      <CreatedIdNotice state={state} t={t} />
    </form>
  );
}

export function ActivatePriceListForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(activatePriceListAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t.pricingPage.activatePriceListTitle}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-priceListId`} className="text-xs">
            {t.pricingPage.priceListIdLabel}
          </Label>
          <Input
            id={`${formId}-priceListId`}
            name="priceListId"
            className="h-9 w-64 text-sm"
            aria-invalid={fieldErrors["priceListId"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
          {isPending ? t.pricingPage.activating : t.pricingPage.activate}
        </Button>
      </div>
      <FormError state={state} />
      <FormSuccess state={state} t={t} />
    </form>
  );
}

export function CreatePriceForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(createPriceAction, INITIAL_CREATE_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t.pricingPage.createPriceTitle}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-priceListId`} className="text-xs">
            {t.pricingPage.priceListIdLabel}
          </Label>
          <Input
            id={`${formId}-priceListId`}
            name="priceListId"
            className="h-9 w-48 text-sm"
            aria-invalid={fieldErrors["priceListId"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-productId`} className="text-xs">
            {t.pricingPage.productIdLabel}
          </Label>
          <Input
            id={`${formId}-productId`}
            name="productId"
            className="h-9 w-48 text-sm"
            aria-invalid={fieldErrors["productId"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-amountMinor`} className="text-xs">
            {t.pricingPage.amountMinorLabel}
          </Label>
          <Input
            id={`${formId}-amountMinor`}
            name="amountMinor"
            inputMode="numeric"
            className="h-9 w-32 text-sm"
            aria-invalid={fieldErrors["amountMinor"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-currency`} className="text-xs">
            {t.pricingPage.currencyLabel}
          </Label>
          <Input
            id={`${formId}-currency`}
            name="currency"
            maxLength={3}
            className="h-9 w-24 text-sm"
            aria-invalid={fieldErrors["currency"] !== undefined || undefined}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-compareAtMinor`} className="text-xs">
            {t.pricingPage.compareAtMinorLabel}
          </Label>
          <Input
            id={`${formId}-compareAtMinor`}
            name="compareAtMinor"
            inputMode="numeric"
            className="h-9 w-32 text-sm"
            aria-invalid={fieldErrors["compareAtMinor"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-costMinor`} className="text-xs">
            {t.pricingPage.costMinorLabel}
          </Label>
          <Input
            id={`${formId}-costMinor`}
            name="costMinor"
            inputMode="numeric"
            className="h-9 w-32 text-sm"
            aria-invalid={fieldErrors["costMinor"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-effectiveFrom`} className="text-xs">
            {t.pricingPage.effectiveFromLabel}
          </Label>
          <Input
            id={`${formId}-effectiveFrom`}
            name="effectiveFrom"
            placeholder={t.pricingPage.datetimePlaceholder}
            className="h-9 w-48 text-sm"
            aria-invalid={fieldErrors["effectiveFrom"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-effectiveTo`} className="text-xs">
            {t.pricingPage.effectiveToLabel}
          </Label>
          <Input
            id={`${formId}-effectiveTo`}
            name="effectiveTo"
            placeholder={t.pricingPage.datetimePlaceholder}
            className="h-9 w-48 text-sm"
            aria-invalid={fieldErrors["effectiveTo"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-taxClassRef`} className="text-xs">
            {t.pricingPage.taxClassRefLabel}
          </Label>
          <Input
            id={`${formId}-taxClassRef`}
            name="taxClassRef"
            className="h-9 w-40 text-sm"
            aria-invalid={fieldErrors["taxClassRef"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
          {isPending ? t.pricingPage.creating : t.pricingPage.create}
        </Button>
      </div>
      <FormError state={state} />
      <CreatedIdNotice state={state} t={t} />
    </form>
  );
}

export function ChangePriceForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(changePriceAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t.pricingPage.changePriceTitle}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-priceId`} className="text-xs">
            {t.pricingPage.priceIdLabel}
          </Label>
          <Input
            id={`${formId}-priceId`}
            name="priceId"
            className="h-9 w-48 text-sm"
            aria-invalid={fieldErrors["priceId"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-amountMinor`} className="text-xs">
            {t.pricingPage.amountMinorLabel}
          </Label>
          <Input
            id={`${formId}-amountMinor`}
            name="amountMinor"
            inputMode="numeric"
            className="h-9 w-32 text-sm"
            aria-invalid={fieldErrors["amountMinor"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-currency`} className="text-xs">
            {t.pricingPage.currencyLabel}
          </Label>
          <Input
            id={`${formId}-currency`}
            name="currency"
            maxLength={3}
            className="h-9 w-24 text-sm"
            aria-invalid={fieldErrors["currency"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-compareAtMinor`} className="text-xs">
            {t.pricingPage.compareAtMinorLabel}
          </Label>
          <Input
            id={`${formId}-compareAtMinor`}
            name="compareAtMinor"
            inputMode="numeric"
            className="h-9 w-32 text-sm"
            aria-invalid={fieldErrors["compareAtMinor"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-costMinor`} className="text-xs">
            {t.pricingPage.costMinorLabel}
          </Label>
          <Input
            id={`${formId}-costMinor`}
            name="costMinor"
            inputMode="numeric"
            className="h-9 w-32 text-sm"
            aria-invalid={fieldErrors["costMinor"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
          {isPending ? t.pricingPage.saving : t.pricingPage.save}
        </Button>
      </div>
      <FormError state={state} />
      <FormSuccess state={state} t={t} />
    </form>
  );
}

export function PublishPriceForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(publishPriceAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t.pricingPage.publishPriceTitle}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-priceId`} className="text-xs">
            {t.pricingPage.priceIdLabel}
          </Label>
          <Input
            id={`${formId}-priceId`}
            name="priceId"
            className="h-9 w-48 text-sm"
            aria-invalid={fieldErrors["priceId"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
          {isPending ? t.pricingPage.publishing : t.pricingPage.publish}
        </Button>
      </div>
      <FormError state={state} />
      <FormSuccess state={state} t={t} />
    </form>
  );
}

export function CreateTaxClassForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(
    createTaxClassAction,
    INITIAL_CREATE_STATE,
  );
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-code`} className="text-xs">
            {t.pricingPage.taxClassCodeLabel}
          </Label>
          <Input
            id={`${formId}-code`}
            name="code"
            className="h-9 w-40 text-sm"
            aria-invalid={fieldErrors["code"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-name`} className="text-xs">
            {t.pricingPage.nameLabel}
          </Label>
          <Input
            id={`${formId}-name`}
            name="name"
            className="h-9 w-56 text-sm"
            aria-invalid={fieldErrors["name"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
          {isPending ? t.pricingPage.creating : t.pricingPage.create}
        </Button>
      </div>
      <FormError state={state} />
      <CreatedIdNotice state={state} t={t} />
    </form>
  );
}

export function CreatePricingRuleForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(
    createPricingRuleAction,
    INITIAL_CREATE_STATE,
  );
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-type`} className="text-xs">
            {t.pricingPage.ruleTypeLabel}
          </Label>
          <select
            id={`${formId}-type`}
            name="type"
            aria-invalid={fieldErrors["type"] !== undefined || undefined}
            className={selectClassName}
          >
            <option value="percentage">{t.pricingPage.ruleTypePercentage}</option>
            <option value="fixed_amount">{t.pricingPage.ruleTypeFixedAmount}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-value`} className="text-xs">
            {t.pricingPage.ruleValueLabel}
          </Label>
          <Input
            id={`${formId}-value`}
            name="value"
            inputMode="decimal"
            className="h-9 w-32 text-sm"
            aria-invalid={fieldErrors["value"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-priority`} className="text-xs">
            {t.pricingPage.rulePriorityLabel}
          </Label>
          <Input
            id={`${formId}-priority`}
            name="priority"
            inputMode="numeric"
            className="h-9 w-24 text-sm"
            aria-invalid={fieldErrors["priority"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
          {isPending ? t.pricingPage.creating : t.pricingPage.create}
        </Button>
      </div>
      <FormError state={state} />
      <CreatedIdNotice state={state} t={t} />
    </form>
  );
}

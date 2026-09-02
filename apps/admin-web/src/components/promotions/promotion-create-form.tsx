"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { createPromotionAction } from "@/app/promotions/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

const SELECT_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out";

/**
 * The Promotions create form (T5.8 Part B) — `createPromotionBody` is a big, conditional shape
 * (`ruleType`/`rewardType` decide which of `buyQuantity`/`getQuantity`/`rewardValue`/etc. are
 * meaningful), rendered here plainly per the task brief: every field always shown, no dynamic
 * show/hide beyond basic usability — the backend validates the real business rules.
 * `targetRefs`/`customerRefs`/`segmentRefs` are plain comma-separated text — no product/category/
 * customer/segment picker exists in this task's scope.
 */
export function PromotionCreateForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(createPromotionAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.status === "error" && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground flex items-center gap-2 rounded-xl border px-4 py-3 text-sm"
        >
          <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${formId}-name`} name="name" label={t.promotionCreate.name} error={fieldErrors["name"]} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-ruleType`}>{t.promotionCreate.ruleType}</Label>
          <select id={`${formId}-ruleType`} name="ruleType" defaultValue="automatic" className={SELECT_CLASS}>
            <option value="automatic">{t.promotionRuleType.automatic}</option>
            <option value="buy_x_get_y">{t.promotionRuleType.buy_x_get_y}</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-scope`}>{t.promotionCreate.scope}</Label>
          <select id={`${formId}-scope`} name="scope" defaultValue="cart" className={SELECT_CLASS}>
            <option value="cart">{t.promotionScope.cart}</option>
            <option value="product">{t.promotionScope.product}</option>
            <option value="category">{t.promotionScope.category}</option>
          </select>
        </div>

        <Field
          id={`${formId}-targetRefs`}
          name="targetRefs"
          label={t.promotionCreate.targetRefs}
          error={fieldErrors["targetRefs"]}
          placeholder="ref-1, ref-2"
        />
        <Field
          id={`${formId}-minimumQuantity`}
          name="minimumQuantity"
          label={t.promotionCreate.minimumQuantity}
          error={fieldErrors["minimumQuantity"]}
          type="number"
          min={1}
        />
        <Field
          id={`${formId}-minimumSubtotalAmountMinor`}
          name="minimumSubtotalAmountMinor"
          label={t.promotionCreate.minimumSubtotalAmountMinor}
          error={fieldErrors["minimumSubtotalAmountMinor"]}
          type="number"
          min={0}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-rewardType`}>{t.promotionCreate.rewardType}</Label>
          <select
            id={`${formId}-rewardType`}
            name="rewardType"
            defaultValue="percentage"
            className={SELECT_CLASS}
          >
            <option value="percentage">{t.promotionRewardType.percentage}</option>
            <option value="fixed_amount">{t.promotionRewardType.fixed_amount}</option>
            <option value="free_shipping">{t.promotionRewardType.free_shipping}</option>
          </select>
        </div>
        <Field
          id={`${formId}-rewardValue`}
          name="rewardValue"
          label={t.promotionCreate.rewardValue}
          error={fieldErrors["rewardValue"]}
          type="number"
          step="any"
        />
        <Field
          id={`${formId}-buyQuantity`}
          name="buyQuantity"
          label={t.promotionCreate.buyQuantity}
          error={fieldErrors["buyQuantity"]}
          type="number"
          min={1}
        />
        <Field
          id={`${formId}-getQuantity`}
          name="getQuantity"
          label={t.promotionCreate.getQuantity}
          error={fieldErrors["getQuantity"]}
          type="number"
          min={1}
        />
        <Field
          id={`${formId}-priority`}
          name="priority"
          label={t.promotionCreate.priority}
          error={fieldErrors["priority"]}
          type="number"
          defaultValue="0"
        />
        <Field
          id={`${formId}-usageLimit`}
          name="usageLimit"
          label={t.promotionCreate.usageLimit}
          error={fieldErrors["usageLimit"]}
          type="number"
          min={1}
        />
        <Field
          id={`${formId}-startsAt`}
          name="startsAt"
          label={t.promotionCreate.startsAt}
          error={fieldErrors["startsAt"]}
          type="datetime-local"
        />
        <Field
          id={`${formId}-endsAt`}
          name="endsAt"
          label={t.promotionCreate.endsAt}
          error={fieldErrors["endsAt"]}
          type="datetime-local"
        />
        <Field
          id={`${formId}-customerRefs`}
          name="customerRefs"
          label={t.promotionCreate.customerRefs}
          placeholder="ref-1, ref-2"
        />
        <Field
          id={`${formId}-segmentRefs`}
          name="segmentRefs"
          label={t.promotionCreate.segmentRefs}
          placeholder="ref-1, ref-2"
        />
        <Field id={`${formId}-campaignRef`} name="campaignRef" label={t.promotionCreate.campaignRef} />
      </div>

      <div className="flex items-center gap-2">
        <input type="checkbox" id={`${formId}-stackable`} name="stackable" className="mt-0.5" />
        <Label htmlFor={`${formId}-stackable`}>{t.promotionCreate.stackable}</Label>
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.promotionCreate.submitting : t.promotionCreate.submit}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  name,
  label,
  error,
  placeholder,
  type,
  min,
  step,
  defaultValue,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly error?: string;
  readonly placeholder?: string;
  readonly type?: string;
  readonly min?: number;
  readonly step?: string | number;
  readonly defaultValue?: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        min={min}
        step={step}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
      />
      {error !== undefined && (
        <p id={errorId} className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

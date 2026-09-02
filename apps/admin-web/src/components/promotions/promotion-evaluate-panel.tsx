"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { evaluatePromotionsAction, type EvaluateFormState } from "@/app/promotions/actions";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: EvaluateFormState = { status: "idle" };

/** A fixed, small set of cart-line rows — a blank `lineProductRef` row is simply unused (see `evaluatePromotionsAction`'s own doc comment on the lenient row parsing). */
const LINE_ROW_COUNT = 3;

/**
 * The "Evaluate" panel (T5.8 Part B) — a "try it out" simulation against a cart snapshot the
 * operator types in, not a mutation (`evaluatePromotions`'s own doc comment: `POST` but pure
 * read). Renders the raw `PromotionDetermination[]` the backend returns as a preview list; never
 * `revalidatePath`s anything, since nothing changed.
 */
export function PromotionEvaluatePanel({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(evaluatePromotionsAction, INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">{t.promotionEvaluate.subtitle}</p>

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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-customerRef`}>{t.promotionEvaluate.customerRef}</Label>
          <Input id={`${formId}-customerRef`} name="customerRef" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-subtotalAmountMinor`}>{t.promotionEvaluate.subtotalAmountMinor}</Label>
          <Input id={`${formId}-subtotalAmountMinor`} name="subtotalAmountMinor" type="number" min={0} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`${formId}-segmentRefs`}>{t.promotionEvaluate.segmentRefs}</Label>
          <Input id={`${formId}-segmentRefs`} name="segmentRefs" placeholder="ref-1, ref-2" />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">{t.promotionEvaluate.linesTitle}</h3>
        {Array.from({ length: LINE_ROW_COUNT }, (_, index) => (
          <div
            key={index}
            className="border-border grid gap-3 rounded-xl border p-4 sm:grid-cols-4"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${formId}-productRef-${index}`} className="text-xs">
                {t.promotionEvaluate.lineProductRef}
              </Label>
              <Input id={`${formId}-productRef-${index}`} name="lineProductRef" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${formId}-categoryRefs-${index}`} className="text-xs">
                {t.promotionEvaluate.lineCategoryRefs}
              </Label>
              <Input id={`${formId}-categoryRefs-${index}`} name="lineCategoryRefs" placeholder="ref-1, ref-2" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${formId}-quantity-${index}`} className="text-xs">
                {t.promotionEvaluate.lineQuantity}
              </Label>
              <Input id={`${formId}-quantity-${index}`} name="lineQuantity" type="number" min={1} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${formId}-unitPrice-${index}`} className="text-xs">
                {t.promotionEvaluate.lineUnitPriceAmountMinor}
              </Label>
              <Input id={`${formId}-unitPrice-${index}`} name="lineUnitPriceAmountMinor" type="number" min={0} />
            </div>
          </div>
        ))}
      </div>

      <div>
        <Button type="submit" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.promotionEvaluate.evaluating : t.promotionEvaluate.evaluate}
        </Button>
      </div>

      {state.status === "success" && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t.promotionEvaluate.resultsTitle}</h3>
          {state.determinations.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t.promotionEvaluate.noDeterminations}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {state.determinations.map((determination, index) => (
                <li
                  key={`${determination.promotionId}-${index}`}
                  className="border-border rounded-xl border p-3 text-sm"
                >
                  <p className="font-mono text-xs">{determination.promotionId}</p>
                  <p>
                    {t.promotionEvaluate.discountAmountMinor}: {determination.discountAmountMinor}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t.promotionEvaluate.priority}: {determination.priority} ·{" "}
                    {determination.stackable
                      ? t.promotionEvaluate.stackableYes
                      : t.promotionEvaluate.stackableNo}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}

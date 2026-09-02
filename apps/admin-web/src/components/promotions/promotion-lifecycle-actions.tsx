"use client";

import { useActionState, useId } from "react";
import { Button, Label } from "@platform/ui";
import { advancePromotionAction, recordPromotionUsageAction } from "@/app/promotions/actions";
import type { FormState } from "@/lib/api/mutation";
import { promotionAdvanceableStatusesFrom } from "@/lib/promotion-lifecycle";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

const SELECT_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out";

/**
 * The Promotion Detail "advance to…" control (T5.8 Part B), gated by
 * `lib/promotion-lifecycle.ts`'s `PROMOTION_LIFECYCLE_TRANSITIONS` — same "no control at all for a
 * terminal status" discipline as `OrderLifecycleActions`' own `AdvanceOrderForm`.
 */
function AdvanceForm({
  promotionId,
  status,
  t,
}: {
  readonly promotionId: string;
  readonly status: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(advancePromotionAction, INITIAL_STATE);
  const formId = useId();
  const targets = promotionAdvanceableStatusesFrom(status);

  if (targets.length === 0) return null;

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="promotionId" value={promotionId} />
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-toStatus`} className="text-muted-foreground text-xs">
            {t.promotionLifecycle.advanceToLabel}
          </Label>
          <select id={`${formId}-toStatus`} name="toStatus" className={SELECT_CLASS}>
            {targets.map((target) => (
              <option key={target} value={target}>
                {(t.promotionStatus as Record<string, string>)[target] ?? target}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.promotionLifecycle.advancing : t.promotionLifecycle.advance}
        </Button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

/** The "Record usage" button — always offered, an invalid state (e.g. a terminal status) surfaces as a normal form error rather than being pre-blocked here (there's no modeled precondition to gate on beyond what the backend itself enforces). */
function RecordUsageForm({ promotionId, t }: { readonly promotionId: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(recordPromotionUsageAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="promotionId" value={promotionId} />
      <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
        {isPending ? t.promotionLifecycle.recordingUsage : t.promotionLifecycle.recordUsage}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

export function PromotionLifecycleActions({
  promotionId,
  status,
  t,
}: {
  readonly promotionId: string;
  readonly status: string;
  readonly t: Dictionary;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t.promotionLifecycle.title}</h2>
      <div className="flex flex-wrap items-start gap-4">
        <AdvanceForm promotionId={promotionId} status={status} t={t} />
        <RecordUsageForm promotionId={promotionId} t={t} />
      </div>
    </div>
  );
}

"use client";

import { useActionState, useId } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import { advanceReviewAction, moderateReviewAction } from "@/app/reviews/actions";
import type { FormState } from "@/lib/api/mutation";
import {
  advanceableReviewStatusesFrom,
  canFlagFrom,
  canRejectFrom,
  canRemoveFrom,
  canRestoreFrom,
} from "@/lib/review-lifecycle";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

const SELECT_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out";

function FormError({ state }: { readonly state: FormState }) {
  if (state.status !== "error") return null;
  return (
    <p role="alert" className="text-destructive text-xs">
      {state.message}
    </p>
  );
}

/**
 * The shared moderatorRef/reason form (`POST /reviews/:reviewId/moderate`) — one submit button per
 * action `lib/review-lifecycle.ts` allows at the review's current status, all sharing the same
 * `moderatorRef`/`reason` inputs and the same `moderateReviewAction`, which reads which button was
 * pressed off the submitter's `name="action"`/`value` pair (same "multiple submit buttons, one
 * form" technique `ReturnLifecycleActions`' own `DecisionForm` uses).
 */
function ModerateForm({
  reviewId,
  status,
  t,
}: {
  readonly reviewId: string;
  readonly status: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(moderateReviewAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col items-start gap-3">
      <input type="hidden" name="reviewId" value={reviewId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-moderatorRef`} className="text-muted-foreground text-xs">
            {t.reviewLifecycle.moderatorRefLabel}
          </Label>
          <Input
            id={`${formId}-moderatorRef`}
            name="moderatorRef"
            className="h-8 text-xs"
            aria-invalid={fieldErrors["moderatorRef"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-reason`} className="text-muted-foreground text-xs">
            {t.reviewLifecycle.reasonLabel}
          </Label>
          <Input id={`${formId}-reason`} name="reason" className="h-8 w-56 text-xs" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {canRejectFrom(status) && (
          <Button
            type="submit"
            name="action"
            value="reject"
            size="sm"
            variant="destructive"
            loading={isPending}
            disabled={isPending}
          >
            {isPending ? t.reviewLifecycle.rejecting : t.reviewLifecycle.reject}
          </Button>
        )}
        {canFlagFrom(status) && (
          <Button
            type="submit"
            name="action"
            value="flag"
            size="sm"
            variant="outline"
            loading={isPending}
            disabled={isPending}
          >
            {isPending ? t.reviewLifecycle.flagging : t.reviewLifecycle.flag}
          </Button>
        )}
        {canRestoreFrom(status) && (
          <Button
            type="submit"
            name="action"
            value="restore"
            size="sm"
            loading={isPending}
            disabled={isPending}
          >
            {isPending ? t.reviewLifecycle.restoring : t.reviewLifecycle.restore}
          </Button>
        )}
        {canRemoveFrom(status) && (
          <Button
            type="submit"
            name="action"
            value="remove"
            size="sm"
            variant="destructive"
            loading={isPending}
            disabled={isPending}
          >
            {isPending ? t.reviewLifecycle.removing : t.reviewLifecycle.remove}
          </Button>
        )}
      </div>
      <FormError state={state} />
    </form>
  );
}

/**
 * The generic "advance to…" fallback (`POST /reviews/:reviewId/transitions`) — only rendered by
 * the caller for the residual `advanceableReviewStatusesFrom` returns (just `pending` -> `published`
 * today, since `moderate`'s 4 actions cover every other transition).
 */
function AdvanceForm({
  reviewId,
  statuses,
  t,
}: {
  readonly reviewId: string;
  readonly statuses: readonly string[];
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(advanceReviewAction, INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="reviewId" value={reviewId} />
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-toStatus`} className="text-muted-foreground text-xs">
            {t.reviewLifecycle.advanceToLabel}
          </Label>
          <select id={`${formId}-toStatus`} name="toStatus" className={SELECT_CLASS}>
            {statuses.map((target) => (
              <option key={target} value={target}>
                {(t.reviewStatus as Record<string, string>)[target] ?? target}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.reviewLifecycle.advancing : t.reviewLifecycle.advance}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/**
 * The Review Detail screen's gated moderation controls (T5.10), per the brief: `moderate` is the
 * primary control (dedicated reject/flag/restore/remove buttons, gated by `lib/review-lifecycle.ts`
 * ), with the generic advance dropdown offered only as a fallback for the one transition `moderate`
 * doesn't cover. Renders nothing at a terminal status (`rejected`/`removed`) or if the caller lacks
 * the `reviews:moderate`/`reviews:advance` permission server-side — this control itself is always
 * offered to a viewer (gated only at `/reviews/new` by `middleware.ts`), the backend rejects the
 * actual submit, same precedent as every prior Phase 5 detail-page write action.
 */
export function ReviewLifecycleActions({
  reviewId,
  status,
  t,
}: {
  readonly reviewId: string;
  readonly status: string;
  readonly t: Dictionary;
}) {
  const hasDedicatedAction =
    canRejectFrom(status) || canFlagFrom(status) || canRestoreFrom(status) || canRemoveFrom(status);
  const advanceTargets = advanceableReviewStatusesFrom(status);

  if (!hasDedicatedAction && advanceTargets.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.reviewLifecycle.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {hasDedicatedAction && <ModerateForm reviewId={reviewId} status={status} t={t} />}
        {advanceTargets.length > 0 && (
          <AdvanceForm reviewId={reviewId} statuses={advanceTargets} t={t} />
        )}
      </CardContent>
    </Card>
  );
}

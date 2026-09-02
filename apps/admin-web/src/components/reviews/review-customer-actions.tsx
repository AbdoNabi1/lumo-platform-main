"use client";

import { useActionState, useId } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import { reportReviewAction, voteReviewAction } from "@/app/reviews/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

function FormError({ state }: { readonly state: FormState }) {
  if (state.status !== "error") return null;
  return (
    <p role="alert" className="text-destructive text-xs">
      {state.message}
    </p>
  );
}

/**
 * `POST /reviews/:reviewId/vote` — normally a customer action from the storefront; offered here
 * mostly for completeness/testing, per the task brief (the route exists and is listed explicitly).
 * Two submit buttons share one form, each setting `helpful` via its own `name`/`value` — same
 * technique `ReturnLifecycleActions`' own `DecisionForm` uses for its approve/reject pair.
 */
function VoteForm({ reviewId, t }: { readonly reviewId: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(voteReviewAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${formId}-customerRef`} className="text-muted-foreground text-xs">
          {t.reviewVoteForm.customerRefLabel}
        </Label>
        <Input
          id={`${formId}-customerRef`}
          name="customerRef"
          className="h-8 text-xs"
          aria-invalid={fieldErrors["customerRef"] !== undefined || undefined}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" name="helpful" value="true" size="sm" loading={isPending} disabled={isPending}>
          {t.reviewVoteForm.helpful}
        </Button>
        <Button
          type="submit"
          name="helpful"
          value="false"
          size="sm"
          variant="outline"
          loading={isPending}
          disabled={isPending}
        >
          {t.reviewVoteForm.unhelpful}
        </Button>
      </div>
      {isPending && <p className="text-muted-foreground text-xs">{t.reviewVoteForm.submitting}</p>}
      <FormError state={state} />
    </form>
  );
}

/**
 * `POST /reviews/:reviewId/report` — **not** idempotent, per the route table (no `Idempotency-Key`
 * is minted, see `lib/api/reviews.ts`'s `reportReview`). Normally a customer action; offered here
 * mostly for completeness/testing.
 */
function ReportForm({ reviewId, t }: { readonly reviewId: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(reportReviewAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-reporterRef`} className="text-muted-foreground text-xs">
            {t.reviewReportForm.reporterRefLabel}
          </Label>
          <Input
            id={`${formId}-reporterRef`}
            name="reporterRef"
            className="h-8 text-xs"
            aria-invalid={fieldErrors["reporterRef"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" variant="destructive" loading={isPending} disabled={isPending}>
          {isPending ? t.reviewReportForm.submitting : t.reviewReportForm.submit}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/**
 * The Review Detail screen's customer-action forms (T5.10) — vote and report are normally
 * customer-initiated (the storefront), not moderator actions, but the task brief lists both routes
 * explicitly, so they're offered here for completeness/testing, kept visually distinct from
 * `ReviewLifecycleActions`' moderator controls above.
 */
export function ReviewCustomerActions({
  reviewId,
  t,
}: {
  readonly reviewId: string;
  readonly t: Dictionary;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.reviewVoteForm.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <VoteForm reviewId={reviewId} t={t} />
        <div className="border-border flex flex-col gap-2 border-t pt-4">
          <h3 className="text-sm font-medium">{t.reviewReportForm.title}</h3>
          <ReportForm reviewId={reviewId} t={t} />
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import { useActionState, useId } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Label } from "@platform/ui";
import { respondToReviewAction } from "@/app/reviews/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

const TEXTAREA_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) min-h-24 w-full rounded-xl border px-3.5 py-2.5 text-sm transition-colors ease-out";

/**
 * The Review Detail screen's merchant-response form (`POST /reviews/:reviewId/respond`) — shows
 * the existing `merchantResponse` when set (the textarea's `defaultValue`, since this route always
 * *replaces* the response rather than appending to it) and doubles as the "set" form when there is
 * none yet.
 */
export function ReviewRespondForm({
  reviewId,
  merchantResponse,
  t,
}: {
  readonly reviewId: string;
  readonly merchantResponse: string | null;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(respondToReviewAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.reviewRespondForm.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="reviewId" value={reviewId} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-responseText`} className="text-muted-foreground text-xs">
              {t.reviewRespondForm.responseTextLabel}
            </Label>
            <textarea
              id={`${formId}-responseText`}
              name="responseText"
              rows={4}
              defaultValue={merchantResponse ?? ""}
              aria-invalid={fieldErrors["responseText"] !== undefined || undefined}
              className={TEXTAREA_CLASS}
            />
          </div>
          <div>
            <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
              {isPending ? t.reviewRespondForm.submitting : t.reviewRespondForm.submit}
            </Button>
          </div>
          {state.status === "error" && (
            <p role="alert" className="text-destructive text-xs">
              {state.message}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

"use client";

import { useActionState, useId } from "react";
import { Button, Input, Label } from "@platform/ui";
import {
  archiveProductAction,
  deleteProductAction,
  publishProductAction,
  schedulePublishProductAction,
  unpublishProductAction,
} from "@/app/products/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

type ActionFn = (previous: FormState, formData: FormData) => Promise<FormState>;

/**
 * One lifecycle transition button — publish/unpublish/archive/delete all need nothing but the
 * product id, so they share this shell. `confirmMessage`, when set, guards the submit with a
 * native `window.confirm` (archive/delete only) since these are one-click, hard-to-undo actions.
 */
function LifecycleActionButton({
  productId,
  action,
  label,
  pendingLabel,
  variant,
  confirmMessage,
}: {
  readonly productId: string;
  readonly action: ActionFn;
  readonly label: string;
  readonly pendingLabel: string;
  readonly variant?: "outline" | "destructive";
  readonly confirmMessage?: string;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (confirmMessage !== undefined && !window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col items-start gap-1"
    >
      <input type="hidden" name="productId" value={productId} />
      <Button
        type="submit"
        size="sm"
        variant={variant ?? "outline"}
        loading={isPending}
        disabled={isPending}
      >
        {isPending ? pendingLabel : label}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

function SchedulePublishForm({
  productId,
  t,
}: {
  readonly productId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(
    schedulePublishProductAction,
    INITIAL_STATE,
  );
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="productId" value={productId} />
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-scheduledAt`} className="text-muted-foreground text-xs">
            {t.productLifecycle.scheduledAtLabel}
          </Label>
          <Input
            id={`${formId}-scheduledAt`}
            name="scheduledAt"
            type="datetime-local"
            className="h-8 text-xs"
            aria-invalid={fieldErrors["scheduledAt"] !== undefined || undefined}
            aria-describedby={
              fieldErrors["scheduledAt"] !== undefined ? `${formId}-scheduledAt-error` : undefined
            }
          />
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.productLifecycle.scheduling : t.productLifecycle.schedulePublish}
        </Button>
      </div>
      {fieldErrors["scheduledAt"] !== undefined && (
        <p id={`${formId}-scheduledAt-error`} className="text-destructive text-xs">
          {fieldErrors["scheduledAt"]}
        </p>
      )}
      {state.status === "error" && fieldErrors["scheduledAt"] === undefined && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

/**
 * The lifecycle action bar (T5.1) — publish/schedule/unpublish/archive/delete had no UI at all
 * before this. Gated by `status` on a best-effort basis (`ProductStatusBadge`'s known statuses:
 * draft/scheduled/published/archived): never offer a transition the state machine plainly cannot
 * take from here. A transition this gating still gets wrong surfaces as a normal form error
 * (`toFormState`) rather than being silently swallowed.
 */
export function ProductLifecycleActions({
  productId,
  status,
  t,
}: {
  readonly productId: string;
  readonly status: string;
  readonly t: Dictionary;
}) {
  const canPublish = status === "draft";
  const canSchedule = status === "draft";
  const canUnpublish = status === "scheduled" || status === "published";
  const canArchive = status === "draft" || status === "scheduled" || status === "published";
  // Deleting a live (published/scheduled) product without unpublishing first is exactly the kind
  // of "obviously-wrong action" the brief says not to offer — an operator can still unpublish
  // then delete in two clicks.
  const canDelete = status === "draft" || status === "archived";

  if (!canPublish && !canSchedule && !canUnpublish && !canArchive && !canDelete) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-start gap-3">
      {canPublish && (
        <LifecycleActionButton
          productId={productId}
          action={publishProductAction}
          label={t.productLifecycle.publish}
          pendingLabel={t.productLifecycle.publishing}
        />
      )}
      {canSchedule && <SchedulePublishForm productId={productId} t={t} />}
      {canUnpublish && (
        <LifecycleActionButton
          productId={productId}
          action={unpublishProductAction}
          label={t.productLifecycle.unpublish}
          pendingLabel={t.productLifecycle.unpublishing}
        />
      )}
      {canArchive && (
        <LifecycleActionButton
          productId={productId}
          action={archiveProductAction}
          label={t.productLifecycle.archive}
          pendingLabel={t.productLifecycle.archiving}
          confirmMessage={t.productLifecycle.confirmArchive}
        />
      )}
      {canDelete && (
        <LifecycleActionButton
          productId={productId}
          action={deleteProductAction}
          label={t.productLifecycle.delete}
          pendingLabel={t.productLifecycle.deleting}
          variant="destructive"
          confirmMessage={t.productLifecycle.confirmDelete}
        />
      )}
    </div>
  );
}

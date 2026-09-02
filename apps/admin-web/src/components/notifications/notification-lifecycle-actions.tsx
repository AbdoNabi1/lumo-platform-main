"use client";

import { useActionState, useId, type ReactNode } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import {
  advanceNotificationAction,
  queueNotificationAction,
  recordNotificationCallbackAction,
  retryNotificationAction,
  sendNotificationAction,
} from "@/app/notifications/actions";
import type { FormState } from "@/lib/api/mutation";
import {
  advanceableNotificationStatusesFrom,
  canQueueFrom,
  canRetryFrom,
  canSendFrom,
} from "@/lib/notification-lifecycle";
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

/** `created` -> `queued` (`POST /notifications/:id/queue`, no body). */
function QueueForm({ notificationId, t }: { readonly notificationId: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(queueNotificationAction, INITIAL_STATE);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="notificationId" value={notificationId} />
      <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
        {isPending ? t.notificationLifecycle.queuing : t.notificationLifecycle.queue}
      </Button>
      <FormError state={state} />
    </form>
  );
}

/** `queued`/`retrying` -> `sent` (`POST /notifications/:id/send`, no body, **not** idempotent). */
function SendForm({ notificationId, t }: { readonly notificationId: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(sendNotificationAction, INITIAL_STATE);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="notificationId" value={notificationId} />
      <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
        {isPending ? t.notificationLifecycle.sending : t.notificationLifecycle.send}
      </Button>
      <FormError state={state} />
    </form>
  );
}

/** `failed` -> `retrying` (`POST /notifications/:id/retry`, no body). */
function RetryForm({ notificationId, t }: { readonly notificationId: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(retryNotificationAction, INITIAL_STATE);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="notificationId" value={notificationId} />
      <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
        {isPending ? t.notificationLifecycle.retrying : t.notificationLifecycle.retry}
      </Button>
      <FormError state={state} />
    </form>
  );
}

/** The generic "advance to…" fallback (`POST /notifications/:id/transitions`). */
function AdvanceForm({
  notificationId,
  statuses,
  t,
}: {
  readonly notificationId: string;
  readonly statuses: readonly string[];
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(advanceNotificationAction, INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="notificationId" value={notificationId} />
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-toStatus`} className="text-muted-foreground text-xs">
            {t.notificationLifecycle.advanceToLabel}
          </Label>
          <select id={`${formId}-toStatus`} name="toStatus" className={SELECT_CLASS}>
            {statuses.map((target) => (
              <option key={target} value={target}>
                {(t.notificationStatus as Record<string, string>)[target] ?? target}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.notificationLifecycle.advancing : t.notificationLifecycle.advance}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/**
 * Records a provider callback (`POST /notifications/:id/callback`) — normally provider-initiated
 * (a delivery webhook), offered here mostly for completeness/testing, same precedent as
 * `components/reviews/review-customer-actions.tsx`'s vote/report forms. Offered at every status,
 * not tied to one transition — the backend decides what a given callback kind does.
 */
function CallbackForm({
  notificationId,
  t,
}: {
  readonly notificationId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(
    recordNotificationCallbackAction,
    INITIAL_STATE,
  );
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="notificationId" value={notificationId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-provider`} className="text-muted-foreground text-xs">
            {t.notificationLifecycle.callbackProviderLabel}
          </Label>
          <Input
            id={`${formId}-provider`}
            name="provider"
            className="h-8 text-xs"
            aria-invalid={fieldErrors["provider"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-callbackId`} className="text-muted-foreground text-xs">
            {t.notificationLifecycle.callbackIdLabel}
          </Label>
          <Input
            id={`${formId}-callbackId`}
            name="callbackId"
            className="h-8 text-xs"
            aria-invalid={fieldErrors["callbackId"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-kind`} className="text-muted-foreground text-xs">
            {t.notificationLifecycle.callbackKindLabel}
          </Label>
          <Input
            id={`${formId}-kind`}
            name="kind"
            className="h-8 text-xs"
            aria-invalid={fieldErrors["kind"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending
            ? t.notificationLifecycle.recordingCallback
            : t.notificationLifecycle.recordCallback}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/**
 * The Notification Detail screen's gated write actions (T5.11a): dedicated `queue`/`send`/`retry`
 * buttons at the statuses `lib/notification-lifecycle.ts` allows them, the generic advance dropdown
 * for the residual transitions, and the provider-callback form (offered at every status, mostly for
 * completeness/testing). Renders nothing among the lifecycle controls at a terminal status with no
 * residual transitions — the callback form still renders on its own in that case.
 */
export function NotificationLifecycleActions({
  notificationId,
  status,
  t,
}: {
  readonly notificationId: string;
  readonly status: string;
  readonly t: Dictionary;
}) {
  const sections: ReactNode[] = [];
  if (canQueueFrom(status)) {
    sections.push(<QueueForm key="queue" notificationId={notificationId} t={t} />);
  }
  if (canSendFrom(status)) {
    sections.push(<SendForm key="send" notificationId={notificationId} t={t} />);
  }
  if (canRetryFrom(status)) {
    sections.push(<RetryForm key="retry" notificationId={notificationId} t={t} />);
  }
  const advanceTargets = advanceableNotificationStatusesFrom(status);
  if (advanceTargets.length > 0) {
    sections.push(
      <AdvanceForm
        key="advance"
        notificationId={notificationId}
        statuses={advanceTargets}
        t={t}
      />,
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.notificationLifecycle.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sections}
        <CallbackForm notificationId={notificationId} t={t} />
      </CardContent>
    </Card>
  );
}

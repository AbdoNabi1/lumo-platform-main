"use client";

import { useActionState, useId, type ReactNode } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import {
  advanceShipmentAction,
  createShipmentLabelAction,
  recordShipmentWebhookAction,
  retryShipmentAction,
  updateShipmentTrackingAction,
  voidShipmentLabelAction,
} from "@/app/orders/[orderId]/shipment/actions";
import type { FormState } from "@/lib/api/mutation";
import {
  advanceableShipmentStatusesFrom,
  canCreateLabelFrom,
  canRecordShipmentWebhookFrom,
  canRetryFrom,
  canUpdateTrackingFrom,
  canVoidLabelFrom,
} from "@/lib/shipping-lifecycle";
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

/** `created` → `label_created` (`POST /shipments/:id/label`, no body). */
function LabelForm({
  orderId,
  shipmentId,
  t,
}: {
  readonly orderId: string;
  readonly shipmentId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(createShipmentLabelAction, INITIAL_STATE);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
        {isPending ? t.shipmentLifecycle.creatingLabel : t.shipmentLifecycle.createLabel}
      </Button>
      <FormError state={state} />
    </form>
  );
}

/** `label_created` → `voided` (`POST /shipments/:id/label-void`, no body). */
function LabelVoidForm({
  orderId,
  shipmentId,
  t,
}: {
  readonly orderId: string;
  readonly shipmentId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(voidShipmentLabelAction, INITIAL_STATE);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <Button
        type="submit"
        size="sm"
        variant="destructive"
        loading={isPending}
        disabled={isPending}
      >
        {isPending ? t.shipmentLifecycle.voidingLabel : t.shipmentLifecycle.voidLabel}
      </Button>
      <FormError state={state} />
    </form>
  );
}

/** Appends a carrier tracking scan (`POST /shipments/:id/tracking`) — offered at the "in motion" statuses. */
function TrackingForm({
  orderId,
  shipmentId,
  t,
}: {
  readonly orderId: string;
  readonly shipmentId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(updateShipmentTrackingAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-description`} className="text-muted-foreground text-xs">
            {t.shipmentLifecycle.trackingDescriptionLabel}
          </Label>
          <Input
            id={`${formId}-description`}
            name="description"
            className="h-8 text-xs"
            aria-invalid={fieldErrors["description"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-location`} className="text-muted-foreground text-xs">
            {t.shipmentLifecycle.trackingLocationLabel}
          </Label>
          <Input id={`${formId}-location`} name="location" className="h-8 text-xs" />
        </div>
        <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
          {isPending ? t.shipmentLifecycle.addingTracking : t.shipmentLifecycle.addTracking}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/** `rejected`/`delivery_failed`/`exception` → resumed (`POST /shipments/:id/retry`, no body) — own button per the brief. */
function RetryForm({
  orderId,
  shipmentId,
  t,
}: {
  readonly orderId: string;
  readonly shipmentId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(retryShipmentAction, INITIAL_STATE);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
        {isPending ? t.shipmentLifecycle.retrying : t.shipmentLifecycle.retry}
      </Button>
      <FormError state={state} />
    </form>
  );
}

/** Records a carrier webhook (`POST /shipments/:id/webhook`) — offered at any non-terminal status. */
function WebhookForm({
  orderId,
  shipmentId,
  t,
}: {
  readonly orderId: string;
  readonly shipmentId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(recordShipmentWebhookAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-carrier`} className="text-muted-foreground text-xs">
            {t.shipmentLifecycle.webhookCarrierLabel}
          </Label>
          <Input
            id={`${formId}-carrier`}
            name="carrier"
            className="h-8 text-xs"
            aria-invalid={fieldErrors["carrier"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-eventId`} className="text-muted-foreground text-xs">
            {t.shipmentLifecycle.webhookEventIdLabel}
          </Label>
          <Input
            id={`${formId}-eventId`}
            name="eventId"
            className="h-8 text-xs"
            aria-invalid={fieldErrors["eventId"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-kind`} className="text-muted-foreground text-xs">
            {t.shipmentLifecycle.webhookKindLabel}
          </Label>
          <Input
            id={`${formId}-kind`}
            name="kind"
            className="h-8 text-xs"
            aria-invalid={fieldErrors["kind"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.shipmentLifecycle.recordingWebhook : t.shipmentLifecycle.recordWebhook}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/** The generic "advance to…" fallback (`POST /shipments/:id/transitions`). */
function AdvanceForm({
  orderId,
  shipmentId,
  statuses,
  t,
}: {
  readonly orderId: string;
  readonly shipmentId: string;
  readonly statuses: readonly string[];
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(advanceShipmentAction, INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-toStatus`} className="text-muted-foreground text-xs">
            {t.shipmentLifecycle.advanceToLabel}
          </Label>
          <select
            id={`${formId}-toStatus`}
            name="toStatus"
            className="border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out"
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {(t.shipmentStatus as Record<string, string>)[status] ?? status}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.shipmentLifecycle.advancing : t.shipmentLifecycle.advance}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/**
 * The shipment detail screen's gated write actions (T5.4). Same co-rendering discipline as
 * `FulfillmentLifecycleActions` (`lib/shipping-lifecycle.ts`'s doc comment explains the per-action
 * gating): `Create label` at `created`, `Void label` at `label_created`, tracking-scan entry at the
 * three "in motion" statuses, `Retry` at the brief's named 3 recoverable states, the generic
 * advance dropdown whenever a residual target exists, and the webhook recorder at any non-terminal
 * status. Renders nothing at all when none of these apply (only the terminal `closed` status).
 */
export function ShipmentLifecycleActions({
  orderId,
  shipmentId,
  status,
  t,
}: {
  readonly orderId: string;
  readonly shipmentId: string;
  readonly status: string;
  readonly t: Dictionary;
}) {
  const sections: ReactNode[] = [];
  if (canCreateLabelFrom(status)) {
    sections.push(<LabelForm key="label" orderId={orderId} shipmentId={shipmentId} t={t} />);
  }
  if (canVoidLabelFrom(status)) {
    sections.push(
      <LabelVoidForm key="label-void" orderId={orderId} shipmentId={shipmentId} t={t} />,
    );
  }
  if (canUpdateTrackingFrom(status)) {
    sections.push(<TrackingForm key="tracking" orderId={orderId} shipmentId={shipmentId} t={t} />);
  }
  if (canRetryFrom(status)) {
    sections.push(<RetryForm key="retry" orderId={orderId} shipmentId={shipmentId} t={t} />);
  }
  const advanceTargets = advanceableShipmentStatusesFrom(status);
  if (advanceTargets.length > 0) {
    sections.push(
      <AdvanceForm
        key="advance"
        orderId={orderId}
        shipmentId={shipmentId}
        statuses={advanceTargets}
        t={t}
      />,
    );
  }
  if (canRecordShipmentWebhookFrom(status)) {
    sections.push(<WebhookForm key="webhook" orderId={orderId} shipmentId={shipmentId} t={t} />);
  }

  if (sections.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.shipmentLifecycle.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{sections}</CardContent>
    </Card>
  );
}

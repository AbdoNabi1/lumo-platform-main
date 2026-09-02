"use client";

import { useActionState, useId, type ReactNode } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import {
  advanceFulfillmentAction,
  recordFulfillmentWebhookAction,
  reserveFulfillmentAction,
  shipFulfillmentAction,
} from "@/app/orders/[orderId]/fulfillment/actions";
import type { FormState } from "@/lib/api/mutation";
import {
  advanceableFulfillmentStatusesFrom,
  canRecordFulfillmentWebhookFrom,
  canReserveFrom,
  canShipFrom,
} from "@/lib/fulfillment-lifecycle";
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

/** `created`/`failed` → `reservation_requested` (`POST /fulfillments/:id/reserve`, no body). */
function ReserveForm({
  orderId,
  fulfillmentOrderId,
  t,
}: {
  readonly orderId: string;
  readonly fulfillmentOrderId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(reserveFulfillmentAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="fulfillmentOrderId" value={fulfillmentOrderId} />
      <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
        {isPending ? t.fulfillmentLifecycle.reserving : t.fulfillmentLifecycle.reserve}
      </Button>
      <FormError state={state} />
    </form>
  );
}

/** `packing_completed` → `shipment_created` (`POST /fulfillments/:id/shipments`, no body). */
function ShipForm({
  orderId,
  fulfillmentOrderId,
  t,
}: {
  readonly orderId: string;
  readonly fulfillmentOrderId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(shipFulfillmentAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="fulfillmentOrderId" value={fulfillmentOrderId} />
      <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
        {isPending ? t.fulfillmentLifecycle.shipping : t.fulfillmentLifecycle.ship}
      </Button>
      <FormError state={state} />
    </form>
  );
}

/** Records a carrier webhook (`POST /fulfillments/:id/webhook`) — offered at any non-terminal status, not tied to one transition. */
function WebhookForm({
  orderId,
  fulfillmentOrderId,
  t,
}: {
  readonly orderId: string;
  readonly fulfillmentOrderId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(
    recordFulfillmentWebhookAction,
    INITIAL_STATE,
  );
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="fulfillmentOrderId" value={fulfillmentOrderId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-carrier`} className="text-muted-foreground text-xs">
            {t.fulfillmentLifecycle.webhookCarrierLabel}
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
            {t.fulfillmentLifecycle.webhookEventIdLabel}
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
            {t.fulfillmentLifecycle.webhookKindLabel}
          </Label>
          <Input
            id={`${formId}-kind`}
            name="kind"
            className="h-8 text-xs"
            aria-invalid={fieldErrors["kind"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.fulfillmentLifecycle.recordingWebhook : t.fulfillmentLifecycle.recordWebhook}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/** The generic "advance to…" fallback (`POST /fulfillments/:id/transitions`). */
function AdvanceForm({
  orderId,
  fulfillmentOrderId,
  statuses,
  t,
}: {
  readonly orderId: string;
  readonly fulfillmentOrderId: string;
  readonly statuses: readonly string[];
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(advanceFulfillmentAction, INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="fulfillmentOrderId" value={fulfillmentOrderId} />
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-toStatus`} className="text-muted-foreground text-xs">
            {t.fulfillmentLifecycle.advanceToLabel}
          </Label>
          <select
            id={`${formId}-toStatus`}
            name="toStatus"
            className="border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out"
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {(t.fulfillmentStatus as Record<string, string>)[status] ?? status}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.fulfillmentLifecycle.advancing : t.fulfillmentLifecycle.advance}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/**
 * The fulfillment detail screen's gated write actions (T5.4). Unlike Returns' exact one-status-
 * one-action split, several of these can co-render at the same status (`lib/fulfillment-
 * lifecycle.ts`'s doc comment explains why): `Reserve` at `created`/`failed`, `Ship` at
 * `packing_completed`, the generic advance dropdown whenever a residual (dedicated-uncovered)
 * target exists, and the webhook recorder at any non-terminal status. Renders nothing at all when
 * none of the four apply (only the terminal `closed` status).
 */
export function FulfillmentLifecycleActions({
  orderId,
  fulfillmentOrderId,
  status,
  t,
}: {
  readonly orderId: string;
  readonly fulfillmentOrderId: string;
  readonly status: string;
  readonly t: Dictionary;
}) {
  const sections: ReactNode[] = [];
  if (canReserveFrom(status)) {
    sections.push(
      <ReserveForm
        key="reserve"
        orderId={orderId}
        fulfillmentOrderId={fulfillmentOrderId}
        t={t}
      />,
    );
  }
  if (canShipFrom(status)) {
    sections.push(
      <ShipForm key="ship" orderId={orderId} fulfillmentOrderId={fulfillmentOrderId} t={t} />,
    );
  }
  const advanceTargets = advanceableFulfillmentStatusesFrom(status);
  if (advanceTargets.length > 0) {
    sections.push(
      <AdvanceForm
        key="advance"
        orderId={orderId}
        fulfillmentOrderId={fulfillmentOrderId}
        statuses={advanceTargets}
        t={t}
      />,
    );
  }
  if (canRecordFulfillmentWebhookFrom(status)) {
    sections.push(
      <WebhookForm key="webhook" orderId={orderId} fulfillmentOrderId={fulfillmentOrderId} t={t} />,
    );
  }

  if (sections.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.fulfillmentLifecycle.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{sections}</CardContent>
    </Card>
  );
}

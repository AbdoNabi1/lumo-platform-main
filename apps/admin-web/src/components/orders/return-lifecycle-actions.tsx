"use client";

import { useActionState, useId, type ReactNode } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import {
  acceptReturnItemsAction,
  advanceReturnAction,
  decideReturnAction,
  generateRmaAction,
  receiveReturnAction,
  recordInspectionAction,
  resolveReturnAction,
} from "@/app/orders/[orderId]/returns/actions";
import type { FormState } from "@/lib/api/mutation";
import type { ReturnItemDto } from "@/lib/api/returns";
import { advanceableReturnStatusesFrom } from "@/lib/return-lifecycle";
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
 * The requested → approved/rejected decision (`POST /returns/:returnId/decision`). Two submit
 * buttons share one form — each sets `approved` via its own `name`/`value` per the standard HTML
 * "submitter's name/value pair" behavior, so no separate action per outcome is needed.
 */
function DecisionForm({
  orderId,
  returnId,
  t,
}: {
  readonly orderId: string;
  readonly returnId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(decideReturnAction, INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="returnId" value={returnId} />
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${formId}-note`} className="text-muted-foreground text-xs">
          {t.returnLifecycle.decisionNoteLabel}
        </Label>
        <Input id={`${formId}-note`} name="note" className="h-8 text-xs" />
      </div>
      <div className="flex gap-2">
        <Button type="submit" name="approved" value="true" size="sm" loading={isPending} disabled={isPending}>
          {isPending ? t.returnLifecycle.approving : t.returnLifecycle.approve}
        </Button>
        <Button
          type="submit"
          name="approved"
          value="false"
          size="sm"
          variant="destructive"
          loading={isPending}
          disabled={isPending}
        >
          {isPending ? t.returnLifecycle.rejecting : t.returnLifecycle.reject}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/** approved → rma_generated (`POST /returns/:returnId/rma`). */
function RmaForm({
  orderId,
  returnId,
  t,
}: {
  readonly orderId: string;
  readonly returnId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(generateRmaAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="returnId" value={returnId} />
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-rmaNumber`} className="text-muted-foreground text-xs">
            {t.returnLifecycle.rmaNumberLabel}
          </Label>
          <Input
            id={`${formId}-rmaNumber`}
            name="rmaNumber"
            className="h-8 text-xs"
            aria-invalid={fieldErrors["rmaNumber"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
          {isPending ? t.returnLifecycle.generatingRma : t.returnLifecycle.generateRma}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/** rma_generated → package_received (`POST /returns/:returnId/receive`). */
function ReceiveForm({
  orderId,
  returnId,
  t,
}: {
  readonly orderId: string;
  readonly returnId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(receiveReturnAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="returnId" value={returnId} />
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-source`} className="text-muted-foreground text-xs">
            {t.returnLifecycle.receiveSourceLabel}
          </Label>
          <Input
            id={`${formId}-source`}
            name="source"
            className="h-8 text-xs"
            aria-invalid={fieldErrors["source"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-callbackId`} className="text-muted-foreground text-xs">
            {t.returnLifecycle.receiveCallbackIdLabel}
          </Label>
          <Input
            id={`${formId}-callbackId`}
            name="callbackId"
            className="h-8 text-xs"
            aria-invalid={fieldErrors["callbackId"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
          {isPending ? t.returnLifecycle.recordingReceipt : t.returnLifecycle.recordReceipt}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/**
 * package_received → inspection_completed (`POST /returns/:returnId/inspection`) — one call per
 * item, per the route's own summary, so `ReturnLifecycleActions` renders one of these per return
 * item rather than a single batched form.
 */
function InspectionForm({
  orderId,
  returnId,
  item,
  t,
}: {
  readonly orderId: string;
  readonly returnId: string;
  readonly item: ReturnItemDto;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(recordInspectionAction, INITIAL_STATE);
  const formId = useId();

  return (
    <form
      action={formAction}
      className="border-border flex flex-col items-start gap-2 rounded-xl border p-3"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="returnId" value={returnId} />
      <input type="hidden" name="itemRef" value={item.orderItemRef} />
      <p className="text-xs font-medium">
        {item.productRef} × {item.quantity}
      </p>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${formId}-note`} className="text-muted-foreground text-xs">
          {t.returnLifecycle.inspectionNoteLabel}
        </Label>
        <Input id={`${formId}-note`} name="note" className="h-8 text-xs" />
      </div>
      <div className="flex gap-2">
        <Button type="submit" name="passed" value="true" size="sm" loading={isPending} disabled={isPending}>
          {t.returnLifecycle.inspectionPass}
        </Button>
        <Button
          type="submit"
          name="passed"
          value="false"
          size="sm"
          variant="destructive"
          loading={isPending}
          disabled={isPending}
        >
          {t.returnLifecycle.inspectionFail}
        </Button>
      </div>
      {isPending && (
        <p className="text-muted-foreground text-xs">{t.returnLifecycle.recordingInspection}</p>
      )}
      <FormError state={state} />
    </form>
  );
}

/**
 * inspection_completed → items_accepted/items_rejected (`POST /returns/:returnId/accept`). One row
 * per return item with a disposition text input; a row left blank is simply not submitted (a
 * partial accept), per `parseAcceptItems`'s own doc comment in `actions.ts`.
 */
function AcceptForm({
  orderId,
  returnId,
  items,
  t,
}: {
  readonly orderId: string;
  readonly returnId: string;
  readonly items: readonly ReturnItemDto[];
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(acceptReturnItemsAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="returnId" value={returnId} />
      {fieldErrors["items"] !== undefined && (
        <p className="text-destructive text-xs">{fieldErrors["items"]}</p>
      )}
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div key={item.orderItemRef} className="flex items-end gap-2">
            <input type="hidden" name="candidateItemRef" value={item.orderItemRef} />
            <p className="text-muted-foreground w-40 shrink-0 truncate text-xs">
              {item.productRef} × {item.quantity}
            </p>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${formId}-disposition-${item.orderItemRef}`} className="text-xs">
                {t.returnLifecycle.acceptDispositionLabel}
              </Label>
              <Input
                id={`${formId}-disposition-${item.orderItemRef}`}
                name={`disposition_${item.orderItemRef}`}
                className="h-8 text-xs"
              />
            </div>
          </div>
        ))}
      </div>
      <div>
        <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
          {isPending ? t.returnLifecycle.accepting : t.returnLifecycle.acceptItems}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/** items_accepted → refund_requested/replacement_requested/repair_requested (`POST /returns/:returnId/resolution`). */
function ResolutionForm({
  orderId,
  returnId,
  t,
}: {
  readonly orderId: string;
  readonly returnId: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(resolveReturnAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="returnId" value={returnId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-outcome`} className="text-muted-foreground text-xs">
            {t.returnLifecycle.resolutionOutcomeLabel}
          </Label>
          <select
            id={`${formId}-outcome`}
            name="outcome"
            aria-invalid={fieldErrors["outcome"] !== undefined || undefined}
            className="border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out"
          >
            <option value="refund">{t.returnLifecycle.resolutionOutcomeRefund}</option>
            <option value="replacement">{t.returnLifecycle.resolutionOutcomeReplacement}</option>
            <option value="repair">{t.returnLifecycle.resolutionOutcomeRepair}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-amountMinor`} className="text-muted-foreground text-xs">
            {t.returnLifecycle.resolutionAmountLabel}
          </Label>
          <Input
            id={`${formId}-amountMinor`}
            name="amountMinor"
            inputMode="numeric"
            className="h-8 w-32 text-xs"
            aria-invalid={fieldErrors["amountMinor"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-currency`} className="text-muted-foreground text-xs">
            {t.returnLifecycle.resolutionCurrencyLabel}
          </Label>
          <Input
            id={`${formId}-currency`}
            name="currency"
            maxLength={3}
            className="h-8 w-16 text-xs"
          />
        </div>
        <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
          {isPending ? t.returnLifecycle.resolving : t.returnLifecycle.resolve}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/**
 * The generic "advance to…" fallback (`POST /returns/:returnId/transitions`) — only rendered by
 * the caller for a status with no dedicated action, where the transition table's only target is
 * always `closed` (`lib/return-lifecycle.ts`). Same shape as `OrderLifecycleActions`'
 * `AdvanceOrderForm`.
 */
function AdvanceForm({
  orderId,
  returnId,
  statuses,
  t,
}: {
  readonly orderId: string;
  readonly returnId: string;
  readonly statuses: readonly string[];
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(advanceReturnAction, INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="returnId" value={returnId} />
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-toStatus`} className="text-muted-foreground text-xs">
            {t.returnLifecycle.advanceToLabel}
          </Label>
          <select
            id={`${formId}-toStatus`}
            name="toStatus"
            className="border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out"
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {(t.returnStatus as Record<string, string>)[status] ?? status}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.returnLifecycle.advancing : t.returnLifecycle.advance}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/**
 * The returns detail screen's gated write actions (T5.3) — exactly one control set per current
 * status, per the brief: a dedicated action for every status that has one, falling back to the
 * generic "advance to…" dropdown only for the five statuses with none (`rejected`,
 * `items_rejected`, `refund_requested`, `replacement_requested`, `repair_requested` — every one of
 * which only ever advances to `closed`). Renders nothing for the terminal `closed` status.
 */
export function ReturnLifecycleActions({
  orderId,
  returnId,
  status,
  items,
  t,
}: {
  readonly orderId: string;
  readonly returnId: string;
  readonly status: string;
  readonly items: readonly ReturnItemDto[];
  readonly t: Dictionary;
}) {
  let body: ReactNode = null;
  if (status === "requested") {
    body = <DecisionForm orderId={orderId} returnId={returnId} t={t} />;
  } else if (status === "approved") {
    body = <RmaForm orderId={orderId} returnId={returnId} t={t} />;
  } else if (status === "rma_generated") {
    body = <ReceiveForm orderId={orderId} returnId={returnId} t={t} />;
  } else if (status === "package_received") {
    body = (
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <InspectionForm
            key={item.orderItemRef}
            orderId={orderId}
            returnId={returnId}
            item={item}
            t={t}
          />
        ))}
      </div>
    );
  } else if (status === "inspection_completed") {
    body = <AcceptForm orderId={orderId} returnId={returnId} items={items} t={t} />;
  } else if (status === "items_accepted") {
    body = <ResolutionForm orderId={orderId} returnId={returnId} t={t} />;
  } else {
    const advanceTargets = advanceableReturnStatusesFrom(status);
    if (advanceTargets.length > 0) {
      body = (
        <AdvanceForm orderId={orderId} returnId={returnId} statuses={advanceTargets} t={t} />
      );
    }
  }

  if (body === null) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.returnLifecycle.title}</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

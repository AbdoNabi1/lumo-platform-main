import { createHash } from "node:crypto";
import { AggregateRoot, BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { ReturnTransitioned } from "./events/return-transitioned.event";
import { ReturnAttempt, type ReturnAttemptKind, type ReturnAttemptOutcome } from "./return-attempt";
import { ReturnInspection } from "./return-inspection";
import type { ReturnItem } from "./value-objects/return-item";
import { ReturnApproval } from "./value-objects/return-approval";
import type { ReturnDisposition } from "./value-objects/return-disposition";
import {
  canTransitionReturn,
  ReturnStatus,
  type ReturnStatusValue,
} from "./value-objects/return-status";
import type { RefundDecision, ResolutionOutcome } from "./value-objects/refund-decision";

/** The canonical 3-segment integration-event type for each status (Sprint 4.11) — spans `request`/`package`/`inspection`/`items`/`refund`/`replacement`/`repair` prefixes, not one uniform mapping (see `ReturnTransitioned`'s doc comment). */
const EVENT_TYPE_BY_STATUS: Readonly<Record<ReturnStatusValue, string>> = {
  requested: "returns.request.requested",
  approved: "returns.request.approved",
  rejected: "returns.request.rejected",
  rma_generated: "returns.package.rma_generated",
  package_received: "returns.package.received",
  inspection_completed: "returns.inspection.completed",
  items_accepted: "returns.items.accepted",
  items_rejected: "returns.items.rejected",
  refund_requested: "returns.refund.requested",
  replacement_requested: "returns.replacement.requested",
  repair_requested: "returns.repair.requested",
  closed: "returns.request.closed",
};

const RESOLUTION_STATUS_BY_OUTCOME: Readonly<Record<ResolutionOutcome, ReturnStatusValue>> = {
  refund: "refund_requested",
  replacement: "replacement_requested",
  repair: "repair_requested",
};

/**
 * RFC-4122-shaped (version 5, variant 10) UUID deterministically derived from `input`. `attempts`
 * and `inspections` need a stable id derived from this aggregate's id plus a discriminator, but
 * `id_column` is `@db.Uuid` in Postgres (Phase A.25 Task 11: the previous plain string
 * concatenation — `${this.id}${n}` — was never a valid UUID and broke on the first real write;
 * never caught because no prior test exercised this against real Postgres).
 */
function deterministicUuid(input: string): string {
  const hex = createHash("sha1").update(input).digest("hex").slice(0, 32);
  const timeHiAndVersion = `5${hex.slice(13, 16)}`;
  const variantNibble = ((parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    timeHiAndVersion,
    `${variantNibble}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

interface ReturnRequestProps {
  readonly orderRef: string;
  readonly items: ReturnItem[];
  status: ReturnStatus;
  readonly attempts: ReturnAttempt[];
  readonly inspections: ReturnInspection[];
  approval?: ReturnApproval;
  rmaNumber?: string;
  refundDecision?: RefundDecision;
}

/**
 * The RMA (Return Merchandise Authorization) lifecycle, inspection results, return decisions,
 * reasons, and dispositions (Sprint 4.11). Full lifecycle: `requested` → `approved`/`rejected` →
 * `rma_generated` → `package_received` → `inspection_completed` → `items_accepted`/`items_rejected`
 * → `refund_requested`/`replacement_requested`/`repair_requested` → `closed`. Never captures
 * refunds, moves inventory, modifies orders/shipments/fulfillment, or calculates prices/taxes —
 * refunds go through `PaymentsPort` (amount caller-provided), restocking through `InventoryPort`,
 * shipment verification through `ShippingPort`.
 */
export class ReturnRequest extends AggregateRoot<ReturnRequestProps> {
  static create(id: UniqueEntityId, orderRef: string, items: readonly ReturnItem[]): ReturnRequest {
    return new ReturnRequest(
      {
        orderRef,
        items: [...items],
        status: ReturnStatus.requested(),
        attempts: [],
        inspections: [],
      },
      id,
    );
  }

  /**
   * Rebuilds a persisted return request exactly as stored - no domain events raised, persisted
   * `version` carried for optimistic locking (ADR-0003, G-12).
   */
  static reconstitute(
    id: UniqueEntityId,
    orderRef: string,
    items: readonly ReturnItem[],
    status: ReturnStatus,
    version: number,
    extra: {
      readonly attempts?: readonly ReturnAttempt[];
      readonly inspections?: readonly ReturnInspection[];
      readonly approval?: ReturnApproval;
      readonly rmaNumber?: string;
      readonly refundDecision?: RefundDecision;
    } = {},
  ): ReturnRequest {
    return new ReturnRequest(
      {
        orderRef,
        items: [...items],
        status,
        attempts: extra.attempts === undefined ? [] : [...extra.attempts],
        inspections: extra.inspections === undefined ? [] : [...extra.inspections],
        approval: extra.approval,
        rmaNumber: extra.rmaNumber,
        refundDecision: extra.refundDecision,
      },
      id,
      version,
    );
  }

  /** The generic, validated transition — every status-changing named method below delegates to this. Computes its own canonical event type per status (`EVENT_TYPE_BY_STATUS`), not a uniform `<status>` string. */
  transition(toStatus: ReturnStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status.value;
    if (!canTransitionReturn(fromStatus, toStatus)) {
      throw new BusinessRuleError(`Cannot transition return from "${fromStatus}" to "${toStatus}"`);
    }
    this.props.status = ReturnStatus.from(toStatus);
    this.addDomainEvent(
      new ReturnTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          orderRef: this.props.orderRef,
          type: EVENT_TYPE_BY_STATUS[toStatus],
          fromStatus,
          toStatus,
        },
      ),
    );
  }

  approve(eventId: string, occurredAt: Date, note?: string): void {
    this.transition("approved", eventId, occurredAt);
    this.props.approval = ReturnApproval.approve(occurredAt, note);
    this.recordAttempt("approval", "succeeded", occurredAt);
  }

  reject(eventId: string, occurredAt: Date, note?: string): void {
    this.transition("rejected", eventId, occurredAt);
    this.props.approval = ReturnApproval.reject(occurredAt, note);
    this.recordAttempt("approval", "failed", occurredAt, note);
  }

  generateRma(rmaNumber: string, eventId: string, occurredAt: Date): void {
    this.props.rmaNumber = rmaNumber;
    this.transition("rma_generated", eventId, occurredAt);
    this.recordAttempt("rma", "succeeded", occurredAt, rmaNumber);
  }

  receivePackage(eventId: string, occurredAt: Date): void {
    this.transition("package_received", eventId, occurredAt);
    this.recordAttempt("receive", "succeeded", occurredAt);
  }

  /** Idempotent by `itemRef` — recording a second inspection for the same item is a no-op (no new `ReturnInspection`, no attempt). */
  inspectItem(itemRef: string, passed: boolean, occurredAt: Date, note?: string): void {
    if (this.props.inspections.some((inspection) => inspection.itemRef === itemRef)) {
      return;
    }
    this.props.inspections.push(
      ReturnInspection.create(
        UniqueEntityId.from(deterministicUuid(`${this.id.toString()}:inspection:${itemRef}`)),
        itemRef,
        passed,
        occurredAt,
        note,
      ),
    );
    this.recordAttempt("inspection", "succeeded", occurredAt, itemRef);
  }

  completeInspection(eventId: string, occurredAt: Date): void {
    this.transition("inspection_completed", eventId, occurredAt);
  }

  /** Records each accepted item's disposition and transitions to `items_accepted`. */
  acceptItems(
    dispositions: readonly {
      readonly orderItemRef: string;
      readonly disposition: ReturnDisposition;
    }[],
    eventId: string,
    occurredAt: Date,
  ): void {
    for (const { orderItemRef, disposition } of dispositions) {
      const item = this.props.items.find((candidate) => candidate.orderItemRef === orderItemRef);
      item?.setDisposition(disposition);
    }
    this.transition("items_accepted", eventId, occurredAt);
    this.recordAttempt("accept", "succeeded", occurredAt);
  }

  rejectItems(reason: string, eventId: string, occurredAt: Date): void {
    this.transition("items_rejected", eventId, occurredAt);
    this.recordAttempt("accept", "failed", occurredAt, reason);
  }

  /** Records the chosen resolution (refund/replacement/repair) and transitions accordingly. */
  decideResolution(decision: RefundDecision, eventId: string, occurredAt: Date): void {
    this.props.refundDecision = decision;
    this.transition(RESOLUTION_STATUS_BY_OUTCOME[decision.outcome], eventId, occurredAt);
    this.recordAttempt("resolution", "succeeded", occurredAt, decision.outcome);
  }

  close(eventId: string, occurredAt: Date): void {
    this.transition("closed", eventId, occurredAt);
  }

  /** Records a warehouse callback receipt as an append-only attempt — replay-safety is enforced by the application layer checking `attempts` for this same `reference` (Phase A.18) before this is ever called twice for the same callback. */
  recordWarehouseCallback(occurredAt: Date, reference?: string): void {
    this.recordAttempt("warehouse_callback", "succeeded", occurredAt, reference);
  }

  private recordAttempt(
    kind: ReturnAttemptKind,
    outcome: ReturnAttemptOutcome,
    occurredAt: Date,
    reference?: string,
  ): void {
    this.props.attempts.push(
      ReturnAttempt.create(
        UniqueEntityId.from(
          deterministicUuid(`${this.id.toString()}:attempt:${this.props.attempts.length}`),
        ),
        kind,
        outcome,
        occurredAt,
        reference,
      ),
    );
  }

  get orderRef(): string {
    return this.props.orderRef;
  }

  get items(): readonly ReturnItem[] {
    return this.props.items;
  }

  get status(): ReturnStatus {
    return this.props.status;
  }

  /** The append-only lifecycle-attempt log (persisted verbatim). */
  get attempts(): readonly ReturnAttempt[] {
    return this.props.attempts;
  }

  /** The append-only per-item inspection log (persisted verbatim). */
  get inspections(): readonly ReturnInspection[] {
    return this.props.inspections;
  }

  get approval(): ReturnApproval | undefined {
    return this.props.approval;
  }

  get rmaNumber(): string | undefined {
    return this.props.rmaNumber;
  }

  get refundDecision(): RefundDecision | undefined {
    return this.props.refundDecision;
  }
}

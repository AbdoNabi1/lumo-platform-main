import { AggregateRoot, BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { FulfillmentTransitioned } from "./events/fulfillment-transitioned.event";
import {
  FulfillmentAttempt,
  type FulfillmentAttemptKind,
  type FulfillmentAttemptOutcome,
} from "./fulfillment-attempt";
import type { FulfillmentItem } from "./value-objects/fulfillment-item";
import type { CarrierReference, TrackingNumber } from "./value-objects/fulfillment-refs";
import {
  canTransitionFulfillment,
  FulfillmentStatus,
  type FulfillmentStatusValue,
} from "./value-objects/fulfillment-status";
import type { ShipmentPackage } from "./value-objects/shipment-package";

interface FulfillmentOrderProps {
  readonly orderRef: string;
  readonly items: FulfillmentItem[];
  status: FulfillmentStatus;
  readonly attempts: FulfillmentAttempt[];
  readonly packages: ShipmentPackage[];
  carrierReference?: CarrierReference;
  trackingNumber?: TrackingNumber;
  deliveredAt?: Date;
}

/**
 * Source of truth for how an order is fulfilled and shipped (carrier-agnostic; Sprint 4.9). Full
 * lifecycle: `created` → `reservation_requested` → `confirmed`/`failed` → `picking_started` →
 * `picking_completed` → `packing_started` → `packing_completed` → `shipment_created` →
 * `tracking_assigned` → `shipment_dispatched` → `in_transit` → `out_for_delivery` →
 * `delivered`/`delivery_failed` → `returned`, with `cancelled`/`closed` side paths. Reuses the
 * transition-table + append-only-attempt-log pattern established in Orders (4.7) / Payments (4.8).
 * Never reserves/modifies inventory itself (asks `InventoryPort`), never modifies orders (reports
 * via `OrdersPort`), never captures payments, never calculates prices/taxes/shipping costs. Carrier
 * integration is fully abstracted behind `ShippingProviderPort` — no provider-specific logic here.
 */
export class FulfillmentOrder extends AggregateRoot<FulfillmentOrderProps> {
  static create(
    id: UniqueEntityId,
    orderRef: string,
    items: readonly FulfillmentItem[],
  ): FulfillmentOrder {
    return new FulfillmentOrder(
      {
        orderRef,
        items: [...items],
        status: FulfillmentStatus.created(),
        attempts: [],
        packages: [],
      },
      id,
    );
  }

  /**
   * Rebuilds a persisted fulfillment order exactly as stored - no domain events raised, persisted
   * `version` carried for optimistic locking (ADR-0003, G-12).
   */
  static reconstitute(
    id: UniqueEntityId,
    orderRef: string,
    items: readonly FulfillmentItem[],
    status: FulfillmentStatus,
    version: number,
    extra: {
      readonly attempts?: readonly FulfillmentAttempt[];
      readonly packages?: readonly ShipmentPackage[];
      readonly carrierReference?: CarrierReference;
      readonly trackingNumber?: TrackingNumber;
      readonly deliveredAt?: Date;
    } = {},
  ): FulfillmentOrder {
    return new FulfillmentOrder(
      {
        orderRef,
        items: [...items],
        status,
        attempts: extra.attempts === undefined ? [] : [...extra.attempts],
        packages: extra.packages === undefined ? [] : [...extra.packages],
        carrierReference: extra.carrierReference,
        trackingNumber: extra.trackingNumber,
        deliveredAt: extra.deliveredAt,
      },
      id,
      version,
    );
  }

  /** The generic, validated transition — every named method below delegates to this. */
  transition(toStatus: FulfillmentStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status.value;
    if (!canTransitionFulfillment(fromStatus, toStatus)) {
      throw new BusinessRuleError(
        `Cannot transition fulfillment from "${fromStatus}" to "${toStatus}"`,
      );
    }
    this.props.status = FulfillmentStatus.from(toStatus);
    this.addDomainEvent(
      new FulfillmentTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        { orderRef: this.props.orderRef, fromStatus, toStatus },
      ),
    );
  }

  /** Requests a stock reservation from Inventory (`InventoryPort`) — Fulfillment never reserves stock itself. */
  requestReservation(eventId: string, occurredAt: Date): void {
    this.transition("reservation_requested", eventId, occurredAt);
    this.recordAttempt("reservation", "succeeded", occurredAt);
  }

  confirmReservation(eventId: string, occurredAt: Date): void {
    this.transition("confirmed", eventId, occurredAt);
  }

  failReservation(reason: string, eventId: string, occurredAt: Date): void {
    this.transition("failed", eventId, occurredAt);
    this.recordAttempt("reservation", "failed", occurredAt, reason);
  }

  startPicking(eventId: string, occurredAt: Date): void {
    this.transition("picking_started", eventId, occurredAt);
  }

  completePicking(eventId: string, occurredAt: Date): void {
    this.transition("picking_completed", eventId, occurredAt);
  }

  startPacking(eventId: string, occurredAt: Date): void {
    this.transition("packing_started", eventId, occurredAt);
  }

  /** Records a physical parcel produced while packing (does not itself transition). */
  addPackage(shipmentPackage: ShipmentPackage): void {
    this.props.packages.push(shipmentPackage);
  }

  completePacking(eventId: string, occurredAt: Date): void {
    this.transition("packing_completed", eventId, occurredAt);
  }

  /** Requests a shipment from the carrier (`ShippingProviderPort.createShipment`, idempotency-keyed) — records the {@link CarrierReference} and transitions to `shipment_created`. */
  createShipment(carrierReference: CarrierReference, eventId: string, occurredAt: Date): void {
    this.props.carrierReference = carrierReference;
    this.transition("shipment_created", eventId, occurredAt);
    this.recordAttempt("shipment", "succeeded", occurredAt);
  }

  /** Records the carrier's tracking number and transitions to `tracking_assigned`. */
  assignTracking(trackingNumber: TrackingNumber, eventId: string, occurredAt: Date): void {
    this.props.trackingNumber = trackingNumber;
    this.transition("tracking_assigned", eventId, occurredAt);
  }

  dispatch(eventId: string, occurredAt: Date): void {
    this.transition("shipment_dispatched", eventId, occurredAt);
  }

  markInTransit(eventId: string, occurredAt: Date): void {
    this.transition("in_transit", eventId, occurredAt);
  }

  markOutForDelivery(eventId: string, occurredAt: Date): void {
    this.transition("out_for_delivery", eventId, occurredAt);
  }

  /** Marks delivery complete — records `deliveredAt`. */
  markDelivered(eventId: string, occurredAt: Date): void {
    this.transition("delivered", eventId, occurredAt);
    this.props.deliveredAt = occurredAt;
  }

  markDeliveryFailed(reason: string, eventId: string, occurredAt: Date): void {
    this.transition("delivery_failed", eventId, occurredAt);
    this.recordAttempt("shipment", "failed", occurredAt, reason);
  }

  markReturned(eventId: string, occurredAt: Date): void {
    this.transition("returned", eventId, occurredAt);
  }

  cancel(eventId: string, occurredAt: Date): void {
    this.transition("cancelled", eventId, occurredAt);
  }

  close(eventId: string, occurredAt: Date): void {
    this.transition("closed", eventId, occurredAt);
  }

  /** Records a carrier webhook receipt as an append-only attempt (replay-safety is enforced by the application layer's `ProcessedCarrierWebhookStore`, before this is ever called twice for the same event). The application layer follows this with its own validated `transition()` call for recognized kinds. */
  recordCarrierWebhook(kind: string, occurredAt: Date): void {
    this.recordAttempt("carrier_webhook", "succeeded", occurredAt, kind);
  }

  private recordAttempt(
    kind: FulfillmentAttemptKind,
    outcome: FulfillmentAttemptOutcome,
    occurredAt: Date,
    reference?: string,
  ): void {
    this.props.attempts.push(
      FulfillmentAttempt.create(
        UniqueEntityId.from(this.id.toString() + this.props.attempts.length),
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

  get items(): readonly FulfillmentItem[] {
    return this.props.items;
  }

  get status(): FulfillmentStatus {
    return this.props.status;
  }

  /** The append-only lifecycle-attempt log (persisted verbatim). */
  get attempts(): readonly FulfillmentAttempt[] {
    return this.props.attempts;
  }

  get packages(): readonly ShipmentPackage[] {
    return this.props.packages;
  }

  get carrierReference(): CarrierReference | undefined {
    return this.props.carrierReference;
  }

  get trackingNumber(): TrackingNumber | undefined {
    return this.props.trackingNumber;
  }

  get deliveredAt(): Date | undefined {
    return this.props.deliveredAt;
  }
}

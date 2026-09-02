import { AggregateRoot, BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { ShipmentTransitioned } from "./events/shipment-transitioned.event";
import {
  ShippingAttempt,
  type ShippingAttemptKind,
  type ShippingAttemptOutcome,
} from "./shipping-attempt";
import { TrackingEvent } from "./tracking-event";
import type { DeliveryEstimate } from "./value-objects/delivery-estimate";
import type { ShipmentPackage } from "./value-objects/shipment-package";
import type { Carrier, CarrierService } from "./value-objects/carrier";
import type { ShippingLabel } from "./value-objects/shipping-label";
import type { TrackingNumber } from "./value-objects/tracking-number";
import {
  canTransitionShipment,
  RETRY_TARGET_BY_STATUS,
  ShipmentStatus,
  type ShipmentStatusValue,
} from "./value-objects/shipment-status";

/** The canonical 3-segment integration-event type for each status (Sprint 4.10) — spans `shipment`/`label`/`carrier` prefixes, not one uniform mapping (see `ShipmentTransitioned`'s doc comment). */
const EVENT_TYPE_BY_STATUS: Readonly<Record<ShipmentStatusValue, string>> = {
  created: "shipping.shipment.created",
  label_created: "shipping.label.created",
  voided: "shipping.label.voided",
  carrier_accepted: "shipping.carrier.accepted",
  rejected: "shipping.carrier.rejected",
  in_transit: "shipping.shipment.in_transit",
  out_for_delivery: "shipping.shipment.out_for_delivery",
  delivered: "shipping.shipment.delivered",
  delivery_failed: "shipping.shipment.delivery_failed",
  returned: "shipping.shipment.returned",
  exception: "shipping.shipment.exception",
  cancelled: "shipping.shipment.cancelled",
  closed: "shipping.shipment.closed",
};

interface ShipmentProps {
  readonly fulfillmentRef: string;
  readonly packages: ShipmentPackage[];
  status: ShipmentStatus;
  readonly attempts: ShippingAttempt[];
  readonly trackingEvents: TrackingEvent[];
  carrier?: Carrier;
  carrierService?: CarrierService;
  label?: ShippingLabel;
  trackingNumber?: TrackingNumber;
  deliveryEstimate?: DeliveryEstimate;
  deliveredAt?: Date;
}

/**
 * Source of truth for carrier references, shipping labels, tracking history, delivery estimates,
 * and the shipment/carrier-communication lifecycle (Sprint 4.10). Full lifecycle: `created` →
 * `label_created`/`voided` → `carrier_accepted`/`rejected` → `in_transit` → `out_for_delivery` →
 * `delivered`/`delivery_failed` → `returned`, with `exception`/`cancelled`/`closed` side paths and
 * retry from the 3 recoverable states (`rejected`/`delivery_failed`/`exception`). Distinct from
 * Fulfillment (C9): Fulfillment orchestrates the internal warehouse flow and *requests* a shipment;
 * Shipping owns the carrier lifecycle and executes it — never modifies orders, fulfillment, or
 * inventory, never captures payments, never calculates prices/taxes/checkout totals. Carrier
 * integration is fully abstracted behind `CarrierProviderPort` — no provider-specific logic here.
 */
export class Shipment extends AggregateRoot<ShipmentProps> {
  static create(
    id: UniqueEntityId,
    fulfillmentRef: string,
    packages: readonly ShipmentPackage[],
  ): Shipment {
    return new Shipment(
      {
        fulfillmentRef,
        packages: [...packages],
        status: ShipmentStatus.created(),
        attempts: [],
        trackingEvents: [],
      },
      id,
    );
  }

  /**
   * Rebuilds a persisted shipment exactly as stored - no domain events raised, persisted `version`
   * carried for optimistic locking (ADR-0003, G-12).
   */
  static reconstitute(
    id: UniqueEntityId,
    fulfillmentRef: string,
    packages: readonly ShipmentPackage[],
    status: ShipmentStatus,
    version: number,
    extra: {
      readonly attempts?: readonly ShippingAttempt[];
      readonly trackingEvents?: readonly TrackingEvent[];
      readonly carrier?: Carrier;
      readonly carrierService?: CarrierService;
      readonly label?: ShippingLabel;
      readonly trackingNumber?: TrackingNumber;
      readonly deliveryEstimate?: DeliveryEstimate;
      readonly deliveredAt?: Date;
    } = {},
  ): Shipment {
    return new Shipment(
      {
        fulfillmentRef,
        packages: [...packages],
        status,
        attempts: extra.attempts === undefined ? [] : [...extra.attempts],
        trackingEvents: extra.trackingEvents === undefined ? [] : [...extra.trackingEvents],
        carrier: extra.carrier,
        carrierService: extra.carrierService,
        label: extra.label,
        trackingNumber: extra.trackingNumber,
        deliveryEstimate: extra.deliveryEstimate,
        deliveredAt: extra.deliveredAt,
      },
      id,
      version,
    );
  }

  /** The generic, validated transition — every status-changing named method below delegates to this. Computes its own canonical event type per status (`EVENT_TYPE_BY_STATUS`), not a uniform `<status>` string. */
  transition(toStatus: ShipmentStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status.value;
    if (!canTransitionShipment(fromStatus, toStatus)) {
      throw new BusinessRuleError(
        `Cannot transition shipment from "${fromStatus}" to "${toStatus}"`,
      );
    }
    this.props.status = ShipmentStatus.from(toStatus);
    this.addDomainEvent(
      new ShipmentTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          shipmentRef: this.id.toString(),
          type: EVENT_TYPE_BY_STATUS[toStatus],
          fromStatus,
          toStatus,
        },
      ),
    );
  }

  /** Requests a label from the carrier (`CarrierProviderPort.createLabel`, idempotency-keyed) — records the label + carrier/service and transitions to `label_created`. */
  createLabel(
    label: ShippingLabel,
    carrier: Carrier,
    carrierService: CarrierService,
    trackingNumber: TrackingNumber,
    eventId: string,
    occurredAt: Date,
  ): void {
    this.props.label = label;
    this.props.carrier = carrier;
    this.props.carrierService = carrierService;
    this.props.trackingNumber = trackingNumber;
    this.transition("label_created", eventId, occurredAt);
    this.recordAttempt("label", "succeeded", occurredAt);
  }

  voidLabel(eventId: string, occurredAt: Date): void {
    this.transition("voided", eventId, occurredAt);
    this.recordAttempt("label", "succeeded", occurredAt, "voided");
  }

  acceptByCarrier(eventId: string, occurredAt: Date): void {
    this.transition("carrier_accepted", eventId, occurredAt);
    this.recordAttempt("carrier", "succeeded", occurredAt);
  }

  rejectByCarrier(reason: string, eventId: string, occurredAt: Date): void {
    this.transition("rejected", eventId, occurredAt);
    this.recordAttempt("carrier", "failed", occurredAt, reason);
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
    this.recordAttempt("carrier", "failed", occurredAt, reason);
  }

  markReturned(eventId: string, occurredAt: Date): void {
    this.transition("returned", eventId, occurredAt);
  }

  raiseException(reason: string, eventId: string, occurredAt: Date): void {
    this.transition("exception", eventId, occurredAt);
    this.recordAttempt("carrier", "failed", occurredAt, reason);
  }

  cancel(eventId: string, occurredAt: Date): void {
    this.transition("cancelled", eventId, occurredAt);
  }

  close(eventId: string, occurredAt: Date): void {
    this.transition("closed", eventId, occurredAt);
  }

  /** Retries from one of the 3 recoverable states (`rejected`/`delivery_failed`/`exception`) back into the appropriate earlier status. Throws if the current status has no retry target. */
  retry(eventId: string, occurredAt: Date): void {
    const target = RETRY_TARGET_BY_STATUS[this.props.status.value];
    if (target === undefined) {
      throw new BusinessRuleError(`Cannot retry a shipment that is ${this.props.status.value}`);
    }
    this.transition(target, eventId, occurredAt);
    this.recordAttempt("retry", "succeeded", occurredAt);
  }

  /** Appends a carrier tracking scan to the append-only history — not a status transition; raises `shipping.tracking.updated` directly. */
  addTrackingEvent(description: string, occurredAt: Date, location?: string): void {
    this.props.trackingEvents.push(
      TrackingEvent.create(
        UniqueEntityId.from(this.id.toString() + this.props.trackingEvents.length),
        description,
        occurredAt,
        location,
      ),
    );
    this.raiseNonTransitionEvent("shipping.tracking.updated", occurredAt);
  }

  /** Records a carrier-provided delivery window — not a status transition; raises `shipping.tracking.estimate_set` directly. */
  setDeliveryEstimate(estimate: DeliveryEstimate, occurredAt: Date): void {
    this.props.deliveryEstimate = estimate;
    this.raiseNonTransitionEvent("shipping.tracking.estimate_set", occurredAt);
  }

  /** Records a carrier webhook receipt as an append-only attempt (replay-safety is enforced by the application layer's `ProcessedCarrierWebhookStore`). The application layer follows this with its own validated `transition()`/`addTrackingEvent()` call. */
  recordCarrierWebhook(kind: string, occurredAt: Date): void {
    this.recordAttempt("carrier_webhook", "succeeded", occurredAt, kind);
  }

  private raiseNonTransitionEvent(type: string, occurredAt: Date): void {
    const status = this.props.status.value;
    const eventId = `${this.id.toString()}:${type}:${this.domainEvents.length}:${occurredAt.getTime()}`;
    this.addDomainEvent(
      new ShipmentTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        { shipmentRef: this.id.toString(), type, fromStatus: status, toStatus: status },
      ),
    );
  }

  private recordAttempt(
    kind: ShippingAttemptKind,
    outcome: ShippingAttemptOutcome,
    occurredAt: Date,
    reference?: string,
  ): void {
    this.props.attempts.push(
      ShippingAttempt.create(
        UniqueEntityId.from(this.id.toString() + this.props.attempts.length),
        kind,
        outcome,
        occurredAt,
        reference,
      ),
    );
  }

  get fulfillmentRef(): string {
    return this.props.fulfillmentRef;
  }

  get packages(): readonly ShipmentPackage[] {
    return this.props.packages;
  }

  get status(): ShipmentStatus {
    return this.props.status;
  }

  /** The append-only lifecycle-attempt log (persisted verbatim). */
  get attempts(): readonly ShippingAttempt[] {
    return this.props.attempts;
  }

  /** The append-only carrier tracking history (persisted verbatim). */
  get trackingEvents(): readonly TrackingEvent[] {
    return this.props.trackingEvents;
  }

  get carrier(): Carrier | undefined {
    return this.props.carrier;
  }

  get carrierService(): CarrierService | undefined {
    return this.props.carrierService;
  }

  get label(): ShippingLabel | undefined {
    return this.props.label;
  }

  get trackingNumber(): TrackingNumber | undefined {
    return this.props.trackingNumber;
  }

  get deliveryEstimate(): DeliveryEstimate | undefined {
    return this.props.deliveryEstimate;
  }

  get deliveredAt(): Date | undefined {
    return this.props.deliveredAt;
  }
}

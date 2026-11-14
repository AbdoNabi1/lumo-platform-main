import { AggregateRoot, BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { attemptIdFor } from "./attempt-id";
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

  /**
   * Requests a label from the carrier (`CarrierProviderPort.createLabel`, idempotency-keyed) —
   * records the label + carrier/service and transitions to `label_created`. On the carrier path,
   * `reference` is the open pending attempt's reference, and the `succeeded` row closes it.
   */
  createLabel(
    label: ShippingLabel,
    carrier: Carrier,
    carrierService: CarrierService,
    trackingNumber: TrackingNumber,
    eventId: string,
    occurredAt: Date,
    reference?: string,
  ): void {
    this.props.label = label;
    this.props.carrier = carrier;
    this.props.carrierService = carrierService;
    this.props.trackingNumber = trackingNumber;
    this.transition("label_created", eventId, occurredAt);
    this.recordAttempt("label", "succeeded", occurredAt, reference);
  }

  /**
   * The open carrier label request (Ruling 4): the latest `label`/`pending` attempt whose
   * reference has no later `label` attempt. Attempts are append-only, so a pending row is closed
   * by appending a `succeeded`/`failed` `label` row with the same reference, never by rewriting.
   */
  pendingLabelAttempt(): ShippingAttempt | undefined {
    const settled = new Set<string | undefined>();
    for (let i = this.props.attempts.length - 1; i >= 0; i -= 1) {
      const attempt = this.props.attempts[i];
      if (attempt === undefined || attempt.kind !== "label") continue;
      if (attempt.outcome === "pending" && !settled.has(attempt.reference)) return attempt;
      settled.add(attempt.reference);
    }
    return undefined;
  }

  /** `${base}-${1 + number of pending label attempts}` (Ruling 4): each carrier request gets a fresh reference. */
  nextLabelReference(base: string): string {
    const started = this.props.attempts.filter(
      (a) => a.kind === "label" && a.outcome === "pending",
    ).length;
    return `${base}-${started + 1}`;
  }

  /** Opens a carrier label request (appends `label`/`pending`/`reference`). Throws if one is already open or the status can't reach `label_created`. */
  beginLabelAttempt(reference: string, occurredAt: Date): void {
    const open = this.pendingLabelAttempt();
    if (open !== undefined) {
      throw new BusinessRuleError(
        `Shipment ${this.id.toString()} already has a pending label attempt (${String(open.reference)})`,
      );
    }
    if (!canTransitionShipment(this.props.status.value, "label_created")) {
      throw new BusinessRuleError(
        `Cannot start a label attempt for a shipment that is ${this.props.status.value}`,
      );
    }
    this.recordAttempt("label", "pending", occurredAt, reference);
  }

  /** Closes the open carrier label request as failed (appends `label`/`failed`/`reference`). */
  failLabelAttempt(reference: string, occurredAt: Date): void {
    this.requireOpenLabelAttempt(reference);
    this.recordAttempt("label", "failed", occurredAt, reference);
  }

  /**
   * The carrier's answer to the open label request is unknown (§9a.5): `created → exception`,
   * recording `carrier`/`failed`/`CARRIER_RESULT_UNKNOWN:<reference>`. The pending attempt stays
   * open, so {@link needsCarrierReview} holds until `retry()` closes it.
   */
  markCarrierResultUnknown(reference: string, eventId: string, occurredAt: Date): void {
    this.requireOpenLabelAttempt(reference);
    this.transition("exception", eventId, occurredAt);
    this.recordAttempt("carrier", "failed", occurredAt, `CARRIER_RESULT_UNKNOWN:${reference}`);
  }

  /** The merchant must check the carrier before shipping again: status `exception` with an open label attempt. */
  get needsCarrierReview(): boolean {
    return this.props.status.value === "exception" && this.pendingLabelAttempt() !== undefined;
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
    // Ruling 42: the merchant has checked the carrier, so the unknown request is closed as failed
    // and the next request goes out under the next reference.
    const pending =
      this.props.status.value === "exception" ? this.pendingLabelAttempt() : undefined;
    if (pending?.reference !== undefined) {
      this.failLabelAttempt(pending.reference, occurredAt);
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

  private requireOpenLabelAttempt(reference: string): void {
    if (this.pendingLabelAttempt()?.reference !== reference) {
      throw new BusinessRuleError(
        `Shipment ${this.id.toString()} has no pending label attempt "${reference}"`,
      );
    }
  }

  private recordAttempt(
    kind: ShippingAttemptKind,
    outcome: ShippingAttemptOutcome,
    occurredAt: Date,
    reference?: string,
  ): void {
    this.props.attempts.push(
      ShippingAttempt.create(
        UniqueEntityId.from(attemptIdFor(this.id.toString(), this.props.attempts.length)),
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

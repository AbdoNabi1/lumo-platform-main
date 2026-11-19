import type { UseCase } from "@platform/application";
import { BusinessRuleError, isDomainError } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { FulfillmentOrder } from "../domain/fulfillment-order";
import {
  fulfillmentCarrierPathTo,
  type FulfillmentStatusValue,
} from "../domain/value-objects/fulfillment-status";
import { CarrierReference, TrackingNumber } from "../domain/value-objects/fulfillment-refs";
import { withConcurrencyRetry } from "./concurrency-retry";
import type { FulfillmentOrderStatusOutput } from "./create-fulfillment.use-case";
import {
  type FulfillmentLifecycleDeps,
  type FulfillmentOrderIdInput,
  notifyBestEffort,
} from "./fulfillment-lifecycle.use-cases";
import type { RequestReservation } from "./request-reservation.use-case";

const MAX_CONCURRENCY_RETRIES = 5;

/** The stages `PrepareForCarrierShipment` walks after a confirmed reservation, in order. */
const PREPARE_WALK: readonly FulfillmentStatusValue[] = [
  "confirmed",
  "picking_started",
  "picking_completed",
  "packing_started",
  "packing_completed",
];

/** Statuses at which a label is attached (or about to be): the order is packed and not yet picked up. */
const PACKED_OR_LABELLED: ReadonlySet<FulfillmentStatusValue> = new Set([
  "packing_completed",
  "shipment_created",
  "tracking_assigned",
]);

const RESERVATION_STATUSES: ReadonlySet<FulfillmentStatusValue> = new Set([
  "created",
  "failed",
  "reservation_requested",
]);

/** What a mutation decided: the new state is `changed`, or it was already as wanted. */
type Mutation = Result<{ readonly changed: boolean }, DomainError>;

/**
 * Reads the order, applies `mutate`, and — only when it changed something — saves (outbox in the
 * same transaction) and notifies best-effort. The whole read/apply/save is retried on an
 * optimistic-lock conflict. A thrown domain error becomes a `Result` error.
 */
async function mutateOrder(
  deps: FulfillmentLifecycleDeps,
  input: FulfillmentOrderIdInput,
  mutate: (order: FulfillmentOrder) => Mutation,
): Promise<Result<FulfillmentOrderStatusOutput & { readonly changed: boolean }, DomainError>> {
  return withConcurrencyRetry(MAX_CONCURRENCY_RETRIES, () =>
    deps.unitOfWork.run<
      Result<FulfillmentOrderStatusOutput & { readonly changed: boolean }, DomainError>
    >(async (tx) => {
      const order = await deps.fulfillmentOrders.findById(
        input.fulfillmentOrderId,
        input.tenantId,
        tx,
      );
      if (order === null) return err(new NotFoundError("Fulfillment order not found"));
      let outcome: Mutation;
      try {
        outcome = mutate(order);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      if (!outcome.ok) return err(outcome.error);
      if (outcome.value.changed) {
        await deps.fulfillmentOrders.save(order, input.tenantId, tx);
        await notifyBestEffort(deps, order, input.tenantId);
      }
      return ok({
        fulfillmentOrderId: order.id.toString(),
        status: order.status.value,
        changed: outcome.value.changed,
      });
    }),
  );
}

function statusOnly(
  result: Result<FulfillmentOrderStatusOutput & { readonly changed: boolean }, DomainError>,
): Result<FulfillmentOrderStatusOutput, DomainError> {
  if (!result.ok) return err(result.error);
  return ok({
    fulfillmentOrderId: result.value.fulfillmentOrderId,
    status: result.value.status,
  });
}

export interface PrepareForCarrierShipmentDeps extends FulfillmentLifecycleDeps {
  readonly requestReservation: Pick<RequestReservation, "execute">;
}

/**
 * Takes a fulfillment order to `packing_completed` in one call (spec 9a.3): reserves stock when it
 * has not been reserved yet, then walks pick and pack. Resumable from any step; an order already
 * packed or labelled is returned as it is.
 */
export class PrepareForCarrierShipment implements UseCase<
  FulfillmentOrderIdInput,
  FulfillmentOrderStatusOutput,
  DomainError
> {
  private readonly deps: PrepareForCarrierShipmentDeps;

  constructor(deps: PrepareForCarrierShipmentDeps) {
    this.deps = deps;
  }

  async execute(
    input: FulfillmentOrderIdInput,
  ): Promise<Result<FulfillmentOrderStatusOutput, DomainError>> {
    const current = await this.deps.fulfillmentOrders.findById(
      input.fulfillmentOrderId,
      input.tenantId,
    );
    if (current === null) return err(new NotFoundError("Fulfillment order not found"));

    if (RESERVATION_STATUSES.has(current.status.value)) {
      const reserved = await this.deps.requestReservation.execute(input);
      if (!reserved.ok) return err(reserved.error);
      if (reserved.value.status === "failed") {
        return err(
          new BusinessRuleError("STOCK_NOT_RESERVED: inventory could not reserve this order"),
        );
      }
      if (reserved.value.status === "reservation_requested") {
        return err(
          new BusinessRuleError(
            "SHIPMENT_IN_PROGRESS: another request is reserving stock for this order",
          ),
        );
      }
    }

    return statusOnly(
      await mutateOrder(this.deps, input, (order) => {
        const from = order.status.value;
        if (PACKED_OR_LABELLED.has(from)) return ok({ changed: false });
        const index = PREPARE_WALK.indexOf(from);
        if (index < 0) {
          return err(
            new BusinessRuleError(
              `FULFILLMENT_NOT_SHIPPABLE: a fulfillment order in "${from}" cannot be prepared for a carrier`,
            ),
          );
        }
        for (const step of PREPARE_WALK.slice(index + 1)) {
          order.transition(step, this.deps.idGenerator.generate(), this.deps.clock.now());
        }
        return ok({ changed: true });
      }),
    );
  }
}

/** The domain calls of an attach, shared by `AttachCarrierShipment` and `MirrorShipmentStatus`: `packing_completed` → `shipment_created` (when needed) → `tracking_assigned`. */
function applyCarrierAttach(
  order: FulfillmentOrder,
  reference: CarrierReference,
  tracking: TrackingNumber,
  eventId: () => string,
  at: Date,
): void {
  if (order.status.value === "packing_completed") order.createShipment(reference, eventId(), at);
  order.assignTracking(tracking, eventId(), at);
}

export interface AttachCarrierShipmentInput extends FulfillmentOrderIdInput {
  readonly carrier: string;
  readonly carrierShipmentId: string;
  readonly trackingNumber: string;
}

/** Records a carrier's label on a packed order: `packing_completed` → `shipment_created` → `tracking_assigned`. Idempotent for the same tracking number (Ruling 35). */
export class AttachCarrierShipment implements UseCase<
  AttachCarrierShipmentInput,
  FulfillmentOrderStatusOutput,
  DomainError
> {
  private readonly deps: FulfillmentLifecycleDeps;

  constructor(deps: FulfillmentLifecycleDeps) {
    this.deps = deps;
  }

  async execute(
    input: AttachCarrierShipmentInput,
  ): Promise<Result<FulfillmentOrderStatusOutput, DomainError>> {
    const reference = CarrierReference.create(input.carrier, input.carrierShipmentId);
    if (!reference.ok) return err(reference.error);
    const tracking = TrackingNumber.create(input.trackingNumber);
    if (!tracking.ok) return err(tracking.error);

    return statusOnly(
      await mutateOrder(this.deps, input, (order) => {
        const from = order.status.value;
        const eventId = (): string => this.deps.idGenerator.generate();
        if (from === "tracking_assigned") {
          if (order.trackingNumber?.value === input.trackingNumber) return ok({ changed: false });
          return err(
            new BusinessRuleError(
              "FULFILLMENT_NOT_ATTACHABLE: this order already carries a different tracking number",
            ),
          );
        }
        if (from !== "packing_completed" && from !== "shipment_created") {
          return err(
            new BusinessRuleError(
              `FULFILLMENT_NOT_ATTACHABLE: a fulfillment order in "${from}" cannot take a carrier shipment`,
            ),
          );
        }
        applyCarrierAttach(order, reference.value, tracking.value, eventId, this.deps.clock.now());
        return ok({ changed: true });
      }),
    );
  }
}

export interface DetachCarrierShipmentInput extends FulfillmentOrderIdInput {
  readonly expectedTrackingNumber?: string;
}

/** Voids the label only when its optional expected tracking identity still matches. */
export class DetachCarrierShipment implements UseCase<
  DetachCarrierShipmentInput,
  FulfillmentOrderStatusOutput & { readonly changed: boolean },
  DomainError
> {
  private readonly deps: FulfillmentLifecycleDeps;

  constructor(deps: FulfillmentLifecycleDeps) {
    this.deps = deps;
  }

  async execute(
    input: DetachCarrierShipmentInput,
  ): Promise<Result<FulfillmentOrderStatusOutput & { readonly changed: boolean }, DomainError>> {
    return mutateOrder(this.deps, input, (order) => {
      if (
        input.expectedTrackingNumber !== undefined &&
        order.trackingNumber?.value !== input.expectedTrackingNumber
      ) {
        return ok({ changed: false });
      }
      const from = order.status.value;
      if (from === "packing_completed") return ok({ changed: false });
      if (from !== "shipment_created" && from !== "tracking_assigned") {
        return err(
          new BusinessRuleError(
            `FULFILLMENT_ALREADY_DISPATCHED: a fulfillment order in "${from}" no longer holds a voidable label`,
          ),
        );
      }
      order.returnToPacking(this.deps.idGenerator.generate(), this.deps.clock.now());
      return ok({ changed: true });
    });
  }
}

export interface MirrorShipmentStatusInput extends FulfillmentOrderIdInput {
  readonly shipmentStatus: string;
  /** With `trackingNumber` and `carrierShipmentId`, lets a packed order take the label before it mirrors (F16). */
  readonly carrier?: string;
  readonly trackingNumber?: string;
  readonly carrierShipmentId?: string;
}

/** Shipment statuses that never attach a label on their own. */
const NO_ATTACH_STATUSES: ReadonlySet<string> = new Set([
  "created",
  "label_created",
  "voided",
  "cancelled",
]);

/** Shipment status → the fulfillment status it drives (spec 9a.4). */
const MIRROR_TARGETS: Readonly<Record<string, FulfillmentStatusValue>> = {
  carrier_accepted: "shipment_dispatched",
  in_transit: "in_transit",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  delivery_failed: "delivery_failed",
  returned: "returned",
};

/**
 * Mirrors a shipment status onto its fulfillment order (spec 9a.4, Ruling 24). Walks
 * `fulfillmentCarrierPathTo`; an unreachable or unrecognised status is `changed: false`, never an
 * error, so a late or out-of-order carrier scan cannot fail a webhook. A `cancelled` shipment
 * returns the order to `packing_completed`, and only before pickup.
 */
export class MirrorShipmentStatus implements UseCase<
  MirrorShipmentStatusInput,
  FulfillmentOrderStatusOutput & { readonly changed: boolean },
  DomainError
> {
  private readonly deps: FulfillmentLifecycleDeps;

  constructor(deps: FulfillmentLifecycleDeps) {
    this.deps = deps;
  }

  async execute(
    input: MirrorShipmentStatusInput,
  ): Promise<Result<FulfillmentOrderStatusOutput & { readonly changed: boolean }, DomainError>> {
    return mutateOrder(this.deps, input, (order) => {
      let from = order.status.value;
      const eventId = (): string => this.deps.idGenerator.generate();
      const now = (): Date => this.deps.clock.now();

      // A predecessor shipment (another tracking number) never moves this fulfillment.
      if (
        input.trackingNumber !== undefined &&
        order.trackingNumber !== undefined &&
        order.trackingNumber.value !== input.trackingNumber
      ) {
        return ok({ changed: false });
      }

      if (input.shipmentStatus === "cancelled") {
        if (from !== "shipment_created" && from !== "tracking_assigned") {
          return ok({ changed: false });
        }
        order.returnToPacking(eventId(), now());
        return ok({ changed: true });
      }

      const target = MIRROR_TARGETS[input.shipmentStatus];
      let attached = false;
      if (
        from === "packing_completed" &&
        !NO_ATTACH_STATUSES.has(input.shipmentStatus) &&
        input.carrier !== undefined &&
        input.trackingNumber !== undefined &&
        input.carrierShipmentId !== undefined
      ) {
        const reference = CarrierReference.create(input.carrier, input.carrierShipmentId);
        const tracking = TrackingNumber.create(input.trackingNumber);
        if (!reference.ok) return err(reference.error);
        if (!tracking.ok) return err(tracking.error);
        applyCarrierAttach(order, reference.value, tracking.value, eventId, now());
        attached = true;
        from = order.status.value;
      }
      if (target === undefined) return ok({ changed: attached });
      const path = fulfillmentCarrierPathTo(from, target);
      if (path === null || path.length === 0) return ok({ changed: attached });

      for (const step of path.slice(0, -1)) order.transition(step, eventId(), now());
      switch (target) {
        case "delivered":
          order.markDelivered(eventId(), now());
          break;
        case "delivery_failed":
          order.markDeliveryFailed("carrier_reported", eventId(), now());
          break;
        case "returned":
          order.markReturned(eventId(), now());
          break;
        default:
          order.transition(target, eventId(), now());
      }
      return ok({ changed: true });
    });
  }
}

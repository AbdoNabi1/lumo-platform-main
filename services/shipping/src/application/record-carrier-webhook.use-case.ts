import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import type { Shipment } from "../domain/shipment";
import type { ShipmentRepository } from "../domain/shipment-repository";
import { carrierPathTo, type ShipmentStatusValue } from "../domain/value-objects/shipment-status";
import { withConcurrencyRetry } from "./concurrency-retry";
import type { ProcessedCarrierWebhookStore } from "./ports";

export interface RecordCarrierWebhookInput {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
  readonly carrier: string;
  readonly eventId: string;
  readonly kind: string;
  /** Exactly one of shipmentId / trackingNumber. */
  readonly shipmentId?: string;
  readonly trackingNumber?: string;
  /** Carrier-mapped target; when set it wins over KIND_TO_STATUS. */
  readonly toStatus?: ShipmentStatusValue;
  readonly scan?: {
    readonly description: string;
    readonly location?: string;
    readonly occurredAt: Date;
  };
  /** For delivery_failed / exception attempts. */
  readonly reason?: string;
}

export interface RecordCarrierWebhookOutput {
  readonly shipmentId: string;
  readonly fulfillmentRef: string;
  readonly status: string;
  readonly duplicate: boolean;
  /** The statuses entered, in order; [] for a scan only. */
  readonly transitions: readonly ShipmentStatusValue[];
  readonly carrier: string;
  readonly trackingNumber: string | null;
  readonly carrierDeliveryId: string | null;
  /** True when this is the newest shipment of its fulfillment (plan review 1, finding 7). */
  readonly isCurrentShipment: boolean;
}

export interface RecordCarrierWebhookDeps {
  readonly shipments: ShipmentRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly processedCarrierWebhooks: ProcessedCarrierWebhookStore;
}

/** Carrier webhook kinds that map directly onto a validated lifecycle transition (Sprint 4.10). Unrecognized kinds are still recorded, just don't transition. */
const KIND_TO_STATUS: Readonly<Record<string, ShipmentStatusValue>> = {
  accepted: "carrier_accepted",
  rejected: "rejected",
  in_transit: "in_transit",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  delivery_failed: "delivery_failed",
  returned: "returned",
  exception: "exception",
};

/** Records a carrier webhook idempotently (`ProcessedCarrierWebhookStore`, replay-safe) and walks the carrier's status over the shipment's transition table (Ruling 23). Signature verification is the carrier adapter's job, never this use case's. */
export class RecordCarrierWebhook implements UseCase<
  RecordCarrierWebhookInput,
  RecordCarrierWebhookOutput,
  DomainError
> {
  private readonly deps: RecordCarrierWebhookDeps;

  constructor(deps: RecordCarrierWebhookDeps) {
    this.deps = deps;
  }

  async execute(
    input: RecordCarrierWebhookInput,
  ): Promise<Result<RecordCarrierWebhookOutput, DomainError>> {
    const carrier = Guard.againstEmpty(input.carrier, "carrier");
    if (!carrier.ok) return err(carrier.error);
    const eventId = Guard.againstEmpty(input.eventId, "eventId");
    if (!eventId.ok) return err(eventId.error);
    if ((input.shipmentId === undefined) === (input.trackingNumber === undefined)) {
      return err(new ValidationError("Exactly one of shipmentId or trackingNumber is required"));
    }

    return withConcurrencyRetry(5, () =>
      this.deps.unitOfWork.run<Result<RecordCarrierWebhookOutput, DomainError>>((tx) =>
        this.recordOnce(input, tx),
      ),
    );
  }

  private async recordOnce(
    input: RecordCarrierWebhookInput,
    tx: unknown,
  ): Promise<Result<RecordCarrierWebhookOutput, DomainError>> {
    const { shipments, processedCarrierWebhooks } = this.deps;
    const shipment =
      input.shipmentId !== undefined
        ? await shipments.findById(input.shipmentId, input.tenantId, tx)
        : await shipments.findByTrackingNumber(
            input.carrier,
            input.trackingNumber ?? "",
            input.tenantId,
            tx,
          );
    if (shipment === null) return err(new NotFoundError("Shipment not found"));

    const current = await shipments.findByFulfillmentRef(
      shipment.fulfillmentRef,
      input.tenantId,
      tx,
    );
    const isCurrentShipment = current !== null && current.id.toString() === shipment.id.toString();

    if (
      await processedCarrierWebhooks.hasProcessed(input.carrier, input.eventId, input.tenantId, tx)
    ) {
      return ok(summarise(shipment, true, [], isCurrentShipment));
    }

    let transitions: readonly ShipmentStatusValue[];
    try {
      transitions = this.apply(shipment, input);
    } catch (error) {
      if (isDomainError(error)) return err(error);
      throw error;
    }

    await shipments.save(shipment, input.tenantId, tx);
    await processedCarrierWebhooks.markProcessed(input.carrier, input.eventId, input.tenantId, tx);
    return ok(summarise(shipment, false, transitions, isCurrentShipment));
  }

  /** Receipt, scan, then the walk. An unreachable target changes nothing and never throws (§8.2). */
  private apply(shipment: Shipment, input: RecordCarrierWebhookInput): ShipmentStatusValue[] {
    const at = input.scan?.occurredAt ?? this.deps.clock.now();
    shipment.recordCarrierWebhook(input.kind, at);
    if (input.scan !== undefined) {
      shipment.addTrackingEvent(input.scan.description, at, input.scan.location);
    }
    const target = input.toStatus ?? KIND_TO_STATUS[input.kind];
    if (target === undefined) return [];
    const path = carrierPathTo(shipment.status.value, target);
    if (path === null) return [];
    const reason = input.reason ?? input.kind;
    for (const step of path) {
      const id = this.deps.idGenerator.generate();
      switch (step) {
        case "carrier_accepted":
          shipment.acceptByCarrier(id, at);
          break;
        case "in_transit":
          shipment.markInTransit(id, at);
          break;
        case "out_for_delivery":
          shipment.markOutForDelivery(id, at);
          break;
        case "delivered":
          shipment.markDelivered(id, at);
          break;
        case "delivery_failed":
          shipment.markDeliveryFailed(reason, id, at);
          break;
        case "exception":
          shipment.raiseException(reason, id, at);
          break;
        case "rejected":
          shipment.rejectByCarrier(reason, id, at);
          break;
        case "returned":
          shipment.markReturned(id, at);
          break;
        case "cancelled":
          shipment.cancel(id, at);
          break;
        default:
          shipment.transition(step, id, at);
      }
    }
    return [...path];
  }
}

function summarise(
  shipment: Shipment,
  duplicate: boolean,
  transitions: readonly ShipmentStatusValue[],
  isCurrentShipment: boolean,
): RecordCarrierWebhookOutput {
  return {
    shipmentId: shipment.id.toString(),
    fulfillmentRef: shipment.fulfillmentRef,
    status: shipment.status.value,
    duplicate,
    transitions,
    carrier: shipment.carrier?.value ?? "",
    trackingNumber: shipment.trackingNumber?.value ?? null,
    carrierDeliveryId: shipment.label?.carrierDeliveryId ?? null,
    isCurrentShipment,
  };
}

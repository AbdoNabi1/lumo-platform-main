import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { FulfillmentOrderRepository } from "../domain/fulfillment-order-repository";
import type { FulfillmentStatusValue } from "../domain/value-objects/fulfillment-status";
import type { ProcessedCarrierWebhookStore } from "./ports";

export interface RecordCarrierWebhookInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly fulfillmentOrderId: string;
  readonly carrier: string;
  readonly eventId: string;
  readonly kind: string;
}

export interface RecordCarrierWebhookOutput {
  readonly fulfillmentOrderId: string;
  readonly status: string;
  readonly duplicate: boolean;
}

export interface RecordCarrierWebhookDeps {
  readonly fulfillmentOrders: FulfillmentOrderRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly processedCarrierWebhooks: ProcessedCarrierWebhookStore;
}

/** Carrier webhook kinds that map directly onto a validated lifecycle transition (Sprint 4.9). Unrecognized kinds are still recorded, just don't transition. */
const KIND_TO_STATUS: Readonly<Record<string, FulfillmentStatusValue>> = {
  dispatched: "shipment_dispatched",
  in_transit: "in_transit",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  delivery_failed: "delivery_failed",
  returned: "returned",
};

/** Records a carrier webhook idempotently (`ProcessedCarrierWebhookStore`, replay-safe) and maps its kind to a validated transition. Signature verification is the carrier adapter's job, never this use case's. */
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

    return this.deps.unitOfWork.run<Result<RecordCarrierWebhookOutput, DomainError>>(async (tx) => {
      const fulfillmentOrder = await this.deps.fulfillmentOrders.findById(
        input.fulfillmentOrderId,
        input.tenantId,
        tx,
      );
      if (fulfillmentOrder === null) {
        return err(new NotFoundError("Fulfillment order not found"));
      }

      const alreadyProcessed = await this.deps.processedCarrierWebhooks.hasProcessed(
        input.carrier,
        input.eventId,
        input.tenantId,
      );
      if (alreadyProcessed) {
        return ok({
          fulfillmentOrderId: fulfillmentOrder.id.toString(),
          status: fulfillmentOrder.status.value,
          duplicate: true,
        });
      }

      try {
        fulfillmentOrder.recordCarrierWebhook(input.kind, this.deps.clock.now());
        const toStatus = KIND_TO_STATUS[input.kind];
        if (toStatus !== undefined) {
          fulfillmentOrder.transition(
            toStatus,
            this.deps.idGenerator.generate(),
            this.deps.clock.now(),
          );
        }
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.fulfillmentOrders.save(fulfillmentOrder, input.tenantId, tx);
      await this.deps.processedCarrierWebhooks.markProcessed(
        input.carrier,
        input.eventId,
        input.tenantId,
      );
      return ok({
        fulfillmentOrderId: fulfillmentOrder.id.toString(),
        status: fulfillmentOrder.status.value,
        duplicate: false,
      });
    });
  }
}

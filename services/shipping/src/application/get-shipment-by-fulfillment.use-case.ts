import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Shipment } from "../domain/shipment";
import type { ShipmentRepository } from "../domain/shipment-repository";

export interface GetShipmentByFulfillmentInput {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
  readonly fulfillmentRef: string;
}

export interface GetShipmentByFulfillmentDeps {
  readonly shipments: ShipmentRepository;
}

/** Reads the shipment created for a given fulfillment order, if any (Phase A.30 admin Order Detail panel). */
export class GetShipmentByFulfillment implements UseCase<
  GetShipmentByFulfillmentInput,
  Shipment,
  DomainError
> {
  private readonly deps: GetShipmentByFulfillmentDeps;

  constructor(deps: GetShipmentByFulfillmentDeps) {
    this.deps = deps;
  }

  async execute(input: GetShipmentByFulfillmentInput): Promise<Result<Shipment, DomainError>> {
    const shipment = await this.deps.shipments.findByFulfillmentRef(
      input.fulfillmentRef,
      input.tenantId,
    );
    if (shipment === null) {
      return err(new NotFoundError("No shipment found for this fulfillment order"));
    }
    return ok(shipment);
  }
}

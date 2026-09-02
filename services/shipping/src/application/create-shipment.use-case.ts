import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import { Shipment } from "../domain/shipment";
import type { ShipmentRepository } from "../domain/shipment-repository";
import { ShipmentPackage } from "../domain/value-objects/shipment-package";

export interface CreateShipmentPackageInput {
  readonly reference: string;
  readonly itemRefs: readonly string[];
  readonly weightGrams: number;
}

export interface CreateShipmentInput {
  readonly fulfillmentRef: string;
  readonly packages: readonly CreateShipmentPackageInput[];
}

export interface ShipmentStatusOutput {
  readonly shipmentId: string;
  readonly status: string;
}

export interface CreateShipmentDeps {
  readonly shipments: ShipmentRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Opens a shipment for a fulfillment order's packages — the entry point into the Sprint 4.10 lifecycle. */
export class CreateShipment implements UseCase<
  CreateShipmentInput,
  ShipmentStatusOutput,
  DomainError
> {
  private readonly deps: CreateShipmentDeps;

  constructor(deps: CreateShipmentDeps) {
    this.deps = deps;
  }

  async execute(input: CreateShipmentInput): Promise<Result<ShipmentStatusOutput, DomainError>> {
    const fulfillmentRef = Guard.againstEmpty(input.fulfillmentRef, "fulfillmentRef");
    if (!fulfillmentRef.ok) return err(fulfillmentRef.error);
    if (input.packages.length === 0) {
      return err(
        new ValidationError("Invalid shipment", [
          { field: "packages", message: "must not be empty" },
        ]),
      );
    }

    const packages: ShipmentPackage[] = [];
    for (const packageInput of input.packages) {
      const shipmentPackage = ShipmentPackage.create(
        packageInput.reference,
        packageInput.itemRefs,
        packageInput.weightGrams,
      );
      if (!shipmentPackage.ok) return err(shipmentPackage.error);
      packages.push(shipmentPackage.value);
    }

    return this.deps.unitOfWork.run<Result<ShipmentStatusOutput, DomainError>>(async (tx) => {
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const shipment = Shipment.create(id, input.fulfillmentRef, packages);
      await this.deps.shipments.save(shipment, tx);
      return ok({ shipmentId: id.toString(), status: shipment.status.value });
    });
  }
}

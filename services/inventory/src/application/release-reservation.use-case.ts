import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError, ProductRef } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { InventoryItemRepository } from "../domain/inventory-item-repository";
import { WarehouseId } from "../domain/value-objects/warehouse-id";

export interface ReleaseReservationInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly productId: string;
  readonly warehouseId: string;
  readonly reservationId: string;
}

export interface ReleaseReservationOutput {
  readonly available: number;
}

export interface ReleaseReservationDeps {
  readonly items: InventoryItemRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Releases a previously held reservation, returning the stock to availability. */
export class ReleaseReservation implements UseCase<
  ReleaseReservationInput,
  ReleaseReservationOutput,
  DomainError
> {
  private readonly deps: ReleaseReservationDeps;

  constructor(deps: ReleaseReservationDeps) {
    this.deps = deps;
  }

  async execute(
    input: ReleaseReservationInput,
  ): Promise<Result<ReleaseReservationOutput, DomainError>> {
    const product = ProductRef.create(input.productId);
    if (!product.ok) return err(product.error);
    const warehouse = WarehouseId.create(input.warehouseId);
    if (!warehouse.ok) return err(warehouse.error);

    return this.deps.unitOfWork.run<Result<ReleaseReservationOutput, DomainError>>(async (tx) => {
      const item = await this.deps.items.findByProductAndWarehouse(
        product.value.value,
        warehouse.value.value,
        input.tenantId,
        tx,
      );
      if (item === null) {
        return err(new NotFoundError("Inventory item not found"));
      }

      try {
        item.releaseReservation(
          input.reservationId,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.items.save(item, input.tenantId, tx);
      return ok({ available: item.stockLevel.available });
    });
  }
}

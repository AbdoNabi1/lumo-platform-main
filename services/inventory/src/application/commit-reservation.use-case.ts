import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError, ProductRef } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { InventoryItemRepository } from "../domain/inventory-item-repository";
import { WarehouseId } from "../domain/value-objects/warehouse-id";

export interface CommitReservationInput {
  readonly productId: string;
  readonly warehouseId: string;
  readonly reservationId: string;
}

export interface CommitReservationOutput {
  readonly onHand: number;
  readonly available: number;
}

export interface CommitReservationDeps {
  readonly items: InventoryItemRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Fulfills a held reservation (ADR-0013 commit step): on-hand and reserved both drop together. */
export class CommitReservation implements UseCase<
  CommitReservationInput,
  CommitReservationOutput,
  DomainError
> {
  private readonly deps: CommitReservationDeps;

  constructor(deps: CommitReservationDeps) {
    this.deps = deps;
  }

  async execute(
    input: CommitReservationInput,
  ): Promise<Result<CommitReservationOutput, DomainError>> {
    const product = ProductRef.create(input.productId);
    if (!product.ok) return err(product.error);
    const warehouse = WarehouseId.create(input.warehouseId);
    if (!warehouse.ok) return err(warehouse.error);

    return this.deps.unitOfWork.run<Result<CommitReservationOutput, DomainError>>(async (tx) => {
      const item = await this.deps.items.findByProductAndWarehouse(
        product.value.value,
        warehouse.value.value,
        tx,
      );
      if (item === null) {
        return err(new NotFoundError("Inventory item not found"));
      }

      try {
        item.commitReservation(
          input.reservationId,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.items.save(item, tx);
      return ok({ onHand: item.stockLevel.onHand, available: item.stockLevel.available });
    });
  }
}

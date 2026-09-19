import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError, ProductRef } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import type { InventoryItemRepository } from "../domain/inventory-item-repository";
import { WarehouseId } from "../domain/value-objects/warehouse-id";

export interface AdjustInventoryInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly productId: string;
  readonly warehouseId: string;
  /** The corrected on-hand quantity (non-negative integer). */
  readonly onHand: number;
}

export interface AdjustInventoryOutput {
  readonly available: number;
}

export interface AdjustInventoryDeps {
  readonly items: InventoryItemRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Corrects an item's on-hand quantity (e.g. after a stock count), emitting `inventory.adjusted`. */
export class AdjustInventory implements UseCase<
  AdjustInventoryInput,
  AdjustInventoryOutput,
  DomainError
> {
  private readonly deps: AdjustInventoryDeps;

  constructor(deps: AdjustInventoryDeps) {
    this.deps = deps;
  }

  async execute(input: AdjustInventoryInput): Promise<Result<AdjustInventoryOutput, DomainError>> {
    const product = ProductRef.create(input.productId);
    if (!product.ok) return err(product.error);
    const warehouse = WarehouseId.create(input.warehouseId);
    if (!warehouse.ok) return err(warehouse.error);
    if (!Number.isInteger(input.onHand) || input.onHand < 0) {
      return err(
        new ValidationError("Invalid on-hand quantity", [
          { field: "onHand", message: "must be a non-negative integer" },
        ]),
      );
    }

    return this.deps.unitOfWork.run<Result<AdjustInventoryOutput, DomainError>>(async (tx) => {
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
        item.adjust(input.onHand, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.items.save(item, input.tenantId, tx);
      return ok({ available: item.stockLevel.available });
    });
  }
}

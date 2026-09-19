import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { ProductRef, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { InventoryItem } from "../domain/inventory-item";
import type { InventoryItemRepository } from "../domain/inventory-item-repository";
import { Quantity } from "../domain/value-objects/quantity";
import { WarehouseId } from "../domain/value-objects/warehouse-id";

export interface ReceiveStockInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly productId: string;
  readonly warehouseId: string;
  readonly quantity: number;
}

export interface ReceiveStockOutput {
  readonly available: number;
}

export interface ReceiveStockDeps {
  readonly items: InventoryItemRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Receives stock for a product at a warehouse, creating the item on first receipt. */
export class ReceiveStock implements UseCase<ReceiveStockInput, ReceiveStockOutput, DomainError> {
  private readonly deps: ReceiveStockDeps;

  constructor(deps: ReceiveStockDeps) {
    this.deps = deps;
  }

  async execute(input: ReceiveStockInput): Promise<Result<ReceiveStockOutput, DomainError>> {
    const product = ProductRef.create(input.productId);
    if (!product.ok) return err(product.error);
    const warehouse = WarehouseId.create(input.warehouseId);
    if (!warehouse.ok) return err(warehouse.error);
    const quantity = Quantity.create(input.quantity);
    if (!quantity.ok) return err(quantity.error);

    return this.deps.unitOfWork.run<Result<ReceiveStockOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.items.findByProductAndWarehouse(
        product.value.value,
        warehouse.value.value,
        input.tenantId,
        tx,
      );
      const item =
        existing ??
        InventoryItem.create(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          product.value,
          warehouse.value,
        );

      item.receive(quantity.value, this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.items.save(item, input.tenantId, tx);
      return ok({ available: item.stockLevel.available });
    });
  }
}

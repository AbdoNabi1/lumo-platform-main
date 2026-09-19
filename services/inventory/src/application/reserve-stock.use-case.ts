import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, ProductRef, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { InventoryItemRepository } from "../domain/inventory-item-repository";
import { Quantity } from "../domain/value-objects/quantity";
import { WarehouseId } from "../domain/value-objects/warehouse-id";

export interface ReserveStockInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly productId: string;
  readonly warehouseId: string;
  readonly quantity: number;
  /** The reserving order/cart reference (bare id). */
  readonly reference: string;
}

export interface ReserveStockOutput {
  readonly reservationId: string;
  readonly available: number;
}

export interface ReserveStockDeps {
  readonly items: InventoryItemRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Reserves available stock for an order/cart; fails if availability is insufficient. */
export class ReserveStock implements UseCase<ReserveStockInput, ReserveStockOutput, DomainError> {
  private readonly deps: ReserveStockDeps;

  constructor(deps: ReserveStockDeps) {
    this.deps = deps;
  }

  async execute(input: ReserveStockInput): Promise<Result<ReserveStockOutput, DomainError>> {
    const product = ProductRef.create(input.productId);
    if (!product.ok) return err(product.error);
    const warehouse = WarehouseId.create(input.warehouseId);
    if (!warehouse.ok) return err(warehouse.error);
    const quantity = Quantity.create(input.quantity);
    if (!quantity.ok) return err(quantity.error);
    const reference = Guard.againstEmpty(input.reference, "reference");
    if (!reference.ok) return err(reference.error);

    return this.deps.unitOfWork.run<Result<ReserveStockOutput, DomainError>>(async (tx) => {
      const item = await this.deps.items.findByProductAndWarehouse(
        product.value.value,
        warehouse.value.value,
        input.tenantId,
        tx,
      );
      if (item === null) {
        return err(new NotFoundError("Inventory item not found"));
      }

      const reservationId = UniqueEntityId.from(this.deps.idGenerator.generate());
      try {
        item.reserve(
          reservationId,
          quantity.value,
          input.reference,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.items.save(item, input.tenantId, tx);
      return ok({ reservationId: reservationId.toString(), available: item.stockLevel.available });
    });
  }
}

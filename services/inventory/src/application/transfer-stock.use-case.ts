import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError, ProductRef, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import { InventoryItem } from "../domain/inventory-item";
import type { InventoryItemRepository } from "../domain/inventory-item-repository";
import { Quantity } from "../domain/value-objects/quantity";
import { WarehouseId } from "../domain/value-objects/warehouse-id";

export interface TransferStockInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly productId: string;
  readonly sourceWarehouseId: string;
  readonly destinationWarehouseId: string;
  readonly quantity: number;
}

export interface TransferStockOutput {
  readonly sourceAvailable: number;
  readonly destinationAvailable: number;
}

export interface TransferStockDeps {
  readonly items: InventoryItemRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Moves unreserved stock between two warehouses for the same product — source out-leg + destination in-leg, one unit of work. */
export class TransferStock implements UseCase<
  TransferStockInput,
  TransferStockOutput,
  DomainError
> {
  private readonly deps: TransferStockDeps;

  constructor(deps: TransferStockDeps) {
    this.deps = deps;
  }

  async execute(input: TransferStockInput): Promise<Result<TransferStockOutput, DomainError>> {
    const product = ProductRef.create(input.productId);
    if (!product.ok) return err(product.error);
    const source = WarehouseId.create(input.sourceWarehouseId);
    if (!source.ok) return err(source.error);
    const destination = WarehouseId.create(input.destinationWarehouseId);
    if (!destination.ok) return err(destination.error);
    if (source.value.value === destination.value.value) {
      return err(
        new ValidationError("Cannot transfer stock to the same warehouse", [
          { field: "destinationWarehouseId", message: "must differ from sourceWarehouseId" },
        ]),
      );
    }
    const quantity = Quantity.create(input.quantity);
    if (!quantity.ok) return err(quantity.error);

    return this.deps.unitOfWork.run<Result<TransferStockOutput, DomainError>>(async (tx) => {
      const sourceItem = await this.deps.items.findByProductAndWarehouse(
        product.value.value,
        source.value.value,
        input.tenantId,
        tx,
      );
      if (sourceItem === null) {
        return err(new NotFoundError("Source inventory item not found"));
      }

      const destinationItem =
        (await this.deps.items.findByProductAndWarehouse(
          product.value.value,
          destination.value.value,
          input.tenantId,
          tx,
        )) ??
        InventoryItem.create(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          product.value,
          destination.value,
        );

      try {
        sourceItem.transferOut(
          quantity.value,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
        destinationItem.transferIn(
          quantity.value,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.items.save(sourceItem, input.tenantId, tx);
      await this.deps.items.save(destinationItem, input.tenantId, tx);

      return ok({
        sourceAvailable: sourceItem.stockLevel.available,
        destinationAvailable: destinationItem.stockLevel.available,
      });
    });
  }
}

import type { UseCase } from "@platform/application";
import { ProductRef } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { InventoryItemRepository } from "../domain/inventory-item-repository";
import { WarehouseId } from "../domain/value-objects/warehouse-id";

export interface CheckAvailabilityInput {
  readonly productId: string;
  readonly warehouseId: string;
}

export interface CheckAvailabilityOutput {
  readonly available: number;
}

export interface CheckAvailabilityDeps {
  readonly items: InventoryItemRepository;
}

/**
 * Read-only availability lookup for a product at a warehouse.
 *
 * NOTE (evidence gap, disclosed per the Recovery Implementation Methodology): no Sprint 1.2, 4.3,
 * or 7.0 report individually names `CheckAvailability` — `PATCH_OWNERSHIP_MATRIX_V5.md` groups it
 * with `list-inventory-items.use-case.ts` as "Sprint 7.0 (generic list, inferred)", Medium
 * confidence. Reconstructed here as a thin read using the existing `findByProductAndWarehouse`
 * port method (no new port surface), consistent with the repo's established use-case shape.
 */
export class CheckAvailability implements UseCase<
  CheckAvailabilityInput,
  CheckAvailabilityOutput,
  DomainError
> {
  private readonly deps: CheckAvailabilityDeps;

  constructor(deps: CheckAvailabilityDeps) {
    this.deps = deps;
  }

  async execute(
    input: CheckAvailabilityInput,
  ): Promise<Result<CheckAvailabilityOutput, DomainError>> {
    const product = ProductRef.create(input.productId);
    if (!product.ok) return err(product.error);
    const warehouse = WarehouseId.create(input.warehouseId);
    if (!warehouse.ok) return err(warehouse.error);

    const item = await this.deps.items.findByProductAndWarehouse(
      product.value.value,
      warehouse.value.value,
    );
    if (item === null) {
      return err(new NotFoundError("Inventory item not found"));
    }
    return ok({ available: item.stockLevel.available });
  }
}

import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { InventoryItem } from "../domain/inventory-item";
import type { InventoryItemRepository } from "../domain/inventory-item-repository";

export interface ListInventoryByProductInput {
  readonly productId: string;
}

export interface ListInventoryByProductDeps {
  readonly items: InventoryItemRepository;
}

/** Every stock row for a product, across all warehouses (Phase A.30 admin Products screen). */
export class ListInventoryByProduct implements UseCase<
  ListInventoryByProductInput,
  readonly InventoryItem[],
  DomainError
> {
  private readonly deps: ListInventoryByProductDeps;

  constructor(deps: ListInventoryByProductDeps) {
    this.deps = deps;
  }

  async execute(
    input: ListInventoryByProductInput,
  ): Promise<Result<readonly InventoryItem[], DomainError>> {
    return ok(await this.deps.items.findByProduct(input.productId));
  }
}

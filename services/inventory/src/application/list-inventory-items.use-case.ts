import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { InventoryItem } from "../domain/inventory-item";
import type { InventoryItemRepository } from "../domain/inventory-item-repository";

export interface ListInventoryItemsDeps {
  readonly items: InventoryItemRepository;
}

/** Cursor-paginated listing of inventory items (Sprint 7.0: generic list, no dedicated report names this use-case). */
export class ListInventoryItems
  implements UseCase<CursorPage, Paginated<InventoryItem>, DomainError>
{
  private readonly deps: ListInventoryItemsDeps;

  constructor(deps: ListInventoryItemsDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<InventoryItem>, DomainError>> {
    return ok(await this.deps.items.list(input));
  }
}

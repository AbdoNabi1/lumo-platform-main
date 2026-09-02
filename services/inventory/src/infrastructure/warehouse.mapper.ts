import { UniqueEntityId } from "@platform/domain";
import { Warehouse, type WarehouseStatus } from "../domain/warehouse";

export interface WarehouseRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
  readonly version: number;
}

/** Persistence ↔ aggregate mapping for {@link Warehouse}. Mapping only — no I/O. */
export class WarehouseMapper {
  static toDomain(row: WarehouseRow): Warehouse {
    return Warehouse.reconstitute(
      UniqueEntityId.from(row.id),
      row.code,
      row.name,
      row.status as WarehouseStatus,
      row.version,
    );
  }

  /** `version: 1` on create — matches the repo's established convention (see `InventoryItemMapper.toItemRow`). */
  static toRow(warehouse: Warehouse, tenantId: string) {
    return {
      id: warehouse.id.toString(),
      tenantId,
      code: warehouse.code,
      name: warehouse.name,
      status: warehouse.status,
      version: 1,
    };
  }
}

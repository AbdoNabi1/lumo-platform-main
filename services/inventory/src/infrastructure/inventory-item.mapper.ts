import { ProductRef, UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { UnexpectedError } from "@platform/utils";
import { InventoryItem } from "../domain/inventory-item";
import { Reservation } from "../domain/reservation";
import { Quantity } from "../domain/value-objects/quantity";
import { StockLevel } from "../domain/value-objects/stock-level";
import { WarehouseId } from "../domain/value-objects/warehouse-id";

export interface InventoryItemRow {
  readonly id: string;
  readonly productRef: string;
  readonly warehouseId: string;
  readonly onHand: number;
  readonly reserved: number;
  readonly version: number;
}
export interface ReservationRow {
  readonly id: string;
  readonly quantity: number;
  readonly reference: string;
}

function must<T>(result: Result<T, { message: string }>, what: string): T {
  if (!result.ok) {
    throw new UnexpectedError(`Corrupt inventory row: invalid ${what} (${result.error.message})`);
  }
  return result.value;
}

/** Persistence ↔ aggregate mapping for {@link InventoryItem}. Mapping only — no I/O. */
export class InventoryItemMapper {
  static toDomain(row: InventoryItemRow, reservations: readonly ReservationRow[]): InventoryItem {
    return InventoryItem.reconstitute(
      UniqueEntityId.from(row.id),
      must(ProductRef.create(row.productRef), "product ref"),
      must(WarehouseId.create(row.warehouseId), "warehouse id"),
      must(StockLevel.create(row.onHand, row.reserved), "stock level"),
      reservations.map((r) =>
        Reservation.create(
          UniqueEntityId.from(r.id),
          must(Quantity.create(r.quantity), "reservation quantity"),
          r.reference,
        ),
      ),
      row.version,
    );
  }

  static toItemRow(item: InventoryItem, tenantId: string) {
    return {
      id: item.id.toString(),
      tenantId,
      productRef: item.product.value,
      warehouseId: item.warehouseId.value,
      onHand: item.stockLevel.onHand,
      reserved: item.stockLevel.reserved,
      version: 1,
    };
  }

  static toReservationRows(item: InventoryItem, tenantId: string) {
    return item.reservations.map((r) => ({
      id: r.id.toString(),
      tenantId,
      itemId: item.id.toString(),
      quantity: r.quantity.value,
      reference: r.reference,
    }));
  }
}

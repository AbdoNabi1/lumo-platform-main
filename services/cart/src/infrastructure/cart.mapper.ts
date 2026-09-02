import { Money, ProductRef, UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { UnexpectedError } from "@platform/utils";
import { Cart, type CartStatus } from "../domain/cart";
import { CartItem } from "../domain/cart-item";
import { Quantity } from "../domain/value-objects/quantity";

export interface CartRow {
  readonly id: string;
  readonly customerRef: string | null;
  readonly sessionRef: string;
  readonly currency: string;
  readonly status: string;
  readonly version: number;
}
export interface CartItemRow {
  readonly id: string;
  readonly productRef: string;
  readonly quantity: number;
  readonly unitPriceAmountMinor: number;
  readonly inventorySnapshot: Record<string, unknown> | null;
  readonly metadata: Record<string, unknown> | null;
}

function must<T>(result: Result<T, { message: string }>, what: string): T {
  if (!result.ok) {
    throw new UnexpectedError(`Corrupt cart row: invalid ${what} (${result.error.message})`);
  }
  return result.value;
}

/** Persistence ↔ aggregate mapping for {@link Cart}. Mapping only — no I/O. */
export class CartMapper {
  static toDomain(row: CartRow, items: readonly CartItemRow[]): Cart {
    return Cart.reconstitute(
      UniqueEntityId.from(row.id),
      row.customerRef ?? undefined,
      row.sessionRef,
      row.currency,
      row.status as CartStatus,
      items.map((item) =>
        CartItem.create(
          UniqueEntityId.from(item.id),
          must(ProductRef.create(item.productRef), "product ref"),
          must(Quantity.create(item.quantity), "quantity"),
          must(Money.create(item.unitPriceAmountMinor, row.currency), "unit price"),
          {
            inventoryAvailable:
              typeof item.inventorySnapshot?.available === "number"
                ? item.inventorySnapshot.available
                : undefined,
            metadata: item.metadata ?? undefined,
          },
        ),
      ),
      row.version,
    );
  }

  static toCartRow(cart: Cart, tenantId: string) {
    return {
      id: cart.id.toString(),
      tenantId,
      customerRef: cart.customerRef ?? null,
      sessionRef: cart.sessionRef,
      currency: cart.currency,
      status: cart.status,
      version: 1,
    };
  }

  static toItemRows(cart: Cart, tenantId: string) {
    return cart.items.map((item) => ({
      id: item.id.toString(),
      tenantId,
      cartId: cart.id.toString(),
      productRef: item.productRef.value,
      quantity: item.quantity.value,
      unitPriceAmountMinor: item.unitPrice.amountMinor,
      inventorySnapshot:
        item.inventoryAvailable === undefined ? null : { available: item.inventoryAvailable },
      metadata: item.metadata ?? null,
    }));
  }
}

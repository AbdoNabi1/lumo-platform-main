import type { Product, ProductController } from "@platform/catalog";
import type {
  CheckoutItem,
  InventoryValidationPort,
  InventoryValidationResult,
} from "@platform/checkout";
import type { InventoryController, WarehouseRepository } from "@platform/inventory";
import { pickLocation, type LocationLevel } from "./pick-location";
import { variantOf } from "./variant-of";

interface CheckAvailabilityBody {
  readonly available: number;
}

/**
 * Real `InventoryValidationPort` over Inventory's own stock data (Phase 3 Task 10, C-3) —
 * `ValidateCheckout` and `CompleteCheckout` call this instead of the offline
 * `InMemoryInventoryValidationAdapter` stub
 * (`services/checkout/src/infrastructure/in-memory-orchestration-adapters.ts`), which only checked
 * `quantity > 0` and never consulted Inventory at all.
 *
 * Plan 2B-3: the shop has several locations. `CheckoutItem` carries no location, so a line is
 * served by the ACTIVE location holding the most of the variant (`pickLocation`), and it is valid
 * only when that location alone covers the quantity. Inactive locations never count, and with no
 * active location a stock-limited line is invalid (an unlimited line still passes). The tenant's
 * locations are listed ONCE per `validate()` call. Stock split across locations is not combined.
 * Invalidity is reported back as `{ valid: false, reason }` — never thrown — because a `false` port
 * response is an ordinary "not valid yet" outcome for both call sites, not a fault.
 *
 * Plan 2B-1: stock is the VARIANT's. Each item's variant is resolved from Catalog (the named one,
 * or the product's only variant — never a guess), its two inventory switches decide whether stock
 * limits the sale at all (`isStockLimited`: tracked and stopping at zero), and the stock itself is
 * read with that `variantId`. A variant that is not stock-limited never blocks checkout, even with
 * no stock row at all; a product that cannot be loaded is never assumed to have stock.
 *
 * Takes `InventoryController` narrowed via `Pick` to `checkAvailability` — the only method this
 * adapter calls — rather than the full 9-use-case controller: the real, production
 * `InventoryController` still satisfies this structurally, so `wireAdmin` passes it unchanged,
 * while tests can supply a lightweight fake instead of constructing every other use case.
 */
export class InventoryValidationAdapter implements InventoryValidationPort {
  private readonly products: Pick<ProductController, "get">;
  private readonly inventory: Pick<InventoryController, "checkAvailability">;
  private readonly warehouses: WarehouseRepository;

  /** ADR-0014 (WP-10, T10.3): stateless per tenant — `InventoryValidationPort.validate` carries `tenantId` per call. */
  constructor(
    products: Pick<ProductController, "get">,
    inventory: Pick<InventoryController, "checkAvailability">,
    warehouses: WarehouseRepository,
  ) {
    this.products = products;
    this.inventory = inventory;
    this.warehouses = warehouses;
  }

  async validate(
    items: readonly CheckoutItem[],
    tenantId: string,
  ): Promise<InventoryValidationResult> {
    if (items.length === 0) {
      return { valid: true };
    }

    const locations = (await this.warehouses.list({ first: 100 }, tenantId)).items.filter(
      (warehouse) => warehouse.active,
    );

    for (const item of items) {
      const productResponse = await this.products.get({ productId: item.productRef, tenantId });
      if (productResponse.status !== 200) {
        return { valid: false, reason: `product "${item.productRef}" not found` };
      }
      const variant = variantOf(productResponse.body as Product, item.variantRef);
      if (variant === undefined) {
        return { valid: false, reason: `no matching variant for product "${item.productRef}"` };
      }
      if (!variant.isStockLimited()) continue;

      // A location with no stock row answers 404, which is simply zero there.
      const levels: LocationLevel[] = [];
      for (const location of locations) {
        const response = await this.inventory.checkAvailability({
          tenantId,
          productId: item.productRef,
          variantId: variant.id.toString(),
          warehouseId: location.id.value,
        });
        levels.push({
          locationId: location.id.value,
          available:
            response.status === 200 ? (response.body as CheckAvailabilityBody).available : 0,
        });
      }

      const chosen = pickLocation(levels, item.quantity);
      if (chosen === null) {
        return {
          valid: false,
          reason: `no active location can supply product "${item.productRef}"`,
        };
      }
      if (!chosen.covers) {
        return {
          valid: false,
          reason:
            `insufficient stock for product "${item.productRef}": requested ${item.quantity}, ` +
            `${chosen.available} available`,
        };
      }
    }
    return { valid: true };
  }
}

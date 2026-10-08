import type { Product, ProductController } from "@platform/catalog";
import type {
  CheckoutItem,
  InventoryValidationPort,
  InventoryValidationResult,
} from "@platform/checkout";
import type { InventoryController, WarehouseRepository } from "@platform/inventory";
import { variantOf } from "./variant-of";

interface CheckAvailabilityBody {
  readonly available: number;
}

/**
 * Real `InventoryValidationPort` over Inventory's own stock data (Phase 3 Task 10, C-3) —
 * `ValidateCheckout` calls this instead of the offline `InMemoryInventoryValidationAdapter` stub
 * (`services/checkout/src/infrastructure/in-memory-orchestration-adapters.ts`), which only checked
 * `quantity > 0` and never consulted Inventory at all.
 *
 * Warehouse-resolution gap (disclosed, not solved here): `CheckoutItem` carries only a
 * `productRef` — no warehouse — and no context in this repository (Catalog, Orders, Checkout,
 * Fulfillment) stores or computes a warehouse assignment; there is no "default warehouse"
 * convention anywhere in the codebase. This adapter resolves the warehouse by listing the
 * tenant's warehouses ONCE per `validate()` call (a warehouse assignment is tenant-wide, not
 * per-item) and requires there to be EXACTLY ONE registered: zero or more than one is reported
 * back as `{ valid: false, reason }` — never thrown. `ValidateCheckout`'s call site
 * (`services/checkout/src/application/checkout-orchestration.use-cases.ts`) treats a `false`
 * port response as an ordinary "checkout not valid yet" outcome, not a fault, so throwing here
 * would surface as an unhandled 500 instead of the reason making it into the response. Real
 * multi-warehouse stock routing is out of scope for this adapter and is not implemented.
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

    // `first: 2` is enough to distinguish "exactly one" from "more than one" without paging
    // through the whole registry.
    const page = await this.warehouses.list({ first: 2 }, tenantId);
    const [warehouse, extra] = page.items;
    if (warehouse === undefined || extra !== undefined) {
      return {
        valid: false,
        reason:
          warehouse === undefined
            ? "cannot resolve a single warehouse for availability checks — no warehouse is " +
              "registered; multi-warehouse routing is not implemented"
            : "cannot resolve a single warehouse for availability checks — more than one " +
              "warehouse is registered; multi-warehouse routing is not implemented",
      };
    }
    const warehouseId = warehouse.id.value;

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
      const response = await this.inventory.checkAvailability({
        tenantId,
        productId: item.productRef,
        variantId: variant.id.toString(),
        warehouseId,
      });
      if (response.status !== 200) {
        return {
          valid: false,
          reason: `no inventory record for product "${item.productRef}" at warehouse "${warehouseId}"`,
        };
      }
      const { available } = response.body as CheckAvailabilityBody;
      if (available < item.quantity) {
        return {
          valid: false,
          reason:
            `insufficient stock for product "${item.productRef}": requested ${item.quantity}, ` +
            `${available} available`,
        };
      }
    }
    return { valid: true };
  }
}

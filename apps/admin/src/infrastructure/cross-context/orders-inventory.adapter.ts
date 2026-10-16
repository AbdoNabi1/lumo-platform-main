import type { Product, ProductController } from "@platform/catalog";
import type {
  InventoryController,
  InventoryItemRepository,
  WarehouseRepository,
} from "@platform/inventory";
import type { InventoryPort, OrderController } from "@platform/orders";
import { pickLocation, type LocationLevel } from "./pick-location";
import { variantOf } from "./variant-of";

interface OrderLinesBody {
  readonly items: readonly {
    readonly snapshot: { readonly productId: string; readonly variantRef?: string | null };
    readonly quantity: number;
  }[];
}

/**
 * Real `InventoryPort` over Inventory's own `reserve` use case (Phase 3 Task 12, C-3) — `Orders`'
 * `RequestFulfillment` calls this instead of the offline `InMemoryInventoryAdapter` stub
 * (`services/orders/src/infrastructure/in-memory-port-adapters.ts`), which fabricated a
 * `reservation-{orderId}-{n}` ref without ever touching Inventory's real stock.
 *
 * Plan 2B-3: the shop has several locations and the order carries none. For each stock-tracking
 * line this adapter lists the tenant's ACTIVE locations once per `requestReservation()` call,
 * reads the variant's stock at each, and reserves at the one holding the most (`pickLocation`,
 * shared with `InventoryValidationAdapter`). Inactive locations never count. `InventoryPort` has
 * no `{ valid: false }` channel — its contract is `Promise<InventoryReservationResult>`, success
 * or bust — so a stock-limited line that no single location covers (or with no active location at
 * all) THROWS a clear `Error` naming the product: fabricating a fake `reservationRef` would
 * silently corrupt stock tracking, which is strictly worse than a loud failure. Confirmed safe to
 * throw by reading the actual call site (`services/orders/src/application/order-lifecycle.use-cases.ts`'s
 * `RequestFulfillment.execute()`): both port calls run outside any `present()`/domain-error-mapping
 * wrapper, so a thrown `Error` propagates all the way out of `OrderController.requestFulfillment()`
 * as a genuine unhandled error — never silently swallowed, never converted into a fabricated
 * success.
 *
 * Idempotency (the port's documented contract, `services/orders/src/application/ports.ts`): the
 * SAME `orderId` called twice must return the SAME `reservationRef`, never create a second
 * reservation. `ReserveStock.execute()` (`services/inventory/src/application/reserve-stock.use-case.ts`)
 * is NOT itself idempotent by `reference` — it unconditionally generates a fresh `reservationId` and
 * calls `InventoryItem.reserve()`, which unconditionally pushes a new `Reservation` and decrements
 * `stockLevel`. A naive retry would either double-decrement `available` (silently over-reserving
 * real stock) or throw `BusinessRuleError` once availability is exhausted — never "return the same
 * reservation" (see `order-lifecycle.use-cases.ts`'s own `RequestFulfillment` doc, RESIDUAL RISK #1:
 * this was always a mitigation "contingent on the real adapter honoring the contract", and closing
 * it here — rather than inside Inventory's own domain, a larger cross-context change out of this
 * phase's scope — is exactly this adapter's job).
 *
 * So THIS adapter enforces the contract itself, per line item, before calling `reserve()`:
 * `InventoryItemRepository.findByProductAndWarehouse` resolves the item at EACH active location,
 * then `findByReservationReference(item.id, orderId)` (scaffolding added ahead of any real caller —
 * "not yet wired into any use case" per its own doc — this adapter is the first) checks whether a
 * reservation already exists under this exact `orderId`. Found at ANY location ⇒ skip re-reserving
 * this line (idempotent no-op) — not only at the location a fresh pick would choose now, because
 * reserving lowers that location's stock and a retry could otherwise drift to another one and
 * reserve the line twice. Not found ⇒ pick a location and call `reserve()` as normal. The order-level ref this adapter
 * returns is `orderId` itself, NOT one of Inventory's per-item `reservationId`s from
 * `ReserveStockOutput` (those are Inventory-internal and, for a multi-item order, there would be
 * several of them with no single one able to stand for "the reservation"). `orderId` is already the
 * stable, natural correlation key Orders itself treats as canonical.
 *
 * Plan 2B-1: stock is the VARIANT's. Per line, the variant is resolved from Catalog (the snapshot's
 * `variantRef`, else the product's only variant — never a guess; an unresolvable one throws like
 * the other gaps above). A variant that does not track quantity is not reserved. A `continue`
 * ("keep selling when out of stock") line reserves only what is in stock, and never fails for lack
 * of it; a `deny` line reserves its full quantity and fails when it cannot. A `continue` line
 * reserves only what is in stock; the oversold remainder is not tracked as negative stock (gap
 * recorded by Plan 2B-1).
 *
 * Cross-context self-reference note: this adapter needs to read the SAME order's line items that
 * `wireOrders` itself manages, but it is also one of `wireOrders`'s own inputs (it becomes
 * `ordersDeps.inventoryPort`) — the real `OrderController` does not exist yet at the point this
 * adapter must be constructed. `apps/admin/src/composition.ts` resolves this with a one-shot lazy
 * forwarding object (not a second, state-disconnected `OrderController`/repository instance):
 * built empty, then pointed at the real controller immediately after `wireOrders()` returns. By the
 * time any caller actually invokes `requestReservation` (always after `wireAdmin` has fully
 * returned), the forwarding object already resolves correctly. This is NOT the Orders<->Payments
 * composition cycle `paymentPort` needs a workaround for (two DIFFERENT `wireX` calls each needing
 * the other's controller) — it is Orders' own inbound port needing Orders' own outbound read
 * surface, resolved entirely inside the single `wireOrders` call with no cross-context cycle.
 */
export class OrdersInventoryAdapter implements InventoryPort {
  private readonly products: Pick<ProductController, "get">;
  private readonly inventory: Pick<InventoryController, "reserve">;
  private readonly warehouses: WarehouseRepository;
  private readonly items: Pick<
    InventoryItemRepository,
    "findByProductAndWarehouse" | "findByReservationReference"
  >;
  private readonly orders: Pick<OrderController, "getOrder">;
  /** ADR-0014 (WP-10, T10.3): stateless per tenant — `InventoryPort.requestReservation` carries `tenantId` per call. */
  constructor(
    products: Pick<ProductController, "get">,
    inventory: Pick<InventoryController, "reserve">,
    warehouses: WarehouseRepository,
    items: Pick<
      InventoryItemRepository,
      "findByProductAndWarehouse" | "findByReservationReference"
    >,
    orders: Pick<OrderController, "getOrder">,
  ) {
    this.products = products;
    this.inventory = inventory;
    this.warehouses = warehouses;
    this.items = items;
    this.orders = orders;
  }

  async requestReservation(
    orderId: string,
    tenantId: string,
  ): Promise<{ readonly reservationRef: string }> {
    const orderResponse = await this.orders.getOrder({ tenantId, orderId });
    if (orderResponse.status !== 200) {
      throw new Error(
        `OrdersInventoryAdapter: cannot load order "${orderId}" for reservation ` +
          `(status ${orderResponse.status})`,
      );
    }
    const { items } = orderResponse.body as OrderLinesBody;

    // The tenant's active locations, listed once per call (Plan 2B-3).
    const locations = (await this.warehouses.list({ first: 100 }, tenantId)).items.filter(
      (warehouse) => warehouse.active,
    );

    for (const item of items) {
      const productId = item.snapshot.productId;
      const productResponse = await this.products.get({ productId, tenantId });
      if (productResponse.status !== 200) {
        throw new Error(
          `OrdersInventoryAdapter: cannot load product "${productId}" for order "${orderId}" ` +
            `(status ${productResponse.status})`,
        );
      }
      const variant = variantOf(productResponse.body as Product, item.snapshot.variantRef);
      if (variant === undefined) {
        throw new Error(
          `OrdersInventoryAdapter: no matching variant for product "${productId}" on order "${orderId}"`,
        );
      }
      if (!variant.attributes.tracksInventory) continue;
      const variantId = variant.id.toString();

      // Idempotency guard (see class doc): `ReserveStock` itself is not idempotent by `reference`,
      // so a retried `requestReservation(orderId)` must not blindly re-call `reserve()` — that would
      // either double-decrement real stock or hard-fail a legitimate retry. Skip this line if it was
      // already reserved under this exact `orderId` on a prior attempt, at whichever location.
      const levels: LocationLevel[] = [];
      let alreadyReserved = false;
      for (const location of locations) {
        const warehouseId = location.id.value;
        const inventoryItem = await this.items.findByProductAndWarehouse(
          productId,
          warehouseId,
          tenantId,
          undefined,
          variantId,
        );
        if (inventoryItem !== null) {
          const existing = await this.items.findByReservationReference(
            inventoryItem.id.toString(),
            orderId,
            tenantId,
          );
          if (existing !== null) {
            alreadyReserved = true;
            break;
          }
        }
        levels.push({
          locationId: warehouseId,
          available: inventoryItem?.stockLevel.available ?? 0,
        });
      }
      if (alreadyReserved) continue;

      const chosen = pickLocation(levels, item.quantity);
      const continueSelling = variant.attributes.inventoryPolicy === "continue";

      // "Continue selling": reserve what is in stock, never fail for the rest. "Deny": all of it —
      // and a deny line that no single location covers fails loudly (see class doc).
      if (chosen === null || (!continueSelling && !chosen.covers)) {
        throw new Error(
          `OrdersInventoryAdapter: no active location can supply product "${productId}" ` +
            `on order "${orderId}" (requested ${item.quantity}, ` +
            `${chosen === null ? "no active location" : `${chosen.available} at best`})`,
        );
      }
      const quantity = continueSelling ? Math.min(item.quantity, chosen.available) : item.quantity;
      if (quantity === 0) continue;

      const response = await this.inventory.reserve({
        tenantId,
        productId,
        variantId,
        warehouseId: chosen.locationId,
        quantity,
        reference: orderId,
      });
      if (response.status !== 201) {
        throw new Error(
          `OrdersInventoryAdapter: reservation failed for product "${productId}" ` +
            `on order "${orderId}" (status ${response.status}): ${JSON.stringify(response.body)}`,
        );
      }
      // The per-item `reservationId` in `response.body` is intentionally discarded here — see the
      // class doc for why `orderId` itself, not one of these, is the returned order-level ref.
    }

    return { reservationRef: orderId };
  }
}

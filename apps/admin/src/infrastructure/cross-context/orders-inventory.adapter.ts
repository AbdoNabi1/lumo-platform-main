import type {
  InventoryController,
  InventoryItemRepository,
  WarehouseRepository,
} from "@platform/inventory";
import type { InventoryPort, OrderController } from "@platform/orders";

interface OrderLinesBody {
  readonly items: readonly {
    readonly snapshot: { readonly productId: string };
    readonly quantity: number;
  }[];
}

/**
 * Real `InventoryPort` over Inventory's own `reserve` use case (Phase 3 Task 12, C-3) — `Orders`'
 * `RequestFulfillment` calls this instead of the offline `InMemoryInventoryAdapter` stub
 * (`services/orders/src/infrastructure/in-memory-port-adapters.ts`), which fabricated a
 * `reservation-{orderId}-{n}` ref without ever touching Inventory's real stock.
 *
 * Warehouse-resolution gap (same one Task 10 already solved for Checkout's
 * `InventoryValidationPort`, reused verbatim — see `inventory-validation.adapter.ts`): the order
 * carries no warehouse, and there is no "default warehouse" convention anywhere in this codebase.
 * This adapter resolves it by listing the tenant's warehouses once per `requestReservation()` call
 * and requires there to be EXACTLY ONE registered.
 *
 * Unlike `InventoryValidationPort` (which reports `{valid: false, reason}` because Checkout's call
 * site treats a `false` response as an ordinary "not valid yet" outcome), `InventoryPort` has no
 * such channel — its contract is `Promise<InventoryReservationResult>`, success or bust. So a
 * zero/multi-warehouse gap here is a request-time failure the caller genuinely needs to see, and
 * this adapter THROWS a clear `Error` instead: fabricating a fake `reservationRef` to paper over an
 * unresolved warehouse would silently corrupt stock tracking, which is strictly worse than a loud
 * failure. Confirmed safe to throw by reading the actual call site
 * (`services/orders/src/application/order-lifecycle.use-cases.ts`'s `RequestFulfillment.execute()`):
 * both port calls run outside any `present()`/domain-error-mapping wrapper, so a thrown `Error`
 * propagates all the way out of `OrderController.requestFulfillment()` as a genuine unhandled
 * error — never silently swallowed, never converted into a fabricated success.
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
 * `InventoryItemRepository.findByProductAndWarehouse` resolves the item, then
 * `findByReservationReference(item.id, orderId)` (scaffolding added ahead of any real caller —
 * "not yet wired into any use case" per its own doc — this adapter is the first) checks whether a
 * reservation already exists under this exact `orderId`. Found ⇒ skip re-reserving this line
 * (idempotent no-op); not found ⇒ call `reserve()` as normal. The order-level ref this adapter
 * returns is `orderId` itself, NOT one of Inventory's per-item `reservationId`s from
 * `ReserveStockOutput` (those are Inventory-internal and, for a multi-item order, there would be
 * several of them with no single one able to stand for "the reservation"). `orderId` is already the
 * stable, natural correlation key Orders itself treats as canonical.
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
  private readonly inventory: Pick<InventoryController, "reserve">;
  private readonly warehouses: WarehouseRepository;
  private readonly items: Pick<
    InventoryItemRepository,
    "findByProductAndWarehouse" | "findByReservationReference"
  >;
  private readonly orders: Pick<OrderController, "getOrder">;
  private readonly tenantId: string | undefined;

  /**
   * ADR-0014 (WP-10, T10.3): Inventory's repositories and use cases now take `tenantId` per call,
   * but orders' own `InventoryPort.requestReservation(orderId)` does not carry one yet — widening
   * it is orders-context work. Until orders converts, this adapter captures the tenant at
   * construction (same not-yet-converted pattern as `OrdersNotificationAdapter`). `tenantId` stays
   * optional only because `AdminWiringDeps.tenantId` is; `requestReservation` throws if it is
   * missing, never defaulting a tenant.
   */
  constructor(
    inventory: Pick<InventoryController, "reserve">,
    warehouses: WarehouseRepository,
    items: Pick<
      InventoryItemRepository,
      "findByProductAndWarehouse" | "findByReservationReference"
    >,
    orders: Pick<OrderController, "getOrder">,
    tenantId?: string,
  ) {
    this.inventory = inventory;
    this.warehouses = warehouses;
    this.items = items;
    this.orders = orders;
    this.tenantId = tenantId;
  }

  async requestReservation(orderId: string): Promise<{ readonly reservationRef: string }> {
    const tenantId = this.tenantId;
    if (tenantId === undefined) {
      throw new Error(
        `OrdersInventoryAdapter: cannot reserve stock for order "${orderId}" without a tenant`,
      );
    }
    const orderResponse = await this.orders.getOrder({ orderId });
    if (orderResponse.status !== 200) {
      throw new Error(
        `OrdersInventoryAdapter: cannot load order "${orderId}" for reservation ` +
          `(status ${orderResponse.status})`,
      );
    }
    const { items } = orderResponse.body as OrderLinesBody;

    // `first: 2` is enough to distinguish "exactly one" from "more than one" without paging
    // through the whole registry (same convention as `InventoryValidationAdapter`).
    const page = await this.warehouses.list({ first: 2 }, tenantId);
    const [warehouse, extra] = page.items;
    if (warehouse === undefined || extra !== undefined) {
      throw new Error(
        warehouse === undefined
          ? `OrdersInventoryAdapter: cannot resolve a single warehouse for order "${orderId}" — ` +
              "no warehouse is registered; multi-warehouse routing is not implemented"
          : `OrdersInventoryAdapter: cannot resolve a single warehouse for order "${orderId}" — ` +
              "more than one warehouse is registered; multi-warehouse routing is not implemented",
      );
    }
    const warehouseId = warehouse.id.value;

    for (const item of items) {
      // Idempotency guard (see class doc): `ReserveStock` itself is not idempotent by `reference`,
      // so a retried `requestReservation(orderId)` must not blindly re-call `reserve()` — that would
      // either double-decrement real stock or hard-fail a legitimate retry. Skip this line if it was
      // already reserved under this exact `orderId` on a prior attempt.
      const inventoryItem = await this.items.findByProductAndWarehouse(
        item.snapshot.productId,
        warehouseId,
        tenantId,
      );
      if (inventoryItem !== null) {
        const existing = await this.items.findByReservationReference(
          inventoryItem.id.toString(),
          orderId,
          tenantId,
        );
        if (existing !== null) {
          continue;
        }
      }

      const response = await this.inventory.reserve({
        tenantId,
        productId: item.snapshot.productId,
        warehouseId,
        quantity: item.quantity,
        reference: orderId,
      });
      if (response.status !== 201) {
        throw new Error(
          `OrdersInventoryAdapter: reservation failed for product "${item.snapshot.productId}" ` +
            `on order "${orderId}" (status ${response.status}): ${JSON.stringify(response.body)}`,
        );
      }
      // The per-item `reservationId` in `response.body` is intentionally discarded here — see the
      // class doc for why `orderId` itself, not one of these, is the returned order-level ref.
    }

    return { reservationRef: orderId };
  }
}

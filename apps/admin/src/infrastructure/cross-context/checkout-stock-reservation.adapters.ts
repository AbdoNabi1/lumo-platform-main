import type {
  CheckoutItem,
  OrderCancellationPort,
  OrderStockReservationPort,
  StockReservationResult,
} from "@platform/checkout";
import type { OrderController } from "@platform/orders";
import type { OrdersInventoryAdapter } from "./orders-inventory.adapter";
import type { OrdersStockReleaseAdapter } from "./orders-stock-release.adapter";

/**
 * Real `OrderStockReservationPort` (Plan 3C, G-114): when Checkout places an order, the stock is
 * held for it right away, like Shopify — not days later when fulfillment is requested.
 *
 * It adds no stock logic of its own. Reserving goes through `OrdersInventoryAdapter` — the same code
 * `RequestFulfillment` uses later, with its rules intact: the variant is resolved from Catalog,
 * a variant that does not track quantity is skipped, a "keep selling when out of stock" line
 * reserves only what is there and never fails, a "deny" line needs one active location that covers
 * it, and the location is the one holding the most (`pickLocation`). The reference is the order's id.
 * Because that adapter skips a line already reserved under the order's id, a later
 * `RequestFulfillment` reuses these reservations instead of reserving again.
 *
 * The lines come from the ORDER Orders just created (its snapshots), not from the `items` argument,
 * so what is held is exactly what was ordered.
 *
 * Releasing goes through `OrdersStockReleaseAdapter` (G-130): everything held under the order's id
 * goes back to available.
 */
export class CheckoutStockReservationAdapter implements OrderStockReservationPort {
  private readonly inventory: Pick<OrdersInventoryAdapter, "requestReservation">;
  private readonly stockRelease: Pick<OrdersStockReleaseAdapter, "releaseOrderStock">;

  constructor(
    inventory: Pick<OrdersInventoryAdapter, "requestReservation">,
    stockRelease: Pick<OrdersStockReleaseAdapter, "releaseOrderStock">,
  ) {
    this.inventory = inventory;
    this.stockRelease = stockRelease;
  }

  async reserve(
    orderId: string,
    _items: readonly CheckoutItem[],
    tenantId: string,
  ): Promise<StockReservationResult> {
    try {
      await this.inventory.requestReservation(orderId, tenantId);
      return { ok: true };
    } catch {
      // `requestReservation` throws when a stock-limited line has no location that covers it (or
      // cannot be resolved). The shopper is told the stock is gone; the internal message stays out.
      return { ok: false, reason: "insufficient stock" };
    }
  }

  async release(orderId: string, tenantId: string): Promise<void> {
    await this.stockRelease.releaseOrderStock(orderId, tenantId);
  }
}

/**
 * Real `OrderCancellationPort` (Plan 3C): cancels the order Checkout just placed through Orders' own
 * status transition. Cancelling is what voids its payment, cancels its fulfillment and releases its
 * stock (G-126 / G-130), so nothing is repeated here.
 */
export class CheckoutOrderCancellationAdapter implements OrderCancellationPort {
  private readonly orders: Pick<OrderController, "advance">;

  constructor(orders: Pick<OrderController, "advance">) {
    this.orders = orders;
  }

  async cancel(orderId: string, tenantId: string): Promise<void> {
    const response = await this.orders.advance({ tenantId, orderId, toStatus: "cancelled" });
    if (response.status !== 200) {
      throw new Error(
        `CheckoutOrderCancellationAdapter: could not cancel order "${orderId}" (status ${response.status})`,
      );
    }
  }
}

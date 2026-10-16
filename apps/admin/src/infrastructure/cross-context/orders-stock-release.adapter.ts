import type { InventoryController, InventoryItemRepository } from "@platform/inventory";
import type { OrderController, StockReleasePort } from "@platform/orders";
import { type Logger, logger as defaultLogger } from "@platform/utils";

interface OrderLinesBody {
  readonly items: readonly { readonly snapshot: { readonly productId: string } }[];
}

/**
 * Real `StockReleasePort` (G-130): when an order is cancelled, whatever stock Inventory is holding
 * FOR THAT ORDER goes back to available.
 *
 * It uses what Inventory already has. `OrdersInventoryAdapter` reserves with `reference: orderId`, so
 * the order's reservations are found the same way: for each product on the order, every inventory
 * item of that product (any location, any variant) is read, and each reservation whose reference is
 * the order's id is released through Inventory's own `ReleaseReservation` (`inventory.release`),
 * which restores `available`. Nothing else's reservation is touched, and an order with nothing
 * reserved releases nothing.
 *
 * Best-effort, never throws, each release independent: the order is already cancelled when this
 * runs, and one refused release must not strand the others. Problems are logged with ids only.
 *
 * Since Plan 3C (G-114) Checkout reserves an order's stock the moment it is placed, so a cancelled
 * order really does hold stock, and this is the path that gives it back — including for an order
 * Checkout itself cancels after a lost race for the last units. (Committing the reservation when the
 * order ships waits for the Fulfillment rework, G-131.)
 */
export class OrdersStockReleaseAdapter implements StockReleasePort {
  private readonly orders: Pick<OrderController, "getOrder">;
  private readonly items: Pick<InventoryItemRepository, "findByProduct">;
  private readonly inventory: Pick<InventoryController, "release">;
  private readonly logger: Logger;

  constructor(
    orders: Pick<OrderController, "getOrder">,
    items: Pick<InventoryItemRepository, "findByProduct">,
    inventory: Pick<InventoryController, "release">,
    logger: Logger = defaultLogger,
  ) {
    this.orders = orders;
    this.items = items;
    this.inventory = inventory;
    this.logger = logger;
  }

  async releaseOrderStock(orderId: string, tenantId: string): Promise<void> {
    try {
      const found = await this.orders.getOrder({ tenantId, orderId });
      if (found.status !== 200) {
        this.logger.warn(
          "OrdersStockReleaseAdapter: could not read the order to release its stock",
          {
            orderId,
            status: found.status,
          },
        );
        return;
      }
      const productIds = [
        ...new Set((found.body as OrderLinesBody).items.map((line) => line.snapshot.productId)),
      ];
      for (const productId of productIds) {
        const stockItems = await this.items.findByProduct(productId, tenantId);
        for (const stockItem of stockItems) {
          // A copy: releasing takes the reservation off the aggregate being walked.
          for (const reservation of [...stockItem.reservations]) {
            if (reservation.reference !== orderId) continue;
            await this.release(orderId, tenantId, {
              productId,
              warehouseId: stockItem.warehouseId.value,
              ...(stockItem.variantRef !== null ? { variantId: stockItem.variantRef } : {}),
              reservationId: reservation.id.toString(),
            });
          }
        }
      }
    } catch {
      this.logger.warn("OrdersStockReleaseAdapter: releasing the order's stock failed", {
        orderId,
      });
    }
  }

  /** One release, independent of the others: a refusal or a throw is logged and the loop goes on. */
  private async release(
    orderId: string,
    tenantId: string,
    target: {
      readonly productId: string;
      readonly warehouseId: string;
      readonly variantId?: string;
      readonly reservationId: string;
    },
  ): Promise<void> {
    try {
      const released = await this.inventory.release({ tenantId, ...target });
      if (released.status !== 200) {
        this.logger.warn("OrdersStockReleaseAdapter: Inventory refused to release a reservation", {
          orderId,
          reservationId: target.reservationId,
          status: released.status,
        });
      }
    } catch {
      this.logger.warn("OrdersStockReleaseAdapter: releasing a reservation failed", {
        orderId,
        reservationId: target.reservationId,
      });
    }
  }
}

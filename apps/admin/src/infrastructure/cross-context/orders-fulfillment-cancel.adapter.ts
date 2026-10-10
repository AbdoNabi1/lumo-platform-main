import type { FulfillmentController } from "@platform/fulfillment";
import type { FulfillmentCancelPort } from "@platform/orders";
import { type Logger, logger as defaultLogger } from "@platform/utils";

/**
 * The fulfillment-order statuses Fulfillment's own transition table lets be cancelled
 * (`created`, `confirmed`, `failed`). Anything further along is a fulfillment already being worked.
 */
const CANCELLABLE: ReadonlySet<string> = new Set(["created", "confirmed", "failed"]);
/** Statuses where there is nothing left to cancel; not worth a warning. */
const SETTLED: ReadonlySet<string> = new Set(["cancelled", "closed", "delivered", "returned"]);

/**
 * Real `FulfillmentCancelPort` (G-130): when an order is cancelled, its open fulfillment order is
 * cancelled too, so nobody picks, packs or ships a cancelled order.
 *
 * It uses what Fulfillment already has — `getByOrder` (the order's newest fulfillment order) and the
 * generic validated `AdvanceFulfillment` transition to `cancelled`; no new Fulfillment use case.
 * Fulfillment's table only allows that from `created`, `confirmed` and `failed`; a fulfillment order
 * that is already being picked, packed or shipped is left alone and a warning (order id only) says so
 * — the table is not changed here (G-131).
 *
 * Best-effort, never throws: the order is already cancelled when this runs. Problems are logged with
 * ids only — no name, phone, email or the other context's message.
 */
export class OrdersFulfillmentCancelAdapter implements FulfillmentCancelPort {
  private readonly fulfillment: Pick<FulfillmentController, "getByOrder" | "advance">;
  private readonly logger: Logger;

  constructor(
    fulfillment: Pick<FulfillmentController, "getByOrder" | "advance">,
    logger: Logger = defaultLogger,
  ) {
    this.fulfillment = fulfillment;
    this.logger = logger;
  }

  async cancelOpenFulfillment(orderId: string, tenantId: string): Promise<void> {
    try {
      const found = await this.fulfillment.getByOrder({ tenantId, orderRef: orderId });
      if (found.status !== 200) return; // The order has no fulfillment order: nothing to cancel.
      const body = found.body as {
        readonly id: { toString(): string };
        readonly status: { readonly value: string };
      };
      const status = body.status.value;
      if (!CANCELLABLE.has(status)) {
        if (!SETTLED.has(status)) {
          this.logger.warn(
            "OrdersFulfillmentCancelAdapter: the fulfillment is already in progress and was not cancelled (G-131)",
            { orderId, status },
          );
        }
        return;
      }
      const cancelled = await this.fulfillment.advance({
        tenantId,
        fulfillmentOrderId: body.id.toString(),
        toStatus: "cancelled",
      });
      if (cancelled.status !== 200) {
        this.logger.warn("OrdersFulfillmentCancelAdapter: Fulfillment refused to cancel", {
          orderId,
          status: cancelled.status,
        });
      }
    } catch {
      this.logger.warn("OrdersFulfillmentCancelAdapter: cancelling the fulfillment failed", {
        orderId,
      });
    }
  }
}

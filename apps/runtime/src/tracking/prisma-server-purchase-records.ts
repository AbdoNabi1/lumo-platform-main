/**
 * The cancel guard's question (Tracking P2-D3): "did THIS platform send a Purchase for this order?"
 *
 * A cancellation is worth sending to an ad platform (GA4 `refund`, a Meta / TikTok / Snap cancel event) only if the
 * purchase it reverses was recorded. Answered from `tracking_event_records`: a record of `eventName = purchase` whose
 * event id is the one derived from the tenant and `ord_<orderId>` AND whose stored envelope has
 * `eventOrigin = "server"`. The origin matters: a browser may claim any valid-shaped `ord_` dedup id so that its
 * thank-you pixel collapses with the server's Purchase, and that claim must never be enough to emit a refund.
 *
 * A store with nothing connected records no events at all (P2-D2), so it has no purchase record and no cancel is sent:
 * nothing was ever reported, nothing to reverse.
 *
 * Read-only, one scoped statement, `tenantId` in the `where`.
 */

import { runReadScoped, type Database } from "@platform/db";
import { businessEventId, businessMessageId } from "@platform/tracking";

export interface ServerPurchaseRecords {
  /** True when a server-origin Purchase record exists for the order under this tenant. */
  hasServerPurchase(tenantId: string, orderId: string): Promise<boolean>;
}

export class PrismaServerPurchaseRecords implements ServerPurchaseRecords {
  constructor(private readonly db: Database) {}

  async hasServerPurchase(tenantId: string, orderId: string): Promise<boolean> {
    const eventId = businessMessageId(tenantId, businessEventId("order", orderId));
    const row = await runReadScoped(this.db, tenantId, (tx) =>
      tx.trackingEventRecord.findFirst({
        where: {
          tenantId,
          eventId,
          eventName: "purchase",
          envelope: { path: ["eventOrigin"], equals: "server" },
        },
        select: { eventId: true },
      }),
    );
    return row !== null;
  }
}

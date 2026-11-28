/**
 * What counts as a real business event (Tracking P1-D8, owner decision: "never block real orders or leads").
 *
 * The bot score and the block list exist to keep crawler page views and a merchant's own test clicks out of the
 * ad platforms. They must never touch the thing the merchant is paid for: an order, a lead form that was
 * submitted, an order's delivery or cancellation. Those events are exempt from BOTH the bot skip (router) and the
 * IP block (collect route), whatever the score or the address says — a wrong "bot" verdict on a real order is lost
 * revenue, a wrong "human" verdict on a fake one is one inflated count.
 *
 * Deliberately by event name AND by evidence (an order id, a `lead_…` dedup id, a server-side emitter): a server
 * event that names its business reference is business, whatever it is called.
 */

import type { TrackingEnvelope } from "../envelope/envelope";

/** The canonical events that are the business itself (see `vendor-event-names.ts`). */
export const BUSINESS_CONVERSION_EVENTS: ReadonlySet<string> = new Set([
  "purchase",
  "form_submitted",
  "order_delivered",
  "order_cancelled",
]);

export function isBusinessConversion(
  envelope: Pick<TrackingEnvelope, "eventName" | "payload" | "eventOrigin"> & {
    readonly dedupId?: string | undefined;
  },
): boolean {
  if (BUSINESS_CONVERSION_EVENTS.has(envelope.eventName)) return true;
  const payload = envelope.payload;
  if ((payload?.orderId ?? "").trim() !== "" || (payload?.transactionId ?? "").trim() !== "") {
    return true;
  }
  if ((envelope.dedupId ?? "").startsWith("lead_")) return true;
  // A server-side emitter (checkout, lead action, back office) is not a browser a crawler can drive.
  return envelope.eventOrigin === "server";
}

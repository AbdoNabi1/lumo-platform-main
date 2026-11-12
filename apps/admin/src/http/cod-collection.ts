import { derivePaymentStatus, type Order } from "@platform/orders";
import type { PaymentIntentSummary } from "@platform/payments";

/** What a cash-on-delivery payment still asks for: the courier's "collect" line and the bulk mark. */
export interface CodCollectionState {
  /** Print the order total as cash to collect (CSV "COD amount", packing slip "Collect"). */
  readonly printAmount: boolean;
  /** Bulk "Mark cash as received" may confirm the collection. */
  readonly canMarkCollected: boolean;
}

const NOTHING: CodCollectionState = { printAmount: false, canMarkCollected: false };

/**
 * Intent statuses meaning the cash already arrived. `ConfirmCodCollection` captures the intent at
 * once; the order only gets `payment_received` later via the outbox — so the intent decides.
 * `closed` is terminal and reachable both after a refund and after a cancel/expiry; nothing calls
 * `PaymentIntent.close()` today. It is treated as settled so a courier is never asked to collect
 * twice; revisit (e.g. using the intent's prior status) when closing intents is wired.
 */
const SETTLED = new Set(["captured", "refunded", "partially_refunded", "closed"]);

/** Intent statuses after which a collection can no longer be confirmed, with no cash received. */
const DEAD = new Set(["cancelled", "expired", "failed"]);

/**
 * The ONE cash-on-delivery eligibility rule, shared by the export / packing slip amount and the bulk
 * "Mark cash as received". Eligible only when the intent is THIS order's, cash collected on delivery
 * (`collectedOnDelivery` — by capability, not name) and the order still waits for payment.
 * A settled intent prints nothing and cannot be marked. A dead intent (cancelled/expired/failed) on a
 * still-pending order keeps PRINTING the total — a courier must never hand goods over without
 * collecting — but cannot be marked collected (there is nothing to confirm).
 *
 * Order operations Part 4 (Ruling 9): a draft order "Marked as paid" uses the `manual` provider, which
 * is settled by an operator's confirmation too — but the merchant already HAS that money, so it is never
 * cash to collect: `collectedOnDelivery` is false for it. Even if its settlement failed and the intent is
 * still pending, no packing slip or CSV prints "Collect" for it and the bulk "Mark cash as received"
 * skips it; the draft's own "Mark as paid" (resumable, Ruling 6) is how it gets settled.
 */
export function codCollectionState(
  order: Order,
  intent: PaymentIntentSummary | undefined,
): CodCollectionState {
  if (
    intent === undefined ||
    !intent.collectedOnDelivery ||
    intent.orderRef !== order.id.toString() ||
    derivePaymentStatus(order.history) !== "pending" ||
    SETTLED.has(intent.status)
  ) {
    return NOTHING;
  }
  return { printAmount: true, canMarkCollected: !DEAD.has(intent.status) };
}

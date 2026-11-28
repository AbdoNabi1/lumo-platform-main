/**
 * The plain read models the business-event mappers consume (P2 Task 2).
 *
 * `packages/tracking` cannot import `@platform/orders` or `@platform/leads` (dependency-cruiser), so what an order
 * or a lead looks like to tracking is defined HERE, as plain data. The runtime adapters (Task 4's order reader,
 * Task 5's lead emitter) read their own tables and return these types; nothing else crosses the boundary.
 *
 * Money is integer minor units. Raw customer fields (email, phone, name, address) stay raw here: the mappers put
 * them in the envelope's identity block with `hashStatus: "raw"`, and the delivery pipeline normalises and hashes
 * them before anything leaves the platform.
 */

/** One captured click id (same shape as the edge capture / snapshot store). */
export interface SnapshotClickId {
  readonly name: string;
  readonly value: string;
  /** ISO-8601 UTC instant the click was captured; the vendor attribution window is judged from it. */
  readonly capturedAt: string;
}

/**
 * What the visitor's browser carried when they placed the order or sent the lead form (P2-D8): the attribution
 * snapshot. Every field is optional; a draft or phone order has none and still produces an identity-only event.
 */
export interface BusinessAttributionSnapshot {
  readonly visitorId?: string;
  readonly sessionId?: string;
  /** The VISITOR's address, not the storefront server's. */
  readonly ip?: string;
  readonly userAgent?: string;
  readonly pageUrl?: string;
  readonly referrer?: string;
  /** Raw cookie values; `ga` is the whole `_ga` cookie (`GA1.1.123.456`). */
  readonly cookies?: {
    readonly fbp?: string;
    readonly fbc?: string;
    readonly ttp?: string;
    readonly scid?: string;
    readonly ga?: string;
  };
  readonly clickIds?: readonly SnapshotClickId[];
  readonly utm?: {
    readonly source?: string;
    readonly medium?: string;
    readonly campaign?: string;
    readonly content?: string;
    readonly term?: string;
  };
}

export interface OrderTrackingLine {
  readonly productRef: string;
  readonly variantRef?: string;
  readonly sku?: string;
  readonly name: string;
  readonly unitPriceMinor: number;
  readonly quantity: number;
}

/** The order's `OrderTotalsSnapshot` fields (all minor units, in `currency`). */
export interface OrderTrackingTotals {
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly taxMinor: number;
  readonly shippingMinor: number;
  /** What the customer pays; informational, never the reported value (see `businessValueMinor`). */
  readonly totalMinor?: number;
  /** False on older orders where the field is absent (the tax was added on top). */
  readonly taxIncluded: boolean;
}

export interface OrderTrackingCustomer {
  /** `identity.customers` id; sent to GA4 as `user_id`. */
  readonly customerRef?: string;
  readonly email?: string;
  /** As typed (national format is fine; the mapper makes it E.164 from the order currency). */
  readonly phone?: string;
  readonly name?: string;
}

export interface OrderTrackingShipping {
  readonly recipientName?: string;
  readonly phone?: string;
  readonly city?: string;
  readonly province?: string;
  /** ISO 3166-1 alpha-2 when known (`EG`); anything else is dropped by normalisation. */
  readonly country?: string;
}

export interface OrderTrackingReadModel {
  /** The order id; the `ord_`/`dlv_`/`cnl_` business ids and GA4 `transaction_id` are built from it. */
  readonly orderId: string;
  readonly orderNumber?: string;
  readonly currency: string;
  readonly totals: OrderTrackingTotals;
  readonly lines: readonly OrderTrackingLine[];
  readonly customer: OrderTrackingCustomer;
  readonly shipping?: OrderTrackingShipping;
  readonly checkoutRef?: string;
  /** ISO-8601 UTC instant the order was placed; the Purchase event's time. */
  readonly placedAt: string;
  /** Discount code the shopper used, when one was. */
  readonly couponCode?: string;
  /** Absent for orders with no attribution snapshot (draft, phone, pre-release). */
  readonly snapshot?: BusinessAttributionSnapshot;
}

export interface LeadTrackingReadModel {
  /** The lead id; the `lead_<id>` business id is built from it. */
  readonly leadId: string;
  /** Name as typed (one field). */
  readonly name: string;
  /** As typed. */
  readonly phone?: string;
  /** Already E.164 when the lead use case could normalise it; preferred over `phone`. */
  readonly phoneE164?: string;
  readonly email?: string;
  /** ISO-8601 UTC instant the form was submitted. */
  readonly submittedAt: string;
  /** Deliberately has no `message` field: free text is never forwarded to an ad platform. */
  readonly snapshot?: BusinessAttributionSnapshot;
}

/** What every mapper needs from the caller besides the read model. */
export interface BusinessEventContext {
  readonly tenantId: string;
  /**
   * `https://<store primary domain>/` (P2-D7): the `event_source_url` of last resort, used only when the snapshot
   * has no page url. Resolved by the caller from `tenancy.shop_domains` (or the platform storefront URL).
   */
  readonly storeUrl: string;
  /**
   * The store's currency, used to pick the calling code for a lead's national phone number. Orders carry their own
   * currency. Absent => Egypt.
   */
  readonly currency?: string;
}

/** `deliveredEnvelope` / `cancelledEnvelope` need the instant of the transition (the order was placed earlier). */
export interface TransitionEventContext extends BusinessEventContext {
  /** ISO-8601 UTC instant the delivery / cancellation / return happened (the domain event's `occurredAt`). */
  readonly occurredAt: string;
}

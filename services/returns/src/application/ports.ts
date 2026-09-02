/** Reports a return outcome to Orders — reference-only, Returns never modifies orders itself. */
export interface OrdersPort {
  reportReturnOutcome(orderRef: string, status: string): Promise<void>;
}

/** Sends a best-effort lifecycle notification — reference-only, never blocks a transition's own result. */
export interface NotificationPort {
  notify(orderRef: string, status: string): Promise<void>;
}

/** Requests a refund from Payments — reference-only, retry-safe (idempotency key). The amount is caller-provided; Returns never calculates it. */
export interface PaymentsPort {
  requestRefund(
    orderRef: string,
    amountMinor: number,
    currency: string,
    idempotencyKey: string,
  ): Promise<void>;
}

/**
 * Verifies a staff-decided refund amount does not exceed the refundable ceiling for the order
 * (Phase A.1, F-04) — reference-only, Returns never computes the ceiling itself (Returns prices
 * nothing, by design). Optional: when unwired, behavior is unchanged from before this port
 * existed, same convention as Orders' `PaymentVerificationPort`.
 */
export interface RefundVerificationPort {
  isRefundable(orderRef: string, amountMinor: number, currency: string): Promise<boolean>;
}

export interface RestockItem {
  readonly productRef: string;
  readonly quantity: number;
}

/** Requests a restock for accepted items — reference-only, Returns never moves inventory itself. */
export interface InventoryPort {
  restock(orderRef: string, items: readonly RestockItem[]): Promise<void>;
}

/** Verifies a return shipment with Shipping — reference-only, Returns never owns the shipment lifecycle itself. */
export interface ShippingPort {
  verifyReturnShipment(orderRef: string): Promise<boolean>;
}

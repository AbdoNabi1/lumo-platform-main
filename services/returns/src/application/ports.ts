/** Reports a return outcome to Orders — reference-only, Returns never modifies orders itself. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface OrdersPort {
  reportReturnOutcome(orderRef: string, status: string, tenantId: string): Promise<void>;
}

/** Sends a best-effort lifecycle notification — reference-only, never blocks a transition's own result. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface NotificationPort {
  notify(orderRef: string, status: string, tenantId: string): Promise<void>;
}

/** Requests a refund from Payments — reference-only, retry-safe (idempotency key). The amount is caller-provided; Returns never calculates it. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface PaymentsPort {
  requestRefund(
    orderRef: string,
    amountMinor: number,
    currency: string,
    idempotencyKey: string,
    tenantId: string,
  ): Promise<void>;
}

/**
 * Verifies a staff-decided refund amount does not exceed the refundable ceiling for the order
 * (Phase A.1, F-04) — reference-only, Returns never computes the ceiling itself (Returns prices
 * nothing, by design). Optional: when unwired, behavior is unchanged from before this port
 * existed, same convention as Orders' `PaymentVerificationPort`. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter.
 */
export interface RefundVerificationPort {
  isRefundable(
    orderRef: string,
    amountMinor: number,
    currency: string,
    tenantId: string,
  ): Promise<boolean>;
}

export interface RestockItem {
  readonly productRef: string;
  readonly quantity: number;
}

/** Requests a restock for accepted items — reference-only, Returns never moves inventory itself. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface InventoryPort {
  restock(orderRef: string, items: readonly RestockItem[], tenantId: string): Promise<void>;
}

/** Verifies a return shipment with Shipping — reference-only, Returns never owns the shipment lifecycle itself. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface ShippingPort {
  verifyReturnShipment(orderRef: string, tenantId: string): Promise<boolean>;
}

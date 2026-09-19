export interface PaymentCaptureResult {
  readonly paymentRef: string;
}

/** Requests a payment capture from Payments — Orders never captures payment itself, only records the returned ref. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface PaymentPort {
  requestCapture(
    orderId: string,
    amountMinor: number,
    currency: string,
    tenantId: string,
  ): Promise<PaymentCaptureResult>;
}

export interface InventoryReservationResult {
  readonly reservationRef: string;
}

/**
 * Requests stock reservation from Inventory — Orders never reserves/moves stock itself.
 *
 * IDEMPOTENCY CONTRACT (Phase A.16, Task 4/5 — closes the A.15 §20/§24 orphan-reservation risk):
 * implementers MUST be idempotent keyed on `orderId` alone — calling `requestReservation(orderId)`
 * twice for the SAME order must return the SAME `reservationRef`, never create a second reservation.
 * This is required because `RequestFulfillment` (`order-lifecycle.use-cases.ts`) has no durable local
 * state distinguishing "reservation already requested" from "not yet requested" between this call and
 * `ShippingPort.requestShipment` — if the shipment call then fails, a caller retry calls
 * `requestReservation(orderId)` again with no other information available. `orderId` is already the
 * natural, stable, pre-existing correlation key (no port signature change needed, unlike Licensing's
 * `collect()` which had no caller-supplied identity at all) — reusing it here, rather than adding a
 * new persisted intermediate `Order` status (a schema/business-semantics change explicitly out of
 * this phase's scope per the brief), is what closes the orphan-reservation window. See
 * `in-memory-port-adapters.ts` for the reference implementation and `order-lifecycle.use-cases.ts`'s
 * `RequestFulfillment` class doc for the full analysis.
 * ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. The
 * idempotency key is `(tenantId, orderId)`.
 */
export interface InventoryPort {
  requestReservation(orderId: string, tenantId: string): Promise<InventoryReservationResult>;
}

export interface ShipmentResult {
  readonly shipmentRef: string;
}

/**
 * Requests shipment creation from Shipping — Orders never ships anything itself.
 *
 * IDEMPOTENCY CONTRACT (Phase A.16, Task 4/5): same `orderId`-keyed idempotency requirement as
 * `InventoryPort.requestReservation` — see that interface's doc for the full reasoning. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter.
 */
export interface ShippingPort {
  requestShipment(orderId: string, tenantId: string): Promise<ShipmentResult>;
}

/** Sends a best-effort lifecycle notification — reference-only, never blocks a transition's own result. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface NotificationPort {
  notify(customerRef: string, orderNumber: string, status: string, tenantId: string): Promise<void>;
}

/**
 * Verifies a captured payment exists for this order/reference with Payments — reference-only,
 * Orders never queries Payments' own store directly. Gates the admin backoffice `markOrderPaid`
 * action (the ONE caller-asserted path — the event-driven `PaymentCapturedConsumer` path is
 * already trustworthy by construction, since the event itself is the captured-payment evidence). ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter.
 */
export interface PaymentVerificationPort {
  hasCapturedPayment(orderId: string, paymentRef: string, tenantId: string): Promise<boolean>;
}

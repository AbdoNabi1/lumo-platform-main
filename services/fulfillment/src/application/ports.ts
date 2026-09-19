/** Reports a fulfillment outcome to Orders — reference-only, Fulfillment never creates/modifies an order. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface OrdersPort {
  reportFulfillmentOutcome(orderRef: string, status: string, tenantId: string): Promise<void>;
}

export interface ReservationItem {
  readonly productRef: string;
  readonly quantity: number;
}

export interface ReservationResult {
  readonly confirmed: boolean;
  readonly reason?: string;
}

/** Requests a stock reservation from Inventory — reference-only, Fulfillment never reserves/modifies inventory itself. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface InventoryPort {
  reserve(
    orderRef: string,
    items: readonly ReservationItem[],
    tenantId: string,
  ): Promise<ReservationResult>;
}

export interface CreateShipmentRequest {
  /** ADR-0014 (WP-10, T10.3): the request's tenant — a carrier adapter resolves its per-tenant credentials from it. */
  readonly tenantId: string;
  readonly fulfillmentOrderId: string;
  readonly orderRef: string;
  /** Retry-safe: a repeated call with the same key must not create a second shipment at the carrier. */
  readonly idempotencyKey: string;
}

export interface ProviderShipment {
  readonly carrier: string;
  readonly carrierShipmentId: string;
  readonly trackingNumber?: string;
}

/** Carrier-agnostic outbound port — no provider-specific logic in the domain; multiple carriers are a composition/config choice. */
export interface ShippingProviderPort {
  createShipment(request: CreateShipmentRequest): Promise<ProviderShipment>;
}

/** Sends a best-effort lifecycle notification — reference-only, never blocks a transition's own result. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface NotificationPort {
  notify(orderRef: string, status: string, tenantId: string): Promise<void>;
}

/** Replay-safe carrier-webhook dedup — unique per `(tenant, carrier, event)`, backing `RecordCarrierWebhook`'s idempotency. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface ProcessedCarrierWebhookStore {
  hasProcessed(carrier: string, eventId: string, tenantId: string): Promise<boolean>;
  markProcessed(carrier: string, eventId: string, tenantId: string): Promise<void>;
}

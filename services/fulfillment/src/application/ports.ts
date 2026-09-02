/** Reports a fulfillment outcome to Orders — reference-only, Fulfillment never creates/modifies an order. */
export interface OrdersPort {
  reportFulfillmentOutcome(orderRef: string, status: string): Promise<void>;
}

export interface ReservationItem {
  readonly productRef: string;
  readonly quantity: number;
}

export interface ReservationResult {
  readonly confirmed: boolean;
  readonly reason?: string;
}

/** Requests a stock reservation from Inventory — reference-only, Fulfillment never reserves/modifies inventory itself. */
export interface InventoryPort {
  reserve(orderRef: string, items: readonly ReservationItem[]): Promise<ReservationResult>;
}

export interface CreateShipmentRequest {
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

/** Sends a best-effort lifecycle notification — reference-only, never blocks a transition's own result. */
export interface NotificationPort {
  notify(orderRef: string, status: string): Promise<void>;
}

/** Replay-safe carrier-webhook dedup — unique per `(carrier, event)`, backing `RecordCarrierWebhook`'s idempotency. */
export interface ProcessedCarrierWebhookStore {
  hasProcessed(carrier: string, eventId: string): Promise<boolean>;
  markProcessed(carrier: string, eventId: string): Promise<void>;
}

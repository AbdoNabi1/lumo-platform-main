/** Reports a shipment outcome to Fulfillment — reference-only, Shipping never modifies fulfillment/orders/inventory itself. */
export interface FulfillmentPort {
  reportShipmentOutcome(fulfillmentRef: string, status: string): Promise<void>;
}

/** Sends a best-effort lifecycle notification — reference-only, never blocks a transition's own result. */
export interface NotificationPort {
  notify(fulfillmentRef: string, status: string): Promise<void>;
}

export interface CreateLabelRequest {
  readonly shipmentId: string;
  readonly fulfillmentRef: string;
  /** Retry-safe: a repeated call with the same key must not create a second label at the carrier. */
  readonly idempotencyKey: string;
}

export interface ProviderLabel {
  readonly carrier: string;
  readonly carrierService: string;
  readonly labelId: string;
  readonly trackingNumber: string;
}

export interface VoidLabelRequest {
  readonly labelId: string;
  readonly idempotencyKey: string;
}

/** Carrier-agnostic outbound port — no provider-specific logic in the domain; multiple carriers are a composition/config choice. */
export interface CarrierProviderPort {
  createLabel(request: CreateLabelRequest): Promise<ProviderLabel>;
  voidLabel(request: VoidLabelRequest): Promise<void>;
}

/** Replay-safe carrier-webhook dedup — unique per `(carrier, event)`, backing `RecordCarrierWebhook`'s idempotency. */
export interface ProcessedCarrierWebhookStore {
  hasProcessed(carrier: string, eventId: string): Promise<boolean>;
  markProcessed(carrier: string, eventId: string): Promise<void>;
}

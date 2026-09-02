import type {
  CreateShipmentRequest,
  InventoryPort,
  NotificationPort,
  OrdersPort,
  ProcessedCarrierWebhookStore,
  ProviderShipment,
  ReservationItem,
  ReservationResult,
  ShippingProviderPort,
} from "../application/ports";

/**
 * Offline in-memory stub adapters for the 4 reference-only outbound ports + the carrier-webhook
 * dedup store. Production swaps these for the real Orders/Inventory adapters + per-carrier
 * `ShippingProviderPort` implementations at the composition root — unchanged interface.
 */
export class InMemoryOrdersAdapter implements OrdersPort {
  async reportFulfillmentOutcome(): Promise<void> {
    // Offline stub: no-op. Production swaps this for the Orders adapter.
  }
}

export class InMemoryInventoryAdapter implements InventoryPort {
  async reserve(_orderRef: string, _items: readonly ReservationItem[]): Promise<ReservationResult> {
    return { confirmed: true };
  }
}

export class InMemoryShippingProvider implements ShippingProviderPort {
  private counter = 0;

  async createShipment(request: CreateShipmentRequest): Promise<ProviderShipment> {
    this.counter += 1;
    return {
      carrier: "offline-carrier",
      carrierShipmentId: `ship-${request.orderRef}-${this.counter}`,
      trackingNumber: `track-${request.orderRef}-${this.counter}`,
    };
  }
}

export class InMemoryNotificationAdapter implements NotificationPort {
  async notify(): Promise<void> {
    // Offline stub: no-op. Production swaps this for the Notifications adapter.
  }
}

/** Replay-safe carrier-webhook dedup — in-memory `Set` keyed `(carrier, eventId)`. Prisma-backed store supersedes this in production (unique `(tenant, carrier, webhook_event_id)`). */
export class InMemoryProcessedCarrierWebhookStore implements ProcessedCarrierWebhookStore {
  private readonly processed = new Set<string>();

  async hasProcessed(carrier: string, eventId: string): Promise<boolean> {
    return this.processed.has(`${carrier}:${eventId}`);
  }

  async markProcessed(carrier: string, eventId: string): Promise<void> {
    this.processed.add(`${carrier}:${eventId}`);
  }
}

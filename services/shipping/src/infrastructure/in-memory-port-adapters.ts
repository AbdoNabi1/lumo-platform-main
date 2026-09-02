import type {
  CarrierProviderPort,
  CreateLabelRequest,
  FulfillmentPort,
  NotificationPort,
  ProcessedCarrierWebhookStore,
  ProviderLabel,
  VoidLabelRequest,
} from "../application/ports";

/**
 * Offline in-memory stub adapters for the 3 reference-only outbound ports + the carrier-webhook
 * dedup store. Production swaps these for the real Fulfillment adapter + per-carrier
 * `CarrierProviderPort` implementations at the composition root — unchanged interface.
 */
export class InMemoryFulfillmentAdapter implements FulfillmentPort {
  async reportShipmentOutcome(): Promise<void> {
    // Offline stub: no-op. Production swaps this for the Fulfillment adapter.
  }
}

export class InMemoryCarrierProvider implements CarrierProviderPort {
  private counter = 0;

  async createLabel(request: CreateLabelRequest): Promise<ProviderLabel> {
    this.counter += 1;
    return {
      carrier: "offline-carrier",
      carrierService: "ground",
      labelId: `label-${request.fulfillmentRef}-${this.counter}`,
      trackingNumber: `track-${request.fulfillmentRef}-${this.counter}`,
    };
  }

  async voidLabel(_request: VoidLabelRequest): Promise<void> {
    // Offline stub: no-op.
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

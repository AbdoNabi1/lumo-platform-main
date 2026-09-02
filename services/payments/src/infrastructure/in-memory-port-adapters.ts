import type { PaymentIntentRequest, PaymentProvider, ProviderIntent } from "@platform/contracts";
import type {
  FinancePort,
  NotificationPort,
  OrdersPort,
  ProcessedWebhookStore,
} from "../application/ports";

/**
 * Offline in-memory stub adapters for the PSP (`PaymentProvider`, `@platform/contracts`) + the 3
 * reference-only outbound ports. Production swaps these for the real per-tenant PSP adapters
 * (`@platform/psp-<provider>`) + context adapters at the composition root — unchanged interface.
 */
export class InMemoryPaymentProvider implements PaymentProvider {
  private counter = 0;

  async createIntent(request: PaymentIntentRequest): Promise<ProviderIntent> {
    this.counter += 1;
    return { providerIntentId: `psp-intent-${request.orderRef}-${this.counter}` };
  }

  async capture(): Promise<void> {
    // Offline stub: no-op. Truth arrives via the webhook, per ADR-0012.
  }

  async cancel(): Promise<void> {
    // Idempotent no-op offline stub.
  }

  async refund(): Promise<void> {
    // Offline stub: no-op.
  }

  async verifyWebhook(): Promise<boolean> {
    return true;
  }
}

export class InMemoryOrdersAdapter implements OrdersPort {
  async reportPaymentOutcome(): Promise<void> {
    // Offline stub: no-op. Production swaps this for the Orders adapter.
  }
}

export class InMemoryFinanceAdapter implements FinancePort {
  async recordPaymentEvent(): Promise<void> {
    // Offline stub: no-op. Production swaps this for the Finance adapter.
  }
}

export class InMemoryNotificationAdapter implements NotificationPort {
  async notify(): Promise<void> {
    // Offline stub: no-op. Production swaps this for the Notifications adapter.
  }
}

/** Replay-safe webhook dedup — in-memory `Set` keyed `(provider, eventId)`. Prisma-backed store supersedes this in production (unique `(tenant, provider, event)`). */
export class InMemoryProcessedWebhookStore implements ProcessedWebhookStore {
  private readonly processed = new Set<string>();

  async hasProcessed(provider: string, eventId: string): Promise<boolean> {
    return this.processed.has(`${provider}:${eventId}`);
  }

  async markProcessed(provider: string, eventId: string): Promise<void> {
    this.processed.add(`${provider}:${eventId}`);
  }
}

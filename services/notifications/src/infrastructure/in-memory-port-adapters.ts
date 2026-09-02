import type {
  EmailProviderPort,
  ProcessedProviderCallbackStore,
  ProviderSendRequest,
  ProviderSendResult,
  PushProviderPort,
  SmsProviderPort,
  WebhookProviderPort,
} from "../application/ports";

/**
 * Offline in-memory stub adapters for the 4 outbound provider ports + the callback dedup store.
 * Production swaps these for the real per-tenant provider adapters (`@platform/notify-<provider>`)
 * at the composition root — unchanged interface. No real providers here, per the report's own
 * "in-memory stubs only" scope.
 */
function stubProvider(prefix: string) {
  let counter = 0;
  return {
    async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
      counter += 1;
      return { providerRef: `${prefix}-${request.recipientRef}-${counter}` };
    },
  };
}

export class InMemoryEmailProvider implements EmailProviderPort {
  private readonly stub = stubProvider("email");
  send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    return this.stub.send(request);
  }
}

export class InMemorySmsProvider implements SmsProviderPort {
  private readonly stub = stubProvider("sms");
  send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    return this.stub.send(request);
  }
}

export class InMemoryPushProvider implements PushProviderPort {
  private readonly stub = stubProvider("push");
  send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    return this.stub.send(request);
  }
}

export class InMemoryWebhookProvider implements WebhookProviderPort {
  private readonly stub = stubProvider("webhook");
  send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    return this.stub.send(request);
  }
}

/** Replay-safe provider-callback dedup — in-memory `Set` keyed `(provider, callbackId)`. Prisma-backed store supersedes this in production (unique `(tenant, provider, callback_id)`). */
export class InMemoryProcessedProviderCallbackStore implements ProcessedProviderCallbackStore {
  private readonly processed = new Set<string>();

  async hasProcessed(provider: string, callbackId: string): Promise<boolean> {
    return this.processed.has(`${provider}:${callbackId}`);
  }

  async markProcessed(provider: string, callbackId: string): Promise<void> {
    this.processed.add(`${provider}:${callbackId}`);
  }
}

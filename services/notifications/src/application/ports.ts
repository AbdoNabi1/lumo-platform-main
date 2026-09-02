export interface ProviderSendRequest {
  readonly recipientRef: string;
  readonly subject?: string;
  readonly body: string;
  /** Retry-safe: a repeated call with the same key must not send a second message at the provider. */
  readonly idempotencyKey: string;
}

export interface ProviderSendResult {
  readonly providerRef: string;
}

/** Outbound email delivery — no provider-specific logic in the domain; the domain never calls this directly. */
export interface EmailProviderPort {
  send(request: ProviderSendRequest): Promise<ProviderSendResult>;
}

/** Outbound SMS delivery. */
export interface SmsProviderPort {
  send(request: ProviderSendRequest): Promise<ProviderSendResult>;
}

/** Outbound push delivery. */
export interface PushProviderPort {
  send(request: ProviderSendRequest): Promise<ProviderSendResult>;
}

/** Outbound webhook delivery. */
export interface WebhookProviderPort {
  send(request: ProviderSendRequest): Promise<ProviderSendResult>;
}

/** Replay-safe provider-callback dedup — unique per `(provider, callback)`, backing `RecordProviderCallback`'s idempotency. */
export interface ProcessedProviderCallbackStore {
  hasProcessed(provider: string, callbackId: string): Promise<boolean>;
  markProcessed(provider: string, callbackId: string): Promise<void>;
}

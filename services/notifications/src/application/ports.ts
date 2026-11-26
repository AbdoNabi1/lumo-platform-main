export interface ProviderSendRequest {
  readonly recipientRef: string;
  readonly subject?: string;
  readonly body: string;
  /** Wave 2b: the notification's tenant, for providers that read per-store settings. */
  readonly tenantId?: string;
  /** Wave 2b: the template key the notification was created from (a catalogue key, or a manual composer id). */
  readonly templateId?: string;
  /** Wave 2b: the notification's stored variables (no address, no secret: ADR-0006). */
  readonly variables?: Readonly<Record<string, string>>;
  /**
   * Wave 2b: values that exist ONLY in memory for this one send (an invoice link is a bearer secret;
   * it must never sit in a notification row). A later retry from the row does not have them.
   */
  readonly transient?: Readonly<Record<string, string>>;
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

/** Replay-safe provider-callback dedup — unique per `(tenant, provider, callback)`, backing `RecordProviderCallback`'s idempotency. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface ProcessedProviderCallbackStore {
  hasProcessed(provider: string, callbackId: string, tenantId: string): Promise<boolean>;
  markProcessed(provider: string, callbackId: string, tenantId: string): Promise<void>;
}

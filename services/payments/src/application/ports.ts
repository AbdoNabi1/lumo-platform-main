export type { PaymentIntentRequest, PaymentProvider, ProviderIntent } from "@platform/contracts";

/** Reports a payment outcome to Orders — reference-only, Payments never creates/modifies an order. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface OrdersPort {
  reportPaymentOutcome(orderRef: string, status: string, tenantId: string): Promise<void>;
}

/** Records a payment event with Finance (ADR-0024) — reference-only, Payments never posts ledger entries itself. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface FinancePort {
  recordPaymentEvent(
    orderRef: string,
    amountMinor: number,
    currency: string,
    kind: string,
    tenantId: string,
  ): Promise<void>;
}

/** Sends a best-effort lifecycle notification — reference-only, never blocks a transition's own result. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface NotificationPort {
  notify(orderRef: string, status: string, tenantId: string): Promise<void>;
}

/** Replay-safe webhook dedup — unique per `(tenant, provider, event)`, backing `RecordWebhook`'s idempotency. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface ProcessedWebhookStore {
  hasProcessed(provider: string, eventId: string, tenantId: string): Promise<boolean>;
  markProcessed(provider: string, eventId: string, tenantId: string): Promise<void>;
}

export type { PaymentIntentRequest, PaymentProvider, ProviderIntent } from "@platform/contracts";

/** Reports a payment outcome to Orders — reference-only, Payments never creates/modifies an order. */
export interface OrdersPort {
  reportPaymentOutcome(orderRef: string, status: string): Promise<void>;
}

/** Records a payment event with Finance (ADR-0024) — reference-only, Payments never posts ledger entries itself. */
export interface FinancePort {
  recordPaymentEvent(
    orderRef: string,
    amountMinor: number,
    currency: string,
    kind: string,
  ): Promise<void>;
}

/** Sends a best-effort lifecycle notification — reference-only, never blocks a transition's own result. */
export interface NotificationPort {
  notify(orderRef: string, status: string): Promise<void>;
}

/** Replay-safe webhook dedup — unique per `(provider, event)`, backing `RecordWebhook`'s idempotency. */
export interface ProcessedWebhookStore {
  hasProcessed(provider: string, eventId: string): Promise<boolean>;
  markProcessed(provider: string, eventId: string): Promise<void>;
}

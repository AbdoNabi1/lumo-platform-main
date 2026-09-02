import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface PaymentWebhookReceivedData {
  readonly orderRef: string;
  readonly provider: string;
  readonly kind: string;
}

/** Raised when a PSP webhook is recorded (replay-safe: the application layer dedupes via `ProcessedWebhookStore` before this is ever raised twice for the same event). */
export class PaymentWebhookReceived extends DomainEvent {
  readonly eventName = "payment.webhook_received";
  readonly data: PaymentWebhookReceivedData;

  constructor(props: DomainEventProps, data: PaymentWebhookReceivedData) {
    super(props);
    this.data = data;
  }
}

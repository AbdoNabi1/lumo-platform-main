import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { PaymentCaptured } from "../domain/events/payment-captured.event";
import { PaymentFailed } from "../domain/events/payment-failed.event";
import { PaymentRefunded } from "../domain/events/payment-refunded.event";
import { PaymentTransitioned } from "../domain/events/payment-transitioned.event";
import { PaymentWebhookReceived } from "../domain/events/payment-webhook-received.event";
import { RefundTransitioned } from "../domain/events/refund-transitioned.event";

/** Maps Payments domain events to integration events. `PaymentTransitioned`/`RefundTransitioned` map dynamically to their canonical `payments.intent.<status>`/`payments.refund.<state>` types. */
export class PaymentEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof PaymentCaptured) {
      return {
        type: "payments.payment_intent.captured",
        eventVersion: 1,
        aggregateType: "payment_intent",
        payload: event.data,
      };
    }
    if (event instanceof PaymentFailed) {
      return {
        type: "payments.payment_intent.failed",
        eventVersion: 1,
        aggregateType: "payment_intent",
        payload: event.data,
      };
    }
    if (event instanceof PaymentRefunded) {
      return {
        type: "payments.payment_intent.refunded",
        eventVersion: 1,
        aggregateType: "payment_intent",
        payload: event.data,
      };
    }
    if (event instanceof PaymentTransitioned) {
      return {
        type: `payments.intent.${event.data.toStatus}`,
        eventVersion: 1,
        aggregateType: "payment_intent",
        payload: event.data,
      };
    }
    if (event instanceof RefundTransitioned) {
      return {
        type: `payments.refund.${event.data.state}`,
        eventVersion: 1,
        aggregateType: "payment_intent",
        payload: event.data,
      };
    }
    if (event instanceof PaymentWebhookReceived) {
      return {
        type: "payments.webhook.received",
        eventVersion: 1,
        aggregateType: "payment_intent",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Payments context (validated fail-closed by `paymentsModule()`), 18 types: legacy 3 + 11 intent statuses + 3 refund states + 1 webhook. */
export const PAYMENTS_PUBLISHED_EVENTS: readonly string[] = [
  "payments.payment_intent.captured",
  "payments.payment_intent.failed",
  "payments.payment_intent.refunded",
  "payments.intent.created",
  "payments.intent.processing",
  "payments.intent.authorized",
  "payments.intent.capture_requested",
  "payments.intent.captured",
  "payments.intent.failed",
  "payments.intent.cancelled",
  "payments.intent.expired",
  "payments.intent.partially_refunded",
  "payments.intent.refunded",
  "payments.intent.closed",
  "payments.refund.requested",
  "payments.refund.completed",
  "payments.refund.failed",
  "payments.webhook.received",
];

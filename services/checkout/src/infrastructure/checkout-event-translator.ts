import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { CheckoutCompleted } from "../domain/events/checkout-completed.event";
import { CheckoutExpired } from "../domain/events/checkout-expired.event";
import { CheckoutFailed } from "../domain/events/checkout-failed.event";
import { CheckoutLocked } from "../domain/events/checkout-locked.event";
import { CheckoutRecalculated } from "../domain/events/checkout-recalculated.event";

/** Maps Checkout domain events to integration events (`CHECKOUT_PUBLISHED_EVENTS`, 5 types). */
export class CheckoutEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof CheckoutCompleted) {
      return {
        type: "checkout.checkout_session.completed",
        eventVersion: 1,
        aggregateType: "checkout_session",
        payload: event.data,
      };
    }
    if (event instanceof CheckoutFailed) {
      return {
        type: "checkout.checkout_session.failed",
        eventVersion: 1,
        aggregateType: "checkout_session",
        payload: event.data,
      };
    }
    if (event instanceof CheckoutRecalculated) {
      return {
        type: "checkout.checkout_session.recalculated",
        eventVersion: 1,
        aggregateType: "checkout_session",
        payload: event.data,
      };
    }
    if (event instanceof CheckoutLocked) {
      return {
        type: "checkout.checkout_session.locked",
        eventVersion: 1,
        aggregateType: "checkout_session",
        payload: event.data,
      };
    }
    if (event instanceof CheckoutExpired) {
      return {
        type: "checkout.checkout_session.expired",
        eventVersion: 1,
        aggregateType: "checkout_session",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Checkout context (validated fail-closed by `checkoutModule()`). */
export const CHECKOUT_PUBLISHED_EVENTS: readonly string[] = [
  "checkout.checkout_session.completed",
  "checkout.checkout_session.failed",
  "checkout.checkout_session.recalculated",
  "checkout.checkout_session.locked",
  "checkout.checkout_session.expired",
];

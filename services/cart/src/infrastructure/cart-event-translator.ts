import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { CartAbandoned } from "../domain/events/cart-abandoned.event";
import { CartCheckedOut } from "../domain/events/cart-checked-out.event";
import { CartExpired } from "../domain/events/cart-expired.event";
import { CartLocked } from "../domain/events/cart-locked.event";
import { CartMerged } from "../domain/events/cart-merged.event";
import { CartSaved } from "../domain/events/cart-saved.event";

/** Maps Cart domain events to integration events (`CART_PUBLISHED_EVENTS`, 6 types). */
export class CartEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof CartCheckedOut) {
      return {
        type: "cart.cart.checked_out",
        eventVersion: 1,
        aggregateType: "cart",
        payload: event.data,
      };
    }
    if (event instanceof CartAbandoned) {
      return {
        type: "cart.cart.abandoned",
        eventVersion: 1,
        aggregateType: "cart",
        payload: event.data,
      };
    }
    if (event instanceof CartMerged) {
      return {
        type: "cart.cart.merged",
        eventVersion: 1,
        aggregateType: "cart",
        payload: event.data,
      };
    }
    if (event instanceof CartLocked) {
      return {
        type: "cart.cart.locked",
        eventVersion: 1,
        aggregateType: "cart",
        payload: event.data,
      };
    }
    if (event instanceof CartSaved) {
      return {
        type: "cart.cart.saved",
        eventVersion: 1,
        aggregateType: "cart",
        payload: event.data,
      };
    }
    if (event instanceof CartExpired) {
      return {
        type: "cart.cart.expired",
        eventVersion: 1,
        aggregateType: "cart",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Cart context (validated fail-closed by `cartModule()`). */
export const CART_PUBLISHED_EVENTS: readonly string[] = [
  "cart.cart.checked_out",
  "cart.cart.abandoned",
  "cart.cart.merged",
  "cart.cart.locked",
  "cart.cart.saved",
  "cart.cart.expired",
];

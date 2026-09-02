import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { PriceChanged } from "../domain/events/price-changed.event";
import { PricePublished } from "../domain/events/price-published.event";
import { PricingRuleCreated } from "../domain/events/pricing-rule-created.event";
import { TaxClassCreated } from "../domain/events/tax-class-created.event";

/** Maps Pricing domain events to integration events (`PRICING_PUBLISHED_EVENTS`, 4 types). */
export class PricingEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof PriceChanged) {
      return {
        type: "pricing.price.changed",
        eventVersion: 1,
        aggregateType: "price",
        payload: event.data,
      };
    }
    if (event instanceof PricePublished) {
      return {
        type: "pricing.price.published",
        eventVersion: 1,
        aggregateType: "price",
        payload: event.data,
      };
    }
    if (event instanceof TaxClassCreated) {
      return {
        type: "pricing.tax_class.created",
        eventVersion: 1,
        aggregateType: "tax_class",
        payload: event.data,
      };
    }
    if (event instanceof PricingRuleCreated) {
      return {
        type: "pricing.pricing_rule.created",
        eventVersion: 1,
        aggregateType: "pricing_rule",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Pricing context (validated fail-closed by `pricingModule()`). */
export const PRICING_PUBLISHED_EVENTS: readonly string[] = [
  "pricing.price.changed",
  "pricing.price.published",
  "pricing.tax_class.created",
  "pricing.pricing_rule.created",
];

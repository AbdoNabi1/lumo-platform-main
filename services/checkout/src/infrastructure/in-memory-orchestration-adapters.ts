import type { CheckoutItem } from "../domain/value-objects/checkout-item";
import type {
  InventoryValidationPort,
  InventoryValidationResult,
  PricingValidationPort,
  PricingValidationResult,
  PromotionValidationPort,
  PromotionValidationResult,
  ShippingCalculationPort,
  ShippingQuote,
  TaxCalculationPort,
  TaxCalculationResult,
} from "../application/ports";

/**
 * Offline in-memory stub adapters for the 5 orchestration ports (ADR-0012 §5). Production swaps
 * these for the Pricing/Inventory/Finance/Shipping/Promotions adapters (or the saga's own
 * activities) at the composition root — unchanged interface, no domain/application impact.
 */
export class InMemoryPricingValidationAdapter implements PricingValidationPort {
  async validate(items: readonly CheckoutItem[]): Promise<PricingValidationResult> {
    return { valid: items.every((item) => item.unitPriceAmountMinor >= 0) };
  }
}

export class InMemoryInventoryValidationAdapter implements InventoryValidationPort {
  async validate(items: readonly CheckoutItem[]): Promise<InventoryValidationResult> {
    return { valid: items.every((item) => item.quantity > 0) };
  }
}

export class InMemoryTaxCalculationAdapter implements TaxCalculationPort {
  async calculate(items: readonly CheckoutItem[]): Promise<TaxCalculationResult> {
    const subtotalMinor = items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
    return { taxMinor: Math.round(subtotalMinor * 0.1) };
  }
}

export class InMemoryShippingCalculationAdapter implements ShippingCalculationPort {
  async quote(): Promise<readonly ShippingQuote[]> {
    return [
      { method: "standard", rateAmountMinor: 500 },
      { method: "express", rateAmountMinor: 1500 },
    ];
  }
}

export class InMemoryPromotionValidationAdapter implements PromotionValidationPort {
  // Offline stub — never consults Promotions, so it cannot tell whether `promotionRef` matches a
  // real, active promotion. Keeps its original flat behavior (always valid, zero discount)
  // unconditionally; none of `items`/`customerRef`/`promotionRef`/`currency` affect the outcome,
  // so (as `InMemoryShippingCalculationAdapter.quote()` above already does for its own port) they
  // are dropped from the signature rather than declared and left unused.
  async validate(): Promise<PromotionValidationResult> {
    return { valid: true, discountMinor: 0 };
  }
}

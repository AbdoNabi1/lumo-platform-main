import type { CheckoutItem } from "../domain/value-objects/checkout-item";
import type { DiscountSnapshot } from "../domain/value-objects/discount-snapshot";
import type {
  DiscountEvaluationInput,
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

/**
 * Offline stub (tests and local runs only): no tax is collected — the real adapter reads the shop's
 * tax settings, and with no region configured that is zero too. Local runs no longer add a flat 10%.
 */
export class InMemoryTaxCalculationAdapter implements TaxCalculationPort {
  async calculate(): Promise<TaxCalculationResult> {
    return { taxMinor: 0, included: true };
  }
}

export class InMemoryShippingCalculationAdapter implements ShippingCalculationPort {
  async quote(): Promise<readonly ShippingQuote[]> {
    return [
      { method: "standard", name: "Standard", rateAmountMinor: 500 },
      { method: "express", name: "Express", rateAmountMinor: 1500 },
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

  /** Offline stub: knows no codes and no automatic discounts. */
  async evaluate(input: DiscountEvaluationInput): Promise<DiscountSnapshot> {
    return {
      applied: [],
      orderDiscountMinor: 0,
      shippingDiscountMinor: 0,
      codeStatuses: input.codes.map((code) => ({ code, applicable: false, reason: "not_found" })),
      lineAllocations: [],
    };
  }
}

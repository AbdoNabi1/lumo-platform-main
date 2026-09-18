import type {
  CheckoutItem,
  PricingValidationPort,
  PricingValidationResult,
} from "@platform/checkout";
import type { PriceRepository } from "@platform/pricing";

/**
 * Real `PricingValidationPort` over Pricing's own published-price data (Phase 3 Task 9, closes
 * H-1) — `ValidateCheckout` calls this instead of the offline `InMemoryPricingValidationAdapter`
 * stub (`services/checkout/src/infrastructure/in-memory-orchestration-adapters.ts`), which only
 * checked `unitPriceAmountMinor >= 0` and never consulted Pricing at all.
 *
 * Reads `PriceRepository.findPublishedByProduct` (added by this task) directly rather than going
 * through `PriceController.list()` + in-memory filtering — the `first: 100`-then-filter approach
 * `apps/admin/src/http/pricing-resolution.ts` already accepts as a disclosed limitation there, and
 * this adapter is explicitly told not to copy. `findPublishedByProduct` is backed by the
 * `@@index([tenantId, productRef])` index (`packages/db/prisma/schema/pricing.prisma:38`), so cost
 * scales with the number of rows for one product, not the size of the whole price catalog.
 *
 * Ambiguity semantics mirror `PriceBook.resolve()`/`resolvePrice()` (Pricing has no invariant
 * preventing more than one concurrently-published price for the same product+currency): zero
 * matches or a mismatched amount ⇒ invalid; more than one match ⇒ invalid, never guessed at;
 * exactly one match whose amount equals the item's snapshot ⇒ that item is valid.
 */
export class PricingValidationAdapter implements PricingValidationPort {
  private readonly prices: PriceRepository;
  private readonly tenantId: string | undefined;

  /**
   * ADR-0014 (WP-10, T10.3): `PriceRepository.findPublishedByProduct` now takes `tenantId` per
   * call, but checkout's own `PricingValidationPort.validate(items, currency)` does not carry
   * one yet — widening it is checkout-context work. Until checkout converts, this adapter captures
   * the tenant at construction (same not-yet-converted pattern as `PromotionValidationAdapter`).
   * `tenantId` stays optional only because `AdminWiringDeps.tenantId` is; `validate` fails
   * closed if it is missing, never defaulting a tenant.
   */
  constructor(prices: PriceRepository, tenantId?: string) {
    this.prices = prices;
    this.tenantId = tenantId;
  }

  async validate(
    items: readonly CheckoutItem[],
    currency: string,
  ): Promise<PricingValidationResult> {
    const tenantId = this.tenantId;
    if (tenantId === undefined) {
      return { valid: false, reason: "cannot validate pricing without a tenant" };
    }
    for (const item of items) {
      const matches = await this.prices.findPublishedByProduct(item.productRef, currency, tenantId);
      if (matches.length === 0) {
        return {
          valid: false,
          reason: `no published price found for product "${item.productRef}" in ${currency}`,
        };
      }
      if (matches.length > 1) {
        return {
          valid: false,
          reason:
            `ambiguous published price for product "${item.productRef}" in ${currency} ` +
            `(${matches.length} published rows)`,
        };
      }
      const [price] = matches;
      if (price === undefined || price.amount.amountMinor !== item.unitPriceAmountMinor) {
        return {
          valid: false,
          reason: `stale price snapshot for product "${item.productRef}" — the published price has changed`,
        };
      }
    }
    return { valid: true };
  }
}

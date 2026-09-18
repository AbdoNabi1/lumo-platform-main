import type {
  CheckoutItem,
  PromotionValidationPort,
  PromotionValidationResult,
} from "@platform/checkout";
import type { Product, ProductController } from "@platform/catalog";
import type {
  CartSnapshot,
  CartSnapshotLine,
  PromotionDetermination,
  PromotionsController,
} from "@platform/promotions";

/**
 * Real `PromotionValidationPort` over Promotions' own `EvaluatePromotions` use case (Phase 3
 * Task 11, C-3) — `ValidatePromotion` calls this instead of the offline
 * `InMemoryPromotionValidationAdapter` stub
 * (`services/checkout/src/infrastructure/in-memory-orchestration-adapters.ts`), which never
 * consulted Promotions and always returned a flat `{ valid: true, discountMinor: 0 }` regardless
 * of `promotionRef`.
 *
 * `EvaluatePromotions` needs a `CartSnapshot` (product/category refs, quantities, subtotal) to
 * evaluate promotion rules against — `PromotionCondition.matches()`
 * (`services/promotions/src/domain/value-objects/promotion-rule.ts`) checks
 * `minimumSubtotalAmountMinor`/`minimumQuantity`/category-or-product scope against real cart
 * data, so `PromotionValidationPort` was widened (see its own doc comment in
 * `services/checkout/src/application/ports.ts`) from `validate(promotionRef, currency)` to carry
 * `items`/`customerRef` instead — there is no cart-independent way to answer "is this promotion
 * valid and what's the discount." `currency` is accepted (interface shape) but unused here, the
 * same way `InMemoryShippingCalculationAdapter.quote()` drops params its own logic doesn't need.
 *
 * `CheckoutItem` carries a `productRef` but not `categoryRefs` — this adapter resolves each
 * item's categories via Catalog's `ProductController.get`, one lookup per item, the same
 * "resolve what the snapshot doesn't carry" shape as `InventoryValidationAdapter`'s warehouse
 * lookup. `subtotalAmountMinor` is `Σ quantity * unitPriceAmountMinor` — arithmetic on
 * already-known values, not new business logic, same as `OrderItem.lineTotal` elsewhere.
 *
 * `promotionRef` IS a promotion id, not a customer-facing code needing translation —
 * `PromotionRepository` has no `findByCode`-style lookup (only `findById`/`findActive`), and
 * Coupons already treats a bare `promotionRef` as stored directly on a Coupon, consistent with
 * that.
 *
 * Result mapping: no `promotionRef` ⇒ vacuously valid, zero discount, no round-trip to
 * Promotions at all (mirrors `InventoryValidationAdapter`'s "empty items" shortcut). A
 * `promotionRef` absent from `EvaluatePromotions`' `determinations` (not active, not eligible for
 * this cart, or simply nonexistent — `EvaluatePromotions` doesn't distinguish these, it just
 * omits non-matching promotions) ⇒ `{ valid: false, reason }` naming the ref, never thrown (same
 * "false is an ordinary outcome" reasoning as `InventoryValidationAdapter`'s doc comment). A
 * `promotionRef` present in `determinations` ⇒ valid, with that determination's own computed
 * `discountAmountMinor`.
 */
export class PromotionValidationAdapter implements PromotionValidationPort {
  private readonly products: Pick<ProductController, "get">;
  private readonly promotions: Pick<PromotionsController, "evaluate">;
  private readonly tenantId: string | undefined;

  /**
   * ADR-0014: `ProductController.get` now requires `tenantId` per call (catalog's `GetProduct`
   * use case, converted under WP-10/T10.3's first-context slice) — this adapter captures it at
   * construction, the same not-yet-converted pattern `checkout`'s own `PromotionValidationPort`
   * still uses everywhere else, rather than widening that port's `validate(items, customerRef,
   * promotionRef)` signature, which is checkout-context work, not catalog's, and out of scope for
   * this first-context slice. `tenantId` stays optional here only because `AdminWiringDeps.
   * tenantId` is optional (in-memory/test composition omits it); `validate` fails closed if it is
   * actually missing when a promotion lookup is attempted, per this WP's "never default a missing
   * tenant" rule.
   */
  constructor(
    products: Pick<ProductController, "get">,
    promotions: Pick<PromotionsController, "evaluate">,
    tenantId?: string,
  ) {
    this.products = products;
    this.promotions = promotions;
    this.tenantId = tenantId;
  }

  async validate(
    items: readonly CheckoutItem[],
    customerRef: string | undefined,
    promotionRef: string | undefined,
  ): Promise<PromotionValidationResult> {
    if (promotionRef === undefined) {
      return { valid: true, discountMinor: 0 };
    }
    if (this.tenantId === undefined) {
      throw new Error(
        "PromotionValidationAdapter.validate: tenantId is required (ADR-0014) but this adapter " +
          "was constructed without one — never default to a placeholder tenant.",
      );
    }
    const tenantId = this.tenantId;

    const lines: CartSnapshotLine[] = [];
    for (const item of items) {
      const response = await this.products.get({ productId: item.productRef, tenantId });
      if (response.status !== 200) {
        return {
          valid: false,
          discountMinor: 0,
          reason: `cannot resolve product "${item.productRef}" to evaluate promotion "${promotionRef}"`,
        };
      }
      const product = response.body as Product;
      lines.push({
        productRef: item.productRef,
        categoryRefs: product.categories.map((category) => category.categoryId),
        quantity: item.quantity,
        unitPriceAmountMinor: item.unitPriceAmountMinor,
      });
    }
    const subtotalAmountMinor = items.reduce(
      (sum, item) => sum + item.quantity * item.unitPriceAmountMinor,
      0,
    );
    const cart: CartSnapshot = { lines, subtotalAmountMinor };

    const response = await this.promotions.evaluate({
      cart,
      customerRef: customerRef ?? "",
      tenantId,
    });
    if (response.status !== 200) {
      return {
        valid: false,
        discountMinor: 0,
        reason: `promotion evaluation failed while validating "${promotionRef}"`,
      };
    }
    const { determinations } = response.body as {
      readonly determinations: readonly PromotionDetermination[];
    };
    const determination = determinations.find((d) => d.promotionId === promotionRef);
    if (determination === undefined) {
      return {
        valid: false,
        discountMinor: 0,
        reason: `promotion "${promotionRef}" is not active or not eligible for this cart`,
      };
    }
    return { valid: true, discountMinor: determination.discountAmountMinor };
  }
}

import type { Clock } from "@platform/contracts";
import type {
  CheckoutItem,
  DiscountEvaluationInput,
  DiscountSnapshot,
  PromotionValidationPort,
  PromotionValidationResult,
} from "@platform/checkout";
import type { Product, ProductController } from "@platform/catalog";
import type { Coupon, CouponsController } from "@platform/coupons";
import {
  calculateDiscounts,
  MAX_DISCOUNT_CODES,
  normalizeDiscountCode,
  type CartSnapshot,
  type CartSnapshotLine,
  type CouponState,
  type DiscountCandidate,
  type DiscountLine,
  type Promotion,
  type PromotionDetermination,
  type PromotionsController,
} from "@platform/promotions";

/** What the calculator needs from a coupon — plain data, so Promotions never imports Coupons. */
function toCouponState(coupon: Coupon): CouponState {
  return {
    couponId: coupon.id.toString(),
    code: coupon.code.value,
    status: coupon.status.value,
    ...(coupon.usageLimit === undefined ? {} : { usageLimit: coupon.usageLimit }),
    usageCount: coupon.usageCount,
    oncePerCustomer: !coupon.multiUse,
    ...(coupon.customerRef === undefined ? {} : { assignedCustomerRef: coupon.customerRef }),
    ...(coupon.expiresAt === undefined ? {} : { expiresAt: coupon.expiresAt }),
    redemptions: coupon.redemptions.map((r) => ({
      customerRef: r.customerRef,
      ...(r.email === undefined ? {} : { email: r.email }),
    })),
  };
}

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
  private readonly promotions: Pick<
    PromotionsController,
    "evaluate" | "get" | "listActiveAutomatic"
  >;
  private readonly coupons: Pick<CouponsController, "getByCode">;
  private readonly clock: Clock;

  /** ADR-0014 (WP-10, T10.3): stateless per tenant — `PromotionValidationPort.validate` carries `tenantId` per call. */
  constructor(
    products: Pick<ProductController, "get">,
    promotions: Pick<PromotionsController, "evaluate" | "get" | "listActiveAutomatic">,
    coupons: Pick<CouponsController, "getByCode">,
    clock: Clock,
  ) {
    this.products = products;
    this.promotions = promotions;
    this.coupons = coupons;
    this.clock = clock;
  }

  /**
   * Phase 2: every discount for a checkout. Lines are numbered by position (`"0"`, `"1"`, …) and
   * carry their Catalog categories; each entered code is resolved to its coupon and promotion;
   * active automatic promotions are added; `calculateDiscounts` decides. A product Catalog cannot
   * resolve is evaluated without categories rather than failing the checkout.
   */
  async evaluate(input: DiscountEvaluationInput): Promise<DiscountSnapshot> {
    const lines: DiscountLine[] = [];
    for (const [index, item] of input.items.entries()) {
      lines.push({
        lineRef: String(index),
        productRef: item.productRef,
        categoryRefs: await this.categoriesOf(item, input.tenantId),
        quantity: item.quantity,
        unitPriceMinor: item.unitPriceAmountMinor,
      });
    }

    const candidates: DiscountCandidate[] = [];
    const codes = [...new Set(input.codes.map(normalizeDiscountCode))].slice(0, MAX_DISCOUNT_CODES);
    for (const code of codes) {
      const couponResponse = await this.coupons.getByCode({ tenantId: input.tenantId, code });
      if (couponResponse.status !== 200) continue;
      const coupon = couponResponse.body as Coupon;
      const promotionResponse = await this.promotions.get({
        tenantId: input.tenantId,
        promotionId: coupon.promotionRef,
      });
      if (promotionResponse.status !== 200) continue;
      candidates.push({
        promotion: promotionResponse.body as Promotion,
        coupon: toCouponState(coupon),
      });
    }
    const automatic = await this.promotions.listActiveAutomatic({ tenantId: input.tenantId });
    if (automatic.status === 200) {
      for (const promotion of (automatic.body as { readonly items: readonly Promotion[] }).items) {
        candidates.push({ promotion });
      }
    }

    return calculateDiscounts({
      lines,
      shipping: input.shipping,
      customer: {
        ...(input.customerRef === undefined ? {} : { customerRef: input.customerRef }),
        ...(input.email === undefined ? {} : { email: input.email }),
      },
      enteredCodes: input.codes,
      candidates,
      now: this.clock.now(),
    });
  }

  private async categoriesOf(item: CheckoutItem, tenantId: string): Promise<readonly string[]> {
    const response = await this.products.get({ productId: item.productRef, tenantId });
    if (response.status !== 200) return [];
    return (response.body as Product).categories.map((category) => category.categoryId);
  }

  async validate(
    items: readonly CheckoutItem[],
    customerRef: string | undefined,
    promotionRef: string | undefined,
    _currency: string,
    tenantId: string,
  ): Promise<PromotionValidationResult> {
    if (promotionRef === undefined) {
      return { valid: true, discountMinor: 0 };
    }

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

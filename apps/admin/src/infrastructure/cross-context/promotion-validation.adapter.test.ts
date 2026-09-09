import { describe, expect, it } from "vitest";
import { CheckoutItem, type PromotionValidationPort } from "@platform/checkout";
import type { Product, ProductController } from "@platform/catalog";
import type {
  CartSnapshot,
  PromotionDetermination,
  PromotionsController,
} from "@platform/promotions";
import { PromotionValidationAdapter } from "./promotion-validation.adapter";

function must<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(`invalid fixture: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function checkoutItem(
  productRef: string,
  quantity: number,
  unitPriceAmountMinor: number,
  currency: string,
): CheckoutItem {
  return must(CheckoutItem.create(productRef, quantity, unitPriceAmountMinor, currency));
}

/**
 * A minimal `Product`-shaped fixture — only `.categories` is read by `PromotionValidationAdapter`,
 * so the fixture carries just that (same minimal-cast convention as
 * `inventory-validation.adapter.test.ts`'s `warehouseFixture`).
 */
function productFixture(categoryIds: readonly string[]): Product {
  return { categories: categoryIds.map((categoryId) => ({ categoryId })) } as unknown as Product;
}

/**
 * A fake owning controller (Common Structure step 3) for `ProductController`, narrowed to `get`
 * — the only method this adapter calls. A product absent from the map simulates a 404 (mirrors
 * `GetProduct`'s real `NotFoundError` behavior via `present()`).
 */
function fakeProductController(
  categoriesByProduct: Readonly<Record<string, readonly string[]>>,
): Pick<ProductController, "get"> {
  return {
    async get(input) {
      const categoryIds = categoriesByProduct[input.productId];
      if (categoryIds === undefined) {
        return { status: 404, body: { code: "NOT_FOUND", message: "Product not found" } };
      }
      return { status: 200, body: productFixture(categoryIds) };
    },
  };
}

/**
 * A fake owning controller for `PromotionsController`, narrowed to `evaluate` — the only method
 * this adapter calls. `onEvaluate` lets a test capture the `CartSnapshot` actually sent, to
 * confirm categories/subtotal are threaded through rather than stubbed.
 */
function fakePromotionsController(
  determinations: readonly PromotionDetermination[],
  onEvaluate?: (cart: CartSnapshot, customerRef: string) => void,
): Pick<PromotionsController, "evaluate"> {
  return {
    async evaluate(input) {
      onEvaluate?.(input.cart, input.customerRef);
      return { status: 200, body: { determinations } };
    },
  };
}

/** Throws if `evaluate` is ever called — proves the "no promotionRef" path skips Promotions entirely. */
function throwingPromotionsController(): Pick<PromotionsController, "evaluate"> {
  return {
    evaluate(): never {
      throw new Error("evaluate() must not be called when promotionRef is undefined");
    },
  };
}

describe("PromotionValidationAdapter (Checkout -> Promotions, C-3)", () => {
  it("no promotionRef given: vacuously valid, zero discount, no round-trip to Promotions", async () => {
    const products = fakeProductController({ "product-1": ["cat-shoes"] });
    const promotions = throwingPromotionsController();
    // Typed as the port, not the concrete class — exercised the same way `ValidatePromotion`
    // (the real caller) sees it, with all 4 positional args the interface declares.
    const adapter: PromotionValidationPort = new PromotionValidationAdapter(
      products,
      promotions,
      "tenant-1",
    );

    const result = await adapter.validate(
      [checkoutItem("product-1", 2, 1999, "USD")],
      "customer-1",
      undefined,
      "USD",
    );

    expect(result).toEqual({ valid: true, discountMinor: 0 });
  });

  it("promotionRef given and matches an active/eligible determination: valid, correct discount", async () => {
    const products = fakeProductController({ "product-1": ["cat-shoes"] });
    const promotions = fakePromotionsController([
      { promotionId: "promo-1", discountAmountMinor: 500, stackable: false, priority: 0 },
      { promotionId: "promo-2", discountAmountMinor: 200, stackable: true, priority: 1 },
    ]);
    // Typed as the port, not the concrete class — exercised the same way `ValidatePromotion`
    // (the real caller) sees it, with all 4 positional args the interface declares.
    const adapter: PromotionValidationPort = new PromotionValidationAdapter(
      products,
      promotions,
      "tenant-1",
    );

    const result = await adapter.validate(
      [checkoutItem("product-1", 2, 1999, "USD")],
      "customer-1",
      "promo-1",
      "USD",
    );

    expect(result).toEqual({ valid: true, discountMinor: 500 });
  });

  it("promotionRef given but no matching determination: invalid, names the ref", async () => {
    const products = fakeProductController({ "product-1": ["cat-shoes"] });
    const promotions = fakePromotionsController([
      { promotionId: "promo-other", discountAmountMinor: 500, stackable: false, priority: 0 },
    ]);
    // Typed as the port, not the concrete class — exercised the same way `ValidatePromotion`
    // (the real caller) sees it, with all 4 positional args the interface declares.
    const adapter: PromotionValidationPort = new PromotionValidationAdapter(
      products,
      promotions,
      "tenant-1",
    );

    const result = await adapter.validate(
      [checkoutItem("product-1", 2, 1999, "USD")],
      "customer-1",
      "promo-missing",
      "USD",
    );

    expect(result.valid).toBe(false);
    expect(result.discountMinor).toBe(0);
    expect(result.reason).toContain("promo-missing");
  });

  it("multi-item cart with mixed categories: resolves and threads real categoryRefs + subtotal through", async () => {
    const products = fakeProductController({
      "product-shoe": ["cat-shoes", "cat-sale"],
      "product-hat": ["cat-hats"],
    });
    let capturedCart: CartSnapshot | undefined;
    let capturedCustomerRef: string | undefined;
    const promotions = fakePromotionsController(
      [{ promotionId: "promo-1", discountAmountMinor: 300, stackable: false, priority: 0 }],
      (cart, customerRef) => {
        capturedCart = cart;
        capturedCustomerRef = customerRef;
      },
    );
    // Typed as the port, not the concrete class — exercised the same way `ValidatePromotion`
    // (the real caller) sees it, with all 4 positional args the interface declares.
    const adapter: PromotionValidationPort = new PromotionValidationAdapter(
      products,
      promotions,
      "tenant-1",
    );

    const result = await adapter.validate(
      [checkoutItem("product-shoe", 2, 1000, "USD"), checkoutItem("product-hat", 3, 500, "USD")],
      "customer-1",
      "promo-1",
      "USD",
    );

    expect(result).toEqual({ valid: true, discountMinor: 300 });
    expect(capturedCustomerRef).toBe("customer-1");
    expect(capturedCart).toEqual({
      lines: [
        {
          productRef: "product-shoe",
          categoryRefs: ["cat-shoes", "cat-sale"],
          quantity: 2,
          unitPriceAmountMinor: 1000,
        },
        {
          productRef: "product-hat",
          categoryRefs: ["cat-hats"],
          quantity: 3,
          unitPriceAmountMinor: 500,
        },
      ],
      // 2*1000 + 3*500 = 3500
      subtotalAmountMinor: 3500,
    });
  });

  it("guest checkout: undefined customerRef is sent to Promotions as an empty string", async () => {
    const products = fakeProductController({ "product-1": ["cat-shoes"] });
    let capturedCustomerRef: string | undefined;
    const promotions = fakePromotionsController(
      [{ promotionId: "promo-1", discountAmountMinor: 100, stackable: false, priority: 0 }],
      (_cart, customerRef) => {
        capturedCustomerRef = customerRef;
      },
    );
    // Typed as the port, not the concrete class — exercised the same way `ValidatePromotion`
    // (the real caller) sees it, with all 4 positional args the interface declares.
    const adapter: PromotionValidationPort = new PromotionValidationAdapter(
      products,
      promotions,
      "tenant-1",
    );

    await adapter.validate(
      [checkoutItem("product-1", 1, 1000, "USD")],
      undefined,
      "promo-1",
      "USD",
    );

    expect(capturedCustomerRef).toBe("");
  });

  it("invalid: promotionRef given but a cart product cannot be resolved from Catalog", async () => {
    const products = fakeProductController({});
    const promotions = throwingPromotionsController();
    // Typed as the port, not the concrete class — exercised the same way `ValidatePromotion`
    // (the real caller) sees it, with all 4 positional args the interface declares.
    const adapter: PromotionValidationPort = new PromotionValidationAdapter(
      products,
      promotions,
      "tenant-1",
    );

    const result = await adapter.validate(
      [checkoutItem("product-missing", 1, 1000, "USD")],
      "customer-1",
      "promo-1",
      "USD",
    );

    expect(result.valid).toBe(false);
    expect(result.discountMinor).toBe(0);
    expect(result.reason).toContain("product-missing");
  });
});

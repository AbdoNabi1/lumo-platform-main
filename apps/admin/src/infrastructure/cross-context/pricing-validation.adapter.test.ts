import { describe, expect, it } from "vitest";
import { CheckoutItem } from "@platform/checkout";
import type { Price, PriceRepository } from "@platform/pricing";
import type { CursorPage, Paginated } from "@platform/types";
import { PricingValidationAdapter } from "./pricing-validation.adapter";

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
 * A minimal `Price`-shaped fixture — only `product.value`/`amount.{amountMinor,currency}` are
 * read by `PricingValidationAdapter`, so the fixture carries just those (no `@platform/domain`
 * dependency in this app's tests otherwise, and none of the aggregate's other invariants matter
 * here). Cast at the single boundary where `FakePriceRepository` hands it back as a `Price`.
 */
function publishedPriceFixture(productRef: string, amountMinor: number, currency: string): Price {
  return {
    product: { value: productRef },
    amount: { amountMinor, currency },
  } as unknown as Price;
}

/** A fake `PriceRepository` (Common Structure step 3) — only `findPublishedByProduct` is exercised by this adapter; every other method is unused and throws if ever called. */
class FakePriceRepository implements PriceRepository {
  constructor(private readonly published: readonly Price[]) {}

  async findPublishedByProduct(productRef: string, currency: string): Promise<readonly Price[]> {
    return this.published.filter(
      (price) => price.product.value === productRef && price.amount.currency === currency,
    );
  }

  save(): Promise<void> {
    throw new Error("not used by PricingValidationAdapter");
  }
  findById(): Promise<Price | null> {
    throw new Error("not used by PricingValidationAdapter");
  }
  delete(): Promise<void> {
    throw new Error("not used by PricingValidationAdapter");
  }
  list(_page: CursorPage): Promise<Paginated<Price>> {
    throw new Error("not used by PricingValidationAdapter");
  }
}

describe("PricingValidationAdapter (Checkout -> Pricing, H-1)", () => {
  it("valid: every item's snapshot price matches the single published price for its product+currency", async () => {
    const repo = new FakePriceRepository([publishedPriceFixture("product-1", 1999, "USD")]);
    const adapter = new PricingValidationAdapter(repo);

    const result = await adapter.validate([checkoutItem("product-1", 2, 1999, "USD")], "USD");

    expect(result).toEqual({ valid: true });
  });

  it("invalid: no published price exists for the product+currency", async () => {
    const repo = new FakePriceRepository([]);
    const adapter = new PricingValidationAdapter(repo);

    const result = await adapter.validate([checkoutItem("product-missing", 1, 1999, "USD")], "USD");

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("product-missing");
  });

  it("invalid: the item's snapshot price is stale (published price has since changed)", async () => {
    const repo = new FakePriceRepository([publishedPriceFixture("product-1", 2500, "USD")]);
    const adapter = new PricingValidationAdapter(repo);

    // Caller's snapshot still carries the old 1999 price — must never be trusted over Pricing's own data.
    const result = await adapter.validate([checkoutItem("product-1", 1, 1999, "USD")], "USD");

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("product-1");
  });

  it("invalid: more than one published price exists for the same product+currency (never guessed at)", async () => {
    const repo = new FakePriceRepository([
      publishedPriceFixture("product-ambiguous", 500, "USD"),
      publishedPriceFixture("product-ambiguous", 700, "USD"),
    ]);
    const adapter = new PricingValidationAdapter(repo);

    const result = await adapter.validate(
      [checkoutItem("product-ambiguous", 1, 500, "USD")],
      "USD",
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("product-ambiguous");
  });

  it("checks every item, not just the first", async () => {
    const repo = new FakePriceRepository([
      publishedPriceFixture("product-1", 1000, "USD"),
      publishedPriceFixture("product-2", 2000, "USD"),
    ]);
    const adapter = new PricingValidationAdapter(repo);

    const result = await adapter.validate(
      [checkoutItem("product-1", 1, 1000, "USD"), checkoutItem("product-2", 1, 9999, "USD")],
      "USD",
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("product-2");
  });

  it("empty items: vacuously valid — nothing to price-check", async () => {
    const repo = new FakePriceRepository([]);
    const adapter = new PricingValidationAdapter(repo);

    const result = await adapter.validate([], "USD");

    expect(result).toEqual({ valid: true });
  });
});

# Discounts Engine and Checkout (Part 1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ملخص للمالك (بالعربي):** الجزء ده هو "المحرّك": بعده الخصم بيشتغل فعلاً من الـ API — الكود
> بيتلاقى، التلقائي بيتطبّق، الحساب مضبوط للأنواع الأربعة، الطلب بيتسجّل فيه الخصم، والاستخدام بيتعدّ.
> مفيش شاشات هنا (صفحة الأدمن = الجزء 2، خانة الكود في المتجر = الجزء 3). فيه ملفين migration
> (إضافة أعمدة بس، مفيش مسح ولا تعديل بيانات) هتشغّلهم إنت قبل النشر زي كل مرة.

**Goal:** Make Shopify-style discounts (amount off products, amount off order, buy X get Y, free shipping; by code or automatic) actually apply at checkout, get recorded on the order, count their usage, and be manageable through one admin `/discounts` API.

**Architecture:** A discount is a `Promotion` (services/promotions) — extended with a method, combination settings and the full reward shapes — and a discount code is a `Coupon` (services/coupons) pointing at it. A new pure `calculateDiscounts()` in the Promotions domain decides eligibility, amounts, the best combination and per-line allocation. Checkout keeps the codes and a discount snapshot on the session, refreshes it on every recalculation through the widened `PromotionValidationPort`, re-checks it before placing the order, and reports usage through a new `DiscountUsagePort`. apps/admin wires the cross-context adapters, two public code routes, and a `/discounts` facade over promotions + coupons.

**Tech Stack:** TypeScript (ESM), pnpm workspaces, Vitest, Prisma 6 (PostgreSQL, hand-written migrations), zod route schemas (`@platform/http` `defineRoute`).

**Spec:** `docs/superpowers/specs/2026-10-15-shopify-discounts-design.md` (sections "The discount model", "Applying discounts at checkout", "Admin → API"). Admin screens and the storefront field are Parts 2 and 3 and are NOT in this plan.

## Refinements to the spec made while planning (apply these, they win over the spec)

1. **Permissions.** Only `promotions:read` and `promotions:create` exist in the Ory seed (`scripts/ops/seed-ory-network.mjs`). The `/discounts` routes use `promotions:read` for reads and `promotions:create` for every write — no new permission strings. The two public code routes use the existing `checkout:recalculate`.
2. **No data backfill.** The new `promotions` columns are nullable. `method = NULL` means "created before Phase 2": such a promotion is never applied automatically (it only works through its coupon); `discount_class` and `combines_with` are derived in the mapper when NULL (`combines_with` from `stackable`). The migrations are therefore pure `ADD COLUMN` — no `UPDATE` that row-level security could silently turn into a no-op.
3. **Extra rejection reason `no_matching_items`** for a code whose products/categories are not in the cart (clearer than reusing `not_eligible`).
4. **`Promotion.evaluate()` is fixed in place** (it now uses the matched lines' subtotal) instead of delegating to the calculator; Checkout no longer calls it.
5. **A rejected code answers 422** with the uniform validation envelope, `details: [{ field: "code", message: "<reason>" }]`, so the storefront reads the reason from `details[0].message`. An accepted code answers 200 with the session DTO.

## Global Constraints

- Money is integer minor units in the store currency everywhere; never accept an amount, price or discount from a client.
- Every repository/use-case call takes `tenantId` explicitly (ADR-0014).
- Migrations are hand-written, additive only (`ADD COLUMN`, `CREATE INDEX`), and are NEVER applied by the agent — the owner deploys them before the release that reads them. Never run `prisma migrate` against any database.
- Discount codes are normalised with `trim().toUpperCase()` and must match `^[A-Z0-9_-]{3,32}$` (existing `CouponCode` rule).
- At most 5 codes per checkout (`MAX_DISCOUNT_CODES = 5`); after 10 rejected codes in one session, code entry answers `too_many_attempts` for 15 minutes.
- Application order: product discounts → order discounts → shipping discounts.
- Percentages may have up to 2 decimals; percentage discounts are `Math.floor((amount * Math.round(pct * 100)) / 10000)`.
- Run tests per package with `pnpm --filter <package> exec vitest run <file>`; typecheck with `pnpm --filter <package> exec tsc --noEmit`. Package names: `@platform/promotions`, `@platform/coupons`, `@platform/checkout`, `@platform/orders`, `@platform/admin` (apps/admin), `@platform/db`. If a `--filter` name does not resolve, read the package's `package.json` `name` field and use that.
- Commits: Conventional Commits with a **lowercase** subject (commitlint rejects sentence case). This machine has no git identity, so commit with `git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit ...`, and end every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only the files of the task (`.claude/worktrees/` is unrelated and must stay untracked).
- Match the surrounding code: doc comments on exported symbols, `Result`/`err`/`ok` from `@platform/types`, domain errors from `@platform/utils` / `@platform/domain`.

## Review Focus

1. **A code typed as `" sale10 "`** must match the coupon `SALE10` (normalisation) — test in Task 6.
2. **A cart change that makes an applied code stop qualifying** must keep the code listed as not applicable with its reason, drop the discount to 0, and give a correct total — test in Task 6.
3. **A fixed amount larger than the cart** must never make a line, the subtotal, or the grand total negative — test in Task 2.
4. **A guest re-using a once-per-customer code with the same email in different letter case** must get `already_used` — test in Task 2 (calculator) and Task 4 (coupon).
5. **A free-shipping code entered before a shipping method is chosen** must be accepted with amount 0, and once shipping is chosen the shipping must become free in the totals — test in Task 6.

---

## File Structure

**services/promotions**

- Create `src/domain/value-objects/discount-settings.ts` — method, discount class, combination flags, `canCombine`.
- Modify `src/domain/value-objects/promotion-rule.ts` — reward shapes for buy X get Y and free shipping, validation, matched subtotal.
- Modify `src/domain/promotion.ts` — method, combinesWith, `discountClass`, `viewAt()`, `update()`, evaluate fix.
- Create `src/domain/discount-calculator.ts` (+ `.test.ts`) — the pure calculation.
- Modify `src/domain/promotion-repository.ts`, `src/infrastructure/{promotion.mapper,prisma-promotion-repository,in-memory-promotion-repository}.ts` — new fields, `findActiveAutomatic`, `listForAdmin`.
- Modify `src/application/promotion.use-cases.ts` — shared builder, `UpdatePromotion`, `ListActiveAutomaticPromotions`, `ListPromotionsForAdmin`.
- Modify `src/interfaces/promotions.controller.ts`, `src/composition.ts`, `src/index.ts`.

**services/coupons**

- Modify `src/domain/{coupon,coupon-redemption,coupon-repository}.ts`, `src/infrastructure/{coupon.mapper,prisma-coupon-repository,in-memory-coupon-repository}.ts`, `src/application/coupon.use-cases.ts`, `src/interfaces/coupons.controller.ts`, `src/composition.ts`.

**services/checkout**

- Create `src/domain/value-objects/discount-snapshot.ts`.
- Modify `src/domain/checkout-session.ts`, `src/domain/value-objects/checkout-totals.ts`, `src/infrastructure/{checkout-session.mapper,prisma-checkout-session-repository,in-memory-orchestration-adapters}.ts`.
- Modify `src/application/ports.ts`; create `src/application/discount-code.use-cases.ts` (+ `.test.ts`); modify `src/application/checkout-orchestration.use-cases.ts`, `src/application/complete-checkout.use-case.ts`, `src/interfaces/checkout.controller.ts`, `src/composition.ts`, `src/index.ts`.

**services/orders**

- Modify `src/domain/value-objects/order-totals-snapshot.ts`, `src/application/create-order-from-checkout.use-case.ts`, `src/infrastructure/order.mapper.ts`.

**packages/db**

- Modify `prisma/schema/promotions.prisma`, `prisma/schema/checkout.prisma`.
- Create `prisma/schema/migrations/20261016000000_discount_settings/migration.sql`, `prisma/schema/migrations/20261016010000_checkout_discounts/migration.sql`.

**apps/admin**

- Modify `src/infrastructure/cross-context/promotion-validation.adapter.ts`; create `src/infrastructure/cross-context/discount-usage.adapter.ts`.
- Create `src/interfaces/discounts/discount-dto.ts`, `src/interfaces/discounts/discounts.admin-controller.ts` (+ test).
- Create `src/http/discounts-routes.ts` (+ test); modify `src/http/public-checkout-routes.ts` (+ test), `src/http/admin-routes.ts`, `src/composition.ts`.

---

### Task 1: Promotion domain — discount settings, reward shapes, update

**Files:**

- Create: `services/promotions/src/domain/value-objects/discount-settings.ts`
- Modify: `services/promotions/src/domain/value-objects/promotion-rule.ts`
- Modify: `services/promotions/src/domain/promotion.ts`
- Test: `services/promotions/src/domain/promotion.test.ts` (append)

**Interfaces:**

- Produces: `DiscountMethod`, `DiscountClass`, `CombinesWith`, `COMBINES_WITH_NOTHING`, `COMBINES_WITH_EVERYTHING`, `discountClassOf(rule)`, `canCombine(a, b)`; `PromotionRewardProps` (exported) with `buys?`, `gets?`, `maxUsesPerOrder?`, `appliesOncePerOrder?`, `countries?`, `maxShippingRateMinor?`; reward type `"buy_x_get_y"`; `PromotionCondition.matchedSubtotalAmountMinor(cart)`; `Promotion.create(..., usageLimit?, settings?: PromotionSettings)`, `Promotion.reconstitute(..., version, settings?)`, `promotion.method`, `promotion.combinesWith`, `promotion.discountClass`, `promotion.viewAt(now)`, `promotion.update(changes: PromotionChanges)`.

- [ ] **Step 1: Write the failing tests** — append to `services/promotions/src/domain/promotion.test.ts`:

```ts
import { COMBINES_WITH_EVERYTHING, COMBINES_WITH_NOTHING } from "./value-objects/discount-settings";

function amountOffProductsRule(targetRefs: string[]): PromotionRule {
  const condition = PromotionCondition.create({ scope: "product", targetRefs });
  const reward = PromotionReward.create({ type: "percentage", value: 10 });
  if (!reward.ok) throw new Error("invalid fixture");
  const result = PromotionRule.create("automatic", condition, reward.value, false, 0);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

describe("Promotion — Shopify discount settings (Phase 2)", () => {
  it("defaults to no method and combines with nothing unless stackable", () => {
    const p = promotion();
    expect(p.method).toBeUndefined();
    expect(p.combinesWith).toEqual(COMBINES_WITH_NOTHING);
    expect(p.discountClass).toBe("order");
  });

  it("keeps the method and combination flags it was created with", () => {
    const p = Promotion.create(
      UniqueEntityId.from("promo-2"),
      "SALE10",
      rule(),
      PromotionSchedule.create(new Date(0)),
      CustomerEligibility.everyone(),
      PromotionCampaign.none(),
      undefined,
      { method: "code", combinesWith: COMBINES_WITH_EVERYTHING },
    );
    expect(p.method).toBe("code");
    expect(p.combinesWith).toEqual(COMBINES_WITH_EVERYTHING);
  });

  it("classes a product-scoped amount off as a product discount", () => {
    const p = Promotion.create(
      UniqueEntityId.from("promo-3"),
      "Shoes",
      amountOffProductsRule(["shoe"]),
      PromotionSchedule.create(new Date(0)),
      CustomerEligibility.everyone(),
      PromotionCampaign.none(),
    );
    expect(p.discountClass).toBe("product");
  });

  it("evaluates a product-scoped percentage on the matching lines only", () => {
    const p = Promotion.create(
      UniqueEntityId.from("promo-4"),
      "Shoes",
      amountOffProductsRule(["shoe"]),
      PromotionSchedule.create(new Date(0)),
      CustomerEligibility.everyone(),
      PromotionCampaign.none(),
    );
    p.activate("evt-1", new Date(0));
    const determination = p.evaluate(
      {
        lines: [
          { productRef: "shoe", categoryRefs: [], quantity: 1, unitPriceAmountMinor: 1_000 },
          { productRef: "hat", categoryRefs: [], quantity: 1, unitPriceAmountMinor: 9_000 },
        ],
        subtotalAmountMinor: 10_000,
      },
      "customer-1",
      [],
      new Date(0),
    );
    expect(determination?.discountAmountMinor).toBe(100);
  });

  it("updates every editable field", () => {
    const p = promotion();
    p.activate("evt-1", new Date(0));
    p.update({
      name: "15% off",
      rule: rule({ stackable: true }),
      schedule: PromotionSchedule.create(new Date(10), new Date(20)),
      eligibility: CustomerEligibility.create({ customerRefs: ["c-1"] }),
      usageLimit: 3,
      combinesWith: COMBINES_WITH_EVERYTHING,
    });
    expect(p.name).toBe("15% off");
    expect(p.schedule.endsAt).toEqual(new Date(20));
    expect(p.eligibility.customerRefs).toEqual(["c-1"]);
    expect(p.usageLimit).toBe(3);
    expect(p.combinesWith).toEqual(COMBINES_WITH_EVERYTHING);
  });

  it("refuses to change a discount's type", () => {
    const p = promotion();
    expect(() =>
      p.update({
        name: "x",
        rule: amountOffProductsRule(["shoe"]),
        schedule: p.schedule,
        eligibility: p.eligibility,
        combinesWith: COMBINES_WITH_NOTHING,
      }),
    ).toThrow(BusinessRuleError);
  });

  it("reports how Shopify would show it at a given moment", () => {
    const p = Promotion.create(
      UniqueEntityId.from("promo-5"),
      "Later",
      rule(),
      PromotionSchedule.create(new Date(100), new Date(200)),
      CustomerEligibility.everyone(),
      PromotionCampaign.none(),
    );
    expect(p.viewAt(new Date(150))).toBe("expired"); // still a draft: not running
    p.activate("evt-1", new Date(0));
    expect(p.viewAt(new Date(50))).toBe("scheduled");
    expect(p.viewAt(new Date(150))).toBe("active");
    expect(p.viewAt(new Date(250))).toBe("expired");
    p.pause("evt-2", new Date(150));
    expect(p.viewAt(new Date(150))).toBe("expired");
  });
});

describe("PromotionReward — Shopify reward shapes", () => {
  it("accepts a buy X get Y reward", () => {
    const reward = PromotionReward.create({
      type: "buy_x_get_y",
      buys: { kind: "quantity", value: 2 },
      gets: { quantity: 1, scope: "product", targetRefs: ["sock"], effect: { kind: "free" } },
    });
    expect(reward.ok).toBe(true);
  });

  it("refuses a buy X get Y reward with no items to get", () => {
    const reward = PromotionReward.create({
      type: "buy_x_get_y",
      buys: { kind: "quantity", value: 2 },
      gets: { quantity: 1, scope: "product", targetRefs: [], effect: { kind: "free" } },
    });
    expect(reward.ok).toBe(false);
  });

  it("refuses free-shipping countries that are not ISO codes", () => {
    const reward = PromotionReward.create({ type: "free_shipping", countries: ["Egypt"] });
    expect(reward.ok).toBe(false);
  });

  it("refuses a fractional fixed amount", () => {
    const reward = PromotionReward.create({ type: "fixed_amount", value: 10.5 });
    expect(reward.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @platform/promotions exec vitest run src/domain/promotion.test.ts`
Expected: FAIL — `discount-settings` module not found / `method` undefined on `Promotion`.

- [ ] **Step 3: Create `services/promotions/src/domain/value-objects/discount-settings.ts`**

```ts
import type { PromotionRule } from "./promotion-rule";

/** How a discount reaches a cart — a code the customer types, or automatically (Shopify's two methods). */
export type DiscountMethod = "code" | "automatic";

/** Shopify's combination classes: what a discount takes money off. */
export type DiscountClass = "product" | "order" | "shipping";

/** Which other classes of discount this one may be combined with. */
export interface CombinesWith {
  readonly product: boolean;
  readonly order: boolean;
  readonly shipping: boolean;
}

export const COMBINES_WITH_NOTHING: CombinesWith = {
  product: false,
  order: false,
  shipping: false,
};
export const COMBINES_WITH_EVERYTHING: CombinesWith = {
  product: true,
  order: true,
  shipping: true,
};

/** The class a rule belongs to: free shipping → shipping; buy X get Y or a product/category scope → product; a cart scope → order. */
export function discountClassOf(rule: PromotionRule): DiscountClass {
  if (rule.reward.type === "free_shipping") return "shipping";
  if (rule.type === "buy_x_get_y") return "product";
  return rule.condition.scope === "cart" ? "order" : "product";
}

/** Two discounts combine only when each allows the other's class. */
export function canCombine(
  a: { readonly discountClass: DiscountClass; readonly combinesWith: CombinesWith },
  b: { readonly discountClass: DiscountClass; readonly combinesWith: CombinesWith },
): boolean {
  return a.combinesWith[b.discountClass] && b.combinesWith[a.discountClass];
}
```

- [ ] **Step 4: Extend `services/promotions/src/domain/value-objects/promotion-rule.ts`**

Replace the type line and the reward section (from `export type PromotionRewardType` and from `interface PromotionRewardProps` down to the end of `class PromotionReward`) with:

```ts
export type PromotionRewardType = "percentage" | "fixed_amount" | "free_shipping" | "buy_x_get_y";
```

```ts
/** What the customer must buy for a buy X get Y discount: a number of items, or an amount (minor units). */
export interface BuyXGetYBuys {
  readonly kind: "quantity" | "amount";
  readonly value: number;
}

/** What the customer gets: how many items, from which products or categories, and how much off. */
export interface BuyXGetYGets {
  readonly quantity: number;
  readonly scope: "product" | "category";
  readonly targetRefs: readonly string[];
  readonly effect:
    { readonly kind: "percentage"; readonly value: number } | { readonly kind: "free" };
}

export interface PromotionRewardProps {
  readonly type: PromotionRewardType;
  /** Percentage (0-100, up to 2 decimals) for `percentage`, minor-units amount for `fixed_amount`; ignored otherwise. */
  readonly value?: number;
  /** Legacy (before Phase 2) buy X get Y quantities; kept for old rows and the platform-tools API. */
  readonly buyQuantity?: number;
  readonly getQuantity?: number;
  /** Fixed amount off products: true = once per order, spread over the matching items; false/absent = per item. */
  readonly appliesOncePerOrder?: boolean;
  /** Free shipping: ISO 3166-1 alpha-2 destinations; absent = every country. */
  readonly countries?: readonly string[];
  /** Free shipping: rates above this amount (minor units) are not made free. */
  readonly maxShippingRateMinor?: number;
  readonly buys?: BuyXGetYBuys;
  readonly gets?: BuyXGetYGets;
  /** Buy X get Y: how many times one order may use it; absent = unlimited. */
  readonly maxUsesPerOrder?: number;
}

function isPositiveInteger(value: number | undefined): boolean {
  return value !== undefined && Number.isInteger(value) && value > 0;
}

function rewardIssues(props: PromotionRewardProps): { field: string; message: string }[] {
  const issues: { field: string; message: string }[] = [];
  switch (props.type) {
    case "percentage":
      if (props.value === undefined || props.value < 0 || props.value > 100) {
        issues.push({ field: "value", message: "percentage reward must be 0-100" });
      }
      break;
    case "fixed_amount":
      if (props.value !== undefined && (!Number.isInteger(props.value) || props.value < 0)) {
        issues.push({
          field: "value",
          message: "fixed amount must be a whole number of minor units",
        });
      }
      break;
    case "buy_x_get_y":
      if (props.buys === undefined || !isPositiveInteger(props.buys.value)) {
        issues.push({ field: "buys", message: "must say how much the customer buys" });
      }
      if (
        props.gets === undefined ||
        !isPositiveInteger(props.gets.quantity) ||
        props.gets.targetRefs.length === 0
      ) {
        issues.push({
          field: "gets",
          message: "must say which items and how many the customer gets",
        });
      } else if (
        props.gets.effect.kind === "percentage" &&
        (props.gets.effect.value <= 0 || props.gets.effect.value > 100)
      ) {
        issues.push({ field: "gets.effect", message: "percentage must be 0-100" });
      }
      if (props.maxUsesPerOrder !== undefined && !isPositiveInteger(props.maxUsesPerOrder)) {
        issues.push({ field: "maxUsesPerOrder", message: "must be a positive whole number" });
      }
      break;
    case "free_shipping":
      if (props.countries !== undefined && props.countries.some((c) => !/^[A-Z]{2}$/.test(c))) {
        issues.push({ field: "countries", message: "must be ISO 3166-1 alpha-2 codes" });
      }
      if (
        props.maxShippingRateMinor !== undefined &&
        (!Number.isInteger(props.maxShippingRateMinor) || props.maxShippingRateMinor < 0)
      ) {
        issues.push({
          field: "maxShippingRateMinor",
          message: "must be a whole number of minor units",
        });
      }
      break;
  }
  return issues;
}

/** The discount a matching promotion determines — a pure calculation, never applied to a price directly. */
export class PromotionReward extends ValueObject<PromotionRewardProps> {
  static create(props: PromotionRewardProps): Result<PromotionReward, ValidationError> {
    const issues = rewardIssues(props);
    if (issues.length > 0) {
      return err(new ValidationError("Invalid promotion reward", issues));
    }
    return ok(new PromotionReward(props));
  }

  /**
   * Computes the discount amount (minor units) for a matched subtotal — pure. Used only by the
   * legacy `Promotion.evaluate()`; checkout uses `calculateDiscounts()`, which handles every type.
   */
  discountAmountMinor(matchedSubtotalAmountMinor: number): number {
    switch (this.props.type) {
      case "percentage":
        return Math.floor((matchedSubtotalAmountMinor * (this.props.value ?? 0)) / 100);
      case "fixed_amount":
        return Math.min(this.props.value ?? 0, matchedSubtotalAmountMinor);
      case "free_shipping":
      case "buy_x_get_y":
        return 0;
    }
  }

  get type(): PromotionRewardType {
    return this.props.type;
  }

  get value(): number | undefined {
    return this.props.value;
  }

  get buyQuantity(): number | undefined {
    return this.props.buyQuantity;
  }

  get getQuantity(): number | undefined {
    return this.props.getQuantity;
  }

  get appliesOncePerOrder(): boolean | undefined {
    return this.props.appliesOncePerOrder;
  }

  get countries(): readonly string[] | undefined {
    return this.props.countries;
  }

  get maxShippingRateMinor(): number | undefined {
    return this.props.maxShippingRateMinor;
  }

  get buys(): BuyXGetYBuys | undefined {
    return this.props.buys;
  }

  get gets(): BuyXGetYGets | undefined {
    return this.props.gets;
  }

  get maxUsesPerOrder(): number | undefined {
    return this.props.maxUsesPerOrder;
  }

  /** Every field, for persistence. */
  toProps(): PromotionRewardProps {
    return { ...this.props };
  }
}
```

In `PromotionCondition`, add after `matches()`:

```ts
  /** The subtotal of the lines this condition is about — the whole cart for a cart scope. */
  matchedSubtotalAmountMinor(cart: CartSnapshot): number {
    if (this.props.scope === "cart") return cart.subtotalAmountMinor;
    return this.relevantLines(cart).reduce(
      (sum, line) => sum + line.quantity * line.unitPriceAmountMinor,
      0,
    );
  }
```

In `PromotionRule.create`, replace the buy X get Y check with:

```ts
if (
  type === "buy_x_get_y" &&
  reward.type !== "buy_x_get_y" &&
  (reward.buyQuantity === undefined || reward.getQuantity === undefined)
) {
  return err(
    new ValidationError("Invalid promotion rule", [
      { field: "reward", message: "buy_x_get_y requires buyQuantity and getQuantity" },
    ]),
  );
}
if (reward.type === "buy_x_get_y" && type !== "buy_x_get_y") {
  return err(
    new ValidationError("Invalid promotion rule", [
      { field: "ruleType", message: "a buy X get Y reward needs the buy_x_get_y rule type" },
    ]),
  );
}
```

- [ ] **Step 5: Extend `services/promotions/src/domain/promotion.ts`**

Add imports:

```ts
import {
  COMBINES_WITH_EVERYTHING,
  COMBINES_WITH_NOTHING,
  discountClassOf,
  type CombinesWith,
  type DiscountClass,
  type DiscountMethod,
} from "./value-objects/discount-settings";
```

Add these exported types above `interface PromotionProps`:

```ts
/** Phase 2 settings. Absent `method` = created before Phase 2: reachable only through its coupon. */
export interface PromotionSettings {
  readonly method?: DiscountMethod;
  readonly combinesWith?: CombinesWith;
}

/** Every field the merchant may edit on an existing discount (type and method excluded). */
export interface PromotionChanges {
  readonly name: string;
  readonly rule: PromotionRule;
  readonly schedule: PromotionSchedule;
  readonly eligibility: CustomerEligibility;
  readonly usageLimit?: number;
  readonly combinesWith: CombinesWith;
}

/** How Shopify shows a discount at a moment. Drafts are not running, so they read as expired. */
export type PromotionView = "active" | "scheduled" | "expired" | "archived";
```

Change `PromotionProps` to (fields that `update()` writes lose `readonly`):

```ts
interface PromotionProps {
  name: string;
  rule: PromotionRule;
  schedule: PromotionSchedule;
  eligibility: CustomerEligibility;
  readonly campaign: PromotionCampaign;
  usageLimit?: number;
  usageCount: number;
  status: PromotionStatus;
  readonly method?: DiscountMethod;
  combinesWith: CombinesWith;
}
```

Give `create` a last parameter `settings: PromotionSettings = {}` and add to its props:

```ts
        method: settings.method,
        combinesWith:
          settings.combinesWith ?? (rule.stackable ? COMBINES_WITH_EVERYTHING : COMBINES_WITH_NOTHING),
```

Give `reconstitute` a last parameter `settings: PromotionSettings = {}` (after `version`) and pass the same two props into `new Promotion({ ... })`.

Replace the `discountAmountMinor` line in `evaluate()` with:

```ts
      discountAmountMinor: this.props.rule.reward.discountAmountMinor(
        this.props.rule.condition.matchedSubtotalAmountMinor(cart),
      ),
```

Add these methods after `recordUsage`:

```ts
  /** Applies the merchant's edits. The type (class and rule type) can never change, as in Shopify. */
  update(changes: PromotionChanges): void {
    if (this.props.status.value === "archived") {
      throw new BusinessRuleError("An archived discount cannot be edited");
    }
    if (
      changes.rule.type !== this.props.rule.type ||
      discountClassOf(changes.rule) !== this.discountClass
    ) {
      throw new BusinessRuleError("A discount's type cannot be changed");
    }
    this.props.name = changes.name;
    this.props.rule = changes.rule;
    this.props.schedule = changes.schedule;
    this.props.eligibility = changes.eligibility;
    this.props.usageLimit = changes.usageLimit;
    this.props.combinesWith = changes.combinesWith;
  }

  /** Shopify's status column at `now`: Active, Scheduled or Expired (deactivated reads as expired). */
  viewAt(now: Date): PromotionView {
    const status = this.props.status.value;
    if (status === "archived") return "archived";
    if (status !== "active" && status !== "scheduled") return "expired";
    if (this.props.schedule.isExpiredAt(now)) return "expired";
    if (now.getTime() < this.props.schedule.startsAt.getTime()) return "scheduled";
    return status === "active" ? "active" : "scheduled";
  }

  get method(): DiscountMethod | undefined {
    return this.props.method;
  }

  get combinesWith(): CombinesWith {
    return this.props.combinesWith;
  }

  get discountClass(): DiscountClass {
    return discountClassOf(this.props.rule);
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @platform/promotions exec vitest run src/domain`
Expected: PASS (new tests and the existing ones).

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @platform/promotions exec tsc --noEmit` — Expected: no output.

```bash
git add services/promotions/src/domain
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -m "feat(promotions): discount method, combinations and shopify reward shapes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The discount calculator

**Files:**

- Create: `services/promotions/src/domain/discount-calculator.ts`
- Test: `services/promotions/src/domain/discount-calculator.test.ts`
- Modify: `services/promotions/src/index.ts`

**Interfaces:**

- Consumes (Task 1): `Promotion` (`method`, `discountClass`, `combinesWith`, `rule`, `schedule`, `eligibility`, `status`, `usageLimit`, `usageCount`, `name`, `id`), `canCombine`, `DiscountClass`.
- Produces (exported from `@platform/promotions`):

```ts
export type DiscountRejection =
  | "not_found"
  | "expired"
  | "not_started"
  | "minimum_not_met"
  | "no_matching_items"
  | "not_eligible"
  | "usage_limit_reached"
  | "already_used"
  | "cannot_combine"
  | "too_many_codes";
export const MAX_DISCOUNT_CODES = 5;
export function normalizeDiscountCode(code: string): string;
export interface DiscountLine {
  lineRef: string;
  productRef: string;
  categoryRefs: readonly string[];
  quantity: number;
  unitPriceMinor: number;
}
export interface DiscountShipping {
  countryCode: string;
  rateMinor: number;
}
export interface DiscountCustomer {
  customerRef?: string;
  email?: string;
}
export interface CouponState {
  couponId: string;
  code: string;
  status: "active" | "disabled" | "expired" | "depleted";
  usageLimit?: number;
  usageCount: number;
  oncePerCustomer: boolean;
  assignedCustomerRef?: string;
  expiresAt?: Date;
  redemptions: readonly { customerRef: string; email?: string }[];
}
export interface DiscountCandidate {
  promotion: Promotion;
  coupon?: CouponState;
}
export interface CalculateDiscountsInput {
  lines: readonly DiscountLine[];
  shipping: DiscountShipping | null;
  customer: DiscountCustomer;
  enteredCodes: readonly string[];
  candidates: readonly DiscountCandidate[];
  now: Date;
}
export interface AppliedDiscount {
  promotionId: string;
  couponId?: string;
  code?: string;
  title: string;
  discountClass: DiscountClass;
  amountMinor: number;
}
export interface DiscountCodeStatus {
  code: string;
  applicable: boolean;
  reason?: DiscountRejection;
}
export interface LineAllocation {
  lineRef: string;
  amountMinor: number;
}
export interface DiscountResult {
  applied: readonly AppliedDiscount[];
  orderDiscountMinor: number;
  shippingDiscountMinor: number;
  codeStatuses: readonly DiscountCodeStatus[];
  lineAllocations: readonly LineAllocation[];
}
export function calculateDiscounts(input: CalculateDiscountsInput): DiscountResult;
```

- [ ] **Step 1: Write the failing tests** — create `services/promotions/src/domain/discount-calculator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import {
  calculateDiscounts,
  type CouponState,
  type DiscountCandidate,
  type DiscountLine,
} from "./discount-calculator";
import { Promotion } from "./promotion";
import {
  COMBINES_WITH_EVERYTHING,
  COMBINES_WITH_NOTHING,
  type CombinesWith,
  type DiscountMethod,
} from "./value-objects/discount-settings";
import {
  PromotionCondition,
  PromotionReward,
  PromotionRule,
  type PromotionRewardProps,
  type PromotionRuleType,
  type PromotionScope,
} from "./value-objects/promotion-rule";
import {
  CustomerEligibility,
  PromotionCampaign,
  PromotionSchedule,
} from "./value-objects/promotion-schedule";

const NOW = new Date("2026-10-16T12:00:00.000Z");

interface PromoOptions {
  readonly id: string;
  readonly ruleType?: PromotionRuleType;
  readonly scope?: PromotionScope;
  readonly targetRefs?: string[];
  readonly minimumQuantity?: number;
  readonly minimumSubtotalAmountMinor?: number;
  readonly reward: PromotionRewardProps;
  readonly method?: DiscountMethod;
  readonly combinesWith?: CombinesWith;
  readonly startsAt?: Date;
  readonly endsAt?: Date;
  readonly customerRefs?: string[];
  readonly usageLimit?: number;
  readonly active?: boolean;
}

function promo(o: PromoOptions): Promotion {
  const reward = PromotionReward.create(o.reward);
  if (!reward.ok) throw new Error(reward.error.message);
  const rule = PromotionRule.create(
    o.ruleType ?? "automatic",
    PromotionCondition.create({
      scope: o.scope ?? "cart",
      targetRefs: o.targetRefs ?? [],
      minimumQuantity: o.minimumQuantity,
      minimumSubtotalAmountMinor: o.minimumSubtotalAmountMinor,
    }),
    reward.value,
    false,
    0,
  );
  if (!rule.ok) throw new Error(rule.error.message);
  const p = Promotion.create(
    UniqueEntityId.from(o.id),
    o.id,
    rule.value,
    PromotionSchedule.create(o.startsAt ?? new Date(0), o.endsAt),
    o.customerRefs === undefined
      ? CustomerEligibility.everyone()
      : CustomerEligibility.create({ customerRefs: o.customerRefs }),
    PromotionCampaign.none(),
    o.usageLimit,
    { method: o.method ?? "automatic", combinesWith: o.combinesWith ?? COMBINES_WITH_NOTHING },
  );
  if (o.active !== false) p.activate("evt", new Date(0));
  return p;
}

function coupon(code: string, overrides: Partial<CouponState> = {}): CouponState {
  return {
    couponId: `coupon-${code}`,
    code,
    status: "active",
    usageCount: 0,
    oncePerCustomer: false,
    redemptions: [],
    ...overrides,
  };
}

function line(
  lineRef: string,
  productRef: string,
  unitPriceMinor: number,
  quantity = 1,
  categoryRefs: string[] = [],
): DiscountLine {
  return { lineRef, productRef, categoryRefs, quantity, unitPriceMinor };
}

function run(
  candidates: DiscountCandidate[],
  lines: DiscountLine[],
  options: {
    codes?: string[];
    shipping?: { countryCode: string; rateMinor: number } | null;
    customer?: { customerRef?: string; email?: string };
  } = {},
) {
  return calculateDiscounts({
    lines,
    shipping: options.shipping ?? null,
    customer: options.customer ?? {},
    enteredCodes: options.codes ?? [],
    candidates,
    now: NOW,
  });
}

describe("calculateDiscounts — amount off order", () => {
  it("takes a percentage off the whole order and allocates it over the lines", () => {
    const sale = promo({ id: "p1", method: "code", reward: { type: "percentage", value: 10 } });
    const result = run(
      [{ promotion: sale, coupon: coupon("SALE10") }],
      [line("0", "a", 1_000), line("1", "b", 3_000)],
      {
        codes: ["SALE10"],
      },
    );
    expect(result.orderDiscountMinor).toBe(400);
    expect(result.codeStatuses).toEqual([{ code: "SALE10", applicable: true }]);
    expect(result.lineAllocations).toEqual([
      { lineRef: "0", amountMinor: 100 },
      { lineRef: "1", amountMinor: 300 },
    ]);
  });

  it("never takes more than the order is worth (Review Focus 3)", () => {
    const big = promo({ id: "p1", reward: { type: "fixed_amount", value: 50_000 } });
    const result = run([{ promotion: big }], [line("0", "a", 1_000)]);
    expect(result.orderDiscountMinor).toBe(1_000);
  });

  it("refuses a code below the minimum purchase", () => {
    const sale = promo({
      id: "p1",
      method: "code",
      minimumSubtotalAmountMinor: 20_000,
      reward: { type: "percentage", value: 10 },
    });
    const result = run([{ promotion: sale, coupon: coupon("SALE10") }], [line("0", "a", 1_000)], {
      codes: ["SALE10"],
    });
    expect(result.orderDiscountMinor).toBe(0);
    expect(result.codeStatuses).toEqual([
      { code: "SALE10", applicable: false, reason: "minimum_not_met" },
    ]);
  });
});

describe("calculateDiscounts — amount off products", () => {
  it("takes the percentage off the matching lines only", () => {
    const shoes = promo({
      id: "p1",
      scope: "product",
      targetRefs: ["shoe"],
      reward: { type: "percentage", value: 25 },
    });
    const result = run([{ promotion: shoes }], [line("0", "shoe", 2_000), line("1", "hat", 5_000)]);
    expect(result.orderDiscountMinor).toBe(500);
    expect(result.lineAllocations).toEqual([{ lineRef: "0", amountMinor: 500 }]);
  });

  it("matches by category", () => {
    const summer = promo({
      id: "p1",
      scope: "category",
      targetRefs: ["summer"],
      reward: { type: "percentage", value: 50 },
    });
    const result = run(
      [{ promotion: summer }],
      [line("0", "tee", 1_000, 1, ["summer"]), line("1", "coat", 9_000, 1, ["winter"])],
    );
    expect(result.orderDiscountMinor).toBe(500);
  });

  it("takes a fixed amount off each matching item, never below zero", () => {
    const off = promo({
      id: "p1",
      scope: "product",
      targetRefs: ["shoe"],
      reward: { type: "fixed_amount", value: 1_500 },
    });
    const result = run([{ promotion: off }], [line("0", "shoe", 1_000, 3)]);
    expect(result.orderDiscountMinor).toBe(3_000);
  });

  it("takes a fixed amount once per order when asked to", () => {
    const off = promo({
      id: "p1",
      scope: "product",
      targetRefs: ["shoe"],
      reward: { type: "fixed_amount", value: 1_500, appliesOncePerOrder: true },
    });
    const result = run([{ promotion: off }], [line("0", "shoe", 1_000, 3)]);
    expect(result.orderDiscountMinor).toBe(1_500);
  });

  it("rejects a code whose products are not in the cart", () => {
    const shoes = promo({
      id: "p1",
      method: "code",
      scope: "product",
      targetRefs: ["shoe"],
      reward: { type: "percentage", value: 10 },
    });
    const result = run([{ promotion: shoes, coupon: coupon("SHOES") }], [line("0", "hat", 1_000)], {
      codes: ["SHOES"],
    });
    expect(result.codeStatuses[0]).toEqual({
      code: "SHOES",
      applicable: false,
      reason: "no_matching_items",
    });
  });

  it("measures the minimum purchase on the matching items only, as Shopify", () => {
    const shoes = promo({
      id: "p1",
      scope: "product",
      targetRefs: ["shoe"],
      minimumSubtotalAmountMinor: 5_000,
      reward: { type: "percentage", value: 10 },
    });
    const result = run([{ promotion: shoes }], [line("0", "shoe", 1_000), line("1", "hat", 9_000)]);
    expect(result.orderDiscountMinor).toBe(0);
  });
});

describe("calculateDiscounts — buy X get Y", () => {
  const bxgy = (overrides: Partial<PromotionRewardProps> = {}) =>
    promo({
      id: "p1",
      ruleType: "buy_x_get_y",
      scope: "product",
      targetRefs: ["shirt"],
      reward: {
        type: "buy_x_get_y",
        buys: { kind: "quantity", value: 2 },
        gets: { quantity: 1, scope: "product", targetRefs: ["sock"], effect: { kind: "free" } },
        ...overrides,
      },
    });

  it("gives the cheapest qualifying item free once the customer buys enough", () => {
    const result = run(
      [{ promotion: bxgy() }],
      [line("0", "shirt", 3_000, 2), line("1", "sock", 500, 1)],
    );
    expect(result.orderDiscountMinor).toBe(500);
  });

  it("gives nothing when the customer has not bought enough", () => {
    const result = run(
      [{ promotion: bxgy() }],
      [line("0", "shirt", 3_000, 1), line("1", "sock", 500, 1)],
    );
    expect(result.orderDiscountMinor).toBe(0);
  });

  it("never counts the same unit as both bought and got", () => {
    const sameItem = promo({
      id: "p1",
      ruleType: "buy_x_get_y",
      scope: "product",
      targetRefs: ["shirt"],
      reward: {
        type: "buy_x_get_y",
        buys: { kind: "quantity", value: 2 },
        gets: { quantity: 1, scope: "product", targetRefs: ["shirt"], effect: { kind: "free" } },
      },
    });
    expect(run([{ promotion: sameItem }], [line("0", "shirt", 1_000, 2)]).orderDiscountMinor).toBe(
      0,
    );
    expect(run([{ promotion: sameItem }], [line("0", "shirt", 1_000, 3)]).orderDiscountMinor).toBe(
      1_000,
    );
  });

  it("respects the maximum uses per order", () => {
    const result = run(
      [{ promotion: bxgy({ maxUsesPerOrder: 1 }) }],
      [line("0", "shirt", 3_000, 4), line("1", "sock", 500, 2)],
    );
    expect(result.orderDiscountMinor).toBe(500);
  });

  it("applies a percentage effect", () => {
    const half = bxgy({
      gets: {
        quantity: 1,
        scope: "product",
        targetRefs: ["sock"],
        effect: { kind: "percentage", value: 50 },
      },
    });
    const result = run(
      [{ promotion: half }],
      [line("0", "shirt", 3_000, 2), line("1", "sock", 500, 1)],
    );
    expect(result.orderDiscountMinor).toBe(250);
  });
});

describe("calculateDiscounts — free shipping", () => {
  const free = (overrides: Partial<PromotionRewardProps> = {}) =>
    promo({ id: "p1", method: "code", reward: { type: "free_shipping", ...overrides } });

  it("makes the selected rate free", () => {
    const result = run(
      [{ promotion: free(), coupon: coupon("SHIPFREE") }],
      [line("0", "a", 1_000)],
      {
        codes: ["SHIPFREE"],
        shipping: { countryCode: "EG", rateMinor: 6_000 },
      },
    );
    expect(result.shippingDiscountMinor).toBe(6_000);
    expect(result.orderDiscountMinor).toBe(0);
  });

  it("is accepted with nothing off before shipping is chosen (Review Focus 5)", () => {
    const result = run(
      [{ promotion: free(), coupon: coupon("SHIPFREE") }],
      [line("0", "a", 1_000)],
      { codes: ["SHIPFREE"] },
    );
    expect(result.codeStatuses).toEqual([{ code: "SHIPFREE", applicable: true }]);
    expect(result.shippingDiscountMinor).toBe(0);
  });

  it("refuses another country and a rate above the cap", () => {
    const limited = free({ countries: ["EG"], maxShippingRateMinor: 5_000 });
    const elsewhere = run(
      [{ promotion: limited, coupon: coupon("SHIPFREE") }],
      [line("0", "a", 1_000)],
      {
        codes: ["SHIPFREE"],
        shipping: { countryCode: "SA", rateMinor: 1_000 },
      },
    );
    expect(elsewhere.codeStatuses[0]?.reason).toBe("not_eligible");
    const expensive = run(
      [{ promotion: limited, coupon: coupon("SHIPFREE") }],
      [line("0", "a", 1_000)],
      {
        codes: ["SHIPFREE"],
        shipping: { countryCode: "EG", rateMinor: 9_000 },
      },
    );
    expect(expensive.codeStatuses[0]?.reason).toBe("not_eligible");
  });
});

describe("calculateDiscounts — eligibility", () => {
  const sale = (o: Partial<PromoOptions> = {}) =>
    promo({ id: "p1", method: "code", reward: { type: "percentage", value: 10 }, ...o });
  const cart = [line("0", "a", 10_000)];
  const reasonFor = (candidate: DiscountCandidate, customer = {}) =>
    run([candidate], cart, { codes: ["SALE10"], customer }).codeStatuses[0]?.reason;

  it("answers not_found for an unknown code", () => {
    expect(run([], cart, { codes: ["NOPE"] }).codeStatuses).toEqual([
      { code: "NOPE", applicable: false, reason: "not_found" },
    ]);
  });

  it("normalises the code the customer typed (Review Focus 1)", () => {
    expect(
      run([{ promotion: sale(), coupon: coupon("SALE10") }], cart, { codes: [" sale10 "] })
        .codeStatuses,
    ).toEqual([{ code: "SALE10", applicable: true }]);
  });

  it("answers not_started and expired from the dates", () => {
    expect(
      reasonFor({
        promotion: sale({ startsAt: new Date("2027-01-01") }),
        coupon: coupon("SALE10"),
      }),
    ).toBe("not_started");
    expect(
      reasonFor({ promotion: sale({ endsAt: new Date("2026-01-01") }), coupon: coupon("SALE10") }),
    ).toBe("expired");
  });

  it("answers not_found for a deactivated or deleted code", () => {
    expect(reasonFor({ promotion: sale(), coupon: coupon("SALE10", { status: "disabled" }) })).toBe(
      "not_found",
    );
    expect(reasonFor({ promotion: sale({ active: false }), coupon: coupon("SALE10") })).toBe(
      "not_found",
    );
  });

  it("answers not_eligible for a customer outside the list", () => {
    const only = { promotion: sale({ customerRefs: ["vip"] }), coupon: coupon("SALE10") };
    expect(reasonFor(only, { customerRef: "someone" })).toBe("not_eligible");
    expect(reasonFor(only, {})).toBe("not_eligible");
    expect(reasonFor(only, { customerRef: "vip" })).toBeUndefined();
  });

  it("answers usage_limit_reached when the code is used up", () => {
    expect(
      reasonFor({ promotion: sale(), coupon: coupon("SALE10", { usageLimit: 2, usageCount: 2 }) }),
    ).toBe("usage_limit_reached");
  });

  it("answers already_used for the same customer or the same guest email in any case (Review Focus 4)", () => {
    const once = coupon("SALE10", {
      oncePerCustomer: true,
      redemptions: [{ customerRef: "c-1", email: "Ali@Example.com" }],
    });
    expect(reasonFor({ promotion: sale(), coupon: once }, { customerRef: "c-1" })).toBe(
      "already_used",
    );
    expect(reasonFor({ promotion: sale(), coupon: once }, { email: "ali@example.COM" })).toBe(
      "already_used",
    );
    expect(
      reasonFor(
        { promotion: sale(), coupon: once },
        { customerRef: "c-2", email: "other@example.com" },
      ),
    ).toBeUndefined();
  });

  it("answers too_many_codes beyond five", () => {
    const codes = ["A1A", "B1B", "C1C", "D1D", "E1E", "F1F"];
    const result = run([], cart, { codes });
    expect(result.codeStatuses[5]).toEqual({
      code: "F1F",
      applicable: false,
      reason: "too_many_codes",
    });
  });

  it("never applies a code-only discount without its code", () => {
    const codeOnly = { promotion: sale(), coupon: coupon("SALE10") };
    expect(run([codeOnly], cart).orderDiscountMinor).toBe(0);
  });
});

describe("calculateDiscounts — combinations", () => {
  it("keeps the larger saving when two discounts cannot combine, and says why", () => {
    const auto = promo({ id: "p1", reward: { type: "percentage", value: 5 } });
    const code = promo({ id: "p2", method: "code", reward: { type: "percentage", value: 20 } });
    const result = run(
      [{ promotion: auto }, { promotion: code, coupon: coupon("BIG20") }],
      [line("0", "a", 10_000)],
      {
        codes: ["BIG20"],
      },
    );
    expect(result.orderDiscountMinor).toBe(2_000);
    expect(result.applied.map((a) => a.promotionId)).toEqual(["p2"]);
  });

  it("answers cannot_combine for an entered code left out", () => {
    const auto = promo({ id: "p1", reward: { type: "percentage", value: 30 } });
    const code = promo({ id: "p2", method: "code", reward: { type: "percentage", value: 10 } });
    const result = run(
      [{ promotion: auto }, { promotion: code, coupon: coupon("SMALL10") }],
      [line("0", "a", 10_000)],
      {
        codes: ["SMALL10"],
      },
    );
    expect(result.codeStatuses).toEqual([
      { code: "SMALL10", applicable: false, reason: "cannot_combine" },
    ]);
    expect(result.orderDiscountMinor).toBe(3_000);
  });

  it("applies product discounts before order discounts when both allow it", () => {
    const product = promo({
      id: "p1",
      scope: "product",
      targetRefs: ["a"],
      reward: { type: "fixed_amount", value: 2_000 },
      combinesWith: COMBINES_WITH_EVERYTHING,
    });
    const order = promo({
      id: "p2",
      reward: { type: "percentage", value: 10 },
      combinesWith: COMBINES_WITH_EVERYTHING,
    });
    const result = run([{ promotion: product }, { promotion: order }], [line("0", "a", 10_000)]);
    // 10,000 − 2,000 = 8,000, then 10% of 8,000 = 800.
    expect(result.orderDiscountMinor).toBe(2_800);
  });

  it("combines free shipping with an order discount when both allow it", () => {
    const order = promo({
      id: "p1",
      reward: { type: "percentage", value: 10 },
      combinesWith: COMBINES_WITH_EVERYTHING,
    });
    const ship = promo({
      id: "p2",
      method: "code",
      reward: { type: "free_shipping" },
      combinesWith: COMBINES_WITH_EVERYTHING,
    });
    const result = run(
      [{ promotion: order }, { promotion: ship, coupon: coupon("SHIP") }],
      [line("0", "a", 10_000)],
      {
        codes: ["SHIP"],
        shipping: { countryCode: "EG", rateMinor: 5_000 },
      },
    );
    expect(result.orderDiscountMinor).toBe(1_000);
    expect(result.shippingDiscountMinor).toBe(5_000);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @platform/promotions exec vitest run src/domain/discount-calculator.test.ts`
Expected: FAIL — module `./discount-calculator` not found.

- [ ] **Step 3: Implement `services/promotions/src/domain/discount-calculator.ts`**

```ts
import type { Promotion } from "./promotion";
import {
  canCombine,
  type CombinesWith,
  type DiscountClass,
} from "./value-objects/discount-settings";
import type { PromotionScope } from "./value-objects/promotion-rule";

/** Why a code gives nothing — the storefront turns each one into a sentence. */
export type DiscountRejection =
  | "not_found"
  | "expired"
  | "not_started"
  | "minimum_not_met"
  | "no_matching_items"
  | "not_eligible"
  | "usage_limit_reached"
  | "already_used"
  | "cannot_combine"
  | "too_many_codes";

/** At most this many codes per checkout (Shopify's limit for product/order codes). */
export const MAX_DISCOUNT_CODES = 5;

/** The form every code is compared in: trimmed, upper case — the same rule as `CouponCode`. */
export function normalizeDiscountCode(code: string): string {
  return code.trim().toUpperCase();
}

export interface DiscountLine {
  readonly lineRef: string;
  readonly productRef: string;
  readonly categoryRefs: readonly string[];
  readonly quantity: number;
  readonly unitPriceMinor: number;
}

export interface DiscountShipping {
  readonly countryCode: string;
  readonly rateMinor: number;
}

export interface DiscountCustomer {
  readonly customerRef?: string;
  readonly email?: string;
}

/** What the calculator needs to know about a code — plain data, no Coupons import. */
export interface CouponState {
  readonly couponId: string;
  readonly code: string;
  readonly status: "active" | "disabled" | "expired" | "depleted";
  readonly usageLimit?: number;
  readonly usageCount: number;
  readonly oncePerCustomer: boolean;
  readonly assignedCustomerRef?: string;
  readonly expiresAt?: Date;
  readonly redemptions: readonly { readonly customerRef: string; readonly email?: string }[];
}

/** A discount that might apply: a promotion, with its coupon when it is reached by code. */
export interface DiscountCandidate {
  readonly promotion: Promotion;
  readonly coupon?: CouponState;
}

export interface CalculateDiscountsInput {
  readonly lines: readonly DiscountLine[];
  /** The destination and selected rate; `null` before a shipping method is chosen. */
  readonly shipping: DiscountShipping | null;
  readonly customer: DiscountCustomer;
  /** As the customer typed them; normalised and de-duplicated here. */
  readonly enteredCodes: readonly string[];
  /** The promotions behind the entered codes, plus the active automatic ones. */
  readonly candidates: readonly DiscountCandidate[];
  readonly now: Date;
}

export interface AppliedDiscount {
  readonly promotionId: string;
  readonly couponId?: string;
  readonly code?: string;
  readonly title: string;
  readonly discountClass: DiscountClass;
  readonly amountMinor: number;
}

export interface DiscountCodeStatus {
  readonly code: string;
  readonly applicable: boolean;
  readonly reason?: DiscountRejection;
}

export interface LineAllocation {
  readonly lineRef: string;
  readonly amountMinor: number;
}

export interface DiscountResult {
  readonly applied: readonly AppliedDiscount[];
  /** Product + order discounts. */
  readonly orderDiscountMinor: number;
  readonly shippingDiscountMinor: number;
  readonly codeStatuses: readonly DiscountCodeStatus[];
  /** How the product + order discounts split over the lines (for partial refunds). */
  readonly lineAllocations: readonly LineAllocation[];
}

interface Eligible {
  readonly candidate: DiscountCandidate;
  readonly promotionId: string;
  readonly code?: string;
  readonly discountClass: DiscountClass;
  readonly combinesWith: CombinesWith;
}

const CLASS_ORDER: Readonly<Record<DiscountClass, number>> = { product: 0, order: 1, shipping: 2 };

/** Above this many eligible discounts the best set is chosen greedily instead of exhaustively. */
const EXHAUSTIVE_LIMIT = 10;

function percentOf(amountMinor: number, percentage: number): number {
  return Math.floor((amountMinor * Math.round(percentage * 100)) / 10_000);
}

function lineTotal(line: DiscountLine): number {
  return line.unitPriceMinor * line.quantity;
}

function matchingLines(
  lines: readonly DiscountLine[],
  scope: PromotionScope,
  targetRefs: readonly string[],
): readonly DiscountLine[] {
  if (scope === "cart" || targetRefs.length === 0) return lines;
  if (scope === "product") return lines.filter((line) => targetRefs.includes(line.productRef));
  return lines.filter((line) => line.categoryRefs.some((ref) => targetRefs.includes(ref)));
}

function usedBy(coupon: CouponState, customer: DiscountCustomer): boolean {
  const email = customer.email?.toLowerCase();
  return coupon.redemptions.some(
    (r) =>
      (customer.customerRef !== undefined && r.customerRef === customer.customerRef) ||
      (email !== undefined && r.email !== undefined && r.email.toLowerCase() === email),
  );
}

/** What the cart must contain, and the minimum purchase — `null` when satisfied. */
function requirementRejection(
  promotion: Promotion,
  input: CalculateDiscountsInput,
): DiscountRejection | null {
  const { rule } = promotion;
  const { condition, reward } = rule;
  const matched = matchingLines(input.lines, condition.scope, condition.targetRefs);

  if (reward.type === "free_shipping" && input.shipping !== null) {
    if (reward.countries !== undefined && !reward.countries.includes(input.shipping.countryCode)) {
      return "not_eligible";
    }
    if (
      reward.maxShippingRateMinor !== undefined &&
      input.shipping.rateMinor > reward.maxShippingRateMinor
    ) {
      return "not_eligible";
    }
  }

  if (rule.type === "buy_x_get_y") {
    const { buys, gets } = reward;
    if (buys === undefined || gets === undefined) return "no_matching_items";
    if (
      matched.length === 0 ||
      matchingLines(input.lines, gets.scope, gets.targetRefs).length === 0
    ) {
      return "no_matching_items";
    }
    const bought =
      buys.kind === "quantity"
        ? matched.reduce((sum, line) => sum + line.quantity, 0)
        : matched.reduce((sum, line) => sum + lineTotal(line), 0);
    return bought < buys.value ? "minimum_not_met" : null;
  }

  if (promotion.discountClass === "product" && matched.length === 0) return "no_matching_items";
  const base = promotion.discountClass === "product" ? matched : input.lines;
  if (
    condition.minimumSubtotalAmountMinor !== undefined &&
    base.reduce((sum, line) => sum + lineTotal(line), 0) < condition.minimumSubtotalAmountMinor
  ) {
    return "minimum_not_met";
  }
  if (
    condition.minimumQuantity !== undefined &&
    base.reduce((sum, line) => sum + line.quantity, 0) < condition.minimumQuantity
  ) {
    return "minimum_not_met";
  }
  return null;
}

function rejectionFor(
  candidate: DiscountCandidate,
  input: CalculateDiscountsInput,
): DiscountRejection | null {
  const { promotion, coupon } = candidate;
  const now = input.now;

  if (coupon !== undefined) {
    if (coupon.status === "disabled") return "not_found";
    if (coupon.status === "expired") return "expired";
    if (coupon.status === "depleted") return "usage_limit_reached";
    if (coupon.expiresAt !== undefined && now.getTime() >= coupon.expiresAt.getTime()) {
      return "expired";
    }
  }

  switch (promotion.status.value) {
    case "draft":
    case "cancelled":
    case "archived":
      return "not_found";
    case "paused":
    case "expired":
      return "expired";
    case "depleted":
      return "usage_limit_reached";
    case "active":
    case "scheduled":
      break;
  }
  if (now.getTime() < promotion.schedule.startsAt.getTime()) return "not_started";
  if (promotion.schedule.isExpiredAt(now)) return "expired";

  const { customerRefs, segmentRefs } = promotion.eligibility;
  if (customerRefs !== undefined || segmentRefs !== undefined) {
    const ref = input.customer.customerRef;
    if (ref === undefined || customerRefs === undefined || !customerRefs.includes(ref)) {
      return "not_eligible";
    }
  }
  if (
    coupon?.assignedCustomerRef !== undefined &&
    coupon.assignedCustomerRef !== input.customer.customerRef
  ) {
    return "not_eligible";
  }

  if (promotion.usageLimit !== undefined && promotion.usageCount >= promotion.usageLimit) {
    return "usage_limit_reached";
  }
  if (coupon?.usageLimit !== undefined && coupon.usageCount >= coupon.usageLimit) {
    return "usage_limit_reached";
  }
  if (coupon?.oncePerCustomer === true && usedBy(coupon, input.customer)) return "already_used";

  return requirementRejection(promotion, input);
}

/** Splits `total` over the lines in proportion to their amounts; leftover units go to the largest remainders. */
function allocate(
  total: number,
  base: readonly { readonly ref: string; readonly amount: number }[],
): Map<string, number> {
  const result = new Map<string, number>();
  const sum = base.reduce((acc, b) => acc + b.amount, 0);
  if (total <= 0 || sum <= 0) {
    for (const b of base) result.set(b.ref, 0);
    return result;
  }
  const shares = base.map((b, index) => {
    const exact = (total * b.amount) / sum;
    return { ref: b.ref, index, value: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let left = total - shares.reduce((acc, s) => acc + s.value, 0);
  for (const share of [...shares].sort((a, b) => b.fraction - a.fraction || a.index - b.index)) {
    if (left === 0) break;
    share.value += 1;
    left -= 1;
  }
  for (const share of shares) result.set(share.ref, share.value);
  return result;
}

function buyXGetYDiscounts(
  promotion: Promotion,
  lines: readonly DiscountLine[],
  remaining: ReadonlyMap<string, number>,
): Map<string, number> {
  const { rule } = promotion;
  const { buys, gets, maxUsesPerOrder } = rule.reward;
  const result = new Map<string, number>();
  if (buys === undefined || gets === undefined) return result;

  const buysRefs = new Set(
    matchingLines(lines, rule.condition.scope, rule.condition.targetRefs).map((l) => l.lineRef),
  );
  const getsRefs = new Set(matchingLines(lines, gets.scope, gets.targetRefs).map((l) => l.lineRef));
  // One entry per unit, priced at what is left of its line after earlier discounts.
  const units = lines.flatMap((line) => {
    const unitPrice = Math.floor((remaining.get(line.lineRef) ?? 0) / line.quantity);
    return Array.from({ length: line.quantity }, () => ({ ref: line.lineRef, price: unitPrice }));
  });
  const indexes = units.map((_, index) => index);
  const getsOrder = indexes
    .filter((i) => getsRefs.has(units[i]!.ref))
    .sort((a, b) => units[a]!.price - units[b]!.price || a - b);
  const buysOrder = indexes
    .filter((i) => buysRefs.has(units[i]!.ref))
    .sort((a, b) => units[b]!.price - units[a]!.price || a - b);

  const used = new Set<number>();
  const got: number[] = [];
  const maxUses = maxUsesPerOrder ?? Number.POSITIVE_INFINITY;
  let uses = 0;

  if (buys.kind === "amount") {
    const bought = lines
      .filter((line) => buysRefs.has(line.lineRef))
      .reduce((sum, line) => sum + (remaining.get(line.lineRef) ?? 0), 0);
    const free = getsOrder.slice(0, gets.quantity);
    if (bought >= buys.value && maxUses >= 1 && free.length === gets.quantity) got.push(...free);
  } else {
    while (uses < maxUses) {
      const bought = buysOrder.filter((i) => !used.has(i)).slice(0, buys.value);
      if (bought.length < buys.value) break;
      for (const i of bought) used.add(i);
      const free = getsOrder.filter((i) => !used.has(i)).slice(0, gets.quantity);
      if (free.length < gets.quantity) break;
      for (const i of free) {
        used.add(i);
        got.push(i);
      }
      uses += 1;
    }
  }

  for (const i of got) {
    const unit = units[i]!;
    const off = gets.effect.kind === "free" ? unit.price : percentOf(unit.price, gets.effect.value);
    result.set(unit.ref, (result.get(unit.ref) ?? 0) + off);
  }
  for (const [ref, amount] of result) result.set(ref, Math.min(amount, remaining.get(ref) ?? 0));
  return result;
}

/** What one product/order discount takes off each line, given what is left of each line. */
function lineDiscounts(
  promotion: Promotion,
  lines: readonly DiscountLine[],
  remaining: ReadonlyMap<string, number>,
): Map<string, number> {
  const { rule } = promotion;
  if (rule.type === "buy_x_get_y") return buyXGetYDiscounts(promotion, lines, remaining);

  const isProduct = promotion.discountClass === "product";
  const targets = isProduct
    ? matchingLines(lines, rule.condition.scope, rule.condition.targetRefs)
    : lines;
  const base = targets.map((line) => ({
    ref: line.lineRef,
    amount: remaining.get(line.lineRef) ?? 0,
    quantity: line.quantity,
  }));
  const total = base.reduce((sum, b) => sum + b.amount, 0);
  const value = rule.reward.value ?? 0;

  if (rule.reward.type === "percentage") {
    if (isProduct) return new Map(base.map((b) => [b.ref, percentOf(b.amount, value)]));
    return allocate(percentOf(total, value), base);
  }
  // fixed_amount
  if (isProduct && rule.reward.appliesOncePerOrder !== true) {
    return new Map(base.map((b) => [b.ref, Math.min(b.amount, value * b.quantity)]));
  }
  return allocate(Math.min(value, total), base);
}

interface Application {
  readonly applied: readonly AppliedDiscount[];
  readonly allocations: ReadonlyMap<string, number>;
  readonly total: number;
}

/** Applies a compatible set in Shopify's order: product, then order, then shipping. */
function applySet(set: readonly Eligible[], input: CalculateDiscountsInput): Application {
  const remaining = new Map(input.lines.map((line) => [line.lineRef, lineTotal(line)]));
  const allocations = new Map<string, number>();
  let shippingLeft = input.shipping?.rateMinor ?? 0;
  const ordered = [...set].sort(
    (a, b) =>
      CLASS_ORDER[a.discountClass] - CLASS_ORDER[b.discountClass] ||
      a.promotionId.localeCompare(b.promotionId),
  );

  const applied: AppliedDiscount[] = [];
  for (const entry of ordered) {
    let amount = 0;
    if (entry.discountClass === "shipping") {
      amount = shippingLeft;
      shippingLeft = 0;
    } else {
      for (const [ref, off] of lineDiscounts(entry.candidate.promotion, input.lines, remaining)) {
        if (off <= 0) continue;
        remaining.set(ref, (remaining.get(ref) ?? 0) - off);
        allocations.set(ref, (allocations.get(ref) ?? 0) + off);
        amount += off;
      }
    }
    applied.push({
      promotionId: entry.promotionId,
      ...(entry.candidate.coupon === undefined
        ? {}
        : { couponId: entry.candidate.coupon.couponId }),
      ...(entry.code === undefined ? {} : { code: entry.code }),
      title: entry.candidate.promotion.name,
      discountClass: entry.discountClass,
      amountMinor: amount,
    });
  }
  return { applied, allocations, total: applied.reduce((sum, a) => sum + a.amountMinor, 0) };
}

function isCompatible(set: readonly Eligible[]): boolean {
  for (let i = 0; i < set.length; i += 1) {
    for (let j = i + 1; j < set.length; j += 1) {
      if (!canCombine(set[i]!, set[j]!)) return false;
    }
  }
  return true;
}

/** Larger saving wins; then more entered codes; then the earlier-created discounts. */
function isBetter(
  a: Application & { set: readonly Eligible[] },
  b: Application & { set: readonly Eligible[] },
): boolean {
  if (a.total !== b.total) return a.total > b.total;
  const codesA = a.set.filter((e) => e.code !== undefined).length;
  const codesB = b.set.filter((e) => e.code !== undefined).length;
  if (codesA !== codesB) return codesA > codesB;
  const key = (s: readonly Eligible[]) =>
    s
      .map((e) => e.promotionId)
      .sort()
      .join("|");
  return key(a.set) < key(b.set);
}

function bestSet(
  eligible: readonly Eligible[],
  input: CalculateDiscountsInput,
): Application & { set: readonly Eligible[] } {
  let best: Application & { set: readonly Eligible[] } = { ...applySet([], input), set: [] };
  if (eligible.length <= EXHAUSTIVE_LIMIT) {
    for (let mask = 1; mask < 1 << eligible.length; mask += 1) {
      const set = eligible.filter((_, i) => (mask & (1 << i)) !== 0);
      if (!isCompatible(set)) continue;
      const candidate = { ...applySet(set, input), set };
      if (isBetter(candidate, best)) best = candidate;
    }
    return best;
  }
  const bySaving = [...eligible].sort(
    (a, b) => applySet([b], input).total - applySet([a], input).total,
  );
  const set: Eligible[] = [];
  for (const entry of bySaving) {
    if (isCompatible([...set, entry])) set.push(entry);
  }
  return { ...applySet(set, input), set };
}

/**
 * Decides which discounts a cart gets and how much each one takes off — pure, no I/O. Codes are
 * matched to their coupons; automatic promotions apply on their own; a promotion reached only by
 * code never applies without it. Among the eligible discounts, the compatible set that saves the
 * most wins (spec "The calculation").
 */
export function calculateDiscounts(input: CalculateDiscountsInput): DiscountResult {
  const codes = [...new Set(input.enteredCodes.map(normalizeDiscountCode))].filter((c) => c !== "");
  const activeCodes = codes.slice(0, MAX_DISCOUNT_CODES);

  const rejections = new Map<string, DiscountRejection>();
  const eligible: Eligible[] = [];
  for (const candidate of input.candidates) {
    const code =
      candidate.coupon === undefined ? undefined : normalizeDiscountCode(candidate.coupon.code);
    if (code !== undefined && !activeCodes.includes(code)) continue;
    if (code === undefined && candidate.promotion.method !== "automatic") continue;
    const reason = rejectionFor(candidate, input);
    if (reason !== null) {
      if (code !== undefined) rejections.set(code, reason);
      continue;
    }
    eligible.push({
      candidate,
      promotionId: candidate.promotion.id.toString(),
      ...(code === undefined ? {} : { code }),
      discountClass: candidate.promotion.discountClass,
      combinesWith: candidate.promotion.combinesWith,
    });
  }

  const best = bestSet(eligible, input);
  const chosenCodes = new Set(
    best.set.map((e) => e.code).filter((c): c is string => c !== undefined),
  );
  const applied = best.applied.filter((a) => a.code !== undefined || a.amountMinor > 0);

  const codeStatuses: DiscountCodeStatus[] = codes.map((code, index) => {
    if (index >= MAX_DISCOUNT_CODES) return { code, applicable: false, reason: "too_many_codes" };
    if (chosenCodes.has(code)) return { code, applicable: true };
    const rejection = rejections.get(code);
    if (rejection !== undefined) return { code, applicable: false, reason: rejection };
    const known = eligible.some((e) => e.code === code);
    return { code, applicable: false, reason: known ? "cannot_combine" : "not_found" };
  });

  return {
    applied,
    orderDiscountMinor: applied
      .filter((a) => a.discountClass !== "shipping")
      .reduce((sum, a) => sum + a.amountMinor, 0),
    shippingDiscountMinor: applied
      .filter((a) => a.discountClass === "shipping")
      .reduce((sum, a) => sum + a.amountMinor, 0),
    codeStatuses,
    lineAllocations: input.lines
      .map((line) => ({
        lineRef: line.lineRef,
        amountMinor: best.allocations.get(line.lineRef) ?? 0,
      }))
      .filter((allocation) => allocation.amountMinor > 0),
  };
}
```

- [ ] **Step 4: Export from `services/promotions/src/index.ts`** — append:

```ts
export {
  calculateDiscounts,
  MAX_DISCOUNT_CODES,
  normalizeDiscountCode,
  type AppliedDiscount,
  type CalculateDiscountsInput,
  type CouponState,
  type DiscountCandidate,
  type DiscountCodeStatus,
  type DiscountCustomer,
  type DiscountLine,
  type DiscountRejection,
  type DiscountResult,
  type DiscountShipping,
  type LineAllocation,
} from "./domain/discount-calculator";
export {
  COMBINES_WITH_EVERYTHING,
  COMBINES_WITH_NOTHING,
  type CombinesWith,
  type DiscountClass,
  type DiscountMethod,
} from "./domain/value-objects/discount-settings";
export type {
  BuyXGetYBuys,
  BuyXGetYGets,
  PromotionRewardProps,
  PromotionRewardType,
  PromotionRuleType,
  PromotionScope,
} from "./domain/value-objects/promotion-rule";
export type { PromotionView } from "./domain/promotion";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @platform/promotions exec vitest run src/domain`
Expected: PASS. If a combination test fails, re-check `applySet`'s ordering and `isBetter` before touching the test — the expected numbers in the tests are the spec.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @platform/promotions exec tsc --noEmit` — Expected: no output.

```bash
git add services/promotions/src/domain/discount-calculator.ts services/promotions/src/domain/discount-calculator.test.ts services/promotions/src/index.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -m "feat(promotions): pure discount calculator for the four shopify types" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Promotions persistence, use cases and migration

**Files:**

- Modify: `packages/db/prisma/schema/promotions.prisma`
- Create: `packages/db/prisma/schema/migrations/20261016000000_discount_settings/migration.sql`
- Modify: `services/promotions/src/domain/promotion-repository.ts`
- Modify: `services/promotions/src/infrastructure/promotion.mapper.ts`
- Modify: `services/promotions/src/infrastructure/prisma-promotion-repository.ts`
- Modify: `services/promotions/src/infrastructure/in-memory-promotion-repository.ts`
- Modify: `services/promotions/src/application/promotion.use-cases.ts`
- Modify: `services/promotions/src/interfaces/promotions.controller.ts`
- Modify: `services/promotions/src/composition.ts`
- Test: `services/promotions/src/application/discount-use-cases.test.ts` (create)

**Interfaces:**

- Consumes (Task 1): `PromotionSettings`, `PromotionChanges`, `PromotionView`, `CombinesWith`, `DiscountMethod`, `PromotionRewardProps`.
- Produces:
  - `PromotionRepository.findActiveAutomatic(tenantId, tx?): Promise<readonly Promotion[]>`
  - `PromotionRepository.listForAdmin(query: AdminPromotionQuery, tenantId, tx?): Promise<Paginated<Promotion>>` with `export interface AdminPromotionQuery extends CursorPage { readonly view: "all" | "active" | "scheduled" | "expired"; readonly search?: string; readonly alsoIds?: readonly string[]; readonly now: Date }`
  - `CreatePromotionInput` gains `method?`, `combinesWith?`, `appliesOncePerOrder?`, `countries?`, `maxShippingRateMinor?`, `buys?`, `gets?`, `maxUsesPerOrder?`; `rewardType` accepts `"buy_x_get_y"`.
  - `UpdatePromotionInput = Omit<CreatePromotionInput, "method" | "campaignRef"> & { promotionId: string }`
  - `PromotionsController.update(input)` (200, `{ promotionId, status }`), `.listActiveAutomatic({ tenantId })` (200, `{ items: Promotion[] }`), `.listForAdmin({ tenantId, view, search?, alsoIds?, first?, after? })` (200, `Paginated<Promotion>`).

- [ ] **Step 1: Write the failing tests** — create `services/promotions/src/application/discount-use-cases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { Paginated } from "@platform/types";
import { wirePromotions } from "../composition";
import type { Promotion } from "../domain/promotion";

const TENANT = "tenant-1";
const clock: Clock = { now: () => new Date("2026-10-16T12:00:00.000Z") };

function build() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `0000000${(n += 1)}`.slice(-8) };
  return wirePromotions({ serializer: new InMemoryEventSerializer(), idGenerator, clock })
    .promotions;
}

const base = {
  tenantId: TENANT,
  ruleType: "automatic" as const,
  scope: "cart" as const,
  targetRefs: [],
  rewardType: "percentage" as const,
  rewardValue: 10,
  stackable: false,
  priority: 0,
  startsAt: new Date("2026-01-01T00:00:00.000Z"),
};

async function create(controller: ReturnType<typeof build>, overrides: Record<string, unknown>) {
  const response = await controller.create({ ...base, name: "x", ...overrides } as never);
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  const { promotionId } = response.body as { promotionId: string };
  await controller.advance({ tenantId: TENANT, promotionId, toStatus: "active" });
  return promotionId;
}

describe("promotions — discount use cases (Phase 2)", () => {
  it("lists only automatic, active promotions for checkout", async () => {
    const c = build();
    const auto = await create(c, { name: "Auto", method: "automatic" });
    await create(c, { name: "CODE10", method: "code" });
    const response = await c.listActiveAutomatic({ tenantId: TENANT });
    const { items } = response.body as { items: readonly Promotion[] };
    expect(items.map((p) => p.id.toString())).toEqual([auto]);
  });

  it("updates a discount and keeps its new settings", async () => {
    const c = build();
    const id = await create(c, { name: "Auto", method: "automatic" });
    const response = await c.update({
      ...base,
      promotionId: id,
      name: "Autumn",
      rewardValue: 20,
      combinesWith: { product: true, order: false, shipping: true },
    });
    expect(response.status).toBe(200);
    const promotion = (await c.get({ tenantId: TENANT, promotionId: id })).body as Promotion;
    expect(promotion.name).toBe("Autumn");
    expect(promotion.rule.reward.value).toBe(20);
    expect(promotion.combinesWith).toEqual({ product: true, order: false, shipping: true });
  });

  it("refuses an update that changes the type", async () => {
    const c = build();
    const id = await create(c, { method: "automatic" });
    const response = await c.update({
      ...base,
      promotionId: id,
      name: "x",
      rewardType: "free_shipping",
    });
    expect(response.status).toBe(409);
  });

  it("filters the admin list by view and search, newest first, never archived", async () => {
    const c = build();
    const a = await create(c, { name: "Alpha" });
    const b = await create(c, { name: "Beta", startsAt: new Date("2027-01-01T00:00:00.000Z") });
    const d = await create(c, { name: "Delta" });
    await c.advance({ tenantId: TENANT, promotionId: d, toStatus: "archived" });

    const list = async (input: Record<string, unknown>) =>
      (
        (await c.listForAdmin({ tenantId: TENANT, view: "all", ...input } as never))
          .body as Paginated<Promotion>
      ).items.map((p) => p.id.toString());
    expect(await list({})).toEqual([b, a]);
    expect(await list({ view: "active" })).toEqual([a]);
    expect(await list({ view: "scheduled" })).toEqual([b]);
    expect(await list({ search: "alp" })).toEqual([a]);
    expect(await list({ search: "zzz", alsoIds: [b] })).toEqual([b]);
  });

  it("keeps the minimum purchase and the customer list it was created with", async () => {
    const c = build();
    const id = await create(c, { minimumSubtotalAmountMinor: 20_000, customerRefs: ["c-1"] });
    const promotion = (await c.get({ tenantId: TENANT, promotionId: id })).body as Promotion;
    expect(promotion.rule.condition.minimumSubtotalAmountMinor).toBe(20_000);
    expect(promotion.eligibility.customerRefs).toEqual(["c-1"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @platform/promotions exec vitest run src/application/discount-use-cases.test.ts`
Expected: FAIL — `listActiveAutomatic` / `update` / `listForAdmin` are not functions.

- [ ] **Step 3: Repository port** — in `services/promotions/src/domain/promotion-repository.ts` add:

```ts
/** The admin Discounts list's query (Phase 2): Shopify's tabs, search by title, plus ids found by code. */
export interface AdminPromotionQuery extends CursorPage {
  readonly view: "all" | "active" | "scheduled" | "expired";
  /** Case-insensitive part of the title. */
  readonly search?: string;
  /** Promotions to include whatever their title — the ones whose code matched the search. */
  readonly alsoIds?: readonly string[];
  readonly now: Date;
}
```

and to the interface:

```ts
  /** Active promotions applied without a code — what checkout evaluates automatically. */
  findActiveAutomatic(tenantId: string, tx?: unknown): Promise<readonly Promotion[]>;
  /** Newest first; never archived. */
  listForAdmin(query: AdminPromotionQuery, tenantId: string, tx?: unknown): Promise<Paginated<Promotion>>;
```

- [ ] **Step 4: In-memory repository** — in `in-memory-promotion-repository.ts` add:

```ts
  async findActiveAutomatic(tenantId: string): Promise<readonly Promotion[]> {
    return [...bucketFor(this.store, tenantId).values()].filter(
      (p) => p.status.value === "active" && p.method === "automatic",
    );
  }

  async listForAdmin(query: AdminPromotionQuery, tenantId: string): Promise<Paginated<Promotion>> {
    const search = query.search?.trim().toLowerCase();
    const all = [...bucketFor(this.store, tenantId).values()]
      .filter((p) => p.viewAt(query.now) !== "archived")
      .filter((p) => query.view === "all" || p.viewAt(query.now) === query.view)
      .filter(
        (p) =>
          search === undefined ||
          search === "" ||
          p.name.toLowerCase().includes(search) ||
          (query.alsoIds ?? []).includes(p.id.toString()),
      )
      .sort((a, b) => b.id.toString().localeCompare(a.id.toString()));
    const after = query.after !== undefined ? decodeCursor(query.after) : undefined;
    const start = after === undefined ? 0 : all.findIndex((p) => p.id.toString() < after);
    const limit = normalizePageSize(query.first);
    const window = start < 0 ? [] : all.slice(start, start + limit + 1);
    return buildPaginatedPage(window, limit, (p) => p.id.toString());
  }
```

(import `type AdminPromotionQuery` from `../domain/promotion-repository`.)

- [ ] **Step 5: Prisma schema and migration**

In `packages/db/prisma/schema/promotions.prisma`, inside `model Promotion`, after `status`:

```prisma
  method                      String? // Phase 2: code | automatic. NULL = created before Phase 2, reachable only through its coupon.
  discountClass               String?   @map("discount_class") // product | order | shipping (derived from the rule when NULL)
  combinesWith                Json?     @map("combines_with") // { product, order, shipping } (derived from stackable when NULL)
```

and next to the other indexes:

```prisma
  @@index([tenantId, method, status])
```

Create `packages/db/prisma/schema/migrations/20261016000000_discount_settings/migration.sql`:

```sql
-- Phase 2 (Shopify-style discounts) — how a promotion reaches a cart and what it combines with.
-- Written by hand, NOT applied by the agent; the owner deploys it BEFORE the release that reads
-- these columns. Additive and nullable: existing rows keep working (NULL method = reachable only
-- through its coupon; class and combinations are derived in the mapper), so no backfill is needed.
ALTER TABLE "promotions"."promotions" ADD COLUMN "method" TEXT;
ALTER TABLE "promotions"."promotions" ADD COLUMN "discount_class" TEXT;
ALTER TABLE "promotions"."promotions" ADD COLUMN "combines_with" JSONB;
CREATE INDEX "promotions_tenant_id_method_status_idx" ON "promotions"."promotions"("tenant_id", "method", "status");
```

Run: `pnpm --filter @platform/db exec prisma validate` then `pnpm --filter @platform/db exec prisma generate`
Expected: "The schema ... is valid" and "Generated Prisma Client".

- [ ] **Step 6: Mapper** — in `services/promotions/src/infrastructure/promotion.mapper.ts`:

Add imports:

```ts
import {
  COMBINES_WITH_EVERYTHING,
  COMBINES_WITH_NOTHING,
  type CombinesWith,
  type DiscountMethod,
} from "../domain/value-objects/discount-settings";
import type { PromotionRewardProps } from "../domain/value-objects/promotion-rule";
```

Add to `PromotionRow`:

```ts
  /** Phase 2 reward fields (buy X get Y, free shipping, once per order); absent on older rows. */
  readonly rewardExtras?: Omit<PromotionRewardProps, "type" | "value" | "buyQuantity" | "getQuantity">;
  readonly method: DiscountMethod | null;
  readonly combinesWith: CombinesWith | null;
```

In `toDomain`, build the reward with `...row.rewardExtras` spread after `getQuantity`, and call `Promotion.reconstitute(..., row.version, { method: row.method ?? undefined, combinesWith: row.combinesWith ?? (row.stackable ? COMBINES_WITH_EVERYTHING : COMBINES_WITH_NOTHING) })`.

Replace `toRow` with:

```ts
  static toRow(promotion: Promotion, tenantId: string) {
    const { condition, reward } = promotion.rule;
    return {
      id: promotion.id.toString(),
      tenantId,
      name: promotion.name,
      ruleType: promotion.rule.type,
      scope: condition.scope,
      targetRefs: [...condition.targetRefs],
      minimumQuantity: condition.minimumQuantity ?? null,
      minimumSubtotalAmountMinor: condition.minimumSubtotalAmountMinor ?? null,
      reward: JSON.parse(JSON.stringify(reward.toProps())) as Record<string, unknown>,
      stackable: promotion.rule.stackable,
      priority: promotion.rule.priority,
      startsAt: promotion.schedule.startsAt,
      endsAt: promotion.schedule.endsAt ?? null,
      customerRefs: promotion.eligibility.customerRefs ?? null,
      segmentRefs: promotion.eligibility.segmentRefs ?? null,
      campaignRef: promotion.campaign.campaignRef ?? null,
      usageLimit: promotion.usageLimit ?? null,
      usageCount: promotion.usageCount,
      status: promotion.status.value,
      method: promotion.method ?? null,
      discountClass: promotion.discountClass,
      combinesWith: { ...promotion.combinesWith },
      version: 1,
    };
  }
```

(`JSON.parse(JSON.stringify(...))` drops `undefined` keys so the JSONB holds only what is set.)

- [ ] **Step 7: Prisma repository** — in `prisma-promotion-repository.ts`:

Add `import { Prisma } from "@prisma/client";` and a helper:

```ts
function jsonOrDbNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}
```

Replace the body of `save`'s create and update branches with:

```ts
const data = {
  name: row.name,
  ruleType: row.ruleType,
  scope: row.scope,
  targetRefs: row.targetRefs,
  minimumQuantity: row.minimumQuantity,
  minimumSubtotalAmountMinor: row.minimumSubtotalAmountMinor,
  reward: row.reward as Prisma.InputJsonValue,
  stackable: row.stackable,
  priority: row.priority,
  startsAt: row.startsAt,
  endsAt: row.endsAt,
  customerRefs: jsonOrDbNull(row.customerRefs),
  segmentRefs: jsonOrDbNull(row.segmentRefs),
  campaignRef: row.campaignRef,
  usageLimit: row.usageLimit,
  usageCount: row.usageCount,
  status: row.status,
  method: row.method,
  discountClass: row.discountClass,
  combinesWith: row.combinesWith as Prisma.InputJsonValue,
};
if (promotion.version === 0) {
  await client.promotion.create({ data: { id: row.id, tenantId, ...data } });
} else {
  const updated = await client.promotion.updateMany({
    where: { id: promotionId, tenantId, version: promotion.version },
    data: { ...data, version: { increment: 1 } },
  });
  if (updated.count === 0) {
    throw new ConcurrencyError(
      `Promotion ${promotionId} was modified concurrently (expected version ${promotion.version})`,
    );
  }
}
```

Add the two queries:

```ts
  async findActiveAutomatic(tenantId: string, tx?: unknown): Promise<readonly Promotion[]> {
    const rows = await readScoped(this.deps.prisma, tenantId, tx, (client) =>
      client.promotion.findMany({ where: { tenantId, status: "active", method: "automatic" } }),
    );
    return rows.map((row) => PromotionMapper.toDomain(this.toMapperRow(row)));
  }

  async listForAdmin(
    query: AdminPromotionQuery,
    tenantId: string,
    tx?: unknown,
  ): Promise<Paginated<Promotion>> {
    const after = query.after !== undefined ? decodeCursor(query.after) : undefined;
    const limit = normalizePageSize(query.first);
    const now = query.now;
    const view: Prisma.PromotionWhereInput =
      query.view === "active"
        ? { status: "active", startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }
        : query.view === "scheduled"
          ? { status: { in: ["active", "scheduled"] }, startsAt: { gt: now } }
          : query.view === "expired"
            ? {
                OR: [
                  { status: { in: ["draft", "paused", "expired", "depleted", "cancelled"] } },
                  { endsAt: { lte: now } },
                ],
              }
            : {};
    const search = query.search?.trim();
    const where: Prisma.PromotionWhereInput = {
      AND: [
        { tenantId, status: { not: "archived" } },
        view,
        ...(search === undefined || search === ""
          ? []
          : [
              {
                OR: [
                  { name: { contains: search, mode: "insensitive" as const } },
                  { id: { in: [...(query.alsoIds ?? [])] } },
                ],
              },
            ]),
        ...(after === undefined ? [] : [{ id: { lt: after } }]),
      ],
    };
    const rows = await readScoped(this.deps.prisma, tenantId, tx, (client) =>
      client.promotion.findMany({ where, orderBy: { id: "desc" }, take: limit + 1 }),
    );
    return buildPaginatedPage(
      rows.map((row) => PromotionMapper.toDomain(this.toMapperRow(row))),
      limit,
      (p) => p.id.toString(),
    );
  }
```

Extend `toMapperRow`'s parameter with `readonly method: string | null; readonly combinesWith: unknown;` and return, besides the existing fields:

```ts
      rewardExtras: {
        appliesOncePerOrder: reward.appliesOncePerOrder,
        countries: reward.countries,
        maxShippingRateMinor: reward.maxShippingRateMinor,
        buys: reward.buys,
        gets: reward.gets,
        maxUsesPerOrder: reward.maxUsesPerOrder,
      },
      method: row.method as PromotionRow["method"],
      combinesWith: row.combinesWith as PromotionRow["combinesWith"],
```

where the `reward` cast becomes `row.reward as PromotionRewardProps` (import the type).

- [ ] **Step 8: Use cases** — in `promotion.use-cases.ts`:

Extend `CreatePromotionInput` (the `rewardType` type already widens through `PromotionRewardType`):

```ts
  /** Phase 2. Absent = automatic for new callers of the platform-tools API. */
  readonly method?: DiscountMethod;
  readonly combinesWith?: CombinesWith;
  readonly appliesOncePerOrder?: boolean;
  readonly countries?: readonly string[];
  readonly maxShippingRateMinor?: number;
  readonly buys?: BuyXGetYBuys;
  readonly gets?: BuyXGetYGets;
  readonly maxUsesPerOrder?: number;
```

Extract the validation part of `CreatePromotion.execute` into a shared function and use it from both create and update:

```ts
type PromotionParts = {
  readonly rule: PromotionRule;
  readonly schedule: PromotionSchedule;
  readonly eligibility: CustomerEligibility;
};

function buildPromotionParts(
  input: Omit<CreatePromotionInput, "tenantId" | "method" | "campaignRef">,
): Result<PromotionParts, DomainError> {
  const name = Guard.againstEmpty(input.name, "name");
  if (!name.ok) return err(name.error);
  const condition = PromotionCondition.create({
    scope: input.scope,
    targetRefs: input.targetRefs,
    minimumQuantity: input.minimumQuantity,
    minimumSubtotalAmountMinor: input.minimumSubtotalAmountMinor,
  });
  const reward = PromotionReward.create({
    type: input.rewardType,
    value: input.rewardValue,
    buyQuantity: input.buyQuantity,
    getQuantity: input.getQuantity,
    appliesOncePerOrder: input.appliesOncePerOrder,
    countries: input.countries,
    maxShippingRateMinor: input.maxShippingRateMinor,
    buys: input.buys,
    gets: input.gets,
    maxUsesPerOrder: input.maxUsesPerOrder,
  });
  if (!reward.ok) return err(reward.error);
  const rule = PromotionRule.create(
    input.ruleType,
    condition,
    reward.value,
    input.stackable,
    input.priority,
  );
  if (!rule.ok) return err(rule.error);
  if (input.endsAt !== undefined && input.endsAt.getTime() <= input.startsAt.getTime()) {
    return err(
      new ValidationError("Invalid promotion schedule", [
        { field: "endsAt", message: "must be after startsAt" },
      ]),
    );
  }
  return ok({
    rule: rule.value,
    schedule: PromotionSchedule.create(input.startsAt, input.endsAt),
    eligibility:
      input.customerRefs === undefined && input.segmentRefs === undefined
        ? CustomerEligibility.everyone()
        : CustomerEligibility.create({
            customerRefs: input.customerRefs,
            segmentRefs: input.segmentRefs,
          }),
  });
}
```

`CreatePromotion.execute` becomes: `const parts = buildPromotionParts(input); if (!parts.ok) return err(parts.error);` then inside the unit of work `Promotion.create(id, input.name, parts.value.rule, parts.value.schedule, parts.value.eligibility, PromotionCampaign.create(input.campaignRef), input.usageLimit, { method: input.method, combinesWith: input.combinesWith })`.

Add:

```ts
export type UpdatePromotionInput = Omit<CreatePromotionInput, "method" | "campaignRef"> & {
  readonly promotionId: string;
};

/** Applies the merchant's edits to a discount (Phase 2). Type and method never change. */
export class UpdatePromotion implements UseCase<
  UpdatePromotionInput,
  PromotionStatusOutput,
  DomainError
> {
  private readonly deps: PromotionDeps;

  constructor(deps: PromotionDeps) {
    this.deps = deps;
  }

  async execute(input: UpdatePromotionInput): Promise<Result<PromotionStatusOutput, DomainError>> {
    const parts = buildPromotionParts(input);
    if (!parts.ok) return err(parts.error);
    return this.deps.unitOfWork.run<Result<PromotionStatusOutput, DomainError>>(async (tx) => {
      const promotion = await this.deps.promotions.findById(input.promotionId, input.tenantId, tx);
      if (promotion === null) return err(new NotFoundError("Promotion not found"));
      try {
        promotion.update({
          name: input.name,
          ...parts.value,
          usageLimit: input.usageLimit,
          combinesWith: input.combinesWith ?? promotion.combinesWith,
        });
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.promotions.save(promotion, input.tenantId, tx);
      return ok({ promotionId: promotion.id.toString(), status: promotion.status.value });
    });
  }
}

/** The automatic promotions checkout evaluates on every cart (Phase 2). */
export class ListActiveAutomaticPromotions implements UseCase<
  { readonly tenantId: string },
  { readonly items: readonly Promotion[] },
  DomainError
> {
  private readonly deps: Pick<PromotionDeps, "promotions">;

  constructor(deps: Pick<PromotionDeps, "promotions">) {
    this.deps = deps;
  }

  async execute(input: { readonly tenantId: string }) {
    return ok({ items: await this.deps.promotions.findActiveAutomatic(input.tenantId) });
  }
}

export interface ListPromotionsForAdminInput extends CursorPage {
  readonly tenantId: string;
  readonly view: AdminPromotionQuery["view"];
  readonly search?: string;
  readonly alsoIds?: readonly string[];
}

/** The admin Discounts list (Phase 2): Shopify's tabs and search, newest first. */
export class ListPromotionsForAdmin implements UseCase<
  ListPromotionsForAdminInput,
  Paginated<Promotion>,
  DomainError
> {
  private readonly deps: Pick<PromotionDeps, "promotions" | "clock">;

  constructor(deps: Pick<PromotionDeps, "promotions" | "clock">) {
    this.deps = deps;
  }

  async execute(
    input: ListPromotionsForAdminInput,
  ): Promise<Result<Paginated<Promotion>, DomainError>> {
    const { tenantId, ...query } = input;
    return ok(
      await this.deps.promotions.listForAdmin({ ...query, now: this.deps.clock.now() }, tenantId),
    );
  }
}
```

(imports: `type CursorPage, type Paginated` from `@platform/types`; `type AdminPromotionQuery` from the repository file; `type BuyXGetYBuys, type BuyXGetYGets` from `promotion-rule`; `type CombinesWith, type DiscountMethod` from `discount-settings`.)

- [ ] **Step 9: Controller and composition** — in `promotions.controller.ts` add deps `updatePromotion: UpdatePromotion; listActiveAutomatic: ListActiveAutomaticPromotions; listForAdmin: ListPromotionsForAdmin;` and methods:

```ts
  async update(input: UpdatePromotionInput): Promise<ControllerResponse> {
    return present(await this.deps.updatePromotion.execute(input), 200);
  }

  async listActiveAutomatic(input: { readonly tenantId: string }): Promise<ControllerResponse> {
    return present(await this.deps.listActiveAutomatic.execute(input), 200);
  }

  async listForAdmin(input: ListPromotionsForAdminInput): Promise<ControllerResponse> {
    return present(await this.deps.listForAdmin.execute(input), 200);
  }
```

In `composition.ts` `buildController`, add:

```ts
    updatePromotion: new UpdatePromotion(promotionDeps),
    listActiveAutomatic: new ListActiveAutomaticPromotions({ promotions }),
    listForAdmin: new ListPromotionsForAdmin({ promotions, clock: deps.clock }),
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `pnpm --filter @platform/promotions exec vitest run`
Expected: PASS (all files; the Prisma integration test is skipped without a database, as before).

- [ ] **Step 11: Typecheck and commit**

Run: `pnpm --filter @platform/promotions exec tsc --noEmit` — Expected: no output.

```bash
git add packages/db/prisma/schema/promotions.prisma packages/db/prisma/schema/migrations/20261016000000_discount_settings services/promotions/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -m "feat(promotions): persist discount settings, admin list and automatic lookup" -m "Fixes the mapper dropping the minimum purchase and customer list on save." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Coupons — editable codes, guest emails, lookups

**Files:**

- Modify: `services/coupons/src/domain/coupon-redemption.ts`
- Modify: `services/coupons/src/domain/coupon.ts`
- Modify: `services/coupons/src/domain/coupon-repository.ts`
- Modify: `services/coupons/src/infrastructure/coupon.mapper.ts`
- Modify: `services/coupons/src/infrastructure/prisma-coupon-repository.ts`
- Modify: `services/coupons/src/infrastructure/in-memory-coupon-repository.ts`
- Modify: `services/coupons/src/application/coupon.use-cases.ts`
- Modify: `services/coupons/src/interfaces/coupons.controller.ts`
- Modify: `services/coupons/src/composition.ts`
- Test: `services/coupons/src/application/discount-code-use-cases.test.ts` (create)

**Interfaces:**

- Produces:
  - `CouponRedemption.email?: string`; `Coupon.redeem(idempotencyKey, customerRef, occurredAt, eventId, orderRef?, email?)` — once-per-customer also matches the email, case-insensitively.
  - `Coupon.reconfigure({ code: CouponCode; multiUse: boolean; usageLimit?: number }): void`
  - `CouponRepository.findByPromotionRefs(refs, tenantId, tx?)`, `.findPromotionRefsByCode(fragment, tenantId, tx?): Promise<readonly string[]>`
  - `RedeemCouponInput.email?: string`
  - `CouponsController.getByCode({ tenantId, code })` (200 `Coupon` | 404), `.listByPromotionRefs({ tenantId, promotionRefs })` (200 `{ items: Coupon[] }`), `.findPromotionRefsByCode({ tenantId, fragment })` (200 `{ promotionRefs: string[] }`), `.reconfigure({ tenantId, couponId, code, multiUse, usageLimit? })` (200 `{ couponId, status }`; 409 when the code is taken).

- [ ] **Step 1: Write the failing tests** — create `services/coupons/src/application/discount-code-use-cases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireCoupons } from "../composition";
import type { Coupon } from "../domain/coupon";

const TENANT = "tenant-1";
const clock: Clock = { now: () => new Date("2026-10-16T12:00:00.000Z") };

function build() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  return wireCoupons({ serializer: new InMemoryEventSerializer(), idGenerator, clock }).coupons;
}

async function create(
  c: ReturnType<typeof build>,
  code: string,
  promotionRef: string,
  multiUse = true,
) {
  const response = await c.create({ tenantId: TENANT, code, promotionRef, multiUse });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  return (response.body as { couponId: string }).couponId;
}

describe("coupons — discount code use cases (Phase 2)", () => {
  it("finds a coupon by its normalised code", async () => {
    const c = build();
    await create(c, "SALE10", "p-1");
    const response = await c.getByCode({ tenantId: TENANT, code: " sale10 " });
    expect(response.status).toBe(200);
    expect((response.body as Coupon).promotionRef).toBe("p-1");
    expect((await c.getByCode({ tenantId: TENANT, code: "NOPE" })).status).toBe(404);
  });

  it("lists the coupons of several promotions and finds promotions by part of a code", async () => {
    const c = build();
    await create(c, "SALE10", "p-1");
    await create(c, "WINTER", "p-2");
    const listed = await c.listByPromotionRefs({ tenantId: TENANT, promotionRefs: ["p-2"] });
    expect((listed.body as { items: Coupon[] }).items.map((x) => x.code.value)).toEqual(["WINTER"]);
    const found = await c.findPromotionRefsByCode({ tenantId: TENANT, fragment: "sal" });
    expect((found.body as { promotionRefs: string[] }).promotionRefs).toEqual(["p-1"]);
  });

  it("changes the code and limits, refusing a code already in use", async () => {
    const c = build();
    const id = await create(c, "SALE10", "p-1");
    await create(c, "TAKEN", "p-2");
    const ok = await c.reconfigure({
      tenantId: TENANT,
      couponId: id,
      code: "SALE15",
      multiUse: false,
      usageLimit: 5,
    });
    expect(ok.status).toBe(200);
    const coupon = (await c.getByCode({ tenantId: TENANT, code: "SALE15" })).body as Coupon;
    expect(coupon.multiUse).toBe(false);
    expect(coupon.usageLimit).toBe(5);
    const taken = await c.reconfigure({
      tenantId: TENANT,
      couponId: id,
      code: "TAKEN",
      multiUse: false,
    });
    expect(taken.status).toBe(409);
  });

  it("treats the same guest email in any case as the same customer (Review Focus 4)", async () => {
    const c = build();
    await create(c, "ONCE", "p-1", false);
    const first = await c.redeem({
      tenantId: TENANT,
      code: "ONCE",
      customerRef: "guest-a",
      email: "Ali@Example.com",
      idempotencyKey: "order-1",
    });
    expect(first.status).toBe(200);
    const second = await c.redeem({
      tenantId: TENANT,
      code: "ONCE",
      customerRef: "guest-b",
      email: "ali@example.COM",
      idempotencyKey: "order-2",
    });
    expect(second.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @platform/coupons exec vitest run src/application/discount-code-use-cases.test.ts`
Expected: FAIL — `getByCode is not a function`.

- [ ] **Step 3: Domain** —

`coupon-redemption.ts`: add `readonly email?: string;` to the props, an `email?: string` last parameter to `create` (passed into props as `...(email === undefined ? {} : { email })`), and `get email(): string | undefined`.

`coupon.ts`: make `code`, `multiUse` and `usageLimit` in `CouponProps` mutable (drop `readonly`). Change `redeem`'s signature to `redeem(idempotencyKey, customerRef, occurredAt, eventId, orderRef?: string, email?: string)`, replace its once-per-customer check with:

```ts
const normalizedEmail = email?.toLowerCase();
if (
  !this.props.multiUse &&
  this.props.redemptions.some(
    (r) =>
      r.customerRef === customerRef ||
      (normalizedEmail !== undefined && r.email?.toLowerCase() === normalizedEmail),
  )
) {
  throw new BusinessRuleError("Coupon has already been redeemed by this customer");
}
```

pass `email` as the last argument of `CouponRedemption.create`, and add:

```ts
  /**
   * The merchant's edits to a discount code (Phase 2): the code itself, one-use-per-customer and the
   * total limit. Uniqueness of the new code is the use case's job (it needs the repository).
   */
  reconfigure(changes: { readonly code: CouponCode; readonly multiUse: boolean; readonly usageLimit?: number }): void {
    this.props.code = changes.code;
    this.props.multiUse = changes.multiUse;
    this.props.usageLimit = changes.usageLimit;
  }
```

`coupon-repository.ts` — add to the interface:

```ts
  /** Every coupon authorising one of these promotions (the admin Discounts list). */
  findByPromotionRefs(promotionRefs: readonly string[], tenantId: string, tx?: unknown): Promise<readonly Coupon[]>;
  /** The promotions whose code contains `fragment` (case-insensitive), at most 50. */
  findPromotionRefsByCode(fragment: string, tenantId: string, tx?: unknown): Promise<readonly string[]>;
```

- [ ] **Step 4: Infrastructure** —

`coupon.mapper.ts`: add `readonly email?: string;` to `CouponRedemptionJson`; pass `r.email` as the last argument of `CouponRedemption.create` in `toDomain`; in `toRow` add `...(r.email === undefined ? {} : { email: r.email })` to each redemption.

`prisma-coupon-repository.ts`: in `save`'s update branch add `code: row.code, multiUse: row.multiUse, usageLimit: row.usageLimit,` to `data`, and add:

```ts
  async findByPromotionRefs(promotionRefs: readonly string[], tenantId: string, tx?: unknown): Promise<readonly Coupon[]> {
    if (promotionRefs.length === 0) return [];
    const run = (client: TransactionClient) =>
      client.coupon.findMany({ where: { tenantId, promotionRef: { in: [...promotionRefs] } } });
    const rows =
      tx !== undefined && tx !== null ? await run(tx as TransactionClient) : await runReadScoped(this.deps.prisma, tenantId, run);
    return rows.map((row) => CouponMapper.toDomain(this.toMapperRow(row)));
  }

  async findPromotionRefsByCode(fragment: string, tenantId: string, tx?: unknown): Promise<readonly string[]> {
    const run = (client: TransactionClient) =>
      client.coupon.findMany({
        where: { tenantId, code: { contains: fragment.trim().toUpperCase() } },
        select: { promotionRef: true },
        take: 50,
      });
    const rows =
      tx !== undefined && tx !== null ? await run(tx as TransactionClient) : await runReadScoped(this.deps.prisma, tenantId, run);
    return [...new Set(rows.map((row) => row.promotionRef))];
  }
```

`in-memory-coupon-repository.ts` — add:

```ts
  async findByPromotionRefs(promotionRefs: readonly string[], tenantId: string): Promise<readonly Coupon[]> {
    return [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId && promotionRefs.includes(entry.coupon.promotionRef))
      .map((entry) => entry.coupon);
  }

  async findPromotionRefsByCode(fragment: string, tenantId: string): Promise<readonly string[]> {
    const needle = fragment.trim().toUpperCase();
    const refs = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId && entry.coupon.code.value.includes(needle))
      .map((entry) => entry.coupon.promotionRef);
    return [...new Set(refs)].slice(0, 50);
  }
```

- [ ] **Step 5: Use cases** — in `coupon.use-cases.ts`:

Add `readonly email?: string;` to `RedeemCouponInput` and pass `input.email` as the last argument of `coupon.redeem(...)`.

Add:

```ts
/** A coupon by the code a customer typed (normalised the same way `CouponCode` stores it). */
export class GetCouponByCode implements UseCase<
  { readonly tenantId: string; readonly code: string },
  Coupon,
  DomainError
> {
  private readonly deps: Pick<CouponDeps, "coupons">;

  constructor(deps: Pick<CouponDeps, "coupons">) {
    this.deps = deps;
  }

  async execute(input: {
    readonly tenantId: string;
    readonly code: string;
  }): Promise<Result<Coupon, DomainError>> {
    const coupon = await this.deps.coupons.findByCode(
      input.code.trim().toUpperCase(),
      input.tenantId,
    );
    return coupon === null ? err(new NotFoundError("Coupon not found")) : ok(coupon);
  }
}

/** The coupons authorising a set of promotions (admin Discounts list). */
export class ListCouponsByPromotionRefs implements UseCase<
  { readonly tenantId: string; readonly promotionRefs: readonly string[] },
  { readonly items: readonly Coupon[] },
  DomainError
> {
  private readonly deps: Pick<CouponDeps, "coupons">;

  constructor(deps: Pick<CouponDeps, "coupons">) {
    this.deps = deps;
  }

  async execute(input: { readonly tenantId: string; readonly promotionRefs: readonly string[] }) {
    return ok({
      items: await this.deps.coupons.findByPromotionRefs(input.promotionRefs, input.tenantId),
    });
  }
}

/** The promotions whose code contains a search fragment (admin Discounts search). */
export class FindPromotionRefsByCode implements UseCase<
  { readonly tenantId: string; readonly fragment: string },
  { readonly promotionRefs: readonly string[] },
  DomainError
> {
  private readonly deps: Pick<CouponDeps, "coupons">;

  constructor(deps: Pick<CouponDeps, "coupons">) {
    this.deps = deps;
  }

  async execute(input: { readonly tenantId: string; readonly fragment: string }) {
    if (input.fragment.trim() === "") return ok({ promotionRefs: [] as readonly string[] });
    return ok({
      promotionRefs: await this.deps.coupons.findPromotionRefsByCode(
        input.fragment,
        input.tenantId,
      ),
    });
  }
}

export interface ReconfigureCouponInput extends CouponIdInput {
  readonly code: string;
  readonly multiUse: boolean;
  readonly usageLimit?: number;
}

/** Edits a discount code's code and limits; a code used by another coupon is a conflict. */
export class ReconfigureCoupon implements UseCase<
  ReconfigureCouponInput,
  CouponStatusOutput,
  DomainError
> {
  private readonly deps: CouponDeps;

  constructor(deps: CouponDeps) {
    this.deps = deps;
  }

  async execute(input: ReconfigureCouponInput): Promise<Result<CouponStatusOutput, DomainError>> {
    const code = CouponCode.create(input.code);
    if (!code.ok) return err(code.error);
    return this.deps.unitOfWork.run<Result<CouponStatusOutput, DomainError>>(async (tx) => {
      const coupon = await this.deps.coupons.findById(input.couponId, input.tenantId, tx);
      if (coupon === null) return err(new NotFoundError("Coupon not found"));
      const holder = await this.deps.coupons.findByCode(code.value.value, input.tenantId, tx);
      if (holder !== null && holder.id.toString() !== coupon.id.toString()) {
        return err(new ConflictError(`Coupon code "${code.value.value}" already exists`));
      }
      coupon.reconfigure({
        code: code.value,
        multiUse: input.multiUse,
        usageLimit: input.usageLimit,
      });
      await this.deps.coupons.save(coupon, input.tenantId, tx);
      return ok({ couponId: coupon.id.toString(), status: coupon.status.value });
    });
  }
}
```

- [ ] **Step 6: Controller and composition** — `coupons.controller.ts` deps gain `getCouponByCode`, `listCouponsByPromotionRefs`, `findPromotionRefsByCode`, `reconfigureCoupon`; add methods `getByCode`, `listByPromotionRefs`, `findPromotionRefsByCode`, `reconfigure`, each `return present(await this.deps.<useCase>.execute(input), 200);`. In `composition.ts` `buildController` add `getCouponByCode: new GetCouponByCode({ coupons })`, `listCouponsByPromotionRefs: new ListCouponsByPromotionRefs({ coupons })`, `findPromotionRefsByCode: new FindPromotionRefsByCode({ coupons })`, `reconfigureCoupon: new ReconfigureCoupon(couponDeps)`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @platform/coupons exec vitest run`
Expected: PASS (new and existing).

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm --filter @platform/coupons exec tsc --noEmit` — Expected: no output.

```bash
git add services/coupons/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -m "feat(coupons): editable codes, guest emails and discount lookups" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Checkout session — codes, discount snapshot, shipping discount, persistence

**Files:**

- Create: `services/checkout/src/domain/value-objects/discount-snapshot.ts`
- Modify: `services/checkout/src/domain/value-objects/checkout-totals.ts`
- Modify: `services/checkout/src/domain/checkout-session.ts`
- Modify: `services/checkout/src/infrastructure/checkout-session.mapper.ts`
- Modify: `services/checkout/src/infrastructure/prisma-checkout-session-repository.ts`
- Modify: `packages/db/prisma/schema/checkout.prisma`
- Create: `packages/db/prisma/schema/migrations/20261016010000_checkout_discounts/migration.sql`
- Test: `services/checkout/src/domain/checkout-session.discounts.test.ts` (create)
- Test: `services/checkout/src/infrastructure/checkout-session.mapper.discounts.test.ts` (create)

**Interfaces:**

- Produces (exported from `@platform/checkout` in Task 6):

```ts
export type DiscountClassValue = "product" | "order" | "shipping";
export interface AppliedDiscountSnapshot {
  promotionId: string;
  couponId?: string;
  code?: string;
  title: string;
  discountClass: DiscountClassValue;
  amountMinor: number;
}
export interface DiscountCodeStatusSnapshot {
  code: string;
  applicable: boolean;
  reason?: string;
}
export interface DiscountSnapshot {
  applied: readonly AppliedDiscountSnapshot[];
  orderDiscountMinor: number;
  shippingDiscountMinor: number;
  codeStatuses: readonly DiscountCodeStatusSnapshot[];
  lineAllocations: readonly { lineRef: string; amountMinor: number }[];
}
export const MAX_DISCOUNT_CODES = 5;
export const DISCOUNT_ATTEMPT_LIMIT = 10;
export const DISCOUNT_ATTEMPT_WINDOW_MS = 900_000;
export function normalizeDiscountCode(code: string): string;
```

- `CheckoutSession`: `enterDiscountCode(code)` (throws `BusinessRuleError("TOO_MANY_CODES: ...")` past 5), `removeDiscountCode(code)`, `applyDiscountSnapshot(snapshot)` (sets `discountMinor = snapshot.orderDiscountMinor`), `recordRejectedDiscountCode(now)`, `isDiscountCodeEntryLocked(now)`, getters `discountCodes`, `discountSnapshot`, `rejectedCodeAttempts`, `codeAttemptsWindowStartedAt`, `hasDiscountState`; `OrderDraft.discounts`.
- `CheckoutTotals.shippingDiscountMinor` (capped at the shipping amount, subtracted from the total); `CheckoutTotals.assemble(..., extra: { taxIncluded?, shippingName?, shippingDiscountMinor? })`.

- [ ] **Step 1: Write the failing tests** — create `services/checkout/src/domain/checkout-session.discounts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { CheckoutSession } from "./checkout-session";
import { CheckoutAddress } from "./value-objects/checkout-address";
import { CheckoutItem } from "./value-objects/checkout-item";
import type { DiscountSnapshot } from "./value-objects/discount-snapshot";
import { ShippingSelection } from "./value-objects/selections";

function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function sessionWithShipping(): CheckoutSession {
  const s = CheckoutSession.start(UniqueEntityId.from("cs-1"), "cart-1", undefined, "s-1", "EGP");
  s.loadItems([must(CheckoutItem.create("prod-1", 2, 5_000, "EGP"))]);
  const address = must(
    CheckoutAddress.create({ line1: "1 Main St", city: "Cairo", postalCode: "", country: "EG" }),
  );
  s.setShippingAddress(address);
  s.setBillingAddress(address);
  s.selectShipping(must(ShippingSelection.create("std", 6_000, "EGP", { name: "Standard" })));
  return s;
}

const snapshot = (overrides: Partial<DiscountSnapshot> = {}): DiscountSnapshot => ({
  applied: [
    {
      promotionId: "p-1",
      couponId: "c-1",
      code: "SALE10",
      title: "SALE10",
      discountClass: "order",
      amountMinor: 1_000,
    },
  ],
  orderDiscountMinor: 1_000,
  shippingDiscountMinor: 0,
  codeStatuses: [{ code: "SALE10", applicable: true }],
  lineAllocations: [{ lineRef: "0", amountMinor: 1_000 }],
  ...overrides,
});

describe("CheckoutSession — discount codes (Phase 2)", () => {
  it("stores codes normalised and once", () => {
    const s = sessionWithShipping();
    s.enterDiscountCode(" sale10 ");
    s.enterDiscountCode("SALE10");
    expect(s.discountCodes).toEqual(["SALE10"]);
    s.removeDiscountCode("sale10");
    expect(s.discountCodes).toEqual([]);
  });

  it("refuses a sixth code", () => {
    const s = sessionWithShipping();
    for (const code of ["AAA", "BBB", "CCC", "DDD", "EEE"]) s.enterDiscountCode(code);
    expect(() => s.enterDiscountCode("FFF")).toThrow(BusinessRuleError);
  });

  it("takes the order discount and the shipping discount off the total", () => {
    const s = sessionWithShipping();
    s.applyDiscountSnapshot(snapshot({ shippingDiscountMinor: 6_000 }));
    s.recalculateTotals("evt-1", new Date(0));
    expect(s.discountMinor).toBe(1_000);
    expect(s.totals?.shippingDiscountMinor).toBe(6_000);
    // 10,000 + 6,000 shipping − 6,000 free shipping − 1,000 discount
    expect(s.totals?.totalMinor).toBe(9_000);
  });

  it("never discounts shipping beyond its price", () => {
    const s = sessionWithShipping();
    s.applyDiscountSnapshot(snapshot({ shippingDiscountMinor: 99_000 }));
    s.recalculateTotals("evt-1", new Date(0));
    expect(s.totals?.shippingDiscountMinor).toBe(6_000);
  });

  it("locks code entry after ten rejected codes for fifteen minutes", () => {
    const s = sessionWithShipping();
    const start = new Date("2026-10-16T12:00:00.000Z");
    for (let i = 0; i < 10; i += 1) s.recordRejectedDiscountCode(start);
    expect(s.isDiscountCodeEntryLocked(new Date(start.getTime() + 60_000))).toBe(true);
    expect(s.isDiscountCodeEntryLocked(new Date(start.getTime() + 15 * 60_000))).toBe(false);
  });

  it("hands the applied discounts to the order draft", () => {
    const s = sessionWithShipping();
    s.applyDiscountSnapshot(snapshot());
    s.recalculateTotals("evt-1", new Date(0));
    expect(s.generateOrderDraft().discounts).toEqual(snapshot().applied);
  });

  it("has no discount state until a code or a discount arrives", () => {
    const s = sessionWithShipping();
    expect(s.hasDiscountState).toBe(false);
    s.enterDiscountCode("SALE10");
    expect(s.hasDiscountState).toBe(true);
  });
});
```

Create `services/checkout/src/infrastructure/checkout-session.mapper.discounts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { CheckoutSession } from "../domain/checkout-session";
import { CheckoutAddress } from "../domain/value-objects/checkout-address";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import { ShippingSelection } from "../domain/value-objects/selections";
import { CheckoutSessionMapper } from "./checkout-session.mapper";

function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function sessionWithShipping(): CheckoutSession {
  const s = CheckoutSession.start(UniqueEntityId.from("cs-1"), "cart-1", undefined, "s-1", "EGP");
  s.loadItems([must(CheckoutItem.create("prod-1", 2, 5_000, "EGP"))]);
  const address = must(
    CheckoutAddress.create({ line1: "1 Main St", city: "Cairo", postalCode: "", country: "EG" }),
  );
  s.setShippingAddress(address);
  s.setBillingAddress(address);
  s.selectShipping(must(ShippingSelection.create("std", 6_000, "EGP", { name: "Standard" })));
  return s;
}

describe("CheckoutSessionMapper — discounts (Phase 2)", () => {
  it("round-trips codes, the snapshot, attempts and the shipping discount", () => {
    const s = sessionWithShipping();
    s.enterDiscountCode("SALE10");
    s.applyDiscountSnapshot({
      applied: [
        {
          promotionId: "p-1",
          code: "SALE10",
          title: "SALE10",
          discountClass: "shipping",
          amountMinor: 6_000,
        },
      ],
      orderDiscountMinor: 0,
      shippingDiscountMinor: 6_000,
      codeStatuses: [{ code: "SALE10", applicable: true }],
      lineAllocations: [],
    });
    s.recordRejectedDiscountCode(new Date("2026-10-16T12:00:00.000Z"));
    s.recalculateTotals("evt-1", new Date(0));

    const back = CheckoutSessionMapper.toDomain({
      ...CheckoutSessionMapper.toRow(s, "t1"),
      version: 1,
    } as never);

    expect(back.discountCodes).toEqual(["SALE10"]);
    expect(back.discountSnapshot).toEqual(s.discountSnapshot);
    expect(back.totals?.shippingDiscountMinor).toBe(6_000);
    expect(back.rejectedCodeAttempts).toBe(1);
  });

  it("reads a row saved before Phase 2 as having no discount state", () => {
    const row = {
      ...CheckoutSessionMapper.toRow(sessionWithShipping(), "t1"),
      discounts: {},
      version: 1,
    };
    expect(CheckoutSessionMapper.toDomain(row as never).hasDiscountState).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @platform/checkout exec vitest run src/domain/checkout-session.discounts.test.ts src/infrastructure/checkout-session.mapper.discounts.test.ts`
Expected: FAIL — `./value-objects/discount-snapshot` not found / `enterDiscountCode is not a function`.

- [ ] **Step 3: Create `services/checkout/src/domain/value-objects/discount-snapshot.ts`**

```ts
/**
 * Phase 2 (Shopify-style discounts): what Promotions decided for a session — stored verbatim and
 * never computed here, like the tax and shipping snapshots. Plain data so Checkout imports nothing
 * from Promotions.
 */
export type DiscountClassValue = "product" | "order" | "shipping";

export interface AppliedDiscountSnapshot {
  readonly promotionId: string;
  readonly couponId?: string;
  readonly code?: string;
  readonly title: string;
  readonly discountClass: DiscountClassValue;
  readonly amountMinor: number;
}

export interface DiscountCodeStatusSnapshot {
  readonly code: string;
  readonly applicable: boolean;
  /** Why a code gives nothing (`not_found`, `minimum_not_met`, …); the storefront words it. */
  readonly reason?: string;
}

export interface DiscountSnapshot {
  readonly applied: readonly AppliedDiscountSnapshot[];
  /** Product + order discounts — what `discountMinor` and the tax calculation use. */
  readonly orderDiscountMinor: number;
  readonly shippingDiscountMinor: number;
  readonly codeStatuses: readonly DiscountCodeStatusSnapshot[];
  readonly lineAllocations: readonly { readonly lineRef: string; readonly amountMinor: number }[];
}

export const MAX_DISCOUNT_CODES = 5;
export const DISCOUNT_ATTEMPT_LIMIT = 10;
export const DISCOUNT_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/** Trimmed and upper case — the same rule Coupons stores codes with. */
export function normalizeDiscountCode(code: string): string {
  return code.trim().toUpperCase();
}
```

- [ ] **Step 4: `CheckoutTotals`** — add `readonly shippingDiscountMinor: number;` to the props, accept `readonly shippingDiscountMinor?: number` in `assemble`'s `extra`, and compute:

```ts
const shippingDiscountMinor = Math.min(
  Math.max(0, extra.shippingDiscountMinor ?? 0),
  shippingMinor,
);
// grandTotal = subtotal + shipping − shipping discount − discount + (taxIncluded ? 0 : tax)
const totalMinor = Math.max(
  0,
  subtotalMinor +
    shippingMinor -
    shippingDiscountMinor -
    discountMinor +
    (taxIncluded ? 0 : taxMinor),
);
```

passing `shippingDiscountMinor` into the props, and add `get shippingDiscountMinor(): number { return this.props.shippingDiscountMinor; }`.

- [ ] **Step 5: `CheckoutSession`** — import:

```ts
import {
  DISCOUNT_ATTEMPT_LIMIT,
  DISCOUNT_ATTEMPT_WINDOW_MS,
  MAX_DISCOUNT_CODES,
  normalizeDiscountCode,
  type AppliedDiscountSnapshot,
  type DiscountSnapshot,
} from "./value-objects/discount-snapshot";
```

Add to `OrderDraft`: `/** Phase 2: the discounts the order is placed with (empty when none). */ readonly discounts: readonly AppliedDiscountSnapshot[];`

Add to `CheckoutSessionProps`:

```ts
  /** Phase 2: the codes the shopper entered, normalised, at most five. */
  discountCodes: readonly string[];
  /** Phase 2: the last decision Promotions made for this session. */
  discountSnapshot?: DiscountSnapshot;
  rejectedCodeAttempts: number;
  codeAttemptsWindowStartedAt?: Date;
```

In `start`, add `discountCodes: [], rejectedCodeAttempts: 0,`. In `reconstitute`'s `extra` type add `readonly discountCodes?: readonly string[]; readonly discountSnapshot?: DiscountSnapshot; readonly rejectedCodeAttempts?: number; readonly codeAttemptsWindowStartedAt?: Date;` and pass `discountCodes: [...(extra.discountCodes ?? [])], discountSnapshot: extra.discountSnapshot, rejectedCodeAttempts: extra.rejectedCodeAttempts ?? 0, codeAttemptsWindowStartedAt: extra.codeAttemptsWindowStartedAt,`.

In `recalculateTotals`, add `shippingDiscountMinor: this.props.discountSnapshot?.shippingDiscountMinor ?? 0,` to the `extra` object. In `generateOrderDraft`, add `discounts: this.props.discountSnapshot?.applied ?? [],` to the returned draft.

Add these methods after `applyPromotionSnapshot`:

```ts
  /** Adds a code the shopper typed (Phase 2). Already entered: nothing changes. A sixth code: refused. */
  enterDiscountCode(code: string): void {
    this.ensureOpen();
    const normalized = normalizeDiscountCode(code);
    if (this.props.discountCodes.includes(normalized)) return;
    if (this.props.discountCodes.length >= MAX_DISCOUNT_CODES) {
      throw new BusinessRuleError(`TOO_MANY_CODES: at most ${MAX_DISCOUNT_CODES} discount codes`);
    }
    this.props.discountCodes = [...this.props.discountCodes, normalized];
  }

  removeDiscountCode(code: string): void {
    this.ensureOpen();
    const normalized = normalizeDiscountCode(code);
    this.props.discountCodes = this.props.discountCodes.filter((c) => c !== normalized);
  }

  /** Stores what Promotions decided (Phase 2); the order discount becomes `discountMinor`. Never computed here. */
  applyDiscountSnapshot(snapshot: DiscountSnapshot): void {
    this.ensureOpen();
    this.props.discountSnapshot = snapshot;
    this.props.discountMinor = snapshot.orderDiscountMinor;
  }

  /** Counts a rejected code; the count restarts once the window has passed. */
  recordRejectedDiscountCode(now: Date): void {
    this.ensureOpen();
    const start = this.props.codeAttemptsWindowStartedAt;
    if (start === undefined || now.getTime() - start.getTime() >= DISCOUNT_ATTEMPT_WINDOW_MS) {
      this.props.codeAttemptsWindowStartedAt = now;
      this.props.rejectedCodeAttempts = 1;
      return;
    }
    this.props.rejectedCodeAttempts += 1;
  }

  /** True after ten rejected codes within fifteen minutes — guards against guessing codes. */
  isDiscountCodeEntryLocked(now: Date): boolean {
    const start = this.props.codeAttemptsWindowStartedAt;
    return (
      start !== undefined &&
      now.getTime() - start.getTime() < DISCOUNT_ATTEMPT_WINDOW_MS &&
      this.props.rejectedCodeAttempts >= DISCOUNT_ATTEMPT_LIMIT
    );
  }

  get discountCodes(): readonly string[] {
    return this.props.discountCodes;
  }

  get discountSnapshot(): DiscountSnapshot | undefined {
    return this.props.discountSnapshot;
  }

  get rejectedCodeAttempts(): number {
    return this.props.rejectedCodeAttempts;
  }

  get codeAttemptsWindowStartedAt(): Date | undefined {
    return this.props.codeAttemptsWindowStartedAt;
  }

  /** Whether Phase 2 discounts have touched this session (a legacy `applyPromotionSnapshot` session has not). */
  get hasDiscountState(): boolean {
    return this.props.discountCodes.length > 0 || this.props.discountSnapshot !== undefined;
  }
```

- [ ] **Step 6: Schema and migration** — in `packages/db/prisma/schema/checkout.prisma` inside `model CheckoutSession`, after `totals`:

```prisma
  discounts         Json     @default("{}") // Phase 2: { codes, snapshot, rejectedAttempts, attemptsWindowStartedAt }; {} = none
```

Create `packages/db/prisma/schema/migrations/20261016010000_checkout_discounts/migration.sql`:

```sql
-- Phase 2 (Shopify-style discounts) — the codes a shopper entered and the discounts Promotions
-- decided for the session. Written by hand, NOT applied by the agent; the owner deploys it BEFORE
-- the release that reads it. Additive with a default: existing sessions read as having none.
ALTER TABLE "checkout"."checkout_sessions" ADD COLUMN "discounts" JSONB NOT NULL DEFAULT '{}';
```

Run: `pnpm --filter @platform/db exec prisma validate` and `pnpm --filter @platform/db exec prisma generate` — Expected: valid; client generated.

- [ ] **Step 7: Mapper and repository** — in `checkout-session.mapper.ts` import `type DiscountSnapshot` from `../domain/value-objects/discount-snapshot` and add:

```ts
interface DiscountsJson {
  readonly codes?: readonly string[];
  readonly snapshot?: DiscountSnapshot;
  readonly rejectedAttempts?: number;
  readonly attemptsWindowStartedAt?: string;
}
```

Add `readonly shippingDiscountMinor?: number;` to `CheckoutTotalsJson` and `readonly discounts: DiscountsJson | Record<string, never>;` to `CheckoutSessionRow`.

In `toDomain`, add to the `extra` object:

```ts
        discountCodes: isSet(row.discounts) ? (row.discounts.codes ?? []) : [],
        discountSnapshot: isSet(row.discounts) ? row.discounts.snapshot : undefined,
        rejectedCodeAttempts: isSet(row.discounts) ? (row.discounts.rejectedAttempts ?? 0) : 0,
        codeAttemptsWindowStartedAt:
          isSet(row.discounts) && row.discounts.attemptsWindowStartedAt !== undefined
            ? new Date(row.discounts.attemptsWindowStartedAt)
            : undefined,
```

and pass `shippingDiscountMinor: row.totals.shippingDiscountMinor ?? 0,` in the `CheckoutTotals.assemble` extra.

In `toRow`, add `shippingDiscountMinor: session.totals.shippingDiscountMinor,` inside `totals`, and a `discounts` key:

```ts
      discounts:
        session.hasDiscountState || session.rejectedCodeAttempts > 0
          ? (JSON.parse(
              JSON.stringify({
                codes: session.discountCodes,
                snapshot: session.discountSnapshot,
                rejectedAttempts: session.rejectedCodeAttempts,
                attemptsWindowStartedAt: session.codeAttemptsWindowStartedAt?.toISOString(),
              }),
            ) as DiscountsJson)
          : {},
```

(`JSON.parse(JSON.stringify(...))` drops `undefined` keys, which Prisma's JSON input does not accept.)

In `prisma-checkout-session-repository.ts` add `discounts: row.discounts,` to the `updateMany` data (the create branch already passes the whole row).

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @platform/checkout exec vitest run src/domain src/infrastructure`
Expected: PASS.

- [ ] **Step 9: Typecheck and commit**

Run: `pnpm --filter @platform/checkout exec tsc --noEmit` — Expected: no output. Hand-written `OrderDraft` literals in tests (if any) need `discounts: []`; drafts built with `generateOrderDraft()` need nothing.

```bash
git add packages/db/prisma/schema/checkout.prisma packages/db/prisma/schema/migrations/20261016010000_checkout_discounts services/checkout/src/domain services/checkout/src/infrastructure
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -m "feat(checkout): discount codes and snapshot on the checkout session" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Checkout application — evaluating discounts, adding and removing codes

**Files:**

- Modify: `services/checkout/src/application/ports.ts`
- Modify: `services/checkout/src/infrastructure/in-memory-orchestration-adapters.ts`
- Create: `services/checkout/src/application/discount-code.use-cases.ts`
- Modify: `services/checkout/src/application/checkout-orchestration.use-cases.ts`
- Modify: `services/checkout/src/interfaces/checkout.controller.ts`
- Modify: `services/checkout/src/composition.ts`
- Modify: `services/checkout/src/index.ts`
- Test: `services/checkout/src/application/discount-code.use-cases.test.ts` (create)

**Interfaces:**

- Consumes (Task 5): `CheckoutSession` discount methods, `DiscountSnapshot`, `AppliedDiscountSnapshot`, `normalizeDiscountCode`.
- Produces:

```ts
// ports.ts
export interface DiscountEvaluationInput {
  readonly tenantId: string;
  readonly items: readonly CheckoutItem[];
  /** Destination country and the selected rate; null until both an address and a method exist. */
  readonly shipping: { readonly countryCode: string; readonly rateMinor: number } | null;
  readonly customerRef?: string;
  readonly email?: string;
  readonly codes: readonly string[];
}
// PromotionValidationPort gains:
evaluate(input: DiscountEvaluationInput): Promise<DiscountSnapshot>;
export interface DiscountUsagePort {
  record(input: {
    readonly tenantId: string;
    readonly orderRef: string;
    readonly customerRef?: string;
    readonly email?: string;
    readonly applied: readonly AppliedDiscountSnapshot[];
  }): Promise<void>;
}
// discount-code.use-cases.ts
export async function refreshDiscounts(session: CheckoutSession, port: PromotionValidationPort, tenantId: string): Promise<void>;
export interface DiscountCodeInput { tenantId: string; checkoutSessionId: string; code: string }
export interface DiscountCodeOutput { checkoutSessionId: string; state: string; code: string; applicable: boolean; reason?: string }
export class AddDiscountCode; export class RemoveDiscountCode;
// CheckoutController
addDiscountCode(input: DiscountCodeInput): Promise<ControllerResponse>;    // 200 DiscountCodeOutput
removeDiscountCode(input: DiscountCodeInput): Promise<ControllerResponse>; // 200 { checkoutSessionId, state }
```

- `RecalculateTotals` and `RequestTaxCalculation` accept an optional `promotionValidation` and refresh discounts first. Line refs sent to Promotions are each item's position as a string (`"0"`, `"1"`, …) — Task 9's adapter builds them the same way.

- [ ] **Step 1: Write the failing tests** — create `services/checkout/src/application/discount-code.use-cases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import { CheckoutAddress } from "../domain/value-objects/checkout-address";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import type {
  AppliedDiscountSnapshot,
  DiscountSnapshot,
} from "../domain/value-objects/discount-snapshot";
import { ShippingSelection } from "../domain/value-objects/selections";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { RecalculateTotals } from "./checkout-orchestration.use-cases";
import { AddDiscountCode, RemoveDiscountCode } from "./discount-code.use-cases";
import type { DiscountEvaluationInput, PromotionValidationPort } from "./ports";

class FakeSessions implements CheckoutSessionRepository {
  readonly store = new Map<string, CheckoutSession>();
  async save(session: CheckoutSession): Promise<void> {
    this.store.set(session.id.toString(), session);
  }
  async findById(id: string): Promise<CheckoutSession | null> {
    return this.store.get(id) ?? null;
  }
}

function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

/** Stands in for Promotions: SALE10 = 10% off orders of 10,000 or more; SHIPFREE = free shipping; anything else is unknown. */
class FakePromotions implements PromotionValidationPort {
  readonly calls: DiscountEvaluationInput[] = [];
  async validate() {
    return { valid: true, discountMinor: 0 };
  }
  async evaluate(input: DiscountEvaluationInput): Promise<DiscountSnapshot> {
    this.calls.push(input);
    const subtotal = input.items.reduce((s, i) => s + i.lineTotalMinor, 0);
    const applied: AppliedDiscountSnapshot[] = [];
    const codeStatuses = input.codes.map((code) => {
      if (code === "SALE10") {
        if (subtotal < 10_000) return { code, applicable: false, reason: "minimum_not_met" };
        applied.push({
          promotionId: "p-sale",
          code,
          title: code,
          discountClass: "order",
          amountMinor: subtotal / 10,
        });
        return { code, applicable: true };
      }
      if (code === "SHIPFREE") {
        applied.push({
          promotionId: "p-ship",
          code,
          title: code,
          discountClass: "shipping",
          amountMinor: input.shipping?.rateMinor ?? 0,
        });
        return { code, applicable: true };
      }
      return { code, applicable: false, reason: "not_found" };
    });
    const sum = (cls: (c: string) => boolean) =>
      applied.filter((a) => cls(a.discountClass)).reduce((s, a) => s + a.amountMinor, 0);
    return {
      applied,
      orderDiscountMinor: sum((c) => c !== "shipping"),
      shippingDiscountMinor: sum((c) => c === "shipping"),
      codeStatuses,
      lineAllocations: [],
    };
  }
}

const clock = { now: () => new Date("2026-10-16T12:00:00.000Z") };
let n = 0;
const idGenerator = { generate: () => `id-${(n += 1)}` };

function setup(quantity = 2) {
  const sessions = new FakeSessions();
  const session = CheckoutSession.start(
    UniqueEntityId.from("cs-1"),
    "cart-1",
    undefined,
    "s-1",
    "EGP",
  );
  session.loadItems([must(CheckoutItem.create("prod-1", quantity, 5_000, "EGP"))]);
  session.setShippingAddress(
    must(
      CheckoutAddress.create({ line1: "1 Main St", city: "Cairo", postalCode: "", country: "EG" }),
    ),
  );
  sessions.store.set("cs-1", session);
  const promotionValidation = new FakePromotions();
  const deps = {
    sessions,
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator,
    clock,
    promotionValidation,
  };
  const input = (code: string) => ({ tenantId: "t1", checkoutSessionId: "cs-1", code });
  return {
    session,
    promotionValidation,
    add: (code: string) => new AddDiscountCode(deps).execute(input(code)),
    remove: (code: string) => new RemoveDiscountCode(deps).execute(input(code)),
    recalculate: () =>
      new RecalculateTotals(deps).execute({ tenantId: "t1", checkoutSessionId: "cs-1" }),
  };
}

describe("AddDiscountCode / RemoveDiscountCode (Phase 2)", () => {
  it("accepts a code typed in any case with spaces, and takes it off the total (Review Focus 1)", async () => {
    const t = setup();
    const result = await t.add(" sale10 ");
    expect(result.ok && result.value).toMatchObject({ code: "SALE10", applicable: true });
    expect(t.session.discountCodes).toEqual(["SALE10"]);
    expect(t.session.totals?.discountMinor).toBe(1_000);
  });

  it("refuses an unknown code, forgets it and counts the attempt", async () => {
    const t = setup();
    const result = await t.add("NOPE");
    expect(result.ok && result.value).toMatchObject({ applicable: false, reason: "not_found" });
    expect(t.session.discountCodes).toEqual([]);
    expect(t.session.rejectedCodeAttempts).toBe(1);
  });

  it("answers too_many_attempts after ten rejected codes", async () => {
    const t = setup();
    for (let i = 0; i < 10; i += 1) await t.add(`BAD${i}X`);
    const result = await t.add("SALE10");
    expect(result.ok && result.value).toMatchObject({
      applicable: false,
      reason: "too_many_attempts",
    });
  });

  it("keeps a code that stops qualifying, as not applicable, with a correct total (Review Focus 2)", async () => {
    const t = setup(2);
    await t.add("SALE10");
    t.session.loadItems([must(CheckoutItem.create("prod-1", 1, 5_000, "EGP"))]);
    await t.recalculate();
    expect(t.session.discountCodes).toEqual(["SALE10"]);
    expect(t.session.discountSnapshot?.codeStatuses).toEqual([
      { code: "SALE10", applicable: false, reason: "minimum_not_met" },
    ]);
    expect(t.session.totals?.discountMinor).toBe(0);
    expect(t.session.totals?.totalMinor).toBe(5_000);
  });

  it("accepts free shipping before a method is chosen, then makes shipping free (Review Focus 5)", async () => {
    const t = setup();
    const result = await t.add("SHIPFREE");
    expect(result.ok && result.value).toMatchObject({ applicable: true });
    expect(t.promotionValidation.calls.at(-1)?.shipping).toBeNull();
    t.session.selectShipping(must(ShippingSelection.create("std", 6_000, "EGP")));
    await t.recalculate();
    expect(t.session.totals?.shippingMinor).toBe(6_000);
    expect(t.session.totals?.shippingDiscountMinor).toBe(6_000);
    expect(t.session.totals?.totalMinor).toBe(10_000);
  });

  it("removes a code and its discount", async () => {
    const t = setup();
    await t.add("SALE10");
    await t.remove("sale10");
    expect(t.session.discountCodes).toEqual([]);
    expect(t.session.totals?.discountMinor).toBe(0);
  });

  it("sends Promotions the lines, the tenant and the codes", async () => {
    const t = setup();
    await t.add("SALE10");
    const call = t.promotionValidation.calls.at(-1);
    expect(call?.codes).toEqual(["SALE10"]);
    expect(call?.items).toHaveLength(1);
    expect(call?.tenantId).toBe("t1");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @platform/checkout exec vitest run src/application/discount-code.use-cases.test.ts`
Expected: FAIL — `./discount-code.use-cases` not found.

- [ ] **Step 3: Ports** — in `services/checkout/src/application/ports.ts` add `import type { AppliedDiscountSnapshot, DiscountSnapshot } from "../domain/value-objects/discount-snapshot";`, the `DiscountEvaluationInput` and `DiscountUsagePort` interfaces exactly as in **Interfaces** above (with doc comments), and add to `PromotionValidationPort`:

```ts
  /**
   * Phase 2: decides every discount for the session — entered codes and automatic discounts —
   * against its lines, destination and selected rate. Checkout stores the answer verbatim.
   */
  evaluate(input: DiscountEvaluationInput): Promise<DiscountSnapshot>;
```

In `in-memory-orchestration-adapters.ts`, add to `InMemoryPromotionValidationAdapter`:

```ts
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
```

Then give every other implementation of the port the same method (a test fake that does not care returns the stub's answer). Find them:

Run: `git grep -n "PromotionValidationPort" -- services apps`

- [ ] **Step 4: Create `services/checkout/src/application/discount-code.use-cases.ts`**

```ts
import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import type { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import { normalizeDiscountCode } from "../domain/value-objects/discount-snapshot";
import type { PromotionValidationPort } from "./ports";

/**
 * Asks Promotions for the session's discounts and stores the answer (Phase 2). A session no
 * discount has touched, and for which nothing applies, is left exactly as it was — so a legacy
 * admin `ValidatePromotion` snapshot is never overwritten with zero.
 */
export async function refreshDiscounts(
  session: CheckoutSession,
  port: PromotionValidationPort,
  tenantId: string,
): Promise<void> {
  const address = session.shippingAddress;
  const selection = session.shippingSelection;
  const snapshot = await port.evaluate({
    tenantId,
    items: session.items,
    shipping:
      address !== undefined && selection !== undefined
        ? { countryCode: address.country, rateMinor: selection.rateAmountMinor }
        : null,
    ...(session.customerRef === undefined ? {} : { customerRef: session.customerRef }),
    ...(session.contactEmail === undefined ? {} : { email: session.contactEmail.value }),
    codes: session.discountCodes,
  });
  if (snapshot.applied.length > 0 || session.hasDiscountState) {
    session.applyDiscountSnapshot(snapshot);
  }
}

export interface DiscountCodeInput {
  readonly tenantId: string;
  readonly checkoutSessionId: string;
  readonly code: string;
}

export interface DiscountCodeOutput {
  readonly checkoutSessionId: string;
  readonly state: string;
  readonly code: string;
  readonly applicable: boolean;
  readonly reason?: string;
}

interface DiscountCodeDeps {
  readonly sessions: CheckoutSessionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly promotionValidation: PromotionValidationPort;
}

function recalculateIfPossible(session: CheckoutSession, deps: DiscountCodeDeps): void {
  if (session.items.length > 0) {
    session.recalculateTotals(deps.idGenerator.generate(), deps.clock.now());
  }
}

/**
 * A shopper enters a discount code (Phase 2). An accepted code stays on the session with its
 * discount in the totals; a rejected one is forgotten and counted towards the guessing limit.
 * Either way the answer is `ok` — whether the code applies is the outcome, not an error.
 */
export class AddDiscountCode implements UseCase<
  DiscountCodeInput,
  DiscountCodeOutput,
  DomainError
> {
  private readonly deps: DiscountCodeDeps;

  constructor(deps: DiscountCodeDeps) {
    this.deps = deps;
  }

  async execute(input: DiscountCodeInput): Promise<Result<DiscountCodeOutput, DomainError>> {
    const code = normalizeDiscountCode(input.code);
    if (code === "") {
      return err(
        new ValidationError("Invalid discount code", [{ field: "code", message: "required" }]),
      );
    }
    return this.deps.unitOfWork.run<Result<DiscountCodeOutput, DomainError>>(async (tx) => {
      const session = await this.deps.sessions.findById(
        input.checkoutSessionId,
        input.tenantId,
        tx,
      );
      if (session === null) return err(new NotFoundError("Checkout session not found"));
      const answer = (applicable: boolean, reason?: string): DiscountCodeOutput => ({
        checkoutSessionId: session.id.toString(),
        state: session.state.value,
        code,
        applicable,
        ...(reason === undefined ? {} : { reason }),
      });

      const now = this.deps.clock.now();
      if (session.isDiscountCodeEntryLocked(now)) return ok(answer(false, "too_many_attempts"));

      try {
        try {
          session.enterDiscountCode(code);
        } catch (error) {
          if (isDomainError(error) && error.message.startsWith("TOO_MANY_CODES")) {
            return ok(answer(false, "too_many_codes"));
          }
          throw error;
        }
        await refreshDiscounts(session, this.deps.promotionValidation, input.tenantId);
        const status = session.discountSnapshot?.codeStatuses.find((s) => s.code === code);
        const applicable = status?.applicable === true;
        if (!applicable) {
          session.removeDiscountCode(code);
          session.recordRejectedDiscountCode(now);
          await refreshDiscounts(session, this.deps.promotionValidation, input.tenantId);
        }
        recalculateIfPossible(session, this.deps);
        await this.deps.sessions.save(session, input.tenantId, tx);
        return ok(answer(applicable, applicable ? undefined : (status?.reason ?? "not_found")));
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
    });
  }
}

/** A shopper removes a code; the discounts are worked out again without it. */
export class RemoveDiscountCode implements UseCase<
  DiscountCodeInput,
  { readonly checkoutSessionId: string; readonly state: string },
  DomainError
> {
  private readonly deps: DiscountCodeDeps;

  constructor(deps: DiscountCodeDeps) {
    this.deps = deps;
  }

  async execute(
    input: DiscountCodeInput,
  ): Promise<Result<{ readonly checkoutSessionId: string; readonly state: string }, DomainError>> {
    return this.deps.unitOfWork.run<
      Result<{ readonly checkoutSessionId: string; readonly state: string }, DomainError>
    >(async (tx) => {
      const session = await this.deps.sessions.findById(
        input.checkoutSessionId,
        input.tenantId,
        tx,
      );
      if (session === null) return err(new NotFoundError("Checkout session not found"));
      try {
        session.removeDiscountCode(input.code);
        await refreshDiscounts(session, this.deps.promotionValidation, input.tenantId);
        recalculateIfPossible(session, this.deps);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.sessions.save(session, input.tenantId, tx);
      return ok({ checkoutSessionId: session.id.toString(), state: session.state.value });
    });
  }
}
```

- [ ] **Step 5: Refresh on every recalculation** — in `checkout-orchestration.use-cases.ts` import `refreshDiscounts` from `./discount-code.use-cases`.

`RequestTaxCalculation`: widen its deps type (field and constructor) to `OrchestrationDeps & { readonly taxCalculation: TaxCalculationPort; readonly promotionValidation?: PromotionValidationPort }`. Right after the "no shipping address" guard add:

```ts
try {
  if (this.deps.promotionValidation !== undefined) {
    await refreshDiscounts(session, this.deps.promotionValidation, input.tenantId);
  }
} catch (error) {
  if (isDomainError(error)) return err(error);
  throw error;
}
```

and replace the last argument of `calculate(...)` with:

```ts
          // Finance works the tax out after discounts, like Shopify — shipping discounts included (Phase 2).
          {
            orderMinor: session.discountMinor ?? 0,
            shippingMinor: session.discountSnapshot?.shippingDiscountMinor ?? 0,
          },
```

`RecalculateTotals`: widen its deps type (field and constructor) to `OrchestrationDeps & { readonly promotionValidation?: PromotionValidationPort }` and, inside its `try`, before `session.recalculateTotals(...)`, add:

```ts
if (this.deps.promotionValidation !== undefined) {
  await refreshDiscounts(session, this.deps.promotionValidation, input.tenantId);
}
```

- [ ] **Step 6: Controller, composition, exports** — in `checkout.controller.ts` add deps `readonly addDiscountCode: AddDiscountCode; readonly removeDiscountCode: RemoveDiscountCode;` and:

```ts
  async addDiscountCode(input: DiscountCodeInput): Promise<ControllerResponse> {
    return present(await this.deps.addDiscountCode.execute(input), 200);
  }

  async removeDiscountCode(input: DiscountCodeInput): Promise<ControllerResponse> {
    return present(await this.deps.removeDiscountCode.execute(input), 200);
  }
```

In `composition.ts` `buildController`: add `promotionValidation,` to the `RequestTaxCalculation` and `RecalculateTotals` deps, and:

```ts
    addDiscountCode: new AddDiscountCode({
      sessions,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
      promotionValidation,
    }),
    removeDiscountCode: new RemoveDiscountCode({
      sessions,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
      promotionValidation,
    }),
```

In `services/checkout/src/index.ts` add `DiscountEvaluationInput` and `DiscountUsagePort` to the exported port types, and:

```ts
export type {
  AppliedDiscountSnapshot,
  DiscountClassValue,
  DiscountCodeStatusSnapshot,
  DiscountSnapshot,
} from "./domain/value-objects/discount-snapshot";
export {
  MAX_DISCOUNT_CODES,
  normalizeDiscountCode,
} from "./domain/value-objects/discount-snapshot";
export type { DiscountCodeInput, DiscountCodeOutput } from "./application/discount-code.use-cases";
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @platform/checkout exec vitest run`
Expected: PASS — the new file and every existing checkout test (`RequestTaxCalculation`'s existing assertions on the discounts argument still see `{ orderMinor: 0, shippingMinor: 0 }`).

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm --filter @platform/checkout exec tsc --noEmit` — Expected: no output.

```bash
git add services/checkout/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -m "feat(checkout): enter and remove discount codes, refresh discounts on recalculation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Checkout completion — final re-check, discounts on the order, usage

**Files:**

- Modify: `services/checkout/src/application/complete-checkout.use-case.ts`
- Modify: `services/checkout/src/application/ports.ts` (`OrderCreationPort` input)
- Modify: `services/checkout/src/composition.ts`
- Test: `services/checkout/src/application/complete-checkout.discounts.test.ts` (create)

**Interfaces:**

- Consumes (Tasks 5–6): `refreshDiscounts`, `DiscountUsagePort`, `OrderDraft.discounts`.
- Produces: `CompleteCheckoutDeps.promotionValidation?`, `CompleteCheckoutDeps.discountUsage?`; `CheckoutWiringDeps.discountUsage?: DiscountUsagePort`; `OrderCreationPort.create` input gains `readonly discounts?: readonly AppliedDiscountSnapshot[]`. A completion whose discounts moved fails with `BusinessRuleError("DISCOUNTS_CHANGED: ...")` (409) and leaves the session open with the new totals.

- [ ] **Step 1: Write the failing tests** — create `services/checkout/src/application/complete-checkout.discounts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import { CheckoutAddress } from "../domain/value-objects/checkout-address";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import type { DiscountSnapshot } from "../domain/value-objects/discount-snapshot";
import { ShippingSelection } from "../domain/value-objects/selections";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { CompleteCheckout } from "./complete-checkout.use-case";
import type { DiscountUsagePort, OrderCreationPort, PromotionValidationPort } from "./ports";

class FakeSessions implements CheckoutSessionRepository {
  readonly store = new Map<string, CheckoutSession>();
  async save(session: CheckoutSession): Promise<void> {
    this.store.set(session.id.toString(), session);
  }
  async findById(id: string): Promise<CheckoutSession | null> {
    return this.store.get(id) ?? null;
  }
}

function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const tenPercent: DiscountSnapshot = {
  applied: [
    {
      promotionId: "p-1",
      couponId: "c-1",
      code: "SALE10",
      title: "SALE10",
      discountClass: "order",
      amountMinor: 1_000,
    },
  ],
  orderDiscountMinor: 1_000,
  shippingDiscountMinor: 0,
  codeStatuses: [{ code: "SALE10", applicable: true }],
  lineAllocations: [{ lineRef: "0", amountMinor: 1_000 }],
};

const clock = { now: () => new Date("2026-10-16T12:00:00.000Z") };
let n = 0;
const idGenerator = { generate: () => `id-${(n += 1)}` };

function setup(options: { evaluateTo: DiscountSnapshot; usageFails?: boolean }) {
  const sessions = new FakeSessions();
  const session = CheckoutSession.start(
    UniqueEntityId.from("cs-1"),
    "cart-1",
    undefined,
    "s-1",
    "EGP",
  );
  session.loadItems([must(CheckoutItem.create("prod-1", 2, 5_000, "EGP"))]);
  const address = must(
    CheckoutAddress.create({ line1: "1 Main St", city: "Cairo", postalCode: "", country: "EG" }),
  );
  session.setShippingAddress(address);
  session.setBillingAddress(address);
  session.selectShipping(must(ShippingSelection.create("std", 6_000, "EGP")));
  session.enterDiscountCode("SALE10");
  session.applyDiscountSnapshot(tenPercent);
  session.recalculateTotals("evt-0", new Date(0));
  sessions.store.set("cs-1", session);

  const created: Parameters<OrderCreationPort["create"]>[0][] = [];
  const orderCreation: OrderCreationPort = {
    async create(input) {
      created.push(input);
      return { orderRef: "order-1" };
    },
  };
  const promotionValidation: PromotionValidationPort = {
    async validate() {
      return { valid: true, discountMinor: 0 };
    },
    async evaluate() {
      return options.evaluateTo;
    },
  };
  const usage: Parameters<DiscountUsagePort["record"]>[0][] = [];
  const discountUsage: DiscountUsagePort = {
    async record(input) {
      usage.push(input);
      if (options.usageFails === true) throw new Error("coupons down");
    },
  };
  const complete = new CompleteCheckout({
    sessions,
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator,
    clock,
    orderCreation,
    promotionValidation,
    discountUsage,
  });
  return {
    session,
    created,
    usage,
    run: () =>
      complete.execute({ tenantId: "t1", checkoutSessionId: "cs-1", idempotencyKey: "k-1" }),
  };
}

describe("CompleteCheckout — discounts (Phase 2)", () => {
  it("places the order with its discounts and records their use once", async () => {
    const t = setup({ evaluateTo: tenPercent });
    const result = await t.run();
    expect(result.ok).toBe(true);
    expect(t.created[0]?.discounts).toEqual(tenPercent.applied);
    expect(t.created[0]?.totals.discountMinor).toBe(1_000);
    expect(t.usage).toEqual([{ tenantId: "t1", orderRef: "order-1", applied: tenPercent.applied }]);
  });

  it("refuses to place the order when the discounts changed, and shows the new total", async () => {
    const t = setup({
      evaluateTo: {
        ...tenPercent,
        applied: [],
        orderDiscountMinor: 0,
        codeStatuses: [{ code: "SALE10", applicable: false, reason: "usage_limit_reached" }],
      },
    });
    const result = await t.run();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toMatch(/^DISCOUNTS_CHANGED/);
    expect(t.created).toHaveLength(0);
    expect(t.session.state.isOpen).toBe(true);
    expect(t.session.totals?.discountMinor).toBe(0);
  });

  it("still places the order when recording the usage fails", async () => {
    const t = setup({ evaluateTo: tenPercent, usageFails: true });
    const result = await t.run();
    expect(result.ok).toBe(true);
    expect(t.session.orderRef).toBe("order-1");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @platform/checkout exec vitest run src/application/complete-checkout.discounts.test.ts`
Expected: FAIL — `discounts` undefined on the created order input; no `DISCOUNTS_CHANGED`.

- [ ] **Step 3: `OrderCreationPort`** — in `ports.ts` add to `OrderCreationPort.create`'s input:

```ts
    /** Phase 2: the discounts the shopper got, as shown at checkout; absent when none. */
    readonly discounts?: readonly AppliedDiscountSnapshot[];
```

- [ ] **Step 4: `CompleteCheckout`** — import `DiscountUsagePort`, `PromotionValidationPort` from `./ports` and `refreshDiscounts` from `./discount-code.use-cases`, and add to `CompleteCheckoutDeps`:

```ts
  /** Phase 2: when present, the discounts are worked out once more right before the order exists. */
  readonly promotionValidation?: PromotionValidationPort;
  /** Phase 2: when present, each discount's use is recorded after the order is placed (best effort). */
  readonly discountUsage?: DiscountUsagePort;
```

Insert right after the `if (!session.state.isOpen) { ... }` block and before `let draft;`:

```ts
// Phase 2: a code can run out, expire or stop qualifying between the last recalculation and
// this click. Work the discounts out once more; if they moved, show the shopper the new total
// instead of placing an order at a price they never saw. `DISCOUNTS_CHANGED:` is the prefix
// the storefront reads, like `OUT_OF_STOCK:`.
if (this.deps.promotionValidation !== undefined) {
  const before = {
    order: session.discountMinor ?? 0,
    shipping: session.discountSnapshot?.shippingDiscountMinor ?? 0,
  };
  try {
    await refreshDiscounts(session, this.deps.promotionValidation, input.tenantId);
    const after = {
      order: session.discountMinor ?? 0,
      shipping: session.discountSnapshot?.shippingDiscountMinor ?? 0,
    };
    if (before.order !== after.order || before.shipping !== after.shipping) {
      session.recalculateTotals(this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.sessions.save(session, input.tenantId, tx);
      return err(
        new BusinessRuleError("DISCOUNTS_CHANGED: the discounts changed; review the new total"),
      );
    }
  } catch (error) {
    if (isDomainError(error)) return err(error);
    throw error;
  }
}
```

In the `orderCreation.create({ ... })` call add:

```ts
        ...(draft.discounts.length === 0 ? {} : { discounts: draft.discounts }),
```

After the final `await this.deps.sessions.save(session, input.tenantId, tx);` and before the final `return ok(...)`, add:

```ts
// Phase 2: count each discount's use. The order already exists, so a failure here must not
// undo it; Coupons dedupes by order, and a retried completion returns early above.
if (this.deps.discountUsage !== undefined && draft.discounts.length > 0) {
  try {
    await this.deps.discountUsage.record({
      tenantId: input.tenantId,
      orderRef,
      ...(draft.customerRef === undefined ? {} : { customerRef: draft.customerRef }),
      ...(draft.contactEmail === undefined ? {} : { email: draft.contactEmail }),
      applied: draft.discounts,
    });
  } catch {
    // Best effort by design (spec "Placing the order and recording usage").
  }
}
```

- [ ] **Step 5: Composition** — in `services/checkout/src/composition.ts` add to `CheckoutWiringDeps`:

```ts
  /** Phase 2: records each discount's use once an order is placed. Absent ⇒ nothing is recorded. */
  readonly discountUsage?: DiscountUsagePort;
```

and in the `CompleteCheckout` construction add `promotionValidation,` and `...(deps.discountUsage === undefined ? {} : { discountUsage: deps.discountUsage }),`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @platform/checkout exec vitest run`
Expected: PASS — including the existing `complete-checkout.use-case.test.ts` (its sessions carry no discount state and the in-memory adapter applies nothing, so the re-check changes nothing).

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @platform/checkout exec tsc --noEmit` — Expected: no output.

```bash
git add services/checkout/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -m "feat(checkout): re-check discounts before placing the order and record their use" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Orders — the discounts an order was placed with

**Files:**

- Modify: `services/orders/src/domain/value-objects/order-totals-snapshot.ts`
- Modify: `services/orders/src/application/create-order-from-checkout.use-case.ts`
- Modify: `services/orders/src/infrastructure/order.mapper.ts`
- Test: `services/orders/src/infrastructure/order.mapper.discounts.test.ts` (create)

**Interfaces:**

- Produces: `export interface OrderDiscountLine { readonly title: string; readonly code?: string; readonly discountClass: string; readonly amountMinor: number }` (exported from `@platform/orders`'s index next to `OrderTotalsSnapshot` if that is exported; otherwise from the value-object module only); `OrderTotalsSnapshot.shippingDiscountMinor` (0 when absent), `OrderTotalsSnapshot.discounts` (empty when absent); `CreateOrderFromCheckoutTotalsInput` gains `shippingDiscountMinor?` and `discounts?`.

- [ ] **Step 1: Write the failing test** — create `services/orders/src/infrastructure/order.mapper.discounts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { Order } from "../domain/order";
import { OrderItem } from "../domain/order-item";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { OrderTotalsSnapshot } from "../domain/value-objects/order-totals-snapshot";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import { OrderMapper } from "./order.mapper";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function order(totalsExtra: Partial<Parameters<typeof OrderTotalsSnapshot.create>[0]> = {}) {
  const line = OrderItem.create(
    UniqueEntityId.from("item-1"),
    must(ProductSnapshot.create("p-shirt", "Shirt", must(Money.create(5_000, "EGP")))),
    2,
  );
  const address = must(AddressSnapshot.create("1 Main St", "Cairo", "", "EG"));
  const totals = OrderTotalsSnapshot.create({
    subtotalMinor: 10_000,
    taxMinor: 0,
    shippingMinor: 6_000,
    discountMinor: 1_000,
    totalMinor: 9_000,
    currency: "EGP",
    ...totalsExtra,
  });
  return Order.createFromCheckout(
    UniqueEntityId.from("order-1"),
    must(OrderNumber.create("1001")),
    "customer-1",
    "EGP",
    [line],
    address,
    address,
    totals,
    "checkout-1",
    "evt-1",
    new Date(0),
  );
}

function roundTrip(o: Order): Order {
  return OrderMapper.toDomain(
    { ...OrderMapper.toOrderRow(o, "t1"), version: 1 } as never,
    OrderMapper.toItemRows(o, "t1"),
    OrderMapper.toEventRows(o, "t1"),
    OrderMapper.toAddressRow(o, "t1"),
  );
}

describe("OrderMapper — discounts (Phase 2)", () => {
  it("keeps the discounts and the shipping discount the order was placed with", () => {
    const discounts = [
      { title: "SALE10", code: "SALE10", discountClass: "order", amountMinor: 1_000 },
      { title: "Free shipping", discountClass: "shipping", amountMinor: 6_000 },
    ];
    const back = roundTrip(order({ discounts, shippingDiscountMinor: 6_000 }));
    expect(back.totals?.discounts).toEqual(discounts);
    expect(back.totals?.shippingDiscountMinor).toBe(6_000);
  });

  it("reads an order placed before Phase 2 as having no discount lines", () => {
    const back = roundTrip(order());
    expect(back.totals?.discounts).toEqual([]);
    expect(back.totals?.shippingDiscountMinor).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @platform/orders exec vitest run src/infrastructure/order.mapper.discounts.test.ts`
Expected: FAIL — type error on `discounts` / `discounts` undefined.

- [ ] **Step 3: Implement** —

`order-totals-snapshot.ts`: add above the props

```ts
/** Phase 2: one discount the order was placed with, as the shopper saw it. */
export interface OrderDiscountLine {
  readonly title: string;
  readonly code?: string;
  readonly discountClass: string;
  readonly amountMinor: number;
}
```

add to `OrderTotalsSnapshotProps`:

```ts
  /** Phase 2: the free-shipping part of the discounts; absent on older orders. */
  readonly shippingDiscountMinor?: number;
  /** Phase 2: each discount the shopper got; absent on older orders. */
  readonly discounts?: readonly OrderDiscountLine[];
```

and getters:

```ts
  get shippingDiscountMinor(): number {
    return this.props.shippingDiscountMinor ?? 0;
  }

  get discounts(): readonly OrderDiscountLine[] {
    return this.props.discounts ?? [];
  }
```

`create-order-from-checkout.use-case.ts`: add the same two optional fields (with the same doc comments) to `CreateOrderFromCheckoutTotalsInput`; `OrderTotalsSnapshot.create({ ...input.totals, currency: input.currency })` already spreads them through.

`order.mapper.ts`: add to `OrderTotalsJson`:

```ts
  /** Phase 2: JSON keys, no migration; absent on orders placed before discounts applied at checkout. */
  readonly shippingDiscountMinor?: number;
  readonly discounts?: readonly OrderDiscountLine[];
```

In `toDomain` they arrive through the existing `...row.totals` spread. In `OrderMapper.toOrderRow`, inside the `totals` object (next to the existing `shippingName` spread), add:

```ts
              ...(order.totals.shippingDiscountMinor === 0
                ? {}
                : { shippingDiscountMinor: order.totals.shippingDiscountMinor }),
              ...(order.totals.discounts.length === 0
                ? {}
                : { discounts: order.totals.discounts.map((d) => ({ ...d })) }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @platform/orders exec vitest run src/infrastructure`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @platform/orders exec tsc --noEmit` — Expected: no output.

```bash
git add services/orders/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -m "feat(orders): keep the discounts an order was placed with" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: apps/admin — discount evaluation and usage adapters, wiring, order DTO

**Files:**

- Modify: `apps/admin/src/infrastructure/cross-context/promotion-validation.adapter.ts`
- Create: `apps/admin/src/infrastructure/cross-context/discount-usage.adapter.ts`
- Modify: `apps/admin/src/infrastructure/cross-context/order-creation.adapter.ts`
- Modify: `apps/admin/src/composition.ts`
- Modify: `apps/admin/src/http/admin-routes.ts` (`OrderTotalsDto` and where it is built)
- Test: `apps/admin/src/infrastructure/cross-context/discount-adapters.test.ts` (create)

**Interfaces:**

- Consumes: `calculateDiscounts`, `normalizeDiscountCode`, `MAX_DISCOUNT_CODES`, `CouponState`, `DiscountCandidate`, `DiscountLine`, `Promotion` (`@platform/promotions`); `PromotionsController.get/listActiveAutomatic/recordUsage` (Task 3); `CouponsController.getByCode/redeem` (Task 4); `Coupon` (`@platform/coupons`); `DiscountEvaluationInput`, `DiscountSnapshot`, `DiscountUsagePort`, `AppliedDiscountSnapshot` (`@platform/checkout`).
- Produces:
  - `new PromotionValidationAdapter(products, promotions, coupons, clock)` — constructor gains `coupons: Pick<CouponsController, "getByCode">` and `clock: Clock`; `promotions` widens to `Pick<PromotionsController, "evaluate" | "get" | "listActiveAutomatic">`; new `evaluate(input)`.
  - `new DiscountUsageAdapter(promotions: Pick<PromotionsController, "recordUsage">, coupons: Pick<CouponsController, "redeem">)` implementing `DiscountUsagePort`. A code's use is redeemed on its coupon with idempotency key `${orderRef}:${couponId}`; an automatic discount's use is counted on its promotion.
  - `AdminWiringDeps.discountUsage?: DiscountUsagePort` (the `wireAdmin` deps interface — the one that already declares `promotionValidation?`).
  - `OrderTotalsDto` gains `shippingDiscountMinor: number` and `discounts: readonly { title: string; code: string | null; discountClass: string; amountMinor: number }[]`.

- [ ] **Step 1: Write the failing tests** — create `apps/admin/src/infrastructure/cross-context/discount-adapters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { CheckoutItem } from "@platform/checkout";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireCoupons, type Coupon } from "@platform/coupons";
import { wirePromotions, type Promotion } from "@platform/promotions";
import { DiscountUsageAdapter } from "./discount-usage.adapter";
import { PromotionValidationAdapter } from "./promotion-validation.adapter";

const TENANT = "tenant-1";
const clock: Clock = { now: () => new Date("2026-10-16T12:00:00.000Z") };

function contexts() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `0000${(n += 1)}`.slice(-5) };
  const deps = { serializer: new InMemoryEventSerializer(), idGenerator, clock };
  return { promotions: wirePromotions(deps).promotions, coupons: wireCoupons(deps).coupons };
}

const products = {
  async get() {
    return { status: 200, body: { categories: [{ categoryId: "summer" }] } };
  },
};

async function percentOff(
  c: ReturnType<typeof contexts>,
  method: "code" | "automatic",
  value: number,
): Promise<string> {
  const created = await c.promotions.create({
    tenantId: TENANT,
    name: method === "code" ? "SALE10" : "Autumn",
    ruleType: "automatic",
    scope: "cart",
    targetRefs: [],
    rewardType: "percentage",
    rewardValue: value,
    stackable: false,
    priority: 0,
    startsAt: new Date("2026-01-01T00:00:00.000Z"),
    method,
  });
  const { promotionId } = created.body as { promotionId: string };
  await c.promotions.advance({ tenantId: TENANT, promotionId, toStatus: "active" });
  return promotionId;
}

function item(quantity: number, unitPriceMinor: number): CheckoutItem {
  const result = CheckoutItem.create("prod-1", quantity, unitPriceMinor, "EGP");
  if (!result.ok) throw result.error;
  return result.value;
}

describe("PromotionValidationAdapter.evaluate (Phase 2)", () => {
  it("applies an entered code and an automatic discount through the real contexts", async () => {
    const c = contexts();
    const codeId = await percentOff(c, "code", 10);
    await c.coupons.create({
      tenantId: TENANT,
      code: "SALE10",
      promotionRef: codeId,
      multiUse: true,
    });
    const adapter = new PromotionValidationAdapter(
      products as never,
      c.promotions,
      c.coupons,
      clock,
    );

    const snapshot = await adapter.evaluate({
      tenantId: TENANT,
      items: [item(2, 5_000)],
      shipping: null,
      codes: [" sale10 "],
    });

    expect(snapshot.codeStatuses).toEqual([{ code: "SALE10", applicable: true }]);
    expect(snapshot.orderDiscountMinor).toBe(1_000);
    expect(snapshot.applied[0]).toMatchObject({ code: "SALE10", couponId: expect.any(String) });
  });

  it("answers not_found for a code nobody created", async () => {
    const c = contexts();
    const adapter = new PromotionValidationAdapter(
      products as never,
      c.promotions,
      c.coupons,
      clock,
    );
    const snapshot = await adapter.evaluate({
      tenantId: TENANT,
      items: [item(1, 1_000)],
      shipping: null,
      codes: ["NOPE"],
    });
    expect(snapshot.codeStatuses).toEqual([
      { code: "NOPE", applicable: false, reason: "not_found" },
    ]);
  });

  it("applies an automatic discount with no code", async () => {
    const c = contexts();
    await percentOff(c, "automatic", 5);
    const adapter = new PromotionValidationAdapter(
      products as never,
      c.promotions,
      c.coupons,
      clock,
    );
    const snapshot = await adapter.evaluate({
      tenantId: TENANT,
      items: [item(1, 10_000)],
      shipping: null,
      codes: [],
    });
    expect(snapshot.orderDiscountMinor).toBe(500);
  });
});

describe("DiscountUsageAdapter (Phase 2)", () => {
  it("redeems a code once per order and counts an automatic discount on its promotion", async () => {
    const c = contexts();
    const codeId = await percentOff(c, "code", 10);
    const autoId = await percentOff(c, "automatic", 5);
    await c.coupons.create({
      tenantId: TENANT,
      code: "SALE10",
      promotionRef: codeId,
      multiUse: true,
    });
    const coupon = (await c.coupons.getByCode({ tenantId: TENANT, code: "SALE10" })).body as Coupon;
    const adapter = new DiscountUsageAdapter(c.promotions, c.coupons);
    const usage = {
      tenantId: TENANT,
      orderRef: "order-1",
      email: "ali@example.com",
      applied: [
        {
          promotionId: codeId,
          couponId: coupon.id.toString(),
          code: "SALE10",
          title: "SALE10",
          discountClass: "order" as const,
          amountMinor: 1_000,
        },
        { promotionId: autoId, title: "Autumn", discountClass: "order" as const, amountMinor: 500 },
      ],
    };

    await adapter.record(usage);
    await adapter.record(usage);

    const after = (await c.coupons.getByCode({ tenantId: TENANT, code: "SALE10" })).body as Coupon;
    expect(after.usageCount).toBe(1);
    expect(after.redemptions[0]?.email).toBe("ali@example.com");
    const automatic = (await c.promotions.get({ tenantId: TENANT, promotionId: autoId }))
      .body as Promotion;
    expect(automatic.usageCount).toBe(2); // automatic uses are not deduplicated; CompleteCheckout calls this once per order
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @platform/admin exec vitest run src/infrastructure/cross-context/discount-adapters.test.ts`
Expected: FAIL — `./discount-usage.adapter` not found / constructor arity.

- [ ] **Step 3: `PromotionValidationAdapter.evaluate`** — in `promotion-validation.adapter.ts`:

Imports:

```ts
import type { Clock } from "@platform/contracts";
import type {
  CheckoutItem,
  DiscountEvaluationInput,
  DiscountSnapshot,
  PromotionValidationPort,
  PromotionValidationResult,
} from "@platform/checkout";
import type { Coupon, CouponsController } from "@platform/coupons";
import {
  calculateDiscounts,
  MAX_DISCOUNT_CODES,
  normalizeDiscountCode,
  type CouponState,
  type DiscountCandidate,
  type DiscountLine,
  type Promotion,
  type PromotionsController,
} from "@platform/promotions";
```

(`Promotion` and `PromotionsController` are already exported by `@platform/promotions`; keep the existing `CartSnapshot*`/`PromotionDetermination` imports used by `validate`.)

Change the fields and constructor:

```ts
  private readonly products: Pick<ProductController, "get">;
  private readonly promotions: Pick<PromotionsController, "evaluate" | "get" | "listActiveAutomatic">;
  private readonly coupons: Pick<CouponsController, "getByCode">;
  private readonly clock: Clock;

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
```

Add a module-level helper and the method:

```ts
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
```

```ts
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
      candidates.push({ promotion: promotionResponse.body as Promotion, coupon: toCouponState(coupon) });
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
```

- [ ] **Step 4: Create `apps/admin/src/infrastructure/cross-context/discount-usage.adapter.ts`**

```ts
import type { DiscountUsagePort } from "@platform/checkout";
import type { CouponsController } from "@platform/coupons";
import type { PromotionsController } from "@platform/promotions";

/**
 * Real `DiscountUsagePort` (Phase 2): counts each discount an order was placed with. A code is
 * redeemed on its coupon — keyed `${orderRef}:${couponId}`, so a retry never counts twice, and
 * carrying the guest's email so "one use per customer" also catches a returning guest. An automatic
 * discount is counted on its promotion. Every failure is collected and thrown at the end; Checkout
 * treats this as best effort and never undoes the order over it.
 */
export class DiscountUsageAdapter implements DiscountUsagePort {
  private readonly promotions: Pick<PromotionsController, "recordUsage">;
  private readonly coupons: Pick<CouponsController, "redeem">;

  constructor(
    promotions: Pick<PromotionsController, "recordUsage">,
    coupons: Pick<CouponsController, "redeem">,
  ) {
    this.promotions = promotions;
    this.coupons = coupons;
  }

  async record(input: Parameters<DiscountUsagePort["record"]>[0]): Promise<void> {
    const failures: string[] = [];
    for (const discount of input.applied) {
      const response =
        discount.couponId !== undefined && discount.code !== undefined
          ? await this.coupons.redeem({
              tenantId: input.tenantId,
              code: discount.code,
              customerRef: input.customerRef ?? `guest:${input.email ?? input.orderRef}`,
              ...(input.email === undefined ? {} : { email: input.email }),
              idempotencyKey: `${input.orderRef}:${discount.couponId}`,
              orderRef: input.orderRef,
            })
          : await this.promotions.recordUsage({
              tenantId: input.tenantId,
              promotionId: discount.promotionId,
            });
      if (response.status < 200 || response.status >= 300) {
        failures.push(`${discount.promotionId}: ${response.status}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`DiscountUsageAdapter: could not record ${failures.join(", ")}`);
    }
  }
}
```

- [ ] **Step 5: Order creation adapter and order DTO** — in `order-creation.adapter.ts`, inside the `totals: { ... }` object passed to Orders, add:

```ts
        // Phase 2: the free-shipping part and each discount, as the shopper saw them at checkout.
        ...(input.totals.shippingDiscountMinor === 0
          ? {}
          : { shippingDiscountMinor: input.totals.shippingDiscountMinor }),
        ...(input.discounts === undefined || input.discounts.length === 0
          ? {}
          : {
              discounts: input.discounts.map((d) => ({
                title: d.title,
                ...(d.code === undefined ? {} : { code: d.code }),
                discountClass: d.discountClass,
                amountMinor: d.amountMinor,
              })),
            }),
```

In `apps/admin/src/http/admin-routes.ts`, add to `OrderTotalsDto`:

```ts
  /** Phase 2: the free-shipping part of the discounts; 0 on older orders. */
  readonly shippingDiscountMinor: number;
  /** Phase 2: each discount the order was placed with (code null for an automatic one); empty on older orders. */
  readonly discounts: readonly {
    readonly title: string;
    readonly code: string | null;
    readonly discountClass: string;
    readonly amountMinor: number;
  }[];
```

and where the DTO's `totals` is built (the block that writes `shippingName: totals.shippingName ?? null`) add:

```ts
            shippingDiscountMinor: totals.shippingDiscountMinor,
            discounts: totals.discounts.map((d) => ({
              title: d.title,
              code: d.code ?? null,
              discountClass: d.discountClass,
              amountMinor: d.amountMinor,
            })),
```

- [ ] **Step 6: Wiring** — in `apps/admin/src/composition.ts`:
  1. Add to the `wireAdmin` deps interface, next to `promotionValidation?`:

```ts
  /**
   * Phase 2: records each discount's use once an order is placed. Absent ⇒ the real
   * `DiscountUsageAdapter` over Promotions + Coupons.
   */
  readonly discountUsage?: DiscountUsagePort;
```

(import `type DiscountUsagePort` from `@platform/checkout` alongside `PromotionValidationPort`.) 2. Move `const coupons = wireCoupons(deps);` from its current place (after `const content = wireContent(deps);`) up to right after `const promotions = wirePromotions(deps);` — Checkout's adapters now need it. 3. In `checkoutDeps`, replace the `promotionValidation` entry and add `discountUsage`:

```ts
    promotionValidation:
      deps.promotionValidation ??
      new PromotionValidationAdapter(catalog.products, promotions.promotions, coupons.coupons, deps.clock),
    discountUsage:
      deps.discountUsage ?? new DiscountUsageAdapter(promotions.promotions, coupons.coupons),
```

(import `DiscountUsageAdapter` from `./infrastructure/cross-context/discount-usage.adapter`.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @platform/admin exec vitest run src/infrastructure src/http/public-checkout-routes.test.ts src/http/promotions-routes.test.ts src/http/cart-checkout-pricing-security.e2e.test.ts`
Expected: PASS — the new file, and the existing checkout/promotion suites unchanged (no promotions exist there, so evaluation applies nothing).

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm --filter @platform/admin exec tsc --noEmit` — Expected: no output.

```bash
git add apps/admin/src/infrastructure apps/admin/src/composition.ts apps/admin/src/http/admin-routes.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -m "feat(admin): evaluate discounts and record their use at checkout" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Public routes — add and remove a discount code

**Files:**

- Modify: `apps/admin/src/http/public-checkout-routes.ts`
- Modify: `apps/admin/src/http/public-checkout-routes.test.ts` (route inventory)
- Test: `apps/admin/src/http/public-checkout-discounts.test.ts` (create)

**Interfaces:**

- Consumes: `CheckoutController.addDiscountCode/removeDiscountCode` (Task 6, through `admin.publicReads.checkout`), `DiscountCodeOutput`.
- Produces:
  - `POST /public/checkouts/:checkoutSessionId/discount-codes` body `{ sessionRef, code }` (strict) → 200 `PublicCheckoutSessionDto`, or 422 with `details: [{ field: "code", message: <reason> }]` when the code gives nothing.
  - `DELETE /public/checkouts/:checkoutSessionId/discount-codes/:code` (sessionRef from the `x-cart-session` header or `?sessionRef=`, like GET) → 200 `PublicCheckoutSessionDto`.
  - `PublicCheckoutSessionDto.totals` gains `discountMinor` and `shippingDiscountMinor`; the DTO gains:

```ts
  readonly discount: {
    readonly codes: readonly { readonly code: string; readonly applicable: boolean; readonly reason: string | null }[];
    readonly applied: readonly { readonly title: string; readonly code: string | null; readonly discountClass: string; readonly amountMinor: number }[];
  };
```

- [ ] **Step 1: Update the route inventory test** — in `public-checkout-routes.test.ts`, in "exposes exactly the 15 guest-completable routes", rename the test to "17" and add to the expected list:

```ts
        // Phase 2: a shopper enters and removes discount codes.
        "POST /public/checkouts/:checkoutSessionId/discount-codes",
        "DELETE /public/checkouts/:checkoutSessionId/discount-codes/:code",
```

- [ ] **Step 2: Write the failing tests** — create `apps/admin/src/http/public-checkout-discounts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import type { Coupon } from "@platform/coupons";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import type { Order } from "@platform/orders";
import type { Paginated } from "@platform/types";
import { wireAdmin, type WiredAdmin } from "../composition";
import { publicCartRoutes } from "./public-cart-routes";
import { publicCheckoutRoutes, type PublicCheckoutSessionDto } from "./public-checkout-routes";
import { controllerDriver, seedSingleVariantProduct } from "./testing/seed-catalog";
import { controllerStockDriver, seedStock } from "./testing/seed-stock";

const TENANT = "tenant-local";
const clock: Clock = { now: () => new Date("2026-10-16T12:00:00.000Z") };
const staff: Principal = { id: "staff-1", kind: "staff", roles: ["admin"], tenantId: TENANT };

interface Response {
  readonly status: number;
  readonly body: unknown;
}

function buildAdmin(): WiredAdmin {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  return wireAdmin({ serializer: new InMemoryEventSerializer(), idGenerator, clock });
}

function route(routes: readonly RouteDefinition[], method: string, path: string): RouteDefinition {
  const found = routes.find((r) => r.method === method && r.path === path);
  if (found === undefined) throw new Error(`no route ${method} ${path}`);
  return found;
}

function context(sessionRef?: string) {
  return {
    tenantId: TENANT,
    principal: { id: "public", kind: "customer", roles: [] },
    requestId: "req-1",
    headers: sessionRef === undefined ? {} : { "x-cart-session": sessionRef },
  };
}

function unwrap<T>(response: Response, action: string): T {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${action} failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return response.body as T;
}

/** A 10%-off-the-order code, created the way the admin facade will (promotion + coupon + activation). */
async function createCode(admin: WiredAdmin, code: string): Promise<void> {
  const created = unwrap<{ promotionId: string }>(
    await admin.promotions.create(staff, {
      tenantId: TENANT,
      name: code,
      ruleType: "automatic",
      scope: "cart",
      targetRefs: [],
      rewardType: "percentage",
      rewardValue: 10,
      stackable: false,
      priority: 0,
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      method: "code",
    }),
    "create promotion",
  );
  unwrap(
    await admin.coupons.create(staff, {
      tenantId: TENANT,
      code,
      promotionRef: created.promotionId,
      multiUse: true,
    }),
    "create coupon",
  );
  unwrap(
    await admin.promotions.advance(staff, {
      tenantId: TENANT,
      promotionId: created.promotionId,
      toStatus: "active",
    }),
    "activate",
  );
}

/** A guest checkout with one 19.99 line, both addresses, shipping and payment chosen. */
async function readyCheckout(admin: WiredAdmin, sessionRef: string) {
  const product = await seedSingleVariantProduct(
    controllerDriver(admin.publicReads.products, TENANT),
    "P-1",
    1999,
  );
  await seedStock(controllerStockDriver(admin.inventory, staff, TENANT), {
    productId: product.productId,
    variantId: product.variantId,
    quantity: 100,
  });
  const cartRoutes = publicCartRoutes(admin);
  const checkoutRoutes = publicCheckoutRoutes(admin);
  const call = (
    routes: readonly RouteDefinition[],
    method: string,
    path: string,
    params: Record<string, string>,
    body?: unknown,
    query: Record<string, string> = {},
  ) =>
    route(routes, method, path).handle({
      body,
      params,
      query,
      context: context(sessionRef),
    } as never) as Promise<Response>;

  const cart = unwrap<{ id: string }>(
    await call(cartRoutes, "POST", "/public/carts", {}, { sessionRef, currency: "USD" }),
    "cart",
  );
  await call(
    cartRoutes,
    "POST",
    "/public/carts/:cartId/items",
    { cartId: cart.id },
    { sessionRef, productId: product.productId, quantity: 1 },
  );
  const started = unwrap<PublicCheckoutSessionDto>(
    await call(
      checkoutRoutes,
      "POST",
      "/public/checkouts",
      {},
      { sessionRef, cartRef: cart.id, currency: "USD" },
    ),
    "start",
  );
  const id = { checkoutSessionId: started.id };
  const address = {
    sessionRef,
    line1: "1 Main St",
    city: "Springfield",
    postalCode: "00000",
    country: "US",
  };
  await call(checkoutRoutes, "POST", "/public/checkouts/:checkoutSessionId/items", id, {
    sessionRef,
    cartId: cart.id,
  });
  await call(
    checkoutRoutes,
    "POST",
    "/public/checkouts/:checkoutSessionId/billing-address",
    id,
    address,
  );
  await call(
    checkoutRoutes,
    "POST",
    "/public/checkouts/:checkoutSessionId/shipping-address",
    id,
    address,
  );
  await call(
    checkoutRoutes,
    "POST",
    "/public/checkouts/:checkoutSessionId/shipping-selection",
    id,
    { sessionRef, method: "standard" },
  );
  await call(checkoutRoutes, "POST", "/public/checkouts/:checkoutSessionId/payment-selection", id, {
    sessionRef,
    paymentMethodRef: "pm_1",
    provider: "stripe",
  });
  await call(checkoutRoutes, "POST", "/public/checkouts/:checkoutSessionId/contact", id, {
    sessionRef,
    email: "guest@example.com",
  });
  await call(checkoutRoutes, "POST", "/public/checkouts/:checkoutSessionId/recalculate", id, {
    sessionRef,
  });

  return {
    id,
    addCode: (code: string, ref = sessionRef) =>
      route(checkoutRoutes, "POST", "/public/checkouts/:checkoutSessionId/discount-codes").handle({
        body: { sessionRef: ref, code },
        params: id,
        query: {},
        context: context(ref),
      } as never) as Promise<Response>,
    removeCode: (code: string) =>
      call(checkoutRoutes, "DELETE", "/public/checkouts/:checkoutSessionId/discount-codes/:code", {
        ...id,
        code,
      }),
    complete: () =>
      call(checkoutRoutes, "POST", "/public/checkouts/:checkoutSessionId/complete", id, {
        sessionRef,
        idempotencyKey: "k-1",
      }),
  };
}

describe("public checkout — discount codes (Phase 2)", () => {
  it("applies a code: the session shows it and the total drops", async () => {
    const admin = buildAdmin();
    await createCode(admin, "SALE10");
    const checkout = await readyCheckout(admin, "s-1");

    const session = unwrap<PublicCheckoutSessionDto>(await checkout.addCode("sale10"), "add code");

    expect(session.discount.codes).toEqual([{ code: "SALE10", applicable: true, reason: null }]);
    expect(session.discount.applied).toEqual([
      { title: "SALE10", code: "SALE10", discountClass: "order", amountMinor: 199 },
    ]);
    expect(session.totals?.discountMinor).toBe(199);
  });

  it("refuses an unknown code with 422 and the reason", async () => {
    const admin = buildAdmin();
    const checkout = await readyCheckout(admin, "s-1");
    const response = await checkout.addCode("NOPE");
    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain("not_found");
  });

  it("removes a code and its discount", async () => {
    const admin = buildAdmin();
    await createCode(admin, "SALE10");
    const checkout = await readyCheckout(admin, "s-1");
    await checkout.addCode("SALE10");
    const session = unwrap<PublicCheckoutSessionDto>(await checkout.removeCode("SALE10"), "remove");
    expect(session.discount.codes).toEqual([]);
    expect(session.totals?.discountMinor).toBe(0);
  });

  it("does not let another session add a code to this checkout", async () => {
    const admin = buildAdmin();
    await createCode(admin, "SALE10");
    const checkout = await readyCheckout(admin, "s-1");
    expect((await checkout.addCode("SALE10", "someone-else")).status).toBe(404);
  });

  it("places the order with the discount and counts the code's use", async () => {
    const admin = buildAdmin();
    await createCode(admin, "SALE10");
    const checkout = await readyCheckout(admin, "s-1");
    await checkout.addCode("SALE10");

    const completed = unwrap<PublicCheckoutSessionDto>(await checkout.complete(), "complete");

    const order = unwrap<Order>(
      (await admin.orders.getOrder(staff, {
        tenantId: TENANT,
        orderId: completed.orderRef ?? "",
      })) as Response,
      "order",
    );
    expect(order.totals?.discountMinor).toBe(199);
    expect(order.totals?.discounts.map((d) => d.code)).toEqual(["SALE10"]);
    const coupons = unwrap<Paginated<Coupon>>(
      (await admin.coupons.list(staff, { tenantId: TENANT, first: 10 })) as Response,
      "coupons",
    );
    expect(coupons.items[0]?.usageCount).toBe(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @platform/admin exec vitest run src/http/public-checkout-discounts.test.ts src/http/public-checkout-routes.test.ts`
Expected: FAIL — `no route POST /public/checkouts/:checkoutSessionId/discount-codes`.

- [ ] **Step 4: Implement** — in `public-checkout-routes.ts`:

Change the utils import to `import { NotFoundError, ValidationError, toErrorEnvelope } from "@platform/utils";` and add `import type { DiscountCodeOutput } from "@platform/checkout";` (merge into the existing `@platform/checkout` import).

Schemas, next to the other schemas:

```ts
/** Phase 2: a code the shopper typed — never an amount. Normalised by Checkout. */
const discountCodeBody = z
  .object({ sessionRef: z.string().min(1), code: z.string().trim().min(1).max(64) })
  .strict();
const discountCodeParams = z.object({
  checkoutSessionId: z.string().min(1),
  code: z.string().min(1).max(64),
});
```

DTO — in `PublicCheckoutSessionDto.totals` add `readonly discountMinor: number; readonly shippingDiscountMinor: number;`, and the `discount` member from **Interfaces**. In `toPublicCheckoutSessionDto`, add to `totals`:

```ts
            discountMinor: session.totals.discountMinor,
            shippingDiscountMinor: session.totals.shippingDiscountMinor,
```

and the member:

```ts
    // Phase 2: the codes the shopper entered with whether each applies, and what was taken off —
    // titles and amounts only, never promotion internals.
    discount: {
      codes: session.discountCodes.map((code) => {
        const status = session.discountSnapshot?.codeStatuses.find((s) => s.code === code);
        return { code, applicable: status?.applicable === true, reason: status?.reason ?? null };
      }),
      applied: (session.discountSnapshot?.applied ?? []).map((a) => ({
        title: a.title,
        code: a.code ?? null,
        discountClass: a.discountClass,
        amountMinor: a.amountMinor,
      })),
    },
```

Routes, after the `recalculate` route:

```ts
    defineRoute({
      method: "POST",
      path: "/public/checkouts/:checkoutSessionId/discount-codes",
      version: 1,
      permission: "checkout:recalculate",
      public: true,
      idempotent: true,
      summary: "Public: apply a discount code to the caller's own checkout session",
      schema: { params: checkoutSessionIdParams, body: discountCodeBody },
      handle: async ({ params, body, context }) => {
        const owned = await requireOwnedSession(admin, params.checkoutSessionId, body.sessionRef, context.tenantId);
        if (!(owned instanceof CheckoutSession)) return owned;
        const result = await admin.publicReads.checkout.addDiscountCode({
          tenantId: context.tenantId,
          checkoutSessionId: params.checkoutSessionId,
          code: body.code,
        });
        if (result.status < 200 || result.status >= 300) return result;
        const outcome = result.body as DiscountCodeOutput;
        if (!outcome.applicable) {
          // The reason is a stable token (`not_found`, `minimum_not_met`, …) the storefront words.
          return {
            status: 422,
            body: toErrorEnvelope(
              new ValidationError("Discount code not applied", [
                { field: "code", message: outcome.reason ?? "not_found" },
              ]),
            ),
          };
        }
        return mapSession(
          await admin.publicReads.checkout.get({ ...params, tenantId: context.tenantId }),
          toPublicCheckoutSessionDto,
        );
      },
    }),
    defineRoute({
      method: "DELETE",
      path: "/public/checkouts/:checkoutSessionId/discount-codes/:code",
      version: 1,
      permission: "checkout:recalculate",
      public: true,
      idempotent: true,
      summary: "Public: remove a discount code from the caller's own checkout session",
      schema: { params: discountCodeParams, querystring: sessionRefQuery },
      handle: async ({ params, query, context }) => {
        const sessionRef = resolveSessionRef(context, query.sessionRef);
        const owned = await requireOwnedSession(admin, params.checkoutSessionId, sessionRef, context.tenantId);
        if (!(owned instanceof CheckoutSession)) return owned;
        const result = await admin.publicReads.checkout.removeDiscountCode({
          tenantId: context.tenantId,
          checkoutSessionId: params.checkoutSessionId,
          code: params.code,
        });
        if (result.status < 200 || result.status >= 300) return result;
        return mapSession(
          await admin.publicReads.checkout.get({ tenantId: context.tenantId, checkoutSessionId: params.checkoutSessionId }),
          toPublicCheckoutSessionDto,
        );
      },
    }),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @platform/admin exec vitest run src/http/public-checkout-discounts.test.ts src/http/public-checkout-routes.test.ts`
Expected: PASS. If the DTO-boundary test in `public-checkout-routes.test.ts` lists the DTO's keys exactly, add `discount` there.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @platform/admin exec tsc --noEmit` — Expected: no output.

```bash
git add apps/admin/src/http/public-checkout-routes.ts apps/admin/src/http/public-checkout-routes.test.ts apps/admin/src/http/public-checkout-discounts.test.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -m "feat(admin): public routes to apply and remove discount codes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Admin `/discounts` API — one Shopify-style facade over promotions and coupons

**Files:**

- Create: `apps/admin/src/interfaces/discounts/discount-input.ts`
- Create: `apps/admin/src/interfaces/discounts/discount-dto.ts`
- Create: `apps/admin/src/interfaces/discounts/discounts.admin-controller.ts`
- Create: `apps/admin/src/http/discounts-routes.ts`
- Modify: `apps/admin/src/http/admin-routes.ts` (register the routes)
- Modify: `apps/admin/src/composition.ts` (`WiredAdmin.discounts`)
- Test: `apps/admin/src/http/discounts-routes.test.ts` (create)

**Interfaces:**

- Consumes: Task 3 (`create` with `method`, `update`, `listForAdmin`, `get`, `advance`), Task 4 (`getByCode`, `listByPromotionRefs`, `findPromotionRefsByCode`, `reconfigure`, `create`, `advance`), `Promotion.viewAt`, `Promotion.method`.
- Produces:
  - `discountInputSchema` (zod) and `type DiscountInput`.
  - `DiscountDto` (below) and `toDiscountDto(promotion, coupon | undefined, now)`, `discountTypeOf(promotion)`, `toPromotionFields(input)`.
  - `DiscountsAdminController` with `list(principal, { tenantId, view, q?, first?, after? })`, `get(principal, { tenantId, discountId })`, `create(principal, { tenantId, input })`, `update(principal, { tenantId, discountId, input })`, `deactivate/activate/remove(principal, { tenantId, discountId })`.
  - Routes: `GET /discounts`, `GET /discounts/:discountId`, `POST /discounts`, `PUT /discounts/:discountId`, `POST /discounts/:discountId/deactivate`, `POST /discounts/:discountId/activate`, `DELETE /discounts/:discountId`. Reads use `promotions:read`; writes use `promotions:create` (see Refinements §1).

```ts
export type DiscountType =
  "amount_off_products" | "amount_off_order" | "buy_x_get_y" | "free_shipping";
export interface DiscountDto {
  readonly id: string;
  readonly type: DiscountType;
  readonly method: "code" | "automatic";
  readonly title: string;
  readonly code: string | null;
  readonly status: "active" | "scheduled" | "expired";
  readonly value: { readonly kind: "percentage" | "fixed_amount"; readonly amount: number } | null;
  readonly appliesTo: {
    readonly kind: "products" | "categories";
    readonly refs: readonly string[];
  } | null;
  readonly appliesOncePerOrder: boolean;
  readonly buys: {
    readonly kind: "quantity" | "amount";
    readonly value: number;
    readonly scope: "products" | "categories";
    readonly refs: readonly string[];
  } | null;
  readonly gets: {
    readonly quantity: number;
    readonly scope: "products" | "categories";
    readonly refs: readonly string[];
    readonly effect:
      { readonly kind: "percentage"; readonly value: number } | { readonly kind: "free" };
  } | null;
  readonly maxUsesPerOrder: number | null;
  readonly countries: readonly string[] | null;
  readonly maxShippingRateMinor: number | null;
  readonly minimumRequirement:
    | { readonly kind: "none" }
    | { readonly kind: "amount"; readonly amountMinor: number }
    | { readonly kind: "quantity"; readonly quantity: number };
  readonly customerEligibility:
    | { readonly kind: "all" }
    | { readonly kind: "customers"; readonly customerRefs: readonly string[] };
  readonly usageLimit: number | null;
  readonly oncePerCustomer: boolean;
  readonly combinesWith: {
    readonly product: boolean;
    readonly order: boolean;
    readonly shipping: boolean;
  };
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly usageCount: number;
}
```

- [ ] **Step 1: Write the failing tests** — create `apps/admin/src/http/discounts-routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin, type WiredAdmin } from "../composition";
import type { DiscountDto } from "../interfaces/discounts/discount-dto";
import { discountsRoutes } from "./discounts-routes";

const TENANT = "tenant-local";
const clock: Clock = { now: () => new Date("2026-10-16T12:00:00.000Z") };
const staff: Principal = { id: "staff-1", kind: "staff", roles: ["admin"], tenantId: TENANT };

interface Response {
  readonly status: number;
  readonly body: unknown;
}

function build() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `0000000${(n += 1)}`.slice(-8) };
  const admin: WiredAdmin = wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
  });
  const routes = discountsRoutes(admin);
  const call = (
    method: string,
    path: string,
    params: Record<string, string> = {},
    body?: unknown,
    query: Record<string, string> = {},
  ) => {
    const route = routes.find((r: RouteDefinition) => r.method === method && r.path === path);
    if (route === undefined) throw new Error(`no route ${method} ${path}`);
    return route.handle({
      body,
      params,
      query,
      context: { tenantId: TENANT, principal: staff, requestId: "r" },
    } as never) as Promise<Response>;
  };
  return { admin, call };
}

const common = {
  minimumRequirement: { kind: "none" },
  customerEligibility: { kind: "all" },
  oncePerCustomer: false,
  combinesWith: { product: false, order: false, shipping: false },
  startsAt: "2026-01-01T00:00:00.000Z",
};

const sale10 = {
  ...common,
  type: "amount_off_order",
  method: "code",
  code: "sale10",
  value: { kind: "percentage", amount: 10 },
  minimumRequirement: { kind: "amount", amountMinor: 20_000 },
  usageLimit: 100,
  oncePerCustomer: true,
};

function body<T>(response: Response): T {
  if (response.status < 200 || response.status >= 300)
    throw new Error(`${response.status}: ${JSON.stringify(response.body)}`);
  return response.body as T;
}

describe("/discounts — Shopify-style facade (Phase 2)", () => {
  it("creates a code discount and reads it back in Shopify's shape", async () => {
    const { call } = build();
    const created = body<DiscountDto>(await call("POST", "/discounts", {}, sale10));
    expect(created).toMatchObject({
      type: "amount_off_order",
      method: "code",
      title: "SALE10",
      code: "SALE10",
      status: "active",
      value: { kind: "percentage", amount: 10 },
      minimumRequirement: { kind: "amount", amountMinor: 20_000 },
      usageLimit: 100,
      oncePerCustomer: true,
      usageCount: 0,
    });
    expect(
      body<DiscountDto>(await call("GET", "/discounts/:discountId", { discountId: created.id })),
    ).toEqual(created);
  });

  it("creates each of the four types", async () => {
    const { call } = build();
    const products = body<DiscountDto>(
      await call(
        "POST",
        "/discounts",
        {},
        {
          ...common,
          type: "amount_off_products",
          method: "automatic",
          title: "Shoes 20% off",
          value: { kind: "percentage", amount: 20 },
          appliesTo: { kind: "categories", refs: ["shoes"] },
        },
      ),
    );
    expect(products).toMatchObject({
      type: "amount_off_products",
      method: "automatic",
      code: null,
      appliesTo: { kind: "categories", refs: ["shoes"] },
    });

    const bxgy = body<DiscountDto>(
      await call(
        "POST",
        "/discounts",
        {},
        {
          ...common,
          type: "buy_x_get_y",
          method: "code",
          code: "SOCKS",
          buys: { kind: "quantity", value: 2, scope: "products", refs: ["shirt"] },
          gets: { quantity: 1, scope: "products", refs: ["sock"], effect: { kind: "free" } },
          maxUsesPerOrder: 1,
        },
      ),
    );
    expect(bxgy).toMatchObject({
      type: "buy_x_get_y",
      buys: { kind: "quantity", value: 2, scope: "products", refs: ["shirt"] },
      maxUsesPerOrder: 1,
    });

    const shipping = body<DiscountDto>(
      await call(
        "POST",
        "/discounts",
        {},
        {
          ...common,
          type: "free_shipping",
          method: "code",
          code: "SHIPFREE",
          countries: ["EG"],
          maxShippingRateMinor: 10_000,
        },
      ),
    );
    expect(shipping).toMatchObject({
      type: "free_shipping",
      countries: ["EG"],
      maxShippingRateMinor: 10_000,
    });
  });

  it("refuses a code already in use with a field error", async () => {
    const { call } = build();
    await call("POST", "/discounts", {}, sale10);
    const again = await call("POST", "/discounts", {}, { ...sale10, code: "SALE10" });
    expect(again.status).toBe(422);
    expect(JSON.stringify(again.body)).toContain("This code is already in use");
  });

  it("lists by tab and finds a discount by part of its code", async () => {
    const { call } = build();
    const active = body<DiscountDto>(await call("POST", "/discounts", {}, sale10));
    const later = body<DiscountDto>(
      await call(
        "POST",
        "/discounts",
        {},
        { ...sale10, code: "WINTER", startsAt: "2027-01-01T00:00:00.000Z" },
      ),
    );
    const ids = async (query: Record<string, string>) =>
      body<{ items: DiscountDto[] }>(
        await call("GET", "/discounts", {}, undefined, query),
      ).items.map((d) => d.id);
    expect(await ids({})).toEqual([later.id, active.id]);
    expect(await ids({ view: "active" })).toEqual([active.id]);
    expect(await ids({ view: "scheduled" })).toEqual([later.id]);
    expect(await ids({ q: "wint" })).toEqual([later.id]);
  });

  it("edits a discount, including its code and limits", async () => {
    const { call } = build();
    const created = body<DiscountDto>(await call("POST", "/discounts", {}, sale10));
    const edited = body<DiscountDto>(
      await call(
        "PUT",
        "/discounts/:discountId",
        { discountId: created.id },
        { ...sale10, code: "SALE15", value: { kind: "percentage", amount: 15 }, usageLimit: 5 },
      ),
    );
    expect(edited).toMatchObject({
      code: "SALE15",
      title: "SALE15",
      value: { kind: "percentage", amount: 15 },
      usageLimit: 5,
    });
  });

  it("refuses to change a discount's type or method", async () => {
    const { call } = build();
    const created = body<DiscountDto>(await call("POST", "/discounts", {}, sale10));
    const response = await call(
      "PUT",
      "/discounts/:discountId",
      { discountId: created.id },
      { ...common, type: "free_shipping", method: "code", code: "SALE10" },
    );
    expect(response.status).toBe(422);
  });

  it("deactivates (shown as expired), reactivates and deletes", async () => {
    const { call } = build();
    const created = body<DiscountDto>(await call("POST", "/discounts", {}, sale10));
    const id = { discountId: created.id };
    expect(
      body<DiscountDto>(await call("POST", "/discounts/:discountId/deactivate", id)).status,
    ).toBe("expired");
    expect(
      body<DiscountDto>(await call("POST", "/discounts/:discountId/activate", id)).status,
    ).toBe("active");
    expect((await call("DELETE", "/discounts/:discountId", id)).status).toBe(200);
    expect((await call("GET", "/discounts/:discountId", id)).status).toBe(404);
    expect(body<{ items: DiscountDto[] }>(await call("GET", "/discounts")).items).toEqual([]);
  });

  it("validates the input per type", async () => {
    const { call } = build();
    const missingValue = await call(
      "POST",
      "/discounts",
      {},
      { ...common, type: "amount_off_order", method: "code", code: "NOVALUE" },
    );
    expect(missingValue.status).toBe(422);
    const missingCode = await call(
      "POST",
      "/discounts",
      {},
      { ...common, type: "free_shipping", method: "code" },
    );
    expect(missingCode.status).toBe(422);
  });
});
```

(The schema-level 422 in the last test comes from the route layer: if `route.handle` does not run zod itself in this test harness, parse with `discountInputSchema.safeParse` inside the handler as Step 6 shows — the handler below does that explicitly so the test does not depend on the harness.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @platform/admin exec vitest run src/http/discounts-routes.test.ts`
Expected: FAIL — `./discounts-routes` not found.

- [ ] **Step 3: Create `apps/admin/src/interfaces/discounts/discount-input.ts`**

```ts
import { z } from "zod";

const refs = z.array(z.string().min(1)).min(1).max(250);
const scope = z.enum(["products", "categories"]);

/**
 * The Shopify discount form (Phase 2), one shape for the four types. Per-type requirements are
 * checked in `superRefine` so each missing field is reported on its own path. Amounts are minor
 * units; a percentage is 0–100 with up to two decimals.
 */
export const discountInputSchema = z
  .object({
    type: z.enum(["amount_off_products", "amount_off_order", "buy_x_get_y", "free_shipping"]),
    method: z.enum(["code", "automatic"]),
    title: z.string().trim().min(1).max(255).optional(),
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{3,32}$/, "3-32 letters, digits, _ or -")
      .optional(),
    value: z
      .object({ kind: z.enum(["percentage", "fixed_amount"]), amount: z.number().positive() })
      .optional(),
    appliesTo: z.object({ kind: scope, refs }).optional(),
    appliesOncePerOrder: z.boolean().optional(),
    buys: z
      .object({
        kind: z.enum(["quantity", "amount"]),
        value: z.number().int().positive(),
        scope,
        refs,
      })
      .optional(),
    gets: z
      .object({
        quantity: z.number().int().positive(),
        scope,
        refs,
        effect: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("percentage"), value: z.number().positive().max(100) }),
          z.object({ kind: z.literal("free") }),
        ]),
      })
      .optional(),
    maxUsesPerOrder: z.number().int().positive().optional(),
    countries: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .min(1)
      .optional(),
    maxShippingRateMinor: z.number().int().min(0).optional(),
    minimumRequirement: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }),
      z.object({ kind: z.literal("amount"), amountMinor: z.number().int().positive() }),
      z.object({ kind: z.literal("quantity"), quantity: z.number().int().positive() }),
    ]),
    customerEligibility: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("all") }),
      z.object({ kind: z.literal("customers"), customerRefs: z.array(z.string().min(1)).min(1) }),
    ]),
    usageLimit: z.number().int().positive().optional(),
    oncePerCustomer: z.boolean(),
    combinesWith: z.object({ product: z.boolean(), order: z.boolean(), shipping: z.boolean() }),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const need = (condition: boolean, path: string, message: string) => {
      if (!condition) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    };
    need(
      input.method !== "code" || input.code !== undefined,
      "code",
      "required for a discount code",
    );
    need(
      input.method !== "automatic" || input.title !== undefined,
      "title",
      "required for an automatic discount",
    );
    if (input.type === "amount_off_products" || input.type === "amount_off_order") {
      need(input.value !== undefined, "value", "required");
      if (input.value?.kind === "percentage")
        need(input.value.amount <= 100, "value", "at most 100");
      if (input.value?.kind === "fixed_amount") {
        need(Number.isInteger(input.value.amount), "value", "a whole number of minor units");
      }
    }
    if (input.type === "amount_off_products")
      need(input.appliesTo !== undefined, "appliesTo", "choose products or categories");
    if (input.type === "buy_x_get_y") {
      need(input.buys !== undefined, "buys", "required");
      need(input.gets !== undefined, "gets", "required");
    }
    need(
      input.endsAt === undefined || input.endsAt.getTime() > input.startsAt.getTime(),
      "endsAt",
      "must be after the start",
    );
  });

export type DiscountInput = z.infer<typeof discountInputSchema>;
```

- [ ] **Step 4: Create `apps/admin/src/interfaces/discounts/discount-dto.ts`**

Copy the `DiscountType` and `DiscountDto` declarations from **Interfaces** above into this file, then add:

```ts
import type { Coupon } from "@platform/coupons";
import type { Promotion } from "@platform/promotions";
import type { DiscountInput } from "./discount-input";

const toScope = (scope: string): "products" | "categories" =>
  scope === "category" ? "categories" : "products";
const fromScope = (scope: "products" | "categories"): "product" | "category" =>
  scope === "categories" ? "category" : "product";

/** Shopify's four types, read off the promotion's rule. */
export function discountTypeOf(promotion: Promotion): DiscountType {
  if (promotion.rule.reward.type === "free_shipping") return "free_shipping";
  if (promotion.rule.type === "buy_x_get_y") return "buy_x_get_y";
  return promotion.rule.condition.scope === "cart" ? "amount_off_order" : "amount_off_products";
}

/** A promotion created before Phase 2 has no method: it is a code discount when a coupon points at it. */
export function discountMethodOf(
  promotion: Promotion,
  coupon: Coupon | undefined,
): "code" | "automatic" {
  return promotion.method ?? (coupon === undefined ? "automatic" : "code");
}

/** The admin's view of one discount — never promotion or coupon internals. */
export function toDiscountDto(
  promotion: Promotion,
  coupon: Coupon | undefined,
  now: Date,
): DiscountDto {
  const type = discountTypeOf(promotion);
  const { condition, reward } = promotion.rule;
  const view = promotion.viewAt(now);
  return {
    id: promotion.id.toString(),
    type,
    method: discountMethodOf(promotion, coupon),
    title: promotion.name,
    code: coupon?.code.value ?? null,
    status: view === "archived" ? "expired" : view,
    value:
      type === "amount_off_order" || type === "amount_off_products"
        ? {
            kind: reward.type === "fixed_amount" ? "fixed_amount" : "percentage",
            amount: reward.value ?? 0,
          }
        : null,
    appliesTo:
      type === "amount_off_products"
        ? { kind: toScope(condition.scope), refs: condition.targetRefs }
        : null,
    appliesOncePerOrder: reward.appliesOncePerOrder === true,
    buys:
      type === "buy_x_get_y" && reward.buys !== undefined
        ? {
            kind: reward.buys.kind,
            value: reward.buys.value,
            scope: toScope(condition.scope),
            refs: condition.targetRefs,
          }
        : null,
    gets:
      type === "buy_x_get_y" && reward.gets !== undefined
        ? {
            quantity: reward.gets.quantity,
            scope: toScope(reward.gets.scope),
            refs: reward.gets.targetRefs,
            effect: reward.gets.effect,
          }
        : null,
    maxUsesPerOrder: reward.maxUsesPerOrder ?? null,
    countries: reward.countries ?? null,
    maxShippingRateMinor: reward.maxShippingRateMinor ?? null,
    minimumRequirement:
      condition.minimumSubtotalAmountMinor !== undefined
        ? { kind: "amount", amountMinor: condition.minimumSubtotalAmountMinor }
        : condition.minimumQuantity !== undefined
          ? { kind: "quantity", quantity: condition.minimumQuantity }
          : { kind: "none" },
    customerEligibility:
      promotion.eligibility.customerRefs === undefined
        ? { kind: "all" }
        : { kind: "customers", customerRefs: promotion.eligibility.customerRefs },
    usageLimit: coupon?.usageLimit ?? null,
    oncePerCustomer: coupon !== undefined && !coupon.multiUse,
    combinesWith: promotion.combinesWith,
    startsAt: promotion.schedule.startsAt.toISOString(),
    endsAt: promotion.schedule.endsAt?.toISOString() ?? null,
    usageCount: coupon?.usageCount ?? promotion.usageCount,
  };
}

/**
 * The Promotions fields for a discount form. A code discount is titled by its code, as in Shopify.
 * `stackable`/`priority` are legacy and fixed; combinations come from `combinesWith`.
 */
export function toPromotionFields(input: DiscountInput) {
  const name =
    input.method === "code" ? (input.code ?? "").trim().toUpperCase() : (input.title ?? "").trim();
  const minimum =
    input.type === "buy_x_get_y" || input.minimumRequirement.kind === "none"
      ? {}
      : input.minimumRequirement.kind === "amount"
        ? { minimumSubtotalAmountMinor: input.minimumRequirement.amountMinor }
        : { minimumQuantity: input.minimumRequirement.quantity };
  const customers =
    input.customerEligibility.kind === "customers"
      ? { customerRefs: input.customerEligibility.customerRefs }
      : {};
  const common = {
    name,
    stackable: false,
    priority: 0,
    startsAt: input.startsAt,
    ...(input.endsAt === undefined ? {} : { endsAt: input.endsAt }),
    combinesWith: input.combinesWith,
    ...minimum,
    ...customers,
  };
  switch (input.type) {
    case "amount_off_order":
      return {
        ...common,
        ruleType: "automatic" as const,
        scope: "cart" as const,
        targetRefs: [],
        rewardType: input.value!.kind,
        rewardValue: input.value!.amount,
      };
    case "amount_off_products":
      return {
        ...common,
        ruleType: "automatic" as const,
        scope: fromScope(input.appliesTo!.kind),
        targetRefs: input.appliesTo!.refs,
        rewardType: input.value!.kind,
        rewardValue: input.value!.amount,
        appliesOncePerOrder: input.appliesOncePerOrder === true,
      };
    case "free_shipping":
      return {
        ...common,
        ruleType: "automatic" as const,
        scope: "cart" as const,
        targetRefs: [],
        rewardType: "free_shipping" as const,
        ...(input.countries === undefined ? {} : { countries: input.countries }),
        ...(input.maxShippingRateMinor === undefined
          ? {}
          : { maxShippingRateMinor: input.maxShippingRateMinor }),
      };
    case "buy_x_get_y":
      return {
        ...common,
        ruleType: "buy_x_get_y" as const,
        scope: fromScope(input.buys!.scope),
        targetRefs: input.buys!.refs,
        rewardType: "buy_x_get_y" as const,
        buys: { kind: input.buys!.kind, value: input.buys!.value },
        gets: {
          quantity: input.gets!.quantity,
          scope: fromScope(input.gets!.scope),
          targetRefs: input.gets!.refs,
          effect: input.gets!.effect,
        },
        ...(input.maxUsesPerOrder === undefined ? {} : { maxUsesPerOrder: input.maxUsesPerOrder }),
      };
  }
}
```

- [ ] **Step 5: Create `apps/admin/src/interfaces/discounts/discounts.admin-controller.ts`**

```ts
import type { Clock, Principal } from "@platform/contracts";
import type { Coupon, CouponsController } from "@platform/coupons";
import type { Promotion, PromotionsController } from "@platform/promotions";
import type { Paginated } from "@platform/types";
import { NotFoundError, ValidationError, toErrorEnvelope } from "@platform/utils";
import type { AdminGuard } from "../admin-guard";
import type { AdminResponse } from "../admin-response";
import { discountMethodOf, discountTypeOf, toDiscountDto, toPromotionFields } from "./discount-dto";
import type { DiscountInput } from "./discount-input";

export interface DiscountsAdminControllerDeps {
  readonly promotions: PromotionsController;
  readonly coupons: CouponsController;
  readonly guard: AdminGuard;
  readonly clock: Clock;
}

type DiscountView = "all" | "active" | "scheduled" | "expired";

function fieldError(field: string, message: string): AdminResponse {
  return {
    status: 422,
    body: toErrorEnvelope(new ValidationError("Invalid discount", [{ field, message }])),
  };
}

const codeTaken = () => fieldError("code", "This code is already in use");
const notFound = (): AdminResponse => ({
  status: 404,
  body: toErrorEnvelope(new NotFoundError("Discount not found")),
});
const isOk = (response: AdminResponse) => response.status >= 200 && response.status < 300;

/**
 * The admin Discounts screen's API (Phase 2): one Shopify-style discount over a Promotion (the
 * rule) and, for a code, a Coupon (the code, its limits, its usage). The merchant never sees the
 * split. Reads need `promotions:read`; every write needs `promotions:create` — the two permissions
 * the Ory seed grants.
 */
export class DiscountsAdminController {
  private readonly deps: DiscountsAdminControllerDeps;

  constructor(deps: DiscountsAdminControllerDeps) {
    this.deps = deps;
  }

  async list(
    principal: Principal,
    input: {
      readonly tenantId: string;
      readonly view: DiscountView;
      readonly q?: string;
      readonly first?: number;
      readonly after?: string;
    },
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "promotions:read");
    if (denied) return denied;
    const q = input.q?.trim() ?? "";
    let alsoIds: readonly string[] = [];
    if (q !== "") {
      const found = await this.deps.coupons.findPromotionRefsByCode({
        tenantId: input.tenantId,
        fragment: q,
      });
      if (isOk(found))
        alsoIds = (found.body as { readonly promotionRefs: readonly string[] }).promotionRefs;
    }
    const page = await this.deps.promotions.listForAdmin({
      tenantId: input.tenantId,
      view: input.view,
      ...(q === "" ? {} : { search: q, alsoIds }),
      ...(input.first === undefined ? {} : { first: input.first }),
      ...(input.after === undefined ? {} : { after: input.after }),
    });
    if (!isOk(page)) return page;
    const { items, pageInfo } = page.body as Paginated<Promotion>;
    const coupons = await this.couponsOf(
      input.tenantId,
      items.map((p) => p.id.toString()),
    );
    const now = this.deps.clock.now();
    return {
      status: 200,
      body: {
        items: items.map((p) => toDiscountDto(p, coupons.get(p.id.toString()), now)),
        pageInfo,
      },
    };
  }

  async get(
    principal: Principal,
    input: { readonly tenantId: string; readonly discountId: string },
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "promotions:read");
    if (denied) return denied;
    return this.read(input.tenantId, input.discountId, 200);
  }

  async create(
    principal: Principal,
    input: { readonly tenantId: string; readonly input: DiscountInput },
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "promotions:create");
    if (denied) return denied;
    const { tenantId, input: discount } = input;
    if (discount.method === "code") {
      const holder = await this.deps.coupons.getByCode({ tenantId, code: discount.code ?? "" });
      if (holder.status === 200) return codeTaken();
    }
    const created = await this.deps.promotions.create({
      tenantId,
      method: discount.method,
      ...toPromotionFields(discount),
    });
    if (created.status !== 201) return created;
    const { promotionId } = created.body as { readonly promotionId: string };
    if (discount.method === "code") {
      const coupon = await this.deps.coupons.create({
        tenantId,
        code: discount.code ?? "",
        promotionRef: promotionId,
        multiUse: !discount.oncePerCustomer,
        ...(discount.usageLimit === undefined ? {} : { usageLimit: discount.usageLimit }),
      });
      if (coupon.status !== 201) {
        await this.deps.promotions.advance({ tenantId, promotionId, toStatus: "cancelled" });
        return coupon.status === 409 ? codeTaken() : coupon;
      }
    }
    const activated = await this.deps.promotions.advance({
      tenantId,
      promotionId,
      toStatus: "active",
    });
    if (!isOk(activated)) return activated;
    return this.read(tenantId, promotionId, 201);
  }

  async update(
    principal: Principal,
    input: {
      readonly tenantId: string;
      readonly discountId: string;
      readonly input: DiscountInput;
    },
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "promotions:create");
    if (denied) return denied;
    const { tenantId, discountId, input: discount } = input;
    const loaded = await this.load(tenantId, discountId);
    if (loaded === null) return notFound();
    const { promotion, coupon } = loaded;
    if (
      discount.type !== discountTypeOf(promotion) ||
      discount.method !== discountMethodOf(promotion, coupon)
    ) {
      return fieldError("type", "A discount's type and method cannot be changed");
    }
    if (discount.method === "code") {
      const holder = await this.deps.coupons.getByCode({ tenantId, code: discount.code ?? "" });
      if (holder.status === 200 && (holder.body as Coupon).promotionRef !== discountId)
        return codeTaken();
    }
    const updated = await this.deps.promotions.update({
      tenantId,
      promotionId: discountId,
      ...toPromotionFields(discount),
    });
    if (!isOk(updated)) return updated;
    if (coupon !== undefined) {
      const reconfigured = await this.deps.coupons.reconfigure({
        tenantId,
        couponId: coupon.id.toString(),
        code: discount.code ?? coupon.code.value,
        multiUse: !discount.oncePerCustomer,
        ...(discount.usageLimit === undefined ? {} : { usageLimit: discount.usageLimit }),
      });
      if (reconfigured.status === 409) return codeTaken();
      if (!isOk(reconfigured)) return reconfigured;
    }
    return this.read(tenantId, discountId, 200);
  }

  /** Shopify's "Deactivate": the discount stops at once and reads as expired. */
  async deactivate(
    principal: Principal,
    input: { readonly tenantId: string; readonly discountId: string },
  ): Promise<AdminResponse> {
    return this.transition(principal, input, {
      promotionFrom: "active",
      promotionTo: "paused",
      couponFrom: "active",
      couponTo: "disabled",
    });
  }

  async activate(
    principal: Principal,
    input: { readonly tenantId: string; readonly discountId: string },
  ): Promise<AdminResponse> {
    return this.transition(principal, input, {
      promotionFrom: "paused",
      promotionTo: "active",
      couponFrom: "disabled",
      couponTo: "active",
    });
  }

  /** Deleting archives the promotion (it leaves every list) and disables its code. */
  async remove(
    principal: Principal,
    input: { readonly tenantId: string; readonly discountId: string },
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "promotions:create");
    if (denied) return denied;
    const loaded = await this.load(input.tenantId, input.discountId);
    if (loaded === null) return notFound();
    const archived = await this.deps.promotions.advance({
      tenantId: input.tenantId,
      promotionId: input.discountId,
      toStatus: "archived",
    });
    if (!isOk(archived)) return archived;
    if (loaded.coupon !== undefined && loaded.coupon.status.value === "active") {
      await this.deps.coupons.advance({
        tenantId: input.tenantId,
        couponId: loaded.coupon.id.toString(),
        toStatus: "disabled",
      });
    }
    return { status: 200, body: { id: input.discountId, deleted: true } };
  }

  private async transition(
    principal: Principal,
    input: { readonly tenantId: string; readonly discountId: string },
    steps: {
      readonly promotionFrom: string;
      readonly promotionTo: "paused" | "active";
      readonly couponFrom: string;
      readonly couponTo: "disabled" | "active";
    },
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "promotions:create");
    if (denied) return denied;
    const loaded = await this.load(input.tenantId, input.discountId);
    if (loaded === null) return notFound();
    if (loaded.promotion.status.value === steps.promotionFrom) {
      const moved = await this.deps.promotions.advance({
        tenantId: input.tenantId,
        promotionId: input.discountId,
        toStatus: steps.promotionTo,
      });
      if (!isOk(moved)) return moved;
    }
    if (loaded.coupon !== undefined && loaded.coupon.status.value === steps.couponFrom) {
      const moved = await this.deps.coupons.advance({
        tenantId: input.tenantId,
        couponId: loaded.coupon.id.toString(),
        toStatus: steps.couponTo,
      });
      if (!isOk(moved)) return moved;
    }
    return this.read(input.tenantId, input.discountId, 200);
  }

  private async load(
    tenantId: string,
    discountId: string,
  ): Promise<{ readonly promotion: Promotion; readonly coupon: Coupon | undefined } | null> {
    const response = await this.deps.promotions.get({ tenantId, promotionId: discountId });
    if (response.status !== 200) return null;
    const promotion = response.body as Promotion;
    if (promotion.status.value === "archived") return null;
    return { promotion, coupon: (await this.couponsOf(tenantId, [discountId])).get(discountId) };
  }

  private async couponsOf(
    tenantId: string,
    promotionRefs: readonly string[],
  ): Promise<Map<string, Coupon>> {
    if (promotionRefs.length === 0) return new Map();
    const response = await this.deps.coupons.listByPromotionRefs({ tenantId, promotionRefs });
    const items = isOk(response)
      ? (response.body as { readonly items: readonly Coupon[] }).items
      : [];
    return new Map(items.map((c) => [c.promotionRef, c]));
  }

  private async read(tenantId: string, discountId: string, status: number): Promise<AdminResponse> {
    const loaded = await this.load(tenantId, discountId);
    if (loaded === null) return notFound();
    return { status, body: toDiscountDto(loaded.promotion, loaded.coupon, this.deps.clock.now()) };
  }
}
```

- [ ] **Step 6: Create `apps/admin/src/http/discounts-routes.ts`**

```ts
import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import { ValidationError, toErrorEnvelope } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import { discountInputSchema, type DiscountInput } from "../interfaces/discounts/discount-input";

const listQuery = z.object({
  view: z.enum(["all", "active", "scheduled", "expired"]).default("all"),
  q: z.string().max(100).optional(),
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
});
const discountIdParams = z.object({ discountId: z.string().min(1) });

/** Parses the form here as well, so a per-type error is a 422 whatever the transport does first. */
function parseInput(body: unknown): DiscountInput | AdminResponse {
  const parsed = discountInputSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  return {
    status: 422,
    body: toErrorEnvelope(
      new ValidationError(
        "Invalid discount",
        parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      ),
    ),
  };
}

const isResponse = (value: DiscountInput | AdminResponse): value is AdminResponse =>
  "status" in value;

/** The admin Discounts API (Phase 2): Shopify's discounts over Promotions + Coupons. */
export function discountsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/discounts",
      version: 1,
      permission: "promotions:read",
      summary:
        "List discounts (Shopify tabs: all, active, scheduled, expired; search by title or code)",
      schema: { querystring: listQuery },
      handle: ({ query, context }) =>
        admin.discounts.list(context.principal, {
          tenantId: context.tenantId,
          view: query.view ?? "all",
          ...(query.q === undefined ? {} : { q: query.q }),
          ...(query.first === undefined ? {} : { first: query.first }),
          ...(query.after === undefined ? {} : { after: query.after }),
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/discounts/:discountId",
      version: 1,
      permission: "promotions:read",
      summary: "Get a discount",
      schema: { params: discountIdParams },
      handle: ({ params, context }) =>
        admin.discounts.get(context.principal, {
          tenantId: context.tenantId,
          discountId: params.discountId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/discounts",
      version: 1,
      permission: "promotions:create",
      idempotent: true,
      summary: "Create a discount (code or automatic)",
      handle: ({ body, context }) => {
        const input = parseInput(body);
        if (isResponse(input)) return Promise.resolve(input);
        return admin.discounts.create(context.principal, { tenantId: context.tenantId, input });
      },
    }),
    defineRoute({
      method: "PUT",
      path: "/discounts/:discountId",
      version: 1,
      permission: "promotions:create",
      idempotent: true,
      summary: "Edit a discount (its type and method cannot change)",
      schema: { params: discountIdParams },
      handle: ({ params, body, context }) => {
        const input = parseInput(body);
        if (isResponse(input)) return Promise.resolve(input);
        return admin.discounts.update(context.principal, {
          tenantId: context.tenantId,
          discountId: params.discountId,
          input,
        });
      },
    }),
    defineRoute({
      method: "POST",
      path: "/discounts/:discountId/deactivate",
      version: 1,
      permission: "promotions:create",
      idempotent: true,
      summary: "Deactivate a discount",
      schema: { params: discountIdParams },
      handle: ({ params, context }) =>
        admin.discounts.deactivate(context.principal, {
          tenantId: context.tenantId,
          discountId: params.discountId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/discounts/:discountId/activate",
      version: 1,
      permission: "promotions:create",
      idempotent: true,
      summary: "Reactivate a deactivated discount",
      schema: { params: discountIdParams },
      handle: ({ params, context }) =>
        admin.discounts.activate(context.principal, {
          tenantId: context.tenantId,
          discountId: params.discountId,
        }),
    }),
    defineRoute({
      method: "DELETE",
      path: "/discounts/:discountId",
      version: 1,
      permission: "promotions:create",
      idempotent: true,
      summary: "Delete a discount",
      schema: { params: discountIdParams },
      handle: ({ params, context }) =>
        admin.discounts.remove(context.principal, {
          tenantId: context.tenantId,
          discountId: params.discountId,
        }),
    }),
  ];
}
```

If `defineRoute` requires a `schema.body` for POST/PUT, add `body: z.unknown()` to those schemas — the handler validates with `parseInput` either way.

- [ ] **Step 7: Register** — in `composition.ts` add `readonly discounts: DiscountsAdminController;` to `WiredAdmin` (next to `promotions`), and where the admin controllers are built (next to `promotions: new PromotionsAdminController(...)`):

```ts
    discounts: new DiscountsAdminController({
      promotions: promotions.promotions,
      coupons: coupons.coupons,
      guard,
      clock: deps.clock,
    }),
```

In `admin-routes.ts` import `discountsRoutes` and add `...discountsRoutes(admin),` next to `...promotionsRoutes(admin),`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @platform/admin exec vitest run src/http/discounts-routes.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck and commit**

Run: `pnpm --filter @platform/admin exec tsc --noEmit` — Expected: no output.

```bash
git add apps/admin/src/interfaces/discounts apps/admin/src/http/discounts-routes.ts apps/admin/src/http/discounts-routes.test.ts apps/admin/src/http/admin-routes.ts apps/admin/src/composition.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -m "feat(admin): shopify-style /discounts api over promotions and coupons" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Whole-part verification

**Files:** none new (fixes only, in the files above).

- [ ] **Step 1: Typecheck every touched package**

Run each and expect no output:
`pnpm --filter @platform/promotions exec tsc --noEmit`, `pnpm --filter @platform/coupons exec tsc --noEmit`, `pnpm --filter @platform/checkout exec tsc --noEmit`, `pnpm --filter @platform/orders exec tsc --noEmit`, `pnpm --filter @platform/admin exec tsc --noEmit`, and `pnpm --filter admin-web exec tsc --noEmit` (admin-web reads `OrderTotalsDto`; the new fields are additive).

- [ ] **Step 2: Run every touched package's tests**

Run: `pnpm --filter @platform/promotions --filter @platform/coupons --filter @platform/checkout --filter @platform/orders --filter @platform/admin exec vitest run`
Expected: all PASS. Integration tests that need a database stay skipped as before.

- [ ] **Step 3: Architecture, lint and format**

Run: `pnpm arch` — Expected: 0 violations (apps/admin may import `@platform/promotions`/`@platform/coupons`; services must not import each other — Checkout never imports Promotions).
Run: `git diff --name-only HEAD~11 -- services apps packages | xargs node_modules/.bin/prettier --check` and fix with `--write` if needed; run each touched package's `eslint` (`pnpm --filter <pkg> exec eslint src`).

- [ ] **Step 4: Review the migrations by eye**

Open both `migration.sql` files and confirm: only `ALTER TABLE ... ADD COLUMN` and `CREATE INDEX`; nothing applied to any database; the header says the owner deploys it before the release.

- [ ] **Step 5: Commit any fixes**

```bash
git add -u services apps packages
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -m "chore(discounts): lint and format part 1" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Skip the commit when there is nothing to fix.)

---

## After this plan

- **Owner, before deploying:** run the two migrations (`20261016000000_discount_settings`, `20261016010000_checkout_discounts`) the way earlier hand-written migrations were applied.
- **Part 2** (admin Discounts screens) consumes `/discounts` and `OrderTotalsDto.discounts`; **Part 3** (storefront code field) consumes the two public routes, `PublicCheckoutSessionDto.discount` and the `DISCOUNTS_CHANGED:` completion error. Each gets its own plan.

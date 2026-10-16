# Shopify Product Data (Plan 2C-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ملخص للمالك (بالعربي):** قارنّا صفحة المنتج عندنا بصفحة شوبيفاي. المنتج عندنا **ناقصه بيانات أساسية** موجودة في شوبيفاي:
>
> | الناقص                                                     | النتيجة                                              |
> | ---------------------------------------------------------- | ---------------------------------------------------- |
> | الوصف، والنوع، والـ tags                                   | **مفيش مكان تكتب فيه وصف المنتج خالص**               |
> | السعر قبل الخصم، والتكلفة، والباركود، والوزن، و"منتج مادي" | مفيش شطب على السعر القديم في المتجر، ومفيش وزن للشحن |
> | حالة "غير مدرج"                                            | ما ينفعش تعمل منتج يتفتح بالرابط بس                  |
> | الخيارات (المقاس/اللون) بتتقفل بعد النشر                   | **لازم تلغي نشر المنتج عشان تضيف مقاس**              |
> | المتجر لسه بيقرا السعر من شاشة الأسعار القديمة             | السعر في الكروت ممكن يختلف عن سعر المقاس             |
>
> **الخطة دي بتضيف البيانات دي كلها في السيرفر، وبتخلي السعر ليه مكان واحد بس: المقاس نفسه.** المتجر هيعرض الوصف، والسعر قبل الخصم مشطوب، و"يبدأ من" لو المقاسات أسعارها مختلفة.
>
> **شاشة المنتج نفسها (صفحة واحدة زي شوبيفاي) هي الخطة اللي بعدها، 2C-2.** يعني بعد الخطة دي، الحقول الجديدة موجودة في الـ API بس لسه ما ظهرتش في لوحة التحكم.

**Goal:** Give the Catalog product and variant Shopify's core data fields, add the "unlisted" status, let options change after publishing, and make the variant the **only** price source everywhere (storefront display, add-to-cart, staff checkout validation).

**Architecture:**

- **Product** gains a `ProductDetails` value object: `description` (plain text), `productType`, `tags`.
- **Variant** gains `VariantAttributes`: `compareAtPrice`, `cost`, `barcode`, `weightGrams`, `requiresShipping`, `taxable`. Its `selection` becomes editable through `updateVariant`.
- **All variants of one product share one currency** (a cart has one currency; live data is all USD).
- **Options** become editable in any status, as long as no variant uses a value the change removes.
- **`unlisted`** joins the publish states:
  - sellable and reachable by slug;
  - but never in lists, search, collections or the sitemap.
  - No new event type: leaving `published` raises the existing `product.unpublished`.
- **One price source (closes G-94):**
  - The staff checkout `/validate` route checks the snapshot against the **Catalog variant**, through a new `CatalogPricingValidationAdapter`.
  - The storefront derives every displayed price from `product.variants`. `PriceBook` (the Pricing read) is deleted.
- **Public API fix found while planning:** `GET /public/products` and `GET /public/products/:slug` currently return **draft and archived products** too. The storefront hides them client-side, but the API leaks them. They become listed-only and sellable-only, server-side.
- Additive, nullable or defaulted columns only. One migration.
- The admin screen is **not** redesigned here (Plan 2C-2). Only the Pricing sidebar link is hidden.

**Tech Stack:** TypeScript, vitest, zod, Prisma 6 (hand-written additive migration), Next.js 15.

**Spec:**

- [PLATFORM-MASTER-PLAN.md](../../plans/PLATFORM-MASTER-PLAN.md): Phase 1 unit 1 (Catalog: variants, SKU, barcode, weight, status, SEO).
- [PLATFORM-GAP-REVIEW.md](../../plans/PLATFORM-GAP-REVIEW.md): §2.2 (one price source).
- G-94 in `docs/architecture/23-platform-gap-register.md`.
- Owner's Shopify screenshots, 2026-10-08:
  - status: Active / Draft / Unlisted;
  - price card: price, compare-at, cost;
  - inventory card: SKU, barcode;
  - shipping card: physical product, weight.

## Global Constraints

Same as Plans 1A to 2A. Every task implicitly includes these.

### Git and branch

- Branch `morbeh/w0-w17-w12`. No force-push. No `--no-verify`. Never raise the lint warning cap.
- Never stage `.claude/worktrees/`.
- Commit lines at most 100 characters, lowercase subject.
- End every commit with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

### Database

- **No database connection.** Write migrations only. Never set `TENANT_MODE=multi`.
- No guard exemptions: rename instead. No new `TENANT_DEFAULT_ID` reads.

### Backward compatibility (non-negotiable)

- Every new API field is **optional**. Omitted means "keep the current value"; `null` means "clear".
- Every new column is nullable or has a default. Live products (13, one USD variant each) must load and sell unchanged.
- The admin-web forms send only `sku`, `priceAmountMinor` and `currency` today. They must keep working untouched.

### Security

- **The price is never accepted from the client.** No change to that rule.
- **`cost` is staff-only.** It must never appear in a public DTO. `barcode` and `weightGrams` stay out of public DTOs too: the storefront does not need them.
- The description is **plain text**. The storefront renders it as text (`whitespace-pre-line`), never as HTML. Rich text with a sanitizer is Plan 2C-2.

### Commands

- Windows: use per-package commands:
  - `pnpm.cmd --filter <pkg> run test`
  - `pnpm.cmd --filter <pkg> run typecheck`
  - `pnpm.cmd --filter <pkg> run lint`
- Never run a full typecheck and a full test suite at the same time.
- No new lint warnings. No `async` without `await`.
- Package filters:

| Directory           | Package filter       |
| ------------------- | -------------------- |
| `services/catalog`  | `@platform/catalog`  |
| `services/checkout` | `@platform/checkout` |
| `apps/admin`        | `@platform/admin`    |
| `apps/storefront`   | `storefront`         |
| `apps/admin-web`    | `admin-web`          |
| `packages/db`       | `@platform/db`       |

---

## File Structure

### `services/catalog/src/`

- **`domain/variant.ts`:**
  - `VariantAttributes`, `DEFAULT_VARIANT_ATTRIBUTES` and `assertValidAttributes`;
  - `VariantChanges`;
  - `apply()` replaces `update()`;
  - `selection` becomes mutable.
- **`domain/value-objects/product-details.ts`** (new): `ProductDetails`, `normalizeTags`.
- **`domain/value-objects/publish-state.ts`:** `unlisted`, `isUnlisted`, `isSellable`, `isListed`.
- **`domain/product.ts`:**
  - `details`, `setDetails`;
  - `updateVariant(variantId, changes, …)`;
  - the single-currency rule;
  - `setOptions` in any status;
  - `unlist`; `unpublish` from `unlisted`.
- **`application/variant-attributes-input.ts`** (new): `VariantAttributesInput`, `toVariantAttributes`.
- **`application/add-variant.use-case.ts`, `update-variant.use-case.ts`, `create-product.use-case.ts`, `update-product.use-case.ts`:** the new optional inputs.
- **`application/unlist-product.use-case.ts`** (new).
- **`interfaces/product.controller.ts`, `composition.ts`:** wire `unlist`.
- **`infrastructure/catalog.mappers.ts`:** map the new columns.

### `packages/db/`

- **`prisma/schema/catalog.prisma`:** the new `Product` and `ProductVariant` fields.
- **`prisma/schema/migrations/20261009000000_product_details/migration.sql`** (new).
- **`src/schema-migration-consistency.test.ts`:** one block.

### `apps/admin/src/`

- **`http/admin-routes.ts`:**
  - the new body fields;
  - `POST /products/:productId/unlist`;
  - the detail DTO fields.
- **`interfaces/products.admin-controller.ts`:** `unlistProduct`.
- **`http/public-catalog-routes.ts`:**
  - public DTO fields (`description`, `productType`, `tags`, `compareAtAmountMinor`);
  - listed-only list and search;
  - sellable-only by-slug.
- **`http/merchandise-resolution.ts`:** `isSellable`.
- **`infrastructure/cross-context/catalog-pricing-validation.adapter.ts`** (new). It replaces `pricing-validation.adapter.ts`, which is deleted.
- **`composition.ts`:** wire the new adapter.

### `apps/storefront/src/`

- **`lib/runtime-api.ts`:** the new DTO fields.
- **`lib/catalog.ts`:**
  - `priceOf(product)` replaces `PriceBook`;
  - `SellableProduct`;
  - `resolveProductBySlug` accepts `unlisted`.
- **`app/page.tsx`, `app/collections/[slug]/page.tsx`, `app/search/page.tsx`:** use `priceOf`.
- **`app/products/[slug]/page.tsx`:** `priceOf`, description, `noindex` when unlisted.
- **`components/product-card.tsx`:** "from" price and compare-at.
- **`components/variant-picker.tsx`:** compare-at.
- **`components/add-to-cart-button.tsx`, `app/cart/actions.ts`:** `currency` comes from the variant, and the Pricing pre-check is removed.

### `apps/admin-web/src/`

- **`components/navigation.ts`:** hide the Pricing entry. The route stays.

---

### Task 1: Variant attributes, editable selection, one currency per product

**Files:**

- Modify: `services/catalog/src/domain/variant.ts`
- Modify: `services/catalog/src/domain/product.ts`
- Create: `services/catalog/src/application/variant-attributes-input.ts`
- Modify: `services/catalog/src/application/add-variant.use-case.ts`
- Modify: `services/catalog/src/application/update-variant.use-case.ts`
- Modify: `services/catalog/src/application/create-product.use-case.ts`
- Test: `services/catalog/src/domain/variant-attributes.test.ts` (new)
- Test: `services/catalog/src/application/variant-attributes.use-case.test.ts` (new)

**Interfaces:**

- Produces (domain):
  - `VariantAttributes`;
  - `DEFAULT_VARIANT_ATTRIBUTES`;
  - `assertValidAttributes(price, attributes)`;
  - `VariantChanges { sku; price; selection; attributes }`;
  - `Variant.create(id, sku, price, selection = null, attributes = DEFAULT_VARIANT_ATTRIBUTES)`;
  - `Variant.apply(changes)`;
  - `Variant.attributes`;
  - `Product.updateVariant(variantId, changes: VariantChanges, eventId, occurredAt)`.
- Produces (application):
  - `VariantAttributesInput`;
  - `toVariantAttributes(input, currency, base?)`;
  - optional inputs on `AddVariantInput`, `UpdateVariantInput` (plus `selection?: Record | null`) and `VariantInput` (create).

- [ ] **Step 1: Write the failing domain tests**

`services/catalog/src/domain/variant-attributes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BusinessRuleError, Money, UniqueEntityId, ValidationError } from "@platform/domain";
import { Product } from "./product";
import { ProductOption } from "./value-objects/product-option";
import { Sku } from "./value-objects/sku";
import { Slug } from "./value-objects/slug";
import { VariantSelection } from "./value-objects/variant-selection";
import { DEFAULT_VARIANT_ATTRIBUTES, Variant, type VariantAttributes } from "./variant";

function must<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}
const money = (amount: number, currency = "USD") => must(Money.create(amount, currency));
const sku = (value: string) => must(Sku.create(value));
const selection = (values: Record<string, string>) => must(VariantSelection.create(values));
const attrs = (overrides: Partial<VariantAttributes>): VariantAttributes => ({
  ...DEFAULT_VARIANT_ATTRIBUTES,
  ...overrides,
});

function product(variants: Variant[]): Product {
  return Product.create(
    UniqueEntityId.from("product-1"),
    { sku: sku("P-1"), name: "Tee", slug: must(Slug.create("tee")), variants },
    "evt-0",
    new Date(0),
  );
}

describe("Variant attributes (Plan 2C-1)", () => {
  it("defaults to no compare-at/cost/barcode/weight, physical and taxable", () => {
    const variant = Variant.create(UniqueEntityId.from("v-1"), sku("S-1"), money(1000));
    expect(variant.attributes).toEqual(DEFAULT_VARIANT_ATTRIBUTES);
    expect(variant.attributes.requiresShipping).toBe(true);
    expect(variant.attributes.taxable).toBe(true);
  });

  it("keeps a compare-at price higher than the price, and a cost", () => {
    const variant = Variant.create(
      UniqueEntityId.from("v-1"),
      sku("S-1"),
      money(1000),
      null,
      attrs({ compareAtPrice: money(1500), cost: money(400), barcode: "6221234567890" }),
    );
    expect(variant.attributes.compareAtPrice?.amountMinor).toBe(1500);
    expect(variant.attributes.cost?.amountMinor).toBe(400);
  });

  it("rejects a compare-at price that is not higher than the price", () => {
    expect(() =>
      Variant.create(
        UniqueEntityId.from("v-1"),
        sku("S-1"),
        money(1000),
        null,
        attrs({ compareAtPrice: money(1000) }),
      ),
    ).toThrow(ValidationError);
  });

  it("rejects attributes in another currency, a blank barcode and a negative weight", () => {
    for (const bad of [
      attrs({ compareAtPrice: money(1500, "EGP") }),
      attrs({ cost: money(100, "EGP") }),
      attrs({ barcode: "   " }),
      attrs({ weightGrams: -1 }),
      attrs({ weightGrams: 1.5 }),
    ]) {
      expect(() =>
        Variant.create(UniqueEntityId.from("v-1"), sku("S-1"), money(1000), null, bad),
      ).toThrow(ValidationError);
    }
  });
});

describe("Product.updateVariant with changes (Plan 2C-1)", () => {
  it("changes the selection of a variant to one the options declare", () => {
    const p = product([Variant.create(UniqueEntityId.from("v-1"), sku("S-1"), money(1000))]);
    p.setOptions([must(ProductOption.create("Size", ["S", "L"]))]);
    p.updateVariant(
      "v-1",
      {
        sku: sku("S-1"),
        price: money(1000),
        selection: selection({ Size: "S" }),
        attributes: DEFAULT_VARIANT_ATTRIBUTES,
      },
      "evt-1",
      new Date(0),
    );
    expect(p.variants[0]?.selection?.values).toEqual({ Size: "S" });
  });

  it("rejects a selection that another variant already has, or that no option declares", () => {
    const p = product([Variant.create(UniqueEntityId.from("v-1"), sku("S-1"), money(1000))]);
    p.setOptions([must(ProductOption.create("Size", ["S", "L"]))]);
    p.addVariant(
      Variant.create(UniqueEntityId.from("v-2"), sku("S-2"), money(1200), selection({ Size: "L" })),
      "evt-1",
      new Date(0),
    );
    const change = (values: Record<string, string>) => () =>
      p.updateVariant(
        "v-1",
        {
          sku: sku("S-1"),
          price: money(1000),
          selection: selection(values),
          attributes: DEFAULT_VARIANT_ATTRIBUTES,
        },
        "evt-2",
        new Date(0),
      );
    expect(change({ Size: "L" })).toThrow(BusinessRuleError);
    expect(change({ Size: "XL" })).toThrow(BusinessRuleError);
  });

  it("keeps every variant of a product in one currency", () => {
    const p = product([Variant.create(UniqueEntityId.from("v-1"), sku("S-1"), money(1000))]);
    expect(() =>
      p.addVariant(
        Variant.create(UniqueEntityId.from("v-2"), sku("S-2"), money(1000, "EGP")),
        "evt-1",
        new Date(0),
      ),
    ).toThrow(BusinessRuleError);
    // A single-variant product may still change its own currency.
    p.updateVariant(
      "v-1",
      {
        sku: sku("S-1"),
        price: money(5000, "EGP"),
        selection: null,
        attributes: DEFAULT_VARIANT_ATTRIBUTES,
      },
      "evt-2",
      new Date(0),
    );
    expect(p.variants[0]?.price.currency).toBe("EGP");
  });

  it("rejects creating a product whose variants use two currencies", () => {
    expect(() =>
      product([
        Variant.create(UniqueEntityId.from("v-1"), sku("S-1"), money(1000)),
        Variant.create(UniqueEntityId.from("v-2"), sku("S-2"), money(1000, "EGP")),
      ]),
    ).toThrow(BusinessRuleError);
  });
});
```

If `ValidationError` is not re-exported by `@platform/domain`, import it from `@platform/utils`. The value objects in `domain/value-objects/` show which one this package uses.

- [ ] **Step 2: Run them, expect failure**

Run: `pnpm.cmd --filter @platform/catalog run test -- variant-attributes`
Expected: FAIL. `DEFAULT_VARIANT_ATTRIBUTES` is not exported, and `updateVariant` takes `(id, sku, price, …)`.

- [ ] **Step 3: Implement `variant.ts`**

Replace the file body with:

```ts
import { Entity, type Money, type UniqueEntityId, ValidationError } from "@platform/domain";
import type { Sku } from "./value-objects/sku";
import type { VariantSelection } from "./value-objects/variant-selection";

/** Plan 2C-1: Shopify's variant fields beyond price (price card, inventory card, shipping card). */
export interface VariantAttributes {
  /** Shown struck through on the storefront; must be HIGHER than the price, same currency. */
  readonly compareAtPrice: Money | null;
  /** Cost per item — staff-only (margin); never in a public DTO. */
  readonly cost: Money | null;
  readonly barcode: string | null;
  readonly weightGrams: number | null;
  /** Shopify "physical product": false for a service or digital good (no shipping). */
  readonly requiresShipping: boolean;
  readonly taxable: boolean;
}

export const DEFAULT_VARIANT_ATTRIBUTES: VariantAttributes = Object.freeze({
  compareAtPrice: null,
  cost: null,
  barcode: null,
  weightGrams: null,
  requiresShipping: true,
  taxable: true,
});

export const MAX_BARCODE_LENGTH = 64;
export const MAX_WEIGHT_GRAMS = 1_000_000;

/** Throws one `ValidationError` naming every invalid attribute, judged against `price`. */
export function assertValidAttributes(price: Money, attributes: VariantAttributes): void {
  const issues: { field: string; message: string }[] = [];
  const { compareAtPrice, cost, barcode, weightGrams } = attributes;
  if (compareAtPrice !== null) {
    if (compareAtPrice.currency !== price.currency) {
      issues.push({ field: "compareAtAmountMinor", message: "must use the variant's currency" });
    } else if (compareAtPrice.amountMinor <= price.amountMinor) {
      issues.push({ field: "compareAtAmountMinor", message: "must be higher than the price" });
    }
  }
  if (cost !== null && cost.currency !== price.currency) {
    issues.push({ field: "costAmountMinor", message: "must use the variant's currency" });
  }
  if (barcode !== null && (barcode.trim().length === 0 || barcode.length > MAX_BARCODE_LENGTH)) {
    issues.push({ field: "barcode", message: `must be 1-${MAX_BARCODE_LENGTH} characters` });
  }
  if (
    weightGrams !== null &&
    (!Number.isInteger(weightGrams) || weightGrams < 0 || weightGrams > MAX_WEIGHT_GRAMS)
  ) {
    issues.push({ field: "weightGrams", message: `must be a whole number 0-${MAX_WEIGHT_GRAMS}` });
  }
  if (issues.length > 0) throw new ValidationError("Invalid variant", issues);
}

/** Everything `Product.updateVariant` may change at once. The aggregate checks the selection rules. */
export interface VariantChanges {
  readonly sku: Sku;
  readonly price: Money;
  readonly selection: VariantSelection | null;
  readonly attributes: VariantAttributes;
}

interface VariantProps {
  sku: Sku;
  price: Money;
  selection: VariantSelection | null;
  attributes: VariantAttributes;
}

/**
 * A purchasable variant of a product (identity by id). `selection` places it in the product's
 * option matrix. Plan 2C-1 made `selection` editable (through `Product.updateVariant`, which
 * re-checks uniqueness and the declared options) and added Shopify's variant attributes.
 */
export class Variant extends Entity<VariantProps> {
  static create(
    id: UniqueEntityId,
    sku: Sku,
    price: Money,
    selection: VariantSelection | null = null,
    attributes: VariantAttributes = DEFAULT_VARIANT_ATTRIBUTES,
  ): Variant {
    assertValidAttributes(price, attributes);
    return new Variant({ sku, price, selection, attributes }, id);
  }

  /** Applies a full change set. Selection rules are the aggregate's job; attributes are checked here. */
  apply(changes: VariantChanges): void {
    assertValidAttributes(changes.price, changes.attributes);
    this.props.sku = changes.sku;
    this.props.price = changes.price;
    this.props.selection = changes.selection;
    this.props.attributes = changes.attributes;
  }

  get sku(): Sku {
    return this.props.sku;
  }

  get price(): Money {
    return this.props.price;
  }

  get selection(): VariantSelection | null {
    return this.props.selection;
  }

  get attributes(): VariantAttributes {
    return this.props.attributes;
  }
}
```

If `ValidationError` is not exported from `@platform/domain`, import it from where `value-objects/seo.ts` imports it.

- [ ] **Step 4: Implement the `product.ts` changes**

1. Import `VariantChanges` and `VariantSelection` (type) next to `Variant`.

2. In `Product.create`, before `new Product(…)`, add:

```ts
const currencies = new Set(props.variants.map((v) => v.price.currency));
if (currencies.size > 1) {
  throw new BusinessRuleError("All variants of a product must use the same currency");
}
```

3. Add these private helpers at the end of the class, before the getters:

```ts
  /** A selection must name declared option values, and no OTHER variant may already hold it. */
  private assertSelectionAllowed(selection: VariantSelection, exceptVariantId?: string): void {
    for (const [optionName, value] of Object.entries(selection.values)) {
      const option = this.props.options.find((o) => o.name === optionName);
      if (!option || !option.values.includes(value)) {
        throw new BusinessRuleError(
          `Variant selection ${optionName}=${value} does not match a declared product option`,
        );
      }
    }
    if (
      this.props.variants.some(
        (v) =>
          v.id.toString() !== exceptVariantId &&
          v.selection !== null &&
          v.selection.matches(selection),
      )
    ) {
      throw new BusinessRuleError("Another variant already has this exact option selection");
    }
  }

  /** Plan 2C-1: one product, one currency (a cart holds one currency). */
  private assertSameCurrency(currency: string, exceptVariantId?: string): void {
    if (
      this.props.variants.some(
        (v) => v.id.toString() !== exceptVariantId && v.price.currency !== currency,
      )
    ) {
      throw new BusinessRuleError("All variants of a product must use the same currency");
    }
  }
```

4. In `addVariant`, replace the inline `if (selection !== null) { … }` block with the following, and keep the duplicate-SKU check above it:

```ts
if (variant.selection !== null) this.assertSelectionAllowed(variant.selection);
this.assertSameCurrency(variant.price.currency);
```

5. Replace `updateVariant` with:

```ts
  /**
   * Edits a variant in place (Sprint 7.0, widened by Plan 2C-1): SKU, price, attributes, and the
   * selection, which is re-checked against the declared options and the other variants.
   */
  updateVariant(
    variantId: string,
    changes: VariantChanges,
    eventId: string,
    occurredAt: Date,
  ): void {
    const variant = this.props.variants.find((v) => v.id.toString() === variantId);
    if (!variant) {
      throw new BusinessRuleError(`Variant not found: ${variantId}`);
    }
    if (
      this.props.variants.some(
        (v) => v.id.toString() !== variantId && v.sku.value === changes.sku.value,
      )
    ) {
      throw new BusinessRuleError(`Duplicate variant SKU: ${changes.sku.value}`);
    }
    if (changes.selection !== null) this.assertSelectionAllowed(changes.selection, variantId);
    this.assertSameCurrency(changes.price.currency, variantId);
    variant.apply(changes);
    this.addDomainEvent(
      new ProductVariantUpdated({ eventId, aggregateId: this.id, occurredAt }, { variantId }),
    );
  }
```

- [ ] **Step 5: Run the domain tests**

Run: `pnpm.cmd --filter @platform/catalog run test -- variant-attributes product.test`
Expected: PASS.

If an existing test calls `variant.update(…)` or the old `product.updateVariant(id, sku, price, …)`, change it to the `VariantChanges` form, with the same values and the variant's current `selection` and `attributes`. Do not change what that test asserts.

- [ ] **Step 6: Write the failing use-case tests**

`services/catalog/src/application/variant-attributes.use-case.test.ts`. Build the use cases the way `application.test.ts` does: the same in-memory repository, unit of work, id generator and clock fixtures, imported from the same places. Cover:

1. `AddVariant` with `compareAtAmountMinor: 1500, costAmountMinor: 400, barcode: " 622 ", weightGrams: 250, requiresShipping: false, taxable: false` stores:
   - `compareAtPrice.amountMinor === 1500`;
   - `cost.amountMinor === 400`;
   - `barcode === "622"` (trimmed);
   - `weightGrams === 250`;
   - `requiresShipping === false`;
   - `taxable === false`.
2. `AddVariant` with `compareAtAmountMinor` equal to the price returns `err` with code `VALIDATION` and a `fields` entry for `compareAtAmountMinor`. Nothing is saved: the product still has one variant.
3. `UpdateVariant` with only `{ sku, priceAmountMinor, currency }`, the exact body admin-web sends today, keeps every attribute that `AddVariant` set in (1).
4. `UpdateVariant` with `compareAtAmountMinor: null` clears it, and leaves `cost` untouched.
5. `UpdateVariant` with `selection: { Size: "S" }`, after `SetProductOptions` declared `Size: [S, L]`, stores the selection. `selection: null` clears it.
6. `CreateProduct` with a variant carrying `weightGrams: 300` stores it. `CreateProduct` with variants in USD and EGP returns `err` (not a throw), and nothing is saved.

- [ ] **Step 7: Run them, expect failure**

Run: `pnpm.cmd --filter @platform/catalog run test -- variant-attributes.use-case`
Expected: FAIL. The inputs do not accept the new fields.

- [ ] **Step 8: Implement `application/variant-attributes-input.ts`**

```ts
import { Money } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";
import { DEFAULT_VARIANT_ATTRIBUTES, type VariantAttributes } from "../domain/variant";

/**
 * Plan 2C-1: the optional variant attributes every variant-writing use case accepts. For each
 * field, `undefined` keeps the current value and `null` clears it, so older callers (admin-web
 * sends only sku/price/currency) change nothing they did not name.
 */
export interface VariantAttributesInput {
  readonly compareAtAmountMinor?: number | null;
  readonly costAmountMinor?: number | null;
  readonly barcode?: string | null;
  readonly weightGrams?: number | null;
  readonly requiresShipping?: boolean;
  readonly taxable?: boolean;
}

function moneyOrKeep(
  amountMinor: number | null | undefined,
  currency: string,
  current: Money | null,
  field: string,
): Result<Money | null, ValidationError> {
  if (amountMinor === undefined) return ok(current);
  if (amountMinor === null) return ok(null);
  const money = Money.create(amountMinor, currency);
  return money.ok
    ? ok(money.value)
    : err(
        new ValidationError("Invalid variant", [
          { field, message: "must be a whole, non-negative number of minor units" },
        ]),
      );
}

/** Merges `input` over `base` into domain attributes. Range/currency rules run in `Variant`. */
export function toVariantAttributes(
  input: VariantAttributesInput,
  currency: string,
  base: VariantAttributes = DEFAULT_VARIANT_ATTRIBUTES,
): Result<VariantAttributes, ValidationError> {
  const compareAtPrice = moneyOrKeep(
    input.compareAtAmountMinor,
    currency,
    base.compareAtPrice,
    "compareAtAmountMinor",
  );
  if (!compareAtPrice.ok) return compareAtPrice;
  const cost = moneyOrKeep(input.costAmountMinor, currency, base.cost, "costAmountMinor");
  if (!cost.ok) return cost;
  let barcode = base.barcode;
  if (input.barcode === null) barcode = null;
  else if (input.barcode !== undefined) {
    const trimmed = input.barcode.trim();
    barcode = trimmed.length === 0 ? null : trimmed;
  }
  return ok({
    compareAtPrice: compareAtPrice.value,
    cost: cost.value,
    barcode,
    weightGrams: input.weightGrams === undefined ? base.weightGrams : input.weightGrams,
    requiresShipping: input.requiresShipping ?? base.requiresShipping,
    taxable: input.taxable ?? base.taxable,
  });
}
```

Use the same `ValidationError` import the other use cases in `application/` use (`@platform/utils`).

- [ ] **Step 9: Wire the use cases**

**`add-variant.use-case.ts`**

1. `export interface AddVariantInput extends VariantAttributesInput { … }`, keeping its current fields.
2. After `price` is created:

```ts
const attributes = toVariantAttributes(input, input.currency);
if (!attributes.ok) return err(attributes.error);
```

3. Move `Variant.create(…)` **inside** the existing `try`, and pass `selection, attributes.value`. `Variant.create` now throws a `ValidationError`, which `isDomainError` turns into `err`.

**`update-variant.use-case.ts`**

1. `export interface UpdateVariantInput extends VariantAttributesInput`, with the new optional field:

```ts
  /** Plan 2C-1: `undefined` keeps the selection, `null` clears it. */
  readonly selection?: Readonly<Record<string, string>> | null;
```

2. Inside the unit of work, after the product is found:

```ts
const current = product.variants.find((v) => v.id.toString() === input.variantId);
if (current === undefined) {
  return err(new BusinessRuleError(`Variant not found: ${input.variantId}`));
}
const attributes = toVariantAttributes(input, input.currency, current.attributes);
if (!attributes.ok) return err(attributes.error);
let selection = current.selection;
if (input.selection === null) selection = null;
else if (input.selection !== undefined) {
  const created = VariantSelection.create(input.selection);
  if (!created.ok) return err(created.error);
  selection = created.value;
}
```

3. Then call:

```ts
product.updateVariant(
  input.variantId,
  { sku: sku.value, price: price.value, selection, attributes: attributes.value },
  …,
);
```

Keep the existing `try`/`isDomainError`. `BusinessRuleError` comes from `@platform/domain`, the same one `product.ts` throws, so an unknown variant keeps today's status code.

**`create-product.use-case.ts`**

1. `export interface VariantInput extends VariantAttributesInput { … }`.
2. In the loop:
   - build `const attributes = toVariantAttributes(variant, variant.currency); if (!attributes.ok) return err(attributes.error);`;
   - create with `Variant.create(id, sku, price, null, attributes.value)` inside a `try` that returns `err` for `isDomainError`.
3. Before the unit of work, add:

```ts
if (new Set(input.variants.map((v) => v.currency)).size > 1) {
  return err(
    new ValidationError("All variants of a product must use the same currency", [
      { field: "variants", message: "must share one currency" },
    ]),
  );
}
```

- [ ] **Step 10: Run the catalog package**

Run: `pnpm.cmd --filter @platform/catalog run test`, then `pnpm.cmd --filter @platform/catalog run typecheck`.
Expected: all PASS.

- [ ] **Step 11: Commit**

```bash
git add services/catalog/src
git commit -m "feat(catalog): add variant attributes, editable selection and one currency per product"
```

---

### Task 2: Product details (description, type, tags) and options after publishing

**Files:**

- Create: `services/catalog/src/domain/value-objects/product-details.ts`
- Modify: `services/catalog/src/domain/product.ts`
- Modify: `services/catalog/src/application/update-product.use-case.ts`
- Modify: `services/catalog/src/application/create-product.use-case.ts`
- Modify: `services/catalog/src/domain/product.test.ts` (the "options are mutable only while draft" case)
- Test: `services/catalog/src/domain/value-objects/product-details.test.ts` (new)

**Interfaces:**

- Produces:
  - `ProductDetails.create({ description, productType, tags })`, `ProductDetails.empty()` and `normalizeTags(tags)`;
  - `Product.details` and `Product.setDetails(details)`;
  - `NewProduct.details?`;
  - `Product.reconstitute(…, version, details = ProductDetails.empty())`;
  - `UpdateProductInput.description? / productType? / tags?`;
  - `CreateProductInput.description? / productType? / tags?`.

- [ ] **Step 1: Write the failing tests**

`product-details.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAX_DESCRIPTION_LENGTH, ProductDetails, normalizeTags } from "./product-details";

describe("ProductDetails (Plan 2C-1)", () => {
  it("trims, and turns blank text into null", () => {
    const result = ProductDetails.create({
      description: "  Soft cotton.\nMachine wash.  ",
      productType: "   ",
      tags: [],
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.description).toBe("Soft cotton.\nMachine wash.");
    expect(result.value.productType).toBeNull();
  });

  it("normalizes tags: trimmed, no blanks, case-insensitive duplicates dropped, first kept", () => {
    expect(normalizeTags([" Summer ", "summer", "", "SALE", "sale ", "Cotton"])).toEqual([
      "Summer",
      "SALE",
      "Cotton",
    ]);
  });

  it("rejects an over-long description and too many tags", () => {
    expect(
      ProductDetails.create({
        description: "x".repeat(MAX_DESCRIPTION_LENGTH + 1),
        productType: null,
        tags: [],
      }).ok,
    ).toBe(false);
    expect(
      ProductDetails.create({
        description: null,
        productType: null,
        tags: Array.from({ length: 251 }, (_, i) => `t${i}`),
      }).ok,
    ).toBe(false);
  });
});
```

In `product.test.ts`, **replace** `"options are mutable only while draft"` with these two cases:

```ts
// Plan 2C-1: Shopify lets a merchant add a size to a live product. The old draft-only rule is gone;
// the remaining guard is that no variant may be left pointing at a removed option value.
it("options can change after publishing", () => {
  const product = productFixture();
  product.publish("evt-1", new Date(0));
  const option = ProductOption.create("Size", ["S", "M"]);
  if (!option.ok) throw new Error("invalid fixture");
  product.setOptions([option.value]);
  expect(product.options.map((o) => o.name)).toEqual(["Size"]);
});

it("options cannot drop a value a variant still uses", () => {
  const product = productFixture();
  const sizes = ProductOption.create("Size", ["S", "M"]);
  const onlyS = ProductOption.create("Size", ["S"]);
  const m = VariantSelection.create({ Size: "M" });
  if (!sizes.ok || !onlyS.ok || !m.ok) throw new Error("invalid fixture");
  product.setOptions([sizes.value]);
  product.addVariant(
    Variant.create(UniqueEntityId.from("variant-2"), sku("SKU-2"), money(1999), m.value),
    "evt-1",
    new Date(0),
  );
  expect(() => product.setOptions([onlyS.value])).toThrow(BusinessRuleError);
});
```

Add a third case to `product.test.ts`: `"keeps details and replaces them with setDetails"`. A new product's `details.tags` is `[]`. After `setDetails(ProductDetails.create({ description: "d", productType: "Shirts", tags: ["a"] }).value)`, the getters return those values, and **no** domain event is raised.

- [ ] **Step 2: Run them, expect failure**

Run: `pnpm.cmd --filter @platform/catalog run test -- product-details product.test`
Expected: FAIL.

- [ ] **Step 3: Implement `product-details.ts`**

```ts
import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

export const MAX_DESCRIPTION_LENGTH = 20_000;
export const MAX_PRODUCT_TYPE_LENGTH = 255;
export const MAX_TAG_LENGTH = 255;
export const MAX_TAGS = 250;

interface ProductDetailsProps {
  readonly description: string | null;
  readonly productType: string | null;
  readonly tags: readonly string[];
}

/**
 * Plan 2C-1: Shopify's descriptive product fields. `description` is PLAIN TEXT (line breaks
 * kept); rich text with an HTML sanitizer is Plan 2C-2, and until then nothing renders it as HTML.
 */
export class ProductDetails extends ValueObject<ProductDetailsProps> {
  static empty(): ProductDetails {
    return new ProductDetails({ description: null, productType: null, tags: [] });
  }

  static create(input: {
    readonly description: string | null;
    readonly productType: string | null;
    readonly tags: readonly string[];
  }): Result<ProductDetails, ValidationError> {
    const issues: { field: string; message: string }[] = [];
    const description = blankToNull(input.description);
    if (description !== null && description.length > MAX_DESCRIPTION_LENGTH) {
      issues.push({
        field: "description",
        message: `must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
      });
    }
    const productType = blankToNull(input.productType);
    if (productType !== null && productType.length > MAX_PRODUCT_TYPE_LENGTH) {
      issues.push({
        field: "productType",
        message: `must be at most ${MAX_PRODUCT_TYPE_LENGTH} characters`,
      });
    }
    const tags = normalizeTags(input.tags);
    if (tags.length > MAX_TAGS) {
      issues.push({ field: "tags", message: `must have at most ${MAX_TAGS} tags` });
    }
    if (tags.some((tag) => tag.length > MAX_TAG_LENGTH)) {
      issues.push({
        field: "tags",
        message: `each tag must be at most ${MAX_TAG_LENGTH} characters`,
      });
    }
    if (issues.length > 0) return err(new ValidationError("Invalid product details", issues));
    return ok(new ProductDetails({ description, productType, tags }));
  }

  get description(): string | null {
    return this.props.description;
  }

  get productType(): string | null {
    return this.props.productType;
  }

  get tags(): readonly string[] {
    return this.props.tags;
  }
}

function blankToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Trims, drops blanks, and drops case-insensitive duplicates keeping the first spelling (Shopify). */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (tag.length === 0) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}
```

Use the `ValidationError` import that `seo.ts` uses.

- [ ] **Step 4: Implement the `product.ts` changes**

1. Add `details: ProductDetails;` to `ProductProps`, and `readonly details?: ProductDetails;` to `NewProduct`.
2. Set `details: props.details ?? ProductDetails.empty()` in `create`.
3. Add a **last** parameter `details: ProductDetails = ProductDetails.empty()` to `reconstitute`, after `version`, and set it in the props.
4. Add `setDetails` and `get details()`:

```ts
  /** Plan 2C-1. No event of its own — `UpdateProduct` already raises `product.updated`. */
  setDetails(details: ProductDetails): void {
    this.props.details = details;
  }
```

5. Replace `setOptions` with:

```ts
  /**
   * Replaces the declared option set — in ANY status since Plan 2C-1 (Shopify lets a merchant add a
   * size to a live product). Refused only when a variant would be left on a removed option value.
   */
  setOptions(options: readonly ProductOption[]): void {
    for (const variant of this.props.variants) {
      if (variant.selection === null) continue;
      for (const [name, value] of Object.entries(variant.selection.values)) {
        const option = options.find((o) => o.name === name);
        if (!option || !option.values.includes(value)) {
          throw new BusinessRuleError(
            `Variant ${variant.sku.value} uses ${name}=${value}, which these options remove — ` +
              "change or remove that variant first",
          );
        }
      }
    }
    this.props.options = [...options];
  }
```

Update the class doc comment's "`options` are mutable only while draft" sentence to say what Plan 2C-1 allows.

- [ ] **Step 5: Wire `UpdateProduct` and `CreateProduct`**

**`UpdateProductInput`** gains:

```ts
  /** Plan 2C-1 — each optional: `undefined` keeps, `null`/`[]` clears. */
  readonly description?: string | null;
  readonly productType?: string | null;
  readonly tags?: readonly string[];
```

Inside the unit of work, after `product.update(…)`:

```ts
if (
  input.description !== undefined ||
  input.productType !== undefined ||
  input.tags !== undefined
) {
  const details = ProductDetails.create({
    description: input.description === undefined ? product.details.description : input.description,
    productType: input.productType === undefined ? product.details.productType : input.productType,
    tags: input.tags ?? product.details.tags,
  });
  if (!details.ok) return err(details.error);
  product.setDetails(details.value);
}
```

Validation runs **before** `products.save`, so an invalid body saves nothing. Add a test in `application.test.ts`: an update with a 20 001-character description returns `VALIDATION`, and the stored name is unchanged.

**`CreateProductInput`** gains the same three optional fields. Build `ProductDetails.create({ description: input.description ?? null, productType: input.productType ?? null, tags: input.tags ?? [] })` before the unit of work, return `err` when invalid, and pass `details` to `Product.create`.

- [ ] **Step 6: Run the catalog package**

Run: `pnpm.cmd --filter @platform/catalog run test`, then `pnpm.cmd --filter @platform/catalog run typecheck`.
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add services/catalog/src
git commit -m "feat(catalog): add product description, type and tags; allow options after publishing"
```

---

### Task 3: The "unlisted" status

**Files:**

- Modify: `services/catalog/src/domain/value-objects/publish-state.ts`
- Modify: `services/catalog/src/domain/product.ts`
- Create: `services/catalog/src/application/unlist-product.use-case.ts`
- Modify: `services/catalog/src/interfaces/product.controller.ts`
- Modify: `services/catalog/src/composition.ts`
- Modify: `services/catalog/src/index.ts` (only if it re-exports each use case; follow how `UnpublishProduct` is exported)
- Test: `services/catalog/src/domain/product-unlisted.test.ts` (new)

**Interfaces:**

- Produces:
  - `PublishStateValue` includes `"unlisted"`;
  - `PublishState.unlisted()`, `.isUnlisted`, `.isSellable` (published or unlisted) and `.isListed` (published);
  - `Product.unlist(eventId, occurredAt)`;
  - `UnlistProduct` / `UnlistProductInput { productId; tenantId }`;
  - `ProductController.unlist(input)`.

- [ ] **Step 1: Write the failing tests**

`product-unlisted.test.ts`. Build the product with the same fixture style as `product.test.ts`. Cases:

1. A draft product: `unlist()` sets status `unlisted`, `isSellable === true`, `isListed === false`, and raises **no** event.
2. A published product: `unlist()` raises exactly one event, `product.unpublished`. It left every listing.
3. An unlisted product: `publish()` makes it `published` and raises `product.published`.
4. An unlisted product: `unpublish()` makes it `draft` and raises **no** event. It was never listed.
5. `unlist()` on an unlisted product throws `BusinessRuleError`, and so does `unlist()` on an archived product.
6. `PublishState.from("unlisted").isSellable === true`; `PublishState.published().isListed === true`; `PublishState.draft().isSellable === false`.

- [ ] **Step 2: Run, expect failure.** `pnpm.cmd --filter @platform/catalog run test -- product-unlisted`

- [ ] **Step 3: Implement**

**`publish-state.ts`:**

- `export type PublishStateValue = "draft" | "scheduled" | "published" | "unlisted" | "archived";`
- `static unlisted()`, `get isUnlisted()`;
- the two getters below:

```ts
  /** Plan 2C-1: may be added to a cart (published, or unlisted = direct link only). */
  get isSellable(): boolean {
    return this.props.value === "published" || this.props.value === "unlisted";
  }

  /** Plan 2C-1: appears in lists, search, collections and the sitemap — published only. */
  get isListed(): boolean {
    return this.props.value === "published";
  }
```

**`product.ts`:**

```ts
  /**
   * Plan 2C-1 (Shopify "Unlisted"): sellable and reachable by its link, but kept out of lists,
   * search, collections and the sitemap. Leaving `published` raises the existing
   * `product.unpublished` — the product left every listing — so no new event type is needed.
   */
  unlist(eventId: string, occurredAt: Date): void {
    if (this.props.status.isUnlisted) {
      throw new BusinessRuleError("Product is already unlisted");
    }
    if (this.props.status.isArchived) {
      throw new BusinessRuleError("An archived product cannot be unlisted");
    }
    const wasPublished = this.props.status.isPublished;
    this.props.status = PublishState.unlisted();
    this.props.scheduledAt = null;
    if (wasPublished) {
      this.addDomainEvent(
        new ProductUnpublished(
          { eventId, aggregateId: this.id, occurredAt },
          { sku: this.props.sku.value },
        ),
      );
    }
  }
```

Change `unpublish` so it accepts `published` **or** `unlisted` and raises `ProductUnpublished` only when it was `published`. Keep the error message for a draft unchanged.

**`unlist-product.use-case.ts`:** an exact copy of `unpublish-product.use-case.ts` with:

- the names changed (`UnlistProduct`, `UnlistProductInput`, `UnlistProductOutput`, `UnlistProductDeps`);
- `product.unlist(…)`;
- doc line `/** Unlists a product (sellable by link only — Plan 2C-1). */`.

**Wiring:**

- **`product.controller.ts`:**
  - `readonly unlistProduct: UnlistProduct;` in the deps;
  - `async unlist(input: UnlistProductInput) { return present(await this.deps.unlistProduct.execute(input), 200); }`.
- **`composition.ts`:** `unlistProduct: new UnlistProduct({ products, unitOfWork, idGenerator, clock }),` next to `unpublishProduct`.

- [ ] **Step 4: Run.** `pnpm.cmd --filter @platform/catalog run test` and `… run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/catalog/src
git commit -m "feat(catalog): add the unlisted status (sellable by link, never listed)"
```

---

### Task 4: Persist the new fields

**Files:**

- Modify: `packages/db/prisma/schema/catalog.prisma`
- Create: `packages/db/prisma/schema/migrations/20261009000000_product_details/migration.sql`
- Modify: `packages/db/src/schema-migration-consistency.test.ts`
- Modify: `services/catalog/src/infrastructure/catalog.mappers.ts`
- Test: `services/catalog/src/infrastructure/catalog.mappers.test.ts` (new)

**Interfaces:**

- Consumes: `ProductDetails`, `VariantAttributes` (Tasks 1 to 2).
- Produces:
  - `ProductRow.description / productType / tags`;
  - `VariantRow.compareAtAmountMinor / costAmountMinor / barcode / weightGrams / requiresShipping / taxable`.

- [ ] **Step 1: Write the failing tests**

**Mapper round trip** (`catalog.mappers.test.ts`):

1. Build a product with:
   - details `{ description: "d", productType: "Shirts", tags: ["a", "b"] }`;
   - one variant with every attribute set (`compareAt 1500`, `cost 400`, `barcode "622"`, `weightGrams 250`, `requiresShipping false`, `taxable false`) and `selection { Size: "S" }`, with options declared first.
2. `ProductMapper.toProductRow` + `toVariantRows` → feed the rows back through `ProductMapper.toDomain` (add `version`/`deletedAt`/`publishState` to the row object, as the Prisma repository would) → expect every field equal.

**Legacy rows:**

1. A `ProductRow` **without** `description`/`productType`/`tags`, and a `VariantRow` **without** the six new fields (as the Prisma repository returns rows written before the migration, i.e. `null`/defaults), map to `ProductDetails.empty()` and `DEFAULT_VARIANT_ATTRIBUTES`.
2. Model the old rows exactly as after the migration: `description: null`, `productType: null`, `tags: []`, `compareAtAmountMinor: null`, `costAmountMinor: null`, `barcode: null`, `weightGrams: null`, `requiresShipping: true`, `taxable: true`.

**Migration consistency** (`schema-migration-consistency.test.ts`), copying the Plan 2A block's style:

```ts
describe("catalog.products and catalog.product_variants — product details (Plan 2C-1)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(join(migrationsDir, entry.name, "migration.sql"), "utf-8"))
    .join("\n");

  it("products gained description, product_type and tags", () => {
    const actual = columnsEverAddedTo("catalog", "products", allSql);
    for (const column of ["description", "product_type", "tags"]) {
      expect(actual.has(column), `expected "catalog"."products"."${column}"`).toBe(true);
    }
  });

  it("product_variants gained the Shopify variant attributes", () => {
    const actual = columnsEverAddedTo("catalog", "product_variants", allSql);
    for (const column of [
      "compare_at_amount_minor",
      "cost_amount_minor",
      "barcode",
      "weight_grams",
      "requires_shipping",
      "taxable",
    ]) {
      expect(actual.has(column), `expected "catalog"."product_variants"."${column}"`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm.cmd --filter @platform/catalog run test -- catalog.mappers` and `pnpm.cmd --filter @platform/db run test -- schema-migration`.

- [ ] **Step 3: Write the migration**

`20261009000000_product_details/migration.sql`:

```sql
-- Plan 2C-1 — Shopify product data. Written by hand, NOT applied by the agent; the owner deploys it
-- from Railway's Console (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`) WITH
-- or BEFORE the release that reads these columns.
--
-- ADDITIVE: nullable columns, or NOT NULL with a default that equals today's behaviour (no tags;
-- every variant physical and taxable), so all 13 live products load and sell exactly as before.

ALTER TABLE "catalog"."products"
  ADD COLUMN "description"  TEXT,
  ADD COLUMN "product_type" TEXT,
  ADD COLUMN "tags"         TEXT[] DEFAULT ARRAY[]::TEXT[]; -- nullable like media_refs: what Prisma emits for String[]

ALTER TABLE "catalog"."product_variants"
  ADD COLUMN "compare_at_amount_minor" INTEGER,
  ADD COLUMN "cost_amount_minor"       INTEGER,
  ADD COLUMN "barcode"                 TEXT,
  ADD COLUMN "weight_grams"            INTEGER,
  ADD COLUMN "requires_shipping"       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "taxable"                 BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN "catalog"."product_variants"."cost_amount_minor" IS
  'Plan 2C-1: cost per item, staff-only (margin). Never exposed on a public route.';
```

- [ ] **Step 3b: Commit and push the migration ALONE, then tell the owner**

Railway deploys every push. Once the Prisma schema lists the new columns, every product read selects them, so the **catalog breaks** if the code goes live before the migration. Plan 2A's cart had exactly that window.

The migration SQL on its own is harmless: no code reads it. So it ships first.

```bash
git add packages/db/prisma/schema/migrations/20261009000000_product_details/migration.sql
git commit -m "feat(db): add the product details migration (applied before the code that reads it)"
git push origin morbeh/w0-w17-w12
```

Push **all** local commits at this point. Tasks 1 to 3 change only domain and application code, and **no** persisted shape, so they are safe to deploy before the migration. Run `pnpm.cmd --filter @platform/catalog run test` first. Do not reorder history.

Then print this message for the owner, in Arabic, and **continue** with Step 4 (do not wait):

> طبّق الـ migration دلوقتي من Railway → runtime-api → Console:
> `cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`
> المفروض تشوف `20261009000000_product_details` اتطبّقت. قولّي "تم" لما تخلص.

- [ ] **Step 4: Update the Prisma schema**

In `model Product`, after `mediaRefs`:

```prisma
  description  String?   // Plan 2C-1 — plain text
  productType  String?   @map("product_type")
  tags         String[]  @default([])
```

In `model ProductVariant`, after `mediaRef`:

```prisma
  compareAtAmountMinor Int?    @map("compare_at_amount_minor") // Plan 2C-1
  costAmountMinor      Int?    @map("cost_amount_minor")       // staff-only
  barcode              String?
  weightGrams          Int?    @map("weight_grams")
  requiresShipping     Boolean @default(true) @map("requires_shipping")
  taxable              Boolean @default(true)
```

Run the package's Prisma generate script, the same one earlier plans ran. Check `packages/db/package.json`; do not connect to a database.

- [ ] **Step 5: Update the mappers**

**`ProductRow`** gains:

- `readonly description: string | null;`
- `readonly productType: string | null;`
- `readonly tags: readonly string[];`

**`VariantRow`** gains:

- `readonly compareAtAmountMinor: number | null;`
- `readonly costAmountMinor: number | null;`
- `readonly barcode: string | null;`
- `readonly weightGrams: number | null;`
- `readonly requiresShipping: boolean;`
- `readonly taxable: boolean;`

**`toDomain`:**

1. Pass `must(ProductDetails.create({ description: row.description ?? null, productType: row.productType ?? null, tags: row.tags ?? [] }), "product details")` as the **last** `reconstitute` argument.
2. Pass this as `Variant.create`'s 5th argument:

```ts
{
  compareAtPrice:
    v.compareAtAmountMinor == null
      ? null
      : must(Money.create(v.compareAtAmountMinor, v.currency), "variant compare-at price"),
  cost:
    v.costAmountMinor == null
      ? null
      : must(Money.create(v.costAmountMinor, v.currency), "variant cost"),
  barcode: v.barcode ?? null,
  weightGrams: v.weightGrams ?? null,
  requiresShipping: v.requiresShipping ?? true,
  taxable: v.taxable ?? true,
}
```

The `?? null` / `?? true` fallbacks keep in-memory test rows built before this plan valid.

**`toProductRow`** adds `description`, `productType` and `tags: [...product.details.tags]`.

**`toVariantRows`** adds:

- `compareAtAmountMinor: v.attributes.compareAtPrice?.amountMinor ?? null`;
- `costAmountMinor: v.attributes.cost?.amountMinor ?? null`;
- `barcode`, `weightGrams`, `requiresShipping` and `taxable` from `v.attributes`.

`PrismaProductRepository` needs no change. It spreads `toProductRow`/`toVariantRows` into `create`/`updateMany`, and reads full rows with `include: { variants: true }`. Confirm the spread covers the new keys. Typecheck will fail if the Prisma client lacks them.

- [ ] **Step 6: Run**

1. `pnpm.cmd --filter @platform/catalog run test`
2. `pnpm.cmd --filter @platform/db run test`
3. `pnpm.cmd --filter @platform/catalog run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma packages/db/src services/catalog/src
git commit -m "feat(db): persist product details and variant attributes"
```

Do **not** push this commit until the owner confirms the migration is applied (Task 8, Step 3).

---

### Task 5: Staff API (admin routes, detail DTO, unlist route)

**Files:**

- Modify: `apps/admin/src/http/admin-routes.ts`
- Modify: `apps/admin/src/interfaces/products.admin-controller.ts`
- Test: `apps/admin/src/http/product-details-routes.test.ts` (new). Build the routes the way `public-cart-variants.test.ts` or `admin-http.e2e.test.ts` does; use whichever already drives staff product routes with a principal.

**Interfaces:**

- Consumes: the Task 1 to 3 inputs, and `ProductController.unlist`.
- Produces:
  - **`ProductDetailDto` gains** `description`, `productType` and `tags`.
  - **`ProductVariantDto` gains** `compareAtAmountMinor`, `costAmountMinor`, `barcode`, `weightGrams`, `requiresShipping` and `taxable`.
  - **New route** `POST /api/v1/products/:productId/unlist`.

- [ ] **Step 1: Write the failing tests**

1. `POST /products` with `description`, `productType`, `tags` and a variant carrying `compareAtAmountMinor`/`costAmountMinor`/`barcode`/`weightGrams`/`requiresShipping: false`, then `GET /products/:id`. The detail DTO returns every one of them.
2. `PATCH`/`PUT /products/:id` (whichever verb the existing update route uses) with only `{ name, slug }` keeps the description. With `{ name, slug, description: null }`, it clears it.
3. Updating a variant with the **exact** admin-web body `{ sku, priceAmountMinor, currency }` keeps `compareAtAmountMinor`. With `selection: { Size: "L" }`, after options were set on a **published** product, it returns 200.
4. `compareAtAmountMinor` lower than the price returns 422 with a field issue on `compareAtAmountMinor`.
5. `POST /products/:id/unlist` on a published product returns 200, and the detail's `status` becomes `"unlisted"`. A principal without `products:publish` gets 403 (copy the publish route's permission test, if one exists).
6. Strict schemas: an unknown body key is still rejected wherever it was before (do not loosen any `.strict()`).

- [ ] **Step 2: Run, expect failure.** `pnpm.cmd --filter @platform/admin run test -- product-details-routes`

- [ ] **Step 3: Implement**

**Zod pieces** (near `addVariantBody`):

```ts
const variantAttributesBody = {
  compareAtAmountMinor: z.number().int().min(0).nullable().optional(),
  costAmountMinor: z.number().int().min(0).nullable().optional(),
  barcode: z.string().max(64).nullable().optional(),
  weightGrams: z.number().int().min(0).max(1_000_000).nullable().optional(),
  requiresShipping: z.boolean().optional(),
  taxable: z.boolean().optional(),
};
const productDetailsBody = {
  description: z.string().max(20_000).nullable().optional(),
  productType: z.string().max(255).nullable().optional(),
  tags: z.array(z.string().max(255)).max(250).optional(),
};
```

**Spread them into the existing schemas:**

- `createProductBody` gets `...productDetailsBody`; its variant item gets `...variantAttributesBody`.
- `updateProductBody` gets `...productDetailsBody`.
- `addVariantBody` gets `...variantAttributesBody`.
- `updateVariantBody` gets `...variantAttributesBody` and `selection: z.record(z.string()).nullable().optional()`.

If any of these objects is `.strict()`, keep it strict.

**`ProductVariantDto` / `toProductDetailDto`** gain:

```ts
  readonly compareAtAmountMinor: number | null;
  readonly costAmountMinor: number | null;
  readonly barcode: string | null;
  readonly weightGrams: number | null;
  readonly requiresShipping: boolean;
  readonly taxable: boolean;
```

mapped from `variant.attributes`, plus `description`, `productType` and `tags: [...product.details.tags]` on the product. This is the **staff** DTO, so `cost` belongs here.

**Unlist route**, a copy of `/products/:productId/publish`:

```ts
    defineRoute({
      method: "POST",
      path: "/products/:productId/unlist",
      version: 1,
      permission: "products:publish",
      idempotent: true,
      summary: "Unlist a product (sellable by direct link only, never listed)",
      schema: { params: productIdParams },
      handle: ({ params, context }) =>
        admin.products.unlistProduct(context.principal, {
          ...params,
          tenantId: context.tenantId,
        }),
    }),
```

**`ProductsAdminController.unlistProduct`:** a copy of `unpublishProduct` that calls `this.products.unlist(input)` with `"products:publish"`.

If a route-inventory, OpenAPI or route-count snapshot test fails because of the new route, update that snapshot. Do not weaken it.

- [ ] **Step 4: Run.** `pnpm.cmd --filter @platform/admin run test` and `… run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src
git commit -m "feat(admin): accept product details and variant attributes, add the unlist route"
```

---

### Task 6: Public surface and one price source on the server (closes G-94, server half)

**Files:**

- Modify: `apps/admin/src/http/public-catalog-routes.ts`
- Modify: `apps/admin/src/http/merchandise-resolution.ts`
- Create: `apps/admin/src/infrastructure/cross-context/catalog-pricing-validation.adapter.ts`
- Create: `apps/admin/src/infrastructure/cross-context/catalog-pricing-validation.adapter.test.ts`
- Delete: `apps/admin/src/infrastructure/cross-context/pricing-validation.adapter.ts` and its test
- Modify: `apps/admin/src/composition.ts`
- Modify: whatever tests seed a Pricing row only for `/validate`. Plan 2A kept one in `cart-checkout-pricing-security.e2e.test.ts` (Attack D). It becomes unnecessary: remove that seeding, and keep the assertion.
- Test: extend `apps/admin/src/http/public-catalog-routes.test.ts`

**Interfaces:**

- Consumes: `PublishState.isSellable` / `isListed` (Task 3); `Variant.attributes` (Task 1); `ProductDetails` (Task 2).
- Produces:
  - **`PublicProductDto` gains** `description: string | null`, `productType: string | null` and `tags: readonly string[]`.
  - **`PublicVariantDto` gains** `compareAtAmountMinor: number | null`.
  - **`CatalogPricingValidationAdapter`**, which implements `PricingValidationPort`.

- [ ] **Step 1: Write the failing tests**

**`public-catalog-routes.test.ts`:**

1. `GET /public/products` returns a published product, and **not** a draft, an unlisted or an archived one. Seed all four.
2. `GET /public/products?query=…` (search) applies the same rule.
3. `GET /public/products/:slug`:
   - returns 200 for published **and** unlisted;
   - returns 404 for draft and archived, with the same 404 body a missing slug gets today.
4. The public product DTO contains `description`, `productType`, `tags` and `variants[].compareAtAmountMinor`. Its keys **do not include** `cost`, `costAmountMinor`, `barcode` or `weightGrams`.
   - Assert this on `Object.keys`, for both the product and the variant.
   - **This is the security assertion of this task.**

If an existing test asserted that the public list returns drafts, rewrite it to this rule, and say so in the report.

**`catalog-pricing-validation.adapter.test.ts`**, using a fake `Pick<ProductController, "get">` that returns a `Product` built with the domain fixtures:

1. An item whose `variantRef` names a variant priced 1999 USD, with snapshot 1999 USD, is valid.
2. Snapshot 1500 when the variant is 1999 is invalid, with a reason containing `stale price`.
3. An unknown `variantRef` is invalid.
4. A legacy item with no `variantRef` on a single-variant product is checked against that variant. On a multi-variant product it is invalid.
5. A draft or archived product is invalid. An **unlisted** product is valid.
6. A currency different from the variant's is invalid.
7. The product lookup is called with the **item's** product id and the call's `tenantId`, never another tenant.

**Merchandise:** in the existing `public-cart-variants.test.ts`, an **unlisted** product can be added to the cart (200), and a draft one still cannot (422).

- [ ] **Step 2: Run, expect failure.** `pnpm.cmd --filter @platform/admin run test -- public-catalog-routes catalog-pricing-validation public-cart-variants`

- [ ] **Step 3: Implement the public routes**

**DTO:**

1. Add the fields to `PublicProductDto` / `PublicVariantDto`.
2. In `toProductDto`, add `description: product.details.description`, `productType: product.details.productType` and `tags: [...product.details.tags]`.
3. Per variant, add `compareAtAmountMinor: variant.attributes.compareAtPrice?.amountMinor ?? null`.
4. Do **not** add anything else from `attributes`.

**Filters:**

```ts
/** Plan 2C-1: lists and search show only LISTED products (published; never draft/unlisted/archived). */
function listedProductsOnly(response: PageResponse): PageResponse {
  if (response.status < 200 || response.status >= 300) return response;
  const page = response.body as Paginated<Product>;
  return {
    status: response.status,
    body: {
      ...page,
      items: page.items.filter((product) => product.status.isListed && !product.deleted),
    },
  };
}
```

- **`GET /public/products`:** `mapPage(listedProductsOnly(await admin.publicReads.products.list(…)), toProductDto)`.
- **`GET /public/products/:slug`:** after the 200 check:

```ts
const product = response.body as Product;
if (!product.status.isSellable || product.deleted) {
  return NOT_FOUND_RESPONSE;
}
return { status: 200, body: toProductDto(product) };
```

`NOT_FOUND_RESPONSE` must be **byte-identical** to what `getBySlug` returns for a missing slug. Build it with the same `NotFoundError("Product not found")` → `toErrorEnvelope` path (status 404), so a draft is indistinguishable from a missing slug.

A filtered page can be shorter than `first`. That is acceptable, and is the same trade-off as `publishedOnly` for prices. Note it in the function's doc comment.

**`merchandise-resolution.ts`:** replace `product.status.isPublished` with `product.status.isSellable`, and update the comment.

- [ ] **Step 4: Implement the adapter and wire it**

```ts
import type {
  CheckoutItem,
  PricingValidationPort,
  PricingValidationResult,
} from "@platform/checkout";
import type { Product, ProductController } from "@platform/catalog";

/**
 * Plan 2C-1 (closes G-94): the staff checkout `/validate` price check reads the Catalog VARIANT —
 * the same single price source the cart routes have used since Plan 2A — instead of a product-level
 * Pricing row. A legacy line with no variant is checked against the product's only variant; a
 * product with several variants and no variant named is never guessed at.
 */
export class CatalogPricingValidationAdapter implements PricingValidationPort {
  private readonly products: Pick<ProductController, "get">;

  constructor(products: Pick<ProductController, "get">) {
    this.products = products;
  }

  async validate(
    items: readonly CheckoutItem[],
    currency: string,
    tenantId: string,
  ): Promise<PricingValidationResult> {
    for (const item of items) {
      const response = await this.products.get({ productId: item.productRef, tenantId });
      if (response.status !== 200) {
        return { valid: false, reason: `product "${item.productRef}" not found` };
      }
      const product = response.body as Product;
      if (!product.status.isSellable || product.deleted) {
        return { valid: false, reason: `product "${item.productRef}" is not for sale` };
      }
      const variant =
        item.variantRef === undefined
          ? product.variants.length === 1
            ? product.variants[0]
            : undefined
          : product.variants.find((v) => v.id.toString() === item.variantRef);
      if (variant === undefined) {
        return { valid: false, reason: `no matching variant for product "${item.productRef}"` };
      }
      if (variant.price.currency !== currency) {
        return { valid: false, reason: `currency mismatch for product "${item.productRef}"` };
      }
      if (variant.price.amountMinor !== item.unitPriceAmountMinor) {
        return {
          valid: false,
          reason: `stale price snapshot for product "${item.productRef}" — the variant price has changed`,
        };
      }
    }
    return { valid: true };
  }
}
```

Check how `CheckoutItem` exposes `variantRef`. Plan 2A added a getter that returns `string | undefined`, so the `=== undefined` test is right. If it returns `null`, compare with `== null`.

**`composition.ts`:** replace

```ts
pricingValidation: deps.pricingValidation ?? new PricingValidationAdapter(pricing.priceRepository),
```

with

```ts
pricingValidation: deps.pricingValidation ?? new CatalogPricingValidationAdapter(catalog.products),
```

and update the comment above it. Then:

- remove the old import;
- delete `pricing-validation.adapter.ts` and its test;
- if `pricing.priceRepository` is now unused in `composition.ts`, leave `wirePricing` alone. The Pricing screen still uses it.

`resolvePrice` in `http/pricing-resolution.ts`: if nothing outside tests imports it, delete the file and its test. If something still does, leave it and list the importer in the report.

- [ ] **Step 5: Run.** `pnpm.cmd --filter @platform/admin run test` and `… run typecheck`. Expected: PASS.

Every H-01 / financial-security assertion from Plan 2A must still pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src
git commit -m "feat(admin): list only listed products publicly and validate prices against the variant"
```

---

### Task 7: Storefront: prices from the variant, description, compare-at, unlisted

**Files:**

- Modify: `apps/storefront/src/lib/runtime-api.ts`
- Modify: `apps/storefront/src/lib/catalog.ts`
- Modify: `apps/storefront/src/lib/catalog.test.ts`
- Modify: `apps/storefront/src/app/page.tsx`
- Modify: `apps/storefront/src/app/collections/[slug]/page.tsx`
- Modify: `apps/storefront/src/app/search/page.tsx`
- Modify: `apps/storefront/src/app/products/[slug]/page.tsx`
- Modify: `apps/storefront/src/components/product-card.tsx`
- Modify: `apps/storefront/src/components/variant-picker.tsx`
- Modify: `apps/storefront/src/components/add-to-cart-button.tsx`
- Modify: `apps/storefront/src/app/cart/actions.ts`
- Modify: `apps/storefront/src/messages/en.ts`, `ar.ts`
- Modify: `apps/admin-web/src/components/navigation.ts` (hide Pricing)

**Interfaces:**

- Consumes: `PublicProductDto.description / productType / tags` and `PublicVariantDto.compareAtAmountMinor` (Task 6).
- Produces:
  - `priceOf(product): PriceResolution`;
  - `PriceResolution`'s `ok` arm gains `compareAtMinor: number | null` and `varies: boolean`;
  - `SellableProduct`;
  - `addToCart(productId, quantity, variantId, currency)`.

- [ ] **Step 1: Write the failing tests**

In `lib/catalog.test.ts`, **delete** the `PriceBook` describe block, and add this one:

```ts
describe("priceOf (Plan 2C-1: the variant is the only price source)", () => {
  it("one variant: its price and compare-at", () => {
    expect(
      priceOf(
        product({ variants: [variant({ priceAmountMinor: 1999, compareAtAmountMinor: 2999 })] }),
      ),
    ).toEqual({
      status: "ok",
      amountMinor: 1999,
      currency: "USD",
      compareAtMinor: 2999,
      varies: false,
    });
  });

  it("several variants: the lowest price, flagged as varying", () => {
    const result = priceOf(
      product({
        variants: [
          variant({ id: "a", priceAmountMinor: 12000 }),
          variant({ id: "b", priceAmountMinor: 10000 }),
        ],
      }),
    );
    expect(result).toEqual({
      status: "ok",
      amountMinor: 10000,
      currency: "USD",
      compareAtMinor: null,
      varies: true,
    });
  });

  it("several variants with one price: not varying", () => {
    const result = priceOf(product({ variants: [variant({ id: "a" }), variant({ id: "b" })] }));
    expect(result.status === "ok" && result.varies).toBe(false);
  });

  it("no variants: unavailable; two currencies: ambiguous", () => {
    expect(priceOf(product({ variants: [] }))).toEqual({ status: "unavailable" });
    expect(
      priceOf(product({ variants: [variant({ id: "a" }), variant({ id: "b", currency: "EGP" })] })),
    ).toEqual({ status: "ambiguous" });
  });
});
```

Add `product()`/`variant()` fixture builders to the test file, matching the updated `ProductSummary` / `ProductVariantSummary`. The variant price defaults to 1999 USD, with `compareAtAmountMinor: null`, `selection: null` and `title: null`.

Also add a `resolveProductBySlug` case: an `unlisted` product resolves `ok`, and a `draft` still resolves `not-found`.

In `cart/actions` tests (or the closest existing test of `addToCart`):

1. `addToCart` creates the cart with the **currency it was given**.
2. It no longer calls `getPrices`.
3. For each test that mocked `getPrices` only to pass the pre-check, remove the mock and keep the assertion.

- [ ] **Step 2: Run, expect failure.** `pnpm.cmd --filter storefront run test -- catalog cart`

- [ ] **Step 3: Implement**

**`runtime-api.ts`:**

- `ProductSummary` gains `readonly description: string | null; readonly productType: string | null; readonly tags: readonly string[];`;
- `ProductVariantSummary` gains `readonly compareAtAmountMinor: number | null;`.

**`lib/catalog.ts`:**

1. Delete `PriceBook`, and the `getPrices` import if nothing else uses it.
2. Extend the `ok` arm of `PriceResolution` with `readonly compareAtMinor: number | null; readonly varies: boolean;`. Update the `"ambiguous"` doc comment: it now means "variants in two currencies", which the backend forbids since Plan 2C-1.
3. Add:

```ts
/**
 * Plan 2C-1 (closes G-94, storefront half): the displayed price comes from the product's own
 * variants — the same source the cart charges — never from the Pricing screen. Several prices show
 * the lowest as "from"; compare-at is shown only when it belongs to that lowest-priced variant.
 */
export function priceOf(product: Pick<ProductSummary, "variants">): PriceResolution {
  const [first] = product.variants;
  if (first === undefined) return { status: "unavailable" };
  if (product.variants.some((v) => v.currency !== first.currency)) return { status: "ambiguous" };
  const lowest = product.variants.reduce((min, v) =>
    v.priceAmountMinor < min.priceAmountMinor ? v : min,
  );
  return {
    status: "ok",
    amountMinor: lowest.priceAmountMinor,
    currency: lowest.currency,
    compareAtMinor: lowest.compareAtAmountMinor,
    varies: product.variants.some((v) => v.priceAmountMinor !== lowest.priceAmountMinor),
  };
}

export type SellableProduct = Omit<ProductSummary, "status"> & {
  readonly status: "published" | "unlisted";
};

function isSellableProduct(product: ProductSummary): product is SellableProduct {
  return product.status === "published" || product.status === "unlisted";
}
```

4. `resolveProductBySlug` uses `isSellableProduct`, and `ProductLookupResult`'s `ok` arm carries `SellableProduct`.
5. Lists and search keep `isPublishedProduct`. The server now filters too; keep both checks (defence in depth).

**Pages** (`page.tsx`, `collections/[slug]/page.tsx`, `search/page.tsx`):

- Remove `PriceBook.load()` from the `Promise.all`. Keep the destructuring order consistent, so `availabilityBook` stays correct.
- Replace `priceBook?.resolve(product.id) ?? { status: "unavailable" }` with `priceOf(product)`.

**Product page:**

1. `const price = priceOf(product);`.
2. Under the SKU line:

```tsx
{
  product.description !== null && (
    <p className="whitespace-pre-line text-sm">{product.description}</p>
  );
}
```

This is plain text. **Never** use `dangerouslySetInnerHTML`.

3. Add `generateMetadata`. Follow the `params` typing the page itself uses (Next 15 `params` is a Promise in this app, so copy the page's signature):

```ts
export async function generateMetadata({ params }: …): Promise<Metadata> {
  const { slug } = await params;
  const result = await resolveProductBySlug(slug);
  if (result.status !== "ok") return {};
  return {
    title: result.product.name,
    ...(result.product.status === "unlisted" ? { robots: { index: false, follow: false } } : {}),
  };
}
```

If the root layout already sets a title template, keep `title` consistent with it.

**`PriceLabel`** (in `product-card.tsx`), for the `ok` arm:

```tsx
<span className="flex items-baseline gap-2 text-sm">
  <span className="font-medium">
    {price.varies
      ? t.product.priceFrom.replace(
          "{price}",
          formatCurrency(locale, price.amountMinor, price.currency),
        )
      : formatCurrency(locale, price.amountMinor, price.currency)}
  </span>
  {price.compareAtMinor !== null && (
    <s className="text-muted-foreground">
      {formatCurrency(locale, price.compareAtMinor, price.currency)}
    </s>
  )}
</span>
```

Messages, in both `en.ts` and `ar.ts` next to `priceUnavailable`:

- English: `priceFrom: "From {price}"`;
- Arabic: `priceFrom: "يبدأ من {price}"`.

The `Dictionary` type must stay satisfied by both files.

**`VariantPicker`:** next to the chosen variant's price, render `<s className="text-muted-foreground text-sm">…</s>` with that variant's `compareAtAmountMinor` when it is not null. Pass `currency={variant?.currency ?? product.variants[0]?.currency ?? ""}` to `AddToCartButton`.

**`ProductCard`:** the footer condition stays `price.status === "ok" && product.variants.length <= 1`. Pass `currency={product.variants[0]?.currency ?? ""}`.

**`AddToCartButton`:** a new required prop `readonly currency: string;`. Call `addToCart(productId, 1, variantId, currency)`.

**`cart/actions.ts` `addToCart(productId, quantity, variantId: string | undefined, currency: string)`:**

1. Delete the `PriceBook` pre-check. The server resolves the price, and answers 422 when the product is not sellable. That 422 already maps to `"network"` today; map a plain 422 (not `VARIANT_REQUIRED`) to `{ ok: false, reason: "unavailable" }` instead, so the shopper still sees "unavailable".
2. Keep `AvailabilityBook` as is.
3. Use `currency` in `createCart(sessionRef, currency)`.
4. If `currency` is empty, return `{ ok: false, reason: "unavailable" }` before any network call.
5. Update the doc comment. The H-01 note stays true: the price is still never sent.

**`apps/admin-web/src/components/navigation.ts`:** remove the `pricing` entry from the nav list, and add a one-line comment where it was:

```ts
// Plan 2C-1: Pricing hidden — the variant on the product is the only price source. The /pricing
// route stays reachable for now (Plan 2C-2 decides what of it survives).
```

If a navigation test lists the items, update it. Remove the now-unused `TagIcon` import only if nothing else uses it.

- [ ] **Step 4: Run, sequentially**

1. `pnpm.cmd --filter storefront run test`
2. `pnpm.cmd --filter storefront run typecheck`
3. `pnpm.cmd --filter admin-web run test`
4. `pnpm.cmd --filter admin-web run typecheck`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src apps/admin-web/src/components/navigation.ts
git commit -m "feat(storefront): price from the variant, show description and compare-at, unlisted pages"
```

(If the navigation test file changed, add it too.)

---

### Task 8: Docs, gaps, gates, push

- [ ] **Step 1: Gaps** (`docs/KNOWN_GAPS.md` and `docs/architecture/23-platform-gap-register.md`)

**Close G-94** with the date and "closed by Plan 2C-1". The storefront and the staff `/validate` route now read the variant price; `PriceBook` and `PricingValidationAdapter` are deleted.

**Record as closed by Plan 2C-1** (new rows, closed the same day):

- "the public product routes returned draft and archived products (hidden only client-side)";
- "product options could not change after publishing".

**Open**, each with its plan:

- **Medium (Plan 2C-2):** "The admin product screen does not yet show description, type, tags, compare-at, cost, barcode, weight, physical-product or the unlisted status; prices are typed in minor units."
- **Medium (Plan 2C-2):** "Variant and product SKUs are required and unique per tenant; Shopify allows blank SKUs. Auto-generated variants (option matrix) need either generated SKUs or optional SKUs."
- **Low (Settings plan):** "No store currency setting; each product's currency is typed per variant."
- **Low (Plan 2D):** "Description, type and tags are single-language."

- [ ] **Step 2: Gates, sequentially**

1. Package suites: `@platform/catalog`, `@platform/checkout`, `@platform/admin`, `storefront`, `admin-web` and `@platform/db`, each with `pnpm.cmd --filter <pkg> run test`.
2. `pnpm.cmd -r --no-bail run typecheck`
3. `pnpm.cmd -r --no-bail run lint`
4. `pnpm.cmd arch`

Expected: every one exits 0, with no new warnings. The `tenant-mode-guard` classification test and `prisma-tenant-where.guard` must pass.

- [ ] **Step 3: Commit, then STOP before pushing**

```bash
git add docs/KNOWN_GAPS.md docs/architecture/23-platform-gap-register.md docs/superpowers/plans/2026-10-08-product-details.md
git commit -m "docs(catalog): record plan 2c-1, close g-94"
```

**STOP here.** Give the owner the Arabic report (see "Report back"), and ask them, in Arabic, to confirm that `20261009000000_product_details` shows as applied in Railway's Console.

Push only after the owner confirms:

```bash
git push origin morbeh/w0-w17-w12
```

If the owner reports a migration error, do not push. Report the error text.

---

## Done criteria

- A product carries a description, a type and tags. A variant carries compare-at, cost, barcode, weight, physical-product and taxable. All are optional, and live products are unchanged.
- Options can be changed on a published product. A variant's option selection can be edited.
- A product can be **unlisted**:
  - it opens by link and can be bought;
  - it is absent from the home page, collections, search and the sitemap;
  - its page carries `noindex`.
- The storefront shows each product's price from its variants:
  - "From …" when sizes differ;
  - the compare-at price struck through.
- The staff `/validate` route checks the variant price. Nothing reads the Pricing screen for a sale any more, and its sidebar link is hidden.
- The public product API never returns drafts or archived products, and never exposes cost, barcode or weight.
- Migration `20261009000000_product_details` is written and **not** applied. The owner applies it from Railway's Console **before or with** this release.

## Report back

In Arabic for the owner:

- one table, task → commit → test counts;
- every rewritten test, old name → new name;
- anything you had to decide that this plan did not;
- the migration reminder.

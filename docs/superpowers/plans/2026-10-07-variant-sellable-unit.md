# The Variant Is What Is Sold (Plan 2A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ملخص للمالك (بالعربي):** في شوبيفاي، الزبون بيشتري **مقاس ولون معيّن** من المنتج (variant)، مش المنتج كله. عندنا دلوقتي:
>
> | المشكلة                            | النتيجة                                                                            |
> | ---------------------------------- | ---------------------------------------------------------------------------------- |
> | السلة بتسجّل المنتج بس             | **الزبون ما يقدرش يختار مقاس أو لون**، وما ينفعش يحط مقاسين من نفس المنتج في السلة |
> | السعر بيتجاب من جدول الأسعار العام | لو المقاس L أغلى من S، السلة هتحسبهم بنفس السعر                                    |
> | اسم المنتج مش بيتنقل للطلب         | **الطلب بيتسجّل والمنتج اسمه رقم طويل** بدل اسمه الحقيقي                           |
>
> **الخطة دي بتصلّح التلاتة:**
>
> - صفحة المنتج في المتجر هيبقى فيها **اختيار المقاس/اللون**.
> - السعر بييجي من المقاس/اللون اللي اخترته.
> - الطلب بيتسجّل **باسم المنتج + المقاس/اللون + الـ SKU**، زي شوبيفاي.
>
> المخزون لكل مقاس/لون جاي في خطة **2B** بعدها على طول.

**Goal:** A cart line, checkout line and order line each reference a specific **variant** (Shopify's "merchandise"). Each line carries a snapshot of the product title, the variant title, the SKU and the variant's own price. The storefront lets shoppers pick a variant.

**Architecture:**

- A **line key** is introduced: `variantRef ?? productRef`.
  - Every cart operation (add, change quantity, remove, replace, merge) finds lines by it.
  - Lines written before this plan (no variant) keep working, keyed by product exactly as today.
- New optional line fields `variantRef`, `sku`, `title` and `variantTitle` travel **Cart → Checkout → Order**:
  - each as an optional addition;
  - with additive, nullable columns on `cart.cart_items` and `orders.order_items`;
  - and inside the existing JSON `checkout.checkout_sessions.items`, so no migration is needed there.
- One server-side resolver, `resolveMerchandise`, turns `{ productId, variantId? }` into the variant's price and snapshot. It reads Catalog (the variant's own price), not the product-level Pricing row.
  - With no `variantId`, a product with exactly one variant uses it.
  - With no `variantId` and several variants, the answer is `choose_variant`.
- Inventory stays product-level in this plan. Per-variant stock is Plan 2B.

**Tech Stack:** TypeScript, vitest, Prisma 6 (hand-written additive migrations), Next.js 15 (storefront client component for the picker).

**Spec:**

- [PLATFORM-MASTER-PLAN.md](../../plans/PLATFORM-MASTER-PLAN.md): Phase 1 units 1 (Catalog), 5 (Cart/Checkout) and 7 (Orders).
- [PLATFORM-GAP-REVIEW.md](../../plans/PLATFORM-GAP-REVIEW.md): §2.2 (variant is the SKU; one price source) and §2.4 (order lines hold price and title snapshots).

## Global Constraints

Same as Plans 1A to 1C. Every task implicitly includes these.

### Git and branch

- Branch `morbeh/w0-w17-w12`. No force-push. No `--no-verify`. Never raise the lint warning cap.
- Never stage `.claude/worktrees/`.
- Commit lines at most 100 characters, lowercase subject.
- End every commit with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

### Database

- **No database connection.** Write migrations only. Never set `TENANT_MODE=multi`.
- No guard exemptions: rename instead.

### Backward compatibility (non-negotiable)

- A cart line, checkout line or order line **without** a variant must keep working exactly as today. Live carts and orders have no variant.
- Every new field is optional, and every new column is nullable.

### Prices

- **The price is never accepted from the client.** The variant's price comes from Catalog, server-side, as today's product price comes from Pricing.
- `inventoryAvailable` from the body keeps its current (snapshot-only) meaning. Do not widen it.

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
| `services/cart`     | `@platform/cart`     |
| `services/checkout` | `@platform/checkout` |
| `services/orders`   | `@platform/orders`   |
| `apps/admin`        | `@platform/admin`    |
| `apps/storefront`   | `storefront`         |
| `packages/db`       | `@platform/db`       |

Confirm each filter name from its `package.json` before the first run.

---

## File Structure

### `services/cart/src/`

- **`domain/cart-item.ts`:** merchandise fields; `lineKey`.
- **`domain/cart.ts`:** find by `lineKey` everywhere.
- **`application/add-item.use-case.ts`, `change-item-quantity.use-case.ts`, `remove-item.use-case.ts`, `replace-variant.use-case.ts`:** an optional `variantId` / merchandise.
- **`infrastructure/cart.mapper.ts`:** map the new columns.
- **`domain/cart-variant-lines.test.ts`** (new).

### `packages/db/`

- **`prisma/schema/cart.prisma`:** `CartItem` gains `variantRef`, `sku`, `title` and `variantTitle`; the unique becomes `[cartId, productRef, variantRef]`.
- **`prisma/schema/orders.prisma`:** `OrderItem` gains `variantRef`, `sku` and `variantTitle`.
- **`prisma/schema/migrations/20261008000000_variant_lines/migration.sql`** (new).
- **`src/schema-migration-consistency.test.ts`:** two blocks.

### `apps/admin/src/http/`

- **`merchandise-resolution.ts`** (new), with `merchandise-resolution.test.ts`: `resolveMerchandise`.
- **`public-cart-routes.ts`:** bodies accept `variantId`; add uses `resolveMerchandise`; DTO fields.
- **`cart-routes.ts`:** the staff add and replace-variant routes, same treatment.
- **`public-checkout-routes.ts`:** load-items copies the merchandise.
- **`public-catalog-routes.ts`:** `PublicProductDto` gains `options` and `variants[].selection` / `variants[].title`.
- **`public-cart-variants.test.ts`** (new).

### `apps/admin/src/infrastructure/cross-context/`

- **`order-creation.adapter.ts`:** `name` = title, or the product ref when absent; it passes `variantRef`, `sku` and `variantTitle`.

### `services/checkout/src/`

- **`domain/value-objects/checkout-item.ts`:** optional merchandise.
- **`application/checkout-details.use-cases.ts`:** the `LoadItems` input carries it.
- **`infrastructure/checkout-session.mapper.ts`:** JSON round-trip.

### `services/orders/src/`

- **`domain/value-objects/product-snapshot.ts`:** optional `variantRef`, `sku`, `variantTitle`.
- **`application/place-order.use-case.ts`:** `PlaceOrderItemInput` carries them.
- **`infrastructure/order.mapper.ts`:** the columns.

### `apps/storefront/src/`

- **`components/variant-picker.tsx`** (new, client), with `variant-picker.test.tsx`.
- **`components/add-to-cart-button.tsx`:** takes `variantId`.
- **`app/cart/actions.ts`, `lib/runtime-api.ts`:** pass `variantId` on add, quantity and remove.
- **`app/products/[slug]/page.tsx`:** renders the picker; the price follows the selected variant.
- **`components/cart-view.tsx`:** shows `title — variantTitle` and passes `variantId` for quantity and remove.

---

### Task 1: `resolveMerchandise`, and options/selection on the public product DTO

**Files:**

- Create: `apps/admin/src/http/merchandise-resolution.ts`
- Test: `apps/admin/src/http/merchandise-resolution.test.ts`
- Modify: `apps/admin/src/http/public-catalog-routes.ts`:
  - `PublicVariantDto` gains `selection: Readonly<Record<string, string>> | null` and `title: string | null`;
  - `PublicProductDto` gains `options: readonly { name: string; values: readonly string[] }[]`;
  - `toProductDto` fills them.

**Interfaces:**

- Produces:

```ts
export type MerchandiseResolution =
  | {
      readonly status: "ok";
      readonly productId: string;
      readonly variantId: string;
      readonly sku: string;
      readonly title: string;
      readonly variantTitle: string | null;
      readonly amountMinor: number;
      readonly currency: string;
    }
  | { readonly status: "choose_variant" } // several variants, none named
  | { readonly status: "unavailable" }; // no such product/variant, not published, or a read error

export async function resolveMerchandise(
  admin: WiredAdmin,
  input: { readonly productId: string; readonly variantId?: string },
  tenantId: string,
): Promise<MerchandiseResolution>;

export function variantTitleOf(
  options: readonly { name: string; values: readonly string[] }[],
  selection: Readonly<Record<string, string>> | null,
): string | null; // values in the product's option order, joined " / "; null when no selection

export function merchandiseUnresolvedResponse(resolution: {
  status: "choose_variant" | "unavailable";
}): PageResponse;
// 422 with code VARIANT_REQUIRED for choose_variant; 422 "Unable to resolve a price…" for unavailable
```

- [ ] **Step 1: Write the failing test**

Seed products through the same route or controller path that `public-catalog-routes.test.ts` uses to create and publish products. Open it first and copy its setup.

Seed these two products:

- **product A:** a single variant, price 10000 EGP;
- **product B:** options `Size: [S, L]`, variants S = 10000 and L = 12000, published.

Then assert:

1. `resolveMerchandise(admin, { productId: A }, t)` returns `ok`, with A's only variant id, `title` = A's name, `variantTitle: null`, `amountMinor` 10000.
2. `resolveMerchandise(admin, { productId: B }, t)` returns `{ status: "choose_variant" }`.
3. `resolveMerchandise(admin, { productId: B, variantId: L.id }, t)` returns `ok`, with `amountMinor` 12000 and `variantTitle` `"L"`.
4. A `variantId` that belongs to another product returns `unavailable`.
5. An unpublished (draft) product returns `unavailable`.
6. `variantTitleOf([{name:"Color",values:[...]},{name:"Size",values:[...]}], { Size: "L", Color: "Red" })` returns `"Red / L"`. Option order wins over object key order.
7. The public product DTO for B exposes `options` and each variant's `selection` and `title`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/admin run test -- merchandise-resolution`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/admin/src/http/merchandise-resolution.ts
import type { Product } from "@platform/catalog";
import { ValidationError, toErrorEnvelope } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { PageResponse } from "./public-catalog-routes";

export type MerchandiseResolution =
  | {
      readonly status: "ok";
      readonly productId: string;
      readonly variantId: string;
      readonly sku: string;
      readonly title: string;
      readonly variantTitle: string | null;
      readonly amountMinor: number;
      readonly currency: string;
    }
  | { readonly status: "choose_variant" }
  | { readonly status: "unavailable" };

export function variantTitleOf(
  options: readonly { readonly name: string; readonly values: readonly string[] }[],
  selection: Readonly<Record<string, string>> | null,
): string | null {
  if (selection === null) return null;
  const parts = options
    .map((option) => selection[option.name])
    .filter((value): value is string => value !== undefined);
  return parts.length === 0 ? null : parts.join(" / ");
}

/**
 * Plan 2A: the price and snapshot of the exact variant being sold (Shopify's merchandise). The
 * price is the VARIANT's, read server-side from Catalog — never from the caller, and no longer the
 * product-level Pricing row (`resolvePrice`), which cannot price two sizes differently.
 */
export async function resolveMerchandise(
  admin: WiredAdmin,
  input: { readonly productId: string; readonly variantId?: string },
  tenantId: string,
): Promise<MerchandiseResolution> {
  const response = await admin.publicReads.products.get({ productId: input.productId, tenantId });
  if (response.status !== 200) return { status: "unavailable" };
  const product = response.body as Product;
  if (!product.status.isPublished || product.deleted) return { status: "unavailable" };
  const variant =
    input.variantId === undefined
      ? product.variants.length === 1
        ? product.variants[0]
        : undefined
      : product.variants.find((v) => v.id.toString() === input.variantId);
  if (variant === undefined) {
    return input.variantId === undefined ? { status: "choose_variant" } : { status: "unavailable" };
  }
  const options = product.options.map((o) => ({ name: o.name, values: [...o.values] }));
  return {
    status: "ok",
    productId: product.id.toString(),
    variantId: variant.id.toString(),
    sku: variant.sku.value,
    title: product.name,
    variantTitle: variantTitleOf(options, variant.selection?.values ?? null),
    amountMinor: variant.price.amountMinor,
    currency: variant.price.currency,
  };
}

export function merchandiseUnresolvedResponse(resolution: {
  readonly status: "choose_variant" | "unavailable";
}): PageResponse {
  if (resolution.status === "choose_variant") {
    return {
      status: 422,
      body: {
        code: "VARIANT_REQUIRED",
        message: "Choose a variant (size, color…) for this product",
        retryable: false,
        fields: [{ field: "variantId", message: "required for a product with several variants" }],
      },
    };
  }
  return {
    status: 422,
    body: toErrorEnvelope(new ValidationError("Unable to resolve a price for this product")),
  };
}
```

> - **`publicReads.products.get`:** if `WiredAdmin.publicReads.products` has no `get`, add it. It is the raw `ProductController.get` (product.controller.ts line ≈ 84), exposed the same way `getBySlug` and `list` already are.
> - **`Product`:** if it is not exported from `@platform/catalog`, export it.
> - **`.toString()` vs `.value`:** use whichever `UniqueEntityId` accessor `toProductDto` uses (it uses `.value`). Keep both files consistent.
> - **`PageResponse`'s body shape:** match it to the existing 422 envelope used by `priceUnresolvedResponse` (`toErrorEnvelope`). If the envelope's `code` field is named differently, follow it, so the storefront can detect `VARIANT_REQUIRED`.

`public-catalog-routes.ts`, in `toProductDto`:

```ts
    options: product.options.map((o) => ({ name: o.name, values: [...o.values] })),
    variants: product.variants.map((variant) => ({
      id: variant.id.value,
      sku: variant.sku.value,
      priceAmountMinor: variant.price.amountMinor,
      currency: variant.price.currency,
      selection: variant.selection?.values ?? null,
      title: variantTitleOf(
        product.options.map((o) => ({ name: o.name, values: [...o.values] })),
        variant.selection?.values ?? null,
      ),
    })),
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm.cmd --filter @platform/admin run test -- merchandise-resolution public-catalog-routes`
Run: `pnpm.cmd --filter @platform/admin run typecheck`
Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/http/merchandise-resolution.ts apps/admin/src/http/merchandise-resolution.test.ts apps/admin/src/http/public-catalog-routes.ts apps/admin/src/composition.ts services/catalog/src/index.ts
git commit -m "feat(admin): resolve the variant being sold and expose options publicly"
```

---

### Task 2: Cart lines keyed by variant

**Files:**

- Modify: `services/cart/src/domain/cart-item.ts`, `services/cart/src/domain/cart.ts`
- Modify: `services/cart/src/application/add-item.use-case.ts`, `change-item-quantity.use-case.ts`, `remove-item.use-case.ts`, `replace-variant.use-case.ts`
- Test: `services/cart/src/domain/cart-variant-lines.test.ts`

**Interfaces:**

- Produces:
  - `CartItemSnapshots` gains `merchandise?: { variantRef: string; sku: string; title: string; variantTitle: string | null }`.
  - `CartItem` gains these getters:
    - `variantRef: string | undefined`
    - `sku: string | undefined`
    - `title: string | undefined`
    - `variantTitle: string | null | undefined`
    - `lineKey: string`, which is `variantRef ?? productRef.value`.
  - The `Cart` methods that took a product id now take a **line key**: `removeItem(lineKey)`, `changeItemQuantity(lineKey, q)`, `replaceItemVariant(itemId, oldLineKey, …)`.

    `addItem` and `merge` match on `lineKey`. The new line's key comes from `snapshots.merchandise?.variantRef ?? productRef.value`.

  - Use-case inputs:
    - `AddItemInput` gains `merchandise?: {…}` (same shape);
    - `ChangeItemQuantityInput` and `RemoveItemInput` gain `variantId?: string`, and the use case passes `input.variantId ?? input.productId` as the line key;
    - `ReplaceVariantInput` gains `oldVariantId?` and `newMerchandise?`.

- [ ] **Step 1: Write the failing test**

```ts
// services/cart/src/domain/cart-variant-lines.test.ts
import { describe, expect, it } from "vitest";
import { Money, ProductRef, UniqueEntityId } from "@platform/domain";
import { Cart } from "./cart";
import { Quantity } from "./value-objects/quantity";

const ref = (v: string) => {
  const r = ProductRef.create(v);
  if (!r.ok) throw new Error("bad ref");
  return r.value;
};
const qty = (n: number) => {
  const q = Quantity.create(n);
  if (!q.ok) throw new Error("bad qty");
  return q.value;
};
const egp = (n: number) => {
  const m = Money.create(n, "EGP");
  if (!m.ok) throw new Error("bad money");
  return m.value;
};
const shirtS = { variantRef: "v-s", sku: "SHIRT-S", title: "Shirt", variantTitle: "S" };
const shirtL = { variantRef: "v-l", sku: "SHIRT-L", title: "Shirt", variantTitle: "L" };

// Build an empty active EGP cart the same way the existing cart tests do (open cart.test.ts for the
// exact Cart.create(...) call and copy it into this helper).
function emptyCart(): Cart {
  throw new Error("replace with the Cart.create(...) call from cart.test.ts");
}

describe("cart lines keyed by variant (Plan 2A)", () => {
  it("two sizes of one product are two lines; the same size twice increments", () => {
    const cart = emptyCart();
    cart.addItem(UniqueEntityId.from("i1"), ref("p-shirt"), qty(1), egp(10000), {
      merchandise: shirtS,
    });
    cart.addItem(UniqueEntityId.from("i2"), ref("p-shirt"), qty(1), egp(12000), {
      merchandise: shirtL,
    });
    cart.addItem(UniqueEntityId.from("i3"), ref("p-shirt"), qty(2), egp(10000), {
      merchandise: shirtS,
    });
    expect(cart.items.map((i) => [i.lineKey, i.quantity.value])).toEqual([
      ["v-s", 3],
      ["v-l", 1],
    ]);
    expect(cart.totalAmount().amountMinor).toBe(3 * 10000 + 12000);
  });

  it("quantity and remove address a line by its variant", () => {
    const cart = emptyCart();
    cart.addItem(UniqueEntityId.from("i1"), ref("p-shirt"), qty(1), egp(10000), {
      merchandise: shirtS,
    });
    cart.addItem(UniqueEntityId.from("i2"), ref("p-shirt"), qty(1), egp(12000), {
      merchandise: shirtL,
    });
    cart.changeItemQuantity("v-l", qty(4));
    cart.removeItem("v-s");
    expect(cart.items.map((i) => [i.lineKey, i.quantity.value, i.sku, i.variantTitle])).toEqual([
      ["v-l", 4, "SHIRT-L", "L"],
    ]);
  });

  it("a line without a variant is keyed by product exactly as before", () => {
    const cart = emptyCart();
    cart.addItem(UniqueEntityId.from("i1"), ref("p-mug"), qty(1), egp(5000));
    cart.changeItemQuantity("p-mug", qty(2));
    expect(cart.items[0]?.lineKey).toBe("p-mug");
    expect(cart.items[0]?.variantRef).toBeUndefined();
    cart.removeItem("p-mug");
    expect(cart.items).toHaveLength(0);
  });
});
```

> Replace `emptyCart()`'s body with the real `Cart.create(...)` call used in `services/cart/src/domain/cart.test.ts` (or the nearest existing cart test). The `throw` exists only so the helper cannot be forgotten.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/cart run test -- cart-variant-lines`
Expected: FAIL. `lineKey` is undefined, or the two sizes merge into one line.

- [ ] **Step 3: Write the implementation**

In `cart-item.ts`:

```ts
export interface CartLineMerchandise {
  readonly variantRef: string;
  readonly sku: string;
  readonly title: string;
  readonly variantTitle: string | null;
}

export interface CartItemSnapshots {
  readonly inventoryAvailable?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Plan 2A: the exact variant this line sells, snapshotted server-side. Absent on legacy lines. */
  readonly merchandise?: CartLineMerchandise;
}
```

- Add `readonly merchandise?: CartLineMerchandise` to `CartItemProps`, and set it in `create`.
- Add the getters:

```ts
  get variantRef(): string | undefined {
    return this.props.merchandise?.variantRef;
  }
  get sku(): string | undefined {
    return this.props.merchandise?.sku;
  }
  get title(): string | undefined {
    return this.props.merchandise?.title;
  }
  get variantTitle(): string | null | undefined {
    return this.props.merchandise?.variantTitle;
  }
  /** Plan 2A: what identifies a line — the variant when known, else the product (legacy lines). */
  get lineKey(): string {
    return this.props.merchandise?.variantRef ?? this.props.productRef.value;
  }
```

In `cart.ts`:

- Replace every `i.productRef.value === X` lookup with `i.lineKey === X`. There are five sites: `addItem`, `removeItem`, `changeItemQuantity`, `replaceItemVariant` and `merge`.
- In `addItem`, compute the key of the incoming line as `snapshots.merchandise?.variantRef ?? productRef.value`.
- In `merge`, use `item.lineKey`.
- Rename the parameters `productId` / `oldProductId` to `lineKey` / `oldLineKey`. Their doc comments say a legacy line's key is its product id.

In the four use cases:

- **`AddItem`:** forward `input.merchandise` inside the snapshots object.
- **`ChangeItemQuantity` and `RemoveItem`:** call the cart with `input.variantId ?? input.productId`.
- **`ReplaceVariant`:** old key `input.oldVariantId ?? input.oldProductId`, and pass `newMerchandise` in the snapshots.

  Read its current input names first, and keep them.

Update every **existing** caller to compile. They pass product ids, which remain valid line keys for legacy lines, so no behaviour changes.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm.cmd --filter @platform/cart run test`
Run: `pnpm.cmd --filter @platform/cart run typecheck`
Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add services/cart/src
git commit -m "feat(cart): key cart lines by variant, legacy lines by product"
```

---

### Task 3: Columns and migration for cart and order lines

**Files:**

- Modify: `packages/db/prisma/schema/cart.prisma`, `packages/db/prisma/schema/orders.prisma`
- Create: `packages/db/prisma/schema/migrations/20261008000000_variant_lines/migration.sql`
- Modify: `packages/db/src/schema-migration-consistency.test.ts`
- Modify: `services/cart/src/infrastructure/cart.mapper.ts` (read and write the four columns)

**Interfaces:**

- `CartItem` model: `variantRef String? @map("variant_ref")`, `sku String?`, `title String?`, `variantTitle String? @map("variant_title")`. Replace `@@unique([cartId, productRef])` with `@@unique([cartId, productRef, variantRef])`.
- `OrderItem` model: `variantRef String? @map("variant_ref")`, `sku String?`, `variantTitle String? @map("variant_title")`.

- [ ] **Step 1: Write the failing test** (append to `schema-migration-consistency.test.ts`)

Assert that `columnsEverAddedTo` includes:

- for `"cart"."cart_items"`: `variant_ref`, `sku`, `title`, `variant_title`;
- for `"orders"."order_items"`: `variant_ref`, `sku`, `variant_title`.

Also assert that `allSql` contains:

- `DROP INDEX IF EXISTS "cart"."cart_items_cart_id_product_ref_key";`
- `NULLS NOT DISTINCT`

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/db run test -- schema-migration-consistency`
Expected: FAIL.

- [ ] **Step 3: Write the migration, models and mapper**

```sql
-- Plan 2A — the variant is what is sold. Written by hand, NOT applied by the agent; the owner deploys
-- it from Railway's Console (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`)
-- WITH or BEFORE the release that writes variant lines.
--
-- ADDITIVE: nullable columns only, so every existing cart/order line (no variant) stays valid and is
-- read exactly as before. The cart line uniqueness widens from (cart, product) to
-- (cart, product, variant) so two sizes of one product can be two lines; NULLS NOT DISTINCT keeps
-- legacy (variant-less) lines unique per product, exactly as the old index did. Postgres ≥ 15.

ALTER TABLE "cart"."cart_items"
  ADD COLUMN "variant_ref"   TEXT,
  ADD COLUMN "sku"           TEXT,
  ADD COLUMN "title"         TEXT,
  ADD COLUMN "variant_title" TEXT;

DROP INDEX IF EXISTS "cart"."cart_items_cart_id_product_ref_key";
CREATE UNIQUE INDEX "cart_items_cart_id_product_ref_variant_ref_key"
  ON "cart"."cart_items" ("cart_id", "product_ref", "variant_ref") NULLS NOT DISTINCT;

ALTER TABLE "orders"."order_items"
  ADD COLUMN "variant_ref"   TEXT,
  ADD COLUMN "sku"           TEXT,
  ADD COLUMN "variant_title" TEXT;

COMMENT ON COLUMN "cart"."cart_items"."variant_ref" IS
  'Plan 2A: the catalog variant this line sells; NULL on lines written before variants were tracked.';
COMMENT ON COLUMN "orders"."order_items"."variant_ref" IS
  'Plan 2A: snapshot of the variant sold; NULL on orders placed before variants were tracked.';
```

**Prisma models:** add the fields as listed under Interfaces.

`@@unique([cartId, productRef, variantRef])` generates an index name. The migration creates exactly `cart_items_cart_id_product_ref_variant_ref_key`, which is Prisma's default name for that `@@unique`. Prisma cannot express `NULLS NOT DISTINCT`; it exists in the SQL only, and that is intended.

**Cart mapper:**

- **To row:** `variantRef: item.variantRef ?? null`, `sku: item.sku ?? null`, `title: item.title ?? null`, `variantTitle: item.variantTitle ?? null`.
- **To domain:** when `row.variantRef !== null`, pass `merchandise: { variantRef, sku: row.sku ?? "", title: row.title ?? "", variantTitle: row.variantTitle }`.

Run `pnpm.cmd --filter @platform/db exec prisma generate`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm.cmd --filter @platform/db run test`
Expected: PASS, including the `prisma-tenant-where` guard.

Run: `pnpm.cmd --filter @platform/cart run test`
Run: `pnpm.cmd --filter @platform/cart run typecheck`
Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema/cart.prisma packages/db/prisma/schema/orders.prisma packages/db/prisma/schema/migrations/20261008000000_variant_lines/migration.sql packages/db/src/schema-migration-consistency.test.ts services/cart/src/infrastructure/cart.mapper.ts
git commit -m "feat(db): add variant columns to cart and order lines"
```

---

### Task 4: Cart routes sell variants

**Files:**

- Modify: `apps/admin/src/http/public-cart-routes.ts`
- Modify: `apps/admin/src/http/cart-routes.ts` (staff add and replace-variant: same treatment)
- Modify: the cart controller and admin-controller input types, if they enumerate fields
- Test: `apps/admin/src/http/public-cart-variants.test.ts`

**Interfaces:**

- **`addItemBody`:** gains `variantId: z.string().min(1).optional()`.
  - The handler calls `resolveMerchandise(admin, { productId, variantId }, tenant)`.
  - On not-ok it returns `merchandiseUnresolvedResponse(...)`.
  - On ok it calls `cart.add` with the price from the resolution and `merchandise: { variantRef, sku, title, variantTitle }`.
- **`changeQuantityBody` and `removeItemBody`:** gain `variantId?`, forwarded.
- **`PublicCartItemDto`:** gains `variantId: string | null`, `sku: string | null`, `title: string | null`, `variantTitle: string | null`.
- **Wishlist "move to cart"** (`public-wishlist-routes.ts` ≈ line 294): switch from `resolvePrice` to `resolveMerchandise(admin, { productId: body.productRef }, …)`. A multi-variant product then answers `VARIANT_REQUIRED`, which is correct: the shopper must pick a size.
- **`resolvePrice`:** stays, for any remaining caller. Do not delete it in this plan.

- [ ] **Step 1: Write the failing test**

Seed product B (S = 10000, L = 12000) and product A (single variant) as in Task 1. Open a guest cart through the public routes, the way `public-cart-routes.test.ts` does. Then assert:

1. Adding B with `variantId: S` and then `variantId: L` gives two items. The DTO shows the variant ids, `sku`, `title` "…" and `variantTitle` "S"/"L". Subtotal 22000.
2. Adding B **without** `variantId` gives 422 with code `VARIANT_REQUIRED`.
3. Adding A without `variantId` works (single-variant default), with `variantTitle: null`.
4. The quantity route with `variantId: L, quantity: 3` changes only the L line. Remove with `variantId: S` removes only S.
5. The body cannot set a price: an extra `unitPriceAmountMinor` field is rejected by the `.strict()` schema (400/422).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/admin run test -- public-cart-variants`
Expected: FAIL.

- [ ] **Step 3: Implement as specified above.** Keep `requireOwnedCart` and every existing check exactly as is.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm.cmd --filter @platform/admin run test`
Expected: PASS. Every existing cart, wishlist and checkout suite stays green.

Run: `pnpm.cmd --filter @platform/admin run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src
git commit -m "feat(admin): sell variants through the cart routes"
```

---

### Task 5: Checkout and orders carry the variant; order lines get real names

**Files:**

- Modify: `services/checkout/src/domain/value-objects/checkout-item.ts`
- Modify: `services/checkout/src/application/checkout-details.use-cases.ts` (≈ line 74), `services/checkout/src/infrastructure/checkout-session.mapper.ts` (≈ line 85)
- Modify: `apps/admin/src/http/public-checkout-routes.ts`:
  - load-items, ≈ line 297: copy `variantId: item.variantRef`, `sku`, `title`, `variantTitle`;
  - the checkout DTO, ≈ line 149: expose them.
- Modify: `services/orders/src/domain/value-objects/product-snapshot.ts`, `services/orders/src/application/place-order.use-case.ts`, `services/orders/src/infrastructure/order.mapper.ts`
- Modify: `apps/admin/src/infrastructure/cross-context/order-creation.adapter.ts` (≈ line 97)
- Test: append to the existing checkout and orders unit tests, plus `apps/admin/src/http/guest-checkout.e2e.test.ts` (one new case)

**Interfaces:**

- `CheckoutItem.create(productRef, quantity, unitPriceAmountMinor, currency, merchandise?: { variantRef; sku; title; variantTitle })`. Getters return `undefined` when absent. The JSON stored in `checkout_sessions.items` gains the four optional keys.
- `ProductSnapshot.create(productId, name, unitPrice, variant?: { variantRef: string; sku: string; variantTitle: string | null })`.
- `PlaceOrderItemInput` gains `variantRef?`, `sku?`, `variantTitle?`.
- `OrderCreationAdapter` builds each order item as:

```ts
      items: input.items.map((item) => ({
        productId: item.productRef,
        // Plan 2A: the real product title when the line carries one; legacy lines keep the old
        // placeholder (the ref) — see this class's doc comment, now narrowed to legacy lines only.
        name: item.title ?? item.productRef,
        unitPriceAmountMinor: item.unitPriceAmountMinor,
        quantity: item.quantity,
        ...(item.variantRef === undefined
          ? {}
          : { variantRef: item.variantRef, sku: item.sku, variantTitle: item.variantTitle }),
      })),
```

Read the current object first and keep any field it already sets. Update the class doc comment's bullet about names: it now applies only to lines without a title.

- [ ] **Step 1: Write the failing tests**

1. **Checkout:** a `CheckoutItem` with merchandise round-trips through the session mapper with all four fields, and one without it still round-trips unchanged.
2. **Orders:** `PlaceOrder` with an item carrying `variantRef`/`sku`/`variantTitle` persists them. The mapper round-trip in the in-memory repository returns them. An item without them is unchanged.
3. **e2e** (`guest-checkout.e2e.test.ts`, new `it`): add product B size L to a guest cart → checkout → place order.

   The created order's line has `name` = B's title (**not** its id), `sku` "…-L", `variantTitle` "L", and unit price 12000.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm.cmd --filter @platform/checkout run test`
Run: `pnpm.cmd --filter @platform/orders run test`
Run: `pnpm.cmd --filter @platform/admin run test -- guest-checkout`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement as specified above.** For `order.mapper.ts`, map the three nullable columns both ways, just like Task 3's cart mapper.

- [ ] **Step 4: Run the tests and typecheck**

Run the three suites above, then typecheck `@platform/checkout`, `@platform/orders` and `@platform/admin`.
Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add services/checkout/src services/orders/src apps/admin/src
git commit -m "feat(orders): carry the variant through checkout and name order lines"
```

---

### Task 6: Storefront variant picker

**Files:**

- Create: `apps/storefront/src/components/variant-picker.tsx` (client), with `variant-picker.test.tsx`
- Modify: `apps/storefront/src/components/add-to-cart-button.tsx`: prop `variantId?: string`, passed to `addToCart(productId, 1, variantId)`.
- Modify: `apps/storefront/src/app/cart/actions.ts`: `addToCart(productId, quantity, variantId?)`; quantity and remove actions accept `variantId?`; map a 422 `VARIANT_REQUIRED` to reason `"choose-variant"`.
- Modify: `apps/storefront/src/lib/runtime-api.ts`:
  - `ProductSummary.options` and `ProductVariantSummary.selection` / `title`;
  - the add, quantity and remove calls send `variantId` when given;
  - `CartItemSummary` gains `variantId`, `sku`, `title`, `variantTitle`.
- Modify: `apps/storefront/src/app/products/[slug]/page.tsx`: render `<VariantPicker product=… t=… />` in place of the bare `AddToCartButton`. Delete the static variant SKU list, which the picker replaces.
- Modify: `apps/storefront/src/components/cart-view.tsx`: line label `title ?? productId`, plus ` — ${variantTitle}` when present; quantity and remove pass `variantId ?? undefined`.
- Modify: `apps/storefront/src/messages/en.ts` and `ar.ts`:

| Key                              | English                             | Arabic                     |
| -------------------------------- | ----------------------------------- | -------------------------- |
| `product.chooseOption`           | "Choose {option}"                   | "اختر {option}"            |
| `product.unavailableCombination` | "This combination is not available" | "الاختيار ده مش متاح"      |
| `product.chooseVariant`          | "Choose a size/option first"        | "اختار المقاس/النوع الأول" |

**Interfaces:**

- `VariantPicker({ product: ProductSummary, outOfStock: boolean, t: Dictionary })`:
  - one `<select>` (or button group) per option, labelled with the option name;
  - the selected combination resolves to the variant whose `selection` matches all chosen values;
  - it shows that variant's price, formatted with the existing `lib/format.ts` helper;
  - it enables `AddToCartButton` with that `variantId` only when a match exists; otherwise it shows `unavailableCombination`.

    A product with **no options** (one variant) renders just the price and the button with that single variant's id.

- [ ] **Step 1: Write the failing test** (`variant-picker.test.tsx`, Testing Library, like `add-to-cart-button.test.tsx`)

1. A product with options Size `[S, L]` and two variants shows the S price by default (the first value of each option). Switching to L shows the L price. The add button is wired with L's id: mock `@/app/cart/actions` and assert `addToCart` was called with `(productId, 1, "v-l")`.
2. A combination with no variant shows the "not available" text and the button is disabled.
3. A product with no options renders the single price, and the button adds that variant's id.
4. Arabic dictionary: labels come from `ar.ts`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter storefront run test -- variant-picker`
Expected: FAIL.

- [ ] **Step 3: Implement as specified above.** Keep it a small client component. Formatting, i18n and `Button` come from the existing imports used by `add-to-cart-button.tsx`.

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `pnpm.cmd --filter storefront run test`
Run: `pnpm.cmd --filter storefront run typecheck`
Run: `pnpm.cmd --filter storefront run lint`
Expected: PASS, exit 0, no new warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src
git commit -m "feat(storefront): let shoppers choose a variant and show its price"
```

---

### Task 7: Docs, gaps, gates, push

- [ ] **Step 1: Gaps** (`docs/KNOWN_GAPS.md` and `docs/architecture/23-platform-gap-register.md`)

Add, as **closed by Plan 2A**:

- "cart lines could not distinguish variants";
- "order lines were named by product id".

Add as **open**, each with its plan:

- **Medium:** "Stock is still tracked per product, not per variant (Plan 2B)."
- **Low:** "The admin Pricing screen's product-level prices no longer drive cart prices; variant prices do. Consolidate in the product editor (Plan 2C)."

- [ ] **Step 2: Gates, sequentially**

Run the package suites first, then the repo-wide checks:

1. `@platform/cart`, `@platform/checkout`, `@platform/orders`, `@platform/admin`, `storefront`, `@platform/db`, each with `pnpm.cmd --filter <pkg> run test`;
2. `pnpm.cmd -r --no-bail run typecheck`;
3. `pnpm.cmd -r --no-bail run lint`;
4. `pnpm.cmd arch`.

Expected: every one exits 0, with no new warnings. The `tenant-mode-guard` classification test must pass.

- [ ] **Step 3: Commit and push**

```bash
git add docs/KNOWN_GAPS.md docs/architecture/23-platform-gap-register.md docs/superpowers/plans/2026-10-07-variant-sellable-unit.md
git commit -m "docs(catalog): record plan 2a, open the per-variant stock gap"
git push origin morbeh/w0-w17-w12
```

---

## Done criteria

- On the storefront, a product with sizes shows a picker. The price follows the chosen size.
- Two sizes of the same product can be in the cart as two lines.
- An order placed from that cart lists each line with the product's **name**, the size (`variantTitle`), the SKU and that size's price.
- Prices come from the variant, server-side. The client cannot set one.
- Existing carts and orders without variants still load, change and check out exactly as before.
- The migration is written and not applied. No database connection. No `TENANT_MODE=multi`.

## Stop conditions (stop and report in Arabic)

- Any existing test outside the listed files fails and the fix is not an obvious compile update.
- `publicReads.products` cannot expose `get` without widening an unrelated controller.
- The `prisma-tenant-where` or `tenant-mode-guard` guard fails.
- `NULLS NOT DISTINCT` is rejected by the schema-consistency parser. Report; do not drop the clause.

## Owner steps after merge (not for agents)

1. Railway → runtime-api → Console: `cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`. Expect `20261008000000_variant_lines`.
2. Open a product with several sizes on the storefront, pick a size, add it, check out with cash on delivery. Then open the order in the dashboard: the line should show the product name and size.

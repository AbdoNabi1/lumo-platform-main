# Stock Per Variant (Plan 2B-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ملخص للمالك (بالعربي):** في شوبيفاي **كل مقاس ليه كميته**: لو الـ M خلص والـ L لسه موجود، الزبون يقدر يشتري L بس. عندنا دلوقتي الكمية للمنتج كله، فلو المنتج فيه 10 قطع، **محدش يعرف كام منهم M وكام L**.
>
> الخطة دي بتعمل الجزء اللي في السيرفر:
>
> - **كمية لكل مقاس.** المنتجات اللي ليها مقاس واحد (كل منتجاتك الحالية) بتنتقل كميتها لوحدها للمقاس ده، ومفيش حاجة هتتغيّر في متجرك.
> - **"تتبّع الكمية"**: لو قفلته، المنتج يتباع من غير ما يتعدّ (زي منتج بيتعمل حسب الطلب).
> - **"كمّل البيع لما الكمية تخلص"**: المنتج يفضل يتباع حتى لو الكمية صفر.
> - **قايمة المخازن بأساميها**، عشان الشاشة تبطّل تعرض أرقام طويلة.
> - **المتجر بيعرض "نفدت الكمية" للمقاس اللي خلص بس.**
> - تصليح عرض أسعار العملات اللي ليها 3 أو 0 كسور (الدينار الكويتي والين).
>
> **الشاشة نفسها** (جدول المقاسات فيه السعر والكمية، وزرار حفظ واحد للصفحة كلها) هي الخطة اللي بعدها على طول، **2B-2**.
>
> فيها **migration**. هتطبّقها من Railway زي كل مرة، و**قبل** ما الكود يترفع.

**Goal:** Stock is held per **variant** at a warehouse. The checkout check, the order reservation and the storefront's "in stock" all read the variant's own stock. Each variant also carries Shopify's two inventory switches, "track quantity" and "continue selling when out of stock".

**Architecture:**

- **Inventory:**
  - `InventoryItem` gains a nullable `variantRef`.
  - Its natural key becomes `(tenant, product, variant, warehouse)`, unique with `NULLS NOT DISTINCT`, so legacy product-level rows stay unique.
  - Every stock use case accepts an optional `variantId`.
- **One lookup rule, in the repository** (`findByProductAndWarehouse(…, variantId?)`):
  - **with `variantId`:** the row for that variant. If none exists, the product's single legacy row at that warehouse (variant `NULL`), only when it is the **only** row of that product there.
  - **without `variantId`:** the product's only row at that warehouse. If there are several, none: a product id alone names nothing.

  This is the same rule `Cart.findLine` follows since Plan 2A.

- **The migration backfills** `variant_ref` for every product with exactly one variant. All live products have one, so every live stock row becomes that variant's stock. It runs with `SET row_security = off`, the pattern of migration `20260924010000`.
- **Catalog:** `VariantAttributes` gains `tracksInventory` (default `true`) and `inventoryPolicy` (`"deny"` default, or `"continue"`).
  - A variant is **stock-limited** only when `tracksInventory && inventoryPolicy === "deny"`.
  - When the variant is not stock-limited:
    - checkout does not block;
    - the order reserves what is available and never fails for lack of stock;
    - the storefront never shows "out of stock".
- **Checkout `InventoryValidationAdapter` and `OrdersInventoryAdapter`** read the variant, both its flags from Catalog and its stock with `variantId`.
- **New read routes:** `GET /warehouses` (staff); the public inventory DTO carries `variantId`; the public variant DTO carries `sellableWhenOutOfStock`.
- **Money display:** `formatCurrency` in admin-web and the storefront uses the currency's own exponent, not a fixed `/100`.

**Tech Stack:** TypeScript, vitest, zod, Prisma 6 (hand-written migration), Next.js 15.

**Spec:**

- [PLATFORM-MASTER-PLAN.md](../../plans/PLATFORM-MASTER-PLAN.md): Phase 1 unit 3 (Inventory: quantity per variant, sell when out of stock).
- The owner's Shopify screenshots (the inventory card: track quantity, quantity per location, continue selling).
- The "Medium: stock is still tracked per product, not per variant (Plan 2B)" gap opened by Plan 2A.

## Global Constraints

Same as Plans 1A to 2C-2. Every task implicitly includes these.

### Git and branch

- Branch `morbeh/w0-w17-w12`. No force-push. No `--no-verify`. Never raise the lint warning cap.
- Never stage `.claude/worktrees/`.
- Commit lines at most 100 characters, lowercase subject.
- End every commit with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

### Database

- **No database connection.** Write migrations only. Never set `TENANT_MODE=multi`.
- No guard exemptions: rename instead. No new `TENANT_DEFAULT_ID` reads.

### Backward compatibility (non-negotiable)

- Every stock call that names no variant keeps working exactly as today for a product with one variant. That is every live product.
- Every new input field is optional. Every new column is nullable, or has a default equal to today's behaviour (`tracks_inventory = true`, `inventory_policy = 'deny'`).
- `inventoryAvailable` on the public cart body keeps its snapshot-only meaning. Do not widen it.

### Commands

- Windows: use per-package commands:
  - `pnpm.cmd --filter <pkg> run test`
  - `pnpm.cmd --filter <pkg> run typecheck`
  - `pnpm.cmd --filter <pkg> run lint`
- Never run a full typecheck and a full test suite at the same time.
- No new lint warnings. No `async` without `await`.
- Package filters:

| Directory            | Package filter        |
| -------------------- | --------------------- |
| `services/inventory` | `@platform/inventory` |
| `services/catalog`   | `@platform/catalog`   |
| `apps/admin`         | `@platform/admin`     |
| `apps/storefront`    | `storefront`          |
| `apps/admin-web`     | `admin-web`           |
| `packages/db`        | `@platform/db`        |

Confirm `@platform/inventory` from `services/inventory/package.json` before the first run.

---

## File Structure

### `services/inventory/src/`

- **`domain/inventory-item.ts`:** `variantRef`.
- **`domain/inventory-item-repository.ts`:** `findByProductAndWarehouse(…, variantId?)`; the rule above.
- **`infrastructure/inventory-item.mapper.ts`, `prisma-inventory-item-repository.ts`, `in-memory-inventory-item-repository.ts`:** `variantRef`, and the rule.
- **`application/*.use-case.ts`:** an optional `variantId` on receive, adjust, reserve, release, commit, transfer and check-availability.
- **`application/warehouse.use-cases.ts`, `interfaces/warehouse.controller.ts`, `composition.ts`:** `ListWarehouses`.

### `services/catalog/src/`

- **`domain/variant.ts`:** `tracksInventory`, `inventoryPolicy`, `isStockLimited()`.
- **`application/variant-attributes-input.ts`:** the two inputs.
- **`infrastructure/catalog.mappers.ts`:** the two columns.

### `packages/db/`

- **`prisma/schema/inventory.prisma`:** `variantRef`, and the new unique.
- **`prisma/schema/catalog.prisma`:** `tracksInventory`, `inventoryPolicy`.
- **`prisma/schema/migrations/20261010000000_variant_stock/migration.sql`** (new).
- **`src/schema-migration-consistency.test.ts`:** one block.

### `apps/admin/src/`

- **`http/admin-routes.ts`:**
  - `variantId` on the stock bodies;
  - `GET /warehouses`;
  - the product inventory row DTO gains `variantId`;
  - the staff variant DTO gains the two flags;
  - the variant bodies accept them.
- **`interfaces/inventory.admin-controller.ts`:** `listWarehouses`.
- **`http/public-catalog-routes.ts`:** the public inventory DTO gains `variantId`; the public variant DTO gains `sellableWhenOutOfStock`.
- **`infrastructure/cross-context/inventory-validation.adapter.ts`, `orders-inventory.adapter.ts`:** variant-aware.
- **`composition.ts`:** pass `catalog.products` to both adapters.

### `apps/storefront/src/`

- **`lib/runtime-api.ts`:** `InventoryItemSummary.variantId`, `ProductVariantSummary.sellableWhenOutOfStock`.
- **`lib/catalog.ts`:** `AvailabilityBook` per variant.
- **`app/products/[slug]/page.tsx`, `components/variant-picker.tsx`, `components/product-card.tsx`, `app/cart/actions.ts`, the three listing pages:** the per-variant availability.
- **`lib/format.ts`:** the exponent-aware `formatCurrency`.

### `apps/admin-web/src/`

- **`lib/format.ts`:** the exponent-aware `formatCurrency` (and `formatCurrencyCompact`).
- **`lib/api/products.ts`:** the two flags on the variant DTO and inputs; `variantId` on `ProductInventoryRowDto`.
- **`lib/api/inventory.ts`:** `fetchWarehouses()`, and `variantId` on the receive/adjust inputs.

These are API-client changes only. The screen is Plan 2B-2.

---

### Task 1: Inventory knows the variant

**Files:**

- Modify: `services/inventory/src/domain/inventory-item.ts`
- Modify: `services/inventory/src/domain/inventory-item-repository.ts`
- Modify: `services/inventory/src/infrastructure/in-memory-inventory-item-repository.ts`
- Modify: every stock use case in `services/inventory/src/application/` (receive, adjust, reserve, release, commit, transfer, check-availability)
- Modify: `services/inventory/src/infrastructure/inventory-item.mapper.ts` (in-memory side only; the Prisma side is Task 2)
- Test: `services/inventory/src/application/variant-stock.test.ts` (new)

**Interfaces:**

- **Domain:**
  - `InventoryItem.create(id, product, warehouseId, variantRef: string | null = null)`;
  - `InventoryItem.reconstitute(…, version, variantRef: string | null = null)`, with `variantRef` as the **last** parameter;
  - the getter `variantRef: string | null`.
- **Repository:** `findByProductAndWarehouse(productId, warehouseId, tenantId, tx?, variantId?)`.
- **Use cases:** every stock input above gains `readonly variantId?: string`.

- [ ] **Step 1: Write the failing tests**

`variant-stock.test.ts`, built the way the existing inventory application tests build their use cases (same in-memory repository, unit of work, id generator and clock):

1. `ReceiveStock { productId: "p1", variantId: "v-m", warehouseId: "w1", quantity: 5 }` and `{ …, variantId: "v-l", quantity: 2 }` create **two** items. Then:
   - `CheckAvailability { productId: "p1", variantId: "v-m", warehouseId: "w1" }` returns 5;
   - the same with `v-l` returns 2.
2. `ReserveStock` with `variantId: "v-m"`, quantity 4, reserves on the M item only. The availabilities become M 1 and L 2.
3. **Legacy fallback, single row.** A legacy item (`variantRef: null`, product p2, 7 on hand) is the only row of p2 at w1. Then:
   - `CheckAvailability` with no `variantId` returns 7;
   - with `variantId: "v-only"` it also returns 7, the legacy row read as that variant's stock.
4. **No guessing.** Product p1 has two variant rows. `CheckAvailability { productId: "p1", warehouseId: "w1" }` with **no** `variantId` returns `NOT_FOUND`.
5. **No legacy stand-in.** For p1 (rows for v-m and v-l), `variantId: "v-s"` (no row) returns `NOT_FOUND`. The legacy fallback does not apply when the product has other rows.
6. **Adjust, release, commit and transfer** each act on the variant's item when given `variantId`. One assertion each: the other variant's level is unchanged.
7. **Tenant isolation.** The same product and variant ids under another tenant are never returned. Follow the existing tenant-isolation test style.

- [ ] **Step 2: Run, expect failure.** `pnpm.cmd --filter @platform/inventory run test -- variant-stock`

- [ ] **Step 3: Implement**

**`inventory-item.ts`:** add `readonly variantRef: string | null;` to the props, to `create` (default `null`) and to `reconstitute` (the last parameter, default `null`), plus a getter:

```ts
  /**
   * Plan 2B-1: the Catalog variant this stock belongs to (bare id, never an FK). `null` on a legacy
   * product-level row written before variants were tracked; such a row is read as the stock of a
   * product's only variant (see `InventoryItemRepository.findByProductAndWarehouse`).
   */
  get variantRef(): string | null {
    return this.props.variantRef;
  }
```

Do **not** change the `inventory.adjusted` event payload. Its schema is registered, and per-variant events are out of scope; record that in the report.

**`inventory-item-repository.ts`:** replace the `findByProductAndWarehouse` doc and signature with:

```ts
  /**
   * Plan 2B-1 lookup rule (mirrors `Cart.findLine`, Plan 2A):
   *  - with `variantId`: that variant's row; if it has none, the product's legacy row
   *    (`variantRef` null) at this warehouse — but only when that legacy row is the product's ONLY
   *    row there (a live product's stock written before variants were tracked);
   *  - without `variantId`: the product's only row at this warehouse; with several rows a product
   *    id alone names nothing, so `null`.
   */
  findByProductAndWarehouse(
    productId: string,
    warehouseId: string,
    tenantId: string,
    tx?: unknown,
    variantId?: string,
  ): Promise<InventoryItem | null>;
```

**A shared pure helper**, `domain/resolve-stock-row.ts`, which both repositories call after loading the product's rows at that warehouse:

```ts
import type { InventoryItem } from "./inventory-item";

/** The Plan 2B-1 lookup rule over one product's rows at one warehouse. */
export function resolveStockRow(
  rows: readonly InventoryItem[],
  variantId: string | undefined,
): InventoryItem | null {
  if (variantId !== undefined) {
    const exact = rows.find((row) => row.variantRef === variantId);
    if (exact !== undefined) return exact;
    const [only] = rows;
    return rows.length === 1 && only !== undefined && only.variantRef === null ? only : null;
  }
  const [only] = rows;
  return rows.length === 1 && only !== undefined ? only : null;
}
```

Add a small `resolve-stock-row.test.ts` covering its five branches.

**`in-memory-inventory-item-repository.ts`:** filter the tenant's items by product and warehouse, then call `resolveStockRow`.

**Use cases.** Each one gains `readonly variantId?: string;`, and passes it as the 5th argument to `findByProductAndWarehouse`.

- **`ReceiveStock`:** when nothing is found it creates `InventoryItem.create(id, product, warehouse, input.variantId ?? null)`.
- **`TransferStock`:** the destination item it creates carries the same `variantId`, and the source lookup uses it too.

- [ ] **Step 4: Run.** `pnpm.cmd --filter @platform/inventory run test`, then `… run typecheck`. Expected: PASS. Existing tests pass unchanged; they name no variant, and each has one row per product.

- [ ] **Step 5: Commit**

```bash
git add services/inventory/src
git commit -m "feat(inventory): hold stock per variant, with a legacy product-level fallback"
```

---

### Task 2: Migration (push it alone), then persistence

**Files:**

- Create: `packages/db/prisma/schema/migrations/20261010000000_variant_stock/migration.sql`
- Modify: `packages/db/prisma/schema/inventory.prisma`, `packages/db/prisma/schema/catalog.prisma`
- Modify: `packages/db/src/schema-migration-consistency.test.ts`
- Modify: `services/inventory/src/infrastructure/inventory-item.mapper.ts`, `prisma-inventory-item-repository.ts`

- [ ] **Step 1: Write the failing consistency test**

```ts
describe("inventory.inventory_items and catalog.product_variants — stock per variant (Plan 2B-1)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(join(migrationsDir, entry.name, "migration.sql"), "utf-8"))
    .join("\n");

  it("inventory_items gained variant_ref", () => {
    expect(columnsEverAddedTo("inventory", "inventory_items", allSql).has("variant_ref")).toBe(
      true,
    );
  });

  it("widens the stock key to (tenant, product, variant, warehouse), legacy rows still unique", () => {
    expect(allSql).toContain(
      'DROP INDEX IF EXISTS "inventory"."inventory_items_tenant_id_product_ref_warehouse_id_key";',
    );
    expect(allSql).toMatch(
      /inventory_items_tenant_id_product_ref_variant_ref_warehouse_id_key[\s\S]*NULLS NOT DISTINCT/,
    );
  });

  it("product_variants gained the two inventory switches", () => {
    const actual = columnsEverAddedTo("catalog", "product_variants", allSql);
    expect(actual.has("tracks_inventory")).toBe(true);
    expect(actual.has("inventory_policy")).toBe(true);
  });
});
```

Run: `pnpm.cmd --filter @platform/db run test -- schema-migration`. Expected: FAIL.

- [ ] **Step 2: Write the migration**

```sql
-- Plan 2B-1 — stock per variant. Written by hand, NOT applied by the agent; the owner deploys it from
-- Railway's Console (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`) BEFORE the
-- release whose Prisma schema reads these columns.
--
-- ROW LEVEL SECURITY: `inventory_items` has FORCE RLS keyed on `app.tenant_id`, which no migration
-- session sets — under a role without BYPASSRLS the backfill UPDATE would silently match nothing.
-- `row_security = off` turns that into an ERROR instead (same as 20260924010000).
SET row_security = off;

-- (1) The variant a stock row belongs to. NULL = a legacy product-level row.
ALTER TABLE "inventory"."inventory_items" ADD COLUMN "variant_ref" TEXT;

-- (2) Backfill: a product with exactly ONE variant — its stock is that variant's stock. Every live
-- product has one variant, so every live row is assigned. Products with several variants keep their
-- legacy row NULL (the application reads it only while it is that product's only row).
UPDATE "inventory"."inventory_items" AS i
SET "variant_ref" = v.only_variant
FROM (
  SELECT "tenant_id", "product_id"::text AS product_ref, MIN("id"::text) AS only_variant
  FROM "catalog"."product_variants"
  GROUP BY "tenant_id", "product_id"
  HAVING COUNT(*) = 1
) AS v
WHERE i."tenant_id" = v."tenant_id"
  AND i."product_ref" = v.product_ref
  AND i."variant_ref" IS NULL;

-- (3) The natural key widens from (tenant, product, warehouse) to (tenant, product, variant,
-- warehouse); NULLS NOT DISTINCT keeps one legacy row per product and warehouse, as before.
DROP INDEX IF EXISTS "inventory"."inventory_items_tenant_id_product_ref_warehouse_id_key";
CREATE UNIQUE INDEX "inventory_items_tenant_id_product_ref_variant_ref_warehouse_id_key"
  ON "inventory"."inventory_items" ("tenant_id", "product_ref", "variant_ref", "warehouse_id")
  NULLS NOT DISTINCT;

-- (4) Shopify's two inventory switches on the variant; defaults equal today's behaviour.
ALTER TABLE "catalog"."product_variants"
  ADD COLUMN "tracks_inventory" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "inventory_policy" TEXT    NOT NULL DEFAULT 'deny';

RESET row_security;
```

Check the existing unique index name in the migration that created `inventory_items`, and use that exact name in the `DROP INDEX`. Prisma names it `inventory_items_tenant_id_product_ref_warehouse_id_key`; if the actual name differs, use the actual one in both the SQL and the test.

Run the consistency test. Expected: PASS.

- [ ] **Step 3: Commit and push the migration ALONE, then tell the owner**

The SQL on its own is harmless: no code reads it. Push it first, so it can be applied **before** the code that reads the new columns goes live. Task 1 (domain and application code only, no persisted shape) is safe to push with it.

```bash
git add packages/db/prisma/schema/migrations/20261010000000_variant_stock/migration.sql packages/db/src/schema-migration-consistency.test.ts
git commit -m "feat(db): add the variant stock migration (applied before the code that reads it)"
git push origin morbeh/w0-w17-w12
```

Then print this for the owner, in Arabic, and **continue** (do not wait):

> طبّق الـ migration دلوقتي من Railway → runtime-api → Console:
> `cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`
> المفروض تشوف `20261010000000_variant_stock` اتطبّقت. ابعتلي الناتج.

- [ ] **Step 4: Prisma schema and persistence**

**`inventory.prisma`.** Add a field to `InventoryItem`:

```prisma
  variantRef  String?  @map("variant_ref") // Plan 2B-1 — bare id into Catalog; NULL = legacy product-level row
```

Then replace `@@unique([tenantId, productRef, warehouseId])` with `@@unique([tenantId, productRef, variantRef, warehouseId])`. Add a comment that the migration declares it `NULLS NOT DISTINCT`, as Plan 2A did for cart lines.

**`catalog.prisma`.** Add to `ProductVariant`:

```prisma
  tracksInventory  Boolean @default(true) @map("tracks_inventory")   // Plan 2B-1
  inventoryPolicy  String  @default("deny") @map("inventory_policy") // deny | continue (domain-enforced)
```

Run the package's Prisma generate script, as earlier plans did. If `prisma format` reformats unrelated schema files, restore them, as in Plan 2C-1.

**`inventory-item.mapper.ts`:**

- `InventoryItemRow.variantRef: string | null`;
- `toDomain` passes `row.variantRef ?? null` as the last `reconstitute` argument;
- `toItemRow` writes `variantRef: item.variantRef`.

**`prisma-inventory-item-repository.ts`.** `findByProductAndWarehouse` loads **all** rows for `{ tenantId, productRef: productId, warehouseId }` with `findMany` (`include: { reservations: true }`), maps them, and returns `resolveStockRow(items, variantId)`. Keep the tenant scoping it has today (`this.scoped(…)`).

The `prisma-tenant-where.guard` must stay green: the `where` keeps `tenantId`.

- [ ] **Step 5: Run.** `pnpm.cmd --filter @platform/inventory run test`, `pnpm.cmd --filter @platform/db run test`, `pnpm.cmd --filter @platform/inventory run typecheck`. Expected: PASS.

- [ ] **Step 6: Commit** (do **not** push; Task 8 waits for the owner)

```bash
git add packages/db/prisma services/inventory/src
git commit -m "feat(db): persist the stock variant and the two inventory switches"
```

---

### Task 3: Catalog — track quantity and continue selling

**Files:**

- Modify: `services/catalog/src/domain/variant.ts`
- Modify: `services/catalog/src/application/variant-attributes-input.ts`
- Modify: `services/catalog/src/infrastructure/catalog.mappers.ts`
- Test: extend `services/catalog/src/domain/variant-attributes.test.ts` and `services/catalog/src/infrastructure/catalog.mappers.test.ts`

**Interfaces:**

- `VariantAttributes.tracksInventory: boolean` (default `true`).
- `VariantAttributes.inventoryPolicy: InventoryPolicy`, where `type InventoryPolicy = "deny" | "continue"` (default `"deny"`).
- `Variant.isStockLimited(): boolean`, true only when `tracksInventory && inventoryPolicy === "deny"`.
- `VariantAttributesInput.tracksInventory?: boolean`, `.inventoryPolicy?: InventoryPolicy`.
- Row fields `tracksInventory`, `inventoryPolicy`.

- [ ] **Step 1: Write the failing tests**

1. A new variant defaults to `tracksInventory: true`, `inventoryPolicy: "deny"` and `isStockLimited() === true`.
2. `tracksInventory: false` makes `isStockLimited()` false, and so does `inventoryPolicy: "continue"`.
3. `assertValidAttributes` rejects `inventoryPolicy: "sometimes"`. Cast through `as never` in the test, and expect a `ValidationError` on field `inventoryPolicy`.
4. **Mapper round trip.** Both fields survive. A row without them (`undefined`) maps to the defaults.
5. **`toVariantAttributes`.** Omitting both keeps the base. Setting `tracksInventory: false` changes only that.

- [ ] **Step 2: Run, expect failure.** `pnpm.cmd --filter @platform/catalog run test -- variant-attributes catalog.mappers`

- [ ] **Step 3: Implement**

**`variant.ts`:**

1. `export type InventoryPolicy = "deny" | "continue";`.
2. Add both fields to `VariantAttributes` and to `DEFAULT_VARIANT_ATTRIBUTES`:

```ts
  /** Shopify "Track quantity". Off: sold without counting stock (made to order, digital, services). */
  readonly tracksInventory: boolean;
  /** Shopify "Continue selling when out of stock": `continue` sells past zero; `deny` stops at zero. */
  readonly inventoryPolicy: InventoryPolicy;
```

3. Add a check to `assertValidAttributes`:

```ts
if (attributes.inventoryPolicy !== "deny" && attributes.inventoryPolicy !== "continue") {
  issues.push({ field: "inventoryPolicy", message: 'must be "deny" or "continue"' });
}
```

4. Add to `Variant`:

```ts
  /** Plan 2B-1: only a tracked variant that stops at zero is limited by its stock. */
  isStockLimited(): boolean {
    return this.props.attributes.tracksInventory && this.props.attributes.inventoryPolicy === "deny";
  }
```

**`variant-attributes-input.ts`:**

- `readonly tracksInventory?: boolean; readonly inventoryPolicy?: InventoryPolicy;`;
- in `toVariantAttributes`: `tracksInventory: input.tracksInventory ?? base.tracksInventory, inventoryPolicy: input.inventoryPolicy ?? base.inventoryPolicy`.

**`catalog.mappers.ts`:**

- `VariantRow` gains `readonly tracksInventory: boolean; readonly inventoryPolicy: string;`;
- `toDomain` passes `tracksInventory: v.tracksInventory ?? true` and `inventoryPolicy: (v.inventoryPolicy ?? "deny") as InventoryPolicy`. `assertValidAttributes` catches a corrupt value;
- `toVariantRows` writes both from `v.attributes`.

Export `InventoryPolicy` from the package `index.ts` if `VariantAttributes` is exported there.

- [ ] **Step 4: Run.** `pnpm.cmd --filter @platform/catalog run test`, then `… run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/catalog/src
git commit -m "feat(catalog): add track quantity and continue selling to variants"
```

---

### Task 4: Warehouses list and staff routes

**Files:**

- Modify: `services/inventory/src/application/warehouse.use-cases.ts`
- Modify: `services/inventory/src/interfaces/warehouse.controller.ts`
- Modify: `services/inventory/src/composition.ts`
- Modify: `apps/admin/src/interfaces/inventory.admin-controller.ts`
- Modify: `apps/admin/src/http/admin-routes.ts`
- Test: `apps/admin/src/http/variant-stock-routes.test.ts` (new). Follow `product-details-routes.test.ts` (Plan 2C-1) for how staff routes are driven.

**Interfaces:**

- **`ListWarehouses`**:
  - input `{ tenantId; first?; after? }`;
  - output `Paginated<WarehouseOutput>`, the existing `WarehouseOutput` shape `{ warehouseId, code, name, status }`.
- **`WarehouseController.list(input)`** and **`InventoryAdminController.listWarehouses(principal, input)`**, with permission `"inventory:read"`.
- **`GET /api/v1/warehouses`**:
  - query `{ first?, after? }`;
  - body `{ items: [{ id, code, name, status }], pageInfo }`.
- **Stock bodies** (`receive`, `adjust`, `reserve`, `release`, `commit`, `transfer`) gain `variantId: z.string().min(1).optional()`.
- **`ProductInventoryRowDto`** gains `variantId: string | null`.
- **The staff variant DTO** gains `tracksInventory: boolean` and `inventoryPolicy: "deny" | "continue"`. The variant bodies (create item, add, update) accept `tracksInventory: z.boolean().optional()` and `inventoryPolicy: z.enum(["deny", "continue"]).optional()`.

- [ ] **Step 1: Write the failing tests**

1. `GET /warehouses` lists registered warehouses with `id`, `code`, `name` and `status`. Another tenant's warehouse is absent.
2. `POST /inventory/receive` with `variantId` on two variants, then `GET /products/:id/inventory`, returns two rows, each with its `variantId`.
3. `POST /products/:id/variants/:variantId` (the update route) with `{ sku, priceAmountMinor, currency, tracksInventory: false }` stores it, and the detail DTO shows `tracksInventory: false` with `inventoryPolicy: "deny"`.
4. `inventoryPolicy: "sometimes"` → 422.

- [ ] **Step 2: Run, expect failure.** `pnpm.cmd --filter @platform/admin run test -- variant-stock-routes`

- [ ] **Step 3: Implement**

**`ListWarehouses`:** reads `deps.warehouses.list({ first: input.first ?? 50, after: input.after }, input.tenantId)`, and maps each warehouse to `WarehouseOutput` exactly as `RegisterWarehouse` builds it. Wire it in `composition.ts` next to `RegisterWarehouse`.

**`WarehouseController.list`:** `present(await this.deps.listWarehouses.execute(input), 200)`.

**`inventory.admin-controller.ts`:** `listWarehouses`, a copy of `registerWarehouse`'s guard shape, using `"inventory:read"`.

**`admin-routes.ts`.** Add the route next to `POST /warehouses`:

```ts
    defineRoute({
      method: "GET",
      path: "/warehouses",
      version: 1,
      permission: "inventory:read",
      summary: "List warehouses (stock locations)",
      schema: { querystring: listWarehousesQuery },
      handle: async ({ query, context }): Promise<AdminResponse> => {
        const response = await admin.inventory.listWarehouses(context.principal, {
          ...query,
          tenantId: context.tenantId,
        });
        if (response.status !== 200) return response;
        const page = response.body as Paginated<WarehouseOutput>;
        return {
          status: 200,
          body: {
            items: page.items.map((w) => ({ id: w.warehouseId, code: w.code, name: w.name, status: w.status })),
            pageInfo: page.pageInfo,
          },
        };
      },
    }),
```

with `const listWarehousesQuery = z.object({ first: z.coerce.number().int().min(1).max(100).optional(), after: z.string().min(1).optional() });`.

Import `WarehouseOutput` from `@platform/inventory` if it is exported. If it is not, export it from the package `index.ts`.

**The rest of `admin-routes.ts`:**

- add `variantId` to the six stock bodies;
- `toProductInventoryRowDto` adds `variantId: item.variantRef`;
- the staff variant DTO and the variant zod bodies add the two flags, mapped from `variant.attributes`.

If a route-inventory or OpenAPI snapshot test fails because of the new route, update it. Do not weaken it.

- [ ] **Step 4: Run.** `pnpm.cmd --filter @platform/inventory run test`, `pnpm.cmd --filter @platform/admin run test`, then both typechecks. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/inventory/src apps/admin/src
git commit -m "feat(admin): list warehouses, accept the variant on stock routes and the inventory switches"
```

---

### Task 5: Checkout and orders read the variant's stock

**Files:**

- Modify: `apps/admin/src/infrastructure/cross-context/inventory-validation.adapter.ts` (+ its test)
- Modify: `apps/admin/src/infrastructure/cross-context/orders-inventory.adapter.ts` (+ its test)
- Modify: `apps/admin/src/composition.ts`
- Create: `apps/admin/src/infrastructure/cross-context/variant-of.ts` (+ test)

**Interfaces:**

- **`variantOf(product: Product, variantRef: string | undefined | null): Variant | undefined`.** It returns the named variant. When none is named, it returns the product's only variant, or `undefined` when there are several. This is the same rule as `resolveMerchandise` and `CatalogPricingValidationAdapter`. Refactor those two to call it.
- **The two adapter constructors** gain a first parameter `products: Pick<ProductController, "get">`.

- [ ] **Step 1: Write the failing tests**

**`InventoryValidationAdapter`:**

1. A stock-limited variant with 3 available and quantity 2 is valid; with quantity 4 it is invalid. The reason names the product.
2. A variant with `tracksInventory: false` and **no stock row at all** is valid.
3. A variant with `inventoryPolicy: "continue"`, 0 available and quantity 5 is valid.
4. Two variants of one product: the item for M checks **M's** stock, not L's. Assert that `checkAvailability` was called with `variantId: "v-m"`.
5. A legacy item with no `variantRef`, on a single-variant product, is checked with that variant's id.
6. The product lookup failing (non-200) is invalid. Never assume stock.

**`OrdersInventoryAdapter`:**

1. A tracked "deny" line reserves its full quantity with `variantId`.
2. An untracked line is **not** reserved.
3. A "continue" line with 2 available and quantity 5 reserves **2**. With 0 available it reserves nothing, and nothing throws.
4. The idempotency check (an existing reservation for this order) still skips. It must look up the item **for that variant**.
5. An order line without `variantRef`, on a single-variant product, reserves against that variant.

- [ ] **Step 2: Run, expect failure.** `pnpm.cmd --filter @platform/admin run test -- inventory-validation orders-inventory variant-of`

- [ ] **Step 3: Implement**

**`variant-of.ts`:**

```ts
import type { Product } from "@platform/catalog";

/**
 * The variant an order/checkout line means (Plan 2A rule): the named one; with none named, the
 * product's only variant; with several and none named, nothing — never a guess.
 */
export function variantOf(product: Product, variantRef: string | undefined | null) {
  if (variantRef !== undefined && variantRef !== null) {
    return product.variants.find((v) => v.id.toString() === variantRef);
  }
  return product.variants.length === 1 ? product.variants[0] : undefined;
}
```

**`InventoryValidationAdapter.validate`.** Per item, before the stock check:

```ts
const productResponse = await this.products.get({ productId: item.productRef, tenantId });
if (productResponse.status !== 200) {
  return { valid: false, reason: `product "${item.productRef}" not found` };
}
const variant = variantOf(productResponse.body as Product, item.variantRef);
if (variant === undefined) {
  return { valid: false, reason: `no matching variant for product "${item.productRef}"` };
}
if (!variant.isStockLimited()) continue;
const response = await this.inventory.checkAvailability({
  tenantId,
  productId: item.productRef,
  variantId: variant.id.toString(),
  warehouseId,
});
```

The rest is unchanged. Keep the single-warehouse resolution as it is. If every item is unlimited, the warehouse lookup may still run first; that is fine.

**`OrdersInventoryAdapter.requestReservation`:**

- Widen `OrderLinesBody`'s snapshot to `{ productId: string; variantRef?: string | null }`. Confirm against how `admin-routes.ts` reads `item.snapshot.variantRef`.
- Per line:
  1. get the product and `variantOf(…)`;
  2. throw, with the same message style, if the product or variant cannot be resolved;
  3. if `!variant.attributes.tracksInventory`, skip the line;
  4. find the item with `findByProductAndWarehouse(productId, warehouseId, tenantId, undefined, variantId)`;
  5. run the existing idempotency check on **that** item;
  6. pick the quantity: when the policy is `"continue"`, `quantity = Math.min(line.quantity, inventoryItem?.stockLevel.available ?? 0)`, skipping the line when it is `0`; otherwise `line.quantity`;
  7. `this.inventory.reserve({ tenantId, productId, variantId, warehouseId, quantity, reference: orderId })`.
- Add to the class doc: "A `continue` line reserves only what is in stock; the oversold remainder is not tracked as negative stock (gap opened in Task 8)."

**`composition.ts`:** pass `catalog.products` as the new first argument to both constructors. `catalog` is wired before both.

Refactor `resolveMerchandise` (`apps/admin/src/http/merchandise-resolution.ts`) and `CatalogPricingValidationAdapter` to use `variantOf`, with no behaviour change. Their tests stay green.

- [ ] **Step 4: Run.** `pnpm.cmd --filter @platform/admin run test`, then `… run typecheck`. Expected: PASS. Every Plan 2A and 2C-1 security assertion is unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src
git commit -m "feat(admin): check and reserve the variant's own stock, honour the inventory switches"
```

---

### Task 6: Public surface and storefront availability per variant, money display

**Files:**

- Modify: `apps/admin/src/http/public-catalog-routes.ts` (+ its test)
- Modify: `apps/storefront/src/lib/runtime-api.ts`
- Modify: `apps/storefront/src/lib/catalog.ts`, `apps/storefront/src/lib/catalog.test.ts`
- Modify: `apps/storefront/src/app/products/[slug]/page.tsx`
- Modify: `apps/storefront/src/components/variant-picker.tsx`, `components/product-card.tsx`
- Modify: `apps/storefront/src/app/page.tsx`, `app/collections/[slug]/page.tsx`, `app/search/page.tsx`
- Modify: `apps/storefront/src/app/cart/actions.ts`
- Modify: `apps/storefront/src/lib/format.ts` (+ test), `apps/admin-web/src/lib/format.ts` (+ test)

**Interfaces:**

- `PublicInventoryDto.variantId: string | null`.
- `PublicVariantDto.sellableWhenOutOfStock: boolean`, equal to `!variant.isStockLimited()`.
- `AvailabilityBook.resolve(productId, variantId?)` and `AvailabilityBook.resolveProduct(product)`.
- `formatCurrency(locale, amountMinor, currency)` uses the currency's exponent.

- [ ] **Step 1: Write the failing tests**

**`public-catalog-routes.test.ts`:**

1. `GET /public/inventory` rows carry `variantId`.
2. The public variant DTO carries `sellableWhenOutOfStock`: true for an untracked or "continue" variant, false by default. Its keys still exclude `cost`, `barcode`, `weightGrams` and `tracksInventory`. Expose only the derived flag.

**`lib/catalog.test.ts`:**

1. **Per variant:** `AvailabilityBook.resolve("p1", "v-m")` sums only rows with `variantId === "v-m"`.
2. **Legacy, single row:** a `variantId: null` row is that variant's stock **only** when it is the product's only row, with the same rule as the backend.
3. **Product total:** `resolveProduct(product)`:
   - is `{ status: "ok", available: Infinity }` when any variant has `sellableWhenOutOfStock`;
   - otherwise it is the sum over the product's variants;
   - with no rows at all, it is `unknown`.

**`format.test.ts`** (both apps):

- `formatCurrency("en", 15050, "EGP")` contains `150.50`;
- `(…, 12345, "KWD")` contains `12.345`;
- `(…, 500, "JPY")` contains `500` and no decimal point.

**`variant-picker` test:**

- with M out of stock and L in stock, choosing M disables "Add to cart" and shows `outOfStock`, and choosing L enables it;
- a `sellableWhenOutOfStock` variant with 0 stock stays enabled.

- [ ] **Step 2: Run, expect failure.**

1. `pnpm.cmd --filter @platform/admin run test -- public-catalog-routes`
2. `pnpm.cmd --filter storefront run test`
3. `pnpm.cmd --filter admin-web run test -- format`

- [ ] **Step 3: Implement**

**Public routes:**

- `toInventoryDto` adds `variantId: item.variantRef`;
- `toProductDto`'s variants add `sellableWhenOutOfStock: !variant.isStockLimited()`.

**Storefront `runtime-api.ts`:**

- `InventoryItemSummary.variantId: string | null`;
- `ProductVariantSummary.sellableWhenOutOfStock: boolean`.

**`AvailabilityBook`.** Keep the rows grouped by product, then:

```ts
  /** Plan 2B-1: one variant's availability (same legacy rule as the backend's resolveStockRow). */
  resolve(productId: string, variantId?: string): AvailabilityResolution {
    const rows = this.byProduct.get(productId) ?? [];
    if (rows.length === 0) return { status: "unknown" };
    if (variantId === undefined) {
      return { status: "ok", available: rows.reduce((sum, r) => sum + r.available, 0) };
    }
    const exact = rows.filter((r) => r.variantId === variantId);
    if (exact.length > 0) return { status: "ok", available: exact.reduce((s, r) => s + r.available, 0) };
    const legacy = rows.every((r) => r.variantId === null);
    return legacy ? { status: "ok", available: rows.reduce((s, r) => s + r.available, 0) } : { status: "ok", available: 0 };
  }

  /** The product as a whole: unlimited if any variant sells past zero; else the sum of its variants. */
  resolveProduct(product: Pick<ProductSummary, "id" | "variants">): AvailabilityResolution {
    if (product.variants.some((v) => v.sellableWhenOutOfStock)) {
      return { status: "ok", available: Number.POSITIVE_INFINITY };
    }
    return this.resolve(product.id);
  }
```

Rows are summed across warehouses, as today. The legacy rule here is per product, not per warehouse, because the storefront sums across warehouses. Document that.

**`AvailabilityBadge`:** when `available === Infinity`, render the plain "in stock" badge with no count. Add `t.product.inStockNoCount`: en `"In stock"`, ar `"متوفر"`.

**Pages:**

- the listing pages and `ProductCard` use `availabilityBook?.resolveProduct(product)`;
- the product page passes the whole `availabilityBook` resolution **per variant** to `VariantPicker`, as a prop `availabilityByVariant: Record<string, number | "unlimited">`, built server-side from `resolve(product.id, v.id)` and `v.sellableWhenOutOfStock`;
- `VariantPicker` disables "Add to cart" only when the chosen variant is `0`. `"unlimited"` is never disabled.

**`cart/actions.ts` `addToCart`.** The `inventoryAvailable` snapshot sent to the API becomes the **variant's** availability (`resolve(productId, variantId)`). It stays undefined when the variant sells when out of stock. The snapshot-only meaning is unchanged.

**`formatCurrency` (both apps):**

```ts
export function formatCurrency(locale: Locale, amountMinor: number, currency: string): string {
  const digits = currencyExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountMinor / 10 ** digits);
}
```

- admin-web imports `currencyExponent` from `@/lib/products/money`;
- the storefront gets its own copy in `lib/money.ts`, the same three-line function. Apps do not import each other;
- fix `formatCurrencyCompact` in admin-web the same way.

- [ ] **Step 4: Run, sequentially**

1. `pnpm.cmd --filter @platform/admin run test`
2. `pnpm.cmd --filter storefront run test`
3. `pnpm.cmd --filter storefront run typecheck`
4. `pnpm.cmd --filter admin-web run test`
5. `pnpm.cmd --filter admin-web run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src apps/storefront/src apps/admin-web/src/lib/format.ts apps/admin-web/src/lib/format.test.ts
git commit -m "feat(storefront): show stock per variant, respect continue-selling, format every currency"
```

---

### Task 7: admin-web API client (types only; the screen is Plan 2B-2)

**Files:**

- Modify: `apps/admin-web/src/lib/api/products.ts` (+ test)
- Modify: `apps/admin-web/src/lib/api/inventory.ts` (+ test)

**Interfaces:**

- **`ProductVariantDto` gains** `tracksInventory: boolean` and `inventoryPolicy: "deny" | "continue"`; the variant inputs accept both, optionally.
- **`ProductInventoryRowDto` gains** `variantId: string | null`.
- **`WarehouseDto`** `{ id, code, name, status }`, and `fetchWarehouses(): Promise<{ outcome: "ok"; items: readonly WarehouseDto[] } | { outcome: "unauthorized" } | { outcome: "error"; message: string }>`, which reads `GET /api/v1/warehouses?first=100`.
- **`receiveStock` / `adjustStock` inputs** gain `variantId?: string`.

- [ ] **Step 1: Write failing tests** in the existing `products.test.ts` / `inventory.test.ts` style:
  - `fetchWarehouses` parses a page;
  - `receiveStock` sends `variantId` when given;
  - the variant update sends `tracksInventory: false`.
- [ ] **Step 2: Run, expect failure.** `pnpm.cmd --filter admin-web run test -- lib/api`
- [ ] **Step 3: Implement.** Follow the existing fetch helpers in those files exactly (auth, error mapping).
- [ ] **Step 4: Run.** `… run test -- lib/api` and `… run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/lib/api
git commit -m "feat(admin-web): carry variant stock, inventory switches and warehouses in the api client"
```

---

### Task 8: Docs, gaps, gates, then STOP before pushing

- [ ] **Step 1: Gaps** (`docs/KNOWN_GAPS.md` and `docs/architecture/23-platform-gap-register.md`)

**Close:** the Plan 2A gap "stock is tracked per product, not per variant", closed by Plan 2B-1.

**Open:**

- **Low:** "Continue-selling oversells are not tracked as negative stock; an order reserves only what is in stock."
- **Low:** "`inventory.adjusted` events carry no variant id."
- **Medium (Plan 2B-2):** "The product screen does not yet edit stock per variant, the inventory switches, or show warehouse names."

- [ ] **Step 2: Gates, sequentially**

1. Package suites: `@platform/inventory`, `@platform/catalog`, `@platform/admin`, `storefront`, `admin-web` and `@platform/db`, each with `pnpm.cmd --filter <pkg> run test`.
2. `pnpm.cmd -r --no-bail run typecheck`
3. `pnpm.cmd -r --no-bail run lint`
4. `pnpm.cmd arch`

Expected: all exit 0, with no new warnings. `tenant-mode-guard` and `prisma-tenant-where.guard` pass.

- [ ] **Step 3: Commit, then STOP**

```bash
git add docs/KNOWN_GAPS.md docs/architecture/23-platform-gap-register.md docs/superpowers/plans/2026-10-09-variant-stock.md
git commit -m "docs(inventory): record plan 2b-1, close the per-variant stock gap"
```

Give the owner the Arabic report. Ask them, in Arabic, to confirm that `20261010000000_variant_stock` was applied. **Push only after they confirm:**

```bash
git push origin morbeh/w0-w17-w12
```

If the owner reports a migration error, do not push; report the error text.

---

## Done criteria

- A product with sizes holds a quantity per size. Buying M lowers M's stock only.
- All live products (one variant each) keep their stock and sell exactly as before. The migration moved each product's stock to its only variant.
- An untracked variant sells without stock. A "continue selling" variant sells past zero. Both never show "out of stock".
- The storefront shows out of stock for the chosen size only.
- `GET /warehouses` lists locations with their names.
- KWD and JPY prices display correctly in both apps.

## Report back

In Arabic for the owner:

- the task → commit → tests table;
- every rewritten test (old → new);
- anything decided that the plan did not say;
- the migration reminder.

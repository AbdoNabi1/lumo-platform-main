# Shopify Variants and Inventory Screen (Plan 2B-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ملخص للمالك (بالعربي):** المالك قال إن صفحة المنتج "مش مفهومة زي شوبيفاي". الخطة دي بتصلّح أكتر حاجات بتلخبط:
>
> | قبل                                                           | بعد (زي شوبيفاي)                                                                          |
> | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
> | 4 زراير حفظ في نفس الصفحة                                     | **زرار حفظ واحد** للصفحة كلها، المقاسات والكميات معاها                                    |
> | القيم بتتكتب في خانة واحدة بفواصل `S, M, L`                   | كل قيمة في خانة لوحدها، والخانة اللي بعدها بتطلع لوحدها، وبعدين "تم"                      |
> | الجدول بيظهر بعد الحفظ بس، والسعر لازم تفتح نافذة عشان تغيّره | **الجدول بيتحدّث وانت بتكتب**، وفيه **السعر والكمية** تكتبهم مباشرة                       |
> | المخزون بيعرض رقم طويل، وفيه زرار "استلام بضاعة"              | كارت "المخزون": **تتبّع الكمية**، والكمية جنب اسم المخزن، و**كمّل البيع لما الكمية تخلص** |
>
> مفيش migration، والتعديل في لوحة التحكم بس.

**Goal:** Make the product page's variants and inventory work like Shopify:

- one Save for everything;
- option values typed one per field;
- a live variants table with editable price and available quantity;
- an Inventory card with "Track quantity", a quantity next to the location's name, and "Continue selling when out of stock".

**Architecture:**

- **Options and the variants table join the page form** (`form="product-editor"`). The separate "Save options" form and the stock card with warehouse ids are removed.
- **The table is derived live.** `planOptionChange` (Plan 2C-2) gains a `rows` output: one row per resulting variant, in combination order, each carrying the existing variant id it keeps, or `null` for a new one.
  - The client renders rows from it as the merchant types.
  - The server recomputes the same rows from the submitted options and the product it re-reads, so row `r` means the same variant on both sides.
  - A hidden `row-<r>-key` lets the server refuse a stale page, rather than writing a price to the wrong size.
- **Stock edits** go through a pure helper, `stockChange`. The merchant edits **available**, as in Shopify. The helper turns that into `receive` (no stock row yet) or `adjust` (`onHand = available + reserved`), always with `variantId`.
- **The only location:**
  - when none exists, the first save registers one called "Shop location" / "المتجر";
  - when several exist, quantities are read-only and say so (checkout supports one location today).
- **`saveProductAction` order:** details → options (plan operations) → the single variant's fields, or per-row prices → stock → SEO → brand → categories → status.
- **Removing variants** asks for confirmation on Save (`window.confirm`), not while typing.
- **The variant dialog** stays for the rarely used fields (compare-at, cost, SKU, barcode, weight, physical product, taxable), plus the two inventory switches.

**Tech Stack:** Next.js 15, React 19 (`useActionState`), `@platform/ui`, vitest + Testing Library.

**Spec:**

- Owner's feedback, 2026-10-08: "مش مفهومة زي شوبيفاي ومش فيها كل الفيتشرز".
- Owner's Shopify screenshots: the variants card and the inventory card.
- [2026-10-09-variant-stock.md](2026-10-09-variant-stock.md): the API this screen uses.
- Gap "Medium (Plan 2B-2)" opened by Plan 2B-1.

## Global Constraints

Same as Plans 1A to 2B-1. Every task implicitly includes these.

### Git and branch

- Branch `morbeh/w0-w17-w12`. No force-push. No `--no-verify`. Never raise the lint warning cap.
- Never stage `.claude/worktrees/`.
- Commit lines at most 100 characters, lowercase subject.
- End every commit with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

### Scope

- **`apps/admin-web` only.** No backend, no migration, no Railway. If a step needs a backend change, **stop and report**.

### App rules

- Runtime API calls happen only from server components and server actions.
- One `newIdempotencyKey()` per API call.
- `toFormState` for every non-`ok` outcome.
- Every new key goes in both `messages/en.ts` and `messages/ar.ts`.
- Logical RTL classes only.

### Commands

- `pnpm.cmd --filter admin-web run test|typecheck|lint`. Never run a full typecheck and a full test suite at the same time.
- No new lint warnings.

---

## File Structure

All paths are under `apps/admin-web/src/`.

### Pure helpers (`lib/products/`)

- **`variant-matrix.ts`:** `OptionPlan` gains `rows: readonly MatrixRow[]`.
- **`stock.ts`** (new): `stockChange`, `StockLevelDto`, `stockByVariant`.

### Server actions

- **`app/products/actions.ts`:**
  - `saveProductAction` handles options, rows and stock;
  - `saveProductOptionsAction` is removed;
  - `updateVariantDetailsAction` accepts the two inventory switches.

### Editor UI (`components/products/editor/`)

- **`options-editor.tsx`** (new): the Shopify option editor (one input per value, Done, suggestions).
- **`variants-card.tsx`:** rewritten to hold the options editor, the live table (price and available inputs, joined to the page form) and the existing dialog.
- **`inventory-card.tsx`** (new): replaces `inventory-identifiers-card.tsx`, which is deleted.
- **`product-editor.tsx`:** the variants card renders inside the editor; the confirmation before Save; the `stock` prop.

### Pages and components

- **`app/products/[productId]/page.tsx`:** builds `stock` (warehouses + product inventory) and drops the `stock` slot.
- **`components/products/product-inventory-card.tsx`, `product-inventory-table.tsx`:** deleted if nothing else imports them. The `/inventory` screen keeps its own components; grep first.
- **`messages/en.ts`, `messages/ar.ts`:** the new keys.

---

### Task 1: Pure helpers (rows from the planner, stock change)

**Files:**

- Modify: `lib/products/variant-matrix.ts`, `lib/products/variant-matrix.test.ts`
- Create: `lib/products/stock.ts`, `lib/products/stock.test.ts`

**Interfaces:**

- **`MatrixRow`** `{ readonly selection: Readonly<Record<string, string>> | null; readonly variantId: string | null }`.
- **`OptionPlan`** `ok` branch: `rows: readonly MatrixRow[]`.
  - With options: one row per combination, in `combinations()` order.
  - Without options: exactly one row, `{ selection: null, variantId: <kept variant id> }`.
- **`rowKey(selection)`**: a stable string for a row; `"default"` when `selection` is `null`.
- **`StockLevelDto`** `{ onHand: number; reserved: number; available: number }`.
- **`stockChange(desiredAvailable: number, current: StockLevelDto | null)`**: returns `{ kind: "none" } | { kind: "receive"; quantity: number } | { kind: "adjust"; onHand: number } | { kind: "invalid" }`.
- **`stockByVariant(rows, variants)`**: returns `Record<string, StockLevelDto>`. It applies the Plan 2B-1 legacy rule: a `variantId: null` row counts for the product's only variant, and only when it is that product's only row.

- [ ] **Step 1: Write the failing tests**

Add to `variant-matrix.test.ts`:

```ts
it("returns one row per resulting variant, existing ids kept, new ones null", () => {
  const plan = planOptionChange({
    productSku: "P-1",
    variants: [v("a", null)],
    nextOptions: [{ name: "Size", values: ["S", "M"] }],
  });
  if (!plan.ok) throw new Error(plan.reason);
  expect(plan.rows).toEqual([
    { selection: { Size: "S" }, variantId: "a" },
    { selection: { Size: "M" }, variantId: null },
  ]);
});

it("returns the kept variant as the single row when there are no options", () => {
  const plan = planOptionChange({
    productSku: "P-1",
    variants: [v("s", { Size: "S" }), v("l", { Size: "L" })],
    nextOptions: [],
  });
  if (!plan.ok) throw new Error(plan.reason);
  expect(plan.rows).toEqual([{ selection: null, variantId: "s" }]);
});

it("rowKey is stable and order-independent", () => {
  expect(rowKey({ Size: "S", Color: "Red" })).toBe(rowKey({ Color: "Red", Size: "S" }));
  expect(rowKey(null)).toBe("default");
});
```

`stock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { stockByVariant, stockChange } from "./stock";

describe("stockChange (Plan 2B-2: the merchant edits AVAILABLE, as in Shopify)", () => {
  it("creates stock for a variant that has none", () => {
    expect(stockChange(5, null)).toEqual({ kind: "receive", quantity: 5 });
    expect(stockChange(0, null)).toEqual({ kind: "none" });
  });

  it("sets on-hand to available + reserved", () => {
    expect(stockChange(7, { onHand: 10, reserved: 2, available: 8 })).toEqual({
      kind: "adjust",
      onHand: 9,
    });
    expect(stockChange(8, { onHand: 10, reserved: 2, available: 8 })).toEqual({ kind: "none" });
    expect(stockChange(0, { onHand: 3, reserved: 0, available: 3 })).toEqual({
      kind: "adjust",
      onHand: 0,
    });
  });

  it("refuses a negative or fractional quantity", () => {
    expect(stockChange(-1, null)).toEqual({ kind: "invalid" });
    expect(stockChange(1.5, null)).toEqual({ kind: "invalid" });
  });
});

describe("stockByVariant (Plan 2B-1 legacy rule)", () => {
  const level = (onHand: number) => ({ onHand, reserved: 0, available: onHand });

  it("maps rows by variant", () => {
    expect(
      stockByVariant(
        [
          { variantId: "m", ...level(3) },
          { variantId: "l", ...level(4) },
        ],
        [{ id: "m" }, { id: "l" }],
      ),
    ).toEqual({ m: level(3), l: level(4) });
  });

  it("reads a lone legacy row as the only variant's stock, and ignores it otherwise", () => {
    expect(stockByVariant([{ variantId: null, ...level(9) }], [{ id: "only" }])).toEqual({
      only: level(9),
    });
    expect(
      stockByVariant(
        [
          { variantId: null, ...level(9) },
          { variantId: "m", ...level(1) },
        ],
        [{ id: "m" }, { id: "l" }],
      ),
    ).toEqual({ m: level(1) });
  });
});
```

`stockByVariant` takes **one location's** rows. The page filters the product inventory rows by the location's `warehouseId` first (Task 4).

- [ ] **Step 2: Run, expect failure.** `pnpm.cmd --filter admin-web run test -- lib/products`

- [ ] **Step 3: Implement**

**`variant-matrix.ts`:**

1. Export the `MatrixRow` interface and `rowKey`:

```ts
/** A stable key for a row: option names sorted, so key order never matters. */
export function rowKey(selection: Readonly<Record<string, string>> | null): string {
  if (selection === null) return "default";
  return Object.keys(selection)
    .sort()
    .map((name) => `${name}=${selection[name]}`)
    .join("|");
}
```

2. In `planOptionChange`:
   - **zero combinations:** return `rows: [{ selection: null, variantId: keep.id }]`.
   - **otherwise:** after the `add` loop, build `rows` from `combos.map((combo, index) => ({ selection: combo, variantId: claimed.get(index)?.id ?? null }))`.

   `claimed` already holds every existing variant that keeps a combination, including the reassigned ones.

**`stock.ts`:**

```ts
export interface StockLevelDto {
  readonly onHand: number;
  readonly reserved: number;
  readonly available: number;
}

export type StockChange =
  | { readonly kind: "none" }
  | { readonly kind: "receive"; readonly quantity: number }
  | { readonly kind: "adjust"; readonly onHand: number }
  | { readonly kind: "invalid" };

/** The merchant types AVAILABLE (Shopify); on-hand keeps the reserved units on top of it. */
export function stockChange(desiredAvailable: number, current: StockLevelDto | null): StockChange {
  if (!Number.isInteger(desiredAvailable) || desiredAvailable < 0) return { kind: "invalid" };
  if (current === null) {
    return desiredAvailable === 0
      ? { kind: "none" }
      : { kind: "receive", quantity: desiredAvailable };
  }
  if (desiredAvailable === current.available) return { kind: "none" };
  return { kind: "adjust", onHand: desiredAvailable + current.reserved };
}

/** One location's stock rows → by variant id, with the Plan 2B-1 legacy-row rule. */
export function stockByVariant(
  rows: readonly ({ readonly variantId: string | null } & StockLevelDto)[],
  variants: readonly { readonly id: string }[],
): Record<string, StockLevelDto> {
  const result: Record<string, StockLevelDto> = {};
  for (const row of rows) {
    if (row.variantId !== null) {
      result[row.variantId] = {
        onHand: row.onHand,
        reserved: row.reserved,
        available: row.available,
      };
    }
  }
  const [only] = variants;
  const [lone] = rows;
  if (
    variants.length === 1 &&
    only !== undefined &&
    rows.length === 1 &&
    lone?.variantId === null
  ) {
    result[only.id] = { onHand: lone.onHand, reserved: lone.reserved, available: lone.available };
  }
  return result;
}
```

- [ ] **Step 4: Run.** `… run test -- lib/products`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/lib/products
git commit -m "feat(admin-web): derive variant rows from the planner and stock changes from available"
```

---

### Task 2: One save for options, rows and stock

**Files:**

- Modify: `app/products/actions.ts`
- Modify: `app/products/actions.test.ts`

**Interfaces:**

- Consumes: `planOptionChange` (with `rows`), `rowKey`, `stockChange`, `stockByVariant`; `fetchWarehouses`, `registerWarehouse`, `fetchProductInventory`, `receiveStock`, `adjustStock`.
- Produces: `saveProductAction`, extended; `updateVariantDetailsAction` accepts `tracksInventory` / `continueSelling`. `saveProductOptionsAction` is removed.

**Form fields added by this plan** (joined to `product-editor`):

| Field                                                | Name                                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| options section rendered                             | `optionsPresent` = `"1"`                                                                      |
| option name, option `i` (0..2)                       | `optionName-<i>`                                                                              |
| option values, option `i` (one input each, repeated) | `optionValue-<i>`                                                                             |
| row `r` key (hidden)                                 | `row-<r>-key` = `rowKey(selection)`                                                           |
| row `r` price                                        | `row-<r>-price`                                                                               |
| row `r` available                                    | `row-<r>-available` (absent when the row's variant is untracked, or quantities are read-only) |
| single variant: track quantity                       | `tracksInventory` (checkbox)                                                                  |
| single variant: available at the location            | `available`                                                                                   |
| single variant: continue selling                     | `continueSelling` (checkbox)                                                                  |

- [ ] **Step 1: Write the failing tests** (extend `actions.test.ts`; mock `@/lib/api/inventory` the same way as `@/lib/api/products`)

1. **Options added on a one-variant product.** `optionsPresent=1`, `optionName-0="Size"`, `optionValue-0` = `["S", "M", ""]` (a trailing blank is ignored). Rows: `row-0-key="Size=S"`, `row-0-price="150"`, `row-1-key="Size=M"`, `row-1-price="175"`. The action:
   - runs the plan's operations (assign S → `setProductOptions` → add M);
   - takes the new variant id from `addProductVariant`'s `data.variantId`;
   - then calls `updateProductVariant` for **M** with `priceAmountMinor 17500`, because 175 differs from the copied first price;
   - calls `updateProductVariant` for **S** with `15000` **only if** 150 differs from S's current price. Assert both cases.
2. **Stale page.** `row-1-key` does not match the server's row 1 (`"Size=L"` posted, server computes `"Size=M"`). The action returns an error with `t.productEditor.pageOutOfDate` and calls **nothing**: rows are validated before the first write.
3. **Stock per row.** One location, `w1`. The rows post `row-0-available="5"` (S currently has 2 available, 0 reserved) and `row-1-available="3"` (new M, no stock). The action calls:
   - `adjustStock({ productId, variantId: S, warehouseId: "w1", onHand: 5 })`;
   - `receiveStock({ productId, variantId: <new M id>, warehouseId: "w1", quantity: 3 })`.

   A blank `row-r-available` changes nothing.

4. **No location yet.** `fetchWarehouses` returns `[]`. The first stock write is preceded by `registerWarehouse({ code: "SHOP", name: t.productEditor.shopLocation }, key)`, and its returned `warehouseId` is used.
5. **Several locations.** `fetchWarehouses` returns two. The action calls no stock function, even when `available` fields are posted. The UI does not render them, but the server must not trust that.
6. **Single variant (no options), inventory card.** `tracksInventory` off and `continueSelling` on send `updateProductVariant` with `tracksInventory: false, inventoryPolicy: "continue"`. `available="12"` with tracking **off** makes no stock call.
7. **Bad numbers.** `row-0-price="abc"` returns `fieldErrors["row-0-price"]`, and `row-0-available="-1"` returns `fieldErrors["row-0-available"]`, before any call.
8. **Unchanged options make no option calls.** Options equal to the product's give no `setProductOptions`, `addProductVariant` or `removeProductVariant`. Price edits still apply.
9. **The order is fixed:** details → option operations → variant/price → stock → SEO → brand → categories → status. Assert it through the mocks' `invocationCallOrder` in one combined case.

- [ ] **Step 2: Run, expect failure.** `pnpm.cmd --filter admin-web run test -- app/products/actions`

- [ ] **Step 3: Implement**

**Parsing:**

```ts
/** `optionName-<i>` / repeated `optionValue-<i>`; blank names drop the option, blank values are ignored. */
function parsePageOptions(formData: FormData): ProductOptionInput[] {
  const options: ProductOptionInput[] = [];
  for (let index = 0; index < MAX_OPTIONS; index += 1) {
    const name = stringField(formData, `optionName-${index}`).trim();
    const values = stringFieldValues(formData, `optionValue-${index}`)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (name.length === 0 && values.length === 0) continue;
    options.push({ name, values });
  }
  return options;
}
```

**Then wire `saveProductAction`.** Keep its structure (collect `steps`, run in order, stop on the first failure, add the `partiallySaved` prefix, revalidate), and change it as follows:

1. **Validate before any write.** Parse the options (if `optionsPresent`) and plan them (`planOptionChange` against the fetched product). An invalid plan is an error with `invalidOptions` / `tooManyVariants`. Then:
   - check `row-<r>-key === rowKey(plan.rows[r].selection)` for every `r`; otherwise return `pageOutOfDate`;
   - parse every `row-<r>-price` (`toMinorUnits` in the product's currency) and every `row-<r>-available` (a whole number ≥ 0, blank = no change);
   - return field errors **before** any write.

   Without `optionsPresent`, treat the options as unchanged (`product.options`).

2. **Option operations.** When the options changed (compare names and values, in order, to `product.options`), add **one** step that runs the plan's operations exactly as `saveProductOptionsAction` did. Move that loop into a helper, `applyOptionPlan(productId, product, plan)`, which returns `{ result, variantIdByRow }`:
   - `variantIdByRow[r]` is `plan.rows[r].variantId`;
   - or, for a new row, the id parsed from that `add` operation's `data.variantId`.

   Match an `add` to its row by `rowKey(op.selection) === rowKey(row.selection)`. When the options did not change, `variantIdByRow` is simply `plan.rows.map((row) => row.variantId)`.

3. **Prices.** With options (`product.options.length > 0` or new options), for each row whose parsed price differs from what that variant will have, call `updateProductVariant(productId, id, { sku, priceAmountMinor, currency })`. Compare against:
   - the existing variant's price;
   - or, for a new row, the price the `add` used.

   Read `sku` from the fetched variant, or for a new one, from the `add` operation.

   Without options, the existing single-variant step stays, plus `tracksInventory: checkbox("tracksInventory")` and `inventoryPolicy: checkbox("continueSelling") ? "continue" : "deny"`, compared like the other fields.

   The single-variant inventory card only renders when there are no options. When it renders, these two fields are present.

4. **Stock.**
   - **Location:** `fetchWarehouses()` once.
     - `[]` → register on first need (`registerWarehouse({ code: "SHOP", name: editor.shopLocation })`, then take `warehouseId` from `data`);
     - one → use it;
     - several → skip every stock step.
   - **Current levels:** `fetchProductInventory(productId)`, filtered to that location, then `stockByVariant(…)`.
   - **Per row** with a non-blank `row-<r>-available` (or `available` for the single variant): skip when that variant is untracked. Otherwise apply `stockChange(desired, levels[variantId] ?? null)`:
     - `receive` → `receiveStock({ productId, variantId, warehouseId, quantity })`;
     - `adjust` → `adjustStock({ productId, variantId, warehouseId, onHand })`.
   - Map the field errors back to `row-<r>-available` / `available`.
5. **SEO, brand, categories, status:** unchanged, in that order, last.

**Remove** `saveProductOptionsAction` and its test cases. Move the planner-execution test cases onto `saveProductAction` (test 1 above covers them). Name the moved cases in the report.

**`updateVariantDetailsAction`** also sends `tracksInventory: checkbox("tracksInventory")` and `inventoryPolicy: checkbox("continueSelling") ? "continue" : "deny"`.

- [ ] **Step 4: Run.** `… run test -- app/products/actions` and `… run typecheck`. Expected: PASS.

`variants-card.tsx` imports `saveProductOptionsAction` and will fail typecheck until Task 3. If needed, temporarily drop that import and the option form there in this task, so the commit stays green, and say so in the report.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/app/products
git commit -m "feat(admin-web): save options, variant prices and stock with the one page save"
```

---

### Task 3: Option editor, live variants table, inventory card

**Files** (under `components/products/editor/`):

- Create: `options-editor.tsx`, `options-editor.test.tsx`
- Modify: `variants-card.tsx`, `variants-card.test.tsx` (rewrite)
- Create: `inventory-card.tsx`, `inventory-card.test.tsx`
- Delete: `inventory-identifiers-card.tsx`
- Modify: `product-editor.tsx`, `product-editor.test.tsx`

**Interfaces:**

- **`OptionsEditor({ initial: readonly MatrixOption[]; onChange: (options: MatrixOption[]) => void; t })`.** It renders the inputs named in Task 2, each with `form={PRODUCT_FORM_ID}`.
- **`VariantsCard({ product, stock, t, locale, onPlanChange })`.**
  - `stock: { location: { id; name } | null; multipleLocations: boolean; byVariant: Record<string, StockLevelDto> }`;
  - `onPlanChange(summary: { adds: number; removes: number })` lifts the pending removals up for the Save confirmation.
- **`InventoryCard({ variant, stock, t, errors, mode })`.** It is the single-variant card.
- **`ProductEditor`** gains `stock` (same shape) as a prop, and loses `slots.variants` and `slots.stock`. It renders `VariantsCard` itself in edit mode.

- [ ] **Step 1: Write the failing tests**

**`options-editor.test.tsx`:**

1. "Add options like size or color" adds an option in **editing** state:
   - a name input with a `<datalist>` of suggestions (`t.productEditor.optionSuggestions`, an array in the dictionary: en `["Size", "Color", "Material", "Style"]`, ar `["المقاس", "اللون", "الخامة", "الستايل"]`);
   - **one** empty value input.
2. Typing in the last value input appends a new empty one. Clearing a middle value and leaving it blank keeps the order, and blanks are not submitted as values (the action filters them; the UI still renders them).
3. Each value has a remove button (`aria-label` = `t.productEditor.removeValue` with the value).
4. **Done.** It collapses the option to its name and value chips, plus an "Edit" button. Done is disabled while the name is blank or there is no value.
5. **Hidden inputs while collapsed.** A collapsed option **still submits** its name and values: render hidden inputs with the same names, joined to the form.
6. "Delete option" removes it. "Add another option" is disabled at 3.

**`variants-card.test.tsx`:**

1. A product with one plain variant and no options shows the options editor. After adding `Size` with `S` and `M`, the table shows two rows (`S`, `M`).
   - `S` keeps the existing variant's price.
   - `M` shows the first variant's price, with a "New" badge (`t.productEditor.newVariant`).
2. Each row has `row-<r>-key` (hidden), `row-<r>-price` (decimal input) and `row-<r>-available` (number input). All are joined to the page form.
3. `row-<r>-available` is not rendered for an untracked variant ("Not tracked"), nor when `stock.multipleLocations` is set (the read-only quantity plus `t.productEditor.multipleLocations`).
4. Removing a value calls `onPlanChange({ adds: 0, removes: 1 })`.
5. "Edit" exists only for existing rows, and opens the dialog. The dialog contains the two new checkboxes (`tracksInventory`, `continueSelling`).

**`inventory-card.test.tsx`:**

1. "Track quantity" checked shows the location row: `stock.location.name`, or `t.productEditor.shopLocation` when it is `null`. It has an `available` input defaulted to the current available, and the "Continue selling when out of stock" checkbox.
2. Unchecking "Track quantity" hides the quantity row and the continue-selling checkbox. Use the same hide-but-keep approach as weight, so `tracksInventory` is still submitted unchecked.
3. With `multipleLocations`, the quantity is read-only, with the note.
4. SKU and barcode are kept, moved here from the deleted identifiers card, with the same names.

**`product-editor.test.tsx`:**

1. **Confirmation.** With a pending removal (`onPlanChange` reported `removes: 1`), clicking Save calls `window.confirm` with `t.productEditor.confirmRemoveVariants`. Cancelling submits nothing.
2. **Single-variant layout.** A product without options shows the inventory card, and no separate stock card. A product with options shows the variants table, and no pricing, inventory or shipping card.
3. **No other form.** There is no other `<form>` in the editor except the dialog's, which is rendered in a portal when open.

- [ ] **Step 2: Run, expect failure.** `pnpm.cmd --filter admin-web run test -- components/products/editor`

- [ ] **Step 3: Implement**

**`OptionsEditor`.** Keep local state `{ key; name; values: string[]; editing: boolean }[]`, and keep exactly one trailing empty value while editing. In editing state:

- the name `Input` (`list` = a datalist id);
- the value inputs, each `name={\`optionValue-${index}\`}`;
- "Delete option" (`type="button"`) and "Done" (`type="button"`).

In collapsed state:

- the name;
- chips (`Badge`) for the values;
- "Edit";
- hidden inputs carrying the name and values.

Call `onChange` on every edit, with options built from non-blank values.

**`VariantsCard`:**

- holds the current options (from `OptionsEditor.onChange`), and calls `planOptionChange({ productSku, variants, nextOptions })` on every change;
- renders `plan.rows`;
- shows the existing error messages when the plan is not `ok`, with no rows;
- emits `onPlanChange(plan.summary)`;
- renders a hidden `optionsPresent=1`.

**Columns:**

- **Variant:** values joined by `" / "`, or `t.productEditor.defaultVariant`.
- **Price:** an `Input` with `inputMode="decimal"`, `name={\`row-${r}-price\`}`, and `defaultValue`from`fromMinorUnits(…)`. **Key each row's inputs by `rowKey`**, so React keeps a typed value when other rows appear or disappear.
- **Available:** as described in the test.
- **Edit.**

The dialog is the existing `VariantDialog`, plus `CheckboxRow name="tracksInventory"` and `CheckboxRow name="continueSelling"` with defaults from the variant.

**`InventoryCard`** replaces `InventoryIdentifiersCard` in `product-editor.tsx` for single-variant products and in create mode:

- in create mode there is no stock yet; the location name is `t.productEditor.shopLocation`, and `available` is blank;
- in create mode, also send `tracksInventory` / `continueSelling` / `available` through `createProductAction`:
  - add the two flags to the variant it creates;
  - after create, if `available > 0` and tracked, run the same location logic and `receiveStock` with the new variant's id. The create response must carry the variant id. If `createProduct`'s `data` has no variant ids, fetch the product once after creating it to read them.

**`ProductEditor`:**

- holds `pendingRemovals`;
- the main `<form>`'s `onSubmit`:

```tsx
onSubmit={(event) => {
  if (pendingRemovals > 0 && !window.confirm(editor.confirmRemoveVariants.replace("{count}", String(pendingRemovals)))) {
    event.preventDefault();
  }
}}
```

React 19 still honours `preventDefault` for a form with an `action`; the test proves it.

- Remove `pricesOnVariants` usage only if the table replaces it. Keep the key if anything else uses it.

- [ ] **Step 4: Run.** `… run test -- components/products/editor` and `… run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/components/products/editor apps/admin-web/src/app/products
git commit -m "feat(admin-web): add the shopify option editor, a live variants table and the inventory card"
```

---

### Task 4: Page wiring, messages, cleanup

**Files:**

- Modify: `app/products/[productId]/page.tsx`
- Modify: `app/products/new/page.tsx` (pass `stock` with `location: null`, `multipleLocations: false`, `byVariant: {}`)
- Delete: `components/products/product-inventory-card.tsx`, `product-inventory-table.tsx` (+ tests), **only if** nothing else imports them (grep; `/inventory` may)
- Modify: `messages/en.ts`, `messages/ar.ts`

- [ ] **Step 1: Write the failing test.** For the page, or for a small `buildStockView(warehouses, rows, variants)` helper in `lib/products/stock.ts`, whichever the repo's page tests make practical:
  - one location → `{ location: { id, name }, multipleLocations: false, byVariant }`;
  - none → `location: null`;
  - two → `multipleLocations: true`, with `location` set to the first, for display only.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

**`[productId]/page.tsx`:**

1. `Promise.all([fetchWarehouses(), fetchProductInventory(product.id)])`.
2. Build `stock` with `buildStockView`.
3. A failed read degrades to `location: null`, `byVariant: {}`, and **read-only** quantities. Add a field `readOnlyReason` to the stock view, and show `t.productEditor.stockUnavailable`. Never default to 0, which would write zeros on Save.
4. Remove the `variants` and `stock` slots, and pass `stock` to `ProductEditor`.

**Messages**, in both files:

| key                 | en                                                                        | ar                                                              |
| ------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `optionSuggestions` | `["Size", "Color", "Material", "Style"]`                                  | `["المقاس", "اللون", "الخامة", "الستايل"]`                      |
| `optionValue`       | Option value                                                              | قيمة الخيار                                                     |
| `removeValue`       | Remove {value}                                                            | احذف {value}                                                    |
| `done`              | Done                                                                      | تم                                                              |
| `edit`              | Edit                                                                      | تعديل                                                           |
| `deleteOption`      | Delete option                                                             | احذف الخيار                                                     |
| `newVariant`        | New                                                                       | جديد                                                            |
| `variant`           | Variant                                                                   | المتغيّر                                                        |
| `available`         | Available                                                                 | المتاح                                                          |
| `notTracked`        | Not tracked                                                               | غير متتبَّع                                                     |
| `trackQuantity`     | Track quantity                                                            | تتبّع الكمية                                                    |
| `continueSelling`   | Continue selling when out of stock                                        | كمّل البيع لما الكمية تخلص                                      |
| `shopLocation`      | Shop location                                                             | المتجر                                                          |
| `quantity`          | Quantity                                                                  | الكمية                                                          |
| `multipleLocations` | Quantities are managed per location on the Inventory page.                | الكميات بتتظبط لكل مخزن من صفحة المخزون.                        |
| `stockUnavailable`  | Stock could not be loaded; quantities are read-only. Reload to edit them. | ما قدرناش نجيب الكميات، فهي للعرض بس. اعمل reload عشان تعدّلها. |
| `pageOutOfDate`     | This page is out of date. Reload and try again.                           | الصفحة دي قديمة. اعمل reload وجرّب تاني.                        |

`Dictionary` must accept an array for `optionSuggestions`. Check the `Widen<>` type in `en.ts`. If it cannot hold an array, use a single comma-separated string and split it in the component.

Remove the keys that became unused (`saveOptions`, `matrixPreview`, and any others), but only after grepping both apps' sources for each one.

- [ ] **Step 4: Run, sequentially:** `pnpm.cmd --filter admin-web run test`, `… run typecheck`, `… run lint`. Expected: PASS, with no new warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src
git commit -m "feat(admin-web): wire stock into the product page and drop the warehouse-id stock card"
```

---

### Task 5: Docs, gates, push

- [ ] **Step 1: Gaps** (`docs/KNOWN_GAPS.md` and `docs/architecture/23-platform-gap-register.md`)

**Close** the Plan 2B-1 gap "the product screen does not yet edit stock per variant…".

**Open:**

- **Low:** "Quantities for more than one location are not editable on the product page."
- **Low:** "The `/inventory` screen still asks for warehouse ids."

- [ ] **Step 2: Gates, sequentially**

1. `pnpm.cmd --filter admin-web run test`
2. `pnpm.cmd -r --no-bail run typecheck`
3. `pnpm.cmd -r --no-bail run lint`
4. `pnpm.cmd arch`

All exit 0.

- [ ] **Step 3: Commit and push** (no migration, so push directly)

```bash
git add docs/KNOWN_GAPS.md docs/architecture/23-platform-gap-register.md docs/superpowers/plans/2026-10-09-variants-ux.md
git commit -m "docs(admin-web): record plan 2b-2, close the variant stock screen gap"
git push origin morbeh/w0-w17-w12
```

---

## Done criteria

- **One Save** on the product page. Options, prices, quantities and every other field save together.
- **Option values** are typed one per field, a new field appears as you type, and "Done" collapses the option to chips.
- **The variants table** updates while you type. Each row's price and available quantity are edited in place, and new rows are marked "New".
- **Removing values** asks for confirmation on Save.
- **The single-variant inventory card** has "Track quantity", the quantity next to the location's name ("Shop location" when none exists, created on first save) and "Continue selling when out of stock".
- **No warehouse id** appears anywhere on the product page.

## Report back

In Arabic for the owner:

- the task → commit → tests table;
- what to click to try it;
- every moved or rewritten test;
- anything you decided that this plan did not.

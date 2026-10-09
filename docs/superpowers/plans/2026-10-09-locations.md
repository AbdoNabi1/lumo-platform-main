# Locations Like Shopify (Plan 2B-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ملخص للمالك (بالعربي):** المتجر فيه **مخزنين** من البيانات التجريبية (3 منتجات في واحد و10 في التاني). وعشان كده فيه 3 مشاكل:
>
> 1. الكمية **مش بتتعدّل من صفحة المنتج**.
> 2. لما موظف يطلب **تجهيز طلب**، الطلب **بيفشل**، لأن النظام مش عارف يحجز البضاعة من أنهي مخزن.
> 3. **الدفع مش بيتأكد من الكمية في السيرفر.** الحماية الوحيدة هي إن زرار "أضف للسلة" بيتقفل في المتجر، فممكن يتباع منتج كميته خلصت.
>
> **الخطة دي بتصلّح التلاتة زي شوبيفاي:**
>
> - **صفحة المنتج:** فوق جدول المقاسات اختيار **"المخزن"** (موقع المتجر ▾)، والكمية بتتعدّل للمخزن اللي اخترته. ولو المنتج مقاس واحد، كارت المخزون فيه **سطر لكل مخزن**.
> - **الطلب:** النظام بيختار لوحده المخزن اللي فيه البضاعة.
> - **الدفع:** السيرفر بيرفض الطلب لو الكمية مش كفاية، والزبون يشوف رسالة "بعض المنتجات خلصت". ده ما بيحصلش لو المقاس عليه "البيع عند نفاد المخزون" أو مش متتبَّع.
> - **صفحة المخزون:** قايمة **المواقع بأساميها**، وزرار "إضافة موقع"، وزرار "إيقاف" لكل موقع. والأدوات المتقدمة اللي بتطلب أرقام طويلة بتتخبّى تحت "متقدم".
> - **زرار "إضافة خيارات"** بيفتح قايمة زي شوبيفاي: بحث، و**خيارات مقترحة** (المقاس، اللون، الخامة…)، و"**إنشاء خيار مخصص**". وكمان قيم مقترحة للمقاس واللون.
>
> مفيش migration. فيه تعديل في السيرفر (الدفع والطلبات) وفي لوحة التحكم.

**Goal:** Support several active locations end to end. That means:

- the product page edits quantities per location;
- checkout validation and order reservation pick the location that holds the stock;
- completing a checkout refuses stock-limited lines that no location can cover;
- the Inventory page manages locations by name;
- adding an option works like Shopify's recommended-option menu.

**Architecture:**

- **Location choice (server).** One pure function, `pickLocation(levels, quantity)`, in `apps/admin/src/infrastructure/cross-context/pick-location.ts`.
  - **Input:** per active location, the variant's available quantity.
  - **Output:** the location with the most available, and whether it covers the quantity.
  - **Both adapters use it:**
    - `InventoryValidationAdapter` requires a location that covers the line;
    - `OrdersInventoryAdapter` reserves at the picked location, with the same `continue` rule as Plan 2B-1.
  - **No more "exactly one warehouse" errors.**
  - **Inactive locations never count.** With **zero** active locations, a stock-limited line is invalid, while unlimited lines still pass.
- **Checkout gate.** `CompleteCheckout` gains an optional `inventoryValidation` dependency.
  - When it is present, `complete` validates the session's items **before** creating the order. An invalid result returns a `BusinessRuleError` (409) whose message starts with `OUT_OF_STOCK:`.
  - The admin composition passes the real adapter.
  - The storefront maps that 409 to a clear "some items are no longer available" message.
  - A race between two shoppers is still possible until reservation moves to order placement (gap).
- **Product page.**
  - The stock view carries **every** active location and `byLocation[locationId][variantId]`.
  - The variants table gets a location select (`stockLocationId`), and its `row-<r>-available` fields apply to that location.
  - The single-variant inventory card renders one `available-<locationId>` field per location.
  - `saveProductAction` writes to the named location(s), and validates that each id is an active location of this tenant, from `fetchWarehouses`.
  - With zero locations, the first save still registers "Shop location".
- **Inventory page.** A Locations card with each location's name, code and status, plus Add location (name only; the code is derived) and Deactivate (with a confirmation). The id-typed forms (transfer, reservations) move into a collapsed **Advanced** `<details>`.
- **Option picker.** A popover with:
  - a search box;
  - the recommended options from the dictionary, excluding names already used;
  - "Create custom option".

  Choosing one adds an option already named, with the cursor in its first value field. Size and Color get value suggestions through a `<datalist>`.

**Tech Stack:** TypeScript, vitest, Next.js 15, React 19, `@platform/ui`.

**Spec:**

- Owner screenshots, 2026-10-09: the "Quantities are managed per location" note; Shopify's "add options" menu (search, Recommended, Create custom option).
- Gap G-107 (several locations not editable on the product page) and G-108 (`/inventory` asks for warehouse ids).
- Finding: the guest checkout never checks stock on the server.

## Global Constraints

Same as Plans 2B-1 to 2C-4. Every task implicitly includes these.

### Git and branch

- Branch `morbeh/w0-w17-w12`. No force-push. No `--no-verify`. Never raise the lint warning cap.
- Never stage `.claude/worktrees/`.
- Commit lines at most 100 characters, lowercase subject.
- End every commit with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

### Scope

- **No migration, no database, no Railway.**
- The backend changes are limited to `services/checkout` (the optional dependency) and `apps/admin` (adapters, composition).
- **Security assertions from Plans 2A, 2C-1 and 2B-1 must stay green, unchanged.**

### App rules

- Runtime API calls only from server code. One idempotency key per write. `toFormState` for every non-`ok` outcome.
- Both message files get every key. Logical RTL classes only.
- No `autoFocus`; use a one-shot focus ref.

### Commands

- Per-package `pnpm.cmd --filter <pkg> run test|typecheck|lint`. Never run a full typecheck and a full test suite at the same time.
- No new lint warnings.

| Directory           | Package filter       |
| ------------------- | -------------------- |
| `services/checkout` | `@platform/checkout` |
| `apps/admin`        | `@platform/admin`    |
| `apps/storefront`   | `storefront`         |
| `apps/admin-web`    | `admin-web`          |

---

### Task 1: Pick the location on the server; gate checkout completion

**Files:**

- Create: `apps/admin/src/infrastructure/cross-context/pick-location.ts` (+ test)
- Modify: `apps/admin/src/infrastructure/cross-context/inventory-validation.adapter.ts` (+ test)
- Modify: `apps/admin/src/infrastructure/cross-context/orders-inventory.adapter.ts` (+ test)
- Modify: `services/checkout/src/application/complete-checkout.use-case.ts` (+ test)
- Modify: `services/checkout/src/composition.ts`
- Modify: `apps/admin/src/composition.ts` (only if the checkout wiring needs the adapter passed explicitly)
- Modify: `apps/storefront/src/app/checkout/actions.ts` and the checkout page/messages that show failure reasons (+ test)

**Interfaces:**

- **`pickLocation`:**

```ts
export interface LocationLevel {
  readonly locationId: string;
  readonly available: number;
}
export function pickLocation(
  levels: readonly LocationLevel[],
  quantity: number,
): { readonly locationId: string; readonly available: number; readonly covers: boolean } | null;
```

It returns `null` for an empty input. Otherwise it returns the highest `available` (ties broken by input order), with `covers = available >= quantity`.

- **`CompleteCheckoutDeps.inventoryValidation?: InventoryValidationPort`.**

- [ ] **Step 1: Write the failing tests**

**`pick-location.test.ts`:**

1. `[{a, 3}, {b, 7}]` with quantity 5 → `b`, covers.
2. With quantity 9 → `b`, does not cover.
3. A tie (`[{a, 4}, {b, 4}]`) → `a`.
4. `[]` → `null`.

**`InventoryValidationAdapter`.** The warehouses repository returns several warehouses, including inactive ones. `checkAvailability` returns per warehouse, with 404 meaning 0.

1. Two active locations: M has 0 at A and 6 at B, quantity 5 → **valid**. Before this plan, it was always invalid for "more than one warehouse".
2. Quantity 7 → invalid. The reason names the product.
3. An **inactive** location holding 10 is ignored. The line is invalid if the active ones cannot cover it.
4. Zero active locations: a stock-limited line is invalid, and an untracked line is valid.
5. `checkAvailability` is called with `variantId` for each active location only.

**`OrdersInventoryAdapter`:**

1. Reserves at the location `pickLocation` chose, with that location's `warehouseId` and the `variantId`.
2. The idempotency skip checks **that** location's item.
3. `continue` policy: reserves `min(quantity, chosen.available)`; skips when 0; never throws for lack of stock.
4. A stock-limited "deny" line that no location covers **throws**, with the existing message style. That is the current behaviour for insufficient stock.

**`CompleteCheckout`:**

1. With `inventoryValidation` returning `{ valid: false, reason: "insufficient stock for product p1…" }`:
   - the result is `err(BusinessRuleError)`;
   - the message starts with `OUT_OF_STOCK:`;
   - **`orderCreation.create` is not called**;
   - the session stays open.
2. With it valid → it proceeds exactly as today.
3. Without the dependency (existing tests) → unchanged.
4. An already completed session (`orderRef` set) returns the existing result **without** validating again. A retried complete must stay idempotent.

**Storefront `completeCheckout`:**

- a 409 whose body message starts with `OUT_OF_STOCK:` → `{ ok: false, reason: "out-of-stock" }`;
- the checkout page shows `t.checkout.outOfStock`:
  - en: "Some items in your cart are no longer available in the quantity you chose. Update your cart and try again.";
  - ar: "في منتجات في سلتك الكمية المطلوبة منها مش متاحة دلوقتي. عدّل السلة وجرّب تاني.";
- include a link back to `/cart`.

- [ ] **Step 2: Run, expect failure.** Run the three packages' tests, filtered to these files.

- [ ] **Step 3: Implement**

**The adapters:**

1. List the active warehouses:

```ts
(await this.warehouses.list({ first: 100 }, tenantId)).items.filter((w) => w.active);
```

Use the getter the `Warehouse` aggregate exposes (`active`). 2. Delete the "exactly one warehouse" branches and their messages. 3. Per line:

- resolve the variant (`variantOf`), and skip it when it is unlimited (validation) or untracked (reservation);
- collect the levels per active location (validation: `checkAvailability`; reservation: `findByProductAndWarehouse(…, variantId)` → `stockLevel.available`, or 0);
- call `pickLocation`.

**`CompleteCheckout`.** After `generateOrderDraft()` succeeds and **before** `orderCreation.create`:

```ts
if (this.deps.inventoryValidation !== undefined) {
  const stock = await this.deps.inventoryValidation.validate(session.items, input.tenantId);
  if (!stock.valid) {
    return err(new BusinessRuleError(`OUT_OF_STOCK: ${stock.reason ?? "insufficient stock"}`));
  }
}
```

In checkout's `composition.ts`, pass `inventoryValidation: deps.inventoryValidation` to `CompleteCheckout`. It is already in the deps that `ValidateCheckout` receives. Admin's `checkoutDeps` already provides the real adapter, so check that nothing else is needed.

**Storefront.** Read the response body's error message, using the same envelope shape the other failure mappers read, and add the `"out-of-stock"` reason to `CheckoutActionResult`'s reason union. Also add the message keys.

- [ ] **Step 4: Run.** The `@platform/checkout`, `@platform/admin` and `storefront` tests, then the three typechecks. Expected: PASS, and every earlier security test is unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src services/checkout/src apps/storefront/src
git commit -m "feat(checkout): pick the stocked location, refuse out-of-stock checkouts on the server"
```

---

### Task 2: Product page — quantities per location

**Files:**

- Modify: `apps/admin-web/src/lib/products/stock.ts` (+ test): `buildStockView`
- Modify: `apps/admin-web/src/app/products/actions.ts` (+ test): the stock step
- Modify: `apps/admin-web/src/components/products/editor/variants-card.tsx` (+ test)
- Modify: `apps/admin-web/src/components/products/editor/inventory-card.tsx` (+ test)
- Modify: `apps/admin-web/src/app/products/[productId]/page.tsx`, `apps/admin-web/src/app/products/new/page.tsx`

**Interfaces:**

- **`StockView`** becomes:

```ts
{
  locations: readonly { id; name }[];
  defaultLocationId: string | null;
  readOnlyReason: "unavailable" | null;
  byLocation: Record<locationId, Record<variantId, StockLevelDto>>;
}
```

- `defaultLocationId` is the active location holding the most of this product's stock, or else the first one.
- Remove `location` and `multipleLocations`, and update every consumer.
- **New form fields:**
  - `stockLocationId`: the location the table edits; rendered when there is at least one location;
  - `available-<locationId>`: single-variant products, one per location;
  - `available`: kept **only** for the zero-locations case, where the first save registers "Shop location".

- [ ] **Step 1: Write the failing tests**

1. **`buildStockView`:**
   - two active locations and one inactive → two `locations`, keyed per location;
   - the legacy-row rule applies **per location**;
   - `defaultLocationId` is the one holding the most stock.
2. **Variants card:**
   - with two locations, a select labelled `t.productEditor.location` shows both names;
   - changing it switches the Available column to that location's quantities. They are controlled values, so typed but unsaved edits for the other location are kept per location in state;
   - the hidden `stockLocationId` follows the select;
   - with one location, no select is shown, but `stockLocationId` is still posted.
3. **Inventory card** (single variant, two locations): two rows with the location names and fields `available-<idA>` / `available-<idB>`.
4. **`saveProductAction`:**
   - `stockLocationId=B` with `row-0-available=4` adjusts at **B**;
   - an unknown or inactive `stockLocationId` → `fieldErrors.stockLocationId` and **no** stock call;
   - `available-A=2` + `available-B=5` on a single variant writes both, each through `stockChange`;
   - the zero-locations case is unchanged: register "Shop location", then write.
   - Remove the old "several locations → write nothing" case; it no longer applies.
   - Add `stockLocationId` to the "rows are validated before the first write" guarantee.

- [ ] **Step 2: Run, expect failure.** `pnpm.cmd --filter admin-web exec vitest run src/lib/products src/app/products src/components/products/editor`

- [ ] **Step 3: Implement**, as specified.

The table's Available input keeps its name `row-<r>-available`. The location travels in `stockLocationId`. Remove the `t.productEditor.multipleLocations` note, and its key if it is unused.

- [ ] **Step 4: Run.** The same command, then `pnpm.cmd --filter admin-web run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src
git commit -m "feat(admin-web): edit stock per location on the product page"
```

---

### Task 3: Shopify's "add options" menu and value suggestions

**Files:**

- Create: `apps/admin-web/src/components/products/editor/option-name-picker.tsx` (+ test)
- Modify: `apps/admin-web/src/components/products/editor/options-editor.tsx` (+ test)
- Modify: `apps/admin-web/src/messages/en.ts`, `ar.ts`

**Interfaces:**

- **`OptionNamePicker({ used: readonly string[]; onPick: (name: string) => void; t; triggerLabel })`.**
- **Dictionary:**
  - `productEditor.recommendedOptions: readonly string[]`, which replaces `optionSuggestions`; remove the old key after migrating its users;
  - `productEditor.valueSuggestions: Record<string, readonly string[]>`, keyed by the lowercase option name in both languages.

- [ ] **Step 1: Write the failing tests**

1. The trigger ("Add options like size or color", or "Add another option" when some exist) opens a panel (`role="dialog"`, labelled) containing:
   - a search box;
   - a "Recommended" heading;
   - the recommended names **not already used** (case-insensitive);
   - a "Create custom option" button.
2. Typing `col` filters the list to "Color".
3. **Picking "Color"** calls `onPick("Color")`. The panel closes, and the new option opens in editing state named "Color", with the cursor in its first value field.
4. **"Create custom option"** with search text `"Fabric"` creates an option named "Fabric". With empty search, it creates an unnamed option with the cursor in the name field.
5. Escape and outside clicks close the panel, and focus returns to the trigger.
6. **Value suggestions.** An option named "Size" (or "المقاس") gives its value inputs a `<datalist>` with `XS, S, M, L, XL, XXL`. "Color" / "اللون" lists common colors. Other names get none.
7. The 3-option limit still disables the trigger.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

The panel is a positioned `div` under the trigger:

- `role="dialog"`, `aria-label={t.productEditor.addOptions}`;
- the search `Input` gets focus through a one-shot ref when the panel opens;
- a list of `button`s;
- a separator, then "Create custom option" with a `PlusCircle` icon;
- a `useEffect` closes it on Escape (keydown on the panel) and on `pointerdown` outside;
- RTL-safe positioning (`start-0`).

**Messages:**

| key                  | en                                                                                                                              | ar                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recommended`        | Recommended                                                                                                                     | موصى به                                                                                                                                                                   |
| `searchOptions`      | Search                                                                                                                          | بحث                                                                                                                                                                       |
| `createCustomOption` | Create custom option                                                                                                            | إنشاء خيار مخصص                                                                                                                                                           |
| `recommendedOptions` | `["Size", "Color", "Material", "Style", "Pattern", "Age group", "Flavor", "Weight", "Length", "Capacity"]`                      | `["المقاس", "اللون", "الخامة", "الستايل", "النقشة", "الفئة العمرية", "النكهة", "الوزن", "الطول", "السعة"]`                                                                |
| `valueSuggestions`   | `{ size: ["XS","S","M","L","XL","XXL"], color: ["Black","White","Red","Blue","Green","Yellow","Pink","Grey","Brown","Beige"] }` | `{ "المقاس": ["XS","S","M","L","XL","XXL"], "اللون": ["أسود","أبيض","أحمر","أزرق","أخضر","أصفر","وردي","رمادي","بني","بيج"], size: […same as en], color: […same as en] }` |

`valueSuggestions` is looked up with `name.trim().toLowerCase()`. Arabic has no case, so the Arabic keys match as written. If `Widen<>` cannot type a record of arrays, store each suggestion list as one comma-separated string and split it.

- [ ] **Step 4: Run.** `pnpm.cmd --filter admin-web exec vitest run src/components/products/editor`, then `… run typecheck` and `… run lint`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src
git commit -m "feat(admin-web): shopify's add-options menu with recommended options and value suggestions"
```

---

### Task 4: Inventory page — locations by name

**Files:**

- Modify: `apps/admin-web/src/app/inventory/page.tsx`
- Modify: `apps/admin-web/src/app/inventory/actions.ts` (+ test)
- Create: `apps/admin-web/src/components/inventory/locations-card.tsx` (+ test)
- Modify: `apps/admin-web/src/messages/en.ts`, `ar.ts`

**Interfaces:**

- **`addLocationAction(prev, formData)`:** takes `name`; derives `code` with `handleFromTitle(name).toUpperCase()`, or `LOC-<RANDOM4>` when that is empty; calls `registerWarehouse`.
- **`deactivateLocationAction(prev, formData)`:** takes `warehouseId` from a hidden field rendered per row; calls the existing deactivate API.

- [ ] **Step 1: Write the failing tests**

1. **The Locations card** lists each warehouse's **name**, its code (muted) and a status badge (Active / Inactive). There are no raw ids in visible text.
2. **"Add location"** (a name field and a button) calls `addLocationAction`. For `"Nasr City"` it sends `code: "NASR-CITY"`. For an Arabic-only name, `LOC-XXXX`.
3. **"Deactivate"** exists only on active rows. It asks `window.confirm(t.inventoryPage.confirmDeactivate)` ("Stock at this location will no longer be sold. Continue?" / "البضاعة في الموقع ده مش هتتباع تاني. تكمّل؟"), then posts that row's id.
4. **The page renders** the Locations card first, then a `<details>` titled `t.inventoryPage.advanced`, holding the existing transfer and reservation forms. They are unchanged, and collapsed by default.
5. **Removed:** the old "Register warehouse" and "Deactivate warehouse" id forms. The card replaces them. Delete their components if nothing else uses them.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement.** The page reads `fetchWarehouses()`. Show an error state on failure, as other pages do.

- [ ] **Step 4: Run.** `pnpm.cmd --filter admin-web run test`, `… run typecheck`, `… run lint`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src
git commit -m "feat(admin-web): manage locations by name, tuck the id-based tools under advanced"
```

---

### Task 5: Docs, gates, push

- [ ] **Step 1: Gaps** (`docs/KNOWN_GAPS.md` and `docs/architecture/23-platform-gap-register.md`)

**Close:**

- G-107 (several locations on the product page);
- G-108 (the inventory page asked for warehouse ids);
- the Plan 2B-1 note that reservations fail with more than one warehouse.

**Open:**

- **Medium:** "Stock is checked at checkout completion but only reserved when staff request fulfillment; two shoppers can still buy the last unit at the same moment. Move the reservation to order placement."
- **Low:** "A line is served from one location; stock split across locations is not combined."
- **Low:** "Deactivating a location does not move its stock."

- [ ] **Step 2: Gates, sequentially**

1. The package suites: `@platform/checkout`, `@platform/admin`, `storefront`, `admin-web`.
2. `pnpm.cmd -r --no-bail run typecheck`
3. `pnpm.cmd -r --no-bail run lint`
4. `pnpm.cmd arch`

- [ ] **Step 3: Commit and push** (no migration, so push directly)

```bash
git add docs/KNOWN_GAPS.md docs/architecture/23-platform-gap-register.md docs/superpowers/plans/2026-10-09-locations.md
git commit -m "docs(inventory): record plan 2b-3, close the location gaps"
git push origin morbeh/w0-w17-w12
```

---

## Done criteria

- **Product page:** with two locations, a location select sits above the variants table, and quantities save to the chosen location. A single-variant product shows one quantity field per location.
- **Checkout and orders:** "Request fulfillment" reserves from the location that holds the stock, with no "more than one warehouse" error.
- **Out of stock:** completing a checkout for more than any location holds is refused, and the shopper sees the out-of-stock message. Untracked and continue-selling variants still sell.
- **Inventory page:** lists locations by name, adds one by name, and deactivates with a warning. No ids are shown outside "Advanced".
- **Add options:** opens Shopify's menu (search, Recommended, Create custom option). Size and Color suggest values.

## Report back

In Arabic for the owner:

- the task → commit → tests table;
- what to click to try it;
- every rewritten test;
- anything you decided that this plan did not.

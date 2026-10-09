# Shopify Look for the Product Page (Plan 2C-4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ملخص للمالك (بالعربي):** المالك بعت اسكرين لصفحة المنتج في شوبيفاي. الخطة دي بتخلي صفحتنا **شكلها وطريقتها زيها**:
>
> | في شوبيفاي                                                                                           | هيبقى عندنا                                                              |
> | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
> | كارت السعر صغير: السعر بس، وتحته **بطاقات** (السعر المقارن، فرض ضريبة، التكلفة) بتفتح لما تضغط عليها | بالظبط كده، والبطاقة بتعرض قيمتها ("فرض ضريبة · نعم")                    |
> | **مفتاح تشغيل** "المخزون مُتتبَّع" فوق كارت المخزون، وجدول "موقع المتجر: الكمية"                     | بالظبط كده، وتحته بطاقات: SKU، والرموز الشريطية، والبيع عند نفاد المخزون |
> | **مفتاح تشغيل** "منتج مادي" في كارت الشحن                                                            | بالظبط كده، والوزن ووحدته                                                |
> | قايمة "الحالة" فيها شرح تحت كل اختيار                                                                | نفس القايمة                                                              |
> | "المورّد" بيتكتب بإيدك                                                                               | بيتكتب، ولو جديد بيتعمل لوحده                                            |
> | العلامات بطاقات بتتشال بـ ✕                                                                          | بالظبط كده                                                               |
> | زراير "معاينة" و"نسخ" فوق                                                                            | بالظبط كده                                                               |
> | الكلام بالعربي بنفس كلمات شوبيفاي                                                                    | نفس الكلمات                                                              |
>
> **مش في الخطة دي:** رفع الصور (2C-3، على Supabase)، ومحرّر الوصف المنسّق، والطرود والأبعاد، وفئات شوبيفاي الجاهزة، وقنوات البيع.

**Goal:** Restyle the product editor to match Shopify's product page as shown in the owner's screenshots:

- compact cards whose optional fields hide behind value-showing chips;
- switches;
- a status picker with descriptions;
- a free-text vendor;
- a tag-chip input;
- Preview and Duplicate actions;
- Shopify's own Arabic wording.

**Architecture:**

- **No input `name` changes,** except `brandId`, which becomes `vendor`. Every existing action and test keeps working.
- **Hidden ≠ removed.** A field behind a chip stays mounted, with the `hidden` attribute, so it is always submitted, the same way the weight row already works. Chips only change what is visible.
- **New primitives live in `components/products/editor/controls.tsx`:** `Switch`, `ChipRow` / `Chip`, `MoneyInput`, `TagsInput` and `StatusPicker`. Each one is a thin wrapper over a native input, so the `form="product-editor"` association keeps working.
- **Vendor.**
  - A typed name that matches an existing brand (case-insensitive) uses that brand.
  - A new name creates a brand (`createBrand`), then assigns it.
  - Blank means no brand.
- **Duplicate** is a server action that:
  1. re-reads the product;
  2. creates a draft copy with fresh SKUs and handle;
  3. rebuilds options and variants through the existing option-plan helper;
  4. copies each variant's price;
  5. redirects to the copy.

  Stock is not copied, matching Shopify's default.

- **Preview** links to `${STOREFRONT_URL}/products/<handle>`. It shows for published or unlisted products only, and only when `STOREFRONT_URL` is set.
  - The product page (a server component) reads `process.env["STOREFRONT_URL"]` **at request time**, and passes it to the editor as a prop.
  - It is **not** a `NEXT_PUBLIC_` variable. Those are inlined at build time, and the admin-web Dockerfile passes no build args, so one would always be empty in production.

**Tech Stack:** Next.js 15, React 19, `@platform/ui` (`Badge`, `Button`, `DropdownMenu`), Tailwind logical classes, vitest + Testing Library.

**Spec:** owner's Shopify screenshots, 2026-10-08/09: the price, inventory and shipping cards; the status dropdown; the sidebar.

## Global Constraints

Same as Plans 2C-2 and 2B-2. Every task implicitly includes these.

### Git and branch

- Branch `morbeh/w0-w17-w12`. No force-push. No `--no-verify`. Never raise the lint warning cap.
- Never stage `.claude/worktrees/`.
- Commit lines at most 100 characters, lowercase subject.
- End every commit with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

### Scope

- **`apps/admin-web` only.** No backend, no migration, no Railway. If a step needs a backend change, **stop and report**.

### App rules

- Runtime API calls happen only from server components and server actions. One idempotency key per call. `toFormState` for every non-`ok` outcome.
- Both message files get every key.
- Logical RTL classes only. The switch thumb must move toward the end in both directions (`rtl:` variants).

### Accessibility

- `Switch` is `<input type="checkbox" role="switch">`, with a visible label.
- Chips are `<button type="button" aria-expanded aria-controls>`.
- `StatusPicker` is keyboard operable; Radix `DropdownMenu` gives this.
- `jsx-a11y` must stay clean. **No `autoFocus`**; use a one-shot focus ref, as in `options-editor.tsx`.

### Commands

- `pnpm.cmd --filter admin-web run test|typecheck|lint`. Never run a full typecheck and a full test suite at the same time.
- No new lint warnings.

---

## File Structure

All paths are under `apps/admin-web/src/`.

- **`components/products/editor/controls.tsx`** (new) and **`controls.test.tsx`**: the primitives.
- **`components/products/editor/pricing-card.tsx`, `inventory-card.tsx`, `shipping-card.tsx`:** restyled with chips and switches; same field names.
- **`components/products/editor/variants-card.tsx`:** the variant dialog restyled the same way.
- **`components/products/editor/status-card.tsx`:** `StatusPicker`.
- **`components/products/editor/organization-card.tsx`:** the vendor text field (with a datalist of brands) and `TagsInput`.
- **`components/products/editor/product-editor.tsx`:** the header actions (Preview, Duplicate).
- **`app/products/actions.ts`:** `vendor` handling in save and create; `duplicateProductAction`.
- **`messages/en.ts`, `messages/ar.ts`:** Shopify wording.

---

### Task 1: The primitives

**Files:**

- Create: `components/products/editor/controls.tsx`, `components/products/editor/controls.test.tsx`

**Interfaces:**

- **`Switch`** `({ name?, label, checked?, defaultChecked?, onCheckedChange?, form?, id? })`: a checkbox with `role="switch"`.
- **`ChipRow`** `({ children })` and **`Chip`** `({ label, value?, expanded, onToggle, controls })`.
  - `value` renders after a middle dot: "فرض ضريبة · نعم".
- **`MoneyInput`** `({ name, currency, locale, value, onValueChange, form, invalid, describedBy, id, label })`: a decimal input with the currency symbol as a non-editable prefix.
  - Get the symbol with `new Intl.NumberFormat(locale, { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value`.
  - The prefix sits at the **start** (`ps-` padding).
- **`TagsInput`** `({ name, defaultTags, form, label, hint, removeLabel })`:
  - typing then Enter or a comma (`,` or the Arabic `،`) adds a chip;
  - Backspace in an empty input removes the last chip;
  - each chip has a ✕ (`aria-label` = `removeLabel` with the tag);
  - one hidden `<input name={name} form={form} value={tags.join(", ")}>`.
- **`StatusPicker`** `({ name, value, onChange?, options: { value; label; description }[], form, label })`:
  - a `DropdownMenu`, whose trigger shows the current label;
  - each item shows its label, its description, and a check on the current one;
  - a hidden `<input name={name} form={form} value={current}>`.

- [ ] **Step 1: Write the failing tests** (`controls.test.tsx`)

1. **Switch.** It toggles and is submitted as `"on"` when on. Its role is `switch` and it has a label. Render it inside a `<form>`, and read `new FormData(form)`.
2. **Chip.**
   - The panel it controls is **mounted and hidden** until clicked. Assert that `hidden` is set and that the input inside the panel is still in `FormData`.
   - Clicking sets `aria-expanded="true"` and unhides the panel.
3. **MoneyInput.** With `currency="EGP"` and `locale="ar"`, it shows the symbol `formatToParts` gives. Do not hard-code it; compute the expectation the same way. With `"USD"` and `"en"`, it shows `$`.
4. **TagsInput.**
   - `"summer"` + Enter, then `"sale,"`, makes two chips, and the hidden value is `"summer, sale"`.
   - Backspace on the empty input removes `"sale"`.
   - `"أ،"` adds `"أ"` (Arabic comma).
   - Duplicates are ignored, case-insensitively, as the backend normalizes them.
5. **StatusPicker.**
   - Opening it shows three items with their descriptions.
   - Choosing "Unlisted" updates the trigger and the hidden input.
   - The current item is marked (`aria-checked` or a check icon with an sr-only "selected").

- [ ] **Step 2: Run, expect failure.** `pnpm.cmd --filter admin-web exec vitest run src/components/products/editor/controls.test.tsx`

- [ ] **Step 3: Implement**

**`Switch`:**

```tsx
export function Switch({ label, className, onCheckedChange, ...props }: SwitchProps) {
  const id = useId();
  return (
    <label
      htmlFor={props.id ?? id}
      className={cn("flex cursor-pointer items-center gap-2 text-sm", className)}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="relative inline-flex">
        <input
          id={props.id ?? id}
          type="checkbox"
          role="switch"
          className="peer sr-only"
          onChange={(event) => onCheckedChange?.(event.target.checked)}
          {...props}
        />
        <span className="bg-muted peer-checked:bg-foreground peer-focus-visible:ring-ring h-5 w-9 rounded-full transition-colors peer-focus-visible:ring-2" />
        <span className="bg-background absolute start-0.5 top-0.5 size-4 rounded-full shadow transition-transform peer-checked:translate-x-4 rtl:peer-checked:-translate-x-4" />
      </span>
    </label>
  );
}
```

**`Chip`:**

```tsx
export function Chip({ label, value, expanded, onToggle, controls }: ChipProps) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      className={cn(
        "border-border inline-flex h-7 items-center gap-1 rounded-full border px-3 text-xs",
        expanded ? "bg-muted" : "bg-card hover:bg-muted",
      )}
    >
      <span>{label}</span>
      {value !== undefined && <span className="text-muted-foreground">· {value}</span>}
    </button>
  );
}
```

`ChipRow` is a `div` with `flex flex-wrap gap-2 border-t pt-3`.

**`MoneyInput`.** Wrap an `Input` in a `relative` div; render the prefix in an `absolute start-3` span, and give the input `ps-10`. Use `inputMode="decimal"`, `dir="ltr"` for the digits, and `text-end` in RTL contexts the same way the current price inputs do. Copy their alignment; do not invent one.

**`TagsInput`.** It holds `tags: string[]` and `draft: string` in state. `commit()` trims, then splits on `,` and `،`, then dedupes case-insensitively against the existing tags. Enter calls `preventDefault()`, so it never submits the page.

**`StatusPicker`:**

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button type="button" variant="outline" className="w-full justify-between" aria-label={label}>
      {currentOption.label}
      <ChevronDownIcon aria-hidden="true" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="start" className="w-72">
    {options.map((option) => (
      <DropdownMenuItem key={option.value} onSelect={() => choose(option.value)} aria-checked={option.value === current} role="menuitemradio">
        <CheckIcon aria-hidden="true" className={cn("size-4", option.value === current ? "opacity-100" : "opacity-0")} />
        <span className="flex flex-col">
          <span className="font-medium">{option.label}</span>
          <span className="text-muted-foreground text-xs">{option.description}</span>
        </span>
      </DropdownMenuItem>
    ))}
  </DropdownMenuContent>
</DropdownMenu>
<input type="hidden" name={name} form={form} value={current} />
```

If Radix's menu content does not render under jsdom without pointer events, follow how other admin-web tests open a `DropdownMenu` (for example `account-menu`'s test). Use `fireEvent.pointerDown` followed by `keyDown`, as they do.

- [ ] **Step 4: Run.** The same command, then `… run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/components/products/editor/controls.tsx apps/admin-web/src/components/products/editor/controls.test.tsx
git commit -m "feat(admin-web): add shopify-style switch, chips, money, tags and status controls"
```

---

### Task 2: Price, inventory, shipping and the variant dialog in the Shopify layout

**Files:**

- Modify: `components/products/editor/pricing-card.tsx` (+ test)
- Modify: `components/products/editor/inventory-card.tsx` (+ test)
- Modify: `components/products/editor/shipping-card.tsx`
- Modify: `components/products/editor/variants-card.tsx` (the dialog only) (+ test)

**Layout** (match the screenshots):

**Pricing card**, titled `t.productEditor.pricingCard`:

1. `MoneyInput` for `price`, full width.
2. A `ChipRow` with three chips:
   - **compare-at:** value = the formatted compare-at price, when set;
   - **charge tax:** value = Yes / No;
   - **cost per item:** value = the formatted cost, when set.
3. One panel per chip:
   - **compare-at:** the `compareAtPrice` `MoneyInput` and its hint;
   - **charge tax:** `Switch name="taxable"`;
   - **cost:** the `costPerItem` `MoneyInput`, plus profit and margin, the existing computation.
4. The currency `NativeSelect` moves into a small trailing control next to the price, with the visible label `t.productEditor.currency`. Keep `name="currency"`.

**Inventory card:**

1. **Header:** the title on one side and `Switch name="tracksInventory"` (label "المخزون مُتتبَّع" / "Inventory tracked") on the other, as in the screenshot.
2. **When tracked:** a bordered mini-table with a header row (`t.productEditor.quantity`) and one row: the location name, plus the `available` number input, or the read-only value with its note.
3. **A `ChipRow`:**
   - **SKU:** value = the SKU, or "—";
   - **barcode:** value = the barcode;
   - **sell when out of stock:** value = On / Off (`t.productEditor.on` / `off`).
4. **Their panels:**
   - `sku`;
   - `barcode`;
   - `Switch name="continueSelling"`.
5. When "track" is off, the quantity table and the continue-selling chip are hidden (still mounted).

**Shipping card:**

- the header holds the title plus `Switch name="requiresShipping"` (`t.productEditor.physicalProduct`);
- when on, the weight row: number + `NativeSelect weightUnit` g / kg (the current behaviour, restyled);
- when off, the hint `t.productEditor.notPhysicalHint` ("Customers won't enter a shipping address…" / "الزبون مش هيدخل عنوان شحن للمنتج ده").

**Variant dialog:** the same three blocks, in the same order (price + chips, inventory + chips, shipping), with the same field names it has today.

**Chips open by default** when their field has a non-default value:

- a compare-at or cost is set;
- tax is off;
- a SKU or barcode is set;
- continue-selling is on.

So a merchant never has a value they cannot see. Compute this once, from the initial values.

- [ ] **Step 1: Update the tests first**

1. **Pricing.** Profit and margin show once the cost chip is open. The compare-at input is **in `FormData`** even when its chip is closed.
2. **Inventory.**
   - Switching tracking off hides the quantity table, and `FormData` has no `tracksInventory`.
   - The chips show the SKU's value.
   - The `continueSelling` switch is inside the "sell when out of stock" panel.
3. **Dialog.** Every field name it posted before is still posted. Use the existing `updateVariantDetailsAction` expectations unchanged.
4. **Initial state.** A variant with a cost renders the cost chip expanded.

- [ ] **Step 2: Run, expect failure.** `pnpm.cmd --filter admin-web exec vitest run src/components/products/editor`

- [ ] **Step 3: Implement**, as specified above.

**Do not change any `name`.** Run `app/products/actions.test.ts` too: it must pass untouched.

- [ ] **Step 4: Run.** `… exec vitest run src/components/products src/app/products`, then `… run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/components/products/editor
git commit -m "feat(admin-web): compact price, inventory and shipping cards with chips and switches"
```

---

### Task 3: Sidebar (status picker, vendor, tags) and actions

**Files:**

- Modify: `components/products/editor/status-card.tsx` (+ test)
- Modify: `components/products/editor/organization-card.tsx`
- Modify: `app/products/actions.ts`, `app/products/actions.test.ts`

**Interfaces:**

- **Form field `vendor`** (text) replaces `brandId`.
- **`resolveVendor(vendor: string, brands: readonly BrandDto[])`**, in `lib/products/vendor.ts` (new, pure): returns `{ kind: "none" } | { kind: "existing"; brandId } | { kind: "new"; name; slug }`.
  - `slug` is `handleFromTitle(name)`, or `brand-<randomToken(6)>` when that is empty.
  - Matching is case-insensitive, on trimmed names.

- [ ] **Step 1: Write the failing tests**

**`lib/products/vendor.test.ts`:**

1. `""` → `none`.
2. `" acme toys "` with the brand "Acme Toys" → `existing`.
3. `"Nile Kids"` → `new`, with slug `"nile-kids"`.
4. `"شركة النيل"` → `new`, with slug matching `/^brand-[a-z0-9]{6}$/`.

**`actions.test.ts`** (add cases; mock `@/lib/api/brands`):

1. **Save with an existing vendor.** `vendor="acme toys"` while the product's brand is Acme makes **no** brand call. `vendor="Nile Kids"` calls `createBrand({ name: "Nile Kids", slug: "nile-kids" })`, then `setProductBrand(productId, <new id from data.brandId or data.id>)`.

   Read the actual create-brand response shape from `apps/admin`'s brand route, and use that field.

2. **Save with a blank vendor** on a product that has a brand calls `setProductBrand(productId, null)`.
3. **Create.** `createProductAction` follows the same vendor rules.
4. **Brand conflict.** If `createBrand` returns a `conflict` (the slug exists under another spelling), re-fetch the brands once, use the brand whose slug matches, and otherwise return the error on `vendor`.

**`status-card.test.tsx`:** update it for `StatusPicker`. It still offers exactly published / draft / unlisted, and is still locked for archived or scheduled products.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

**Organization card:**

- `vendor`: `Input` with `list` pointing at a `<datalist>` of the brand names; its default is the current brand's name;
- **type:** unchanged;
- **categories:** unchanged checkboxes;
- **tags:** `TagsInput name="tags"`.

**Status card:** `StatusPicker name="status"`, with the three options and their descriptions (`statusPublishedHint` etc.). Keep the locked state.

**Actions:** replace the `brandId` parsing in both `saveProductAction` and `createProductAction` with `vendor` + `resolveVendor`. Brands come from `fetchBrandsPage({ first: 100 })`, called only when `vendor` is not blank.

The brand step stays **in the same position** in the save order.

- [ ] **Step 4: Run.** `… exec vitest run src/lib/products src/app/products src/components/products`, then `… run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src
git commit -m "feat(admin-web): status picker with descriptions, free-text vendor and tag chips"
```

---

### Task 4: Header actions (Preview, Duplicate) and Shopify wording

**Files:**

- Modify: `components/products/editor/product-editor.tsx` (+ test)
- Modify: `app/products/actions.ts` (+ test): `duplicateProductAction`
- Modify: `app/products/[productId]/page.tsx` (only if the header lives there; put the actions next to the title)
- Modify: `messages/en.ts`, `messages/ar.ts`

**Interfaces:**

- **`duplicateProductAction(prev, formData)`:** `productId` in; redirects to `/products/<newId>`.
- **The header** shows:
  - **Preview:** an `<a target="_blank" rel="noopener noreferrer">` with an external-link icon;
  - **Duplicate:** a small form with a hidden `productId` and a submit button, rendered **outside** the editor form;
  - the existing "More actions".

- [ ] **Step 1: Write the failing tests**

1. **Preview link.** Its `href` is `${storefrontUrl}/products/<slug>` (the prop) for published and unlisted products. It is absent for draft, and absent when `storefrontUrl` is `null`. A trailing slash on the URL must not double the `/`.
2. **`duplicateProductAction`, single-variant product.** It calls `createProduct` with:
   - `name` = `t.productEditor.copyOf` with the name substituted;
   - `slug` = `<slug>-copy`;
   - a new product SKU;
   - the variant's price and attributes;
   - status left as draft.

   It then redirects to the new product.

3. **Multi-variant product.** After creating, it fetches the copy, then applies a `planOptionChange` from the copy's single variant to the source's options, via the same helper `saveProductAction` uses. Then it prices each new row from the source variant with the same `rowKey`.
4. **Slug conflict.** A conflict on `-copy` retries once with `-copy-<token>`.
5. **Details are copied:** description, type, tags, brand, categories and SEO. Media ids are copied. Stock is **not**.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement.** Reuse `applyOptionPlan` and the row pricing from `saveProductAction`; extract them into shared functions in `actions.ts` if they are not already. Then re-fetch to get variant ids, as `createProductAction` does.

**Messages.** Set these, in both files. The Arabic follows Shopify's own Arabic wording, which the owner uses daily.

| key                   | en                                                  | ar                                            |
| --------------------- | --------------------------------------------------- | --------------------------------------------- |
| `pricingCard`         | Price                                               | السعر                                         |
| `compareAtPrice`      | Compare-at price                                    | السعر المقارن                                 |
| `chargeTax`           | Charge tax                                          | فرض ضريبة                                     |
| `costPerItem`         | Cost per item                                       | التكلفة لكل عنصر                              |
| `yes`                 | Yes                                                 | نعم                                           |
| `no`                  | No                                                  | لا                                            |
| `on`                  | On                                                  | تفعيل                                         |
| `off`                 | Off                                                 | إلغاء التفعيل                                 |
| `inventoryCard`       | Inventory                                           | المخزون                                       |
| `inventoryTracked`    | Inventory tracked                                   | المخزون مُتتبَّع                              |
| `quantity`            | Quantity                                            | الكمية                                        |
| `shopLocation`        | Shop location                                       | موقع المتجر                                   |
| `sku`                 | SKU (Stock Keeping Unit)                            | (SKU) رمز التخزين التعريفي                    |
| `barcode`             | Barcode                                             | الرموز الشريطية                               |
| `sellWhenOutOfStock`  | Sell when out of stock                              | البيع عند نفاد المخزون                        |
| `shippingCard`        | Shipping                                            | الشحن                                         |
| `physicalProduct`     | Physical product                                    | منتج مادي                                     |
| `notPhysicalHint`     | Customers won't enter shipping details at checkout. | الزبون مش هيدخل عنوان شحن عند الدفع.          |
| `weight`              | Weight                                              | الوزن                                         |
| `statusCard`          | Status                                              | الحالة                                        |
| `statusPublishedHint` | Sell via selected sales channels and markets        | البيع عبر قنوات المبيعات والأسواق المحددة     |
| `statusDraftHint`     | Not visible on selected sales channels or markets   | غير مرئي في قنوات المبيعات أو الأسواق المحددة |
| `statusUnlistedHint`  | Only accessible via a direct link                   | يمكن الوصول إليه فقط عن طريق رابط مباشر       |
| `organizationCard`    | Product organization                                | تنظيم المنتجات                                |
| `productType`         | Type                                                | النوع                                         |
| `brand`               | Vendor                                              | المورّد                                       |
| `tags`                | Tags                                                | العلامات                                      |
| `removeTag`           | Remove {tag}                                        | احذف {tag}                                    |
| `seoCard`             | Search engine listing                               | قائمة محرك البحث                              |
| `variantsCard`        | Variants                                            | المتغيرات                                     |
| `addOptions`          | Add options like size or color                      | إضافة خيارات مثل المقاس أو اللون              |
| `preview`             | Preview                                             | معاينة                                        |
| `duplicate`           | Duplicate                                           | نسخ                                           |
| `copyOf`              | Copy of {name}                                      | نسخة من {name}                                |

`productStatus.published` stays "Active" / "نشط". Keep the other keys, and remove only keys that end up unused (grep first).

- [ ] **Step 4: Run, sequentially**

1. `pnpm.cmd --filter admin-web run test`
2. `pnpm.cmd --filter admin-web run typecheck`
3. `pnpm.cmd --filter admin-web run lint`

Expected: PASS, with no new warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src
git commit -m "feat(admin-web): add preview and duplicate, use shopify's wording in both languages"
```

---

### Task 5: Docs, gates, push

- [ ] **Step 1: Gaps** (`docs/KNOWN_GAPS.md` and `docs/architecture/23-platform-gap-register.md`)

Open, **Low** each:

- "Rich-text description (needs an HTML sanitizer in the storefront)";
- "Shipping packages and packed dimensions";
- "Shopify standard product taxonomy (category) and category metafields";
- "Sales channels / publishing";
- "Duplicate does not copy stock."

- [ ] **Step 2: Gates, sequentially**

1. `pnpm.cmd --filter admin-web run test`
2. `pnpm.cmd -r --no-bail run typecheck`
3. `pnpm.cmd -r --no-bail run lint`
4. `pnpm.cmd arch`

- [ ] **Step 3: Commit and push**

```bash
git add docs/KNOWN_GAPS.md docs/architecture/23-platform-gap-register.md docs/superpowers/plans/2026-10-09-shopify-look.md
git commit -m "docs(admin-web): record plan 2c-4"
git push origin morbeh/w0-w17-w12
```

---

## Done criteria

- **Price card:** shows only the price, with chips for compare-at, charge tax and cost. Each chip shows its value and opens its field.
- **Inventory card:** has the "Inventory tracked" switch, a quantity table with the location name, and chips for SKU, barcode and sell-when-out-of-stock.
- **Shipping card:** has the "Physical product" switch and the weight.
- **Status:** a menu with descriptions. **Vendor:** typed freely. **Tags:** chips.
- **Header:** Preview opens the product in the store, and Duplicate makes a draft copy with its variants.
- **Arabic:** every label uses Shopify's Arabic wording.
- **No field name changed** except `brandId` → `vendor`. The save and create actions still pass every earlier test.

## Report back

In Arabic for the owner:

- the task → commit → tests table;
- what to click to try it;
- every rewritten test;
- anything you decided that this plan did not.

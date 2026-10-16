# Shopify Product Editor (Plan 2C-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ملخص للمالك (بالعربي):** الخطة 2C-1 حطّت بيانات المنتج في السيرفر. الخطة دي بتعمل **شاشة المنتج نفسها زي شوبيفاي**: صفحة واحدة، وفيها زرار **حفظ** واحد.
>
> | الكارت         | فيه إيه                                                                                                   |
> | -------------- | --------------------------------------------------------------------------------------------------------- |
> | العنوان والوصف | اسم المنتج، ووصف بأكتر من سطر                                                                             |
> | السعر          | السعر **بالجنيه/الدولار عادي** (`150.50`)، والسعر قبل الخصم، والتكلفة، و**الربح والهامش بيتحسبوا لوحدهم** |
> | المخزون        | الـ SKU والباركود                                                                                         |
> | الشحن          | "منتج مادي" والوزن (جرام أو كيلو)                                                                         |
> | المتغيّرات     | تكتب "المقاس: S, M, L" و**المتغيّرات بتتعمل لوحدها**، وتعدّل أي واحد بضغطة                                |
> | محرّك البحث    | عنوان ووصف لجوجل، ورابط المنتج                                                                            |
> | الجنب: الحالة  | نشط / مسودة / غير مدرج                                                                                    |
> | الجنب: التنظيم | النوع، والماركة، والفئات، والـ tags                                                                       |
>
> **إضافة منتج جديد** هتبقى بنفس الشكل. الـ SKU والرابط بيتعملوا لوحدهم لو سبتهم فاضيين.
>
> **مش في الخطة دي:** رفع الصور من جهازك (محتاج تخزين صور، Cloudflare R2، خطة 2C-3)، والكمية لكل مقاس (خطة 2B).

**Goal:** Replace the admin Products detail and create screens with a single-page, single-save editor modelled on Shopify's product page. It covers decimal prices, every Plan 2C-1 field, the status select (including Unlisted) and an option editor that generates the variant matrix.

**Architecture:**

- **One form, one Save.** A `<form id="product-editor">` holds no children of its own. Every editable input in the "form cards" joins it with the HTML `form="product-editor"` attribute. This lets cards that own their own forms (variants, media, stock) sit between them **without nesting forms**, which is invalid HTML.
- **A composite server action, `saveProductAction`**, re-reads the product server-side, then calls only the endpoints whose values changed, in a fixed order: details → variant → SEO → brand → categories → status.
  - It stops at the first failure and reports it.
  - Everything before the failure stays saved, and the page revalidates to show it.
  - Every call is idempotent, so saving again is safe.
- **Prices are typed in major units.** `toMinorUnits` and `fromMinorUnits` use the currency's own exponent (EGP 2, JPY 0, KWD 3), with no floating point. They accept Arabic-Indic digits.
- **The option editor uses a pure planner, `planOptionChange`.** It turns "current variants + new options" into an ordered list of API operations (remove → clear → set options → assign → add):
  - every intermediate state passes the Plan 2C-1 domain rules;
  - existing variants keep their ids (and with them cart lines and stock), and are re-assigned rather than recreated wherever possible;
  - the client runs the same planner to preview "adds N, removes M" before saving.
- **SKUs and handles are generated when left blank**, because the domain still requires them (G-98): `P-XXXXXX` for the product, `<product SKU>-<values>` for variants, and an ASCII handle from the title (or `product-xxxxxx` for an Arabic title).
- **No backend change.** Everything this needs exists since Plan 2C-1.

**Tech Stack:** Next.js 15 (App Router, server actions, `useActionState`), React 19, `@platform/ui` (Radix dialog, inputs, cards), vitest + Testing Library.

**Spec:**

- [PLATFORM-MASTER-PLAN.md](../../plans/PLATFORM-MASTER-PLAN.md): Phase 1 unit 1 (Catalog).
- [2026-10-08-product-details.md](2026-10-08-product-details.md): the fields this screen edits.
- Owner's Shopify screenshots, 2026-10-08:
  - add-product page layout;
  - status select (Active / Draft / Unlisted);
  - price, inventory and shipping cards;
  - variants "add options like size or color".
- Gaps G-97 and G-98 (opened by Plan 2C-1).

## Global Constraints

Same as Plans 1A to 2C-1. Every task implicitly includes these.

### Git and branch

- Branch `morbeh/w0-w17-w12`. No force-push. No `--no-verify`. Never raise the lint warning cap.
- Never stage `.claude/worktrees/`.
- Commit lines at most 100 characters, lowercase subject.
- End every commit with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

### Scope

- **`apps/admin-web` only.** No change to `apps/admin`, `services/*` or `packages/db`. If a step seems to need a backend change, **stop and report**.
- No database, no migration, no Railway change.

### Rules this app already enforces

- Never call the runtime API from browser JS. Every read and write goes through `lib/api/*` from server components or server actions.
- Every write mints one `newIdempotencyKey()` per API call.
- Every non-`ok` outcome goes through `toFormState`. Never show a raw error message.
- Both `messages/en.ts` and `messages/ar.ts` get every new key. `ar` must satisfy `Dictionary`.
- RTL: use logical classes (`ms-`/`me-`/`ps-`/`pe-`/`start`/`end`), never `ml-`/`mr-`/`left`/`right`. Directional icons get `rtl:-scale-x-100`.
- **Description is plain text** (`<textarea>`). No rich text, no `dangerouslySetInnerHTML`.

### Commands

- `pnpm.cmd --filter admin-web run test|typecheck|lint`. Never run a full typecheck and a full test suite at the same time.
- No new lint warnings. No `async` without `await`.

---

## File Structure

All paths are under `apps/admin-web/src/`.

### New pure helpers (`lib/products/`)

- **`money.ts`:** `currencyExponent`, `toMinorUnits`, `fromMinorUnits`, `SUPPORTED_CURRENCIES`.
- **`handles.ts`:** `handleFromTitle`, `randomToken`, `fallbackHandle`, `generateProductSku`, `variantSkuFor`.
- **`variant-matrix.ts`:** `combinations`, `sameSelection`, `planOptionChange`, `MAX_VARIANTS`, `MAX_OPTIONS`.

Each has a `*.test.ts` beside it.

### API client

- **`lib/api/products.ts`:**
  - the DTO fields from Plan 2C-1;
  - `updateProduct` accepts details;
  - variant inputs accept attributes;
  - `unlistProduct`.

### Server actions

- **`app/products/actions.ts`:**
  - new: `saveProductAction`, `createProductAction` (rewritten), `saveProductOptionsAction`, `updateVariantDetailsAction`;
  - kept: `removeProductVariantAction`, the schedule, archive and delete actions, and the media actions;
  - removed: `updateProductAction`, `setProductSeoAction`, `setProductBrandAction`, `assignProductCategoriesAction`, `setProductOptionsAction`, `addProductVariantAction`, `updateProductVariantAction`, `publishProductAction` and `unpublishProductAction`.
- **`app/products/actions.test.ts`** (new).

### Editor UI (`components/products/editor/`)

- **`product-editor.tsx`:** the client shell. It owns the hidden form, the sticky save bar and the two-column grid.
- **`title-description-card.tsx`, `pricing-card.tsx`, `inventory-identifiers-card.tsx`, `shipping-card.tsx`, `seo-card.tsx`, `status-card.tsx`, `organization-card.tsx`:** the form cards.
- **`variants-card.tsx`:** its own forms. It holds the option editor, the variants table and the edit dialog.
- **`field.tsx`:** the shared label + input + error row, plus `NativeSelect`, `NativeTextarea`, `CheckboxRow`, `rename-field-errors`.
- One `*.test.tsx` per card that has logic: pricing, variants, status, and the editor shell.

### Pages and kept components

- **`app/products/[productId]/page.tsx`, `app/products/new/page.tsx`:** render `ProductEditor`.
- **`components/products/product-media-card.tsx`:** the media half of `product-media-seo-card.tsx`. That file is then deleted.
- **`components/products/product-lifecycle-actions.tsx`:** only schedule, archive and delete remain.
- **`components/products/product-status-badge.tsx`:** `unlisted`.
- **Deleted:** `product-edit-form.tsx`, `product-create-form.tsx` (+test), `product-organization-card.tsx`, `product-variants-card.tsx` (+test), `product-media-seo-card.tsx`.
- **`messages/en.ts`, `messages/ar.ts`:** a `productEditor` section and `productStatus.unlisted`.

---

### Task 1: Pure helpers (money, handles, variant matrix)

**Files:**

- Create: `lib/products/money.ts`, `lib/products/money.test.ts`
- Create: `lib/products/handles.ts`, `lib/products/handles.test.ts`
- Create: `lib/products/variant-matrix.ts`, `lib/products/variant-matrix.test.ts`

**Interfaces:**

- **Money:**
  - `currencyExponent(currency: string): number`;
  - `toMinorUnits(text: string, currency: string): number | null`;
  - `fromMinorUnits(minor: number, currency: string): string`;
  - `SUPPORTED_CURRENCIES: readonly string[]`.
- **Handles:**
  - `handleFromTitle(title: string): string`;
  - `randomToken(length: number): string`;
  - `fallbackHandle(): string`;
  - `generateProductSku(): string`;
  - `variantSkuFor(productSku: string, values: readonly string[], taken: ReadonlySet<string>): string`.
- **Variant matrix:**
  - `MatrixOption`, `MatrixVariant`, `MatrixOperation`, `OptionPlan`;
  - `combinations(options)`;
  - `sameSelection(a, b)`;
  - `planOptionChange({ productSku, variants, nextOptions })`;
  - `MAX_VARIANTS = 100`, `MAX_OPTIONS = 3`.

- [ ] **Step 1: Write the failing tests**

`money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { currencyExponent, fromMinorUnits, toMinorUnits } from "./money";

describe("money (Plan 2C-2)", () => {
  it("knows each currency's minor-unit exponent", () => {
    expect(currencyExponent("EGP")).toBe(2);
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
  });

  it("parses a typed amount into minor units without floating point", () => {
    expect(toMinorUnits("150", "EGP")).toBe(15000);
    expect(toMinorUnits("150.5", "EGP")).toBe(15050);
    expect(toMinorUnits("0.29", "USD")).toBe(29); // 0.29 * 100 is 28.999… in floats
    expect(toMinorUnits(" 1,250.75 ", "USD")).toBe(125075);
    expect(toMinorUnits("١٥٠٫٥", "EGP")).toBe(15050); // Arabic-Indic digits and separator
    expect(toMinorUnits("12.345", "KWD")).toBe(12345);
    expect(toMinorUnits("500", "JPY")).toBe(500);
  });

  it("rejects what is not a non-negative amount within the currency's decimals", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1.2.3", "1e3", "."]) {
      expect(toMinorUnits(bad, "EGP"), bad).toBeNull();
    }
    expect(toMinorUnits("5.5", "JPY")).toBeNull();
  });

  it("formats minor units back for an input's default value", () => {
    expect(fromMinorUnits(15050, "EGP")).toBe("150.50");
    expect(fromMinorUnits(29, "USD")).toBe("0.29");
    expect(fromMinorUnits(500, "JPY")).toBe("500");
    expect(fromMinorUnits(12345, "KWD")).toBe("12.345");
  });
});
```

`handles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fallbackHandle, generateProductSku, handleFromTitle, variantSkuFor } from "./handles";

describe("handles and SKUs (Plan 2C-2)", () => {
  it("derives a Shopify-style ASCII handle from a title", () => {
    expect(handleFromTitle("Plush Teddy Bear")).toBe("plush-teddy-bear");
    expect(handleFromTitle("  Café — Crème! 2026 ")).toBe("cafe-creme-2026");
    expect(handleFromTitle("قميص قطن")).toBe(""); // the caller falls back
  });

  it("falls back to product-<token> and generates P-<TOKEN> product SKUs", () => {
    expect(fallbackHandle()).toMatch(/^product-[a-z0-9]{6}$/);
    expect(generateProductSku()).toMatch(/^P-[A-Z0-9]{6}$/);
  });

  it("builds variant SKUs from option values, unique against taken SKUs", () => {
    expect(variantSkuFor("P-ABC123", ["Red", "L"], new Set())).toBe("P-ABC123-RED-L");
    expect(variantSkuFor("P-ABC123", ["أحمر"], new Set())).toBe("P-ABC123-V1");
    expect(variantSkuFor("P-ABC123", ["L"], new Set(["P-ABC123-L"]))).toBe("P-ABC123-L-2");
  });
});
```

`variant-matrix.test.ts`. Write a helper that **applies** a plan to an in-memory copy of the product, enforcing the same rules the backend enforces:

- at least one variant;
- no two equal non-null selections;
- a selection only uses declared options and values;
- `setOptions` is refused while a variant holds a value it removes.

Then assert the final state. This is how the test proves every intermediate step is legal.

```ts
import { describe, expect, it } from "vitest";
import {
  MAX_VARIANTS,
  combinations,
  planOptionChange,
  sameSelection,
  type MatrixOperation,
  type MatrixOption,
  type MatrixVariant,
} from "./variant-matrix";

interface State {
  options: MatrixOption[];
  variants: { id: string; sku: string; selection: Record<string, string> | null }[];
}

/** Applies a plan with the backend's invariants; throws on the first illegal step. */
function apply(start: State, operations: readonly MatrixOperation[]): State {
  const state: State = structuredClone(start);
  const allowed = (selection: Record<string, string>) =>
    Object.entries(selection).every(([name, value]) =>
      state.options.some((o) => o.name === name && o.values.includes(value)),
    );
  let next = 0;
  for (const op of operations) {
    if (op.kind === "remove") {
      if (state.variants.length <= 1) throw new Error("would remove the last variant");
      state.variants = state.variants.filter((v) => v.id !== op.variantId);
    } else if (op.kind === "setOptions") {
      state.options = op.options.map((o) => ({ name: o.name, values: [...o.values] }));
      for (const v of state.variants) {
        if (v.selection !== null && !allowed(v.selection)) {
          throw new Error(`setOptions while ${v.id} holds a removed value`);
        }
      }
    } else if (op.kind === "assign") {
      if (op.selection !== null) {
        if (!allowed(op.selection)) throw new Error("assign to an undeclared value");
        if (
          state.variants.some(
            (v) =>
              v.id !== op.variantId &&
              v.selection !== null &&
              sameSelection(v.selection, op.selection!),
          )
        ) {
          throw new Error("assign a duplicate selection");
        }
      }
      const target = state.variants.find((v) => v.id === op.variantId);
      if (target === undefined) throw new Error("assign to a missing variant");
      target.selection = op.selection;
    } else {
      if (!allowed(op.selection)) throw new Error("add with an undeclared value");
      if (
        state.variants.some((v) => v.selection !== null && sameSelection(v.selection, op.selection))
      ) {
        throw new Error("add a duplicate selection");
      }
      state.variants.push({ id: `new-${(next += 1)}`, sku: op.sku, selection: op.selection });
    }
  }
  return state;
}

const v = (id: string, selection: Record<string, string> | null): MatrixVariant => ({
  id,
  sku: `SKU-${id}`,
  selection,
  priceAmountMinor: 1999,
  currency: "USD",
});

describe("variant matrix (Plan 2C-2)", () => {
  it("builds combinations in option order", () => {
    expect(
      combinations([
        { name: "Color", values: ["Red", "Blue"] },
        { name: "Size", values: ["S", "L"] },
      ]),
    ).toEqual([
      { Color: "Red", Size: "S" },
      { Color: "Red", Size: "L" },
      { Color: "Blue", Size: "S" },
      { Color: "Blue", Size: "L" },
    ]);
  });

  it("first options on a plain product: the existing variant takes the first combination", () => {
    const start: State = { options: [], variants: [{ id: "a", sku: "SKU-a", selection: null }] };
    const plan = planOptionChange({
      productSku: "P-1",
      variants: [v("a", null)],
      nextOptions: [{ name: "Size", values: ["S", "M", "L"] }],
    });
    if (!plan.ok) throw new Error(plan.reason);
    const end = apply(start, plan.operations);
    expect(end.variants.map((x) => x.selection)).toEqual([
      { Size: "S" },
      { Size: "M" },
      { Size: "L" },
    ]);
    expect(end.variants[0]?.id).toBe("a"); // id kept: carts and stock still point at it
    expect(plan.summary).toEqual({ adds: 2, removes: 0 });
  });

  it("removing a value removes only the variants that used it", () => {
    const start: State = {
      options: [{ name: "Size", values: ["S", "M", "L"] }],
      variants: [
        { id: "s", sku: "SKU-s", selection: { Size: "S" } },
        { id: "m", sku: "SKU-m", selection: { Size: "M" } },
        { id: "l", sku: "SKU-l", selection: { Size: "L" } },
      ],
    };
    const plan = planOptionChange({
      productSku: "P-1",
      variants: [v("s", { Size: "S" }), v("m", { Size: "M" }), v("l", { Size: "L" })],
      nextOptions: [{ name: "Size", values: ["S", "L"] }],
    });
    if (!plan.ok) throw new Error(plan.reason);
    const end = apply(start, plan.operations);
    expect(end.variants.map((x) => x.id)).toEqual(["s", "l"]);
    expect(plan.summary).toEqual({ adds: 0, removes: 1 });
  });

  it("adding a second option re-assigns existing variants instead of recreating them", () => {
    const start: State = {
      options: [{ name: "Size", values: ["S", "L"] }],
      variants: [
        { id: "s", sku: "SKU-s", selection: { Size: "S" } },
        { id: "l", sku: "SKU-l", selection: { Size: "L" } },
      ],
    };
    const plan = planOptionChange({
      productSku: "P-1",
      variants: [v("s", { Size: "S" }), v("l", { Size: "L" })],
      nextOptions: [
        { name: "Size", values: ["S", "L"] },
        { name: "Color", values: ["Red", "Blue"] },
      ],
    });
    if (!plan.ok) throw new Error(plan.reason);
    const end = apply(start, plan.operations);
    expect(end.variants).toHaveLength(4);
    expect(end.variants.find((x) => x.id === "s")?.selection).toEqual({ Size: "S", Color: "Red" });
    expect(end.variants.find((x) => x.id === "l")?.selection).toEqual({ Size: "L", Color: "Red" });
  });

  it("removing every option leaves one plain variant", () => {
    const start: State = {
      options: [{ name: "Size", values: ["S", "L"] }],
      variants: [
        { id: "s", sku: "SKU-s", selection: { Size: "S" } },
        { id: "l", sku: "SKU-l", selection: { Size: "L" } },
      ],
    };
    const plan = planOptionChange({
      productSku: "P-1",
      variants: [v("s", { Size: "S" }), v("l", { Size: "L" })],
      nextOptions: [],
    });
    if (!plan.ok) throw new Error(plan.reason);
    const end = apply(start, plan.operations);
    expect(end.options).toEqual([]);
    expect(end.variants).toEqual([{ id: "s", sku: "SKU-s", selection: null }]);
  });

  it("new variants copy the first variant's price and get unique SKUs", () => {
    const plan = planOptionChange({
      productSku: "P-1",
      variants: [v("a", null)],
      nextOptions: [{ name: "Size", values: ["S", "M"] }],
    });
    if (!plan.ok) throw new Error(plan.reason);
    const adds = plan.operations.filter((op) => op.kind === "add");
    expect(adds).toEqual([
      {
        kind: "add",
        sku: "P-1-M",
        selection: { Size: "M" },
        priceAmountMinor: 1999,
        currency: "USD",
      },
    ]);
  });

  it("refuses too many combinations, more than three options, and blank or duplicate values", () => {
    const many = Array.from({ length: 11 }, (_, i) => `v${i}`);
    expect(
      planOptionChange({
        productSku: "P-1",
        variants: [v("a", null)],
        nextOptions: [
          { name: "A", values: many },
          { name: "B", values: many },
        ],
      }),
    ).toEqual({ ok: false, reason: "too_many_variants" });
    expect(MAX_VARIANTS).toBe(100);
    for (const nextOptions of [
      [
        { name: "A", values: ["x"] },
        { name: "B", values: ["x"] },
        { name: "C", values: ["x"] },
        { name: "D", values: ["x"] },
      ],
      [{ name: " ", values: ["x"] }],
      [{ name: "A", values: ["x", "x"] }],
      [
        { name: "A", values: ["x"] },
        { name: "a", values: ["y"] },
      ],
    ]) {
      expect(
        planOptionChange({ productSku: "P-1", variants: [v("a", null)], nextOptions }),
      ).toEqual({
        ok: false,
        reason: "invalid_options",
      });
    }
  });

  it("no change produces no operations", () => {
    const plan = planOptionChange({
      productSku: "P-1",
      variants: [v("s", { Size: "S" }), v("l", { Size: "L" })],
      nextOptions: [{ name: "Size", values: ["S", "L"] }],
    });
    expect(plan).toEqual({
      ok: true,
      operations: [{ kind: "setOptions", options: [{ name: "Size", values: ["S", "L"] }] }],
      summary: { adds: 0, removes: 0 },
    });
  });
});
```

The last case keeps exactly one `setOptions`. It is harmless, and it also covers reordering the values.

- [ ] **Step 2: Run them, expect failure.** `pnpm.cmd --filter admin-web run test -- lib/products`

- [ ] **Step 3: Implement `money.ts`**

```ts
/** Currencies offered in the price fields until a store currency setting exists (G-99). */
export const SUPPORTED_CURRENCIES = ["EGP", "USD", "SAR", "AED", "KWD", "QAR", "EUR"] as const;

/** Minor-unit exponent of an ISO-4217 currency (EGP 2, JPY 0, KWD 3), from the runtime's Intl data. */
export function currencyExponent(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

function normalizeDigits(text: string): string {
  let out = "";
  for (const char of text) {
    const index = ARABIC_INDIC.indexOf(char);
    if (index >= 0) out += String(index);
    else if (char === "٫") out += ".";
    else if (char === "٬" || char === "," || char === " ") continue;
    else out += char;
  }
  return out;
}

/**
 * A typed amount ("150", "150.5", "1,250.75", "١٥٠٫٥") to minor units, by string arithmetic —
 * never `Number(text) * 100`, which turns 0.29 into 28.999…. `null` when the text is not a
 * non-negative amount with at most the currency's number of decimals.
 */
export function toMinorUnits(text: string, currency: string): number | null {
  const normalized = normalizeDigits(text.trim());
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (match === null) return null;
  const exponent = currencyExponent(currency);
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > exponent) return null;
  const minor = Number(whole + fraction.padEnd(exponent, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units to the plain text an input shows ("150.50"); no grouping, always `exponent` decimals. */
export function fromMinorUnits(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  if (exponent === 0) return String(minor);
  const digits = String(minor).padStart(exponent + 1, "0");
  return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}
```

- [ ] **Step 4: Implement `handles.ts`**

```ts
const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A random lowercase token from the platform CSPRNG (server actions run on Node 20+). */
export function randomToken(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
  return out;
}

/**
 * Shopify-style handle from a title: Latin letters and digits, lowercase, joined by "-". The
 * Catalog `Slug` accepts only `[a-z0-9-]`, so a title with no Latin characters (Arabic) yields ""
 * and the caller uses {@link fallbackHandle}. Arabic handles are Plan 2D.
 */
export function handleFromTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export function fallbackHandle(): string {
  return `product-${randomToken(6)}`;
}

/** The product-level SKU the domain still requires (G-98); merchants never type it. */
export function generateProductSku(): string {
  return `P-${randomToken(6).toUpperCase()}`;
}

function skuPart(value: string, index: number): string {
  const ascii = handleFromTitle(value).toUpperCase();
  return ascii.length > 0 ? ascii : `V${index + 1}`;
}

/** `<productSku>-<VALUE>-<VALUE>`, suffixed -2, -3… until it is not in `taken`. */
export function variantSkuFor(
  productSku: string,
  values: readonly string[],
  taken: ReadonlySet<string>,
): string {
  const base = [productSku, ...values.map(skuPart)].join("-");
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
```

- [ ] **Step 5: Implement `variant-matrix.ts`**

```ts
import { variantSkuFor } from "./handles";

export const MAX_OPTIONS = 3;
export const MAX_VARIANTS = 100;

export interface MatrixOption {
  readonly name: string;
  readonly values: readonly string[];
}

export interface MatrixVariant {
  readonly id: string;
  readonly sku: string;
  readonly selection: Readonly<Record<string, string>> | null;
  readonly priceAmountMinor: number;
  readonly currency: string;
}

export type MatrixOperation =
  | { readonly kind: "remove"; readonly variantId: string }
  | { readonly kind: "setOptions"; readonly options: readonly MatrixOption[] }
  | {
      readonly kind: "assign";
      readonly variantId: string;
      readonly selection: Readonly<Record<string, string>> | null;
    }
  | {
      readonly kind: "add";
      readonly sku: string;
      readonly selection: Readonly<Record<string, string>>;
      readonly priceAmountMinor: number;
      readonly currency: string;
    };

export type OptionPlan =
  | {
      readonly ok: true;
      readonly operations: readonly MatrixOperation[];
      readonly summary: { readonly adds: number; readonly removes: number };
    }
  | { readonly ok: false; readonly reason: "too_many_variants" | "invalid_options" };

export function combinations(options: readonly MatrixOption[]): Record<string, string>[] {
  let result: Record<string, string>[] = [{}];
  for (const option of options) {
    result = result.flatMap((partial) =>
      option.values.map((value) => ({ ...partial, [option.name]: value })),
    );
  }
  return options.length === 0 ? [] : result;
}

export function sameSelection(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function validOptions(options: readonly MatrixOption[]): boolean {
  if (options.length > MAX_OPTIONS) return false;
  const names = new Set<string>();
  for (const option of options) {
    const name = option.name.trim().toLowerCase();
    if (name.length === 0 || names.has(name)) return false;
    names.add(name);
    if (option.values.length === 0) return false;
    if (option.values.some((value) => value.trim().length === 0)) return false;
    if (new Set(option.values).size !== option.values.length) return false;
  }
  return true;
}

/**
 * Plan 2C-2: turns "these variants + these new options" into API operations whose EVERY
 * intermediate state is legal for the Plan 2C-1 domain (≥1 variant; unique non-null selections;
 * selections use declared values; setOptions refused while a variant holds a removed value).
 * Order: remove → clear re-assigned selections → setOptions → assign → add. Existing variants keep
 * their ids wherever a combination can take them (carts and stock point at variant ids).
 */
export function planOptionChange(input: {
  readonly productSku: string;
  readonly variants: readonly MatrixVariant[];
  readonly nextOptions: readonly MatrixOption[];
}): OptionPlan {
  const { productSku, variants, nextOptions } = input;
  if (!validOptions(nextOptions)) return { ok: false, reason: "invalid_options" };
  const combos = combinations(nextOptions);
  if (combos.length > MAX_VARIANTS) return { ok: false, reason: "too_many_variants" };
  const [first] = variants;
  if (first === undefined) return { ok: false, reason: "invalid_options" };

  const operations: MatrixOperation[] = [];

  if (combos.length === 0) {
    const keep = first;
    for (const variant of variants.slice(1)) {
      operations.push({ kind: "remove", variantId: variant.id });
    }
    if (keep.selection !== null) {
      operations.push({ kind: "assign", variantId: keep.id, selection: null });
    }
    operations.push({ kind: "setOptions", options: [] });
    return { ok: true, operations, summary: { adds: 0, removes: variants.length - 1 } };
  }

  // 1. Variants already sitting on a combination keep it.
  const claimed = new Map<number, MatrixVariant>();
  const unplaced: MatrixVariant[] = [];
  for (const variant of variants) {
    const index =
      variant.selection === null
        ? -1
        : combos.findIndex((c, i) => !claimed.has(i) && sameSelection(c, variant.selection!));
    if (index >= 0) claimed.set(index, variant);
    else unplaced.push(variant);
  }

  // 2. The others take free combinations in order, a partial match first (a variant that had
  //    Size: S takes Size: S / Color: Red before an unrelated combination).
  const reassigned: { variant: MatrixVariant; index: number }[] = [];
  const toRemove: MatrixVariant[] = [];
  for (const variant of unplaced) {
    const free = combos
      .map((combo, index) => ({ combo, index }))
      .filter(({ index }) => !claimed.has(index));
    const partial = free.find(
      ({ combo }) =>
        variant.selection !== null &&
        Object.entries(variant.selection).every(([name, value]) => combo[name] === value),
    );
    const target = partial ?? free[0];
    if (target === undefined) {
      toRemove.push(variant);
    } else {
      claimed.set(target.index, variant);
      reassigned.push({ variant, index: target.index });
    }
  }

  for (const variant of toRemove) operations.push({ kind: "remove", variantId: variant.id });
  for (const { variant } of reassigned) {
    if (variant.selection !== null) {
      operations.push({ kind: "assign", variantId: variant.id, selection: null });
    }
  }
  operations.push({
    kind: "setOptions",
    options: nextOptions.map((o) => ({ name: o.name, values: [...o.values] })),
  });
  for (const { variant, index } of reassigned) {
    operations.push({ kind: "assign", variantId: variant.id, selection: combos[index]! });
  }

  const taken = new Set(variants.map((variant) => variant.sku));
  let adds = 0;
  combos.forEach((combo, index) => {
    if (claimed.has(index)) return;
    const sku = variantSkuFor(
      productSku,
      nextOptions.map((o) => combo[o.name]!),
      taken,
    );
    taken.add(sku);
    operations.push({
      kind: "add",
      sku,
      selection: combo,
      priceAmountMinor: first.priceAmountMinor,
      currency: first.currency,
    });
    adds += 1;
  });

  return { ok: true, operations, summary: { adds, removes: toRemove.length } };
}
```

The "no change" test expects `operations` to be **only** the `setOptions`. It passes because claimed variants produce no `assign`.

- [ ] **Step 6: Run.** `pnpm.cmd --filter admin-web run test -- lib/products`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/lib/products
git commit -m "feat(admin-web): add price parsing, handle/sku generation and the variant matrix planner"
```

---

### Task 2: API client for the Plan 2C-1 fields

**Files:**

- Modify: `lib/api/products.ts`
- Modify: `lib/api/products.test.ts`

**Interfaces:**

- **`ProductDetailDto` gains:**
  - `description: string | null`;
  - `productType: string | null`;
  - `tags: readonly string[]`.
- **`ProductVariantDto` gains:**
  - `compareAtAmountMinor: number | null`;
  - `costAmountMinor: number | null`;
  - `barcode: string | null`;
  - `weightGrams: number | null`;
  - `requiresShipping: boolean`;
  - `taxable: boolean`.
- **`VariantAttributesInput`**: the optional six, named exactly as the API names them.
- **Inputs that change:**
  - `CreateProductVariantInput` and `AddProductVariantInput` extend `VariantAttributesInput`;
  - `UpdateProductVariantInput` extends it too, and adds `selection?: Record | null`;
  - `CreateProductInput` and the `updateProduct` input gain optional `description` / `productType` / `tags`.
- **`unlistProduct(productId, idempotencyKey)`**: `POST /api/v1/products/:id/unlist`.

- [ ] **Step 1: Write the failing tests** (in `products.test.ts`, following its existing `fetch`-mock style)

1. `updateProduct("p1", { name, slug, description: "d", tags: ["a"] }, key)` sends exactly that body to `/api/v1/products/p1`.
2. `updateProductVariant(…, { sku, priceAmountMinor, currency, compareAtAmountMinor: null, selection: { Size: "S" } }, key)` sends `compareAtAmountMinor: null`. `null` must survive `JSON.stringify`. Do not strip it.
3. `unlistProduct("p1", key)` POSTs to `/api/v1/products/p1/unlist` with the idempotency key header.
4. `fetchProduct` returns the new DTO fields untouched (fixture with every field).

- [ ] **Step 2: Run, expect failure.** `pnpm.cmd --filter admin-web run test -- lib/api/products`

- [ ] **Step 3: Implement.** Add the fields and types above.

`unlistProduct` is a copy of `unpublishProduct`, with the path `"/unlist"` and the doc line `/** POST /products/:productId/unlist (idempotent: true, products:publish) — Plan 2C-1. */`.

Find the existing variant-update input type (the one `updateProductVariant` takes). If it is inline, name it `UpdateProductVariantInput` and export it.

- [ ] **Step 4: Run.** `… run test -- lib/api/products` and `… run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/lib/api
git commit -m "feat(admin-web): carry product details, variant attributes and unlist in the api client"
```

---

### Task 3: Server actions (save, create, options, variant dialog)

**Files:**

- Modify: `app/products/actions.ts`
- Create: `app/products/actions.test.ts`
- Create: `components/products/editor/rename-field-errors.ts`

**Interfaces:**

- Consumes: Task 1 helpers; Task 2 client.
- Produces:
  - `saveProductAction(prev, formData)`;
  - `createProductAction(prev, formData)`, which redirects to `/products/:id` on success;
  - `saveProductOptionsAction(prev, formData)`;
  - `updateVariantDetailsAction(prev, formData)`;
  - `renameFieldErrors(state, map)`;
  - `PRODUCT_FIELD_NAMES`.

**Form field names** (the contract between Task 4/5 inputs and these actions):

| Card                     | Field                        | Name                                                  |
| ------------------------ | ---------------------------- | ----------------------------------------------------- |
| title                    | title                        | `title`                                               |
| title                    | description                  | `description`                                         |
| pricing (single variant) | price                        | `price`                                               |
| pricing                  | compare-at                   | `compareAtPrice`                                      |
| pricing                  | cost                         | `costPerItem`                                         |
| pricing                  | currency                     | `currency`                                            |
| pricing                  | charge tax                   | `taxable` (checkbox, value `"on"`)                    |
| inventory ids            | SKU                          | `sku`                                                 |
| inventory ids            | barcode                      | `barcode`                                             |
| shipping                 | physical                     | `requiresShipping` (checkbox)                         |
| shipping                 | weight                       | `weight`                                              |
| shipping                 | weight unit                  | `weightUnit` (`"g"` \| `"kg"`)                        |
| seo                      | handle                       | `handle`                                              |
| seo                      | SEO title                    | `seoTitle`                                            |
| seo                      | SEO description              | `seoDescription`                                      |
| status                   | status                       | `status` (`"published"` \| `"draft"` \| `"unlisted"`) |
| organization             | type                         | `productType`                                         |
| organization             | brand                        | `brandId` (`""` = none)                               |
| organization             | categories                   | `categoryIds` (repeated)                              |
| organization             | tags                         | `tags` (comma-separated)                              |
| hidden                   | product id                   | `productId` (edit only)                               |
| hidden                   | variant id                   | `variantId` (single-variant edit only)                |
| hidden                   | single-variant block present | `hasVariantFields` = `"1"`                            |

**API → form names**, for `renameFieldErrors`:

```ts
{
  name: "title",
  slug: "handle",
  priceAmountMinor: "price",
  compareAtAmountMinor: "compareAtPrice",
  costAmountMinor: "costPerItem",
  weightGrams: "weight",
  title: "seoTitle",
  description: "description",
}
```

The SEO route's `title` / `description` fields collide with the product's own `description`. So `saveProductAction` renames SEO errors with its own map: `{ title: "seoTitle", description: "seoDescription" }`.

- [ ] **Step 1: Write the failing tests**

`actions.test.ts`:

1. Mock `@/lib/api/products` with `vi.fn()`s for every function the actions call.
2. Mock `next/cache` (`revalidatePath`), `next/navigation` (`redirect`: make it throw a sentinel error, the way Next does, and assert on it) and `next/headers` (`cookies` → no locale, so `en`).
3. Build `FormData` by hand.

**`saveProductAction`:**

1. **Only what changed is called.** `fetchProduct` returns a product (one variant, published). The form changes the title and the price only.
   - Calls `updateProduct` and `updateProductVariant`.
   - The variant call's `priceAmountMinor` is `toMinorUnits(typed price)`; `compareAtAmountMinor` / `costAmountMinor` are `null` when their inputs are blank.
   - **Does not call** `setProductSeo`, `setProductBrand`, `assignProductCategories`, `publishProduct`, `unpublishProduct` or `unlistProduct`.
   - Returns `{ status: "success" }`.
2. **Status mapping** (`fetchProduct` status → form status → call):
   - published → draft: `unpublishProduct`;
   - draft → published: `publishProduct`;
   - draft → unlisted: `unlistProduct`;
   - published → unlisted: `unlistProduct`;
   - unlisted → published: `publishProduct`;
   - unlisted → draft: `unpublishProduct`.
   - The status call is made **last**, after the content calls.
3. **Stops at the first failure.** If `updateProduct` returns `{ outcome: "invalid", fields: [{ field: "slug", message: "taken" }] }`:
   - no later call is made;
   - the state is `error`, with `fieldErrors.handle === "taken"` (renamed).
4. **Bad price.** A typed price `"12.345"` in EGP returns `fieldErrors.price` without any API call.
5. **Weight.** `weight "1.5"` + `weightUnit "kg"` gives `weightGrams 1500`. `"250"` + `"g"` gives `250`. Blank gives `null`.
6. **Tags.** `"summer, Sale , ,summer"` sends `["summer", "Sale", "summer"]`. The backend normalizes; the action only splits, trims and drops blanks.
7. **Multi-variant products.** Without `hasVariantFields`, `updateProductVariant` is never called.

**`createProductAction`:**

1. Title `"Plush Bear"` with blank handle and blank SKU sends:
   - `slug: "plush-bear"`;
   - a product `sku` matching `/^P-[A-Z0-9]{6}$/`;
   - one variant with `sku` = `<product sku>-1` and `priceAmountMinor` from the typed price.

   Then it redirects to `/products/<id>`.

2. An Arabic title with a blank handle sends `slug` matching `/^product-[a-z0-9]{6}$/`.
3. A `conflict` on an **auto-generated** handle retries once with `-<token>` appended. A typed handle that conflicts is **not** retried; it returns the error on `handle`.
4. After create, the chosen status `published` calls `publishProduct(newId)`, and brand and categories are set when given.
5. A blank title returns `fieldErrors.title` without any call.

**`saveProductOptionsAction`:**

1. `fetchProduct` gives one plain variant. The form posts options `Size: "S, M"`. The action:
   - calls `updateProductVariant` (assign `{Size:"S"}`), `setProductOptions` and `addProductVariant` (`Size: M`), **in that order**;
   - passes the existing variant's `sku` / `priceAmountMinor` / `currency` unchanged on the assign call;
   - returns success.
2. A planner refusal (`too_many_variants`) returns an error with `t.productEditor.tooManyVariants`, and makes no API call.
3. If the second operation fails, it stops and returns `toFormState` of that failure, with the message prefixed by `t.productEditor.partiallySaved`. Revalidation still happens.

**`updateVariantDetailsAction`:** posts `variantId`, `price`, `compareAtPrice`, `costPerItem`, `sku`, `barcode`, `weight`, `weightUnit`, `requiresShipping` and `taxable`.

- It sends the full attribute set: blanks become `null`, and unchecked checkboxes become `false`.
- It sends `currency` from the variant fetched server-side, never from the form.

- [ ] **Step 2: Run, expect failure.** `pnpm.cmd --filter admin-web run test -- app/products/actions`

- [ ] **Step 3: Implement**

**Messages first.** These actions and the cards in Tasks 4 and 5 read `t.productEditor.*`. So add the whole `productEditor` section and the two `productStatus` changes from **Task 6's tables** to `messages/en.ts` and `messages/ar.ts` now. Task 6 then only removes the keys that became unused.

**`rename-field-errors.ts`:**

```ts
import type { FormState } from "@/lib/api/mutation";

/** API field names → editor input names (Plan 2C-2), so errors land next to the right input. */
export const PRODUCT_FIELD_NAMES: Readonly<Record<string, string>> = {
  name: "title",
  slug: "handle",
  priceAmountMinor: "price",
  compareAtAmountMinor: "compareAtPrice",
  costAmountMinor: "costPerItem",
  weightGrams: "weight",
};

export function renameFieldErrors(
  state: FormState,
  names: Readonly<Record<string, string>>,
): FormState {
  if (state.status !== "error") return state;
  const fieldErrors: Record<string, string> = {};
  for (const [field, message] of Object.entries(state.fieldErrors)) {
    fieldErrors[names[field] ?? field] = message;
  }
  return { ...state, fieldErrors };
}
```

**In `actions.ts`, add these parsing helpers** next to the existing ones:

```ts
function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

function optionalText(formData: FormData, name: string): string | null {
  const value = stringField(formData, name).trim();
  return value.length === 0 ? null : value;
}

/** Blank → null; otherwise minor units, or `undefined` when the text is not a valid amount. */
function optionalMoney(
  formData: FormData,
  name: string,
  currency: string,
): number | null | undefined {
  const raw = stringField(formData, name).trim();
  if (raw.length === 0) return null;
  return toMinorUnits(raw, currency) ?? undefined;
}

/** Blank → null; grams from "250" g or "1.5" kg (string arithmetic via toMinorUnits with 3 decimals). */
function weightGramsOf(formData: FormData): number | null | undefined {
  const raw = stringField(formData, "weight").trim();
  if (raw.length === 0) return null;
  const unit = stringField(formData, "weightUnit") === "kg" ? "kg" : "g";
  const parsed = toMinorUnits(raw, unit === "kg" ? "KWD" : "JPY"); // KWD = 3 decimals, JPY = 0
  return parsed ?? undefined;
}

function tagsOf(formData: FormData): string[] {
  return stringField(formData, "tags")
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}
```

`weightGramsOf` reuses the exponent-correct parser on purpose. Kilograms with 3 decimals is exactly grams, and grams with 0 decimals rejects `"1.5"` g.

Then write a one-line comment there, saying the currency codes only borrow the exponent.

**`saveProductAction` outline.** Write it in full, in this order:

1. **Read.** `t` = `formErrorDictionary()`, and the editor strings `t2 = dictionaryFor(locale).productEditor`. `productId` from the form. Then `fetchProduct(productId)`; a non-`ok` result → `toFormState` of a matching `MutationResult` (`not_found` / `unauthorized` / `error`).
2. **Parse everything first.** Collect field errors for: blank title; a bad `price` (required when `hasVariantFields`); a bad `compareAtPrice` or `costPerItem` (`undefined`); a bad weight. Use `currency` from the form only when `hasVariantFields`, otherwise the first variant's currency. If there are any errors, return `{ status: "error", message: t.invalid, fieldErrors }` **before any API call**.
3. **Details.** If the title, handle, description, `productType` or tags differ from `product`, call `updateProduct(productId, { name, slug, description, productType, tags }, newIdempotencyKey())`.
   - The handle is the typed one; a blank handle keeps `product.slug`.
   - Compare tags as a joined string.
4. **Variant.** If `hasVariantFields`: build `{ sku, priceAmountMinor, currency, compareAtAmountMinor, costAmountMinor, barcode, weightGrams, requiresShipping, taxable }`.
   - A blank `sku` keeps the variant's current SKU.
   - Call `updateProductVariant(productId, variantId, input, key)` if any value differs from the fetched variant.
5. **SEO.** If `seoTitle` or `seoDescription` differs, call `setProductSeo` with the existing shape. Omit a blank field, as the existing action did.
6. **Brand.** If `brandId` differs (`""` ↔ `null`), call `setProductBrand(productId, brandId || null, key)`.
7. **Categories.** If the sorted `categoryIds` differ, call `assignProductCategories`.
8. **Status.** If the form status differs, call `publishProduct`, `unpublishProduct` or `unlistProduct`, per the table in the tests.
   - When the current status is `archived` or `scheduled`, the form does not render the select. The action then ignores `status` entirely.
9. **After each call.** If the outcome is not `ok`:
   - return `renameFieldErrors(toFormState(result, t), section map)`;
   - prefix the message with `t2.partiallySaved` when an earlier call in this save succeeded;
   - **revalidate before returning**.
10. **Finish.** `revalidatePath("/products")`, `revalidatePath(`/products/${productId}`)`, then `{ status: "success" }`.

**`createProductAction`.** Same parsing, plus:

1. **Handle and product SKU:**
   - `handle = typed || handleFromTitle(title) || fallbackHandle()`;
   - `productSku = generateProductSku()`;
   - `variantSku = typed sku || \`${productSku}-1\``.
2. **Create:** `createProduct({ sku: productSku, name, slug: handle, description, productType, tags, variants: [{ sku: variantSku, priceAmountMinor, currency, …attributes }] })`.
3. **Retry** on `conflict` only when the handle was generated: `${handle}-${randomToken(4)}`.
4. **Then, in order,** for the new id: SEO (if given), brand (if given), categories (if any), status (`published` → `publishProduct`; `unlisted` → `unlistProduct`; `draft` → nothing).
   - A failure after creation still redirects to the new product. The product exists; the merchant fixes the rest there. Pass `?saved=partial` so the page shows `t2.partiallySaved`.
5. **Finish:** `revalidatePath("/products")` and `redirect(\`/products/${id}\`)`.

**`saveProductOptionsAction`:**

1. **Parse.** Get `productId`. Parse the rows with the existing `parseOptions`, but **allow zero rows**: a form with no `optionName` fields means "remove all options". Make `parseOptions` return `[]` for zero rows; it currently returns `null`.
2. **Plan.** `fetchProduct`, then `planOptionChange({ productSku: product.sku, variants: product.variants, nextOptions })`.
   - A refusal → `{ status: "error", message: reason === "too_many_variants" ? t2.tooManyVariants : t2.invalidOptions, fieldErrors: {} }`.
3. **Execute** the operations in order:
   - **`remove`** → `removeProductVariant`.
   - **`setOptions`** → `setProductOptions`.
   - **`assign`** → `updateProductVariant(productId, id, { sku, priceAmountMinor, currency, selection })`, using that variant's current `sku` / `priceAmountMinor` / `currency` from the fetched product. Attributes are omitted, so they are kept.
   - **`add`** → `addProductVariant(productId, { sku, priceAmountMinor, currency, selection })`.
4. **On failure**, stop, revalidate, and return the error prefixed with `t2.partiallySaved` when something already ran.
5. **Finish:** revalidate and return success.

**`updateVariantDetailsAction`:** parse as above. `fetchProduct`, find the variant (`not_found` if absent), and send the full attribute set with the variant's own `currency` and current `selection` omitted (kept).

**Remove** the actions listed under "removed" in File Structure. Keep `removeProductVariantAction`, the schedule, archive and delete actions, and the media actions. Imports that become unused must go (lint).

- [ ] **Step 4: Run.** `… run test -- app/products/actions` and `… run typecheck`. Expected: PASS.

Typecheck will fail in the old components that import removed actions. That is expected until Task 6, which deletes them. To keep this commit green, **delete those components and their tests in this task** (`product-edit-form.tsx`, `product-create-form.tsx` + test, `product-organization-card.tsx`, `product-variants-card.tsx` + test, and the SEO half of `product-media-seo-card.tsx`; see Task 6 for the media split). Do the split now if typecheck requires it.

Then make both pages temporarily render only their header and the cards that still compile. Task 6 wires the editor.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src
git commit -m "feat(admin-web): add the one-save product actions and the option matrix action"
```

---

### Task 4: The editor shell and the form cards

**Files** (all under `components/products/editor/`):

- Create: `field.tsx`, `product-editor.tsx`, `title-description-card.tsx`, `pricing-card.tsx`, `inventory-identifiers-card.tsx`, `shipping-card.tsx`, `seo-card.tsx`, `status-card.tsx`, `organization-card.tsx`
- Test: `product-editor.test.tsx`, `pricing-card.test.tsx`, `status-card.test.tsx`

**Interfaces:**

- **`PRODUCT_FORM_ID = "product-editor"`**, exported from `product-editor.tsx`.
- **`ProductEditor` props:**

```ts
{
  mode: "create" | "edit";
  product: ProductDetailDto | null;      // null in create mode
  brands: readonly BrandDto[];
  categories: readonly CategoryDto[];
  defaultCurrency: string;               // create mode: see Task 6
  t: Dictionary;
  locale: Locale;
  slots: {                               // own-form cards, edit mode only
    variants?: ReactNode;
    media?: ReactNode;
    stock?: ReactNode;
    dangerZone?: ReactNode;
  };
}
```

- **Every input in a form card** carries `form={PRODUCT_FORM_ID}`.

- [ ] **Step 1: Write the failing tests**

**`product-editor.test.tsx`:**

1. Mock `@/app/products/actions` (`saveProductAction`, `createProductAction`).
2. Render in **edit** mode with a single-variant product. Change the title, click **Save**, and assert the action received a `FormData` with:
   - the new `title`;
   - the unchanged `price` (as `fromMinorUnits` text);
   - `productId`;
   - `variantId`;
   - `hasVariantFields = "1"`.

   **This proves the `form=` association works under jsdom.** If jsdom does not collect associated controls, **stop and report**; do not restructure into nested forms.

3. Render with a **two-variant** product. There is no `price` input, no `hasVariantFields`, and a note `t.productEditor.pricesOnVariants` is shown in place of the pricing, inventory and shipping cards.
4. An `error` state with `fieldErrors.price` puts `aria-invalid="true"` on the price input and shows the message next to it.
5. Typing in any field shows the "unsaved changes" text (`t.productEditor.unsaved`) in the save bar.
6. In create mode, the button reads `t.productEditor.create` and calls `createProductAction`.

**`pricing-card.test.tsx`:**

1. With price `150` and cost `100`, it shows profit `50.00` and margin `33.3%`, formatted with `formatCurrency` / `formatNumber` for the locale.
2. Blank cost shows `—` for both.
3. Changing the price updates them live.

**`status-card.test.tsx`:**

1. It offers exactly `published` / `draft` / `unlisted`, with labels `t.productStatus.published` (now "Active" / "نشط"), `draft` and `unlisted`, each with its one-line hint.
2. With status `archived` or `scheduled`, it renders no select, only the badge and `t.productEditor.statusLocked`.

- [ ] **Step 2: Run, expect failure.** `pnpm.cmd --filter admin-web run test -- components/products/editor`

- [ ] **Step 3: Implement**

**`field.tsx`.** Shared, tiny, with no logic beyond wiring `id`, label, `aria-invalid` and the error text:

- `Field({ label, name, error, hint, children })` renders `Label` + children + error (`text-destructive text-xs`, `id=…-error`, referenced by `aria-describedby`) + hint;
- `NativeSelect`, styled with the class string `product-organization-card.tsx` used: `border-input bg-card text-foreground … h-9 rounded-md border px-2 text-sm`;
- `NativeTextarea`, the same tokens with `min-h-32 p-3`;
- `CheckboxRow({ name, label, defaultChecked })`, a native checkbox with `accent-primary`, with the label clickable.

All of them accept and forward `form`.

**`product-editor.tsx`** (client):

```tsx
"use client";

export const PRODUCT_FORM_ID = "product-editor";

export function ProductEditor(props: ProductEditorProps) {
  const action = props.mode === "create" ? createProductAction : saveProductAction;
  const [state, formAction, isPending] = useActionState(action, { status: "idle" } as FormState);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (state.status === "success") setDirty(false);
  }, [state.status]);
  const errors = state.status === "error" ? state.fieldErrors : {};
  const product = props.product;
  const variant = product !== null && product.variants.length === 1 && product.options.length === 0
    ? product.variants[0]
    : undefined;
  const hasVariantFields = props.mode === "create" || variant !== undefined;
  …
  return (
    <div onInput={() => setDirty(true)} onChange={() => setDirty(true)} className="flex flex-col gap-6">
      <form id={PRODUCT_FORM_ID} action={formAction}>
        {product !== null && <input type="hidden" name="productId" value={product.id} />}
        {variant !== undefined && <input type="hidden" name="variantId" value={variant.id} />}
        {hasVariantFields && <input type="hidden" name="hasVariantFields" value="1" />}
      </form>
      <SaveBar … />  {/* sticky top-0 z-10; title + "unsaved" + error summary + Save button (form=PRODUCT_FORM_ID) */}
      <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <TitleDescriptionCard … />
          {props.slots.media}
          {hasVariantFields ? (<><PricingCard … /><InventoryIdentifiersCard … /><ShippingCard … /></>)
                            : <Card><CardContent className="text-muted-foreground py-6 text-sm">{t.productEditor.pricesOnVariants}</CardContent></Card>}
          {props.slots.variants ?? (props.mode === "create" && <Card>… t.productEditor.optionsAfterCreate …</Card>)}
          {props.slots.stock}
          <SeoCard … />
        </div>
        <div className="flex flex-col gap-6">
          <StatusCard … />
          <OrganizationCard … />
          {props.slots.dangerZone}
        </div>
      </div>
    </div>
  );
}
```

The save bar shows:

- `state.message` (`role="alert"`) on error;
- `t.productEditor.unsaved` while dirty;
- the Save button: `type="submit"`, `form={PRODUCT_FORM_ID}`, `loading={isPending}`, label `t.productEditor.save` / `create` / `saving`.

**Cards.** Each one is a `Card` with a `CardHeader` title, and inputs with `form={PRODUCT_FORM_ID}`, `defaultValue` from the product (or empty), and `error={errors[name]}`.

- **Title & description:** `title` (required), `description` (`NativeTextarea`, `maxLength={20000}`).
- **Pricing:**
  - `price`, `compareAtPrice` and `costPerItem`, all `inputMode="decimal"`, `defaultValue` via `fromMinorUnits`;
  - `currency` (`NativeSelect` of `SUPPORTED_CURRENCIES`, plus the variant's own currency if it is not in the list), `defaultValue` = the variant's currency or `defaultCurrency`;
  - `taxable` checkbox (default checked);
  - live profit/margin: profit = price − cost; margin = profit / price, computed with `toMinorUnits` on the current input values (controlled state for price, cost and currency).
  - Hint under compare-at: `t.productEditor.compareAtHint`.
- **Inventory identifiers:** `sku` (placeholder `t.productEditor.skuAuto` in create mode) and `barcode`.
- **Shipping:**
  - `requiresShipping` checkbox (default checked);
  - `weight` (decimal) with `weightUnit` `NativeSelect` `g` / `kg`;
  - `defaultValue`: an existing weight of 1000 g or more shows in kg (`fromMinorUnits(grams, "KWD")` → `"1.500"`; trim trailing zeros); otherwise in g.
  - Hide the weight row while `requiresShipping` is unchecked (controlled checkbox state).
- **SEO:**
  - `seoTitle` (`maxLength 70`, counter) and `seoDescription` (`maxLength 320`, counter);
  - `handle`, prefixed by a read-only `/products/` text;
  - a preview line: title (seoTitle or title), `…/products/<handle>`, and the description (seoDescription or the description's first 160 characters).
- **Status:**
  - `NativeSelect name="status"` with three options, and the selected option's hint below it;
  - in create mode the default is `draft`;
  - when the status is `archived` or `scheduled`, show `ProductStatusBadge` + `t.productEditor.statusLocked` and **no** select.
- **Organization:**
  - `productType` (text, `list` → a `<datalist>` is optional, skip it);
  - `brandId` (`NativeSelect`, first option `""` = `t.productEditor.noBrand`; an assigned brand missing from the list stays as an option labelled with its id, as the old card did);
  - `categoryIds` (one `CheckboxRow` each, `value={category.id}`);
  - `tags` (text; `defaultValue = tags.join(", ")`; hint `t.productEditor.tagsHint`).

- [ ] **Step 4: Run.** `… run test -- components/products/editor` and `… run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/components/products/editor
git commit -m "feat(admin-web): add the one-page product editor shell and its form cards"
```

---

### Task 5: Variants card (option editor, matrix preview, variant dialog)

**Files:**

- Create: `components/products/editor/variants-card.tsx`
- Test: `components/products/editor/variants-card.test.tsx`

**Interfaces:**

- Consumes: `planOptionChange` (Task 1); `saveProductOptionsAction`, `updateVariantDetailsAction` and `removeProductVariantAction` (Task 3).
- Produces: `VariantsCard({ product, t, locale })`.

- [ ] **Step 1: Write the failing tests**

1. For a product with no options, the card shows an "Add options like size or color" button (`t.productEditor.addOptions`). Clicking it shows one option row: a name input and a values input.
2. Typing `Size` / `S, M, L` shows the preview `t.productEditor.matrixPreview` with "adds 2, removes 0". This comes from `planOptionChange`, run client-side on the current inputs.
3. **Submitting when the plan removes any variant** shows `window.confirm` with `t.productEditor.confirmRemoveVariants` (count substituted), and cancelling does not submit.
4. **The table lists one row per variant:**
   - its title (values joined by `" / "` in option order, or `t.productEditor.defaultVariant`);
   - its price (`formatCurrency`);
   - its SKU;
   - an Edit button.
5. **Edit opens a dialog** (`Dialog` from `@platform/ui`) containing that variant's own form:
   - `variantId`;
   - `price`, `compareAtPrice` and `costPerItem`;
   - `sku` and `barcode`;
   - `weight` and `weightUnit`;
   - `requiresShipping` and `taxable`.

   Its submit calls `updateVariantDetailsAction`, and a success closes the dialog.

6. **Remove** (inside the dialog) is hidden when the product has a single variant.
7. More than `MAX_OPTIONS` rows: the "add another option" button is disabled.

- [ ] **Step 2: Run, expect failure.** `… run test -- variants-card`

- [ ] **Step 3: Implement**

**One `<form action={optionsAction}>`** for the option editor. It is NOT tied to `PRODUCT_FORM_ID`.

- Hidden `productId`.
- Rows of `optionName` / `optionValues` inputs (controlled), "Add another option" and per-row "Remove option" (a `type="button"` that drops the row from state).
- A `t.productEditor.saveOptions` submit.
- With zero rows, the submit still posts `productId`. The action reads that as "remove all options".

**Preview.** Parse the controlled rows the same way the action does (split on commas, trim, drop blanks) and call `planOptionChange` with `product.variants` mapped to `MatrixVariant`. Show:

- `t.productEditor.matrixPreview` with `{adds}` / `{removes}` substituted;
- `t.productEditor.tooManyVariants`;
- `t.productEditor.invalidOptions`.

Block submit unless the plan is `ok`.

**Table:** `@platform/ui` `Table`, as the old variants card did.

**Dialog.** One `VariantDialog` per row, mounted only while open:

- its own `useActionState(updateVariantDetailsAction)`;
- fields and names exactly as in Task 3's table, with `defaultValue`s from the variant;
- currency shown read-only (the product's currency);
- `RemoveVariantButton`, kept from the old card, moved here unchanged.

- [ ] **Step 4: Run.** `… run test -- variants-card` and `… run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/components/products/editor
git commit -m "feat(admin-web): add the variants card with an option matrix preview and a variant dialog"
```

---

### Task 6: Wire the pages, messages, status badge and the lifecycle remnants

**Files:**

- Modify: `app/products/[productId]/page.tsx`
- Modify: `app/products/new/page.tsx`
- Create: `components/products/product-media-card.tsx` (split from `product-media-seo-card.tsx`, which is deleted if Task 3 did not already)
- Modify: `components/products/product-lifecycle-actions.tsx`
- Modify: `components/products/product-lifecycle-actions.test.tsx`
- Modify: `components/products/product-status-badge.tsx`
- Modify: `messages/en.ts`, `messages/ar.ts`

- [ ] **Step 1: Write the failing tests**

- `product-lifecycle-actions.test.tsx`:
  - no publish or unpublish buttons any more;
  - schedule for a draft;
  - archive for draft / published / unlisted;
  - delete for draft and archived.
- `product-status-badge`: `unlisted` renders `t.productStatus.unlisted`. Add the case to an existing test, or create `product-status-badge.test.tsx`.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

**`[productId]/page.tsx`:**

1. Keep the auth/not-found/error panels, the back link and the header (title + badge + scheduled line).
2. Replace the grid with `<ProductEditor mode="edit" product={product} brands={brands} categories={categories} defaultCurrency={product.variants[0]?.currency ?? "EGP"} t={t} locale={locale} slots={{ … }} />`, where the slots are:
   - `variants: <VariantsCard product={product} t={t} locale={locale} />`;
   - `media: <ProductMediaCard … />`;
   - `stock: <Suspense fallback={<ProductInventoryCardSkeleton t={t} />}><ProductInventoryCard productId={product.id} t={t} /></Suspense>`;
   - `dangerZone: <ProductLifecycleActions productId={product.id} status={product.status} t={t} />`.
3. When `searchParams.saved === "partial"`, show a `role="status"` note with `t.productEditor.partiallySaved`.

**`new/page.tsx`:**

1. Fetch brands and categories, as the edit page does.
2. **`defaultCurrency`:** fetch `fetchProductsPage({ first: 1 })`, and use its first item's `currency`, else `"EGP"`.
   - Document it: until a store currency setting exists (G-99), the newest product's currency is the best guess of the store's currency.
3. Render `<ProductEditor mode="create" product={null} … slots={{}} />`.

**`product-lifecycle-actions.tsx`:**

1. Remove the publish and unpublish buttons and their imports.
2. Gate the remaining buttons:
   - `canSchedule = draft`;
   - `canArchive = draft | scheduled | published | unlisted`;
   - `canDelete = draft | archived`.
3. Wrap them in a `Card` titled `t.productEditor.moreActions`.

**`product-status-badge.tsx`:** add `unlisted` (neutral/info variant).

**Messages.** These were added in Task 3 (the tables below are the source of truth). Here, check that both files match the tables.

`productStatus` (published gets Shopify's word):

| key         | en         | ar         |
| ----------- | ---------- | ---------- |
| `published` | `Active`   | `نشط`      |
| `unlisted`  | `Unlisted` | `غير مدرج` |

`productEditor`:

| key                     | en                                                                                           | ar                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `save`                  | Save                                                                                         | حفظ                                                                       |
| `saving`                | Saving…                                                                                      | جارٍ الحفظ…                                                               |
| `create`                | Save product                                                                                 | حفظ المنتج                                                                |
| `unsaved`               | Unsaved changes                                                                              | تغييرات غير محفوظة                                                        |
| `partiallySaved`        | Some changes were saved before an error. Review and save again.                              | اتحفظ جزء من التغييرات قبل ما يحصل خطأ. راجع واحفظ تاني.                  |
| `titleCard`             | Title and description                                                                        | العنوان والوصف                                                            |
| `title`                 | Title                                                                                        | العنوان                                                                   |
| `description`           | Description                                                                                  | الوصف                                                                     |
| `pricingCard`           | Pricing                                                                                      | السعر                                                                     |
| `price`                 | Price                                                                                        | السعر                                                                     |
| `compareAtPrice`        | Compare-at price                                                                             | السعر قبل الخصم                                                           |
| `compareAtHint`         | Shown struck through. Must be higher than the price.                                         | بيظهر مشطوب، ولازم يكون أعلى من السعر.                                    |
| `costPerItem`           | Cost per item                                                                                | تكلفة القطعة                                                              |
| `costHint`              | Customers won't see this.                                                                    | الزبون مش هيشوفه.                                                         |
| `profit`                | Profit                                                                                       | الربح                                                                     |
| `margin`                | Margin                                                                                       | الهامش                                                                    |
| `currency`              | Currency                                                                                     | العملة                                                                    |
| `chargeTax`             | Charge tax on this product                                                                   | فرض ضريبة على المنتج ده                                                   |
| `inventoryCard`         | Inventory                                                                                    | المخزون                                                                   |
| `sku`                   | SKU (stock keeping unit)                                                                     | SKU (رمز التخزين)                                                         |
| `skuAuto`               | Generated if left blank                                                                      | بيتعمل لوحده لو سبته فاضي                                                 |
| `barcode`               | Barcode (ISBN, UPC, GTIN…)                                                                   | الباركود (ISBN، UPC، GTIN…)                                               |
| `shippingCard`          | Shipping                                                                                     | الشحن                                                                     |
| `physicalProduct`       | This is a physical product                                                                   | ده منتج مادي                                                              |
| `weight`                | Weight                                                                                       | الوزن                                                                     |
| `weightUnit`            | Unit                                                                                         | الوحدة                                                                    |
| `grams`                 | g                                                                                            | جم                                                                        |
| `kilograms`             | kg                                                                                           | كجم                                                                       |
| `pricesOnVariants`      | This product has variants. Set prices, SKUs and weights on each variant below.               | المنتج ده ليه متغيّرات. حدّد السعر والـ SKU والوزن لكل متغيّر تحت.        |
| `variantsCard`          | Variants                                                                                     | المتغيّرات                                                                |
| `addOptions`            | Add options like size or color                                                               | أضف خيارات زي المقاس أو اللون                                             |
| `optionName`            | Option name                                                                                  | اسم الخيار                                                                |
| `optionValues`          | Values (comma-separated)                                                                     | القيم (افصل بينها بفاصلة)                                                 |
| `addAnotherOption`      | Add another option                                                                           | أضف خيار تاني                                                             |
| `removeOption`          | Remove option                                                                                | احذف الخيار                                                               |
| `saveOptions`           | Save options                                                                                 | احفظ الخيارات                                                             |
| `matrixPreview`         | Will add {adds} and remove {removes} variants.                                               | هيضيف {adds} ويحذف {removes} متغيّر.                                      |
| `confirmRemoveVariants` | This removes {count} variants. Continue?                                                     | ده هيحذف {count} متغيّر. تكمّل؟                                           |
| `tooManyVariants`       | Up to 100 variants per product.                                                              | الحد الأقصى 100 متغيّر للمنتج.                                            |
| `invalidOptions`        | Each option needs a unique name and at least one value, with no duplicates. Up to 3 options. | كل خيار محتاج اسم مختلف وقيمة واحدة على الأقل من غير تكرار. لحد 3 خيارات. |
| `optionsAfterCreate`    | Save the product first, then add options like size or color.                                 | احفظ المنتج الأول، وبعدين أضف خيارات زي المقاس أو اللون.                  |
| `defaultVariant`        | Default                                                                                      | الافتراضي                                                                 |
| `editVariant`           | Edit variant                                                                                 | تعديل المتغيّر                                                            |
| `seoCard`               | Search engine listing                                                                        | قائمة محرك البحث                                                          |
| `seoTitle`              | Page title                                                                                   | عنوان الصفحة                                                              |
| `seoDescription`        | Meta description                                                                             | الوصف التعريفي                                                            |
| `handle`                | URL handle                                                                                   | رابط المنتج                                                               |
| `statusCard`            | Status                                                                                       | الحالة                                                                    |
| `statusPublishedHint`   | Sold and shown on your store.                                                                | بيتباع وبيظهر في متجرك.                                                   |
| `statusDraftHint`       | Hidden from your store.                                                                      | مخفي من متجرك.                                                            |
| `statusUnlistedHint`    | Sold only through its direct link.                                                           | بيتباع من رابطه المباشر بس.                                               |
| `statusLocked`          | Use the actions below to change this status.                                                 | غيّر الحالة دي من الإجراءات اللي تحت.                                     |
| `organizationCard`      | Product organization                                                                         | تنظيم المنتج                                                              |
| `productType`           | Type                                                                                         | النوع                                                                     |
| `brand`                 | Vendor                                                                                       | المورّد                                                                   |
| `noBrand`               | None                                                                                         | بدون                                                                      |
| `categories`            | Categories                                                                                   | الفئات                                                                    |
| `tags`                  | Tags                                                                                         | العلامات (Tags)                                                           |
| `tagsHint`              | Separate tags with commas.                                                                   | افصل بين العلامات بفاصلة.                                                 |
| `moreActions`           | More actions                                                                                 | إجراءات أخرى                                                              |

Remove the keys only the deleted components used (`productEdit`, `productCreate`, `productVariantsForm`, `productOptionsForm`, `productSeoForm`, and any others), **only if** nothing else references them. Grep before you remove each one.

- [ ] **Step 4: Run, sequentially**

1. `pnpm.cmd --filter admin-web run test`
2. `pnpm.cmd --filter admin-web run typecheck`
3. `pnpm.cmd --filter admin-web run lint`

Expected: PASS, with no new warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src
git commit -m "feat(admin-web): replace the product screens with the one-page editor"
```

---

### Task 7: Docs, gaps, gates, push

- [ ] **Step 1: Gaps** (`docs/KNOWN_GAPS.md` and `docs/architecture/23-platform-gap-register.md`)

**Close G-97** (the admin screen lacks the Plan 2C-1 fields; prices typed in minor units), closed by Plan 2C-2.

**Narrow G-98:** the UI now generates SKUs, but the domain still requires them. Keep it open as **Low**.

**Open:**

- **Medium (Plan 2C-3):** "No image upload from the merchant's device; media is attached by asset id. Needs object storage (Cloudflare R2) and a signed-upload route."
- **Low:** "An archived product cannot be returned to draft or active from the editor (the domain has no unarchive)."
- **Low:** "A save that fails half-way leaves the earlier sections saved. Each call is idempotent and the page shows the saved state, but the save is not atomic."

- [ ] **Step 2: Gates, sequentially**

1. `pnpm.cmd --filter admin-web run test`
2. `pnpm.cmd -r --no-bail run typecheck`
3. `pnpm.cmd -r --no-bail run lint`
4. `pnpm.cmd arch`

Expected: all exit 0, with no new warnings.

- [ ] **Step 3: Commit and push** (no migration in this plan, so push directly)

```bash
git add docs/KNOWN_GAPS.md docs/architecture/23-platform-gap-register.md docs/superpowers/plans/2026-10-09-product-editor.md
git commit -m "docs(admin-web): record plan 2c-2, close g-97"
git push origin morbeh/w0-w17-w12
```

---

## Done criteria

- **One page, one Save.** The product detail page is a single page with a single Save. Title, description, price (typed `150.50`), compare-at, cost (with live profit and margin), SKU, barcode, physical product, weight (g/kg), SEO, handle, status (Active / Draft / Unlisted), type, vendor, categories and tags all save together. Only changed parts are sent.
- **Creating a product** uses the same page. A blank handle and a blank SKU are generated, and an Arabic title gets `product-xxxxxx`.
- **Options generate variants.** Typing `Size: S, M, L` on a one-variant product makes three variants, and the original keeps its id. Removing a value removes only its variants, after a confirmation.
- **Editing a variant** happens in a dialog, with all its fields.
- **Products with variants** show "set prices on each variant" in place of the single price, inventory and shipping cards.
- **No backend change.** Every admin-web test, typecheck, lint and arch passes.

## Report back

In Arabic for the owner:

- the task → commit → tests table;
- what the owner should click to try it (create a product, add sizes, edit one, unlist it);
- anything you decided that this plan did not.

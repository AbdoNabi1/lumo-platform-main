# Discounts Admin Screens (Part 2 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ملخص للمالك (بالعربي):** الجزء ده هو صفحة الخصومات في لوحة التاجر، شكلها وترتيبها زي شوبيفاي:
> قائمة بتبويبات (الكل/نشط/مجدول/منتهي) وبحث، زر "إنشاء خصم" بيفتح الأنواع الأربعة، وصفحة الخصم
> بعمودين (الحقول على الشمال والملخّص على اليمين) مع شريط "تغييرات غير محفوظة"، تعطيل/تفعيل وحذف.
> "العروض الترويجية" اتشالت من قايمة الخصومات (موجودة تحت أدوات المنصة)، وصفحة الطلب بقت بتعرض
> كود الخصم جنب سطر الخصم. مفيش migration في الجزء ده.

**Goal:** Give the merchant Shopify's Discounts screens — the list, the create dialog, and the two-column discount form — on top of the `/discounts` API built in Part 1, in English and Arabic.

**Architecture:** admin-web stays server-driven: pages fetch through `lib/api/discounts.ts`, writes go through `"use server"` actions in `app/discounts/actions.ts` (one idempotency key per submit). The form is one controlled client component (`DiscountEditor`) holding `DiscountFormValues` (what the merchant typed, as text); it posts them as one hidden JSON field, and the action converts them to the API's `DiscountInput` with the pure `toDiscountInput()` (`lib/discounts/form.ts`), using the store currency and time zone it re-reads itself. The same pure converter feeds the live Summary card in the browser. Pickers search through a read-only server action, never from browser JS to the runtime API.

**Tech Stack:** Next.js 15 (App Router, Server Components, Server Actions), React 19 (`useActionState`), TypeScript (strict, `noUncheckedIndexedAccess`), Vitest + Testing Library (jsdom), `@platform/ui` (Radix Dialog, Button, Card, Table, Badge, Input), `@platform/regions` (country codes).

**Spec:** `docs/superpowers/specs/2026-10-15-shopify-discounts-design.md` — section "Admin (apps/admin + apps/admin-web)" → "Screens", plus "The discount model" for the fields. Part 1's plan (`docs/superpowers/plans/2026-10-16-discounts-engine-and-checkout.md`, Task 11) built the API this plan consumes.

## Refinements to the spec made while planning (apply these, they win over the spec)

1. **The list tab parameter is `view`** (`GET /discounts?view=&q=&after=&first=`), as Part 1 built it — not `status`.
2. **Types in Shopify's dialog order:** Amount off products, Buy X get Y, Amount off order, Free shipping.
3. **Activate is offered only for a deactivated discount.** The DTO has no raw promotion status, so the form shows "Activate" when the status is `expired` and the end date has not passed (or there is none) — i.e. it was paused, not ended; "Deactivate" when `active` or `scheduled`; neither for a discount whose end date passed (the merchant edits the dates instead).
4. **Coupon redeem-by-hand is removed** together with the old coupon create form (both lived on the old `/discounts/new`); customers redeem at checkout now and Part 1 records usage. `/promotions` and its screens stay, listed under Platform tools.
5. **Validation messages are the app's own.** `toDiscountInput()` reports error _keys_; the action turns them into localized sentences. API field errors (422) are mapped back to form fields with `apiFieldToFormField()`, and shown as "This code is already in use." for a taken code or a generic "Check this field." otherwise — never the API's English text in the Arabic UI.
6. **Dates are entered in the store time zone** (Settings → General), labelled with its short name ("Start time (EET)"), and converted with `Intl` in `lib/discounts/zoned-time.ts` — never with the browser's zone.
7. **Combinations show all three classes**, the discount's own class labelled "Other product/order/shipping discounts", as Shopify does.
8. **Role gate unchanged:** `middleware.ts` already maps `/discounts` (and so `/discounts/new`, `/discounts/[id]`) to `operator`.

## Global Constraints

- Every runtime API call happens in a Server Component or Server Action — never in a Client Component (README "Three rules").
- One `newIdempotencyKey()` per submit, minted in the action before the first attempt.
- Every user-visible string lives in `src/messages/en.ts` **and** `src/messages/ar.ts` (`ar` is typed against `en`; a missing key is a compile error).
- Amounts are integer minor units in the store currency; typed amounts are converted with `toMinorUnits(text, currency)` (`lib/products/money.ts`). Percentages are 0 < p ≤ 100 with at most 2 decimals. Arabic-Indic digits are accepted.
- Discount codes are sent as `trim().toUpperCase()` and must match `^[A-Z0-9_-]{3,32}$`.
- RTL: use logical classes (`ms-`, `me-`, `ps-`, `start-`, `end-`), flip directional icons with `rtl:-scale-x-100`.
- Run tests with `pnpm exec vitest run <files>` and typecheck with `pnpm exec tsc --noEmit`, both from `apps/admin-web`. The whole suite takes ~3 minutes; run it in the background.
- Commits: Conventional Commits with a **lowercase** subject. This machine has no git identity: `git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit ...`; end every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only the task's files (`.claude/worktrees/` must stay untracked). Branch: `morbeh/discounts-admin-screens`.
- Match the surrounding code: doc comments on exported symbols, `readonly` props, `@/` imports, `Dictionary` from `@/messages/en`.

## Review Focus

1. **A merchant typing `" sale10 "` or `١٠` (Arabic digits)** must save `SALE10` / `10` — tests in Task 2.
2. **A date entered while the admin's browser is in another time zone** must be saved as that wall-clock time in the _store's_ zone — tests in Task 2 (`zonedToIso` with an explicit zone) and Task 4 (the action reads the zone from store settings, not from the payload).
3. **A forged or truncated `payload`** (not JSON, wrong type, missing fields) must answer a form error, never throw or call the API — test in Task 4.
4. **Editing a discount and pressing Discard** must restore every field, including picked products and dates — test in Task 7.
5. **A taken code** must show "This code is already in use." under the code field, in Arabic too — test in Task 4.

---

## File Structure

**Create**

- `apps/admin-web/src/lib/discounts/zoned-time.ts` (+ `.test.ts`) — store-zone wall clock ⇄ ISO, zone label, date formatting.
- `apps/admin-web/src/lib/discounts/form.ts` (+ `.test.ts`) — `DiscountFormValues`, defaults, DTO → values, values → `DiscountInput` + error keys, payload parsing, API-field mapping, random code.
- `apps/admin-web/src/lib/discounts/summary.ts` (+ `.test.ts`) — Shopify's summary lines (list line and Summary card).
- `apps/admin-web/src/lib/discounts/target-labels.ts` — server-side names for the ids a discount points at.
- `apps/admin-web/src/app/discounts/actions.test.ts`
- `apps/admin-web/src/app/discounts/[discountId]/page.tsx`
- `apps/admin-web/src/components/discounts/discount-status-badge.tsx`
- `apps/admin-web/src/components/discounts/discount-type-dialog.tsx` (+ `.test.tsx`)
- `apps/admin-web/src/components/discounts/discounts-tabs.tsx`
- `apps/admin-web/src/components/discounts/discounts-search.tsx`
- `apps/admin-web/src/components/discounts/discounts-table.test.tsx`
- `apps/admin-web/src/components/discounts/editor/resource-picker.tsx` (+ `.test.tsx`)
- `apps/admin-web/src/components/discounts/editor/inputs.tsx` — `CardProps`, `RadioRow`, `TextField`, `ErrorText`.
- `apps/admin-web/src/components/discounts/editor/method-card.tsx`
- `apps/admin-web/src/components/discounts/editor/value-card.tsx`
- `apps/admin-web/src/components/discounts/editor/buys-gets-card.tsx`
- `apps/admin-web/src/components/discounts/editor/free-shipping-card.tsx`
- `apps/admin-web/src/components/discounts/editor/rules-cards.tsx` — minimum, eligibility, max uses, combinations, active dates.
- `apps/admin-web/src/components/discounts/editor/summary-card.tsx`
- `apps/admin-web/src/components/discounts/editor/discount-lifecycle-actions.tsx`
- `apps/admin-web/src/components/discounts/editor/discount-editor.tsx` (+ `.test.tsx`)

**Modify**

- `apps/admin-web/src/lib/api/discounts.ts` (rewrite) + create `discounts.test.ts`.
- `apps/admin-web/src/lib/products/money.ts` — export `normalizeDigits`.
- `apps/admin-web/src/app/discounts/actions.ts` (rewrite), `page.tsx` (rewrite), `new/page.tsx` (rewrite).
- `apps/admin-web/src/components/discounts/discounts-table.tsx` (rewrite), `discounts-pagination.tsx` (message keys).
- `apps/admin-web/src/messages/en.ts`, `ar.ts` — new `discounts` section; remove `discountsPage`, `discountStatus`, `discountsRowActions`, `couponCreate`, `couponRedeem` once unused.
- `apps/admin-web/src/components/navigation.ts` (+ `navigation.test.tsx`).
- `apps/admin-web/src/lib/api/orders.ts`, `apps/admin-web/src/components/orders/order-payment-card.tsx` (+ its test).

**Delete**

- `apps/admin-web/src/components/discounts/coupon-create-form.tsx`, `coupon-redeem-form.tsx`
- `apps/admin-web/src/lib/coupon-lifecycle.ts`, `coupon-lifecycle.test.ts`

---

### Task 1: The `/discounts` API client

**Files:**

- Modify (rewrite): `apps/admin-web/src/lib/api/discounts.ts`
- Test: `apps/admin-web/src/lib/api/discounts.test.ts`

**Interfaces:**

- Consumes: `getAdminApi`, `mutateAdminApi`, `MutationResult` from `./client`.
- Produces (every later task imports these from `@/lib/api/discounts`): `DISCOUNT_TYPES`, `DiscountType`, `DiscountMethod`, `DiscountStatus`, `DISCOUNT_VIEWS`, `DiscountView`, `TargetScope`, `DiscountClass`, `DiscountValue`, `DiscountTargets`, `DiscountBuys`, `GetsEffect`, `DiscountGets`, `MinimumRequirement`, `CustomerEligibility`, `CombinesWith`, `DiscountDto`, `DiscountInput`, `DiscountsPageInfo`, `discountClassOf(type)`, `isDiscountType(v)`, `isDiscountView(v)`, `isDiscountDto(v)`, `fetchDiscountsPage(query)`, `fetchDiscount(id)`, `createDiscount(input, key)`, `updateDiscount(id, input, key)`, `deleteDiscount(id, key)`, `activateDiscount(id, key)`, `deactivateDiscount(id, key)`.

The old coupon functions (`fetchCouponsPage`, `createCoupon`, `advanceCoupon`, `redeemCoupon`) and types are removed here; their callers are replaced in Tasks 5 and 6. Until then typecheck is red for those callers only — that is expected; this task's own test must pass.

- [ ] **Step 1: Write the failing test** — `apps/admin-web/src/lib/api/discounts.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: vi.fn() }));

const {
  activateDiscount,
  createDiscount,
  deactivateDiscount,
  deleteDiscount,
  discountClassOf,
  fetchDiscount,
  fetchDiscountsPage,
  isDiscountDto,
  updateDiscount,
} = await import("./discounts");
import type { DiscountDto, DiscountInput } from "./discounts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const dto: DiscountDto = {
  id: "promo-1",
  type: "amount_off_order",
  method: "code",
  title: "SALE10",
  code: "SALE10",
  status: "active",
  value: { kind: "percentage", amount: 10 },
  appliesTo: null,
  appliesOncePerOrder: false,
  buys: null,
  gets: null,
  maxUsesPerOrder: null,
  countries: null,
  maxShippingRateMinor: null,
  minimumRequirement: { kind: "amount", amountMinor: 20000 },
  customerEligibility: { kind: "all" },
  usageLimit: null,
  oncePerCustomer: false,
  combinesWith: { product: false, order: false, shipping: true },
  startsAt: "2026-10-16T10:00:00.000Z",
  endsAt: null,
  usageCount: 3,
};

const input: DiscountInput = {
  type: "amount_off_order",
  method: "code",
  code: "SALE10",
  value: { kind: "percentage", amount: 10 },
  minimumRequirement: { kind: "none" },
  customerEligibility: { kind: "all" },
  oncePerCustomer: false,
  combinesWith: { product: false, order: false, shipping: false },
  startsAt: "2026-10-16T10:00:00.000Z",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
  vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

function lastCall(): [string, RequestInit] {
  return fetchMock.mock.calls.at(-1) as [string, RequestInit];
}

describe("discountClassOf", () => {
  it("maps Shopify's types to their combination class", () => {
    expect(discountClassOf("amount_off_products")).toBe("product");
    expect(discountClassOf("buy_x_get_y")).toBe("product");
    expect(discountClassOf("amount_off_order")).toBe("order");
    expect(discountClassOf("free_shipping")).toBe("shipping");
  });
});

describe("isDiscountDto", () => {
  it("accepts the API's shape and rejects others", () => {
    expect(isDiscountDto(dto)).toBe(true);
    expect(isDiscountDto({ ...dto, type: "bogus" })).toBe(false);
    expect(isDiscountDto({ id: "x" })).toBe(false);
    expect(isDiscountDto(null)).toBe(false);
  });
});

describe("fetchDiscountsPage", () => {
  it("sends view, q, first and after, and returns the page", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { items: [dto], pageInfo: { hasNextPage: true, endCursor: "c2" } }),
    );

    const result = await fetchDiscountsPage({
      view: "active",
      q: " sale ",
      first: 20,
      after: "c1",
    });

    expect(result).toEqual({
      outcome: "ok",
      items: [dto],
      pageInfo: { hasNextPage: true, endCursor: "c2" },
    });
    const url = new URL(lastCall()[0]);
    expect(url.pathname).toBe("/api/v1/discounts");
    expect(url.searchParams.get("view")).toBe("active");
    expect(url.searchParams.get("q")).toBe("sale");
    expect(url.searchParams.get("first")).toBe("20");
    expect(url.searchParams.get("after")).toBe("c1");
  });

  it("leaves out view=all and an empty search", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
    );

    await fetchDiscountsPage({ view: "all", q: "  " });

    const url = new URL(lastCall()[0]);
    expect(url.searchParams.has("view")).toBe(false);
    expect(url.searchParams.has("q")).toBe(false);
  });

  it("reports unauthorized and a bad shape", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    expect(await fetchDiscountsPage({})).toEqual({ outcome: "unauthorized" });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { nope: true }));
    expect((await fetchDiscountsPage({})).outcome).toBe("error");
  });
});

describe("fetchDiscount", () => {
  it("reads one discount by id", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, dto));
    expect(await fetchDiscount("promo 1")).toEqual({ outcome: "ok", discount: dto });
    expect(lastCall()[0]).toBe("http://runtime.test/api/v1/discounts/promo%201");
  });

  it("answers not_found for a 404", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, {}));
    expect(await fetchDiscount("gone")).toEqual({ outcome: "not_found" });
  });
});

describe("discount writes", () => {
  it("creates with POST, the body and the idempotency key", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, dto));

    const result = await createDiscount(input, "key-1");

    expect(result).toEqual({ outcome: "ok", data: dto });
    const [url, init] = lastCall();
    expect(url).toBe("http://runtime.test/api/v1/discounts");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });

  it("updates with PUT on the discount's path", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, dto));
    await updateDiscount("promo-1", input, "key-2");
    const [url, init] = lastCall();
    expect(url).toBe("http://runtime.test/api/v1/discounts/promo-1");
    expect(init.method).toBe("PUT");
  });

  it("deletes with DELETE", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "promo-1", deleted: true }));
    expect((await deleteDiscount("promo-1", "key-3")).outcome).toBe("ok");
    const [url, init] = lastCall();
    expect(url).toBe("http://runtime.test/api/v1/discounts/promo-1");
    expect(init.method).toBe("DELETE");
  });

  it("activates and deactivates with POST on their routes", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, dto));
    await activateDiscount("promo-1", "key-4");
    expect(lastCall()[0]).toBe("http://runtime.test/api/v1/discounts/promo-1/activate");
    await deactivateDiscount("promo-1", "key-5");
    expect(lastCall()[0]).toBe("http://runtime.test/api/v1/discounts/promo-1/deactivate");
    expect(lastCall()[1].method).toBe("POST");
  });

  it("keeps a 422's field issues", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(422, {
        code: "VALIDATION",
        message: "Invalid discount",
        retryable: false,
        fields: [{ field: "code", message: "This code is already in use" }],
      }),
    );
    expect(await createDiscount(input, "key-6")).toEqual({
      outcome: "invalid",
      message: "Invalid discount",
      fields: [{ field: "code", message: "This code is already in use" }],
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `apps/admin-web`): `pnpm exec vitest run src/lib/api/discounts.test.ts`
Expected: FAIL — `discountClassOf`/`fetchDiscountsPage` are not exported.

- [ ] **Step 3: Rewrite `apps/admin-web/src/lib/api/discounts.ts`**

```ts
import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

/**
 * Phase 2 Part 2 — the admin `/discounts` API (`apps/admin/src/http/discounts-routes.ts`): Shopify's
 * discounts, one facade over Promotions (the rule) and Coupons (the code). Reads need
 * `promotions:read`, every write `promotions:create` and is idempotent. The types mirror
 * `apps/admin/src/interfaces/discounts/discount-dto.ts` and `discount-input.ts`.
 */

/** Shopify's four types, in the order its "Select discount type" dialog lists them. */
export const DISCOUNT_TYPES = [
  "amount_off_products",
  "buy_x_get_y",
  "amount_off_order",
  "free_shipping",
] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];
export type DiscountMethod = "code" | "automatic";
export type DiscountStatus = "active" | "scheduled" | "expired";
/** The list's tabs. */
export const DISCOUNT_VIEWS = ["all", "active", "scheduled", "expired"] as const;
export type DiscountView = (typeof DISCOUNT_VIEWS)[number];
export type TargetScope = "products" | "categories";
/** Shopify's combination classes. */
export type DiscountClass = "product" | "order" | "shipping";

export interface DiscountValue {
  readonly kind: "percentage" | "fixed_amount";
  /** A percentage (0–100, two decimals) or minor units. */
  readonly amount: number;
}

export interface DiscountTargets {
  readonly kind: TargetScope;
  readonly refs: readonly string[];
}

export interface DiscountBuys {
  readonly kind: "quantity" | "amount";
  /** Items, or minor units for `amount`. */
  readonly value: number;
  readonly scope: TargetScope;
  readonly refs: readonly string[];
}

export type GetsEffect =
  { readonly kind: "percentage"; readonly value: number } | { readonly kind: "free" };

export interface DiscountGets {
  readonly quantity: number;
  readonly scope: TargetScope;
  readonly refs: readonly string[];
  readonly effect: GetsEffect;
}

export type MinimumRequirement =
  | { readonly kind: "none" }
  | { readonly kind: "amount"; readonly amountMinor: number }
  | { readonly kind: "quantity"; readonly quantity: number };

export type CustomerEligibility =
  | { readonly kind: "all" }
  | { readonly kind: "customers"; readonly customerRefs: readonly string[] };

export interface CombinesWith {
  readonly product: boolean;
  readonly order: boolean;
  readonly shipping: boolean;
}

/** One discount as the API reads it back: the form's fields, the derived status, the usage. */
export interface DiscountDto {
  readonly id: string;
  readonly type: DiscountType;
  readonly method: DiscountMethod;
  readonly title: string;
  readonly code: string | null;
  readonly status: DiscountStatus;
  readonly value: DiscountValue | null;
  readonly appliesTo: DiscountTargets | null;
  readonly appliesOncePerOrder: boolean;
  readonly buys: DiscountBuys | null;
  readonly gets: DiscountGets | null;
  readonly maxUsesPerOrder: number | null;
  readonly countries: readonly string[] | null;
  readonly maxShippingRateMinor: number | null;
  readonly minimumRequirement: MinimumRequirement;
  readonly customerEligibility: CustomerEligibility;
  readonly usageLimit: number | null;
  readonly oncePerCustomer: boolean;
  readonly combinesWith: CombinesWith;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly usageCount: number;
}

/** The body of `POST /discounts` and `PUT /discounts/:id` (`discountInputSchema`). */
export interface DiscountInput {
  readonly type: DiscountType;
  readonly method: DiscountMethod;
  readonly title?: string;
  readonly code?: string;
  readonly value?: DiscountValue;
  readonly appliesTo?: DiscountTargets;
  readonly appliesOncePerOrder?: boolean;
  readonly buys?: DiscountBuys;
  readonly gets?: DiscountGets;
  readonly maxUsesPerOrder?: number;
  readonly countries?: readonly string[];
  readonly maxShippingRateMinor?: number;
  readonly minimumRequirement: MinimumRequirement;
  readonly customerEligibility: CustomerEligibility;
  readonly usageLimit?: number;
  readonly oncePerCustomer: boolean;
  readonly combinesWith: CombinesWith;
  readonly startsAt: string;
  readonly endsAt?: string;
}

export interface DiscountsPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

/** Shopify's combination class of each type. */
export function discountClassOf(type: DiscountType): DiscountClass {
  if (type === "amount_off_order") return "order";
  if (type === "free_shipping") return "shipping";
  return "product";
}

export function isDiscountType(value: unknown): value is DiscountType {
  return typeof value === "string" && (DISCOUNT_TYPES as readonly string[]).includes(value);
}

export function isDiscountView(value: unknown): value is DiscountView {
  return typeof value === "string" && (DISCOUNT_VIEWS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Checks the fields every screen reads; the rest follow the API's contract. */
export function isDiscountDto(value: unknown): value is DiscountDto {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    isDiscountType(value["type"]) &&
    (value["method"] === "code" || value["method"] === "automatic") &&
    typeof value["title"] === "string" &&
    (value["status"] === "active" ||
      value["status"] === "scheduled" ||
      value["status"] === "expired") &&
    isRecord(value["minimumRequirement"]) &&
    isRecord(value["customerEligibility"]) &&
    isRecord(value["combinesWith"]) &&
    typeof value["startsAt"] === "string" &&
    typeof value["usageCount"] === "number"
  );
}

interface DiscountsPageDto {
  readonly items: readonly DiscountDto[];
  readonly pageInfo: DiscountsPageInfo;
}

function isDiscountsPageDto(value: unknown): value is DiscountsPageDto {
  return (
    isRecord(value) &&
    Array.isArray(value["items"]) &&
    value["items"].every(isDiscountDto) &&
    isRecord(value["pageInfo"])
  );
}

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

export type FetchDiscountsPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly DiscountDto[];
      readonly pageInfo: DiscountsPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /discounts` — one tab of the list, searched by title or code, cursor-paginated. */
export async function fetchDiscountsPage(query: {
  readonly view?: DiscountView;
  readonly q?: string;
  readonly first?: number;
  readonly after?: string;
}): Promise<FetchDiscountsPageResult> {
  const params = new URLSearchParams();
  if (query.view !== undefined && query.view !== "all") params.set("view", query.view);
  const q = query.q?.trim() ?? "";
  if (q !== "") params.set("q", q);
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);

  const result = await getAdminApi(`/api/v1/discounts?${params.toString()}`, isDiscountsPageDto);
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  }
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}

export type FetchDiscountResult =
  | { readonly outcome: "ok"; readonly discount: DiscountDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

function discountPath(discountId: string, suffix = ""): string {
  return `/api/v1/discounts/${encodeURIComponent(discountId)}${suffix}`;
}

/** `GET /discounts/:discountId` — the form's shape. A deleted discount is `not_found`. */
export async function fetchDiscount(discountId: string): Promise<FetchDiscountResult> {
  const result = await getAdminApi(discountPath(discountId), isDiscountDto);
  if (result.outcome === "ok") return { outcome: "ok", discount: result.data };
  return result;
}

/** `POST /discounts` — creates the discount (and its code) and activates it. */
export function createDiscount(
  input: DiscountInput,
  idempotencyKey: string,
): Promise<MutationResult<DiscountDto>> {
  return mutateAdminApi(
    "/api/v1/discounts",
    { method: "POST", body: input, idempotencyKey },
    isDiscountDto,
  );
}

/** `PUT /discounts/:discountId` — every field except the type and the method. */
export function updateDiscount(
  discountId: string,
  input: DiscountInput,
  idempotencyKey: string,
): Promise<MutationResult<DiscountDto>> {
  return mutateAdminApi(
    discountPath(discountId),
    { method: "PUT", body: input, idempotencyKey },
    isDiscountDto,
  );
}

/** `DELETE /discounts/:discountId` — archives it; it leaves every list. */
export function deleteDiscount(
  discountId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(discountPath(discountId), { method: "DELETE", idempotencyKey }, isUnknown);
}

/** `POST /discounts/:discountId/activate` — resumes a deactivated discount. */
export function activateDiscount(
  discountId: string,
  idempotencyKey: string,
): Promise<MutationResult<DiscountDto>> {
  return mutateAdminApi(
    discountPath(discountId, "/activate"),
    { method: "POST", idempotencyKey },
    isDiscountDto,
  );
}

/** `POST /discounts/:discountId/deactivate` — Shopify's Deactivate: it stops at once. */
export function deactivateDiscount(
  discountId: string,
  idempotencyKey: string,
): Promise<MutationResult<DiscountDto>> {
  return mutateAdminApi(
    discountPath(discountId, "/deactivate"),
    { method: "POST", idempotencyKey },
    isDiscountDto,
  );
}
```

- [ ] **Step 4: Run the test and the route contract test**

Run: `pnpm exec vitest run src/lib/api/discounts.test.ts src/lib/api/route-contract.test.ts`
Expected: PASS (the route contract test confirms every path above exists in `apps/admin/src/http/discounts-routes.ts`).

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/lib/api/discounts.ts apps/admin-web/src/lib/api/discounts.test.ts
git commit -m "feat(admin-web): typed client for the shopify-style discounts api"
```

---

### Task 2: Form values, conversion and store-zone dates (pure)

**Files:**

- Create: `apps/admin-web/src/lib/discounts/zoned-time.ts`, `zoned-time.test.ts`
- Create: `apps/admin-web/src/lib/discounts/form.ts`, `form.test.ts`
- Modify: `apps/admin-web/src/lib/products/money.ts` (export `normalizeDigits`)

**Interfaces:**

- Consumes: Task 1 types; `toMinorUnits`, `fromMinorUnits` from `@/lib/products/money`.
- Produces:
  - `zoned-time.ts`: `safeZone(tz): string`, `zonedToIso(date: string, time: string, tz: string): string | null`, `isoToZoned(iso, tz): { date: string; time: string }`, `zoneLabel(tz, locale, at?): string`, `formatZonedDate(iso, locale, tz): string`.
  - `form.ts`: `PickedItem`, `DiscountFormValues`, `TargetLabels`, `DiscountErrorKey`, `DiscountFieldErrors`, `emptyFormValues(type, now, tz)`, `formValuesFromDto(dto, labels, currency, tz)`, `toDiscountInput(values, currency, tz): { input: DiscountInput; fieldErrors: DiscountFieldErrors }`, `parseFormValues(raw: unknown): DiscountFormValues | null`, `apiFieldToFormField(path): string`, `generateDiscountCode(): string`, `parsePercent(text)`, `parsePositiveInt(text)`.
  - Form field names (the keys of `DiscountFieldErrors`, also used by the cards to show errors): `code`, `title`, `value`, `appliesTo`, `buys`, `buysItems`, `gets`, `getsItems`, `getsEffect`, `maxUsesPerOrder`, `countries`, `maxShippingRateMinor`, `minimumRequirement`, `customerEligibility`, `usageLimit`, `startsAt`, `endsAt`.

- [ ] **Step 1: Export `normalizeDigits` from `apps/admin-web/src/lib/products/money.ts`**

Change `function normalizeDigits(text: string): string {` to:

```ts
/** Arabic-Indic digits and the Arabic decimal separator to ASCII; grouping marks and spaces dropped. */
export function normalizeDigits(text: string): string {
```

- [ ] **Step 2: Write the failing tests**

`apps/admin-web/src/lib/discounts/zoned-time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatZonedDate, isoToZoned, safeZone, zoneLabel, zonedToIso } from "./zoned-time";

describe("zonedToIso", () => {
  it("reads the wall clock in the store's zone, not the machine's", () => {
    expect(zonedToIso("2026-10-16", "14:30", "Asia/Dubai")).toBe("2026-10-16T10:30:00.000Z");
    expect(zonedToIso("2026-10-16", "14:30", "UTC")).toBe("2026-10-16T14:30:00.000Z");
  });

  it("rejects dates and times that do not exist", () => {
    expect(zonedToIso("2026-02-30", "10:00", "UTC")).toBeNull();
    expect(zonedToIso("2026-10-16", "24:10", "UTC")).toBeNull();
    expect(zonedToIso("", "10:00", "UTC")).toBeNull();
    expect(zonedToIso("2026-10-16", "", "UTC")).toBeNull();
  });

  it("falls back to UTC for an unknown zone", () => {
    expect(safeZone("Not/AZone")).toBe("UTC");
    expect(zonedToIso("2026-10-16", "08:00", "Not/AZone")).toBe("2026-10-16T08:00:00.000Z");
  });
});

describe("isoToZoned", () => {
  it("is the inverse of zonedToIso", () => {
    expect(isoToZoned("2026-10-16T10:30:00.000Z", "Asia/Dubai")).toEqual({
      date: "2026-10-16",
      time: "14:30",
    });
    expect(isoToZoned("2026-12-31T23:05:00.000Z", "UTC")).toEqual({
      date: "2026-12-31",
      time: "23:05",
    });
  });
});

describe("zoneLabel / formatZonedDate", () => {
  it("names the zone and formats a date in it", () => {
    expect(zoneLabel("UTC", "en")).toMatch(/UTC/);
    expect(formatZonedDate("2026-10-16T22:30:00.000Z", "en", "Asia/Dubai")).toMatch(/Oct 17/);
  });
});
```

`apps/admin-web/src/lib/discounts/form.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DiscountDto } from "@/lib/api/discounts";
import {
  apiFieldToFormField,
  emptyFormValues,
  formValuesFromDto,
  generateDiscountCode,
  parseFormValues,
  parsePercent,
  parsePositiveInt,
  toDiscountInput,
  type DiscountFormValues,
} from "./form";

const NOW = new Date("2026-10-16T10:30:00.000Z");
const ZONE = "UTC";

function values(overrides: Partial<DiscountFormValues> = {}): DiscountFormValues {
  return { ...emptyFormValues("amount_off_order", NOW, ZONE), ...overrides };
}

describe("parsePercent / parsePositiveInt", () => {
  it("accepts Arabic digits and up to two decimals", () => {
    expect(parsePercent("١٠")).toBe(10);
    expect(parsePercent("12.5")).toBe(12.5);
    expect(parsePercent("12.555")).toBeNull();
    expect(parsePercent("abc")).toBeNull();
    expect(parsePositiveInt("٣")).toBe(3);
    expect(parsePositiveInt("0")).toBeNull();
    expect(parsePositiveInt("2.5")).toBeNull();
  });
});

describe("emptyFormValues", () => {
  it("starts now, in the store's zone, as a code with nothing combined", () => {
    const empty = emptyFormValues("free_shipping", NOW, "Asia/Dubai");
    expect(empty.type).toBe("free_shipping");
    expect(empty.method).toBe("code");
    expect(empty.startDate).toBe("2026-10-16");
    expect(empty.startTime).toBe("14:30");
    expect(empty.hasEndDate).toBe(false);
    expect(empty.combinesWith).toEqual({ product: false, order: false, shipping: false });
  });
});

describe("toDiscountInput", () => {
  it("builds SALE10: 10% off the order over EGP 200", () => {
    const { input, fieldErrors } = toDiscountInput(
      values({
        code: " sale10 ",
        valueAmount: "10",
        minimumKind: "amount",
        minimumAmount: "200",
      }),
      "EGP",
      ZONE,
    );

    expect(fieldErrors).toEqual({});
    expect(input).toEqual({
      type: "amount_off_order",
      method: "code",
      code: "SALE10",
      value: { kind: "percentage", amount: 10 },
      minimumRequirement: { kind: "amount", amountMinor: 20000 },
      customerEligibility: { kind: "all" },
      oncePerCustomer: false,
      combinesWith: { product: false, order: false, shipping: false },
      startsAt: "2026-10-16T10:30:00.000Z",
    });
  });

  it("reports each missing or wrong field by its key", () => {
    const { fieldErrors } = toDiscountInput(
      values({
        code: "a!",
        valueAmount: "150",
        hasEndDate: true,
        endDate: "2026-10-15",
        endTime: "10:00",
      }),
      "EGP",
      ZONE,
    );
    expect(fieldErrors).toEqual({
      code: "codeFormat",
      value: "percentRange",
      endsAt: "endBeforeStart",
    });
    expect(toDiscountInput(values(), "EGP", ZONE).fieldErrors).toEqual({
      code: "required",
      value: "required",
    });
  });

  it("titles an automatic discount and drops the code-only limits", () => {
    const { input, fieldErrors } = toDiscountInput(
      values({
        method: "automatic",
        title: "  Summer  ",
        valueKind: "fixed_amount",
        valueAmount: "50",
        limitTotalUses: true,
        usageLimit: "10",
        oncePerCustomer: true,
      }),
      "EGP",
      ZONE,
    );
    expect(fieldErrors).toEqual({});
    expect(input.title).toBe("Summer");
    expect(input.code).toBeUndefined();
    expect(input.value).toEqual({ kind: "fixed_amount", amount: 5000 });
    expect(input.usageLimit).toBeUndefined();
    expect(input.oncePerCustomer).toBe(false);
  });

  it("needs picked items for amount off products, and sends once-per-order for a fixed amount", () => {
    const base = { ...emptyFormValues("amount_off_products", NOW, ZONE), code: "SHOES" };
    expect(toDiscountInput({ ...base, valueAmount: "10" }, "EGP", ZONE).fieldErrors).toEqual({
      appliesTo: "chooseItems",
    });

    const { input } = toDiscountInput(
      {
        ...base,
        valueKind: "fixed_amount",
        valueAmount: "25.50",
        appliesToKind: "categories",
        appliesToItems: [{ id: "cat-1", label: "Shoes" }],
        appliesOncePerOrder: true,
      },
      "EGP",
      ZONE,
    );
    expect(input.appliesTo).toEqual({ kind: "categories", refs: ["cat-1"] });
    expect(input.value).toEqual({ kind: "fixed_amount", amount: 2550 });
    expect(input.appliesOncePerOrder).toBe(true);
  });

  it("builds buy X get Y, without a minimum requirement", () => {
    const { input, fieldErrors } = toDiscountInput(
      {
        ...emptyFormValues("buy_x_get_y", NOW, ZONE),
        code: "B2G1",
        buysKind: "amount",
        buysValue: "300",
        buysItems: [{ id: "p-1", label: "Shirt" }],
        getsQuantity: "1",
        getsScope: "categories",
        getsItems: [{ id: "c-1", label: "Socks" }],
        getsEffect: "free",
        limitUsesPerOrder: true,
        maxUsesPerOrder: "2",
        minimumKind: "amount",
        minimumAmount: "999",
      },
      "EGP",
      ZONE,
    );
    expect(fieldErrors).toEqual({});
    expect(input.buys).toEqual({ kind: "amount", value: 30000, scope: "products", refs: ["p-1"] });
    expect(input.gets).toEqual({
      quantity: 1,
      scope: "categories",
      refs: ["c-1"],
      effect: { kind: "free" },
    });
    expect(input.maxUsesPerOrder).toBe(2);
    expect(input.minimumRequirement).toEqual({ kind: "none" });
  });

  it("reports buy X get Y's own fields", () => {
    const { fieldErrors } = toDiscountInput(
      { ...emptyFormValues("buy_x_get_y", NOW, ZONE), code: "B2G1", getsPercentage: "0" },
      "EGP",
      ZONE,
    );
    expect(fieldErrors).toEqual({
      buys: "required",
      buysItems: "chooseItems",
      gets: "required",
      getsItems: "chooseItems",
      getsEffect: "percentRange",
    });
  });

  it("builds free shipping to chosen countries under a rate cap", () => {
    const { input, fieldErrors } = toDiscountInput(
      {
        ...emptyFormValues("free_shipping", NOW, ZONE),
        code: "SHIPFREE",
        allCountries: false,
        countries: [{ id: "EG", label: "Egypt" }],
        excludeRatesOver: true,
        maxShippingRate: "75",
      },
      "EGP",
      ZONE,
    );
    expect(fieldErrors).toEqual({});
    expect(input.countries).toEqual(["EG"]);
    expect(input.maxShippingRateMinor).toBe(7500);
    expect(input.value).toBeUndefined();
  });

  it("limits a code to specific customers, total uses and one use each", () => {
    const { input } = toDiscountInput(
      values({
        code: "VIP",
        valueAmount: "5",
        allCustomers: false,
        customers: [{ id: "cus-1", label: "Mona" }],
        limitTotalUses: true,
        usageLimit: "100",
        oncePerCustomer: true,
        combinesWith: { product: true, order: false, shipping: true },
        hasEndDate: true,
        endDate: "2026-10-31",
        endTime: "23:59",
      }),
      "EGP",
      ZONE,
    );
    expect(input.customerEligibility).toEqual({ kind: "customers", customerRefs: ["cus-1"] });
    expect(input.usageLimit).toBe(100);
    expect(input.oncePerCustomer).toBe(true);
    expect(input.combinesWith).toEqual({ product: true, order: false, shipping: true });
    expect(input.endsAt).toBe("2026-10-31T23:59:00.000Z");
  });

  it("asks for customers when specific customers has none", () => {
    expect(
      toDiscountInput(values({ code: "VIP", valueAmount: "5", allCustomers: false }), "EGP", ZONE)
        .fieldErrors,
    ).toEqual({ customerEligibility: "chooseCustomers" });
  });
});

describe("formValuesFromDto", () => {
  it("is the inverse of toDiscountInput, with the picked items named", () => {
    const dto: DiscountDto = {
      id: "promo-1",
      type: "amount_off_products",
      method: "code",
      title: "SHOES",
      code: "SHOES",
      status: "active",
      value: { kind: "fixed_amount", amount: 2550 },
      appliesTo: { kind: "products", refs: ["p-1", "p-2"] },
      appliesOncePerOrder: true,
      buys: null,
      gets: null,
      maxUsesPerOrder: null,
      countries: null,
      maxShippingRateMinor: null,
      minimumRequirement: { kind: "quantity", quantity: 2 },
      customerEligibility: { kind: "customers", customerRefs: ["cus-1"] },
      usageLimit: 50,
      oncePerCustomer: true,
      combinesWith: { product: false, order: true, shipping: false },
      startsAt: "2026-10-16T10:30:00.000Z",
      endsAt: "2026-10-31T21:59:00.000Z",
      usageCount: 4,
    };

    const form = formValuesFromDto(
      dto,
      {
        products: { "p-1": "Sneaker" },
        categories: {},
        customers: { "cus-1": "Mona" },
        countries: {},
      },
      "EGP",
      ZONE,
    );

    expect(form.valueAmount).toBe("25.50");
    expect(form.appliesToItems).toEqual([
      { id: "p-1", label: "Sneaker" },
      { id: "p-2", label: "p-2" },
    ]);
    expect(form.minimumKind).toBe("quantity");
    expect(form.minimumQuantity).toBe("2");
    expect(form.customers).toEqual([{ id: "cus-1", label: "Mona" }]);
    expect(form.limitTotalUses).toBe(true);
    expect(form.usageLimit).toBe("50");
    expect(form.hasEndDate).toBe(true);
    expect(form.endDate).toBe("2026-10-31");
    expect(form.endTime).toBe("21:59");

    const { input, fieldErrors } = toDiscountInput(form, "EGP", ZONE);
    expect(fieldErrors).toEqual({});
    expect(input.value).toEqual(dto.value);
    expect(input.appliesTo).toEqual(dto.appliesTo);
    expect(input.startsAt).toBe(dto.startsAt);
    expect(input.endsAt).toBe(dto.endsAt);
  });
});

describe("parseFormValues", () => {
  it("accepts what the editor posts", () => {
    const posted = JSON.parse(JSON.stringify(values({ code: "X1Y" })));
    expect(parseFormValues(posted)).toEqual(values({ code: "X1Y" }));
  });

  it("rejects anything else", () => {
    expect(parseFormValues(null)).toBeNull();
    expect(parseFormValues("x")).toBeNull();
    expect(parseFormValues({ ...values(), type: "bogus" })).toBeNull();
    expect(parseFormValues({ ...values(), method: "magic" })).toBeNull();
  });

  it("drops malformed picked items instead of trusting them", () => {
    const parsed = parseFormValues({
      ...values(),
      customers: [{ id: "cus-1", label: "Mona" }, { id: 5 }, "x"],
    });
    expect(parsed?.customers).toEqual([{ id: "cus-1", label: "Mona" }]);
  });
});

describe("apiFieldToFormField", () => {
  it("maps the API's issue paths onto the form's fields", () => {
    expect(apiFieldToFormField("code")).toBe("code");
    expect(apiFieldToFormField("buys.refs")).toBe("buysItems");
    expect(apiFieldToFormField("gets.refs.0")).toBe("getsItems");
    expect(apiFieldToFormField("gets.effect.value")).toBe("gets");
    expect(apiFieldToFormField("customerEligibility.customerRefs")).toBe("customerEligibility");
  });
});

describe("generateDiscountCode", () => {
  it("makes a 12-character code the API accepts, different each time", () => {
    const first = generateDiscountCode();
    expect(first).toMatch(/^[A-Z0-9]{12}$/);
    expect(generateDiscountCode()).not.toBe(first);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm exec vitest run src/lib/discounts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write `apps/admin-web/src/lib/discounts/zoned-time.ts`**

```ts
/**
 * Dates in the store's time zone (Settings → General), as Shopify's discount form shows them. The
 * merchant's browser may sit in another zone than the store, so a typed date and time is converted
 * here, with the zone named explicitly — never with the machine's own zone.
 */

const FALLBACK_ZONE = "UTC";

/** The zone itself when `Intl` knows it, otherwise UTC. */
export function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_ZONE;
  }
}

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function wallClockOf(instant: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
  };
}

/** How far the zone's wall clock is ahead of UTC at `instant`, in ms. */
function offsetAt(instant: number, timeZone: string): number {
  const wall = wallClockOf(new Date(instant), timeZone);
  const minuteFloor = Math.floor(instant / 60_000) * 60_000;
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - minuteFloor;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** "2026-10-16" + "14:30" on the zone's wall clock → an ISO instant; null when it is not a real date or time. */
export function zonedToIso(date: string, time: string, timeZone: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (dateMatch === null || timeMatch === null) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(wall).getUTCDate() !== day) return null;
  const zone = safeZone(timeZone);
  // Two passes settle the offset on either side of a daylight-saving change.
  let instant = wall - offsetAt(wall, zone);
  instant = wall - offsetAt(instant, zone);
  return new Date(instant).toISOString();
}

/** An ISO instant as the date and time the zone's wall clock shows ("2026-10-16", "14:30"). */
export function isoToZoned(
  iso: string,
  timeZone: string,
): { readonly date: string; readonly time: string } {
  const wall = wallClockOf(new Date(iso), safeZone(timeZone));
  return {
    date: `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`,
    time: `${pad(wall.hour)}:${pad(wall.minute)}`,
  };
}

/** The zone's short name for a label: "EET", "GMT+4", "UTC". */
export function zoneLabel(timeZone: string, locale: string, at: Date = new Date()): string {
  const zone = safeZone(timeZone);
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    timeZoneName: "short",
  }).formatToParts(at);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? zone;
}

/** "Oct 16, 2026" in the store's zone. */
export function formatZonedDate(iso: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: safeZone(timeZone),
  }).format(new Date(iso));
}
```

- [ ] **Step 5: Write `apps/admin-web/src/lib/discounts/form.ts`**

```ts
import {
  isDiscountType,
  type CombinesWith,
  type DiscountDto,
  type DiscountInput,
  type DiscountType,
  type TargetScope,
} from "@/lib/api/discounts";
import { fromMinorUnits, normalizeDigits, toMinorUnits } from "@/lib/products/money";
import { isoToZoned, zonedToIso } from "./zoned-time";

/**
 * Phase 2 Part 2 — the discount form as the merchant types it. Every field is kept as typed (text),
 * so the form can hold "12." mid-typing; `toDiscountInput` turns it into the API's body and says,
 * by key, which fields are wrong. The same pure function runs in the browser (the live Summary
 * card) and in the save action (with the store currency and zone the action re-reads itself).
 */

/** Something picked in a Browse dialog: a product, category, customer or country. */
export interface PickedItem {
  readonly id: string;
  readonly label: string;
}

export interface DiscountFormValues {
  readonly type: DiscountType;
  readonly method: "code" | "automatic";
  readonly code: string;
  readonly title: string;
  readonly valueKind: "percentage" | "fixed_amount";
  readonly valueAmount: string;
  readonly appliesToKind: TargetScope;
  readonly appliesToItems: readonly PickedItem[];
  readonly appliesOncePerOrder: boolean;
  readonly buysKind: "quantity" | "amount";
  readonly buysValue: string;
  readonly buysScope: TargetScope;
  readonly buysItems: readonly PickedItem[];
  readonly getsQuantity: string;
  readonly getsScope: TargetScope;
  readonly getsItems: readonly PickedItem[];
  readonly getsEffect: "percentage" | "free";
  readonly getsPercentage: string;
  readonly limitUsesPerOrder: boolean;
  readonly maxUsesPerOrder: string;
  readonly allCountries: boolean;
  readonly countries: readonly PickedItem[];
  readonly excludeRatesOver: boolean;
  readonly maxShippingRate: string;
  readonly minimumKind: "none" | "amount" | "quantity";
  readonly minimumAmount: string;
  readonly minimumQuantity: string;
  readonly allCustomers: boolean;
  readonly customers: readonly PickedItem[];
  readonly limitTotalUses: boolean;
  readonly usageLimit: string;
  readonly oncePerCustomer: boolean;
  readonly combinesWith: CombinesWith;
  readonly startDate: string;
  readonly startTime: string;
  readonly hasEndDate: boolean;
  readonly endDate: string;
  readonly endTime: string;
}

/** Names for the ids a saved discount points at, resolved on the server. Unknown ids show as themselves. */
export interface TargetLabels {
  readonly products: Readonly<Record<string, string>>;
  readonly categories: Readonly<Record<string, string>>;
  readonly customers: Readonly<Record<string, string>>;
  readonly countries: Readonly<Record<string, string>>;
}

/** What is wrong with a field; each key has a sentence under `discounts.errors`. */
export type DiscountErrorKey =
  | "required"
  | "codeFormat"
  | "percentRange"
  | "amountInvalid"
  | "wholeNumber"
  | "chooseItems"
  | "chooseCountries"
  | "chooseCustomers"
  | "dateInvalid"
  | "endBeforeStart";

export type DiscountFieldErrors = Readonly<Record<string, DiscountErrorKey>>;

const CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

/** "10", "12.5", "١٠" → the percentage; null unless it is a number with at most two decimals. */
export function parsePercent(text: string): number | null {
  const normalized = normalizeDigits(text.trim());
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? Number(normalized) : null;
}

/** A whole number above zero, Arabic digits accepted; null otherwise. */
export function parsePositiveInt(text: string): number | null {
  const normalized = normalizeDigits(text.trim());
  if (!/^\d+$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** A new discount of `type`: a code, starting now in the store's zone, combining with nothing. */
export function emptyFormValues(
  type: DiscountType,
  now: Date,
  timeZone: string,
): DiscountFormValues {
  const start = isoToZoned(now.toISOString(), timeZone);
  return {
    type,
    method: "code",
    code: "",
    title: "",
    valueKind: "percentage",
    valueAmount: "",
    appliesToKind: "products",
    appliesToItems: [],
    appliesOncePerOrder: false,
    buysKind: "quantity",
    buysValue: "",
    buysScope: "products",
    buysItems: [],
    getsQuantity: "",
    getsScope: "products",
    getsItems: [],
    getsEffect: "percentage",
    getsPercentage: "",
    limitUsesPerOrder: false,
    maxUsesPerOrder: "",
    allCountries: true,
    countries: [],
    excludeRatesOver: false,
    maxShippingRate: "",
    minimumKind: "none",
    minimumAmount: "",
    minimumQuantity: "",
    allCustomers: true,
    customers: [],
    limitTotalUses: false,
    usageLimit: "",
    oncePerCustomer: false,
    combinesWith: { product: false, order: false, shipping: false },
    startDate: start.date,
    startTime: start.time,
    hasEndDate: false,
    endDate: "",
    endTime: "",
  };
}

/** A saved discount back into the form, amounts as the merchant would type them. */
export function formValuesFromDto(
  dto: DiscountDto,
  labels: TargetLabels,
  currency: string,
  timeZone: string,
): DiscountFormValues {
  const named =
    (names: Readonly<Record<string, string>>) =>
    (id: string): PickedItem => ({ id, label: names[id] ?? id });
  const itemsOf = (scope: TargetScope, refs: readonly string[]) =>
    refs.map(named(scope === "categories" ? labels.categories : labels.products));
  const money = (minor: number) => fromMinorUnits(minor, currency);
  const start = isoToZoned(dto.startsAt, timeZone);
  const end = dto.endsAt === null ? null : isoToZoned(dto.endsAt, timeZone);
  const minimum = dto.minimumRequirement;
  const eligibility = dto.customerEligibility;
  const effect = dto.gets?.effect;

  return {
    ...emptyFormValues(dto.type, new Date(dto.startsAt), timeZone),
    method: dto.method,
    code: dto.code ?? "",
    title: dto.method === "automatic" ? dto.title : "",
    valueKind: dto.value?.kind ?? "percentage",
    valueAmount:
      dto.value === null
        ? ""
        : dto.value.kind === "percentage"
          ? String(dto.value.amount)
          : money(dto.value.amount),
    appliesToKind: dto.appliesTo?.kind ?? "products",
    appliesToItems: dto.appliesTo === null ? [] : itemsOf(dto.appliesTo.kind, dto.appliesTo.refs),
    appliesOncePerOrder: dto.appliesOncePerOrder,
    buysKind: dto.buys?.kind ?? "quantity",
    buysValue:
      dto.buys === null
        ? ""
        : dto.buys.kind === "amount"
          ? money(dto.buys.value)
          : String(dto.buys.value),
    buysScope: dto.buys?.scope ?? "products",
    buysItems: dto.buys === null ? [] : itemsOf(dto.buys.scope, dto.buys.refs),
    getsQuantity: dto.gets === null ? "" : String(dto.gets.quantity),
    getsScope: dto.gets?.scope ?? "products",
    getsItems: dto.gets === null ? [] : itemsOf(dto.gets.scope, dto.gets.refs),
    getsEffect: effect?.kind ?? "percentage",
    getsPercentage: effect?.kind === "percentage" ? String(effect.value) : "",
    limitUsesPerOrder: dto.maxUsesPerOrder !== null,
    maxUsesPerOrder: dto.maxUsesPerOrder === null ? "" : String(dto.maxUsesPerOrder),
    allCountries: dto.countries === null,
    countries: (dto.countries ?? []).map(named(labels.countries)),
    excludeRatesOver: dto.maxShippingRateMinor !== null,
    maxShippingRate: dto.maxShippingRateMinor === null ? "" : money(dto.maxShippingRateMinor),
    minimumKind: minimum.kind,
    minimumAmount: minimum.kind === "amount" ? money(minimum.amountMinor) : "",
    minimumQuantity: minimum.kind === "quantity" ? String(minimum.quantity) : "",
    allCustomers: eligibility.kind === "all",
    customers:
      eligibility.kind === "customers" ? eligibility.customerRefs.map(named(labels.customers)) : [],
    limitTotalUses: dto.usageLimit !== null,
    usageLimit: dto.usageLimit === null ? "" : String(dto.usageLimit),
    oncePerCustomer: dto.oncePerCustomer,
    combinesWith: dto.combinesWith,
    startDate: start.date,
    startTime: start.time,
    hasEndDate: end !== null,
    endDate: end?.date ?? "",
    endTime: end?.time ?? "",
  };
}

type Draft = { -readonly [K in keyof DiscountInput]: DiscountInput[K] };

const ids = (items: readonly PickedItem[]) => items.map((item) => item.id);

/**
 * The form to the API's body, plus what is wrong, by field. The body is always built from the fields
 * that read correctly, so the Summary card can follow a half-filled form; it is sent only when
 * `fieldErrors` is empty.
 */
export function toDiscountInput(
  values: DiscountFormValues,
  currency: string,
  timeZone: string,
): { readonly input: DiscountInput; readonly fieldErrors: DiscountFieldErrors } {
  const errors: Record<string, DiscountErrorKey> = {};
  const isCode = values.method === "code";
  const input: Draft = {
    type: values.type,
    method: values.method,
    minimumRequirement: { kind: "none" },
    customerEligibility: { kind: "all" },
    oncePerCustomer: isCode && values.oncePerCustomer,
    combinesWith: values.combinesWith,
    startsAt: "",
  };
  const blank = (text: string) => text.trim() === "";
  const amountOf = (text: string): number | null => {
    const minor = toMinorUnits(text, currency);
    return minor === null || minor <= 0 ? null : minor;
  };
  const percentOf = (text: string): number | null => {
    const percent = parsePercent(text);
    return percent === null || percent <= 0 || percent > 100 ? null : percent;
  };

  if (isCode) {
    const code = values.code.trim().toUpperCase();
    if (code === "") errors["code"] = "required";
    else if (!CODE_PATTERN.test(code)) errors["code"] = "codeFormat";
    else input.code = code;
  } else {
    const title = values.title.trim();
    if (title === "") errors["title"] = "required";
    else input.title = title;
  }

  if (values.type === "amount_off_products" || values.type === "amount_off_order") {
    const amount =
      values.valueKind === "percentage"
        ? percentOf(values.valueAmount)
        : amountOf(values.valueAmount);
    if (blank(values.valueAmount)) errors["value"] = "required";
    else if (amount === null)
      errors["value"] = values.valueKind === "percentage" ? "percentRange" : "amountInvalid";
    else input.value = { kind: values.valueKind, amount };
  }

  if (values.type === "amount_off_products") {
    if (values.appliesToItems.length === 0) errors["appliesTo"] = "chooseItems";
    else input.appliesTo = { kind: values.appliesToKind, refs: ids(values.appliesToItems) };
    if (values.valueKind === "fixed_amount" && values.appliesOncePerOrder) {
      input.appliesOncePerOrder = true;
    }
  }

  if (values.type === "buy_x_get_y") {
    const buysValue =
      values.buysKind === "quantity"
        ? parsePositiveInt(values.buysValue)
        : amountOf(values.buysValue);
    if (blank(values.buysValue)) errors["buys"] = "required";
    else if (buysValue === null)
      errors["buys"] = values.buysKind === "quantity" ? "wholeNumber" : "amountInvalid";
    if (values.buysItems.length === 0) errors["buysItems"] = "chooseItems";
    if (buysValue !== null && values.buysItems.length > 0) {
      input.buys = {
        kind: values.buysKind,
        value: buysValue,
        scope: values.buysScope,
        refs: ids(values.buysItems),
      };
    }

    const quantity = parsePositiveInt(values.getsQuantity);
    if (blank(values.getsQuantity)) errors["gets"] = "required";
    else if (quantity === null) errors["gets"] = "wholeNumber";
    if (values.getsItems.length === 0) errors["getsItems"] = "chooseItems";
    const percent = values.getsEffect === "percentage" ? percentOf(values.getsPercentage) : null;
    if (values.getsEffect === "percentage" && percent === null)
      errors["getsEffect"] = "percentRange";
    const effect =
      values.getsEffect === "free"
        ? ({ kind: "free" } as const)
        : percent === null
          ? null
          : ({ kind: "percentage", value: percent } as const);
    if (quantity !== null && values.getsItems.length > 0 && effect !== null) {
      input.gets = { quantity, scope: values.getsScope, refs: ids(values.getsItems), effect };
    }

    if (values.limitUsesPerOrder) {
      const max = parsePositiveInt(values.maxUsesPerOrder);
      if (max === null) errors["maxUsesPerOrder"] = "wholeNumber";
      else input.maxUsesPerOrder = max;
    }
  }

  if (values.type === "free_shipping") {
    if (!values.allCountries) {
      if (values.countries.length === 0) errors["countries"] = "chooseCountries";
      else input.countries = ids(values.countries);
    }
    if (values.excludeRatesOver) {
      const cap = toMinorUnits(values.maxShippingRate, currency);
      if (cap === null || blank(values.maxShippingRate))
        errors["maxShippingRateMinor"] = "amountInvalid";
      else input.maxShippingRateMinor = cap;
    }
  }

  if (values.type !== "buy_x_get_y") {
    if (values.minimumKind === "amount") {
      const amount = amountOf(values.minimumAmount);
      if (amount === null) errors["minimumRequirement"] = "amountInvalid";
      else input.minimumRequirement = { kind: "amount", amountMinor: amount };
    } else if (values.minimumKind === "quantity") {
      const quantity = parsePositiveInt(values.minimumQuantity);
      if (quantity === null) errors["minimumRequirement"] = "wholeNumber";
      else input.minimumRequirement = { kind: "quantity", quantity };
    }
  }

  if (!values.allCustomers) {
    if (values.customers.length === 0) errors["customerEligibility"] = "chooseCustomers";
    else input.customerEligibility = { kind: "customers", customerRefs: ids(values.customers) };
  }

  if (isCode && values.limitTotalUses) {
    const limit = parsePositiveInt(values.usageLimit);
    if (limit === null) errors["usageLimit"] = "wholeNumber";
    else input.usageLimit = limit;
  }

  const startsAt = zonedToIso(values.startDate, values.startTime, timeZone);
  if (startsAt === null) errors["startsAt"] = "dateInvalid";
  else input.startsAt = startsAt;
  if (values.hasEndDate) {
    const endsAt = zonedToIso(values.endDate, values.endTime, timeZone);
    if (endsAt === null) errors["endsAt"] = "dateInvalid";
    else if (startsAt !== null && Date.parse(endsAt) <= Date.parse(startsAt))
      errors["endsAt"] = "endBeforeStart";
    else input.endsAt = endsAt;
  }

  return { input, fieldErrors: errors };
}

const MAX_PICKED = 250;

function isPickedItem(value: unknown): value is PickedItem {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    (value as { id: string }).id !== "" &&
    typeof (value as { label?: unknown }).label === "string"
  );
}

/**
 * The editor's posted JSON, read defensively: it crossed the network, so it is not trusted. The
 * shape is rebuilt field by field; anything unreadable falls back to the empty form's value, and a
 * payload without a known type or method is rejected outright.
 */
export function parseFormValues(raw: unknown): DiscountFormValues | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const type = record["type"];
  const method = record["method"];
  if (!isDiscountType(type) || (method !== "code" && method !== "automatic")) return null;
  const empty = emptyFormValues(type, new Date(0), "UTC");
  const text = (key: keyof DiscountFormValues): string => {
    const value = record[key];
    return typeof value === "string" ? value.slice(0, 255) : "";
  };
  const flag = (key: keyof DiscountFormValues): boolean => record[key] === true;
  const items = (key: keyof DiscountFormValues): readonly PickedItem[] => {
    const value = record[key];
    return Array.isArray(value)
      ? value
          .filter(isPickedItem)
          .slice(0, MAX_PICKED)
          .map((item) => ({ id: item.id, label: item.label }))
      : [];
  };
  const oneOf = <T extends string>(
    key: keyof DiscountFormValues,
    options: readonly T[],
    fallback: T,
  ): T => {
    const value = record[key];
    return typeof value === "string" && (options as readonly string[]).includes(value)
      ? (value as T)
      : fallback;
  };
  const scope = (key: keyof DiscountFormValues) =>
    oneOf<TargetScope>(key, ["products", "categories"], "products");
  const combines =
    typeof record["combinesWith"] === "object" && record["combinesWith"] !== null
      ? (record["combinesWith"] as Record<string, unknown>)
      : {};

  return {
    ...empty,
    method,
    code: text("code"),
    title: text("title"),
    valueKind: oneOf("valueKind", ["percentage", "fixed_amount"], "percentage"),
    valueAmount: text("valueAmount"),
    appliesToKind: scope("appliesToKind"),
    appliesToItems: items("appliesToItems"),
    appliesOncePerOrder: flag("appliesOncePerOrder"),
    buysKind: oneOf("buysKind", ["quantity", "amount"], "quantity"),
    buysValue: text("buysValue"),
    buysScope: scope("buysScope"),
    buysItems: items("buysItems"),
    getsQuantity: text("getsQuantity"),
    getsScope: scope("getsScope"),
    getsItems: items("getsItems"),
    getsEffect: oneOf("getsEffect", ["percentage", "free"], "percentage"),
    getsPercentage: text("getsPercentage"),
    limitUsesPerOrder: flag("limitUsesPerOrder"),
    maxUsesPerOrder: text("maxUsesPerOrder"),
    allCountries: flag("allCountries"),
    countries: items("countries"),
    excludeRatesOver: flag("excludeRatesOver"),
    maxShippingRate: text("maxShippingRate"),
    minimumKind: oneOf("minimumKind", ["none", "amount", "quantity"], "none"),
    minimumAmount: text("minimumAmount"),
    minimumQuantity: text("minimumQuantity"),
    allCustomers: flag("allCustomers"),
    customers: items("customers"),
    limitTotalUses: flag("limitTotalUses"),
    usageLimit: text("usageLimit"),
    oncePerCustomer: flag("oncePerCustomer"),
    combinesWith: {
      product: combines["product"] === true,
      order: combines["order"] === true,
      shipping: combines["shipping"] === true,
    },
    startDate: text("startDate"),
    startTime: text("startTime"),
    hasEndDate: flag("hasEndDate"),
    endDate: text("endDate"),
    endTime: text("endTime"),
  };
}

/** The API reports issues by path ("buys.refs", "gets.effect.value"); the form shows them by field. */
export function apiFieldToFormField(path: string): string {
  const [head = "", next] = path.split(".");
  if ((head === "buys" || head === "gets") && next === "refs") return `${head}Items`;
  return head;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Shopify's "Generate random code": 12 characters, no look-alikes (0/O, 1/I). */
export function generateDiscountCode(): string {
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}
```

Note: in `parseFormValues` the `allCountries` and `allCustomers` flags default to `false` when missing; that is safe because `toDiscountInput` then asks for countries/customers.

- [ ] **Step 6: Run the tests**

Run: `pnpm exec vitest run src/lib/discounts src/lib/products`
Expected: PASS. If a `zoneLabel` assertion differs by ICU build, keep the assertion loose (`toMatch(/UTC/)`) as written — never hard-code an ICU-specific abbreviation.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/lib/discounts/zoned-time.ts apps/admin-web/src/lib/discounts/zoned-time.test.ts apps/admin-web/src/lib/discounts/form.ts apps/admin-web/src/lib/discounts/form.test.ts apps/admin-web/src/lib/products/money.ts
git commit -m "feat(admin-web): discount form values, validation and store-zone dates"
```

---

### Task 3: Copy (English and Arabic) and the summary lines

**Files:**

- Modify: `apps/admin-web/src/messages/en.ts`, `apps/admin-web/src/messages/ar.ts` (add the `discounts` section right after the existing `discountsPage` section; removal of old sections happens in Task 5)
- Create: `apps/admin-web/src/lib/discounts/summary.ts`, `summary.test.ts`

**Interfaces:**

- Consumes: Task 1 types; `formatCurrency`, `formatNumber` (`@/lib/format`); `formatZonedDate` (Task 2).
- Produces: the `t.discounts.*` keys below (every UI task uses them); `summary.ts`: `DiscountSummarySource`, `SummaryContext`, `percentText(locale, value)`, `pluralCount(forms, count, locale)`, `valueLine(src, ctx)`, `listSummary(src, ctx)`, `discountSummary(src, ctx)`, `combinationsShort(combinesWith, t)`.

- [ ] **Step 1: Add to `en.ts`** (after the `discountsPage: { ... },` block)

```ts
  /** Phase 2 Part 2 — Shopify's Discounts list, "Select discount type" dialog and discount form. */
  discounts: {
    title: "Discounts",
    create: "Create discount",
    typeDialogTitle: "Select discount type",
    types: {
      amount_off_products: "Amount off products",
      buy_x_get_y: "Buy X get Y",
      amount_off_order: "Amount off order",
      free_shipping: "Free shipping",
    },
    typeDescriptions: {
      amount_off_products: "Discount specific products or categories of products",
      buy_x_get_y: "Discount products based on a customer's purchase",
      amount_off_order: "Discount the total order amount",
      free_shipping: "Offer free shipping on an order",
    },
    classes: {
      product: "Product discount",
      order: "Order discount",
      shipping: "Shipping discount",
    },
    tabsLabel: "Discount status",
    tabs: { all: "All", active: "Active", scheduled: "Scheduled", expired: "Expired" },
    searchLabel: "Search discounts",
    searchPlaceholder: "Search by title or code",
    columns: {
      title: "Title",
      status: "Status",
      method: "Method",
      type: "Type",
      combinations: "Combinations",
      used: "Used",
    },
    status: { active: "Active", scheduled: "Scheduled", expired: "Expired" },
    methods: { code: "Code", automatic: "Automatic" },
    combinesShort: { product: "Product", order: "Order", shipping: "Shipping" },
    combinesNone: "Not combinable",
    emptyTitle: "Manage discounts and promotions",
    emptyBody: "Create discount codes and automatic discounts that apply at checkout.",
    noMatches: "No discounts match your search.",
    noneInView: "No discounts here yet.",
    error: "Couldn't load discounts. Try refreshing the page.",
    unauthorized: "Sign in to view discounts.",
    previous: "Previous",
    next: "Next",
    summary: {
      title: "Summary",
      noCode: "No discount code yet",
      noTitle: "No title yet",
      details: "Details",
      offProducts: "{value} off selected products",
      offCategories: "{value} off selected categories",
      oncePerOrder: "Applies once per order",
      offOrder: "{value} off entire order",
      buyItems: "Buy {items}",
      spendAmount: "Spend {amount}",
      getFree: "Get {items} free",
      getPercent: "Get {items} at {value} off",
      maxUsesPerOrder: "Up to {count} uses per order",
      freeShippingAll: "Free shipping to all countries",
      freeShippingSome: "Free shipping to selected countries",
      ratesUnder: "Applies to shipping rates up to {amount}",
      noMinimum: "No minimum purchase requirement",
      minimumAmount: "Minimum purchase of {amount}",
      minimumQuantity: "Minimum quantity of {items}",
      allCustomers: "For all customers",
      someCustomers: "For specific customers",
      usageLimit: "Limit of {count} uses",
      oncePerCustomer: "One use per customer",
      combinesWith: "Combines with {classes}",
      combinesNames: {
        product: "product discounts",
        order: "order discounts",
        shipping: "shipping discounts",
      },
      combinesNone: "Can't combine with other discounts",
      activeFrom: "Active from {date}",
      activeFromUntil: "Active from {start} until {end}",
      items: {
        zero: "0 items",
        one: "1 item",
        two: "2 items",
        few: "{count} items",
        many: "{count} items",
        other: "{count} items",
      },
      performance: "Performance",
      usedTimes: {
        zero: "Not used yet",
        one: "Used once",
        two: "Used 2 times",
        few: "Used {count} times",
        many: "Used {count} times",
        other: "Used {count} times",
      },
    },
    form: {
      back: "Discounts",
      newTitle: "Create discount",
      method: "Method",
      methodCode: "Discount code",
      methodAutomatic: "Automatic discount",
      code: "Discount code",
      codeHint: "Customers must enter this code at checkout.",
      generate: "Generate random code",
      title: "Title",
      titleHint: "Customers will see this in their cart and at checkout.",
      value: "Discount value",
      valueType: "Value type",
      percentage: "Percentage",
      fixedAmount: "Fixed amount",
      appliesTo: "Applies to",
      specificCategories: "Specific categories",
      specificProducts: "Specific products",
      browse: "Browse",
      searchProducts: "Search products",
      searchCategories: "Search categories",
      searchCustomers: "Search customers",
      searchCountries: "Search countries",
      remove: "Remove {name}",
      oncePerOrder: "Only apply discount once per order",
      oncePerOrderHint:
        "If not selected, the amount will be taken off each eligible item in an order.",
      customerBuys: "Customer buys",
      minQuantityOfItems: "Minimum quantity of items",
      minPurchaseAmount: "Minimum purchase amount",
      quantity: "Quantity",
      amount: "Amount",
      anyItemsFrom: "Any items from",
      customerGets: "Customer gets",
      getsHint: "Customers must add the quantity of items specified below to their cart.",
      atDiscountedValue: "At a discounted value",
      free: "Free",
      maxUsesPerOrder: "Set a maximum number of uses per order",
      countries: "Countries",
      allCountries: "All countries",
      selectedCountries: "Selected countries",
      shippingRates: "Shipping rates",
      excludeRatesOver: "Exclude shipping rates over a certain amount",
      minimumRequirements: "Minimum purchase requirements",
      noMinimum: "No minimum requirements",
      minimumAmount: "Minimum purchase amount ({currency})",
      minimumQuantity: "Minimum quantity of items",
      minimumProductsHint: "Applies only to selected products.",
      eligibility: "Customer eligibility",
      allCustomers: "All customers",
      specificCustomers: "Specific customers",
      maxUses: "Maximum discount uses",
      limitTotal: "Limit number of times this discount can be used in total",
      limitPerCustomer: "Limit to one use per customer",
      combinations: "Combinations",
      combinationsHint: "This discount can be combined with:",
      combineProduct: "Product discounts",
      combineOtherProduct: "Other product discounts",
      combineOrder: "Order discounts",
      combineOtherOrder: "Other order discounts",
      combineShipping: "Shipping discounts",
      combineOtherShipping: "Other shipping discounts",
      activeDates: "Active dates",
      startDate: "Start date",
      startTime: "Start time ({zone})",
      setEndDate: "Set end date",
      endDate: "End date",
      endTime: "End time ({zone})",
      unsaved: "Unsaved changes",
      discard: "Discard",
      save: "Save discount",
      saving: "Saving…",
      deactivate: "Deactivate",
      activate: "Activate",
      delete: "Delete discount",
      confirmDelete: "Delete this discount? Customers will no longer be able to use it.",
      notFound: "This discount doesn't exist or was deleted.",
      loadError: "Couldn't load this discount. Try refreshing the page.",
      unauthorized: "Sign in to view this discount.",
      pickerDone: "Done",
      pickerCancel: "Cancel",
      pickerEmpty: "Nothing found.",
      pickerError: "Couldn't search. Try again.",
      pickerSearching: "Searching…",
    },
    errors: {
      required: "Required.",
      codeFormat: "Use 3 to 32 letters, digits, _ or -.",
      percentRange: "Enter a percentage above 0 and up to 100.",
      amountInvalid: "Enter a valid amount.",
      wholeNumber: "Enter a whole number above 0.",
      chooseItems: "Choose at least one item.",
      chooseCountries: "Choose at least one country.",
      chooseCustomers: "Choose at least one customer.",
      dateInvalid: "Enter a valid date and time.",
      endBeforeStart: "The end must be after the start.",
      codeTaken: "This code is already in use.",
      invalid: "Check this field.",
      notSaved: "The discount wasn't saved. Check the highlighted fields.",
    },
  },
```

- [ ] **Step 2: Add the same section to `ar.ts`** (same position, same keys)

```ts
  discounts: {
    title: "الخصومات",
    create: "إنشاء خصم",
    typeDialogTitle: "اختر نوع الخصم",
    types: {
      amount_off_products: "خصم على منتجات",
      buy_x_get_y: "اشترِ X واحصل على Y",
      amount_off_order: "خصم على الطلب",
      free_shipping: "شحن مجاني",
    },
    typeDescriptions: {
      amount_off_products: "خصم على منتجات معيّنة أو فئات منتجات",
      buy_x_get_y: "خصم على منتجات حسب ما يشتريه العميل",
      amount_off_order: "خصم على إجمالي الطلب",
      free_shipping: "شحن مجاني للطلب",
    },
    classes: {
      product: "خصم منتجات",
      order: "خصم طلب",
      shipping: "خصم شحن",
    },
    tabsLabel: "حالة الخصم",
    tabs: { all: "الكل", active: "نشط", scheduled: "مجدول", expired: "منتهي" },
    searchLabel: "البحث في الخصومات",
    searchPlaceholder: "ابحث بالعنوان أو الكود",
    columns: {
      title: "العنوان",
      status: "الحالة",
      method: "الطريقة",
      type: "النوع",
      combinations: "الدمج",
      used: "الاستخدام",
    },
    status: { active: "نشط", scheduled: "مجدول", expired: "منتهي" },
    methods: { code: "كود", automatic: "تلقائي" },
    combinesShort: { product: "منتجات", order: "طلب", shipping: "شحن" },
    combinesNone: "لا يُدمج",
    emptyTitle: "إدارة الخصومات والعروض",
    emptyBody: "أنشئ أكواد خصم وخصومات تلقائية تُطبَّق عند الدفع.",
    noMatches: "لا توجد خصومات مطابقة للبحث.",
    noneInView: "لا توجد خصومات هنا بعد.",
    error: "تعذّر تحميل الخصومات. حاول تحديث الصفحة.",
    unauthorized: "سجّل الدخول لعرض الخصومات.",
    previous: "السابق",
    next: "التالي",
    summary: {
      title: "الملخّص",
      noCode: "لا يوجد كود خصم بعد",
      noTitle: "لا يوجد عنوان بعد",
      details: "التفاصيل",
      offProducts: "خصم {value} على منتجات محددة",
      offCategories: "خصم {value} على فئات محددة",
      oncePerOrder: "يُطبَّق مرة واحدة لكل طلب",
      offOrder: "خصم {value} على الطلب بالكامل",
      buyItems: "اشترِ {items}",
      spendAmount: "أنفق {amount}",
      getFree: "واحصل على {items} مجانًا",
      getPercent: "واحصل على {items} بخصم {value}",
      maxUsesPerOrder: "حتى {count} مرات استخدام لكل طلب",
      freeShippingAll: "شحن مجاني لكل الدول",
      freeShippingSome: "شحن مجاني لدول محددة",
      ratesUnder: "لأسعار الشحن حتى {amount}",
      noMinimum: "بدون حد أدنى للشراء",
      minimumAmount: "حد أدنى للشراء {amount}",
      minimumQuantity: "حد أدنى {items}",
      allCustomers: "لكل العملاء",
      someCustomers: "لعملاء محددين",
      usageLimit: "حد أقصى {count} مرة استخدام",
      oncePerCustomer: "مرة واحدة لكل عميل",
      combinesWith: "يُدمج مع {classes}",
      combinesNames: {
        product: "خصومات المنتجات",
        order: "خصومات الطلب",
        shipping: "خصومات الشحن",
      },
      combinesNone: "لا يُدمج مع خصومات أخرى",
      activeFrom: "نشط من {date}",
      activeFromUntil: "نشط من {start} حتى {end}",
      items: {
        zero: "لا منتجات",
        one: "منتج واحد",
        two: "منتجين",
        few: "{count} منتجات",
        many: "{count} منتجًا",
        other: "{count} منتج",
      },
      performance: "الأداء",
      usedTimes: {
        zero: "لم يُستخدم بعد",
        one: "استُخدم مرة واحدة",
        two: "استُخدم مرتين",
        few: "استُخدم {count} مرات",
        many: "استُخدم {count} مرة",
        other: "استُخدم {count} مرة",
      },
    },
    form: {
      back: "الخصومات",
      newTitle: "إنشاء خصم",
      method: "الطريقة",
      methodCode: "كود خصم",
      methodAutomatic: "خصم تلقائي",
      code: "كود الخصم",
      codeHint: "يجب أن يكتب العملاء هذا الكود عند الدفع.",
      generate: "إنشاء كود عشوائي",
      title: "العنوان",
      titleHint: "سيظهر للعملاء في السلة وعند الدفع.",
      value: "قيمة الخصم",
      valueType: "نوع القيمة",
      percentage: "نسبة مئوية",
      fixedAmount: "مبلغ ثابت",
      appliesTo: "ينطبق على",
      specificCategories: "فئات محددة",
      specificProducts: "منتجات محددة",
      browse: "تصفّح",
      searchProducts: "ابحث عن منتجات",
      searchCategories: "ابحث عن فئات",
      searchCustomers: "ابحث عن عملاء",
      searchCountries: "ابحث عن دول",
      remove: "إزالة {name}",
      oncePerOrder: "طبّق الخصم مرة واحدة فقط لكل طلب",
      oncePerOrderHint: "إذا لم يُحدَّد، سيُخصم المبلغ من كل منتج مؤهل في الطلب.",
      customerBuys: "العميل يشتري",
      minQuantityOfItems: "حد أدنى لعدد المنتجات",
      minPurchaseAmount: "حد أدنى لمبلغ الشراء",
      quantity: "الكمية",
      amount: "المبلغ",
      anyItemsFrom: "أي منتجات من",
      customerGets: "العميل يحصل على",
      getsHint: "يجب أن يضيف العملاء الكمية المحددة أدناه إلى السلة.",
      atDiscountedValue: "بقيمة مخفّضة",
      free: "مجانًا",
      maxUsesPerOrder: "حدد أقصى عدد مرات استخدام لكل طلب",
      countries: "الدول",
      allCountries: "كل الدول",
      selectedCountries: "دول محددة",
      shippingRates: "أسعار الشحن",
      excludeRatesOver: "استبعد أسعار الشحن الأعلى من مبلغ معيّن",
      minimumRequirements: "الحد الأدنى للشراء",
      noMinimum: "بدون حد أدنى",
      minimumAmount: "حد أدنى لمبلغ الشراء ({currency})",
      minimumQuantity: "حد أدنى لعدد المنتجات",
      minimumProductsHint: "يُحسب على المنتجات المحددة فقط.",
      eligibility: "العملاء المؤهلون",
      allCustomers: "كل العملاء",
      specificCustomers: "عملاء محددون",
      maxUses: "أقصى عدد مرات استخدام",
      limitTotal: "حدد عدد مرات استخدام هذا الخصم إجمالًا",
      limitPerCustomer: "مرة واحدة فقط لكل عميل",
      combinations: "الدمج",
      combinationsHint: "يمكن دمج هذا الخصم مع:",
      combineProduct: "خصومات المنتجات",
      combineOtherProduct: "خصومات منتجات أخرى",
      combineOrder: "خصومات الطلب",
      combineOtherOrder: "خصومات طلب أخرى",
      combineShipping: "خصومات الشحن",
      combineOtherShipping: "خصومات شحن أخرى",
      activeDates: "فترة التفعيل",
      startDate: "تاريخ البدء",
      startTime: "وقت البدء ({zone})",
      setEndDate: "تحديد تاريخ انتهاء",
      endDate: "تاريخ الانتهاء",
      endTime: "وقت الانتهاء ({zone})",
      unsaved: "تغييرات غير محفوظة",
      discard: "تجاهل",
      save: "حفظ الخصم",
      saving: "جارٍ الحفظ…",
      deactivate: "إيقاف",
      activate: "تفعيل",
      delete: "حذف الخصم",
      confirmDelete: "حذف هذا الخصم؟ لن يستطيع العملاء استخدامه بعد ذلك.",
      notFound: "هذا الخصم غير موجود أو تم حذفه.",
      loadError: "تعذّر تحميل هذا الخصم. حاول تحديث الصفحة.",
      unauthorized: "سجّل الدخول لعرض هذا الخصم.",
      pickerDone: "تم",
      pickerCancel: "إلغاء",
      pickerEmpty: "لا توجد نتائج.",
      pickerError: "تعذّر البحث. حاول مرة أخرى.",
      pickerSearching: "جارٍ البحث…",
    },
    errors: {
      required: "مطلوب.",
      codeFormat: "استخدم من 3 إلى 32 حرفًا إنجليزيًا أو رقمًا أو _ أو -.",
      percentRange: "أدخل نسبة أكبر من 0 وحتى 100.",
      amountInvalid: "أدخل مبلغًا صحيحًا.",
      wholeNumber: "أدخل عددًا صحيحًا أكبر من 0.",
      chooseItems: "اختر عنصرًا واحدًا على الأقل.",
      chooseCountries: "اختر دولة واحدة على الأقل.",
      chooseCustomers: "اختر عميلًا واحدًا على الأقل.",
      dateInvalid: "أدخل تاريخًا ووقتًا صحيحين.",
      endBeforeStart: "يجب أن يكون الانتهاء بعد البدء.",
      codeTaken: "هذا الكود مستخدم بالفعل.",
      invalid: "راجع هذا الحقل.",
      notSaved: "لم يُحفظ الخصم. راجع الحقول المحددة.",
    },
  },
```

- [ ] **Step 3: Write the failing test** — `apps/admin-web/src/lib/discounts/summary.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { DiscountDto } from "@/lib/api/discounts";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import {
  combinationsShort,
  discountSummary,
  listSummary,
  pluralCount,
  valueLine,
  type SummaryContext,
} from "./summary";

const ctx: SummaryContext = {
  t: en.discounts.summary,
  locale: "en",
  currency: "EGP",
  timeZone: "UTC",
};

const sale10: DiscountDto = {
  id: "promo-1",
  type: "amount_off_order",
  method: "code",
  title: "SALE10",
  code: "SALE10",
  status: "active",
  value: { kind: "percentage", amount: 10 },
  appliesTo: null,
  appliesOncePerOrder: false,
  buys: null,
  gets: null,
  maxUsesPerOrder: null,
  countries: null,
  maxShippingRateMinor: null,
  minimumRequirement: { kind: "amount", amountMinor: 20000 },
  customerEligibility: { kind: "all" },
  usageLimit: 100,
  oncePerCustomer: true,
  combinesWith: { product: true, order: false, shipping: true },
  startsAt: "2026-10-16T10:00:00.000Z",
  endsAt: "2026-10-31T10:00:00.000Z",
  usageCount: 1,
};

describe("listSummary", () => {
  it("reads like Shopify's list: value and minimum", () => {
    expect(listSummary(sale10, ctx)).toMatch(/^10% off entire order • Minimum purchase of .*200/);
  });

  it("leaves the minimum out when there is none", () => {
    expect(listSummary({ ...sale10, minimumRequirement: { kind: "none" } }, ctx)).toBe(
      "10% off entire order",
    );
  });
});

describe("valueLine", () => {
  it("covers every type", () => {
    expect(
      valueLine(
        { ...sale10, type: "amount_off_products", appliesTo: { kind: "categories", refs: ["c"] } },
        ctx,
      ),
    ).toBe("10% off selected categories");
    expect(
      valueLine(
        {
          ...sale10,
          type: "buy_x_get_y",
          value: null,
          buys: { kind: "quantity", value: 2, scope: "products", refs: ["p"] },
          gets: { quantity: 1, scope: "products", refs: ["p"], effect: { kind: "free" } },
        },
        ctx,
      ),
    ).toBe("Buy 2 items • Get 1 item free");
    expect(valueLine({ ...sale10, type: "free_shipping", value: null }, ctx)).toBe(
      "Free shipping to all countries",
    );
    expect(valueLine({ ...sale10, value: null }, ctx)).toBeNull();
  });
});

describe("discountSummary", () => {
  it("lists every detail in Shopify's order", () => {
    const lines = discountSummary(sale10, ctx);
    expect(lines[0]).toBe("10% off entire order");
    expect(lines).toContain("For all customers");
    expect(lines).toContain("Limit of 100 uses");
    expect(lines).toContain("One use per customer");
    expect(lines).toContain("Combines with product discounts and shipping discounts");
    expect(lines.at(-1)).toBe("Active from Oct 16, 2026 until Oct 31, 2026");
  });

  it("says when nothing combines and there is no minimum", () => {
    const lines = discountSummary(
      {
        ...sale10,
        minimumRequirement: { kind: "none" },
        combinesWith: { product: false, order: false, shipping: false },
        endsAt: null,
      },
      ctx,
    );
    expect(lines).toContain("No minimum purchase requirement");
    expect(lines).toContain("Can't combine with other discounts");
    expect(lines.at(-1)).toBe("Active from Oct 16, 2026");
  });

  it("skips the dates while the start is not a real date", () => {
    expect(
      discountSummary({ ...sale10, startsAt: "" }, ctx).some((l) => l.startsWith("Active")),
    ).toBe(false);
  });

  it("speaks Arabic", () => {
    const arabic: SummaryContext = { ...ctx, t: ar.discounts.summary, locale: "ar" };
    expect(discountSummary(sale10, arabic)[0]).toContain("على الطلب بالكامل");
  });
});

describe("pluralCount / combinationsShort", () => {
  it("picks the plural form for the locale", () => {
    expect(pluralCount(en.discounts.summary.items, 1, "en")).toBe("1 item");
    expect(pluralCount(en.discounts.summary.items, 3, "en")).toBe("3 items");
    expect(pluralCount(ar.discounts.summary.items, 2, "ar")).toBe("منتجين");
  });

  it("names the classes a discount combines with", () => {
    expect(combinationsShort({ product: true, order: false, shipping: true }, en.discounts)).toBe(
      "Product, Shipping",
    );
    expect(combinationsShort({ product: false, order: false, shipping: false }, en.discounts)).toBe(
      "Not combinable",
    );
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm exec vitest run src/lib/discounts/summary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Write `apps/admin-web/src/lib/discounts/summary.ts`**

```ts
import type {
  CombinesWith,
  DiscountBuys,
  DiscountGets,
  DiscountTargets,
  DiscountType,
  DiscountValue,
  MinimumRequirement,
} from "@/lib/api/discounts";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { formatZonedDate } from "./zoned-time";

/**
 * Shopify's discount summary — the one line under a discount in the list ("10% off entire order •
 * Minimum purchase of EGP 200.00") and the bullet list of the form's Summary card. Both a saved
 * `DiscountDto` and the form's live `DiscountInput` fit `DiscountSummarySource`.
 */
export interface DiscountSummarySource {
  readonly type: DiscountType;
  readonly value?: DiscountValue | null | undefined;
  readonly appliesTo?: DiscountTargets | null | undefined;
  readonly appliesOncePerOrder?: boolean | undefined;
  readonly buys?: DiscountBuys | null | undefined;
  readonly gets?: DiscountGets | null | undefined;
  readonly maxUsesPerOrder?: number | null | undefined;
  readonly countries?: readonly string[] | null | undefined;
  readonly maxShippingRateMinor?: number | null | undefined;
  readonly minimumRequirement: MinimumRequirement;
  readonly customerEligibility: { readonly kind: "all" | "customers" };
  readonly usageLimit?: number | null | undefined;
  readonly oncePerCustomer: boolean;
  readonly combinesWith: CombinesWith;
  readonly startsAt: string;
  readonly endsAt?: string | null | undefined;
}

export interface SummaryContext {
  readonly t: Dictionary["discounts"]["summary"];
  readonly locale: Locale;
  readonly currency: string;
  readonly timeZone: string;
}

type PluralForms = Readonly<Record<Intl.LDMLPluralRule, string>>;

/** "1 item" / "3 items" / "منتجين" — the form comes from the locale's own plural rules. */
export function pluralCount(forms: PluralForms, count: number, locale: Locale): string {
  const form = forms[new Intl.PluralRules(locale).select(count)];
  return form.replace("{count}", formatNumber(locale, count));
}

/** 10 → "10%", 12.5 → "12.5%" in the locale's digits. */
export function percentText(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(
    value / 100,
  );
}

function valueText(value: DiscountValue, ctx: SummaryContext): string {
  return value.kind === "percentage"
    ? percentText(ctx.locale, value.amount)
    : formatCurrency(ctx.locale, value.amount, ctx.currency);
}

/** The discount's headline: what it takes off, on what. Null while the form has no value yet. */
export function valueLine(src: DiscountSummarySource, ctx: SummaryContext): string | null {
  const { t } = ctx;
  switch (src.type) {
    case "amount_off_products":
      if (src.value == null) return null;
      return (src.appliesTo?.kind === "categories" ? t.offCategories : t.offProducts).replace(
        "{value}",
        valueText(src.value, ctx),
      );
    case "amount_off_order":
      if (src.value == null) return null;
      return t.offOrder.replace("{value}", valueText(src.value, ctx));
    case "buy_x_get_y": {
      const parts: string[] = [];
      if (src.buys != null) {
        parts.push(
          src.buys.kind === "quantity"
            ? t.buyItems.replace("{items}", pluralCount(t.items, src.buys.value, ctx.locale))
            : t.spendAmount.replace(
                "{amount}",
                formatCurrency(ctx.locale, src.buys.value, ctx.currency),
              ),
        );
      }
      if (src.gets != null) {
        const items = pluralCount(t.items, src.gets.quantity, ctx.locale);
        parts.push(
          src.gets.effect.kind === "free"
            ? t.getFree.replace("{items}", items)
            : t.getPercent
                .replace("{items}", items)
                .replace("{value}", percentText(ctx.locale, src.gets.effect.value)),
        );
      }
      return parts.length === 0 ? null : parts.join(" • ");
    }
    case "free_shipping":
      return src.countries == null ? t.freeShippingAll : t.freeShippingSome;
  }
}

function minimumLine(src: DiscountSummarySource, ctx: SummaryContext): string | null {
  if (src.type === "buy_x_get_y") return null;
  const minimum = src.minimumRequirement;
  if (minimum.kind === "amount") {
    return ctx.t.minimumAmount.replace(
      "{amount}",
      formatCurrency(ctx.locale, minimum.amountMinor, ctx.currency),
    );
  }
  if (minimum.kind === "quantity") {
    return ctx.t.minimumQuantity.replace(
      "{items}",
      pluralCount(ctx.t.items, minimum.quantity, ctx.locale),
    );
  }
  return null;
}

/** The list's one line under the title. */
export function listSummary(src: DiscountSummarySource, ctx: SummaryContext): string {
  return [valueLine(src, ctx), minimumLine(src, ctx)]
    .filter((line): line is string => line !== null)
    .join(" • ");
}

function combinesLine(combinesWith: CombinesWith, ctx: SummaryContext): string {
  const names = (["product", "order", "shipping"] as const)
    .filter((key) => combinesWith[key])
    .map((key) => ctx.t.combinesNames[key]);
  if (names.length === 0) return ctx.t.combinesNone;
  return ctx.t.combinesWith.replace(
    "{classes}",
    new Intl.ListFormat(ctx.locale, { type: "conjunction" }).format(names),
  );
}

function activeLine(src: DiscountSummarySource, ctx: SummaryContext): string | null {
  if (Number.isNaN(Date.parse(src.startsAt))) return null;
  const start = formatZonedDate(src.startsAt, ctx.locale, ctx.timeZone);
  if (src.endsAt == null || Number.isNaN(Date.parse(src.endsAt))) {
    return ctx.t.activeFrom.replace("{date}", start);
  }
  return ctx.t.activeFromUntil
    .replace("{start}", start)
    .replace("{end}", formatZonedDate(src.endsAt, ctx.locale, ctx.timeZone));
}

/** The Summary card's details, in the form's order. */
export function discountSummary(src: DiscountSummarySource, ctx: SummaryContext): string[] {
  const { t } = ctx;
  const lines: (string | null)[] = [valueLine(src, ctx)];
  if (
    src.type === "amount_off_products" &&
    src.appliesOncePerOrder === true &&
    src.value?.kind === "fixed_amount"
  ) {
    lines.push(t.oncePerOrder);
  }
  if (src.type === "buy_x_get_y" && src.maxUsesPerOrder != null) {
    lines.push(t.maxUsesPerOrder.replace("{count}", formatNumber(ctx.locale, src.maxUsesPerOrder)));
  }
  if (src.type === "free_shipping" && src.maxShippingRateMinor != null) {
    lines.push(
      t.ratesUnder.replace(
        "{amount}",
        formatCurrency(ctx.locale, src.maxShippingRateMinor, ctx.currency),
      ),
    );
  }
  if (src.type !== "buy_x_get_y") lines.push(minimumLine(src, ctx) ?? t.noMinimum);
  lines.push(src.customerEligibility.kind === "all" ? t.allCustomers : t.someCustomers);
  if (src.usageLimit != null) {
    lines.push(t.usageLimit.replace("{count}", formatNumber(ctx.locale, src.usageLimit)));
  }
  if (src.oncePerCustomer) lines.push(t.oncePerCustomer);
  lines.push(combinesLine(src.combinesWith, ctx));
  lines.push(activeLine(src, ctx));
  return lines.filter((line): line is string => line !== null);
}

/** The list's Combinations column: "Product, Shipping" or "Not combinable". */
export function combinationsShort(
  combinesWith: CombinesWith,
  t: Pick<Dictionary["discounts"], "combinesShort" | "combinesNone">,
): string {
  const names = (["product", "order", "shipping"] as const)
    .filter((key) => combinesWith[key])
    .map((key) => t.combinesShort[key]);
  return names.length === 0 ? t.combinesNone : names.join(", ");
}
```

- [ ] **Step 6: Run the test and typecheck the dictionaries**

Run: `pnpm exec vitest run src/lib/discounts/summary.test.ts` → PASS.
Run: `pnpm exec tsc --noEmit 2>&1 | grep -E "messages/|lib/discounts/"` → no output (old callers of removed coupon functions may still fail elsewhere until Task 5; ignore those).

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/messages/en.ts apps/admin-web/src/messages/ar.ts apps/admin-web/src/lib/discounts/summary.ts apps/admin-web/src/lib/discounts/summary.test.ts
git commit -m "feat(admin-web): discount copy in english and arabic and shopify-style summaries"
```

---

### Task 4: Server actions — save, delete, activate/deactivate, picker search

**Files:**

- Modify (rewrite): `apps/admin-web/src/app/discounts/actions.ts`
- Create: `apps/admin-web/src/app/discounts/actions.test.ts`
- Create: `apps/admin-web/src/lib/discounts/target-labels.ts`

**Interfaces:**

- Consumes: Task 1 API functions; Task 2 `parseFormValues`, `toDiscountInput`, `apiFieldToFormField`, `TargetLabels`; `storeSettingsOrDefaults` (`@/lib/api/store-settings`); `fetchProductsPage`, `fetchProduct` (`@/lib/api/products`); `fetchCategoriesPage` (`@/lib/api/categories`); `fetchCustomersPage`, `fetchCustomer` (`@/lib/api/customers`); `countryName` (`@/lib/shipping/display`); `newIdempotencyKey`, `toFormState`, `FormState` (`@/lib/api/mutation`).
- Produces:
  - `saveDiscountAction(prev: FormState, formData: FormData): Promise<FormState>` — fields `payload` (JSON of `DiscountFormValues`) and optional `discountId`. Create redirects to `/discounts/<id>`; update returns `{ status: "success" }`.
  - `deleteDiscountAction(prev, formData)` — field `discountId`; redirects to `/discounts`.
  - `setDiscountActiveAction(prev, formData)` — fields `discountId`, `active` (`"true"`/`"false"`).
  - `searchDiscountTargetsAction(kind: TargetKind, query: string): Promise<TargetSearchResult>`.
  - Types (exported from `actions.ts` as `export type`): `TargetKind = "products" | "categories" | "customers"`, `TargetOption { id; label; detail: string | null }`, `TargetSearchResult = { outcome: "ok"; items: readonly TargetOption[] } | { outcome: "error" }`.
  - `target-labels.ts`: `resolveTargetLabels(dto: DiscountDto, locale: Locale): Promise<TargetLabels>`.

- [ ] **Step 1: Write the failing test** — `apps/admin-web/src/app/discounts/actions.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/api/mutation";
import { emptyFormValues } from "@/lib/discounts/form";

const discounts = vi.hoisted(() => ({
  createDiscount: vi.fn(),
  updateDiscount: vi.fn(),
  deleteDiscount: vi.fn(),
  activateDiscount: vi.fn(),
  deactivateDiscount: vi.fn(),
}));
const products = vi.hoisted(() => ({ fetchProductsPage: vi.fn() }));
const categories = vi.hoisted(() => ({ fetchCategoriesPage: vi.fn() }));
const customers = vi.hoisted(() => ({ fetchCustomersPage: vi.fn() }));
const revalidatePath = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
);
const locale = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("@/lib/api/discounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/discounts")>()),
  ...discounts,
}));
vi.mock("@/lib/api/products", () => products);
vi.mock("@/lib/api/categories", () => categories);
vi.mock("@/lib/api/customers", () => customers);
vi.mock("@/lib/api/store-settings", () => ({
  storeSettingsOrDefaults: () =>
    Promise.resolve({
      storeName: "",
      contactEmail: null,
      currency: "EGP",
      timezone: "Asia/Dubai",
      weightUnit: "kg",
    }),
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({ get: () => (locale.value ? { value: locale.value } : undefined) }),
}));

const {
  deleteDiscountAction,
  saveDiscountAction,
  searchDiscountTargetsAction,
  setDiscountActiveAction,
} = await import("./actions");

const idle: FormState = { status: "idle" };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

const sale10 = {
  ...emptyFormValues("amount_off_order", new Date("2026-10-16T10:30:00.000Z"), "Asia/Dubai"),
  code: "sale10",
  valueAmount: "10",
  minimumKind: "amount" as const,
  minimumAmount: "200",
};

beforeEach(() => {
  for (const fn of Object.values(discounts)) fn.mockReset();
  products.fetchProductsPage.mockReset();
  categories.fetchCategoriesPage.mockReset();
  customers.fetchCustomersPage.mockReset();
  revalidatePath.mockReset();
  redirect.mockClear();
  locale.value = undefined;
});

describe("saveDiscountAction", () => {
  it("creates the discount in the store's currency and zone, then opens it", async () => {
    discounts.createDiscount.mockResolvedValue({ outcome: "ok", data: { id: "promo-9" } });

    await expect(
      saveDiscountAction(idle, form({ payload: JSON.stringify(sale10) })),
    ).rejects.toThrow("NEXT_REDIRECT:/discounts/promo-9");

    const [input, key] = discounts.createDiscount.mock.calls[0]!;
    expect(input).toMatchObject({
      code: "SALE10",
      value: { kind: "percentage", amount: 10 },
      minimumRequirement: { kind: "amount", amountMinor: 20000 },
      startsAt: "2026-10-16T10:30:00.000Z",
    });
    expect(typeof key).toBe("string");
    expect(revalidatePath).toHaveBeenCalledWith("/discounts");
  });

  it("updates an existing discount and stays on it", async () => {
    discounts.updateDiscount.mockResolvedValue({ outcome: "ok", data: { id: "promo-1" } });

    const state = await saveDiscountAction(
      idle,
      form({ payload: JSON.stringify(sale10), discountId: "promo-1" }),
    );

    expect(state).toEqual({ status: "success" });
    expect(discounts.updateDiscount).toHaveBeenCalledWith(
      "promo-1",
      expect.any(Object),
      expect.any(String),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/discounts/promo-1");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("answers the form's own errors without calling the API", async () => {
    const state = await saveDiscountAction(
      idle,
      form({ payload: JSON.stringify({ ...sale10, code: "", valueAmount: "500" }) }),
    );

    expect(state).toEqual({
      status: "error",
      message: "The discount wasn't saved. Check the highlighted fields.",
      fieldErrors: { code: "Required.", value: "Enter a percentage above 0 and up to 100." },
    });
    expect(discounts.createDiscount).not.toHaveBeenCalled();
  });

  it("rejects a forged payload without calling the API", async () => {
    for (const payload of ["not json", JSON.stringify({ type: "bogus" }), ""]) {
      const state = await saveDiscountAction(idle, form({ payload }));
      expect(state.status).toBe("error");
    }
    expect(discounts.createDiscount).not.toHaveBeenCalled();
  });

  it("shows a taken code under the code field, in Arabic too", async () => {
    locale.value = "ar";
    discounts.createDiscount.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid discount",
      fields: [
        { field: "code", message: "This code is already in use" },
        { field: "gets.effect.value", message: "at most 100" },
      ],
    });

    const state = await saveDiscountAction(idle, form({ payload: JSON.stringify(sale10) }));

    expect(state).toEqual({
      status: "error",
      message: "لم يُحفظ الخصم. راجع الحقول المحددة.",
      fieldErrors: { code: "هذا الكود مستخدم بالفعل.", gets: "راجع هذا الحقل." },
    });
  });

  it("passes other failures through the shared form errors", async () => {
    discounts.createDiscount.mockResolvedValue({ outcome: "forbidden" });
    const state = await saveDiscountAction(idle, form({ payload: JSON.stringify(sale10) }));
    expect(state.status).toBe("error");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteDiscountAction", () => {
  it("deletes and goes back to the list", async () => {
    discounts.deleteDiscount.mockResolvedValue({ outcome: "ok", data: {} });
    await expect(deleteDiscountAction(idle, form({ discountId: "promo-1" }))).rejects.toThrow(
      "NEXT_REDIRECT:/discounts",
    );
    expect(discounts.deleteDiscount).toHaveBeenCalledWith("promo-1", expect.any(String));
  });

  it("needs an id", async () => {
    expect((await deleteDiscountAction(idle, form({}))).status).toBe("error");
    expect(discounts.deleteDiscount).not.toHaveBeenCalled();
  });
});

describe("setDiscountActiveAction", () => {
  it("deactivates and activates", async () => {
    discounts.deactivateDiscount.mockResolvedValue({ outcome: "ok", data: {} });
    discounts.activateDiscount.mockResolvedValue({ outcome: "ok", data: {} });

    expect(
      await setDiscountActiveAction(idle, form({ discountId: "promo-1", active: "false" })),
    ).toEqual({
      status: "success",
    });
    expect(
      await setDiscountActiveAction(idle, form({ discountId: "promo-1", active: "true" })),
    ).toEqual({
      status: "success",
    });
    expect(discounts.deactivateDiscount).toHaveBeenCalledWith("promo-1", expect.any(String));
    expect(discounts.activateDiscount).toHaveBeenCalledWith("promo-1", expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/discounts/promo-1");
  });
});

describe("searchDiscountTargetsAction", () => {
  it("searches products by name or SKU", async () => {
    products.fetchProductsPage.mockResolvedValue({
      outcome: "ok",
      items: [{ id: "p-1", name: "Sneaker", sku: "SNK-1" }],
      pageInfo: { hasNextPage: false, endCursor: null },
    });

    expect(await searchDiscountTargetsAction("products", " snk ")).toEqual({
      outcome: "ok",
      items: [{ id: "p-1", label: "Sneaker", detail: "SNK-1" }],
    });
    expect(products.fetchProductsPage).toHaveBeenCalledWith({ first: 25, query: "snk" });
  });

  it("filters categories by name", async () => {
    categories.fetchCategoriesPage.mockResolvedValue({
      outcome: "ok",
      items: [
        { id: "c-1", name: "Shoes", slug: "shoes", parentId: null },
        { id: "c-2", name: "Bags", slug: "bags", parentId: null },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    });

    expect(await searchDiscountTargetsAction("categories", "sho")).toEqual({
      outcome: "ok",
      items: [{ id: "c-1", label: "Shoes", detail: null }],
    });
  });

  it("searches customers by name or email, and reports failures", async () => {
    customers.fetchCustomersPage.mockResolvedValueOnce({
      outcome: "ok",
      items: [{ id: "cus-1", name: "Mona", email: "mona@example.com" }],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    expect(await searchDiscountTargetsAction("customers", "mona")).toEqual({
      outcome: "ok",
      items: [{ id: "cus-1", label: "Mona", detail: "mona@example.com" }],
    });

    customers.fetchCustomersPage.mockResolvedValueOnce({ outcome: "error", message: "down" });
    expect(await searchDiscountTargetsAction("customers", "")).toEqual({ outcome: "error" });
  });

  it("refuses an unknown kind", async () => {
    expect(await searchDiscountTargetsAction("orders" as unknown as "products", "x")).toEqual({
      outcome: "error",
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/app/discounts/actions.test.ts`
Expected: FAIL — the new actions are not exported.

- [ ] **Step 3: Rewrite `apps/admin-web/src/app/discounts/actions.ts`**

```ts
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fetchCategoriesPage } from "@/lib/api/categories";
import { fetchCustomersPage } from "@/lib/api/customers";
import {
  activateDiscount,
  createDiscount,
  deactivateDiscount,
  deleteDiscount,
  updateDiscount,
} from "@/lib/api/discounts";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { fetchProductsPage } from "@/lib/api/products";
import { storeSettingsOrDefaults } from "@/lib/api/store-settings";
import { apiFieldToFormField, parseFormValues, toDiscountInput } from "@/lib/discounts/form";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * Phase 2 Part 2 — the Discounts write actions, in the README's recipe: parse `FormData`
 * defensively, mint one `Idempotency-Key` per submit, call `lib/api/discounts.ts`, revalidate, then
 * redirect. The form posts what the merchant typed as one JSON `payload`; it is rebuilt field by
 * field (`parseFormValues`) and converted here with the store's own currency and time zone — never
 * ones the browser sent.
 */

export type TargetKind = "products" | "categories" | "customers";

export interface TargetOption {
  readonly id: string;
  readonly label: string;
  /** A second line: the SKU, the email; null for categories. */
  readonly detail: string | null;
}

export type TargetSearchResult =
  | { readonly outcome: "ok"; readonly items: readonly TargetOption[] }
  | { readonly outcome: "error" };

const SEARCH_LIMIT = 25;

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function dictionary(): Promise<Dictionary> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

function readPayload(formData: FormData): unknown {
  try {
    return JSON.parse(stringField(formData, "payload"));
  } catch {
    return null;
  }
}

/** Creates (no `discountId`) or edits a discount. A create opens the new discount's page. */
export async function saveDiscountAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const errors = t.discounts.errors;
  const discountId = stringField(formData, "discountId").trim();
  const values = parseFormValues(readPayload(formData));
  if (values === null) return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };

  const settings = await storeSettingsOrDefaults();
  const { input, fieldErrors } = toDiscountInput(values, settings.currency, settings.timezone);
  if (Object.keys(fieldErrors).length > 0) {
    const localized: Record<string, string> = {};
    for (const [field, key] of Object.entries(fieldErrors)) localized[field] = errors[key];
    return { status: "error", message: errors.notSaved, fieldErrors: localized };
  }

  const key = newIdempotencyKey();
  const result =
    discountId === ""
      ? await createDiscount(input, key)
      : await updateDiscount(discountId, input, key);

  if (result.outcome === "ok") {
    revalidatePath("/discounts");
    if (discountId === "") redirect(`/discounts/${encodeURIComponent(result.data.id)}`);
    revalidatePath(`/discounts/${discountId}`);
    return { status: "success" };
  }
  if (result.outcome === "invalid") {
    const localized: Record<string, string> = {};
    for (const issue of result.fields) {
      const field = apiFieldToFormField(issue.field);
      if (field === "") continue;
      localized[field] = /already in use/i.test(issue.message) ? errors.codeTaken : errors.invalid;
    }
    return { status: "error", message: errors.notSaved, fieldErrors: localized };
  }
  return toFormState(result, t.formErrors);
}

/** Shopify's Delete: the discount leaves every list and its code stops working. */
export async function deleteDiscountAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const discountId = stringField(formData, "discountId").trim();
  if (discountId === "") return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };

  const result = await deleteDiscount(discountId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/discounts");
    redirect("/discounts");
  }
  return toFormState(result, t.formErrors);
}

/** Deactivate (`active=false`) or Activate (`active=true`). */
export async function setDiscountActiveAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const discountId = stringField(formData, "discountId").trim();
  const active = stringField(formData, "active");
  if (discountId === "" || (active !== "true" && active !== "false")) {
    return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
  }

  const key = newIdempotencyKey();
  const result =
    active === "true"
      ? await activateDiscount(discountId, key)
      : await deactivateDiscount(discountId, key);
  if (result.outcome === "ok") {
    revalidatePath("/discounts");
    revalidatePath(`/discounts/${discountId}`);
    return { status: "success" };
  }
  return toFormState(result, t.formErrors);
}

/**
 * The Browse dialogs' search. A read, run on the server like every runtime API call: the picker in
 * the browser only ever sees ids, names and a second line.
 */
export async function searchDiscountTargetsAction(
  kind: TargetKind,
  query: string,
): Promise<TargetSearchResult> {
  const q = typeof query === "string" ? query.trim().slice(0, 100) : "";
  if (kind === "products") {
    const result = await fetchProductsPage({
      first: SEARCH_LIMIT,
      ...(q === "" ? {} : { query: q }),
    });
    if (result.outcome !== "ok") return { outcome: "error" };
    return {
      outcome: "ok",
      items: result.items.map((item) => ({ id: item.id, label: item.name, detail: item.sku })),
    };
  }
  if (kind === "categories") {
    // Categories have no search route; a store's categories fit in one page.
    const result = await fetchCategoriesPage({ first: 100 });
    if (result.outcome !== "ok") return { outcome: "error" };
    const needle = q.toLocaleLowerCase();
    return {
      outcome: "ok",
      items: result.items
        .filter((item) => needle === "" || item.name.toLocaleLowerCase().includes(needle))
        .slice(0, SEARCH_LIMIT)
        .map((item) => ({ id: item.id, label: item.name, detail: null })),
    };
  }
  if (kind === "customers") {
    const result = await fetchCustomersPage({
      first: SEARCH_LIMIT,
      ...(q === "" ? {} : { search: q }),
    });
    if (result.outcome !== "ok") return { outcome: "error" };
    return {
      outcome: "ok",
      items: result.items.map((item) => ({
        id: item.id,
        label: item.name === "" ? item.email : item.name,
        detail: item.email,
      })),
    };
  }
  return { outcome: "error" };
}
```

Note: the test for product search expects `{ first: 25, query: "snk" }` — matches the spread above.

- [ ] **Step 4: Write `apps/admin-web/src/lib/discounts/target-labels.ts`** (server-only helper used by the edit page in Task 7)

```ts
import { fetchCategoriesPage } from "@/lib/api/categories";
import { fetchCustomer } from "@/lib/api/customers";
import type { DiscountDto } from "@/lib/api/discounts";
import { fetchProduct } from "@/lib/api/products";
import type { Locale } from "@/lib/i18n";
import { countryName } from "@/lib/shipping/display";
import type { TargetLabels } from "./form";

/** How many products/customers a discount page names; the rest show by id until re-picked. */
const MAX_NAMED = 50;

/**
 * Names for the ids a saved discount points at, so the form shows "Sneaker" rather than an id. Read
 * on the server with the existing detail routes; a failed read leaves that id unnamed rather than
 * failing the page.
 */
export async function resolveTargetLabels(dto: DiscountDto, locale: Locale): Promise<TargetLabels> {
  const productIds = new Set<string>();
  const categoryIds = new Set<string>();
  const addAll = (scope: "products" | "categories", refs: readonly string[]) => {
    for (const ref of refs) (scope === "categories" ? categoryIds : productIds).add(ref);
  };
  if (dto.appliesTo !== null) addAll(dto.appliesTo.kind, dto.appliesTo.refs);
  if (dto.buys !== null) addAll(dto.buys.scope, dto.buys.refs);
  if (dto.gets !== null) addAll(dto.gets.scope, dto.gets.refs);
  const customerIds =
    dto.customerEligibility.kind === "customers" ? dto.customerEligibility.customerRefs : [];

  const [products, categories, customers] = await Promise.all([
    Promise.all(
      [...productIds].slice(0, MAX_NAMED).map(async (id) => {
        const result = await fetchProduct(id);
        return result.outcome === "ok" ? ([id, result.product.name] as const) : null;
      }),
    ),
    categoryIds.size === 0 ? null : fetchCategoriesPage({ first: 100 }),
    Promise.all(
      customerIds.slice(0, MAX_NAMED).map(async (id) => {
        const result = await fetchCustomer(id);
        if (result.outcome !== "ok") return null;
        const { name, email } = result.customer;
        return [id, name === "" ? email : name] as const;
      }),
    ),
  ]);

  const entries = (pairs: readonly (readonly [string, string] | null)[]) =>
    Object.fromEntries(pairs.filter((pair): pair is readonly [string, string] => pair !== null));

  return {
    products: entries(products),
    categories:
      categories?.outcome === "ok"
        ? Object.fromEntries(categories.items.map((item) => [item.id, item.name]))
        : {},
    customers: entries(customers),
    countries: Object.fromEntries(
      (dto.countries ?? []).map((code) => [code, countryName(code, locale)]),
    ),
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run src/app/discounts/actions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/app/discounts/actions.ts apps/admin-web/src/app/discounts/actions.test.ts apps/admin-web/src/lib/discounts/target-labels.ts
git commit -m "feat(admin-web): discount save, delete, activate and picker search actions"
```

---

### Task 5: The Discounts list, the type dialog, and removing the coupon screens

**Files:**

- Create: `apps/admin-web/src/components/discounts/discount-status-badge.tsx`
- Create: `apps/admin-web/src/components/discounts/discount-type-dialog.tsx`, `discount-type-dialog.test.tsx`
- Create: `apps/admin-web/src/components/discounts/discounts-tabs.tsx`
- Create: `apps/admin-web/src/components/discounts/discounts-search.tsx`
- Modify (rewrite): `apps/admin-web/src/components/discounts/discounts-table.tsx`; create `discounts-table.test.tsx`
- Modify: `apps/admin-web/src/components/discounts/discounts-pagination.tsx` (`t.discountsPage.previous/next` → `t.discounts.previous/next`)
- Modify (rewrite): `apps/admin-web/src/app/discounts/page.tsx`
- Modify (temporary): `apps/admin-web/src/app/discounts/new/page.tsx` — replaced in Task 7; in this task make it a placeholder that does not import deleted files (see Step 6).
- Delete: `components/discounts/coupon-create-form.tsx`, `components/discounts/coupon-redeem-form.tsx`, `lib/coupon-lifecycle.ts`, `lib/coupon-lifecycle.test.ts`
- Modify: `messages/en.ts`, `messages/ar.ts` — remove `discountsPage`, `discountStatus`, `discountsRowActions`, `couponCreate`, `couponRedeem` **only after** `grep -rn "discountsPage\|discountStatus\|discountsRowActions\|couponCreate\|couponRedeem" apps/admin-web/src` shows no remaining use outside `messages/`.

**Interfaces:**

- Consumes: Task 1 (`fetchDiscountsPage`, `DiscountDto`, `DISCOUNT_TYPES`, `DISCOUNT_VIEWS`, `DiscountView`, `isDiscountView`, `discountClassOf`), Task 3 (`listSummary`, `combinationsShort`, `t.discounts`), `storeSettingsOrDefaults`.
- Produces: `DiscountStatusBadge({ status, t })`, `DiscountTypeDialog({ t, variant? })` (a "Create discount" button that opens the dialog; links go to `/discounts/new?type=<type>`), `DiscountsTabs({ view, q, t })`, `DiscountsSearch({ t })`, `DiscountsTable({ items, t, locale, currency, timeZone })`.

- [ ] **Step 1: Write the failing tests**

`apps/admin-web/src/components/discounts/discount-type-dialog.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { en } from "@/messages/en";
import { DiscountTypeDialog } from "./discount-type-dialog";

describe("DiscountTypeDialog", () => {
  it("offers Shopify's four types, each opening its form", () => {
    render(<DiscountTypeDialog t={en} />);

    fireEvent.click(screen.getByRole("button", { name: en.discounts.create }));

    const dialog = screen.getByRole("dialog", { name: en.discounts.typeDialogTitle });
    const links = within(dialog).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/discounts/new?type=amount_off_products",
      "/discounts/new?type=buy_x_get_y",
      "/discounts/new?type=amount_off_order",
      "/discounts/new?type=free_shipping",
    ]);
    expect(
      within(dialog).getByText(en.discounts.typeDescriptions.free_shipping),
    ).toBeInTheDocument();
  });
});
```

`apps/admin-web/src/components/discounts/discounts-table.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { DiscountDto } from "@/lib/api/discounts";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { DiscountsTable } from "./discounts-table";

const sale10: DiscountDto = {
  id: "promo-1",
  type: "amount_off_order",
  method: "code",
  title: "SALE10",
  code: "SALE10",
  status: "active",
  value: { kind: "percentage", amount: 10 },
  appliesTo: null,
  appliesOncePerOrder: false,
  buys: null,
  gets: null,
  maxUsesPerOrder: null,
  countries: null,
  maxShippingRateMinor: null,
  minimumRequirement: { kind: "none" },
  customerEligibility: { kind: "all" },
  usageLimit: null,
  oncePerCustomer: false,
  combinesWith: { product: true, order: false, shipping: false },
  startsAt: "2026-10-16T10:00:00.000Z",
  endsAt: null,
  usageCount: 3,
};

const summer: DiscountDto = {
  ...sale10,
  id: "promo-2",
  type: "free_shipping",
  method: "automatic",
  title: "Summer shipping",
  code: null,
  status: "scheduled",
  value: null,
  combinesWith: { product: false, order: false, shipping: false },
  usageCount: 0,
};

function renderTable(t = en, locale: "en" | "ar" = "en") {
  return render(
    <DiscountsTable items={[sale10, summer]} t={t} locale={locale} currency="EGP" timeZone="UTC" />,
  );
}

describe("DiscountsTable", () => {
  it("has Shopify's columns", () => {
    renderTable();
    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual([
      en.discounts.columns.title,
      en.discounts.columns.status,
      en.discounts.columns.method,
      en.discounts.columns.type,
      en.discounts.columns.combinations,
      en.discounts.columns.used,
    ]);
  });

  it("shows the code or title with its summary, linking to the discount", () => {
    renderTable();
    const [, first, second] = screen.getAllByRole("row");
    expect(within(first!).getByRole("link", { name: "SALE10" })).toHaveAttribute(
      "href",
      "/discounts/promo-1",
    );
    expect(within(first!).getByText("10% off entire order")).toBeInTheDocument();
    expect(within(first!).getByText(en.discounts.status.active)).toBeInTheDocument();
    expect(within(first!).getByText(en.discounts.methods.code)).toBeInTheDocument();
    expect(within(first!).getByText(en.discounts.types.amount_off_order)).toBeInTheDocument();
    expect(within(first!).getByText("Product")).toBeInTheDocument();
    expect(within(first!).getByText("3")).toBeInTheDocument();

    expect(within(second!).getByRole("link", { name: "Summer shipping" })).toBeInTheDocument();
    expect(within(second!).getByText(en.discounts.methods.automatic)).toBeInTheDocument();
    expect(within(second!).getByText(en.discounts.combinesNone)).toBeInTheDocument();
  });

  it("speaks Arabic", () => {
    renderTable(ar, "ar");
    expect(screen.getByText(ar.discounts.types.free_shipping)).toBeInTheDocument();
    expect(screen.getByText(ar.discounts.status.scheduled)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/components/discounts`
Expected: FAIL — `discount-type-dialog` missing, `DiscountsTable` has the old props.

- [ ] **Step 3: Write the components**

`apps/admin-web/src/components/discounts/discount-status-badge.tsx`:

```tsx
import { Badge } from "@platform/ui";
import type { DiscountStatus } from "@/lib/api/discounts";
import type { Dictionary } from "@/messages/en";

const VARIANT: Readonly<Record<DiscountStatus, "success" | "info" | "outline">> = {
  active: "success",
  scheduled: "info",
  expired: "outline",
};

/** Shopify's discount status: Active, Scheduled or Expired (a deactivated discount reads Expired). */
export function DiscountStatusBadge({
  status,
  t,
}: {
  readonly status: DiscountStatus;
  readonly t: Dictionary;
}) {
  return <Badge variant={VARIANT[status]}>{t.discounts.status[status]}</Badge>;
}
```

`apps/admin-web/src/components/discounts/discount-type-dialog.tsx`:

```tsx
"use client";

import Link from "next/link";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@platform/ui";
import { DISCOUNT_TYPES } from "@/lib/api/discounts";
import type { Dictionary } from "@/messages/en";

/**
 * Shopify's "Create discount" button and its "Select discount type" dialog: the four types, each with
 * a one-line description, each opening the form for that type.
 */
export function DiscountTypeDialog({ t }: { readonly t: Dictionary }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon aria-hidden="true" />
          {t.discounts.create}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.discounts.typeDialogTitle}</DialogTitle>
        </DialogHeader>
        <ul className="border-border flex flex-col divide-y rounded-xl border">
          {DISCOUNT_TYPES.map((type) => (
            <li key={type}>
              <Link
                href={`/discounts/new?type=${type}`}
                className="hover:bg-muted flex items-center gap-3 px-4 py-3 first:rounded-t-xl last:rounded-b-xl"
              >
                <span className="flex flex-1 flex-col">
                  <span className="text-sm font-medium">{t.discounts.types[type]}</span>
                  <span className="text-muted-foreground text-xs">
                    {t.discounts.typeDescriptions[type]}
                  </span>
                </span>
                <ChevronRightIcon
                  aria-hidden="true"
                  className="text-muted-foreground size-4 rtl:-scale-x-100"
                />
              </Link>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
```

Note: the `<Link>` text content includes the description, so its accessible name is "Amount off products Discount specific…"; the test reads `href`s, not names.

`apps/admin-web/src/components/discounts/discounts-tabs.tsx`:

```tsx
import Link from "next/link";
import { cn } from "@platform/ui";
import { DISCOUNT_VIEWS, type DiscountView } from "@/lib/api/discounts";
import type { Dictionary } from "@/messages/en";

/**
 * Shopify's tabs over the list — All, Active, Scheduled, Expired — as links, so the server renders
 * each view and the back button works. A tab keeps the search and starts at the first page.
 */
export function DiscountsTabs({
  view,
  q,
  t,
}: {
  readonly view: DiscountView;
  readonly q: string;
  readonly t: Dictionary;
}) {
  return (
    <nav aria-label={t.discounts.tabsLabel} className="flex gap-1 overflow-x-auto">
      {DISCOUNT_VIEWS.map((tab) => {
        const params = new URLSearchParams();
        if (tab !== "all") params.set("view", tab);
        if (q !== "") params.set("q", q);
        const query = params.toString();
        const current = tab === view;
        return (
          <Link
            key={tab}
            href={query === "" ? "/discounts" : `/discounts?${query}`}
            aria-current={current ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm",
              current ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {t.discounts.tabs[tab]}
          </Link>
        );
      })}
    </nav>
  );
}
```

`apps/admin-web/src/components/discounts/discounts-search.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Input, Label } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

const SEARCH_DEBOUNCE_MS = 350;

/** Search by title or code — drives `?q=` (same technique as `OrdersToolbar`), back to page one. */
export function DiscountsSearch({ t }: { readonly t: Dictionary }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setValue(searchParams.get("q") ?? "");
  }, [searchParams]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function onChange(next: string): void {
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      const q = next.trim();
      if (q === "") params.delete("q");
      else params.set("q", q);
      params.delete("after");
      params.delete("stack");
      const query = params.toString();
      router.push(query === "" ? pathname : `${pathname}?${query}`);
    }, SEARCH_DEBOUNCE_MS);
  }

  return (
    <div className="relative w-full sm:max-w-sm">
      <SearchIcon
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
      />
      <Label htmlFor="discounts-search" className="sr-only">
        {t.discounts.searchLabel}
      </Label>
      <Input
        id="discounts-search"
        type="search"
        placeholder={t.discounts.searchPlaceholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="ps-9"
      />
    </div>
  );
}
```

`apps/admin-web/src/components/discounts/discounts-table.tsx` (rewrite):

```tsx
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { DiscountDto } from "@/lib/api/discounts";
import { combinationsShort, listSummary } from "@/lib/discounts/summary";
import { formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { DiscountStatusBadge } from "./discount-status-badge";

/**
 * Shopify's discount list: Title (the code, or an automatic discount's title, with its summary line
 * under it), Status, Method, Type, Combinations, Used. The title links to the discount.
 */
export function DiscountsTable({
  items,
  t,
  locale,
  currency,
  timeZone,
}: {
  readonly items: readonly DiscountDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly currency: string;
  readonly timeZone: string;
}) {
  const ctx = { t: t.discounts.summary, locale, currency, timeZone };
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.discounts.columns.title}</TableHead>
          <TableHead>{t.discounts.columns.status}</TableHead>
          <TableHead>{t.discounts.columns.method}</TableHead>
          <TableHead>{t.discounts.columns.type}</TableHead>
          <TableHead>{t.discounts.columns.combinations}</TableHead>
          <TableHead className="text-end">{t.discounts.columns.used}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((discount) => {
          const summary = listSummary(discount, ctx);
          return (
            <TableRow key={discount.id}>
              <TableCell>
                <div className="flex flex-col">
                  <Link
                    href={`/discounts/${encodeURIComponent(discount.id)}`}
                    className="font-medium hover:underline"
                  >
                    {discount.code ?? discount.title}
                  </Link>
                  {summary !== "" && (
                    <span className="text-muted-foreground text-xs">{summary}</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <DiscountStatusBadge status={discount.status} t={t} />
              </TableCell>
              <TableCell>{t.discounts.methods[discount.method]}</TableCell>
              <TableCell>{t.discounts.types[discount.type]}</TableCell>
              <TableCell>{combinationsShort(discount.combinesWith, t.discounts)}</TableCell>
              <TableCell className="text-end tabular-nums">
                {formatNumber(locale, discount.usageCount)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 4: Rewrite `apps/admin-web/src/app/discounts/page.tsx`**

```tsx
import type { ReactNode } from "react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { AlertTriangleIcon, LockIcon, PercentIcon, SearchXIcon } from "lucide-react";
import { Card, CardContent, Skeleton } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { DiscountTypeDialog } from "@/components/discounts/discount-type-dialog";
import { DiscountsPagination } from "@/components/discounts/discounts-pagination";
import { DiscountsSearch } from "@/components/discounts/discounts-search";
import { DiscountsTable } from "@/components/discounts/discounts-table";
import { DiscountsTabs } from "@/components/discounts/discounts-tabs";
import { fetchDiscountsPage, isDiscountView, type DiscountView } from "@/lib/api/discounts";
import { storeSettingsOrDefaults } from "@/lib/api/store-settings";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const PAGE_SIZE = 20;

interface DiscountsPageProps {
  readonly searchParams: Promise<{
    readonly view?: string;
    readonly q?: string;
    readonly after?: string;
  }>;
}

/**
 * Phase 2 Part 2 — Shopify's Discounts list (`GET /discounts`): "Create discount" opens the type
 * dialog; tabs All · Active · Scheduled · Expired; search by title or code; cursor pagination.
 */
export default async function DiscountsPage({ searchParams }: DiscountsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const params = await searchParams;
  const view: DiscountView = isDiscountView(params.view) ? params.view : "all";
  const q = params.q?.trim() ?? "";

  return (
    <AppShell t={t} locale={locale} activeNavId="discounts" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">{t.discounts.title}</h1>
          <DiscountTypeDialog t={t} />
        </header>

        <Card>
          <div className="border-border flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <DiscountsTabs view={view} q={q} t={t} />
            <DiscountsSearch t={t} />
          </div>
          <Suspense key={`${view}|${q}|${params.after ?? ""}`} fallback={<DiscountsSkeleton />}>
            <DiscountsResults view={view} q={q} after={params.after} t={t} locale={locale} />
          </Suspense>
        </Card>
      </div>
    </AppShell>
  );
}

async function DiscountsResults({
  view,
  q,
  after,
  t,
  locale,
}: {
  readonly view: DiscountView;
  readonly q: string;
  readonly after: string | undefined;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const [result, settings] = await Promise.all([
    fetchDiscountsPage({ view, q, first: PAGE_SIZE, ...(after === undefined ? {} : { after }) }),
    storeSettingsOrDefaults(),
  ]);

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.discounts.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.discounts.error}
      />
    );
  }
  if (result.items.length === 0) {
    if (view === "all" && q === "" && after === undefined) {
      return (
        <CardContent className="flex flex-col items-center gap-3 px-4 py-16 text-center sm:px-5">
          <PercentIcon aria-hidden="true" className="text-muted-foreground size-6" />
          <h2 className="text-lg font-semibold">{t.discounts.emptyTitle}</h2>
          <p className="text-muted-foreground max-w-md text-sm">{t.discounts.emptyBody}</p>
          <DiscountTypeDialog t={t} />
        </CardContent>
      );
    }
    return (
      <StatePanel
        icon={<SearchXIcon aria-hidden="true" className="size-5" />}
        message={q === "" ? t.discounts.noneInView : t.discounts.noMatches}
      />
    );
  }

  return (
    <>
      <CardContent className="p-0 sm:p-0">
        <DiscountsTable
          items={result.items}
          t={t}
          locale={locale}
          currency={settings.currency}
          timeZone={settings.timezone}
        />
      </CardContent>
      <div className="border-border flex items-center justify-end border-t px-4 py-3 sm:px-5">
        <DiscountsPagination
          hasNextPage={result.pageInfo.hasNextPage}
          endCursor={result.pageInfo.endCursor}
          t={t}
        />
      </div>
    </>
  );
}

function StatePanel({ icon, message }: { readonly icon: ReactNode; readonly message: string }) {
  return (
    <CardContent className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-16 text-center text-base sm:px-5">
      {icon}
      <p role="note">{message}</p>
    </CardContent>
  );
}

function DiscountsSkeleton() {
  return (
    <CardContent className="p-0 sm:p-0" aria-busy="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="border-border flex items-center gap-4 border-t px-4 py-3 first:border-t-0 sm:px-5"
        >
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="ms-auto h-4 w-12" />
        </div>
      ))}
    </CardContent>
  );
}
```

- [ ] **Step 5: Update `discounts-pagination.tsx`** — replace `t.discountsPage.previous` with `t.discounts.previous` and `t.discountsPage.next` with `t.discounts.next`.

- [ ] **Step 6: Remove the coupon screens**

Delete the four files listed above. Replace `apps/admin-web/src/app/discounts/new/page.tsx` for now with a redirect to the list (Task 7 writes the real page):

```tsx
import { redirect } from "next/navigation";

/** Replaced by the discount form in Task 7 of the Part 2 plan. */
export default function NewDiscountPage() {
  redirect("/discounts");
}
```

Then run `grep -rn "discountsPage\|discountStatus\|discountsRowActions\|couponCreate\|couponRedeem\|coupon-lifecycle\|fetchCouponsPage" apps/admin-web/src` (from the repo root). Remove from `en.ts` and `ar.ts` every one of those sections that no longer has a use outside `messages/`. Keep any that something else still uses (for example `marketingPage` keys are unrelated and stay).

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm exec vitest run src/components/discounts src/lib/discounts src/lib/api/discounts.test.ts src/lib/api/route-contract.test.ts`
Expected: PASS.
Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add -A apps/admin-web/src/components/discounts apps/admin-web/src/app/discounts apps/admin-web/src/lib/coupon-lifecycle.ts apps/admin-web/src/lib/coupon-lifecycle.test.ts apps/admin-web/src/messages
git commit -m "feat(admin-web): shopify-style discounts list with tabs, search and type dialog"
```

---

### Task 6: The form's cards and the Browse picker

**Files:**

- Create: `apps/admin-web/src/components/discounts/editor/inputs.tsx`
- Create: `apps/admin-web/src/components/discounts/editor/resource-picker.tsx`, `resource-picker.test.tsx`
- Create: `apps/admin-web/src/components/discounts/editor/method-card.tsx`
- Create: `apps/admin-web/src/components/discounts/editor/value-card.tsx`
- Create: `apps/admin-web/src/components/discounts/editor/buys-gets-card.tsx`
- Create: `apps/admin-web/src/components/discounts/editor/free-shipping-card.tsx`
- Create: `apps/admin-web/src/components/discounts/editor/rules-cards.tsx`

**Interfaces:**

- Consumes: Task 2 (`DiscountFormValues`, `PickedItem`, `generateDiscountCode`), Task 3 copy, Task 4 (`searchDiscountTargetsAction`, `TargetSearchResult`, `TargetOption` from `@/app/discounts/actions`), `MoneyInput` (`@/components/products/editor/controls`), `CheckboxRow` (`@/components/products/editor/field`), `COUNTRY_CODES` (`@platform/regions`), `countryName` (`@/lib/shipping/display`).
- Produces (Task 7 renders these):
  - `CardProps = { values: DiscountFormValues; set: (patch: Partial<DiscountFormValues>) => void; errors: Readonly<Record<string, string>>; t: Dictionary }`
  - `MethodCard(props: CardProps & { mode: "create" | "edit" })`
  - `ValueCard(props: CardProps & { currency: string; locale: Locale })`
  - `BuysGetsCard(props: CardProps & { currency: string; locale: Locale })`
  - `FreeShippingCard(props: CardProps & { currency: string; locale: Locale })`
  - `MinimumCard(props: CardProps & { currency: string; locale: Locale })`, `EligibilityCard(props: CardProps)`, `MaxUsesCard(props: CardProps)`, `CombinationsCard(props: CardProps)`, `ActiveDatesCard(props: CardProps & { zone: string })`
  - `ResourcePicker(props)` — see its file.

Every card is controlled by `values`/`set` and posts nothing itself: the editor (Task 7) posts the whole `values` as JSON. Inputs therefore have no `name` and no `form` attribute.

- [ ] **Step 1: Write the failing test** — `apps/admin-web/src/components/discounts/editor/resource-picker.test.tsx`

```tsx
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { en } from "@/messages/en";
import { ResourcePicker } from "./resource-picker";

describe("ResourcePicker", () => {
  it("searches, lets the merchant tick results, and adds them on Done", async () => {
    const search = vi.fn().mockResolvedValue({
      outcome: "ok",
      items: [
        { id: "p-1", label: "Sneaker", detail: "SNK-1" },
        { id: "p-2", label: "Boot", detail: null },
      ],
    });
    const onChange = vi.fn();
    render(
      <ResourcePicker
        title={en.discounts.form.specificProducts}
        searchLabel={en.discounts.form.searchProducts}
        selected={[]}
        onChange={onChange}
        search={search}
        t={en}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: en.discounts.form.browse }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(search).toHaveBeenCalledWith(""));
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Sneaker/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: en.discounts.form.pickerDone }));

    expect(onChange).toHaveBeenCalledWith([{ id: "p-1", label: "Sneaker" }]);
  });

  it("opens the dialog with what was typed in the field", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const search = vi.fn().mockResolvedValue({ outcome: "ok", items: [] });
    render(
      <ResourcePicker
        title="Products"
        searchLabel={en.discounts.form.searchProducts}
        selected={[]}
        onChange={vi.fn()}
        search={search}
        t={en}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: en.discounts.form.searchProducts }), {
      target: { value: "boo" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(search).toHaveBeenLastCalledWith("boo");
    expect(await screen.findByText(en.discounts.form.pickerEmpty)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("lists the picked items with a remove button each", () => {
    const onChange = vi.fn();
    render(
      <ResourcePicker
        title="Products"
        searchLabel={en.discounts.form.searchProducts}
        selected={[
          { id: "p-1", label: "Sneaker" },
          { id: "p-2", label: "Boot" },
        ]}
        onChange={onChange}
        search={vi.fn()}
        t={en}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Sneaker" }));
    expect(onChange).toHaveBeenCalledWith([{ id: "p-2", label: "Boot" }]);
  });

  it("says when the search fails", async () => {
    render(
      <ResourcePicker
        title="Products"
        searchLabel={en.discounts.form.searchProducts}
        selected={[]}
        onChange={vi.fn()}
        search={vi.fn().mockResolvedValue({ outcome: "error" })}
        t={en}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: en.discounts.form.browse }));
    expect(await screen.findByText(en.discounts.form.pickerError)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/components/discounts/editor/resource-picker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `apps/admin-web/src/components/discounts/editor/inputs.tsx`**

```tsx
"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { Card, CardContent, Input, Label, cn } from "@platform/ui";
import type { DiscountFormValues } from "@/lib/discounts/form";
import type { Dictionary } from "@/messages/en";

/** What every form card receives: the form, a way to change it, the errors by field, the copy. */
export interface CardProps {
  readonly values: DiscountFormValues;
  readonly set: (patch: Partial<DiscountFormValues>) => void;
  readonly errors: Readonly<Record<string, string>>;
  readonly t: Dictionary;
}

/** A form card with Shopify's bold heading. */
export function FormCard({
  title,
  aside,
  children,
}: {
  readonly title: string;
  /** Shown at the heading's end, e.g. the discount class. */
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {aside}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/** A native radio with its label. */
export function RadioRow({
  label,
  className,
  children,
  ...props
}: Omit<ComponentProps<"input">, "type"> & {
  readonly label: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" className="accent-primary size-4" {...props} />
        {label}
      </label>
      {children !== undefined && props.checked === true && <div className="ps-6">{children}</div>}
    </div>
  );
}

/** A field's error under it; `id` ties it to the input's `aria-describedby`. */
export function ErrorText({
  id,
  message,
}: {
  readonly id: string;
  readonly message?: string | undefined;
}) {
  if (message === undefined) return null;
  return (
    <p id={id} className="text-destructive text-xs">
      {message}
    </p>
  );
}

/** Label + text input + hint + error, controlled. */
export function TextField({
  label,
  value,
  onValueChange,
  error,
  hint,
  inputMode,
  type = "text",
  className,
  end,
}: {
  readonly label: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
  readonly inputMode?: ComponentProps<"input">["inputMode"];
  readonly type?: "text" | "date" | "time";
  readonly className?: string;
  /** Something after the input on the same line (a "%" sign, a button). */
  readonly end?: ReactNode;
}) {
  const id = useId();
  const describedBy = [
    error === undefined ? null : `${id}-error`,
    hint === undefined ? null : `${id}-hint`,
  ]
    .filter((value) => value !== null)
    .join(" ");
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type={type}
          inputMode={inputMode}
          value={value}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy === "" ? undefined : describedBy}
          onChange={(event) => onValueChange(event.target.value)}
        />
        {end}
      </div>
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      <ErrorText id={`${id}-error`} message={error} />
    </div>
  );
}
```

- [ ] **Step 4: Write `apps/admin-web/src/components/discounts/editor/resource-picker.tsx`**

```tsx
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@platform/ui";
import type { TargetSearchResult } from "@/app/discounts/actions";
import type { PickedItem } from "@/lib/discounts/form";
import type { Dictionary } from "@/messages/en";
import { ErrorText } from "./inputs";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Shopify's "Search products … [Browse]" field and its dialog. Typing in the field or pressing
 * Browse opens the dialog; results are ticked there and added on Done. `search` is a server action
 * (or, for countries, a local filter), so nothing here calls the runtime API.
 */
export function ResourcePicker({
  title,
  searchLabel,
  selected,
  onChange,
  search,
  t,
  error,
}: {
  readonly title: string;
  readonly searchLabel: string;
  readonly selected: readonly PickedItem[];
  readonly onChange: (items: readonly PickedItem[]) => void;
  readonly search: (query: string) => Promise<TargetSearchResult>;
  readonly t: Dictionary;
  readonly error?: string | undefined;
}) {
  const copy = t.discounts.form;
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<readonly PickedItem[]>(selected);
  const [result, setResult] = useState<TargetSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchRef
        .current(query)
        .catch((): TargetSearchResult => ({ outcome: "error" }))
        .then((next) => {
          if (cancelled) return;
          setResult(next);
          setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  function openWith(initialQuery: string): void {
    setQuery(initialQuery);
    setDraft(selected);
    setOpen(true);
  }

  function toggle(item: PickedItem, checked: boolean): void {
    setDraft((current) =>
      checked ? [...current, item] : current.filter((picked) => picked.id !== item.id),
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
          />
          <Label htmlFor={fieldId} className="sr-only">
            {searchLabel}
          </Label>
          <Input
            id={fieldId}
            type="search"
            placeholder={searchLabel}
            className="ps-9"
            value=""
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={error === undefined ? undefined : `${fieldId}-error`}
            onChange={(event) => openWith(event.target.value)}
          />
        </div>
        <Button type="button" variant="outline" onClick={() => openWith("")}>
          {copy.browse}
        </Button>
      </div>
      <ErrorText id={`${fieldId}-error`} message={error} />

      {selected.length > 0 && (
        <ul className="border-border divide-border flex flex-col divide-y rounded-xl border">
          {selected.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="truncate">{item.label}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={copy.remove.replace("{name}", item.label)}
                onClick={() => onChange(selected.filter((picked) => picked.id !== item.id))}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Input
            type="search"
            aria-label={searchLabel}
            placeholder={searchLabel}
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="max-h-80 overflow-y-auto" aria-busy={searching || undefined}>
            {result === null || (searching && result.outcome !== "ok") ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                {copy.pickerSearching}
              </p>
            ) : result.outcome === "error" ? (
              <p role="alert" className="text-destructive py-6 text-center text-sm">
                {copy.pickerError}
              </p>
            ) : result.items.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">{copy.pickerEmpty}</p>
            ) : (
              <ul className="divide-border flex flex-col divide-y">
                {result.items.map((item) => (
                  <li key={item.id}>
                    <label className="flex items-center gap-3 px-1 py-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-primary size-4"
                        checked={draft.some((picked) => picked.id === item.id)}
                        onChange={(event) =>
                          toggle({ id: item.id, label: item.label }, event.target.checked)
                        }
                      />
                      <span className="flex flex-col">
                        <span>{item.label}</span>
                        {item.detail !== null && (
                          <span className="text-muted-foreground text-xs">{item.detail}</span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {copy.pickerCancel}
            </Button>
            <Button
              type="button"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              {copy.pickerDone}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 5: Run the picker test**

Run: `pnpm exec vitest run src/components/discounts/editor/resource-picker.test.tsx`
Expected: PASS.

- [ ] **Step 6: Write the cards**

`apps/admin-web/src/components/discounts/editor/method-card.tsx`:

```tsx
"use client";

import { Button, cn } from "@platform/ui";
import { discountClassOf } from "@/lib/api/discounts";
import { generateDiscountCode } from "@/lib/discounts/form";
import { FormCard, TextField, type CardProps } from "./inputs";

/**
 * The type card at the top of Shopify's form: the type as its heading, the class beside it, the
 * method (code or automatic — fixed once saved), then the code with "Generate random code", or the
 * automatic discount's title.
 */
export function MethodCard({
  values,
  set,
  errors,
  t,
  mode,
}: CardProps & { readonly mode: "create" | "edit" }) {
  const copy = t.discounts.form;
  const methods = [
    { value: "code", label: copy.methodCode },
    { value: "automatic", label: copy.methodAutomatic },
  ] as const;
  return (
    <FormCard
      title={t.discounts.types[values.type]}
      aside={
        <span className="text-muted-foreground text-xs">
          {t.discounts.classes[discountClassOf(values.type)]}
        </span>
      }
    >
      <div role="radiogroup" aria-label={copy.method} className="flex flex-col gap-1.5">
        <span className="text-sm">{copy.method}</span>
        <div className="bg-muted inline-flex w-fit rounded-lg p-0.5">
          {methods.map((method) => (
            <button
              key={method.value}
              type="button"
              role="radio"
              aria-checked={values.method === method.value}
              disabled={mode === "edit" && values.method !== method.value}
              onClick={() => set({ method: method.value })}
              className={cn(
                "rounded-md px-3 py-1 text-sm disabled:opacity-50",
                values.method === method.value
                  ? "bg-card font-medium shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              {method.label}
            </button>
          ))}
        </div>
      </div>
      {values.method === "code" ? (
        <TextField
          label={copy.code}
          value={values.code}
          onValueChange={(code) => set({ code })}
          error={errors["code"]}
          hint={copy.codeHint}
          end={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => set({ code: generateDiscountCode() })}
            >
              {copy.generate}
            </Button>
          }
        />
      ) : (
        <TextField
          label={copy.title}
          value={values.title}
          onValueChange={(title) => set({ title })}
          error={errors["title"]}
          hint={copy.titleHint}
        />
      )}
    </FormCard>
  );
}
```

`apps/admin-web/src/components/discounts/editor/value-card.tsx`:

```tsx
"use client";

import { useId } from "react";
import { Label } from "@platform/ui";
import { searchDiscountTargetsAction } from "@/app/discounts/actions";
import { MoneyInput } from "@/components/products/editor/controls";
import { CheckboxRow, NativeSelect } from "@/components/products/editor/field";
import type { Locale } from "@/lib/i18n";
import { ErrorText, FormCard, RadioRow, type CardProps } from "./inputs";
import { ResourcePicker } from "./resource-picker";

/** "Discount value" for amount off products / order: percentage or fixed amount, and for products, what it applies to. */
export function ValueCard({
  values,
  set,
  errors,
  t,
  currency,
  locale,
}: CardProps & { readonly currency: string; readonly locale: Locale }) {
  const copy = t.discounts.form;
  const valueId = useId();
  const groupName = useId();
  const forProducts = values.type === "amount_off_products";
  return (
    <FormCard title={copy.value}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={valueId}>{copy.value}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label={copy.valueType}
            value={values.valueKind}
            onChange={(event) =>
              set({
                valueKind: event.target.value === "fixed_amount" ? "fixed_amount" : "percentage",
              })
            }
          >
            <option value="percentage">{copy.percentage}</option>
            <option value="fixed_amount">{copy.fixedAmount}</option>
          </NativeSelect>
          <div className="min-w-32 flex-1">
            {values.valueKind === "percentage" ? (
              <div className="flex items-center gap-2">
                <input
                  id={valueId}
                  inputMode="decimal"
                  className="border-input bg-card h-9 w-full rounded-md border px-3 text-sm"
                  value={values.valueAmount}
                  aria-invalid={errors["value"] === undefined ? undefined : true}
                  aria-describedby={errors["value"] === undefined ? undefined : `${valueId}-error`}
                  onChange={(event) => set({ valueAmount: event.target.value })}
                />
                <span aria-hidden="true" className="text-muted-foreground text-sm">
                  %
                </span>
              </div>
            ) : (
              <MoneyInput
                id={valueId}
                name="valueAmount"
                label={copy.value}
                currency={currency}
                locale={locale}
                value={values.valueAmount}
                onValueChange={(valueAmount) => set({ valueAmount })}
                invalid={errors["value"] !== undefined}
                describedBy={errors["value"] === undefined ? undefined : `${valueId}-error`}
              />
            )}
          </div>
        </div>
        <ErrorText id={`${valueId}-error`} message={errors["value"]} />
      </div>

      {forProducts && (
        <div className="flex flex-col gap-2">
          <span className="text-sm">{copy.appliesTo}</span>
          <div className="flex flex-wrap gap-4">
            <RadioRow
              name={groupName}
              label={copy.specificCategories}
              checked={values.appliesToKind === "categories"}
              onChange={() => set({ appliesToKind: "categories", appliesToItems: [] })}
            />
            <RadioRow
              name={groupName}
              label={copy.specificProducts}
              checked={values.appliesToKind === "products"}
              onChange={() => set({ appliesToKind: "products", appliesToItems: [] })}
            />
          </div>
          <ResourcePicker
            title={
              values.appliesToKind === "categories"
                ? copy.specificCategories
                : copy.specificProducts
            }
            searchLabel={
              values.appliesToKind === "categories" ? copy.searchCategories : copy.searchProducts
            }
            selected={values.appliesToItems}
            onChange={(appliesToItems) => set({ appliesToItems })}
            search={(query) => searchDiscountTargetsAction(values.appliesToKind, query)}
            t={t}
            error={errors["appliesTo"]}
          />
          {values.valueKind === "fixed_amount" && (
            <div className="flex flex-col gap-1">
              <CheckboxRow
                label={copy.oncePerOrder}
                checked={values.appliesOncePerOrder}
                onChange={(event) => set({ appliesOncePerOrder: event.target.checked })}
              />
              <p className="text-muted-foreground ps-6 text-xs">{copy.oncePerOrderHint}</p>
            </div>
          )}
        </div>
      )}
    </FormCard>
  );
}
```

`apps/admin-web/src/components/discounts/editor/buys-gets-card.tsx`:

```tsx
"use client";

import { useId } from "react";
import { searchDiscountTargetsAction } from "@/app/discounts/actions";
import { MoneyInput } from "@/components/products/editor/controls";
import { CheckboxRow, NativeSelect } from "@/components/products/editor/field";
import type { TargetScope } from "@/lib/api/discounts";
import type { Locale } from "@/lib/i18n";
import { ErrorText, FormCard, RadioRow, TextField, type CardProps } from "./inputs";
import { ResourcePicker } from "./resource-picker";

/** Buy X get Y: "Customer buys" and "Customer gets", as two cards in Shopify's order. */
export function BuysGetsCard({
  values,
  set,
  errors,
  t,
  currency,
  locale,
}: CardProps & { readonly currency: string; readonly locale: Locale }) {
  const copy = t.discounts.form;
  const buysGroup = useId();
  const effectGroup = useId();
  const buysValueId = useId();
  const scopeOf = (value: string): TargetScope =>
    value === "categories" ? "categories" : "products";

  return (
    <>
      <FormCard title={copy.customerBuys}>
        <div className="flex flex-col gap-2">
          <RadioRow
            name={buysGroup}
            label={copy.minQuantityOfItems}
            checked={values.buysKind === "quantity"}
            onChange={() => set({ buysKind: "quantity", buysValue: "" })}
          />
          <RadioRow
            name={buysGroup}
            label={copy.minPurchaseAmount}
            checked={values.buysKind === "amount"}
            onChange={() => set({ buysKind: "amount", buysValue: "" })}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {values.buysKind === "quantity" ? (
            <TextField
              label={copy.quantity}
              inputMode="numeric"
              value={values.buysValue}
              onValueChange={(buysValue) => set({ buysValue })}
              error={errors["buys"]}
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={buysValueId} className="text-sm font-medium">
                {copy.amount}
              </label>
              <MoneyInput
                id={buysValueId}
                name="buysValue"
                label={copy.amount}
                currency={currency}
                locale={locale}
                value={values.buysValue}
                onValueChange={(buysValue) => set({ buysValue })}
                invalid={errors["buys"] !== undefined}
                describedBy={errors["buys"] === undefined ? undefined : `${buysValueId}-error`}
              />
              <ErrorText id={`${buysValueId}-error`} message={errors["buys"]} />
            </div>
          )}
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {copy.anyItemsFrom}
            <NativeSelect
              value={values.buysScope}
              onChange={(event) => set({ buysScope: scopeOf(event.target.value), buysItems: [] })}
            >
              <option value="products">{copy.specificProducts}</option>
              <option value="categories">{copy.specificCategories}</option>
            </NativeSelect>
          </label>
        </div>
        <ResourcePicker
          title={
            values.buysScope === "categories" ? copy.specificCategories : copy.specificProducts
          }
          searchLabel={
            values.buysScope === "categories" ? copy.searchCategories : copy.searchProducts
          }
          selected={values.buysItems}
          onChange={(buysItems) => set({ buysItems })}
          search={(query) => searchDiscountTargetsAction(values.buysScope, query)}
          t={t}
          error={errors["buysItems"]}
        />
      </FormCard>

      <FormCard title={copy.customerGets}>
        <p className="text-muted-foreground text-xs">{copy.getsHint}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label={copy.quantity}
            inputMode="numeric"
            value={values.getsQuantity}
            onValueChange={(getsQuantity) => set({ getsQuantity })}
            error={errors["gets"]}
          />
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {copy.anyItemsFrom}
            <NativeSelect
              value={values.getsScope}
              onChange={(event) => set({ getsScope: scopeOf(event.target.value), getsItems: [] })}
            >
              <option value="products">{copy.specificProducts}</option>
              <option value="categories">{copy.specificCategories}</option>
            </NativeSelect>
          </label>
        </div>
        <ResourcePicker
          title={
            values.getsScope === "categories" ? copy.specificCategories : copy.specificProducts
          }
          searchLabel={
            values.getsScope === "categories" ? copy.searchCategories : copy.searchProducts
          }
          selected={values.getsItems}
          onChange={(getsItems) => set({ getsItems })}
          search={(query) => searchDiscountTargetsAction(values.getsScope, query)}
          t={t}
          error={errors["getsItems"]}
        />
        <div className="flex flex-col gap-2">
          <span className="text-sm">{copy.atDiscountedValue}</span>
          <RadioRow
            name={effectGroup}
            label={copy.percentage}
            checked={values.getsEffect === "percentage"}
            onChange={() => set({ getsEffect: "percentage" })}
          >
            <TextField
              label={copy.percentage}
              inputMode="decimal"
              value={values.getsPercentage}
              onValueChange={(getsPercentage) => set({ getsPercentage })}
              error={errors["getsEffect"]}
              end={
                <span aria-hidden="true" className="text-muted-foreground text-sm">
                  %
                </span>
              }
            />
          </RadioRow>
          <RadioRow
            name={effectGroup}
            label={copy.free}
            checked={values.getsEffect === "free"}
            onChange={() => set({ getsEffect: "free" })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <CheckboxRow
            label={copy.maxUsesPerOrder}
            checked={values.limitUsesPerOrder}
            onChange={(event) => set({ limitUsesPerOrder: event.target.checked })}
          />
          {values.limitUsesPerOrder && (
            <TextField
              label={copy.maxUsesPerOrder}
              inputMode="numeric"
              className="ps-6"
              value={values.maxUsesPerOrder}
              onValueChange={(maxUsesPerOrder) => set({ maxUsesPerOrder })}
              error={errors["maxUsesPerOrder"]}
            />
          )}
        </div>
      </FormCard>
    </>
  );
}
```

`apps/admin-web/src/components/discounts/editor/free-shipping-card.tsx`:

```tsx
"use client";

import { useId } from "react";
import { COUNTRY_CODES } from "@platform/regions";
import { MoneyInput } from "@/components/products/editor/controls";
import { CheckboxRow } from "@/components/products/editor/field";
import type { Locale } from "@/lib/i18n";
import { countryName } from "@/lib/shipping/display";
import { ErrorText, FormCard, RadioRow, type CardProps } from "./inputs";
import { ResourcePicker } from "./resource-picker";

/** Free shipping: all countries or chosen ones, and an optional cap on the shipping rate. */
export function FreeShippingCard({
  values,
  set,
  errors,
  t,
  currency,
  locale,
}: CardProps & { readonly currency: string; readonly locale: Locale }) {
  const copy = t.discounts.form;
  const group = useId();
  const capId = useId();
  const searchCountries = (query: string) => {
    const needle = query.trim().toLocaleLowerCase(locale);
    const items = COUNTRY_CODES.map((code) => ({
      id: code,
      label: countryName(code, locale),
      detail: code,
    }))
      .filter(
        (item) =>
          needle === "" ||
          item.label.toLocaleLowerCase(locale).includes(needle) ||
          item.id.toLowerCase() === needle,
      )
      .sort((a, b) => a.label.localeCompare(b.label, locale));
    return Promise.resolve({ outcome: "ok" as const, items });
  };

  return (
    <>
      <FormCard title={copy.countries}>
        <RadioRow
          name={group}
          label={copy.allCountries}
          checked={values.allCountries}
          onChange={() => set({ allCountries: true })}
        />
        <RadioRow
          name={group}
          label={copy.selectedCountries}
          checked={!values.allCountries}
          onChange={() => set({ allCountries: false })}
        >
          <ResourcePicker
            title={copy.selectedCountries}
            searchLabel={copy.searchCountries}
            selected={values.countries}
            onChange={(countries) => set({ countries })}
            search={searchCountries}
            t={t}
            error={errors["countries"]}
          />
        </RadioRow>
      </FormCard>

      <FormCard title={copy.shippingRates}>
        <CheckboxRow
          label={copy.excludeRatesOver}
          checked={values.excludeRatesOver}
          onChange={(event) => set({ excludeRatesOver: event.target.checked })}
        />
        {values.excludeRatesOver && (
          <div className="flex flex-col gap-1.5 ps-6">
            <MoneyInput
              id={capId}
              name="maxShippingRate"
              label={copy.excludeRatesOver}
              currency={currency}
              locale={locale}
              value={values.maxShippingRate}
              onValueChange={(maxShippingRate) => set({ maxShippingRate })}
              invalid={errors["maxShippingRateMinor"] !== undefined}
              describedBy={
                errors["maxShippingRateMinor"] === undefined ? undefined : `${capId}-error`
              }
            />
            <ErrorText id={`${capId}-error`} message={errors["maxShippingRateMinor"]} />
          </div>
        )}
      </FormCard>
    </>
  );
}
```

`apps/admin-web/src/components/discounts/editor/rules-cards.tsx`:

```tsx
"use client";

import { useId } from "react";
import { searchDiscountTargetsAction } from "@/app/discounts/actions";
import { MoneyInput } from "@/components/products/editor/controls";
import { CheckboxRow } from "@/components/products/editor/field";
import { discountClassOf, type DiscountClass } from "@/lib/api/discounts";
import type { Locale } from "@/lib/i18n";
import { ErrorText, FormCard, RadioRow, TextField, type CardProps } from "./inputs";
import { ResourcePicker } from "./resource-picker";

/** "Minimum purchase requirements": none, an amount, or a quantity of items. Not for buy X get Y. */
export function MinimumCard({
  values,
  set,
  errors,
  t,
  currency,
  locale,
}: CardProps & { readonly currency: string; readonly locale: Locale }) {
  const copy = t.discounts.form;
  const group = useId();
  const amountId = useId();
  const error = errors["minimumRequirement"];
  return (
    <FormCard title={copy.minimumRequirements}>
      <RadioRow
        name={group}
        label={copy.noMinimum}
        checked={values.minimumKind === "none"}
        onChange={() => set({ minimumKind: "none" })}
      />
      <RadioRow
        name={group}
        label={copy.minimumAmount.replace("{currency}", currency)}
        checked={values.minimumKind === "amount"}
        onChange={() => set({ minimumKind: "amount" })}
      >
        <div className="flex flex-col gap-1.5">
          <MoneyInput
            id={amountId}
            name="minimumAmount"
            label={copy.minimumAmount.replace("{currency}", currency)}
            currency={currency}
            locale={locale}
            value={values.minimumAmount}
            onValueChange={(minimumAmount) => set({ minimumAmount })}
            invalid={error !== undefined}
            describedBy={error === undefined ? undefined : `${amountId}-error`}
          />
          {values.type === "amount_off_products" && (
            <p className="text-muted-foreground text-xs">{copy.minimumProductsHint}</p>
          )}
          <ErrorText id={`${amountId}-error`} message={error} />
        </div>
      </RadioRow>
      <RadioRow
        name={group}
        label={copy.minimumQuantity}
        checked={values.minimumKind === "quantity"}
        onChange={() => set({ minimumKind: "quantity" })}
      >
        <TextField
          label={copy.minimumQuantity}
          inputMode="numeric"
          value={values.minimumQuantity}
          onValueChange={(minimumQuantity) => set({ minimumQuantity })}
          error={error}
          hint={values.type === "amount_off_products" ? copy.minimumProductsHint : undefined}
        />
      </RadioRow>
    </FormCard>
  );
}

/** "Customer eligibility": everyone, or customers picked from Customers. */
export function EligibilityCard({ values, set, errors, t }: CardProps) {
  const copy = t.discounts.form;
  const group = useId();
  return (
    <FormCard title={copy.eligibility}>
      <RadioRow
        name={group}
        label={copy.allCustomers}
        checked={values.allCustomers}
        onChange={() => set({ allCustomers: true })}
      />
      <RadioRow
        name={group}
        label={copy.specificCustomers}
        checked={!values.allCustomers}
        onChange={() => set({ allCustomers: false })}
      >
        <ResourcePicker
          title={copy.specificCustomers}
          searchLabel={copy.searchCustomers}
          selected={values.customers}
          onChange={(customers) => set({ customers })}
          search={(query) => searchDiscountTargetsAction("customers", query)}
          t={t}
          error={errors["customerEligibility"]}
        />
      </RadioRow>
    </FormCard>
  );
}

/** "Maximum discount uses" — codes only, as in Shopify. */
export function MaxUsesCard({ values, set, errors, t }: CardProps) {
  const copy = t.discounts.form;
  return (
    <FormCard title={copy.maxUses}>
      <CheckboxRow
        label={copy.limitTotal}
        checked={values.limitTotalUses}
        onChange={(event) => set({ limitTotalUses: event.target.checked })}
      />
      {values.limitTotalUses && (
        <TextField
          label={copy.limitTotal}
          inputMode="numeric"
          className="ps-6"
          value={values.usageLimit}
          onValueChange={(usageLimit) => set({ usageLimit })}
          error={errors["usageLimit"]}
        />
      )}
      <CheckboxRow
        label={copy.limitPerCustomer}
        checked={values.oncePerCustomer}
        onChange={(event) => set({ oncePerCustomer: event.target.checked })}
      />
    </FormCard>
  );
}

/** "Combinations": which classes this discount can be combined with; its own class reads "Other …". */
export function CombinationsCard({ values, set, t }: CardProps) {
  const copy = t.discounts.form;
  const own = discountClassOf(values.type);
  const labels: Readonly<Record<DiscountClass, readonly [string, string]>> = {
    product: [copy.combineProduct, copy.combineOtherProduct],
    order: [copy.combineOrder, copy.combineOtherOrder],
    shipping: [copy.combineShipping, copy.combineOtherShipping],
  };
  return (
    <FormCard title={copy.combinations}>
      <p className="text-muted-foreground text-sm">{copy.combinationsHint}</p>
      {(["product", "order", "shipping"] as const).map((kind) => (
        <CheckboxRow
          key={kind}
          label={labels[kind][kind === own ? 1 : 0]}
          checked={values.combinesWith[kind]}
          onChange={(event) =>
            set({ combinesWith: { ...values.combinesWith, [kind]: event.target.checked } })
          }
        />
      ))}
    </FormCard>
  );
}

/** "Active dates": start (required) and an optional end, in the store's time zone. */
export function ActiveDatesCard({
  values,
  set,
  errors,
  t,
  zone,
}: CardProps & { readonly zone: string }) {
  const copy = t.discounts.form;
  const errorId = useId();
  return (
    <FormCard title={copy.activeDates}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          type="date"
          label={copy.startDate}
          value={values.startDate}
          onValueChange={(startDate) => set({ startDate })}
          error={errors["startsAt"]}
        />
        <TextField
          type="time"
          label={copy.startTime.replace("{zone}", zone)}
          value={values.startTime}
          onValueChange={(startTime) => set({ startTime })}
        />
      </div>
      <CheckboxRow
        label={copy.setEndDate}
        checked={values.hasEndDate}
        onChange={(event) =>
          set(
            event.target.checked
              ? {
                  hasEndDate: true,
                  endDate: values.endDate === "" ? values.startDate : values.endDate,
                  endTime: values.endTime === "" ? "23:59" : values.endTime,
                }
              : { hasEndDate: false },
          )
        }
      />
      {values.hasEndDate && (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            type="date"
            label={copy.endDate}
            value={values.endDate}
            onValueChange={(endDate) => set({ endDate })}
          />
          <TextField
            type="time"
            label={copy.endTime.replace("{zone}", zone)}
            value={values.endTime}
            onValueChange={(endTime) => set({ endTime })}
          />
        </div>
      )}
      <ErrorText id={errorId} message={errors["endsAt"]} />
    </FormCard>
  );
}
```

- [ ] **Step 7: Typecheck and run the editor tests so far**

Run: `pnpm exec tsc --noEmit` → no errors (fix unused imports the compiler reports).
Run: `pnpm exec vitest run src/components/discounts/editor` → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/admin-web/src/components/discounts/editor
git commit -m "feat(admin-web): discount form cards and the browse picker"
```

---

### Task 7: The discount editor, its pages, Summary/Performance and lifecycle

**Files:**

- Create: `apps/admin-web/src/components/discounts/editor/summary-card.tsx`
- Create: `apps/admin-web/src/components/discounts/editor/discount-lifecycle-actions.tsx`
- Create: `apps/admin-web/src/components/discounts/editor/discount-editor.tsx`, `discount-editor.test.tsx`
- Modify (rewrite): `apps/admin-web/src/app/discounts/new/page.tsx`
- Create: `apps/admin-web/src/app/discounts/[discountId]/page.tsx`

**Interfaces:**

- Consumes: Tasks 1–6.
- Produces: `DiscountEditor({ mode, discount, initialValues, currency, timeZone, zone, t, locale })`; `SummaryCard`, `PerformanceCard`; `DiscountLifecycleActions({ discount, t })`.

- [ ] **Step 1: Write the failing test** — `apps/admin-web/src/components/discounts/editor/discount-editor.test.tsx`

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { DiscountDto } from "@/lib/api/discounts";
import { emptyFormValues, formValuesFromDto } from "@/lib/discounts/form";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { DiscountEditor } from "./discount-editor";

const actions = vi.hoisted(() => ({
  saveDiscountAction: vi.fn(),
  deleteDiscountAction: vi.fn(),
  setDiscountActiveAction: vi.fn(),
  searchDiscountTargetsAction: vi.fn(),
}));
vi.mock("@/app/discounts/actions", () => actions);

const NOW = new Date("2026-10-16T10:30:00.000Z");

const saved: DiscountDto = {
  id: "promo-1",
  type: "amount_off_products",
  method: "code",
  title: "SHOES",
  code: "SHOES",
  status: "active",
  value: { kind: "percentage", amount: 15 },
  appliesTo: { kind: "products", refs: ["p-1"] },
  appliesOncePerOrder: false,
  buys: null,
  gets: null,
  maxUsesPerOrder: null,
  countries: null,
  maxShippingRateMinor: null,
  minimumRequirement: { kind: "none" },
  customerEligibility: { kind: "all" },
  usageLimit: null,
  oncePerCustomer: false,
  combinesWith: { product: false, order: false, shipping: false },
  startsAt: "2026-10-16T10:30:00.000Z",
  endsAt: null,
  usageCount: 7,
};

function renderCreate(
  type: DiscountDto["type"] = "amount_off_order",
  t = en,
  locale: "en" | "ar" = "en",
) {
  return render(
    <DiscountEditor
      mode="create"
      discount={null}
      initialValues={emptyFormValues(type, NOW, "UTC")}
      currency="EGP"
      timeZone="UTC"
      zone="UTC"
      t={t}
      locale={locale}
    />,
  );
}

function renderEdit(dto: DiscountDto = saved) {
  return render(
    <DiscountEditor
      mode="edit"
      discount={dto}
      initialValues={formValuesFromDto(
        dto,
        { products: { "p-1": "Sneaker" }, categories: {}, customers: {}, countries: {} },
        "EGP",
        "UTC",
      )}
      currency="EGP"
      timeZone="UTC"
      zone="UTC"
      t={en}
      locale="en"
    />,
  );
}

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.saveDiscountAction.mockResolvedValue({ status: "idle" });
});

describe("DiscountEditor — create", () => {
  it("lays out Shopify's cards for amount off order, with the method switch", () => {
    renderCreate();

    expect(
      screen.getByRole("heading", { name: en.discounts.types.amount_off_order }),
    ).toBeInTheDocument();
    for (const title of [
      en.discounts.form.value,
      en.discounts.form.minimumRequirements,
      en.discounts.form.eligibility,
      en.discounts.form.maxUses,
      en.discounts.form.combinations,
      en.discounts.form.activeDates,
      en.discounts.summary.title,
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("radio", { name: en.discounts.form.methodAutomatic }));
    expect(screen.getByLabelText(en.discounts.form.title)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: en.discounts.form.maxUses })).toBeNull();
  });

  it("generates a code and follows the form in the Summary", () => {
    renderCreate();

    fireEvent.click(screen.getByRole("button", { name: en.discounts.form.generate }));
    const code = (screen.getByLabelText(en.discounts.form.code) as HTMLInputElement).value;
    expect(code).toMatch(/^[A-Z0-9]{12}$/);

    fireEvent.change(screen.getByLabelText(en.discounts.form.value), { target: { value: "10" } });
    const summary = screen.getByRole("region", { name: en.discounts.summary.title });
    expect(within(summary).getByText(code)).toBeInTheDocument();
    expect(within(summary).getByText("10% off entire order")).toBeInTheDocument();
    expect(within(summary).getByText(en.discounts.summary.noMinimum)).toBeInTheDocument();
  });

  it("shows the type-specific cards", () => {
    renderCreate("buy_x_get_y");
    expect(
      screen.getByRole("heading", { name: en.discounts.form.customerBuys }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: en.discounts.form.customerGets }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: en.discounts.form.minimumRequirements }),
    ).toBeNull();
  });

  it("posts the whole form as one payload", () => {
    const { container } = renderCreate("free_shipping");
    fireEvent.change(screen.getByLabelText(en.discounts.form.code), {
      target: { value: "SHIPFREE" },
    });

    const payload = container.querySelector<HTMLInputElement>('input[name="payload"]');
    expect(JSON.parse(payload!.value)).toMatchObject({ type: "free_shipping", code: "SHIPFREE" });
    expect(container.querySelector('input[name="discountId"]')).toBeNull();
  });

  it("speaks Arabic", () => {
    renderCreate("free_shipping", ar, "ar");
    expect(
      screen.getByRole("heading", { name: ar.discounts.types.free_shipping }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ar.discounts.form.save })).toBeInTheDocument();
  });
});

describe("DiscountEditor — edit", () => {
  it("shows the picked products, the Performance card and the lifecycle actions", () => {
    renderEdit();

    expect(screen.getByText("Sneaker")).toBeInTheDocument();
    expect(screen.getByText("Used 7 times")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.discounts.form.deactivate })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.discounts.form.delete })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: en.discounts.form.methodAutomatic })).toBeDisabled();
  });

  it("offers Activate for a deactivated discount, nothing for an ended one", () => {
    const { unmount } = renderEdit({ ...saved, status: "expired" });
    expect(screen.getByRole("button", { name: en.discounts.form.activate })).toBeInTheDocument();
    unmount();

    renderEdit({ ...saved, status: "expired", endsAt: "2026-10-01T00:00:00.000Z" });
    expect(screen.queryByRole("button", { name: en.discounts.form.activate })).toBeNull();
    expect(screen.queryByRole("button", { name: en.discounts.form.deactivate })).toBeNull();
  });

  it("shows Unsaved changes only after a change, and Discard restores every field", () => {
    const { container } = renderEdit();
    const save = screen.getByRole("button", { name: en.discounts.form.save });
    expect(save).toBeDisabled();
    expect(screen.queryByText(en.discounts.form.unsaved)).toBeNull();

    fireEvent.change(screen.getByLabelText(en.discounts.form.value), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove Sneaker" }));
    expect(screen.getByText(en.discounts.form.unsaved)).toBeInTheDocument();
    expect(save).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: en.discounts.form.discard }));
    expect(screen.queryByText(en.discounts.form.unsaved)).toBeNull();
    expect((screen.getByLabelText(en.discounts.form.value) as HTMLInputElement).value).toBe("15");
    expect(screen.getByText("Sneaker")).toBeInTheDocument();
    expect(container.querySelector<HTMLInputElement>('input[name="discountId"]')?.value).toBe(
      "promo-1",
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/components/discounts/editor/discount-editor.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `apps/admin-web/src/components/discounts/editor/summary-card.tsx`**

```tsx
"use client";

import { useId } from "react";
import { Card, CardContent } from "@platform/ui";
import type { DiscountDto, DiscountInput } from "@/lib/api/discounts";
import { discountSummary, pluralCount } from "@/lib/discounts/summary";
import type { DiscountFormValues } from "@/lib/discounts/form";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { DiscountStatusBadge } from "../discount-status-badge";

/** Shopify's Summary card: the code or title, the type and method, then the details as bullets. */
export function SummaryCard({
  values,
  input,
  status,
  t,
  locale,
  currency,
  timeZone,
}: {
  readonly values: DiscountFormValues;
  readonly input: DiscountInput;
  readonly status: DiscountDto["status"] | null;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly currency: string;
  readonly timeZone: string;
}) {
  const headingId = useId();
  const copy = t.discounts.summary;
  const name =
    values.method === "code"
      ? values.code.trim().toUpperCase() || copy.noCode
      : values.title.trim() || copy.noTitle;
  const lines = discountSummary(input, { t: copy, locale, currency, timeZone });
  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardContent className="flex flex-col gap-3 py-5">
        <h2 id={headingId} className="text-sm font-semibold">
          {copy.title}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{name}</span>
          {status !== null && <DiscountStatusBadge status={status} t={t} />}
        </div>
        <div className="text-muted-foreground text-sm">
          <p>{t.discounts.types[values.type]}</p>
          <p>
            {values.method === "code"
              ? t.discounts.form.methodCode
              : t.discounts.form.methodAutomatic}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{copy.details}</h3>
          <ul className="list-disc ps-5 text-sm">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

/** On a saved discount: how often it has been used. */
export function PerformanceCard({
  usageCount,
  t,
  locale,
}: {
  readonly usageCount: number;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-5">
        <h2 className="text-sm font-semibold">{t.discounts.summary.performance}</h2>
        <p className="text-sm">{pluralCount(t.discounts.summary.usedTimes, usageCount, locale)}</p>
      </CardContent>
    </Card>
  );
}
```

Note: `pluralCount` for English `usedTimes` with count 7 selects `other` → "Used 7 times" (test), with 0 selects `other` in English too ("Used 0 times") — English `Intl.PluralRules` has no `zero` category; that is acceptable.

- [ ] **Step 4: Write `apps/admin-web/src/components/discounts/editor/discount-lifecycle-actions.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { Button } from "@platform/ui";
import { deleteDiscountAction, setDiscountActiveAction } from "@/app/discounts/actions";
import type { DiscountDto } from "@/lib/api/discounts";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * Deactivate / Activate and Delete, each a small form of its own beside the editor's form (never
 * inside it). Activate is offered only for a discount that was deactivated — expired while its end
 * date, if any, has not passed — since activating one that ended by date would change nothing.
 */
export function DiscountLifecycleActions({
  discount,
  t,
  now = new Date(),
}: {
  readonly discount: DiscountDto;
  readonly t: Dictionary;
  readonly now?: Date;
}) {
  const copy = t.discounts.form;
  const [toggleState, toggleAction, toggling] = useActionState(
    setDiscountActiveAction,
    INITIAL_STATE,
  );
  const [deleteState, deleteAction, deleting] = useActionState(deleteDiscountAction, INITIAL_STATE);
  const ended = discount.endsAt !== null && Date.parse(discount.endsAt) <= now.getTime();
  const canDeactivate = discount.status === "active" || discount.status === "scheduled";
  const canActivate = discount.status === "expired" && !ended;
  const error =
    toggleState.status === "error"
      ? toggleState.message
      : deleteState.status === "error"
        ? deleteState.message
        : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(canDeactivate || canActivate) && (
        <form action={toggleAction}>
          <input type="hidden" name="discountId" value={discount.id} />
          <input type="hidden" name="active" value={canActivate ? "true" : "false"} />
          <Button type="submit" variant="outline" size="sm" loading={toggling} disabled={toggling}>
            {canActivate ? copy.activate : copy.deactivate}
          </Button>
        </form>
      )}
      <form
        action={deleteAction}
        onSubmit={(event) => {
          if (!window.confirm(copy.confirmDelete)) event.preventDefault();
        }}
      >
        <input type="hidden" name="discountId" value={discount.id} />
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          loading={deleting}
          disabled={deleting}
        >
          {copy.delete}
        </Button>
      </form>
      {error !== null && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write `apps/admin-web/src/components/discounts/editor/discount-editor.tsx`**

```tsx
"use client";

import { useActionState, useCallback, useMemo, useState } from "react";
import { Button } from "@platform/ui";
import { saveDiscountAction } from "@/app/discounts/actions";
import type { DiscountDto } from "@/lib/api/discounts";
import type { FormState } from "@/lib/api/mutation";
import { toDiscountInput, type DiscountFormValues } from "@/lib/discounts/form";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { BuysGetsCard } from "./buys-gets-card";
import { DiscountLifecycleActions } from "./discount-lifecycle-actions";
import { FreeShippingCard } from "./free-shipping-card";
import { MethodCard } from "./method-card";
import {
  ActiveDatesCard,
  CombinationsCard,
  EligibilityCard,
  MaxUsesCard,
  MinimumCard,
} from "./rules-cards";
import { PerformanceCard, SummaryCard } from "./summary-card";
import { ValueCard } from "./value-card";

const INITIAL_STATE: FormState = { status: "idle" };
const FORM_ID = "discount-editor";

/**
 * Phase 2 Part 2 — Shopify's discount form, for one type. Left: the type card, then the type's own
 * cards, minimum requirements, eligibility, maximum uses (codes only), combinations, active dates.
 * Right: the live Summary and, once saved, Performance. One `<form>` posts the whole form as JSON
 * (`payload`) to `saveDiscountAction`; the save bar says "Unsaved changes" while the form differs
 * from what was loaded, and Discard puts every field back. The page remounts the editor (by `key`)
 * after a save, so what was saved becomes the new starting point.
 */
export function DiscountEditor({
  mode,
  discount,
  initialValues,
  currency,
  timeZone,
  zone,
  t,
  locale,
}: {
  readonly mode: "create" | "edit";
  /** The saved discount; null in create mode. */
  readonly discount: DiscountDto | null;
  readonly initialValues: DiscountFormValues;
  readonly currency: string;
  /** The store's IANA zone; dates are typed in it. */
  readonly timeZone: string;
  /** Its short name for labels ("EET"). */
  readonly zone: string;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const [state, formAction, isPending] = useActionState(saveDiscountAction, INITIAL_STATE);
  const [values, setValues] = useState(initialValues);
  const set = useCallback(
    (patch: Partial<DiscountFormValues>) => setValues((current) => ({ ...current, ...patch })),
    [],
  );
  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(initialValues),
    [values, initialValues],
  );
  const { input } = useMemo(
    () => toDiscountInput(values, currency, timeZone),
    [values, currency, timeZone],
  );
  const errors: Readonly<Record<string, string>> =
    state.status === "error" ? state.fieldErrors : {};
  const copy = t.discounts.form;
  const cardProps = { values, set, errors, t };
  const moneyProps = { currency, locale };
  const amountOff = values.type === "amount_off_products" || values.type === "amount_off_order";

  return (
    <div className="flex flex-col gap-6">
      <form id={FORM_ID} action={formAction}>
        <input type="hidden" name="payload" value={JSON.stringify(values)} />
        {discount !== null && <input type="hidden" name="discountId" value={discount.id} />}
      </form>

      {/* top-16: below the app shell's sticky header, as on the product page. */}
      <div className="bg-background/95 sticky top-16 z-20 flex flex-wrap items-center justify-end gap-3 py-2 backdrop-blur">
        {discount !== null && (
          <div className="me-auto">
            <DiscountLifecycleActions discount={discount} t={t} />
          </div>
        )}
        {state.status === "error" && (
          <p role="alert" className="text-destructive text-sm">
            {state.message}
          </p>
        )}
        {dirty && <span className="text-muted-foreground text-sm">{copy.unsaved}</span>}
        {dirty && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setValues(initialValues)}
            disabled={isPending}
          >
            {copy.discard}
          </Button>
        )}
        <Button
          type="submit"
          form={FORM_ID}
          loading={isPending}
          disabled={isPending || (mode === "edit" && !dirty)}
        >
          {isPending ? copy.saving : copy.save}
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <MethodCard {...cardProps} mode={mode} />
          {amountOff && <ValueCard {...cardProps} {...moneyProps} />}
          {values.type === "buy_x_get_y" && <BuysGetsCard {...cardProps} {...moneyProps} />}
          {values.type === "free_shipping" && <FreeShippingCard {...cardProps} {...moneyProps} />}
          {values.type !== "buy_x_get_y" && <MinimumCard {...cardProps} {...moneyProps} />}
          <EligibilityCard {...cardProps} />
          {values.method === "code" && <MaxUsesCard {...cardProps} />}
          <CombinationsCard {...cardProps} />
          <ActiveDatesCard {...cardProps} zone={zone} />
        </div>
        <div className="flex flex-col gap-6">
          <SummaryCard
            values={values}
            input={input}
            status={discount?.status ?? null}
            t={t}
            locale={locale}
            currency={currency}
            timeZone={timeZone}
          />
          {discount !== null && (
            <PerformanceCard usageCount={discount.usageCount} t={t} locale={locale} />
          )}
        </div>
      </div>
    </div>
  );
}
```

Note: the editor test's `getByLabelText(en.discounts.form.value)` targets the percentage input; `ValueCard` labels it with `<Label htmlFor={valueId}>{copy.value}</Label>` and the card heading is also "Discount value" (a heading, not a label), so the query is unambiguous. If `getByRole("heading", { name: en.discounts.form.value })` and the `<Label>` collide in another query, keep the label and the heading texts as they are — headings are not labels.

- [ ] **Step 6: Run the editor test**

Run: `pnpm exec vitest run src/components/discounts/editor`
Expected: PASS. If the summary's code assertion fails because the code also appears in the code input, it does not: the test scopes to the `region` named "Summary".

- [ ] **Step 7: Write the pages**

`apps/admin-web/src/app/discounts/new/page.tsx`:

```tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { DiscountEditor } from "@/components/discounts/editor/discount-editor";
import { isDiscountType, type DiscountType } from "@/lib/api/discounts";
import { storeSettingsOrDefaults } from "@/lib/api/store-settings";
import { getCurrentUser } from "@/lib/auth/current-user";
import { emptyFormValues } from "@/lib/discounts/form";
import { zoneLabel } from "@/lib/discounts/zoned-time";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface NewDiscountPageProps {
  readonly searchParams: Promise<{ readonly type?: string }>;
}

/** Phase 2 Part 2 — "Create discount" for the type chosen in the dialog (`?type=`). */
export default async function NewDiscountPage({ searchParams }: NewDiscountPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { type: requested } = await searchParams;
  const type: DiscountType = isDiscountType(requested) ? requested : "amount_off_products";
  const settings = await storeSettingsOrDefaults();

  return (
    <AppShell t={t} locale={locale} activeNavId="discounts" user={user}>
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/discounts">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.discounts.form.back}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{t.discounts.form.newTitle}</h1>
        </div>
        <DiscountEditor
          key={type}
          mode="create"
          discount={null}
          initialValues={emptyFormValues(type, new Date(), settings.timezone)}
          currency={settings.currency}
          timeZone={settings.timezone}
          zone={zoneLabel(settings.timezone, locale)}
          t={t}
          locale={locale}
        />
      </div>
    </AppShell>
  );
}
```

`apps/admin-web/src/app/discounts/[discountId]/page.tsx`:

```tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { DiscountStatusBadge } from "@/components/discounts/discount-status-badge";
import { DiscountEditor } from "@/components/discounts/editor/discount-editor";
import { fetchDiscount } from "@/lib/api/discounts";
import { storeSettingsOrDefaults } from "@/lib/api/store-settings";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formValuesFromDto } from "@/lib/discounts/form";
import { resolveTargetLabels } from "@/lib/discounts/target-labels";
import { zoneLabel } from "@/lib/discounts/zoned-time";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface DiscountPageProps {
  readonly params: Promise<{ readonly discountId: string }>;
}

/** Phase 2 Part 2 — one discount (`GET /discounts/:id`) in Shopify's form, with Performance. */
export default async function DiscountPage({ params }: DiscountPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { discountId } = await params;

  const result = await fetchDiscount(discountId);
  if (result.outcome !== "ok") {
    const [icon, message] =
      result.outcome === "unauthorized"
        ? [
            <LockIcon key="i" aria-hidden="true" className="size-5" />,
            t.discounts.form.unauthorized,
          ]
        : result.outcome === "not_found"
          ? [
              <SearchXIcon key="i" aria-hidden="true" className="size-5" />,
              t.discounts.form.notFound,
            ]
          : [
              <AlertTriangleIcon key="i" aria-hidden="true" className="size-5" />,
              t.discounts.form.loadError,
            ];
    return (
      <AppShell t={t} locale={locale} activeNavId="discounts" user={user}>
        <StatePanel icon={icon} message={message} backLabel={t.discounts.form.back} />
      </AppShell>
    );
  }

  const discount = result.discount;
  const [settings, labels] = await Promise.all([
    storeSettingsOrDefaults(),
    resolveTargetLabels(discount, locale),
  ]);

  return (
    <AppShell t={t} locale={locale} activeNavId="discounts" user={user}>
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/discounts">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.discounts.form.back}
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {discount.code ?? discount.title}
            </h1>
            <DiscountStatusBadge status={discount.status} t={t} />
          </div>
        </div>
        <DiscountEditor
          key={JSON.stringify(discount)}
          mode="edit"
          discount={discount}
          initialValues={formValuesFromDto(discount, labels, settings.currency, settings.timezone)}
          currency={settings.currency}
          timeZone={settings.timezone}
          zone={zoneLabel(settings.timezone, locale)}
          t={t}
          locale={locale}
        />
      </div>
    </AppShell>
  );
}

function StatePanel({
  icon,
  message,
  backLabel,
}: {
  readonly icon: ReactNode;
  readonly message: string;
  readonly backLabel: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-12">
      <Card>
        <CardContent className="text-muted-foreground flex flex-col items-center gap-4 px-4 py-12 text-center sm:px-5">
          {icon}
          <p role="note">{message}</p>
          <Button variant="outline" asChild>
            <Link href="/discounts">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 8: Typecheck and test**

Run: `pnpm exec tsc --noEmit` → no errors.
Run: `pnpm exec vitest run src/components/discounts src/app/discounts src/lib/discounts` → PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/admin-web/src/components/discounts/editor apps/admin-web/src/app/discounts
git commit -m "feat(admin-web): shopify-style discount form with summary, save bar and lifecycle"
```

---

### Task 8: Sidebar and the order page's discount codes

**Files:**

- Modify: `apps/admin-web/src/components/navigation.ts`, `navigation.test.tsx`
- Modify: `apps/admin-web/src/lib/api/orders.ts` (`OrderTotalsDto`)
- Modify: `apps/admin-web/src/components/orders/order-payment-card.tsx`, `order-payment-card.test.tsx`

**Interfaces:**

- Consumes: `GET /orders/:id`'s `totals.discounts: { title; code: string | null; discountClass; amountMinor }[]` and `totals.shippingDiscountMinor` (Part 1, `apps/admin/src/http/admin-routes.ts` `OrderTotalsDto`).
- Produces: `OrderDiscountLineDto` in `lib/api/orders.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `navigation.test.tsx`, inside `describe("SidebarNav (Shopify layout)", …)`:

```tsx
it("keeps Promotions out of Discounts and lists it under Platform tools", () => {
  renderNav("discounts");
  expect(screen.queryByRole("link", { name: en.nav.promotions })).toBeNull();

  renderNav("dashboard", { showPlatformTools: true });
  const tools = screen.getByRole("navigation", { name: en.nav.platformTools });
  expect(within(tools).getByRole("link", { name: en.nav.promotions })).toHaveAttribute(
    "href",
    "/promotions",
  );
});
```

Add to `order-payment-card.test.tsx` (inside its top-level `describe`, using the file's own `order()` helper and the existing `fetchPaymentIntent` mock setup — read the file's other tests first and follow how they render the async card, e.g. `render(await OrderPaymentCard({ order: …, t: en, locale: "en" }))`):

```tsx
it("shows each discount with its code, or an automatic discount's title", async () => {
  fetchPaymentIntent.mockResolvedValue({ outcome: "ok", paymentIntent: intent() });
  const base = order();
  render(
    await OrderPaymentCard({
      order: {
        ...base,
        totals: {
          ...base.totals!,
          discountMinor: 2000,
          shippingDiscountMinor: 5000,
          discounts: [
            { title: "SALE10", code: "SALE10", discountClass: "order", amountMinor: 2000 },
            { title: "Free over 500", code: null, discountClass: "shipping", amountMinor: 5000 },
          ],
        },
      },
      t: en,
      locale: "en",
    }),
  );

  const lines = screen.getAllByText(en.orderPage.paymentDiscount);
  expect(lines).toHaveLength(2);
  expect(screen.getByText("SALE10")).toBeInTheDocument();
  expect(screen.getByText("Free over 500")).toBeInTheDocument();
});
```

If `order()`'s default `totals` is `null` in that file, build `totals` explicitly instead of spreading `base.totals!` (subtotal 36000, shipping 5000, tax 0, discount 2000, total 39000 − 5000, currency "EGP").

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/components/navigation.test.tsx src/components/orders/order-payment-card.test.tsx`
Expected: FAIL — Promotions is still a Discounts child; the card shows one discount line without codes (and `OrderTotalsDto` has no `discounts`, a type error under tsc).

- [ ] **Step 3: Move Promotions** — in `navigation.ts`, change the `discounts` entry to have no `children`:

```ts
  { id: "discounts", label: (t) => t.nav.discounts, href: "/discounts", Icon: PercentIcon },
```

and add to `PLATFORM_TOOLS_NAV`, after `notifications`:

```ts
  // Phase 2: the raw promotion rules behind Discounts — an engineering view, not the merchant's.
  { id: "promotions", label: (t) => t.nav.promotions, href: "/promotions", Icon: GiftIcon },
```

- [ ] **Step 4: Type the order's discounts** — in `lib/api/orders.ts`, before `export interface OrderTotalsDto`, add:

```ts
/** Phase 2: one discount an order was placed with; `code` is null for an automatic discount. */
export interface OrderDiscountLineDto {
  readonly title: string;
  readonly code: string | null;
  readonly discountClass: string;
  readonly amountMinor: number;
}
```

and add to `OrderTotalsDto`:

```ts
  /** Phase 2: the free-shipping part of the discounts; absent from an older API, 0 on older orders. */
  readonly shippingDiscountMinor?: number;
  /** Phase 2: each discount the order was placed with; absent from an older API, empty on older orders. */
  readonly discounts?: readonly OrderDiscountLineDto[];
```

- [ ] **Step 5: Show the codes** — in `order-payment-card.tsx`, replace the `{order.totals.discountMinor > 0 && (…)}` block with:

```tsx
{
  (order.totals.discounts ?? []).length > 0
    ? (order.totals.discounts ?? []).map((discount, index) => (
        <Line
          key={`${discount.code ?? discount.title}-${index}`}
          label={t.orderPage.paymentDiscount}
          note={discount.code ?? discount.title}
          value={money(-discount.amountMinor)}
        />
      ))
    : order.totals.discountMinor > 0 && (
        <Line label={t.orderPage.paymentDiscount} value={money(-order.totals.discountMinor)} />
      );
}
```

and extend the component's doc comment's list of lines with: "one Discount line per discount, with its code (or an automatic discount's title) beside it — Shopify's "Discount SALE10"; a shipping discount is its own line, since Shipping shows the rate before it".

- [ ] **Step 6: Run the tests**

Run: `pnpm exec vitest run src/components/navigation.test.tsx src/components/orders`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/components/navigation.ts apps/admin-web/src/components/navigation.test.tsx apps/admin-web/src/lib/api/orders.ts apps/admin-web/src/components/orders/order-payment-card.tsx apps/admin-web/src/components/orders/order-payment-card.test.tsx
git commit -m "feat(admin-web): promotions under platform tools and discount codes on the order page"
```

---

### Task 9: Whole-part verification

- [ ] **Step 1:** From `apps/admin-web`, run the full suite in the background: `pnpm exec vitest run` → all files pass (baseline before this plan: 139 files / 1593 tests, all green).
- [ ] **Step 2:** `pnpm exec tsc --noEmit` → exit 0.
- [ ] **Step 3:** `pnpm exec eslint src/app/discounts src/components/discounts src/lib/discounts src/lib/api/discounts.ts src/components/orders/order-payment-card.tsx src/components/navigation.ts` → no errors.
- [ ] **Step 4:** `grep -rn "discountsPage\|couponCreate\|couponRedeem\|fetchCouponsPage\|CouponCreateForm" apps/admin-web/src` → no output.
- [ ] **Step 5:** Read `git diff origin/main --stat` and confirm only admin-web files and this plan changed (no migration, no apps/admin change).

## After this plan

Part 3 (storefront "Discount code" field on the one-page checkout) has its own plan. The two Part 1 migrations still need to be deployed by the owner before the release that reads them; this part adds none.

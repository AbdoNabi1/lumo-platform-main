# Discounts Part 3 — Storefront Discount Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shopper can type a discount code in the storefront checkout, see it applied (or why not), remove it, and see the discounts in the totals; a "discounts changed" answer when placing the order reloads the summary with a notice.

**Architecture:** `apps/storefront` (Next.js 15). The runtime already has everything (merged in PR #1): `POST /api/v1/public/checkouts/:id/discount-codes` `{ sessionRef, code }` → 200 session DTO, or **422** envelope whose `fields[0].message` is the reason token; `DELETE /api/v1/public/checkouts/:id/discount-codes/:code?sessionRef=…` → 200 session DTO; the session DTO carries `discount: { codes: [{ code, applicable, reason }], applied: [{ title, code, discountClass, amountMinor }] }` and `totals.discountMinor` / `totals.shippingDiscountMinor`; completing answers **409** with message prefix `DISCOUNTS_CHANGED:` when discounts moved (`services/checkout/src/application/complete-checkout.use-case.ts`). Server actions in `app/checkout/actions.ts` are the only callers of `lib/runtime-api.ts`.

**Tech Stack:** Next.js 15 App Router, server actions, React client component `components/checkout-view.tsx`, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-15-shopify-discounts-design.md` — "Applying discounts at checkout → Customer-facing behaviour" and "Storefront (apps/storefront)".

## Global Constraints

- The storefront never sends an amount, a percentage or a customer ref — only the typed code (the runtime re-derives everything). The code is trimmed; the runtime normalises it.
- The guest `sessionRef` is read on the server only (existing `existingSessionRef()` in `app/checkout/actions.ts`); client components never see it.
- Reason tokens shown to the shopper (each needs en + ar copy): `not_found`, `expired`, `not_started`, `minimum_not_met`, `not_eligible`, `usage_limit_reached`, `already_used`, `cannot_combine`, `too_many_codes`, `too_many_attempts`, `no_matching_items` (the calculator also emits it: "None of the items in your cart qualify"); any other/unknown token → a generic "This code can't be used" message.
- Up to 5 codes per checkout (the runtime enforces it via `too_many_codes`; the UI only shows the message).
- Every user-visible string in `src/messages/en.ts` and `src/messages/ar.ts` (Egyptian Arabic like the existing strings), with the existing key-parity test passing. Logical CSS only (`ms-*`, `me-*`, `text-start`, `text-end`).
- Tests: `pnpm --filter storefront test` (one file: `pnpm --filter storefront exec vitest run <file>`), `pnpm --filter storefront typecheck`, `pnpm --filter storefront lint`.
- Conventional Commits, lower-case subject, body lines ≤ 100 chars, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, commit with `git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit`; never `--no-verify`; stage only the task's files.

## Review Focus

1. **A shopper applies a code, then changes address or shipping** and the code stops qualifying: the chip stays, marked "not applicable" with its reason, and no discount line shows. Pinned in Task 2.
2. **Free-shipping code:** the shipping row reads "Free" (and the shipping discount isn't double-counted in the total — the grand total always comes from `totals.grandTotalMinor`). Pinned in Task 2.
3. **Placing the order after a code expired mid-checkout** (409 `DISCOUNTS_CHANGED:`): the summary reloads and a short notice explains; the order is NOT placed and the shopper can press Place order again. Pinned in Tasks 1–2.
4. **Typing the same code twice / empty input / spaces only:** no request for empty; duplicates are the runtime's business (its answer is shown). Pinned in Task 2.
5. **Arabic (RTL)**: chips, × buttons and amounts render correctly with logical CSS; minus sign on discount amounts. Pinned in Task 2.

---

### Task 1: Transport and server actions for discount codes

**Files:**
- Modify: `apps/storefront/src/lib/runtime-api.ts` (types + two functions)
- Modify: `apps/storefront/src/app/checkout/actions.ts` (two actions; `completeCheckout` maps `DISCOUNTS_CHANGED`)
- Test: `apps/storefront/src/app/checkout/actions.test.ts`, and the runtime-api test file if one covers checkout transport (grep `startCheckout` in `src/lib/*.test.ts`)

**Interfaces — Produces:**
```ts
// runtime-api.ts
export interface CheckoutDiscountCodeSummary { readonly code: string; readonly applicable: boolean; readonly reason: string | null }
export interface CheckoutAppliedDiscountSummary { readonly title: string; readonly code: string | null; readonly discountClass: string; readonly amountMinor: number }
export interface CheckoutDiscountSummary { readonly codes: readonly CheckoutDiscountCodeSummary[]; readonly applied: readonly CheckoutAppliedDiscountSummary[] }
// CheckoutTotalsSummary gains: readonly discountMinor?: number; readonly shippingDiscountMinor?: number;
// CheckoutSessionSummary gains: readonly discount?: CheckoutDiscountSummary;   (optional: older APIs)
export function applyCheckoutDiscountCode(checkoutSessionId: string, sessionRef: string, code: string): Promise<{ status: number; body: unknown }>;
export function removeCheckoutDiscountCode(checkoutSessionId: string, sessionRef: string, code: string): Promise<{ status: number; body: unknown }>;
// actions.ts
export type DiscountCodeActionResult =
  | { readonly ok: true; readonly checkoutSessionId: string }
  | { readonly ok: false; readonly reason: "rejected"; readonly rejection: string } // the runtime's token, e.g. "minimum_not_met"
  | { readonly ok: false; readonly reason: "ownership" | "validation" | "unavailable" | "network" };
export async function applyDiscountCode(checkoutSessionId: string, code: string): Promise<DiscountCodeActionResult>;
export async function removeDiscountCode(checkoutSessionId: string, code: string): Promise<CheckoutActionResult>;
// CheckoutActionResult's failure union gains "discounts-changed" (from completeCheckout only).
```
Behaviour:
- `applyCheckoutDiscountCode` POSTs `{ sessionRef, code }` with the same helper/headers the other checkout writes use (read how `selectCheckoutShipping` posts). `removeCheckoutDiscountCode` sends DELETE to `/api/v1/public/checkouts/${encodeURIComponent(id)}/discount-codes/${encodeURIComponent(code)}?sessionRef=${encodeURIComponent(sessionRef)}` — check how other DELETEs/reads pass the session (the `x-cart-session` header is used on reads at line ~910); send BOTH the header and the query param only if the runtime's `resolveSessionRef` reads one of them — read `resolveSessionRef` in `apps/admin/src/http/public-checkout-routes.ts` and send exactly what it accepts.
- `applyDiscountCode`: trim the code; empty → `{ ok:false, reason:"validation" }` without calling the runtime. 422 whose envelope has `fields[0].field === "code"` → `{ ok:false, reason:"rejected", rejection: fields[0].message }`; other 422 → `validation`; other statuses through the existing `mapFailureStatus`; success → `revalidatePath("/checkout")`.
- `completeCheckout`: 409 with message starting `DISCOUNTS_CHANGED:` → `{ ok:false, reason:"discounts-changed" }` and `revalidatePath("/checkout")` (the session totals changed); keep `OUT_OF_STOCK:` handling first-class as today.

- [ ] **Step 1: Failing tests** in `actions.test.ts` (follow its existing mocking of `runtime-api` and cookies): apply ok; apply rejected → rejection token; apply with blank code → validation, runtime not called; apply 404 → ownership; remove ok / 404; complete 409 DISCOUNTS_CHANGED → discounts-changed; complete 409 OUT_OF_STOCK unchanged. Transport tests (if a runtime-api test exists): URL, method, headers/body/query for both functions.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** storefront tests/typecheck/lint — PASS.
- [ ] **Step 5: Commit** — `feat(storefront): discount code actions for checkout`.

---

### Task 2: Discount code field, chips and totals in the checkout summary

**Files:**
- Modify: `apps/storefront/src/components/checkout-view.tsx` (summary area — `SummaryBody`, `ErrorBanner`/error reasons, `placeOrder`)
- Create (if it keeps checkout-view from growing further): `apps/storefront/src/components/checkout-discount-code.tsx`
- Modify: `apps/storefront/src/messages/en.ts`, `apps/storefront/src/messages/ar.ts` (a `checkout.discount` block)
- Test: `apps/storefront/src/components/checkout-view.test.tsx` (+ a test file for the new component if created)

**Interfaces — Consumes:** Task 1 actions and types.

Behaviour (Shopify's order summary):
- Under the line items: a "Discount code" input with an **Apply** button (disabled while empty or pending). On submit call `applyDiscountCode`; on ok clear the input and refresh the session (use the same refresh mechanism the view already uses after other actions — `router.refresh()` or its existing session reload; read the file). On `rejected` show the reason's message under the field (`role="alert"`), keep the typed code. On other failures show the existing error banner reason.
- Applied codes as chips (tag icon + code + × button with an accessible label "Remove code X"); × calls `removeDiscountCode` then refreshes. A code with `applicable: false` shows its chip with a muted style and the note "Not applicable: <reason message>".
- Totals: after Subtotal, one row per `discount.applied` entry with `discountClass !== "shipping"` (the runtime classes are `"product"`, `"order"`, `"shipping"`): label = code (or title for an automatic discount, i.e. `code === null`), value = "−" + formatted amount. Shipping row: when `totals.shippingDiscountMinor > 0` and it covers the whole `totals.shippingMinor`, show "Free" (and optionally the struck-through original); when it covers part, show the shipping minus the discount. Grand total ALWAYS `totals.grandTotalMinor` when totals exist (no client arithmetic with discounts).
- Placing the order: on `discounts-changed` refresh the session and show a notice (`role="status"`): "Your discounts changed — please review the new total before placing your order." The Place order button works again afterwards.
- Copy (en + ar) for: field label/placeholder, Apply, applying…, remove label, not-applicable prefix, each reason token, generic reason, discounts-changed notice, "Free".

- [ ] **Step 1: Failing tests:** (a) applying calls the action with the trimmed code and clears the field on ok; (b) a `minimum_not_met` rejection shows its message; unknown token shows the generic; (c) chips render for codes, × calls remove; (d) a non-applicable code shows the note and no discount line; (e) totals show one discount row per applied product/order discount with a minus sign, shipping "Free" for a full shipping discount, grand total equals `totals.grandTotalMinor`; (f) discounts-changed shows the notice and doesn't navigate to confirmation; (g) Arabic render of the field and a chip.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** storefront tests/typecheck/lint — PASS.
- [ ] **Step 5: Commit** — `feat(storefront): discount code field, chips and discount totals at checkout`.

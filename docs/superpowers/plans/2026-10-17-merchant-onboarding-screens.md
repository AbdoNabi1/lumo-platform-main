# Merchant Self-Serve Onboarding — Admin Screens (Plan 1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merchant can open a store from `/signup`, sign in at `/login`, and inside the dashboard finds a Shopify-style setup guide on Home, Settings → Plan and billing, Settings → Domains, their store name in the top bar and a trial banner.

**Architecture:** `apps/admin-web` (Next.js 15, server components + server actions; the runtime API is only ever called from the server). Plan 1a (on this branch) added the runtime routes these screens use: `/public/merchant-signup`, `/public/auth/merchant/*`, `/store/settings` (+ `setupGuideDismissedAt`), `POST /store/setup-guide/dismiss`, `/store/domains*`, `/store/billing*`. Requests carry the session token; the runtime takes the tenant from the token's `tenant_id` claim.

**Tech Stack:** Next.js 15 App Router, React server components, server actions, `@platform/ui`, vitest + Testing Library, `jose`.

**Spec:** `docs/superpowers/specs/2026-10-16-merchant-self-serve-onboarding-design.md` (§3, §4, §6). Backend plan: `docs/superpowers/plans/2026-10-16-merchant-onboarding-backend.md`.

## Global Constraints

- Server-only API access: never call the runtime from browser code. **Client components must never value-import `lib/api/*` or `lib/auth/*`** (that pulls `next/headers` into the browser bundle and breaks `next build`; vitest/tsc/eslint do not catch it). Put pure types/guards a client component needs in an import-free module (pattern: `lib/discounts/model.ts`).
- Every user-visible string goes in BOTH `src/messages/en.ts` and `src/messages/ar.ts` (Egyptian-Arabic tone like the existing Arabic strings), read through the `Dictionary` — no hard-coded copy in components (the existing bilingual auth pages — `/login`, `/forgot-password`, `/reset-password` — keep their inline "English / عربي" style; new auth pages follow THEIR style).
- Follow Shopify's placement and wording (owner goal): setup guide card at the top of Home; "Plan" and "Domains" rows in the Settings list in Shopify's order (General, Plan, Billing → here one row "Plan and billing", Users later, Payments, Checkout…, Shipping, Taxes, Locations, Domains, Languages).
- Public auth calls to the runtime send `x-tenant-id: <platform tenant>` = `nativeTenantId()` (`lib/auth/native.ts`) — sign-up, merchant login, merchant reset request AND reset complete.
- Writes from server actions mint one idempotency key per submit (`newIdempotencyKey()` from `lib/api/mutation.ts`) and project non-ok outcomes with `toFormState`.
- No secrets or passwords in URLs or logs. Email never in a redirect URL.
- New env vars must be documented in `.env.example`; run `node scripts/ops/check-env-docs.mjs` and introduce no NEW finding (compare with the output at the task's base commit).
- Tests: `pnpm --filter admin-web test` (single file: `pnpm --filter admin-web exec vitest run <file>`), `pnpm --filter admin-web typecheck`, `pnpm --filter admin-web lint`. `next build` fails on this Windows machine at the standalone symlink step (EPERM) — that is environmental; do not chase it, but DO grep that no `"use client"` file imports `lib/api/` or `lib/auth/`.
- Conventional Commits, lower-case subject, body lines ≤ 100 chars, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, commit with `git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit`; never `--no-verify`; stage only the task's files.

## Review Focus

1. **A platform-team member (bootstrapped owner, not in the staff directory) signing in under native auth** must still get in — merchant login first, then the platform staff login. Pinned in Task 2.
2. **A merchant whose session token belongs to store B** must never have a request sent with store A's tenant header, even if `TENANT_DEFAULT_ID` is A. Pinned in Task 1.
3. **Sign-up turned off** (`ADMIN_SIGNUP_ENABLED` unset, or the runtime answering 503): no dead "Create a store" link, and the page explains instead of erroring. Pinned in Task 3.
4. **A store with no billing yet / the runtime unreachable** on Plan and billing, Domains, Home guide: each card degrades to a message, never a crash or a fake number. Pinned in Tasks 5–7.
5. **Arabic (RTL) layout** of every new screen: logical CSS properties only (`ms-*`, `me-*`, `text-start`). Pinned in each UI task's component test (render with the `ar` dictionary).

---

### Task 1: Session tenant and merchant auth client

**Files:**

- Modify: `apps/admin-web/src/lib/auth/session.ts` (`AdminSession.tenantId: string | undefined`, read from the `tenant_id` claim with `readStringClaim`)
- Modify: `apps/admin-web/src/lib/api/client.ts` (`adminRequestHeaders`, `currentTenantRef`)
- Modify: callers of `currentTenantRef` (`lib/api/licensing.ts`)
- Create: `apps/admin-web/src/lib/auth/merchant.ts`
- Test: `lib/api/client.test.ts`, `lib/auth/session.test.ts`, `lib/auth/merchant.test.ts`

**Interfaces — Produces:**

```ts
// session.ts
export interface AdminSession {
  /* existing fields */ readonly tenantId: string | undefined;
}
// client.ts
export async function currentTenantRef(): Promise<string>; // session tenant, else TENANT_DEFAULT_ID
// merchant.ts (pure fetch helpers, `fetchImpl` injectable like exchangePassword)
export type SignupCountry = "EG" | "SA" | "AE";
export type SignupResult =
  | { ok: true; token: string; expiresIn: number }
  | { ok: true; signInRequired: true }
  | {
      ok: false;
      reason: "taken" | "invalid" | "limited" | "unavailable";
      fields?: readonly { field: string; message: string }[];
    };
export function signupEnabled(): boolean; // process.env["ADMIN_SIGNUP_ENABLED"] === "1" or "true"
export async function signUpMerchant(input: {
  runtimeUrl;
  tenantId;
  storeName;
  email;
  password;
  country: SignupCountry;
  fetchImpl?;
}): Promise<SignupResult>;
export async function exchangeMerchantPassword(input: {
  runtimeUrl;
  tenantId;
  email;
  password;
  fetchImpl?;
}): Promise<ExchangeResult>; // same ExchangeResult as native.ts
export async function requestMerchantReset(input: {
  runtimeUrl;
  tenantId;
  email;
  fetchImpl?;
}): Promise<"sent" | "limited" | "unavailable">;
export async function completeMerchantReset(input: {
  runtimeUrl;
  tenantId;
  store;
  token;
  password;
  fetchImpl?;
}): Promise<"done" | "invalid" | "weak" | "limited" | "unavailable">;
```

Mapping: sign-up 201 with `accessToken` → token; 201 with `signInRequired` → signInRequired; 409 → taken; 400/422 → invalid (+ fields from the envelope's `fields`); 429 → limited; anything else (503, network) → unavailable. Login 200 → token; 401 → invalid; 403 `MFA_REQUIRED` → mfa; else unavailable. Reset request 202 → sent; 429 → limited; else unavailable. Reset complete: mirror `completeReset` in `lib/auth/password-reset.ts` (read it), but POST `/api/v1/public/auth/merchant/password-reset/complete` with body `{ store, token, password }`.

- [ ] **Step 1: Failing tests.** `client.test.ts`: with a session whose `tenantId` is `"shop-b"` and `TENANT_DEFAULT_ID="shop-a"`, a `getAdminApi` call sends `x-tenant-id: shop-b`; with no session it sends `shop-a`; `await currentTenantRef()` follows the same rule (mock `readSession` the way the existing client test mocks it). `session.test.ts`: a token with `tenant_id` yields `tenantId`. `merchant.test.ts`: one case per mapping row above, using a fake `fetchImpl` that asserts URL, method, `x-tenant-id` and body.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** `adminRequestHeaders`: `const session = await readSession(); const tenantId = session?.tenantId ?? requireProdEnv("TENANT_DEFAULT_ID", DEFAULT_TENANT_ID);` (read the session once and reuse it for the token). Make `currentTenantRef` async and update `licensing.ts`.
- [ ] **Step 4: Run** admin-web tests + typecheck + lint — PASS. Document `ADMIN_SIGNUP_ENABLED` in `.env.example` (comment: shows the public "Create a store" sign-up; the runtime must also have TENANT_MODE=multi, AUTH_MODE=native and DEFAULT_PLAN_KEY) and run check-env-docs.
- [ ] **Step 5: Commit** — `feat(admin-web): use the session's store for api calls; merchant auth client`.

---

### Task 2: Sign-in and password reset for merchants

**Files:** `apps/admin-web/src/app/auth/native-login/route.ts`, `app/auth/forgot/route.ts`, `app/auth/reset/route.ts`, `app/reset-password/page.tsx`; tests beside them (follow existing route tests if any; otherwise create `*.test.ts` that call `POST` with a built `NextRequest` and mocked `lib/auth/*` helpers).

**Interfaces — Consumes:** Task 1 helpers.

Behaviour:

- **Native login:** call `exchangeMerchantPassword` (platform tenant) first. If it returns `invalid`, call the existing `exchangePassword` (staff login, platform tenant). The first `ok` wins and sets the session cookie exactly as today. `mfa` from either → `error=mfa`. If merchant returns `unavailable` still try staff; only when both fail report the "worse" reason (`unavailable` over `invalid`). Same redirect/cookie code as today — no duplication: extract the cookie-setting into one local function.
- **Forgot:** send BOTH `requestMerchantReset` and the existing `requestReset` (staff) with the platform tenant; `limited` from either → `?error=limited`; else the neutral "sent" redirect as today.
- **Reset page:** read optional `store` from the query; pass it through as a hidden input (and back into the page URL on a retryable error, like `token`).
- **Reset route:** when `store` is present call `completeMerchantReset({ store, token, password })`, else the existing `completeReset`. Same outcomes/redirects as today.

- [ ] **Step 1: Failing tests:** (a) merchant ok → cookie set, staff not called; (b) merchant invalid + staff ok → cookie set (Review Focus 1); (c) both invalid → `/login?error=invalid`; (d) forgot calls both; (e) reset with `store` calls the merchant completion with that store, without → staff completion.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** tests/typecheck/lint — PASS.
- [ ] **Step 5: Commit** — `feat(admin-web): merchants sign in and reset passwords through the store directory`.

---

### Task 3: "Open your store" sign-up page

**Files:**

- Create: `apps/admin-web/src/app/signup/page.tsx`, `app/signup/signup-form.tsx` (client component only if needed for field state; prefer a plain `<form method="post" action="/auth/signup">` server page like the login form), `app/auth/signup/route.ts`
- Modify: `apps/admin-web/src/middleware.ts` (`PUBLIC_PREFIXES` += `/signup`, `/auth/signup`), `app/login/native-login-form.tsx` (a "New to Morbeh? Open your store / جديد على مربح؟ افتح متجرك" link to `/signup`, shown only when `signupEnabled()` — pass it as a prop from the server page)
- Test: `app/signup/page.test.tsx`, `app/auth/signup/route.test.ts`, `middleware.test.ts`

Behaviour:

- `/signup` when `!isNativeAuth() || !signupEnabled()` → `notFound()`.
- Fields: store name (2–60), email, password (min 8, with a "show" toggle only if the login form already has one — otherwise none), country select (Egypt / Saudi Arabia / UAE; default Egypt), submit "Create store / افتح المتجر". Bilingual inline copy in the same style as `/login`. Footer link "Already have a store? Sign in / عندك متجر؟ سجّل دخول".
- `POST /auth/signup`: read the form; client-side-equivalent checks (trimmed name length, email has "@", password ≥ 8, country in the enum) → on failure redirect back to `/signup?error=invalid`; call `signUpMerchant` with `nativeTenantId()`. `ok` with token → set the session cookie (same options as native login) and redirect to `/?welcome=1`; `signInRequired` → `/login?signup=done`; `taken` → `/signup?error=taken`; `limited` → `/signup?error=limited`; `invalid` → `/signup?error=invalid`; `unavailable` → `/signup?error=unavailable`. Never put the email or store name in the URL.
- Errors shown on the page: taken "This email already has a store — sign in instead", limited "Too many attempts, try again later", invalid "Check the highlighted details", unavailable "Opening new stores isn't available right now — try again later" (each with Arabic).
- `/login?signup=done` shows "Your store is ready — sign in / متجرك جاهز — سجّل دخول".
- Home: `?welcome=1` shows a one-line welcome banner above the setup guide ("Welcome to Morbeh — let's set up your store") — implement in Task 7's guide component as an optional prop; here just pass the redirect.

- [ ] **Step 1: Failing tests:** page 404 when disabled; route: each outcome → the right redirect and cookie only on token; invalid form never calls the runtime; middleware lets `/signup` through unauthenticated.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(admin-web): public open-your-store sign-up page`.

---

### Task 4: API clients for domains, billing and the setup guide

**Files:**

- Modify: `apps/admin-web/src/lib/api/store-settings.ts` (`StoreSettingsDto.setupGuideDismissedAt?: string | null` — optional in the guard so older APIs still validate; `dismissSetupGuide(idempotencyKey)` → `POST /api/v1/store/setup-guide/dismiss`)
- Create: `apps/admin-web/src/lib/api/store-domains.ts`, `apps/admin-web/src/lib/api/store-billing.ts`, and import-free model modules `apps/admin-web/src/lib/domains/model.ts`, `apps/admin-web/src/lib/billing/model.ts` (types + pure helpers client components may use)
- Test: `lib/api/store-domains.test.ts`, `lib/api/store-billing.test.ts`, `lib/billing/model.test.ts`, `lib/api/store-settings.test.ts`

**Interfaces — Produces:**

```ts
// lib/domains/model.ts
export interface ShopDomainDto { id: string; shopId: string; hostname: string; kind: "platform" | "custom"; status: "pending" | "verified"; isPrimary: boolean; verifiedAt: string | null }
export function primaryDomain(domains: readonly ShopDomainDto[]): ShopDomainDto | null;
export function platformDomain(domains: readonly ShopDomainDto[]): ShopDomainDto | null;
// lib/api/store-domains.ts
fetchMyDomains(): Promise<{ outcome: "ok"; domains: ShopDomainDto[] } | other ApiResult outcomes>  // GET /api/v1/store/domains — check the actual list shape in apps/admin/src/http/store-domains-routes.ts (items array or bare array) and type it exactly
addMyDomain(hostname, idempotencyKey): Promise<MutationResult<{ id: string }>>
verifyMyDomain(domainId, idempotencyKey), makeMyDomainPrimary(domainId, idempotencyKey): Promise<MutationResult<ShopDomainDto>>
// lib/billing/model.ts  (mirror the runtime's MerchantBillingView / MerchantPlanView exactly — read services/licensing/src/application/merchant-billing.use-cases.ts)
export interface MerchantPlanDto { key; name; planVersionRef; priceMinor; currency; billingCycle: "monthly" | "annual"; trialDays }
export interface MerchantInvoiceDto { id; status; totalMinor; currency; createdAt }
export interface MerchantBillingDto { plan: MerchantPlanDto | null; status: string | null; nextChargeAt: string | null; trialEndsAt: string | null; cardOnFile: boolean; invoices: MerchantInvoiceDto[] }
export function trialDaysLeft(trialEndsAt: string | null, now: Date): number | null; // ceil days, never negative; null when no trial
export function billingBanner(b: MerchantBillingDto, now: Date): "trial-ending" | "past-due" | null; // trial-ending when 0 < daysLeft <= 3; past-due when status is "grace" or "suspended" or "expired"
// lib/api/store-billing.ts
fetchMyBilling(), fetchPublishedPlans() (GET /api/v1/store/billing/plans → { items }), changeMyPlan(planKey, key), payMyInvoice(invoiceId, key): MutationResult<{ checkoutUrl: string }>
```

- [ ] **Step 1: Failing tests:** guards accept the runtime's real shapes (copy one real response shape from the backend tests) and reject malformed ones; `trialDaysLeft` (14 days → 14, 2.5 days → 3, past → 0 then null? — rule: past end → 0; no trial → null); `billingBanner` cases; each client function hits the right path/method with an idempotency key (mock `getAdminApi`/`mutateAdminApi` like sibling tests).
- [ ] **Step 2–4:** RED, implement, GREEN (tests/typecheck/lint).
- [ ] **Step 5: Commit** — `feat(admin-web): api clients for store domains, billing and the setup guide`.

---

### Task 5: Settings → Domains

**Files:** Create `apps/admin-web/src/app/settings/domains/page.tsx`, `app/settings/domains/actions.ts`, `components/settings/domains/*` (list + add form); modify `app/settings/page.tsx` (add the "Domains" row in Shopify's order, icon `GlobeIcon`), messages en/ar. Tests beside the components and actions.

Behaviour (Shopify's Domains page):

- Header "Domains" with a "Connect existing domain" button opening an inline form (hostname input).
- Table: hostname, type ("Morbeh subdomain" / "Custom"), status badge ("Connected" / "Pending"), "Primary" badge; row actions: "Verify" (pending custom), "Make primary" (verified, not primary). Platform subdomain row has a copy-link button (client component; copies `https://<hostname>`).
- Setup instructions card for a pending custom domain: "Add a CNAME record for `<hostname>` pointing to `<platform subdomain hostname>`, then press Verify. DNS can take up to 48 hours." (use the platform domain from the list; if none, say "your Morbeh address").
- Server actions: add / verify / make primary → `revalidatePath("/settings/domains")`; outcomes via `toFormState` (409 conflict → "This domain is already connected to a store").
- Unauthorized/error → the page's standard error state (follow `app/settings/general/page.tsx`).
- [ ] **Steps:** failing component/action tests (empty list, pending custom shows instructions + Verify, Arabic render), implement, GREEN, commit — `feat(admin-web): settings domains page`.

---

### Task 6: Settings → Plan and billing

**Files:** Create `app/settings/billing/page.tsx`, `app/settings/billing/actions.ts`, `components/settings/billing/*`; modify `app/settings/page.tsx` (row "Plan and billing", icon `CreditCardIcon`/`ReceiptIcon` distinct from Payments, placed right after General), messages en/ar. Tests beside.

Behaviour (Shopify's Plan + Billing):

- **Plan card:** plan name, price formatted with the existing money formatter (`lib/format.ts`) `/month` or `/year`; status line: trial → "Free trial — N days left (ends <date>)", active → "Next charge on <date>", grace/suspended → "Payment overdue — pay your latest invoice to keep your store running" (destructive tone), no subscription → "No plan yet". "Change plan" button → plan picker (list from `fetchPublishedPlans`, current marked) → `changeMyPlanAction(planKey)`.
- **Payment method card:** cardOnFile → "Card saved for renewals"; else "No card yet. Your first invoice will be issued when your trial ends; paying it saves your card for renewals."
- **Bills table:** date, total (money), status badge; issued → "Pay now" button → server action `payMyInvoiceAction(invoiceId)` → on ok `redirect(checkoutUrl)` (only to an `https:` URL — validate before redirecting); 404 → "This invoice is no longer available".
- Billing fetch failure → standard error state with "Try again".
- [ ] **Steps:** failing tests (trial state text with days left, overdue state, no-subscription state, pay action redirects only to https and refuses `javascript:`/`http:`, Arabic render), implement, GREEN, commit — `feat(admin-web): settings plan and billing page`.

---

### Task 7: Home setup guide

**Files:** Create `components/dashboard/setup-guide.tsx` (+ test), `lib/dashboard/setup-guide.ts` (pure step model + test), `app/actions.ts` gains `dismissSetupGuideAction` (or a new `app/setup-guide-actions.ts`); modify `app/page.tsx`, `components/dashboard/home-view.tsx` (render the guide above the KPIs), messages en/ar.

**Interfaces — Produces:**

```ts
export type SetupStepId = "product" | "shipping" | "payments" | "theme" | "domain" | "order";
export interface SetupStep {
  id: SetupStepId;
  done: boolean | null;
  href: string;
} // null = not tracked (theme)
export function buildSetupSteps(facts: {
  productCount: number | null;
  shippingZoneCount: number | null;
  enabledPaymentMethods: number | null;
  hasVerifiedCustomDomain: boolean | null;
  orderCount: number | null;
}): SetupStep[];
export function setupGuideVisible(
  steps: SetupStep[],
  dismissedAt: string | null | undefined,
): boolean; // false when dismissed, or every tracked step done
```

Steps in Shopify's order with hrefs: Add your first product `/products/new` (check the real new-product route) · Set up shipping `/settings/shipping` · Choose payment methods `/settings/payments` · Customize your store `/theme` (untracked, never a checkmark) · Connect a domain `/settings/domains` · Place a test order `/orders` (check route). A fact that failed to load is `null` → step shown as not done (never hides the guide by error).

- Facts are fetched on the server in `app/page.tsx` in parallel (`Promise.all`) from existing clients: products page `first: 1` (use its total/has-items signal — read `fetchProductsPage`), `fetchShippingZones`, `fetchPaymentSettings` (enabled methods), `fetchMyDomains` (custom + verified), `fetchRecentOrders(1)`, `fetchStoreSettings` (dismissedAt). Wrap in its own Suspense boundary so Home's KPIs don't wait on it.
- Card: title "Set up your store", progress "N of 5 tasks complete" (tracked steps only), expandable rows with check icons, "Dismiss" (×) → server action → `revalidatePath("/")`. Welcome line when `?welcome=1` (from Task 3).
- [ ] **Steps:** failing tests (model: all facts → visible states, null facts, dismissed hides, all done hides; component: progress text, Arabic render, dismiss form posts), implement, GREEN, commit — `feat(admin-web): shopify-style setup guide on home`.

---

### Task 8: Store name, View store link and trial banner in the shell

**Files:** Modify `components/app-shell.tsx`, `components/sidebar-nav.tsx` / `components/global-search.tsx` (only if needed to take a resolved store URL), `lib/auth/current-user.ts` or a new server helper `lib/shell/store-context.ts`; create `components/trial-banner.tsx` (+ tests); messages en/ar.

Behaviour:

- A server helper `getStoreContext(): Promise<{ storeName: string | null; storeUrl: string | null; banner: "trial-ending" | "past-due" | null; trialDaysLeft: number | null }>` reads store settings, my domains (primary → `https://<hostname>`) and my billing in parallel; any failure → that field null (the shell never fails because of it). Memoise per request with React `cache()`.
- `AppShell` gains an optional `store` prop; pages keep compiling without it. To avoid editing every page, call `getStoreContext()` inside `AppShell` itself if it is (or can be made) an async server component — check whether `AppShell` is rendered inside any client component first; if it is, fall back to fetching in the pages that matter (Home, Settings) and say so in the report.
- Top bar: show `storeName` when non-empty instead of the brand text (`t.brand` stays as fallback). View-store links use `storeUrl ?? STOREFRONT_URL` (existing behaviour as fallback).
- Banner across the top of the content area: trial-ending → "Your free trial ends in N days — choose a plan" linking to `/settings/billing`; past-due → "Your payment is overdue — pay now to keep your store open" (destructive). Hidden otherwise.
- [ ] **Steps:** failing tests (banner states, store name fallback, store URL fallback, helper swallows a failed fetch), implement, GREEN, commit — `feat(admin-web): store name, store link and trial banner in the admin shell`.

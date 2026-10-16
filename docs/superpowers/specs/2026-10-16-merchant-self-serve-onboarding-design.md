# Merchant Self-Serve Onboarding — Design Spec

**Status:** Decided by Claude on the owner's behalf (owner instruction, 2026-10-16: "نفذ وخد القرارات مكاني ما يخدم مصلحة المنصة"). Every decision below marked **Decision** is Claude's call and is listed again at the end for the owner to check.
**Project:** 1 of 9 in `reports/shopify-features-for-morbeh.md` (outside the repo) — P0 item 1, "فتح متجر بنفسه".

> **ملخص للمالك:** التاجر يدخل صفحة "افتح متجرك" يكتب اسم المتجر وإيميله وكلمة سر ودولته → المنصة تعمل له متجر كامل (صلاحيات، إعدادات بعملة بلده، دومين مجاني `اسم-المتجر.<دومين المنصة>`، وتجربة مجانية 14 يوم) → يدخل لوحة التحكم على طول ويلاقي "خطوات تجهيز متجرك". تسجيل الدخول بالإيميل وكلمة السر بس، والمنصة بتعرف متجره من الإيميل. لوحة التاجر بقت بتاخد المتجر من حساب الداخل مش من إعداد ثابت. وقبل تشغيل وضع "متاجر متعددة" على السيرفر بنكتب اختبارات تتأكد إن مفيش متجر يقدر يشوف بيانات متجر تاني.

---

## Why

No merchant can join Morbeh today: the merchant dashboard (`apps/admin-web`) serves one fixed store (`TENANT_DEFAULT_ID`), and nothing lets a merchant create a store. Every other gap in the Shopify review is worth nothing until a merchant can sign up, so this is first.

## What already exists (and is reused, not rebuilt)

- **Tenancy** (`services/tenancy`): `CreateTenant`, `ActivateTenant`, suspend/cancel/rebrand, workspaces, store settings (name, currency, time zone, weight unit), shop domains (`AddCustomDomain`, `VerifyDomain`, `SetPrimaryDomain`, `ResolveHost`; `PLATFORM_STORE_DOMAIN`, `STOREFRONT_CNAME_TARGET`).
- **Provisioning** (`apps/admin/src/tenant-provisioning.ts`, `TenantProvisioner`): idempotent security baseline + owner principal + owner admin role + enforcement grant, completeness read from stored state.
- **Staff sign-in** (`StaffAuthAdminController`, `/public/auth/staff/login`): native password → session → role keys → JWT, tenant-scoped; `staff-owner-bootstrap.ts` creates the first owner from env.
- **Per-request tenant resolution** (`packages/http/src/tenant-resolution.ts`): verified `tenant_id` claim first, then the header; `TENANT_MODE=multi` exists but **must not be enabled until the adversarial isolation suite (T10.5) exists** (`apps/runtime/src/composition.ts`).
- **Licensing** (`services/licensing`): plans with versions, `StartTrial` (one per tenant), `ActivateSubscription`, renewal billing, dunning, invoices, credits, card enrolment, usage counters, merchant capabilities; **platform billing through Paymob** (`/platform-billing/paymob/*`).
- **Storefront** resolves the shop from the request host (`apps/storefront/src/lib/shop-host.ts`).

**Decision:** the unmerged `licensing-billing` branch (Stripe card-on-file, M2-3) is NOT revived. Paymob — already on `main` — is the merchant billing rail for an Egypt-first platform.

## Goals

1. A merchant creates a working store from a public sign-up page with no operator involvement.
2. A merchant signs in with email + password; the platform finds their store.
3. The merchant dashboard serves whichever store the signed-in merchant owns.
4. The new store starts on a free trial with a platform subdomain, and the dashboard guides the merchant through setup.
5. The merchant can see their plan, trial days left and invoices, add a card (Paymob), and manage domains.
6. Turning on multi-store mode is proven safe by an isolation test suite.

## Non-goals (later projects)

Staff invitations and multiple staff per store (project 9), store switcher for one email owning several stores, theme editor (project 4), email/WhatsApp notification templates (project 8 — sign-up sends no welcome email yet), CAPTCHA, plan comparison/upgrade marketing pages, custom-domain SSL automation beyond what the existing domain flow does.

## Anti-goals

- A store must never read or write another store's data — no shortcut that lets the header override a verified token's tenant.
- Sign-up must never leave a half-created store that blocks the same email from retrying.
- No client-supplied tenant, price, or plan amount is trusted.

---

## Design

### 1. Staff directory (email → store)

**Decision:** a platform-level table `tenancy.staff_directory` (`email` normalised lower-case + trimmed, `tenant_id`, `role` = `owner`, `created_at`), unique on `email` — **one store per email** for now (Shopify-style multi-store per email is a non-goal). Rows live in the PLATFORM tenant scope (the same scope tenancy's own routes are pinned to). Written at sign-up; read at sign-in. Project 9 adds invited staff rows.

Hand-written additive migration; the owner deploys it.

### 2. Public merchant sign-up — `POST /public/merchant-signup`

Platform-scoped public route (tenant = platform tenant, like `/public/domains/resolve`).

Body (strict): `{ storeName, email, password, country }` with `country ∈ {EG, SA, AE}`.

- `storeName` 2–60 chars; `password` ≥ 8 chars (same rule as the staff password provider — reuse it); `email` valid.

**Decision — the orchestration (a `MerchantSignup` application service in `apps/admin`, idempotent per email):**

1. If the email is already in the directory and that store's sign-up is complete → `409 EMAIL_TAKEN` (same answer whether or not the password matches; no enumeration beyond "taken", which a sign-up form cannot avoid).
2. Derive the store slug from `storeName` (ASCII lower-case, digits, `-`; Arabic names transliterate to `store-<6 random base36>`), unique among tenants; append `-2`, `-3`… on collision.
3. `CreateTenant` (name = storeName, slug) → `ActivateTenant`.
4. Write the directory row **before** provisioning, marked `pending`; a retry with the same email resumes the same tenant instead of creating a second one.
5. `TenantProvisioner.provision(tenantId, { owner: email })`.
6. Create the owner's password credential in the new tenant (the same provider `staff-owner-bootstrap.ts` uses).
7. Store settings: name = storeName; **currency by country (EG→EGP, SA→SAR, AE→AED)**; **time zone (EG→Africa/Cairo, SA→Asia/Riyadh, AE→Asia/Dubai)**; weight unit kg.
8. Platform subdomain `<slug>.<PLATFORM_STORE_DOMAIN>` added, verified and primary (skipped with a recorded warning when `PLATFORM_STORE_DOMAIN` is unset).
9. `StartTrial` on the platform's **default plan**. **Decision: 14-day trial** (Salla/Zid/YouCan norm in the region; Shopify's 3-day trial is too short for a market where merchants set up slowly). The default plan is the published plan flagged `isDefault` (new boolean on plans, additive); if none exists sign-up fails closed with `503 NO_DEFAULT_PLAN` and an operator log line.
10. Mark the directory row `active`; sign the merchant in (same token issuance as staff login) and return `{ tenantId, storeUrl, adminRedirect }`.

Rate limit: per IP and per email (Redis, same helper as the signup/login routes). **Decision:** 5 sign-ups per IP per hour, 3 per email per hour.

### 3. Merchant sign-in — `POST /public/auth/merchant/login`

Platform-scoped. Body `{ email, password }`. Looks the email up in the directory and runs the existing tenant-scoped staff login for that tenant. Unknown email and wrong password give the **same** `401 INVALID_CREDENTIALS` after the same work-factor delay. The token carries `tenant_id` (it already does for staff tokens). The existing tenant-scoped `/public/auth/staff/login` stays for the platform team and single-store deployments.

Password reset: `POST /public/auth/merchant/password-reset/request` resolves the tenant from the directory and delegates to the existing staff reset flow (always `202`, no enumeration).

### 4. Merchant dashboard reads the store from the session

`apps/admin-web/src/lib/api/client.ts` stops sending the env tenant when a session exists: the `x-tenant-id` header is the verified session token's `tenant_id` claim (already verified by `middleware.ts`). `TENANT_DEFAULT_ID` remains the fallback only when no session claim exists (single-store deployments, public pages). `currentTenantRef()` follows the same rule. The runtime already prefers the verified claim over the header, so a forged header cannot cross tenants.

### 5. Isolation suite (T10.5) — the gate for `TENANT_MODE=multi`

An adversarial test suite in `apps/admin` that wires the real admin in-memory with two provisioned tenants and proves, per route family (catalog, orders, customers, checkout, discounts, settings, domains, licensing, media, reviews): tenant B's token cannot read, list, update or delete tenant A's records; a B token with an `x-tenant-id: A` header resolves to B; a public route with a forged shop header cannot touch another shop. The suite is required in CI. Once it is green, the runbook documents how the owner enables `TENANT_MODE=multi` (the agent never flips production config).

### 6. Screens (apps/admin-web)

- **`/signup`** (public): store name, email, password, country; Arabic/English; field errors; "Already have a store? Sign in". On success → dashboard Home.
- **`/login`**: email + password through the merchant login (keeps the existing Ory/native switch for the platform team).
- **Home → "Set up your store" card** (Shopify's setup guide), hidden once all steps are done or dismissed: add your first product · set up shipping · choose payment methods · customize your store (links to Theme for now) · connect a domain · place a test order. Each step's done-state is read from existing APIs (product count, shipping zones, enabled payment methods, theme changed from default, custom domain verified, any order). Dismissal stored in store settings (additive field).
- **Settings → Plan and billing**: plan name, status (trial with days left / active / past due), next charge date and amount, invoices list, "Add card" through the existing Paymob card enrolment, "Choose plan" listing published plans (activation through `ActivateSubscription`; charging stays with the existing renewal/dunning flow).
- **Settings → Domains**: the platform subdomain (copy link), custom domains with status, "Connect domain" with the CNAME/A instructions from `STOREFRONT_CNAME_TARGET`, Verify, Make primary.
- Top bar shows the **store name** (from store settings) instead of the brand, and the sidebar's View-store link uses the store's primary domain.
- Trial banner across the dashboard during the last 3 days of the trial and when billing is past due.

### 7. Data and migrations (owner deploys, additive only)

- `tenancy.staff_directory` (new table, unique email, index on tenant_id).
- `licensing.plans.is_default boolean NOT NULL DEFAULT false`.
- `tenancy` store settings: `setup_guide_dismissed_at timestamptz NULL`.

### 8. Testing

Unit tests for slug derivation, currency/time-zone mapping, sign-up resume after each failing step, sign-in non-enumeration; route tests for sign-up/sign-in/reset through the real in-memory `wireAdmin`; the isolation suite (§5); admin-web component tests for every new screen and the session-tenant client rule.

---

## Decisions Claude made on the owner's behalf (please check)

1. Paymob, not the unmerged Stripe `licensing-billing` branch, is the merchant billing rail.
2. One store per email for now; sign-in finds the store from the email.
3. Countries at launch: Egypt, Saudi Arabia, UAE — with their currency and time zone.
4. 14-day free trial on the platform's default plan; no default plan ⇒ sign-up refuses (never a free unlimited store).
5. Arabic store names get a generated slug `store-xxxxxx` (merchants can change the domain later).
6. Rate limits: 5 sign-ups/IP/hour, 3/email/hour; no CAPTCHA yet.
7. No welcome email until the notifications project.
8. Multi-store mode is enabled by the owner only after the isolation suite passes; the agent documents the switch but never flips it.

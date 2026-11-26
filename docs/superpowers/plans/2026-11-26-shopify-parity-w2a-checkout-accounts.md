# Shopify parity — Wave 2a: Settings > Checkout and Settings > Customer accounts

`OPUS: AGREED (self-review below) · reviewer: Opus (owner ruling 2026-11-24)`

**Branch:** `morbeh/shopify-parity-w2a` from origin/main after Wave 1f merges (worktree `F:/New folder/morbeh-shopify-parity-w1b`).
**Evidence:** `docs/superpowers/plans/w2/survey-settings.md` §1, §2, §7 (file:line). Shopify reference: `C:/Users/Abdo/Documents/shopify-audit/Shopify_Audit_My_Store_2.md` (U082-U084, rows 14-17).

**Decisions (defaults taken; owner may reverse):**

- D32 Only settings Morbeh can honour end to end ship. Not in 2a (survey §1.5, §2.5): first/last name split, company name, checkout configurations/editor, checkout rules, phone-or-email contact, tipping, abandoned-checkout emails (after Notifications, 2b), store credit, customer order actions, social/passwordless sign-in.
- D33 Every default equals today's live behaviour, so a shop with no settings row behaves exactly as now: name required, shipping phone required, address line 2 optional, marketing prompt hidden, no add-to-cart limit, login not required, customer accounts optional, account link shown.
- D34 Every switch is enforced on the SERVER (routes/use cases), not only in the storefront page. A storefront-only rule would be a placebo.
- D35 Marketing opt-in at checkout is never pre-ticked by default ("show" = unticked box). "Preselect" is offered with a warning that it may not be legal in every country.
- D36 Phone cannot be "hidden" (Egyptian couriers need it); choices are required / optional.
- D37 Turning customer accounts OFF: sign-up, sign-in and the account link stop; guest checkout keeps working; customers already signed in keep their session until it expires; "require login" cannot be on while accounts are off (refused with a message).

**Implementers:** Task 1 sonnet (backend, checkpoints A/B/C), Task 2 sonnet (admin-web), Task 3 sonnet (storefront). Global constraints G1-G9 of Wave 1e apply (git rules, one migration, tenant from context, zod structure + use-case semantics, brand lock, en/ar, Dialog/revalidation rules, no `@/lib/api` value import in client files, pnpm prefix). Migration name must sort after `20261127000000_mfa_last_used_step`.

---

### Task 1 — backend (sonnet; checkpoints A → B → C)

**A. Settings model + routes.** Migration `20261128000000_checkout_settings` (hand-written, additive, RLS ENABLE+FORCE+tenant_isolation like `customer_tags`):

```sql
CREATE TABLE "checkout"."checkout_settings" (
  "tenant_id" TEXT NOT NULL PRIMARY KEY,
  "name_mode" TEXT NOT NULL DEFAULT 'required' CHECK ("name_mode" IN ('required','optional')),
  "phone_mode" TEXT NOT NULL DEFAULT 'required' CHECK ("phone_mode" IN ('required','optional')),
  "line2_mode" TEXT NOT NULL DEFAULT 'optional' CHECK ("line2_mode" IN ('hidden','optional','required')),
  "marketing_email_prompt" TEXT NOT NULL DEFAULT 'hidden' CHECK ("marketing_email_prompt" IN ('hidden','show','preselect')),
  "cart_line_limit" INTEGER CHECK ("cart_line_limit" IS NULL OR "cart_line_limit" BETWEEN 1 AND 999),
  "require_login" BOOLEAN NOT NULL DEFAULT false,
  "accounts_mode" TEXT NOT NULL DEFAULT 'optional' CHECK ("accounts_mode" IN ('optional','disabled')),
  "show_account_link" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "checkout_settings_login_needs_accounts" CHECK (NOT ("require_login" AND "accounts_mode" = 'disabled')));
ALTER TABLE "checkout"."checkout_sessions" ADD COLUMN "marketing_opt_in" BOOLEAN;
```

Prisma model `CheckoutSettings` + field `CheckoutSession.marketingOptIn Boolean?`; consistency describe `checkout settings (20261128000000)`.
Domain `services/checkout/src/domain/checkout-settings.ts`: `CheckoutSettingsValues` (camelCase of the columns), `DEFAULT_CHECKOUT_SETTINGS` (D33), `validateCheckoutSettings(input)` → ONE `ValidationError` with field names (incl. `requireLogin` "Customer accounts must be on to require login"). Repository port + Prisma (writes need the UoW tx; reads `runReadScoped`; missing row ⇒ defaults) + in-memory twin. Use cases `GetCheckoutSettings`, `UpdateCheckoutSettings { tenantId; expectedVersion: number | null /* null when no row yet */; values }` (stale → CONFLICT "These settings were changed by someone else"). Routes (new `apps/admin/src/http/checkout-settings-routes.ts`): `GET /checkout/settings` (`settings:read`), `POST /checkout/settings` (`settings:update`, idempotent, body `.strict()` all fields + `expectedVersion`), public `GET /public/checkout-settings` (`checkout:read`, `public: true`) returning only `{ nameMode, phoneMode, line2Mode, marketingEmailPrompt, cartLineLimit, requireLogin, accountsMode, showAccountLink }`.

**B. Enforcement (defaults = today).**

- Shipping address (`POST /public/checkouts/:id/shipping-address` and the domain/use case behind it): name missing while `nameMode=required` → 422 field `name`; phone missing while `phoneMode=required` → 422 `phone`; `line2Mode=required` and empty → 422 `line2`; `hidden` → any line2 sent is dropped. `complete` re-checks the stored shipping address against the CURRENT settings (a setting changed mid-checkout) → 422 with the same fields.
- Cart limit: when set, `public-cart-routes` add/change and checkout item loading reject a line quantity above the limit → 422 `{ field: "quantity", message: "You can add up to <n> of this item" }`; checkout start re-checks.
- Require login: when on, checkout create / complete by a non-customer (guest) principal → 403 `{ code: "LOGIN_REQUIRED", message: "Sign in to check out" }`.
- Accounts disabled: `public-auth-routes` register, signup (request + complete) and login → 403 `{ code: "ACCOUNTS_DISABLED", message: "Customer accounts are turned off for this store" }`; logout, refresh, me keep working; claim-cart keeps working; guest checkout unaffected.
  Tests: for every rule both the default (today's behaviour unchanged — existing e2e suites stay green) and the switched value; a stale-settings mid-checkout case; customer cart over the limit; guest blocked when require-login; accounts-disabled refusals and guest checkout still completing.

**C. Marketing opt-in at checkout.** `POST /public/checkouts/:id/contact` accepts optional `marketingOptIn: boolean`, stored on the session only when `marketingEmailPrompt !== "hidden"` (else ignored). On successful `complete`, when `marketingOptIn === true` and the order's customer resolves to an identity customer, write a consent record through a NEW identity use case `RecordShopperMarketingConsent { tenantId; customerId; granted: true; source: "checkout"; checkoutId }` (separate from the staff `ChangeMarketingConsent`; the record's source/actor says shopper/checkout). Guest without a resolvable customer → no record, logged at info. Never written when the box was not ticked. Failure to record consent never fails the order (logged warn). Tests: ticked → record with source checkout; unticked → none; prompt hidden → field ignored; guest → none.

**Commands:** prisma validate + generate (as 1e); `--filter @platform/db exec vitest run schema-migration-consistency`; `--filter @platform/checkout exec vitest run`; `--filter @platform/cart exec vitest run`; `--filter @platform/identity exec vitest run`; `--filter @platform/admin exec vitest run checkout cart public-auth guest-checkout stock-reservation admin-http.e2e`; tsc for checkout, cart, identity, admin; `arch`; tenant scanner. (Use the real package names from each package.json; report them.)

### Task 2 — admin-web (sonnet, UI-only)

`/settings/checkout` and `/settings/customer-accounts` inside `SettingsFrame` (clone `app/settings/payments` structure): grouped sections like Shopify (Customer contact → Customer information → Marketing options → Advanced: add-to-cart limit; and for accounts: Sign-in links + Accounts on/off), radio groups with one-line explanations, the D35 warning under "Preselect", the D37 rule shown inline (require-login disabled while accounts are off, with the reason), Save with `expectedVersion` (409 → reload message), unsaved-changes guard if the payments page has one. Client `lib/api/checkout-settings.ts`. Flip `checkout` and `customer-accounts` to `available: true` in `settings-nav.tsx`; update `settings-nav.test.tsx` and `[section]/page.test.tsx` oracles. en + ar. Tests: render defaults, change + save payload, 409/422 mapping, accounts-off disables require-login, viewer/operator can't reach (middleware `/settings` admin), revalidation.
Commands: `--filter admin-web exec vitest run settings route-contract i18n middleware client --maxWorkers=2 --minWorkers=1`; tsc.

### Task 3 — storefront (sonnet; live money path)

`apps/storefront`: the checkout page fetches `/public/checkout-settings` UNCACHED (no 60 s shell cache) and `checkout-view.tsx` renders name/phone/line2 per mode (required marks, hidden line2), the marketing checkbox per prompt (unticked unless `preselect`) sent with the contact step, maps server 422 fields to the inputs, `LOGIN_REQUIRED` → "Sign in to check out" with links to login/register (hidden when accounts disabled can't happen by D37); cart quantity steppers cap at `cartLineLimit` and show the server message; `site-header.tsx` hides the account icon when `showAccountLink` is false or accounts are disabled; `/account/login`, `/account/register`, `/account/signup/complete` show "Customer accounts are turned off for this store" on `ACCOUNTS_DISABLED`. en + ar. Keep every existing checkout test green; add tests per mode and an e2e-style test that default settings produce today's form exactly.
Commands: `--filter storefront exec vitest run checkout cart account header --maxWorkers=2 --minWorkers=1` (use the real package name); tsc.

---

## Opus self-review (round 1)

- Money path: defaults equal today (D33) and existing checkout/cart e2e suites must stay green; server enforcement means a stale storefront can't bypass rules; settings read uncached at checkout.
- Legal: opt-in never pre-ticked by default; consent records keep shopper vs staff source distinct (survey §1.3).
- Accounts off can't strand checkout: guest path untouched; require-login + accounts-off impossible (DB CHECK + domain validation + UI).
- Only honest features ship (D32); the rest is listed, not hidden.
  VERDICT: AGREED.

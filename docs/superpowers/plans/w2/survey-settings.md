# Wave 2 survey: the six Settings pages still marked "Soon"

Read-only survey. Worktree `F:/New folder/morbeh-shopify-parity-w1b`, branch `morbeh/shopify-parity-w1f` (main + wave 1f). Nothing was edited except this file. No DB, no tests, no installs.

Pages in scope: **Checkout, Customer accounts, Notifications, Customer privacy, Customer events, Custom data (metafields).** Markets and Apps are wave 5 and are not covered.

## 0. How to read this

- Paths are relative to the worktree root. `file:N` is exact (read in this session). `file:~N` is approximate. **NOT FOUND** means I searched and the thing does not exist.
- Sources for "what Shopify has":
  - **[audit]** = `C:/Users/Abdo/Documents/shopify-audit/Shopify_Audit_My_Store_2.md` (section 1-ج, section 2 rows 14-17/28/31/47/56, section 4 links).
  - **[notes]** = `C:/Users/Abdo/Documents/shopify-audit/screenshot_notes_U001-U110.md` (per-screenshot notes; the only place that lists the Checkout fields, U082/U083, and Customer accounts, U084).
  - **[web]** = a web search of help.shopify.com done in this survey. The audit says Cloudflare blocked its own re-check, and `web_extract` is not configured here, so [web] items are search snippets only. Re-check them before an implementer relies on them.
  - **[general]** = my general knowledge of Shopify. Unverified. Do not build on it without confirming.
- **The audit is thin for four of the six pages.** It never opened Customer accounts' sub-pages, Notifications' four sub-pages, or Customer privacy (screenshot U096 is a duplicate of Languages, audit section 3 item 1). Customer events and Custom data were empty stores. Where the audit has nothing, that is stated below rather than guessed.
- Conventions already in the repo that every sub-wave inherits (verified):
  - The six items are `available:false` in `apps/admin-web/src/components/settings/settings-nav.tsx` (checkout :36-41, customer-accounts :42-47, customer-events :69-74, notifications :75-80, custom-data :81-86, customer-privacy :88-93).
  - Unavailable ids fall through to the coming-soon page `apps/admin-web/src/app/settings/[section]/page.tsx:17-24` (renders `t.settingsNav.comingSoon` at :38). A static route such as `app/settings/checkout/page.tsx` takes precedence over the dynamic one. Flipping `available` to `true` also needs `settings-nav.test.tsx` and `[section]/page.test.tsx` updated (the latter currently renders `section: "checkout"` as coming-soon, lines ~20-30).
  - The index page `apps/admin-web/src/app/settings/page.tsx:47-101` lists cards only for available sections. A new card is a new entry plus en/ar message keys (`apps/admin-web/src/messages/en.ts:2334-2356` for `settingsNav`, plus `ar.ts`).
  - A finished settings page to copy is Payments: `apps/admin-web/src/app/settings/payments/page.tsx:16-55` (server page, `fetchPaymentSettings` in `lib/api/payments.ts`, client form `components/settings/payment-methods-form.tsx`, server action in `settings/payments/actions.ts`).
  - Backend pattern for a per-tenant settings row: `MerchantPaymentSettings` (`packages/db/prisma/schema/payments.prisma:127`), `StoreSettings` (`tenancy.prisma:79`), `merchant_carrier_settings` (migration `20261112000000_shipping_carrier_settings`: tenant_id PK, `version`, ENABLE and FORCE RLS plus a `tenant_isolation` policy per table, hand-written, not applied by the agent). Routes: `apps/admin/src/http/store-settings-routes.ts:22-37` (`settings:read`, `settings:update`, idempotent PUT). A public read for the storefront is `GET /public/store` (:61-70).
  - **The newest migration is `20261127000000_mfa_last_used_step`.** Wave 2 migrations must sort after it. New tenant tables need their own RLS block (`packages/db/prisma/MIGRATIONS.md`; the loop RLS migration does not cover new tables, see the comment at `payments.prisma:~126-133`).
  - Permission strings are checked with `guard.ensure(principal, "...")` in `apps/admin/src/interfaces/*.admin-controller.ts` (for example `payments.admin-controller.ts:82`). I did not find where permission strings are mapped to the three fixed roles (admin/operator/viewer). The implementer must find that before adding `checkout:*` or `notifications:*` strings.

---

## 1. Checkout

### 1.1 What Shopify has

From [notes] U082/U083, [audit] section 1-ج and section 2 rows 14-16, section 4 "Payments and checkout":

- **Configurations**: a list of checkout configurations (one Active, up to 20 drafts). "Customize" opens the checkout editor. Official link: checkout-settings/customize-checkout-configurations/active-and-draft-checkouts.
- **Customer contact method**: Email only (selected), or phone-or-email (needs an SMS app; unselectable in the audited store).
- **Show Shop link to track order**: checked.
- **Require login before checkout**: unchecked.
- **Customer information**:
  - Full name: "require first and last".
  - Company name: "don't include".
  - Address line 2: "optional".
  - Shipping address phone: "optional" (the audit recommends "required" for Egypt couriers, row 14 and plan item 1.5).
- **Marketing consent**:
  - Email: "at checkout and sign up" (option to preselect in some regions).
  - SMS: "Don't show". WhatsApp: "Don't show".
  - The audit says SMS/WhatsApp options are "not shown", not disabled (Sol amendment 3).
- **Tipping**: "show tipping options at checkout" (off).
- **Abandoned checkout emails**: "no longer managed here, see Marketing automations".
- **Checkout language**: English, with "edit checkout content".
- **Advanced preferences**: Address collection (manage); **Add-to-cart limit** (Recommended, enabled; applies per variant, official link checkout-settings/add-to-cart-limit).
- **Checkout rules**: apps only (none installed).
- Order processing (auto-fulfil, auto-archive) is on General in Shopify (audit row 13), so it is not part of this page.

### 1.2 What Morbeh already has

- **Storefront checkout** (one page): `apps/storefront/src/components/checkout-view.tsx` (1377 lines).
  - Hard-coded rules today:
    - The shipping name and a valid phone are always required: `isShippingComplete` :127-136, submit gate :661-666, `phoneRequired` passed at :769.
    - The billing phone is optional: :895 `phoneRequired={false}`, :671-672.
    - Address line 2 is always shown and optional: :1092-1095.
    - There is no company field.
    - Email is always required: :662-665.
    - There is a single `name` field, not first and last (:1072-1076).
  - Phone validation lives in `apps/storefront/src/lib/checkout-address.ts:63-78`. The country list comes from the shipping zones (:37-46).
- **Server-side address rules**: `services/checkout/src/domain/value-objects/checkout-address.ts`.
  - Requires line1, city and country (:52-54).
  - `name` and `phone` are **optional** on the server (:56-64). The "required" rule is enforced by the storefront JS only.
  - Zod body for the address routes: `apps/admin/src/http/public-checkout-routes.ts:43-51` (name, phone, postalCode and province optional).
  - Public checkout routes at :351-:819: create, items, billing-address :450, shipping-address :486, contact :522, shipping-quote, shipping-selection, tax, payment-selection, recalculate, discount-codes, complete :764, payment :793.
- **Contact email**: `CheckoutSession.contactEmail` (`packages/db/prisma/schema/checkout.prisma:12`). Guest checkout works (`apps/admin/src/http/guest-checkout.e2e.test.ts`). **There is no "require login before checkout" switch** (NOT FOUND).
- **Marketing consent**:
  - `ConsentRecord` is an append-only log (`identity.prisma:94-108`), scopes `marketing | marketing_sms | analytics | data_sharing` (`services/identity/src/domain/value-objects/consent-scope.ts:3-10`).
  - The only writer reachable from HTTP is the staff route `POST /customers/:customerId/marketing-consent` (`apps/admin/src/http/customer-routes.ts:223-235`). Its use case documents itself as "staff assertion … not proof the shopper opted in" (`services/identity/src/application/change-marketing-consent.use-case.ts:~26-30`).
  - **No shopper opt-in at checkout**: NOT FOUND in `checkout-view.tsx` or the checkout routes.
- **Add-to-cart limit**: NOT FOUND. `Quantity` accepts any positive integer (`services/cart/src/domain/value-objects/quantity.ts:11`). The public cart routes use `z.number().int().positive()` with no max (`apps/admin/src/http/public-cart-routes.ts:65,74`). Only draft orders cap quantity (`MAX_DRAFT_LINE_QUANTITY`, `apps/admin/src/http/draft-order-pricing.ts:8,59`).
- **Tipping**: NOT FOUND.
- **Checkout language**: the storefront has one locale model. `OnlineStorePreferences.defaultLocale` (`online-store.prisma:10`, ar|en) is edited on `/online-store/preferences` and via Languages (`/locales`). So "Checkout language" can only link to those pages.
- **Abandoned checkouts**: the admin screens `apps/admin-web/src/app/abandoned-checkouts/*` and the recovery link use case (`services/checkout/src/application/abandoned-checkouts.use-cases.ts:~163`, 7-day link). The merchant shares the link by hand; **no email is sent** (NOT FOUND).
- **Order-tracking link on the confirmation page** ("Show Shop link to track order"): NOT FOUND as a setting.
- **Existing admin-web screens that could be reused**: none for Checkout settings. `/abandoned-checkouts` is related but separate.

### 1.3 Gaps

- **Backend (migration YES, additive)**:
  - New `checkout.checkout_settings` (tenant_id PK, version, timestamps, RLS). Columns that can be matched honestly:
    - `name_mode` (`required|optional`; first/last split is not supported, see 1.5)
    - `line2_mode` (`hidden|optional|required`)
    - `phone_mode` (`optional|required`; `hidden` only if no courier needs it, and the audit says Egypt needs it)
    - `marketing_email_prompt` (`hidden|show|preselect`)
    - `cart_line_limit` (`int null`, null = off)
    - `require_login` (`bool`)
  - Likely also an additive column `checkout.checkout_sessions.marketing_opt_in boolean null`, so the shopper's tick survives to completion and can be written to `ConsentRecord`.
  - Admin routes `GET/PUT /checkout/settings` (`settings:read` / `settings:update` style).
  - A public read `GET /public/checkout-settings` for the storefront (no secrets; modelled on `/public/store`).
- **Server-side enforcement is mandatory.** Today "required phone" is only in the storefront JS (`checkout-address.ts:61-64` treats phone as optional). If the merchant can set "phone required", `shipping-address`/`complete` must reject a missing phone. The same goes for `require_login`, `cart_line_limit` (cart add/change and checkout items) and the marketing opt-in write. A UI-only setting would be a placebo.
- **Identity**: a shopper-side marketing-consent writer (public, session-bound, idempotent) next to `ChangeMarketingConsent`. It must keep the staff vs shopper source distinct, or the log lies about who opted in.
- **UI over existing APIs**: none. All of the above is new, but the form itself is a small copy of Payments.
- **Storefront**: `checkout-view.tsx` reads the public settings (fetched server-side in the checkout page) and renders line2/phone/consent per setting. Tests in `checkout-view.test.tsx` assume today's rules.

### 1.4 Risks

- **Money-path correctness**: this is the live checkout. Any change to `isShippingComplete`/submit gating can silently block orders. Use defaults equal to today's behaviour (name required, phone required, line2 optional, email-only, no limit, no login required), so a missing settings row changes nothing.
- **Cart limit** touches the cart and checkout use cases and stock reservation (`apps/admin/src/http/checkout-stock-reservation.e2e.test.ts`). Enforce at add/change and again at checkout start.
- **Marketing consent** is legal: a pre-ticked box must never be the default. Shopify only preselects in some regions (the audit shows a US badge). Default for Morbeh: shown, unticked. Whether Egyptian privacy law (PDPL, Law 151/2020) applies is a question for the owner or a lawyer; I did not verify it.
- **Phone "hidden"** can break courier booking (the Bosta carrier needs a phone). Do not offer `hidden` unless the carrier setting says it is not needed.
- Settings changes must reach the storefront within its cache window (`apps/storefront/src/lib/shell-tag.ts:8` `STOREFRONT_CACHE_TTL_SECONDS = 60`). The checkout page should read uncached or via a tag.

### 1.5 Not matchable honestly

- "Require first and last name" (Morbeh stores one `name`; splitting it means changing `CheckoutAddress`, the order snapshot and the carrier booking).
- Company name field (not in `CheckoutAddress`).
- Checkout **Configurations** (drafts, the active/draft switch, the Customize editor), and Checkout rules (apps).
- Phone-or-email contact method (needs an SMS provider; NOT FOUND, see 3.5).
- Tipping (touches totals, payment amounts and refunds). Defer.
- Abandoned checkout emails: Shopify itself moved them out of this page. Morbeh has no sender for them yet, so wait for Notifications (2b).

---

## 2. Customer accounts

### 2.1 What Shopify has

- From [notes] U084 / [audit] row 17: **show login links in the store header and checkout** (ON); **Store credit** (ON, customers view and spend credit); **Configurations** (customise accounts); **Order actions** (reorder, return, cancel; "manage"); **Authentication** ("manage"). The audit never opened the last three sub-pages (section 3 item 8).
- Official links: customers/customer-accounts/manage; customers/store-credit; self-serve returns need the new customer accounts (fulfillment/.../returns/self-serve-returns/setup).
- What Authentication and Order actions contain is **not in the audit**. [general]: sign-in methods (email code, Shop, Google) and which order actions customers may do. Treat as unverified.

### 2.2 What Morbeh already has

- **Customer auth (storefront)**, password-based:
  - `apps/admin/src/http/public-auth-routes.ts`: register :119, signup/complete :155, login :169, logout :195, refresh :207, logout-all :223, me :235, claim-cart :246.
  - Storefront pages `apps/storefront/src/app/(store)/account/{page,login,register,signup/complete,wishlist,loyalty}`.
  - The account page is a profile stub: name/email plus wishlist and loyalty links (`account/page.tsx:~46-75`).
- **Header link**: `apps/storefront/src/components/site-header.tsx:~117-125` always shows the account icon (no setting).
- **Accounts vs guests**: guest checkout always works; guest-to-account upgrade by emailed link (G-72: `services/identity/src/application/request-signup-link.use-case.ts`, `complete-signup.use-case.ts`, `identity.prisma:60-75` `SignupToken`).
- **Customer record** has `language`, `phone`, `note`, `emailVerifiedAt`, `deletedAt` (`identity.prisma:5-27`).
- **Loyalty accounts** exist (`public-loyalty-routes.ts:76`, `/account/loyalty`). That is points, not store credit.
- **Returns**: staff-side only (`apps/admin/src/http/returns-routes.ts:97-215`, `services/returns`). **No customer-facing returns/orders/cancel/reorder routes**: no `/public/orders…` or `/public/returns…` path exists (NOT FOUND), and no `/account/orders` page.
- **Store credit / gift cards**: NOT FOUND anywhere in services, schema, apps (the only hits are policy-template text).
- **Authentication methods**: password only; no social, no passwordless, no Shop (NOT FOUND).
- **Reusable admin-web**: none for settings. `/customers` is the staff-side list.

### 2.3 Gaps

- **Small, honest first version (migration YES, additive)**: a per-tenant settings row (`identity.customer_account_settings`, or fold into the checkout settings table to save a migration) with:
  - `accounts_mode` = `optional` (today) | `disabled`, plus the account icon visible or not;
  - `require_login` (shared with Checkout 1.3).
  - Needs a public read, server-side enforcement (`disabled` ⇒ register/login routes refuse, header hides the link), and one small UI form. This is **UI plus a thin backend**, not UI-only.
- **Big, not small**: customer order history page, order actions (cancel/reorder/self-serve return, which needs customer-visible orders and return policy rules; Policies "return rules" do not exist yet either, audit row 30), and store credit (ledger tables, spend at checkout, refund-to-credit, staff adjust). Each is a feature of its own: defer to a later wave.
- **Authentication**: adding Google/Shop sign-in means an OAuth app per merchant: out of scope.

### 2.4 Risks

- `disabled` plus existing customers: sessions and wishlists/loyalty stop working. Define what happens to signed-in sessions.
- Turning accounts off must not break guest checkout or claim-cart (`public-auth-routes.ts:246`).
- Store credit (when built) is a payments feature: ledger correctness, refunds, double-spend. Needs its own plan.
- Customer data: showing order history exposes PII, so authorisation per customer is critical (tenant + customer binding as in `public-auth-routes`).

### 2.5 Not matchable honestly

- Shopify's hosted "new customer accounts" experience, passwordless email-code sign-in, Shop/Google/Facebook sign-in.
- Store credit (no ledger exists).
- Order actions (no customer order pages and no self-serve returns).
- "Configurations" (account page customisation): Morbeh's account page is a stub.

---

## 3. Notifications

### 3.1 What Shopify has

- [audit]/[notes] U093: **Sender email** (the audited store used Gmail, which Shopify rewrites to `store+<id>@shopifyemail.com`; a custom domain needs CNAME + DMARC, official links email-rewrites / setup-your-email). Four sub-sections, **never opened**: Customer notifications, Staff notifications, Fulfillment request notification, Webhooks (audit section 3 item 9). From the audit's links: webhooks are JSON/XML and the event type cannot be changed after creation.
- [web]:
  - Customer notification templates (Order confirmation, Order canceled, Order refund, Shipping confirmation, Shipping update, Draft order invoice, Gift card created, Customer account welcome, and so on). Each has a subject and body (Liquid), can be previewed and reverted to default, and some can be disabled.
  - "Customize email templates" (logo, colours).
  - Staff notifications: New order (and others) with recipients (an email address or a staff member), plus a store order summary (weekly/daily).
  - The reply-to address is the Sender email.
- [general]: Fulfillment request goes to a third-party fulfillment service. Webhooks are outbound HTTP callbacks per event.

### 3.2 What Morbeh already has

- **A delivery-lifecycle engine, not a message editor**:
  - Table `notifications.notifications` (`packages/db/prisma/schema/notifications.prisma:5-32`): per-notification status, channels, `template` JSON (`templateId`, `bodyPattern`, `subjectPattern`), variables, attempts, history. `recipient` is `{customerRef}` only: "No contact PII (ADR-0006)" (:3, :10). `ProcessedProviderCallback` :35-45.
  - Domain: `services/notifications/src/domain/*`. Channels `email|sms|push|webhook|in_app` (`value-objects/notification-channel.ts:3-9`). Template substitution is only `{{var}}` (`value-objects/notification-template.ts:11-12`, `render` ~:25-31): no loops, no conditionals.
  - **Delivery to a real provider does not exist.** `services/notifications/src/composition.ts:67-70` builds `InMemoryEmailProvider`, `InMemorySmsProvider`, `InMemoryPushProvider` and `InMemoryWebhookProvider`, and the doc comment at :46-50 says "All 4 provider ports stay in-memory stubs". So today an order-status notification is recorded and "sent" to a stub; the shopper gets nothing.
- **Who creates notifications**: `apps/admin/src/infrastructure/cross-context/orders-notification.adapter.ts:38-91` (creates, queues and sends, hard-coded `templateId: "order-status-changed"`, body "Order {{orderNumber}} status changed to {{status}}.", English only, :62-65) and `payments-notification.adapter.ts:64-66` (same idea). Wired at `apps/admin/src/composition.ts:1057` and :1235. Orders calls it best-effort and swallows errors (`services/orders/src/application/order-lifecycle.use-cases.ts:50-57`).
- **Real email path (separate and works)**:
  - Port `apps/admin/src/interfaces/email-sender.port.ts:2-8`; `ResendEmailSender` and `LoggingEmailSender`; runtime picks Resend only if `RESEND_API_KEY` is set (`apps/runtime/src/email-wiring.ts:25-42`, field `deliveryConfigured`).
  - From address is one platform-wide `EMAIL_FROM`, default "Morbeh <onboarding@resend.dev>" (`apps/runtime/src/config.ts:88`). **No per-merchant sender name, reply-to or verified sender** (NOT FOUND).
  - Used only by: staff password reset, staff invitation, customer signup-complete and already-registered mails. Hard-coded bilingual strings in `apps/admin/src/infrastructure/email-templates.ts:2,24,54,67`; adapter `email-signup-email-adapter.ts:6-23`.
  - Store contact email exists: `StoreSettings.contactEmail` (`tenancy.prisma:82`), a natural reply-to.
- **Order confirmation, shipping confirmation, cancel and refund customer emails**: NOT FOUND as sent mail. Only the stub notification above fires. **Staff new-order email**: NOT FOUND. **Merchant webhooks**: NOT FOUND (only the unused `WebhookProviderPort` in `services/notifications/src/application/ports.ts:28-31`, in-memory).
- **Admin routes**: `apps/admin/src/http/notifications-routes.ts:96-184` (create, queue, send, retry, transitions, callback, list, get), UI `apps/admin-web/src/app/notifications` (list, detail, "new") with `lib/api/notifications`. This is a raw delivery log and manual composer, not Shopify's templates page.
- **`/templates` is NOT email templates.** `apps/admin-web/src/app/templates/page.tsx` is the Dynamic Pages templates list (`fetchTemplatesPage` from `lib/api/pages`, `t.templatesPage`). Do not reuse it.
- **Customer language** to pick a template locale: `Customer.language` (`identity.prisma:12`).
- **Customer contact resolution** (customerRef to name and email, one batched read): `services/identity/src/application/get-customer-contacts.use-case.ts:~1-30` (the resolver can build on it; fit not fully verified).
- **Abandoned-checkout email**: NOT FOUND (links are shared by hand).

### 3.3 Gaps

- **Backend, the real work (migration YES)**:
  1. `notifications.notification_templates` (tenant_id, `key` such as `order_confirmation`, subject and body per locale ar/en, `enabled`, `version`, PK (tenant_id, key); RLS). Seeded defaults live in code ("revert to default" = delete the row), localized like store policies (`LocalizedText`, `OnlineStorePolicy` at `online-store.prisma:92`).
  2. `notifications.notification_settings` (tenant_id PK: `sender_name`, `reply_to`, `staff_recipients` JSON, `staff_new_order` bool; RLS).
  3. A real `EmailProviderPort` adapter over the existing `EmailSender`, plus a recipient resolver (customerRef to address via Identity) and a template-variable builder (order number, totals, line items). Needed because Notifications deliberately stores no addresses.
  4. Triggers: order placed (confirmation), cancelled, refunded, shipped (fulfilment/carrier events), draft invoice (the invoice link exists, `apps/admin/src/http/draft-order-invoice.test.ts`). Each is a hook in the Orders/Fulfillment adapters.
  5. Staff new-order notification to configured recipients.
  6. Admin routes `GET/PUT /notifications/settings`, `GET/PUT/DELETE /notifications/templates/:key`, `POST …/preview` and `…/test-send`.
- **UI (sonnet)**: Settings > Notifications: sender section, customer-notification list (enable toggle, edit subject/body per language with variable chips, preview, revert), staff notifications (recipients).
- **UI over existing APIs only**: a "Delivery log" link to `/notifications`.
- The `NotificationsController` retry/attempt model can be reused for delivery bookkeeping, but the **existing generic "order status changed" text must be replaced** by the template path, or shoppers will receive two different mails.

### 3.4 Risks

- **Email sending**: first real transactional mail from the platform.
  - Needs `RESEND_API_KEY`. The default `onboarding@resend.dev` sender is a sandbox [general: Resend only delivers it to the account owner], so launch needs a verified domain, an owner decision (audit plan 3.1).
  - Without a key the logging sender "succeeds" silently. A merchant would see "sent" while nobody got mail. Surface `deliveryConfigured` in the UI as an honest banner (wave 1d's staff-invite flow already refuses with 503 when delivery is not real, `apps/runtime/src/email-wiring.ts:45-57`; reuse that rule).
- **Escaping/injection**: merchant-authored templates with `{{var}}`. Values must be HTML-escaped, and unknown variables must not render.
- **Opt-in rules**: order and shipping mails are transactional. Marketing mail must respect `ConsentRecord` (no marketing sender is in scope here).
- **PII**: do not log bodies (the existing `LoggingEmailSender` only logs recipient and subject). Notifications rows store no addresses (ADR-0006); keep it that way.
- **Idempotency and best-effort**: a retry of an order transition must not email twice (idempotency key `orderNumber:status` is already used, `orders-notification.adapter.ts:54`). A mail failure must never block an order transition (best-effort contract in Orders).
- Rate limits and cost (Resend free tier is 3000 mails/month, per the plan `docs/superpowers/plans/2026-10-07-email-and-password-reset.md`).

### 3.5 Not matchable honestly

- Liquid templates (Morbeh only does `{{var}}`; order line tables need either a purpose-built variable or extending the renderer).
- Sender email replacement and DMARC/CNAME verification (`shopifyemail.com` rewriting): there is no DNS-verify flow for sending (the Domains feature verifies hostnames for serving, `ShopDomain.status` in `tenancy.prisma:41+`, not mail). First version = sender display name plus reply-to; From stays the platform address.
- Webhooks (no outbound webhook subsystem), Fulfillment request notification (no fulfilment-service concept), POS/mobile receipts, SMS/WhatsApp (no provider; NOT FOUND).

---

## 4. Customer privacy

### 4.1 What Shopify has

- **Audit: nothing.** U096 is a copy of Languages; the audit's own row 31 says "no image, cannot judge" and plan item 2.3 needs the screenshot first. Only the official link is cited (customer-privacy-settings/understanding-customer-privacy-settings).
- [web], search snippets of the help pages "Configuring customer privacy settings" and "How customer privacy settings work":
  - **Cookie banner**: "Regions and content" with an automated-settings toggle (the banner is auto-set for UK/EEA when you have markets there) or manual region and content, position, preview; third-party banner integration; can show on storefront, cart, checkout and account pages.
  - **Data sharing opt-out page** (needs a published privacy policy; honours the Global Privacy Control header).
  - **Privacy policy** editor (same as Policies).
  - **Marketing**: double opt-in for marketing.
  - Shopify Network Intelligence settings, data-hosting location info; processing customer data requests (access/erase) is a separate help flow.
- Policies are covered by the existing page (audit row 29: only the automated privacy policy is published).

### 4.2 What Morbeh already has

- **Consent data model**: `ConsentRecord` (`identity.prisma:94-108`); scopes in `consent-scope.ts:3-10`; staff route `customer-routes.ts:223-235`; `Customer.deletedAt` with the comment "GDPR erasure = anonymize + soft delete (G-25)" (`identity.prisma:18`) but **no erase or export use case or route for a single customer** (`services/identity/src/application/` has none; only the staff CSV `GET /customers/export-rows`, `customer-routes.ts:153`).
- **Security context consent projection**: `services/security/src/application/consent.use-cases.ts:22-35` (reads consent decisions for compliance checks, "Identity owns and emits consent"); compliance packs `services/security/src/infrastructure/compliance-packs.ts` and routes `/security/compliance/*` (`security-operations-routes.ts:171-184`), console under `apps/admin-web/src/app/security/*`. This is platform compliance posture, not storefront consent.
- **Tracking consent snapshot**: `packages/tracking/src/envelope/consent.ts` (categories analytics/marketing/personalization; destinations are denied without a snapshot, :85-100). It is ready to consume a visitor's cookie decision, but nothing produces one (see 5.2).
- **Storefront**: **no cookie banner, no consent cookie, no GPC handling** (NOT FOUND; a search of `apps/storefront/src` for consent/gdpr/privacy only matches policy links and tests). CSP is only `frame-ancestors` (`apps/storefront/src/middleware.ts:61-72`). No country detection for a visitor (NOT FOUND).
- **Policies (privacy policy text)**: `OnlineStorePolicy` (`online-store.prisma:92-103`, types refund|shipping|privacy|terms|contact), routes `online-store-routes.ts:331-371` (including a template route), admin page `apps/admin-web/src/app/settings/policies`. Footer policy links via `apps/storefront/src/lib/shell-menus.ts` (`footerPolicyLinks`).
- **Name clash to avoid**: `apps/admin-web/src/app/consent/page.tsx` is the **Hydra OAuth consent provider** for staff login (:1-15), not a cookie page.
- Reusable admin-web: `/settings/policies` for the privacy-policy link only.

### 4.3 Gaps

- **Backend (migration YES, additive)**: `online_store.privacy_settings` (tenant_id PK; `banner_enabled`, `banner_regions` text[] or `mode`, `banner_position`, `banner_text` localized JSON, `honour_gpc`, `version`; RLS). Public read endpoint.
- **Storefront (the main piece)**: banner component, a first-party consent cookie, a small client API (`getConsent`/`onChange`) other scripts (pixels, 5.3) call, GPC detection, a "change my choice" link. Region targeting needs a country signal (edge geo header or the market country): NOT FOUND today, so a first version is "banner for all visitors" or an explicit decision.
- **Data requests**: admin use cases and routes for one customer to export their data and to erase or anonymise (the schema comment promises G-25; the code does not do it). Must cover customers, addresses, consent, order snapshots, notifications, and tracking records (`tracking.tracking_event_records` is described as an immutable system of record, `tracking.prisma:1-28`; that conflicts with erasure and needs a decision).
- **UI**: banner settings form, a link to Policies, and a data-requests tool (on the customer page).
- **UI over existing APIs**: privacy-policy link and the marketing consent log display (already shown on the customer page, wave 1b).

### 4.4 Risks

- **Legal**: a banner that claims compliance but does not block scripts is worse than none. The pixel loader (2d) must be gated by the same consent state. Whether Egypt's PDPL requires opt-in cookies, and what the region defaults should be, is an owner or legal decision. I will not guess. Safe default: opt-in required for non-essential (analytics/marketing) scripts everywhere.
- Erasure vs the immutable tracking store, order/finance records (tax law retention) and the audit chain: an anonymise-not-delete rule is the likely answer; needs an owner decision.
- Banner impacts SEO/CLS and LCP; keep it server-rendered or tiny.
- Storing visitor consent server-side would create new PII; the first version should keep it in the cookie only.

### 4.5 Not matchable honestly

- Automated region settings driven by Markets (Markets deferred to wave 5).
- Shopify Network Intelligence and its opt-out/GPC integration with Shopify's data network, the data-sharing opt-out page tied to it, "customer data hosting location", the Customer Privacy API for third-party banner apps.
- Without a screenshot of the real page (audit section 3 item 1), the exact field list is unverified. **Ask for the screenshot before final UI design.**

---

## 5. Customer events

### 5.1 What Shopify has

- [audit]/[notes] U092: empty "Pixels" page with "add custom pixel" and "explore pixel apps". Official links: promoting-marketing/pixels/overview, app-pixels, custom-pixels/manage (audit line 260; plan item 2.6: test accept and reject consent, no duplicate Purchase).
- [general]: app pixels (installed by apps), custom pixels (merchant JavaScript run in a sandbox), per-pixel customer-privacy requirements (marketing, analytics, preferences, data sale), connection status. Unverified.

### 5.2 What Morbeh already has

- **A server-side tracking pipeline, with no merchant surface**:
  - `packages/tracking` (envelope, normalisation, identity, destination router, `HttpJsonAdapter`, replay) and `apps/collector` (public beacon endpoint, write key to tenant; **real Kafka only, no in-memory fallback**, `apps/collector/src/main.ts:1-10`).
  - Nine seed destinations (Meta CAPI etc.) as registry data (`packages/tracking/src/delivery/platform-profiles.ts:1-50`; each destination's `consentPurpose: "marketing"`, :~47), registry entries and event records in `packages/db/prisma/schema/tracking.prisma:38-131` (append-only).
  - Runtime consumer is **off by default**: `TRACKING_INGEST_ENABLED` (`apps/runtime/src/config.ts:254-273`), requires `EVENT_TRANSPORT=kafka` (:437-447), registry must be seeded.
  - Write keys come from the env var `COLLECTOR_WRITE_KEYS` (`apps/collector/src/main.ts`, `write-key-registry.ts`; "merchant self-service key management" is explicitly future).
- **No browser tracker in the storefront**: no beacon, pixel, `gtag`, `fbq` or dataLayer (NOT FOUND in `apps/storefront/src`). No merchant admin routes or UI for pixels (NOT FOUND in `apps/admin/src`, `apps/admin-web/src`). `apps/admin-web/src/app/integrations/page.tsx:7-16` documents that no integrations context exists.
- **Storefront CSP** allows nothing special; third-party scripts would need a script-src policy (`apps/storefront/src/middleware.ts:61-72`).
- Reusable: none for settings. `/security` has no pixel console.

### 5.3 Gaps

- **Smallest honest feature ("Pixels")**, depends on 4 (consent):
  - Migration YES: `online_store.tracking_pixels` (tenant, id, `kind` meta|ga4|tiktok|snapchat, `pixel_id` validated per kind, `enabled`, `purpose` analytics|marketing, version; RLS).
  - Admin CRUD routes plus a public read.
  - Storefront loader that injects only vetted vendor snippets (built in code from the ID, never merchant-supplied JS), only after consent for the pixel's purpose, and fires standard events (page view, view item, add to cart, begin checkout, purchase; Purchase de-duplication as the audit warns). Needs CSP changes and a purchase-event hook on the confirmation page.
- **Server-side (CAPI) via the existing pipeline** is a separate large effort: Kafka transport, registry seeding, key management, secrets (`vault://` refs). Do not include in wave 2.
- UI: list/add/enable-disable/remove pixel, status text.

### 5.4 Risks

- **Third-party JS on the storefront and checkout**: payment pages must not load marketing scripts (PCI and leakage). Load on storefront pages only, never on payment steps or the admin.
- **Consent**: a pixel firing before consent is a legal and trust failure. Hard dependency on 4.
- **Wrong or duplicated Purchase events** distort ad spend; test accept/reject and refresh on the confirmation page.
- **Custom JS pixels** would let any merchant run arbitrary code on their storefront (XSS-by-design). Shopify mitigates with a sandbox; Morbeh has none.

### 5.5 Not matchable honestly

- **Custom pixels (arbitrary JS) and the app-pixel marketplace**: no sandbox runtime and no apps. Say "Pixels by ID for a fixed vendor list" instead of pretending parity.
- Per-pixel "customer privacy" matrix and Shopify's standard event schema (analytics/marketing/preferences/sale-of-data flags). Can be approximated by 2 purposes only.

---

## 6. Custom data (metafields and metaobjects)

### 6.1 What Shopify has

- [audit]/[notes] U040, U094, U038, U039:
  - **Metafield definitions** per owner type: Products, Variants, Collections, Customers, Orders, Draft orders, Companies, Company locations, Locations, Transfers, Pages, Blogs, Blog posts, Markets, Store (all 0 in the audited store).
  - **Metaobject definitions**: "Knowledge Base Facts" is Shopify-managed with 3 entries (Address / Delivery countries / Privacy policy). Add-definition form: name, type, description, fields (label and type: one/list), options (active/draft, translations, "publish entries as web pages", Storefront API access, Customer Account API access), display name field, thumbnail, filters.
  - Content > Metaobjects lists entries (Active/Available on storefront/Web pages/Draft counts).
- Audit priority P2 (row 56): product category metafields (colour, size). Knowledge Base Facts are publicly exposed to AI agents (row 50, plan 0.6), a Shopify-side feature.
- Official links: custom-data/metafields/using-metafields, custom-data/metaobjects, category-metafields.

### 6.2 What Morbeh already has

- **No generic custom data**: NOT FOUND (searched the Prisma schemas and `services/catalog`). The only structured extras are `Product.options`, `seo`, `tags`, `productType` (`catalog.prisma:6-36`), variant fields (:38+), `Customer.note`/tags, and order notes/tags.
- `customer_360.ComputedAttributeDefinition` (`customer-360.prisma:231`) is a rule-set engine for derived attributes, not merchant-defined fields.
- The theme and sections are fixed JSON with no data binding (`packages/storefront-content/src/sections.ts:17` `SECTION_TYPES`; theme document `online-store.prisma:33+`), so a metafield cannot be shown on the storefront without new rendering work.
- Reusable admin-web: none. The product editor and customer page would need a "Custom data" panel.

### 6.3 Gaps

- **Backend (migration YES)**: `catalog.metafield_definitions` (tenant, owner_type, namespace, key, name, description, type, validation JSON, `storefront_visible` bool, version; unique (tenant, owner_type, namespace, key)) and `catalog.metafield_values` (tenant, definition_id, owner_id, value JSON; unique (tenant, definition_id, owner_id)). Both with RLS. Type set and validation: a closed list (text, number, boolean, date, url, single-line list) with server-side validation.
- Routes: definitions CRUD; values get/put per owner. Owner types for a first cut: products, variants, collections (catalog) and customers. Order and customer metafields must **never** appear in public DTOs.
- Product editor integration, the public catalog DTO (`apps/admin/src/http/public-catalog-routes.ts`) returning only `storefront_visible` values.
- Without section binding the value is only visible through the API, which should be said plainly in the UI.
- **Metaobjects**: separate, larger (definitions with fields, entries, references). Defer.

### 6.4 Risks

- Schema design is hard to change later (definition keys, value typing). Keep the type set small and versioned.
- Public exposure: only an explicit per-definition flag, and never for customer/order owners.
- Catalog performance: values joined onto product reads. Index (tenant, owner_id), fetch lazily.
- Translation of values (Languages page) not handled; flag as a non-goal.

### 6.5 Not matchable honestly

- Metaobjects, Knowledge Base Facts (a Shopify AI/agentic feature), Storefront API and Customer Account API access flags (Morbeh has no GraphQL API), 15 owner types, "publish entries as web pages", category-driven metafields (needs a product taxonomy; `Category` exists but is not Shopify's taxonomy).

---

## 7. Recommended split of wave 2

Ordering rule: ship settings that change live behaviour safely first, then the engine with the biggest functional hole, then the privacy-gated features, then the purely additive data model. Backend and UI are separate tasks (the repo's pattern: backend implementer, then UI implementer). All sub-waves that edit `settings-nav.tsx`, `settings/page.tsx`, `messages/en.ts|ar.ts` and their tests will conflict if run in parallel. Serialise the UI tasks, or give the nav flip to one final task per sub-wave.

### 2a: Checkout and Customer-accounts switches (smallest, lowest risk, defines the settings pattern)

- **Migration** `…_checkout_settings` (date after 20261127000000; additive): `checkout.checkout_settings`, optional `checkout.checkout_sessions.marketing_opt_in`, and the customer-accounts row (`identity.customer_account_settings`, or merged into the first table). RLS each.
- Tasks:
  1. Backend (terra): the settings use cases and routes `GET/PUT /checkout/settings`, `GET /public/checkout-settings`, plus **server-side enforcement** (phone/name/line2/require-login/cart limit) with defaults equal to today.
  2. Backend: shopper-side marketing opt-in writer in Identity and its checkout hook.
  3. Backend: accounts mode (disable register/login, header flag).
  4. UI (sonnet): `/settings/checkout` and `/settings/customer-accounts` forms, nav flips, en/ar.
  5. Storefront UI (sonnet): `checkout-view.tsx` and header read the settings. Careful, live money path, keep e2e.
- Defer: tipping, first/last name, company name, configurations/editor, checkout rules, phone-or-email, abandoned-checkout emails (until 2b), customer order actions, store credit, social sign-in.

### 2b: Notifications (largest functional gap; its backend can start in parallel with 2a)

- **Owner decisions first**: Resend key and verified sender domain, the list of customer emails to ship, ar/en copy.
- **Migration** `…_notification_templates`: `notifications.notification_templates`, `notifications.notification_settings` (RLS).
- Tasks:
  1. Backend: real `EmailProviderPort` over `EmailSender`, recipient resolver, variable builders, HTML escaping, honest "delivery not configured" state.
  2. Backend: templates and settings use cases and routes (preview, test-send, revert).
  3. Backend: triggers: order confirmation, cancel, refund, shipped, draft invoice. Staff new-order mail. Replace the generic "order status changed" text. Idempotent and best-effort.
  4. UI: `/settings/notifications` (sender, template list/editor, staff recipients, link to the delivery log `/notifications`).
- Defer: Liquid, webhooks, fulfilment request, SMS/WhatsApp, DNS sender authentication, abandoned-checkout reminder email (add after the sender works, consent permitting).

### 2c: Customer privacy

- Needs the missing Shopify screenshot (audit section 3 item 1) and an **owner/legal ruling** on region defaults and erasure vs retained records.
- **Migration** `…_privacy_settings` (`online_store.privacy_settings`; optional `identity.data_requests` log).
- Tasks:
  1. Backend: settings routes and a public read.
  2. Storefront (sonnet): cookie banner, consent cookie and client API, GPC.
  3. Backend: per-customer data export and anonymise/erase use cases and routes (plus the customer-page action).
  4. UI: `/settings/customer-privacy`.
- Defer: region targeting (needs a geo signal and Markets), data-sharing opt-out page, double opt-in for marketing, Network Intelligence.

### 2d: Customer events (Pixels), after 2c

- **Migration** `…_tracking_pixels` (`online_store.tracking_pixels`).
- Tasks: backend CRUD plus public read; storefront loader gated by 2c consent with Purchase de-duplication and CSP; UI `/settings/customer-events`.
- Defer: custom JS pixels, app pixels, CAPI/server-side self-service (collector, Kafka, write-key management), per-pixel privacy matrix.

### 2e: Custom data (metafields), independent, can run beside 2c/2d

- **Migration** `…_metafields` (definitions + values tables, RLS).
- Tasks: backend definitions/values and validation for products, variants, collections, customers; public catalog DTO exposure by flag; UI `/settings/custom-data` (definitions) and a panel in the product and customer editors.
- Defer: metaobjects and Knowledge Base Facts, order/draft/company/market/store owners, storefront section binding (no theme support), translations.

### Deferred outside wave 2 (not honest to promise)

Markets/Apps (wave 5); checkout editor and configurations; store credit; customer order actions and self-serve returns (needs return policy rules, audit row 30); social/passwordless sign-in; webhooks; Liquid; custom pixels; metaobjects.

## 8. Owner decisions needed before planning

1. Resend key and verified sender domain (2b); whether `reply_to` = `StoreSettings.contactEmail`.
2. Cookie banner defaults for Egypt and the region rule; erasure policy versus retained order, finance and tracking records (2c). Needs a lawyer's view, not an engineering guess.
3. Which pixel vendors (Meta, GA4, TikTok, Snapchat?) for 2d. The audit says TikTok **Shop** does not support Egypt (row 48), which is a different product from a TikTok pixel; confirm.
4. Whether "phone required" should become the shipped default for new shops (the audit recommends it; today it is hard-coded required in the storefront only).
5. Screenshots still missing from the audit that would settle 2a/2c scope: Settings > Customer privacy, Customer accounts sub-pages, Notifications sub-pages, Checkout "Address collection" (audit section 3 items 1, 8, 9, 13).

## 9. Verification notes

- Searched and read in this session, not run: no tests, no DB, no git writes.
- Not verified: where permission strings map to roles (see section 0); that `get-customer-contacts.use-case.ts` fits the recipient resolver; Resend sandbox behaviour [general]; every [web] and [general] Shopify claim.

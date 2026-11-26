# Shopify parity — Wave 2b: Settings > Notifications (customer emails from the merchant's email)

`OPUS: AGREED (self-review below) · reviewer: Opus (owner ruling 2026-11-24)`

**Owner ask (2026-11-26):** "الإشعارات والإيميلات للزباين من ايميل التاجر" — customer notifications and emails come from the merchant's email.
**Branch:** `morbeh/shopify-parity-w2b` from origin/main `000ed341` (worktree `F:/New folder/morbeh-shopify-parity-w1b`).
**Evidence:** `docs/superpowers/plans/w2/survey-settings.md` §3 (file:line), §7 2b. Shopify audit U093 (Sender email).
**Verified facts (web, 2026-11-26):** Resend Domains API — `POST /domains {name}` returns DNS records (DKIM/SPF/MX), `POST /domains/:id/verify` starts async verification, `GET /domains/:id` gives `status` (`not_started|pending|verified|failed`); needs a FULL-ACCESS API key (a sending-only key can't). Plan domain caps: Free 3, Pro 10, Scale 1000; +100 domains for $20/mo on paid plans.

**Decisions:**

- D38 Sender model = Shopify's. Each store has a **Sender email** (default: store contact email). If that email's domain is VERIFIED for the store → `From: "<Store name>" <sender email>`. Otherwise → `From: "<Store name>" <platform sending address>` with `Reply-To: <sender email>`, so customers see the store name and their replies reach the merchant. Free-mail domains (gmail.com, googlemail.com, yahoo._, outlook.com, hotmail._, live.com, icloud.com, me.com, aol.com, proton.me, protonmail.com, yandex._, mail.ru, gmx._) cannot be verified (their DMARC rejects third-party senders) → always the Reply-To mode, explained in the UI. Never put an unverified merchant address in `From`.
- D39 Customer templates (v1): `order_confirmation`, `order_canceled`, `order_refunded`, `shipping_confirmation`, `draft_order_invoice`; staff: `staff_new_order`. Each: subject + body per locale (en, ar), on/off (order_confirmation and shipping_confirmation default on; all default on), "revert to default" = delete the override. Defaults live in code. Rendering is `{{var}}` with HTML-escaping of every value; unknown variables render empty and are reported by preview; purpose-built blocks `{{line_items}}` and `{{order_totals}}` are rendered by code (no Liquid). Locale = customer language if set, else store default language, else en.
- D40 Honesty: when the runtime has no real email provider (`deliveryConfigured=false`), the settings page shows a banner and every notification is recorded as `failed` with reason `EMAIL_NOT_CONFIGURED` — never "sent".
- D41 One mail per event: the generic "Order {{orderNumber}} status changed to {{status}}" email path is replaced by the template path; idempotency key `<template>:<orderId>:<event-id or status>`; retries never double-send.
- D42 Best-effort: a mail failure never blocks or rolls back an order/payment/fulfilment transition (existing Orders contract); failures logged without bodies or addresses (ADR-0006: notification rows keep only `customerRef`).
- D43 Domain verification is optional and per store: the merchant clicks "Authenticate domain", Morbeh creates the domain at Resend, shows the DNS records, and "Verify" checks them. Needs runtime env `RESEND_DOMAINS_API_KEY` (full access); absent → the section says "Not available yet" (503 NOT_CONFIGURED), Reply-To mode still works.
- D44 Deferred (said, not hidden): Liquid, webhooks, fulfilment-request notification, SMS/WhatsApp, abandoned-checkout email, marketing double opt-in (→ 2c), logo/colour email branding beyond store name (v1 uses the store name + logo URL if StoreSettings has one).

**Owner actions (not code):** (1) the PLATFORM sending address must be on a domain verified in Resend (the current default `onboarding@resend.dev` only delivers to the Resend account owner); (2) add `RESEND_DOMAINS_API_KEY` if merchants should send from their own domains; mind the plan's domain cap.

**Implementers:** sonnet for all tasks. Wave 1e G1-G9 apply. Migration name sorts after `20261128000000_checkout_settings`.

---

### Task 1 — backend: settings, templates, rendering, real delivery (sonnet; checkpoints A → B)

**A. Model + routes.** Migration `20261129000000_notification_settings` (hand-written, additive, RLS ENABLE+FORCE+tenant_isolation per table):

```sql
CREATE TABLE "notifications"."notification_settings" (
  "tenant_id" TEXT NOT NULL PRIMARY KEY,
  "sender_email" TEXT,
  "staff_recipients" JSONB NOT NULL DEFAULT '[]',
  "disabled_templates" TEXT[] NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL);
CREATE TABLE "notifications"."notification_template_overrides" (
  "tenant_id" TEXT NOT NULL, "key" TEXT NOT NULL, "locale" TEXT NOT NULL CHECK ("locale" IN ('en','ar')),
  "subject" TEXT NOT NULL, "body" TEXT NOT NULL, "updated_at" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("tenant_id","key","locale"));
CREATE TABLE "notifications"."sender_domains" (
  "tenant_id" TEXT NOT NULL, "domain" TEXT NOT NULL, "provider_domain_id" TEXT NOT NULL,
  "status" TEXT NOT NULL, "records" JSONB NOT NULL, "verified_at" TIMESTAMP(3), "updated_at" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("tenant_id","domain"));
```

Domain (`services/notifications`): template catalogue + defaults (en/ar copy, variables per key), renderer (escape, unknown vars, blocks), sender resolution (`resolveSender({ storeName, senderEmail, verifiedDomains, platformFrom })` → `{ from, replyTo }`, free-mail list), validation (sender email syntax; staff recipients ≤ 10 valid emails; subject ≤ 200, body ≤ 20 000 chars; key/locale known). Repos Prisma + in-memory. Use cases: Get/UpdateNotificationSettings (expectedVersion, CONFLICT like 2a incl. the P2002-outside-UoW fix), Get/Put/Revert template override, PreviewTemplate (sample data → `{ subject, html, unknownVariables }`), SendTestEmail (to the acting staff member's own email only; rate-limited 10/hour/tenant, fail-closed). Routes `apps/admin/src/http/notification-settings-routes.ts`: `GET/POST /notifications/settings`, `GET /notifications/templates`, `GET/PUT/DELETE /notifications/templates/:key/:locale`, `POST /notifications/templates/:key/preview`, `POST /notifications/templates/:key/test` — permission `settings:read|update` (admin only), `deliveryConfigured` included in the settings read.

**B. Real delivery + triggers.** Extend the `EmailSender` port with optional `from` and `replyTo` (Resend adapter passes them; Logging adapter logs recipient+subject only). New notifications `EmailProviderPort` adapter over `EmailSender` (replaces the in-memory email provider in production wiring; SMS/push/webhook stay stubs). Recipient resolver: `customerRef` → name/email/language via identity `get-customer-contacts`; no address stored on notification rows. Triggers (in the existing cross-context adapters): order placed → `order_confirmation`; cancelled → `order_canceled`; refunded (payments) → `order_refunded`; fulfilment shipped/carrier tracking available → `shipping_confirmation` (with tracking number/URL if present); draft-order invoice send → `draft_order_invoice` (with the existing invoice link); order placed → `staff_new_order` to each configured staff recipient. Disabled template → no mail, notification recorded as `cancelled` reason `DISABLED`. Replace the generic status text (D41). `deliveryConfigured=false` → `failed` `EMAIL_NOT_CONFIGURED` (D40).
Tests: renderer escaping (`<script>` in a product name), unknown var, ar/en choice, sender resolution matrix (verified custom / unverified custom / gmail / no sender → contact email / no contact email → platform from without reply-to), each trigger once, idempotent retry, disabled, failure never fails the order, no body/address in logs.

**Commands:** prisma validate/generate; db consistency; vitest `@platform/notifications`, `@platform/identity`, `@platform/orders`; `@platform/admin` filtered `notification order payment fulfil draft email`; runtime composition/config/email-wiring; tsc notifications/admin/runtime; arch; tenant scanner.

### Task 2 — backend: own-domain sending (sonnet)

Port `SenderDomainProvider { create(domain) → { providerDomainId, status, records }; verify(id); get(id) }`; Resend adapter over `https://api.resend.com/domains` with `RESEND_DOMAINS_API_KEY` (fetch, 10 s timeout, no key in logs) + in-memory twin; runtime wiring (absent key → NotConfigured). Use cases: StartSenderDomain (domain = sender email's domain; refuse free-mail with "Emails from <domain> can't be authenticated. Replies will still reach you."; idempotent per tenant+domain; one domain per store in v1), VerifySenderDomain (calls verify then get; stores status/records/verified_at), GetSenderDomain. A domain verified by another store → refuse ("This domain is used by another store"). Routes `POST /notifications/sender-domain`, `POST /notifications/sender-domain/verify`, `GET /notifications/sender-domain` (admin). The sender resolution of Task 1 reads verified domains. Tests incl. provider errors mapped to 502 with a plain message, NotConfigured 503, cross-store refusal.

### Task 3 — admin-web `/settings/notifications` (sonnet, UI-only)

Sections like Shopify: **Sender email** (input + save; status line: "Customers get emails from <email>" when verified, else "Emails show <Store name> and replies go to <email>"; "Authenticate domain" → DNS records table with copy buttons + "Verify" + status chip; free-mail note; Not-available state), **Customer notifications** (list with on/off and Edit → editor per language with subject, body, variable chips, Preview (rendered HTML in a sandboxed iframe, `sandbox=""`), Send test to me, Revert to default via Dialog), **Staff notifications** (New order: recipients list add/remove), link "Delivery log" → `/notifications`; banner when `deliveryConfigured=false`. Flip `notifications` to available; update nav oracles. en + ar. Tests per section + middleware admin-only + revalidation + client-boundary.

---

## Opus self-review (round 1)

- Owner's ask honoured honestly: merchant's own address in From only after DNS authentication; otherwise store name + Reply-To (what Shopify does). Gmail as literal From is impossible and the UI says so.
- No double mails (generic path replaced, idempotency); no blocking of orders; no PII in logs/rows; HTML escaped; preview sandboxed.
- Honest when email isn't configured; owner actions listed.
  VERDICT: AGREED.

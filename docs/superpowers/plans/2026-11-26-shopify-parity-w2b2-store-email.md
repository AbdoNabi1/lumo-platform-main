# Shopify parity — Wave 2b2: each store sends customer emails from ITS OWN email account

`OPUS: AGREED (self-review below) · reviewer: Opus (owner ruling 2026-11-24)`

**Owner ruling (2026-11-26, verbatim):** "دول خاصين بيا انا مش التاجر RESEND_API_KEY وEMAIL_FROM … الحساب ده خاص بمربح هيبعت للتجار ايميلات تسويقية. اعمل نسخه للزباين جوه اعدادات المتجر للزباين الخاصة بالمتجر ده فقط وبايميل التاجر فقط زيها زي الواتس اب نفس الكلام" — and "ظبط موضوع الايميل".
**Branch:** `morbeh/shopify-parity-w2b2` from origin/main `82894d39` (Wave 2b merged, NOT deployed, its migration `20261129000000_notification_settings` NOT applied in production).
**Supersedes:** Wave 2b D38 (platform From + Reply-To) and D43 (platform-run domain authentication). Keeps D39-D42, D44 (templates, honesty, one mail per event, best-effort).

**Verified facts (2026-11-26):**

- Railway docs (docs.railway.com/networking/outbound-networking): "SMTP is only available on the Pro plan and above. Free, Trial, and Hobby plans must use transactional email services with HTTPS APIs." ⇒ SMTP (Gmail app password etc.) only works if the owner's Railway workspace is Pro. HTTPS email APIs work on every plan.
- The repo has no SMTP client dependency (no nodemailer); adding one needs an install (offline store) ⇒ SMTP is Task 3, gated on the owner's answer.

**Decisions:**

- D45 The platform email account (`RESEND_API_KEY`, `EMAIL_FROM`) is Morbeh's own and sends ONLY Morbeh → merchant/staff mail (staff invites, staff password reset, Morbeh's mail to merchants). It NEVER sends a store's customer mail, under any fallback.
- D46 A store's customer mail (order/shipping/refund/cancel/invoice templates, customer account sign-up mails, test sends) goes ONLY through that store's own **email connection**, `From: "<Store name>" <merchant's email>`. No connection, connection off, or connection failing ⇒ nothing is sent; the notification is recorded `failed` with reason `EMAIL_NOT_CONNECTED` / the provider's sanitized code; the settings page says so. Exactly like WhatsApp: the merchant's own account.
- D47 Connection kinds v1: **Resend API key** (the merchant's own Resend account; From must be on a domain verified in THEIR account — Resend refuses otherwise, and we surface its message). Port shaped so SendGrid/Brevo/SMTP can be added. **SMTP (Gmail/Outlook app password)** = Task 3, only if the owner confirms Railway Pro.
- D48 Secrets are write-only (never returned; UI shows last 4), sealed with a dedicated KEK `EMAIL_CREDENTIALS_KEK_REF`; the stored blob is `{v, alias, wrappedDek, ciphertext}` ONLY — never `kekRef` (same rule as lead-site fix b1f60deb); tenant id + connection kind sealed inside and re-checked on open; any open failure = one generic error. No KEK in a non-local env ⇒ saving answers 503 NOT_CONFIGURED "Not available yet".
- D49 Saving a connection runs a **test send** to the merchant's own address through it; status becomes `connected` only when that succeeds, else `failed` with the sanitized provider message. Every real send failure updates `last_error`/`last_error_at` (no addresses, no bodies, no keys in rows or logs).
- D50 Remove Wave 2b's platform domain authentication: drop the SenderDomain port/provider/use cases/routes/UI section, `RESEND_DOMAINS_API_KEY` config/env docs, and the `notifications.sender_domains` table (new migration drops it; it is empty everywhere). `notification_settings.sender_email` becomes the connection's From address (kept; validated as the From).
- D51 Customer account sign-up when the store has no working connection: the storefront sign-up/register flow answers `503 EMAIL_NOT_CONNECTED` "Sign-up by email isn't available for this store yet" (no platform fallback per D45); Settings > Customer accounts shows a warning linking to Settings > Notifications. Guest checkout unaffected.

**Implementers:** sonnet. Wave 1e G1-G9 apply (git rules, hand-written additive migration, tenant from context, zod structure + use-case semantics, brand lock, en/ar, Dialog/revalidation rules, no `@/lib/api` value import in client files). Migration `20261130000000_store_email_connections` (sorts after `20261129000000_notification_settings`).

---

### Task 1 — backend (sonnet; checkpoints A → B)

**A. Model, vault, provider, routes.** Migration:

```sql
CREATE TABLE "notifications"."email_connections" (
  "tenant_id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('resend')),
  "from_email" TEXT NOT NULL,
  "sealed_credentials" TEXT NOT NULL,
  "secret_last4" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL CHECK ("status" IN ('connected','failed')),
  "last_error" TEXT, "last_error_at" TIMESTAMP(3), "verified_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1, "updated_at" TIMESTAMP(3) NOT NULL);
-- RLS ENABLE + FORCE + tenant_isolation like customer_tags
DROP TABLE IF EXISTS "notifications"."sender_domains";
```

Prisma model + consistency describe. Domain: `EmailConnection` (validation: from email syntax, not empty; Resend key `re_` prefix + length), vault port + envelope adapter (D48) + in-memory twin; `StoreEmailProvider` port `send(connection secrets, message) → ok | { code, message }` with a Resend HTTPS adapter (fetch `https://api.resend.com/emails`, 10 s timeout, `Idempotency-Key`, Bearer = the STORE key, sanitized errors, no key in logs) + in-memory twin. Use cases: `GetEmailConnection` (view: kind, fromEmail, last4, enabled, status, lastError, verifiedAt, version, `credentialsConfigured` = KEK present), `SaveEmailConnection` (expectedVersion; seals; runs the D49 test send to the acting staff member's email; saves status), `SetEmailConnectionEnabled`, `DeleteEmailConnection`, `TestEmailConnection`. Routes (admin-only `settings:read|update`): `GET/PUT/DELETE /notifications/email-connection`, `POST /notifications/email-connection/test`, `POST /notifications/email-connection/enabled`. Runtime: `EMAIL_CREDENTIALS_KEK_REF` (optional, secret; boot refuses the in-memory vault outside APP_ENV=local, like carriers). Remove D50 items.
**B. Delivery switch.** The notifications `EmailProviderPort` used for customer templates resolves the store's connection per send: no/disabled/failed-open connection ⇒ `EMAIL_NOT_CONNECTED` (recorded, never "sent", never the platform sender). Sender resolution: `From: "<safe store name>" <connection.from_email>`; no Reply-To needed. Test-send of a template (Wave 2b route) uses the connection too. Customer sign-up mails (`EmailSignupEmailAdapter` / signup routes) use the store connection; none ⇒ D51 503. Staff invites/reset and anything Morbeh → merchant stay on the platform `EmailSender`. `deliveryConfigured` in the notifications settings view now means "this store has a connected, enabled connection". Tests: matrix (none / disabled / connected / provider refuses), platform sender never called for customer mail (spy), idempotency key reused on retry, sanitized error stored, no secrets in logs/rows/responses, D51 refusal, staff invite still platform.
**Commands:** prisma validate/generate; db consistency; vitest `@platform/notifications`, `@platform/identity`; `@platform/admin` filtered `notification email signup customer-auth public-auth order payment fulfil draft`; runtime composition/config/email-wiring/api; tsc notifications/admin/runtime; arch; tenant scanner.

### Task 2 — admin-web (sonnet, UI-only)

Settings > Notifications: replace the "Sender email / Authenticate domain" section with **Email account**: status chip (Connected / Not connected / Failed + last error), provider choice (Resend now; others "coming soon"), From email, API key (write-only, "Key ending in 1234"), short how-to (create a Resend account, verify your domain there, create a sending key), Save = connect + test, "Send test", on/off switch, Disconnect via Dialog. Banner when not connected: "Customer emails are off until you connect your store's email account." Customer accounts page warning (D51). Remove domain-auth UI and its tests. en + ar. Tests + middleware admin-only + revalidation + client-boundary.

### Task 3 — SMTP connection (ONLY if the owner confirms Railway Pro)

Add `kind = 'smtp'` (host, port, security, username, app password; presets Gmail/Outlook/Zoho) over an SMTP client dependency; same vault/test/status rules. Not planned in detail until confirmed.

---

## Opus self-review (round 1)

- Owner rule honoured literally: no path sends a customer mail through Morbeh's account (spy test + code removal of the platform fallback); store mail only via the store's own credentials; Morbeh's account kept for Morbeh → merchant mail.
- Secrets: write-only, sealed without kekRef, generic errors, no logging; KEK required outside local.
- Honest states everywhere (not connected / failed shown, notifications recorded failed, sign-up refuses clearly instead of silently using the platform).
- Infra truth stated: SMTP blocked on Railway below Pro ⇒ v1 is HTTPS API (Resend); SMTP waits for the owner's answer.
- Wave 2b not deployed and its migration unapplied ⇒ no production data at risk; the drop is of an empty table.
  VERDICT: AGREED.

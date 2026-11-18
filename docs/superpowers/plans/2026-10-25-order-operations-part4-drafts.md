# Order Operations — Part 4: Draft Orders and the Invoice Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merchant builds an order for a phone/WhatsApp customer (Shopify's "Drafts"), then either sends the customer an invoice link that opens a checkout locked to the merchant's quote, or creates the order directly — paid ("Mark as paid", a new `manual` payment recorded in Payments) or cash on delivery — always through the real checkout pipeline.

**Architecture:** A `DraftOrder` aggregate lives in `services/orders` (`orders.draft_orders`, numbers `D1…` from a new column on the existing counter row). Its content is saved with optimistic locking; its status, checkout and deletion columns are written only by guarded `updateMany`s. Turning a draft into an order "materialises" it: `services/checkout` starts a checkout session with a server-minted `sessionRef` and the draft's lines, addresses and **draft terms** (fixed discount + fixed shipping, codes and automatic discounts never evaluated, `DRAFT_LOCKED` on the routes that would change them), then the normal `CompleteCheckout` (stock, guest customer, numbering) and `InitiatePayment` run. "Send invoice" issues a Part 3 `CheckoutLink` with `purpose: "invoice"`; the claim re-materialises from the latest draft and transfers the session to the opener's own guest cookie. `CompleteCheckout` reports a draft's completion back through a best-effort `DraftOrderCompletionPort`, and `apps/admin` self-heals on read. Payments gains a `manual` provider (`recordedByStaff`) settled through the existing confirmed collection, and the cash-to-collect rule learns to never treat it as cash. `admin-web` adds Orders → Drafts (list, editor, Send invoice, Collect payment) and redirects `/orders/new`; the storefront's `/c/<token>` handles invoices and its checkout hides what the merchant fixed.

**Tech Stack:** TypeScript, Prisma 6 / PostgreSQL (hand-written SQL migration, two tenant-scoped raw statements), zod routes on `@platform/http`, Vitest, Next.js 15 App Router + React 19 (admin-web and storefront), Tailwind (logical utilities), `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-10-18-order-operations-design.md` — Part 4 (§4.1–§4.11), "Global constraints", "Permissions", "Anti-goals", "Security and multi-tenancy", "Delivery order", Decisions 25–40. Read the spec and this plan together. Parts 1–3 (`docs/superpowers/plans/2026-10-18-order-operations-part1-list.md`, `2026-10-19-order-operations-part2-notes-tags.md`, `2026-10-19-order-operations-part3-abandoned.md`) are DONE on this branch (HEAD `143799bc`); their conventions are followed here.

## Rulings (decided on the owner's behalf; the spec is silent or ambiguous)

The owner delegated every decision ("نفذ وخد القرارات مكاني ما يخدم مصلحة المنصة"). Each ruling below is binding for the tasks that follow.

1. **No cart for a draft's checkout.** A draft session's `cartRef` is `draft:<draftId>`; no `cart.carts` row is made. Reason: a cart owned by a server-minted `sessionRef` nobody holds is dead data; nothing reads the cart of a completed session (checked: no consumer of `checkout_session.completed` touches carts), and the spec says the cart page is not involved.
2. **Draft writes split like `CheckoutLink` (binding carry 1).** `DraftOrderRepository.save()` writes ONLY the content columns with a `version` check. `status`, `invoice_sent_at`, `completed_at`, `order_ref`, `deleted_at`, `checkout_ref`, `checkout_version` are written only by guarded `updateMany`s (`markInvoiceSent`, `markCompleted`, `softDelete`, `setCheckout`) that never bump `version`. Reason: a content save loaded before a concurrent completion must never re-open the draft, and recording the materialised session must not invalidate `checkout_version === version`.
3. **`setCheckout` is compare-and-set on `checkout_ref`.** Two concurrent materialisations cannot both win; the loser expires the session it just built and answers 409 `DRAFT_BUSY`. Reason: exactly one live session per draft.
4. **Editing a draft expires its open checkout session** (best effort, after the save commits). Reason: a customer already on the invoice checkout must not pay the superseded quote; re-opening the link re-materialises the new one (spec §4.7 decision).
5. **Merchant completion always builds a fresh session** (expiring the open one, which may belong to a customer who opened the link), except when the draft's current session is already completed — then the draft is healed and the call resumes. Reason: spec "Concurrency" — a merchant completion expires any open invoice session first.
6. **Completion is resumable.** `POST /draft-orders/:id/complete` on a draft whose session already became an order resumes `InitiatePayment` and, for `paid`, the confirmed collection (both idempotent), and answers the same `{ orderId, orderNumber }` — when the session's payment provider is the one asked for (`manual` for `paid`, `cod` for `collect_on_delivery`). Otherwise 409 `ALREADY_COMPLETED`. Reason: a network drop after the order exists must never strand a "paid" order unpaid, and must never create a second order.
7. **"Collect on delivery" needs cash on delivery enabled** in Settings → Payments; otherwise 409 `COD_NOT_ENABLED` before anything is created. Reason: the merchant's payment settings stay the one truth of what they accept, and `resolveForNewPayment`'s enablement rule is not weakened for `cod`.
8. **`manual` is a `recordedByStaff` provider.** A new optional capability `recordedByStaff` on `ProviderCapabilities`: never default-enabled, refused by `UpdateMerchantPaymentSettings`, absent from the settings read (so never offered to shoppers), and accepted by `resolveForNewPayment` without enablement. Selected only by the server for a draft session (`SelectDraftPayment` refuses any non-draft session). Reason: spec decision "never listed by `PaymentMethodPort.enabledMethods` nor in payment settings", while still opening an intent.
9. **Cash-to-collect excludes `manual` (binding carry 4).** `PaymentIntentSummary` gains `collectedOnDelivery = settledByOperatorConfirmation && !recordedByStaff`; `codCollectionState` keys on it. A draft completed as paid — even one whose settlement failed and is still pending — never prints "Collect" on a slip or CSV and is never offered to the bulk "Mark cash as received". `ConfirmCodCollection` still accepts `manual` (capability rule unchanged), which is how "Mark as paid" settles.
10. **Self-heal lives in `apps/admin`** (`healedDraft`), run by the draft detail read, the invoice-link route, the complete route and the invoice claim/preview — not inside `services/orders`. Reason: Orders must not import Checkout, and a port plus a lazy cell for one read is more wiring than the rule needs.
11. **`CompleteCheckout` reports; completion does not revoke.** After a draft session's order exists it calls `DraftOrderCompletionPort.complete(...)`, best effort after the commit. `CompleteCheckoutInput.actorRef` (set only by the admin complete route, never by the public `.strict()` body) names the merchant on the `created_from_draft` line; a shopper's payment writes a system line. A completed draft's invoice links are deliberately NOT revoked (the spec's §3.3 "revokes on … complete" yields to §4.7): a revoked link can only give the uniform 404 (binding carry 3), while §4.7 requires the landing page to say "This order has already been placed" (409 `ALREADY_COMPLETED`). The claim refuses a completed draft before anything is built, so such a link can do nothing else. Deletion revokes (Ruling 17).
12. **Prices.** Draft lines are re-priced from Catalog on every create/update (the browser sends ids and quantities only). Materialisation uses the prices stored at the last save — the quote the customer was sent is what they pay (spec "a draft's price is final"); stock is checked at completion. A `rate` shipping choice is re-quoted on every save from the draft's address and lines (422 when the method no longer applies).
13. **Discount title.** The order/checkout discount title is the draft discount's `reason`; admin-web fills an empty reason with its localized default ("Custom discount" / "خصم مخصص") before saving, so the stored title is what everyone sees. The API's own fallback for API callers is "Custom discount".
14. **Totals.** The draft list's total excludes tax (no per-row tax call); the detail, the editor and the invoice preview add the estimated tax from Checkout's own `TaxCalculationPort`. The editor shows the server's totals from the last save and says "Save to update totals" while dirty.
15. **Shipping rates need a saved draft with an address.** The "Add shipping or delivery" dialog saves first when there are unsaved changes, then asks `POST /draft-orders/:id/shipping-rates`.
16. **Search.** Drafts are searched by draft number (`D3` or `#D3`), contact email, contact phone, and the shipping recipient's name and phone — stored columns only, no Identity search.
17. **Delete.** Deleting revokes the draft's invoice links and expires its open session before the soft delete. A draft whose checkout became an order anyway is completed (`markCompleted` clears `deleted_at`): the order is the truth.
18. **Existing customer.** A `customerId` must be a customer of this shop (one Identity read); when no email is typed, the customer's email becomes the draft's contact email.
19. **409 codes.** Every 409 from the draft routes carries `code` and a message prefixed `CODE:` (`VERSION_CONFLICT`, `DRAFT_COMPLETED`, `ALREADY_COMPLETED`, `COD_NOT_ENABLED`, `DRAFT_BUSY`, `OUT_OF_STOCK`, `PAYMENT_NOT_RECORDED`), because admin-web's `MutationResult` "conflict" carries only the message.
20. **Limits.** Line quantity 1–9,999; at most 100 lines (spec); identical variants are merged into one line; reason ≤ 255 characters; custom shipping title ≤ 100; phone ≤ 32 characters. At least one line is needed to save (Shopify's editor).
21. **Invoice links.** Every "Send invoice" mints a new 30-day token (only its hash is stored, so a link cannot be shown twice); earlier links stay valid until they expire or the draft is deleted (a completed draft's link answers "already placed", Ruling 11). The draft's links are listed through a new `(tenant_id, draft_order_ref)` index.
22. **`transferOwnership` only for draft sessions** (and only while open). Reason: recovery never transfers a session; an invoice session is the only one designed to change hands.
23. **Invoice preview.** `GET /public/checkout-links/:token/preview` for an invoice answers `{ purpose: "invoice", draftNumber, completed, … }` from the draft itself (no materialisation on a GET); a completed draft previews with `completed: true` so the landing page says "This order has already been placed" before any button.
24. **Back-link.** The `created_from_draft` timeline line's JSON `data` gains `draftId` (no migration) so the order page links back to the draft.
25. **Role gate.** `/draft-orders` and its detail are `viewer` (drafts are `orders:read`); `/draft-orders/new` is `operator`. "Mark as paid" is shown to admins and disabled with a tooltip for others (spec §4.9).
26. **Product picker.** This branch has no discounts product picker to reuse; the editor gets a two-step picker (search products → choose a variant) over the existing `GET /products` and `GET /products/:id`.

## Global Constraints

Copied verbatim from the spec; every task's requirements include them.

1. **Migrations:** hand-written, additive SQL in `packages/db/prisma/schema/migrations/<ts>_<name>/
migration.sql`, never run against a real DB by the agent (owner deploys from Railway's Console
   before the release that reads them). Every new tenant table: `tenant_id TEXT NOT NULL`, `ENABLE` +
   `FORCE ROW LEVEL SECURITY`, `DROP POLICY IF EXISTS tenant_isolation …; CREATE POLICY
tenant_isolation … FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK
(same)` — exactly as `20261012000000_order_numbers`. Prisma models updated in the matching
   `*.prisma` file.
2. **Per-request tenant (ADR-0014):** new repositories take `tenantId` per call, reads go through
   `runReadScoped` (or the caller's `tx`), writes through the unit of work; nothing is pinned at
   construction (the only exemption stays `services/tenancy`). Each new Prisma repository gets a
   `tenant-isolation.test.ts` case like its siblings.
3. **admin-web:** runtime API only from server code (pages, server actions, route handlers); client
   components never value-import `lib/api/*` or `lib/auth/*` (type imports only); every string in
   `messages/en.ts` and `messages/ar.ts`; logical CSS (`ms-`/`pe-`/`start`/`end`, `rtl:` flips); one
   idempotency key per submit (`newIdempotencyKey()`).
4. **Public routes:** `public: true`, ownership by `sessionRef` from `x-cart-session`/body, uniform 404,
   `.strict()` bodies, DTOs never carry `sessionRef`.
5. **Shopify placement and wording:** the sidebar's Orders item gets children **Drafts** and
   **Abandoned checkouts**, in that order (Shopify's). Labels below are Shopify's English and the
   matching Arabic.

Anti-goals that bind Part 4 (verbatim):

- No client-supplied price, amount or rate on any public route; no merchant-browser-supplied price on
  any admin route added here (draft prices are resolved server-side from Catalog).
- No link that exposes, embeds or derives a guest `sessionRef`; no stored plaintext link token.
- No new way to mark an order paid that bypasses Payments (payment truth stays: a captured payment
  must exist for `order.paymentRef`).
- No change to the order lifecycle transition table and no annotation write that bumps the `Order`
  aggregate's `version` (a note edit must never conflict with a payment webhook).
- No skipping of stock reservation, discount re-check or guest-customer resolution when a draft becomes
  an order.

Permissions (verbatim rows used by Part 4):

| Permission                        | Who has it today via the role table | Used by                                                                                             |
| --------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `orders:read`                     | viewer, operator, admin             | lists, detail, drafts list/detail, abandoned list/detail, packing slips                             |
| `orders:draft`                    | operator, admin                     | create / update / delete drafts, issue invoice link                                                 |
| `orders:complete_draft`           | operator, admin                     | create the order from a draft (collect on delivery)                                                 |
| `payments:confirm_cod_collection` | admin                               | bulk "Mark cash as received"; draft "Mark as paid" (checked in addition to `orders:complete_draft`) |

Operators get `orders:draft` and `orders:complete_draft` from the existing `orders:*` grant in
`ROLE_PERMISSIONS` (`packages/auth/src/role-table-access-control.ts`), admins from `*:*`; viewers hold
only `orders:read`. No role-table code change — Task 1 pins it with a test.

Security and multi-tenancy (verbatim bullets that bind Part 4):

- **Tenant scoping.** Every new table has `tenant_id` + forced RLS `tenant_isolation`; every new
  repository method takes `tenantId` per call and reads through `runReadScoped` or the caller's `tx`;
  link lookup by token hash runs inside the request tenant's scope, so cross-shop tokens are unknown.
- **Links.** 256-bit random tokens, SHA-256 at rest, expiring (7 / 30 days), revocable, claim counted.
  The original guest `sessionRef` is never stored in, derived into, or returned by any link flow;
  recovery clones, invoice sessions use a server-minted `sessionRef` that is replaced by the claimer's
  own cookie value. Claims happen on an explicit user action, not on GET. Preview responses carry no
  email, phone or address.
- **Prices.** Public routes accept no amounts (claim body is `{ token, sessionRef }`); recovery
  re-prices from Catalog; draft lines are priced server-side; the only merchant-entered amounts are
  custom shipping and fixed discount on authenticated admin routes, bounded and validated.
- **Money.** Marking paid always produces a captured Payments record (`manual` provider, confirmed
  collection) and is admin-only; capture and COD settlement in bulk reuse the existing guarded calls.
- **Concurrency.** Annotations never touch the `Order` version; drafts use optimistic locking;
  completion is idempotent by `draft:<id>:<version>`; a merchant completion expires any open invoice
  session first, so a customer and the merchant cannot both create the order.

Part 4 numbers (spec §4.2–§4.8, verbatim values): migration `20261018030000_draft_orders`; draft numbers
`D1`, `D2`, … per shop (`last_draft_number` on `orders.order_number_counters`, a new shop's first draft
inserts `last_number = 1000` so its first order is still `#1001`); at most 100 lines; percentage 0–100;
merchant amounts ≥ 0 and ≤ 10,000,000 minor units; invoice link expiry 30 days; completion idempotency
key `draft:<draftId>:<version>`; discount entry `promotionId: "draft:<draftId>"`, `discountClass: "order"`;
storefront path `/c/<token>`.

Binding carries from earlier reviews (each is pinned by a named test in the owning task):

1. Link revocation is a guarded `updateMany` that writes only `revokedAt`; the link repository's `save()`
   never re-writes `claimCount`, `lastClaimedAt` or `resultCheckoutRef` (`recordClaim` is their only
   writer). **Task 4** (`revokeForDraft`, guarded `save`).
2. A route that issues a link token is NOT idempotent; the plaintext token never enters the response
   cache or logs (the server logs the route pattern only, never the URL). **Task 7**.
3. A revoked link answers the same uniform 404 `LINK_INVALID` (route-level test). **Task 7**.
4. Draft orders paid via `manual` and the COD predicate in `apps/admin/src/http/cod-collection.ts`:
   written down in Ruling 9; a draft completed as paid is never cash-to-collect. **Task 5** and **Task 7**.
5. admin-web middleware `ROUTE_ROLE_REQUIREMENTS` entries for `/draft-orders` (the existing "never sends
   an operator to /forbidden from a sidebar link" test fails without them). **Task 8**.
6. Tenant rules (ADR-0014): per-request tenant via `runReadScoped` or the caller's `tx`; no object field
   named `tenantId` outside the `tenancy` key (closures and parameters only — no class holds a tenant);
   raw SQL carries `"tenant_id" = ${tenantId}` in the statement itself; RLS `tenant_isolation` on
   `orders.draft_orders`. **Tasks 1, 2, 4**.
7. Migrations: hand-written additive SQL `20261018030000_draft_orders` with the matching Prisma change.
   **Never run `prisma migrate` (or any SQL) against a database; the owner deploys.** **Task 1**.
8. admin-web Arabic is Egyptian; storefront Arabic is MSA (house tone); the brand is "مربح". **Tasks 8–10**.
9. No client-supplied amounts: prices always from Catalog or from merchant-set draft terms validated
   server-side. **Tasks 6, 7**.
10. Server-only imports: client components never value-import admin-web `lib/api` or `lib/auth`.
    **Tasks 8, 9**.

Repository rules (from the owner): commit with
`git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit`, Conventional Commits in
lower case, body lines ≤ 100 chars, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`,
never `--no-verify`. Stage only the task's own files (`git add <paths>`), never `.superpowers/` or
`.claude/`. Keep each file's existing line endings (the owner's checkouts are CRLF via
`core.autocrlf`; never mass-convert a file).

## Review Focus

The five failure modes the spec implies but its test list does not exercise, most likely first. Each
line names the task whose tests pin it.

1. **The merchant edits a draft while the customer is already on the invoice checkout** → the customer
   can no longer place the superseded quote (their session is expired by the edit), and re-opening the
   same link shows the new total. Pinned in **Task 7** (`draft-order-invoice.test.ts` "an edit expires
   the open invoice checkout; the link re-opens at the new total").
2. **"Mark as paid" retried after a network drop** (the order was created, the settlement did not
   answer) → one order, one captured `manual` payment; the retry answers the same order. Pinned in
   **Task 7** (`draft-order-complete.test.ts` "a retry after the order exists resumes, never a second
   order").
3. **A drafted variant is unpublished, deleted or sold out between save and completion** → the save
   names the line (422 `lines.N`), completion answers `OUT_OF_STOCK:` and no order or payment is left
   behind. Pinned in **Task 6** (save refuses an unavailable variant) and **Task 7** (out of stock).
4. **A discount larger than the subtotal, or 100 %** → the discount is capped at the subtotal and no
   total is ever negative (draft, checkout and order agree). Pinned in **Task 1**
   (`draftAmounts` table) and **Task 3** (`applyDraftTerms` refuses a discount above the subtotal).
5. **A guest phone typed as `01001234567`, in Arabic-Indic digits, or none at all** → "Share on
   WhatsApp" opens the right chat (draft phone, else the shipping phone), or WhatsApp's chat picker.
   Pinned in **Task 9** (`draftWhatsAppTarget` table, reusing `toWhatsAppDigits`).

---

## File Structure

**packages/db**

- `prisma/schema/migrations/20261018030000_draft_orders/migration.sql` — `orders.draft_orders` + RLS, `last_draft_number`, `checkout_sessions.draft_terms`, the `checkout_links (tenant_id, draft_order_ref)` index.
- `prisma/schema/orders.prisma` — model `DraftOrder`; `OrderNumberCounter.lastDraftNumber`.
- `prisma/schema/checkout.prisma` — `CheckoutSession.draftTerms`; `CheckoutLink @@index([tenantId, draftOrderRef])`.
- `src/schema-migration-consistency.test.ts` — asserts the migration matches the models.

**packages/auth**

- `src/role-table-access-control.test.ts` — pins `orders:draft` / `orders:complete_draft` (no code change).

**services/orders**

- `src/domain/draft-order.ts` — `DraftOrder`, content types, `normalizeDraftContent`, `draftAmounts`, `draftRequirements`, limits.
- `src/domain/draft-order-repository.ts` — `DraftOrderRepository`, `DraftNumberAllocator` ports, query/page types.
- `src/domain/order-timeline.ts` — `OrderTimelineData.draftId`.
- `src/infrastructure/in-memory-draft-order-repository.ts`, `prisma-draft-order-repository.ts`, `in-memory-draft-number-allocator.ts`, `prisma-draft-number-allocator.ts`, `draft-order-rows.ts` (JSON ↔ content).
- `src/infrastructure/prisma-order-timeline-repository.ts` — reads `draftId`.
- `src/application/draft-orders.use-cases.ts` — the eight use cases.
- `src/interfaces/order.controller.ts`, `src/composition.ts`, `src/index.ts` — wiring/exports.

**services/checkout**

- `src/domain/value-objects/draft-terms.ts` — `DraftTerms`, `DRAFT_LOCKED`, `DRAFT_SHIPPING_METHOD`, `draftPromotionId`.
- `src/domain/checkout-session.ts` — `draftTerms`, `applyDraftTerms`, `transferOwnership`, draft locks.
- `src/domain/checkout-link.ts` — `INVOICE_LINK_TTL_MS`.
- `src/domain/checkout-link-repository.ts` + both link repositories — guarded `save`, `revokeForDraft`, `listForDraft`.
- `src/domain/abandoned-checkouts.ts`, `src/infrastructure/prisma-checkout-session-repository.ts` — draft sessions are never abandoned; `sessionRef`/`draftTerms` persisted.
- `src/infrastructure/checkout-session.mapper.ts` — `draft_terms`.
- `src/application/discount-code.use-cases.ts` — `refreshDiscounts` leaves a draft's snapshot alone.
- `src/application/address-province.ts` — `checkoutAddressProblem`.
- `src/application/draft-checkout.use-cases.ts` — `StartDraftCheckout`, `SelectDraftPayment`, `QuoteDraftShipping`, `EstimateDraftTax`, `IssueInvoiceLink`, `ClaimInvoiceCheckout`, `RevokeDraftLinks`, `ListDraftLinks`.
- `src/application/abandoned-checkouts.use-cases.ts` — `ResolveCheckoutLink` invoice branch.
- `src/application/complete-checkout.use-case.ts`, `src/application/ports.ts` — `DraftOrderCompletionPort`, `actorRef`.
- `src/interfaces/checkout.controller.ts`, `src/composition.ts`, `src/index.ts`.

**services/payments**

- `src/domain/value-objects/provider-capabilities.ts` — `recordedByStaff`, `isCollectedOnDelivery`.
- `src/infrastructure/manual-payment-provider.ts`, `built-in-provider-registrations.ts` — `manual`.
- `src/infrastructure/tenant-payment-provider-resolver.ts`, `src/application/merchant-payment-settings.use-cases.ts`, `src/application/get-payment-intents-by-ids.use-case.ts`.

**apps/admin**

- `src/http/cod-collection.ts` — keys on `collectedOnDelivery`.
- `src/http/public-checkout-routes.ts` — `DRAFT_LOCKED`, `draftInvoice` on the DTO.
- `src/infrastructure/cross-context/discount-usage.adapter.ts` — skips `draft:` entries.
- `src/infrastructure/cross-context/draft-order-completion.adapter.ts` — the port's adapter.
- `src/interfaces/draft-orders.admin-controller.ts` — the guarded facade.
- `src/http/draft-order-dto.ts`, `draft-order-pricing.ts`, `draft-order-checkout.ts`, `draft-order-routes.ts`.
- `src/http/public-checkout-link-routes.ts` — invoice claim and preview.
- `src/http/order-timeline-dto.ts` — `draftId`.
- `src/composition.ts`, `src/http/admin-routes.ts`.
- `src/http/testing/draft-harness.ts` — test world.

**apps/admin-web**

- `src/middleware.ts`, `src/components/navigation.ts`, `src/components/create-menu.tsx`.
- `src/lib/api/draft-orders.ts`, `src/lib/orders/draft-orders.ts`.
- `src/app/draft-orders/page.tsx`, `new/page.tsx`, `[draftId]/page.tsx`, `actions.ts`.
- `src/components/draft-orders/*` — table, filters, editor, products card, picker, payment card, customer card, send-invoice dialog.
- `src/app/orders/new/page.tsx` (redirect), `src/app/orders/page.tsx`, `src/app/orders/actions.ts`; delete `components/orders/order-create-form.tsx` (+ test).
- `src/lib/orders/order-timeline.ts`, `src/components/orders/order-timeline.tsx`, `src/lib/api/orders.ts` — draft back-link.
- `src/messages/en.ts`, `src/messages/ar.ts`.

**apps/storefront**

- `src/lib/runtime-api.ts`, `src/app/c/[token]/page.tsx`, `src/app/c/[token]/actions.ts`, `src/components/checkout-view.tsx`, `src/app/checkout/page.tsx`, `src/messages/en.ts`, `src/messages/ar.ts`.

## Commands

- Tests: `pnpm --filter <pkg> test`; one file: `pnpm --filter <pkg> exec vitest run <file>`.
- `pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> lint` (admin lint:
  `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint`; same variable for admin-web).
- Packages: `@platform/db`, `@platform/auth`, `@platform/orders`, `@platform/checkout`, `@platform/payments`, `@platform/admin`, `admin-web`, `storefront`.
- Prisma (dummy URLs, never a real DB):
  `DATABASE_URL=postgresql://u:p@localhost:5432/x DIRECT_URL=postgresql://u:p@localhost:5432/x pnpm --filter @platform/db exec prisma validate`
  and the same with `prisma generate` after a schema change. **Never `prisma migrate` anything.**
- Tenant-filter guard: `node scripts/dev/check-prisma-tenant-where.mjs`. Known environment issue:
  `packages/db/src/prisma-tenant-where.guard.test.ts` cannot load from a path with a space, so run the
  script directly. It has ONE known pre-existing finding at `discounts.admin-controller.ts:166`; any
  other finding is yours to fix. Every new `findMany/findFirst/updateMany` names `tenantId` in a literal `where`.
- `next build` fails with `EPERM` on this machine — do not rely on it; `typecheck`, `lint` and `test`
  are the gates for admin-web and storefront.
- Integration tests run only with `DATABASE_URL_TEST` set (skipped otherwise; never point it at a real database).

Commit template used by every task (replace subject/body):

```bash
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
<type>(<scope>): <lower-case subject>

<body, lines <= 100 chars>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 1: Storage, the permission pin, and the `DraftOrder` model with its repositories and numbers

Model tier: **standard** (SQL must match Prisma's DDL exactly; the guarded writes are fully specified below).

**Files:**

- Create: `packages/db/prisma/schema/migrations/20261018030000_draft_orders/migration.sql`
- Modify: `packages/db/prisma/schema/orders.prisma` (new model `DraftOrder` after `OrderTimelineEntry`; `OrderNumberCounter.lastDraftNumber`)
- Modify: `packages/db/prisma/schema/checkout.prisma` (`CheckoutSession.draftTerms`; `CheckoutLink @@index([tenantId, draftOrderRef])`)
- Modify: `packages/db/src/schema-migration-consistency.test.ts` (append a `describe`)
- Modify: `packages/auth/src/role-table-access-control.test.ts` (append one `it` in the last `describe`)
- Create: `services/orders/src/domain/draft-order.ts`, `services/orders/src/domain/draft-order.test.ts`
- Create: `services/orders/src/domain/draft-order-repository.ts`
- Create: `services/orders/src/infrastructure/draft-order-rows.ts`
- Create: `services/orders/src/infrastructure/in-memory-draft-order-repository.ts`
- Create: `services/orders/src/infrastructure/prisma-draft-order-repository.ts`
- Create: `services/orders/src/infrastructure/draft-order-repository.contract.test.ts`
- Create: `services/orders/src/infrastructure/prisma-draft-order-repository.integration.test.ts`
- Create: `services/orders/src/infrastructure/in-memory-draft-number-allocator.ts`, `prisma-draft-number-allocator.ts`, `prisma-draft-number-allocator.test.ts`
- Modify: `services/orders/src/infrastructure/tenant-isolation.test.ts` (append a `describe`)

**Interfaces:**

- Consumes: `createFakePrisma` (`@platform/db/testing`), `runReadScoped`, `Database`, `TransactionClient` (`@platform/db`); `normalizeNote`, `parseTags`, `MAX_TAGS_PER_ORDER`, `characterCount` (`../domain/order-tags`); `uuidsOf` (`./order-list-where`); `escapeLike` (`./prisma-order-annotation-repository`); `FIRST_ORDER_NUMBER` (`../domain/value-objects/order-number`).
- Produces:
  - Prisma: `model DraftOrder` → delegate `client.draftOrder`; `OrderNumberCounter.lastDraftNumber: Int`; `CheckoutSession.draftTerms: Json`; `CheckoutLink @@index([tenantId, draftOrderRef])`.
  - `draft-order.ts`: `DRAFT_ORDER_STATUSES`, `type DraftOrderStatus = "open" | "invoice_sent" | "completed"`, `MAX_DRAFT_LINES = 100`, `MAX_DRAFT_LINE_QUANTITY = 9999`, `MAX_DRAFT_AMOUNT_MINOR = 10_000_000`, `DRAFT_PAGE_SIZE_MAX = 50`, `DEFAULT_DRAFT_DISCOUNT_TITLE = "Custom discount"`, `FREE_SHIPPING_TITLE = "Free shipping"`, `interface DraftAddress { name: string|null; phone: string|null; line1; line2: string|null; city; province: string|null; postalCode; country }`, `interface DraftLine { productRef; variantRef; sku; title; variantTitle: string|null; quantity; unitPriceMinor }`, `interface DraftDiscount { valueType: "fixed"|"percentage"; value; reason: string|null }`, `type DraftShipping = { kind: "rate"; method; title; amountMinor } | { kind: "custom"; title; amountMinor } | { kind: "free"; title; amountMinor }`, `interface DraftOrderContent`, `interface DraftOrderSnapshot`, `type DraftRequirement = "lines" | "shipping_address" | "shipping" | "email"`, `interface DraftAmounts { subtotalMinor; discountMinor; shippingMinor; totalBeforeTaxMinor }`, `normalizeDraftContent(raw): Result<DraftOrderContent, ValidationError>`, `draftAmounts(content): DraftAmounts`, `draftRequirements(content, purpose: "invoice" | "complete"): DraftRequirement[]`, `normalizeDraftSearch(raw?: string): string | undefined`, `clampDraftPageSize(first?: number): number`, `class DraftOrder { static create(input: CreateDraftOrderProps): Result<DraftOrder, ValidationError>; static reconstitute(s): DraftOrder; revise(content, now): Result<void, DomainError>; content(): DraftOrderContent; snapshot(); readonly isNew; isEditable; getters for every snapshot field }`.
  - `draft-order-repository.ts`: `DraftOrderQuery { status?; search?; first?; after? }`, `DraftOrderPage { items: readonly DraftOrder[]; pageInfo }`, `DraftOrderRepository { save(draft, tenantId, tx?); findById(id, tenantId, tx?); list(query, tenantId); markInvoiceSent(id, at, tenantId, tx?): Promise<boolean>; markCompleted(id, { orderRef, at }, tenantId, tx?): Promise<boolean>; softDelete(id, at, tenantId, tx?): Promise<boolean>; setCheckout(id, { checkoutRef, checkoutVersion }, expectedCheckoutRef: string | null, tenantId, tx?): Promise<boolean> }`, `DraftNumberAllocator { next(tenantId, tx?): Promise<string> }`.
  - `InMemoryDraftOrderRepository` (no deps), `PrismaDraftOrderRepository({ prisma })`, `InMemoryDraftNumberAllocator`, `PrismaDraftNumberAllocator`, `draft-order-rows.ts`: `draftFromRow`, `contentColumns`, `matchesDraftSearch`.
  - Permission pinned: operator/admin hold `orders:draft` and `orders:complete_draft`; viewer does not.

- [ ] **Step 1: Write the failing migration test and the permission pin**

Append to `packages/db/src/schema-migration-consistency.test.ts`:

```ts
describe("orders and checkout schema — draft orders (order operations Part 4)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((dir) => readFileSync(join(migrationsDir, dir, "migration.sql"), "utf-8"))
    .join("\n");

  it("draft_orders has the model's columns, the per-shop number key, the status index and the check", () => {
    expect([...columnsEverAddedTo("orders", "draft_orders", allSql)].sort()).toEqual([
      "billing_address",
      "checkout_ref",
      "checkout_version",
      "completed_at",
      "contact_email",
      "contact_phone",
      "created_at",
      "created_by",
      "currency",
      "customer_ref",
      "deleted_at",
      "discount",
      "draft_number",
      "id",
      "invoice_sent_at",
      "lines",
      "note",
      "order_ref",
      "shipping",
      "shipping_address",
      "status",
      "tags",
      "tenant_id",
      "updated_at",
      "version",
    ]);
    expect(allSql).toContain(
      'CREATE UNIQUE INDEX "draft_orders_tenant_id_draft_number_key" ON "orders"."draft_orders"("tenant_id", "draft_number");',
    );
    expect(allSql).toContain(
      'CREATE INDEX "draft_orders_tenant_id_status_idx" ON "orders"."draft_orders"("tenant_id", "status");',
    );
    expect(allSql).toContain(
      `CONSTRAINT "draft_orders_status_check" CHECK ("status" IN ('open','invoice_sent','completed'))`,
    );
  });

  it("draft_orders is RLS-forced with the tenant_isolation policy", () => {
    expect(allSql).toContain('ALTER TABLE "orders"."draft_orders" ENABLE ROW LEVEL SECURITY;');
    expect(allSql).toContain('ALTER TABLE "orders"."draft_orders" FORCE ROW LEVEL SECURITY;');
    expect(allSql).toContain('DROP POLICY IF EXISTS tenant_isolation ON "orders"."draft_orders";');
    expect(allSql).toContain('CREATE POLICY tenant_isolation ON "orders"."draft_orders" FOR ALL');
  });

  it("the counter gains last_draft_number, sessions gain draft_terms, links get the draft index", () => {
    expect(
      columnsEverAddedTo("orders", "order_number_counters", allSql).has("last_draft_number"),
    ).toBe(true);
    expect(columnsEverAddedTo("checkout", "checkout_sessions", allSql).has("draft_terms")).toBe(
      true,
    );
    expect(allSql).toContain(
      'CREATE INDEX "checkout_links_tenant_id_draft_order_ref_idx" ON "checkout"."checkout_links"("tenant_id", "draft_order_ref");',
    );
  });
});
```

Append inside the LAST `describe` of `packages/auth/src/role-table-access-control.test.ts`:

```ts
it("operators and admins build and complete drafts; viewers only read them (orders Part 4)", async () => {
  for (const permission of ["orders:draft", "orders:complete_draft"]) {
    expect(await acl.authorize(who(["operator"]), permission), permission).toBe(true);
    expect(await acl.authorize(who(["admin"]), permission), permission).toBe(true);
    expect(await acl.authorize(who(["platform-admin"]), permission), permission).toBe(true);
    expect(await acl.authorize(who(["viewer"]), permission), permission).toBe(false);
  }
  // "Mark as paid" also needs the money permission, which stays admin-only.
  expect(await acl.authorize(who(["operator"]), "payments:confirm_cod_collection")).toBe(false);
});
```

- [ ] **Step 2: Run them**

Run: `pnpm --filter @platform/db exec vitest run src/schema-migration-consistency.test.ts`
Expected: FAIL — the three new tests (no `draft_orders` columns, missing strings).
Run: `pnpm --filter @platform/auth exec vitest run src/role-table-access-control.test.ts`
Expected: PASS (the pin documents the existing `orders:*` grant; it must keep passing).

- [ ] **Step 3: Write the migration**

`packages/db/prisma/schema/migrations/20261018030000_draft_orders/migration.sql`:

```sql
-- Order operations Part 4 — draft orders and the invoice link. Written by hand, NOT applied by the
-- agent; the owner deploys it from Railway's Console BEFORE the release that reads it, after
-- 20261018000000_order_archive, 20261018010000_order_notes_tags_timeline and
-- 20261018020000_checkout_recovery_links (all still undeployed). Additive only, no backfill.

-- A draft a merchant builds for a phone/WhatsApp customer. JSON columns use {} / [] for "unset", like
-- the checkout snapshots. status, invoice_sent_at, completed_at, order_ref, deleted_at, checkout_ref
-- and checkout_version are written by guarded updates only, never by the versioned content save.
CREATE TABLE "orders"."draft_orders" (
  "id"               UUID NOT NULL,
  "tenant_id"        TEXT NOT NULL,
  "draft_number"     TEXT NOT NULL,
  "status"           TEXT NOT NULL,
  "currency"         TEXT NOT NULL,
  "customer_ref"     TEXT,
  "contact_email"    TEXT,
  "contact_phone"    TEXT,
  "shipping_address" JSONB NOT NULL DEFAULT '{}',
  "billing_address"  JSONB NOT NULL DEFAULT '{}',
  "lines"            JSONB NOT NULL DEFAULT '[]',
  "discount"         JSONB NOT NULL DEFAULT '{}',
  "shipping"         JSONB NOT NULL DEFAULT '{}',
  "note"             TEXT,
  "tags"             JSONB NOT NULL DEFAULT '[]',
  "checkout_ref"     TEXT,
  "checkout_version" INTEGER,
  "order_ref"        TEXT,
  "invoice_sent_at"  TIMESTAMP(3),
  "completed_at"     TIMESTAMP(3),
  "deleted_at"       TIMESTAMP(3),
  "created_by"       TEXT NOT NULL,
  "version"          INTEGER NOT NULL DEFAULT 0,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "draft_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "draft_orders_status_check" CHECK ("status" IN ('open','invoice_sent','completed'))
);
CREATE UNIQUE INDEX "draft_orders_tenant_id_draft_number_key" ON "orders"."draft_orders"("tenant_id", "draft_number");
CREATE INDEX "draft_orders_tenant_id_status_idx" ON "orders"."draft_orders"("tenant_id", "status");
ALTER TABLE "orders"."draft_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders"."draft_orders" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "orders"."draft_orders";
CREATE POLICY tenant_isolation ON "orders"."draft_orders" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Draft numbers D1, D2, … share the shop's counter row with order numbers (one atomic upsert).
ALTER TABLE "orders"."order_number_counters" ADD COLUMN "last_draft_number" INTEGER NOT NULL DEFAULT 0;

-- A draft's checkout carries the merchant's fixed terms ({} = an ordinary checkout).
ALTER TABLE "checkout"."checkout_sessions" ADD COLUMN "draft_terms" JSONB NOT NULL DEFAULT '{}';

-- A draft's invoice links (detail page; revocation on complete/delete).
CREATE INDEX "checkout_links_tenant_id_draft_order_ref_idx" ON "checkout"."checkout_links"("tenant_id", "draft_order_ref");
```

- [ ] **Step 4: Update the Prisma models**

In `packages/db/prisma/schema/orders.prisma`, `model OrderNumberCounter`, add after `lastNumber`:

```prisma
  lastDraftNumber Int    @default(0) @map("last_draft_number") // Part 4: D1, D2, … (same atomic upsert row)
```

Append after `model OrderTimelineEntry`:

```prisma
/// Order operations Part 4 — a draft order a merchant builds for a phone/WhatsApp customer. Content
/// columns are saved with `version`; status/checkout/deletion columns only by guarded updates.
model DraftOrder {
  id              String    @id @db.Uuid
  tenantId        String    @map("tenant_id")
  draftNumber     String    @map("draft_number") // "D1", "D2", … per shop
  status          String // open | invoice_sent | completed (CHECK + domain-enforced)
  currency        String
  customerRef     String?   @map("customer_ref") // bare id into Identity — never an FK
  contactEmail    String?   @map("contact_email")
  contactPhone    String?   @map("contact_phone")
  shippingAddress Json      @default("{}") @map("shipping_address")
  billingAddress  Json      @default("{}") @map("billing_address") // {} = same as shipping
  lines           Json      @default("[]")
  discount        Json      @default("{}")
  shipping        Json      @default("{}")
  note            String?
  tags            Json      @default("[]")
  checkoutRef     String?   @map("checkout_ref") // bare id into Checkout — never an FK
  checkoutVersion Int?      @map("checkout_version")
  orderRef        String?   @map("order_ref") // bare id into Orders — never an FK
  invoiceSentAt   DateTime? @map("invoice_sent_at")
  completedAt     DateTime? @map("completed_at")
  deletedAt       DateTime? @map("deleted_at")
  createdBy       String    @map("created_by")
  version         Int       @default(0)
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@unique([tenantId, draftNumber])
  @@index([tenantId, status])
  @@map("draft_orders")
  @@schema("orders")
}
```

In `packages/db/prisma/schema/checkout.prisma`, `model CheckoutSession`, add after `recoveredOrderRef`:

```prisma
  draftTerms        Json     @default("{}") @map("draft_terms") // Part 4: a draft's fixed discount/shipping; {} = none
```

and in `model CheckoutLink` add after `@@index([tenantId, checkoutSessionId])`:

```prisma
  @@index([tenantId, draftOrderRef])
```

Run: `DATABASE_URL=postgresql://u:p@localhost:5432/x DIRECT_URL=postgresql://u:p@localhost:5432/x pnpm --filter @platform/db exec prisma validate` → valid; the same with `prisma generate`.
Run: `pnpm --filter @platform/db exec vitest run src/schema-migration-consistency.test.ts` → PASS.

- [ ] **Step 5: Write the failing domain test**

`services/orders/src/domain/draft-order.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DraftOrder,
  draftAmounts,
  draftRequirements,
  MAX_DRAFT_LINES,
  normalizeDraftContent,
  normalizeDraftSearch,
  type DraftLine,
  type DraftOrderContent,
} from "./draft-order";

const NOW = new Date("2026-10-25T10:00:00.000Z");
const line = (over: Partial<DraftLine> = {}): DraftLine => ({
  productRef: "11111111-1111-7111-8111-111111111111",
  variantRef: "22222222-2222-7222-8222-222222222222",
  sku: "TEE-M",
  title: "Tee",
  variantTitle: "M",
  quantity: 2,
  unitPriceMinor: 25000,
  ...over,
});
const ADDRESS = {
  name: "Mona Ali",
  phone: "01001234567",
  line1: "5 Nile St",
  line2: null,
  city: "Cairo",
  province: "EG-C",
  postalCode: "",
  country: "EG",
};
const content = (over: Partial<DraftOrderContent> = {}): DraftOrderContent => ({
  customerRef: null,
  contactEmail: null,
  contactPhone: null,
  shippingAddress: ADDRESS,
  billingAddress: null,
  lines: [line()],
  discount: null,
  shipping: { kind: "custom", title: "Courier", amountMinor: 5000 },
  note: null,
  tags: [],
  ...over,
});
function value<T>(
  r: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: Error },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}
const fieldsOf = (r: { readonly ok: boolean; readonly error?: unknown }): string[] =>
  r.ok ? [] : ((r.error as { fields?: { field: string }[] }).fields ?? []).map((f) => f.field);

describe("draftAmounts (Review Focus 4)", () => {
  it.each([
    ["no discount", null, 50000, 0],
    ["fixed below subtotal", { valueType: "fixed", value: 7000, reason: null }, 50000, 7000],
    [
      "fixed above subtotal is capped",
      { valueType: "fixed", value: 90000, reason: null },
      50000,
      50000,
    ],
    ["10 %", { valueType: "percentage", value: 10, reason: null }, 50000, 5000],
    ["100 %", { valueType: "percentage", value: 100, reason: null }, 50000, 50000],
    [
      "percentage rounds to the nearest minor unit",
      { valueType: "percentage", value: 15, reason: null },
      333,
      50,
    ],
  ] as const)("%s", (_name, discount, subtotal, expected) => {
    const amounts = draftAmounts({
      lines: [line({ quantity: 1, unitPriceMinor: subtotal })],
      discount,
      shipping: { kind: "custom", title: "Courier", amountMinor: 5000 },
    });
    expect(amounts.subtotalMinor).toBe(subtotal);
    expect(amounts.discountMinor).toBe(expected);
    expect(amounts.totalBeforeTaxMinor).toBe(subtotal - expected + 5000);
    expect(amounts.totalBeforeTaxMinor).toBeGreaterThanOrEqual(0);
  });
});

describe("normalizeDraftContent", () => {
  it("merges identical variants, trims, drops blanks and dedupes tags", () => {
    const normalized = value(
      normalizeDraftContent(
        content({
          lines: [line({ quantity: 1 }), line({ quantity: 3 })],
          contactEmail: "  sara@example.com ",
          contactPhone: "   ",
          note: "  call first  ",
          tags: ["VIP", "vip", "urgent, gift"],
          discount: { valueType: "fixed", value: 1000, reason: "  " },
        }),
      ),
    );
    expect(normalized.lines).toHaveLength(1);
    expect(normalized.lines[0]?.quantity).toBe(4);
    expect(normalized.contactEmail).toBe("sara@example.com");
    expect(normalized.contactPhone).toBeNull();
    expect(normalized.note).toBe("call first");
    expect(normalized.tags).toEqual(["VIP", "urgent", "gift"]);
    expect(normalized.discount).toEqual({ valueType: "fixed", value: 1000, reason: null });
  });

  const many = Array.from({ length: MAX_DRAFT_LINES + 1 }, (_, i) =>
    line({ variantRef: `v-${i}` }),
  );
  it.each([
    ["no lines", { lines: [] }, "lines"],
    ["too many lines", { lines: many }, "lines"],
    ["quantity 0", { lines: [line({ quantity: 0 })] }, "lines.0.quantity"],
    ["quantity 10000", { lines: [line({ quantity: 10000 })] }, "lines.0.quantity"],
    [
      "percentage 101",
      { discount: { valueType: "percentage", value: 101, reason: null } },
      "discount.value",
    ],
    [
      "fixed above the cap",
      { discount: { valueType: "fixed", value: 10_000_001, reason: null } },
      "discount.value",
    ],
    [
      "negative shipping",
      { shipping: { kind: "custom", title: "X", amountMinor: -1 } },
      "shipping.amountMinor",
    ],
    [
      "blank custom shipping title",
      { shipping: { kind: "custom", title: " ", amountMinor: 1 } },
      "shipping.title",
    ],
    ["a bad email", { contactEmail: "not-an-email" }, "email"],
    [
      "an address without a city",
      { shippingAddress: { ...ADDRESS, city: " " } },
      "shippingAddress.city",
    ],
  ] as const)("refuses %s", (_name, over, field) => {
    expect(fieldsOf(normalizeDraftContent(content(over as Partial<DraftOrderContent>)))).toContain(
      field,
    );
  });

  it("gives free shipping its title and a zero amount", () => {
    const normalized = value(
      normalizeDraftContent(content({ shipping: { kind: "free", title: "", amountMinor: 0 } })),
    );
    expect(normalized.shipping).toEqual({ kind: "free", title: "Free shipping", amountMinor: 0 });
  });
});

describe("draftRequirements", () => {
  it("an invoice needs lines, an address and a shipping choice; completing a guest also needs an email", () => {
    const bare = content({ shippingAddress: null, shipping: null });
    expect(draftRequirements(bare, "invoice")).toEqual(["shipping_address", "shipping"]);
    expect(draftRequirements(bare, "complete")).toEqual(["shipping_address", "shipping", "email"]);
    expect(draftRequirements(content({ contactEmail: "a@b.co" }), "complete")).toEqual([]);
    expect(draftRequirements(content({ customerRef: "c-1" }), "complete")).toEqual([]);
    expect(draftRequirements(content({ contactPhone: "0100" }), "complete")).toEqual(["email"]);
  });
});

describe("DraftOrder", () => {
  const created = () =>
    value(
      DraftOrder.create({
        id: "33333333-3333-7333-8333-333333333333",
        draftNumber: "D1",
        currency: "EGP",
        createdBy: "staff-op",
        now: NOW,
        content: content(),
      }),
    );

  it("starts open, new, version 0", () => {
    const draft = created();
    expect(draft.isNew).toBe(true);
    expect(draft.status).toBe("open");
    expect(draft.version).toBe(0);
    expect(draft.isEditable).toBe(true);
  });

  it("refuses to revise a completed or a deleted draft", () => {
    const base = created().snapshot();
    for (const snapshot of [
      { ...base, status: "completed" as const, orderRef: "o-1", completedAt: NOW },
      { ...base, deletedAt: NOW },
    ]) {
      const result = DraftOrder.reconstitute(snapshot).revise(content(), NOW);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/^DRAFT_(COMPLETED|DELETED):/);
    }
  });

  it("revises the content and the update time", () => {
    const draft = DraftOrder.reconstitute(created().snapshot());
    const later = new Date(NOW.getTime() + 60_000);
    expect(draft.revise(content({ note: "new" }), later).ok).toBe(true);
    expect(draft.note).toBe("new");
    expect(draft.updatedAt).toEqual(later);
  });
});

describe("normalizeDraftSearch", () => {
  it("strips the # and trims; blank is none", () => {
    expect(normalizeDraftSearch(" #D3 ")).toBe("D3");
    expect(normalizeDraftSearch("   ")).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @platform/orders exec vitest run src/domain/draft-order.test.ts`
Expected: FAIL — `Cannot find module './draft-order'`.

- [ ] **Step 7: Write the domain**

`services/orders/src/domain/draft-order.ts`:

```ts
import { err, ok, type Result } from "@platform/types";
import {
  BusinessRuleError,
  type DomainError,
  type FieldIssue,
  ValidationError,
} from "@platform/utils";
import { characterCount, MAX_TAGS_PER_ORDER, normalizeNote, parseTags } from "./order-tags";

/** What a draft is (spec §4.2) — mirrored by the migration's CHECK. */
export const DRAFT_ORDER_STATUSES = ["open", "invoice_sent", "completed"] as const;
export type DraftOrderStatus = (typeof DRAFT_ORDER_STATUSES)[number];

/** Spec §4.3 and Ruling 20. */
export const MAX_DRAFT_LINES = 100;
export const MAX_DRAFT_LINE_QUANTITY = 9999;
/** Spec §4.8: merchant-entered amounts are ≥ 0 and ≤ 10,000,000 minor units. */
export const MAX_DRAFT_AMOUNT_MINOR = 10_000_000;
export const DRAFT_PAGE_SIZE_MAX = 50;
export const DRAFT_SEARCH_MAX_LENGTH = 100;
/** Ruling 13: the API's own fallback title; admin-web always sends a localized reason. */
export const DEFAULT_DRAFT_DISCOUNT_TITLE = "Custom discount";
export const FREE_SHIPPING_TITLE = "Free shipping";
const MAX_REASON_LENGTH = 255;
const MAX_SHIPPING_TITLE_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_PHONE_LENGTH = 32;
const MAX_ADDRESS_FIELD_LENGTH = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIVE_STATUSES: readonly DraftOrderStatus[] = ["open", "invoice_sent"];

export interface DraftAddress {
  readonly name: string | null;
  readonly phone: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  /** ISO 3166-2; checked against the country by Checkout's address rule in the admin route. */
  readonly province: string | null;
  readonly postalCode: string;
  /** ISO 3166-1 alpha-2, upper case. */
  readonly country: string;
}

/** A catalog variant, priced SERVER-side at the last save (Ruling 12). */
export interface DraftLine {
  readonly productRef: string;
  readonly variantRef: string;
  readonly sku: string;
  readonly title: string;
  readonly variantTitle: string | null;
  readonly quantity: number;
  readonly unitPriceMinor: number;
}

export interface DraftDiscount {
  readonly valueType: "fixed" | "percentage";
  /** Minor units (fixed) or a whole percentage 0–100. */
  readonly value: number;
  /** Shown as the discount's title; null → {@link DEFAULT_DRAFT_DISCOUNT_TITLE}. */
  readonly reason: string | null;
}

export type DraftShipping =
  | {
      readonly kind: "rate";
      readonly method: string;
      readonly title: string;
      readonly amountMinor: number;
    }
  | { readonly kind: "custom"; readonly title: string; readonly amountMinor: number }
  | { readonly kind: "free"; readonly title: string; readonly amountMinor: number };

export interface DraftOrderContent {
  readonly customerRef: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly shippingAddress: DraftAddress | null;
  /** null = same as shipping. */
  readonly billingAddress: DraftAddress | null;
  readonly lines: readonly DraftLine[];
  readonly discount: DraftDiscount | null;
  readonly shipping: DraftShipping | null;
  readonly note: string | null;
  readonly tags: readonly string[];
}

export interface DraftOrderSnapshot extends DraftOrderContent {
  readonly id: string;
  readonly draftNumber: string;
  readonly status: DraftOrderStatus;
  readonly currency: string;
  readonly checkoutRef: string | null;
  readonly checkoutVersion: number | null;
  readonly orderRef: string | null;
  readonly invoiceSentAt: Date | null;
  readonly completedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly createdBy: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** What a draft still needs before an invoice can be sent or the order created (spec §4.5). */
export type DraftRequirement = "lines" | "shipping_address" | "shipping" | "email";

export interface DraftAmounts {
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly shippingMinor: number;
  /** subtotal − discount + shipping; tax is added by the caller (Checkout's tax port). */
  readonly totalBeforeTaxMinor: number;
}

/** Spec §4.3: one order-level discount on the subtotal, capped at it; never a negative total. */
export function draftAmounts(
  content: Pick<DraftOrderContent, "lines" | "discount" | "shipping">,
): DraftAmounts {
  const subtotalMinor = content.lines.reduce(
    (sum, line) => sum + line.unitPriceMinor * line.quantity,
    0,
  );
  const discount = content.discount;
  const raw =
    discount === null
      ? 0
      : discount.valueType === "fixed"
        ? discount.value
        : Math.round((subtotalMinor * discount.value) / 100);
  const discountMinor = Math.max(0, Math.min(raw, subtotalMinor));
  const shippingMinor = content.shipping?.amountMinor ?? 0;
  return {
    subtotalMinor,
    discountMinor,
    shippingMinor,
    totalBeforeTaxMinor: subtotalMinor - discountMinor + shippingMinor,
  };
}

export function draftRequirements(
  content: DraftOrderContent,
  purpose: "invoice" | "complete",
): DraftRequirement[] {
  const missing: DraftRequirement[] = [];
  if (content.lines.length === 0) missing.push("lines");
  if (content.shippingAddress === null) missing.push("shipping_address");
  if (content.shipping === null) missing.push("shipping");
  // Spec §4.5 decision: Identity resolves guest customers by email only.
  if (purpose === "complete" && content.customerRef === null && content.contactEmail === null) {
    missing.push("email");
  }
  return missing;
}

export function normalizeDraftSearch(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim().replace(/^#/, "").trim();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  return trimmed.slice(0, DRAFT_SEARCH_MAX_LENGTH);
}

export function clampDraftPageSize(first: number | undefined): number {
  if (first === undefined || !Number.isFinite(first)) return DRAFT_PAGE_SIZE_MAX;
  return Math.max(1, Math.min(Math.trunc(first), DRAFT_PAGE_SIZE_MAX));
}

export function isLiveDraftStatus(status: DraftOrderStatus): boolean {
  return LIVE_STATUSES.includes(status);
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

function isAmount(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_DRAFT_AMOUNT_MINOR;
}

function normalizeAddress(
  raw: DraftAddress | null,
  prefix: string,
  issues: FieldIssue[],
): DraftAddress | null {
  if (raw === null) return null;
  const required = (field: "line1" | "city" | "country", value: string): string => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_ADDRESS_FIELD_LENGTH) {
      issues.push({ field: `${prefix}.${field}`, message: "required" });
    }
    return trimmed;
  };
  const country = required("country", raw.country).toUpperCase();
  if (country.length > 0 && !/^[A-Z]{2}$/.test(country)) {
    issues.push({ field: `${prefix}.country`, message: "must be a two-letter country code" });
  }
  const phone = blankToNull(raw.phone);
  if (phone !== null && phone.length > MAX_PHONE_LENGTH) {
    issues.push({ field: `${prefix}.phone`, message: `at most ${MAX_PHONE_LENGTH} characters` });
  }
  return {
    name: blankToNull(raw.name),
    phone,
    line1: required("line1", raw.line1),
    line2: blankToNull(raw.line2),
    city: required("city", raw.city),
    province: blankToNull(raw.province),
    postalCode: raw.postalCode.trim(),
    country,
  };
}

function normalizeLines(raw: readonly DraftLine[], issues: FieldIssue[]): DraftLine[] {
  if (raw.length === 0) {
    issues.push({ field: "lines", message: "add at least one product" });
    return [];
  }
  if (raw.length > MAX_DRAFT_LINES) {
    issues.push({ field: "lines", message: `at most ${MAX_DRAFT_LINES} products` });
    return [];
  }
  const merged = new Map<string, DraftLine>();
  raw.forEach((line, index) => {
    const quantityOk =
      Number.isInteger(line.quantity) &&
      line.quantity >= 1 &&
      line.quantity <= MAX_DRAFT_LINE_QUANTITY;
    if (!quantityOk) {
      issues.push({ field: `lines.${index}.quantity`, message: `1-${MAX_DRAFT_LINE_QUANTITY}` });
      return;
    }
    if (!isAmount(line.unitPriceMinor)) {
      issues.push({ field: `lines.${index}.unitPriceMinor`, message: "invalid price" });
      return;
    }
    const key = `${line.productRef}|${line.variantRef}`;
    const seen = merged.get(key);
    merged.set(
      key,
      seen === undefined ? { ...line } : { ...seen, quantity: seen.quantity + line.quantity },
    );
  });
  const lines = [...merged.values()];
  lines.forEach((line, index) => {
    if (line.quantity > MAX_DRAFT_LINE_QUANTITY) {
      issues.push({ field: `lines.${index}.quantity`, message: `1-${MAX_DRAFT_LINE_QUANTITY}` });
    }
  });
  return lines;
}

function normalizeDiscount(raw: DraftDiscount | null, issues: FieldIssue[]): DraftDiscount | null {
  if (raw === null) return null;
  const valid =
    raw.valueType === "fixed"
      ? isAmount(raw.value)
      : Number.isInteger(raw.value) && raw.value >= 0 && raw.value <= 100;
  if (!valid) issues.push({ field: "discount.value", message: "out of range" });
  const reason = blankToNull(raw.reason);
  if (reason !== null && characterCount(reason) > MAX_REASON_LENGTH) {
    issues.push({ field: "discount.reason", message: `at most ${MAX_REASON_LENGTH} characters` });
  }
  if (raw.value === 0) return null;
  return { valueType: raw.valueType, value: raw.value, reason };
}

function normalizeShipping(raw: DraftShipping | null, issues: FieldIssue[]): DraftShipping | null {
  if (raw === null) return null;
  if (raw.kind === "free") {
    return { kind: "free", title: blankToNull(raw.title) ?? FREE_SHIPPING_TITLE, amountMinor: 0 };
  }
  if (!isAmount(raw.amountMinor)) {
    issues.push({ field: "shipping.amountMinor", message: "out of range" });
  }
  const title = raw.title.trim();
  if (title.length === 0 || characterCount(title) > MAX_SHIPPING_TITLE_LENGTH) {
    issues.push({ field: "shipping.title", message: `1-${MAX_SHIPPING_TITLE_LENGTH} characters` });
  }
  return raw.kind === "rate"
    ? { kind: "rate", method: raw.method, title, amountMinor: raw.amountMinor }
    : { kind: "custom", title, amountMinor: raw.amountMinor };
}

/** Every rule a draft's content obeys (spec §4.3, Ruling 20). Field names match the API's input. */
export function normalizeDraftContent(
  raw: DraftOrderContent,
): Result<DraftOrderContent, ValidationError> {
  const issues: FieldIssue[] = [];
  const lines = normalizeLines(raw.lines, issues);
  const discount = normalizeDiscount(raw.discount, issues);
  const shipping = normalizeShipping(raw.shipping, issues);
  const contactEmail = blankToNull(raw.contactEmail);
  if (
    contactEmail !== null &&
    (contactEmail.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(contactEmail))
  ) {
    issues.push({ field: "email", message: "is not an email address" });
  }
  const contactPhone = blankToNull(raw.contactPhone);
  if (contactPhone !== null && contactPhone.length > MAX_PHONE_LENGTH) {
    issues.push({ field: "phone", message: `at most ${MAX_PHONE_LENGTH} characters` });
  }
  const shippingAddress = normalizeAddress(raw.shippingAddress, "shippingAddress", issues);
  const billingAddress = normalizeAddress(raw.billingAddress, "billingAddress", issues);
  const note = normalizeNote(raw.note);
  if (!note.ok) issues.push({ field: "note", message: note.error.message });
  const tags = parseTags(raw.tags);
  if (!tags.ok) issues.push({ field: "tags", message: tags.error.message });
  else if (tags.value.length > MAX_TAGS_PER_ORDER) {
    issues.push({ field: "tags", message: `at most ${MAX_TAGS_PER_ORDER} tags` });
  }
  if (issues.length > 0 || !note.ok || !tags.ok) {
    return err(new ValidationError("Invalid draft order", issues));
  }
  return ok({
    customerRef: blankToNull(raw.customerRef),
    contactEmail,
    contactPhone,
    shippingAddress,
    billingAddress,
    lines,
    discount,
    shipping,
    note: note.value,
    tags: tags.value.map((tag) => tag.tag),
  });
}

type Props = { -readonly [K in keyof DraftOrderSnapshot]: DraftOrderSnapshot[K] };

export interface CreateDraftOrderProps {
  readonly id: string;
  readonly draftNumber: string;
  readonly currency: string;
  readonly createdBy: string;
  readonly now: Date;
  readonly content: DraftOrderContent;
}

/**
 * A merchant's draft order (spec §4.1). Its CONTENT is revised with optimistic locking; its status,
 * checkout and deletion are moved only by the repository's guarded writes (Ruling 2), so this class
 * has no method that changes them — a stale instance can never undo a completion.
 */
export class DraftOrder {
  private readonly props: Props;
  /** True until inserted: `save` inserts a new draft and updates the content of a loaded one. */
  readonly isNew: boolean;

  private constructor(props: Props, isNew: boolean) {
    this.props = props;
    this.isNew = isNew;
  }

  static create(input: CreateDraftOrderProps): Result<DraftOrder, ValidationError> {
    const content = normalizeDraftContent(input.content);
    if (!content.ok) return err(content.error);
    return ok(
      new DraftOrder(
        {
          ...content.value,
          id: input.id,
          draftNumber: input.draftNumber,
          status: "open",
          currency: input.currency,
          checkoutRef: null,
          checkoutVersion: null,
          orderRef: null,
          invoiceSentAt: null,
          completedAt: null,
          deletedAt: null,
          createdBy: input.createdBy,
          version: 0,
          createdAt: input.now,
          updatedAt: input.now,
        },
        true,
      ),
    );
  }

  static reconstitute(snapshot: DraftOrderSnapshot): DraftOrder {
    return new DraftOrder({ ...snapshot }, false);
  }

  /** Not completed and not deleted. */
  get isEditable(): boolean {
    return isLiveDraftStatus(this.props.status) && this.props.deletedAt === null;
  }

  revise(content: DraftOrderContent, now: Date): Result<void, DomainError> {
    if (this.props.deletedAt !== null) {
      return err(new BusinessRuleError("DRAFT_DELETED: this draft order was deleted"));
    }
    if (this.props.status === "completed") {
      return err(new BusinessRuleError("DRAFT_COMPLETED: this draft order is already an order"));
    }
    const normalized = normalizeDraftContent(content);
    if (!normalized.ok) return err(normalized.error);
    Object.assign(this.props, normalized.value, { updatedAt: now });
    return ok(undefined);
  }

  content(): DraftOrderContent {
    const p = this.props;
    return {
      customerRef: p.customerRef,
      contactEmail: p.contactEmail,
      contactPhone: p.contactPhone,
      shippingAddress: p.shippingAddress,
      billingAddress: p.billingAddress,
      lines: p.lines,
      discount: p.discount,
      shipping: p.shipping,
      note: p.note,
      tags: p.tags,
    };
  }

  snapshot(): DraftOrderSnapshot {
    return { ...this.props };
  }

  get id(): string {
    return this.props.id;
  }
  get draftNumber(): string {
    return this.props.draftNumber;
  }
  get status(): DraftOrderStatus {
    return this.props.status;
  }
  get currency(): string {
    return this.props.currency;
  }
  get customerRef(): string | null {
    return this.props.customerRef;
  }
  get contactEmail(): string | null {
    return this.props.contactEmail;
  }
  get contactPhone(): string | null {
    return this.props.contactPhone;
  }
  get shippingAddress(): DraftAddress | null {
    return this.props.shippingAddress;
  }
  get billingAddress(): DraftAddress | null {
    return this.props.billingAddress;
  }
  get lines(): readonly DraftLine[] {
    return this.props.lines;
  }
  get discount(): DraftDiscount | null {
    return this.props.discount;
  }
  get shipping(): DraftShipping | null {
    return this.props.shipping;
  }
  get note(): string | null {
    return this.props.note;
  }
  get tags(): readonly string[] {
    return this.props.tags;
  }
  get checkoutRef(): string | null {
    return this.props.checkoutRef;
  }
  get checkoutVersion(): number | null {
    return this.props.checkoutVersion;
  }
  get orderRef(): string | null {
    return this.props.orderRef;
  }
  get invoiceSentAt(): Date | null {
    return this.props.invoiceSentAt;
  }
  get completedAt(): Date | null {
    return this.props.completedAt;
  }
  get deletedAt(): Date | null {
    return this.props.deletedAt;
  }
  get createdBy(): string {
    return this.props.createdBy;
  }
  get version(): number {
    return this.props.version;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
```

Run: `pnpm --filter @platform/orders exec vitest run src/domain/draft-order.test.ts` → PASS.

- [ ] **Step 8: Write the repository port**

`services/orders/src/domain/draft-order-repository.ts`:

```ts
import type { DraftOrder, DraftOrderStatus } from "./draft-order";

export interface DraftOrderQuery {
  readonly status?: DraftOrderStatus;
  /** Draft number, contact email/phone, recipient name/phone (Ruling 16); already normalized. */
  readonly search?: string;
  readonly first?: number;
  /** Cursor: the id of the last row of the previous page (UUIDv7, time-ordered). */
  readonly after?: string;
}

export interface DraftOrderPage {
  readonly items: readonly DraftOrder[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
}

/**
 * Persistence port for {@link DraftOrder} (order operations Part 4). ADR-0014: `tenantId` per call;
 * writes need the unit of work's `tx`. Ruling 2: `save` writes CONTENT only (version-checked); every
 * status/checkout/deletion change is its own guarded update that never bumps `version`.
 */
export interface DraftOrderRepository {
  /**
   * Inserts a new draft (`draft.isNew`), or writes a loaded draft's CONTENT where `version` still
   * matches and the draft is neither completed nor deleted (bumping `version`); otherwise throws
   * `ConcurrencyError("VERSION_CONFLICT: …")`.
   */
  save(draft: DraftOrder, tenantId: string, tx?: unknown): Promise<void>;
  /** One draft of this shop, INCLUDING a deleted one (the caller decides); null for a non-UUID id. */
  findById(id: string, tenantId: string, tx?: unknown): Promise<DraftOrder | null>;
  /** This shop's drafts that are not deleted, newest first by id. */
  list(query: DraftOrderQuery, tenantId: string): Promise<DraftOrderPage>;
  /** open|invoice_sent and not deleted → invoice_sent at `at`; false otherwise. */
  markInvoiceSent(id: string, at: Date, tenantId: string, tx?: unknown): Promise<boolean>;
  /** open|invoice_sent → completed with the order, clearing `deletedAt` (Ruling 17); false otherwise. */
  markCompleted(
    id: string,
    completion: { readonly orderRef: string; readonly at: Date },
    tenantId: string,
    tx?: unknown,
  ): Promise<boolean>;
  /** open|invoice_sent and not deleted → deleted at `at`; false otherwise. */
  softDelete(id: string, at: Date, tenantId: string, tx?: unknown): Promise<boolean>;
  /**
   * Compare-and-set (Ruling 3): records the materialised session only while `checkout_ref` is still
   * `expectedCheckoutRef` and the draft is open|invoice_sent and not deleted.
   */
  setCheckout(
    id: string,
    next: { readonly checkoutRef: string; readonly checkoutVersion: number },
    expectedCheckoutRef: string | null,
    tenantId: string,
    tx?: unknown,
  ): Promise<boolean>;
}

/** Spec §4.2 decision: `D1`, `D2`, … per shop, in the draft's own transaction. */
export interface DraftNumberAllocator {
  next(tenantId: string, tx?: unknown): Promise<string>;
}
```

- [ ] **Step 9: Write the failing repository contract test**

`services/orders/src/infrastructure/draft-order-repository.contract.test.ts` — one suite against the in-memory store and the Prisma adapter over fake-prisma (fake-prisma supports every guarded `where` used here; `list` uses raw SQL, so it is covered in memory below and by the gated integration test):

```ts
import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import { ConcurrencyError } from "@platform/utils";
import { DraftOrder, type DraftOrderContent } from "../domain/draft-order";
import type { DraftOrderRepository } from "../domain/draft-order-repository";
import { InMemoryDraftOrderRepository } from "./in-memory-draft-order-repository";
import { PrismaDraftOrderRepository } from "./prisma-draft-order-repository";

const T = "tenant-a";
const ID = "33333333-3333-7333-8333-333333333333";
const NOW = new Date("2026-10-25T10:00:00.000Z");
const ADDRESS = {
  name: "Sara",
  phone: null,
  line1: "1 St",
  line2: null,
  city: "Cairo",
  province: "EG-C",
  postalCode: "",
  country: "EG",
};
const CONTENT: DraftOrderContent = {
  customerRef: null,
  contactEmail: "sara@example.com",
  contactPhone: null,
  shippingAddress: ADDRESS,
  billingAddress: null,
  lines: [
    {
      productRef: "p-1",
      variantRef: "v-1",
      sku: "S",
      title: "Tee",
      variantTitle: null,
      quantity: 1,
      unitPriceMinor: 1000,
    },
  ],
  discount: null,
  shipping: { kind: "free", title: "Free shipping", amountMinor: 0 },
  note: "hello",
  tags: ["vip"],
};

function draft(id = ID, number = "D1", content: DraftOrderContent = CONTENT): DraftOrder {
  const created = DraftOrder.create({
    id,
    draftNumber: number,
    currency: "EGP",
    createdBy: "staff",
    now: NOW,
    content,
  });
  if (!created.ok) throw created.error;
  return created.value;
}

type Layer = () => { readonly repo: DraftOrderRepository; readonly tx: unknown };
const layers: readonly [string, Layer][] = [
  ["in-memory", () => ({ repo: new InMemoryDraftOrderRepository(), tx: {} })],
  [
    "prisma over fake-prisma",
    () => {
      const fake = createFakePrisma();
      return { repo: new PrismaDraftOrderRepository({ prisma: fake.database }), tx: fake.database };
    },
  ],
];

describe.each(layers)("DraftOrderRepository (%s)", (_name, make) => {
  it("inserts and reads back the content, JSON columns included", async () => {
    const { repo, tx } = make();
    await repo.save(draft(), T, tx);
    const found = await repo.findById(ID, T);
    expect(found?.content()).toEqual(CONTENT);
    expect(found?.isNew).toBe(false);
    expect(found?.version).toBe(0);
  });

  it("a content save bumps the version; a stale one throws VERSION_CONFLICT", async () => {
    const { repo, tx } = make();
    await repo.save(draft(), T, tx);
    const a = await repo.findById(ID, T);
    const b = await repo.findById(ID, T);
    a?.revise({ ...CONTENT, note: "a" }, NOW);
    await repo.save(a as DraftOrder, T, tx);
    b?.revise({ ...CONTENT, note: "b" }, NOW);
    await expect(repo.save(b as DraftOrder, T, tx)).rejects.toBeInstanceOf(ConcurrencyError);
    const stored = await repo.findById(ID, T);
    expect(stored?.note).toBe("a");
    expect(stored?.version).toBe(1);
  });

  it("a stale content save never re-opens a completed draft (Ruling 2)", async () => {
    const { repo, tx } = make();
    await repo.save(draft(), T, tx);
    const stale = await repo.findById(ID, T);
    expect(await repo.markCompleted(ID, { orderRef: "o-1", at: NOW }, T, tx)).toBe(true);
    // The stale instance still believes it is open, so `revise` succeeds in memory …
    stale?.revise({ ...CONTENT, note: "late" }, NOW);
    // … but the guarded update refuses it.
    await expect(repo.save(stale as DraftOrder, T, tx)).rejects.toBeInstanceOf(ConcurrencyError);
    const done = await repo.findById(ID, T);
    expect(done?.status).toBe("completed");
    expect(done?.orderRef).toBe("o-1");
    expect(done?.note).toBe("hello");
  });

  it("guarded status writes leave the version alone and refuse the wrong state", async () => {
    const { repo, tx } = make();
    await repo.save(draft(), T, tx);
    expect(await repo.markInvoiceSent(ID, NOW, T, tx)).toBe(true);
    expect(await repo.markInvoiceSent(ID, NOW, T, tx)).toBe(true);
    expect((await repo.findById(ID, T))?.version).toBe(0);
    expect(await repo.markCompleted(ID, { orderRef: "o-1", at: NOW }, T, tx)).toBe(true);
    expect(await repo.markCompleted(ID, { orderRef: "o-2", at: NOW }, T, tx)).toBe(false);
    expect(await repo.softDelete(ID, NOW, T, tx)).toBe(false);
    expect(await repo.markInvoiceSent(ID, NOW, T, tx)).toBe(false);
    expect((await repo.findById(ID, T))?.orderRef).toBe("o-1");
  });

  it("soft delete keeps the row; a deleted draft whose checkout became an order completes (Ruling 17)", async () => {
    const { repo, tx } = make();
    await repo.save(draft(), T, tx);
    expect(await repo.softDelete(ID, NOW, T, tx)).toBe(true);
    expect(await repo.softDelete(ID, NOW, T, tx)).toBe(false);
    expect((await repo.findById(ID, T))?.deletedAt).toEqual(NOW);
    expect(await repo.markCompleted(ID, { orderRef: "o-1", at: NOW }, T, tx)).toBe(true);
    expect((await repo.findById(ID, T))?.deletedAt).toBeNull();
  });

  it("setCheckout is compare-and-set on checkout_ref and keeps the version (Ruling 3)", async () => {
    const { repo, tx } = make();
    await repo.save(draft(), T, tx);
    const next = (ref: string) => ({ checkoutRef: ref, checkoutVersion: 0 });
    expect(await repo.setCheckout(ID, next("s-1"), null, T, tx)).toBe(true);
    expect(await repo.setCheckout(ID, next("s-2"), null, T, tx)).toBe(false);
    expect(await repo.setCheckout(ID, next("s-2"), "s-1", T, tx)).toBe(true);
    const found = await repo.findById(ID, T);
    expect(found?.checkoutRef).toBe("s-2");
    expect(found?.checkoutVersion).toBe(0);
    expect(found?.version).toBe(0);
  });
});

describe("PrismaDraftOrderRepository ids", () => {
  it("a non-UUID id is unknown, never a query error", async () => {
    const repo = new PrismaDraftOrderRepository({ prisma: createFakePrisma().database });
    expect(await repo.findById("abc", T)).toBeNull();
    expect(await repo.markInvoiceSent("abc", NOW, T, {})).toBe(false);
  });
});

describe("InMemoryDraftOrderRepository.list", () => {
  const idOf = (n: number) => `33333333-3333-7333-8333-00000000000${n}`;
  async function seeded(): Promise<InMemoryDraftOrderRepository> {
    const repo = new InMemoryDraftOrderRepository();
    const people = [
      [1, "sara@example.com", "Sara"],
      [2, "omar@example.com", "Omar"],
      [3, null, "Mona Ali"],
    ] as const;
    for (const [n, email, name] of people) {
      const content = { ...CONTENT, contactEmail: email, shippingAddress: { ...ADDRESS, name } };
      await repo.save(draft(idOf(n), `D${n}`, content), T);
    }
    return repo;
  }

  it("is newest first, pages by id, filters by status and hides deleted drafts", async () => {
    const repo = await seeded();
    const first = await repo.list({ first: 2 }, T);
    expect(first.items.map((d) => d.draftNumber)).toEqual(["D3", "D2"]);
    expect(first.pageInfo.hasNextPage).toBe(true);
    const second = await repo.list({ first: 2, after: first.pageInfo.endCursor ?? "" }, T);
    expect(second.items.map((d) => d.draftNumber)).toEqual(["D1"]);
    await repo.markInvoiceSent(idOf(2), NOW, T);
    const sent = await repo.list({ status: "invoice_sent" }, T);
    expect(sent.items.map((d) => d.draftNumber)).toEqual(["D2"]);
    await repo.softDelete(idOf(1), NOW, T);
    expect((await repo.list({}, T)).items.map((d) => d.draftNumber)).toEqual(["D3", "D2"]);
  });

  it("searches the number, the email and the recipient, case-insensitively, in one shop", async () => {
    const repo = await seeded();
    const numbers = async (search: string) =>
      (await repo.list({ search }, T)).items.map((d) => d.draftNumber);
    expect(await numbers("d2")).toEqual(["D2"]);
    expect(await numbers("SARA@")).toEqual(["D1"]);
    expect(await numbers("mona")).toEqual(["D3"]);
    expect((await repo.list({}, "tenant-b")).items).toEqual([]);
  });
});
```

Run: `pnpm --filter @platform/orders exec vitest run src/infrastructure/draft-order-repository.contract.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 10: Write the row mapping and both repositories**

`services/orders/src/infrastructure/draft-order-rows.ts`:

```ts
import { UnexpectedError } from "@platform/utils";
import {
  DRAFT_ORDER_STATUSES,
  DraftOrder,
  type DraftAddress,
  type DraftDiscount,
  type DraftLine,
  type DraftOrderSnapshot,
  type DraftOrderStatus,
  type DraftShipping,
} from "../domain/draft-order";

/** What `JSON.parse` yields — assignable to Prisma's JSON input, which the typed interfaces are not. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** The columns of `orders.draft_orders` as Prisma returns them (JSON columns untyped). */
export interface DraftOrderRow {
  readonly id: string;
  readonly draftNumber: string;
  readonly status: string;
  readonly currency: string;
  readonly customerRef: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly shippingAddress: unknown;
  readonly billingAddress: unknown;
  readonly lines: unknown;
  readonly discount: unknown;
  readonly shipping: unknown;
  readonly note: string | null;
  readonly tags: unknown;
  readonly checkoutRef: string | null;
  readonly checkoutVersion: number | null;
  readonly orderRef: string | null;
  readonly invoiceSentAt: Date | null;
  readonly completedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly createdBy: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isEmptyObject = (v: unknown): boolean => isObject(v) && Object.keys(v).length === 0;
const textOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

function corrupt(id: string, what: string): never {
  throw new UnexpectedError(`Corrupt draft order ${id}: invalid ${what}`);
}

function addressOf(id: string, raw: unknown): DraftAddress | null {
  if (raw === null || raw === undefined || isEmptyObject(raw)) return null;
  if (!isObject(raw)) return corrupt(id, "address");
  const line1 = textOrNull(raw["line1"]);
  const city = textOrNull(raw["city"]);
  const country = textOrNull(raw["country"]);
  if (line1 === null || city === null || country === null) return corrupt(id, "address");
  return {
    name: textOrNull(raw["name"]),
    phone: textOrNull(raw["phone"]),
    line1,
    line2: textOrNull(raw["line2"]),
    city,
    province: textOrNull(raw["province"]),
    postalCode: textOrNull(raw["postalCode"]) ?? "",
    country,
  };
}

function linesOf(id: string, raw: unknown): DraftLine[] {
  if (!Array.isArray(raw)) return corrupt(id, "lines");
  return raw.map((line: unknown) => {
    if (!isObject(line)) return corrupt(id, "line");
    const productRef = textOrNull(line["productRef"]);
    const variantRef = textOrNull(line["variantRef"]);
    const quantity = line["quantity"];
    const unitPriceMinor = line["unitPriceMinor"];
    if (
      productRef === null ||
      variantRef === null ||
      typeof quantity !== "number" ||
      typeof unitPriceMinor !== "number"
    ) {
      return corrupt(id, "line");
    }
    return {
      productRef,
      variantRef,
      sku: textOrNull(line["sku"]) ?? "",
      title: textOrNull(line["title"]) ?? "",
      variantTitle: textOrNull(line["variantTitle"]),
      quantity,
      unitPriceMinor,
    };
  });
}

function discountOf(id: string, raw: unknown): DraftDiscount | null {
  if (raw === null || raw === undefined || isEmptyObject(raw)) return null;
  if (!isObject(raw)) return corrupt(id, "discount");
  const valueType = raw["valueType"];
  const value = raw["value"];
  if ((valueType !== "fixed" && valueType !== "percentage") || typeof value !== "number") {
    return corrupt(id, "discount");
  }
  return { valueType, value, reason: textOrNull(raw["reason"]) };
}

function shippingOf(id: string, raw: unknown): DraftShipping | null {
  if (raw === null || raw === undefined || isEmptyObject(raw)) return null;
  if (!isObject(raw)) return corrupt(id, "shipping");
  const title = textOrNull(raw["title"]);
  const amountMinor = raw["amountMinor"];
  if (title === null || typeof amountMinor !== "number") return corrupt(id, "shipping");
  switch (raw["kind"]) {
    case "rate":
      return {
        kind: "rate",
        method: textOrNull(raw["method"]) ?? corrupt(id, "shipping method"),
        title,
        amountMinor,
      };
    case "custom":
      return { kind: "custom", title, amountMinor };
    case "free":
      return { kind: "free", title, amountMinor: 0 };
    default:
      return corrupt(id, "shipping kind");
  }
}

export function draftFromRow(row: DraftOrderRow): DraftOrder {
  if (!(DRAFT_ORDER_STATUSES as readonly string[]).includes(row.status)) {
    corrupt(row.id, "status");
  }
  const tags = Array.isArray(row.tags)
    ? row.tags.filter((tag: unknown): tag is string => typeof tag === "string")
    : [];
  const snapshot: DraftOrderSnapshot = {
    id: row.id,
    draftNumber: row.draftNumber,
    status: row.status as DraftOrderStatus,
    currency: row.currency,
    customerRef: row.customerRef,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    shippingAddress: addressOf(row.id, row.shippingAddress),
    billingAddress: addressOf(row.id, row.billingAddress),
    lines: linesOf(row.id, row.lines),
    discount: discountOf(row.id, row.discount),
    shipping: shippingOf(row.id, row.shipping),
    note: row.note,
    tags,
    checkoutRef: row.checkoutRef,
    checkoutVersion: row.checkoutVersion,
    orderRef: row.orderRef,
    invoiceSentAt: row.invoiceSentAt,
    completedAt: row.completedAt,
    deletedAt: row.deletedAt,
    createdBy: row.createdBy,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return DraftOrder.reconstitute(snapshot);
}

const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;

/** The content columns — the ONLY columns `save` writes on an update (Ruling 2). */
export function contentColumns(draft: DraftOrder) {
  const s = draft.snapshot();
  return {
    customerRef: s.customerRef,
    contactEmail: s.contactEmail,
    contactPhone: s.contactPhone,
    shippingAddress: json(s.shippingAddress ?? {}),
    billingAddress: json(s.billingAddress ?? {}),
    lines: json(s.lines),
    discount: json(s.discount ?? {}),
    shipping: json(s.shipping ?? {}),
    note: s.note,
    tags: json(s.tags),
    updatedAt: s.updatedAt,
  };
}

/** Case-insensitive `contains` over the searchable fields (Ruling 16) — the in-memory mirror of the SQL. */
export function matchesDraftSearch(snapshot: DraftOrderSnapshot, search: string): boolean {
  const needle = search.toLowerCase();
  return [
    snapshot.draftNumber,
    snapshot.contactEmail,
    snapshot.contactPhone,
    snapshot.shippingAddress?.name,
    snapshot.shippingAddress?.phone,
  ].some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
}
```

`services/orders/src/infrastructure/in-memory-draft-order-repository.ts`:

```ts
import { ConcurrencyError } from "@platform/utils";
import {
  clampDraftPageSize,
  DraftOrder,
  isLiveDraftStatus,
  type DraftOrderSnapshot,
} from "../domain/draft-order";
import type {
  DraftOrderPage,
  DraftOrderQuery,
  DraftOrderRepository,
} from "../domain/draft-order-repository";
import { matchesDraftSearch } from "./draft-order-rows";

/** In-memory {@link DraftOrderRepository} keyed by `(tenantId, id)`; the same guards as Prisma's. */
export class InMemoryDraftOrderRepository implements DraftOrderRepository {
  private readonly store = new Map<string, Map<string, DraftOrderSnapshot>>();

  async save(draft: DraftOrder, tenantId: string): Promise<void> {
    let bucket = this.store.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.store.set(tenantId, bucket);
    }
    const s = draft.snapshot();
    if (draft.isNew) {
      bucket.set(s.id, s);
      return;
    }
    const stored = bucket.get(s.id);
    if (
      stored === undefined ||
      stored.version !== s.version ||
      stored.deletedAt !== null ||
      !isLiveDraftStatus(stored.status)
    ) {
      throw new ConcurrencyError(
        "VERSION_CONFLICT: this draft order was changed or closed meanwhile",
      );
    }
    bucket.set(s.id, {
      ...stored,
      customerRef: s.customerRef,
      contactEmail: s.contactEmail,
      contactPhone: s.contactPhone,
      shippingAddress: s.shippingAddress,
      billingAddress: s.billingAddress,
      lines: s.lines,
      discount: s.discount,
      shipping: s.shipping,
      note: s.note,
      tags: s.tags,
      updatedAt: s.updatedAt,
      version: stored.version + 1,
    });
  }

  async findById(id: string, tenantId: string): Promise<DraftOrder | null> {
    const stored = this.store.get(tenantId)?.get(id);
    return stored === undefined ? null : DraftOrder.reconstitute(stored);
  }

  async list(query: DraftOrderQuery, tenantId: string): Promise<DraftOrderPage> {
    const first = clampDraftPageSize(query.first);
    const search = query.search;
    const matching = [...(this.store.get(tenantId)?.values() ?? [])]
      .filter((s) => s.deletedAt === null)
      .filter((s) => query.status === undefined || s.status === query.status)
      .filter((s) => search === undefined || matchesDraftSearch(s, search))
      .filter((s) => query.after === undefined || s.id < query.after)
      .sort((a, b) => (a.id < b.id ? 1 : -1));
    const items = matching.slice(0, first).map((s) => DraftOrder.reconstitute(s));
    return {
      items,
      pageInfo: { hasNextPage: matching.length > first, endCursor: items.at(-1)?.id ?? null },
    };
  }

  async markInvoiceSent(id: string, at: Date, tenantId: string): Promise<boolean> {
    return this.guarded(
      id,
      tenantId,
      (s) => isLiveDraftStatus(s.status) && s.deletedAt === null,
      (s) => ({ ...s, status: "invoice_sent", invoiceSentAt: at }),
    );
  }

  async markCompleted(
    id: string,
    completion: { readonly orderRef: string; readonly at: Date },
    tenantId: string,
  ): Promise<boolean> {
    return this.guarded(
      id,
      tenantId,
      (s) => isLiveDraftStatus(s.status),
      (s) => ({
        ...s,
        status: "completed",
        orderRef: completion.orderRef,
        completedAt: completion.at,
        deletedAt: null,
      }),
    );
  }

  async softDelete(id: string, at: Date, tenantId: string): Promise<boolean> {
    return this.guarded(
      id,
      tenantId,
      (s) => isLiveDraftStatus(s.status) && s.deletedAt === null,
      (s) => ({ ...s, deletedAt: at }),
    );
  }

  async setCheckout(
    id: string,
    next: { readonly checkoutRef: string; readonly checkoutVersion: number },
    expectedCheckoutRef: string | null,
    tenantId: string,
  ): Promise<boolean> {
    return this.guarded(
      id,
      tenantId,
      (s) =>
        isLiveDraftStatus(s.status) &&
        s.deletedAt === null &&
        s.checkoutRef === expectedCheckoutRef,
      (s) => ({ ...s, checkoutRef: next.checkoutRef, checkoutVersion: next.checkoutVersion }),
    );
  }

  /** Check and write in one synchronous step — no await between them, like one guarded UPDATE. */
  private guarded(
    id: string,
    tenantId: string,
    accept: (s: DraftOrderSnapshot) => boolean,
    change: (s: DraftOrderSnapshot) => DraftOrderSnapshot,
  ): boolean {
    const bucket = this.store.get(tenantId);
    const stored = bucket?.get(id);
    if (bucket === undefined || stored === undefined || !accept(stored)) return false;
    bucket.set(id, change(stored));
    return true;
  }
}
```

`services/orders/src/infrastructure/prisma-draft-order-repository.ts`:

```ts
import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import { ConcurrencyError } from "@platform/utils";
import { clampDraftPageSize, type DraftOrder } from "../domain/draft-order";
import type {
  DraftOrderPage,
  DraftOrderQuery,
  DraftOrderRepository,
} from "../domain/draft-order-repository";
import { contentColumns, draftFromRow, type DraftOrderRow } from "./draft-order-rows";
import { uuidsOf } from "./order-list-where";
import { escapeLike } from "./prisma-order-annotation-repository";

export interface PrismaDraftOrderRepositoryDeps {
  readonly prisma: Database;
}

const LIVE = ["open", "invoice_sent"];
const EMPTY: DraftOrderPage = { items: [], pageInfo: { hasNextPage: false, endCursor: null } };
const isUuid = (id: string): boolean => uuidsOf([id]).length === 1;

function writeClient(tx: unknown, method: string): TransactionClient {
  if (tx === undefined || tx === null) {
    throw new Error(
      `PrismaDraftOrderRepository.${method} requires the unit of work's transaction client (ADR-0003).`,
    );
  }
  return tx as TransactionClient;
}

/**
 * `orders.draft_orders` (order operations Part 4). Every Prisma `where` names `tenantId` (RLS is inert
 * on the application's connection — ADR-0014 point 6); the one raw read binds `tenant_id` in the
 * statement itself. Ruling 2: content saves are versioned; status, checkout and deletion are guarded
 * `updateMany`s that never bump `version`.
 */
export class PrismaDraftOrderRepository implements DraftOrderRepository {
  private readonly deps: PrismaDraftOrderRepositoryDeps;

  constructor(deps: PrismaDraftOrderRepositoryDeps) {
    this.deps = deps;
  }

  async save(draft: DraftOrder, tenantId: string, tx?: unknown): Promise<void> {
    const client = writeClient(tx, "save");
    const s = draft.snapshot();
    const content = contentColumns(draft);
    if (draft.isNew) {
      await client.draftOrder.create({
        data: {
          id: s.id,
          tenantId,
          draftNumber: s.draftNumber,
          status: s.status,
          currency: s.currency,
          ...content,
          checkoutRef: null,
          checkoutVersion: null,
          orderRef: null,
          invoiceSentAt: null,
          completedAt: null,
          deletedAt: null,
          createdBy: s.createdBy,
          version: 0,
          createdAt: s.createdAt,
        },
      });
      return;
    }
    const { count } = await client.draftOrder.updateMany({
      where: { id: s.id, tenantId, version: s.version, deletedAt: null, status: { in: LIVE } },
      data: { ...content, version: { increment: 1 } },
    });
    if (count === 0) {
      throw new ConcurrencyError(
        "VERSION_CONFLICT: this draft order was changed or closed meanwhile",
      );
    }
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<DraftOrder | null> {
    if (!isUuid(id)) return null;
    const row = await this.read(tenantId, tx, (client) =>
      client.draftOrder.findFirst({ where: { tenantId, id } }),
    );
    return row === null ? null : draftFromRow(row as unknown as DraftOrderRow);
  }

  async list(query: DraftOrderQuery, tenantId: string): Promise<DraftOrderPage> {
    if (query.after !== undefined && !isUuid(query.after)) return EMPTY;
    const first = clampDraftPageSize(query.first);
    const after = query.after ?? null;
    const status = query.status ?? null;
    const pattern = query.search === undefined ? null : `%${escapeLike(query.search)}%`;
    return runReadScoped(this.deps.prisma, tenantId, async (client) => {
      const page = await client.$queryRaw<{ id: string }[]>`
        SELECT "id"::text AS "id"
        FROM "orders"."draft_orders"
        WHERE "tenant_id" = ${tenantId}
          AND "deleted_at" IS NULL
          AND (${status}::text IS NULL OR "status" = ${status}::text)
          AND (${after}::uuid IS NULL OR "id" < ${after}::uuid)
          AND (${pattern}::text IS NULL
            OR "draft_number" ILIKE ${pattern} ESCAPE '\\'
            OR "contact_email" ILIKE ${pattern} ESCAPE '\\'
            OR "contact_phone" ILIKE ${pattern} ESCAPE '\\'
            OR "shipping_address"->>'name' ILIKE ${pattern} ESCAPE '\\'
            OR "shipping_address"->>'phone' ILIKE ${pattern} ESCAPE '\\')
        ORDER BY "id" DESC
        LIMIT ${first + 1}`;
      const ids = page.slice(0, first).map((row) => row.id);
      if (ids.length === 0) return EMPTY;
      const rows = await client.draftOrder.findMany({ where: { tenantId, id: { in: ids } } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const items = ids.flatMap((id) => {
        const row = byId.get(id);
        return row === undefined ? [] : [draftFromRow(row as unknown as DraftOrderRow)];
      });
      return {
        items,
        pageInfo: { hasNextPage: page.length > first, endCursor: items.at(-1)?.id ?? null },
      };
    });
  }

  async markInvoiceSent(id: string, at: Date, tenantId: string, tx?: unknown): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { count } = await writeClient(tx, "markInvoiceSent").draftOrder.updateMany({
      where: { id, tenantId, deletedAt: null, status: { in: LIVE } },
      data: { status: "invoice_sent", invoiceSentAt: at },
    });
    return count > 0;
  }

  async markCompleted(
    id: string,
    completion: { readonly orderRef: string; readonly at: Date },
    tenantId: string,
    tx?: unknown,
  ): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { count } = await writeClient(tx, "markCompleted").draftOrder.updateMany({
      where: { id, tenantId, status: { in: LIVE } },
      data: {
        status: "completed",
        orderRef: completion.orderRef,
        completedAt: completion.at,
        deletedAt: null,
      },
    });
    return count > 0;
  }

  async softDelete(id: string, at: Date, tenantId: string, tx?: unknown): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { count } = await writeClient(tx, "softDelete").draftOrder.updateMany({
      where: { id, tenantId, deletedAt: null, status: { in: LIVE } },
      data: { deletedAt: at },
    });
    return count > 0;
  }

  async setCheckout(
    id: string,
    next: { readonly checkoutRef: string; readonly checkoutVersion: number },
    expectedCheckoutRef: string | null,
    tenantId: string,
    tx?: unknown,
  ): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { count } = await writeClient(tx, "setCheckout").draftOrder.updateMany({
      where: {
        id,
        tenantId,
        deletedAt: null,
        status: { in: LIVE },
        checkoutRef: expectedCheckoutRef,
      },
      data: { checkoutRef: next.checkoutRef, checkoutVersion: next.checkoutVersion },
    });
    return count > 0;
  }

  private read<T>(
    tenantId: string,
    tx: unknown,
    run: (client: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return tx !== undefined && tx !== null
      ? run(tx as TransactionClient)
      : runReadScoped(this.deps.prisma, tenantId, run);
  }
}
```

If the generated Prisma JSON input type rejects `Json` from `contentColumns`, cast the JSON fields in `save` with `as Prisma.InputJsonValue` (`import type { Prisma } from "@prisma/client"`, as `prisma-order-timeline-repository.ts` does) — never widen the row type.

Run the contract test → PASS.

- [ ] **Step 11: Write the draft number allocators (test first)**

`services/orders/src/infrastructure/prisma-draft-number-allocator.test.ts`:

```ts
import type { TransactionClient } from "@platform/db";
import { describe, expect, it } from "vitest";
import { InMemoryDraftNumberAllocator } from "./in-memory-draft-number-allocator";
import { PrismaDraftNumberAllocator } from "./prisma-draft-number-allocator";

function fakeTx(numbers: readonly number[]) {
  const calls: { sql: string; values: readonly unknown[] }[] = [];
  let next = 0;
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join("?"), values });
      const last_draft_number = numbers[next];
      next += 1;
      return [{ last_draft_number }];
    },
  } as unknown as TransactionClient;
  return { tx, calls };
}

describe("PrismaDraftNumberAllocator", () => {
  it("bumps last_draft_number on the shop's counter row; a new row keeps the first order at #1001", async () => {
    const { tx, calls } = fakeTx([1]);
    expect(await new PrismaDraftNumberAllocator().next("tenant-a", tx)).toBe("D1");
    const sql = calls[0]?.sql.replace(/\s+/g, " ") ?? "";
    expect(sql).toContain('INSERT INTO "orders"."order_number_counters"');
    expect(sql).toContain('("tenant_id", "last_number", "last_draft_number")');
    expect(sql).toContain('ON CONFLICT ("tenant_id") DO UPDATE');
    expect(sql).toContain(
      'SET "last_draft_number" = "order_number_counters"."last_draft_number" + 1',
    );
    expect(sql).not.toContain('SET "last_number"');
    // The tenant and the order-number floor are bound parameters, never interpolated.
    expect(calls[0]?.values).toEqual(["tenant-a", 1000]);
  });

  it("refuses to run outside the draft's transaction", async () => {
    await expect(new PrismaDraftNumberAllocator().next("tenant-a")).rejects.toThrow(/transaction/i);
  });

  it("fails loudly when the database returns no row", async () => {
    const tx = { $queryRaw: async () => [] } as unknown as TransactionClient;
    await expect(new PrismaDraftNumberAllocator().next("tenant-a", tx)).rejects.toThrow(
      /draft number/,
    );
  });
});

describe("InMemoryDraftNumberAllocator", () => {
  it("counts per shop from D1", async () => {
    const allocator = new InMemoryDraftNumberAllocator();
    expect(await allocator.next("a")).toBe("D1");
    expect(await allocator.next("a")).toBe("D2");
    expect(await allocator.next("b")).toBe("D1");
  });
});
```

`services/orders/src/infrastructure/in-memory-draft-number-allocator.ts`:

```ts
import type { DraftNumberAllocator } from "../domain/draft-order-repository";

/** In-memory `DraftNumberAllocator`: one counter per shop, D1 first. */
export class InMemoryDraftNumberAllocator implements DraftNumberAllocator {
  private readonly lastByTenant = new Map<string, number>();

  next(tenantId: string): Promise<string> {
    const next = (this.lastByTenant.get(tenantId) ?? 0) + 1;
    this.lastByTenant.set(tenantId, next);
    return Promise.resolve(`D${next}`);
  }
}
```

`services/orders/src/infrastructure/prisma-draft-number-allocator.ts`:

```ts
import type { TransactionClient } from "@platform/db";
import { UnexpectedError } from "@platform/utils";
import type { DraftNumberAllocator } from "../domain/draft-order-repository";
import { FIRST_ORDER_NUMBER } from "../domain/value-objects/order-number";

/**
 * Draft numbers on the shop's existing counter row (spec §4.2 decision): one atomic upsert in the
 * draft's own transaction. A new shop's row is inserted with `last_number = 1000`, so its first ORDER
 * is still #1001. The tenant is bound in the statement itself (raw SQL has no Prisma `where`).
 */
export class PrismaDraftNumberAllocator implements DraftNumberAllocator {
  async next(tenantId: string, tx?: unknown): Promise<string> {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaDraftNumberAllocator.next requires the unit of work's transaction client (ADR-0003).",
      );
    }
    const client = tx as TransactionClient;
    const rows = await client.$queryRaw<Array<{ last_draft_number: number }>>`
      INSERT INTO "orders"."order_number_counters" ("tenant_id", "last_number", "last_draft_number")
      VALUES (${tenantId}, ${FIRST_ORDER_NUMBER - 1}, 1)
      ON CONFLICT ("tenant_id") DO UPDATE
        SET "last_draft_number" = "order_number_counters"."last_draft_number" + 1
      RETURNING "last_draft_number"`;
    const row = rows[0];
    if (row === undefined) {
      throw new UnexpectedError("Could not allocate a draft number: the counter returned no row");
    }
    return `D${row.last_draft_number}`;
  }
}
```

- [ ] **Step 12: Tenant isolation and the gated integration test**

Append to `services/orders/src/infrastructure/tenant-isolation.test.ts` (add the imports `DraftOrder` from `../domain/draft-order`, `type DraftOrderRepository` from `../domain/draft-order-repository`, `InMemoryDraftOrderRepository` and `PrismaDraftOrderRepository`):

```ts
describe("draft orders tenant isolation (order operations Part 4)", () => {
  const VICTIM_DRAFT = "44444444-4444-7444-8444-444444444444";
  const content = {
    customerRef: null,
    contactEmail: "victim@example.com",
    contactPhone: null,
    shippingAddress: null,
    billingAddress: null,
    lines: [
      {
        productRef: "p",
        variantRef: "v",
        sku: "S",
        title: "T",
        variantTitle: null,
        quantity: 1,
        unitPriceMinor: 100,
      },
    ],
    discount: null,
    shipping: null,
    note: null,
    tags: [],
  };
  function draftLayers(): readonly [string, DraftOrderRepository, unknown][] {
    const fake = createFakePrisma();
    return [
      ["in-memory", new InMemoryDraftOrderRepository(), {}],
      [
        "prisma over fake-prisma",
        new PrismaDraftOrderRepository({ prisma: fake.database }),
        fake.database,
      ],
    ];
  }

  it.each(draftLayers())(
    "%s: another shop can neither read nor move a draft",
    async (_n, repo, tx) => {
      const created = DraftOrder.create({
        id: VICTIM_DRAFT,
        draftNumber: "D1",
        currency: "EGP",
        createdBy: "s",
        now: new Date(0),
        content,
      });
      if (!created.ok) throw created.error;
      await repo.save(created.value, "victim", tx);
      const at = new Date(0);
      expect(await repo.findById(VICTIM_DRAFT, "attacker")).toBeNull();
      expect((await repo.list({}, "attacker")).items).toEqual([]);
      expect(await repo.markInvoiceSent(VICTIM_DRAFT, at, "attacker", tx)).toBe(false);
      expect(await repo.markCompleted(VICTIM_DRAFT, { orderRef: "o", at }, "attacker", tx)).toBe(
        false,
      );
      expect(await repo.softDelete(VICTIM_DRAFT, at, "attacker", tx)).toBe(false);
      expect(
        await repo.setCheckout(
          VICTIM_DRAFT,
          { checkoutRef: "s", checkoutVersion: 0 },
          null,
          "attacker",
          tx,
        ),
      ).toBe(false);
      const victim = await repo.findById(VICTIM_DRAFT, "victim");
      expect(victim?.status).toBe("open");
      expect(victim?.checkoutRef).toBeNull();
      expect(victim?.deletedAt).toBeNull();
    },
  );
});
```

The `list({}, "attacker")` line works for the Prisma layer only if fake-prisma answers `$queryRaw`; it does not, so guard that one assertion with `if (repo instanceof InMemoryDraftOrderRepository)` — the Prisma list's tenant filter is pinned by the integration test.

`services/orders/src/infrastructure/prisma-draft-order-repository.integration.test.ts` — gated exactly like `prisma-order-annotations.integration.test.ts` (copy its `DATABASE_URL_TEST` guard, `PrismaClient` construction and per-test cleanup of `orders.draft_orders` and `orders.order_number_counters` rows for the two test tenants). Cases, each with literal expectations:

1. three drafts saved for `tenant-a`, one for `tenant-b`: `list({}, "tenant-a")` → `["D3","D2","D1"]` by number; `tenant-b`'s draft never appears.
2. `list({ first: 2 })` then `list({ first: 2, after: endCursor })` → `["D3","D2"]`, `["D1"]`.
3. search `"d2"`, an email fragment in upper case, a recipient-name fragment and a phone fragment each return exactly the expected draft; a search containing `%` matches literally (no hit).
4. `markInvoiceSent` then `list({ status: "invoice_sent" })`; `softDelete` hides a draft from `list`.
5. `PrismaDraftNumberAllocator.next` twice in transactions for a NEW tenant → `D1`, `D2`; then `PrismaOrderNumberAllocator.next` for the same tenant → `"1001"`.

- [ ] **Step 13: Run the tests, typecheck, lint and the tenant-where guard**

Run: `pnpm --filter @platform/orders test` → PASS (integration suites skipped without `DATABASE_URL_TEST`).
Run: `pnpm --filter @platform/orders typecheck` and `pnpm --filter @platform/orders lint` → clean.
Run: `node scripts/dev/check-prisma-tenant-where.mjs` → only the known `discounts.admin-controller.ts:166` finding.

- [ ] **Step 14: Commit**

```bash
git add packages/db/prisma/schema/migrations/20261018030000_draft_orders/migration.sql \
  packages/db/prisma/schema/orders.prisma packages/db/prisma/schema/checkout.prisma \
  packages/db/src/schema-migration-consistency.test.ts \
  packages/auth/src/role-table-access-control.test.ts \
  services/orders/src/domain/draft-order.ts services/orders/src/domain/draft-order.test.ts \
  services/orders/src/domain/draft-order-repository.ts \
  services/orders/src/infrastructure/draft-order-rows.ts \
  services/orders/src/infrastructure/in-memory-draft-order-repository.ts \
  services/orders/src/infrastructure/prisma-draft-order-repository.ts \
  services/orders/src/infrastructure/draft-order-repository.contract.test.ts \
  services/orders/src/infrastructure/prisma-draft-order-repository.integration.test.ts \
  services/orders/src/infrastructure/in-memory-draft-number-allocator.ts \
  services/orders/src/infrastructure/prisma-draft-number-allocator.ts \
  services/orders/src/infrastructure/prisma-draft-number-allocator.test.ts \
  services/orders/src/infrastructure/tenant-isolation.test.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(orders): draft order storage, model, repositories and d-numbers

Adds orders.draft_orders (RLS), last_draft_number on the counter row, draft_terms on checkout
sessions and the draft index on checkout links. Content saves are versioned; status, checkout
and deletion are guarded updates that never bump the version. Not applied to any database.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Draft order use cases, completion bookkeeping and the Orders wiring

Model tier: **standard**.

**Files:**

- Create: `services/orders/src/application/draft-orders.use-cases.ts`, `services/orders/src/application/draft-orders.use-cases.test.ts`
- Modify: `services/orders/src/domain/order-timeline.ts` (`OrderTimelineData.draftId`)
- Modify: `services/orders/src/infrastructure/prisma-order-timeline-repository.ts` (`readData` keeps `draftId`)
- Modify: `services/orders/src/interfaces/order.controller.ts`, `services/orders/src/composition.ts`, `services/orders/src/index.ts`
- Create: `services/orders/src/draft-orders.wiring.test.ts`

**Interfaces:**

- Consumes (Task 1): `DraftOrder`, `DraftOrderContent`, `normalizeDraftContent`, `normalizeDraftSearch`, `clampDraftPageSize`, `DraftOrderRepository`, `DraftNumberAllocator`, `InMemoryDraftOrderRepository`, `PrismaDraftOrderRepository`, `InMemoryDraftNumberAllocator`, `PrismaDraftNumberAllocator`. Existing: `OrderAnnotationRepository`, `OrderActivityDeps`, `authorNameOf`, `parseTags`.
- Produces:
  - `draft-orders.use-cases.ts`: `interface DraftOrdersDeps { drafts; draftNumbers; unitOfWork; idGenerator; clock; annotations; activity: OrderActivityDeps }`; use cases and IO types:
    - `CreateDraftOrder` — `CreateDraftOrderInput { tenantId; createdBy; currency; content: DraftOrderContent }` → `DraftOrderOutput { draft: DraftOrder }`
    - `UpdateDraftOrder` — `UpdateDraftOrderInput { tenantId; draftId; version: number; content }` → `DraftOrderOutput`
    - `DeleteDraftOrder` — `DraftOrderIdInput { tenantId; draftId }` → `{ draftId: string }`
    - `GetDraftOrder` — `DraftOrderIdInput` → `DraftOrder` (404 for a deleted draft)
    - `ListDraftOrders` — `ListDraftOrdersInput { tenantId; status?; search?; first?; after? }` → `DraftOrderPage`
    - `MarkDraftInvoiceSent` — `DraftOrderIdInput` → `DraftOrderOutput`
    - `SetDraftCheckout` — `SetDraftCheckoutInput { tenantId; draftId; checkoutRef; checkoutVersion; expectedCheckoutRef: string | null }` → `{ applied: boolean }`
    - `CompleteDraftFromCheckout` — `CompleteDraftFromCheckoutInput { tenantId; draftId; orderRef; actorRef?: string }` → `CompleteDraftFromCheckoutOutput { draftId; orderRef; changed: boolean }`
  - `OrderController`: `createDraftOrder`, `updateDraftOrder`, `deleteDraftOrder`, `getDraftOrder`, `listDraftOrders`, `markDraftInvoiceSent`, `setDraftCheckout`, `completeDraftFromCheckout` (each `(input) => Promise<ControllerResponse>`; create answers 201).
  - `OrderTimelineData.draftId?: string`.
  - `@platform/orders` exports everything above plus the Task 1 domain names.

- [ ] **Step 1: Write the failing use-case test**

`services/orders/src/application/draft-orders.use-cases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import type { DomainError } from "@platform/utils";
import type { DraftOrderContent } from "../domain/draft-order";
import { Order } from "../domain/order";
import { OrderItem } from "../domain/order-item";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import { InMemoryDraftNumberAllocator } from "../infrastructure/in-memory-draft-number-allocator";
import { InMemoryDraftOrderRepository } from "../infrastructure/in-memory-draft-order-repository";
import { InMemoryOrderAnnotationRepository } from "../infrastructure/in-memory-order-annotation-repository";
import { InMemoryOrderRepository } from "../infrastructure/in-memory-order-repository";
import { InMemoryOrderTimelineRepository } from "../infrastructure/in-memory-order-timeline-repository";
import { InMemoryStaffDirectory } from "../infrastructure/in-memory-port-adapters";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { OrderEventTranslator } from "../infrastructure/order-event-translator";
import {
  CompleteDraftFromCheckout,
  CreateDraftOrder,
  DeleteDraftOrder,
  GetDraftOrder,
  ListDraftOrders,
  MarkDraftInvoiceSent,
  SetDraftCheckout,
  UpdateDraftOrder,
} from "./draft-orders.use-cases";

const T = "tenant-a";
const NOW = new Date("2026-10-25T10:00:00.000Z");
const ORDER_ID = "55555555-5555-7555-8555-555555555555";
const CONTENT: DraftOrderContent = {
  customerRef: null,
  contactEmail: "sara@example.com",
  contactPhone: null,
  shippingAddress: {
    name: "Sara",
    phone: "01001234567",
    line1: "1 Nile St",
    line2: null,
    city: "Cairo",
    province: "EG-C",
    postalCode: "",
    country: "EG",
  },
  billingAddress: null,
  lines: [
    {
      productRef: "p-1",
      variantRef: "v-1",
      sku: "TEE",
      title: "Tee",
      variantTitle: null,
      quantity: 2,
      unitPriceMinor: 25000,
    },
  ],
  discount: { valueType: "fixed", value: 5000, reason: "Loyal customer" },
  shipping: { kind: "custom", title: "Courier", amountMinor: 4000 },
  note: "Deliver after 5 pm",
  tags: ["WhatsApp", "vip"],
};

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

async function world() {
  const orders = new InMemoryOrderRepository({
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new OrderEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "orders",
    }),
    context: rootEventContext({ generate: () => "evt" }),
  });
  await orders.save(
    Order.place(
      UniqueEntityId.from(ORDER_ID),
      must(OrderNumber.create("1001")),
      "customer-1",
      "EGP",
      [
        OrderItem.create(
          UniqueEntityId.from("item-1"),
          must(ProductSnapshot.create("p-1", "Tee", must(Money.create(25000, "EGP")))),
          2,
        ),
      ],
      must(AddressSnapshot.create("1 Nile St", "Cairo", "", "EG")),
      "evt-1",
      new Date(0),
    ),
    T,
  );
  const drafts = new InMemoryDraftOrderRepository();
  const annotations = new InMemoryOrderAnnotationRepository({ orders });
  const timeline = new InMemoryOrderTimelineRepository();
  let n = 0;
  const deps = {
    drafts,
    draftNumbers: new InMemoryDraftNumberAllocator(),
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator: {
      generate: () => `33333333-3333-7333-8333-${(n += 1).toString().padStart(12, "0")}`,
    },
    clock: { now: () => NOW },
    annotations,
    activity: {
      timeline,
      staff: new InMemoryStaffDirectory({ "staff-1": "Ahmed" }),
      idGenerator: {
        generate: () => `66666666-6666-7666-8666-${(n += 1).toString().padStart(12, "0")}`,
      },
    },
  };
  return {
    drafts,
    annotations,
    timeline,
    create: new CreateDraftOrder(deps),
    update: new UpdateDraftOrder(deps),
    remove: new DeleteDraftOrder(deps),
    get: new GetDraftOrder(deps),
    list: new ListDraftOrders(deps),
    invoiceSent: new MarkDraftInvoiceSent(deps),
    setCheckout: new SetDraftCheckout(deps),
    complete: new CompleteDraftFromCheckout(deps),
  };
}

const value = <T>(r: { ok: true; value: T } | { ok: false; error: DomainError }): T => {
  if (!r.ok) throw r.error;
  return r.value;
};
const failure = <T>(r: { ok: true; value: T } | { ok: false; error: DomainError }): DomainError => {
  if (r.ok) throw new Error("expected a failure");
  return r.error;
};

describe("CreateDraftOrder", () => {
  it("numbers drafts D1, D2 per shop and stores the normalized content", async () => {
    const w = await world();
    const first = value(
      await w.create.execute({
        tenantId: T,
        createdBy: "staff-1",
        currency: "EGP",
        content: CONTENT,
      }),
    );
    const second = value(
      await w.create.execute({
        tenantId: T,
        createdBy: "staff-1",
        currency: "EGP",
        content: CONTENT,
      }),
    );
    expect(first.draft.draftNumber).toBe("D1");
    expect(second.draft.draftNumber).toBe("D2");
    expect(first.draft.status).toBe("open");
    expect(value(await w.get.execute({ tenantId: T, draftId: first.draft.id })).tags).toEqual([
      "WhatsApp",
      "vip",
    ]);
  });

  it("refuses invalid content without burning a number", async () => {
    const w = await world();
    const refused = failure(
      await w.create.execute({
        tenantId: T,
        createdBy: "s",
        currency: "EGP",
        content: { ...CONTENT, lines: [] },
      }),
    );
    expect(refused.code).toBe("VALIDATION");
    const ok = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    );
    expect(ok.draft.draftNumber).toBe("D1");
  });
});

describe("UpdateDraftOrder", () => {
  it("bumps the version; a stale version answers VERSION_CONFLICT", async () => {
    const w = await world();
    const { draft } = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    );
    const updated = value(
      await w.update.execute({
        tenantId: T,
        draftId: draft.id,
        version: 0,
        content: { ...CONTENT, note: "x" },
      }),
    );
    expect(updated.draft.version).toBe(1);
    expect(updated.draft.note).toBe("x");
    const stale = failure(
      await w.update.execute({ tenantId: T, draftId: draft.id, version: 0, content: CONTENT }),
    );
    expect(stale.code).toBe("CONCURRENCY");
    expect(stale.message).toMatch(/^VERSION_CONFLICT:/);
  });

  it("refuses a completed draft and answers 404 for a deleted one", async () => {
    const w = await world();
    const a = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    ).draft;
    const b = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    ).draft;
    value(await w.complete.execute({ tenantId: T, draftId: a.id, orderRef: ORDER_ID }));
    expect(
      failure(await w.update.execute({ tenantId: T, draftId: a.id, version: 0, content: CONTENT }))
        .message,
    ).toMatch(/^DRAFT_COMPLETED:/);
    value(await w.remove.execute({ tenantId: T, draftId: b.id }));
    expect(
      failure(await w.update.execute({ tenantId: T, draftId: b.id, version: 0, content: CONTENT }))
        .code,
    ).toBe("NOT_FOUND");
  });
});

describe("DeleteDraftOrder / GetDraftOrder / ListDraftOrders", () => {
  it("soft-deletes: get answers 404, the list hides it, a completed draft cannot be deleted", async () => {
    const w = await world();
    const a = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    ).draft;
    const b = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    ).draft;
    value(await w.remove.execute({ tenantId: T, draftId: a.id }));
    expect(failure(await w.get.execute({ tenantId: T, draftId: a.id })).code).toBe("NOT_FOUND");
    expect((await w.drafts.findById(a.id, T))?.deletedAt).toEqual(NOW);
    expect(value(await w.list.execute({ tenantId: T })).items.map((d) => d.draftNumber)).toEqual([
      "D2",
    ]);
    value(await w.complete.execute({ tenantId: T, draftId: b.id, orderRef: ORDER_ID }));
    expect(failure(await w.remove.execute({ tenantId: T, draftId: b.id })).message).toMatch(
      /^DRAFT_COMPLETED:/,
    );
  });

  it("lists by status and by a # search", async () => {
    const w = await world();
    const a = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    ).draft;
    value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    );
    value(await w.invoiceSent.execute({ tenantId: T, draftId: a.id }));
    expect(
      value(await w.list.execute({ tenantId: T, status: "invoice_sent" })).items.map(
        (d) => d.draftNumber,
      ),
    ).toEqual(["D1"]);
    expect(
      value(await w.list.execute({ tenantId: T, search: "#d2" })).items.map((d) => d.draftNumber),
    ).toEqual(["D2"]);
  });
});

describe("MarkDraftInvoiceSent / SetDraftCheckout", () => {
  it("marks invoice sent without changing the version; CAS on the checkout", async () => {
    const w = await world();
    const { draft } = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    );
    const sent = value(await w.invoiceSent.execute({ tenantId: T, draftId: draft.id })).draft;
    expect(sent.status).toBe("invoice_sent");
    expect(sent.invoiceSentAt).toEqual(NOW);
    expect(sent.version).toBe(0);
    const input = {
      tenantId: T,
      draftId: draft.id,
      checkoutRef: "s-1",
      checkoutVersion: 0,
      expectedCheckoutRef: null,
    };
    expect(value(await w.setCheckout.execute(input))).toEqual({ applied: true });
    expect(value(await w.setCheckout.execute({ ...input, checkoutRef: "s-2" }))).toEqual({
      applied: false,
    });
  });
});

describe("CompleteDraftFromCheckout", () => {
  it("completes, copies note and tags onto the order and writes created_from_draft with the actor", async () => {
    const w = await world();
    const { draft } = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    );
    const done = value(
      await w.complete.execute({
        tenantId: T,
        draftId: draft.id,
        orderRef: ORDER_ID,
        actorRef: "staff-1",
      }),
    );
    expect(done).toEqual({ draftId: draft.id, orderRef: ORDER_ID, changed: true });
    const stored = await w.drafts.findById(draft.id, T);
    expect(stored?.status).toBe("completed");
    expect(stored?.orderRef).toBe(ORDER_ID);
    const annotations = (await w.annotations.annotationsOf([ORDER_ID], T)).get(ORDER_ID);
    expect(annotations?.note).toBe("Deliver after 5 pm");
    expect(annotations?.tags).toEqual(["vip", "WhatsApp"]);
    const lines = await w.timeline.listForOrder(ORDER_ID, T, { first: 200 });
    expect(lines.map((l) => [l.kind, l.authorName, l.data])).toEqual([
      ["created_from_draft", "Ahmed", { draftNumber: "D1", draftId: draft.id }],
    ]);
  });

  it("is idempotent for the same order and refuses another order", async () => {
    const w = await world();
    const { draft } = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    );
    value(await w.complete.execute({ tenantId: T, draftId: draft.id, orderRef: ORDER_ID }));
    expect(
      value(await w.complete.execute({ tenantId: T, draftId: draft.id, orderRef: ORDER_ID }))
        .changed,
    ).toBe(false);
    expect(
      failure(await w.complete.execute({ tenantId: T, draftId: draft.id, orderRef: "other" }))
        .message,
    ).toMatch(/^DRAFT_COMPLETED:/);
    expect(await w.timeline.listForOrder(ORDER_ID, T, { first: 200 })).toHaveLength(1);
  });

  it("a shopper's payment writes a system line (no author)", async () => {
    const w = await world();
    const { draft } = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    );
    value(await w.complete.execute({ tenantId: T, draftId: draft.id, orderRef: ORDER_ID }));
    const [line] = await w.timeline.listForOrder(ORDER_ID, T, { first: 200 });
    expect(line?.authorRef).toBeNull();
    expect(line?.authorName).toBeNull();
  });

  it("completes a deleted draft whose checkout became an order (Ruling 17)", async () => {
    const w = await world();
    const { draft } = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    );
    value(await w.remove.execute({ tenantId: T, draftId: draft.id }));
    expect(
      value(await w.complete.execute({ tenantId: T, draftId: draft.id, orderRef: ORDER_ID }))
        .changed,
    ).toBe(true);
    expect(value(await w.get.execute({ tenantId: T, draftId: draft.id })).status).toBe("completed");
  });

  it("an unknown draft is NOT_FOUND; another shop's draft is unknown", async () => {
    const w = await world();
    const { draft } = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    );
    expect(
      failure(
        await w.complete.execute({ tenantId: "tenant-b", draftId: draft.id, orderRef: ORDER_ID }),
      ).code,
    ).toBe("NOT_FOUND");
  });
});
```

(Run Prettier over the file after writing it; the long lines are wrapped there.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @platform/orders exec vitest run src/application/draft-orders.use-cases.test.ts`
Expected: FAIL — `Cannot find module './draft-orders.use-cases'`.

- [ ] **Step 3: Add `draftId` to the timeline data**

In `services/orders/src/domain/order-timeline.ts`, `OrderTimelineData`, after `draftNumber`:

```ts
  /** created_from_draft (Part 4, Ruling 24): the draft's id, for the order page's back-link. */
  readonly draftId?: string;
```

In `services/orders/src/infrastructure/prisma-order-timeline-repository.ts`, `readData`, read and return it like `draftNumber`:

```ts
  const draftId = raw["draftId"];
  …
    ...(typeof draftId === "string" ? { draftId } : {}),
```

- [ ] **Step 4: Write the use cases**

`services/orders/src/application/draft-orders.use-cases.ts`:

```ts
import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import {
  BusinessRuleError,
  ConcurrencyError,
  type DomainError,
  logger,
  NotFoundError,
} from "@platform/utils";
import type { OrderAnnotationRepository } from "../domain/order-annotations";
import {
  clampDraftPageSize,
  DraftOrder,
  normalizeDraftContent,
  normalizeDraftSearch,
  type DraftOrderContent,
  type DraftOrderStatus,
} from "../domain/draft-order";
import type {
  DraftNumberAllocator,
  DraftOrderPage,
  DraftOrderRepository,
} from "../domain/draft-order-repository";
import { parseTags } from "../domain/order-tags";
import { authorNameOf, type OrderActivityDeps } from "./order-activity";

export interface DraftOrdersDeps {
  readonly drafts: DraftOrderRepository;
  readonly draftNumbers: DraftNumberAllocator;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Where the completed order's note and tags are copied (Part 2's annotations). */
  readonly annotations: OrderAnnotationRepository;
  /** Where the `created_from_draft` line is written. */
  readonly activity: OrderActivityDeps;
}

export interface DraftOrderIdInput {
  /** ADR-0014: per-call tenant scope. */
  readonly tenantId: string;
  readonly draftId: string;
}

export interface DraftOrderOutput {
  readonly draft: DraftOrder;
}

function draftNotFound(): NotFoundError {
  return new NotFoundError("Draft order not found");
}

function completedRefusal(): BusinessRuleError {
  return new BusinessRuleError("DRAFT_COMPLETED: this draft order is already an order");
}

export interface CreateDraftOrderInput {
  readonly tenantId: string;
  /** The staff principal id. */
  readonly createdBy: string;
  /** The shop's currency — the lines were priced in it by the caller. */
  readonly currency: string;
  /** Lines priced server-side by the caller (never a browser price — anti-goal 1). */
  readonly content: DraftOrderContent;
}

/** Spec §4.8: a new draft, numbered D1, D2, … in the same transaction. */
export class CreateDraftOrder implements UseCase<
  CreateDraftOrderInput,
  DraftOrderOutput,
  DomainError
> {
  private readonly deps: DraftOrdersDeps;

  constructor(deps: DraftOrdersDeps) {
    this.deps = deps;
  }

  async execute(input: CreateDraftOrderInput): Promise<Result<DraftOrderOutput, DomainError>> {
    // Validated BEFORE a number is allocated: a refused draft never burns one.
    const content = normalizeDraftContent(input.content);
    if (!content.ok) return err(content.error);
    return this.deps.unitOfWork.run<Result<DraftOrderOutput, DomainError>>(async (tx) => {
      const draftNumber = await this.deps.draftNumbers.next(input.tenantId, tx);
      const created = DraftOrder.create({
        id: this.deps.idGenerator.generate(),
        draftNumber,
        currency: input.currency,
        createdBy: input.createdBy,
        now: this.deps.clock.now(),
        content: content.value,
      });
      if (!created.ok) return err(created.error);
      await this.deps.drafts.save(created.value, input.tenantId, tx);
      const stored = await this.deps.drafts.findById(created.value.id, input.tenantId, tx);
      return ok({ draft: stored ?? created.value });
    });
  }
}

export interface UpdateDraftOrderInput extends DraftOrderIdInput {
  /** The version the editor loaded (optimistic lock). */
  readonly version: number;
  readonly content: DraftOrderContent;
}

/** Spec §4.8 `PUT`: the full content, version-checked; refused once completed. */
export class UpdateDraftOrder implements UseCase<
  UpdateDraftOrderInput,
  DraftOrderOutput,
  DomainError
> {
  private readonly deps: DraftOrdersDeps;

  constructor(deps: DraftOrdersDeps) {
    this.deps = deps;
  }

  async execute(input: UpdateDraftOrderInput): Promise<Result<DraftOrderOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<DraftOrderOutput, DomainError>>(async (tx) => {
      const draft = await this.deps.drafts.findById(input.draftId, input.tenantId, tx);
      if (draft === null || draft.deletedAt !== null) return err(draftNotFound());
      if (draft.status === "completed") return err(completedRefusal());
      if (draft.version !== input.version) {
        return err(
          new ConcurrencyError("VERSION_CONFLICT: this draft order was changed by someone else"),
        );
      }
      const revised = draft.revise(input.content, this.deps.clock.now());
      if (!revised.ok) return err(revised.error);
      try {
        await this.deps.drafts.save(draft, input.tenantId, tx);
      } catch (error) {
        if (error instanceof ConcurrencyError) return err(error);
        throw error;
      }
      const stored = await this.deps.drafts.findById(input.draftId, input.tenantId, tx);
      return stored === null ? err(draftNotFound()) : ok({ draft: stored });
    });
  }
}

/** Spec §4.2 decision: a soft delete, only for open/invoice_sent drafts. */
export class DeleteDraftOrder implements UseCase<
  DraftOrderIdInput,
  { readonly draftId: string },
  DomainError
> {
  private readonly deps: DraftOrdersDeps;

  constructor(deps: DraftOrdersDeps) {
    this.deps = deps;
  }

  async execute(
    input: DraftOrderIdInput,
  ): Promise<Result<{ readonly draftId: string }, DomainError>> {
    return this.deps.unitOfWork.run<Result<{ readonly draftId: string }, DomainError>>(
      async (tx) => {
        const draft = await this.deps.drafts.findById(input.draftId, input.tenantId, tx);
        if (draft === null || draft.deletedAt !== null) return err(draftNotFound());
        if (draft.status === "completed") return err(completedRefusal());
        const deleted = await this.deps.drafts.softDelete(
          input.draftId,
          this.deps.clock.now(),
          input.tenantId,
          tx,
        );
        return deleted ? ok({ draftId: input.draftId }) : err(completedRefusal());
      },
    );
  }
}

/** One draft; a deleted draft is not found (the invoice claim relies on it: deleted → 404). */
export class GetDraftOrder implements UseCase<DraftOrderIdInput, DraftOrder, DomainError> {
  private readonly deps: Pick<DraftOrdersDeps, "drafts">;

  constructor(deps: Pick<DraftOrdersDeps, "drafts">) {
    this.deps = deps;
  }

  async execute(input: DraftOrderIdInput): Promise<Result<DraftOrder, DomainError>> {
    const draft = await this.deps.drafts.findById(input.draftId, input.tenantId);
    return draft === null || draft.deletedAt !== null ? err(draftNotFound()) : ok(draft);
  }
}

export interface ListDraftOrdersInput {
  readonly tenantId: string;
  readonly status?: DraftOrderStatus;
  readonly search?: string;
  readonly first?: number;
  readonly after?: string;
}

export class ListDraftOrders implements UseCase<ListDraftOrdersInput, DraftOrderPage, DomainError> {
  private readonly deps: Pick<DraftOrdersDeps, "drafts">;

  constructor(deps: Pick<DraftOrdersDeps, "drafts">) {
    this.deps = deps;
  }

  async execute(input: ListDraftOrdersInput): Promise<Result<DraftOrderPage, DomainError>> {
    const search = normalizeDraftSearch(input.search);
    return ok(
      await this.deps.drafts.list(
        {
          first: clampDraftPageSize(input.first),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(search === undefined ? {} : { search }),
          ...(input.after === undefined ? {} : { after: input.after }),
        },
        input.tenantId,
      ),
    );
  }
}

/** Spec §4.7: `status = invoice_sent` and `invoiceSentAt` (guarded, no version bump — Ruling 2). */
export class MarkDraftInvoiceSent implements UseCase<
  DraftOrderIdInput,
  DraftOrderOutput,
  DomainError
> {
  private readonly deps: DraftOrdersDeps;

  constructor(deps: DraftOrdersDeps) {
    this.deps = deps;
  }

  async execute(input: DraftOrderIdInput): Promise<Result<DraftOrderOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<DraftOrderOutput, DomainError>>(async (tx) => {
      const marked = await this.deps.drafts.markInvoiceSent(
        input.draftId,
        this.deps.clock.now(),
        input.tenantId,
        tx,
      );
      const draft = await this.deps.drafts.findById(input.draftId, input.tenantId, tx);
      if (draft === null || draft.deletedAt !== null) return err(draftNotFound());
      if (!marked) return err(completedRefusal());
      return ok({ draft });
    });
  }
}

export interface SetDraftCheckoutInput extends DraftOrderIdInput {
  readonly checkoutRef: string;
  /** The draft version the session was built from. */
  readonly checkoutVersion: number;
  /** The `checkoutRef` the caller read (compare-and-set, Ruling 3). */
  readonly expectedCheckoutRef: string | null;
}

/** Records the materialised session (spec §4.5 step 3). */
export class SetDraftCheckout implements UseCase<
  SetDraftCheckoutInput,
  { readonly applied: boolean },
  DomainError
> {
  private readonly deps: DraftOrdersDeps;

  constructor(deps: DraftOrdersDeps) {
    this.deps = deps;
  }

  async execute(
    input: SetDraftCheckoutInput,
  ): Promise<Result<{ readonly applied: boolean }, DomainError>> {
    return this.deps.unitOfWork.run(async (tx) =>
      ok({
        applied: await this.deps.drafts.setCheckout(
          input.draftId,
          { checkoutRef: input.checkoutRef, checkoutVersion: input.checkoutVersion },
          input.expectedCheckoutRef,
          input.tenantId,
          tx,
        ),
      }),
    );
  }
}

export interface CompleteDraftFromCheckoutInput extends DraftOrderIdInput {
  readonly orderRef: string;
  /** The staff member who completed it; absent when the shopper paid through the invoice link. */
  readonly actorRef?: string;
}

export interface CompleteDraftFromCheckoutOutput {
  readonly draftId: string;
  readonly orderRef: string;
  /** False when this order already completed the draft (idempotent repeat). */
  readonly changed: boolean;
}

/**
 * Spec §4.6 step 5 / §4.6 decision: the draft became `orderRef`. In ONE transaction: mark it completed
 * (guarded), copy its note and tags onto the order (Part 2's annotations, never the Order aggregate)
 * and append `created_from_draft` ("Order created from draft #D3", with the draft's id for the
 * back-link). Idempotent for the same order; called by the admin complete route, by Checkout's
 * `DraftOrderCompletionPort` and by the self-heal (Ruling 10).
 */
export class CompleteDraftFromCheckout implements UseCase<
  CompleteDraftFromCheckoutInput,
  CompleteDraftFromCheckoutOutput,
  DomainError
> {
  private readonly deps: DraftOrdersDeps;

  constructor(deps: DraftOrdersDeps) {
    this.deps = deps;
  }

  async execute(
    input: CompleteDraftFromCheckoutInput,
  ): Promise<Result<CompleteDraftFromCheckoutOutput, DomainError>> {
    const authorName =
      input.actorRef === undefined
        ? null
        : await authorNameOf(this.deps.activity.staff, input.actorRef, input.tenantId);
    return this.deps.unitOfWork.run<Result<CompleteDraftFromCheckoutOutput, DomainError>>(
      async (tx) => {
        const draft = await this.deps.drafts.findById(input.draftId, input.tenantId, tx);
        if (draft === null) return err(draftNotFound());
        const same = { draftId: draft.id, orderRef: input.orderRef };
        if (draft.status === "completed") {
          return draft.orderRef === input.orderRef
            ? ok({ ...same, changed: false })
            : err(completedRefusal());
        }
        const at = this.deps.clock.now();
        const changed = await this.deps.drafts.markCompleted(
          draft.id,
          { orderRef: input.orderRef, at },
          input.tenantId,
          tx,
        );
        if (!changed) return ok({ ...same, changed: false });

        const verified = await this.deps.annotations.annotationsOf(
          [input.orderRef],
          input.tenantId,
          tx,
        );
        if (!verified.has(input.orderRef)) {
          // The order is another context's commit; never write lines for an id this shop cannot see.
          logger.warn("draft completed by an order the annotations cannot see", {
            tenantId: input.tenantId,
            draftId: draft.id,
          });
          return ok({ ...same, changed: true });
        }
        if (draft.note !== null) {
          await this.deps.annotations.setNote(input.orderRef, draft.note, input.tenantId, tx);
        }
        const tags = parseTags(draft.tags);
        if (tags.ok && tags.value.length > 0) {
          await this.deps.annotations.addTags([input.orderRef], tags.value, input.tenantId, tx);
        }
        await this.deps.activity.timeline.append(
          {
            id: this.deps.activity.idGenerator.generate(),
            orderId: input.orderRef,
            kind: "created_from_draft",
            authorRef: input.actorRef ?? null,
            authorName,
            body: null,
            data: { draftNumber: draft.draftNumber, draftId: draft.id },
            createdAt: at,
            editedAt: null,
            deletedAt: null,
          },
          input.tenantId,
          tx,
        );
        return ok({ ...same, changed: true });
      },
    );
  }
}
```

(Run Prettier; the house style wraps at 100.)

Run the test → PASS.

- [ ] **Step 5: Controller, composition and exports**

`services/orders/src/interfaces/order.controller.ts` — import the eight use cases and their input types from `../application/draft-orders.use-cases`, add to `OrderControllerDeps`:

```ts
  readonly createDraftOrder: CreateDraftOrder;
  readonly updateDraftOrder: UpdateDraftOrder;
  readonly deleteDraftOrder: DeleteDraftOrder;
  readonly getDraftOrder: GetDraftOrder;
  readonly listDraftOrders: ListDraftOrders;
  readonly markDraftInvoiceSent: MarkDraftInvoiceSent;
  readonly setDraftCheckout: SetDraftCheckout;
  readonly completeDraftFromCheckout: CompleteDraftFromCheckout;
```

and the methods at the end of the class:

```ts
  /** Order operations Part 4: drafts (authorization is the caller's — `DraftOrdersAdminController`). */
  async createDraftOrder(input: CreateDraftOrderInput): Promise<ControllerResponse> {
    return present(await this.deps.createDraftOrder.execute(input), 201);
  }

  async updateDraftOrder(input: UpdateDraftOrderInput): Promise<ControllerResponse> {
    return present(await this.deps.updateDraftOrder.execute(input), 200);
  }

  async deleteDraftOrder(input: DraftOrderIdInput): Promise<ControllerResponse> {
    return present(await this.deps.deleteDraftOrder.execute(input), 200);
  }

  async getDraftOrder(input: DraftOrderIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getDraftOrder.execute(input), 200);
  }

  async listDraftOrders(input: ListDraftOrdersInput): Promise<ControllerResponse> {
    return present(await this.deps.listDraftOrders.execute(input), 200);
  }

  async markDraftInvoiceSent(input: DraftOrderIdInput): Promise<ControllerResponse> {
    return present(await this.deps.markDraftInvoiceSent.execute(input), 200);
  }

  async setDraftCheckout(input: SetDraftCheckoutInput): Promise<ControllerResponse> {
    return present(await this.deps.setDraftCheckout.execute(input), 200);
  }

  async completeDraftFromCheckout(input: CompleteDraftFromCheckoutInput): Promise<ControllerResponse> {
    return present(await this.deps.completeDraftFromCheckout.execute(input), 200);
  }
```

`services/orders/src/composition.ts`: `buildController` gains two parameters after `timeline` — `drafts: DraftOrderRepository, draftNumbers: DraftNumberAllocator` — and builds

```ts
const draftDeps = {
  drafts,
  draftNumbers,
  unitOfWork,
  idGenerator: deps.idGenerator,
  clock: deps.clock,
  annotations,
  activity: { timeline, staff, idGenerator: deps.idGenerator },
};
```

passing `createDraftOrder: new CreateDraftOrder(draftDeps)`, `updateDraftOrder: new UpdateDraftOrder(draftDeps)`, `deleteDraftOrder: new DeleteDraftOrder(draftDeps)`, `getDraftOrder: new GetDraftOrder({ drafts })`, `listDraftOrders: new ListDraftOrders({ drafts })`, `markDraftInvoiceSent: new MarkDraftInvoiceSent(draftDeps)`, `setDraftCheckout: new SetDraftCheckout(draftDeps)`, `completeDraftFromCheckout: new CompleteDraftFromCheckout(draftDeps)`. The Prisma branch passes `new PrismaDraftOrderRepository({ prisma: deps.prisma })` and `new PrismaDraftNumberAllocator()`; the in-memory branch `new InMemoryDraftOrderRepository()` and `new InMemoryDraftNumberAllocator()`. Nothing holds a tenant (binding carry 6).

`services/orders/src/index.ts` — append:

```ts
export {
  DEFAULT_DRAFT_DISCOUNT_TITLE,
  DRAFT_ORDER_STATUSES,
  DRAFT_PAGE_SIZE_MAX,
  DraftOrder,
  draftAmounts,
  draftRequirements,
  FREE_SHIPPING_TITLE,
  MAX_DRAFT_AMOUNT_MINOR,
  MAX_DRAFT_LINE_QUANTITY,
  MAX_DRAFT_LINES,
  type DraftAddress,
  type DraftAmounts,
  type DraftDiscount,
  type DraftLine,
  type DraftOrderContent,
  type DraftOrderSnapshot,
  type DraftOrderStatus,
  type DraftRequirement,
  type DraftShipping,
} from "./domain/draft-order";
export type { DraftOrderPage } from "./domain/draft-order-repository";
export type {
  CompleteDraftFromCheckoutInput,
  CompleteDraftFromCheckoutOutput,
  CreateDraftOrderInput,
  DraftOrderIdInput,
  DraftOrderOutput,
  ListDraftOrdersInput,
  SetDraftCheckoutInput,
  UpdateDraftOrderInput,
} from "./application/draft-orders.use-cases";
```

`services/orders/src/draft-orders.wiring.test.ts` — through `wireOrders` (in-memory branch, `InMemoryEventSerializer`, a counter `idGenerator`, fixed clock): `createDraftOrder` answers 201 with `draft.draftNumber === "D1"`; `getDraftOrder` for another tenant answers 404; `listDraftOrders` answers 200 with one item; `updateDraftOrder` with `version: 5` answers 409.

- [ ] **Step 6: Run the package gates**

Run: `pnpm --filter @platform/orders test`, `pnpm --filter @platform/orders typecheck`, `pnpm --filter @platform/orders lint` → green.
Run: `pnpm --filter @platform/admin typecheck` → green (the controller only gained members).

- [ ] **Step 7: Commit**

```bash
git add services/orders/src/application/draft-orders.use-cases.ts \
  services/orders/src/application/draft-orders.use-cases.test.ts \
  services/orders/src/domain/order-timeline.ts \
  services/orders/src/infrastructure/prisma-order-timeline-repository.ts \
  services/orders/src/interfaces/order.controller.ts services/orders/src/composition.ts \
  services/orders/src/index.ts services/orders/src/draft-orders.wiring.test.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(orders): draft order use cases and completion bookkeeping

Create, update (version-checked), soft delete, get, list, mark invoice sent, record the
materialised checkout, and complete from checkout: the note and tags are copied onto the
order and a created_from_draft line links back to the draft.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Draft terms on `CheckoutSession` — fixed discount and shipping, locks, ownership transfer, persistence

Model tier: **standard** (the aggregate change is small but every pricing path must leave a draft's figures alone).

**Files:**

- Create: `services/checkout/src/domain/value-objects/draft-terms.ts`
- Modify: `services/checkout/src/domain/checkout-session.ts`
- Create: `services/checkout/src/domain/checkout-session.drafts.test.ts`
- Modify: `services/checkout/src/infrastructure/checkout-session.mapper.ts`, `services/checkout/src/infrastructure/checkout-session.mapper.test.ts` (append a `describe`)
- Modify: `services/checkout/src/infrastructure/prisma-checkout-session-repository.ts`, `services/checkout/src/infrastructure/prisma-checkout-session-repository.test.ts` (append cases)
- Modify: `services/checkout/src/domain/abandoned-checkouts.ts`, `services/checkout/src/domain/abandoned-checkouts.test.ts` (append a case), `services/checkout/src/infrastructure/abandoned-checkout-fixture.ts`
- Modify: `services/checkout/src/application/discount-code.use-cases.ts`, `services/checkout/src/application/discount-code.use-cases.test.ts` (append a case)
- Modify: `apps/admin/src/infrastructure/cross-context/discount-usage.adapter.ts`, `apps/admin/src/infrastructure/cross-context/discount-adapters.test.ts` (append a case)
- Modify: `services/checkout/src/index.ts`

**Interfaces:**

- Consumes: `ShippingSelection` (`value-objects/selections`), `DiscountSnapshot`.
- Produces:
  - `draft-terms.ts`: `DRAFT_LOCKED = "DRAFT_LOCKED"`, `DRAFT_SHIPPING_METHOD = "draft"`, `draftPromotionId(draftOrderRef: string): string` (`"draft:<ref>"`), `isDraftPromotionId(promotionId: string): boolean`, `interface DraftTerms { draftOrderRef: string; draftNumber: string; discount?: { title: string; amountMinor: number }; shipping: { title: string; amountMinor: number } }`, `draftCartRef(draftOrderRef: string): string` (`"draft:<ref>"`, Ruling 1).
  - `CheckoutSession`: `get draftTerms(): DraftTerms | undefined`, `applyDraftTerms(terms: DraftTerms): void`, `transferOwnership(sessionRef: string): void`; `loadItems`, `selectShipping`, `enterDiscountCode`, `removeDiscountCode` throw `BusinessRuleError("DRAFT_LOCKED: …")` on a draft session; `reconstitute(..., extra.draftTerms)`.
  - Persistence: `draft_terms` mapped both ways; the Prisma `save` update writes `sessionRef` and `draftTerms`.
  - Abandoned definition excludes draft sessions (spec §3.1's `draft_terms = '{}'`).
  - `refreshDiscounts` returns without asking Promotions for a draft session.
  - `DiscountUsageAdapter.record` skips `draft:` entries.
  - `@platform/checkout` exports `DRAFT_LOCKED`, `DRAFT_SHIPPING_METHOD`, `draftPromotionId`, `isDraftPromotionId`, `draftCartRef`, `type DraftTerms`.

- [ ] **Step 1: Write the failing aggregate test**

`services/checkout/src/domain/checkout-session.drafts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { CheckoutSession } from "./checkout-session";
import { CheckoutAddress } from "./value-objects/checkout-address";
import { CheckoutItem } from "./value-objects/checkout-item";
import { draftCartRef, type DraftTerms } from "./value-objects/draft-terms";
import { ShippingSelection } from "./value-objects/selections";

function must<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error("invalid fixture");
  return r.value;
}

const DRAFT_ID = "33333333-3333-7333-8333-333333333333";
const TERMS: DraftTerms = {
  draftOrderRef: DRAFT_ID,
  draftNumber: "D3",
  discount: { title: "Loyal customer", amountMinor: 5000 },
  shipping: { title: "Courier", amountMinor: 4000 },
};

function draftSession(): CheckoutSession {
  const session = CheckoutSession.start(
    UniqueEntityId.from("01920000-0000-7000-8000-000000000001"),
    draftCartRef(DRAFT_ID),
    undefined,
    "server-minted-ref",
    "EGP",
  );
  session.loadItems([must(CheckoutItem.create("p-1", 2, 25000, "EGP"))]);
  session.setShippingAddress(
    must(
      CheckoutAddress.create({ line1: "1 Nile St", city: "Cairo", postalCode: "", country: "EG" }),
    ),
  );
  return session;
}

describe("CheckoutSession draft terms (spec §4.4)", () => {
  it("fixes the shipping and writes ONE draft discount entry; totals follow", () => {
    const session = draftSession();
    session.applyDraftTerms(TERMS);
    expect(session.draftTerms).toEqual(TERMS);
    expect(session.shippingSelection?.method).toBe("draft");
    expect(session.shippingSelection?.rateAmountMinor).toBe(4000);
    expect(session.shippingSelection?.name).toBe("Courier");
    expect(session.discountSnapshot?.applied).toEqual([
      {
        promotionId: `draft:${DRAFT_ID}`,
        title: "Loyal customer",
        discountClass: "order",
        amountMinor: 5000,
      },
    ]);
    expect(session.discountMinor).toBe(5000);
    session.recalculateTotals("evt-1", new Date(0));
    expect(session.totals?.totalMinor).toBe(50000 - 5000 + 4000);
  });

  it("no discount writes an empty snapshot (never a promotion lookup)", () => {
    const session = draftSession();
    session.applyDraftTerms({ ...TERMS, discount: undefined });
    expect(session.discountSnapshot?.applied).toEqual([]);
    expect(session.discountMinor).toBe(0);
  });

  it("refuses a discount above the subtotal, negative amounts, and terms without items (Review Focus 4)", () => {
    expect(() =>
      draftSession().applyDraftTerms({ ...TERMS, discount: { title: "x", amountMinor: 50001 } }),
    ).toThrow(/subtotal/);
    expect(() =>
      draftSession().applyDraftTerms({ ...TERMS, shipping: { title: "x", amountMinor: -1 } }),
    ).toThrow();
    const empty = CheckoutSession.start(
      UniqueEntityId.from("01920000-0000-7000-8000-000000000002"),
      "c",
      undefined,
      "r",
      "EGP",
    );
    expect(() => empty.applyDraftTerms(TERMS)).toThrow(/items/);
  });

  it("refuses another draft's terms on the same session", () => {
    const session = draftSession();
    session.applyDraftTerms(TERMS);
    expect(() => session.applyDraftTerms({ ...TERMS, draftOrderRef: "other" })).toThrow();
  });

  it("locks what the merchant fixed: items, shipping, codes (DRAFT_LOCKED)", () => {
    const session = draftSession();
    session.applyDraftTerms(TERMS);
    const item = must(CheckoutItem.create("p-1", 1, 1, "EGP"));
    const selection = must(ShippingSelection.create("standard", 0, "EGP"));
    expect(() => session.loadItems([item])).toThrow(/^DRAFT_LOCKED:/);
    expect(() => session.selectShipping(selection)).toThrow(/^DRAFT_LOCKED:/);
    expect(() => session.enterDiscountCode("SAVE10")).toThrow(/^DRAFT_LOCKED:/);
    expect(() => session.removeDiscountCode("SAVE10")).toThrow(/^DRAFT_LOCKED:/);
    // Contact and addresses stay open to the shopper.
    session.setShippingAddress(
      must(
        CheckoutAddress.create({ line1: "2 Nile St", city: "Giza", postalCode: "", country: "EG" }),
      ),
    );
    expect(session.shippingAddress?.line1).toBe("2 Nile St");
  });

  it("transfers ownership only for an open draft session (Ruling 22)", () => {
    const session = draftSession();
    expect(() => session.transferOwnership("guest-2")).toThrow();
    session.applyDraftTerms(TERMS);
    session.transferOwnership("guest-2");
    expect(session.sessionRef).toBe("guest-2");
    expect(() => session.transferOwnership(" ")).toThrow();
    session.expire("evt-x", new Date(0));
    expect(() => session.transferOwnership("guest-3")).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @platform/checkout exec vitest run src/domain/checkout-session.drafts.test.ts`
Expected: FAIL — `Cannot find module './value-objects/draft-terms'`.

- [ ] **Step 3: Write the value object and the aggregate changes**

`services/checkout/src/domain/value-objects/draft-terms.ts`:

```ts
/**
 * Order operations Part 4 — what a merchant fixed on a draft order's checkout (spec §4.4): the price is
 * final, so the discount and the shipping are set here and never re-evaluated. Plain data so Checkout
 * imports nothing from Orders.
 */
export interface DraftTerms {
  /** The draft order's id (bare reference into Orders). */
  readonly draftOrderRef: string;
  /** "D3" — shown on the storefront ("Invoice #D3"). */
  readonly draftNumber: string;
  readonly discount?: { readonly title: string; readonly amountMinor: number };
  readonly shipping: { readonly title: string; readonly amountMinor: number };
}

/** The 409 code the public routes answer when a shopper tries to change what the merchant fixed. */
export const DRAFT_LOCKED = "DRAFT_LOCKED";
/** The shipping method recorded on a draft session (snapshotted onto the order). */
export const DRAFT_SHIPPING_METHOD = "draft";

/** The discount entry's `promotionId` — `DiscountUsageAdapter` skips it (no promotion to count). */
export function draftPromotionId(draftOrderRef: string): string {
  return `draft:${draftOrderRef}`;
}

export function isDraftPromotionId(promotionId: string): boolean {
  return promotionId.startsWith("draft:");
}

/** Ruling 1: a draft session has no cart row; its `cartRef` names the draft. */
export function draftCartRef(draftOrderRef: string): string {
  return `draft:${draftOrderRef}`;
}
```

In `services/checkout/src/domain/checkout-session.ts`:

1. Imports: `import { ShippingSelection } from "./value-objects/selections";` (value import, alongside the existing type import of `PaymentSelection`), and `import { DRAFT_SHIPPING_METHOD, draftPromotionId, type DraftTerms } from "./value-objects/draft-terms";`.
2. In `CheckoutSessionProps`, change `readonly sessionRef: string;` to `sessionRef: string;` (comment: "Part 4: replaced only by `transferOwnership`") and add after `recoveredOrderRef`:

```ts
  /** Order operations Part 4: the merchant's fixed terms on a draft order's checkout; absent otherwise. */
  draftTerms?: DraftTerms;
```

3. `reconstitute`'s `extra` gains `readonly draftTerms?: DraftTerms;` and the props literal `draftTerms: extra.draftTerms,`.
4. Add the lock helper next to `ensureOpen`:

```ts
  /** Part 4: what the merchant fixed on a draft order's checkout cannot be changed by the shopper. */
  private ensureNotDraftLocked(what: string): void {
    if (this.props.draftTerms !== undefined) {
      throw new BusinessRuleError(`DRAFT_LOCKED: the ${what} of a draft order's checkout is fixed`);
    }
  }
```

and call it right after `this.ensureOpen();` in `loadItems` (`"items"`), `selectShipping` (`"shipping"`), `enterDiscountCode` and `removeDiscountCode` (`"discount"`). 5. Add the two methods after `markRecovered`:

```ts
  /**
   * Order operations Part 4 (spec §4.4): fixes the merchant's discount and shipping on a draft order's
   * checkout. Items must be loaded first (the discount is checked against their subtotal and can never
   * exceed it). One `draft:<id>` order discount entry, or none; no codes; the shipping selection is the
   * fixed `draft` method. Never computed elsewhere: `refreshDiscounts` leaves a draft session alone.
   */
  applyDraftTerms(terms: DraftTerms): void {
    this.ensureOpen();
    const current = this.props.draftTerms;
    if (current !== undefined && current.draftOrderRef !== terms.draftOrderRef) {
      throw new BusinessRuleError("This checkout belongs to another draft order");
    }
    if (this.props.items.length === 0) {
      throw new BusinessRuleError("A draft order's checkout needs its items before its terms");
    }
    const subtotal = this.props.items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
    const discountMinor = terms.discount?.amountMinor ?? 0;
    if (!Number.isInteger(discountMinor) || discountMinor < 0 || discountMinor > subtotal) {
      throw new BusinessRuleError("A draft discount must be between zero and the subtotal");
    }
    const shipping = ShippingSelection.create(
      DRAFT_SHIPPING_METHOD,
      terms.shipping.amountMinor,
      this.props.currency,
      { name: terms.shipping.title },
    );
    if (!shipping.ok) throw new BusinessRuleError(shipping.error.message);
    this.props.draftTerms = terms;
    this.props.shippingSelection = shipping.value;
    this.props.discountCodes = [];
    this.props.discountSnapshot = {
      applied:
        terms.discount === undefined || discountMinor === 0
          ? []
          : [
              {
                promotionId: draftPromotionId(terms.draftOrderRef),
                title: terms.discount.title,
                discountClass: "order",
                amountMinor: discountMinor,
              },
            ],
      orderDiscountMinor: discountMinor,
      shippingDiscountMinor: 0,
      codeStatuses: [],
      lineAllocations: [],
    };
    this.props.discountMinor = discountMinor;
  }

  /**
   * Order operations Part 4 (spec §4.7): the invoice link's opener takes over this draft checkout — the
   * server-minted `sessionRef` is replaced by the claimer's own guest cookie value. Draft sessions only
   * (Ruling 22), and only while open.
   */
  transferOwnership(sessionRef: string): void {
    this.ensureOpen();
    if (this.props.draftTerms === undefined) {
      throw new BusinessRuleError("Only a draft order's checkout can change hands");
    }
    if (sessionRef.trim().length === 0) {
      throw new BusinessRuleError("A checkout needs an owner");
    }
    this.props.sessionRef = sessionRef;
  }
```

6. Getter: `get draftTerms(): DraftTerms | undefined { return this.props.draftTerms; }`.

Run the test → PASS. Run `pnpm --filter @platform/checkout test` → the existing suites still PASS (no session they build has draft terms).

- [ ] **Step 4: Persist the terms and the new owner (tests first)**

Append to `services/checkout/src/infrastructure/checkout-session.mapper.test.ts`:

```ts
describe("CheckoutSessionMapper — draft terms (order operations Part 4)", () => {
  it("round-trips draft terms and a transferred owner; {} means none", () => {
    const session = CheckoutSession.start(
      UniqueEntityId.from("01920000-0000-7000-8000-000000000009"),
      "draft:d-1",
      undefined,
      "server-ref",
      "EGP",
    );
    session.loadItems([unwrap(CheckoutItem.create("p-1", 1, 1000, "EGP"))]);
    session.applyDraftTerms({
      draftOrderRef: "d-1",
      draftNumber: "D1",
      shipping: { title: "Courier", amountMinor: 500 },
    });
    session.transferOwnership("guest-2");
    const row = CheckoutSessionMapper.toRow(session, "t");
    expect(row.draftTerms).toEqual({
      draftOrderRef: "d-1",
      draftNumber: "D1",
      shipping: { title: "Courier", amountMinor: 500 },
    });
    expect(row.sessionRef).toBe("guest-2");
    const back = CheckoutSessionMapper.toDomain({ ...row, version: 1 } as never);
    expect(back.draftTerms).toEqual(row.draftTerms);
    expect(back.sessionRef).toBe("guest-2");
    const plain = CheckoutSessionMapper.toDomain({ ...row, draftTerms: {}, version: 1 } as never);
    expect(plain.draftTerms).toBeUndefined();
  });
});
```

(`unwrap` / imports: reuse the helpers at the top of that file; add the ones missing.)

Append to `services/checkout/src/infrastructure/prisma-checkout-session-repository.test.ts` (it runs over fake-prisma): save a draft session (version 0), load it, `transferOwnership("guest-2")`, save again → the stored row's `sessionRef` is `"guest-2"` and `draftTerms.draftNumber` is `"D1"`.

In `services/checkout/src/infrastructure/checkout-session.mapper.ts`:

```ts
interface DraftTermsJson {
  readonly draftOrderRef: string;
  readonly draftNumber: string;
  readonly discount?: { readonly title: string; readonly amountMinor: number };
  readonly shipping: { readonly title: string; readonly amountMinor: number };
}
```

`CheckoutSessionRow` gains `readonly draftTerms?: DraftTermsJson | Record<string, never>;` (optional, like the Part 3 columns). `toDomain` passes `draftTerms: row.draftTerms !== undefined && isSet(row.draftTerms) ? row.draftTerms : undefined,` in `extra`. `toRow` adds:

```ts
      draftTerms:
        session.draftTerms === undefined
          ? {}
          : (JSON.parse(JSON.stringify(session.draftTerms)) as JsonObject),
```

In `services/checkout/src/infrastructure/prisma-checkout-session-repository.ts`: `toDomain` adds `draftTerms: row.draftTerms as Record<string, never>,`; the `updateMany` `data` adds `sessionRef: row.sessionRef,` and `draftTerms: row.draftTerms,` (Ruling 22: the owner changes only through `transferOwnership`, which this persists).

Run the two test files → PASS.

- [ ] **Step 5: Draft sessions are never "abandoned" (test first)**

Append to `services/checkout/src/domain/abandoned-checkouts.test.ts` inside `describe("isAbandonedCheckout (spec §3.1)")`:

```ts
it("not a draft order's checkout — the draft list owns it (spec §3.1, draft_terms = '{}')", () => {
  const session = CheckoutSession.start(
    UniqueEntityId.from("01920000-0000-7000-8000-0000000000d1"),
    "draft:d-1",
    undefined,
    "r",
    "EGP",
  );
  session.loadItems([must(CheckoutItem.create("p-1", 1, 1000, "EGP"))]);
  session.setContactEmail(must(ContactEmail.create("draft@example.com")));
  session.applyDraftTerms({
    draftOrderRef: "d-1",
    draftNumber: "D1",
    shipping: { title: "Courier", amountMinor: 0 },
  });
  expect(isAbandonedCheckout({ session, createdAt: IDLE_AT, updatedAt: IDLE_AT }, OLDER_THAN)).toBe(
    false,
  );
});
```

(use the file's own helpers / constants for `must`, the idle time and `olderThan`; add imports that are missing.)

In `services/checkout/src/domain/abandoned-checkouts.ts`, `isAbandonedCheckout`'s second clause gains `session.draftTerms === undefined &&` first, and its doc comment mentions "not a draft order's checkout".

In `services/checkout/src/infrastructure/prisma-checkout-session-repository.ts`, `listAbandoned`'s non-recovered branch gains `AND "draft_terms" = '{}'::jsonb` after the `"items" <> '[]'::jsonb` line. Part 3's resolution 13 is closed by this.

In `services/checkout/src/infrastructure/abandoned-checkout-fixture.ts`, add `"draft"` to `FIXTURE_NAMES`, build it like `emailOnly` (`email: "draft@example.com"`) then `applyDraftTerms({ draftOrderRef: "draft-fixture", draftNumber: "D1", shipping: { title: "Courier", amountMinor: 0 } })`, and save it at `IDLE` with the own-tenant sessions. Both stores must drop it: if a test enumerates the dropped names, add `draft` to that list.

Run: `pnpm --filter @platform/checkout exec vitest run src/domain/abandoned-checkouts.test.ts src/infrastructure/in-memory-checkout-session-repository.test.ts` → PASS.

- [ ] **Step 6: Promotions are never asked for a draft session (test first)**

Append to `services/checkout/src/application/discount-code.use-cases.test.ts`:

```ts
describe("refreshDiscounts on a draft order's checkout (spec §4.4 decision)", () => {
  it("never calls Promotions and keeps the draft's own discount", async () => {
    const session = CheckoutSession.start(
      UniqueEntityId.from("01920000-0000-7000-8000-0000000000d2"),
      "draft:d-1",
      undefined,
      "r",
      "EGP",
    );
    session.loadItems([must(CheckoutItem.create("p-1", 2, 25000, "EGP"))]);
    session.applyDraftTerms({
      draftOrderRef: "d-1",
      draftNumber: "D1",
      discount: { title: "Loyal", amountMinor: 5000 },
      shipping: { title: "Courier", amountMinor: 4000 },
    });
    let calls = 0;
    const port = {
      evaluate: async () => {
        calls += 1;
        throw new Error("must not be called");
      },
    };
    await refreshDiscounts(session, port as never, "t");
    expect(calls).toBe(0);
    expect(session.discountMinor).toBe(5000);
    expect(session.discountSnapshot?.applied[0]?.promotionId).toBe("draft:d-1");
  });
});
```

In `refreshDiscounts` (`services/checkout/src/application/discount-code.use-cases.ts`) add as the first statement:

```ts
// Part 4 (spec §4.4 decision): a draft's price is final — no automatic discount and no code is ever
// evaluated for it; its snapshot was written by `applyDraftTerms`.
if (session.draftTerms !== undefined) return;
```

Every caller (`RequestTaxCalculation`, `RecalculateTotals`, `AddDiscountCode`, `RemoveDiscountCode`, `CompleteCheckout`'s `DISCOUNTS_CHANGED` re-check) goes through it, so none can move a draft's figures; `refreshDiscountsAndTax` then reports `discountsChanged: false`.

- [ ] **Step 7: Discount usage skips the draft entry (test first)**

Append to `apps/admin/src/infrastructure/cross-context/discount-adapters.test.ts` (inside the `DiscountUsageAdapter` describe, reusing its stubs):

```ts
it("skips a draft order's discount — no promotion and no coupon is counted (spec §4.4)", async () => {
  const recordUsage = vi.fn();
  const redeem = vi.fn();
  const adapter = new DiscountUsageAdapter({ recordUsage } as never, { redeem } as never);
  await adapter.record({
    tenantId: "t",
    orderRef: "o-1",
    applied: [
      { promotionId: "draft:d-1", title: "Loyal", discountClass: "order", amountMinor: 500 },
    ],
  });
  expect(recordUsage).not.toHaveBeenCalled();
  expect(redeem).not.toHaveBeenCalled();
});
```

In `DiscountUsageAdapter.record`, first line of the loop body:

```ts
// Part 4: a draft order's own discount names no promotion or coupon.
if (isDraftPromotionId(discount.promotionId)) continue;
```

with `import { isDraftPromotionId, type DiscountUsagePort } from "@platform/checkout";`.

- [ ] **Step 8: Exports and gates**

`services/checkout/src/index.ts` — append:

```ts
export {
  DRAFT_LOCKED,
  DRAFT_SHIPPING_METHOD,
  draftCartRef,
  draftPromotionId,
  isDraftPromotionId,
  type DraftTerms,
} from "./domain/value-objects/draft-terms";
```

Run: `pnpm --filter @platform/checkout test`, `typecheck`, `lint`; `pnpm --filter @platform/admin exec vitest run src/infrastructure/cross-context/discount-adapters.test.ts`; `pnpm --filter @platform/admin typecheck` → green.

- [ ] **Step 9: Commit**

```bash
git add services/checkout/src/domain/value-objects/draft-terms.ts \
  services/checkout/src/domain/checkout-session.ts \
  services/checkout/src/domain/checkout-session.drafts.test.ts \
  services/checkout/src/infrastructure/checkout-session.mapper.ts \
  services/checkout/src/infrastructure/checkout-session.mapper.test.ts \
  services/checkout/src/infrastructure/prisma-checkout-session-repository.ts \
  services/checkout/src/infrastructure/prisma-checkout-session-repository.test.ts \
  services/checkout/src/domain/abandoned-checkouts.ts \
  services/checkout/src/domain/abandoned-checkouts.test.ts \
  services/checkout/src/infrastructure/abandoned-checkout-fixture.ts \
  services/checkout/src/application/discount-code.use-cases.ts \
  services/checkout/src/application/discount-code.use-cases.test.ts \
  services/checkout/src/index.ts \
  apps/admin/src/infrastructure/cross-context/discount-usage.adapter.ts \
  apps/admin/src/infrastructure/cross-context/discount-adapters.test.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(checkout): draft terms on the checkout session

A draft order's checkout carries the merchant's fixed discount and shipping: promotions and
codes are never evaluated for it, items, shipping and codes are locked (DRAFT_LOCKED), the
invoice opener can take ownership, and it never shows as an abandoned checkout.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Checkout draft use cases — start, pay, quote, invoice links, claim, revoke — and `CompleteCheckout` reporting back

Model tier: **senior** (link lifecycle, ownership and the post-commit report are security-relevant; binding carry 1 lives here).

**Files:**

- Modify: `services/checkout/src/domain/checkout-link.ts` (`INVOICE_LINK_TTL_MS`)
- Modify: `services/checkout/src/domain/checkout-link-repository.ts`, `src/infrastructure/prisma-checkout-link-repository.ts`, `src/infrastructure/in-memory-checkout-link-repository.ts`
- Create: `services/checkout/src/infrastructure/checkout-link-repository.drafts.test.ts`
- Modify: `services/checkout/src/application/address-province.ts` (`checkoutAddressProblem`)
- Create: `services/checkout/src/application/draft-checkout.use-cases.ts`, `services/checkout/src/application/draft-checkout.use-cases.test.ts`
- Modify: `services/checkout/src/application/abandoned-checkouts.use-cases.ts` (`ResolveCheckoutLink` invoice branch) and its test (narrow `resolved` by `purpose`)
- Modify: `services/checkout/src/application/ports.ts` (`DraftOrderCompletionPort`), `src/application/complete-checkout.use-case.ts`
- Create: `services/checkout/src/application/complete-checkout.drafts.test.ts`
- Modify: `services/checkout/src/interfaces/checkout.controller.ts`, `src/composition.ts`, `src/index.ts`
- Modify: `apps/admin/src/http/public-checkout-routes.ts` (`DRAFT_LOCKED`, `draftInvoice`), `apps/admin/src/http/public-checkout-link-routes.ts` (narrow `resolved` by `purpose`; the invoice branch itself is Task 7)
- Create: `apps/admin/src/http/public-checkout-drafts.test.ts`

**Interfaces:**

- Consumes (Task 3): `DraftTerms`, `draftCartRef`, `DRAFT_LOCKED`, `CheckoutSession.applyDraftTerms/transferOwnership/draftTerms`. Existing: `calculateAndStoreTax`, `checkoutItemsFrom`, `provinceProblem`, `CheckoutLink`, `LINK_INVALID`, `PaymentSelection`.
- Produces:
  - `checkout-link.ts`: `INVOICE_LINK_TTL_MS = 2_592_000_000` (30 days).
  - `CheckoutLinkRepository` gains `revokeForDraft(draftOrderRef, tenantId, now, tx?): Promise<number>` and `listForDraft(draftOrderRef, tenantId, tx?): Promise<readonly CheckoutLink[]>`; `save` of a loaded link is a guarded `updateMany` (`revokedAt: null` in the `where`) that writes only `revokedAt`.
  - `address-province.ts`: `checkoutAddressProblem(input: CheckoutAddressInput): ValidationError | null`.
  - `draft-checkout.use-cases.ts`: `newDraftSessionRef(): string`; `StartDraftCheckout` (`StartDraftCheckoutInput { tenantId; draftOrderRef; draftNumber; customerRef?; currency; items: LoadItemsInput["items"]; contactEmail?; shippingAddress: CheckoutAddressInput; billingAddress: CheckoutAddressInput; discount?: { title; amountMinor }; shipping: { title; amountMinor }; replaces?: string }` → `{ checkoutSessionId }`); `SelectDraftPayment` (`{ tenantId; checkoutSessionId; provider: "cod" | "manual" }` → `{ checkoutSessionId }`); `QuoteDraftShipping` (`{ tenantId; currency; address: { country; province?; postalCode }; items }` → `{ quotes: readonly ShippingQuote[] }`); `EstimateDraftTax` (`{ tenantId; currency; items; destination: { country; province? }; shippingMinor; discountMinor }` → `TaxCalculationResult`); `IssueInvoiceLink` (`{ tenantId; draftOrderRef; createdBy }` → `IssueInvoiceLinkOutput { linkId; token; expiresAt }`); `ClaimInvoiceCheckout` (`{ tenantId; linkId; checkoutSessionId; sessionRef }` → `{ checkoutSessionId; claimCount }`); `RevokeDraftLinks` (`{ tenantId; draftOrderRef }` → `{ revoked: number }`); `ListDraftLinks` (`{ tenantId; draftOrderRef }` → `readonly CheckoutLink[]`).
  - `ResolveCheckoutLinkOutput` becomes `{ purpose: "recovery"; link; session } | { purpose: "invoice"; link; draftOrderRef: string }`.
  - `ports.ts`: `interface DraftOrderCompletionPort { complete(input: { tenantId; draftOrderRef; orderRef; actorRef?: string }): Promise<void> }`.
  - `CompleteCheckoutInput.actorRef?: string`; `CompleteCheckoutDeps.draftCompletion?: DraftOrderCompletionPort`. Completion REPORTS only; it does not revoke the draft's invoice links (Ruling 11: a completed draft's link must still answer "already placed").
  - `CheckoutController`: `startDraft`, `selectDraftPayment`, `quoteDraftShipping`, `estimateDraftTax`, `issueInvoiceLink` (201), `claimInvoice`, `revokeDraftLinks`, `listDraftLinks`.
  - `CheckoutWiringDeps.draftCompletion?: DraftOrderCompletionPort`.
  - `PublicCheckoutSessionDto.draftInvoice: { draftNumber: string } | null`; `draftLockedResponse()` exported from `public-checkout-routes.ts`.

- [ ] **Step 1: Write the failing link-repository test (binding carry 1)**

`services/checkout/src/infrastructure/checkout-link-repository.drafts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import { CheckoutLink, INVOICE_LINK_TTL_MS } from "../domain/checkout-link";
import type { CheckoutLinkRepository } from "../domain/checkout-link-repository";
import { InMemoryCheckoutLinkRepository } from "./in-memory-checkout-link-repository";
import { PrismaCheckoutLinkRepository } from "./prisma-checkout-link-repository";

const T = "tenant-a";
const NOW = new Date("2026-10-25T10:00:00.000Z");
const LATER = new Date(NOW.getTime() + 60_000);
let n = 0;
const nextId = () => `01920000-0000-7000-8000-${(n += 1).toString().padStart(12, "0")}`;

function invoice(draftOrderRef: string, now = NOW): CheckoutLink {
  return CheckoutLink.issue({
    id: nextId(),
    purpose: "invoice",
    target: { draftOrderRef },
    createdBy: "staff",
    now,
    ttlMs: INVOICE_LINK_TTL_MS,
  }).link;
}

const layers: readonly [string, () => { repo: CheckoutLinkRepository; tx: unknown }][] = [
  ["in-memory", () => ({ repo: new InMemoryCheckoutLinkRepository(), tx: {} })],
  [
    "prisma over fake-prisma",
    () => {
      const fake = createFakePrisma();
      return {
        repo: new PrismaCheckoutLinkRepository({ prisma: fake.database }),
        tx: fake.database,
      };
    },
  ],
];

describe.each(layers)("invoice links (%s)", (_name, make) => {
  it("invoice links last 30 days", () => {
    expect(INVOICE_LINK_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(invoice("d-1").expiresAt.getTime() - NOW.getTime()).toBe(INVOICE_LINK_TTL_MS);
  });

  it("revokeForDraft revokes only that draft's live invoice links, writing only revokedAt", async () => {
    const { repo, tx } = make();
    const a = invoice("d-1");
    const b = invoice("d-1");
    const other = invoice("d-2");
    for (const link of [a, b, other]) await repo.save(link, T, tx);
    expect(await repo.recordClaim(a.id, T, NOW, "s-1", tx)).toBe(1);
    expect(await repo.revokeForDraft("d-1", T, LATER, tx)).toBe(2);
    expect(await repo.revokeForDraft("d-1", T, new Date(LATER.getTime() + 1), tx)).toBe(0);
    const revokedA = await repo.findById(a.id, T);
    expect(revokedA?.revokedAt).toEqual(LATER);
    // The claim fields written by recordClaim are untouched (binding carry 1).
    expect(revokedA?.claimCount).toBe(1);
    expect(revokedA?.resultCheckoutRef).toBe("s-1");
    expect((await repo.findById(other.id, T))?.revokedAt).toBeNull();
    expect(await repo.revokeForDraft("d-1", "tenant-b", LATER, tx)).toBe(0);
  });

  it("save of a loaded link never re-writes the claim fields and never moves a first revocation", async () => {
    const { repo, tx } = make();
    const link = invoice("d-1");
    await repo.save(link, T, tx);
    const stale = await repo.findById(link.id, T);
    await repo.recordClaim(link.id, T, NOW, "s-1", tx);
    stale?.revoke(LATER);
    await repo.save(stale as CheckoutLink, T, tx);
    const again = await repo.findById(link.id, T);
    again?.revoke(new Date(LATER.getTime() + 5));
    // `revoke` keeps the first timestamp in the aggregate; the guarded update would refuse anyway.
    await repo.save(again as CheckoutLink, T, tx);
    const stored = await repo.findById(link.id, T);
    expect(stored?.claimCount).toBe(1);
    expect(stored?.resultCheckoutRef).toBe("s-1");
    expect(stored?.revokedAt).toEqual(LATER);
  });

  it("listForDraft answers the draft's invoice links, newest first, in this shop only", async () => {
    const { repo, tx } = make();
    const older = invoice("d-1", NOW);
    const newer = invoice("d-1", LATER);
    await repo.save(older, T, tx);
    await repo.save(newer, T, tx);
    await repo.save(invoice("d-2"), T, tx);
    expect((await repo.listForDraft("d-1", T)).map((l) => l.id)).toEqual([newer.id, older.id]);
    expect(await repo.listForDraft("d-1", "tenant-b")).toEqual([]);
  });
});
```

Run: `pnpm --filter @platform/checkout exec vitest run src/infrastructure/checkout-link-repository.drafts.test.ts`
Expected: FAIL — `INVOICE_LINK_TTL_MS` is not exported / `revokeForDraft` is not a function.

- [ ] **Step 2: Implement the link changes**

`services/checkout/src/domain/checkout-link.ts`, after `RECOVERY_LINK_TTL_MS`:

```ts
/** An invoice link works for 30 days (spec §3.3 / §4.7). */
export const INVOICE_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
```

`services/checkout/src/domain/checkout-link-repository.ts` — reword the `save` doc ("…otherwise sets its revocation, once: a guarded update that writes ONLY `revokedAt` where it is still null — the claim fields are `recordClaim`'s alone") and add:

```ts
  /**
   * Part 4: revokes every still-live invoice link of a draft (completed or deleted). ONE guarded
   * `updateMany` that writes only `revokedAt` where it is null — never a claim field (binding carry 1).
   * Answers how many it revoked. Needs the unit of work's `tx`.
   */
  revokeForDraft(draftOrderRef: string, tenantId: string, now: Date, tx?: unknown): Promise<number>;
  /** Part 4: a draft's invoice links, newest first. */
  listForDraft(draftOrderRef: string, tenantId: string, tx?: unknown): Promise<readonly CheckoutLink[]>;
```

`services/checkout/src/infrastructure/prisma-checkout-link-repository.ts` — in `save`, the update of a loaded link becomes:

```ts
// Only the revocation, and only the first one: `claimCount`, `lastClaimedAt` and `resultCheckoutRef`
// are written by `recordClaim` alone (binding carry 1), and a later save never moves `revokedAt`.
if (s.revokedAt === null) return;
await client.checkoutLink.updateMany({
  where: { id: s.id, tenantId, revokedAt: null },
  data: { revokedAt: s.revokedAt },
});
```

and add:

```ts
  async revokeForDraft(
    draftOrderRef: string,
    tenantId: string,
    now: Date,
    tx?: unknown,
  ): Promise<number> {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaCheckoutLinkRepository.revokeForDraft requires the unit of work's transaction client (ADR-0003).",
      );
    }
    const { count } = await (tx as TransactionClient).checkoutLink.updateMany({
      where: { tenantId, draftOrderRef, purpose: "invoice", revokedAt: null },
      data: { revokedAt: now },
    });
    return count;
  }

  async listForDraft(
    draftOrderRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly CheckoutLink[]> {
    const rows = await this.read(tenantId, tx, (client) =>
      client.checkoutLink.findMany({ where: { tenantId, draftOrderRef, purpose: "invoice" } }),
    );
    return newestFirst(rows.map(toDomain));
  }
```

`services/checkout/src/infrastructure/in-memory-checkout-link-repository.ts` — `save` of a loaded link writes `revokedAt` only when the stored one is null:

```ts
const stored = bucket.get(link.id);
if (stored !== undefined && stored.revokedAt === null && link.revokedAt !== null) {
  bucket.set(link.id, { ...stored, revokedAt: link.revokedAt });
}
```

and add:

```ts
  async revokeForDraft(draftOrderRef: string, tenantId: string, now: Date): Promise<number> {
    const bucket = this.store.get(tenantId);
    if (bucket === undefined) return 0;
    let revoked = 0;
    for (const [id, stored] of bucket) {
      if (stored.purpose === "invoice" && stored.draftOrderRef === draftOrderRef && stored.revokedAt === null) {
        bucket.set(id, { ...stored, revokedAt: now });
        revoked += 1;
      }
    }
    return revoked;
  }

  async listForDraft(draftOrderRef: string, tenantId: string): Promise<readonly CheckoutLink[]> {
    return newestFirst(
      [...(this.store.get(tenantId)?.values() ?? [])]
        .filter((stored) => stored.purpose === "invoice" && stored.draftOrderRef === draftOrderRef)
        .map((stored) => CheckoutLink.reconstitute(stored)),
    );
  }
```

Any test double that implements `CheckoutLinkRepository` (grep `implements CheckoutLinkRepository` and `CheckoutLinkRepository = {` in `services/checkout/src`) gains the two methods (`async () => 0`, `async () => []`).

Run Step 1's test → PASS; `pnpm --filter @platform/checkout exec vitest run src/infrastructure/checkout-link-repository.claims.test.ts` → still PASS.

- [ ] **Step 3: Write the failing use-case test**

`services/checkout/src/application/draft-checkout.use-cases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import type { Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { CheckoutEventTranslator } from "../infrastructure/checkout-event-translator";
import { InMemoryCheckoutLinkRepository } from "../infrastructure/in-memory-checkout-link-repository";
import { InMemoryCheckoutSessionRepository } from "../infrastructure/in-memory-checkout-session-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { ResolveCheckoutLink } from "./abandoned-checkouts.use-cases";
import {
  ClaimInvoiceCheckout,
  IssueInvoiceLink,
  RevokeDraftLinks,
  SelectDraftPayment,
  StartDraftCheckout,
  type StartDraftCheckoutInput,
} from "./draft-checkout.use-cases";

const T = "tenant-a";
const DRAFT = "33333333-3333-7333-8333-333333333333";
const NOW = new Date("2026-10-25T10:00:00.000Z");
const ADDRESS = {
  name: "Mona Ali",
  phone: "01001234567",
  line1: "5 Nile St",
  city: "Cairo",
  postalCode: "",
  country: "EG",
  province: "EG-C",
};

const value = <T>(r: Result<T, DomainError>): T => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
};
const failure = <T>(r: Result<T, DomainError>): DomainError => {
  if (r.ok) throw new Error("expected a failure");
  return r.error;
};

function world() {
  let now = NOW;
  const clock = { now: () => now };
  const sessions = new InMemoryCheckoutSessionRepository({
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new CheckoutEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "checkout",
    }),
    context: rootEventContext({ generate: () => "evt" }),
    clock,
  });
  const links = new InMemoryCheckoutLinkRepository();
  let n = 0;
  const idGenerator = {
    generate: () => `01920000-0000-7000-8000-${(n += 1).toString().padStart(12, "0")}`,
  };
  const unitOfWork = new InMemoryUnitOfWork();
  const taxCalculation = { calculate: async () => ({ taxMinor: 700, included: false }) };
  const deps = {
    sessions,
    links,
    unitOfWork,
    idGenerator,
    clock,
    taxCalculation,
    abandoned: sessions,
  };
  return {
    sessions,
    links,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    start: new StartDraftCheckout(deps),
    pay: new SelectDraftPayment(deps),
    issue: new IssueInvoiceLink(deps),
    claim: new ClaimInvoiceCheckout(deps),
    revoke: new RevokeDraftLinks(deps),
    resolve: new ResolveCheckoutLink(deps),
  };
}

const input = (over: Partial<StartDraftCheckoutInput> = {}): StartDraftCheckoutInput => ({
  tenantId: T,
  draftOrderRef: DRAFT,
  draftNumber: "D3",
  currency: "EGP",
  items: [
    {
      productId: "11111111-1111-7111-8111-111111111111",
      variantId: "v-1",
      sku: "TEE",
      title: "Tee",
      variantTitle: null,
      quantity: 2,
      unitPriceAmountMinor: 25000,
      currency: "EGP",
    },
  ],
  contactEmail: "sara@example.com",
  shippingAddress: ADDRESS,
  billingAddress: ADDRESS,
  discount: { title: "Loyal customer", amountMinor: 5000 },
  shipping: { title: "Courier", amountMinor: 4000 },
  ...over,
});

describe("StartDraftCheckout (spec §4.5 step 2)", () => {
  it("builds an open session with the draft's lines, contact, addresses, terms, tax and totals", async () => {
    const w = world();
    const { checkoutSessionId } = value(await w.start.execute(input()));
    const session = await w.sessions.findById(checkoutSessionId, T);
    expect(session?.state.value).toBe("started");
    expect(session?.cartRef).toBe(`draft:${DRAFT}`);
    expect(session?.draftTerms?.draftNumber).toBe("D3");
    expect(session?.contactEmail?.value).toBe("sara@example.com");
    expect(session?.taxMinor).toBe(700);
    expect(session?.totals?.totalMinor).toBe(50000 - 5000 + 4000 + 700);
  });

  it("mints a 43-character server sessionRef that is never the same twice", async () => {
    const w = world();
    const a = await w.sessions.findById(value(await w.start.execute(input())).checkoutSessionId, T);
    const b = await w.sessions.findById(value(await w.start.execute(input())).checkoutSessionId, T);
    expect(a?.sessionRef).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a?.sessionRef).not.toBe(b?.sessionRef);
  });

  it("expires the session it replaces — only when it is this draft's and still open", async () => {
    const w = world();
    const first = value(await w.start.execute(input())).checkoutSessionId;
    const foreign = value(
      await w.start.execute(input({ draftOrderRef: "other-draft" })),
    ).checkoutSessionId;
    value(await w.start.execute(input({ replaces: first })));
    value(await w.start.execute(input({ replaces: foreign })));
    expect((await w.sessions.findById(first, T))?.state.value).toBe("expired");
    expect((await w.sessions.findById(foreign, T))?.state.value).toBe("started");
  });

  it("refuses a province that is not the country's (422 with the field)", async () => {
    const w = world();
    const refused = failure(
      await w.start.execute(input({ shippingAddress: { ...ADDRESS, province: "SA-01" } })),
    );
    expect(refused.code).toBe("VALIDATION");
  });
});

describe("SelectDraftPayment (Ruling 8)", () => {
  it("records cod or manual on a draft session only", async () => {
    const w = world();
    const { checkoutSessionId } = value(await w.start.execute(input()));
    value(await w.pay.execute({ tenantId: T, checkoutSessionId, provider: "manual" }));
    expect((await w.sessions.findById(checkoutSessionId, T))?.paymentSelection?.provider).toBe(
      "manual",
    );
  });
});

describe("invoice links (spec §4.7)", () => {
  it("issues a 30-day link that resolves to the draft, and the claim hands the session to the opener", async () => {
    const w = world();
    const { checkoutSessionId } = value(await w.start.execute(input()));
    const issued = value(
      await w.issue.execute({ tenantId: T, draftOrderRef: DRAFT, createdBy: "staff-op" }),
    );
    expect(new Date(issued.expiresAt).getTime() - NOW.getTime()).toBe(30 * 24 * 3_600_000);
    const resolved = value(await w.resolve.execute({ tenantId: T, token: issued.token }));
    expect(resolved.purpose).toBe("invoice");
    if (resolved.purpose !== "invoice") throw new Error("unreachable");
    expect(resolved.draftOrderRef).toBe(DRAFT);
    const claimed = value(
      await w.claim.execute({
        tenantId: T,
        linkId: resolved.link.id,
        checkoutSessionId,
        sessionRef: "guest-1",
      }),
    );
    expect(claimed).toEqual({ checkoutSessionId, claimCount: 1 });
    expect((await w.sessions.findById(checkoutSessionId, T))?.sessionRef).toBe("guest-1");
    // The last opener owns it (spec §4.7 decision).
    value(
      await w.claim.execute({
        tenantId: T,
        linkId: resolved.link.id,
        checkoutSessionId,
        sessionRef: "guest-2",
      }),
    );
    expect((await w.sessions.findById(checkoutSessionId, T))?.sessionRef).toBe("guest-2");
  });

  it("a revoked or expired link, or another shop, answers LINK_INVALID; a foreign session answers DRAFT_BUSY", async () => {
    const w = world();
    const { checkoutSessionId } = value(await w.start.execute(input()));
    const foreign = value(
      await w.start.execute(input({ draftOrderRef: "other-draft" })),
    ).checkoutSessionId;
    const issued = value(
      await w.issue.execute({ tenantId: T, draftOrderRef: DRAFT, createdBy: "staff-op" }),
    );
    const busy = failure(
      await w.claim.execute({
        tenantId: T,
        linkId: issued.linkId,
        checkoutSessionId: foreign,
        sessionRef: "g",
      }),
    );
    expect(busy.message).toMatch(/^DRAFT_BUSY:/);
    expect(
      failure(await w.resolve.execute({ tenantId: "tenant-b", token: issued.token })).message,
    ).toMatch(/^LINK_INVALID:/);
    expect(value(await w.revoke.execute({ tenantId: T, draftOrderRef: DRAFT }))).toEqual({
      revoked: 1,
    });
    expect(failure(await w.resolve.execute({ tenantId: T, token: issued.token })).message).toMatch(
      /^LINK_INVALID:/,
    );
    expect(
      failure(
        await w.claim.execute({
          tenantId: T,
          linkId: issued.linkId,
          checkoutSessionId,
          sessionRef: "g",
        }),
      ).message,
    ).toMatch(/^LINK_INVALID:/);
    const later = value(
      await w.issue.execute({ tenantId: T, draftOrderRef: DRAFT, createdBy: "staff-op" }),
    );
    w.advance(30 * 24 * 3_600_000);
    expect(failure(await w.resolve.execute({ tenantId: T, token: later.token })).message).toMatch(
      /^LINK_INVALID:/,
    );
  });
});
```

Update `services/checkout/src/application/abandoned-checkouts.use-cases.test.ts`'s "answers the link and the abandoned checkout" case to narrow first:

```ts
expect(resolved.purpose).toBe("recovery");
if (resolved.purpose !== "recovery") throw new Error("unreachable");
```

Run: `pnpm --filter @platform/checkout exec vitest run src/application/draft-checkout.use-cases.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the address helper, the use cases and the invoice branch of `ResolveCheckoutLink`**

`services/checkout/src/application/address-province.ts` — append:

```ts
/** The whole address rule Checkout applies (fields + province), for callers outside Checkout (drafts). */
export function checkoutAddressProblem(input: CheckoutAddressInput): ValidationError | null {
  const address = CheckoutAddress.create(input);
  if (!address.ok) return address.error;
  return provinceProblem(input.country, input.province);
}
```

(imports: `CheckoutAddress, type CheckoutAddressInput` from `../domain/value-objects/checkout-address`.)

`services/checkout/src/application/draft-checkout.use-cases.ts`:

```ts
import { randomBytes } from "node:crypto";
import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError, Money, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, type DomainError, NotFoundError } from "@platform/utils";
import { CheckoutLink, INVOICE_LINK_TTL_MS } from "../domain/checkout-link";
import type { CheckoutLinkRepository } from "../domain/checkout-link-repository";
import { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import {
  CheckoutAddress,
  type CheckoutAddressInput,
} from "../domain/value-objects/checkout-address";
import { ContactEmail } from "../domain/value-objects/contact-email";
import { draftCartRef } from "../domain/value-objects/draft-terms";
import { PaymentSelection } from "../domain/value-objects/selections";
import { LINK_INVALID } from "./abandoned-checkouts.use-cases";
import { provinceProblem } from "./address-province";
import { checkoutItemsFrom, type LoadItemsInput } from "./checkout-details.use-cases";
import { calculateAndStoreTax } from "./discount-code.use-cases";
import type {
  ShippingCalculationPort,
  ShippingQuote,
  TaxCalculationPort,
  TaxCalculationResult,
} from "./ports";

/** Spec §4.5: 32 random bytes, base64url — the owner of a draft session nobody holds yet. Never returned. */
export function newDraftSessionRef(): string {
  return randomBytes(32).toString("base64url");
}

function linkInvalid(): NotFoundError {
  return new NotFoundError(`${LINK_INVALID}: this link has expired or is no longer valid`);
}

function draftCheckoutGone(): BusinessRuleError {
  return new BusinessRuleError("DRAFT_BUSY: this invoice's checkout changed; open the link again");
}

export interface DraftCheckoutDeps {
  readonly sessions: CheckoutSessionRepository;
  readonly links: CheckoutLinkRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly taxCalculation: TaxCalculationPort;
}

function address(input: CheckoutAddressInput): Result<CheckoutAddress, DomainError> {
  const built = CheckoutAddress.create(input);
  if (!built.ok) return err(built.error);
  const problem = provinceProblem(input.country, input.province);
  return problem === null ? ok(built.value) : err(problem);
}

export interface StartDraftCheckoutInput {
  readonly tenantId: string;
  readonly draftOrderRef: string;
  readonly draftNumber: string;
  /** The draft's existing customer, or absent for a guest. */
  readonly customerRef?: string;
  readonly currency: string;
  /** The draft's lines at the prices stored at its last save (Ruling 12) — server-side values only. */
  readonly items: LoadItemsInput["items"];
  readonly contactEmail?: string;
  readonly shippingAddress: CheckoutAddressInput;
  readonly billingAddress: CheckoutAddressInput;
  readonly discount?: { readonly title: string; readonly amountMinor: number };
  readonly shipping: { readonly title: string; readonly amountMinor: number };
  /** The draft's previous session: expired here when it is still open AND this draft's. */
  readonly replaces?: string;
}

/**
 * Spec §4.5 step 2 in ONE unit of work: expire the draft's previous session (if open), then build the
 * new one — server-minted `sessionRef`, `cartRef` naming the draft (Ruling 1), the draft's lines,
 * contact and addresses, the merchant's terms, the tax from Finance and the totals.
 */
export class StartDraftCheckout implements UseCase<
  StartDraftCheckoutInput,
  { readonly checkoutSessionId: string },
  DomainError
> {
  private readonly deps: DraftCheckoutDeps;

  constructor(deps: DraftCheckoutDeps) {
    this.deps = deps;
  }

  async execute(
    input: StartDraftCheckoutInput,
  ): Promise<Result<{ readonly checkoutSessionId: string }, DomainError>> {
    const currency = Money.create(0, input.currency);
    if (!currency.ok) return err(currency.error);
    const items = checkoutItemsFrom(input.items);
    if (!items.ok) return err(items.error);
    const shipping = address(input.shippingAddress);
    if (!shipping.ok) return err(shipping.error);
    const billing = address(input.billingAddress);
    if (!billing.ok) return err(billing.error);
    const email =
      input.contactEmail === undefined ? undefined : ContactEmail.create(input.contactEmail);
    if (email !== undefined && !email.ok) return err(email.error);

    return this.deps.unitOfWork.run<Result<{ readonly checkoutSessionId: string }, DomainError>>(
      async (tx) => {
        const now = this.deps.clock.now();
        if (input.replaces !== undefined) {
          const old = await this.deps.sessions.findById(input.replaces, input.tenantId, tx);
          if (
            old !== null &&
            old.state.isOpen &&
            old.draftTerms?.draftOrderRef === input.draftOrderRef
          ) {
            old.expire(this.deps.idGenerator.generate(), now);
            await this.deps.sessions.save(old, input.tenantId, tx);
          }
        }
        const id = this.deps.idGenerator.generate();
        const session = CheckoutSession.start(
          UniqueEntityId.from(id),
          draftCartRef(input.draftOrderRef),
          input.customerRef,
          newDraftSessionRef(),
          input.currency,
        );
        try {
          session.loadItems(items.value);
          if (email !== undefined && email.ok) session.setContactEmail(email.value);
          session.setShippingAddress(shipping.value);
          session.setBillingAddress(billing.value);
          session.applyDraftTerms({
            draftOrderRef: input.draftOrderRef,
            draftNumber: input.draftNumber,
            ...(input.discount === undefined ? {} : { discount: input.discount }),
            shipping: input.shipping,
          });
          await calculateAndStoreTax(session, this.deps.taxCalculation, input.tenantId);
          session.recalculateTotals(this.deps.idGenerator.generate(), now);
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }
        await this.deps.sessions.save(session, input.tenantId, tx);
        return ok({ checkoutSessionId: id });
      },
    );
  }
}

export interface SelectDraftPaymentInput {
  readonly tenantId: string;
  readonly checkoutSessionId: string;
  /** Collect on delivery → `cod`; Mark as paid → `manual` (spec §4.6 step 1). */
  readonly provider: "cod" | "manual";
}

/**
 * Spec §4.6 step 1: the merchant's own choice, bypassing the shopper-facing "offered" list — refused on
 * any session that is not a draft order's (Ruling 8), so no shopper path can reach `manual`.
 */
export class SelectDraftPayment implements UseCase<
  SelectDraftPaymentInput,
  { readonly checkoutSessionId: string },
  DomainError
> {
  private readonly deps: DraftCheckoutDeps;

  constructor(deps: DraftCheckoutDeps) {
    this.deps = deps;
  }

  async execute(
    input: SelectDraftPaymentInput,
  ): Promise<Result<{ readonly checkoutSessionId: string }, DomainError>> {
    const selection = PaymentSelection.create(input.provider, input.provider);
    if (!selection.ok) return err(selection.error);
    return this.deps.unitOfWork.run<Result<{ readonly checkoutSessionId: string }, DomainError>>(
      async (tx) => {
        const session = await this.deps.sessions.findById(
          input.checkoutSessionId,
          input.tenantId,
          tx,
        );
        if (session === null) return err(new NotFoundError("Checkout session not found"));
        if (session.draftTerms === undefined) {
          return err(
            new BusinessRuleError("Only a draft order's checkout takes a merchant payment"),
          );
        }
        try {
          session.selectPayment(selection.value);
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }
        await this.deps.sessions.save(session, input.tenantId, tx);
        return ok({ checkoutSessionId: input.checkoutSessionId });
      },
    );
  }
}

export interface QuoteDraftShippingInput {
  readonly tenantId: string;
  readonly currency: string;
  readonly address: {
    readonly country: string;
    readonly province?: string;
    readonly postalCode: string;
  };
  readonly items: LoadItemsInput["items"];
}

/** Spec §4.3: the shop's rates for a draft's address — the SAME `ShippingCalculationPort` checkout uses. */
export class QuoteDraftShipping implements UseCase<
  QuoteDraftShippingInput,
  { readonly quotes: readonly ShippingQuote[] },
  DomainError
> {
  private readonly deps: { readonly shippingCalculation: ShippingCalculationPort };

  constructor(deps: { readonly shippingCalculation: ShippingCalculationPort }) {
    this.deps = deps;
  }

  async execute(
    input: QuoteDraftShippingInput,
  ): Promise<Result<{ readonly quotes: readonly ShippingQuote[] }, DomainError>> {
    const items = checkoutItemsFrom(input.items);
    if (!items.ok) return err(items.error);
    const quotes = await this.deps.shippingCalculation.quote(
      input.address,
      items.value,
      input.currency,
      input.tenantId,
    );
    return ok({ quotes });
  }
}

export interface EstimateDraftTaxInput {
  readonly tenantId: string;
  readonly currency: string;
  readonly items: LoadItemsInput["items"];
  readonly destination: { readonly country: string; readonly province?: string };
  readonly shippingMinor: number;
  readonly discountMinor: number;
}

/** Spec §4.3 "Estimated tax": Finance's answer for the draft's figures — read-only, nothing stored. */
export class EstimateDraftTax implements UseCase<
  EstimateDraftTaxInput,
  TaxCalculationResult,
  DomainError
> {
  private readonly deps: { readonly taxCalculation: TaxCalculationPort };

  constructor(deps: { readonly taxCalculation: TaxCalculationPort }) {
    this.deps = deps;
  }

  async execute(input: EstimateDraftTaxInput): Promise<Result<TaxCalculationResult, DomainError>> {
    const items = checkoutItemsFrom(input.items);
    if (!items.ok) return err(items.error);
    return ok(
      await this.deps.taxCalculation.calculate(
        items.value,
        input.destination,
        input.shippingMinor,
        input.currency,
        input.tenantId,
        { orderMinor: input.discountMinor, shippingMinor: 0 },
      ),
    );
  }
}

export interface IssueInvoiceLinkInput {
  readonly tenantId: string;
  readonly draftOrderRef: string;
  /** The staff principal id. */
  readonly createdBy: string;
}

export interface IssueInvoiceLinkOutput {
  readonly linkId: string;
  /** Handed out exactly once: only its hash is stored (Ruling 21). */
  readonly token: string;
  readonly expiresAt: string;
}

/** Spec §4.7: a new 30-day invoice link pointing at the DRAFT (not one session). */
export class IssueInvoiceLink implements UseCase<
  IssueInvoiceLinkInput,
  IssueInvoiceLinkOutput,
  DomainError
> {
  private readonly deps: DraftCheckoutDeps;

  constructor(deps: DraftCheckoutDeps) {
    this.deps = deps;
  }

  async execute(
    input: IssueInvoiceLinkInput,
  ): Promise<Result<IssueInvoiceLinkOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IssueInvoiceLinkOutput, DomainError>>(async (tx) => {
      let issued: ReturnType<typeof CheckoutLink.issue>;
      try {
        issued = CheckoutLink.issue({
          id: this.deps.idGenerator.generate(),
          purpose: "invoice",
          target: { draftOrderRef: input.draftOrderRef },
          createdBy: input.createdBy,
          now: this.deps.clock.now(),
          ttlMs: INVOICE_LINK_TTL_MS,
        });
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.links.save(issued.link, input.tenantId, tx);
      return ok({
        linkId: issued.link.id,
        token: issued.token,
        expiresAt: issued.link.expiresAt.toISOString(),
      });
    });
  }
}

export interface ClaimInvoiceCheckoutInput {
  readonly tenantId: string;
  readonly linkId: string;
  /** The draft's current session (the admin route materialised it from the latest draft). */
  readonly checkoutSessionId: string;
  /** The opener's OWN guest cookie value. */
  readonly sessionRef: string;
}

/**
 * Spec §4.7 claim, ONE unit of work: the guarded, atomic claim count first (a revoked or expired link
 * never changes hands), then `transferOwnership` to the opener. The session must still be open and be
 * the link's draft's; otherwise DRAFT_BUSY (it was replaced or completed meanwhile).
 */
export class ClaimInvoiceCheckout implements UseCase<
  ClaimInvoiceCheckoutInput,
  { readonly checkoutSessionId: string; readonly claimCount: number },
  DomainError
> {
  private readonly deps: DraftCheckoutDeps;

  constructor(deps: DraftCheckoutDeps) {
    this.deps = deps;
  }

  async execute(
    input: ClaimInvoiceCheckoutInput,
  ): Promise<
    Result<{ readonly checkoutSessionId: string; readonly claimCount: number }, DomainError>
  > {
    return this.deps.unitOfWork.run(async (tx) => {
      const now = this.deps.clock.now();
      const link = await this.deps.links.findById(input.linkId, input.tenantId, tx);
      if (link === null || !link.isUsable(now) || link.purpose !== "invoice")
        return err(linkInvalid());
      const session = await this.deps.sessions.findById(
        input.checkoutSessionId,
        input.tenantId,
        tx,
      );
      if (
        session === null ||
        !session.state.isOpen ||
        session.draftTerms?.draftOrderRef !== link.draftOrderRef
      ) {
        return err(draftCheckoutGone());
      }
      const claimCount = await this.deps.links.recordClaim(
        link.id,
        input.tenantId,
        now,
        input.checkoutSessionId,
        tx,
      );
      if (claimCount === null) return err(linkInvalid());
      try {
        session.transferOwnership(input.sessionRef);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.sessions.save(session, input.tenantId, tx);
      return ok({ checkoutSessionId: input.checkoutSessionId, claimCount });
    });
  }
}

export interface DraftLinksInput {
  readonly tenantId: string;
  readonly draftOrderRef: string;
}

/** Spec §4.6 step 5 / Ruling 17: the draft's invoice links stop working (completed or deleted). */
export class RevokeDraftLinks implements UseCase<
  DraftLinksInput,
  { readonly revoked: number },
  DomainError
> {
  private readonly deps: DraftCheckoutDeps;

  constructor(deps: DraftCheckoutDeps) {
    this.deps = deps;
  }

  async execute(
    input: DraftLinksInput,
  ): Promise<Result<{ readonly revoked: number }, DomainError>> {
    return this.deps.unitOfWork.run(async (tx) =>
      ok({
        revoked: await this.deps.links.revokeForDraft(
          input.draftOrderRef,
          input.tenantId,
          this.deps.clock.now(),
          tx,
        ),
      }),
    );
  }
}

/** The draft page's links (issued, expires, claim count). */
export class ListDraftLinks implements UseCase<
  DraftLinksInput,
  readonly CheckoutLink[],
  DomainError
> {
  private readonly deps: Pick<DraftCheckoutDeps, "links">;

  constructor(deps: Pick<DraftCheckoutDeps, "links">) {
    this.deps = deps;
  }

  async execute(input: DraftLinksInput): Promise<Result<readonly CheckoutLink[], DomainError>> {
    return ok(await this.deps.links.listForDraft(input.draftOrderRef, input.tenantId));
  }
}
```

(Prettier-format; `unitOfWork.run` callbacks typed with the explicit `Result<…>` generic like the other files.)

`services/checkout/src/application/abandoned-checkouts.use-cases.ts`:

```ts
export type ResolveCheckoutLinkOutput =
  | {
      readonly purpose: "recovery";
      readonly link: CheckoutLink;
      /** The abandoned checkout the link resumes. Never handed to the shopper: the claim clones it. */
      readonly session: CheckoutSession;
    }
  | {
      readonly purpose: "invoice";
      readonly link: CheckoutLink;
      /** The draft the invoice is for; the admin route checks it is still open (Part 4). */
      readonly draftOrderRef: string;
    };
```

and in `ResolveCheckoutLink.execute`, after the hash lookup:

```ts
const now = this.deps.clock.now();
if (
  link !== null &&
  link.isUsable(now) &&
  link.purpose === "invoice" &&
  link.draftOrderRef !== null
) {
  return ok({ purpose: "invoice", link, draftOrderRef: link.draftOrderRef });
}
const session = await resumableCheckoutOf(this.deps, link, input.tenantId, now);
return link === null || session === null
  ? err(linkInvalid())
  : ok({ purpose: "recovery", link, session });
```

(update the class comment: "Part 4 adds the invoice branch: a usable invoice link answers its draft".)

In `apps/admin/src/http/public-checkout-link-routes.ts`, until Task 7 adds the invoice branch, treat an invoice resolution as invalid in both routes — `resolve` answers `null` unless `purpose === "recovery"`:

```ts
async function resolveRecovery(admin: WiredAdmin, tenantId: string, value: string) {
  const resolved = await resolve(admin, tenantId, value);
  return resolved !== null && resolved.purpose === "recovery" ? resolved : null;
}
```

and the two handlers call `resolveRecovery` (Task 7 replaces this with the purpose switch).

Run Step 3's test → PASS.

- [ ] **Step 5: `CompleteCheckout` reports a draft's completion (test first)**

`services/checkout/src/application/complete-checkout.drafts.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { CheckoutEventTranslator } from "../infrastructure/checkout-event-translator";
import { InMemoryCheckoutLinkRepository } from "../infrastructure/in-memory-checkout-link-repository";
import { InMemoryCheckoutSessionRepository } from "../infrastructure/in-memory-checkout-session-repository";
import { InMemoryOrderCreationAdapter } from "../infrastructure/in-memory-order-creation-adapter";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { CompleteCheckout } from "./complete-checkout.use-case";
import { IssueInvoiceLink, StartDraftCheckout } from "./draft-checkout.use-cases";

const T = "tenant-a";
const DRAFT = "33333333-3333-7333-8333-333333333333";
const ADDRESS = {
  line1: "5 Nile St",
  city: "Cairo",
  postalCode: "",
  country: "EG",
  province: "EG-C",
};

async function setup(draftCompletion: { complete: ReturnType<typeof vi.fn> }) {
  const clock = { now: () => new Date("2026-10-25T10:00:00.000Z") };
  const sessions = new InMemoryCheckoutSessionRepository({
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new CheckoutEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "checkout",
    }),
    context: rootEventContext({ generate: () => "evt" }),
    clock,
  });
  const links = new InMemoryCheckoutLinkRepository();
  let n = 0;
  const idGenerator = {
    generate: () => `01920000-0000-7000-8000-${(n += 1).toString().padStart(12, "0")}`,
  };
  const unitOfWork = new InMemoryUnitOfWork();
  const deps = {
    sessions,
    links,
    unitOfWork,
    idGenerator,
    clock,
    taxCalculation: { calculate: async () => ({ taxMinor: 0, included: false }) },
  };
  const { checkoutSessionId } = (await new StartDraftCheckout(deps).execute({
    tenantId: T,
    draftOrderRef: DRAFT,
    draftNumber: "D1",
    currency: "EGP",
    items: [
      {
        productId: "11111111-1111-7111-8111-111111111111",
        quantity: 1,
        unitPriceAmountMinor: 1000,
        currency: "EGP",
      },
    ],
    contactEmail: "sara@example.com",
    shippingAddress: ADDRESS,
    billingAddress: ADDRESS,
    shipping: { title: "Courier", amountMinor: 0 },
  })) as { ok: true; value: { checkoutSessionId: string } };
  await new IssueInvoiceLink(deps).execute({ tenantId: T, draftOrderRef: DRAFT, createdBy: "s" });
  const complete = new CompleteCheckout({
    sessions,
    unitOfWork,
    idGenerator,
    clock,
    orderCreation: new InMemoryOrderCreationAdapter(),
    draftCompletion,
  });
  return { complete, links, checkoutSessionId };
}

describe("CompleteCheckout for a draft order's checkout (spec §4.6 decision, Ruling 11)", () => {
  it("reports the order with the actor; the invoice links stay usable (they now answer 'already placed')", async () => {
    const port = { complete: vi.fn(async () => undefined) };
    const { complete, links, checkoutSessionId } = await setup(port);
    const result = await complete.execute({
      tenantId: T,
      checkoutSessionId,
      idempotencyKey: "k",
      actorRef: "staff-1",
    });
    expect(result.ok).toBe(true);
    const orderRef = result.ok ? result.value.orderRef : "";
    expect(port.complete).toHaveBeenCalledWith({
      tenantId: T,
      draftOrderRef: DRAFT,
      orderRef,
      actorRef: "staff-1",
    });
    expect((await links.listForDraft(DRAFT, T)).every((l) => l.revokedAt === null)).toBe(true);
  });

  it("a failing report never undoes the order; a retry reports again", async () => {
    const port = {
      complete: vi
        .fn()
        .mockRejectedValueOnce(new Error("orders down"))
        .mockResolvedValue(undefined),
    };
    const { complete, checkoutSessionId } = await setup(port);
    const first = await complete.execute({ tenantId: T, checkoutSessionId, idempotencyKey: "k" });
    expect(first.ok).toBe(true);
    const again = await complete.execute({ tenantId: T, checkoutSessionId, idempotencyKey: "k" });
    expect(again.ok && first.ok && again.value.orderRef === first.value.orderRef).toBe(true);
    expect(port.complete).toHaveBeenCalledTimes(2);
  });
});
```

`services/checkout/src/application/ports.ts` — append:

```ts
/**
 * Order operations Part 4 (spec §4.6 decision): tells Orders a draft order's checkout became an order.
 * Best effort and idempotent (the draft is also healed on read); `actorRef` is the staff member when
 * the merchant completed it, absent when the shopper paid through the invoice link.
 */
export interface DraftOrderCompletionPort {
  complete(input: {
    readonly tenantId: string;
    readonly draftOrderRef: string;
    readonly orderRef: string;
    readonly actorRef?: string;
  }): Promise<void>;
}
```

`services/checkout/src/application/complete-checkout.use-case.ts`:

- `CompleteCheckoutInput` gains `/** Part 4: the staff member completing a draft (admin route only; never a public body). */ readonly actorRef?: string;`
- `CompleteCheckoutDeps` gains `readonly draftCompletion?: DraftOrderCompletionPort;`
- the `recovery` holder becomes `const after: { from?: string; draftOrderRef?: string } = {};`, set next to `recovery.from` with `after.draftOrderRef = session.draftTerms?.draftOrderRef;` (rename `recovery.from` uses to `after.from`).
- after the existing recovery mark:

```ts
if (result.ok && after.draftOrderRef !== undefined) {
  await this.reportDraftCompletion(after.draftOrderRef, result.value.orderRef, input);
}
```

- the method:

```ts
  /**
   * Part 4 (Ruling 11): a draft order's checkout became `orderRef` — tell Orders, after the commit, best
   * effort (the draft also heals on read). The invoice links are NOT revoked: a completed draft's link
   * must still answer "this order has already been placed". A retried completion returns early above
   * and lands here again, so a missed report is healed.
   */
  private async reportDraftCompletion(
    draftOrderRef: string,
    orderRef: string,
    input: CompleteCheckoutInput,
  ): Promise<void> {
    if (this.deps.draftCompletion === undefined) return;
    try {
      await this.deps.draftCompletion.complete({
        tenantId: input.tenantId,
        draftOrderRef,
        orderRef,
        ...(input.actorRef === undefined ? {} : { actorRef: input.actorRef }),
      });
    } catch (error) {
      logger.warn("could not report a draft order's completion; the draft heals on read", {
        tenantId: input.tenantId,
        draftOrderRef,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
```

(imports: `logger` from `@platform/utils`, `type DraftOrderCompletionPort`.)

Run: `pnpm --filter @platform/checkout exec vitest run src/application/complete-checkout.drafts.test.ts` → PASS; the existing completion suites still PASS.

- [ ] **Step 6: Controller, composition, exports**

`CheckoutControllerDeps` gains `startDraftCheckout: StartDraftCheckout; selectDraftPayment: SelectDraftPayment; quoteDraftShipping: QuoteDraftShipping; estimateDraftTax: EstimateDraftTax; issueInvoiceLink: IssueInvoiceLink; claimInvoiceCheckout: ClaimInvoiceCheckout; revokeDraftLinks: RevokeDraftLinks; listDraftLinks: ListDraftLinks;` and the class gains:

```ts
  /** Order operations Part 4 — draft order checkouts (authorization is the caller's). */
  async startDraft(input: StartDraftCheckoutInput): Promise<ControllerResponse> {
    return present(await this.deps.startDraftCheckout.execute(input), 201);
  }

  async selectDraftPayment(input: SelectDraftPaymentInput): Promise<ControllerResponse> {
    return present(await this.deps.selectDraftPayment.execute(input), 200);
  }

  async quoteDraftShipping(input: QuoteDraftShippingInput): Promise<ControllerResponse> {
    return present(await this.deps.quoteDraftShipping.execute(input), 200);
  }

  async estimateDraftTax(input: EstimateDraftTaxInput): Promise<ControllerResponse> {
    return present(await this.deps.estimateDraftTax.execute(input), 200);
  }

  async issueInvoiceLink(input: IssueInvoiceLinkInput): Promise<ControllerResponse> {
    return present(await this.deps.issueInvoiceLink.execute(input), 201);
  }

  async claimInvoice(input: ClaimInvoiceCheckoutInput): Promise<ControllerResponse> {
    return present(await this.deps.claimInvoiceCheckout.execute(input), 200);
  }

  async revokeDraftLinks(input: DraftLinksInput): Promise<ControllerResponse> {
    return present(await this.deps.revokeDraftLinks.execute(input), 200);
  }

  async listDraftLinks(input: DraftLinksInput): Promise<ControllerResponse> {
    return present(await this.deps.listDraftLinks.execute(input), 200);
  }
```

`services/checkout/src/composition.ts`: `CheckoutWiringDeps` gains

```ts
  /** Part 4: tells Orders a draft order's checkout became an order. Absent ⇒ nothing is reported. */
  readonly draftCompletion?: DraftOrderCompletionPort;
```

`buildController` builds `const draftDeps = { sessions, links, unitOfWork, idGenerator: deps.idGenerator, clock: deps.clock, taxCalculation };`, wires the eight use cases (`new QuoteDraftShipping({ shippingCalculation })`, `new EstimateDraftTax({ taxCalculation })`, `new ListDraftLinks({ links })`, the rest with `draftDeps`) and passes `...(deps.draftCompletion === undefined ? {} : { draftCompletion: deps.draftCompletion })` to `CompleteCheckout`.

`services/checkout/src/index.ts` — export `INVOICE_LINK_TTL_MS`; `type DraftOrderCompletionPort`; `checkoutAddressProblem`; and the IO types `StartDraftCheckoutInput`, `SelectDraftPaymentInput`, `QuoteDraftShippingInput`, `EstimateDraftTaxInput`, `IssueInvoiceLinkOutput`, `ClaimInvoiceCheckoutInput`, `DraftLinksInput`.

- [ ] **Step 7: Public routes refuse what the merchant fixed (test first)**

`apps/admin/src/http/public-checkout-drafts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { IssueInvoiceLinkOutput, ResolveCheckoutLinkOutput } from "@platform/checkout";
import type { PublicCheckoutSessionDto } from "./public-checkout-routes";
import { recoveryWorld, seedRecoveryProduct, unwrap } from "./testing/abandoned-harness";
import { HARNESS_TENANT } from "./testing/orders-harness";

const DRAFT = "33333333-3333-7333-8333-333333333333";
const ADDRESS = {
  name: "Mona Ali",
  phone: "01001234567",
  line1: "5 Nile St",
  city: "Cairo",
  postalCode: "",
  country: "EG",
  province: "EG-C",
};

/** A draft session owned by `guest-1` — built and claimed through the raw Checkout controller. */
async function draftSession() {
  const world = recoveryWorld();
  const tee = await seedRecoveryProduct(world, "TEE", 25000);
  const checkout = world.admin.publicReads.checkout;
  const tenantId = HARNESS_TENANT;
  const started = await checkout.startDraft({
    tenantId,
    draftOrderRef: DRAFT,
    draftNumber: "D3",
    currency: "EGP",
    items: [
      {
        productId: tee.productId,
        variantId: tee.variantId,
        sku: "TEE",
        title: "Tee",
        variantTitle: null,
        quantity: 1,
        unitPriceAmountMinor: 25000,
        currency: "EGP",
      },
    ],
    contactEmail: "sara@example.com",
    shippingAddress: ADDRESS,
    billingAddress: ADDRESS,
    discount: { title: "Loyal", amountMinor: 1000 },
    shipping: { title: "Courier", amountMinor: 3000 },
  });
  const { checkoutSessionId } = started.body as { checkoutSessionId: string };
  const issued = (
    await checkout.issueInvoiceLink({ tenantId, draftOrderRef: DRAFT, createdBy: "staff" })
  ).body as IssueInvoiceLinkOutput;
  const resolved = (await checkout.resolveLink({ tenantId, token: issued.token }))
    .body as ResolveCheckoutLinkOutput;
  await checkout.claimInvoice({
    tenantId,
    linkId: resolved.link.id,
    checkoutSessionId,
    sessionRef: "guest-1",
  });
  return { world, checkoutSessionId };
}

describe("public checkout routes on a draft order's checkout (spec §4.4)", () => {
  it("answers 409 DRAFT_LOCKED on items, shipping quote, shipping selection and both code routes", async () => {
    const { world, checkoutSessionId } = await draftSession();
    const params = { checkoutSessionId };
    const calls = [
      world.publicCall("POST", "/public/checkouts/:checkoutSessionId/items", {
        params,
        body: { sessionRef: "guest-1", cartId: "any" },
      }),
      world.publicCall("POST", "/public/checkouts/:checkoutSessionId/shipping-quote", {
        params,
        body: { sessionRef: "guest-1" },
      }),
      world.publicCall("POST", "/public/checkouts/:checkoutSessionId/shipping-selection", {
        params,
        body: { sessionRef: "guest-1", method: "standard" },
      }),
      world.publicCall("POST", "/public/checkouts/:checkoutSessionId/discount-codes", {
        params,
        body: { sessionRef: "guest-1", code: "SAVE10" },
      }),
      world.publicCall("DELETE", "/public/checkouts/:checkoutSessionId/discount-codes/:code", {
        params: { ...params, code: "SAVE10" },
        body: { sessionRef: "guest-1" },
      }),
    ];
    for (const reply of await Promise.all(calls)) {
      expect(reply.status).toBe(409);
      expect((reply.body as { code: string }).code).toBe("DRAFT_LOCKED");
    }
  });

  it("someone else's sessionRef still gets the uniform 404 (ownership is checked first)", async () => {
    const { world, checkoutSessionId } = await draftSession();
    const reply = await world.publicCall(
      "POST",
      "/public/checkouts/:checkoutSessionId/shipping-quote",
      { params: { checkoutSessionId }, body: { sessionRef: "stranger" } },
    );
    expect(reply.status).toBe(404);
  });

  it("the session DTO says it is invoice #D3, shows the fixed shipping and the draft discount, never a sessionRef", async () => {
    const { world, checkoutSessionId } = await draftSession();
    const dto = unwrap<PublicCheckoutSessionDto>(
      await world.publicCall("GET", "/public/checkouts/:checkoutSessionId", {
        params: { checkoutSessionId },
        sessionRef: "guest-1",
      }),
      "get",
    );
    expect(dto.draftInvoice).toEqual({ draftNumber: "D3" });
    expect(dto.selectedShippingMethod).toBe("draft");
    expect(dto.totals?.shippingName).toBe("Courier");
    expect(dto.discount.applied).toEqual([
      { title: "Loyal", code: null, discountClass: "order", amountMinor: 1000 },
    ]);
    expect(JSON.stringify(dto)).not.toContain("guest-1");
  });

  it("contact, addresses, tax, payment selection and completion stay open to the shopper", async () => {
    const { world, checkoutSessionId } = await draftSession();
    const params = { checkoutSessionId };
    expect(
      (
        await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/contact", {
          params,
          body: { sessionRef: "guest-1", email: "other@example.com" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/shipping-address", {
          params,
          body: { sessionRef: "guest-1", ...ADDRESS, line1: "9 Nile St" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/recalculate", {
          params,
          body: { sessionRef: "guest-1" },
        })
      ).status,
    ).toBe(200);
  });
});
```

(Check the exact body schema of each public route in `public-checkout-routes.ts` before running; the five locked routes are refused before their bodies are used, so any schema-valid body works. Run Prettier.)

In `apps/admin/src/http/public-checkout-routes.ts`:

```ts
/** Part 4 (spec §4.4): what the merchant fixed on a draft order's checkout cannot be changed here. */
export function draftLockedResponse(): AdminResponse {
  return {
    status: 409,
    body: {
      ...toErrorEnvelope(
        new BusinessRuleError(`${DRAFT_LOCKED}: the merchant fixed this on the draft order`),
      ),
      code: DRAFT_LOCKED,
    },
  };
}
```

Then, in the handlers of `POST …/items`, `POST …/shipping-quote`, `POST …/shipping-selection`, `POST …/discount-codes` and `DELETE …/discount-codes/:code`, directly after `if (!(owned instanceof CheckoutSession)) return owned;` add `if (owned.draftTerms !== undefined) return draftLockedResponse();` — ownership first, so a stranger still gets the uniform 404 (global constraint 4).

`PublicCheckoutSessionDto` gains:

```ts
  /** Part 4: set when this checkout pays a merchant's draft order ("Invoice #D3"); its discount and shipping are fixed. */
  readonly draftInvoice: { readonly draftNumber: string } | null;
```

and `toPublicCheckoutSessionDto` sets `draftInvoice: session.draftTerms === undefined ? null : { draftNumber: session.draftTerms.draftNumber },`. (Import `DRAFT_LOCKED` from `@platform/checkout`; `BusinessRuleError` from `@platform/utils` if not already imported.)

- [ ] **Step 8: Run the gates**

Run: `pnpm --filter @platform/checkout test`, `typecheck`, `lint` → green.
Run: `pnpm --filter @platform/admin exec vitest run src/http/public-checkout-drafts.test.ts src/http/public-checkout-link-routes.test.ts src/http/public-checkout-routes.test.ts` → PASS; `pnpm --filter @platform/admin typecheck` → green.
Run: `node scripts/dev/check-prisma-tenant-where.mjs` → only the known finding.

- [ ] **Step 9: Commit**

```bash
git add services/checkout/src/domain/checkout-link.ts \
  services/checkout/src/domain/checkout-link-repository.ts \
  services/checkout/src/infrastructure/prisma-checkout-link-repository.ts \
  services/checkout/src/infrastructure/in-memory-checkout-link-repository.ts \
  services/checkout/src/infrastructure/checkout-link-repository.drafts.test.ts \
  services/checkout/src/application/address-province.ts \
  services/checkout/src/application/draft-checkout.use-cases.ts \
  services/checkout/src/application/draft-checkout.use-cases.test.ts \
  services/checkout/src/application/abandoned-checkouts.use-cases.ts \
  services/checkout/src/application/abandoned-checkouts.use-cases.test.ts \
  services/checkout/src/application/ports.ts \
  services/checkout/src/application/complete-checkout.use-case.ts \
  services/checkout/src/application/complete-checkout.drafts.test.ts \
  services/checkout/src/interfaces/checkout.controller.ts services/checkout/src/composition.ts \
  services/checkout/src/index.ts \
  apps/admin/src/http/public-checkout-routes.ts apps/admin/src/http/public-checkout-link-routes.ts \
  apps/admin/src/http/public-checkout-drafts.test.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(checkout): draft checkouts, invoice links and completion reporting

Starts a draft order's checkout with a server-minted owner, the merchant's terms and tax;
issues 30-day invoice links; the claim counts atomically and hands the session to the
opener. Revocation is one guarded update of revokedAt only. Completion reports to Orders,
best effort. Public routes answer DRAFT_LOCKED for what the merchant fixed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Payments — the `manual` provider and the cash-to-collect rule

Model tier: **senior** (money: a mistake here either blocks "Mark as paid" or makes a courier collect cash twice).

**Files:**

- Modify: `services/payments/src/domain/value-objects/provider-capabilities.ts` (`recordedByStaff`, `isCollectedOnDelivery`)
- Create: `services/payments/src/infrastructure/manual-payment-provider.ts`, `manual-payment-provider.test.ts`
- Modify: `services/payments/src/infrastructure/built-in-provider-registrations.ts` (`manualPaymentRegistration`)
- Modify: `services/payments/src/infrastructure/tenant-payment-provider-resolver.ts`
- Modify: `services/payments/src/application/merchant-payment-settings.use-cases.ts`
- Modify: `services/payments/src/application/get-payment-intents-by-ids.use-case.ts` and its test
- Create: `services/payments/src/manual-payment.test.ts`
- Modify: `services/payments/src/index.ts`
- Modify: `apps/admin/src/http/cod-collection.ts`, `cod-collection.test.ts`; fixtures in `order-bulk-actions.test.ts`, `order-export-rows.test.ts`
- Modify: `apps/admin-web/src/messages/en.ts`, `ar.ts` (`orderPage.paymentMethodName.manual`)
- Modify (only if they enumerate the built-in keys): `services/payments/src/application/provider-registry.test.ts`, `merchant-credentials-never-leak.test.ts`, `off-session-port.test.ts`, `merchant-payments.e2e.test.ts`, `apps/admin/src/http/merchant-payments.e2e.test.ts`

**Interfaces:**

- Consumes: `ConfirmCodCollection` (unchanged — `manual` qualifies by capability), `PaymentProviderRegistry`.
- Produces:
  - `ProviderCapabilities.recordedByStaff?: boolean`; `isCollectedOnDelivery(capabilities): boolean` (= `isSettledByOperatorConfirmation && recordedByStaff !== true`).
  - `manualPaymentRegistration(): ProviderRegistration` (key `"manual"`, capabilities `{ settlesAtPayTime: true, deliversWebhooks: false, requiresMerchantCredentials: false, chargesOffSession: false, recordedByStaff: true }`, backing `real`), included by `composePaymentProviderRegistrations`.
  - `PaymentIntentSummary.collectedOnDelivery: boolean`.
  - `codCollectionState` keys on `intent.collectedOnDelivery`.
  - admin-web `t.orderPage.paymentMethodName.manual` ("Manual payment" / "دفع يدوي").

- [ ] **Step 1: Write the failing payments test**

`services/payments/src/manual-payment.test.ts` — through `wirePayments` (in-memory branch; copy the deps setup — serializer, id generator, clock — from `services/payments/src/merchant-payments.e2e.test.ts`):

```ts
describe("the manual payment provider (order operations Part 4, Ruling 8)", () => {
  it("is registered but never offered: not in the settings read, not default-enabled", async () => {
    const { payments } = wired();
    const settings = (await payments.getMerchantPaymentSettings({ tenantId: "t" }))
      .body as MerchantPaymentSettingsDto;
    expect(Object.keys(settings.methods)).not.toContain("manual");
    expect(settings.enabledMethods).not.toContain("manual");
  });

  it("cannot be enabled by a merchant", async () => {
    const { payments } = wired();
    const refused = await payments.updateMerchantPaymentSettings({
      tenantId: "t",
      enabledMethods: ["manual"],
    });
    expect(refused.status).toBe(422);
  });

  it("opens an intent without being enabled, and only a confirmed collection settles it", async () => {
    const { payments } = wired();
    const opened = await payments.createIntentLifecycle({
      tenantId: "t",
      orderRef: "o-1",
      provider: "manual",
      amountMinor: 49000,
      currency: "EGP",
    });
    expect(opened.status).toBe(201);
    const { paymentIntentId } = opened.body as { paymentIntentId: string };
    const collected = await payments.confirmCodCollection({
      tenantId: "t",
      paymentIntentId,
      collectedAmountMinor: 49000,
      currency: "EGP",
    });
    expect(collected.status).toBe(200);
    expect((collected.body as { status: string }).status).toBe("captured");
  });

  it("a cod intent still needs cod enabled (Ruling 7 — the resolver's rule is unchanged for cod)", async () => {
    const { payments } = wired();
    const refused = await payments.createIntentLifecycle({
      tenantId: "t",
      orderRef: "o-2",
      provider: "cod",
      amountMinor: 100,
      currency: "EGP",
    });
    expect(refused.status).toBe(422);
  });

  it("the batched summary says a manual intent is settled by confirmation but is NOT collected on delivery", async () => {
    const { payments } = wired();
    const manual = (
      await payments.createIntentLifecycle({
        tenantId: "t",
        orderRef: "o-3",
        provider: "manual",
        amountMinor: 100,
        currency: "EGP",
      })
    ).body as { paymentIntentId: string };
    await payments.updateMerchantPaymentSettings({ tenantId: "t", enabledMethods: ["cod"] });
    const cod = (
      await payments.createIntentLifecycle({
        tenantId: "t",
        orderRef: "o-4",
        provider: "cod",
        amountMinor: 100,
        currency: "EGP",
      })
    ).body as { paymentIntentId: string };
    const summaries = (
      await payments.getPaymentIntentsByIds({
        tenantId: "t",
        paymentIntentIds: [manual.paymentIntentId, cod.paymentIntentId],
      })
    ).body as PaymentIntentSummary[];
    const byProvider = Object.fromEntries(summaries.map((s) => [s.provider, s]));
    expect(byProvider["manual"]).toMatchObject({
      settledByOperatorConfirmation: true,
      collectedOnDelivery: false,
    });
    expect(byProvider["cod"]).toMatchObject({
      settledByOperatorConfirmation: true,
      collectedOnDelivery: true,
    });
  });
});
```

(`wired()` returns `wirePayments({...})`; imports `MerchantPaymentSettingsDto`, `PaymentIntentSummary` from `./index`. If the controller method names differ — check `services/payments/src/interfaces/payment.controller.ts` — use the real ones; the four used here exist today: `getMerchantPaymentSettings`, `updateMerchantPaymentSettings`, `createIntentLifecycle`, `confirmCodCollection`, `getPaymentIntentsByIds`. An unknown method in `enabledMethods` answers 422 today via `ValidationError("Unknown payment method")`.)

`services/payments/src/infrastructure/manual-payment-provider.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ManualPaymentProvider } from "./manual-payment-provider";

describe("ManualPaymentProvider", () => {
  const provider = new ManualPaymentProvider();
  it("opens an unpaid intent with no client handle", async () => {
    expect(await provider.createIntent({ idempotencyKey: "k-1" } as never)).toEqual({
      providerIntentId: "manual:k-1",
    });
  });
  it("refuses capture and refund; cancel is a no-op; no webhook is ever authentic", async () => {
    await expect(provider.capture("x", "k")).rejects.toThrow(/confirm/);
    await expect(provider.refund("x", 1, "k")).rejects.toThrow(/outside the platform/);
    await expect(provider.cancel("x", "k")).resolves.toBeUndefined();
    expect(await provider.verifyWebhook(new Uint8Array(), "sig")).toBe(false);
  });
});
```

Run: `pnpm --filter @platform/payments exec vitest run src/manual-payment.test.ts src/infrastructure/manual-payment-provider.test.ts`
Expected: FAIL — module not found / `manual` unknown.

- [ ] **Step 2: Capability, provider and registration**

`services/payments/src/domain/value-objects/provider-capabilities.ts` — add to the interface (and a bullet to its doc comment):

```ts
  /**
   * Order operations Part 4: staff RECORD a payment received outside the platform (bank transfer,
   * InstaPay, a wallet) — the draft order's "Mark as paid". Never offered to shoppers, never enabled in
   * settings, accepted for a new payment without enablement (only a staff action selects it). Optional:
   * absent means false, so existing registrations are unchanged.
   */
  readonly recordedByStaff?: boolean;
```

and append:

```ts
/**
 * Cash the courier collects on delivery: settled by an operator's confirmation, and NOT a payment staff
 * recorded as already received. The ONE rule the courier's "Collect" amount and the bulk "Mark cash as
 * received" use (Ruling 9) — a `manual` payment is never cash to collect.
 */
export function isCollectedOnDelivery(capabilities: ProviderCapabilities): boolean {
  return isSettledByOperatorConfirmation(capabilities) && capabilities.recordedByStaff !== true;
}
```

`services/payments/src/infrastructure/manual-payment-provider.ts`:

```ts
import type { PaymentIntentRequest, PaymentProvider, ProviderIntent } from "@platform/contracts";

/** Raised for a `PaymentProvider` operation a staff-recorded payment has no faithful equivalent for. */
export class ManualPaymentUnsupportedOperationError extends Error {
  readonly operation: string;

  constructor(operation: string, reason: string) {
    super(`Manual payment does not support "${operation}": ${reason}`);
    this.name = "ManualPaymentUnsupportedOperationError";
    this.operation = operation;
  }
}

/**
 * Order operations Part 4 — "Mark as paid" on a draft order: money the merchant already received outside
 * the platform (bank transfer, InstaPay, wallet). Like cash on delivery there is no PSP: the intent opens
 * unpaid, `capture` refuses (only `ConfirmCodCollection`, an admin's explicit confirmation, settles it),
 * `refund` refuses (it is returned outside the platform; `RefundPaymentLifecycle` records it by
 * capability), `cancel` is a true no-op and no webhook is authentic. Stateless; one instance is shared.
 */
export class ManualPaymentProvider implements PaymentProvider {
  createIntent(request: PaymentIntentRequest): Promise<ProviderIntent> {
    return Promise.resolve({ providerIntentId: `manual:${request.idempotencyKey}` });
  }

  capture(_providerIntentId: string, _idempotencyKey: string): Promise<void> {
    return Promise.reject(
      new ManualPaymentUnsupportedOperationError("capture", "confirm the received payment instead"),
    );
  }

  cancel(_providerIntentId: string, _idempotencyKey: string): Promise<void> {
    return Promise.resolve();
  }

  refund(_providerIntentId: string, _amountMinor: number, _idempotencyKey: string): Promise<void> {
    return Promise.reject(
      new ManualPaymentUnsupportedOperationError(
        "refund",
        "a manual payment is returned outside the platform",
      ),
    );
  }

  verifyWebhook(_payload: Uint8Array, _signature: string): Promise<boolean> {
    return Promise.resolve(false);
  }
}
```

`services/payments/src/infrastructure/built-in-provider-registrations.ts` — add (and include it in `composePaymentProviderRegistrations` after `cashOnDeliveryRegistration()`; update the file's "two providers" comment to "three"):

```ts
/**
 * Order operations Part 4 — `manual` ("Manual payment"): a draft order the merchant marks as paid. COD's
 * capabilities (settled by an operator's confirmation, no webhooks) plus `recordedByStaff` — never
 * offered, never enabled, and never cash a courier collects (Rulings 8 and 9).
 */
export function manualPaymentRegistration(): ProviderRegistration {
  const provider = new ManualPaymentProvider();
  return {
    key: "manual",
    capabilities: {
      settlesAtPayTime: true,
      deliversWebhooks: false,
      requiresMerchantCredentials: false,
      chargesOffSession: false,
      recordedByStaff: true,
    },
    backing: "real",
    create: () => provider,
  };
}
```

- [ ] **Step 3: Never offered, never enabled, accepted for a staff payment**

`services/payments/src/infrastructure/tenant-payment-provider-resolver.ts`, `resolveForNewPayment`:

```ts
    const registration = this.registered(provider);
    // Ruling 8: a staff-recorded payment is never enabled in settings (it cannot be), and only a staff
    // action on a draft order's checkout ever selects it.
    if (registration.capabilities.recordedByStaff === true) {
      return registration.create(await this.contextFor(tenantId, registration, await this.settingsOf(tenantId)));
    }
    const settings = await this.settingsOf(tenantId);
    …unchanged…
```

`services/payments/src/application/merchant-payment-settings.use-cases.ts`:

- `toDto`: skip a registration whose `capabilities.recordedByStaff === true` (`if (registration.capabilities.recordedByStaff === true) continue;`).
- `UpdateMerchantPaymentSettings.execute`: the `requested` check refuses it as unknown —

```ts
if (
  !requested.every((key) => {
    if (!isWellFormedProviderKey(key)) return false;
    const registration = registry.get(key);
    return registration !== undefined && registration.capabilities.recordedByStaff !== true;
  })
) {
  return err(new ValidationError("Unknown payment method", []));
}
```

and the `providerSettings` loop treats it the same way (`registration === undefined || registration.capabilities.recordedByStaff === true` → `ValidationError("Unknown payment method")`).

`CheckoutPaymentMethodsAdapter.enabledMethods` (apps/admin) needs no change: it filters the settings DTO, which no longer lists `manual`.

`services/payments/src/application/get-payment-intents-by-ids.use-case.ts` — `PaymentIntentSummary` gains

```ts
  /** Cash a courier collects on delivery — by capability (Ruling 9); false for a staff-recorded payment. */
  readonly collectedOnDelivery: boolean;
```

and the mapper adds `collectedOnDelivery: capabilities !== undefined && isCollectedOnDelivery(capabilities),`. Its unit test's expected objects gain the field (`true` for cod, `false` for stripe / unregistered).

`services/payments/src/index.ts` — export `manualPaymentRegistration`, `ManualPaymentProvider`, `isCollectedOnDelivery`.

Existing tests that list the registry's keys or the settings' `methods` (run the payments suite and the two `merchant-payments.e2e` suites; fix only literal key lists): add `"manual"` to a registry listing; a settings `methods` listing stays without it.

Run: `pnpm --filter @platform/payments test` → PASS.

- [ ] **Step 4: The cash-to-collect rule (binding carry 4, test first)**

In `apps/admin/src/http/cod-collection.test.ts`, the `cod()` fixture gains `collectedOnDelivery: true`, and append:

```ts
it("a draft completed as paid (manual) is NEVER cash to collect — pending, settled or dead (Ruling 9)", () => {
  const manual = (status: string) =>
    cod({
      provider: "manual",
      status,
      collectedOnDelivery: false,
      settledByOperatorConfirmation: true,
    });
  for (const status of ["created", "capture_requested", "captured", "cancelled"]) {
    expect(codCollectionState(order(), manual(status)), status).toEqual(NONE);
  }
});

it("a cash-on-delivery intent is still collected, keyed on the capability, not the name", () => {
  expect(
    codCollectionState(order(), cod({ provider: "courier-cash", collectedOnDelivery: true })),
  ).toEqual({
    printAmount: true,
    canMarkCollected: true,
  });
});
```

In `apps/admin/src/http/cod-collection.ts`, replace `!intent.settledByOperatorConfirmation ||` with `!intent.collectedOnDelivery ||` and extend the doc comment:

```ts
 * Order operations Part 4 (Ruling 9): a draft order "Marked as paid" uses the `manual` provider, which
 * is settled by an operator's confirmation too — but the merchant already HAS that money, so it is never
 * cash to collect: `collectedOnDelivery` is false for it. Even if its settlement failed and the intent is
 * still pending, no packing slip or CSV prints "Collect" for it and the bulk "Mark cash as received"
 * skips it; the draft's own "Mark as paid" (resumable, Ruling 6) is how it gets settled.
```

The `cod()` / summary fixtures in `order-bulk-actions.test.ts` and `order-export-rows.test.ts` gain `collectedOnDelivery: true` (and `false` wherever they set `settledByOperatorConfirmation: false`).

Run: `pnpm --filter @platform/admin exec vitest run src/http/cod-collection.test.ts src/http/order-bulk-actions.test.ts src/http/order-export-rows.test.ts` → PASS.

- [ ] **Step 5: The order page names it**

`apps/admin-web/src/messages/en.ts`, `orderPage.paymentMethodName`: add `manual: "Manual payment",`; `ar.ts`: `manual: "دفع يدوي",`.

Run: `pnpm --filter admin-web exec vitest run src/lib` → PASS (a `paymentMethodLabel` test may pin the map; add the `manual` row if it enumerates).

- [ ] **Step 6: Gates**

`pnpm --filter @platform/payments typecheck lint`, `pnpm --filter @platform/admin typecheck`, `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint`, `pnpm --filter admin-web typecheck` → green. Run the full `pnpm --filter @platform/admin test` once (the bulk COD and export suites read the summary).

- [ ] **Step 7: Commit**

```bash
git add services/payments/src/domain/value-objects/provider-capabilities.ts \
  services/payments/src/infrastructure/manual-payment-provider.ts \
  services/payments/src/infrastructure/manual-payment-provider.test.ts \
  services/payments/src/infrastructure/built-in-provider-registrations.ts \
  services/payments/src/infrastructure/tenant-payment-provider-resolver.ts \
  services/payments/src/application/merchant-payment-settings.use-cases.ts \
  services/payments/src/application/get-payment-intents-by-ids.use-case.ts \
  services/payments/src/application/get-payment-intents-by-ids.use-case.test.ts \
  services/payments/src/manual-payment.test.ts services/payments/src/index.ts \
  apps/admin/src/http/cod-collection.ts apps/admin/src/http/cod-collection.test.ts \
  apps/admin/src/http/order-bulk-actions.test.ts apps/admin/src/http/order-export-rows.test.ts \
  apps/admin-web/src/messages/en.ts apps/admin-web/src/messages/ar.ts
# plus any of the listed provider-list tests you had to touch, by path
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(payments): manual payment provider for drafts marked as paid

A built-in manual provider, recorded by staff: never offered or enabled, accepted for a new
payment, settled only by the confirmed collection. The cash-to-collect rule keys on a new
collectedOnDelivery capability, so a draft marked paid is never cash a courier collects.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Admin API — draft CRUD, server-side pricing, shipping rates and the DTOs

Model tier: **senior** (the only place merchant amounts enter; every price must come from Catalog or from bounded merchant terms — binding carry 9).

**Files:**

- Create: `apps/admin/src/interfaces/draft-orders.admin-controller.ts`
- Create: `apps/admin/src/infrastructure/cross-context/draft-order-completion.adapter.ts`, `draft-order-completion.adapter.test.ts`
- Create: `apps/admin/src/http/draft-order-dto.ts`
- Create: `apps/admin/src/http/draft-order-pricing.ts`
- Create: `apps/admin/src/http/draft-order-routes.ts`
- Create: `apps/admin/src/http/draft-order-routes.test.ts`
- Create: `apps/admin/src/http/testing/draft-harness.ts`
- Modify: `apps/admin/src/composition.ts` (`WiredAdmin.draftOrders`, `publicReads.draftOrders`, Checkout's `draftCompletion`)
- Modify: `apps/admin/src/http/admin-routes.ts` (register `draftOrderRoutes(admin)` after `abandonedCheckoutRoutes(admin)`)

**Interfaces:**

- Consumes: Task 2 `OrderController` draft methods and `@platform/orders` draft types; Task 4 `CheckoutController.quoteDraftShipping/estimateDraftTax/listDraftLinks/expire/revokeDraftLinks`, `checkoutAddressProblem`; existing `resolveMerchandise`, `resolveLineImages`, `lineKey`, `AdminGuard`, `admin.customers.contactsOfCustomers`, `admin.orders.listOrders`, `admin.tenancy.getPublicStore`.
- Produces:
  - `DraftOrdersAdminController { list, get, create, update, remove, markInvoiceSent (principal, input) => AdminResponse; authorizeDraft(principal): Promise<AdminResponse | null>; authorizeCompletion(principal, payment: "paid" | "collect_on_delivery"): Promise<AdminResponse | null> }`.
  - `WiredAdmin.draftOrders: DraftOrdersAdminController`; `WiredAdmin.publicReads.draftOrders: Pick<OrderController, "getDraftOrder" | "setDraftCheckout" | "completeDraftFromCheckout">`.
  - `DraftOrderCompletionAdapter` (Checkout's `DraftOrderCompletionPort` over `OrderController.completeDraftFromCheckout`).
  - `draft-order-dto.ts`: `DraftAddressDto`, `DraftLineDto`, `DraftTotalsDto`, `DraftLinkDto`, `DraftOrderDto`, `DraftOrderListItemDto`, `DraftRequirementDto`, `toDraftOrderDto(draft, extras)`, `toDraftListItemDto(draft, extras)`, `draftTotalsOf(draft, tax)`.
  - `draft-order-pricing.ts`: `draftBody` (zod), `type DraftBody`, `storeCurrencyOf(admin)`, `draftContentFrom(admin, principal, tenantId, body, currency)`, `draftItemsOf(lines)`, `checkoutAddressOf(address)`, `estimatedTaxOf(admin, tenantId, draft)`, `withConflictCode(response)`, `invalidResponse(message, fields)`.
  - `draft-order-routes.ts`: `draftOrderRoutes(admin)`, `draftDetailOf(admin, principal, tenantId, draft)`, and the six routes below; Task 7 appends `invoice-link` and `complete`.

| Route                                                | Permission     | Answer                                                      |
| ---------------------------------------------------- | -------------- | ----------------------------------------------------------- |
| `GET /draft-orders?status=&q=&first=&after=`         | `orders:read`  | `{ items: DraftOrderListItemDto[], pageInfo }`              |
| `POST /draft-orders` (`idempotent: true`)            | `orders:draft` | 201 `DraftOrderDto`                                         |
| `GET /draft-orders/:draftId`                         | `orders:read`  | `DraftOrderDto`                                             |
| `PUT /draft-orders/:draftId` (`idempotent: true`)    | `orders:draft` | `DraftOrderDto`; 409 `VERSION_CONFLICT` / `DRAFT_COMPLETED` |
| `DELETE /draft-orders/:draftId` (`idempotent: true`) | `orders:draft` | `{ draftId }`; 409 `DRAFT_COMPLETED`                        |
| `POST /draft-orders/:draftId/shipping-rates`         | `orders:draft` | `{ rates: [{ method, title, amountMinor }] }`               |

- [ ] **Step 1: The test harness**

`apps/admin/src/http/testing/draft-harness.ts`:

```ts
import type { Principal } from "@platform/contracts";
import type { DraftOrderDto } from "../draft-order-dto";
import {
  recoveryWorld,
  seedRecoveryProduct,
  unwrap,
  type RecoveryWorld,
} from "./abandoned-harness";
import { adminStaff, HARNESS_TENANT, operatorStaff } from "./orders-harness";
import type { SeededProduct } from "./seed-catalog";

/** TEST-ONLY (order operations Part 4): the real in-memory composition plus two EGP products. */
export interface DraftWorld extends RecoveryWorld {
  readonly tee: SeededProduct;
  readonly cap: SeededProduct;
}

export async function draftWorld(): Promise<DraftWorld> {
  const world = recoveryWorld();
  const tee = await seedRecoveryProduct(world, "TEE", 25000);
  const cap = await seedRecoveryProduct(world, "CAP", 9000);
  return Object.assign(world, { tee, cap });
}

export const DRAFT_ADDRESS = {
  name: "Mona Ali",
  phone: "01001234567",
  line1: "5 Nile St",
  city: "Cairo",
  postalCode: "",
  country: "EG",
  province: "EG-C",
} as const;

/** A complete draft body: two lines, a 10 % discount, custom shipping, a guest email. */
export function draftBody(world: DraftWorld, over: Record<string, unknown> = {}) {
  return {
    email: "sara@example.com",
    phone: "01001234567",
    shippingAddress: DRAFT_ADDRESS,
    lines: [
      { productId: world.tee.productId, variantId: world.tee.variantId, quantity: 2 },
      { productId: world.cap.productId, variantId: world.cap.variantId, quantity: 1 },
    ],
    discount: { valueType: "percentage", value: 10, reason: "Loyal customer" },
    shipping: { kind: "custom", title: "Courier", amountMinor: 4000 },
    note: "Deliver after 5 pm",
    tags: ["WhatsApp"],
    ...over,
  };
}

export async function createDraft(
  world: DraftWorld,
  over: Record<string, unknown> = {},
  principal: Principal = operatorStaff,
): Promise<DraftOrderDto> {
  return unwrap<DraftOrderDto>(
    await world.staffCall("POST", "/draft-orders", { body: draftBody(world, over) }, principal),
    "create draft",
  );
}

/** Settings → Payments: cash on delivery on (Ruling 7). */
export async function enableCashOnDelivery(world: DraftWorld): Promise<void> {
  const response = await world.admin.payments.updateSettings(adminStaff, {
    tenantId: HARNESS_TENANT,
    enabledMethods: ["cod", "stripe"],
  });
  if (response.status !== 200) throw new Error(`enable COD answered ${response.status}`);
}
```

- [ ] **Step 2: Write the failing route test**

`apps/admin/src/http/draft-order-routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DraftOrderDto, DraftOrderListItemDto } from "./draft-order-dto";
import { unwrap } from "./testing/abandoned-harness";
import { createDraft, DRAFT_ADDRESS, draftBody, draftWorld } from "./testing/draft-harness";
import { adminStaff, operatorStaff, viewerStaff } from "./testing/orders-harness";

const fieldsOf = (body: unknown) =>
  ((body as { fields?: { field: string }[] }).fields ?? []).map((f) => f.field);

describe("POST /draft-orders (spec §4.8)", () => {
  it("creates D1 with every price read from Catalog and the totals worked out by the API", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    expect(draft.draftNumber).toBe("D1");
    expect(draft.status).toBe("open");
    expect(draft.version).toBe(0);
    expect(draft.lines.map((l) => [l.sku, l.quantity, l.unitPriceMinor, l.lineTotalMinor])).toEqual(
      [
        ["TEE", 2, 25000, 50000],
        ["CAP", 1, 9000, 9000],
      ],
    );
    expect(draft.discount).toEqual({
      valueType: "percentage",
      value: 10,
      reason: "Loyal customer",
      amountMinor: 5900,
    });
    expect(draft.totals).toMatchObject({
      subtotalMinor: 59000,
      discountMinor: 5900,
      shippingMinor: 4000,
    });
    expect(draft.totals.totalMinor).toBe(
      59000 - 5900 + 4000 + (draft.totals.taxIncluded ? 0 : (draft.totals.taxMinor ?? 0)),
    );
    expect(draft.missing).toEqual({ invoice: [], complete: [] });
    expect((await createDraft(world)).draftNumber).toBe("D2");
  });

  it("never accepts a price from the browser (binding carry 9)", async () => {
    const world = await draftWorld();
    const route = world.routes.find((r) => r.method === "POST" && r.path === "/draft-orders");
    const sneaky = draftBody(world, {
      lines: [
        {
          productId: world.tee.productId,
          variantId: world.tee.variantId,
          quantity: 1,
          unitPriceMinor: 1,
        },
      ],
    });
    expect(route?.schema.body?.safeParse(sneaky).success).toBe(false);
  });

  it("refuses an unsellable variant by line (Review Focus 3)", async () => {
    const world = await draftWorld();
    const refused = await world.staffCall(
      "POST",
      "/draft-orders",
      {
        body: draftBody(world, {
          lines: [
            {
              productId: world.tee.productId,
              variantId: "00000000-0000-7000-8000-00000000dead",
              quantity: 1,
            },
          ],
        }),
      },
      operatorStaff,
    );
    expect(refused.status).toBe(422);
    expect(fieldsOf(refused.body)).toContain("lines.0");
  });

  it("bounds the merchant's amounts and checks the province against the country", async () => {
    const world = await draftWorld();
    const over = async (o: Record<string, unknown>) =>
      world.staffCall("POST", "/draft-orders", { body: draftBody(world, o) }, operatorStaff);
    const route = world.routes.find((r) => r.method === "POST" && r.path === "/draft-orders");
    expect(
      route?.schema.body?.safeParse(
        draftBody(world, { shipping: { kind: "custom", title: "X", amountMinor: 10_000_001 } }),
      ).success,
    ).toBe(false);
    expect(
      route?.schema.body?.safeParse(
        draftBody(world, { discount: { valueType: "percentage", value: 101 } }),
      ).success,
    ).toBe(false);
    const province = await over({ shippingAddress: { ...DRAFT_ADDRESS, province: "SA-01" } });
    expect(province.status).toBe(422);
    expect(fieldsOf(province.body)).toContain("shippingAddress.province");
  });

  it("re-prices a shop rate from its method; an unknown method is refused", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world, { shipping: { kind: "rate", method: "express" } });
    expect(draft.shipping).toEqual({
      kind: "rate",
      method: "express",
      title: "Express",
      amountMinor: 1500,
    });
    const unknown = await world.staffCall(
      "POST",
      "/draft-orders",
      { body: draftBody(world, { shipping: { kind: "rate", method: "teleport" } }) },
      operatorStaff,
    );
    expect(unknown.status).toBe(422);
    expect(fieldsOf(unknown.body)).toContain("shipping.method");
  });

  it("an unknown customer is refused; viewers cannot create", async () => {
    const world = await draftWorld();
    const unknown = await world.staffCall(
      "POST",
      "/draft-orders",
      { body: draftBody(world, { customerId: "00000000-0000-7000-8000-00000000c0de" }) },
      operatorStaff,
    );
    expect(unknown.status).toBe(422);
    expect(fieldsOf(unknown.body)).toContain("customerId");
    expect(
      (await world.staffCall("POST", "/draft-orders", { body: draftBody(world) }, viewerStaff))
        .status,
    ).toBe(403);
  });
});

describe("GET / PUT / DELETE /draft-orders/:draftId", () => {
  it("viewers read it; operators update it with the version; a stale version is 409 VERSION_CONFLICT", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const params = { draftId: draft.id };
    expect(
      (await world.staffCall("GET", "/draft-orders/:draftId", { params }, viewerStaff)).status,
    ).toBe(200);
    const updated = unwrap<DraftOrderDto>(
      await world.staffCall(
        "PUT",
        "/draft-orders/:draftId",
        { params, body: { ...draftBody(world, { note: "new" }), version: 0 } },
        operatorStaff,
      ),
      "update",
    );
    expect(updated.version).toBe(1);
    expect(updated.note).toBe("new");
    const stale = await world.staffCall(
      "PUT",
      "/draft-orders/:draftId",
      { params, body: { ...draftBody(world), version: 0 } },
      operatorStaff,
    );
    expect(stale.status).toBe(409);
    expect((stale.body as { code: string }).code).toBe("VERSION_CONFLICT");
  });

  it("delete is soft: 404 afterwards and gone from the list; a garbage id is 404", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    expect(
      (
        await world.staffCall(
          "DELETE",
          "/draft-orders/:draftId",
          { params: { draftId: draft.id } },
          operatorStaff,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await world.staffCall(
          "GET",
          "/draft-orders/:draftId",
          { params: { draftId: draft.id } },
          adminStaff,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await world.staffCall(
          "GET",
          "/draft-orders/:draftId",
          { params: { draftId: "abc" } },
          adminStaff,
        )
      ).status,
    ).toBe(404);
    const page = unwrap<{ items: DraftOrderListItemDto[] }>(
      await world.staffCall("GET", "/draft-orders", {}, viewerStaff),
      "list",
    );
    expect(page.items).toEqual([]);
  });

  it("a completed draft cannot be changed or deleted (409 DRAFT_COMPLETED)", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    await world.admin.publicReads.draftOrders.completeDraftFromCheckout({
      tenantId: "shop-a",
      draftId: draft.id,
      orderRef: "00000000-0000-7000-8000-0000000000aa",
    });
    const params = { draftId: draft.id };
    const put = await world.staffCall(
      "PUT",
      "/draft-orders/:draftId",
      { params, body: { ...draftBody(world), version: 0 } },
      operatorStaff,
    );
    const del = await world.staffCall(
      "DELETE",
      "/draft-orders/:draftId",
      { params },
      operatorStaff,
    );
    for (const reply of [put, del]) {
      expect(reply.status).toBe(409);
      expect((reply.body as { code: string }).code).toBe("DRAFT_COMPLETED");
    }
  });
});

describe("GET /draft-orders", () => {
  it("lists newest first with the customer's name, total and status; filters by status and #number", async () => {
    const world = await draftWorld();
    await createDraft(world);
    await createDraft(world, { shippingAddress: { ...DRAFT_ADDRESS, name: "Omar" } });
    const page = unwrap<{ items: DraftOrderListItemDto[] }>(
      await world.staffCall("GET", "/draft-orders", {}, viewerStaff),
      "list",
    );
    expect(page.items.map((d) => [d.draftNumber, d.customerName, d.status])).toEqual([
      ["D2", "Omar", "open"],
      ["D1", "Mona Ali", "open"],
    ]);
    expect(page.items[0]?.totalMinor).toBe(59000 - 5900 + 4000);
    const found = unwrap<{ items: DraftOrderListItemDto[] }>(
      await world.staffCall("GET", "/draft-orders", { query: { q: "#D1" } }, viewerStaff),
      "search",
    );
    expect(found.items.map((d) => d.draftNumber)).toEqual(["D1"]);
  });
});

describe("POST /draft-orders/:draftId/shipping-rates", () => {
  it("answers the shop's rates for the saved address; refuses without an address; viewers are refused", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const rates = unwrap<{ rates: { method: string; title: string; amountMinor: number }[] }>(
      await world.staffCall(
        "POST",
        "/draft-orders/:draftId/shipping-rates",
        { params: { draftId: draft.id } },
        operatorStaff,
      ),
      "rates",
    );
    expect(rates.rates).toEqual([
      { method: "standard", title: "Standard", amountMinor: 500 },
      { method: "express", title: "Express", amountMinor: 1500 },
    ]);
    const bare = await createDraft(world, { shippingAddress: null, shipping: null });
    expect(bare.missing.invoice).toEqual(["shipping_address", "shipping"]);
    expect(
      (
        await world.staffCall(
          "POST",
          "/draft-orders/:draftId/shipping-rates",
          { params: { draftId: bare.id } },
          operatorStaff,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await world.staffCall(
          "POST",
          "/draft-orders/:draftId/shipping-rates",
          { params: { draftId: draft.id } },
          viewerStaff,
        )
      ).status,
    ).toBe(403);
  });
});
```

(`staffCall` parses the body through the route's zod schema, so an invalid body throws there — the two `safeParse` assertions test the schema directly. Run Prettier.)

Run: `pnpm --filter @platform/admin exec vitest run src/http/draft-order-routes.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: The guarded facade and the completion adapter**

`apps/admin/src/interfaces/draft-orders.admin-controller.ts`:

```ts
import type { Principal } from "@platform/contracts";
import type { OrderController } from "@platform/orders";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface DraftOrdersAdminControllerDeps {
  readonly orders: OrderController;
  readonly guard: AdminGuard;
}

/** Order operations Part 4 — the staff side of drafts (spec Permissions). */
export class DraftOrdersAdminController {
  private readonly orders: OrderController;
  private readonly guard: AdminGuard;

  constructor(deps: DraftOrdersAdminControllerDeps) {
    this.orders = deps.orders;
    this.guard = deps.guard;
  }

  async list(
    principal: Principal,
    input: Parameters<OrderController["listDraftOrders"]>[0],
  ): Promise<AdminResponse> {
    return (
      (await this.guard.ensure(principal, "orders:read")) ?? this.orders.listDraftOrders(input)
    );
  }

  async get(
    principal: Principal,
    input: Parameters<OrderController["getDraftOrder"]>[0],
  ): Promise<AdminResponse> {
    return (await this.guard.ensure(principal, "orders:read")) ?? this.orders.getDraftOrder(input);
  }

  async create(
    principal: Principal,
    input: Parameters<OrderController["createDraftOrder"]>[0],
  ): Promise<AdminResponse> {
    return (
      (await this.guard.ensure(principal, "orders:draft")) ?? this.orders.createDraftOrder(input)
    );
  }

  async update(
    principal: Principal,
    input: Parameters<OrderController["updateDraftOrder"]>[0],
  ): Promise<AdminResponse> {
    return (
      (await this.guard.ensure(principal, "orders:draft")) ?? this.orders.updateDraftOrder(input)
    );
  }

  async remove(
    principal: Principal,
    input: Parameters<OrderController["deleteDraftOrder"]>[0],
  ): Promise<AdminResponse> {
    return (
      (await this.guard.ensure(principal, "orders:draft")) ?? this.orders.deleteDraftOrder(input)
    );
  }

  async markInvoiceSent(
    principal: Principal,
    input: Parameters<OrderController["markDraftInvoiceSent"]>[0],
  ): Promise<AdminResponse> {
    return (
      (await this.guard.ensure(principal, "orders:draft")) ??
      this.orders.markDraftInvoiceSent(input)
    );
  }

  /** Shipping rates and the invoice link (spec §4.8: `orders:draft`). */
  authorizeDraft(principal: Principal): Promise<AdminResponse | null> {
    return this.guard.ensure(principal, "orders:draft");
  }

  /**
   * Spec §4.8: `orders:complete_draft`, plus `payments:confirm_cod_collection` for "Mark as paid" — money
   * stays admin-only (Plan 1B-2).
   */
  async authorizeCompletion(
    principal: Principal,
    payment: "paid" | "collect_on_delivery",
  ): Promise<AdminResponse | null> {
    const denied = await this.guard.ensure(principal, "orders:complete_draft");
    if (denied !== null || payment !== "paid") return denied;
    return this.guard.ensure(principal, "payments:confirm_cod_collection");
  }
}
```

(Prettier-format.)

`apps/admin/src/infrastructure/cross-context/draft-order-completion.adapter.ts`:

```ts
import type { DraftOrderCompletionPort } from "@platform/checkout";
import type { OrderController } from "@platform/orders";

/**
 * Real `DraftOrderCompletionPort` (order operations Part 4): Checkout reports a draft order's checkout
 * became an order; Orders marks the draft completed (idempotent). Stateless per tenant. A refusal is
 * thrown so Checkout logs it (best effort); the draft heals on read either way (Ruling 10).
 */
export class DraftOrderCompletionAdapter implements DraftOrderCompletionPort {
  private readonly orders: Pick<OrderController, "completeDraftFromCheckout">;

  constructor(orders: Pick<OrderController, "completeDraftFromCheckout">) {
    this.orders = orders;
  }

  async complete(input: Parameters<DraftOrderCompletionPort["complete"]>[0]): Promise<void> {
    const response = await this.orders.completeDraftFromCheckout({
      tenantId: input.tenantId,
      draftId: input.draftOrderRef,
      orderRef: input.orderRef,
      ...(input.actorRef === undefined ? {} : { actorRef: input.actorRef }),
    });
    if (response.status !== 200) {
      throw new Error(`DraftOrderCompletionAdapter: Orders answered ${response.status}`);
    }
  }
}
```

`draft-order-completion.adapter.test.ts`: a stub `completeDraftFromCheckout` returning 200 → resolves and receives `draftId`/`orderRef`/`actorRef`; returning 409 → rejects with `/409/`.

- [ ] **Step 4: Composition**

In `apps/admin/src/composition.ts`:

- import `DraftOrdersAdminController` and `DraftOrderCompletionAdapter`.
- `checkoutDeps` gains `draftCompletion: deps.draftCompletion ?? new DraftOrderCompletionAdapter(orders.orders),` (add `readonly draftCompletion?: DraftOrderCompletionPort;` to the admin wiring deps, documented like `discountUsage`). `orders` is wired before `checkout`, so no lazy cell is needed.
- `WiredAdmin` gains, after `orders`:

```ts
  /** Order operations Part 4: Orders → Drafts. */
  readonly draftOrders: DraftOrdersAdminController;
```

built as `draftOrders: new DraftOrdersAdminController({ orders: orders.orders, guard }),`.

- `WiredAdmin.publicReads` gains (built as `draftOrders: orders.orders`):

```ts
    /**
     * Order operations Part 4: the three draft operations the invoice link and the post-completion
     * bookkeeping need with no staff principal (the shopper opening an invoice, Checkout reporting a
     * paid draft). Nothing else of Orders is reachable here; the guarded `draftOrders` facade stays the
     * only staff path.
     */
    readonly draftOrders: Pick<OrderController, "getDraftOrder" | "setDraftCheckout" | "completeDraftFromCheckout">;
```

No new object holds a tenant (binding carry 6).

- [ ] **Step 5: DTOs**

`apps/admin/src/http/draft-order-dto.ts`:

```ts
import type { CheckoutLink } from "@platform/checkout";
import {
  draftAmounts,
  draftRequirements,
  type DraftAddress,
  type DraftOrder,
  type DraftOrderStatus,
  type DraftRequirement,
} from "@platform/orders";
import { lineKey } from "./product-images";

export type DraftRequirementDto = DraftRequirement;

export interface DraftAddressDto {
  readonly name: string | null;
  readonly phone: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly province: string | null;
  readonly postalCode: string;
  readonly country: string;
}

export interface DraftLineDto {
  readonly productId: string;
  readonly variantId: string;
  readonly sku: string;
  readonly title: string;
  readonly variantTitle: string | null;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly imageUrl: string | null;
}

export interface DraftTotalsDto {
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly shippingMinor: number;
  /** Estimated by Finance for the shipping address; null without one ("Calculated after an address is added"). */
  readonly taxMinor: number | null;
  readonly taxIncluded: boolean;
  readonly totalMinor: number;
}

export interface DraftLinkDto {
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly claimCount: number;
  readonly lastClaimedAt: string | null;
}

export interface DraftOrderDto {
  readonly id: string;
  readonly draftNumber: string;
  readonly status: DraftOrderStatus;
  /** Send it back with a PUT (optimistic lock). */
  readonly version: number;
  readonly currency: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly invoiceSentAt: string | null;
  readonly completedAt: string | null;
  readonly customer: {
    readonly id: string;
    readonly name: string | null;
    readonly email: string | null;
  } | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly shippingAddress: DraftAddressDto | null;
  /** null = same as shipping. */
  readonly billingAddress: DraftAddressDto | null;
  readonly lines: readonly DraftLineDto[];
  readonly discount: {
    readonly valueType: "fixed" | "percentage";
    readonly value: number;
    readonly reason: string | null;
    readonly amountMinor: number;
  } | null;
  readonly shipping: {
    readonly kind: "rate" | "custom" | "free";
    readonly method: string | null;
    readonly title: string;
    readonly amountMinor: number;
  } | null;
  readonly note: string | null;
  readonly tags: readonly string[];
  readonly totals: DraftTotalsDto;
  /** The order it became (completed drafts). */
  readonly order: { readonly id: string; readonly orderNumber: string | null } | null;
  /** Its invoice links, newest first. */
  readonly links: readonly DraftLinkDto[];
  /** What it still needs before Send invoice / Collect payment (spec §4.5). */
  readonly missing: {
    readonly invoice: readonly DraftRequirementDto[];
    readonly complete: readonly DraftRequirementDto[];
  };
}

export interface DraftOrderListItemDto {
  readonly id: string;
  readonly draftNumber: string;
  readonly createdAt: string;
  readonly customerName: string | null;
  readonly status: DraftOrderStatus;
  /** Before tax (Ruling 14). */
  readonly totalMinor: number;
  readonly currency: string;
  readonly orderRef: string | null;
  readonly orderNumber: string | null;
}

const addressDto = (address: DraftAddress | null): DraftAddressDto | null =>
  address === null ? null : { ...address };

export function draftTotalsOf(
  draft: DraftOrder,
  tax: { readonly taxMinor: number; readonly included: boolean } | null,
): DraftTotalsDto {
  const amounts = draftAmounts(draft);
  return {
    subtotalMinor: amounts.subtotalMinor,
    discountMinor: amounts.discountMinor,
    shippingMinor: amounts.shippingMinor,
    taxMinor: tax?.taxMinor ?? null,
    taxIncluded: tax?.included ?? false,
    totalMinor: amounts.totalBeforeTaxMinor + (tax === null || tax.included ? 0 : tax.taxMinor),
  };
}

export interface DraftDetailExtras {
  readonly images: ReadonlyMap<string, { readonly url: string } | null>;
  readonly customer: {
    readonly id: string;
    readonly name: string | null;
    readonly email: string | null;
  } | null;
  readonly tax: { readonly taxMinor: number; readonly included: boolean } | null;
  readonly orderNumber: string | null;
  readonly links: readonly CheckoutLink[];
}

export function toDraftOrderDto(draft: DraftOrder, extras: DraftDetailExtras): DraftOrderDto {
  const amounts = draftAmounts(draft);
  const content = draft.content();
  return {
    id: draft.id,
    draftNumber: draft.draftNumber,
    status: draft.status,
    version: draft.version,
    currency: draft.currency,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
    invoiceSentAt: draft.invoiceSentAt?.toISOString() ?? null,
    completedAt: draft.completedAt?.toISOString() ?? null,
    customer: extras.customer,
    email: draft.contactEmail,
    phone: draft.contactPhone,
    shippingAddress: addressDto(draft.shippingAddress),
    billingAddress: addressDto(draft.billingAddress),
    lines: draft.lines.map((line) => ({
      productId: line.productRef,
      variantId: line.variantRef,
      sku: line.sku,
      title: line.title,
      variantTitle: line.variantTitle,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineTotalMinor: line.unitPriceMinor * line.quantity,
      imageUrl: extras.images.get(lineKey(line.productRef, line.variantRef))?.url ?? null,
    })),
    discount:
      draft.discount === null ? null : { ...draft.discount, amountMinor: amounts.discountMinor },
    shipping:
      draft.shipping === null
        ? null
        : {
            kind: draft.shipping.kind,
            method: draft.shipping.kind === "rate" ? draft.shipping.method : null,
            title: draft.shipping.title,
            amountMinor: draft.shipping.amountMinor,
          },
    note: draft.note,
    tags: [...draft.tags],
    totals: draftTotalsOf(draft, extras.tax),
    order: draft.orderRef === null ? null : { id: draft.orderRef, orderNumber: extras.orderNumber },
    links: extras.links.map((link) => ({
      issuedAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt.toISOString(),
      claimCount: link.claimCount,
      lastClaimedAt: link.lastClaimedAt?.toISOString() ?? null,
    })),
    missing: {
      invoice: draftRequirements(content, "invoice"),
      complete: draftRequirements(content, "complete"),
    },
  };
}

export function toDraftListItemDto(
  draft: DraftOrder,
  extras: { readonly customerName: string | null; readonly orderNumber: string | null },
): DraftOrderListItemDto {
  return {
    id: draft.id,
    draftNumber: draft.draftNumber,
    createdAt: draft.createdAt.toISOString(),
    customerName: extras.customerName,
    status: draft.status,
    totalMinor: draftAmounts(draft).totalBeforeTaxMinor,
    currency: draft.currency,
    orderRef: draft.orderRef,
    orderNumber: extras.orderNumber,
  };
}
```

- [ ] **Step 6: Server-side pricing and validation**

`apps/admin/src/http/draft-order-pricing.ts`:

```ts
import { z } from "zod";
import type { Principal } from "@platform/contracts";
import { checkoutAddressProblem, type CheckoutController } from "@platform/checkout";
import type { CustomerContact } from "@platform/identity";
import {
  draftAmounts,
  MAX_DRAFT_AMOUNT_MINOR,
  MAX_DRAFT_LINE_QUANTITY,
  MAX_DRAFT_LINES,
  type DraftAddress,
  type DraftLine,
  type DraftOrder,
  type DraftOrderContent,
  type DraftShipping,
} from "@platform/orders";
import {
  BusinessRuleError,
  toErrorEnvelope,
  ValidationError,
  type FieldIssue,
} from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import { resolveMerchandise } from "./merchandise-resolution";

const amount = z.number().int().min(0).max(MAX_DRAFT_AMOUNT_MINOR);

export const addressBody = z
  .object({
    name: z.string().max(120).optional(),
    phone: z.string().max(32).optional(),
    line1: z.string().min(1).max(200),
    line2: z.string().max(200).optional(),
    city: z.string().min(1).max(100),
    province: z.string().max(10).optional(),
    postalCode: z.string().max(20).optional(),
    country: z.string().length(2),
  })
  .strict();

/**
 * Spec §4.8 `DraftOrderInput`, `.strict()`: the browser sends ids, quantities and the merchant's own
 * terms — NEVER a line price (binding carry 9). The two merchant amounts are bounded here and again in
 * the domain.
 */
export const draftBody = z
  .object({
    customerId: z.string().min(1).max(64).nullable().optional(),
    email: z.string().max(254).nullable().optional(),
    phone: z.string().max(32).nullable().optional(),
    shippingAddress: addressBody.nullable().optional(),
    billingAddress: addressBody.nullable().optional(),
    lines: z
      .array(
        z
          .object({
            productId: z.string().min(1).max(64),
            variantId: z.string().min(1).max(64).optional(),
            quantity: z.number().int().min(1).max(MAX_DRAFT_LINE_QUANTITY),
          })
          .strict(),
      )
      .max(MAX_DRAFT_LINES),
    discount: z
      .object({
        valueType: z.enum(["fixed", "percentage"]),
        value: amount,
        reason: z.string().max(255).optional(),
      })
      .strict()
      .refine((d) => d.valueType === "fixed" || d.value <= 100, {
        message: "a percentage is 0-100",
        path: ["value"],
      })
      .nullable()
      .optional(),
    shipping: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("rate"), method: z.string().min(1).max(100) }).strict(),
        z
          .object({
            kind: z.literal("custom"),
            title: z.string().min(1).max(100),
            amountMinor: amount,
          })
          .strict(),
        z.object({ kind: z.literal("free") }).strict(),
      ])
      .nullable()
      .optional(),
    note: z.string().max(5000).nullable().optional(),
    tags: z.array(z.string().max(40)).max(250).optional(),
  })
  .strict();
export type DraftBody = z.infer<typeof draftBody>;

type DraftItems = Parameters<CheckoutController["loadItems"]>[0]["items"];

export function invalidResponse(message: string, fields: readonly FieldIssue[]): AdminResponse {
  return { status: 422, body: toErrorEnvelope(new ValidationError(message, [...fields])) };
}

/** Ruling 19: a 409 whose message starts with `CODE:` also carries `code`. */
export function withConflictCode(response: AdminResponse): AdminResponse {
  if (response.status !== 409) return response;
  const body = response.body as { readonly message?: unknown } | null;
  const match = typeof body?.message === "string" ? /^([A-Z_]+):/.exec(body.message) : null;
  return match === null ? response : { status: 409, body: { ...(body as object), code: match[1] } };
}

export function draftConflict(code: string, message: string): AdminResponse {
  return {
    status: 409,
    body: { ...toErrorEnvelope(new BusinessRuleError(`${code}: ${message}`)), code },
  };
}

/** The shop's currency (Settings → General) — every draft is in it. Null when unreadable. */
export async function storeCurrencyOf(admin: Pick<WiredAdmin, "tenancy">): Promise<string | null> {
  const response = await admin.tenancy.getPublicStore();
  if (response.status !== 200) return null;
  const currency = (response.body as { readonly currency?: unknown }).currency;
  return typeof currency === "string" ? currency : null;
}

export function checkoutAddressOf(address: DraftAddress) {
  return {
    ...(address.name === null ? {} : { name: address.name }),
    ...(address.phone === null ? {} : { phone: address.phone }),
    line1: address.line1,
    ...(address.line2 === null ? {} : { line2: address.line2 }),
    city: address.city,
    postalCode: address.postalCode,
    country: address.country,
    ...(address.province === null ? {} : { province: address.province }),
  };
}

export function draftItemsOf(lines: readonly DraftLine[], currency: string): DraftItems {
  return lines.map((line) => ({
    productId: line.productRef,
    variantId: line.variantRef,
    sku: line.sku,
    title: line.title,
    variantTitle: line.variantTitle,
    quantity: line.quantity,
    unitPriceAmountMinor: line.unitPriceMinor,
    currency,
  }));
}

function addressFrom(raw: z.infer<typeof addressBody>): DraftAddress {
  return {
    name: raw.name ?? null,
    phone: raw.phone ?? null,
    line1: raw.line1,
    line2: raw.line2 ?? null,
    city: raw.city,
    province: raw.province ?? null,
    postalCode: raw.postalCode ?? "",
    country: raw.country.toUpperCase(),
  };
}

function addressIssues(prefix: string, address: DraftAddress | null): FieldIssue[] {
  if (address === null) return [];
  const problem = checkoutAddressProblem(checkoutAddressOf(address));
  return problem === null
    ? []
    : problem.fields.map((issue) => ({
        field: `${prefix}.${issue.field}`,
        message: issue.message,
      }));
}

/**
 * Turns the merchant's input into draft CONTENT, server-side (spec §4.3, Ruling 12): each line priced
 * from Catalog now; a `rate` shipping re-quoted from the draft's address and lines; addresses checked
 * with Checkout's own rule (province of the country); an existing customer must be this shop's
 * (Ruling 18). Answers the content or the 422 to return.
 */
export async function draftContentFrom(
  admin: WiredAdmin,
  principal: Principal,
  tenantId: string,
  body: DraftBody,
  currency: string,
): Promise<
  | { readonly ok: true; readonly content: DraftOrderContent }
  | { readonly ok: false; readonly response: AdminResponse }
> {
  const issues: FieldIssue[] = [];
  const lines: DraftLine[] = [];
  for (const [index, line] of body.lines.entries()) {
    const priced = await resolveMerchandise(
      admin,
      {
        productId: line.productId,
        ...(line.variantId === undefined ? {} : { variantId: line.variantId }),
      },
      tenantId,
    );
    if (priced.status === "choose_variant") {
      issues.push({ field: `lines.${index}.variantId`, message: "choose a variant" });
    } else if (priced.status !== "ok") {
      issues.push({ field: `lines.${index}`, message: "this product can no longer be sold" });
    } else if (priced.currency !== currency) {
      issues.push({
        field: `lines.${index}`,
        message: `priced in ${priced.currency}, not ${currency}`,
      });
    } else {
      lines.push({
        productRef: priced.productId,
        variantRef: priced.variantId,
        sku: priced.sku,
        title: priced.title,
        variantTitle: priced.variantTitle,
        quantity: line.quantity,
        unitPriceMinor: priced.amountMinor,
      });
    }
  }

  const shippingAddress = body.shippingAddress == null ? null : addressFrom(body.shippingAddress);
  const billingAddress = body.billingAddress == null ? null : addressFrom(body.billingAddress);
  issues.push(
    ...addressIssues("shippingAddress", shippingAddress),
    ...addressIssues("billingAddress", billingAddress),
  );

  let customerRef: string | null = null;
  let customerEmail: string | null = null;
  if (body.customerId != null) {
    const contacts = await admin.customers.contactsOfCustomers(principal, {
      tenantId,
      customerIds: [body.customerId],
    });
    const contact =
      contacts.status === 200
        ? (contacts.body as readonly CustomerContact[]).find((c) => c.id === body.customerId)
        : undefined;
    if (contact === undefined)
      issues.push({ field: "customerId", message: "no such customer in this shop" });
    else {
      customerRef = contact.id;
      customerEmail = contact.email;
    }
  }

  let shipping: DraftShipping | null = null;
  const choice = body.shipping ?? null;
  if (choice?.kind === "custom")
    shipping = { kind: "custom", title: choice.title, amountMinor: choice.amountMinor };
  if (choice?.kind === "free") shipping = { kind: "free", title: "", amountMinor: 0 };
  if (choice?.kind === "rate") {
    if (shippingAddress === null || lines.length === 0) {
      issues.push({ field: "shipping.method", message: "add an address and products first" });
    } else {
      const quoted = await admin.publicReads.checkout.quoteDraftShipping({
        tenantId,
        currency,
        address: {
          country: shippingAddress.country,
          postalCode: shippingAddress.postalCode,
          ...(shippingAddress.province === null ? {} : { province: shippingAddress.province }),
        },
        items: draftItemsOf(lines, currency),
      });
      const quotes =
        quoted.status === 200
          ? (
              quoted.body as {
                quotes: readonly { method: string; name: string; rateAmountMinor: number }[];
              }
            ).quotes
          : [];
      const quote = quotes.find((q) => q.method === choice.method);
      if (quote === undefined)
        issues.push({
          field: "shipping.method",
          message: "this rate does not apply to the address",
        });
      else
        shipping = {
          kind: "rate",
          method: quote.method,
          title: quote.name,
          amountMinor: quote.rateAmountMinor,
        };
    }
  }

  if (issues.length > 0)
    return { ok: false, response: invalidResponse("Invalid draft order", issues) };
  return {
    ok: true,
    content: {
      customerRef,
      contactEmail: body.email ?? customerEmail,
      contactPhone: body.phone ?? null,
      shippingAddress,
      billingAddress,
      lines,
      discount:
        body.discount == null
          ? null
          : {
              valueType: body.discount.valueType,
              value: body.discount.value,
              reason: body.discount.reason ?? null,
            },
      shipping,
      note: body.note ?? null,
      tags: body.tags ?? [],
    },
  };
}

/** Spec §4.3 "Estimated tax": Finance's figure for the draft's address, or null without one. Read-only. */
export async function estimatedTaxOf(
  admin: Pick<WiredAdmin, "publicReads">,
  tenantId: string,
  draft: DraftOrder,
): Promise<{ readonly taxMinor: number; readonly included: boolean } | null> {
  const address = draft.shippingAddress;
  if (address === null || draft.lines.length === 0) return null;
  const amounts = draftAmounts(draft);
  const response = await admin.publicReads.checkout.estimateDraftTax({
    tenantId,
    currency: draft.currency,
    items: draftItemsOf(draft.lines, draft.currency),
    destination: {
      country: address.country,
      ...(address.province === null ? {} : { province: address.province }),
    },
    shippingMinor: amounts.shippingMinor,
    discountMinor: amounts.discountMinor,
  });
  return response.status === 200
    ? (response.body as { taxMinor: number; included: boolean })
    : null;
}
```

(Prettier-format. `ValidationError.fields` is readonly `FieldIssue[]` — use the accessor the type exposes; `problem.fields` is how `toErrorEnvelope` reads it.)

- [ ] **Step 7: The routes**

`apps/admin/src/http/draft-order-routes.ts`:

```ts
import { z } from "zod";
import type { Principal } from "@platform/contracts";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { CheckoutLink } from "@platform/checkout";
import type { CustomerContact } from "@platform/identity";
import {
  DRAFT_ORDER_STATUSES,
  DRAFT_PAGE_SIZE_MAX,
  type DraftOrder,
  type DraftOrderOutput,
  type DraftOrderPage,
  type Order,
} from "@platform/orders";
import { toErrorEnvelope, UnexpectedError } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import { toDraftListItemDto, toDraftOrderDto } from "./draft-order-dto";
import {
  draftBody,
  draftContentFrom,
  draftItemsOf,
  estimatedTaxOf,
  invalidResponse,
  storeCurrencyOf,
  withConflictCode,
} from "./draft-order-pricing";
import { resolveLineImages } from "./product-images";

const listQuery = z.object({
  status: z.enum(DRAFT_ORDER_STATUSES).optional(),
  q: z.string().max(200).optional(),
  first: z.coerce.number().int().min(1).max(DRAFT_PAGE_SIZE_MAX).optional(),
  after: z.string().min(1).max(64).optional(),
});
export const draftIdParams = z.object({ draftId: z.string().min(1).max(64) });
const updateBody = draftBody.extend({ version: z.number().int().min(0) }).strict();

function currencyUnavailable(): AdminResponse {
  return {
    status: 503,
    body: toErrorEnvelope(new UnexpectedError("The shop's currency is unavailable")),
  };
}

async function orderNumbersOf(
  admin: WiredAdmin,
  principal: Principal,
  tenantId: string,
  orderIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const ids = [...new Set(orderIds)];
  if (ids.length === 0) return new Map();
  const response = await admin.orders.listOrders(principal, { tenantId, ids, first: ids.length });
  if (response.status !== 200) return new Map();
  const page = response.body as { readonly items: readonly Order[] };
  return new Map(page.items.map((order) => [order.id.toString(), order.orderNumber.value]));
}

async function contactsOf(
  admin: WiredAdmin,
  principal: Principal,
  tenantId: string,
  customerIds: readonly string[],
): Promise<ReadonlyMap<string, CustomerContact>> {
  const ids = [...new Set(customerIds)];
  if (ids.length === 0) return new Map();
  const response = await admin.customers.contactsOfCustomers(principal, {
    tenantId,
    customerIds: ids,
  });
  if (response.status !== 200) return new Map();
  return new Map((response.body as readonly CustomerContact[]).map((c) => [c.id, c]));
}

/** The full `DraftOrderDto`: pictures, customer, estimated tax, order number and links in a few reads. */
export async function draftDetailOf(
  admin: WiredAdmin,
  principal: Principal,
  tenantId: string,
  draft: DraftOrder,
): Promise<ReturnType<typeof toDraftOrderDto>> {
  const [images, contacts, tax, numbers, links] = await Promise.all([
    resolveLineImages(
      admin,
      tenantId,
      draft.lines.map((l) => ({ productId: l.productRef, variantId: l.variantRef })),
    ),
    contactsOf(admin, principal, tenantId, draft.customerRef === null ? [] : [draft.customerRef]),
    estimatedTaxOf(admin, tenantId, draft),
    orderNumbersOf(admin, principal, tenantId, draft.orderRef === null ? [] : [draft.orderRef]),
    admin.publicReads.checkout.listDraftLinks({ tenantId, draftOrderRef: draft.id }),
  ]);
  const contact = draft.customerRef === null ? undefined : contacts.get(draft.customerRef);
  return toDraftOrderDto(draft, {
    images,
    customer:
      draft.customerRef === null
        ? null
        : { id: draft.customerRef, name: contact?.name ?? null, email: contact?.email ?? null },
    tax,
    orderNumber: draft.orderRef === null ? null : (numbers.get(draft.orderRef) ?? null),
    links: links.status === 200 ? (links.body as readonly CheckoutLink[]) : [],
  });
}

/** Best effort (Rulings 4 and 17): the draft's open checkout stops; a closed one is left alone. */
export async function expireDraftCheckout(
  admin: WiredAdmin,
  tenantId: string,
  checkoutRef: string | null,
): Promise<void> {
  if (checkoutRef === null) return;
  const response = await admin.publicReads.checkout.get({
    tenantId,
    checkoutSessionId: checkoutRef,
  });
  if (response.status !== 200) return;
  const session = response.body as { readonly state: { readonly isOpen: boolean } };
  if (session.state.isOpen)
    await admin.publicReads.checkout.expire({ tenantId, checkoutSessionId: checkoutRef });
}

/** Order operations Part 4 — Orders → Drafts (spec §4.8). Task 7 appends invoice-link and complete. */
export function draftOrderRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/draft-orders",
      version: 1,
      permission: "orders:read",
      summary: "Draft orders, newest first (status, search by #number, email, phone or name)",
      schema: { querystring: listQuery },
      handle: async ({ query, context }) => {
        const response = await admin.draftOrders.list(context.principal, {
          tenantId: context.tenantId,
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.q === undefined ? {} : { search: query.q }),
          ...(query.first === undefined ? {} : { first: query.first }),
          ...(query.after === undefined ? {} : { after: query.after }),
        });
        if (response.status !== 200) return response;
        const page = response.body as DraftOrderPage;
        const [numbers, contacts] = await Promise.all([
          orderNumbersOf(
            admin,
            context.principal,
            context.tenantId,
            page.items.flatMap((d) => (d.orderRef === null ? [] : [d.orderRef])),
          ),
          contactsOf(
            admin,
            context.principal,
            context.tenantId,
            page.items.flatMap((d) => (d.customerRef === null ? [] : [d.customerRef])),
          ),
        ]);
        return {
          status: 200,
          body: {
            items: page.items.map((draft) =>
              toDraftListItemDto(draft, {
                customerName:
                  draft.shippingAddress?.name ??
                  (draft.customerRef === null
                    ? undefined
                    : contacts.get(draft.customerRef)?.name) ??
                  draft.contactEmail ??
                  draft.contactPhone,
                orderNumber: draft.orderRef === null ? null : (numbers.get(draft.orderRef) ?? null),
              }),
            ),
            pageInfo: page.pageInfo,
          },
        };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/draft-orders",
      version: 1,
      permission: "orders:draft",
      idempotent: true,
      summary:
        "Create a draft order — lines priced from Catalog, the merchant's discount and shipping",
      schema: { body: draftBody },
      handle: async ({ body, context }) => {
        const denied = await admin.draftOrders.authorizeDraft(context.principal);
        if (denied !== null) return denied;
        const currency = await storeCurrencyOf(admin);
        if (currency === null) return currencyUnavailable();
        const content = await draftContentFrom(
          admin,
          context.principal,
          context.tenantId,
          body,
          currency,
        );
        if (!content.ok) return content.response;
        const created = await admin.draftOrders.create(context.principal, {
          tenantId: context.tenantId,
          createdBy: context.principal.id,
          currency,
          content: content.content,
        });
        if (created.status !== 201) return withConflictCode(created);
        const { draft } = created.body as DraftOrderOutput;
        return {
          status: 201,
          body: await draftDetailOf(admin, context.principal, context.tenantId, draft),
        };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/draft-orders/:draftId",
      version: 1,
      permission: "orders:read",
      summary: "One draft order: lines, totals with estimated tax, customer, links",
      schema: { params: draftIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.draftOrders.get(context.principal, {
          tenantId: context.tenantId,
          draftId: params.draftId,
        });
        if (response.status !== 200) return response;
        return {
          status: 200,
          body: await draftDetailOf(
            admin,
            context.principal,
            context.tenantId,
            response.body as DraftOrder,
          ),
        };
      },
    }),
    defineRoute({
      method: "PUT",
      path: "/draft-orders/:draftId",
      version: 1,
      permission: "orders:draft",
      idempotent: true,
      summary: "Replace a draft order's content (version-checked); refused once completed",
      schema: { params: draftIdParams, body: updateBody },
      handle: async ({ params, body, context }) => {
        const denied = await admin.draftOrders.authorizeDraft(context.principal);
        if (denied !== null) return denied;
        const before = await admin.draftOrders.get(context.principal, {
          tenantId: context.tenantId,
          draftId: params.draftId,
        });
        if (before.status !== 200) return before;
        const draft = before.body as DraftOrder;
        const content = await draftContentFrom(
          admin,
          context.principal,
          context.tenantId,
          body,
          draft.currency,
        );
        if (!content.ok) return content.response;
        const updated = await admin.draftOrders.update(context.principal, {
          tenantId: context.tenantId,
          draftId: params.draftId,
          version: body.version,
          content: content.content,
        });
        if (updated.status !== 200) return withConflictCode(updated);
        // Ruling 4: a customer on the invoice checkout must not pay the superseded quote.
        await expireDraftCheckout(admin, context.tenantId, draft.checkoutRef);
        const { draft: saved } = updated.body as DraftOrderOutput;
        return {
          status: 200,
          body: await draftDetailOf(admin, context.principal, context.tenantId, saved),
        };
      },
    }),
    defineRoute({
      method: "DELETE",
      path: "/draft-orders/:draftId",
      version: 1,
      permission: "orders:draft",
      idempotent: true,
      summary: "Delete a draft order (soft); its invoice links stop working",
      schema: { params: draftIdParams },
      handle: async ({ params, context }) => {
        const denied = await admin.draftOrders.authorizeDraft(context.principal);
        if (denied !== null) return denied;
        const before = await admin.draftOrders.get(context.principal, {
          tenantId: context.tenantId,
          draftId: params.draftId,
        });
        if (before.status !== 200) return before;
        const draft = before.body as DraftOrder;
        if (draft.status === "completed") {
          return withConflictCode(
            await admin.draftOrders.remove(context.principal, {
              tenantId: context.tenantId,
              draftId: params.draftId,
            }),
          );
        }
        // Ruling 17: links revoked and the open checkout stopped BEFORE the soft delete.
        await admin.publicReads.checkout.revokeDraftLinks({
          tenantId: context.tenantId,
          draftOrderRef: draft.id,
        });
        await expireDraftCheckout(admin, context.tenantId, draft.checkoutRef);
        return withConflictCode(
          await admin.draftOrders.remove(context.principal, {
            tenantId: context.tenantId,
            draftId: params.draftId,
          }),
        );
      },
    }),
    defineRoute({
      method: "POST",
      path: "/draft-orders/:draftId/shipping-rates",
      version: 1,
      permission: "orders:draft",
      summary: "The shop's shipping rates for a draft's saved address and lines",
      schema: { params: draftIdParams },
      handle: async ({ params, context }) => {
        const denied = await admin.draftOrders.authorizeDraft(context.principal);
        if (denied !== null) return denied;
        const found = await admin.draftOrders.get(context.principal, {
          tenantId: context.tenantId,
          draftId: params.draftId,
        });
        if (found.status !== 200) return found;
        const draft = found.body as DraftOrder;
        const address = draft.shippingAddress;
        if (address === null || draft.lines.length === 0) {
          return invalidResponse("Add products and a shipping address first", [
            { field: "shippingAddress", message: "required" },
          ]);
        }
        const quoted = await admin.publicReads.checkout.quoteDraftShipping({
          tenantId: context.tenantId,
          currency: draft.currency,
          address: {
            country: address.country,
            postalCode: address.postalCode,
            ...(address.province === null ? {} : { province: address.province }),
          },
          items: draftItemsOf(draft.lines, draft.currency),
        });
        if (quoted.status !== 200) return quoted;
        const { quotes } = quoted.body as {
          quotes: readonly { method: string; name: string; rateAmountMinor: number }[];
        };
        return {
          status: 200,
          body: {
            rates: quotes.map((q) => ({
              method: q.method,
              title: q.name,
              amountMinor: q.rateAmountMinor,
            })),
          },
        };
      },
    }),
  ] as readonly RouteDefinition[];
}
```

(Prettier-format. `CheckoutSession.state.isOpen` is a getter on the aggregate the raw controller returns, as Part 3's `reusableResult` uses.)

Register in `apps/admin/src/http/admin-routes.ts`: import `draftOrderRoutes` and add `...draftOrderRoutes(admin),` right after `...abandonedCheckoutRoutes(admin),`.

Run the route test → PASS.

- [ ] **Step 8: Gates**

Run: `pnpm --filter @platform/admin test` (the route-contract and multi-tenant guard tests read the route table), `pnpm --filter @platform/admin typecheck`, `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint` → green. `node scripts/dev/check-prisma-tenant-where.mjs` → only the known finding.

- [ ] **Step 9: Commit**

```bash
git add apps/admin/src/interfaces/draft-orders.admin-controller.ts \
  apps/admin/src/infrastructure/cross-context/draft-order-completion.adapter.ts \
  apps/admin/src/infrastructure/cross-context/draft-order-completion.adapter.test.ts \
  apps/admin/src/http/draft-order-dto.ts apps/admin/src/http/draft-order-pricing.ts \
  apps/admin/src/http/draft-order-routes.ts apps/admin/src/http/draft-order-routes.test.ts \
  apps/admin/src/http/testing/draft-harness.ts \
  apps/admin/src/composition.ts apps/admin/src/http/admin-routes.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin): draft order api — list, create, edit, delete, shipping rates

Lines are priced from Catalog on every save, a shop rate is re-quoted from the address, and
the merchant's discount and custom shipping are bounded. Totals add Finance's estimated tax.
Editing expires an open invoice checkout; deleting revokes its links first.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Admin API — materialisation, Send invoice, Collect payment, and the invoice claim and preview

Model tier: **senior** (money, idempotency and a bearer link meet here).

**Files:**

- Create: `apps/admin/src/http/draft-order-checkout.ts` (`healedDraft`, `materializeDraftCheckout`)
- Modify: `apps/admin/src/http/draft-order-routes.ts` (detail heals; append `invoice-link` and `complete`)
- Modify: `apps/admin/src/http/public-checkout-link-routes.ts` (invoice branch of claim and preview)
- Modify: `apps/admin/src/http/order-timeline-dto.ts` (`data.draftId`)
- Create: `apps/admin/src/http/draft-order-invoice.test.ts`, `apps/admin/src/http/draft-order-complete.test.ts`

**Interfaces:**

- Consumes: Tasks 2, 4, 5, 6 (`draftContentFrom`, `draftItemsOf`, `checkoutAddressOf`, `estimatedTaxOf`, `draftConflict`, `withConflictCode`, `invalidResponse`, `draftDetailOf`, `expireDraftCheckout`, `draftIdParams`, `draftTotalsOf`); `shopLinkUrl`, `primaryHostnameOf`, `shopNameOf`; `linkInvalidResponse`, `CheckoutLinkClaimDto`.
- Produces:
  - `draft-order-checkout.ts`: `healedDraft(admin, tenantId, draft): Promise<DraftOrder>`; `materializeDraftCheckout(admin, tenantId, draft, options: { fresh: boolean }): Promise<{ ok: true; checkoutSessionId: string } | { ok: false; response: AdminResponse }>`.
  - `POST /draft-orders/:draftId/invoice-link` (`orders:draft`, **not idempotent**) → 201 `InvoiceLinkDto { url: string | null; path; expiresAt; shopName }`.
  - `POST /draft-orders/:draftId/complete` (`orders:complete_draft` + `payments:confirm_cod_collection` for `paid`, `idempotent: true`), body `{ payment: "paid" | "collect_on_delivery" }` → 200 `{ orderId, orderNumber }`.
  - `CheckoutLinkPreviewDto` becomes `{ purpose: "recovery" | "invoice"; draftNumber: string | null; completed: boolean; shopName; itemCount; items; totalMinor; currency }`.
  - The claim answers 409 `{ code: "ALREADY_COMPLETED" }` for a completed draft and 409 `{ code: "DRAFT_NOT_READY" }` when the draft cannot be checked out.
  - `TimelineEntryDto.data.draftId?: string`.

**Links after completion (Ruling 11):** a completed draft's invoice link stays resolvable so its landing page can say "This order has already been placed" (spec §4.7: completed → 409 `ALREADY_COMPLETED`); the claim refuses before anything is built, so the link can do nothing else. Deletion revokes (Ruling 17), and a revoked link is the uniform 404 (binding carry 3).

- [ ] **Step 1: Write the failing invoice test**

`apps/admin/src/http/draft-order-invoice.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DraftOrderDto } from "./draft-order-dto";
import type { CheckoutLinkClaimDto, CheckoutLinkPreviewDto } from "./public-checkout-link-routes";
import type { PublicCheckoutSessionDto } from "./public-checkout-routes";
import { completeCheckout, unwrap } from "./testing/abandoned-harness";
import {
  createDraft,
  draftBody,
  draftWorld,
  enableCashOnDelivery,
  type DraftWorld,
} from "./testing/draft-harness";
import { operatorStaff, viewerStaff } from "./testing/orders-harness";

interface InvoiceLink {
  url: string | null;
  path: string;
  expiresAt: string;
  shopName: string;
}

const send = (world: DraftWorld, draftId: string, principal = operatorStaff) =>
  world.staffCall(
    "POST",
    "/draft-orders/:draftId/invoice-link",
    { params: { draftId } },
    principal,
  );
const tokenOf = (link: InvoiceLink) => link.path.slice("/c/".length);
const claim = (world: DraftWorld, token: string, sessionRef: string) =>
  world.publicCall("POST", "/public/checkout-links/claim", { body: { token, sessionRef } });
const preview = (world: DraftWorld, token: string) =>
  world.publicCall("GET", "/public/checkout-links/:token/preview", { params: { token } });
const sessionAs = (world: DraftWorld, checkoutSessionId: string, sessionRef: string) =>
  world.publicCall("GET", "/public/checkouts/:checkoutSessionId", {
    params: { checkoutSessionId },
    sessionRef,
  });
const detail = async (world: DraftWorld, draftId: string) =>
  unwrap<DraftOrderDto>(
    await world.staffCall("GET", "/draft-orders/:draftId", { params: { draftId } }, viewerStaff),
    "detail",
  );

describe("POST /draft-orders/:draftId/invoice-link (spec §4.7)", () => {
  it("issues a 30-day link at /c/<token>, marks the draft Invoice sent and lists the link", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const link = unwrap<InvoiceLink>(await send(world, draft.id), "send");
    expect(link.path).toMatch(/^\/c\/[A-Za-z0-9_-]{43}$/);
    expect(link.url).toBeNull(); // no verified domain in the harness → admin-web uses STOREFRONT_URL
    expect(Date.parse(link.expiresAt) - world.clock.now().getTime()).toBe(30 * 24 * 3_600_000);
    const after = await detail(world, draft.id);
    expect(after.status).toBe("invoice_sent");
    expect(after.links).toHaveLength(1);
    const again = unwrap<InvoiceLink>(await send(world, draft.id), "send again");
    expect(again.path).not.toBe(link.path);
    expect((await preview(world, tokenOf(link))).status).toBe(200);
  });

  it("is NOT idempotent: the response cache would keep the plaintext token (binding carry 2)", async () => {
    const world = await draftWorld();
    const route = world.routes.find(
      (r) => r.method === "POST" && r.path === "/draft-orders/:draftId/invoice-link",
    );
    expect(route).toBeDefined();
    expect(route?.idempotent).not.toBe(true);
  });

  it("refuses a draft that is not ready (422 with what is missing) and viewers (403)", async () => {
    const world = await draftWorld();
    const bare = await createDraft(world, { shipping: null });
    const refused = await send(world, bare.id);
    expect(refused.status).toBe(422);
    expect((refused.body as { fields: { field: string }[] }).fields.map((f) => f.field)).toEqual([
      "shipping",
    ]);
    expect((await send(world, bare.id, viewerStaff)).status).toBe(403);
  });
});

describe("the invoice landing page's API (spec §4.7, §3.5)", () => {
  it("previews 'Invoice #D1' with items and the total — no email, phone or address", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const token = tokenOf(unwrap<InvoiceLink>(await send(world, draft.id), "send"));
    const dto = unwrap<CheckoutLinkPreviewDto>(await preview(world, token), "preview");
    expect(dto).toMatchObject({
      purpose: "invoice",
      draftNumber: "D1",
      completed: false,
      itemCount: 3,
      currency: "EGP",
    });
    expect(dto.totalMinor).toBe(draft.totals.totalMinor);
    const text = JSON.stringify(dto);
    for (const secret of ["sara@example.com", "01001234567", "Nile", "Mona"])
      expect(text).not.toContain(secret);
  });

  it("the claim hands the draft's checkout to the opener; the last opener owns it", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const token = tokenOf(unwrap<InvoiceLink>(await send(world, draft.id), "send"));
    const first = unwrap<CheckoutLinkClaimDto>(await claim(world, token, "guest-a"), "claim a");
    expect(first.droppedItems).toBe(0);
    const mine = unwrap<PublicCheckoutSessionDto>(
      await sessionAs(world, first.checkoutSessionId, "guest-a"),
      "session",
    );
    expect(mine.draftInvoice).toEqual({ draftNumber: "D1" });
    expect(mine.totals?.grandTotalMinor).toBe(draft.totals.totalMinor);
    const second = unwrap<CheckoutLinkClaimDto>(await claim(world, token, "guest-b"), "claim b");
    expect(second.checkoutSessionId).toBe(first.checkoutSessionId); // reused: the draft did not change
    expect((await sessionAs(world, first.checkoutSessionId, "guest-a")).status).toBe(404);
    expect((await sessionAs(world, first.checkoutSessionId, "guest-b")).status).toBe(200);
  });

  it("an edit expires the open invoice checkout; the link re-opens at the new total (Review Focus 1)", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const token = tokenOf(unwrap<InvoiceLink>(await send(world, draft.id), "send"));
    const before = unwrap<CheckoutLinkClaimDto>(await claim(world, token, "guest-a"), "claim");
    const edited = unwrap<DraftOrderDto>(
      await world.staffCall(
        "PUT",
        "/draft-orders/:draftId",
        {
          params: { draftId: draft.id },
          body: { ...draftBody(world, { discount: null }), version: draft.version },
        },
        operatorStaff,
      ),
      "edit",
    );
    const stale = await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/complete", {
      params: { checkoutSessionId: before.checkoutSessionId },
      body: { sessionRef: "guest-a", idempotencyKey: "k-stale" },
    });
    expect(stale.status).not.toBe(200);
    const after = unwrap<CheckoutLinkClaimDto>(await claim(world, token, "guest-a"), "claim again");
    expect(after.checkoutSessionId).not.toBe(before.checkoutSessionId);
    const session = unwrap<PublicCheckoutSessionDto>(
      await sessionAs(world, after.checkoutSessionId, "guest-a"),
      "session",
    );
    expect(session.totals?.grandTotalMinor).toBe(edited.totals.totalMinor);
  });

  it("paying through the link completes the draft; reopening says it was already placed", async () => {
    const world = await draftWorld();
    await enableCashOnDelivery(world);
    const draft = await createDraft(world);
    const token = tokenOf(unwrap<InvoiceLink>(await send(world, draft.id), "send"));
    const claimed = unwrap<CheckoutLinkClaimDto>(await claim(world, token, "guest-a"), "claim");
    const orderRef = await completeCheckout(world, claimed.checkoutSessionId, "guest-a");
    const completed = await detail(world, draft.id);
    expect(completed.status).toBe("completed");
    expect(completed.order?.id).toBe(orderRef);
    const again = await claim(world, token, "guest-a");
    expect(again.status).toBe(409);
    expect((again.body as { code: string }).code).toBe("ALREADY_COMPLETED");
    expect(unwrap<CheckoutLinkPreviewDto>(await preview(world, token), "preview").completed).toBe(
      true,
    );
  });

  it("a deleted draft's (revoked) link answers the SAME 404 LINK_INVALID as an unknown token (binding carry 3)", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const token = tokenOf(unwrap<InvoiceLink>(await send(world, draft.id), "send"));
    const unknown = await claim(world, "x".repeat(43), "guest-a");
    expect(
      (
        await world.staffCall(
          "DELETE",
          "/draft-orders/:draftId",
          { params: { draftId: draft.id } },
          operatorStaff,
        )
      ).status,
    ).toBe(200);
    for (const reply of [await claim(world, token, "guest-a"), await preview(world, token)]) {
      expect(reply.status).toBe(404);
      expect(reply.body).toEqual(unknown.body);
      expect((reply.body as { code: string }).code).toBe("LINK_INVALID");
    }
  });

  it("another shop's token is unknown", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const token = tokenOf(unwrap<InvoiceLink>(await send(world, draft.id), "send"));
    const other = await world.publicCall("POST", "/public/checkout-links/claim", {
      body: { token, sessionRef: "g" },
      tenantId: "shop-b",
    });
    expect(other.status).toBe(404);
  });
});
```

(Prettier-format.)

- [ ] **Step 2: Write the failing completion test**

`apps/admin/src/http/draft-order-complete.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PaymentIntentSummary } from "@platform/payments";
import { codCollectionState } from "./cod-collection";
import type { DraftOrderDto } from "./draft-order-dto";
import { unwrap } from "./testing/abandoned-harness";
import {
  createDraft,
  draftWorld,
  enableCashOnDelivery,
  type DraftWorld,
} from "./testing/draft-harness";
import { adminStaff, HARNESS_TENANT, operatorStaff, viewerStaff } from "./testing/orders-harness";
import type { Principal } from "@platform/contracts";
import type { Order } from "@platform/orders";

const complete = (
  world: DraftWorld,
  draftId: string,
  payment: "paid" | "collect_on_delivery",
  principal: Principal = operatorStaff,
) =>
  world.staffCall(
    "POST",
    "/draft-orders/:draftId/complete",
    { params: { draftId }, body: { payment } },
    principal,
  );
const orderOf = async (world: DraftWorld, orderId: string) =>
  unwrap<Order>(
    await world.admin.orders.getOrder(adminStaff, { tenantId: HARNESS_TENANT, orderId }),
    "order",
  );
const orderCount = async (world: DraftWorld) =>
  unwrap<{ items: unknown[] }>(
    await world.admin.orders.listOrders(adminStaff, { tenantId: HARNESS_TENANT, first: 50 }),
    "orders",
  ).items.length;

describe("POST /draft-orders/:draftId/complete (spec §4.6)", () => {
  it("collect on delivery needs cash on delivery enabled (Ruling 7) — nothing is created", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const refused = await complete(world, draft.id, "collect_on_delivery");
    expect(refused.status).toBe(409);
    expect((refused.body as { code: string }).code).toBe("COD_NOT_ENABLED");
    expect(await orderCount(world)).toBe(0);
  });

  it("collect on delivery creates #1001 with payment pending, the note, tags and a created_from_draft line", async () => {
    const world = await draftWorld();
    await enableCashOnDelivery(world);
    const draft = await createDraft(world);
    const done = unwrap<{ orderId: string; orderNumber: string }>(
      await complete(world, draft.id, "collect_on_delivery"),
      "complete",
    );
    expect(done.orderNumber).toBe("1001");
    const order = await orderOf(world, done.orderId);
    expect(order.status).toBe("payment_requested");
    const after = unwrap<DraftOrderDto>(
      await world.staffCall(
        "GET",
        "/draft-orders/:draftId",
        { params: { draftId: draft.id } },
        viewerStaff,
      ),
      "draft",
    );
    expect(after.status).toBe("completed");
    expect(after.order).toEqual({ id: done.orderId, orderNumber: "1001" });
    const annotations = unwrap<
      ReadonlyMap<string, { note: string | null; tags: readonly string[] }>
    >(
      await world.admin.orders.orderAnnotations(adminStaff, {
        tenantId: HARNESS_TENANT,
        orderIds: [done.orderId],
      }),
      "annotations",
    );
    expect(annotations.get(done.orderId)).toMatchObject({
      note: "Deliver after 5 pm",
      tags: ["WhatsApp"],
    });
    const timeline = unwrap<{
      entries: { kind: string; data: { draftNumber?: string; draftId?: string } }[];
    }>(
      await world.admin.orders.orderTimeline(adminStaff, {
        tenantId: HARNESS_TENANT,
        orderId: done.orderId,
      }),
      "timeline",
    );
    expect(timeline.entries.map((e) => [e.kind, e.data])).toContainEqual([
      "created_from_draft",
      { draftNumber: "D1", draftId: draft.id },
    ]);
  });

  it("Mark as paid is admin-only; it records a captured manual payment that is never cash to collect (binding carry 4)", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    expect((await complete(world, draft.id, "paid", operatorStaff)).status).toBe(403);
    const done = unwrap<{ orderId: string }>(
      await complete(world, draft.id, "paid", adminStaff),
      "paid",
    );
    const order = await orderOf(world, done.orderId);
    const paymentRef = order.paymentRef ?? "";
    const [summary] = unwrap<readonly PaymentIntentSummary[]>(
      await world.admin.orders.paymentIntentsOf(adminStaff, {
        tenantId: HARNESS_TENANT,
        paymentIntentIds: [paymentRef],
      }),
      "intents",
    );
    expect(summary).toMatchObject({
      provider: "manual",
      status: "captured",
      collectedOnDelivery: false,
    });
    expect(codCollectionState(order, summary)).toEqual({
      printAmount: false,
      canMarkCollected: false,
    });
    // In production PaymentCapturedConsumer makes this call on the captured event (no consumer runs here).
    const paid = await world.admin.orders.markOrderPaid(adminStaff, {
      tenantId: HARNESS_TENANT,
      orderId: done.orderId,
      paymentRef,
    });
    expect(paid.status).toBe(200);
    expect((await orderOf(world, done.orderId)).status).toBe("payment_received");
  });

  it("a retry after the order exists resumes, never a second order (Review Focus 2, Ruling 6)", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const first = unwrap<{ orderId: string }>(
      await complete(world, draft.id, "paid", adminStaff),
      "first",
    );
    const retry = unwrap<{ orderId: string }>(
      await complete(world, draft.id, "paid", adminStaff),
      "retry",
    );
    expect(retry.orderId).toBe(first.orderId);
    expect(await orderCount(world)).toBe(1);
    const other = await complete(world, draft.id, "collect_on_delivery", adminStaff);
    expect(other.status).toBe(409);
    expect((other.body as { code: string }).code).toBe("ALREADY_COMPLETED");
  });

  it("a guest draft without an email cannot be completed directly (spec §4.5)", async () => {
    const world = await draftWorld();
    await enableCashOnDelivery(world);
    const draft = await createDraft(world, { email: null });
    const refused = await complete(world, draft.id, "collect_on_delivery");
    expect(refused.status).toBe(422);
    expect((refused.body as { fields: { field: string }[] }).fields.map((f) => f.field)).toEqual([
      "email",
    ]);
  });

  it("not enough stock answers OUT_OF_STOCK and leaves no order (Review Focus 3)", async () => {
    const world = await draftWorld();
    await enableCashOnDelivery(world);
    const draft = await createDraft(world, {
      lines: [{ productId: world.tee.productId, variantId: world.tee.variantId, quantity: 150 }],
    });
    const refused = await complete(world, draft.id, "collect_on_delivery");
    expect(refused.status).toBe(409);
    expect((refused.body as { code: string }).code).toBe("OUT_OF_STOCK");
    expect(await orderCount(world)).toBe(0);
    const after = unwrap<DraftOrderDto>(
      await world.staffCall(
        "GET",
        "/draft-orders/:draftId",
        { params: { draftId: draft.id } },
        viewerStaff,
      ),
      "draft",
    );
    expect(after.status).toBe("open");
  });

  it("the merchant's completion expires a customer's open invoice checkout first (spec Concurrency)", async () => {
    const world = await draftWorld();
    await enableCashOnDelivery(world);
    const draft = await createDraft(world);
    const link = unwrap<{ path: string }>(
      await world.staffCall(
        "POST",
        "/draft-orders/:draftId/invoice-link",
        { params: { draftId: draft.id } },
        operatorStaff,
      ),
      "send",
    );
    const claimed = unwrap<{ checkoutSessionId: string }>(
      await world.publicCall("POST", "/public/checkout-links/claim", {
        body: { token: link.path.slice(3), sessionRef: "guest-a" },
      }),
      "claim",
    );
    unwrap(await complete(world, draft.id, "collect_on_delivery"), "merchant completes");
    const customer = await world.publicCall(
      "POST",
      "/public/checkouts/:checkoutSessionId/complete",
      {
        params: { checkoutSessionId: claimed.checkoutSessionId },
        body: { sessionRef: "guest-a", idempotencyKey: "k-customer" },
      },
    );
    expect(customer.status).not.toBe(200);
    expect(await orderCount(world)).toBe(1);
  });

  it("viewers are refused", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    expect((await complete(world, draft.id, "collect_on_delivery", viewerStaff)).status).toBe(403);
  });
});
```

(Use the exact `OrdersAdminController` method names — `getOrder`, `listOrders`, `orderAnnotations`, `orderTimeline`, `paymentIntentsOf`, `markOrderPaid` exist today — and their input shapes from `orders.admin-controller.ts`. Run Prettier.)

Run both: `pnpm --filter @platform/admin exec vitest run src/http/draft-order-invoice.test.ts src/http/draft-order-complete.test.ts`
Expected: FAIL — routes not found.

- [ ] **Step 3: Materialisation and self-heal**

`apps/admin/src/http/draft-order-checkout.ts`:

```ts
import type { CheckoutSession } from "@platform/checkout";
import {
  DEFAULT_DRAFT_DISCOUNT_TITLE,
  draftAmounts,
  draftRequirements,
  type DraftOrder,
} from "@platform/orders";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import {
  checkoutAddressOf,
  draftConflict,
  draftItemsOf,
  invalidResponse,
} from "./draft-order-pricing";

type Materialised =
  | { readonly ok: true; readonly checkoutSessionId: string }
  | { readonly ok: false; readonly response: AdminResponse };

async function sessionOf(
  admin: Pick<WiredAdmin, "publicReads">,
  tenantId: string,
  checkoutSessionId: string,
): Promise<CheckoutSession | null> {
  const response = await admin.publicReads.checkout.get({ tenantId, checkoutSessionId });
  return response.status === 200 ? (response.body as CheckoutSession) : null;
}

/**
 * Spec §4.6 decision / Ruling 10: a draft whose current checkout already became an order is completed
 * (the best-effort report may have failed). Idempotent; answers the draft as it now is.
 */
export async function healedDraft(
  admin: Pick<WiredAdmin, "publicReads">,
  tenantId: string,
  draft: DraftOrder,
): Promise<DraftOrder> {
  if (draft.status === "completed" || draft.checkoutRef === null) return draft;
  const session = await sessionOf(admin, tenantId, draft.checkoutRef);
  if (session === null || session.orderRef === null) return draft;
  await admin.publicReads.draftOrders.completeDraftFromCheckout({
    tenantId,
    draftId: draft.id,
    orderRef: session.orderRef,
  });
  const reread = await admin.publicReads.draftOrders.getDraftOrder({ tenantId, draftId: draft.id });
  return reread.status === 200 ? (reread.body as DraftOrder) : draft;
}

/**
 * Spec §4.5: the draft's checkout session. Reused when it is still open and was built from this very
 * version (unless `fresh` — the merchant's completion, Ruling 5); otherwise the old one is expired and
 * a new one built from the draft's STORED prices (Ruling 12), then recorded with compare-and-set
 * (Ruling 3). A lost race expires what it built and answers 409 DRAFT_BUSY.
 */
export async function materializeDraftCheckout(
  admin: Pick<WiredAdmin, "publicReads">,
  tenantId: string,
  draft: DraftOrder,
  options: { readonly fresh: boolean },
): Promise<Materialised> {
  const missing = draftRequirements(draft.content(), "invoice");
  const shippingAddress = draft.shippingAddress;
  const shipping = draft.shipping;
  if (missing.length > 0 || shippingAddress === null || shipping === null) {
    return {
      ok: false,
      response: invalidResponse(
        "This draft order is not ready",
        missing.map((field) => ({ field, message: "required" })),
      ),
    };
  }
  if (!options.fresh && draft.checkoutRef !== null && draft.checkoutVersion === draft.version) {
    const current = await sessionOf(admin, tenantId, draft.checkoutRef);
    if (current !== null && current.state.isOpen) {
      return { ok: true, checkoutSessionId: draft.checkoutRef };
    }
  }
  const amounts = draftAmounts(draft);
  const started = await admin.publicReads.checkout.startDraft({
    tenantId,
    draftOrderRef: draft.id,
    draftNumber: draft.draftNumber,
    ...(draft.customerRef === null ? {} : { customerRef: draft.customerRef }),
    currency: draft.currency,
    items: draftItemsOf(draft.lines, draft.currency),
    ...(draft.contactEmail === null ? {} : { contactEmail: draft.contactEmail }),
    shippingAddress: checkoutAddressOf(shippingAddress),
    billingAddress: checkoutAddressOf(draft.billingAddress ?? shippingAddress),
    ...(amounts.discountMinor === 0
      ? {}
      : {
          discount: {
            title: draft.discount?.reason ?? DEFAULT_DRAFT_DISCOUNT_TITLE,
            amountMinor: amounts.discountMinor,
          },
        }),
    shipping: { title: shipping.title, amountMinor: amounts.shippingMinor },
    ...(draft.checkoutRef === null ? {} : { replaces: draft.checkoutRef }),
  });
  if (started.status !== 201) return { ok: false, response: started };
  const { checkoutSessionId } = started.body as { readonly checkoutSessionId: string };
  const recorded = await admin.publicReads.draftOrders.setDraftCheckout({
    tenantId,
    draftId: draft.id,
    checkoutRef: checkoutSessionId,
    checkoutVersion: draft.version,
    expectedCheckoutRef: draft.checkoutRef,
  });
  const applied =
    recorded.status === 200 && (recorded.body as { readonly applied: boolean }).applied;
  if (!applied) {
    await admin.publicReads.checkout.expire({ tenantId, checkoutSessionId });
    return {
      ok: false,
      response: draftConflict("DRAFT_BUSY", "this draft order changed meanwhile; try again"),
    };
  }
  return { ok: true, checkoutSessionId };
}
```

- [ ] **Step 4: The two staff routes (and the healing detail)**

In `apps/admin/src/http/draft-order-routes.ts`:

1. `GET /draft-orders/:draftId`: after the guarded `get`, `const draft = await healedDraft(admin, context.tenantId, response.body as DraftOrder);` and build the detail from it.
2. Add the imports (`healedDraft`, `materializeDraftCheckout`, `draftConflict`, `primaryHostnameOf`, `shopLinkUrl`, `shopNameOf`, `type IssueInvoiceLinkOutput`, `type CheckoutSession`, `type PaymentIntent` from `@platform/payments`) and append to the route list:

```ts
    defineRoute({
      method: "POST",
      path: "/draft-orders/:draftId/invoice-link",
      version: 1,
      permission: "orders:draft",
      // NOT idempotent (binding carry 2): every call mints a new token, and the idempotency response
      // cache would otherwise keep the plaintext token — stored nowhere else — for 24 hours. The server
      // logs the route PATTERN only, never the URL or the body, so the token never reaches a log.
      summary: "Send invoice: a new 30-day payment link for a draft order (the token is shown once)",
      schema: { params: draftIdParams },
      handle: async ({ params, context }) => {
        const denied = await admin.draftOrders.authorizeDraft(context.principal);
        if (denied !== null) return denied;
        const found = await admin.draftOrders.get(context.principal, { tenantId: context.tenantId, draftId: params.draftId });
        if (found.status !== 200) return found;
        const draft = await healedDraft(admin, context.tenantId, found.body as DraftOrder);
        if (draft.status === "completed") return draftConflict("DRAFT_COMPLETED", "this draft order is already an order");
        const built = await materializeDraftCheckout(admin, context.tenantId, draft, { fresh: false });
        if (!built.ok) return built.response;
        const marked = await admin.draftOrders.markInvoiceSent(context.principal, { tenantId: context.tenantId, draftId: draft.id });
        if (marked.status !== 200) return withConflictCode(marked);
        const issued = await admin.publicReads.checkout.issueInvoiceLink({
          tenantId: context.tenantId,
          draftOrderRef: draft.id,
          createdBy: context.principal.id,
        });
        if (issued.status !== 201) return issued;
        const { token, expiresAt } = issued.body as IssueInvoiceLinkOutput;
        const path = `/c/${token}`;
        const hostname = primaryHostnameOf(await admin.shopDomains(context.tenantId));
        return {
          status: 201,
          body: { url: shopLinkUrl(hostname, path), path, expiresAt, shopName: await shopNameOf(admin) },
        };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/draft-orders/:draftId/complete",
      version: 1,
      permission: "orders:complete_draft",
      idempotent: true,
      summary: "Create the order from a draft: Mark as paid (manual payment) or Collect on delivery (COD)",
      schema: {
        params: draftIdParams,
        body: z.object({ payment: z.enum(["paid", "collect_on_delivery"]) }).strict(),
      },
      handle: async ({ params, body, context }) => {
        const { tenantId, principal } = context;
        const denied = await admin.draftOrders.authorizeCompletion(principal, body.payment);
        if (denied !== null) return denied;
        const found = await admin.draftOrders.get(principal, { tenantId, draftId: params.draftId });
        if (found.status !== 200) return found;
        const draft = await healedDraft(admin, tenantId, found.body as DraftOrder);
        const provider = body.payment === "paid" ? "manual" : "cod";

        if (draft.status === "completed") {
          // Ruling 6: resume the payment steps when the order was made with the method asked for.
          const session =
            draft.checkoutRef === null
              ? null
              : await admin.publicReads.checkout.get({ tenantId, checkoutSessionId: draft.checkoutRef });
          const placed = session?.status === 200 ? (session.body as CheckoutSession) : null;
          if (placed === null || placed.orderRef === null || placed.paymentSelection?.provider !== provider) {
            return draftConflict("ALREADY_COMPLETED", "this draft order is already an order");
          }
          return finishPayment(admin, principal, tenantId, placed.id.toString(), placed.orderRef, body.payment);
        }

        const missing = draftRequirements(draft.content(), "complete");
        if (missing.length > 0) {
          return invalidResponse("This draft order is not ready", missing.map((field) => ({ field, message: "required" })));
        }
        if (body.payment === "collect_on_delivery") {
          const offered = await admin.publicReads.checkout.listPaymentMethods({ tenantId });
          const methods = offered.status === 200 ? (offered.body as { methods: readonly string[] }).methods : [];
          if (!methods.includes("cod")) {
            return draftConflict("COD_NOT_ENABLED", "turn on cash on delivery in Settings → Payments");
          }
        }
        // Ruling 5: always a fresh session — any open invoice checkout is expired first.
        const built = await materializeDraftCheckout(admin, tenantId, draft, { fresh: true });
        if (!built.ok) return built.response;
        const selected = await admin.publicReads.checkout.selectDraftPayment({ tenantId, checkoutSessionId: built.checkoutSessionId, provider });
        if (selected.status !== 200) return selected;
        const completed = await admin.publicReads.checkout.complete({
          tenantId,
          checkoutSessionId: built.checkoutSessionId,
          idempotencyKey: `draft:${draft.id}:${draft.version}`,
          actorRef: principal.id,
        });
        if (completed.status !== 200) return withConflictCode(completed);
        const { orderRef } = completed.body as { readonly orderRef: string };
        // Explicit and idempotent: the port inside CompleteCheckout is best effort.
        await admin.publicReads.draftOrders.completeDraftFromCheckout({ tenantId, draftId: draft.id, orderRef, actorRef: principal.id });
        return finishPayment(admin, principal, tenantId, built.checkoutSessionId, orderRef, body.payment);
      },
    }),
```

and the helper (module level):

```ts
/**
 * Spec §4.6 steps 3–4, both idempotent: open the payment (order → payment_requested), and for "paid"
 * settle the `manual` intent through the confirmed collection with the intent's OWN amount (never a
 * client figure). A failure answers 409 PAYMENT_NOT_RECORDED; the same request resumes (Ruling 6).
 */
async function finishPayment(
  admin: WiredAdmin,
  principal: Principal,
  tenantId: string,
  checkoutSessionId: string,
  orderRef: string,
  payment: "paid" | "collect_on_delivery",
): Promise<AdminResponse> {
  const initiated = await admin.publicReads.checkout.initiatePayment({
    tenantId,
    checkoutSessionId,
  });
  if (initiated.status < 200 || initiated.status >= 300) {
    return draftConflict(
      "PAYMENT_NOT_RECORDED",
      "the order exists but its payment could not be opened; try again",
    );
  }
  const { paymentIntentId } = initiated.body as { readonly paymentIntentId: string };
  if (payment === "paid") {
    const read = await admin.payments.getPaymentIntent(principal, { tenantId, paymentIntentId });
    if (read.status !== 200)
      return draftConflict("PAYMENT_NOT_RECORDED", "the payment could not be read; try again");
    const intent = read.body as PaymentIntent;
    if (intent.status.value !== "captured") {
      const settled = await admin.payments.confirmCodCollection(principal, {
        tenantId,
        paymentIntentId,
        collectedAmountMinor: intent.amount.amountMinor,
        currency: intent.amount.currency,
      });
      if (settled.status !== 200) {
        return draftConflict(
          "PAYMENT_NOT_RECORDED",
          "the order exists but the payment was not recorded; try again",
        );
      }
    }
  }
  const order = await admin.orders.getOrder(principal, { tenantId, orderId: orderRef });
  const orderNumber = order.status === 200 ? (order.body as Order).orderNumber.value : null;
  return { status: 200, body: { orderId: orderRef, orderNumber } };
}
```

(`PaymentIntent` is exported by `@platform/payments`; if it is not, read the fields through a local `interface IntentView { status: { value: string }; amount: { amountMinor: number; currency: string } }`. Prettier-format.)

- [ ] **Step 5: The invoice branch of the public link routes**

In `apps/admin/src/http/public-checkout-link-routes.ts`:

- `CheckoutLinkPreviewDto` becomes:

```ts
export interface CheckoutLinkPreviewDto {
  readonly purpose: "recovery" | "invoice";
  /** "D3" for an invoice ("Invoice #D3 from <shop>"); null for a recovery link. */
  readonly draftNumber: string | null;
  /** Invoice only: the order was already placed (Ruling 23); always false for recovery. */
  readonly completed: boolean;
  readonly shopName: string;
  readonly itemCount: number;
  readonly items: readonly {
    readonly title: string | null;
    readonly variantTitle: string | null;
    readonly quantity: number;
    readonly imageUrl: string | null;
  }[];
  /** Recovery: the lines at the prices they were left at. Invoice: the draft's total with estimated tax. */
  readonly totalMinor: number;
  readonly currency: string;
}
```

and the recovery preview sets `draftNumber: null, completed: false`.

- Replace Task 4's temporary `resolveRecovery` with a `purpose` switch in both handlers: `if (resolved.purpose === "invoice") return claimInvoice(admin, tenantId, resolved, body.sessionRef);` / `return previewInvoice(admin, context.tenantId, resolved);`.
- Add:

```ts
function invoiceConflict(
  code: "ALREADY_COMPLETED" | "DRAFT_NOT_READY",
  message: string,
): AdminResponse {
  return {
    status: 409,
    body: { ...toErrorEnvelope(new BusinessRuleError(`${code}: ${message}`)), code },
  };
}

/** The draft an invoice link is for — or null (deleted/unknown → the uniform 404), healed first. */
async function invoiceDraftOf(
  admin: WiredAdmin,
  tenantId: string,
  draftOrderRef: string,
): Promise<DraftOrder | null> {
  const found = await admin.publicReads.draftOrders.getDraftOrder({
    tenantId,
    draftId: draftOrderRef,
  });
  return found.status === 200 ? healedDraft(admin, tenantId, found.body as DraftOrder) : null;
}

/**
 * Spec §4.7 claim, invoice branch: deleted → 404; completed → 409 ALREADY_COMPLETED; otherwise
 * materialise from the LATEST draft (reused when unchanged) and hand that session to the caller's own
 * `sessionRef` — the last opener owns it. The server-minted owner is never exposed.
 */
async function claimInvoice(
  admin: WiredAdmin,
  tenantId: string,
  resolved: Extract<ResolveCheckoutLinkOutput, { purpose: "invoice" }>,
  sessionRef: string,
): Promise<AdminResponse> {
  const draft = await invoiceDraftOf(admin, tenantId, resolved.draftOrderRef);
  if (draft === null) return linkInvalidResponse();
  if (draft.status === "completed")
    return invoiceConflict("ALREADY_COMPLETED", "this order has already been placed");
  const built = await materializeDraftCheckout(admin, tenantId, draft, { fresh: false });
  if (!built.ok) {
    // The shopper never sees the draft's field names.
    return built.response.status === 422
      ? invoiceConflict("DRAFT_NOT_READY", "this invoice cannot be paid right now")
      : built.response;
  }
  const claimed = await admin.publicReads.checkout.claimInvoice({
    tenantId,
    linkId: resolved.link.id,
    checkoutSessionId: built.checkoutSessionId,
    sessionRef,
  });
  if (claimed.status === 404) return linkInvalidResponse();
  if (claimed.status !== 200) return withConflictCode(claimed);
  const dto: CheckoutLinkClaimDto = { checkoutSessionId: built.checkoutSessionId, droppedItems: 0 };
  return { status: 200, body: dto };
}

/** Spec §4.7 preview: "Invoice #D3 from <shop>", items and the total — no email, phone or address; no write. */
async function previewInvoice(
  admin: WiredAdmin,
  tenantId: string,
  resolved: Extract<ResolveCheckoutLinkOutput, { purpose: "invoice" }>,
): Promise<AdminResponse> {
  const draft = await invoiceDraftOf(admin, tenantId, resolved.draftOrderRef);
  if (draft === null) return linkInvalidResponse();
  const images = await resolveLineImages(
    admin,
    tenantId,
    draft.lines.map((l) => ({ productId: l.productRef, variantId: l.variantRef })),
  );
  const totals = draftTotalsOf(draft, await estimatedTaxOf(admin, tenantId, draft));
  const dto: CheckoutLinkPreviewDto = {
    purpose: "invoice",
    draftNumber: draft.draftNumber,
    completed: draft.status === "completed",
    shopName: await shopNameOf(admin),
    itemCount: draft.lines.reduce((count, line) => count + line.quantity, 0),
    items: draft.lines.map((line) => ({
      title: line.title,
      variantTitle: line.variantTitle,
      quantity: line.quantity,
      imageUrl: images.get(lineKey(line.productRef, line.variantRef))?.url ?? null,
    })),
    totalMinor: totals.totalMinor,
    currency: draft.currency,
  };
  return { status: 200, body: dto };
}
```

(Imports: `type DraftOrder` from `@platform/orders`; `healedDraft`, `materializeDraftCheckout` from `./draft-order-checkout`; `draftTotalsOf` from `./draft-order-dto`; `estimatedTaxOf`, `withConflictCode` from `./draft-order-pricing`. Prettier-format.)

- [ ] **Step 6: The order timeline line carries the draft id**

`apps/admin/src/http/order-timeline-dto.ts`, `TimelineEntryDto.data`: add `readonly draftId?: string;` (the mapper already copies `entry.data`).

- [ ] **Step 7: Run the tests and gates**

Run: `pnpm --filter @platform/admin exec vitest run src/http/draft-order-invoice.test.ts src/http/draft-order-complete.test.ts src/http/draft-order-routes.test.ts src/http/public-checkout-link-routes.test.ts` → PASS.
Run: `pnpm --filter @platform/admin test`, `pnpm --filter @platform/admin typecheck`, `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint` → green.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/http/draft-order-checkout.ts apps/admin/src/http/draft-order-routes.ts \
  apps/admin/src/http/public-checkout-link-routes.ts apps/admin/src/http/order-timeline-dto.ts \
  apps/admin/src/http/draft-order-invoice.test.ts apps/admin/src/http/draft-order-complete.test.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin): send invoice, collect payment and the invoice link claim

A draft becomes a checkout session (reused while unchanged, rebuilt after edits) and then an
order through CompleteCheckout. Send invoice mints a 30-day link (never cached); Collect on
delivery needs COD enabled; Mark as paid records a captured manual payment. Completion is
resumable. The invoice claim hands the session to the opener; a completed draft says so.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: admin-web — Orders → Drafts navigation, the role gate, the API client, the Drafts list and the `/orders/new` redirect

Model tier: **standard**.

**Files:**

- Modify: `apps/admin-web/src/middleware.ts`, `apps/admin-web/src/middleware.test.ts` (append cases)
- Modify: `apps/admin-web/src/components/navigation.ts`, `apps/admin-web/src/components/navigation.test.tsx` (append a case)
- Create: `apps/admin-web/src/lib/api/draft-orders.ts`
- Create: `apps/admin-web/src/lib/orders/draft-orders.ts`, `apps/admin-web/src/lib/orders/draft-orders.test.ts`
- Create: `apps/admin-web/src/app/draft-orders/page.tsx`
- Create: `apps/admin-web/src/components/draft-orders/draft-orders-tabs.tsx`, `draft-orders-table.tsx`, `draft-orders-table.test.tsx`
- Modify: `apps/admin-web/src/app/orders/new/page.tsx` (redirect), `apps/admin-web/src/app/orders/page.tsx` (Create order → `/draft-orders/new`), `apps/admin-web/src/components/create-menu.tsx`
- Delete: `apps/admin-web/src/components/orders/order-create-form.tsx`, `order-create-form.test.tsx`; remove `placeOrderAction` (and its cases in `app/orders/actions.test.ts`) from `apps/admin-web/src/app/orders/actions.ts`
- Modify: `apps/admin-web/src/lib/api/orders.ts` (`TimelineEntryDto.data.draftId`), `apps/admin-web/src/lib/orders/order-timeline.ts` (`activityHref`), its test, `apps/admin-web/src/components/orders/order-timeline.tsx` (link)
- Modify: `apps/admin-web/src/messages/en.ts`, `apps/admin-web/src/messages/ar.ts`

**Interfaces:**

- Consumes: Task 6/7 routes and DTOs (mirrored as types; admin-web never imports backend code).
- Produces:
  - `lib/api/draft-orders.ts` (server-only): types `DraftOrderStatus`, `DraftRequirement`, `DraftAddressDto`, `DraftLineDto`, `DraftTotalsDto`, `DraftOrderDto`, `DraftOrderListItemDto`, `DraftOrdersPageDto`, `DraftAddressInput`, `DraftOrderInput`, `DraftShippingRateDto`, `InvoiceLinkDto`, `DraftPayment = "paid" | "collect_on_delivery"`; calls `fetchDraftOrders(query)`, `fetchDraftOrder(id)`, `createDraftOrder(input, key)`, `updateDraftOrder(id, input & { version }, key)`, `deleteDraftOrder(id, key)`, `fetchDraftShippingRates(id)`, `issueDraftInvoiceLink(id)` (NO idempotency key), `completeDraftOrder(id, payment, key)`.
  - `lib/orders/draft-orders.ts`: `DRAFT_PAGE_SIZE = 50`, `DRAFT_STATUSES`, `parseDraftStatus(raw)`, `draftsHref({ status, q })`, `canEditDrafts(role)`, `canMarkDraftPaid(role)`, `conflictCodeOf(message)`.
  - `t.nav.drafts`, `t.draftOrders.*` (list keys; Task 9 adds `t.draftOrders.editor`).
  - `activityHref(entry): string | null` in `lib/orders/order-timeline.ts`.

- [ ] **Step 1: Write the failing role-gate, navigation and helper tests**

Append to `apps/admin-web/src/middleware.test.ts`, inside `describe("middleware role table for the orders screens")`:

```ts
it("lets a viewer open drafts and a draft, but not the new-draft screen (orders Part 4)", async () => {
  jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
  for (const path of ["/draft-orders", "/draft-orders/2f6f1c52-5c3a-4a53-8c0a-3f4f3d7a0c11"]) {
    const response = await middleware(requestFor(path, "good.token"));
    expect(response.headers.get("location"), path).toBeNull();
  }
  const denied = await middleware(requestFor("/draft-orders/new", "good.token"));
  expect(denied.headers.get("location")).toContain("/forbidden");
});

it("lets an operator create a draft", async () => {
  jwtVerifyMock.mockResolvedValue({ payload: { roles: ["operator"] } });
  const response = await middleware(requestFor("/draft-orders/new", "good.token"));
  expect(response.headers.get("location")).toBeNull();
});
```

(The existing "never sends an operator to /forbidden from a sidebar link" case fails as soon as the Drafts nav item exists without these entries — binding carry 5.)

Append to `apps/admin-web/src/components/navigation.test.tsx`:

```ts
describe("Orders children (Shopify order)", () => {
  it("lists Drafts, then Abandoned checkouts", () => {
    const orders = PRIMARY_NAV.find((item) => item.id === "orders");
    expect(orders?.children?.map((child) => child.href)).toEqual([
      "/draft-orders",
      "/abandoned-checkouts",
    ]);
  });
});
```

(import `PRIMARY_NAV` from `./navigation` if the file does not already.)

`apps/admin-web/src/lib/orders/draft-orders.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  canEditDrafts,
  canMarkDraftPaid,
  conflictCodeOf,
  draftsHref,
  parseDraftStatus,
} from "./draft-orders";

describe("draft list helpers", () => {
  it("parses only known statuses", () => {
    expect(parseDraftStatus("invoice_sent")).toBe("invoice_sent");
    expect(parseDraftStatus("archived")).toBeUndefined();
    expect(parseDraftStatus(undefined)).toBeUndefined();
  });

  it("builds tab hrefs that keep the search and drop the cursor", () => {
    expect(draftsHref({ status: undefined, q: undefined })).toBe("/draft-orders");
    expect(draftsHref({ status: "open", q: "#D3" })).toBe("/draft-orders?status=open&q=%23D3");
  });

  it("operators and admins edit; only admins mark paid", () => {
    expect([canEditDrafts("viewer"), canEditDrafts("operator"), canEditDrafts("admin")]).toEqual([
      false,
      true,
      true,
    ]);
    expect([canMarkDraftPaid("operator"), canMarkDraftPaid("admin")]).toEqual([false, true]);
    expect(canEditDrafts(undefined)).toBe(false);
  });

  it("reads the CODE: prefix of a 409 message (Ruling 19)", () => {
    expect(conflictCodeOf("OUT_OF_STOCK: insufficient stock")).toBe("OUT_OF_STOCK");
    expect(conflictCodeOf("Conflict")).toBeNull();
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/middleware.test.ts src/components/navigation.test.tsx src/lib/orders/draft-orders.test.ts`
Expected: FAIL (the middleware case passes for viewers on `/draft-orders` only after the entries exist; the helpers module is missing).

- [ ] **Step 2: Role gate, navigation and helpers**

`apps/admin-web/src/middleware.ts`, `ROUTE_ROLE_REQUIREMENTS`, after the `/abandoned-checkouts` line:

```ts
  // Drafts read like orders (`orders:read`); creating one is operator work. The API decides who may
  // send an invoice or collect payment (Mark as paid is admin-only).
  ["/draft-orders/new", "operator"],
  ["/draft-orders", "viewer"],
```

`apps/admin-web/src/components/navigation.ts`, the Orders `children`, BEFORE the abandoned item (import `FileTextIcon` from `lucide-react`):

```ts
      { id: "draft-orders", label: (t) => t.nav.drafts, href: "/draft-orders", Icon: FileTextIcon },
```

`apps/admin-web/src/lib/orders/draft-orders.ts`:

```ts
import type { DraftOrderStatus } from "@/lib/api/draft-orders";

/** Shopify's page size; the API's maximum too. */
export const DRAFT_PAGE_SIZE = 50;
export const DRAFT_STATUSES: readonly DraftOrderStatus[] = ["open", "invoice_sent", "completed"];

export function parseDraftStatus(raw: string | undefined): DraftOrderStatus | undefined {
  return DRAFT_STATUSES.find((status) => status === raw);
}

/** A tab's link: the search stays, the cursor goes (a new tab starts on page one). */
export function draftsHref(state: {
  readonly status: DraftOrderStatus | undefined;
  readonly q: string | undefined;
}): string {
  const params = new URLSearchParams();
  if (state.status !== undefined) params.set("status", state.status);
  if (state.q !== undefined && state.q !== "") params.set("q", state.q);
  const query = params.toString();
  return query === "" ? "/draft-orders" : `/draft-orders?${query}`;
}

/** `orders:draft` / `orders:complete_draft` are operators' and admins' (the API decides; this only hides buttons). */
export function canEditDrafts(role: string | undefined): boolean {
  return role === "admin" || role === "operator";
}

/** "Mark as paid" also needs `payments:confirm_cod_collection` — admins only (spec Permissions). */
export function canMarkDraftPaid(role: string | undefined): boolean {
  return role === "admin";
}

/** Ruling 19: the API prefixes every draft 409 message with its code. */
export function conflictCodeOf(message: string): string | null {
  return /^([A-Z_]+):/.exec(message)?.[1] ?? null;
}
```

- [ ] **Step 3: The API client (server-only)**

`apps/admin-web/src/lib/api/draft-orders.ts`:

```ts
import { getAdminApi, mutateAdminApi, type ApiResult, type MutationResult } from "./client";

/** Order operations Part 4 — the wire shapes of `apps/admin`'s `draft-order-dto.ts`. */
export type DraftOrderStatus = "open" | "invoice_sent" | "completed";
export type DraftRequirement = "lines" | "shipping_address" | "shipping" | "email";
export type DraftPayment = "paid" | "collect_on_delivery";

export interface DraftAddressDto {
  readonly name: string | null;
  readonly phone: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly province: string | null;
  readonly postalCode: string;
  readonly country: string;
}

export interface DraftLineDto {
  readonly productId: string;
  readonly variantId: string;
  readonly sku: string;
  readonly title: string;
  readonly variantTitle: string | null;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly imageUrl: string | null;
}

export interface DraftTotalsDto {
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly shippingMinor: number;
  readonly taxMinor: number | null;
  readonly taxIncluded: boolean;
  readonly totalMinor: number;
}

export interface DraftOrderDto {
  readonly id: string;
  readonly draftNumber: string;
  readonly status: DraftOrderStatus;
  readonly version: number;
  readonly currency: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly invoiceSentAt: string | null;
  readonly completedAt: string | null;
  readonly customer: {
    readonly id: string;
    readonly name: string | null;
    readonly email: string | null;
  } | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly shippingAddress: DraftAddressDto | null;
  readonly billingAddress: DraftAddressDto | null;
  readonly lines: readonly DraftLineDto[];
  readonly discount: {
    readonly valueType: "fixed" | "percentage";
    readonly value: number;
    readonly reason: string | null;
    readonly amountMinor: number;
  } | null;
  readonly shipping: {
    readonly kind: "rate" | "custom" | "free";
    readonly method: string | null;
    readonly title: string;
    readonly amountMinor: number;
  } | null;
  readonly note: string | null;
  readonly tags: readonly string[];
  readonly totals: DraftTotalsDto;
  readonly order: { readonly id: string; readonly orderNumber: string | null } | null;
  readonly links: readonly {
    readonly issuedAt: string;
    readonly expiresAt: string;
    readonly claimCount: number;
    readonly lastClaimedAt: string | null;
  }[];
  readonly missing: {
    readonly invoice: readonly DraftRequirement[];
    readonly complete: readonly DraftRequirement[];
  };
}

export interface DraftOrderListItemDto {
  readonly id: string;
  readonly draftNumber: string;
  readonly createdAt: string;
  readonly customerName: string | null;
  readonly status: DraftOrderStatus;
  readonly totalMinor: number;
  readonly currency: string;
  readonly orderRef: string | null;
  readonly orderNumber: string | null;
}

export interface DraftOrdersPageDto {
  readonly items: readonly DraftOrderListItemDto[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
}

export interface DraftAddressInput {
  readonly name?: string;
  readonly phone?: string;
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly province?: string;
  readonly postalCode?: string;
  readonly country: string;
}

/** What the browser may send: ids, quantities and the merchant's own terms — never a line price. */
export interface DraftOrderInput {
  readonly customerId: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly shippingAddress: DraftAddressInput | null;
  readonly billingAddress: DraftAddressInput | null;
  readonly lines: readonly {
    readonly productId: string;
    readonly variantId?: string;
    readonly quantity: number;
  }[];
  readonly discount: {
    readonly valueType: "fixed" | "percentage";
    readonly value: number;
    readonly reason?: string;
  } | null;
  readonly shipping:
    | { readonly kind: "rate"; readonly method: string }
    | { readonly kind: "custom"; readonly title: string; readonly amountMinor: number }
    | { readonly kind: "free" }
    | null;
  readonly note: string | null;
  readonly tags: readonly string[];
}

export interface DraftShippingRateDto {
  readonly method: string;
  readonly title: string;
  readonly amountMinor: number;
}

export interface InvoiceLinkDto {
  readonly url: string | null;
  readonly path: string;
  readonly expiresAt: string;
  readonly shopName: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isPage = (value: unknown): value is DraftOrdersPageDto =>
  isObject(value) && Array.isArray(value["items"]) && isObject(value["pageInfo"]);
const isDraft = (value: unknown): value is DraftOrderDto =>
  isObject(value) &&
  typeof value["id"] === "string" &&
  typeof value["draftNumber"] === "string" &&
  Array.isArray(value["lines"]);
const isRates = (value: unknown): value is { readonly rates: readonly DraftShippingRateDto[] } =>
  isObject(value) && Array.isArray(value["rates"]);
const isInvoiceLink = (value: unknown): value is InvoiceLinkDto =>
  isObject(value) &&
  typeof value["path"] === "string" &&
  (value["url"] === null || typeof value["url"] === "string");
const isCompleted = (
  value: unknown,
): value is { readonly orderId: string; readonly orderNumber: string | null } =>
  isObject(value) && typeof value["orderId"] === "string";
const isDeleted = (value: unknown): value is { readonly draftId: string } =>
  isObject(value) && typeof value["draftId"] === "string";

const basePath = "/api/v1/draft-orders";
const draftPath = (id: string, suffix = "") => `${basePath}/${encodeURIComponent(id)}${suffix}`;

/** `GET /draft-orders` (`orders:read`). Server code only. */
export function fetchDraftOrders(query: {
  readonly status?: DraftOrderStatus;
  readonly q?: string;
  readonly first?: number;
  readonly after?: string;
}): Promise<ApiResult<DraftOrdersPageDto>> {
  const params = new URLSearchParams();
  if (query.status !== undefined) params.set("status", query.status);
  if (query.q !== undefined && query.q !== "") params.set("q", query.q);
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);
  const search = params.toString();
  return getAdminApi(search === "" ? basePath : `${basePath}?${search}`, isPage);
}

export function fetchDraftOrder(id: string): Promise<ApiResult<DraftOrderDto>> {
  return getAdminApi(draftPath(id), isDraft);
}

export function createDraftOrder(
  input: DraftOrderInput,
  idempotencyKey: string,
): Promise<MutationResult<DraftOrderDto>> {
  return mutateAdminApi(basePath, { method: "POST", body: input, idempotencyKey }, isDraft);
}

export function updateDraftOrder(
  id: string,
  input: DraftOrderInput & { readonly version: number },
  idempotencyKey: string,
): Promise<MutationResult<DraftOrderDto>> {
  return mutateAdminApi(draftPath(id), { method: "PUT", body: input, idempotencyKey }, isDraft);
}

export function deleteDraftOrder(
  id: string,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly draftId: string }>> {
  return mutateAdminApi(draftPath(id), { method: "DELETE", idempotencyKey }, isDeleted);
}

export function fetchDraftShippingRates(
  id: string,
): Promise<MutationResult<{ readonly rates: readonly DraftShippingRateDto[] }>> {
  return mutateAdminApi(draftPath(id, "/shipping-rates"), { method: "POST" }, isRates);
}

/**
 * `POST /draft-orders/:id/invoice-link` (`orders:draft`). NOT idempotent: every call mints a new token,
 * and the plaintext token must never be cached or replayed, so no `Idempotency-Key` is sent.
 */
export function issueDraftInvoiceLink(id: string): Promise<MutationResult<InvoiceLinkDto>> {
  return mutateAdminApi(draftPath(id, "/invoice-link"), { method: "POST" }, isInvoiceLink);
}

export function completeDraftOrder(
  id: string,
  payment: DraftPayment,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly orderId: string; readonly orderNumber: string | null }>> {
  return mutateAdminApi(
    draftPath(id, "/complete"),
    { method: "POST", body: { payment }, idempotencyKey },
    isCompleted,
  );
}
```

(The route-contract test executes every export and checks each path against the route table — the six paths exist since Tasks 6–7. Prettier-format.)

- [ ] **Step 4: Strings**

`apps/admin-web/src/messages/en.ts` — `nav`: add `drafts: "Drafts",` before `abandonedCheckouts`. Add a top-level section after `abandonedCheckouts`:

```ts
  /** Order operations Part 4 — Orders → Drafts (Shopify's wording). */
  draftOrders: {
    title: "Drafts",
    createOrder: "Create order",
    tabsLabel: "Draft order views",
    tabs: { all: "All", open: "Open", invoice_sent: "Invoice sent", completed: "Completed" },
    searchLabel: "Search draft orders",
    searchPlaceholder: "Search by draft number, name, email or phone",
    search: "Search",
    columns: { draft: "Draft order", date: "Date", customer: "Customer", status: "Status", total: "Total" },
    status: { open: "Open", invoice_sent: "Invoice sent", completed: "Completed" },
    noCustomer: "No customer",
    orderLink: "Order #{number}",
    empty: "No draft orders yet",
    emptyBody:
      "Create an order for a customer who reached you on WhatsApp or by phone, then send them a payment link or mark it as paid.",
    emptyFiltered: "No draft orders match your search",
    error: "Couldn't load draft orders. Try again.",
    unauthorized: "You don't have access to draft orders.",
  },
```

`apps/admin-web/src/messages/ar.ts` (Egyptian Arabic, binding carry 8) — `nav.drafts: "المسودات",` and:

```ts
  draftOrders: {
    title: "المسودات",
    createOrder: "إنشاء طلب",
    tabsLabel: "عرض المسودات",
    tabs: { all: "الكل", open: "مفتوحة", invoice_sent: "تم إرسال الفاتورة", completed: "مكتملة" },
    searchLabel: "دوّر في المسودات",
    searchPlaceholder: "دوّر برقم المسودة أو الاسم أو الإيميل أو التليفون",
    search: "دوّر",
    columns: { draft: "المسودة", date: "التاريخ", customer: "العميل", status: "الحالة", total: "الإجمالي" },
    status: { open: "مفتوحة", invoice_sent: "تم إرسال الفاتورة", completed: "مكتملة" },
    noCustomer: "من غير عميل",
    orderLink: "الطلب #{number}",
    empty: "لسه مفيش مسودات",
    emptyBody: "اعمل طلب لعميل كلّمك واتساب أو تليفون، وبعدين ابعتله لينك يدفع منه أو علّمه إنه اتدفع.",
    emptyFiltered: "مفيش مسودات مطابقة للبحث",
    error: "معرفناش نحمّل المسودات. جرّب تاني.",
    unauthorized: "مش مسموحلك تشوف المسودات.",
  },
```

- [ ] **Step 5: The list (tabs, search, table) — test first**

`apps/admin-web/src/components/draft-orders/draft-orders-table.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { DraftOrdersTable } from "./draft-orders-table";

const row = (over = {}) => ({
  id: "d-1",
  draftNumber: "D3",
  createdAt: "2026-10-25T10:00:00.000Z",
  customerName: "Mona Ali",
  status: "open" as const,
  totalMinor: 57100,
  currency: "EGP",
  orderRef: null,
  orderNumber: null,
  ...over,
});

describe("DraftOrdersTable", () => {
  it("shows #D3 linking to the draft, the customer, the status badge and the total", () => {
    render(<DraftOrdersTable drafts={[row()]} t={en} locale="en" />);
    expect(screen.getByRole("link", { name: "#D3" })).toHaveAttribute("href", "/draft-orders/d-1");
    expect(screen.getByText("Mona Ali")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("links a completed draft's order number", () => {
    render(
      <DraftOrdersTable
        drafts={[row({ status: "completed", orderRef: "o-1", orderNumber: "1001" })]}
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByRole("link", { name: "Order #1001" })).toHaveAttribute(
      "href",
      "/orders/o-1",
    );
  });

  it("says 'No customer' when none was given", () => {
    render(<DraftOrdersTable drafts={[row({ customerName: null })]} t={en} locale="en" />);
    expect(screen.getByText("No customer")).toBeInTheDocument();
  });
});
```

`apps/admin-web/src/components/draft-orders/draft-orders-table.tsx`:

```tsx
import Link from "next/link";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { DraftOrderListItemDto, DraftOrderStatus } from "@/lib/api/draft-orders";
import { formatCurrency, formatShortDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/** `@platform/ui` Badge variants (neutral, accent, success, warning, destructive, info, outline). */
export const DRAFT_BADGE: Record<DraftOrderStatus, "neutral" | "info" | "success"> = {
  open: "neutral",
  invoice_sent: "info",
  completed: "success",
};

/** Shopify's Drafts table. Server-renderable: receives DTOs, imports no API code. */
export function DraftOrdersTable({
  drafts,
  t,
  locale,
}: {
  readonly drafts: readonly DraftOrderListItemDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const d = t.draftOrders;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{d.columns.draft}</TableHead>
          <TableHead>{d.columns.date}</TableHead>
          <TableHead>{d.columns.customer}</TableHead>
          <TableHead>{d.columns.status}</TableHead>
          <TableHead className="text-end">{d.columns.total}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {drafts.map((draft) => (
          <TableRow key={draft.id}>
            <TableCell>
              <Link
                href={`/draft-orders/${encodeURIComponent(draft.id)}`}
                className="font-medium hover:underline"
              >
                {`#${draft.draftNumber}`}
              </Link>
              {draft.orderRef !== null && draft.orderNumber !== null && (
                <Link
                  href={`/orders/${encodeURIComponent(draft.orderRef)}`}
                  className="text-muted-foreground ms-2 text-sm hover:underline"
                >
                  {d.orderLink.replace("{number}", () => draft.orderNumber ?? "")}
                </Link>
              )}
            </TableCell>
            <TableCell>{formatShortDate(locale, draft.createdAt)}</TableCell>
            <TableCell>
              <span dir="auto">{draft.customerName ?? d.noCustomer}</span>
            </TableCell>
            <TableCell>
              <Badge variant={DRAFT_BADGE[draft.status]}>{d.status[draft.status]}</Badge>
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {formatCurrency(locale, draft.totalMinor, draft.currency)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

(`DRAFT_BADGE` is reused by the editor's header in Task 9.)

`apps/admin-web/src/components/draft-orders/draft-orders-tabs.tsx`:

```tsx
import Link from "next/link";
import { cn } from "@platform/ui";
import type { DraftOrderStatus } from "@/lib/api/draft-orders";
import { DRAFT_STATUSES, draftsHref } from "@/lib/orders/draft-orders";
import type { Dictionary } from "@/messages/en";

/** Shopify's Drafts tabs: All, Open, Invoice sent, Completed — each a link (`?status=`). */
export function DraftOrdersTabs({
  current,
  q,
  t,
}: {
  readonly current: DraftOrderStatus | undefined;
  readonly q: string | undefined;
  readonly t: Dictionary;
}) {
  const tabs: readonly (DraftOrderStatus | undefined)[] = [undefined, ...DRAFT_STATUSES];
  return (
    <nav
      aria-label={t.draftOrders.tabsLabel}
      className="border-border flex gap-1 overflow-x-auto border-b"
    >
      {tabs.map((status) => {
        const active = status === current;
        return (
          <Link
            key={status ?? "all"}
            href={draftsHref({ status, q })}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2",
              active
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {t.draftOrders.tabs[status ?? "all"]}
          </Link>
        );
      })}
    </nav>
  );
}
```

`apps/admin-web/src/app/draft-orders/page.tsx`:

```tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  AlertTriangleIcon,
  FileTextIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
  SearchXIcon,
} from "lucide-react";
import { Button, Card, CardContent, Input, Label } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { DraftOrdersTable } from "@/components/draft-orders/draft-orders-table";
import { DraftOrdersTabs } from "@/components/draft-orders/draft-orders-tabs";
import { OrdersPagination } from "@/components/orders/orders-pagination";
import { fetchDraftOrders } from "@/lib/api/draft-orders";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { canEditDrafts, DRAFT_PAGE_SIZE, parseDraftStatus } from "@/lib/orders/draft-orders";

interface DraftOrdersPageProps {
  readonly searchParams: Promise<{
    readonly status?: string;
    readonly q?: string;
    readonly after?: string;
  }>;
}

/** Orders → Drafts (order operations Part 4, Shopify's screen). */
export default async function DraftOrdersPage({ searchParams }: DraftOrdersPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const d = t.draftOrders;
  const user = await getCurrentUser();
  const canEdit = canEditDrafts(highestRole((await readSession())?.roles ?? []));
  const params = await searchParams;
  const q = params.q?.trim() || undefined;
  const status = parseDraftStatus(params.status);
  const result = await fetchDraftOrders({ first: DRAFT_PAGE_SIZE, after: params.after, q, status });

  let content: ReactNode;
  if (result.outcome === "unauthorized") {
    content = (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={d.unauthorized}
      />
    );
  } else if (result.outcome !== "ok") {
    content = (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={d.error}
      />
    );
  } else if (result.data.items.length === 0) {
    content =
      q !== undefined || status !== undefined ? (
        <StatePanel
          icon={<SearchXIcon aria-hidden="true" className="size-5" />}
          message={d.emptyFiltered}
        />
      ) : (
        <StatePanel
          icon={<FileTextIcon aria-hidden="true" className="size-5" />}
          message={d.empty}
          detail={d.emptyBody}
        />
      );
  } else {
    content = (
      <Card>
        <CardContent className="p-0 sm:p-0">
          <DraftOrdersTable drafts={result.data.items} t={t} locale={locale} />
        </CardContent>
        <div className="border-border flex items-center justify-between border-t px-4 py-3 sm:px-5">
          <OrdersPagination
            hasNextPage={result.data.pageInfo.hasNextPage}
            endCursor={result.data.pageInfo.endCursor}
            t={t}
          />
        </div>
      </Card>
    );
  }

  return (
    <AppShell t={t} locale={locale} activeNavId="draft-orders" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{d.title}</h1>
          {canEdit && (
            <Button asChild>
              <Link href="/draft-orders/new">
                <PlusIcon aria-hidden="true" />
                {d.createOrder}
              </Link>
            </Button>
          )}
        </header>
        <DraftOrdersTabs current={status} q={q} t={t} />
        <form
          role="search"
          method="get"
          action="/draft-orders"
          className="flex flex-wrap items-end gap-3"
        >
          {status !== undefined && <input type="hidden" name="status" value={status} />}
          <div className="flex min-w-60 flex-1 flex-col gap-1.5">
            <Label htmlFor="drafts-search" className="sr-only">
              {d.searchLabel}
            </Label>
            <Input
              id="drafts-search"
              type="search"
              name="q"
              dir="auto"
              maxLength={200}
              defaultValue={q ?? ""}
              placeholder={d.searchPlaceholder}
              aria-label={d.searchLabel}
            />
          </div>
          <Button type="submit" variant="outline">
            <SearchIcon aria-hidden="true" />
            {d.search}
          </Button>
        </form>
        {content}
      </div>
    </AppShell>
  );
}

function StatePanel({
  icon,
  message,
  detail,
}: {
  readonly icon: ReactNode;
  readonly message: string;
  readonly detail?: string;
}) {
  return (
    <Card>
      <CardContent className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-16 text-center text-base sm:px-5">
        {icon}
        <p role="note" className="text-foreground font-medium">
          {message}
        </p>
        {detail !== undefined && <p className="max-w-md text-sm">{detail}</p>}
      </CardContent>
    </Card>
  );
}
```

(`AppShell`'s `activeNavId` accepts any nav id; `"draft-orders"` is the new child's. Prettier-format.)

- [ ] **Step 6: Point "Create order" at drafts and retire the legacy form**

- `apps/admin-web/src/app/orders/new/page.tsx` becomes:

```tsx
import { redirect } from "next/navigation";

/** Spec §4.1 decision: "Create order" is a draft order now (Shopify's behaviour). */
export default function NewOrderPage(): never {
  redirect("/draft-orders/new");
}
```

- `app/orders/page.tsx`: the header's "Create order" link → `/draft-orders/new`; `components/create-menu.tsx`: the order item's `href` → `/draft-orders/new`.
- Delete `components/orders/order-create-form.tsx` and `order-create-form.test.tsx`; remove `placeOrderAction` from `app/orders/actions.ts` and its cases from `app/orders/actions.test.ts`. Keep `parseLineItems`/`parseAddress` (the from-checkout action uses them). If nothing else imports `placeOrder` from `lib/api/orders.ts`, delete it and its input types; if nothing else reads `t.orderCreate`, delete that section from BOTH dictionaries. The `POST /orders` API is untouched (spec decision).
- Add a test to `apps/admin-web/src/app/orders/new` — `page.test.tsx`: mock `next/navigation`'s `redirect` and assert it is called with `"/draft-orders/new"`.

- [ ] **Step 7: The order timeline links back to the draft (test first)**

Append to `apps/admin-web/src/lib/orders/order-timeline.test.ts`:

```ts
describe("activityHref (Ruling 24)", () => {
  it("links created_from_draft to its draft; other lines link nowhere", () => {
    expect(
      activityHref(
        line({
          kind: "created_from_draft",
          body: null,
          data: { draftNumber: "D3", draftId: "d-1" },
        }),
      ),
    ).toBe("/draft-orders/d-1");
    expect(
      activityHref(line({ kind: "created_from_draft", body: null, data: { draftNumber: "D3" } })),
    ).toBeNull();
    expect(activityHref(line({ kind: "archived", body: null, data: {} }))).toBeNull();
  });
});
```

(`line(...)` is the file's existing fixture helper.)

- `lib/api/orders.ts`, `TimelineEntryDto.data`: add `readonly draftId?: string;`.
- `lib/orders/order-timeline.ts`:

```ts
/** Where an activity line links (Ruling 24): "Order created from draft #D3" opens the draft. */
export function activityHref(entry: TimelineEntryDto): string | null {
  return entry.kind === "created_from_draft" && entry.data.draftId !== undefined
    ? `/draft-orders/${encodeURIComponent(entry.data.draftId)}`
    : null;
}
```

- `components/orders/order-timeline.tsx`: `Line` gains `readonly href?: string | null;` and renders the label as `<Link href={href} className="hover:underline">{label}</Link>` when set; the entry branch passes `href={activityHref(entry)}`.

- [ ] **Step 8: Gates**

Run: `pnpm --filter admin-web test`, `pnpm --filter admin-web typecheck`, `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint` → green. (`next build` is not used — EPERM on this machine.)

- [ ] **Step 9: Commit**

```bash
git add apps/admin-web/src/middleware.ts apps/admin-web/src/middleware.test.ts \
  apps/admin-web/src/components/navigation.ts apps/admin-web/src/components/navigation.test.tsx \
  apps/admin-web/src/lib/api/draft-orders.ts \
  apps/admin-web/src/lib/orders/draft-orders.ts apps/admin-web/src/lib/orders/draft-orders.test.ts \
  apps/admin-web/src/app/draft-orders/page.tsx \
  apps/admin-web/src/components/draft-orders/draft-orders-tabs.tsx \
  apps/admin-web/src/components/draft-orders/draft-orders-table.tsx \
  apps/admin-web/src/components/draft-orders/draft-orders-table.test.tsx \
  apps/admin-web/src/app/orders/new/page.tsx apps/admin-web/src/app/orders/new/page.test.tsx \
  apps/admin-web/src/app/orders/page.tsx apps/admin-web/src/components/create-menu.tsx \
  apps/admin-web/src/app/orders/actions.ts apps/admin-web/src/app/orders/actions.test.ts \
  apps/admin-web/src/lib/api/orders.ts apps/admin-web/src/lib/orders/order-timeline.ts \
  apps/admin-web/src/lib/orders/order-timeline.test.ts \
  apps/admin-web/src/components/orders/order-timeline.tsx \
  apps/admin-web/src/messages/en.ts apps/admin-web/src/messages/ar.ts
git rm apps/admin-web/src/components/orders/order-create-form.tsx \
  apps/admin-web/src/components/orders/order-create-form.test.tsx
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin-web): orders > drafts list, role gate and the create-order redirect

Drafts sits under Orders before Abandoned checkouts, readable by viewers and created by
operators. The list has Shopify's tabs, search and columns; Create order now opens a new
draft and the legacy create form is gone. The order timeline links back to its draft.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: admin-web — the draft editor: products, payment, customer, notes and tags, Send invoice, Collect payment

Model tier: **senior** (the largest client surface; role gating and the save-first rule must hold).

**Files:**

- Modify: `apps/admin-web/src/lib/orders/draft-orders.ts`, `draft-orders.test.ts` (form helpers)
- Create: `apps/admin-web/src/app/draft-orders/actions.ts`, `actions.test.ts`
- Create: `apps/admin-web/src/app/draft-orders/new/page.tsx`, `apps/admin-web/src/app/draft-orders/[draftId]/page.tsx`
- Create: `apps/admin-web/src/components/draft-orders/draft-order-editor.tsx`, `draft-order-editor.test.tsx`
- Create: `apps/admin-web/src/components/draft-orders/draft-products-card.tsx`, `draft-product-picker.tsx`
- Create: `apps/admin-web/src/components/draft-orders/draft-payment-card.tsx`, `draft-payment-card.test.tsx`
- Create: `apps/admin-web/src/components/draft-orders/draft-customer-card.tsx`
- Create: `apps/admin-web/src/components/draft-orders/send-invoice-dialog.tsx`, `send-invoice-dialog.test.tsx`
- Modify: `apps/admin-web/src/messages/en.ts`, `apps/admin-web/src/messages/ar.ts` (`draftOrders.editor`)

**Interfaces:**

- Consumes (Task 8): `lib/api/draft-orders.ts` types and calls (server only), `DRAFT_BADGE`, `canEditDrafts`, `canMarkDraftPaid`, `conflictCodeOf`; existing `toWhatsAppDigits`, `whatsAppUrl`, `fillTemplate` (`lib/whatsapp.ts`), `recoveryLinkHref` (`lib/orders/abandoned-checkouts.ts`), `fetchProductsPage`, `fetchProduct`, `fetchCustomersPage`, `newIdempotencyKey`, `TagInput`, `countryName`, `PROVINCES`, `hasProvinces`, `provinceName`, `formatCurrency`, `toMinorUnits`, `fromMinorUnits`.
- Produces:
  - `lib/orders/draft-orders.ts`: `interface DraftFormAddress`, `interface DraftFormLine`, `type DraftFormShipping`, `interface DraftForm`, `EMPTY_DRAFT_ADDRESS`, `formFromDraft(draft: DraftOrderDto | null): DraftForm`, `inputFromForm(form: DraftForm, defaultDiscountReason: string): DraftOrderInput`, `sameDraftForm(a, b): boolean`, `draftWhatsAppTarget(form): { phone: string | null; country: string | null }`, `invoiceMessage(template, values)`, `fieldErrorsOf(fields)`.
  - Server actions (`app/draft-orders/actions.ts`): `saveDraftOrderAction(draftId: string | null, version: number | null, input: DraftOrderInput): Promise<DraftSaveResult>`, `deleteDraftOrderAction(draftId)`, `draftShippingRatesAction(draftId)`, `sendDraftInvoiceAction(draftId)`, `completeDraftOrderAction(draftId, payment)`, `searchDraftProductsAction(q)`, `draftProductVariantsAction(productId)`, `searchDraftCustomersAction(q)`.
  - `t.draftOrders.editor.*`.

- [ ] **Step 1: Write the failing helper tests**

Append to `apps/admin-web/src/lib/orders/draft-orders.test.ts`:

```ts
import type { DraftOrderDto } from "@/lib/api/draft-orders";
import {
  draftWhatsAppTarget,
  EMPTY_DRAFT_ADDRESS,
  fieldErrorsOf,
  formFromDraft,
  inputFromForm,
  invoiceMessage,
  sameDraftForm,
} from "./draft-orders";

const DTO: DraftOrderDto = {
  id: "d-1",
  draftNumber: "D3",
  status: "open",
  version: 2,
  currency: "EGP",
  createdAt: "2026-10-25T10:00:00.000Z",
  updatedAt: "2026-10-25T10:00:00.000Z",
  invoiceSentAt: null,
  completedAt: null,
  customer: null,
  email: "sara@example.com",
  phone: "01001234567",
  shippingAddress: {
    name: "Mona Ali",
    phone: "01001234567",
    line1: "5 Nile St",
    line2: null,
    city: "Cairo",
    province: "EG-C",
    postalCode: "",
    country: "EG",
  },
  billingAddress: null,
  lines: [
    {
      productId: "p-1",
      variantId: "v-1",
      sku: "TEE",
      title: "Tee",
      variantTitle: "M",
      quantity: 2,
      unitPriceMinor: 25000,
      lineTotalMinor: 50000,
      imageUrl: null,
    },
  ],
  discount: { valueType: "fixed", value: 5000, reason: "Loyal", amountMinor: 5000 },
  shipping: { kind: "rate", method: "standard", title: "Standard", amountMinor: 500 },
  note: "call first",
  tags: ["vip"],
  totals: {
    subtotalMinor: 50000,
    discountMinor: 5000,
    shippingMinor: 500,
    taxMinor: 0,
    taxIncluded: true,
    totalMinor: 45500,
  },
  order: null,
  links: [],
  missing: { invoice: [], complete: [] },
};

describe("draft form", () => {
  it("round-trips a draft into the API input — ids and quantities only, no price", () => {
    const input = inputFromForm(formFromDraft(DTO), "Custom discount");
    expect(input).toEqual({
      customerId: null,
      email: "sara@example.com",
      phone: "01001234567",
      shippingAddress: {
        name: "Mona Ali",
        phone: "01001234567",
        line1: "5 Nile St",
        city: "Cairo",
        province: "EG-C",
        postalCode: "",
        country: "EG",
      },
      billingAddress: null,
      lines: [{ productId: "p-1", variantId: "v-1", quantity: 2 }],
      discount: { valueType: "fixed", value: 5000, reason: "Loyal" },
      shipping: { kind: "rate", method: "standard" },
      note: "call first",
      tags: ["vip"],
    });
    expect(JSON.stringify(input)).not.toContain("25000");
  });

  it("fills an empty discount reason with the localized default (Ruling 13)", () => {
    const form = {
      ...formFromDraft(DTO),
      discount: { valueType: "percentage" as const, value: 10, reason: "  " },
    };
    expect(inputFromForm(form, "خصم مخصص").discount).toEqual({
      valueType: "percentage",
      value: 10,
      reason: "خصم مخصص",
    });
  });

  it("a new draft starts empty, with billing same as shipping", () => {
    const empty = formFromDraft(null);
    expect(empty.lines).toEqual([]);
    expect(empty.billingSame).toBe(true);
    expect(empty.shippingAddress).toBeNull();
    expect(EMPTY_DRAFT_ADDRESS.country).toBe("EG");
  });

  it("dirty compares what would be sent, not display data", () => {
    const a = formFromDraft(DTO);
    expect(sameDraftForm(a, { ...a, lines: a.lines.map((l) => ({ ...l, imageUrl: "x" })) })).toBe(
      true,
    );
    expect(sameDraftForm(a, { ...a, note: "other" })).toBe(false);
  });

  it("maps API field issues to a field → message record", () => {
    expect(
      fieldErrorsOf([
        { field: "lines.0", message: "gone" },
        { field: "email", message: "bad" },
      ]),
    ).toEqual({ "lines.0": "gone", email: "bad" });
  });
});

describe("draftWhatsAppTarget (Review Focus 5)", () => {
  it.each([
    [
      "the draft phone",
      { phone: "01001234567", shipping: null },
      { phone: "01001234567", country: null },
    ],
    [
      "else the shipping phone and its country",
      { phone: "", shipping: { phone: "٠١٠٠١٢٣٤٥٦٧", country: "EG" } },
      { phone: "٠١٠٠١٢٣٤٥٦٧", country: "EG" },
    ],
    ["nothing → the chat picker", { phone: " ", shipping: null }, { phone: null, country: null }],
  ])("%s", (_name, given, expected) => {
    const form = {
      ...formFromDraft(null),
      phone: given.phone,
      shippingAddress:
        given.shipping === null
          ? null
          : {
              ...EMPTY_DRAFT_ADDRESS,
              phone: given.shipping.phone,
              country: given.shipping.country,
            },
    };
    expect(draftWhatsAppTarget(form)).toEqual(
      expected.phone === "01001234567"
        ? { phone: "01001234567", country: form.shippingAddress?.country ?? null }
        : expected,
    );
  });

  it("fills the invoice message literally", () => {
    expect(
      invoiceMessage("Hi {name}, #{draft} from {shop}: {total} {url}", {
        name: "Mona $&",
        draft: "D3",
        shop: "Shop",
        total: "EGP 455.00",
        url: "https://s/c/x",
      }),
    ).toBe("Hi Mona $&, #D3 from Shop: EGP 455.00 https://s/c/x");
  });
});
```

(The draft-phone row keeps the shipping country, `null` when there is no address; Prettier-format.)

Run: `pnpm --filter admin-web exec vitest run src/lib/orders/draft-orders.test.ts` → FAIL (exports missing).

- [ ] **Step 2: The form helpers**

Append to `apps/admin-web/src/lib/orders/draft-orders.ts`:

```ts
import type { DraftAddressInput, DraftOrderDto, DraftOrderInput } from "@/lib/api/draft-orders";
import type { FieldIssue } from "@/lib/api/client";
import { fillTemplate } from "@/lib/whatsapp";

/** Every address field as the form edits it (strings; blank = absent). */
export interface DraftFormAddress {
  readonly name: string;
  readonly phone: string;
  readonly line1: string;
  readonly line2: string;
  readonly city: string;
  readonly province: string;
  readonly postalCode: string;
  readonly country: string;
}

/** A line as the editor shows it; only `productId`, `variantId` and `quantity` are ever sent. */
export interface DraftFormLine {
  readonly productId: string;
  readonly variantId: string | null;
  readonly quantity: number;
  readonly title: string;
  readonly variantTitle: string | null;
  readonly sku: string | null;
  readonly imageUrl: string | null;
  /** For display until the server prices it on save (Ruling 12). */
  readonly unitPriceMinor: number | null;
}

export type DraftFormShipping =
  | {
      readonly kind: "rate";
      readonly method: string;
      readonly title: string;
      readonly amountMinor: number;
    }
  | { readonly kind: "custom"; readonly title: string; readonly amountMinor: number }
  | { readonly kind: "free" }
  | null;

export interface DraftForm {
  readonly customer: {
    readonly id: string;
    readonly name: string | null;
    readonly email: string | null;
  } | null;
  readonly email: string;
  readonly phone: string;
  readonly shippingAddress: DraftFormAddress | null;
  readonly billingSame: boolean;
  readonly billingAddress: DraftFormAddress | null;
  readonly lines: readonly DraftFormLine[];
  readonly discount: {
    readonly valueType: "fixed" | "percentage";
    readonly value: number;
    readonly reason: string;
  } | null;
  readonly shipping: DraftFormShipping;
  readonly note: string;
  readonly tags: readonly string[];
}

/** Egypt first: the platform's home market. */
export const EMPTY_DRAFT_ADDRESS: DraftFormAddress = {
  name: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  province: "",
  postalCode: "",
  country: "EG",
};

const formAddress = (a: DraftOrderDto["shippingAddress"]): DraftFormAddress | null =>
  a === null
    ? null
    : {
        name: a.name ?? "",
        phone: a.phone ?? "",
        line1: a.line1,
        line2: a.line2 ?? "",
        city: a.city,
        province: a.province ?? "",
        postalCode: a.postalCode,
        country: a.country,
      };

export function formFromDraft(draft: DraftOrderDto | null): DraftForm {
  if (draft === null) {
    return {
      customer: null,
      email: "",
      phone: "",
      shippingAddress: null,
      billingSame: true,
      billingAddress: null,
      lines: [],
      discount: null,
      shipping: null,
      note: "",
      tags: [],
    };
  }
  return {
    customer: draft.customer,
    email: draft.email ?? "",
    phone: draft.phone ?? "",
    shippingAddress: formAddress(draft.shippingAddress),
    billingSame: draft.billingAddress === null,
    billingAddress: formAddress(draft.billingAddress),
    lines: draft.lines.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      quantity: l.quantity,
      title: l.title,
      variantTitle: l.variantTitle,
      sku: l.sku,
      imageUrl: l.imageUrl,
      unitPriceMinor: l.unitPriceMinor,
    })),
    discount:
      draft.discount === null
        ? null
        : {
            valueType: draft.discount.valueType,
            value: draft.discount.value,
            reason: draft.discount.reason ?? "",
          },
    shipping:
      draft.shipping === null
        ? null
        : draft.shipping.kind === "rate"
          ? {
              kind: "rate",
              method: draft.shipping.method ?? "",
              title: draft.shipping.title,
              amountMinor: draft.shipping.amountMinor,
            }
          : draft.shipping.kind === "custom"
            ? {
                kind: "custom",
                title: draft.shipping.title,
                amountMinor: draft.shipping.amountMinor,
              }
            : { kind: "free" },
    note: draft.note ?? "",
    tags: [...draft.tags],
  };
}

function addressInput(a: DraftFormAddress | null): DraftAddressInput | null {
  if (a === null) return null;
  const optional = (key: "name" | "phone" | "line2" | "province", value: string) =>
    value.trim() === "" ? {} : { [key]: value.trim() };
  return {
    ...optional("name", a.name),
    ...optional("phone", a.phone),
    line1: a.line1.trim(),
    ...optional("line2", a.line2),
    city: a.city.trim(),
    ...optional("province", a.province),
    postalCode: a.postalCode.trim(),
    country: a.country,
  };
}

/** The API input: ids, quantities and the merchant's own terms — never a line price (binding carry 9). */
export function inputFromForm(form: DraftForm, defaultDiscountReason: string): DraftOrderInput {
  const blank = (v: string) => (v.trim() === "" ? null : v.trim());
  return {
    customerId: form.customer?.id ?? null,
    email: blank(form.email),
    phone: blank(form.phone),
    shippingAddress: addressInput(form.shippingAddress),
    billingAddress: form.billingSame ? null : addressInput(form.billingAddress),
    lines: form.lines.map((l) => ({
      productId: l.productId,
      ...(l.variantId === null ? {} : { variantId: l.variantId }),
      quantity: l.quantity,
    })),
    discount:
      form.discount === null
        ? null
        : {
            valueType: form.discount.valueType,
            value: form.discount.value,
            reason:
              form.discount.reason.trim() === ""
                ? defaultDiscountReason
                : form.discount.reason.trim(),
          },
    shipping:
      form.shipping === null
        ? null
        : form.shipping.kind === "rate"
          ? { kind: "rate", method: form.shipping.method }
          : form.shipping.kind === "custom"
            ? { kind: "custom", title: form.shipping.title, amountMinor: form.shipping.amountMinor }
            : { kind: "free" },
    note: blank(form.note),
    tags: [...form.tags],
  };
}

/** Two forms are the same when they would send the same input (display fields do not count). */
export function sameDraftForm(a: DraftForm, b: DraftForm): boolean {
  return JSON.stringify(inputFromForm(a, "")) === JSON.stringify(inputFromForm(b, ""));
}

/** Review Focus 5: the draft's phone, else the shipping phone — with the shipping country for `toWhatsAppDigits`. */
export function draftWhatsAppTarget(form: Pick<DraftForm, "phone" | "shippingAddress">): {
  readonly phone: string | null;
  readonly country: string | null;
} {
  const country = form.shippingAddress?.country ?? null;
  if (form.phone.trim() !== "") return { phone: form.phone.trim(), country };
  const shipping = form.shippingAddress?.phone.trim() ?? "";
  return shipping === "" ? { phone: null, country: null } : { phone: shipping, country };
}

export function invoiceMessage(
  template: string,
  values: {
    readonly name: string;
    readonly draft: string;
    readonly shop: string;
    readonly total: string;
    readonly url: string;
  },
): string {
  return fillTemplate(template, values);
}

export function fieldErrorsOf(fields: readonly FieldIssue[]): Readonly<Record<string, string>> {
  return Object.fromEntries(fields.map((f) => [f.field, f.message]));
}
```

(`lib/orders/draft-orders.ts` imports only TYPES from `lib/api`, so client components may import it — binding carry 10. Prettier-format.)

Run the helper test → PASS.

- [ ] **Step 3: Server actions (test first)**

`apps/admin-web/src/app/draft-orders/actions.test.ts` — mock `@/lib/api/draft-orders`, `@/lib/api/products`, `@/lib/api/customers`, `next/headers` (`cookies` → no locale), `next/cache` and `next/navigation` (`redirect` throws a sentinel), following `app/abandoned-checkouts/actions.test.ts`:

```ts
describe("draft actions", () => {
  it("sendDraftInvoiceAction sends NO idempotency key and builds the link from STOREFRONT_URL when the shop has no domain", async () => {
    issueDraftInvoiceLink.mockResolvedValue({
      outcome: "ok",
      data: { url: null, path: "/c/abc", expiresAt: "x", shopName: "Shop" },
    });
    process.env["STOREFRONT_URL"] = "https://shop.example/";
    const result = await sendDraftInvoiceAction(DRAFT_ID);
    expect(issueDraftInvoiceLink).toHaveBeenCalledWith(DRAFT_ID);
    expect(issueDraftInvoiceLink.mock.calls[0]).toHaveLength(1);
    expect(result).toEqual({ ok: true, url: "https://shop.example/c/abc", shopName: "Shop" });
  });

  it("completeDraftOrderAction maps the 409 codes to words and sends one key per submit", async () => {
    completeDraftOrder.mockResolvedValue({
      outcome: "conflict",
      message: "COD_NOT_ENABLED: turn on cash on delivery",
    });
    expect(await completeDraftOrderAction(DRAFT_ID, "collect_on_delivery")).toEqual({
      ok: false,
      message: en.draftOrders.editor.errors.codNotEnabled,
    });
    expect(completeDraftOrder.mock.calls[0]?.[2]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("saveDraftOrderAction returns field errors and flags a version conflict", async () => {
    updateDraftOrder.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid",
      fields: [{ field: "lines.0", message: "gone" }],
    });
    expect(await saveDraftOrderAction(DRAFT_ID, 2, INPUT)).toMatchObject({
      ok: false,
      fields: { "lines.0": "gone" },
      conflict: false,
    });
    updateDraftOrder.mockResolvedValue({
      outcome: "conflict",
      message: "VERSION_CONFLICT: changed",
    });
    expect(await saveDraftOrderAction(DRAFT_ID, 2, INPUT)).toMatchObject({
      ok: false,
      conflict: true,
    });
  });

  it("refuses a malformed draft id without calling the API", async () => {
    expect(await sendDraftInvoiceAction("../x")).toMatchObject({ ok: false });
    expect(issueDraftInvoiceLink).not.toHaveBeenCalled();
  });
});
```

(Define `DRAFT_ID` as a UUID, `INPUT` as a minimal `DraftOrderInput`, the `vi.mock` blocks and `beforeEach(vi.resetAllMocks)` at the top; import `en` from `@/messages/en`.)

`apps/admin-web/src/app/draft-orders/actions.ts`:

```ts
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fetchCustomersPage } from "@/lib/api/customers";
import {
  completeDraftOrder,
  createDraftOrder,
  deleteDraftOrder,
  fetchDraftShippingRates,
  issueDraftInvoiceLink,
  updateDraftOrder,
  type DraftOrderDto,
  type DraftOrderInput,
  type DraftPayment,
  type DraftShippingRateDto,
} from "@/lib/api/draft-orders";
import { newIdempotencyKey } from "@/lib/api/mutation";
import { fetchProduct, fetchProductsPage } from "@/lib/api/products";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { recoveryLinkHref } from "@/lib/orders/abandoned-checkouts";
import { conflictCodeOf, fieldErrorsOf } from "@/lib/orders/draft-orders";

const DRAFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function words() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE).draftOrders.editor.errors;
}

type Failure = { readonly ok: false; readonly message: string };

async function failureOf(result: {
  readonly outcome: string;
  readonly message?: string;
}): Promise<Failure> {
  const e = await words();
  if (result.outcome === "unauthorized") return { ok: false, message: e.sessionExpired };
  if (result.outcome === "forbidden") return { ok: false, message: e.forbidden };
  if (result.outcome === "not_found") return { ok: false, message: e.notFound };
  if (result.outcome === "conflict") {
    const byCode: Readonly<Record<string, string>> = {
      VERSION_CONFLICT: e.conflict,
      DRAFT_COMPLETED: e.completed,
      ALREADY_COMPLETED: e.completed,
      COD_NOT_ENABLED: e.codNotEnabled,
      OUT_OF_STOCK: e.outOfStock,
      DRAFT_BUSY: e.busy,
      PAYMENT_NOT_RECORDED: e.paymentNotRecorded,
    };
    return { ok: false, message: byCode[conflictCodeOf(result.message ?? "") ?? ""] ?? e.generic };
  }
  if (result.outcome === "invalid") return { ok: false, message: e.invalid };
  return { ok: false, message: e.generic };
}

export type DraftSaveResult =
  | { readonly ok: true; readonly draft: DraftOrderDto }
  | {
      readonly ok: false;
      readonly message: string;
      readonly fields: Readonly<Record<string, string>>;
      readonly conflict: boolean;
    };

/** Create (no id) or replace (id + version). One idempotency key per submit. */
export async function saveDraftOrderAction(
  draftId: string | null,
  version: number | null,
  input: DraftOrderInput,
): Promise<DraftSaveResult> {
  if (draftId !== null && (!DRAFT_ID.test(draftId) || version === null)) {
    return { ok: false, message: (await words()).generic, fields: {}, conflict: false };
  }
  const result =
    draftId === null
      ? await createDraftOrder(input, newIdempotencyKey())
      : await updateDraftOrder(draftId, { ...input, version: version ?? 0 }, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/draft-orders");
    revalidatePath(`/draft-orders/${result.data.id}`);
    return { ok: true, draft: result.data };
  }
  const failure = await failureOf(result);
  return {
    ...failure,
    fields: result.outcome === "invalid" ? fieldErrorsOf(result.fields) : {},
    conflict:
      result.outcome === "conflict" && conflictCodeOf(result.message) === "VERSION_CONFLICT",
  };
}

export async function deleteDraftOrderAction(draftId: string): Promise<Failure> {
  if (!DRAFT_ID.test(draftId)) return { ok: false, message: (await words()).generic };
  const result = await deleteDraftOrder(draftId, newIdempotencyKey());
  if (result.outcome !== "ok") return failureOf(result);
  revalidatePath("/draft-orders");
  redirect("/draft-orders");
}

export async function draftShippingRatesAction(
  draftId: string,
): Promise<{ readonly ok: true; readonly rates: readonly DraftShippingRateDto[] } | Failure> {
  if (!DRAFT_ID.test(draftId)) return { ok: false, message: (await words()).generic };
  const result = await fetchDraftShippingRates(draftId);
  return result.outcome === "ok" ? { ok: true, rates: result.data.rates } : failureOf(result);
}

/**
 * Send invoice: a NEW link per press — never idempotent, no key is sent, the token is never cached or
 * logged (binding carry 2). The URL is the shop's own domain, else `STOREFRONT_URL` (Part 3's rule).
 */
export async function sendDraftInvoiceAction(
  draftId: string,
): Promise<{ readonly ok: true; readonly url: string; readonly shopName: string } | Failure> {
  const e = await words();
  if (!DRAFT_ID.test(draftId)) return { ok: false, message: e.generic };
  const result = await issueDraftInvoiceLink(draftId);
  if (result.outcome !== "ok") return failureOf(result);
  const url = recoveryLinkHref(result.data, process.env["STOREFRONT_URL"] ?? null);
  if (url === null) return { ok: false, message: e.noStoreAddress };
  revalidatePath(`/draft-orders/${draftId}`);
  revalidatePath("/draft-orders");
  return { ok: true, url, shopName: result.data.shopName };
}

export async function completeDraftOrderAction(
  draftId: string,
  payment: DraftPayment,
): Promise<{ readonly ok: true; readonly orderId: string } | Failure> {
  if (!DRAFT_ID.test(draftId) || (payment !== "paid" && payment !== "collect_on_delivery")) {
    return { ok: false, message: (await words()).generic };
  }
  const result = await completeDraftOrder(draftId, payment, newIdempotencyKey());
  if (result.outcome !== "ok") return failureOf(result);
  revalidatePath(`/draft-orders/${draftId}`);
  revalidatePath("/draft-orders");
  revalidatePath("/orders");
  return { ok: true, orderId: result.data.orderId };
}

export interface DraftPickerProduct {
  readonly id: string;
  readonly title: string;
  readonly imageUrl: string | null;
  readonly variantCount: number;
  readonly priceMinor: number | null;
  readonly currency: string | null;
}

export interface DraftPickerVariant {
  readonly productId: string;
  readonly variantId: string;
  readonly title: string;
  readonly variantTitle: string | null;
  readonly sku: string;
  readonly priceMinor: number;
  readonly currency: string;
  readonly imageUrl: string | null;
}

export async function searchDraftProductsAction(q: string): Promise<readonly DraftPickerProduct[]> {
  const result = await fetchProductsPage({
    first: 20,
    ...(q.trim() === "" ? {} : { query: q.trim().slice(0, 100) }),
  });
  if (result.outcome !== "ok") return [];
  return result.items
    .filter((p) => p.status === "published" || p.status === "unlisted")
    .map((p) => ({
      id: p.id,
      title: p.name,
      imageUrl: p.featuredImage?.url ?? null,
      variantCount: p.variantCount,
      priceMinor: p.priceAmountMinor,
      currency: p.currency,
    }));
}

export async function draftProductVariantsAction(
  productId: string,
): Promise<readonly DraftPickerVariant[]> {
  const result = await fetchProduct(productId);
  if (result.outcome !== "ok") return [];
  const p = result.product;
  const imageUrl = p.media?.[0]?.url ?? null;
  return p.variants.map((v) => ({
    productId: p.id,
    variantId: v.id,
    title: p.name,
    variantTitle:
      v.selection === null
        ? null
        : p.options
            .map((o) => v.selection?.[o.name])
            .filter((x): x is string => x !== undefined)
            .join(" / ") || null,
    sku: v.sku,
    priceMinor: v.priceAmountMinor,
    currency: v.currency,
    imageUrl: p.media?.find((m) => m.id === v.imageId)?.url ?? imageUrl,
  }));
}

export async function searchDraftCustomersAction(
  q: string,
): Promise<readonly { readonly id: string; readonly name: string; readonly email: string }[]> {
  if (q.trim().length < 2) return [];
  const result = await fetchCustomersPage({ first: 10, search: q.trim().slice(0, 100) });
  return result.outcome === "ok" ? result.items : [];
}
```

(Prettier-format.)

Run the actions test → PASS.

- [ ] **Step 4: Strings**

`apps/admin-web/src/messages/en.ts`, inside `draftOrders`:

```ts
    editor: {
      newTitle: "Create order",
      back: "Drafts",
      moreActions: "More actions",
      deleteDraft: "Delete draft",
      confirmDelete: "Delete draft #{draft}? Its invoice links will stop working.",
      unsaved: "Unsaved changes",
      discard: "Discard",
      save: "Save",
      saving: "Saving…",
      completedBanner: "This draft order was completed.",
      viewOrder: "View order #{number}",
      products: {
        title: "Products",
        browse: "Browse",
        empty: "Add a product to start the order.",
        quantity: "Quantity of {title}",
        remove: "Remove {title}",
        each: "{price} each",
        pricedOnSave: "Priced when you save",
      },
      picker: {
        title: "Add products",
        search: "Search products",
        noResults: "No products found",
        loading: "Loading…",
        variants: "Choose a variant of {title}",
        add: "Add",
        back: "Back",
        close: "Close",
      },
      payment: {
        title: "Payment",
        subtotal: "Subtotal",
        addDiscount: "Add discount",
        discount: "Discount",
        addShipping: "Add shipping or delivery",
        shipping: "Shipping",
        tax: "Estimated tax",
        taxPending: "Calculated after an address is added",
        taxIncluded: "Including {tax} in taxes",
        total: "Total",
        saveToUpdate: "Save to update totals",
        free: "Free",
        sendInvoice: "Send invoice",
        collectPayment: "Collect payment",
        markAsPaid: "Mark as paid",
        markAsPaidAdminOnly: "Only admins can mark an order as paid",
        collectOnDelivery: "Collect on delivery",
        confirmMarkAsPaid: "Create the order and record that you received {total}?",
        confirmCollect: "Create the order with {total} to collect on delivery?",
        working: "Creating the order…",
      },
      discountDialog: {
        title: "Add discount",
        type: "Discount type",
        fixed: "Amount",
        percentage: "Percentage",
        value: "Value",
        reason: "Reason for discount",
        defaultReason: "Custom discount",
        apply: "Apply",
        remove: "Remove discount",
        cancel: "Cancel",
      },
      shippingDialog: {
        title: "Shipping and delivery",
        rates: "Shop rates",
        custom: "Custom",
        free: "Free shipping",
        name: "Rate name",
        price: "Price",
        loading: "Loading rates…",
        noRates: "No shipping rates match this address.",
        needsAddress: "Add products and a shipping address first.",
        apply: "Apply",
        remove: "Remove shipping",
        cancel: "Cancel",
      },
      customer: {
        title: "Customer",
        search: "Search or create a customer",
        noResults: "No customers found — fill in the guest details below.",
        guest: "Guest",
        remove: "Remove customer",
        email: "Email",
        phone: "Phone",
        shippingAddress: "Shipping address",
        addAddress: "Add shipping address",
        billingAddress: "Billing address",
        sameAsShipping: "Same as shipping address",
        address: {
          name: "Recipient name",
          phone: "Recipient phone",
          line1: "Address",
          line2: "Apartment, floor, etc.",
          city: "City",
          province: "Governorate",
          selectProvince: "Select a governorate",
          postalCode: "Postal code",
          country: "Country/region",
        },
      },
      notes: { title: "Notes", label: "Note", placeholder: "Add a note" },
      tags: { title: "Tags", label: "Tags" },
      invoice: {
        title: "Send invoice",
        sending: "Creating the link…",
        linkLabel: "Invoice link",
        copy: "Copy link",
        copied: "Copied",
        whatsapp: "Share on WhatsApp",
        messageLabel: "Message",
        message: "Hi {name}, here is the invoice for your order #{draft} from {shop}, total {total}. You can pay here: {url}",
        messageNoName: "Hi, here is the invoice for your order #{draft} from {shop}, total {total}. You can pay here: {url}",
        openWhatsApp: "Open WhatsApp",
        email: "Email invoice — coming soon",
        expires: "This link works for 30 days.",
        close: "Close",
      },
      missing: {
        lines: "Add a product",
        shipping_address: "Add a shipping address",
        shipping: "Add shipping or delivery",
        email: "Add the customer's email to create the order directly",
      },
      errors: {
        generic: "Something went wrong. Try again.",
        invalid: "Check the highlighted fields.",
        sessionExpired: "Your session expired. Sign in again.",
        forbidden: "You don't have permission to do that.",
        notFound: "This draft order no longer exists.",
        conflict: "Someone else changed this draft. Reload to see their changes.",
        completed: "This draft order is already an order.",
        codNotEnabled: "Turn on Cash on delivery in Settings → Payments first.",
        outOfStock: "Some products don't have enough stock.",
        busy: "This draft is being updated. Try again.",
        paymentNotRecorded: "The order was created, but the payment wasn't recorded. Press Mark as paid again.",
        noStoreAddress: "Set your online store's address to create links.",
      },
    },
```

`apps/admin-web/src/messages/ar.ts` (Egyptian, binding carry 8; the WhatsApp text is the spec's):

```ts
    editor: {
      newTitle: "إنشاء طلب",
      back: "المسودات",
      moreActions: "إجراءات أكتر",
      deleteDraft: "امسح المسودة",
      confirmDelete: "تمسح المسودة #{draft}؟ لينكات الفاتورة بتاعتها هتبطّل تشتغل.",
      unsaved: "فيه تغييرات مش محفوظة",
      discard: "تجاهل",
      save: "احفظ",
      saving: "بنحفظ…",
      completedBanner: "المسودة دي اتحولت لطلب.",
      viewOrder: "افتح الطلب #{number}",
      products: {
        title: "المنتجات",
        browse: "تصفّح",
        empty: "ضيف منتج عشان تبدأ الطلب.",
        quantity: "كمية {title}",
        remove: "شيل {title}",
        each: "{price} للقطعة",
        pricedOnSave: "السعر بيتحسب لما تحفظ",
      },
      picker: {
        title: "ضيف منتجات",
        search: "دوّر على منتج",
        noResults: "مفيش منتجات",
        loading: "بنحمّل…",
        variants: "اختار نوع من {title}",
        add: "ضيف",
        back: "رجوع",
        close: "اقفل",
      },
      payment: {
        title: "الدفع",
        subtotal: "المجموع الفرعي",
        addDiscount: "ضيف خصم",
        discount: "الخصم",
        addShipping: "ضيف شحن أو توصيل",
        shipping: "الشحن",
        tax: "الضريبة التقديرية",
        taxPending: "بتتحسب بعد ما تضيف عنوان",
        taxIncluded: "شامل {tax} ضرايب",
        total: "الإجمالي",
        saveToUpdate: "احفظ عشان الإجماليات تتحدّث",
        free: "مجاني",
        sendInvoice: "ابعت الفاتورة",
        collectPayment: "تحصيل المبلغ",
        markAsPaid: "تحديد كمدفوع",
        markAsPaidAdminOnly: "الأدمن بس هو اللي يقدر يحدد الطلب كمدفوع",
        collectOnDelivery: "تحصيل عند الاستلام",
        confirmMarkAsPaid: "نعمل الطلب ونسجّل إنك استلمت {total}؟",
        confirmCollect: "نعمل الطلب و{total} تتحصّل عند الاستلام؟",
        working: "بنعمل الطلب…",
      },
      discountDialog: {
        title: "ضيف خصم",
        type: "نوع الخصم",
        fixed: "مبلغ",
        percentage: "نسبة",
        value: "القيمة",
        reason: "سبب الخصم",
        defaultReason: "خصم مخصص",
        apply: "طبّق",
        remove: "شيل الخصم",
        cancel: "إلغاء",
      },
      shippingDialog: {
        title: "الشحن والتوصيل",
        rates: "أسعار الشحن بتاعة المتجر",
        custom: "مخصص",
        free: "شحن مجاني",
        name: "اسم السعر",
        price: "السعر",
        loading: "بنحمّل الأسعار…",
        noRates: "مفيش أسعار شحن للعنوان ده.",
        needsAddress: "ضيف منتجات وعنوان شحن الأول.",
        apply: "طبّق",
        remove: "شيل الشحن",
        cancel: "إلغاء",
      },
      customer: {
        title: "العميل",
        search: "دوّر على عميل",
        noResults: "مفيش عملاء — اكتب بيانات الضيف تحت.",
        guest: "ضيف",
        remove: "شيل العميل",
        email: "الإيميل",
        phone: "التليفون",
        shippingAddress: "عنوان الشحن",
        addAddress: "ضيف عنوان شحن",
        billingAddress: "عنوان الفاتورة",
        sameAsShipping: "نفس عنوان الشحن",
        address: {
          name: "اسم المستلم",
          phone: "تليفون المستلم",
          line1: "العنوان",
          line2: "الشقة، الدور، إلخ",
          city: "المدينة",
          province: "المحافظة",
          selectProvince: "اختار المحافظة",
          postalCode: "الرمز البريدي",
          country: "الدولة",
        },
      },
      notes: { title: "ملاحظات", label: "ملاحظة", placeholder: "ضيف ملاحظة" },
      tags: { title: "العلامات", label: "العلامات" },
      invoice: {
        title: "ابعت الفاتورة",
        sending: "بنعمل اللينك…",
        linkLabel: "لينك الفاتورة",
        copy: "انسخ اللينك",
        copied: "اتنسخ",
        whatsapp: "ابعته واتساب",
        messageLabel: "الرسالة",
        message: "أهلاً {name}، دي فاتورة طلبك #{draft} من {shop} بإجمالي {total}. تقدر تدفع من هنا: {url}",
        messageNoName: "أهلاً، دي فاتورة طلبك #{draft} من {shop} بإجمالي {total}. تقدر تدفع من هنا: {url}",
        openWhatsApp: "افتح واتساب",
        email: "إرسال الفاتورة بالإيميل — قريب",
        expires: "اللينك ده شغال 30 يوم.",
        close: "اقفل",
      },
      missing: {
        lines: "ضيف منتج",
        shipping_address: "ضيف عنوان شحن",
        shipping: "ضيف شحن أو توصيل",
        email: "ضيف إيميل العميل عشان تعمل الطلب على طول",
      },
      errors: {
        generic: "حصلت مشكلة. جرّب تاني.",
        invalid: "راجع الخانات المعلّمة.",
        sessionExpired: "الجلسة خلصت. سجّل دخول تاني.",
        forbidden: "مش مسموحلك تعمل ده.",
        notFound: "المسودة دي مبقتش موجودة.",
        conflict: "حد تاني عدّل المسودة دي. اعمل تحديث للصفحة عشان تشوف التعديلات.",
        completed: "المسودة دي اتحولت لطلب خلاص.",
        codNotEnabled: "شغّل الدفع عند الاستلام من الإعدادات ← الدفع الأول.",
        outOfStock: "فيه منتجات مخزونها مش كفاية.",
        busy: "المسودة بتتحدّث دلوقتي. جرّب تاني.",
        paymentNotRecorded: "الطلب اتعمل بس الدفع ماتسجّلش. دوس تحديد كمدفوع تاني.",
        noStoreAddress: "حدّد عنوان المتجر الأونلاين عشان تعمل لينكات.",
      },
    },
```

- [ ] **Step 5: The pages**

`apps/admin-web/src/app/draft-orders/new/page.tsx`:

```tsx
import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { DraftOrderEditor } from "@/components/draft-orders/draft-order-editor";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { canEditDrafts, canMarkDraftPaid } from "@/lib/orders/draft-orders";

/** Orders → Create order (spec §4.9): a new draft. Operators and up (middleware). */
export default async function NewDraftOrderPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const role = highestRole((await readSession())?.roles ?? []);
  return (
    <AppShell t={t} locale={locale} activeNavId="draft-orders" user={user}>
      <DraftOrderEditor
        draft={null}
        canEdit={canEditDrafts(role)}
        canMarkPaid={canMarkDraftPaid(role)}
        t={t}
        locale={locale}
      />
    </AppShell>
  );
}
```

`apps/admin-web/src/app/draft-orders/[draftId]/page.tsx`:

```tsx
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AlertTriangleIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { DraftOrderEditor } from "@/components/draft-orders/draft-order-editor";
import { fetchDraftOrder } from "@/lib/api/draft-orders";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { canEditDrafts, canMarkDraftPaid } from "@/lib/orders/draft-orders";

/** One draft order (spec §4.9). Viewers read it; the editor is read-only for them. */
export default async function DraftOrderPage({
  params,
}: {
  readonly params: Promise<{ readonly draftId: string }>;
}) {
  const { draftId } = await params;
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const role = highestRole((await readSession())?.roles ?? []);
  const result = await fetchDraftOrder(draftId);
  if (result.outcome === "not_found") notFound();
  return (
    <AppShell t={t} locale={locale} activeNavId="draft-orders" user={user}>
      {result.outcome === "ok" ? (
        <DraftOrderEditor
          draft={result.data}
          canEdit={canEditDrafts(role)}
          canMarkPaid={canMarkDraftPaid(role)}
          t={t}
          locale={locale}
        />
      ) : (
        <Card>
          <CardContent className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-16 text-center">
            <AlertTriangleIcon aria-hidden="true" className="size-5" />
            <p role="note" className="text-foreground font-medium">
              {result.outcome === "unauthorized" ? t.draftOrders.unauthorized : t.draftOrders.error}
            </p>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
```

- [ ] **Step 6: The editor and its cards (tests first)**

`apps/admin-web/src/components/draft-orders/draft-order-editor.test.tsx` (mock `@/app/draft-orders/actions` with `vi.mock`, and `next/navigation`'s `useRouter`):

```tsx
describe("DraftOrderEditor", () => {
  it("a new draft shows 'Create order', no save bar until something changes, and Save sends ids only", async () => {
    const user = userEvent.setup();
    saveDraftOrderAction.mockResolvedValue({ ok: true, draft: DTO });
    render(<DraftOrderEditor draft={null} canEdit canMarkPaid={false} t={en} locale="en" />);
    expect(screen.getByRole("heading", { name: "Create order" })).toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    await user.type(screen.getByLabelText("Note"), "call first");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    const [, , input] = saveDraftOrderAction.mock.calls[0] ?? [];
    expect(JSON.stringify(input)).not.toMatch(/unitPrice|lineTotal/);
    expect(replace).toHaveBeenCalledWith(`/draft-orders/${DTO.id}`);
  });

  it("Discard returns to the saved draft", async () => {
    const user = userEvent.setup();
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    await user.type(screen.getByLabelText("Note"), "!");
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByLabelText("Note")).toHaveValue("call first");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("Mark as paid is disabled for non-admins, with the reason (spec §4.9)", async () => {
    const user = userEvent.setup();
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid={false} t={en} locale="en" />);
    await user.click(screen.getByRole("button", { name: "Collect payment" }));
    const item = screen.getByRole("menuitem", { name: /Mark as paid/ });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Only admins can mark an order as paid")).toBeInTheDocument();
  });

  it("a viewer sees the draft read-only (no Save, no Send invoice)", () => {
    render(<DraftOrderEditor draft={DTO} canEdit={false} canMarkPaid={false} t={en} locale="en" />);
    expect(screen.queryByRole("button", { name: "Send invoice" })).toBeNull();
    expect(screen.getByLabelText("Note")).toHaveAttribute("readonly");
  });

  it("a completed draft is read-only with a banner linking its order", () => {
    render(
      <DraftOrderEditor
        draft={{ ...DTO, status: "completed", order: { id: "o-1", orderNumber: "1001" } }}
        canEdit
        canMarkPaid
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByText("This draft order was completed.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View order #1001" })).toHaveAttribute(
      "href",
      "/orders/o-1",
    );
    expect(screen.queryByRole("button", { name: "Collect payment" })).toBeNull();
  });

  it("Send invoice saves first when there are unsaved changes", async () => {
    const user = userEvent.setup();
    saveDraftOrderAction.mockResolvedValue({ ok: true, draft: DTO });
    sendDraftInvoiceAction.mockResolvedValue({ ok: true, url: "https://s/c/x", shopName: "Shop" });
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    await user.type(screen.getByLabelText("Note"), "!");
    await user.click(screen.getByRole("button", { name: "Send invoice" }));
    expect(saveDraftOrderAction).toHaveBeenCalledBefore(sendDraftInvoiceAction);
    expect(await screen.findByDisplayValue("https://s/c/x")).toBeInTheDocument();
  });
});
```

(`DTO` as in Step 1; `replace` is the mocked router's `replace`; `toHaveBeenCalledBefore` comes from `jest-extended` only if the repo has it — otherwise compare `mock.invocationCallOrder[0]`. Prettier-format.)

`apps/admin-web/src/components/draft-orders/send-invoice-dialog.test.tsx` — copy `recovery-card.test.tsx`'s clipboard cases: with `navigator.clipboard.writeText` rejecting, "Copy link" leaves the link in a read-only, selected field and never shows "Copied"; "Share on WhatsApp" opens `https://wa.me/201001234567?text=…` (phone `01001234567`, country `EG`) with the Egyptian message when the locale is `ar`.

`apps/admin-web/src/components/draft-orders/draft-payment-card.test.tsx`: the totals rows render from the DTO; "Calculated after an address is added" when `taxMinor` is null; "Save to update totals" when `dirty`; the discount dialog's Apply writes `{ valueType: "percentage", value: 10, reason: "" }` to `onChange`; the shipping dialog with no saved address says "Add products and a shipping address first."

Then write the components:

`apps/admin-web/src/components/draft-orders/draft-order-editor.tsx`:

```tsx
"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, MoreHorizontalIcon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Label,
} from "@platform/ui";
import {
  completeDraftOrderAction,
  deleteDraftOrderAction,
  saveDraftOrderAction,
  sendDraftInvoiceAction,
} from "@/app/draft-orders/actions";
import { TagInput } from "@/components/orders/tag-input";
import { DRAFT_BADGE } from "@/components/draft-orders/draft-orders-table";
import type { DraftOrderDto, DraftPayment } from "@/lib/api/draft-orders";
import type { Locale } from "@/lib/i18n";
import {
  formFromDraft,
  inputFromForm,
  sameDraftForm,
  type DraftForm,
} from "@/lib/orders/draft-orders";
import type { Dictionary } from "@/messages/en";
import { DraftCustomerCard } from "./draft-customer-card";
import { DraftPaymentCard } from "./draft-payment-card";
import { DraftProductsCard } from "./draft-products-card";
import { SendInvoiceDialog } from "./send-invoice-dialog";

/**
 * Shopify's draft order page (spec §4.9): Products and Payment on the left; Notes, Customer and Tags on
 * the right; a save bar while there are unsaved changes. The browser holds only ids, quantities and the
 * merchant's own terms — the server prices every line on save (Ruling 12). Send invoice and Collect
 * payment save first. Client component: it imports server ACTIONS and only TYPES from `lib/api`.
 */
export function DraftOrderEditor({
  draft: initial,
  canEdit,
  canMarkPaid,
  t,
  locale,
}: {
  readonly draft: DraftOrderDto | null;
  readonly canEdit: boolean;
  readonly canMarkPaid: boolean;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const e = t.draftOrders.editor;
  const router = useRouter();
  const [saved, setSaved] = useState<DraftOrderDto | null>(initial);
  const [form, setForm] = useState<DraftForm>(() => formFromDraft(initial));
  const [fields, setFields] = useState<Readonly<Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [invoice, setInvoice] = useState<{
    readonly url: string;
    readonly shopName: string;
  } | null>(null);
  const busy = useRef(false);

  const completed = saved?.status === "completed";
  const editable = canEdit && !completed;
  const base = useMemo(() => formFromDraft(saved), [saved]);
  const dirty = editable && !sameDraftForm(form, base);
  const update = (next: Partial<DraftForm>) => setForm((current) => ({ ...current, ...next }));

  /** Saves when there is something to save; answers the saved draft or null (and shows why). */
  async function persist(): Promise<DraftOrderDto | null> {
    if (saved !== null && !dirty) return saved;
    const result = await saveDraftOrderAction(
      saved?.id ?? null,
      saved?.version ?? null,
      inputFromForm(form, e.discountDialog.defaultReason),
    );
    if (!result.ok) {
      setError(result.message);
      setFields(result.fields);
      return null;
    }
    setError(null);
    setFields({});
    setSaved(result.draft);
    setForm(formFromDraft(result.draft));
    if (saved === null) router.replace(`/draft-orders/${result.draft.id}`);
    return result.draft;
  }

  /** One action at a time: a second press while one runs is ignored. */
  function run(work: () => Promise<void>): void {
    if (busy.current) return;
    busy.current = true;
    startTransition(async () => {
      try {
        await work();
      } catch {
        setError(e.errors.generic);
      } finally {
        busy.current = false;
      }
    });
  }

  const save = () => run(async () => void (await persist()));
  const discard = () => {
    setForm(base);
    setFields({});
    setError(null);
  };
  const sendInvoice = () =>
    run(async () => {
      const current = await persist();
      if (current === null) return;
      const sent = await sendDraftInvoiceAction(current.id);
      if (!sent.ok) return setError(sent.message);
      setInvoice({ url: sent.url, shopName: sent.shopName });
    });
  const collect = (payment: DraftPayment, confirmText: string) =>
    run(async () => {
      const current = await persist();
      if (current === null || !window.confirm(confirmText)) return;
      const done = await completeDraftOrderAction(current.id, payment);
      if (!done.ok) return setError(done.message);
      router.push(`/orders/${done.orderId}`);
    });
  const remove = () =>
    run(async () => {
      if (
        saved === null ||
        !window.confirm(e.confirmDelete.replace("{draft}", () => saved.draftNumber))
      )
        return;
      const result = await deleteDraftOrderAction(saved.id);
      if (!result.ok) setError(result.message);
    });

  const title = saved === null ? e.newTitle : `#${saved.draftNumber}`;
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="-ms-2">
          <Link href="/draft-orders">
            <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
            {e.back}
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {saved !== null && (
          <Badge variant={DRAFT_BADGE[saved.status]}>{t.draftOrders.status[saved.status]}</Badge>
        )}
        {editable && saved !== null && (
          <div className="ms-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <MoreHorizontalIcon aria-hidden="true" />
                  {e.moreActions}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={remove} className="text-destructive">
                  {e.deleteDraft}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {completed && saved?.order != null && (
        <p
          role="status"
          className="bg-success-subtle text-success-foreground flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3 text-sm"
        >
          {e.completedBanner}
          <Link
            href={`/orders/${encodeURIComponent(saved.order.id)}`}
            className="font-medium underline"
          >
            {e.viewOrder.replace("{number}", () => saved.order?.orderNumber ?? "")}
          </Link>
        </p>
      )}

      {dirty && (
        <div className="bg-background/95 sticky top-16 z-20 flex flex-wrap items-center justify-end gap-3 py-2 backdrop-blur">
          <span className="text-muted-foreground me-auto text-sm">{e.unsaved}</span>
          <Button variant="outline" onClick={discard} disabled={pending}>
            {e.discard}
          </Button>
          <Button onClick={save} loading={pending} disabled={pending}>
            {pending ? e.saving : e.save}
          </Button>
        </div>
      )}
      {error !== null && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <DraftProductsCard
            lines={form.lines}
            onChange={(lines) => update({ lines })}
            errors={fields}
            editable={editable}
            currency={saved?.currency ?? null}
            t={t}
            locale={locale}
          />
          <DraftPaymentCard
            draft={saved}
            form={form}
            dirty={dirty}
            editable={editable}
            canMarkPaid={canMarkPaid}
            pending={pending}
            onDiscount={(discount) => update({ discount })}
            onShipping={(shipping) => update({ shipping })}
            saveFirst={persist}
            onSendInvoice={sendInvoice}
            onCollect={collect}
            errors={fields}
            t={t}
            locale={locale}
          />
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{e.notes.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <Label htmlFor="draft-note" className="sr-only">
                {e.notes.label}
              </Label>
              <textarea
                id="draft-note"
                aria-label={e.notes.label}
                dir="auto"
                rows={3}
                maxLength={5000}
                readOnly={!editable}
                value={form.note}
                placeholder={e.notes.placeholder}
                onChange={(event) => update({ note: event.target.value })}
                className="border-input bg-card focus-visible:ring-ring min-h-20 w-full rounded-xl border px-3.5 py-2 text-base focus-visible:outline-none focus-visible:ring-2"
              />
            </CardContent>
          </Card>
          <DraftCustomerCard
            form={form}
            onChange={update}
            errors={fields}
            editable={editable}
            t={t}
            locale={locale}
          />
          <Card>
            <CardHeader>
              <CardTitle>{e.tags.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <TagInput
                label={e.tags.label}
                tags={form.tags}
                disabled={!editable}
                maxTags={250}
                onAdd={(added) =>
                  update({
                    tags: [
                      ...form.tags,
                      ...added.filter(
                        (tag) => !form.tags.some((t2) => t2.toLowerCase() === tag.toLowerCase()),
                      ),
                    ],
                  })
                }
                onRemove={(tag) => update({ tags: form.tags.filter((t2) => t2 !== tag) })}
                t={t}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {invoice !== null && saved !== null && (
        <SendInvoiceDialog
          url={invoice.url}
          shopName={invoice.shopName}
          draftNumber={saved.draftNumber}
          total={saved.totals.totalMinor}
          currency={saved.currency}
          form={form}
          onClose={() => setInvoice(null)}
          t={t}
          locale={locale}
        />
      )}
    </div>
  );
}
```

`apps/admin-web/src/components/draft-orders/draft-products-card.tsx` — a `Card` titled `e.products.title` with: a "Browse" `Button` (hidden when `!editable`) opening `DraftProductPicker`; when `lines` is empty, `e.products.empty`; otherwise one row per line — `LineThumb`-style 48px image (reuse the abandoned detail page's line markup), title (`dir="auto"`), `variantTitle` and SKU in muted text, a number `Input` (`min=1`, `max=9999`, `aria-label={e.products.quantity.replace("{title}", …)}`, `readOnly={!editable}`) that calls `onChange` with the new quantity, the unit price (`formatCurrency(locale, unitPriceMinor, currency)` when both are known, else `e.products.pricedOnSave`) and a remove icon button (`aria-label={e.products.remove…}`). A field error `errors["lines.N"]` or `errors["lines.N.quantity"]` renders under its row (`role="alert"`). Adding a variant that is already a line increments its quantity (the server merges too, Ruling 20).

`apps/admin-web/src/components/draft-orders/draft-product-picker.tsx` — a `Dialog` (`e.picker.title`) with a search `Input` debounced 300 ms calling `searchDraftProductsAction(q)` (loading / no-results states); choosing a product calls `draftProductVariantsAction(productId)`: one variant → `onAdd(line)` at once; several → a list of variants (`e.picker.variants`) each with "Add". `onAdd` receives a `DraftFormLine` with `quantity: 1` and the picker's display price. A stale response (an older search answering after a newer one) is dropped (request counter in a ref).

`apps/admin-web/src/components/draft-orders/draft-payment-card.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@platform/ui";
import { draftShippingRatesAction } from "@/app/draft-orders/actions";
import type { DraftOrderDto, DraftPayment, DraftShippingRateDto } from "@/lib/api/draft-orders";
import { formatCurrency } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { DraftForm, DraftFormShipping } from "@/lib/orders/draft-orders";
import { fromMinorUnits, toMinorUnits } from "@/lib/products/money";
import type { Dictionary } from "@/messages/en";

/** Shopify's Payment card: totals from the LAST SAVE (Ruling 14), the discount and shipping dialogs, and the two actions. */
export function DraftPaymentCard(props: {
  readonly draft: DraftOrderDto | null;
  readonly form: DraftForm;
  readonly dirty: boolean;
  readonly editable: boolean;
  readonly canMarkPaid: boolean;
  readonly pending: boolean;
  readonly onDiscount: (discount: DraftForm["discount"]) => void;
  readonly onShipping: (shipping: DraftFormShipping) => void;
  /** Saves pending changes first (Ruling 15); null when the save failed. */
  readonly saveFirst: () => Promise<DraftOrderDto | null>;
  readonly onSendInvoice: () => void;
  readonly onCollect: (payment: DraftPayment, confirmText: string) => void;
  readonly errors: Readonly<Record<string, string>>;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const { draft, form, dirty, editable, canMarkPaid, pending, t, locale } = props;
  const p = t.draftOrders.editor.payment;
  const currency = draft?.currency ?? "EGP";
  const money = (minor: number) => formatCurrency(locale, minor, currency);
  const totals = draft?.totals ?? null;
  const [discountOpen, setDiscountOpen] = useState(false);
  const [shippingOpen, setShippingOpen] = useState(false);
  const missing = draft?.missing ?? {
    invoice: ["lines", "shipping_address", "shipping"],
    complete: ["lines", "shipping_address", "shipping", "email"],
  };
  const total = totals === null ? "" : money(totals.totalMinor);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{p.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <dl className={dirty ? "flex flex-col gap-2 opacity-60" : "flex flex-col gap-2"}>
          <Row label={p.subtotal} value={totals === null ? "—" : money(totals.subtotalMinor)} />
          <Row
            label={
              editable ? (
                <Button variant="link" className="h-auto p-0" onClick={() => setDiscountOpen(true)}>
                  {form.discount === null ? p.addDiscount : p.discount}
                </Button>
              ) : (
                p.discount
              )
            }
            value={
              totals === null || totals.discountMinor === 0
                ? "—"
                : `−${money(totals.discountMinor)}`
            }
          />
          <Row
            label={
              editable ? (
                <Button variant="link" className="h-auto p-0" onClick={() => setShippingOpen(true)}>
                  {form.shipping === null ? p.addShipping : p.shipping}
                </Button>
              ) : (
                p.shipping
              )
            }
            value={
              totals === null || form.shipping === null
                ? "—"
                : totals.shippingMinor === 0
                  ? p.free
                  : money(totals.shippingMinor)
            }
          />
          <Row
            label={p.tax}
            value={
              totals?.taxMinor == null
                ? p.taxPending
                : totals.taxIncluded
                  ? p.taxIncluded.replace("{tax}", () => money(totals.taxMinor ?? 0))
                  : money(totals.taxMinor)
            }
          />
          <Row
            label={<strong>{p.total}</strong>}
            value={<strong>{totals === null ? "—" : total}</strong>}
          />
        </dl>
        {dirty && <p className="text-muted-foreground text-xs">{p.saveToUpdate}</p>}
        {editable && (
          <>
            {missing.invoice.length > 0 && (
              <ul className="text-muted-foreground list-disc ps-5 text-xs">
                {missing.invoice.map((m) => (
                  <li key={m}>{t.draftOrders.editor.missing[m]}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button variant="outline" onClick={props.onSendInvoice} disabled={pending}>
                {p.sendInvoice}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button disabled={pending}>
                    {p.collectPayment}
                    <ChevronDownIcon aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuItem
                          disabled={!canMarkPaid}
                          aria-disabled={!canMarkPaid}
                          onSelect={() =>
                            props.onCollect(
                              "paid",
                              p.confirmMarkAsPaid.replace("{total}", () => total),
                            )
                          }
                        >
                          {p.markAsPaid}
                        </DropdownMenuItem>
                      </TooltipTrigger>
                      {!canMarkPaid && <TooltipContent>{p.markAsPaidAdminOnly}</TooltipContent>}
                    </Tooltip>
                  </TooltipProvider>
                  {!canMarkPaid && (
                    <p className="text-muted-foreground px-2 pb-1 text-xs">
                      {p.markAsPaidAdminOnly}
                    </p>
                  )}
                  <DropdownMenuItem
                    onSelect={() =>
                      props.onCollect(
                        "collect_on_delivery",
                        p.confirmCollect.replace("{total}", () => total),
                      )
                    }
                  >
                    {p.collectOnDelivery}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
      </CardContent>
      {discountOpen && (
        <DiscountDialog
          current={form.discount}
          currency={currency}
          onApply={props.onDiscount}
          onClose={() => setDiscountOpen(false)}
          t={t}
        />
      )}
      {shippingOpen && (
        <ShippingDialog
          current={form.shipping}
          currency={currency}
          saveFirst={props.saveFirst}
          onApply={props.onShipping}
          onClose={() => setShippingOpen(false)}
          t={t}
          locale={locale}
        />
      )}
    </Card>
  );
}

function Row({ label, value }: { readonly label: ReactNode; readonly value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function DiscountDialog({
  current,
  currency,
  onApply,
  onClose,
  t,
}: {
  readonly current: DraftForm["discount"];
  readonly currency: string;
  readonly onApply: (discount: DraftForm["discount"]) => void;
  readonly onClose: () => void;
  readonly t: Dictionary;
}) {
  const d = t.draftOrders.editor.discountDialog;
  const [valueType, setValueType] = useState<"fixed" | "percentage">(current?.valueType ?? "fixed");
  const [text, setText] = useState(
    current === null
      ? ""
      : current.valueType === "fixed"
        ? fromMinorUnits(current.value, currency)
        : String(current.value),
  );
  const [reason, setReason] = useState(current?.reason ?? "");
  const value =
    valueType === "fixed"
      ? toMinorUnits(text, currency)
      : /^\d{1,3}$/.test(text.trim())
        ? Number(text.trim())
        : null;
  const valid =
    value !== null && value >= 0 && (valueType === "fixed" ? value <= 10_000_000 : value <= 100);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{d.title}</DialogTitle>
        </DialogHeader>
        <fieldset className="flex gap-4">
          <legend className="sr-only">{d.type}</legend>
          {(["fixed", "percentage"] as const).map((type) => (
            <label key={type} className="flex items-center gap-2">
              <input
                type="radio"
                name="discount-type"
                checked={valueType === type}
                onChange={() => setValueType(type)}
              />
              {d[type]}
            </label>
          ))}
        </fieldset>
        <Label htmlFor="discount-value">{d.value}</Label>
        <Input
          id="discount-value"
          inputMode="decimal"
          dir="ltr"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <Label htmlFor="discount-reason">{d.reason}</Label>
        <Input
          id="discount-reason"
          dir="auto"
          maxLength={255}
          value={reason}
          placeholder={d.defaultReason}
          onChange={(event) => setReason(event.target.value)}
        />
        <DialogFooter>
          {current !== null && (
            <Button
              variant="outline"
              onClick={() => {
                onApply(null);
                onClose();
              }}
            >
              {d.remove}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            {d.cancel}
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              if (value !== null) onApply({ valueType, value, reason });
              onClose();
            }}
          >
            {d.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShippingDialog({
  current,
  currency,
  saveFirst,
  onApply,
  onClose,
  t,
  locale,
}: {
  readonly current: DraftFormShipping;
  readonly currency: string;
  readonly saveFirst: () => Promise<DraftOrderDto | null>;
  readonly onApply: (shipping: DraftFormShipping) => void;
  readonly onClose: () => void;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const s = t.draftOrders.editor.shippingDialog;
  const [kind, setKind] = useState<"rate" | "custom" | "free">(current?.kind ?? "rate");
  const [rates, setRates] = useState<readonly DraftShippingRateDto[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [method, setMethod] = useState(current?.kind === "rate" ? current.method : "");
  const [title, setTitle] = useState(current?.kind === "custom" ? current.title : "");
  const [price, setPrice] = useState(
    current?.kind === "custom" ? fromMinorUnits(current.amountMinor, currency) : "",
  );
  // Ruling 15: rates are for the SAVED draft's address — save first, then ask. Once per opening.
  const saveFirstRef = useRef(saveFirst);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const draft = await saveFirstRef.current();
      if (cancelled) return;
      if (draft === null || draft.shippingAddress === null || draft.lines.length === 0) {
        setMessage(s.needsAddress);
        setRates([]);
        return;
      }
      const result = await draftShippingRatesAction(draft.id);
      if (cancelled) return;
      if (!result.ok) {
        setMessage(result.message);
        setRates([]);
        return;
      }
      setRates(result.rates);
      if (result.rates.length === 0) setMessage(s.noRates);
    })();
    return () => {
      cancelled = true;
    };
  }, [s.needsAddress, s.noRates]);

  const amount = toMinorUnits(price, currency);
  const chosenRate = rates?.find((r) => r.method === method);
  const valid =
    kind === "free" ||
    (kind === "rate" && chosenRate !== undefined) ||
    (kind === "custom" &&
      title.trim() !== "" &&
      amount !== null &&
      amount >= 0 &&
      amount <= 10_000_000);
  const apply = () => {
    if (kind === "free") onApply({ kind: "free" });
    else if (kind === "rate" && chosenRate !== undefined)
      onApply({
        kind: "rate",
        method: chosenRate.method,
        title: chosenRate.title,
        amountMinor: chosenRate.amountMinor,
      });
    else if (kind === "custom" && amount !== null)
      onApply({ kind: "custom", title: title.trim(), amountMinor: amount });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{s.title}</DialogTitle>
        </DialogHeader>
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">{s.title}</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="shipping-kind"
              checked={kind === "rate"}
              onChange={() => setKind("rate")}
            />
            {s.rates}
          </label>
          {kind === "rate" && (
            <div className="flex flex-col gap-2 ps-6">
              {rates === null && <p className="text-muted-foreground">{s.loading}</p>}
              {message !== null && <p className="text-muted-foreground">{message}</p>}
              {rates?.map((rate) => (
                <label key={rate.method} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="shipping-rate"
                    checked={method === rate.method}
                    onChange={() => setMethod(rate.method)}
                  />
                  <span dir="auto">{rate.title}</span>
                  <span className="text-muted-foreground ms-auto tabular-nums">
                    {formatCurrency(locale, rate.amountMinor, currency)}
                  </span>
                </label>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="shipping-kind"
              checked={kind === "custom"}
              onChange={() => setKind("custom")}
            />
            {s.custom}
          </label>
          {kind === "custom" && (
            <div className="grid gap-2 ps-6 sm:grid-cols-2">
              <Label htmlFor="shipping-title">{s.name}</Label>
              <Input
                id="shipping-title"
                dir="auto"
                maxLength={100}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <Label htmlFor="shipping-price">{s.price}</Label>
              <Input
                id="shipping-price"
                inputMode="decimal"
                dir="ltr"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </div>
          )}
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="shipping-kind"
              checked={kind === "free"}
              onChange={() => setKind("free")}
            />
            {s.free}
          </label>
        </fieldset>
        <DialogFooter>
          {current !== null && (
            <Button
              variant="outline"
              onClick={() => {
                onApply(null);
                onClose();
              }}
            >
              {s.remove}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            {s.cancel}
          </Button>
          <Button disabled={!valid} onClick={apply}>
            {s.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

(Imports for this file also need `useEffect`, `useRef` from `react` and `type ReactNode` for `Row`'s props. Prettier-format.)

`apps/admin-web/src/components/draft-orders/draft-customer-card.tsx` — a `Card` (`e.customer.title`) with:

- when `form.customer` is set: the customer's name and email and a "Remove customer" button (editable only);
- otherwise a search `Input` (`e.customer.search`, debounced 300 ms, ≥ 2 characters) listing `searchDraftCustomersAction(q)` results as buttons; choosing one sets `customer` (and fills `email` when it is empty); "no results" shows `e.customer.noResults`;
- guest fields `Email` (`type="email"`, `dir="ltr"`) and `Phone` (`type="tel"`, `dir="ltr"`), field errors `errors.email` / `errors.phone` under them (`role="alert"`);
- **Shipping address**: "Add shipping address" (sets `EMPTY_DRAFT_ADDRESS`) or the address fields — recipient name, recipient phone, line 1, line 2, city, a governorate `<select>` when `hasProvinces(country)` (options `PROVINCES[country]` named with `provinceName(code, locale)`), postal code, and a country `<select>` over `COUNTRY_CODES` named with `countryName(code, locale)`; changing the country clears the province; errors `errors["shippingAddress.<field>"]` beside each field;
- **Billing address**: a checkbox "Same as shipping address" (`billingSame`), and the same fields for `billingAddress` when unchecked.
  All inputs are `readOnly`/`disabled` when `!editable`; layout uses logical utilities (`ms-`, `ps-`, `text-start`).

`apps/admin-web/src/components/draft-orders/send-invoice-dialog.tsx` — Part 3's `RecoveryCard` pattern in a `Dialog` (`e.invoice.title`): the link in a read-only `dir="ltr"` field (selected on focus), **Copy link** (shows "Copied" only after a real clipboard write; on refusal focuses and selects the field), **Share on WhatsApp** opening a nested edit step with a `textarea` prefilled by `invoiceMessage(name === "" ? e.invoice.messageNoName : e.invoice.message, { name, draft: draftNumber, shop: shopName, total: formatCurrency(locale, total, currency), url })` where `name` is the shipping recipient or the customer's name, and **Open WhatsApp** → `window.open(whatsAppUrl(toWhatsAppDigits(target.phone, target.country), message), "_blank", "noopener,noreferrer")` with `target = draftWhatsAppTarget(form)`; then the disabled line `e.invoice.email` and the note `e.invoice.expires`. The URL is never logged.

Run: `pnpm --filter admin-web exec vitest run src/components/draft-orders src/app/draft-orders src/lib/orders/draft-orders.test.ts` → PASS.

- [ ] **Step 7: Gates**

Run: `pnpm --filter admin-web test`, `pnpm --filter admin-web typecheck`, `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint` → green. Confirm no client component value-imports `@/lib/api/*` or `@/lib/auth/*`: `grep -rn "from \"@/lib/api\|from \"@/lib/auth" apps/admin-web/src/components/draft-orders` must show only `import type` lines (binding carry 10).

- [ ] **Step 8: Commit**

```bash
git add apps/admin-web/src/lib/orders/draft-orders.ts apps/admin-web/src/lib/orders/draft-orders.test.ts \
  apps/admin-web/src/app/draft-orders/actions.ts apps/admin-web/src/app/draft-orders/actions.test.ts \
  apps/admin-web/src/app/draft-orders/new/page.tsx "apps/admin-web/src/app/draft-orders/[draftId]/page.tsx" \
  apps/admin-web/src/components/draft-orders/draft-order-editor.tsx \
  apps/admin-web/src/components/draft-orders/draft-order-editor.test.tsx \
  apps/admin-web/src/components/draft-orders/draft-products-card.tsx \
  apps/admin-web/src/components/draft-orders/draft-product-picker.tsx \
  apps/admin-web/src/components/draft-orders/draft-payment-card.tsx \
  apps/admin-web/src/components/draft-orders/draft-payment-card.test.tsx \
  apps/admin-web/src/components/draft-orders/draft-customer-card.tsx \
  apps/admin-web/src/components/draft-orders/send-invoice-dialog.tsx \
  apps/admin-web/src/components/draft-orders/send-invoice-dialog.test.tsx \
  apps/admin-web/src/messages/en.ts apps/admin-web/src/messages/ar.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin-web): draft order editor with send invoice and collect payment

Shopify's draft page: products with a picker, the payment card with discount and shipping
dialogs, customer and addresses, notes and tags, and a save bar. Send invoice and Collect
payment save first; Mark as paid is admin-only. The invoice link copies or opens WhatsApp
with an editable Egyptian Arabic or English message.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: Storefront — the invoice landing page and the checkout locked to the merchant's terms

Model tier: **standard**.

**Files:**

- Modify: `apps/storefront/src/lib/runtime-api.ts` (preview and session types)
- Modify: `apps/storefront/src/app/c/[token]/page.tsx`, `page.test.tsx` (append cases)
- Modify: `apps/storefront/src/app/c/[token]/actions.ts`, `actions.test.ts` (append cases)
- Modify: `apps/storefront/src/components/checkout-view.tsx`, `checkout-view.test.tsx` (append a `describe`)
- Modify: `apps/storefront/src/app/checkout/page.tsx` (no "Back to cart" on an invoice checkout)
- Modify: `apps/storefront/src/messages/en.ts`, `apps/storefront/src/messages/ar.ts`

**Interfaces:**

- Consumes (Tasks 4, 7): `PublicCheckoutSessionDto.draftInvoice`, `discount.applied`, `totals.shippingName`; the preview's `purpose`, `draftNumber`, `completed`; the claim's 409 codes `ALREADY_COMPLETED`, `DRAFT_NOT_READY`, `DRAFT_BUSY`, `ITEMS_UNAVAILABLE`.
- Produces: `CheckoutLinkPreview { purpose: "recovery" | "invoice"; draftNumber: string | null; completed: boolean; … }`; `CheckoutSessionSummary.draftInvoice?: { draftNumber: string } | null` and `.discount?: { applied: readonly { title: string; amountMinor: number }[] }`; `CheckoutTotalsSummary.discountMinor?: number`; claim errors `"completed"` and `"notReady"`; `t.invoice.*`, `t.recovery.errors.completed/notReady`, `t.checkout.invoiceBadge`, `t.checkout.summary.discount`, `t.checkout.fixedShippingHint`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/storefront/src/app/c/[token]/actions.test.ts`:

```ts
describe("claimCheckoutLink — invoice links (order operations Part 4)", () => {
  it("a completed draft goes back to the page with error=completed", async () => {
    jar.set("morbeh-storefront-guest-session", "guest-1");
    claimApi.mockResolvedValue({
      status: 409,
      body: { code: "ALREADY_COMPLETED", message: "ALREADY_COMPLETED: placed" },
    });
    await expect(claimCheckoutLink(TOKEN)).rejects.toThrow(
      `NEXT_REDIRECT /c/${TOKEN}?error=completed`,
    );
    expect(set).not.toHaveBeenCalledWith(
      "morbeh_checkout_session",
      expect.anything(),
      expect.anything(),
    );
  });

  it("an invoice that cannot be paid right now says so (error=notReady)", async () => {
    jar.set("morbeh-storefront-guest-session", "guest-1");
    claimApi.mockResolvedValue({ status: 409, body: { code: "DRAFT_NOT_READY" } });
    await expect(claimCheckoutLink(TOKEN)).rejects.toThrow(
      `NEXT_REDIRECT /c/${TOKEN}?error=notReady`,
    );
  });

  it("a recovery link with nothing left to sell is still 'unavailable'", async () => {
    jar.set("morbeh-storefront-guest-session", "guest-1");
    claimApi.mockResolvedValue({ status: 409, body: { code: "ITEMS_UNAVAILABLE" } });
    await expect(claimCheckoutLink(TOKEN)).rejects.toThrow(
      `NEXT_REDIRECT /c/${TOKEN}?error=unavailable`,
    );
  });
});
```

Append to `apps/storefront/src/app/c/[token]/page.test.tsx` (it already mocks `getCheckoutLinkPreview`; reuse its render helper):

```tsx
describe("invoice links (order operations Part 4)", () => {
  const invoice = {
    purpose: "invoice" as const,
    draftNumber: "D3",
    completed: false,
    shopName: "Nile Shop",
    itemCount: 2,
    items: [{ title: "Tee", variantTitle: "M", quantity: 2, imageUrl: null }],
    totalMinor: 49000,
    currency: "EGP",
  };

  it("shows 'Invoice #D3', the shop, the total and ONE 'Pay now' button — claiming nothing on render", async () => {
    preview.mockResolvedValue({ status: 200, body: invoice });
    await renderPage(TOKEN);
    expect(screen.getByRole("heading", { name: "Invoice #D3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay now" })).toBeInTheDocument();
    expect(claimApi).not.toHaveBeenCalled();
  });

  it("a completed invoice says the order was already placed, with no button", async () => {
    preview.mockResolvedValue({ status: 200, body: { ...invoice, completed: true } });
    await renderPage(TOKEN);
    expect(screen.getByText("This order has already been placed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay now" })).toBeNull();
  });

  it("speaks Modern Standard Arabic", async () => {
    preview.mockResolvedValue({ status: 200, body: invoice });
    await renderPage(TOKEN, "ar");
    expect(screen.getByRole("button", { name: "ادفع الآن" })).toBeInTheDocument();
  });
});
```

(Adapt `renderPage`/`preview`/`claimApi` to the helpers the file already defines; the locale cookie is set the way the existing Arabic case sets it.)

Append to `apps/storefront/src/components/checkout-view.test.tsx`:

```tsx
describe("CheckoutView on an invoice checkout (spec §4.10)", () => {
  const ADDRESS = {
    name: "Mona Ali",
    phone: "01001234567",
    line1: "5 Nile St",
    city: "Cairo",
    postalCode: "",
    country: "EG",
    province: "EG-C",
  };
  const draftSession: CheckoutSessionSummary = {
    ...SESSION,
    shippingAddress: ADDRESS,
    billingAddress: ADDRESS,
    contactEmail: "sara@example.com",
    selectedShippingMethod: "draft",
    totals: {
      subtotalMinor: 50000,
      shippingMinor: 4000,
      taxMinor: 0,
      grandTotalMinor: 49000,
      taxIncluded: true,
      shippingName: "Courier",
      discountMinor: 5000,
    },
    draftInvoice: { draftNumber: "D3" },
    discount: { applied: [{ title: "Loyal customer", amountMinor: 5000 }] },
  };

  it("shows the fixed shipping and the draft's discount, offers no shipping choice and asks for no quote", async () => {
    render(
      <CheckoutView
        session={draftSession}
        t={en}
        locale="en"
        paymentMethods={["cod"]}
        shippableCountries={COUNTRIES}
      />,
    );
    expect(screen.getByText("Invoice #D3")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: STANDARD })).toBeNull();
    expect(screen.getAllByText(/Courier/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Loyal customer/)).toBeInTheDocument();
    await waitFor(() => expect(requestShippingQuote).not.toHaveBeenCalled());
  });

  it("placing the order saves the address but never quotes or selects shipping", async () => {
    render(
      <CheckoutView
        session={draftSession}
        t={en}
        locale="en"
        paymentMethods={["cod"]}
        shippableCountries={COUNTRIES}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: en.checkout.placeOrder }));
    await waitFor(() => expect(completeCheckout).toHaveBeenCalled());
    expect(requestShippingQuote).not.toHaveBeenCalled();
    expect(selectShipping).not.toHaveBeenCalled();
  });
});
```

(`SESSION`, `COUNTRIES` and the "Complete order" button text are the file's existing fixtures/keys — use their actual names.)

Run: `pnpm --filter storefront exec vitest run "src/app/c/[token]" src/components/checkout-view.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Types**

`apps/storefront/src/lib/runtime-api.ts`:

```ts
/** Order operations Parts 3–4: what a recovery or invoice link holds — shop, items, total; no personal data. */
export interface CheckoutLinkPreview {
  readonly purpose: "recovery" | "invoice";
  /** "D3" for an invoice; null for recovery. */
  readonly draftNumber: string | null;
  /** Invoice only: the order was already placed. */
  readonly completed: boolean;
  readonly shopName: string;
  readonly itemCount: number;
  readonly items: readonly {
    readonly title: string | null;
    readonly variantTitle: string | null;
    readonly quantity: number;
    readonly imageUrl: string | null;
  }[];
  readonly totalMinor: number;
  readonly currency: string;
}
```

`CheckoutTotalsSummary` gains `readonly discountMinor?: number;`. `CheckoutSessionSummary` gains:

```ts
  /** Part 4: this checkout pays a merchant's draft order — its discount and shipping are fixed. */
  readonly draftInvoice?: { readonly draftNumber: string } | null;
  /** The discounts taken off (titles and amounts only). */
  readonly discount?: { readonly applied: readonly { readonly title: string; readonly amountMinor: number }[] };
```

- [ ] **Step 3: The claim action**

`apps/storefront/src/app/c/[token]/actions.ts` — `failureOf` reads the body's `code`:

```ts
type ClaimFailure = "invalid" | "unavailable" | "completed" | "notReady" | "network";

function failureOf(status: number, body: unknown): ClaimFailure {
  if (status === 404) return "invalid";
  if (status === 409) {
    const code = (body as { readonly code?: unknown } | null)?.code;
    if (code === "ALREADY_COMPLETED") return "completed";
    if (code === "DRAFT_NOT_READY" || code === "DRAFT_BUSY") return "notReady";
    return "unavailable";
  }
  return "network";
}
```

and the last line becomes `redirect(\`/c/${token}?error=${failureOf(result.status, result.body)}\`);`. Update its doc comment: "Part 4: an invoice link's claim takes over the merchant's draft checkout for this browser; the same cookie and redirect apply."

- [ ] **Step 4: The landing page**

In `apps/storefront/src/app/c/[token]/page.tsx`:

- `CLAIM_ERRORS` becomes `["invalid", "unavailable", "completed", "notReady", "network"] as const`.
- `generateMetadata`: for an invoice, `const label = t.invoice.metaTitle.replace("{draft}", () => preview.draftNumber ?? "")` and the title is `${preview.shopName} — ${label}` (shop name only, no personal data).
- The card: `const isInvoice = preview.purpose === "invoice";` — heading `isInvoice ? t.invoice.title.replace("{draft}", () => preview.draftNumber ?? "") : t.recovery.title`; the "from shop" line uses `t.invoice.fromShop` for an invoice; the note under the total is `t.invoice.totalNote` for an invoice (the total is the merchant's quote, shipping included) and `t.recovery.pricesNote` otherwise.
- A completed invoice renders, instead of the card, `<StatePanel icon={<CheckCircleIcon className="size-6" />} title={t.invoice.completedTitle} body={t.invoice.completedBody} action={{ href: "/", label: t.recovery.backToShop }} />` — no form, no button.
- The button: `isInvoice ? t.invoice.pay : t.recovery.continue`, pending label `isInvoice ? t.invoice.paying : t.recovery.continuing`. The form still posts `claimCheckoutLink.bind(null, token)` — the claim happens only on the press (spec §3.8 decision).

- [ ] **Step 5: The checkout locked to the merchant's terms**

In `apps/storefront/src/components/checkout-view.tsx`, inside `CheckoutForm`:

1. `const draftMode = session.draftInvoice != null;`
2. `syncAddress`: right after `lastSavedRef.current = sig;` add

```ts
// Part 4: the merchant fixed the shipping — save the address (tax follows it), never quote.
if (draftMode) return true;
```

3. The reload effect: `if (draftMode || initialQuotesRequested.current || !hasSavedAddress) return;`
4. `const noRates = !draftMode && addressComplete && quotesLoaded && quotes.length === 0;`
5. In `placeOrder`, step 2's null check becomes `if (!draftMode && selectedRef.current === null) {`.
6. The "Shipping method" `Section` renders, when `draftMode`:

```tsx
            {draftMode ? (
              <p className="bg-muted/50 flex items-center justify-between rounded-md px-3 py-3 text-sm">
                <span dir="auto">{session.totals?.shippingName ?? t.checkout.summary.shipping}</span>
                <span className="font-medium">
                  {priceLabel(session.totals?.shippingMinor ?? 0, session.currency, locale, t)}
                </span>
              </p>
            ) : /* the existing noRates / hint / fieldset branches, unchanged */ }
```

with a muted `t.checkout.fixedShippingHint` line under it. 7. The form's title area shows `t.checkout.invoiceBadge.replace("{draft}", () => session.draftInvoice?.draftNumber ?? "")` as a small badge when `draftMode`. 8. `SummaryBody`: after the subtotal row, when `session.draftInvoice != null && (session.totals?.discountMinor ?? 0) > 0`:

```tsx
<SummaryRow
  label={session.discount?.applied[0]?.title ?? t.checkout.summary.discount}
  value={`−${formatCurrency(locale, session.totals?.discountMinor ?? 0, session.currency)}`}
/>
```

There is no discount-code field in this checkout today, so nothing else needs hiding; items are only shown, never edited.

In `apps/storefront/src/app/checkout/page.tsx`, render the "Back to cart" link only when the session is not an invoice checkout (`session?.body?.draftInvoice == null`) — the cart is not involved (spec §4.10).

- [ ] **Step 6: Strings (Modern Standard Arabic — binding carry 8)**

`apps/storefront/src/messages/en.ts`:

```ts
  /** Order operations Part 4 — an invoice link (`/c/<token>`) a merchant sent for a draft order. */
  invoice: {
    metaTitle: "Invoice #{draft}",
    title: "Invoice #{draft}",
    fromShop: "From {shop}",
    totalNote: "This is the total the store quoted, shipping included. Taxes are confirmed at checkout.",
    pay: "Pay now",
    paying: "Opening checkout…",
    completedTitle: "This order has already been placed",
    completedBody: "The store has received this order. Thank you!",
  },
```

and `recovery.errors` gains `completed: "This order has already been placed.",` and `notReady: "This invoice can't be paid right now. Please contact the store.",`; `checkout` gains `invoiceBadge: "Invoice #{draft}",` and `fixedShippingHint: "Shipping was set by the store for this order.",`; `checkout.summary` gains `discount: "Discount",`.

`apps/storefront/src/messages/ar.ts`:

```ts
  invoice: {
    metaTitle: "فاتورة #{draft}",
    title: "فاتورة #{draft}",
    fromShop: "من {shop}",
    totalNote: "هذا هو الإجمالي الذي حدده المتجر، شاملًا الشحن. تُحتسب الضرائب عند الدفع.",
    pay: "ادفع الآن",
    paying: "جارٍ فتح صفحة الدفع…",
    completedTitle: "تم تقديم هذا الطلب بالفعل",
    completedBody: "استلم المتجر هذا الطلب. شكرًا لك!",
  },
```

with `recovery.errors.completed: "تم تقديم هذا الطلب بالفعل.",`, `recovery.errors.notReady: "لا يمكن دفع هذه الفاتورة حاليًا. يُرجى التواصل مع المتجر.",`, `checkout.invoiceBadge: "فاتورة #{draft}",`, `checkout.fixedShippingHint: "حدّد المتجر الشحن لهذا الطلب.",`, `checkout.summary.discount: "الخصم",`.

Run the Step 1 tests → PASS.

- [ ] **Step 7: Gates**

Run: `pnpm --filter storefront test`, `pnpm --filter storefront typecheck`, `pnpm --filter storefront lint` → green. (`next build` is not used — EPERM on this machine.)

- [ ] **Step 8: Commit**

```bash
git add apps/storefront/src/lib/runtime-api.ts \
  "apps/storefront/src/app/c/[token]/page.tsx" "apps/storefront/src/app/c/[token]/page.test.tsx" \
  "apps/storefront/src/app/c/[token]/actions.ts" "apps/storefront/src/app/c/[token]/actions.test.ts" \
  apps/storefront/src/components/checkout-view.tsx apps/storefront/src/components/checkout-view.test.tsx \
  apps/storefront/src/app/checkout/page.tsx \
  apps/storefront/src/messages/en.ts apps/storefront/src/messages/ar.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(storefront): invoice landing page and the checkout locked to the quote

/c/<token> shows "Invoice #D3" with Pay now (claiming only on the press) or "This order has
already been placed". An invoice checkout shows the store's fixed shipping and discount,
never quotes or offers shipping methods, and keeps contact, address and payment open.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Final verification (after Task 10)

- [ ] `node scripts/dev/check-prisma-tenant-where.mjs` → only the known `discounts.admin-controller.ts:166` finding.
- [ ] `DATABASE_URL=postgresql://u:p@localhost:5432/x DIRECT_URL=postgresql://u:p@localhost:5432/x pnpm --filter @platform/db exec prisma validate` → valid. Never `prisma migrate`.
- [ ] For each of `@platform/db`, `@platform/auth`, `@platform/orders`, `@platform/checkout`, `@platform/payments`, `@platform/admin`, `admin-web`, `storefront`: `typecheck`, `lint` (with `NODE_OPTIONS=--max-old-space-size=8192` for the two admin apps) and `test` all green. Report that the `DATABASE_URL_TEST` integration suites were skipped unless a throwaway database was configured.
- [ ] `git status --short` shows nothing staged under `.superpowers/` or `.claude/`.
- [ ] E2E (spec §4.11, `apps/e2e`, only when an environment is available — never against production): create draft → send invoice → open the link in a fresh browser → pay COD → the draft shows Completed and the order exists with the custom discount.
- [ ] Deploy note for the owner (do NOT run it): apply `20261018000000_order_archive`, `20261018010000_order_notes_tags_timeline`, `20261018020000_checkout_recovery_links` and `20261018030000_draft_orders` in that order from Railway's Console before the release that reads them.

## Self-review (done while writing this plan)

1. **Spec coverage.** §4.1 aggregate in `services/orders` and the pipeline path → Tasks 1–2, 6–7; `/orders/new` redirect, legacy form removed, `POST /orders` kept → Task 8. §4.2 migration, D-numbers on the counter row, soft delete → Task 1 (+ Ruling 2 for the guarded writes). §4.3 catalog-only lines priced on save, ≤ 100 lines, one discount capped at the subtotal, shipping rate/custom/free, customer or guest, note and tags, totals with estimated tax, no stock reservation → Tasks 1, 6. §4.4 `draftTerms`, `applyDraftTerms`, `transferOwnership`, `refreshDiscounts` skip, usage adapter skip, `DRAFT_LOCKED` on items/shipping-quote/shipping-selection/discount codes, `draftInvoice` on the DTO → Tasks 3–4. §4.5 materialisation (reuse vs rebuild, old expired, server-minted `sessionRef`, validation, email for direct completion) → Tasks 4, 7. §4.6 completion (cod/manual selection, `draft:<id>:<version>` key, `InitiatePayment`, confirmed collection, mark completed, note/tags copy, `created_from_draft`), the `manual` provider, `DraftOrderCompletionPort` and self-heal → Tasks 2, 4, 5, 7. §4.7 invoice link (30 days, not idempotent, points to the draft, re-materialises), claim (deleted → 404, completed → 409, last opener owns), preview → Tasks 4, 7. §4.8 every route and permission → Tasks 6–7. §4.9 navigation, list, editor, dialogs, save bar, role-gated Mark as paid, WhatsApp, completed banner, order back-link → Tasks 8–9. §4.10 storefront → Task 10. §4.11 tests: each item has a named test in the owning task; the E2E is in Final verification (environment-gated, as the spec says). Security bullets and binding carries 1–10 are mapped to tasks in Global Constraints.
2. **Placeholders.** Code is given for every new module; four component bodies (products card, picker, customer card, send-invoice dialog) are specified field by field with their exact props, strings and behaviour and point at the existing Part 3 component they copy (`RecoveryCard`), because their markup repeats house patterns verbatim. The "if the repo has X" notes name the file to check and both outcomes.
3. **Type consistency.** `DraftOrderContent`/`DraftOrderSnapshot`, `DraftRequirement` (`"lines" | "shipping_address" | "shipping" | "email"`), `DraftTerms`, `StartDraftCheckoutInput`, `ResolveCheckoutLinkOutput` (union by `purpose`), `CheckoutLinkPreviewDto` (`purpose`, `draftNumber`, `completed`), `DraftOrderDto`/`DraftOrderListItemDto` (admin and admin-web), `InvoiceLinkDto`, `PaymentIntentSummary.collectedOnDelivery`, and the controller method names (`createDraftOrder` … `completeDraftFromCheckout`; `startDraft` … `listDraftLinks`) are spelled the same in every task that produces or consumes them.
4. **Review Focus.** Five lines above, each pinned to a named test in Tasks 1, 3, 6, 7 and 9.

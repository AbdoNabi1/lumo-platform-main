# Order Operations — Part 3: Abandoned Checkouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merchants see the checkouts shoppers left after typing an email or phone (Shopify's "Abandoned checkouts"), and can copy a recovery link or share it on WhatsApp; the shopper who opens it presses one button and continues a fresh checkout of the same items at today's prices.

**Architecture:** "Abandoned" is derived at read time from `checkout.checkout_sessions` (open, idle ≥ 60 min, items, email or phone — plus every recovered one); no job. A new `checkout.checkout_links` table stores only the SHA-256 of a 256-bit token. `services/checkout` gains the `CheckoutLink` model, a read port `AbandonedCheckoutQueries` implemented by both session repositories, recovery fields on `CheckoutSession` (`recoveredFromRef`, `recoveredOrderRef`, `markRecovered`) and five use cases; `CompleteCheckout` stamps and expires the original once the recovered checkout becomes an order. `apps/admin` adds the staff list/detail/issue routes and two public routes (preview, claim): the claim clones the abandoned lines into the opener's OWN cart and session, re-priced with `resolveMerchandise`, and never hands out the original `sessionRef`. `admin-web` adds Orders → Abandoned checkouts (list, detail, copy link, WhatsApp share through a new `lib/whatsapp.ts`); the storefront adds `/c/[token]`, which claims only on a button press.

**Tech Stack:** TypeScript, Prisma 6 / PostgreSQL (hand-written SQL migration, one raw read), zod routes on `@platform/http`, Vitest, Next.js 15 App Router + React 19 (admin-web and storefront), Tailwind (logical utilities), `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-10-18-order-operations-design.md` — Part 3 (§3.1–§3.9), "Global constraints", "Permissions", "Security and multi-tenancy", Decisions 17–24 and 39. Read the spec and this plan together. Parts 1 and 2 (`docs/superpowers/plans/2026-10-18-order-operations-part1-list.md`, `docs/superpowers/plans/2026-10-19-order-operations-part2-notes-tags.md`) are DONE on this branch; their conventions are followed here.

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
   matching Arabic. _(Part 3 adds Abandoned checkouts; Part 4 inserts Drafts before it.)_

Anti-goals that bind Part 3 (verbatim):

- No client-supplied price, amount or rate on any public route; no merchant-browser-supplied price on
  any admin route added here (draft prices are resolved server-side from Catalog).
- No link that exposes, embeds or derives a guest `sessionRef`; no stored plaintext link token.

Permissions (verbatim rows used by Part 3):

| Permission                | Who has it today via the role table | Used by                                                                 |
| ------------------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| `orders:read`             | viewer, operator, admin             | lists, detail, drafts list/detail, abandoned list/detail, packing slips |
| `orders:recover_checkout` | operator, admin                     | issue a recovery link                                                   |

Operators get `orders:recover_checkout` from the existing `orders:*` grant in `ROLE_PERMISSIONS`
(`packages/auth/src/role-table-access-control.ts`), admins from `*:*`; viewers hold only `orders:read`.
No role-table code change — Task 1 pins it with a test.

Security and multi-tenancy (verbatim bullets that bind Part 3):

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
- **PII.** Export is operator/admin-only, capped, and formula-guarded; abandoned checkouts are behind
  `orders:read` like orders themselves.

Part 3 numbers (spec §3.1–§3.3, verbatim values): idle threshold `ABANDONED_AFTER_MINUTES` = 60; token
= 32 bytes from `crypto.randomBytes`, base64url (43 chars), only `sha256(token)` stored; recovery expiry
7 days; every "Copy recovery link" mints a new token; storefront path `/c/<token>`.

Repository rules (from the owner): commit with
`git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit`, Conventional Commits in
lower case, body lines ≤ 100 chars, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`,
never `--no-verify`. Never run a migration against a real database.

## Where the spec and the code disagree (resolved here)

1. **`CheckoutSessionRepository.listAbandoned`.** Six test fakes implement the narrow
   `CheckoutSessionRepository` port (`complete-checkout.use-case.test.ts`, `discount-code.use-cases.test.ts`,
   …); widening it breaks them all. The abandoned reads live on a second port,
   `AbandonedCheckoutQueries { listAbandoned; findRecord }` (`domain/abandoned-checkouts.ts`), implemented
   by BOTH `InMemoryCheckoutSessionRepository` and `PrismaCheckoutSessionRepository`. `findRecord` also
   returns `createdAt`/`updatedAt`, which the aggregate does not carry and the list needs.
2. **`CheckoutLinkRepository.latestFor(sessionId, tenantId)`** becomes
   `listForSessions(sessionIds, tenantId)` (newest first): one read serves a 50-row list page
   ("Shared Oct 18") and the detail page's link history.
3. **"Load that session in the same tx".** `CompleteCheckout` creates the order through
   `OrderCreationPort`, which commits on its own; if marking the original failed inside the session's
   transaction (a `ConcurrencyError` because the original browser touched it), the completion would roll
   back while the order stands. The original is therefore marked in its OWN unit of work right after the
   completion commits, best effort (like discount usage); a retried completion (the idempotent early
   return) re-attempts it.
4. **Recovery-link response `whatsappText`.** The API does not know the admin's language and §3.7 says
   the text comes from the dictionaries. The response is `{ url, path, expiresAt, shopName }`:
   admin-web composes the message; `shopName` is returned because operators hold no `settings:read`.
5. **Spent links.** A recovery link whose checkout has since been completed (in the original browser) or
   already recovered resolves to the same `LINK_INVALID` 404 — otherwise a placed cart could be cloned
   into a second order.
6. **Claim count.** As spec step 5 says, `recordClaim` runs only when a claim clones; a second tap that
   reuses the result session (step 2) does not count again.
7. **Preview `totalMinor`** is the sum of the abandoned lines at their snapshot prices (shipping and tax
   are re-chosen at checkout); the landing page says prices are confirmed at checkout.
8. **Non-UUID ids.** `checkout_sessions.id` and `checkout_links.checkout_session_id` are UUID columns, so
   Prisma throws on `abc`. `findRecord`, `findById` (links) and `listForSessions` answer `null` / `[]`
   for a non-UUID id without querying; the routes therefore answer 404, not 500.
9. **All lines unsellable.** The lines are priced BEFORE the caller's cart is touched: when none can be
   sold the claim answers 409 `ITEMS_UNAVAILABLE` and the shopper's current cart is left as it was.
10. **`currentOrNewSessionRef()`.** `app/cart/actions.ts` is a `"use server"` module; exporting a helper
    from it would make the helper callable from the browser. It moves to `lib/guest-session.ts` (server
    only), used by the cart actions and the new claim action.
11. **Abandoned list page size** is at most 50 (Shopify's page size): the recovered rows' order numbers
    come from one `listOrders({ ids })` read, which Part 1 caps at 50 ids.
12. **Dropped-items notice** travels as `/checkout?dropped=1`.
13. **`draft_terms = '{}'`** is not part of the definition yet (it arrives with Part 4's column).
14. **Added DTO field.** `AbandonedCheckoutListItemDto` also carries `country` (the shipping country,
    or null): `toWhatsAppDigits(phone, country)` needs it for the calling code.
15. **Migration order.** `20261018020000_checkout_recovery_links` sorts after Part 1's
    `20261018000000_order_archive` and Part 2's `20261018010000_order_notes_tags_timeline`, both still
    undeployed; the owner deploys the three in order.

## Review Focus

The five failure modes the spec implies but its test list does not exercise, most likely first. Each
line names the task whose tests pin it.

1. **A customer phone typed as `01001234567`, `+20 100 123 4567`, `00971…` or in Arabic-Indic digits
   (`٠١٠٠١٢٣٤٥٦٧`)** → WhatsApp opens the right chat (`201001234567`), and an unusable phone opens
   WhatsApp's chat picker instead of a broken number. Pinned in **Task 7** (`toWhatsAppDigits` table).
2. **The original browser touches the abandoned checkout while the recovered one completes** (a
   `ConcurrencyError` saving the original) → the recovered order still stands and the shopper sees
   success; a retried completion marks the original. Pinned in **Task 3**
   (`complete-checkout.recovery.test.ts` "a failure marking the original never undoes the order").
3. **The browser refuses the clipboard** (no permission, insecure context, Safari after an await) → the
   link is still shown in a read-only field to copy by hand, and nothing says "Copied". Pinned in
   **Task 7** (`recovery-card.test.tsx` "shows the link when the clipboard is refused").
4. **A recovery link opened after the shopper already placed that order** (in the original browser, or
   through an earlier recovery) → `LINK_INVALID`, never a second cloned order. Pinned in **Task 3**
   (`ResolveCheckoutLink` "completed" / "recovered") and **Task 5** (route "a link whose checkout became
   an order is spent").
5. **A garbage id or cursor in the admin URL** (`/abandoned-checkouts/abc`, `?after=xyz`) → 404 / an
   empty page, never a 500 from a UUID column. Pinned in **Task 2** (`findRecord` / `listAbandoned`
   over fake-prisma) and **Task 4** (route "non-UUID id is 404").

---

## File Structure

**packages/db**

- `prisma/schema/migrations/20261018020000_checkout_recovery_links/migration.sql` — two session columns, the abandoned-list index, `checkout_links` + RLS.
- `prisma/schema/checkout.prisma` — `CheckoutSession.recoveredFromRef/recoveredOrderRef` + index; model `CheckoutLink`.
- `src/schema-migration-consistency.test.ts` — asserts the migration matches the models.

**packages/auth**

- `src/role-table-access-control.test.ts` — pins `orders:recover_checkout` (no code change).

**services/checkout**

- `src/domain/checkout-link.ts` — `CheckoutLink`, token mint/hash, TTL, purposes.
- `src/domain/checkout-link-repository.ts` — `CheckoutLinkRepository` port.
- `src/domain/abandoned-checkouts.ts` — the abandoned definition, query types, `AbandonedCheckoutQueries` port.
- `src/domain/checkout-session.ts` — `recoveredFromRef`, `recoveredOrderRef`, `markRecovered`.
- `src/application/abandoned-checkouts.use-cases.ts` — `ListAbandonedCheckouts`, `GetAbandonedCheckout`, `IssueRecoveryLink`, `ResolveCheckoutLink`, `RecordCheckoutLinkClaim`, `LINK_INVALID`.
- `src/application/start-checkout.use-case.ts` — optional `recoveredFromRef`.
- `src/application/complete-checkout.use-case.ts` — marks the original recovered.
- `src/infrastructure/uuid.ts` — `isUuid`.
- `src/infrastructure/in-memory-checkout-link-repository.ts`, `prisma-checkout-link-repository.ts`.
- `src/infrastructure/in-memory-checkout-session-repository.ts`, `prisma-checkout-session-repository.ts` — timestamps, `findRecord`, `listAbandoned`, recovery columns.
- `src/infrastructure/checkout-session.mapper.ts` — the two columns.
- `src/infrastructure/abandoned-checkout-fixture.ts` — one fixture for both stores.
- `src/interfaces/checkout.controller.ts`, `src/composition.ts`, `src/index.ts` — wiring/exports.

**apps/admin**

- `src/interfaces/checkout.admin-controller.ts` — `listAbandoned`, `getAbandoned`, `issueRecoveryLink`.
- `src/composition.ts` — `WiredAdmin.shopDomains`.
- `src/http/shop-link-url.ts` — `primaryHostnameOf`, `shopLinkUrl`, `shopNameOf`.
- `src/http/abandoned-checkout-dto.ts` — list/detail DTOs.
- `src/http/abandoned-checkout-routes.ts` — the three staff routes.
- `src/http/public-checkout-link-routes.ts` — preview and claim.
- `src/http/public-checkout-routes.ts` — exports `checkoutItemsOf(cart)`.
- `src/http/admin-routes.ts` — registers both route files.
- `src/http/testing/orders-harness.ts` — optional clock; `src/http/testing/abandoned-harness.ts` — stepping clock, product seed, public calls, `abandonCheckout`.

**apps/admin-web**

- `src/components/navigation.ts` — Orders → Abandoned checkouts.
- `src/lib/api/abandoned-checkouts.ts` — DTOs and the three calls.
- `src/lib/orders/abandoned-checkouts.ts` — role gate, filter parsing, link href, timeline.
- `src/lib/whatsapp.ts` — `toWhatsAppDigits`, `whatsAppUrl`, `fillTemplate`.
- `src/app/abandoned-checkouts/page.tsx`, `[checkoutId]/page.tsx`, `actions.ts`.
- `src/components/abandoned-checkouts/abandoned-checkouts-table.tsx`, `abandoned-checkouts-filters.tsx`, `recovery-card.tsx`, `abandoned-checkout-timeline.tsx`.
- `src/messages/en.ts`, `src/messages/ar.ts`.

**apps/storefront**

- `src/lib/guest-session.ts` — `currentOrNewSessionRef()` (moved from `app/cart/actions.ts`).
- `src/lib/runtime-api.ts` — `getCheckoutLinkPreview`, `claimCheckoutLink`.
- `src/app/c/[token]/page.tsx`, `src/app/c/[token]/actions.ts`.
- `src/app/checkout/page.tsx` — dropped-items notice.
- `src/messages/en.ts`, `src/messages/ar.ts`.

## Commands

- Tests: `pnpm --filter <pkg> test`; one file: `pnpm --filter <pkg> exec vitest run <file>`.
- `pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> lint` (admin lint:
  `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint`; same variable for admin-web).
- Packages: `@platform/db`, `@platform/auth`, `@platform/checkout`, `@platform/admin`, `admin-web`, `storefront`.
- Prisma (dummy URLs, never a real DB):
  `DATABASE_URL=postgresql://u:p@localhost:5432/x DIRECT_URL=postgresql://u:p@localhost:5432/x pnpm --filter @platform/db exec prisma validate`
  and the same with `prisma generate` after a schema change.
- Tenant-filter guard: `node scripts/dev/check-prisma-tenant-where.mjs` (exit 0). Known environment
  issue: `packages/db/src/prisma-tenant-where.guard.test.ts` cannot load from a path with a space, so
  run the script directly. Every new `findMany/findFirst/updateMany` names `tenantId` in a literal `where`.
- Integration tests run only with `DATABASE_URL_TEST` set (they are skipped otherwise; never point it
  at a real database).

Commit template used by every task (replace subject/body):

```bash
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
<type>(<scope>): <lower-case subject>

<body, lines <= 100 chars>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 1: Storage, the permission pin, and the `CheckoutLink` model with its repositories

Model tier: **standard** (SQL must match Prisma's DDL exactly; the token rules are fully specified below).

**Files:**

- Create: `packages/db/prisma/schema/migrations/20261018020000_checkout_recovery_links/migration.sql`
- Modify: `packages/db/prisma/schema/checkout.prisma` (model `CheckoutSession`, new model `CheckoutLink` after it)
- Modify: `packages/db/src/schema-migration-consistency.test.ts` (append a `describe` at the end)
- Modify: `packages/auth/src/role-table-access-control.test.ts` (append one `it` inside the last `describe`)
- Create: `services/checkout/src/domain/checkout-link.ts`, `services/checkout/src/domain/checkout-link.test.ts`
- Create: `services/checkout/src/domain/checkout-link-repository.ts`
- Create: `services/checkout/src/infrastructure/uuid.ts`
- Create: `services/checkout/src/infrastructure/in-memory-checkout-link-repository.ts`
- Create: `services/checkout/src/infrastructure/prisma-checkout-link-repository.ts`, `services/checkout/src/infrastructure/prisma-checkout-link-repository.test.ts`
- Modify: `services/checkout/src/infrastructure/tenant-isolation.test.ts` (append a `describe`)

**Interfaces:**

- Consumes: `createFakePrisma` (`@platform/db/testing`), `runReadScoped`, `Database`, `TransactionClient` (`@platform/db`); `BusinessRuleError`, `ValidationError` (`@platform/utils`).
- Produces:
  - Prisma: `CheckoutSession.recoveredFromRef: String?`, `CheckoutSession.recoveredOrderRef: String?`, `@@index([tenantId, state, updatedAt])`; `model CheckoutLink { id, tenantId, purpose, tokenHash (unique), checkoutSessionId?, draftOrderRef?, expiresAt, revokedAt?, createdBy, createdAt, claimCount, lastClaimedAt?, resultCheckoutRef? }` → delegate `client.checkoutLink`.
  - `checkout-link.ts`: `CHECKOUT_LINK_PURPOSES`, `type CheckoutLinkPurpose = "recovery" | "invoice"`, `LINK_TOKEN_BYTES = 32`, `RECOVERY_LINK_TTL_MS = 604_800_000`, `newLinkToken(): string`, `hashLinkToken(token: string): string` (hex SHA-256), `isWellFormedLinkToken(token: string): boolean`, `type CheckoutLinkTarget = { checkoutSessionId: string } | { draftOrderRef: string }`, `interface CheckoutLinkSnapshot`, `class CheckoutLink { static issue(input: IssueCheckoutLinkInput): { link: CheckoutLink; token: string }; static reconstitute(s: CheckoutLinkSnapshot): CheckoutLink; readonly isNew: boolean; isUsable(now: Date): boolean; recordClaim(now: Date, resultCheckoutRef?: string): void; revoke(now: Date): void; snapshot(): CheckoutLinkSnapshot; getters id, purpose, tokenHash, checkoutSessionId, draftOrderRef, expiresAt, revokedAt, createdBy, createdAt, claimCount, lastClaimedAt, resultCheckoutRef }`.
  - `checkout-link-repository.ts`: `interface CheckoutLinkRepository { save(link, tenantId, tx?): Promise<void>; findByTokenHash(hash, tenantId, tx?): Promise<CheckoutLink | null>; findById(id, tenantId, tx?): Promise<CheckoutLink | null>; listForSessions(ids: readonly string[], tenantId, tx?): Promise<readonly CheckoutLink[]> }`.
  - `uuid.ts`: `isUuid(value: string): boolean`.
  - `InMemoryCheckoutLinkRepository` (no deps), `PrismaCheckoutLinkRepository({ prisma: Database })`.
  - Permission pinned: operator/admin hold `orders:recover_checkout`; viewer does not.

- [ ] **Step 1: Write the failing migration test**

Append to `packages/db/src/schema-migration-consistency.test.ts`:

```ts
describe("checkout schema — recovery links (order operations Part 3)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((dir) => readFileSync(join(migrationsDir, dir, "migration.sql"), "utf-8"))
    .join("\n");

  it("checkout_sessions gains the two recovery columns and the abandoned-list index", () => {
    const columns = columnsEverAddedTo("checkout", "checkout_sessions", allSql);
    expect(columns.has("recovered_from_ref")).toBe(true);
    expect(columns.has("recovered_order_ref")).toBe(true);
    expect(allSql).toContain(
      'CREATE INDEX "checkout_sessions_tenant_id_state_updated_at_idx" ON "checkout"."checkout_sessions"("tenant_id", "state", "updated_at");',
    );
  });

  it("checkout_links has the model's columns, a unique token hash, the session index and both checks", () => {
    expect([...columnsEverAddedTo("checkout", "checkout_links", allSql)].sort()).toEqual([
      "checkout_session_id",
      "claim_count",
      "created_at",
      "created_by",
      "draft_order_ref",
      "expires_at",
      "id",
      "last_claimed_at",
      "purpose",
      "result_checkout_ref",
      "revoked_at",
      "tenant_id",
      "token_hash",
    ]);
    expect(allSql).toContain(
      'CREATE UNIQUE INDEX "checkout_links_token_hash_key" ON "checkout"."checkout_links"("token_hash");',
    );
    expect(allSql).toContain(
      'CREATE INDEX "checkout_links_tenant_id_checkout_session_id_idx" ON "checkout"."checkout_links"("tenant_id", "checkout_session_id");',
    );
    expect(allSql).toContain(
      `CONSTRAINT "checkout_links_purpose_check" CHECK ("purpose" IN ('recovery','invoice'))`,
    );
    expect(allSql).toContain(`("purpose" = 'recovery' AND "checkout_session_id" IS NOT NULL) OR`);
    expect(allSql).toContain(`("purpose" = 'invoice'  AND "draft_order_ref" IS NOT NULL))`);
  });

  it("checkout_links is RLS-forced with the tenant_isolation policy", () => {
    expect(allSql).toContain('ALTER TABLE "checkout"."checkout_links" ENABLE ROW LEVEL SECURITY;');
    expect(allSql).toContain('ALTER TABLE "checkout"."checkout_links" FORCE ROW LEVEL SECURITY;');
    expect(allSql).toContain(
      'DROP POLICY IF EXISTS tenant_isolation ON "checkout"."checkout_links";',
    );
    expect(allSql).toContain(
      'CREATE POLICY tenant_isolation ON "checkout"."checkout_links" FOR ALL',
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @platform/db exec vitest run src/schema-migration-consistency.test.ts`
Expected: FAIL — the three new tests (no columns, empty column set, missing strings).

- [ ] **Step 3: Write the migration**

`packages/db/prisma/schema/migrations/20261018020000_checkout_recovery_links/migration.sql`:

```sql
-- Order operations Part 3 — abandoned checkouts and recovery links. Written by hand, NOT applied by the
-- agent; the owner deploys it from Railway's Console BEFORE the release that reads it, after
-- 20261018000000_order_archive and 20261018010000_order_notes_tags_timeline (both still undeployed).
-- Additive only, no backfill.

-- recovered_from_ref: on a NEW session a recovery link created (the abandoned session's id).
-- recovered_order_ref: on the ORIGINAL session once the recovered checkout became an order.
ALTER TABLE "checkout"."checkout_sessions" ADD COLUMN "recovered_from_ref" TEXT;
ALTER TABLE "checkout"."checkout_sessions" ADD COLUMN "recovered_order_ref" TEXT;
-- The abandoned list reads open sessions of one shop that have been idle for an hour.
CREATE INDEX "checkout_sessions_tenant_id_state_updated_at_idx" ON "checkout"."checkout_sessions"("tenant_id", "state", "updated_at");

-- A link a shopper opens to resume a checkout (recovery) or to pay a draft (invoice, Part 4). Only the
-- hex SHA-256 of the token is stored: the token itself exists only in the link the merchant copied.
-- created_by is the staff principal id; result_checkout_ref is the session the last claim produced.
CREATE TABLE "checkout"."checkout_links" (
  "id"                  UUID NOT NULL,
  "tenant_id"           TEXT NOT NULL,
  "purpose"             TEXT NOT NULL,
  "token_hash"          TEXT NOT NULL,
  "checkout_session_id" UUID,
  "draft_order_ref"     TEXT,
  "expires_at"          TIMESTAMP(3) NOT NULL,
  "revoked_at"          TIMESTAMP(3),
  "created_by"          TEXT NOT NULL,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claim_count"         INTEGER NOT NULL DEFAULT 0,
  "last_claimed_at"     TIMESTAMP(3),
  "result_checkout_ref" TEXT,
  CONSTRAINT "checkout_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "checkout_links_purpose_check" CHECK ("purpose" IN ('recovery','invoice')),
  CONSTRAINT "checkout_links_target_check" CHECK (
    ("purpose" = 'recovery' AND "checkout_session_id" IS NOT NULL) OR
    ("purpose" = 'invoice'  AND "draft_order_ref" IS NOT NULL))
);
CREATE UNIQUE INDEX "checkout_links_token_hash_key" ON "checkout"."checkout_links"("token_hash");
CREATE INDEX "checkout_links_tenant_id_checkout_session_id_idx" ON "checkout"."checkout_links"("tenant_id", "checkout_session_id");
ALTER TABLE "checkout"."checkout_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "checkout"."checkout_links" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "checkout"."checkout_links";
CREATE POLICY tenant_isolation ON "checkout"."checkout_links" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
```

- [ ] **Step 4: Update the Prisma models**

In `packages/db/prisma/schema/checkout.prisma`, inside `model CheckoutSession`, add after the `discounts` line:

```prisma
  recoveredFromRef  String?  @map("recovered_from_ref") // Part 3: on a session a recovery link created — the abandoned session's id
  recoveredOrderRef String?  @map("recovered_order_ref") // Part 3: on the abandoned session once its recovery became an order
```

and after `@@index([tenantId, state])` add:

```prisma
  @@index([tenantId, state, updatedAt])
```

Append after the `CheckoutSession` model:

```prisma
// Part 3 (order operations): a link a shopper opens to resume a checkout (recovery) or to pay a draft
// (invoice, Part 4). Only the hex SHA-256 of the token is stored. `purpose` and the target rule are
// CHECK constraints in the migration (recovery ⇒ checkoutSessionId, invoice ⇒ draftOrderRef).
model CheckoutLink {
  id                String    @id @db.Uuid
  tenantId          String    @map("tenant_id")
  purpose           String // recovery | invoice
  tokenHash         String    @unique @map("token_hash")
  checkoutSessionId String?   @map("checkout_session_id") @db.Uuid // bare id into checkout_sessions — never an FK
  draftOrderRef     String?   @map("draft_order_ref")
  expiresAt         DateTime  @map("expires_at")
  revokedAt         DateTime? @map("revoked_at")
  createdBy         String    @map("created_by")
  createdAt         DateTime  @default(now()) @map("created_at")
  claimCount        Int       @default(0) @map("claim_count")
  lastClaimedAt     DateTime? @map("last_claimed_at")
  resultCheckoutRef String?   @map("result_checkout_ref")

  @@index([tenantId, checkoutSessionId])
  @@map("checkout_links")
  @@schema("checkout")
}
```

Prisma's default names are exactly the migration's: `checkout_links_token_hash_key`,
`checkout_links_tenant_id_checkout_session_id_idx`, `checkout_sessions_tenant_id_state_updated_at_idx`.

- [ ] **Step 5: Validate, generate and re-run the migration test**

Run:
`DATABASE_URL=postgresql://u:p@localhost:5432/x DIRECT_URL=postgresql://u:p@localhost:5432/x pnpm --filter @platform/db exec prisma validate`
then the same with `prisma generate`, then
`pnpm --filter @platform/db exec vitest run src/schema-migration-consistency.test.ts`
Expected: "The schema … is valid", client generated, all tests PASS.

- [ ] **Step 6: Pin the permission (passes immediately — it guards the role table)**

Append inside the last `describe` of `packages/auth/src/role-table-access-control.test.ts`:

```ts
it("operators and admins issue recovery links; viewers only read abandoned checkouts (orders Part 3)", async () => {
  expect(await acl.authorize(who(["operator"]), "orders:recover_checkout")).toBe(true);
  expect(await acl.authorize(who(["admin"]), "orders:recover_checkout")).toBe(true);
  expect(await acl.authorize(who(["platform-admin"]), "orders:recover_checkout")).toBe(true);
  expect(await acl.authorize(who(["viewer"]), "orders:recover_checkout")).toBe(false);
  expect(await acl.authorize(who(["viewer"]), "orders:read")).toBe(true);
});
```

Run: `pnpm --filter @platform/auth exec vitest run src/role-table-access-control.test.ts`
Expected: PASS (if it fails, the role table changed — stop and report; do not edit the table).

- [ ] **Step 7: Write the failing `CheckoutLink` tests**

`services/checkout/src/domain/checkout-link.test.ts`:

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BusinessRuleError, ValidationError } from "@platform/utils";
import {
  CheckoutLink,
  hashLinkToken,
  isWellFormedLinkToken,
  RECOVERY_LINK_TTL_MS,
} from "./checkout-link";

const NOW = new Date("2026-10-18T12:00:00.000Z");
const SESSION = "01920000-0000-7000-8000-000000000001";

function issueRecovery(now = NOW) {
  return CheckoutLink.issue({
    id: "01920000-0000-7000-8000-0000000000a1",
    purpose: "recovery",
    target: { checkoutSessionId: SESSION },
    createdBy: "staff-op",
    now,
    ttlMs: RECOVERY_LINK_TTL_MS,
  });
}

describe("CheckoutLink.issue", () => {
  it("mints a 32-byte base64url token (43 chars) and keeps only its SHA-256", () => {
    const { link, token } = issueRecovery();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(link.tokenHash).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
    expect(link.tokenHash).toBe(hashLinkToken(token));
    expect(JSON.stringify(link.snapshot())).not.toContain(token);
  });

  it("never mints the same token twice", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => issueRecovery().token));
    expect(tokens.size).toBe(50);
  });

  it("a recovery link points at its checkout, expires in 7 days and starts unclaimed", () => {
    const { link } = issueRecovery();
    expect(link.purpose).toBe("recovery");
    expect(link.checkoutSessionId).toBe(SESSION);
    expect(link.draftOrderRef).toBeNull();
    expect(link.expiresAt).toEqual(new Date("2026-10-25T12:00:00.000Z"));
    expect(link.claimCount).toBe(0);
    expect(link.lastClaimedAt).toBeNull();
    expect(link.resultCheckoutRef).toBeNull();
    expect(link.revokedAt).toBeNull();
    expect(link.createdBy).toBe("staff-op");
    expect(link.createdAt).toEqual(NOW);
    expect(link.isNew).toBe(true);
  });

  it("refuses a recovery link without a checkout, an invoice link without a draft, and a bad ttl", () => {
    const base = { id: "x", createdBy: "staff-op", now: NOW, ttlMs: RECOVERY_LINK_TTL_MS };
    expect(() =>
      CheckoutLink.issue({ ...base, purpose: "recovery", target: { draftOrderRef: "d-1" } }),
    ).toThrow(ValidationError);
    expect(() =>
      CheckoutLink.issue({ ...base, purpose: "invoice", target: { checkoutSessionId: SESSION } }),
    ).toThrow(ValidationError);
    expect(() =>
      CheckoutLink.issue({
        ...base,
        purpose: "recovery",
        target: { checkoutSessionId: SESSION },
        ttlMs: 0,
      }),
    ).toThrow(ValidationError);
    expect(() =>
      CheckoutLink.issue({
        ...base,
        purpose: "recovery",
        target: { checkoutSessionId: SESSION },
        createdBy: " ",
      }),
    ).toThrow(ValidationError);
  });
});

describe("CheckoutLink lifecycle", () => {
  it("is usable until the expiry instant, not at it", () => {
    const { link } = issueRecovery();
    expect(link.isUsable(new Date(link.expiresAt.getTime() - 1))).toBe(true);
    expect(link.isUsable(link.expiresAt)).toBe(false);
  });

  it("counts claims and remembers the session the last claim produced", () => {
    const { link } = issueRecovery();
    link.recordClaim(new Date("2026-10-19T00:00:00.000Z"), "result-1");
    link.recordClaim(new Date("2026-10-19T01:00:00.000Z"));
    expect(link.claimCount).toBe(2);
    expect(link.lastClaimedAt).toEqual(new Date("2026-10-19T01:00:00.000Z"));
    expect(link.resultCheckoutRef).toBe("result-1");
  });

  it("refuses a claim on an expired or revoked link", () => {
    const expired = issueRecovery().link;
    expect(() => expired.recordClaim(expired.expiresAt)).toThrow(BusinessRuleError);
    const revoked = issueRecovery().link;
    revoked.revoke(NOW);
    expect(revoked.isUsable(NOW)).toBe(false);
    expect(() => revoked.recordClaim(NOW)).toThrow(BusinessRuleError);
  });

  it("revoking twice keeps the first time", () => {
    const { link } = issueRecovery();
    link.revoke(new Date("2026-10-19T00:00:00.000Z"));
    link.revoke(new Date("2026-10-20T00:00:00.000Z"));
    expect(link.revokedAt).toEqual(new Date("2026-10-19T00:00:00.000Z"));
  });

  it("a reconstituted link is not new and keeps every field", () => {
    const { link } = issueRecovery();
    const loaded = CheckoutLink.reconstitute(link.snapshot());
    expect(loaded.isNew).toBe(false);
    expect(loaded.snapshot()).toEqual(link.snapshot());
  });
});

describe("isWellFormedLinkToken", () => {
  it("accepts a minted token and nothing else", () => {
    expect(isWellFormedLinkToken(issueRecovery().token)).toBe(true);
    expect(isWellFormedLinkToken("short")).toBe(false);
    expect(isWellFormedLinkToken(`${"a".repeat(42)}/`)).toBe(false);
    expect(isWellFormedLinkToken("a".repeat(44))).toBe(false);
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `pnpm --filter @platform/checkout exec vitest run src/domain/checkout-link.test.ts`
Expected: FAIL — `Cannot find module './checkout-link'`.

- [ ] **Step 9: Write `checkout-link.ts`**

`services/checkout/src/domain/checkout-link.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";
import { BusinessRuleError, ValidationError } from "@platform/utils";

/** What a link opens: an abandoned checkout to resume, or a draft order to pay (Part 4). */
export const CHECKOUT_LINK_PURPOSES = ["recovery", "invoice"] as const;
export type CheckoutLinkPurpose = (typeof CHECKOUT_LINK_PURPOSES)[number];

/** 256-bit tokens (spec §3.3): 32 random bytes, base64url — 43 characters. */
export const LINK_TOKEN_BYTES = 32;
/** A recovery link works for 7 days (spec §3.3). */
export const RECOVERY_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newLinkToken(): string {
  return randomBytes(LINK_TOKEN_BYTES).toString("base64url");
}

/** The only form a token is ever stored or looked up in: its hex SHA-256. */
export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A token as `newLinkToken` mints it — anything else can be refused without a lookup. */
export function isWellFormedLinkToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export type CheckoutLinkTarget =
  { readonly checkoutSessionId: string } | { readonly draftOrderRef: string };

export interface CheckoutLinkSnapshot {
  readonly id: string;
  readonly purpose: CheckoutLinkPurpose;
  readonly tokenHash: string;
  readonly checkoutSessionId: string | null;
  readonly draftOrderRef: string | null;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly claimCount: number;
  readonly lastClaimedAt: Date | null;
  readonly resultCheckoutRef: string | null;
}

export interface IssueCheckoutLinkInput {
  readonly id: string;
  readonly purpose: CheckoutLinkPurpose;
  readonly target: CheckoutLinkTarget;
  /** The staff principal id. */
  readonly createdBy: string;
  readonly now: Date;
  readonly ttlMs: number;
}

type Props = { -readonly [K in keyof CheckoutLinkSnapshot]: CheckoutLinkSnapshot[K] };

function targetOf(target: CheckoutLinkTarget): {
  readonly checkoutSessionId: string | null;
  readonly draftOrderRef: string | null;
} {
  return "checkoutSessionId" in target
    ? { checkoutSessionId: target.checkoutSessionId.trim() || null, draftOrderRef: null }
    : { checkoutSessionId: null, draftOrderRef: target.draftOrderRef.trim() || null };
}

/**
 * A bearer link to "resume this checkout" (recovery) or "pay this draft" (invoice, Part 4). The token
 * is handed out exactly once, by {@link CheckoutLink.issue}; only its hash is kept, so the same link
 * can never be shown twice — every "Copy recovery link" mints a new one (spec §3.3). Not an event-
 * sourced aggregate: nothing else reacts to a link, so it raises no domain events.
 */
export class CheckoutLink {
  private readonly props: Props;
  /** True until the repository has inserted it: `save` inserts a new link and updates a loaded one. */
  readonly isNew: boolean;

  private constructor(props: Props, isNew: boolean) {
    this.props = props;
    this.isNew = isNew;
  }

  static issue(input: IssueCheckoutLinkInput): {
    readonly link: CheckoutLink;
    readonly token: string;
  } {
    const target = targetOf(input.target);
    if (input.purpose === "recovery" && target.checkoutSessionId === null) {
      throw new ValidationError("A recovery link needs a checkout", [
        { field: "checkoutSessionId", message: "required" },
      ]);
    }
    if (input.purpose === "invoice" && target.draftOrderRef === null) {
      throw new ValidationError("An invoice link needs a draft order", [
        { field: "draftOrderRef", message: "required" },
      ]);
    }
    if (!Number.isInteger(input.ttlMs) || input.ttlMs <= 0) {
      throw new ValidationError("A link must expire", [
        { field: "ttlMs", message: "must be a positive whole number of milliseconds" },
      ]);
    }
    if (input.createdBy.trim().length === 0) {
      throw new ValidationError("A link needs the staff member who made it", [
        { field: "createdBy", message: "required" },
      ]);
    }
    const token = newLinkToken();
    const link = new CheckoutLink(
      {
        id: input.id,
        purpose: input.purpose,
        tokenHash: hashLinkToken(token),
        checkoutSessionId: target.checkoutSessionId,
        draftOrderRef: target.draftOrderRef,
        expiresAt: new Date(input.now.getTime() + input.ttlMs),
        revokedAt: null,
        createdBy: input.createdBy,
        createdAt: input.now,
        claimCount: 0,
        lastClaimedAt: null,
        resultCheckoutRef: null,
      },
      true,
    );
    return { link, token };
  }

  static reconstitute(snapshot: CheckoutLinkSnapshot): CheckoutLink {
    return new CheckoutLink({ ...snapshot }, false);
  }

  /** Not revoked and not yet expired (the expiry instant itself is already too late). */
  isUsable(now: Date): boolean {
    return this.props.revokedAt === null && now.getTime() < this.props.expiresAt.getTime();
  }

  recordClaim(now: Date, resultCheckoutRef?: string): void {
    if (!this.isUsable(now)) {
      throw new BusinessRuleError("LINK_INVALID: this link has expired or was revoked");
    }
    this.props.claimCount += 1;
    this.props.lastClaimedAt = now;
    if (resultCheckoutRef !== undefined) this.props.resultCheckoutRef = resultCheckoutRef;
  }

  revoke(now: Date): void {
    if (this.props.revokedAt === null) this.props.revokedAt = now;
  }

  snapshot(): CheckoutLinkSnapshot {
    return { ...this.props };
  }

  get id(): string {
    return this.props.id;
  }
  get purpose(): CheckoutLinkPurpose {
    return this.props.purpose;
  }
  get tokenHash(): string {
    return this.props.tokenHash;
  }
  get checkoutSessionId(): string | null {
    return this.props.checkoutSessionId;
  }
  get draftOrderRef(): string | null {
    return this.props.draftOrderRef;
  }
  get expiresAt(): Date {
    return this.props.expiresAt;
  }
  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }
  get createdBy(): string {
    return this.props.createdBy;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get claimCount(): number {
    return this.props.claimCount;
  }
  get lastClaimedAt(): Date | null {
    return this.props.lastClaimedAt;
  }
  get resultCheckoutRef(): string | null {
    return this.props.resultCheckoutRef;
  }
}
```

- [ ] **Step 10: Run the domain test**

Run: `pnpm --filter @platform/checkout exec vitest run src/domain/checkout-link.test.ts`
Expected: PASS.

- [ ] **Step 11: Write the port, `isUuid` and the in-memory repository**

`services/checkout/src/domain/checkout-link-repository.ts`:

```ts
import type { CheckoutLink } from "./checkout-link";

/**
 * Persistence port for {@link CheckoutLink} (order operations Part 3). ADR-0014: `tenantId` per call;
 * a token hash from another shop is simply unknown. Writes need the unit of work's `tx`.
 */
export interface CheckoutLinkRepository {
  /** Inserts a link issued in this request (`link.isNew`), otherwise updates its claim and revocation. */
  save(link: CheckoutLink, tenantId: string, tx?: unknown): Promise<void>;
  findByTokenHash(tokenHash: string, tenantId: string, tx?: unknown): Promise<CheckoutLink | null>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<CheckoutLink | null>;
  /** Every link of these checkouts, newest first. */
  listForSessions(
    checkoutSessionIds: readonly string[],
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly CheckoutLink[]>;
}
```

`services/checkout/src/infrastructure/uuid.ts`:

```ts
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids stored in UUID columns: anything else is unknown without asking Postgres (which would throw). */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
```

`services/checkout/src/infrastructure/in-memory-checkout-link-repository.ts`:

```ts
import type { CheckoutLink } from "../domain/checkout-link";
import type { CheckoutLinkRepository } from "../domain/checkout-link-repository";

export function newestFirst(links: readonly CheckoutLink[]): CheckoutLink[] {
  return [...links].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1),
  );
}

/** In-memory `CheckoutLinkRepository` keyed by `(tenantId, id)` (ADR-0014). */
export class InMemoryCheckoutLinkRepository implements CheckoutLinkRepository {
  private readonly store = new Map<string, Map<string, CheckoutLink>>();

  async save(link: CheckoutLink, tenantId: string): Promise<void> {
    let bucket = this.store.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.store.set(tenantId, bucket);
    }
    bucket.set(link.id, link);
  }

  async findByTokenHash(tokenHash: string, tenantId: string): Promise<CheckoutLink | null> {
    for (const link of this.store.get(tenantId)?.values() ?? []) {
      if (link.tokenHash === tokenHash) return link;
    }
    return null;
  }

  async findById(id: string, tenantId: string): Promise<CheckoutLink | null> {
    return this.store.get(tenantId)?.get(id) ?? null;
  }

  async listForSessions(
    checkoutSessionIds: readonly string[],
    tenantId: string,
  ): Promise<readonly CheckoutLink[]> {
    const wanted = new Set(checkoutSessionIds);
    const links = [...(this.store.get(tenantId)?.values() ?? [])].filter(
      (link) => link.checkoutSessionId !== null && wanted.has(link.checkoutSessionId),
    );
    return newestFirst(links);
  }
}
```

- [ ] **Step 12: Write the failing Prisma repository test (over fake-prisma)**

`services/checkout/src/infrastructure/prisma-checkout-link-repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import { CheckoutLink, hashLinkToken, RECOVERY_LINK_TTL_MS } from "../domain/checkout-link";
import { PrismaCheckoutLinkRepository } from "./prisma-checkout-link-repository";

const TENANT = "tenant-a";
const SESSION_1 = "01920000-0000-7000-8000-000000000001";
const SESSION_2 = "01920000-0000-7000-8000-000000000002";

function issue(id: string, session: string, now: Date) {
  return CheckoutLink.issue({
    id,
    purpose: "recovery",
    target: { checkoutSessionId: session },
    createdBy: "staff-op",
    now,
    ttlMs: RECOVERY_LINK_TTL_MS,
  });
}

function setup() {
  const fake = createFakePrisma();
  return { fake, repository: new PrismaCheckoutLinkRepository({ prisma: fake.database }) };
}

describe("PrismaCheckoutLinkRepository (over fake-prisma)", () => {
  it("stores the token's hash and never the token", async () => {
    const { fake, repository } = setup();
    const { link, token } = issue("01920000-0000-7000-8000-0000000000a1", SESSION_1, new Date(0));
    await repository.save(link, TENANT, fake.database);

    const rows = fake.rowsOf("checkoutLink");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["tokenHash"]).toBe(hashLinkToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("finds a link by the hash of its token inside the shop", async () => {
    const { fake, repository } = setup();
    const { link, token } = issue("01920000-0000-7000-8000-0000000000a1", SESSION_1, new Date(0));
    await repository.save(link, TENANT, fake.database);

    const found = await repository.findByTokenHash(hashLinkToken(token), TENANT, fake.database);
    expect(found?.snapshot()).toEqual(link.snapshot());
    expect(found?.isNew).toBe(false);
    expect(await repository.findByTokenHash(token, TENANT, fake.database)).toBeNull();
  });

  it("updates a loaded link's claim fields without touching what it was issued with", async () => {
    const { fake, repository } = setup();
    const { link } = issue("01920000-0000-7000-8000-0000000000a1", SESSION_1, new Date(0));
    await repository.save(link, TENANT, fake.database);
    const loaded = await repository.findById(link.id, TENANT, fake.database);
    if (loaded === null) throw new Error("setup failed");
    loaded.recordClaim(new Date(1000), "result-1");
    await repository.save(loaded, TENANT, fake.database);

    const again = await repository.findById(link.id, TENANT, fake.database);
    expect(again?.claimCount).toBe(1);
    expect(again?.lastClaimedAt).toEqual(new Date(1000));
    expect(again?.resultCheckoutRef).toBe("result-1");
    expect(again?.tokenHash).toBe(link.tokenHash);
    expect(fake.rowsOf("checkoutLink")).toHaveLength(1);
  });

  it("lists the links of the given checkouts, newest first", async () => {
    const { fake, repository } = setup();
    const older = issue("01920000-0000-7000-8000-0000000000a1", SESSION_1, new Date(1000)).link;
    const newer = issue("01920000-0000-7000-8000-0000000000a2", SESSION_1, new Date(2000)).link;
    const other = issue("01920000-0000-7000-8000-0000000000a3", SESSION_2, new Date(3000)).link;
    for (const link of [older, newer, other]) await repository.save(link, TENANT, fake.database);

    const listed = await repository.listForSessions([SESSION_1], TENANT, fake.database);
    expect(listed.map((link) => link.id)).toEqual([newer.id, older.id]);
  });

  it("answers nothing for non-UUID ids without querying (UUID columns)", async () => {
    const { fake, repository } = setup();
    expect(await repository.findById("abc", TENANT, fake.database)).toBeNull();
    expect(await repository.listForSessions(["abc"], TENANT, fake.database)).toEqual([]);
  });

  it("refuses to write outside the unit of work", async () => {
    const { repository } = setup();
    const { link } = issue("01920000-0000-7000-8000-0000000000a1", SESSION_1, new Date(0));
    await expect(repository.save(link, TENANT)).rejects.toThrow(/unit of work/);
  });
});
```

- [ ] **Step 13: Run it to verify it fails**

Run: `pnpm --filter @platform/checkout exec vitest run src/infrastructure/prisma-checkout-link-repository.test.ts`
Expected: FAIL — `Cannot find module './prisma-checkout-link-repository'`.

- [ ] **Step 14: Write the Prisma repository**

`services/checkout/src/infrastructure/prisma-checkout-link-repository.ts`:

```ts
import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import { CheckoutLink, type CheckoutLinkPurpose } from "../domain/checkout-link";
import type { CheckoutLinkRepository } from "../domain/checkout-link-repository";
import { newestFirst } from "./in-memory-checkout-link-repository";
import { isUuid } from "./uuid";

export interface PrismaCheckoutLinkRepositoryDeps {
  readonly prisma: Database;
}

type LinkRow = NonNullable<Awaited<ReturnType<TransactionClient["checkoutLink"]["findFirst"]>>>;

function toDomain(row: LinkRow): CheckoutLink {
  return CheckoutLink.reconstitute({
    id: row.id,
    purpose: row.purpose as CheckoutLinkPurpose,
    tokenHash: row.tokenHash,
    checkoutSessionId: row.checkoutSessionId,
    draftOrderRef: row.draftOrderRef,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    claimCount: row.claimCount,
    lastClaimedAt: row.lastClaimedAt,
    resultCheckoutRef: row.resultCheckoutRef,
  });
}

/**
 * `checkout.checkout_links` (order operations Part 3). Every read and write names `tenantId` in its
 * `where` (RLS is inert on the application's connection — ADR-0014 point 6), so a token hash from
 * another shop is unknown here.
 */
export class PrismaCheckoutLinkRepository implements CheckoutLinkRepository {
  private readonly deps: PrismaCheckoutLinkRepositoryDeps;

  constructor(deps: PrismaCheckoutLinkRepositoryDeps) {
    this.deps = deps;
  }

  async save(link: CheckoutLink, tenantId: string, tx?: unknown): Promise<void> {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaCheckoutLinkRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    const client = tx as TransactionClient;
    const s = link.snapshot();
    if (link.isNew) {
      await client.checkoutLink.create({
        data: {
          id: s.id,
          tenantId,
          purpose: s.purpose,
          tokenHash: s.tokenHash,
          checkoutSessionId: s.checkoutSessionId,
          draftOrderRef: s.draftOrderRef,
          expiresAt: s.expiresAt,
          revokedAt: s.revokedAt,
          createdBy: s.createdBy,
          createdAt: s.createdAt,
          claimCount: s.claimCount,
          lastClaimedAt: s.lastClaimedAt,
          resultCheckoutRef: s.resultCheckoutRef,
        },
      });
      return;
    }
    await client.checkoutLink.updateMany({
      where: { id: s.id, tenantId },
      data: {
        revokedAt: s.revokedAt,
        claimCount: s.claimCount,
        lastClaimedAt: s.lastClaimedAt,
        resultCheckoutRef: s.resultCheckoutRef,
      },
    });
  }

  async findByTokenHash(
    tokenHash: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<CheckoutLink | null> {
    const row = await this.read(tenantId, tx, (client) =>
      client.checkoutLink.findFirst({ where: { tenantId, tokenHash } }),
    );
    return row === null ? null : toDomain(row);
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<CheckoutLink | null> {
    if (!isUuid(id)) return null;
    const row = await this.read(tenantId, tx, (client) =>
      client.checkoutLink.findFirst({ where: { tenantId, id } }),
    );
    return row === null ? null : toDomain(row);
  }

  async listForSessions(
    checkoutSessionIds: readonly string[],
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly CheckoutLink[]> {
    const ids = [...new Set(checkoutSessionIds)].filter(isUuid);
    if (ids.length === 0) return [];
    const rows = await this.read(tenantId, tx, (client) =>
      client.checkoutLink.findMany({ where: { tenantId, checkoutSessionId: { in: ids } } }),
    );
    return newestFirst(rows.map(toDomain));
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

- [ ] **Step 15: Run the repository test**

Run: `pnpm --filter @platform/checkout exec vitest run src/infrastructure/prisma-checkout-link-repository.test.ts`
Expected: PASS.

- [ ] **Step 16: Add the tenant-isolation case (both layers)**

Append to `services/checkout/src/infrastructure/tenant-isolation.test.ts` (add the imports at the top):

```ts
import { createFakePrisma } from "@platform/db/testing";
import { CheckoutLink, hashLinkToken, RECOVERY_LINK_TTL_MS } from "../domain/checkout-link";
import type { CheckoutLinkRepository } from "../domain/checkout-link-repository";
import { InMemoryCheckoutLinkRepository } from "./in-memory-checkout-link-repository";
import { PrismaCheckoutLinkRepository } from "./prisma-checkout-link-repository";
```

```ts
// ── order operations Part 3: recovery links ────────────────────────────────────────────────────
// The Prisma adapter runs over the fake that applies `where` literally: it cannot pass because of RLS.
describe("checkout links tenant isolation (order operations Part 3)", () => {
  const VICTIM_SESSION = "01920000-0000-7000-8000-00000000000b";

  function layers(): readonly [string, CheckoutLinkRepository, unknown][] {
    const fake = createFakePrisma();
    return [
      [
        "prisma over fake-prisma",
        new PrismaCheckoutLinkRepository({ prisma: fake.database }),
        fake.database,
      ],
      ["in-memory", new InMemoryCheckoutLinkRepository(), undefined],
    ];
  }

  it("a token issued in shop B is unknown in shop A, by hash, id or checkout", async () => {
    for (const [layer, links, tx] of layers()) {
      const { link, token } = CheckoutLink.issue({
        id: "01920000-0000-7000-8000-0000000000b1",
        purpose: "recovery",
        target: { checkoutSessionId: VICTIM_SESSION },
        createdBy: "staff-b",
        now: new Date(0),
        ttlMs: RECOVERY_LINK_TTL_MS,
      });
      await links.save(link, "tenant-b", tx);

      expect(await links.findByTokenHash(hashLinkToken(token), "tenant-a", tx), layer).toBeNull();
      expect(await links.findById(link.id, "tenant-a", tx), layer).toBeNull();
      expect(await links.listForSessions([VICTIM_SESSION], "tenant-a", tx), layer).toEqual([]);
      expect(
        await links.findByTokenHash(hashLinkToken(token), "tenant-b", tx),
        layer,
      ).not.toBeNull();
    }
  });
});
```

Run: `pnpm --filter @platform/checkout exec vitest run src/infrastructure/tenant-isolation.test.ts`
Expected: PASS.

- [ ] **Step 17: Guard, typecheck, lint, package tests**

Run: `node scripts/dev/check-prisma-tenant-where.mjs` → exit 0, no `checkoutLink` line.
Run: `pnpm --filter @platform/checkout typecheck && pnpm --filter @platform/checkout lint && pnpm --filter @platform/checkout test`
Expected: all green.

- [ ] **Step 18: Commit**

```bash
git add packages/db/prisma/schema/migrations/20261018020000_checkout_recovery_links/migration.sql \
  packages/db/prisma/schema/checkout.prisma packages/db/src/schema-migration-consistency.test.ts \
  packages/auth/src/role-table-access-control.test.ts \
  services/checkout/src/domain/checkout-link.ts services/checkout/src/domain/checkout-link.test.ts \
  services/checkout/src/domain/checkout-link-repository.ts services/checkout/src/infrastructure/uuid.ts \
  services/checkout/src/infrastructure/in-memory-checkout-link-repository.ts \
  services/checkout/src/infrastructure/prisma-checkout-link-repository.ts \
  services/checkout/src/infrastructure/prisma-checkout-link-repository.test.ts \
  services/checkout/src/infrastructure/tenant-isolation.test.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(checkout): recovery link storage and the checkout link model

Adds migration 20261018020000_checkout_recovery_links (two session columns, the
abandoned-list index, checkout_links with forced RLS) and the CheckoutLink model:
256-bit base64url tokens, only their SHA-256 stored, 7-day recovery expiry, claims
counted. In-memory and Prisma repositories scope every read by tenant.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Recovery fields on `CheckoutSession`, the abandoned definition, and both session stores

Model tier: **most-capable** (one definition that a raw SQL read and an in-memory filter must agree on, a mapper change on a hot table, and the UUID guards).

**Files:**

- Modify: `services/checkout/src/domain/checkout-session.ts`
- Create: `services/checkout/src/domain/checkout-session.recovery.test.ts`
- Create: `services/checkout/src/domain/abandoned-checkouts.ts`, `services/checkout/src/domain/abandoned-checkouts.test.ts`
- Modify: `services/checkout/src/infrastructure/checkout-session.mapper.ts`, `services/checkout/src/infrastructure/checkout-session.mapper.test.ts` (append a `describe`)
- Modify: `services/checkout/src/infrastructure/in-memory-checkout-session-repository.ts`
- Create: `services/checkout/src/infrastructure/in-memory-checkout-session-repository.test.ts`
- Modify: `services/checkout/src/infrastructure/prisma-checkout-session-repository.ts`
- Create: `services/checkout/src/infrastructure/prisma-checkout-session-repository.test.ts`
- Modify: `services/checkout/src/infrastructure/prisma-checkout-session-repository.integration.test.ts` (append a `describe`)
- Create: `services/checkout/src/infrastructure/abandoned-checkout-fixture.ts`
- Modify: `services/checkout/src/infrastructure/tenant-isolation.test.ts` (append a `describe`)
- Modify: `services/checkout/src/composition.ts:316` (the in-memory repository gets the clock)

**Interfaces:**

- Consumes: Task 1's Prisma columns `recoveredFromRef`/`recoveredOrderRef` and `isUuid` (`infrastructure/uuid.ts`).
- Produces:
  - `CheckoutSession.start(id, cartRef, customerRef, sessionRef, currency, options?: { recoveredFromRef?: string })`; `reconstitute(..., extra.recoveredFromRef?, extra.recoveredOrderRef?)`; `markRecovered(orderRef: string, eventId: string, occurredAt: Date): void`; getters `recoveredFromRef: string | undefined`, `recoveredOrderRef: string | undefined`.
  - `abandoned-checkouts.ts`: `ABANDONED_AFTER_MINUTES = 60`, `ABANDONED_PAGE_SIZE_MAX = 50`, `ABANDONED_SEARCH_MAX_LENGTH = 100`, `RECOVERY_FILTERS`, `type RecoveryFilter = "recovered" | "not_recovered"`, `interface CheckoutSessionRecord { session; createdAt: Date; updatedAt: Date }`, `interface AbandonedCheckoutQuery { olderThan: Date; first?: number; after?: string; search?: string; recovery?: RecoveryFilter }`, `interface AbandonedCheckoutPage { items: readonly CheckoutSessionRecord[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }`, `interface AbandonedCheckoutQueries { listAbandoned(query, tenantId): Promise<AbandonedCheckoutPage>; findRecord(id, tenantId, tx?): Promise<CheckoutSessionRecord | null> }`, `abandonedBefore(now: Date): Date`, `isRecovered(session): boolean`, `isAbandonedCheckout(record, olderThan: Date): boolean`, `normalizeAbandonedSearch(raw: string | undefined): string | undefined`, `clampAbandonedPageSize(first: number | undefined): number`, `matchesAbandonedSearch(session, search: string): boolean`.
  - `InMemoryCheckoutSessionRepository` deps gain `clock?: Clock`; it and `PrismaCheckoutSessionRepository` both implement `CheckoutSessionRepository & AbandonedCheckoutQueries`.
  - `prisma-checkout-session-repository.ts` exports `escapeLike(text: string): string`.
  - `abandoned-checkout-fixture.ts`: `FIXTURE_NOW`, `FIXTURE_OLDER_THAN`, `FIXTURE_NAMES`, `type FixtureName`, `type FixtureIds`, `interface AbandonedFixtureStore { save(session, tenantId, updatedAt: Date): Promise<void> }`, `seedAbandonedFixture(store, tenants: { tenantId; otherTenantId }, newId: () => string): Promise<FixtureIds>`, `ABANDONED_FIXTURE_CASES: readonly { name; query: Omit<AbandonedCheckoutQuery, "olderThan">; expected: readonly FixtureName[] }[]`, `expectedIds(ids: FixtureIds, names: readonly FixtureName[]): string[]` (id desc).

- [ ] **Step 1: Write the failing domain tests for the recovery fields**

`services/checkout/src/domain/checkout-session.recovery.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { CheckoutSession } from "./checkout-session";
import { CheckoutExpired } from "./events/checkout-expired.event";
import { CheckoutItem } from "./value-objects/checkout-item";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function open(options: { recoveredFromRef?: string } = {}): CheckoutSession {
  const session = CheckoutSession.start(
    UniqueEntityId.from("cs-original"),
    "cart-1",
    undefined,
    "session-1",
    "EGP",
    options,
  );
  session.loadItems([must(CheckoutItem.create("product-1", 1, 1000, "EGP"))]);
  session.pullDomainEvents();
  return session;
}

const AT = new Date("2026-10-18T12:00:00.000Z");

describe("CheckoutSession — recovery (order operations Part 3)", () => {
  it("a session starts with no recovery marks; a recovered one remembers where it came from", () => {
    expect(open().recoveredFromRef).toBeUndefined();
    expect(open().recoveredOrderRef).toBeUndefined();
    expect(open({ recoveredFromRef: "cs-abandoned" }).recoveredFromRef).toBe("cs-abandoned");
  });

  it("markRecovered stamps the order and expires a still-open original, so it can't be placed too", () => {
    const original = open();
    original.markRecovered("order-9", "evt-1", AT);
    expect(original.recoveredOrderRef).toBe("order-9");
    expect(original.state.value).toBe("expired");
    const events = original.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(CheckoutExpired);
    expect(() => original.loadItems([])).toThrow(BusinessRuleError);
  });

  it("expires a locked original too", () => {
    const original = open();
    original.lock("evt-lock", AT);
    original.markRecovered("order-9", "evt-1", AT);
    expect(original.state.value).toBe("expired");
  });

  it("only stamps an original that is already failed or expired", () => {
    const failed = open();
    failed.fail("declined", "evt-fail", AT);
    failed.pullDomainEvents();
    failed.markRecovered("order-9", "evt-1", AT);
    expect(failed.recoveredOrderRef).toBe("order-9");
    expect(failed.state.value).toBe("failed");
    expect(failed.pullDomainEvents()).toHaveLength(0);
  });

  it("marking twice keeps the first order", () => {
    const original = open();
    original.markRecovered("order-9", "evt-1", AT);
    original.markRecovered("order-10", "evt-2", AT);
    expect(original.recoveredOrderRef).toBe("order-9");
  });

  it("refuses to mark a completed checkout recovered", () => {
    const original = open();
    original.complete("order-1", "evt-complete", AT);
    expect(() => original.markRecovered("order-9", "evt-1", AT)).toThrow(BusinessRuleError);
    expect(original.recoveredOrderRef).toBeUndefined();
  });

  it("reconstitute carries both marks", () => {
    const loaded = CheckoutSession.reconstitute(
      UniqueEntityId.from("cs-1"),
      "cart-1",
      undefined,
      "session-1",
      "EGP",
      open().state,
      null,
      [],
      3,
      { recoveredFromRef: "cs-0", recoveredOrderRef: "order-1" },
    );
    expect(loaded.recoveredFromRef).toBe("cs-0");
    expect(loaded.recoveredOrderRef).toBe("order-1");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @platform/checkout exec vitest run src/domain/checkout-session.recovery.test.ts`
Expected: FAIL — TypeScript/vitest reports `markRecovered is not a function` and `recoveredFromRef` undefined for the recovered start.

- [ ] **Step 3: Add the fields and `markRecovered` to `CheckoutSession`**

In `services/checkout/src/domain/checkout-session.ts`:

Add to `interface CheckoutSessionProps` (after `codeAttemptsWindowStartedAt?: Date;`):

```ts
  /** Order operations Part 3: on a session a recovery link created — the abandoned session's id. Set at start only. */
  readonly recoveredFromRef?: string;
  /** Order operations Part 3: on the abandoned session, once its recovered checkout became this order. */
  recoveredOrderRef?: string;
```

Replace the `start` signature and body:

```ts
  static start(
    id: UniqueEntityId,
    cartRef: string,
    customerRef: string | undefined,
    sessionRef: string,
    currency: string,
    options: { readonly recoveredFromRef?: string } = {},
  ): CheckoutSession {
    return new CheckoutSession(
      {
        cartRef,
        customerRef,
        sessionRef,
        currency,
        state: CheckoutState.started(),
        orderRef: null,
        items: [],
        discountCodes: [],
        rejectedCodeAttempts: 0,
        ...(options.recoveredFromRef === undefined
          ? {}
          : { recoveredFromRef: options.recoveredFromRef }),
      },
      id,
    );
  }
```

In `reconstitute`, add to the `extra` parameter type:

```ts
      readonly recoveredFromRef?: string;
      readonly recoveredOrderRef?: string;
```

and to the props object it builds (after `codeAttemptsWindowStartedAt: extra.codeAttemptsWindowStartedAt,`):

```ts
        recoveredFromRef: extra.recoveredFromRef,
        recoveredOrderRef: extra.recoveredOrderRef,
```

Add after `expire(...)`:

```ts
  /**
   * Order operations Part 3: this abandoned checkout was recovered — a session cloned from it through a
   * recovery link became `orderRef`. Stamps it (it stays listed as "Recovered") and expires it while it
   * is still open, so the original browser cannot also place it. Marking twice keeps the first order; a
   * completed checkout was placed by its own shopper and is never marked (the caller skips it).
   */
  markRecovered(orderRef: string, eventId: string, occurredAt: Date): void {
    if (this.props.recoveredOrderRef !== undefined) return;
    if (this.props.state.value === "completed") {
      throw new BusinessRuleError("A completed checkout cannot be marked recovered");
    }
    this.props.recoveredOrderRef = orderRef;
    if (this.props.state.isOpen) this.expire(eventId, occurredAt);
  }
```

Add the getters next to the others:

```ts
  get recoveredFromRef(): string | undefined {
    return this.props.recoveredFromRef;
  }

  get recoveredOrderRef(): string | undefined {
    return this.props.recoveredOrderRef;
  }
```

- [ ] **Step 4: Run the domain test**

Run: `pnpm --filter @platform/checkout exec vitest run src/domain/checkout-session.recovery.test.ts src/domain/checkout-session.test.ts`
Expected: PASS (the existing session tests are unchanged).

- [ ] **Step 5: Write the failing tests for the abandoned definition**

`services/checkout/src/domain/abandoned-checkouts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import {
  abandonedBefore,
  ABANDONED_PAGE_SIZE_MAX,
  clampAbandonedPageSize,
  isAbandonedCheckout,
  matchesAbandonedSearch,
  normalizeAbandonedSearch,
} from "./abandoned-checkouts";
import { CheckoutSession } from "./checkout-session";
import { CheckoutAddress } from "./value-objects/checkout-address";
import { CheckoutItem } from "./value-objects/checkout-item";
import { ContactEmail } from "./value-objects/contact-email";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

const NOW = new Date("2026-10-18T12:00:00.000Z");
const OLDER_THAN = abandonedBefore(NOW);
const IDLE = new Date("2026-10-18T10:59:59.999Z");
const JUST_NOW = new Date("2026-10-18T11:00:00.000Z");

function session(
  options: { email?: string; phone?: string; name?: string; items?: boolean } = {},
): CheckoutSession {
  const s = CheckoutSession.start(UniqueEntityId.from("cs-1"), "cart-1", undefined, "ref-1", "EGP");
  if (options.items !== false) s.loadItems([must(CheckoutItem.create("p-1", 1, 1000, "EGP"))]);
  if (options.email !== undefined) s.setContactEmail(must(ContactEmail.create(options.email)));
  if (options.phone !== undefined || options.name !== undefined) {
    s.setShippingAddress(
      must(
        CheckoutAddress.create({
          name: options.name,
          phone: options.phone,
          line1: "5 Nile St",
          city: "Cairo",
          postalCode: "",
          country: "EG",
        }),
      ),
    );
  }
  return s;
}

const record = (s: CheckoutSession, updatedAt = IDLE) => ({
  session: s,
  createdAt: updatedAt,
  updatedAt,
});

describe("isAbandonedCheckout (spec §3.1)", () => {
  it("the threshold is 60 minutes before now", () => {
    expect(OLDER_THAN).toEqual(new Date("2026-10-18T11:00:00.000Z"));
  });

  it("open, idle an hour, with items and an email or a phone", () => {
    expect(isAbandonedCheckout(record(session({ email: "a@b.co" })), OLDER_THAN)).toBe(true);
    expect(isAbandonedCheckout(record(session({ phone: "01001234567" })), OLDER_THAN)).toBe(true);
    const locked = session({ email: "a@b.co" });
    locked.lock("e", NOW);
    expect(isAbandonedCheckout(record(locked), OLDER_THAN)).toBe(true);
  });

  it("not while the shopper may still be typing (idle exactly 60 minutes is not yet)", () => {
    expect(isAbandonedCheckout(record(session({ email: "a@b.co" }), JUST_NOW), OLDER_THAN)).toBe(
      false,
    );
  });

  it("not without items, without any contact, or once completed / failed / expired", () => {
    expect(
      isAbandonedCheckout(record(session({ email: "a@b.co", items: false })), OLDER_THAN),
    ).toBe(false);
    expect(isAbandonedCheckout(record(session({ name: "No Phone" })), OLDER_THAN)).toBe(false);
    for (const end of ["complete", "fail", "expire"] as const) {
      const s = session({ email: "a@b.co" });
      if (end === "complete") s.complete("o-1", "e", NOW);
      if (end === "fail") s.fail("declined", "e", NOW);
      if (end === "expire") s.expire("e", NOW);
      expect(isAbandonedCheckout(record(s), OLDER_THAN), end).toBe(false);
    }
  });

  it("a recovered checkout stays listed, however fresh or closed", () => {
    const s = session({ email: "a@b.co" });
    s.markRecovered("order-9", "e", NOW);
    expect(isAbandonedCheckout(record(s, NOW), OLDER_THAN)).toBe(true);
  });
});

describe("search and page size", () => {
  it("normalizes the search: trimmed, blank is none, capped at 100 characters", () => {
    expect(normalizeAbandonedSearch(undefined)).toBeUndefined();
    expect(normalizeAbandonedSearch("   ")).toBeUndefined();
    expect(normalizeAbandonedSearch("  mona ")).toBe("mona");
    expect(normalizeAbandonedSearch("x".repeat(150))).toHaveLength(100);
  });

  it("matches the email, the recipient's name and the phone, case-insensitively and literally", () => {
    const s = session({ email: "Sara@Example.com", phone: "01001234567", name: "Mona Ali" });
    expect(matchesAbandonedSearch(s, "SARA@")).toBe(true);
    expect(matchesAbandonedSearch(s, "mona")).toBe(true);
    expect(matchesAbandonedSearch(s, "0100123")).toBe(true);
    expect(matchesAbandonedSearch(s, "%")).toBe(false);
    expect(matchesAbandonedSearch(s, "ahmed")).toBe(false);
  });

  it("clamps the page size to 1..50, default 50", () => {
    expect(clampAbandonedPageSize(undefined)).toBe(ABANDONED_PAGE_SIZE_MAX);
    expect(clampAbandonedPageSize(0)).toBe(1);
    expect(clampAbandonedPageSize(500)).toBe(50);
    expect(clampAbandonedPageSize(20.7)).toBe(20);
    expect(clampAbandonedPageSize(Number.NaN)).toBe(50);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @platform/checkout exec vitest run src/domain/abandoned-checkouts.test.ts`
Expected: FAIL — `Cannot find module './abandoned-checkouts'`.

- [ ] **Step 7: Write `abandoned-checkouts.ts`**

`services/checkout/src/domain/abandoned-checkouts.ts`:

```ts
import type { CheckoutSession } from "./checkout-session";

/** Spec §3.1 decision: an open checkout counts as abandoned once idle this long. */
export const ABANDONED_AFTER_MINUTES = 60;
/** Shopify's page size — and the most order numbers one `listOrders({ ids })` read resolves. */
export const ABANDONED_PAGE_SIZE_MAX = 50;
export const ABANDONED_SEARCH_MAX_LENGTH = 100;
export const RECOVERY_FILTERS = ["recovered", "not_recovered"] as const;
export type RecoveryFilter = (typeof RECOVERY_FILTERS)[number];

/** A session with the two timestamps the aggregate does not carry (its row's columns). */
export interface CheckoutSessionRecord {
  readonly session: CheckoutSession;
  readonly createdAt: Date;
  /** The last change to the session — the list's "last activity". */
  readonly updatedAt: Date;
}

export interface AbandonedCheckoutQuery {
  /** Open sessions count only when last changed before this instant ({@link abandonedBefore}). */
  readonly olderThan: Date;
  readonly first?: number;
  /** Cursor: the id of the last row of the previous page (ids are UUIDv7, time-ordered). */
  readonly after?: string;
  readonly search?: string;
  readonly recovery?: RecoveryFilter;
}

export interface AbandonedCheckoutPage {
  readonly items: readonly CheckoutSessionRecord[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
}

/**
 * Order operations Part 3: the read side of abandoned checkouts. Its own port (not
 * `CheckoutSessionRepository`) so the many narrow fakes of that port stay valid; both session
 * repositories implement it. ADR-0014: `tenantId` per call.
 */
export interface AbandonedCheckoutQueries {
  /** Abandoned checkouts of one shop ({@link isAbandonedCheckout}), newest first by id. */
  listAbandoned(query: AbandonedCheckoutQuery, tenantId: string): Promise<AbandonedCheckoutPage>;
  /** One session with its timestamps, or null — also for an id that is not a UUID. */
  findRecord(id: string, tenantId: string, tx?: unknown): Promise<CheckoutSessionRecord | null>;
}

export function abandonedBefore(now: Date): Date {
  return new Date(now.getTime() - ABANDONED_AFTER_MINUTES * 60_000);
}

export function isRecovered(session: CheckoutSession): boolean {
  return session.recoveredOrderRef !== undefined;
}

/**
 * Spec §3.1, derived at read time (no job): open (`started`/`locked`), last changed before
 * `olderThan`, at least one item, and an email or a shipping phone to reach the shopper — plus every
 * recovered checkout, so it stays listed as "Recovered". `PrismaCheckoutSessionRepository.listAbandoned`
 * is the same rule in SQL; the shared fixture keeps them equal.
 */
export function isAbandonedCheckout(record: CheckoutSessionRecord, olderThan: Date): boolean {
  const { session } = record;
  if (isRecovered(session)) return true;
  return (
    session.state.isOpen &&
    record.updatedAt.getTime() < olderThan.getTime() &&
    session.items.length > 0 &&
    (session.contactEmail !== undefined || session.shippingAddress?.phone !== undefined)
  );
}

export function normalizeAbandonedSearch(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  return trimmed.slice(0, ABANDONED_SEARCH_MAX_LENGTH);
}

export function clampAbandonedPageSize(first: number | undefined): number {
  if (first === undefined || !Number.isFinite(first)) return ABANDONED_PAGE_SIZE_MAX;
  return Math.max(1, Math.min(Math.trunc(first), ABANDONED_PAGE_SIZE_MAX));
}

/** Contact email, recipient name or phone contains `search` — case-insensitive, taken literally. */
export function matchesAbandonedSearch(session: CheckoutSession, search: string): boolean {
  const needle = search.toLowerCase();
  return [
    session.contactEmail?.value,
    session.shippingAddress?.name,
    session.shippingAddress?.phone,
  ].some((value) => value !== undefined && value.toLowerCase().includes(needle));
}
```

- [ ] **Step 8: Run the definition tests**

Run: `pnpm --filter @platform/checkout exec vitest run src/domain/abandoned-checkouts.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing mapper tests**

Append to `services/checkout/src/infrastructure/checkout-session.mapper.test.ts`:

```ts
describe("CheckoutSessionMapper — recovery marks (order operations Part 3)", () => {
  it("writes null for both when unset", () => {
    const row = CheckoutSessionMapper.toRow(guest(), "t1");
    expect(row.recoveredFromRef).toBeNull();
    expect(row.recoveredOrderRef).toBeNull();
  });

  it("round-trips both marks", () => {
    const session = CheckoutSession.start(
      UniqueEntityId.from("00000000-0000-4000-8000-000000000002"),
      "cart-1",
      undefined,
      "session-1",
      "USD",
      { recoveredFromRef: "00000000-0000-4000-8000-000000000001" },
    );
    const row = CheckoutSessionMapper.toRow(session, "t1");
    expect(row.recoveredFromRef).toBe("00000000-0000-4000-8000-000000000001");
    const original = guest();
    original.markRecovered("order-9", "evt-1", new Date(0));
    expect(
      CheckoutSessionMapper.toDomain(asRow(CheckoutSessionMapper.toRow(original, "t1")))
        .recoveredOrderRef,
    ).toBe("order-9");
    expect(CheckoutSessionMapper.toDomain(asRow(row)).recoveredFromRef).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it("reads a row from before the migration (no such keys) as unset", () => {
    const legacy: CheckoutSessionRow = {
      ...asRow(CheckoutSessionMapper.toRow(guest(), "t1")),
      recoveredFromRef: undefined,
      recoveredOrderRef: undefined,
    };
    const session = CheckoutSessionMapper.toDomain(legacy);
    expect(session.recoveredFromRef).toBeUndefined();
    expect(session.recoveredOrderRef).toBeUndefined();
  });
});
```

Run: `pnpm --filter @platform/checkout exec vitest run src/infrastructure/checkout-session.mapper.test.ts`
Expected: FAIL — `row.recoveredFromRef` is `undefined`, not `null`.

- [ ] **Step 10: Map the two columns**

In `services/checkout/src/infrastructure/checkout-session.mapper.ts`:

Add to `interface CheckoutSessionRow` (after `discounts`):

```ts
  /** Order operations Part 3: optional so rows read before the migration still map. */
  readonly recoveredFromRef?: string | null;
  readonly recoveredOrderRef?: string | null;
```

In `toDomain`, add to the `reconstitute` extra object (after `codeAttemptsWindowStartedAt: …`):

```ts
        recoveredFromRef: row.recoveredFromRef ?? undefined,
        recoveredOrderRef: row.recoveredOrderRef ?? undefined,
```

In `toRow`, add before `version: 1,`:

```ts
      recoveredFromRef: session.recoveredFromRef ?? null,
      recoveredOrderRef: session.recoveredOrderRef ?? null,
```

Run the mapper test again. Expected: PASS.

- [ ] **Step 11: Write the shared fixture**

`services/checkout/src/infrastructure/abandoned-checkout-fixture.ts`:

```ts
import { UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { abandonedBefore, type AbandonedCheckoutQuery } from "../domain/abandoned-checkouts";
import { CheckoutSession } from "../domain/checkout-session";
import { CheckoutAddress } from "../domain/value-objects/checkout-address";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import { ContactEmail } from "../domain/value-objects/contact-email";

/**
 * TEST-ONLY (order operations Part 3). One set of sessions — every case the abandoned definition keeps
 * or drops — that the in-memory store (unit test) and the Prisma store (integration test) must list
 * identically. Ids come from the caller so the integration run can use fresh UUIDs each time.
 */
export const FIXTURE_NOW = new Date("2026-10-18T12:00:00.000Z");
export const FIXTURE_OLDER_THAN = abandonedBefore(FIXTURE_NOW);
const IDLE = new Date("2026-10-18T10:00:00.000Z");
const FRESH = new Date("2026-10-18T11:30:00.000Z");

export const FIXTURE_NAMES = [
  "emailOnly",
  "phoneOnly",
  "locked",
  "recovered",
  "completed",
  "failed",
  "expired",
  "fresh",
  "noContact",
  "noItems",
  "otherTenant",
] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];
export type FixtureIds = Readonly<Record<FixtureName, string>>;

export interface AbandonedFixtureStore {
  /** Saves the session as last changed at `updatedAt`. */
  save(session: CheckoutSession, tenantId: string, updatedAt: Date): Promise<void>;
}

function must<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function open(
  id: string,
  name: FixtureName,
  options: { email?: string; phone?: string; recipient?: string; items?: boolean },
): CheckoutSession {
  const session = CheckoutSession.start(
    UniqueEntityId.from(id),
    `cart-${name}`,
    undefined,
    `session-${name}`,
    "EGP",
  );
  if (options.items !== false) {
    session.loadItems([must(CheckoutItem.create("product-1", 1, 1000, "EGP"))]);
  }
  if (options.email !== undefined)
    session.setContactEmail(must(ContactEmail.create(options.email)));
  if (options.phone !== undefined || options.recipient !== undefined) {
    session.setShippingAddress(
      must(
        CheckoutAddress.create({
          name: options.recipient,
          phone: options.phone,
          line1: "5 Nile St",
          city: "Cairo",
          postalCode: "",
          country: "EG",
        }),
      ),
    );
  }
  return session;
}

export async function seedAbandonedFixture(
  store: AbandonedFixtureStore,
  tenants: { readonly tenantId: string; readonly otherTenantId: string },
  newId: () => string,
): Promise<FixtureIds> {
  const ids = Object.fromEntries(FIXTURE_NAMES.map((name) => [name, newId()])) as Record<
    FixtureName,
    string
  >;
  const at = new Date(0);
  const emailOnly = open(ids.emailOnly, "emailOnly", { email: "Sara@Example.com" });
  const phoneOnly = open(ids.phoneOnly, "phoneOnly", {
    phone: "01001234567",
    recipient: "Mona Ali",
  });
  const locked = open(ids.locked, "locked", { email: "ali@example.com", recipient: "Ahmed" });
  locked.lock(newId(), at);
  const recovered = open(ids.recovered, "recovered", { email: "omar@example.com" });
  recovered.markRecovered("order-recovered", newId(), at);
  const completed = open(ids.completed, "completed", { email: "done@example.com" });
  completed.complete("order-completed", newId(), at);
  const failed = open(ids.failed, "failed", { email: "failed@example.com" });
  failed.fail("declined", newId(), at);
  const expired = open(ids.expired, "expired", { email: "gone@example.com" });
  expired.expire(newId(), at);
  const fresh = open(ids.fresh, "fresh", { email: "fresh@example.com" });
  const noContact = open(ids.noContact, "noContact", { recipient: "No Phone" });
  const noItems = open(ids.noItems, "noItems", { email: "empty@example.com", items: false });
  const otherTenant = open(ids.otherTenant, "otherTenant", { email: "sara@example.com" });

  const own: readonly (readonly [CheckoutSession, Date])[] = [
    [emailOnly, IDLE],
    [phoneOnly, IDLE],
    [locked, IDLE],
    [recovered, FRESH],
    [completed, IDLE],
    [failed, IDLE],
    [expired, IDLE],
    [fresh, FRESH],
    [noContact, IDLE],
    [noItems, IDLE],
  ];
  for (const [session, updatedAt] of own) await store.save(session, tenants.tenantId, updatedAt);
  await store.save(otherTenant, tenants.otherTenantId, IDLE);
  return ids;
}

export interface AbandonedFixtureCase {
  readonly name: string;
  readonly query: Omit<AbandonedCheckoutQuery, "olderThan">;
  readonly expected: readonly FixtureName[];
}

const LISTED: readonly FixtureName[] = ["emailOnly", "phoneOnly", "locked", "recovered"];

export const ABANDONED_FIXTURE_CASES: readonly AbandonedFixtureCase[] = [
  {
    name: "lists idle open sessions with an email or a phone, plus recovered ones — nothing else",
    query: {},
    expected: LISTED,
  },
  {
    name: "search matches the email, case-insensitively",
    query: { search: "SARA@" },
    expected: ["emailOnly"],
  },
  {
    name: "search matches the recipient's name",
    query: { search: "mona" },
    expected: ["phoneOnly"],
  },
  { name: "search matches the phone", query: { search: "0100123" }, expected: ["phoneOnly"] },
  { name: "a search with % is taken literally", query: { search: "%" }, expected: [] },
  { name: "recovered only", query: { recovery: "recovered" }, expected: ["recovered"] },
  {
    name: "not recovered only",
    query: { recovery: "not_recovered" },
    expected: ["emailOnly", "phoneOnly", "locked"],
  },
];

/** The ids of `names` in the list's order (id descending). */
export function expectedIds(ids: FixtureIds, names: readonly FixtureName[]): string[] {
  return names
    .map((name) => ids[name])
    .sort()
    .reverse();
}

export const FIXTURE_LISTED: readonly FixtureName[] = LISTED;
```

- [ ] **Step 12: Write the failing in-memory store test**

`services/checkout/src/infrastructure/in-memory-checkout-session-repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import {
  ABANDONED_FIXTURE_CASES,
  expectedIds,
  FIXTURE_LISTED,
  FIXTURE_OLDER_THAN,
  seedAbandonedFixture,
} from "./abandoned-checkout-fixture";
import { CheckoutEventTranslator } from "./checkout-event-translator";
import { InMemoryCheckoutSessionRepository } from "./in-memory-checkout-session-repository";

async function seeded() {
  let now = new Date(0);
  const repository = new InMemoryCheckoutSessionRepository({
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new CheckoutEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "checkout",
    }),
    context: rootEventContext({ generate: () => "evt-x" }),
    clock: { now: () => now },
  });
  let n = 0;
  const ids = await seedAbandonedFixture(
    {
      save: async (session, tenantId, updatedAt) => {
        now = updatedAt;
        await repository.save(session, tenantId);
      },
    },
    { tenantId: "tenant-a", otherTenantId: "tenant-b" },
    () => `01920000-0000-7000-8000-${(n += 1).toString(16).padStart(12, "0")}`,
  );
  return { repository, ids };
}

describe("InMemoryCheckoutSessionRepository.listAbandoned (shared fixture)", () => {
  for (const c of ABANDONED_FIXTURE_CASES) {
    it(c.name, async () => {
      const { repository, ids } = await seeded();
      const page = await repository.listAbandoned(
        { ...c.query, olderThan: FIXTURE_OLDER_THAN },
        "tenant-a",
      );
      expect(page.items.map((r) => r.session.id.toString())).toEqual(expectedIds(ids, c.expected));
    });
  }

  it("pages by id, newest first", async () => {
    const { repository, ids } = await seeded();
    const all = expectedIds(ids, FIXTURE_LISTED);
    const first = await repository.listAbandoned(
      { olderThan: FIXTURE_OLDER_THAN, first: 2 },
      "tenant-a",
    );
    expect(first.items.map((r) => r.session.id.toString())).toEqual(all.slice(0, 2));
    expect(first.pageInfo).toEqual({ hasNextPage: true, endCursor: all[1] });
    const second = await repository.listAbandoned(
      { olderThan: FIXTURE_OLDER_THAN, first: 2, after: all[1] },
      "tenant-a",
    );
    expect(second.items.map((r) => r.session.id.toString())).toEqual(all.slice(2));
    expect(second.pageInfo.hasNextPage).toBe(false);
  });

  it("records when a session was created and last changed", async () => {
    const { repository, ids } = await seeded();
    const record = await repository.findRecord(ids.emailOnly, "tenant-a");
    expect(record?.createdAt).toEqual(new Date("2026-10-18T10:00:00.000Z"));
    expect(record?.updatedAt).toEqual(new Date("2026-10-18T10:00:00.000Z"));
    expect(await repository.findRecord(ids.emailOnly, "tenant-b")).toBeNull();
  });
});
```

Run: `pnpm --filter @platform/checkout exec vitest run src/infrastructure/in-memory-checkout-session-repository.test.ts`
Expected: FAIL — `repository.listAbandoned is not a function`.

- [ ] **Step 13: Implement the in-memory side**

Replace `services/checkout/src/infrastructure/in-memory-checkout-session-repository.ts` with:

```ts
import type { Clock } from "@platform/contracts";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import {
  clampAbandonedPageSize,
  isAbandonedCheckout,
  isRecovered,
  matchesAbandonedSearch,
  normalizeAbandonedSearch,
  type AbandonedCheckoutPage,
  type AbandonedCheckoutQueries,
  type AbandonedCheckoutQuery,
  type CheckoutSessionRecord,
} from "../domain/abandoned-checkouts";
import type { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";

export interface InMemoryCheckoutSessionRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
  /** Order operations Part 3: stamps created/updated times like Prisma's columns; wall clock by default. */
  readonly clock?: Clock;
}

interface Times {
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** In-memory `CheckoutSessionRepository`. Persists the aggregate and writes events to the outbox on save. ADR-0014 (WP-10, T10.3): keyed by `(tenantId, id)`. */
export class InMemoryCheckoutSessionRepository
  implements CheckoutSessionRepository, AbandonedCheckoutQueries
{
  private readonly store = new Map<string, Map<string, CheckoutSession>>();
  private readonly times = new Map<string, Map<string, Times>>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;
  private readonly clock: Clock;

  constructor(deps: InMemoryCheckoutSessionRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
    this.clock = deps.clock ?? { now: () => new Date() };
  }

  async save(session: CheckoutSession, tenantId: string, tx?: unknown): Promise<void> {
    let bucket = this.store.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.store.set(tenantId, bucket);
    }
    const id = session.id.toString();
    bucket.set(id, session);

    let times = this.times.get(tenantId);
    if (times === undefined) {
      times = new Map();
      this.times.set(tenantId, times);
    }
    const now = this.clock.now();
    times.set(id, { createdAt: times.get(id)?.createdAt ?? now, updatedAt: now });

    await this.outbox.write(session.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<CheckoutSession | null> {
    return this.store.get(tenantId)?.get(id) ?? null;
  }

  async findRecord(id: string, tenantId: string): Promise<CheckoutSessionRecord | null> {
    return this.recordOf(id, tenantId);
  }

  async listAbandoned(
    query: AbandonedCheckoutQuery,
    tenantId: string,
  ): Promise<AbandonedCheckoutPage> {
    const search = normalizeAbandonedSearch(query.search);
    const first = clampAbandonedPageSize(query.first);
    const matching = [...(this.store.get(tenantId)?.keys() ?? [])]
      .map((id) => this.recordOf(id, tenantId))
      .filter((record): record is CheckoutSessionRecord => record !== null)
      .filter((record) => isAbandonedCheckout(record, query.olderThan))
      .filter(
        (record) =>
          query.recovery === undefined ||
          (query.recovery === "recovered") === isRecovered(record.session),
      )
      .filter((record) => search === undefined || matchesAbandonedSearch(record.session, search))
      .filter((record) => query.after === undefined || record.session.id.toString() < query.after)
      .sort((a, b) => (a.session.id.toString() < b.session.id.toString() ? 1 : -1));
    const items = matching.slice(0, first);
    return {
      items,
      pageInfo: {
        hasNextPage: matching.length > first,
        endCursor: items.at(-1)?.session.id.toString() ?? null,
      },
    };
  }

  private recordOf(id: string, tenantId: string): CheckoutSessionRecord | null {
    const session = this.store.get(tenantId)?.get(id);
    const times = this.times.get(tenantId)?.get(id);
    return session === undefined || times === undefined ? null : { session, ...times };
  }
}
```

In `services/checkout/src/composition.ts`, in the in-memory branch, change

```ts
const sessions = new InMemoryCheckoutSessionRepository({ outbox: outboxWriter, context });
```

to

```ts
const sessions = new InMemoryCheckoutSessionRepository({
  outbox: outboxWriter,
  context,
  clock: deps.clock,
});
```

Run the in-memory test again. Expected: PASS.

- [ ] **Step 14: Write the failing Prisma-side tests (over fake-prisma)**

`services/checkout/src/infrastructure/prisma-checkout-session-repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { CheckoutSession } from "../domain/checkout-session";
import { CheckoutEventTranslator } from "./checkout-event-translator";
import { CheckoutSessionMapper } from "./checkout-session.mapper";
import { escapeLike, PrismaCheckoutSessionRepository } from "./prisma-checkout-session-repository";

const ID = "01920000-0000-7000-8000-000000000001";
const CREATED = new Date("2026-10-18T09:00:00.000Z");
const UPDATED = new Date("2026-10-18T10:00:00.000Z");

async function setup() {
  const fake = createFakePrisma();
  const repository = new PrismaCheckoutSessionRepository({
    prisma: fake.database,
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new CheckoutEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "checkout",
    }) as never,
    context: rootEventContext({ generate: () => "evt-x" }),
  });
  const session = CheckoutSession.start(
    UniqueEntityId.from(ID),
    "cart-1",
    undefined,
    "ref-1",
    "EGP",
    {
      recoveredFromRef: "01920000-0000-7000-8000-0000000000ff",
    },
  );
  // fake-prisma has no column defaults: seed the timestamps explicitly.
  await fake.database.checkoutSession.create({
    data: {
      ...CheckoutSessionMapper.toRow(session, "tenant-a"),
      createdAt: CREATED,
      updatedAt: UPDATED,
    } as never,
  });
  return { fake, repository };
}

describe("PrismaCheckoutSessionRepository — Part 3 reads (over fake-prisma)", () => {
  it("findRecord answers the session with its row's timestamps and recovery mark", async () => {
    const { repository } = await setup();
    const record = await repository.findRecord(ID, "tenant-a");
    expect(record?.createdAt).toEqual(CREATED);
    expect(record?.updatedAt).toEqual(UPDATED);
    expect(record?.session.recoveredFromRef).toBe("01920000-0000-7000-8000-0000000000ff");
    expect(await repository.findRecord(ID, "tenant-b")).toBeNull();
  });

  it("a non-UUID id or cursor answers nothing without querying (UUID column; Review Focus 5)", async () => {
    const { repository } = await setup();
    expect(await repository.findRecord("abc", "tenant-a")).toBeNull();
    // fake-prisma has no $queryRaw: reaching the query would throw here.
    expect(
      await repository.listAbandoned({ olderThan: new Date(), after: "xyz" }, "tenant-a"),
    ).toEqual({ items: [], pageInfo: { hasNextPage: false, endCursor: null } });
  });
});

describe("escapeLike", () => {
  it("escapes %, _ and backslash so a typed search matches literally", () => {
    expect(escapeLike("100%_\\x")).toBe("100\\%\\_\\\\x");
    expect(escapeLike("mona")).toBe("mona");
  });
});
```

Run: `pnpm --filter @platform/checkout exec vitest run src/infrastructure/prisma-checkout-session-repository.test.ts`
Expected: FAIL — `escapeLike` is not exported / `findRecord` is not a function.

- [ ] **Step 15: Implement the Prisma side**

Replace `services/checkout/src/infrastructure/prisma-checkout-session-repository.ts` with:

```ts
import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import {
  clampAbandonedPageSize,
  normalizeAbandonedSearch,
  type AbandonedCheckoutPage,
  type AbandonedCheckoutQueries,
  type AbandonedCheckoutQuery,
  type CheckoutSessionRecord,
} from "../domain/abandoned-checkouts";
import type { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import { CheckoutSessionMapper } from "./checkout-session.mapper";
import { isUuid } from "./uuid";

export interface PrismaCheckoutSessionRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

type SessionRow = NonNullable<
  Awaited<ReturnType<TransactionClient["checkoutSession"]["findFirst"]>>
>;

type CheckoutSessionRowItems = readonly {
  readonly productRef: string;
  readonly quantity: number;
  readonly unitPriceAmountMinor: number;
  readonly currency: string;
}[];

function toDomain(row: SessionRow): CheckoutSession {
  return CheckoutSessionMapper.toDomain({
    ...row,
    // `CheckoutSessionRowItems` is an array of closed object shapes without an index
    // signature, so it has no structural overlap with Prisma's `JsonValue` union.
    items: row.items as unknown as CheckoutSessionRowItems,
    billingAddress: row.billingAddress as Record<string, never>,
    shippingAddress: row.shippingAddress as Record<string, never>,
    shippingSelection: row.shippingSelection as Record<string, never>,
    paymentSelection: row.paymentSelection as Record<string, never>,
    totals: row.totals as Record<string, never>,
    discounts: row.discounts as Record<string, never>,
  });
}

function toRecord(row: SessionRow): CheckoutSessionRecord {
  return { session: toDomain(row), createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** `LIKE` treats `%`, `_` and `\` specially; a typed search must match literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

const EMPTY_PAGE: AbandonedCheckoutPage = {
  items: [],
  pageInfo: { hasNextPage: false, endCursor: null },
};

/**
 * Production `CheckoutSessionRepository` on the `checkout` schema. Optimistic locking +
 * same-transaction outbox per ADR-0003. Snapshot columns (items/addresses/selections/totals) are
 * JSONB — `{}` means unset, never `null` (Sprint 4.6's own mapper convention).
 */
export class PrismaCheckoutSessionRepository
  implements CheckoutSessionRepository, AbandonedCheckoutQueries
{
  private readonly deps: PrismaCheckoutSessionRepositoryDeps;

  constructor(deps: PrismaCheckoutSessionRepositoryDeps) {
    this.deps = deps;
  }

  async save(session: CheckoutSession, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const row = CheckoutSessionMapper.toRow(session, tenantId);

    if (session.version === 0) {
      await client.checkoutSession.create({ data: row });
    } else {
      const updated = await client.checkoutSession.updateMany({
        where: { id: session.id.toString(), tenantId, version: session.version },
        data: {
          customerRef: row.customerRef,
          contactEmail: row.contactEmail,
          state: row.state,
          orderRef: row.orderRef,
          items: row.items,
          billingAddress: row.billingAddress,
          shippingAddress: row.shippingAddress,
          shippingSelection: row.shippingSelection,
          paymentSelection: row.paymentSelection,
          taxMinor: row.taxMinor,
          discountMinor: row.discountMinor,
          totals: row.totals,
          discounts: row.discounts,
          recoveredOrderRef: row.recoveredOrderRef,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `CheckoutSession ${session.id.toString()} was modified concurrently (expected version ${session.version})`,
        );
      }
    }

    await this.deps.outbox.write(
      session.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<CheckoutSession | null> {
    const row = await this.findRow(id, tenantId, tx);
    return row === null ? null : toDomain(row);
  }

  async findRecord(
    id: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<CheckoutSessionRecord | null> {
    if (!isUuid(id)) return null;
    const row = await this.findRow(id, tenantId, tx);
    return row === null ? null : toRecord(row);
  }

  /**
   * The abandoned definition (`isAbandonedCheckout`) in SQL: one tenant-filtered id page (raw SQL is
   * outside the Prisma where-guard, so `tenant_id` is filtered in the statement itself), then the rows.
   */
  async listAbandoned(
    query: AbandonedCheckoutQuery,
    tenantId: string,
  ): Promise<AbandonedCheckoutPage> {
    if (query.after !== undefined && !isUuid(query.after)) return EMPTY_PAGE;
    const after = query.after ?? null;
    const first = clampAbandonedPageSize(query.first);
    const search = normalizeAbandonedSearch(query.search);
    const pattern = search === undefined ? null : `%${escapeLike(search)}%`;
    const recovery = query.recovery ?? null;
    const olderThan = query.olderThan.toISOString();

    return runReadScoped(this.deps.prisma, tenantId, async (client) => {
      const page = await client.$queryRaw<{ id: string }[]>`
        SELECT "id"::text AS "id"
        FROM "checkout"."checkout_sessions"
        WHERE "tenant_id" = ${tenantId}
          AND (
            "recovered_order_ref" IS NOT NULL
            OR (
              "state" IN ('started', 'locked')
              AND "updated_at" < (${olderThan}::timestamptz AT TIME ZONE 'UTC')
              AND "items" <> '[]'::jsonb
              AND ("contact_email" IS NOT NULL OR "shipping_address"->>'phone' IS NOT NULL)
            )
          )
          AND (${recovery}::text IS NULL
            OR (${recovery}::text = 'recovered') = ("recovered_order_ref" IS NOT NULL))
          AND (${after}::uuid IS NULL OR "id" < ${after}::uuid)
          AND (${pattern}::text IS NULL
            OR "contact_email" ILIKE ${pattern} ESCAPE '\\'
            OR "shipping_address"->>'name' ILIKE ${pattern} ESCAPE '\\'
            OR "shipping_address"->>'phone' ILIKE ${pattern} ESCAPE '\\')
        ORDER BY "id" DESC
        LIMIT ${first + 1}`;
      const ids = page.slice(0, first).map((row) => row.id);
      if (ids.length === 0) return EMPTY_PAGE;
      const rows = await client.checkoutSession.findMany({ where: { tenantId, id: { in: ids } } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const items = ids.flatMap((id) => {
        const row = byId.get(id);
        return row === undefined ? [] : [toRecord(row)];
      });
      return {
        items,
        pageInfo: {
          hasNextPage: page.length > first,
          endCursor: items.at(-1)?.session.id.toString() ?? null,
        },
      };
    });
  }

  private async findRow(id: string, tenantId: string, tx?: unknown): Promise<SessionRow | null> {
    const run = (client: TransactionClient) =>
      client.checkoutSession.findFirst({ where: { id, tenantId } });
    return tx !== undefined && tx !== null
      ? run(tx as TransactionClient)
      : runReadScoped(this.deps.prisma, tenantId, run);
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaCheckoutSessionRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
```

(`updated_at` is `TIMESTAMP(3)` written in UTC by Prisma; the parameter is cast from an ISO string to
the same UTC wall time, as `prisma-sales-summary-query.ts` does with its dates.)

Run the fake-prisma test again. Expected: PASS.

- [ ] **Step 16: Run the same fixture against PostgreSQL (integration, gated)**

Append to `services/checkout/src/infrastructure/prisma-checkout-session-repository.integration.test.ts`
(add the fixture import at the top):

```ts
import {
  ABANDONED_FIXTURE_CASES,
  expectedIds,
  FIXTURE_LISTED,
  FIXTURE_OLDER_THAN,
  seedAbandonedFixture,
} from "./abandoned-checkout-fixture";
```

```ts
describe.runIf(Boolean(databaseUrl))(
  "PrismaCheckoutSessionRepository.listAbandoned (integration, Part 3)",
  () => {
    async function seeded() {
      const prisma = createTestPrismaClient(databaseUrl);
      const ids: IdGenerator = { generate: () => crypto.randomUUID() };
      const outbox = new OutboxWriter({
        store: new PrismaOutboxStore(prisma),
        translator: new CheckoutEventTranslator(),
        serializer: new InMemoryEventSerializer(),
        clock: { now: () => new Date("2026-10-18T00:00:00.000Z") },
        producer: "checkout",
      });
      const repository = new PrismaCheckoutSessionRepository({
        prisma,
        outbox,
        context: rootEventContext(ids),
      });
      const unitOfWork = new PrismaUnitOfWork(prisma);
      const tenantId = `tenant-p3-${crypto.randomUUID().slice(0, 8)}`;
      const otherTenantId = `tenant-p3-other-${crypto.randomUUID().slice(0, 8)}`;
      const fixtureIds = await seedAbandonedFixture(
        {
          save: async (session, tenant, updatedAt) => {
            await unitOfWork.run((tx) => repository.save(session, tenant, tx));
            await prisma.checkoutSession.updateMany({
              where: { tenantId: tenant, id: session.id.toString() },
              data: { updatedAt },
            });
          },
        },
        { tenantId, otherTenantId },
        () => crypto.randomUUID(),
      );
      return { prisma, repository, tenantId, ids: fixtureIds };
    }

    for (const c of ABANDONED_FIXTURE_CASES) {
      it(c.name, async () => {
        const { prisma, repository, tenantId, ids } = await seeded();
        const page = await repository.listAbandoned(
          { ...c.query, olderThan: FIXTURE_OLDER_THAN },
          tenantId,
        );
        expect(page.items.map((r) => r.session.id.toString())).toEqual(
          expectedIds(ids, c.expected),
        );
        await prisma.$disconnect();
      });
    }

    it("pages by id, newest first", async () => {
      const { prisma, repository, tenantId, ids } = await seeded();
      const all = expectedIds(ids, FIXTURE_LISTED);
      const first = await repository.listAbandoned(
        { olderThan: FIXTURE_OLDER_THAN, first: 2 },
        tenantId,
      );
      expect(first.items.map((r) => r.session.id.toString())).toEqual(all.slice(0, 2));
      expect(first.pageInfo.hasNextPage).toBe(true);
      const second = await repository.listAbandoned(
        { olderThan: FIXTURE_OLDER_THAN, first: 2, after: first.pageInfo.endCursor ?? undefined },
        tenantId,
      );
      expect(second.items.map((r) => r.session.id.toString())).toEqual(all.slice(2));
      await prisma.$disconnect();
    });
  },
);
```

Run (only if a throwaway test database is configured):
`DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/checkout exec vitest run src/infrastructure/prisma-checkout-session-repository.integration.test.ts`
Expected: PASS (it is skipped without `DATABASE_URL_TEST`; say so in the task report).

- [ ] **Step 17: Tenant isolation for the abandoned reads**

Append to `services/checkout/src/infrastructure/tenant-isolation.test.ts` (imports at the top):

```ts
import { FIXTURE_OLDER_THAN, seedAbandonedFixture } from "./abandoned-checkout-fixture";
```

```ts
describe("abandoned checkouts tenant isolation (order operations Part 3)", () => {
  it("shop A never lists or reads shop B's abandoned checkout (in-memory; Prisma: SQL filters tenant_id)", async () => {
    let now = new Date(0);
    const writer = new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new CheckoutEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "checkout",
    });
    const repo = new InMemoryCheckoutSessionRepository({
      outbox: writer,
      context: rootEventContext({ generate: () => "evt-x" }),
      clock: { now: () => now },
    });
    let n = 0;
    const ids = await seedAbandonedFixture(
      {
        save: async (s, t, at) => {
          now = at;
          await repo.save(s, t);
        },
      },
      { tenantId: "tenant-a", otherTenantId: "tenant-b" },
      () => `01920000-0000-7000-8000-${(n += 1).toString(16).padStart(12, "0")}`,
    );
    const listedForA = await repo.listAbandoned(
      { olderThan: FIXTURE_OLDER_THAN, search: "sara" },
      "tenant-a",
    );
    expect(listedForA.items.map((r) => r.session.id.toString())).toEqual([ids.emailOnly]);
    expect(await repo.findRecord(ids.otherTenant, "tenant-a")).toBeNull();
    expect(await repo.findRecord(ids.emailOnly, "tenant-b")).toBeNull();
  });

  it("PrismaCheckoutSessionRepository.findRecord filters by tenant (over fake-prisma)", async () => {
    const fake = createFakePrisma();
    const id = "01920000-0000-7000-8000-00000000000c";
    const session = CheckoutSession.start(
      UniqueEntityId.from(id),
      "cart-1",
      undefined,
      "ref",
      "EGP",
    );
    await fake.database.checkoutSession.create({
      data: {
        ...CheckoutSessionMapper.toRow(session, "tenant-b"),
        createdAt: new Date(0),
        updatedAt: new Date(0),
      } as never,
    });
    const prismaRepo = new PrismaCheckoutSessionRepository({
      prisma: fake.database,
      outbox: undefined as never,
      context: rootEventContext({ generate: () => "evt-x" }),
    });
    expect(await prismaRepo.findRecord(id, "tenant-a")).toBeNull();
    expect(await prismaRepo.findRecord(id, "tenant-b")).not.toBeNull();
  });
});
```

(add `import { CheckoutSessionMapper } from "./checkout-session.mapper";` and
`import { PrismaCheckoutSessionRepository } from "./prisma-checkout-session-repository";` to the imports.)

Run: `pnpm --filter @platform/checkout exec vitest run src/infrastructure/tenant-isolation.test.ts`
Expected: PASS.

- [ ] **Step 18: Guard, typecheck, lint, package tests**

Run: `node scripts/dev/check-prisma-tenant-where.mjs` → exit 0.
Run: `pnpm --filter @platform/checkout typecheck && pnpm --filter @platform/checkout lint && pnpm --filter @platform/checkout test`
Expected: all green (the old mapper/repository/use-case tests still pass unchanged).

- [ ] **Step 19: Commit**

```bash
git add services/checkout/src/domain/checkout-session.ts \
  services/checkout/src/domain/checkout-session.recovery.test.ts \
  services/checkout/src/domain/abandoned-checkouts.ts services/checkout/src/domain/abandoned-checkouts.test.ts \
  services/checkout/src/infrastructure/checkout-session.mapper.ts \
  services/checkout/src/infrastructure/checkout-session.mapper.test.ts \
  services/checkout/src/infrastructure/in-memory-checkout-session-repository.ts \
  services/checkout/src/infrastructure/in-memory-checkout-session-repository.test.ts \
  services/checkout/src/infrastructure/prisma-checkout-session-repository.ts \
  services/checkout/src/infrastructure/prisma-checkout-session-repository.test.ts \
  services/checkout/src/infrastructure/prisma-checkout-session-repository.integration.test.ts \
  services/checkout/src/infrastructure/abandoned-checkout-fixture.ts \
  services/checkout/src/infrastructure/tenant-isolation.test.ts services/checkout/src/composition.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(checkout): abandoned checkout definition and recovery marks on sessions

Sessions remember the checkout a recovery link cloned them from and, on the original, the
order it became; markRecovered expires an open original. Both session stores list the
abandoned ones (open, idle an hour, items, email or phone, plus recovered) from one shared
fixture; non-UUID ids and cursors answer nothing instead of a database error.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Recovery use cases, completion marking the original, and the Checkout wiring

Model tier: **most-capable** (the security rules of the link — uniform invalid answer, spent links — and the transaction boundary of `CompleteCheckout`).

**Files:**

- Create: `services/checkout/src/application/abandoned-checkouts.use-cases.ts`, `services/checkout/src/application/abandoned-checkouts.use-cases.test.ts`
- Modify: `services/checkout/src/application/start-checkout.use-case.ts`
- Create: `services/checkout/src/application/start-checkout.use-case.test.ts`
- Modify: `services/checkout/src/application/complete-checkout.use-case.ts`
- Create: `services/checkout/src/application/complete-checkout.recovery.test.ts`
- Modify: `services/checkout/src/interfaces/checkout.controller.ts`, `services/checkout/src/composition.ts`, `services/checkout/src/index.ts`
- Create: `services/checkout/src/checkout-recovery.wiring.test.ts`

**Interfaces:**

- Consumes: Task 1 `CheckoutLink`, `hashLinkToken`, `RECOVERY_LINK_TTL_MS`, `CheckoutLinkRepository`, `InMemoryCheckoutLinkRepository`, `PrismaCheckoutLinkRepository`; Task 2 `AbandonedCheckoutQueries`, `CheckoutSessionRecord`, `RecoveryFilter`, `abandonedBefore`, `isAbandonedCheckout`, `clampAbandonedPageSize`, `CheckoutSession.markRecovered`, `recoveredFromRef`, `recoveredOrderRef`.
- Produces:
  - `abandoned-checkouts.use-cases.ts`: `LINK_INVALID = "LINK_INVALID"`; `interface CheckoutRecoveryDeps { abandoned: AbandonedCheckoutQueries; sessions: CheckoutSessionRepository; links: CheckoutLinkRepository; unitOfWork; idGenerator; clock }`;
    `ListAbandonedCheckouts.execute({ tenantId, first?, after?, search?, recovery? }) → Result<ListAbandonedCheckoutsOutput>` with `ListAbandonedCheckoutsOutput = { items: readonly AbandonedCheckoutListEntry[]; pageInfo }`, `AbandonedCheckoutListEntry = { record: CheckoutSessionRecord; lastLinkIssuedAt: Date | null }`;
    `GetAbandonedCheckout.execute({ tenantId, checkoutSessionId }) → Result<GetAbandonedCheckoutOutput = { record; links: readonly CheckoutLink[] }>` (404 unless abandoned);
    `IssueRecoveryLink.execute({ tenantId, checkoutSessionId, createdBy }) → Result<IssueRecoveryLinkOutput = { linkId: string; token: string; expiresAt: string }>` (404 not abandoned, 409 `ALREADY_RECOVERED:`);
    `ResolveCheckoutLink.execute({ tenantId, token }) → Result<ResolveCheckoutLinkOutput = { link: CheckoutLink; session: CheckoutSession }>` (every failure: `NotFoundError("LINK_INVALID: …")`);
    `RecordCheckoutLinkClaim.execute({ tenantId, linkId, resultCheckoutRef }) → Result<{ claimCount: number }>`.
  - `StartCheckoutInput.recoveredFromRef?: string`.
  - `CheckoutController`: `listAbandoned(input) → 200`, `getAbandoned(input) → 200`, `issueRecoveryLink(input) → 201`, `resolveLink(input) → 200`, `recordLinkClaim(input) → 200`.
  - `@platform/checkout` exports: `CheckoutLink`, `hashLinkToken`, `isWellFormedLinkToken`, `RECOVERY_LINK_TTL_MS`, `type CheckoutLinkPurpose`, `type CheckoutLinkRepository`, `PrismaCheckoutLinkRepository`, `ABANDONED_AFTER_MINUTES`, `ABANDONED_PAGE_SIZE_MAX`, `RECOVERY_FILTERS`, `type RecoveryFilter`, `type CheckoutSessionRecord`, `type AbandonedCheckoutQueries`, `LINK_INVALID`, `type ListAbandonedCheckoutsOutput`, `type AbandonedCheckoutListEntry`, `type GetAbandonedCheckoutOutput`, `type IssueRecoveryLinkOutput`, `type ResolveCheckoutLinkOutput`.

- [ ] **Step 1: Write the failing use-case tests**

`services/checkout/src/application/abandoned-checkouts.use-cases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import type { Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { hashLinkToken } from "../domain/checkout-link";
import { CheckoutSession } from "../domain/checkout-session";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import { ContactEmail } from "../domain/value-objects/contact-email";
import { CheckoutEventTranslator } from "../infrastructure/checkout-event-translator";
import { InMemoryCheckoutLinkRepository } from "../infrastructure/in-memory-checkout-link-repository";
import { InMemoryCheckoutSessionRepository } from "../infrastructure/in-memory-checkout-session-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import {
  GetAbandonedCheckout,
  IssueRecoveryLink,
  LINK_INVALID,
  ListAbandonedCheckouts,
  RecordCheckoutLinkClaim,
  ResolveCheckoutLink,
} from "./abandoned-checkouts.use-cases";

const T0 = new Date("2026-10-18T09:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TENANT = "tenant-a";
const SESSION_ID = "01920000-0000-7000-8000-000000000001";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function value<T>(result: Result<T, DomainError>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

function error<T>(result: Result<T, DomainError>): DomainError {
  if (result.ok) throw new Error("expected an error");
  return result.error;
}

function world() {
  let now = T0;
  const clock = { now: () => now };
  const sessions = new InMemoryCheckoutSessionRepository({
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new CheckoutEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "checkout",
    }),
    context: rootEventContext({ generate: () => "evt-x" }),
    clock,
  });
  const links = new InMemoryCheckoutLinkRepository();
  let n = 0;
  const deps = {
    abandoned: sessions,
    sessions,
    links,
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator: {
      generate: () => `01920000-0000-7000-8000-0000000a${(n += 1).toString(16).padStart(4, "0")}`,
    },
    clock,
  };
  return {
    sessions,
    links,
    now: () => now,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    list: new ListAbandonedCheckouts(deps),
    get: new GetAbandonedCheckout(deps),
    issue: new IssueRecoveryLink(deps),
    resolve: new ResolveCheckoutLink(deps),
    recordClaim: new RecordCheckoutLinkClaim(deps),
  };
}

type World = ReturnType<typeof world>;

async function abandon(w: World, id = SESSION_ID): Promise<CheckoutSession> {
  const s = CheckoutSession.start(
    UniqueEntityId.from(id),
    "cart-1",
    undefined,
    "ref-original",
    "EGP",
  );
  s.loadItems([must(CheckoutItem.create("p-1", 1, 1000, "EGP"))]);
  s.setContactEmail(must(ContactEmail.create("sara@example.com")));
  await w.sessions.save(s, TENANT);
  return s;
}

/** An abandoned checkout (idle 2 hours) with one recovery link; answers the token. */
async function withLink(w: World): Promise<string> {
  await abandon(w);
  w.advance(2 * HOUR);
  return value(
    await w.issue.execute({
      tenantId: TENANT,
      checkoutSessionId: SESSION_ID,
      createdBy: "staff-op",
    }),
  ).token;
}

describe("ListAbandonedCheckouts", () => {
  it("lists a checkout only once it has been idle for an hour", async () => {
    const w = world();
    await abandon(w);
    w.advance(59 * 60_000);
    expect(value(await w.list.execute({ tenantId: TENANT })).items).toEqual([]);
    w.advance(2 * 60_000);
    const page = value(await w.list.execute({ tenantId: TENANT }));
    expect(page.items.map((entry) => entry.record.session.id.toString())).toEqual([SESSION_ID]);
    expect(page.items[0]?.lastLinkIssuedAt).toBeNull();
  });

  it("shows when the newest recovery link was issued", async () => {
    const w = world();
    await withLink(w);
    w.advance(HOUR);
    value(
      await w.issue.execute({
        tenantId: TENANT,
        checkoutSessionId: SESSION_ID,
        createdBy: "staff-op",
      }),
    );
    const page = value(await w.list.execute({ tenantId: TENANT }));
    expect(page.items[0]?.lastLinkIssuedAt).toEqual(w.now());
  });
});

describe("GetAbandonedCheckout", () => {
  it("answers the checkout with its links, newest first", async () => {
    const w = world();
    await withLink(w);
    w.advance(HOUR);
    value(
      await w.issue.execute({
        tenantId: TENANT,
        checkoutSessionId: SESSION_ID,
        createdBy: "staff-op",
      }),
    );
    const found = value(await w.get.execute({ tenantId: TENANT, checkoutSessionId: SESSION_ID }));
    expect(found.record.session.id.toString()).toBe(SESSION_ID);
    expect(found.links.map((link) => link.createdAt)).toEqual([
      w.now(),
      new Date(T0.getTime() + 2 * HOUR),
    ]);
  });

  it("is 404 for a checkout that is not abandoned (fresh, completed) and for an unknown id", async () => {
    const w = world();
    const s = await abandon(w);
    expect(
      error(await w.get.execute({ tenantId: TENANT, checkoutSessionId: SESSION_ID })).code,
    ).toBe("NOT_FOUND");
    w.advance(2 * HOUR);
    s.complete("order-1", "evt", w.now());
    await w.sessions.save(s, TENANT);
    expect(
      error(await w.get.execute({ tenantId: TENANT, checkoutSessionId: SESSION_ID })).code,
    ).toBe("NOT_FOUND");
    expect(error(await w.get.execute({ tenantId: TENANT, checkoutSessionId: "nope" })).code).toBe(
      "NOT_FOUND",
    );
  });
});

describe("IssueRecoveryLink", () => {
  it("hands out a 43-character token once and stores only its hash, valid for 7 days", async () => {
    const w = world();
    await abandon(w);
    w.advance(2 * HOUR);
    const issued = value(
      await w.issue.execute({
        tenantId: TENANT,
        checkoutSessionId: SESSION_ID,
        createdBy: "staff-op",
      }),
    );
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.expiresAt).toBe(new Date(w.now().getTime() + 7 * DAY).toISOString());
    const stored = await w.links.findByTokenHash(hashLinkToken(issued.token), TENANT);
    expect(stored?.id).toBe(issued.linkId);
    expect(stored?.createdBy).toBe("staff-op");
    expect(await w.links.findByTokenHash(issued.token, TENANT)).toBeNull();
  });

  it("every copy mints a new token; the older one keeps working", async () => {
    const w = world();
    const first = await withLink(w);
    const second = value(
      await w.issue.execute({
        tenantId: TENANT,
        checkoutSessionId: SESSION_ID,
        createdBy: "staff-op",
      }),
    ).token;
    expect(second).not.toBe(first);
    expect((await w.resolve.execute({ tenantId: TENANT, token: first })).ok).toBe(true);
    expect((await w.resolve.execute({ tenantId: TENANT, token: second })).ok).toBe(true);
  });

  it("is 404 for a checkout that is not abandoned yet and 409 for one already recovered", async () => {
    const w = world();
    const s = await abandon(w);
    expect(
      error(
        await w.issue.execute({
          tenantId: TENANT,
          checkoutSessionId: SESSION_ID,
          createdBy: "staff-op",
        }),
      ).code,
    ).toBe("NOT_FOUND");
    w.advance(2 * HOUR);
    s.markRecovered("order-9", "evt", w.now());
    await w.sessions.save(s, TENANT);
    const refused = error(
      await w.issue.execute({
        tenantId: TENANT,
        checkoutSessionId: SESSION_ID,
        createdBy: "staff-op",
      }),
    );
    expect(refused.code).toBe("BUSINESS_RULE");
    expect(refused.message).toMatch(/^ALREADY_RECOVERED:/);
  });
});

describe("ResolveCheckoutLink", () => {
  it("answers the link and the abandoned checkout for a usable token", async () => {
    const w = world();
    const token = await withLink(w);
    const resolved = value(await w.resolve.execute({ tenantId: TENANT, token }));
    expect(resolved.session.id.toString()).toBe(SESSION_ID);
    expect(resolved.link.checkoutSessionId).toBe(SESSION_ID);
  });

  it("answers the SAME not-found for unknown, expired, revoked and other-shop tokens", async () => {
    const answers: DomainError[] = [];
    {
      const w = world();
      await withLink(w);
      answers.push(error(await w.resolve.execute({ tenantId: TENANT, token: "x".repeat(43) })));
    }
    {
      const w = world();
      const token = await withLink(w);
      w.advance(7 * 24 * HOUR);
      answers.push(error(await w.resolve.execute({ tenantId: TENANT, token })));
    }
    {
      const w = world();
      const token = await withLink(w);
      const link = await w.links.findByTokenHash(hashLinkToken(token), TENANT);
      link?.revoke(w.now());
      if (link) await w.links.save(link, TENANT);
      answers.push(error(await w.resolve.execute({ tenantId: TENANT, token })));
    }
    {
      const w = world();
      const token = await withLink(w);
      answers.push(error(await w.resolve.execute({ tenantId: "tenant-b", token })));
    }
    for (const answer of answers) {
      expect(answer.code).toBe("NOT_FOUND");
      expect(answer.message).toBe(answers[0]?.message);
      expect(answer.message.startsWith(LINK_INVALID)).toBe(true);
    }
  });

  it("a link whose checkout was since completed or recovered is spent (Review Focus 4)", async () => {
    for (const end of ["completed", "recovered"] as const) {
      const w = world();
      const token = await withLink(w);
      const s = await w.sessions.findById(SESSION_ID, TENANT);
      if (s === null) throw new Error("setup failed");
      if (end === "completed") s.complete("order-own", "evt", w.now());
      else s.markRecovered("order-9", "evt", w.now());
      await w.sessions.save(s, TENANT);
      const answer = error(await w.resolve.execute({ tenantId: TENANT, token }));
      expect(answer.code, end).toBe("NOT_FOUND");
      expect(answer.message.startsWith(LINK_INVALID), end).toBe(true);
    }
  });
});

describe("RecordCheckoutLinkClaim", () => {
  it("counts the claim and remembers the session it produced", async () => {
    const w = world();
    const token = await withLink(w);
    const { link } = value(await w.resolve.execute({ tenantId: TENANT, token }));
    expect(
      value(
        await w.recordClaim.execute({
          tenantId: TENANT,
          linkId: link.id,
          resultCheckoutRef: "cs-new",
        }),
      ),
    ).toEqual({ claimCount: 1 });
    const stored = await w.links.findById(link.id, TENANT);
    expect(stored?.resultCheckoutRef).toBe("cs-new");
    expect(stored?.lastClaimedAt).toEqual(w.now());
  });

  it("refuses to count a claim on a link that expired meanwhile", async () => {
    const w = world();
    const token = await withLink(w);
    const { link } = value(await w.resolve.execute({ tenantId: TENANT, token }));
    w.advance(8 * 24 * HOUR);
    expect(
      (
        await w.recordClaim.execute({
          tenantId: TENANT,
          linkId: link.id,
          resultCheckoutRef: "cs-new",
        })
      ).ok,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @platform/checkout exec vitest run src/application/abandoned-checkouts.use-cases.test.ts`
Expected: FAIL — `Cannot find module './abandoned-checkouts.use-cases'`.

- [ ] **Step 3: Write the use cases**

`services/checkout/src/application/abandoned-checkouts.use-cases.ts`:

```ts
import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, type DomainError, NotFoundError } from "@platform/utils";
import {
  abandonedBefore,
  clampAbandonedPageSize,
  isAbandonedCheckout,
  type AbandonedCheckoutPage,
  type AbandonedCheckoutQueries,
  type CheckoutSessionRecord,
  type RecoveryFilter,
} from "../domain/abandoned-checkouts";
import { CheckoutLink, hashLinkToken, RECOVERY_LINK_TTL_MS } from "../domain/checkout-link";
import type { CheckoutLinkRepository } from "../domain/checkout-link-repository";
import type { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";

/**
 * The one answer for every link that cannot be used — unknown, expired, revoked, another shop's, or
 * spent (its checkout became an order). The public routes turn it into a 404 `{ code: "LINK_INVALID" }`.
 */
export const LINK_INVALID = "LINK_INVALID";

function linkInvalid(): NotFoundError {
  return new NotFoundError(`${LINK_INVALID}: this link has expired or is no longer valid`);
}

function notAbandoned(): NotFoundError {
  return new NotFoundError("Abandoned checkout not found");
}

export interface CheckoutRecoveryDeps {
  readonly abandoned: AbandonedCheckoutQueries;
  readonly sessions: CheckoutSessionRepository;
  readonly links: CheckoutLinkRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface ListAbandonedCheckoutsInput {
  readonly tenantId: string;
  readonly first?: number;
  readonly after?: string;
  readonly search?: string;
  readonly recovery?: RecoveryFilter;
}

export interface AbandonedCheckoutListEntry {
  readonly record: CheckoutSessionRecord;
  /** When the newest recovery link for it was made ("Shared Oct 18"), or null ("Not shared"). */
  readonly lastLinkIssuedAt: Date | null;
}

export interface ListAbandonedCheckoutsOutput {
  readonly items: readonly AbandonedCheckoutListEntry[];
  readonly pageInfo: AbandonedCheckoutPage["pageInfo"];
}

/** Spec §3.4: the abandoned checkouts of one shop, newest first, with when each was last shared. */
export class ListAbandonedCheckouts implements UseCase<
  ListAbandonedCheckoutsInput,
  ListAbandonedCheckoutsOutput,
  DomainError
> {
  private readonly deps: CheckoutRecoveryDeps;

  constructor(deps: CheckoutRecoveryDeps) {
    this.deps = deps;
  }

  async execute(
    input: ListAbandonedCheckoutsInput,
  ): Promise<Result<ListAbandonedCheckoutsOutput, DomainError>> {
    const page = await this.deps.abandoned.listAbandoned(
      {
        olderThan: abandonedBefore(this.deps.clock.now()),
        first: clampAbandonedPageSize(input.first),
        after: input.after,
        search: input.search,
        recovery: input.recovery,
      },
      input.tenantId,
    );
    const links = await this.deps.links.listForSessions(
      page.items.map((record) => record.session.id.toString()),
      input.tenantId,
    );
    // `listForSessions` is newest first: the first link seen per checkout is its latest.
    const latest = new Map<string, Date>();
    for (const link of links) {
      const id = link.checkoutSessionId;
      if (id !== null && !latest.has(id)) latest.set(id, link.createdAt);
    }
    return ok({
      items: page.items.map((record) => ({
        record,
        lastLinkIssuedAt: latest.get(record.session.id.toString()) ?? null,
      })),
      pageInfo: page.pageInfo,
    });
  }
}

export interface AbandonedCheckoutIdInput {
  readonly tenantId: string;
  readonly checkoutSessionId: string;
}

export interface GetAbandonedCheckoutOutput {
  readonly record: CheckoutSessionRecord;
  /** Its recovery links, newest first. */
  readonly links: readonly CheckoutLink[];
}

/** Spec §3.4: one abandoned checkout — 404 unless it matches the abandoned definition. */
export class GetAbandonedCheckout implements UseCase<
  AbandonedCheckoutIdInput,
  GetAbandonedCheckoutOutput,
  DomainError
> {
  private readonly deps: CheckoutRecoveryDeps;

  constructor(deps: CheckoutRecoveryDeps) {
    this.deps = deps;
  }

  async execute(
    input: AbandonedCheckoutIdInput,
  ): Promise<Result<GetAbandonedCheckoutOutput, DomainError>> {
    const record = await this.deps.abandoned.findRecord(input.checkoutSessionId, input.tenantId);
    if (record === null || !isAbandonedCheckout(record, abandonedBefore(this.deps.clock.now()))) {
      return err(notAbandoned());
    }
    const links = await this.deps.links.listForSessions([input.checkoutSessionId], input.tenantId);
    return ok({ record, links });
  }
}

export interface IssueRecoveryLinkInput extends AbandonedCheckoutIdInput {
  /** The staff principal id. */
  readonly createdBy: string;
}

export interface IssueRecoveryLinkOutput {
  readonly linkId: string;
  /** Handed out exactly once: only its hash is stored. */
  readonly token: string;
  readonly expiresAt: string;
}

/**
 * Spec §3.3–§3.4: a new recovery link for an abandoned checkout, valid for 7 days. Every call mints a
 * new token (a link cannot be shown twice); older links keep working until they expire.
 */
export class IssueRecoveryLink implements UseCase<
  IssueRecoveryLinkInput,
  IssueRecoveryLinkOutput,
  DomainError
> {
  private readonly deps: CheckoutRecoveryDeps;

  constructor(deps: CheckoutRecoveryDeps) {
    this.deps = deps;
  }

  async execute(
    input: IssueRecoveryLinkInput,
  ): Promise<Result<IssueRecoveryLinkOutput, DomainError>> {
    const now = this.deps.clock.now();
    return this.deps.unitOfWork.run<Result<IssueRecoveryLinkOutput, DomainError>>(async (tx) => {
      const record = await this.deps.abandoned.findRecord(
        input.checkoutSessionId,
        input.tenantId,
        tx,
      );
      if (record === null || !isAbandonedCheckout(record, abandonedBefore(now))) {
        return err(notAbandoned());
      }
      if (record.session.recoveredOrderRef !== undefined) {
        return err(
          new BusinessRuleError("ALREADY_RECOVERED: this checkout already became an order"),
        );
      }
      let issued: ReturnType<typeof CheckoutLink.issue>;
      try {
        issued = CheckoutLink.issue({
          id: this.deps.idGenerator.generate(),
          purpose: "recovery",
          target: { checkoutSessionId: input.checkoutSessionId },
          createdBy: input.createdBy,
          now,
          ttlMs: RECOVERY_LINK_TTL_MS,
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

export interface ResolveCheckoutLinkInput {
  readonly tenantId: string;
  readonly token: string;
}

export interface ResolveCheckoutLinkOutput {
  readonly link: CheckoutLink;
  /** The abandoned checkout the link resumes. Never handed to the shopper: the claim clones it. */
  readonly session: CheckoutSession;
}

/**
 * Spec §3.5 step 1: token → usable link. Looked up by hash INSIDE the request's shop, so another
 * shop's token is unknown. Unknown, expired, revoked and spent links (the checkout was completed or
 * already recovered) all answer the same {@link LINK_INVALID} not-found. Part 3 resolves recovery
 * links only; Part 4 adds the invoice branch.
 */
export class ResolveCheckoutLink implements UseCase<
  ResolveCheckoutLinkInput,
  ResolveCheckoutLinkOutput,
  DomainError
> {
  private readonly deps: CheckoutRecoveryDeps;

  constructor(deps: CheckoutRecoveryDeps) {
    this.deps = deps;
  }

  async execute(
    input: ResolveCheckoutLinkInput,
  ): Promise<Result<ResolveCheckoutLinkOutput, DomainError>> {
    const link = await this.deps.links.findByTokenHash(hashLinkToken(input.token), input.tenantId);
    if (
      link === null ||
      !link.isUsable(this.deps.clock.now()) ||
      link.purpose !== "recovery" ||
      link.checkoutSessionId === null
    ) {
      return err(linkInvalid());
    }
    const session = await this.deps.sessions.findById(link.checkoutSessionId, input.tenantId);
    if (
      session === null ||
      session.state.value === "completed" ||
      session.recoveredOrderRef !== undefined
    ) {
      return err(linkInvalid());
    }
    return ok({ link, session });
  }
}

export interface RecordCheckoutLinkClaimInput {
  readonly tenantId: string;
  readonly linkId: string;
  /** The session the claim produced (the claimer's own). */
  readonly resultCheckoutRef: string;
}

/** Spec §3.5 step 5: counts a claim and remembers the session it produced (for a second tap). */
export class RecordCheckoutLinkClaim implements UseCase<
  RecordCheckoutLinkClaimInput,
  { readonly claimCount: number },
  DomainError
> {
  private readonly deps: CheckoutRecoveryDeps;

  constructor(deps: CheckoutRecoveryDeps) {
    this.deps = deps;
  }

  async execute(
    input: RecordCheckoutLinkClaimInput,
  ): Promise<Result<{ readonly claimCount: number }, DomainError>> {
    return this.deps.unitOfWork.run<Result<{ readonly claimCount: number }, DomainError>>(
      async (tx) => {
        const link = await this.deps.links.findById(input.linkId, input.tenantId, tx);
        if (link === null) return err(linkInvalid());
        try {
          link.recordClaim(this.deps.clock.now(), input.resultCheckoutRef);
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }
        await this.deps.links.save(link, input.tenantId, tx);
        return ok({ claimCount: link.claimCount });
      },
    );
  }
}
```

(The in-memory link ids from the test's generator are not UUIDs; the in-memory link repository does
not check UUIDs — only the Prisma one does, because of its column.)

- [ ] **Step 4: Run the use-case tests**

Run: `pnpm --filter @platform/checkout exec vitest run src/application/abandoned-checkouts.use-cases.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `StartCheckout` test**

`services/checkout/src/application/start-checkout.use-case.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { CheckoutEventTranslator } from "../infrastructure/checkout-event-translator";
import { InMemoryCheckoutSessionRepository } from "../infrastructure/in-memory-checkout-session-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { StartCheckout } from "./start-checkout.use-case";

function setup() {
  const sessions = new InMemoryCheckoutSessionRepository({
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new CheckoutEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "checkout",
    }),
    context: rootEventContext({ generate: () => "evt-x" }),
  });
  let n = 0;
  const start = new StartCheckout({
    sessions,
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator: { generate: () => `cs-${(n += 1)}` },
  });
  return { sessions, start };
}

describe("StartCheckout — recovered sessions (order operations Part 3)", () => {
  it("remembers the abandoned checkout a recovery started from", async () => {
    const { sessions, start } = setup();
    const result = await start.execute({
      tenantId: "t",
      cartRef: "cart-1",
      sessionRef: "ref-1",
      currency: "EGP",
      recoveredFromRef: "cs-abandoned",
    });
    if (!result.ok) throw new Error("start failed");
    expect((await sessions.findById(result.value.checkoutSessionId, "t"))?.recoveredFromRef).toBe(
      "cs-abandoned",
    );
  });

  it("an ordinary start has none", async () => {
    const { sessions, start } = setup();
    const result = await start.execute({
      tenantId: "t",
      cartRef: "c",
      sessionRef: "r",
      currency: "EGP",
    });
    if (!result.ok) throw new Error("start failed");
    expect(
      (await sessions.findById(result.value.checkoutSessionId, "t"))?.recoveredFromRef,
    ).toBeUndefined();
  });
});
```

Run: `pnpm --filter @platform/checkout exec vitest run src/application/start-checkout.use-case.test.ts`
Expected: FAIL — TypeScript error on `recoveredFromRef` / the first test's assertion is `undefined`.

- [ ] **Step 6: Pass `recoveredFromRef` through `StartCheckout`**

In `services/checkout/src/application/start-checkout.use-case.ts`, add to `StartCheckoutInput`:

```ts
  /**
   * Order operations Part 3: set ONLY by the recovery-link claim (server side) — the abandoned session
   * this one clones. The public start route's `.strict()` body cannot carry it, so a shopper can never
   * point their session at someone else's checkout (which completion would then expire).
   */
  readonly recoveredFromRef?: string;
```

and in `execute`, replace the `CheckoutSession.start(...)` call with:

```ts
const session = CheckoutSession.start(
  id,
  input.cartRef,
  input.customerRef,
  input.sessionRef,
  input.currency,
  input.recoveredFromRef === undefined ? {} : { recoveredFromRef: input.recoveredFromRef },
);
```

Run the test again. Expected: PASS.

- [ ] **Step 7: Write the failing completion tests**

`services/checkout/src/application/complete-checkout.recovery.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { ConcurrencyError } from "@platform/utils";
import { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import { CheckoutAddress } from "../domain/value-objects/checkout-address";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import { ContactEmail } from "../domain/value-objects/contact-email";
import {
  CheckoutSessionMapper,
  type CheckoutSessionRow,
} from "../infrastructure/checkout-session.mapper";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import type { OrderCreationPort } from "./ports";
import { CompleteCheckout } from "./complete-checkout.use-case";

const ORIGINAL = "00000000-0000-4000-8000-0000000000a1";
const CLONE = "00000000-0000-4000-8000-0000000000b1";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

/** Copy-on-read like a database: a failed save leaves the stored row untouched. */
class RowSessions implements CheckoutSessionRepository {
  private readonly rows = new Map<string, ReturnType<typeof CheckoutSessionMapper.toRow>>();
  failSaving: string | null = null;

  seed(session: CheckoutSession): void {
    session.pullDomainEvents();
    this.rows.set(session.id.toString(), CheckoutSessionMapper.toRow(session, "t"));
  }

  async save(session: CheckoutSession): Promise<void> {
    if (session.id.toString() === this.failSaving) {
      throw new ConcurrencyError("the original browser changed it");
    }
    session.pullDomainEvents();
    this.rows.set(session.id.toString(), CheckoutSessionMapper.toRow(session, "t"));
  }

  async findById(id: string): Promise<CheckoutSession | null> {
    const row = this.rows.get(id);
    return row === undefined
      ? null
      : CheckoutSessionMapper.toDomain(row as unknown as CheckoutSessionRow);
  }
}

class Orders implements OrderCreationPort {
  calls = 0;
  async create(): Promise<{ readonly orderRef: string }> {
    this.calls += 1;
    return { orderRef: "order-new" };
  }
}

const clock: Clock = { now: () => new Date("2026-10-18T12:00:00.000Z") };
function ids(): IdGenerator {
  let n = 0;
  return { generate: () => `evt-${(n += 1)}` };
}

function original(): CheckoutSession {
  const s = CheckoutSession.start(
    UniqueEntityId.from(ORIGINAL),
    "cart-a",
    undefined,
    "ref-a",
    "EGP",
  );
  s.loadItems([must(CheckoutItem.create("product-1", 1, 1000, "EGP"))]);
  return s;
}

function readyClone(recoveredFromRef: string | undefined = ORIGINAL): CheckoutSession {
  const s = CheckoutSession.start(
    UniqueEntityId.from(CLONE),
    "cart-b",
    undefined,
    "ref-b",
    "EGP",
    recoveredFromRef === undefined ? {} : { recoveredFromRef },
  );
  const address = must(
    CheckoutAddress.create({ line1: "5 Nile St", city: "Cairo", postalCode: "", country: "EG" }),
  );
  s.loadItems([must(CheckoutItem.create("product-1", 1, 1200, "EGP"))]);
  s.setContactEmail(must(ContactEmail.create("sara@example.com")));
  s.setBillingAddress(address);
  s.setShippingAddress(address);
  s.recalculateTotals("evt-totals", new Date(0));
  return s;
}

function completer(sessions: RowSessions, orders = new Orders()) {
  return new CompleteCheckout({
    sessions,
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator: ids(),
    clock,
    orderCreation: orders,
  });
}

describe("CompleteCheckout — recovered checkouts (order operations Part 3)", () => {
  it("marks the original recovered and expires it, so its own browser can't also place it", async () => {
    const sessions = new RowSessions();
    sessions.seed(original());
    sessions.seed(readyClone());
    const complete = completer(sessions);

    const result = await complete.execute({
      tenantId: "t",
      checkoutSessionId: CLONE,
      idempotencyKey: "k",
    });
    expect(result.ok).toBe(true);
    const marked = await sessions.findById(ORIGINAL);
    expect(marked?.recoveredOrderRef).toBe("order-new");
    expect(marked?.state.value).toBe("expired");
    const again = await complete.execute({
      tenantId: "t",
      checkoutSessionId: ORIGINAL,
      idempotencyKey: "k2",
    });
    expect(again.ok).toBe(false);
  });

  it("leaves an original its own shopper already placed untouched", async () => {
    const sessions = new RowSessions();
    const placed = original();
    placed.complete("order-own", "evt-own", new Date(0));
    sessions.seed(placed);
    sessions.seed(readyClone());

    const result = await completer(sessions).execute({
      tenantId: "t",
      checkoutSessionId: CLONE,
      idempotencyKey: "k",
    });
    expect(result.ok).toBe(true);
    const own = await sessions.findById(ORIGINAL);
    expect(own?.recoveredOrderRef).toBeUndefined();
    expect(own?.orderRef).toBe("order-own");
  });

  it("completes when the original no longer exists", async () => {
    const sessions = new RowSessions();
    sessions.seed(readyClone());
    const result = await completer(sessions).execute({
      tenantId: "t",
      checkoutSessionId: CLONE,
      idempotencyKey: "k",
    });
    expect(result.ok).toBe(true);
  });

  it("a failure marking the original never undoes the order; a retry marks it (Review Focus 2)", async () => {
    const sessions = new RowSessions();
    sessions.seed(original());
    sessions.seed(readyClone());
    const orders = new Orders();
    const complete = completer(sessions, orders);
    sessions.failSaving = ORIGINAL;

    const first = await complete.execute({
      tenantId: "t",
      checkoutSessionId: CLONE,
      idempotencyKey: "k",
    });
    expect(first.ok && first.value.orderRef).toBe("order-new");
    expect((await sessions.findById(CLONE))?.state.value).toBe("completed");
    expect((await sessions.findById(ORIGINAL))?.recoveredOrderRef).toBeUndefined();

    sessions.failSaving = null;
    const retry = await complete.execute({
      tenantId: "t",
      checkoutSessionId: CLONE,
      idempotencyKey: "k",
    });
    expect(retry.ok && retry.value.orderRef).toBe("order-new");
    expect(orders.calls).toBe(1);
    expect((await sessions.findById(ORIGINAL))?.recoveredOrderRef).toBe("order-new");
  });

  it("an ordinary checkout touches no other session", async () => {
    const sessions = new RowSessions();
    sessions.seed(original());
    sessions.seed(readyClone(undefined));
    await completer(sessions).execute({
      tenantId: "t",
      checkoutSessionId: CLONE,
      idempotencyKey: "k",
    });
    const untouched = await sessions.findById(ORIGINAL);
    expect(untouched?.recoveredOrderRef).toBeUndefined();
    expect(untouched?.state.value).toBe("started");
  });
});
```

Run: `pnpm --filter @platform/checkout exec vitest run src/application/complete-checkout.recovery.test.ts`
Expected: FAIL — the original is never marked (first and fourth tests).

- [ ] **Step 8: Mark the original after the completion commits**

In `services/checkout/src/application/complete-checkout.use-case.ts`:

1. Change the start of `execute` so the result of the unit of work is kept, and remember the session's
   `recoveredFromRef` inside it. Replace

```ts
    return this.deps.unitOfWork.run<Result<CompleteCheckoutOutput, DomainError>>(async (tx) => {
      const session = await this.deps.sessions.findById(
        input.checkoutSessionId,
        input.tenantId,
        tx,
      );
      if (session === null) {
        return err(new NotFoundError("Checkout session not found"));
      }
```

with

```ts
    // Part 3: set inside the unit of work, read after it commits (a property, so TypeScript does not
    // narrow it to `undefined` across the callback).
    const recovery: { from?: string } = {};
    const result = await this.deps.unitOfWork.run<Result<CompleteCheckoutOutput, DomainError>>(
      async (tx) => {
      const session = await this.deps.sessions.findById(
        input.checkoutSessionId,
        input.tenantId,
        tx,
      );
      if (session === null) {
        return err(new NotFoundError("Checkout session not found"));
      }
      recovery.from = session.recoveredFromRef;
```

2. Close the callback where the old `return this.deps.unitOfWork.run(...)` closed (`});` after the final
   `return ok({ checkoutSessionId: …, orderRef });`) with:

```ts
      },
    );

    if (result.ok && recovery.from !== undefined) {
      await this.markOriginalRecovered(recovery.from, result.value.orderRef, input.tenantId);
    }
    return result;
```

(Prettier re-indents the callback body; no statement inside it changes.)

3. Add the method after `undoOrder`:

```ts
  /**
   * Order operations Part 3: the recovered checkout became `orderRef`, so the abandoned original is
   * stamped "Recovered" and expired — its own browser can no longer place it. Its OWN unit of work,
   * after the completion committed, and best effort: the order already exists (OrderCreationPort
   * commits on its own), so a conflict here (the original browser touched the session) must never
   * undo the completion. A retried completion returns early above and lands here again, so a missed
   * mark is healed. An original its shopper already placed, or one already marked, is left alone.
   */
  private async markOriginalRecovered(
    originalId: string,
    orderRef: string,
    tenantId: string,
  ): Promise<void> {
    try {
      await this.deps.unitOfWork.run(async (tx) => {
        const original = await this.deps.sessions.findById(originalId, tenantId, tx);
        if (
          original === null ||
          original.state.value === "completed" ||
          original.recoveredOrderRef !== undefined
        ) {
          return;
        }
        original.markRecovered(orderRef, this.deps.idGenerator.generate(), this.deps.clock.now());
        await this.deps.sessions.save(original, tenantId, tx);
      });
    } catch {
      // Best effort by design (see above); the list shows it as not recovered until a retry marks it.
    }
  }
```

Run: `pnpm --filter @platform/checkout exec vitest run src/application/complete-checkout.recovery.test.ts src/application/complete-checkout.use-case.test.ts src/application/complete-checkout.discounts.test.ts`
Expected: PASS (the existing completion suites are unchanged).

- [ ] **Step 9: Expose the use cases on the controller, wire them, export them**

In `services/checkout/src/interfaces/checkout.controller.ts` add the imports:

```ts
import type {
  AbandonedCheckoutIdInput,
  GetAbandonedCheckout,
  IssueRecoveryLink,
  IssueRecoveryLinkInput,
  ListAbandonedCheckouts,
  ListAbandonedCheckoutsInput,
  RecordCheckoutLinkClaim,
  RecordCheckoutLinkClaimInput,
  ResolveCheckoutLink,
  ResolveCheckoutLinkInput,
} from "../application/abandoned-checkouts.use-cases";
```

add to `CheckoutControllerDeps`:

```ts
  readonly listAbandonedCheckouts: ListAbandonedCheckouts;
  readonly getAbandonedCheckout: GetAbandonedCheckout;
  readonly issueRecoveryLink: IssueRecoveryLink;
  readonly resolveCheckoutLink: ResolveCheckoutLink;
  readonly recordCheckoutLinkClaim: RecordCheckoutLinkClaim;
```

and add to the class:

```ts
  /** Order operations Part 3: the abandoned checkouts list (authorization is the caller's). */
  async listAbandoned(input: ListAbandonedCheckoutsInput): Promise<ControllerResponse> {
    return present(await this.deps.listAbandonedCheckouts.execute(input), 200);
  }

  async getAbandoned(input: AbandonedCheckoutIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getAbandonedCheckout.execute(input), 200);
  }

  async issueRecoveryLink(input: IssueRecoveryLinkInput): Promise<ControllerResponse> {
    return present(await this.deps.issueRecoveryLink.execute(input), 201);
  }

  async resolveLink(input: ResolveCheckoutLinkInput): Promise<ControllerResponse> {
    return present(await this.deps.resolveCheckoutLink.execute(input), 200);
  }

  async recordLinkClaim(input: RecordCheckoutLinkClaimInput): Promise<ControllerResponse> {
    return present(await this.deps.recordCheckoutLinkClaim.execute(input), 200);
  }
```

In `services/checkout/src/composition.ts`:

- imports:

```ts
import {
  GetAbandonedCheckout,
  IssueRecoveryLink,
  ListAbandonedCheckouts,
  RecordCheckoutLinkClaim,
  ResolveCheckoutLink,
} from "./application/abandoned-checkouts.use-cases";
import type { AbandonedCheckoutQueries } from "./domain/abandoned-checkouts";
import type { CheckoutLinkRepository } from "./domain/checkout-link-repository";
import { InMemoryCheckoutLinkRepository } from "./infrastructure/in-memory-checkout-link-repository";
import { PrismaCheckoutLinkRepository } from "./infrastructure/prisma-checkout-link-repository";
```

- `buildController`'s signature becomes

```ts
function buildController(
  sessions: CheckoutSessionRepository & AbandonedCheckoutQueries,
  links: CheckoutLinkRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: CheckoutWiringDeps,
): CheckoutController {
```

with, before `return new CheckoutController({`,

```ts
const recoveryDeps = {
  abandoned: sessions,
  sessions,
  links,
  unitOfWork,
  idGenerator: deps.idGenerator,
  clock: deps.clock,
};
```

and inside the controller deps object (after `generatePaymentIntentRequest: …,`):

```ts
    listAbandonedCheckouts: new ListAbandonedCheckouts(recoveryDeps),
    getAbandonedCheckout: new GetAbandonedCheckout(recoveryDeps),
    issueRecoveryLink: new IssueRecoveryLink(recoveryDeps),
    resolveCheckoutLink: new ResolveCheckoutLink(recoveryDeps),
    recordCheckoutLinkClaim: new RecordCheckoutLinkClaim(recoveryDeps),
```

- the Prisma branch calls
  `buildController(sessions, new PrismaCheckoutLinkRepository({ prisma: deps.prisma }), unitOfWork, deps)`;
  the in-memory branch calls `buildController(sessions, new InMemoryCheckoutLinkRepository(), unitOfWork, deps)`.

Append to `services/checkout/src/index.ts`:

```ts
export {
  CheckoutLink,
  hashLinkToken,
  isWellFormedLinkToken,
  RECOVERY_LINK_TTL_MS,
  type CheckoutLinkPurpose,
} from "./domain/checkout-link";
export type { CheckoutLinkRepository } from "./domain/checkout-link-repository";
export {
  ABANDONED_AFTER_MINUTES,
  ABANDONED_PAGE_SIZE_MAX,
  RECOVERY_FILTERS,
  type AbandonedCheckoutQueries,
  type CheckoutSessionRecord,
  type RecoveryFilter,
} from "./domain/abandoned-checkouts";
export {
  LINK_INVALID,
  type AbandonedCheckoutListEntry,
  type GetAbandonedCheckoutOutput,
  type IssueRecoveryLinkOutput,
  type ListAbandonedCheckoutsOutput,
  type ResolveCheckoutLinkOutput,
} from "./application/abandoned-checkouts.use-cases";
export { PrismaCheckoutLinkRepository } from "./infrastructure/prisma-checkout-link-repository";
```

- [ ] **Step 10: A wiring test through `wireCheckout`**

`services/checkout/src/checkout-recovery.wiring.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireCheckout } from "./composition";

describe("wireCheckout — Part 3 recovery surface", () => {
  it("answers an empty abandoned list and a LINK_INVALID 404 for an unknown token", async () => {
    let n = 0;
    const { checkout } = wireCheckout({
      serializer: new InMemoryEventSerializer(),
      idGenerator: { generate: () => `id-${(n += 1)}` },
      clock: { now: () => new Date("2026-10-18T12:00:00.000Z") },
    });
    expect(await checkout.listAbandoned({ tenantId: "t" })).toEqual({
      status: 200,
      body: { items: [], pageInfo: { hasNextPage: false, endCursor: null } },
    });
    const unknown = await checkout.resolveLink({ tenantId: "t", token: "x".repeat(43) });
    expect(unknown.status).toBe(404);
    expect((unknown.body as { message: string }).message).toMatch(/^LINK_INVALID:/);
  });
});
```

Run: `pnpm --filter @platform/checkout exec vitest run src/checkout-recovery.wiring.test.ts`
Expected: PASS.

- [ ] **Step 11: Package checks**

Run: `pnpm --filter @platform/checkout typecheck && pnpm --filter @platform/checkout lint && pnpm --filter @platform/checkout test`
Then: `pnpm --filter @platform/admin typecheck` (apps/admin builds the controller through `wireCheckout`; it must still compile).
Expected: all green.

- [ ] **Step 12: Commit**

```bash
git add services/checkout/src/application/abandoned-checkouts.use-cases.ts \
  services/checkout/src/application/abandoned-checkouts.use-cases.test.ts \
  services/checkout/src/application/start-checkout.use-case.ts \
  services/checkout/src/application/start-checkout.use-case.test.ts \
  services/checkout/src/application/complete-checkout.use-case.ts \
  services/checkout/src/application/complete-checkout.recovery.test.ts \
  services/checkout/src/interfaces/checkout.controller.ts services/checkout/src/composition.ts \
  services/checkout/src/index.ts services/checkout/src/checkout-recovery.wiring.test.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(checkout): abandoned checkout and recovery link use cases

List, get and issue recovery links for abandoned checkouts; resolve a token to a usable
link inside the shop (unknown, expired, revoked, other-shop and spent links all answer the
same LINK_INVALID) and record claims. Completing a recovered checkout stamps and expires the
original in its own best-effort transaction, healed by a retried completion.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Admin API — abandoned list, detail and "issue recovery link" with the shop's own URL

Model tier: **standard** (thin routes over Task 3, with the permission split and the DTO rules spelled out).

**Files:**

- Modify: `apps/admin/src/interfaces/checkout.admin-controller.ts` (three methods)
- Modify: `apps/admin/src/composition.ts` (`WiredAdmin.shopDomains` + its value)
- Create: `apps/admin/src/http/shop-link-url.ts`, `apps/admin/src/http/shop-link-url.test.ts`
- Create: `apps/admin/src/http/abandoned-checkout-dto.ts`, `apps/admin/src/http/abandoned-checkout-dto.test.ts`
- Create: `apps/admin/src/http/abandoned-checkout-routes.ts`, `apps/admin/src/http/abandoned-checkout-routes.test.ts`
- Modify: `apps/admin/src/http/admin-routes.ts` (import + register after `...orderAnnotationRoutes(admin),`)
- Modify: `apps/admin/src/http/testing/orders-harness.ts` (optional `clock`)
- Create: `apps/admin/src/http/testing/abandoned-harness.ts`

**Interfaces:**

- Consumes: Task 3's `CheckoutController.listAbandoned/getAbandoned/issueRecoveryLink`, `ListAbandonedCheckoutsOutput`, `GetAbandonedCheckoutOutput`, `IssueRecoveryLinkOutput`, `CheckoutSessionRecord`, `CheckoutLink`, `ABANDONED_PAGE_SIZE_MAX`, `RECOVERY_FILTERS`; Part 1's `OrdersAdminController.listOrders` with `ids`; `withLineImages`; `TenancyController.listShopDomains({ shopId })`; `TenancyAdminController.getPublicStore()`; the Part 1 harness (`buildOrdersAdmin`, `adminStaff`, `operatorStaff`, `viewerStaff`, `HARNESS_NOW`, `HARNESS_TENANT`).
- Produces:
  - `CheckoutAdminController.listAbandoned(principal, input)` (`orders:read`), `.getAbandoned(principal, input)` (`orders:read`), `.issueRecoveryLink(principal, input)` (`orders:recover_checkout`).
  - `WiredAdmin.shopDomains: (tenantId: string) => Promise<readonly ShopDomainLike[]>`.
  - `shop-link-url.ts`: `interface ShopDomainLike { hostname: string; status: string; isPrimary: boolean }`, `primaryHostnameOf(domains): string | null`, `shopLinkUrl(hostname: string | null, path: string): string | null`, `shopNameOf(admin: Pick<WiredAdmin, "tenancy">): Promise<string>`.
  - `abandoned-checkout-dto.ts`: `AbandonedCheckoutListItemDto`, `AbandonedCheckoutLineDto`, `AbandonedCheckoutTotalsDto`, `AbandonedCheckoutAddressDto`, `AbandonedCheckoutLinkDto`, `AbandonedCheckoutDetailDto`, `RecoveredOrderDto`, `RecoveryLinkDto = { url: string | null; path: string; expiresAt: string; shopName: string }`, `checkoutReference(id): string`, `recoveredOrderOf(session, orderNumbers): RecoveredOrderDto | null`, `toAbandonedListItemDto(record, extra)`, `toAbandonedDetailDto(record, links, recoveredOrder)`.
  - Routes: `GET /abandoned-checkouts?first=&after=&q=&recovery=` (`orders:read`), `GET /abandoned-checkouts/:checkoutSessionId` (`orders:read`), `POST /abandoned-checkouts/:checkoutSessionId/recovery-link` (`orders:recover_checkout`, `idempotent: true`, 201 `RecoveryLinkDto`). Exported `abandonedCheckoutRoutes(admin)`.
  - Harness: `buildOrdersAdmin({ clock? })`; `abandoned-harness.ts`: `HOUR_MS`, `steppingClock(start?)`, `interface RecoveryWorld { admin; routes; clock; publicCall(method, path, input); staffCall(method, path, input, principal?) }`, `recoveryWorld(): RecoveryWorld`, `seedRecoveryProduct(world, sku, priceMinor): Promise<SeededProduct>`, `RECOVERY_ADDRESS`, `abandonCheckout(world, { sessionRef, lines, email? }): Promise<{ checkoutSessionId: string; cartId: string }>`, `completeCheckout(world, checkoutSessionId, sessionRef): Promise<string /* orderRef */>`, `unwrap<T>(reply, what): T`.

- [ ] **Step 1: Write the failing URL helper tests**

`apps/admin/src/http/shop-link-url.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { primaryHostnameOf, shopLinkUrl } from "./shop-link-url";

describe("shop link URL (spec §3.6)", () => {
  it("uses the shop's primary VERIFIED hostname", () => {
    expect(
      primaryHostnameOf([
        { hostname: "pending.example", status: "pending", isPrimary: false },
        { hostname: "shop.morbeh.app", status: "verified", isPrimary: false },
        { hostname: "www.sara.shop", status: "verified", isPrimary: true },
      ]),
    ).toBe("www.sara.shop");
  });

  it("has none when no domain is both primary and verified", () => {
    expect(primaryHostnameOf([])).toBeNull();
    expect(
      primaryHostnameOf([{ hostname: "x.shop", status: "pending", isPrimary: true }]),
    ).toBeNull();
  });

  it("builds an https URL, or null so admin-web falls back to STOREFRONT_URL", () => {
    expect(shopLinkUrl("www.sara.shop", "/c/abc")).toBe("https://www.sara.shop/c/abc");
    expect(shopLinkUrl(null, "/c/abc")).toBeNull();
  });
});
```

Run: `pnpm --filter @platform/admin exec vitest run src/http/shop-link-url.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Write `shop-link-url.ts`**

```ts
import type { WiredAdmin } from "../composition";

/** What a link URL needs of a shop domain (Tenancy's `ShopDomainView` satisfies it). */
export interface ShopDomainLike {
  readonly hostname: string;
  readonly status: string;
  readonly isPrimary: boolean;
}

/** Spec §3.6: the primary VERIFIED hostname — a pending domain does not serve the shop yet. */
export function primaryHostnameOf(domains: readonly ShopDomainLike[]): string | null {
  return (
    domains.find((domain) => domain.isPrimary && domain.status === "verified")?.hostname ?? null
  );
}

/** `https://<host><path>`, or null when the shop has no domain (admin-web then uses STOREFRONT_URL). */
export function shopLinkUrl(hostname: string | null, path: string): string | null {
  return hostname === null ? null : `https://${hostname}${path}`;
}

/** The shop's name as the storefront shows it — no permission needed (it is public). "" if unreadable. */
export async function shopNameOf(admin: Pick<WiredAdmin, "tenancy">): Promise<string> {
  const response = await admin.tenancy.getPublicStore();
  if (response.status !== 200) return "";
  const name = (response.body as { readonly name?: unknown }).name;
  return typeof name === "string" ? name : "";
}
```

Run the test again. Expected: PASS.

- [ ] **Step 3: Add `shopDomains` to `WiredAdmin` and the three controller methods**

In `apps/admin/src/composition.ts`:

- add `import type { ShopDomainLike } from "./http/shop-link-url";` with the other imports;
- in `interface WiredAdmin`, after `readonly tenantAvailability: …;`:

```ts
  /**
   * Order operations Part 3: the shop's domains — what a recovery link's absolute URL is built from.
   * Tenancy's raw controller (the tenancy exemption, ADR-0014); it authorizes nothing itself — the
   * route that calls it does (`orders:recover_checkout`).
   */
  readonly shopDomains: (tenantId: string) => Promise<readonly ShopDomainLike[]>;
```

- in the returned object, after `tenantAvailability: tenancy.tenantAvailability,`:

```ts
    shopDomains: async (tenantId) => {
      const response = await tenancy.tenancy.listShopDomains({ shopId: tenantId });
      return response.status === 200
        ? (response.body as { readonly items: readonly ShopDomainLike[] }).items
        : [];
    },
```

In `apps/admin/src/interfaces/checkout.admin-controller.ts`, add to the class:

```ts
  /** Order operations Part 3: abandoned checkouts are order data — `orders:read`, like orders. */
  async listAbandoned(
    principal: Principal,
    input: Parameters<CheckoutController["listAbandoned"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:read");
    if (denied) return denied;
    return this.checkout.listAbandoned(input);
  }

  async getAbandoned(
    principal: Principal,
    input: Parameters<CheckoutController["getAbandoned"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:read");
    if (denied) return denied;
    return this.checkout.getAbandoned(input);
  }

  /** Spec Permissions: operators and admins (`orders:recover_checkout`); viewers are refused. */
  async issueRecoveryLink(
    principal: Principal,
    input: Parameters<CheckoutController["issueRecoveryLink"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:recover_checkout");
    if (denied) return denied;
    return this.checkout.issueRecoveryLink(input);
  }
```

- [ ] **Step 4: Write the failing DTO tests**

`apps/admin` does not depend on `@platform/domain`, so these tests stay on the pure helpers; the field
mapping is asserted end to end by the route tests in Step 7.

`apps/admin/src/http/abandoned-checkout-dto.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkoutReference, recoveredOrderOf } from "./abandoned-checkout-dto";

describe("abandoned checkout DTO helpers (spec §3.6)", () => {
  it("the reference is # and the id's last 8 hex digits, upper case", () => {
    expect(checkoutReference("01920000-0000-7000-8000-00000000abcd")).toBe("#0000ABCD");
  });

  it("a recovered checkout names its order, with the number when it could be read", () => {
    expect(
      recoveredOrderOf({ recoveredOrderRef: "order-9" }, new Map([["order-9", "1007"]])),
    ).toEqual({
      id: "order-9",
      orderNumber: "1007",
    });
    expect(recoveredOrderOf({ recoveredOrderRef: "order-9" }, new Map())).toEqual({
      id: "order-9",
      orderNumber: null,
    });
    expect(recoveredOrderOf({ recoveredOrderRef: undefined }, new Map())).toBeNull();
  });
});
```

Run: `pnpm --filter @platform/admin exec vitest run src/http/abandoned-checkout-dto.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Write `abandoned-checkout-dto.ts`**

```ts
import type { CheckoutLink, CheckoutSession, CheckoutSessionRecord } from "@platform/checkout";

/**
 * Order operations Part 3 — the staff view of an abandoned checkout (spec §3.6). Domain aggregates
 * never go on the wire; the guest's `sessionRef` (their ownership secret) is never part of it.
 */

export interface RecoveredOrderDto {
  readonly id: string;
  /** Null only if the order could not be read back (it was placed through this shop's checkout). */
  readonly orderNumber: string | null;
}

export interface AbandonedCheckoutListItemDto {
  readonly id: string;
  /** "#" + the id's last 8 hex digits, upper case. */
  readonly reference: string;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly customerName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  /** Province code (ISO 3166-2), else the city. */
  readonly region: string | null;
  /** Shipping country (ISO 3166-1) — WhatsApp sharing needs it for the calling code. */
  readonly country: string | null;
  readonly itemCount: number;
  readonly totalMinor: number;
  readonly currency: string;
  readonly recoveryStatus: "not_recovered" | "recovered";
  readonly recoveredOrder: RecoveredOrderDto | null;
  readonly lastLinkIssuedAt: string | null;
}

export interface AbandonedCheckoutLineDto {
  readonly productId: string;
  readonly variantId: string | null;
  readonly title: string | null;
  readonly variantTitle: string | null;
  readonly sku: string | null;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  /** Filled in by `withLineImages`. */
  readonly imageUrl: string | null;
}

export interface AbandonedCheckoutTotalsDto {
  readonly subtotalMinor: number;
  readonly shippingMinor: number;
  readonly taxMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  readonly taxIncluded: boolean;
}

export interface AbandonedCheckoutAddressDto {
  readonly name: string | null;
  readonly phone: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly province: string | null;
  readonly postalCode: string;
  readonly country: string;
}

export interface AbandonedCheckoutLinkDto {
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly claimCount: number;
  readonly lastClaimedAt: string | null;
}

export interface AbandonedCheckoutDetailDto extends AbandonedCheckoutListItemDto {
  readonly items: readonly AbandonedCheckoutLineDto[];
  readonly totals: AbandonedCheckoutTotalsDto | null;
  readonly shippingAddress: AbandonedCheckoutAddressDto | null;
  /** Newest first. */
  readonly links: readonly AbandonedCheckoutLinkDto[];
}

/** `POST /abandoned-checkouts/:id/recovery-link` (201). */
export interface RecoveryLinkDto {
  /** `https://<primary verified shop hostname>/c/<token>`, or null when the shop has no domain. */
  readonly url: string | null;
  readonly path: string;
  readonly expiresAt: string;
  /** For the WhatsApp message admin-web composes in the admin's language. */
  readonly shopName: string;
}

export function checkoutReference(id: string): string {
  return `#${id.replace(/-/g, "").slice(-8).toUpperCase()}`;
}

function itemsSubtotal(session: CheckoutSession): number {
  return session.items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
}

export function recoveredOrderOf(
  session: Pick<CheckoutSession, "recoveredOrderRef">,
  orderNumbers: ReadonlyMap<string, string>,
): RecoveredOrderDto | null {
  const orderRef = session.recoveredOrderRef;
  return orderRef === undefined
    ? null
    : { id: orderRef, orderNumber: orderNumbers.get(orderRef) ?? null };
}

export function toAbandonedListItemDto(
  record: CheckoutSessionRecord,
  extra: {
    readonly lastLinkIssuedAt: Date | null;
    readonly recoveredOrder: RecoveredOrderDto | null;
  },
): AbandonedCheckoutListItemDto {
  const { session } = record;
  const address = session.shippingAddress;
  const id = session.id.toString();
  return {
    id,
    reference: checkoutReference(id),
    createdAt: record.createdAt.toISOString(),
    lastActivityAt: record.updatedAt.toISOString(),
    customerName: address?.name ?? null,
    email: session.contactEmail?.value ?? null,
    phone: address?.phone ?? null,
    region: address?.province ?? address?.city ?? null,
    country: address?.country ?? null,
    itemCount: session.items.reduce((count, item) => count + item.quantity, 0),
    totalMinor: session.totals?.totalMinor ?? itemsSubtotal(session),
    currency: session.currency,
    recoveryStatus: session.recoveredOrderRef === undefined ? "not_recovered" : "recovered",
    recoveredOrder: extra.recoveredOrder,
    lastLinkIssuedAt: extra.lastLinkIssuedAt?.toISOString() ?? null,
  };
}

export function toAbandonedDetailDto(
  record: CheckoutSessionRecord,
  links: readonly CheckoutLink[],
  recoveredOrder: RecoveredOrderDto | null,
): AbandonedCheckoutDetailDto {
  const { session } = record;
  const address = session.shippingAddress;
  const totals = session.totals;
  return {
    ...toAbandonedListItemDto(record, {
      lastLinkIssuedAt: links[0]?.createdAt ?? null,
      recoveredOrder,
    }),
    items: session.items.map((item) => ({
      productId: item.productRef,
      variantId: item.variantRef ?? null,
      title: item.title ?? null,
      variantTitle: item.variantTitle ?? null,
      sku: item.sku ?? null,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceAmountMinor,
      lineTotalMinor: item.lineTotalMinor,
      imageUrl: null,
    })),
    totals:
      totals === undefined
        ? null
        : {
            subtotalMinor: totals.subtotalMinor,
            shippingMinor: totals.shippingMinor,
            taxMinor: totals.taxMinor,
            discountMinor: totals.discountMinor,
            totalMinor: totals.totalMinor,
            taxIncluded: totals.taxIncluded,
          },
    shippingAddress:
      address === undefined
        ? null
        : {
            name: address.name ?? null,
            phone: address.phone ?? null,
            line1: address.line1,
            line2: address.line2 ?? null,
            city: address.city,
            province: address.province ?? null,
            postalCode: address.postalCode,
            country: address.country,
          },
    links: links.map((link) => ({
      issuedAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt.toISOString(),
      claimCount: link.claimCount,
      lastClaimedAt: link.lastClaimedAt?.toISOString() ?? null,
    })),
  };
}
```

Run the DTO test again. Expected: PASS.

- [ ] **Step 6: Give the Part 1 harness an optional clock and write the recovery harness**

In `apps/admin/src/http/testing/orders-harness.ts` change `buildOrdersAdmin`'s options and clock:

```ts
export function buildOrdersAdmin(
  options: {
    readonly staffNames?: Readonly<Record<string, string>>;
    /** Order operations Part 3: a clock the test moves (abandoned = idle an hour). */
    readonly clock?: Clock;
  } = {},
): WiredAdmin {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-7000-8000-${(n += 1).toString().padStart(12, "0")}`,
  };
  const clock: Clock = options.clock ?? { now: () => HARNESS_NOW };
```

`apps/admin/src/http/testing/abandoned-harness.ts`:

```ts
import type { Clock, Principal } from "@platform/contracts";
import type { RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../../composition";
import { adminRoutes } from "../admin-routes";
import { adminStaff, buildOrdersAdmin, HARNESS_NOW, HARNESS_TENANT } from "./orders-harness";
import { controllerDriver, seedSingleVariantProduct, type SeededProduct } from "./seed-catalog";
import { controllerStockDriver, seedStock } from "./seed-stock";

/** TEST-ONLY (order operations Part 3): the real in-memory composition with a clock the test moves. */
export const HOUR_MS = 3_600_000;

export interface SteppingClock extends Clock {
  advance(ms: number): void;
}

export function steppingClock(start: Date = HARNESS_NOW): SteppingClock {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms;
    },
  };
}

export interface Reply {
  readonly status: number;
  readonly body: unknown;
}

type Method = RouteDefinition["method"];

export interface RecoveryWorld {
  readonly admin: WiredAdmin;
  readonly routes: readonly RouteDefinition[];
  readonly clock: SteppingClock;
  /** A public route as the storefront's server calls it (`sessionRef` in the header on reads). */
  publicCall(
    method: Method,
    path: string,
    input: {
      readonly params?: Record<string, string>;
      readonly body?: unknown;
      readonly sessionRef?: string;
      readonly tenantId?: string;
    },
  ): Promise<Reply>;
  /** A staff route; the controllers authorize `principal` with the real role table. */
  staffCall(
    method: Method,
    path: string,
    input: {
      readonly params?: Record<string, string>;
      readonly query?: Record<string, string>;
      readonly body?: unknown;
    },
    principal?: Principal,
  ): Promise<Reply>;
}

export function recoveryWorld(): RecoveryWorld {
  const clock = steppingClock();
  const admin = buildOrdersAdmin({ clock });
  const routes = adminRoutes(admin);
  const find = (method: Method, path: string): RouteDefinition => {
    const route = routes.find(
      (candidate) => candidate.method === method && candidate.path === path,
    );
    if (route === undefined) throw new Error(`no ${method} ${path} route`);
    return route;
  };
  return {
    admin,
    routes,
    clock,
    publicCall: (method, path, input) => {
      const route = find(method, path);
      return route.handle({
        body:
          input.body === undefined
            ? undefined
            : (route.schema.body?.parse(input.body) ?? input.body),
        params: input.params ?? {},
        query: {},
        context: {
          tenantId: input.tenantId ?? HARNESS_TENANT,
          principal: { id: "public", kind: "customer", roles: [] },
          requestId: "req-1",
          correlationId: "corr-1",
          headers: input.sessionRef === undefined ? {} : { "x-cart-session": input.sessionRef },
        },
      } as never) as Promise<Reply>;
    },
    staffCall: (method, path, input, principal = adminStaff) => {
      const route = find(method, path);
      return route.handle({
        body: input.body === undefined ? undefined : route.schema.body?.parse(input.body),
        params: input.params ?? {},
        query:
          input.query === undefined
            ? {}
            : (route.schema.querystring?.parse(input.query) ?? input.query),
        context: {
          tenantId: principal.tenantId,
          principal,
          requestId: "req-1",
          correlationId: "corr-1",
        },
      } as never) as Promise<Reply>;
    },
  };
}

export function unwrap<T>(reply: Reply, what: string): T {
  if (reply.status < 200 || reply.status >= 300) {
    throw new Error(`${what} failed (${reply.status}): ${JSON.stringify(reply.body)}`);
  }
  return reply.body as T;
}

/** One published single-variant product in EGP with stock, as the storefront would sell it. */
export async function seedRecoveryProduct(
  world: RecoveryWorld,
  sku: string,
  priceMinor: number,
): Promise<SeededProduct> {
  const product = await seedSingleVariantProduct(
    controllerDriver(world.admin.publicReads.products, HARNESS_TENANT),
    sku,
    priceMinor,
    "EGP",
  );
  await seedStock(controllerStockDriver(world.admin.inventory, adminStaff, HARNESS_TENANT), {
    productId: product.productId,
    variantId: product.variantId,
    quantity: 100,
  });
  return product;
}

export const RECOVERY_ADDRESS = {
  name: "Mona Ali",
  phone: "01001234567",
  line1: "5 Nile St",
  city: "Cairo",
  country: "EG",
  province: "EG-C",
} as const;

/** A guest who filled the cart, started checkout, typed contact and address — then left. */
export async function abandonCheckout(
  world: RecoveryWorld,
  input: {
    readonly sessionRef: string;
    readonly lines: readonly { readonly product: SeededProduct; readonly quantity: number }[];
    readonly email?: string;
  },
): Promise<{ readonly checkoutSessionId: string; readonly cartId: string }> {
  const { sessionRef } = input;
  const cart = unwrap<{ id: string }>(
    await world.publicCall("POST", "/public/carts", { body: { sessionRef, currency: "EGP" } }),
    "create cart",
  );
  for (const line of input.lines) {
    unwrap(
      await world.publicCall("POST", "/public/carts/:cartId/items", {
        params: { cartId: cart.id },
        body: { sessionRef, productId: line.product.productId, quantity: line.quantity },
      }),
      "add item",
    );
  }
  const started = unwrap<{ id: string }>(
    await world.publicCall("POST", "/public/checkouts", {
      body: { sessionRef, cartRef: cart.id, currency: "EGP" },
    }),
    "start checkout",
  );
  const params = { checkoutSessionId: started.id };
  unwrap(
    await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/items", {
      params,
      body: { sessionRef, cartId: cart.id },
    }),
    "load items",
  );
  if (input.email !== undefined) {
    unwrap(
      await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/contact", {
        params,
        body: { sessionRef, email: input.email },
      }),
      "contact",
    );
  }
  unwrap(
    await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/shipping-address", {
      params,
      body: { sessionRef, ...RECOVERY_ADDRESS },
    }),
    "shipping address",
  );
  return { checkoutSessionId: started.id, cartId: cart.id };
}

/** Billing address, totals, complete — answers the order id. */
export async function completeCheckout(
  world: RecoveryWorld,
  checkoutSessionId: string,
  sessionRef: string,
): Promise<string> {
  const params = { checkoutSessionId };
  unwrap(
    await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/billing-address", {
      params,
      body: { sessionRef, ...RECOVERY_ADDRESS },
    }),
    "billing address",
  );
  unwrap(
    await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/recalculate", {
      params,
      body: { sessionRef },
    }),
    "recalculate",
  );
  const completed = unwrap<{ orderRef: string }>(
    await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/complete", {
      params,
      body: { sessionRef, idempotencyKey: `complete-${checkoutSessionId}` },
    }),
    "complete",
  );
  return completed.orderRef;
}
```

- [ ] **Step 7: Write the failing route tests**

`apps/admin/src/http/abandoned-checkout-routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Principal } from "@platform/contracts";
import type {
  AbandonedCheckoutDetailDto,
  AbandonedCheckoutListItemDto,
  RecoveryLinkDto,
} from "./abandoned-checkout-dto";
import {
  abandonCheckout,
  HOUR_MS,
  recoveryWorld,
  seedRecoveryProduct,
  unwrap,
  type RecoveryWorld,
} from "./testing/abandoned-harness";
import { HARNESS_TENANT, operatorStaff, viewerStaff } from "./testing/orders-harness";

interface Page {
  readonly items: readonly AbandonedCheckoutListItemDto[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
}

const nobody: Principal = { id: "staff-none", kind: "staff", roles: [], tenantId: HARNESS_TENANT };

async function setup() {
  const world = recoveryWorld();
  const product = await seedRecoveryProduct(world, "TEE", 25000);
  const { checkoutSessionId } = await abandonCheckout(world, {
    sessionRef: "guest-secret-1",
    lines: [{ product, quantity: 2 }],
    email: "Sara@Example.com",
  });
  return { world, product, checkoutSessionId };
}

const list = (
  world: RecoveryWorld,
  query: Record<string, string> = {},
  principal: Principal = viewerStaff,
) => world.staffCall("GET", "/abandoned-checkouts", { query }, principal);
const detail = (world: RecoveryWorld, id: string, principal: Principal = viewerStaff) =>
  world.staffCall(
    "GET",
    "/abandoned-checkouts/:checkoutSessionId",
    { params: { checkoutSessionId: id } },
    principal,
  );
const issue = (world: RecoveryWorld, id: string, principal: Principal = operatorStaff) =>
  world.staffCall(
    "POST",
    "/abandoned-checkouts/:checkoutSessionId/recovery-link",
    { params: { checkoutSessionId: id } },
    principal,
  );

describe("GET /abandoned-checkouts (order operations Part 3)", () => {
  it("lists a checkout once idle an hour, to a viewer, with Shopify's columns and no sessionRef", async () => {
    const { world, checkoutSessionId } = await setup();
    expect(unwrap<Page>(await list(world), "list").items).toEqual([]);

    world.clock.advance(2 * HOUR_MS);
    const page = unwrap<Page>(await list(world), "list");
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: checkoutSessionId,
      reference: `#${checkoutSessionId.replace(/-/g, "").slice(-8).toUpperCase()}`,
      customerName: "Mona Ali",
      email: "sara@example.com",
      phone: "01001234567",
      region: "EG-C",
      country: "EG",
      itemCount: 2,
      totalMinor: 50000,
      currency: "EGP",
      recoveryStatus: "not_recovered",
      recoveredOrder: null,
      lastLinkIssuedAt: null,
    });
    expect(JSON.stringify(page)).not.toContain("guest-secret-1");
    expect(JSON.stringify(page)).not.toContain("sessionRef");
  });

  it("searches by email, name or phone and filters by recovery status", async () => {
    const { world } = await setup();
    world.clock.advance(2 * HOUR_MS);
    const count = async (query: Record<string, string>) =>
      unwrap<Page>(await list(world, query), "list").items.length;
    expect(await count({ q: "SARA" })).toBe(1);
    expect(await count({ q: "mona" })).toBe(1);
    expect(await count({ q: "0100123" })).toBe(1);
    expect(await count({ q: "nobody" })).toBe(0);
    expect(await count({ recovery: "not_recovered" })).toBe(1);
    expect(await count({ recovery: "recovered" })).toBe(0);
  });

  it("is orders:read; a staff member without it is refused", async () => {
    const { world } = await setup();
    const route = world.routes.find((r) => r.method === "GET" && r.path === "/abandoned-checkouts");
    expect(route?.permission).toBe("orders:read");
    expect(route?.schema.querystring?.safeParse({ first: "51" }).success).toBe(false);
    expect(route?.schema.querystring?.safeParse({ recovery: "maybe" }).success).toBe(false);
    expect((await list(world, {}, nobody)).status).toBe(403);
  });
});

describe("GET /abandoned-checkouts/:checkoutSessionId", () => {
  it("answers lines (with images), the address and the link history", async () => {
    const { world, checkoutSessionId } = await setup();
    world.clock.advance(2 * HOUR_MS);
    const dto = unwrap<AbandonedCheckoutDetailDto>(
      await detail(world, checkoutSessionId),
      "detail",
    );
    expect(dto.items).toHaveLength(1);
    expect(dto.items[0]).toMatchObject({ quantity: 2, unitPriceMinor: 25000, sku: "TEE-STD" });
    expect(dto.items[0]).toHaveProperty("imageUrl");
    expect(dto.shippingAddress?.city).toBe("Cairo");
    expect(dto.links).toEqual([]);
    expect(JSON.stringify(dto)).not.toContain("guest-secret-1");
  });

  it("is 404 for a fresh checkout, an unknown id and a non-UUID id (Review Focus 5)", async () => {
    const { world, checkoutSessionId } = await setup();
    expect((await detail(world, checkoutSessionId)).status).toBe(404);
    world.clock.advance(2 * HOUR_MS);
    expect((await detail(world, "00000000-0000-7000-8000-0000000fffff")).status).toBe(404);
    expect((await detail(world, "abc")).status).toBe(404);
  });
});

describe("POST /abandoned-checkouts/:checkoutSessionId/recovery-link", () => {
  it("an operator gets a /c/<token> path valid for 7 days; the list and detail show it was shared", async () => {
    const { world, checkoutSessionId } = await setup();
    world.clock.advance(2 * HOUR_MS);
    const reply = await issue(world, checkoutSessionId);
    expect(reply.status).toBe(201);
    const link = reply.body as RecoveryLinkDto;
    expect(link.path).toMatch(/^\/c\/[A-Za-z0-9_-]{43}$/);
    expect(link.url).toBeNull(); // the in-memory shop has no verified primary domain
    expect(link.expiresAt).toBe(
      new Date(world.clock.now().getTime() + 7 * 24 * HOUR_MS).toISOString(),
    );
    expect(typeof link.shopName).toBe("string");
    expect(Object.keys(link).sort()).toEqual(["expiresAt", "path", "shopName", "url"]);

    const dto = unwrap<AbandonedCheckoutDetailDto>(
      await detail(world, checkoutSessionId),
      "detail",
    );
    expect(dto.links).toEqual([
      {
        issuedAt: world.clock.now().toISOString(),
        expiresAt: link.expiresAt,
        claimCount: 0,
        lastClaimedAt: null,
      },
    ]);
    // The token is shown once, in the 201 above: neither it nor its hash is ever read back.
    expect(JSON.stringify(dto)).not.toContain(link.path.slice(3));
    expect(unwrap<Page>(await list(world), "list").items[0]?.lastLinkIssuedAt).toBe(
      world.clock.now().toISOString(),
    );
  });

  it("each copy is a new link", async () => {
    const { world, checkoutSessionId } = await setup();
    world.clock.advance(2 * HOUR_MS);
    const first = (await issue(world, checkoutSessionId)).body as RecoveryLinkDto;
    const second = (await issue(world, checkoutSessionId)).body as RecoveryLinkDto;
    expect(second.path).not.toBe(first.path);
  });

  it("is orders:recover_checkout and idempotent; a viewer is refused; a fresh checkout is 404", async () => {
    const { world, checkoutSessionId } = await setup();
    const route = world.routes.find(
      (r) =>
        r.method === "POST" && r.path === "/abandoned-checkouts/:checkoutSessionId/recovery-link",
    );
    expect(route?.permission).toBe("orders:recover_checkout");
    expect(route?.idempotent).toBe(true);
    expect((await issue(world, checkoutSessionId)).status).toBe(404);
    world.clock.advance(2 * HOUR_MS);
    expect((await issue(world, checkoutSessionId, viewerStaff)).status).toBe(403);
  });
});
```

Run: `pnpm --filter @platform/admin exec vitest run src/http/abandoned-checkout-routes.test.ts`
Expected: FAIL — `no GET /abandoned-checkouts route`.

- [ ] **Step 8: Write the routes and register them**

`apps/admin/src/http/abandoned-checkout-routes.ts`:

```ts
import { z } from "zod";
import type { Principal } from "@platform/contracts";
import { defineRoute, type RouteDefinition } from "@platform/http";
import {
  ABANDONED_PAGE_SIZE_MAX,
  RECOVERY_FILTERS,
  type GetAbandonedCheckoutOutput,
  type IssueRecoveryLinkOutput,
  type ListAbandonedCheckoutsOutput,
} from "@platform/checkout";
import type { Order } from "@platform/orders";
import type { WiredAdmin } from "../composition";
import {
  recoveredOrderOf,
  toAbandonedDetailDto,
  toAbandonedListItemDto,
  type RecoveryLinkDto,
} from "./abandoned-checkout-dto";
import { withLineImages } from "./product-images";
import { primaryHostnameOf, shopLinkUrl, shopNameOf } from "./shop-link-url";

const listQuery = z.object({
  first: z.coerce.number().int().min(1).max(ABANDONED_PAGE_SIZE_MAX).optional(),
  after: z.string().min(1).max(64).optional(),
  q: z.string().max(200).optional(),
  recovery: z.enum(RECOVERY_FILTERS).optional(),
});
const idParams = z.object({ checkoutSessionId: z.string().min(1).max(64) });

/** The recovered rows' order numbers in ONE `orders:read` read (at most 50 ids — Part 1's cap). */
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

const recoveredRefs = (sessions: readonly { readonly recoveredOrderRef?: string }[]): string[] =>
  sessions.flatMap((s) => (s.recoveredOrderRef === undefined ? [] : [s.recoveredOrderRef]));

/** Order operations Part 3 — the staff side of abandoned checkouts (spec §3.6). */
export function abandonedCheckoutRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return withLineImages(admin, [
    defineRoute({
      method: "GET",
      path: "/abandoned-checkouts",
      version: 1,
      permission: "orders:read",
      summary:
        "Abandoned checkouts (idle an hour with an email or phone) and recovered ones, newest first",
      schema: { querystring: listQuery },
      handle: async ({ query, context }) => {
        const response = await admin.checkout.listAbandoned(context.principal, {
          tenantId: context.tenantId,
          first: query.first,
          after: query.after,
          search: query.q,
          recovery: query.recovery,
        });
        if (response.status !== 200) return response;
        const page = response.body as ListAbandonedCheckoutsOutput;
        const numbers = await orderNumbersOf(
          admin,
          context.principal,
          context.tenantId,
          recoveredRefs(page.items.map((entry) => entry.record.session)),
        );
        return {
          status: 200,
          body: {
            items: page.items.map((entry) =>
              toAbandonedListItemDto(entry.record, {
                lastLinkIssuedAt: entry.lastLinkIssuedAt,
                recoveredOrder: recoveredOrderOf(entry.record.session, numbers),
              }),
            ),
            pageInfo: page.pageInfo,
          },
        };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/abandoned-checkouts/:checkoutSessionId",
      version: 1,
      permission: "orders:read",
      summary: "One abandoned checkout: lines, totals, contact, address and its recovery links",
      schema: { params: idParams },
      handle: async ({ params, context }) => {
        const response = await admin.checkout.getAbandoned(context.principal, {
          tenantId: context.tenantId,
          checkoutSessionId: params.checkoutSessionId,
        });
        if (response.status !== 200) return response;
        const found = response.body as GetAbandonedCheckoutOutput;
        const numbers = await orderNumbersOf(
          admin,
          context.principal,
          context.tenantId,
          recoveredRefs([found.record.session]),
        );
        return {
          status: 200,
          body: toAbandonedDetailDto(
            found.record,
            found.links,
            recoveredOrderOf(found.record.session, numbers),
          ),
        };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/abandoned-checkouts/:checkoutSessionId/recovery-link",
      version: 1,
      permission: "orders:recover_checkout",
      idempotent: true,
      summary:
        "Issue a new 7-day recovery link for an abandoned checkout (the token is shown once)",
      schema: { params: idParams },
      handle: async ({ params, context }) => {
        const issued = await admin.checkout.issueRecoveryLink(context.principal, {
          tenantId: context.tenantId,
          checkoutSessionId: params.checkoutSessionId,
          createdBy: context.principal.id,
        });
        if (issued.status !== 201) return issued;
        const { token, expiresAt } = issued.body as IssueRecoveryLinkOutput;
        const path = `/c/${token}`;
        const hostname = primaryHostnameOf(await admin.shopDomains(context.tenantId));
        const body: RecoveryLinkDto = {
          url: shopLinkUrl(hostname, path),
          path,
          expiresAt,
          shopName: await shopNameOf(admin),
        };
        return { status: 201, body };
      },
    }),
  ] as readonly RouteDefinition[]);
}
```

In `apps/admin/src/http/admin-routes.ts` add `import { abandonedCheckoutRoutes } from "./abandoned-checkout-routes";`
next to the order route imports, and `...abandonedCheckoutRoutes(admin),` right after
`...orderAnnotationRoutes(admin),`.

Run the route test again. Expected: PASS.

- [ ] **Step 9: Package checks**

Run: `pnpm --filter @platform/admin typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint && pnpm --filter @platform/admin test`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add apps/admin/src/interfaces/checkout.admin-controller.ts apps/admin/src/composition.ts \
  apps/admin/src/http/shop-link-url.ts apps/admin/src/http/shop-link-url.test.ts \
  apps/admin/src/http/abandoned-checkout-dto.ts apps/admin/src/http/abandoned-checkout-dto.test.ts \
  apps/admin/src/http/abandoned-checkout-routes.ts apps/admin/src/http/abandoned-checkout-routes.test.ts \
  apps/admin/src/http/admin-routes.ts apps/admin/src/http/testing/orders-harness.ts \
  apps/admin/src/http/testing/abandoned-harness.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin): abandoned checkouts list, detail and recovery link api

GET /abandoned-checkouts and /abandoned-checkouts/:id under orders:read; POST .../recovery-link
under orders:recover_checkout answers { url, path, expiresAt, shopName } with the URL built
from the shop's primary verified domain. No DTO carries the guest's sessionRef.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Public claim and preview routes (`/public/checkout-links/*`)

Model tier: **most-capable** (the security core of the part: ownership, re-pricing, no `sessionRef` leak, uniform 404, no claim on GET).

**Files:**

- Create: `apps/admin/src/http/public-checkout-link-routes.ts`, `apps/admin/src/http/public-checkout-link-routes.test.ts`
- Modify: `apps/admin/src/http/public-checkout-routes.ts` (export `checkoutItemsOf(cart)`; the `items` route uses it)
- Modify: `apps/admin/src/http/admin-routes.ts` (import + register after `...publicCheckoutRoutes(admin),`)

**Interfaces:**

- Consumes: Task 3 `CheckoutController.resolveLink/recordLinkClaim/start({ …, recoveredFromRef })/loadItems/setContactEmail/setShippingAddress/get`, `LINK_INVALID`, `ResolveCheckoutLinkOutput`; `resolveMerchandise` (`merchandise-resolution.ts`); `CartController.getCurrent/create/get/clear/add` (`admin.publicReads.cart`); `resolveLineImages`, `lineKey` (`product-images.ts`); Task 4 `shopNameOf`, harness (`recoveryWorld`, `seedRecoveryProduct`, `abandonCheckout`, `completeCheckout`, `unwrap`, `HOUR_MS`), DTO types.
- Produces:
  - `public-checkout-routes.ts`: `checkoutItemsOf(cart: Cart): Parameters<CheckoutController["loadItems"]>[0]["items"]`.
  - `public-checkout-link-routes.ts`: `publicCheckoutLinkRoutes(admin): readonly RouteDefinition[]`; `interface CheckoutLinkClaimDto { checkoutSessionId: string; droppedItems: number }`; `interface CheckoutLinkPreviewDto { purpose: "recovery"; shopName: string; itemCount: number; items: { title: string | null; variantTitle: string | null; quantity: number; imageUrl: string | null }[]; totalMinor: number; currency: string }`; `linkInvalidResponse(): AdminResponse` (404 `{ code: "LINK_INVALID", … }`).
  - Routes: `POST /public/checkout-links/claim` (`public: true`, `checkout:start`, body `{ token, sessionRef }` `.strict()`) → 200 `CheckoutLinkClaimDto` | 404 `LINK_INVALID` | 409 `ITEMS_UNAVAILABLE`; `GET /public/checkout-links/:token/preview` (`public: true`, `checkout:read`) → 200 `CheckoutLinkPreviewDto` | 404 `LINK_INVALID`.

- [ ] **Step 1: Write the failing route tests**

`apps/admin/src/http/public-checkout-link-routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type {
  AbandonedCheckoutDetailDto,
  AbandonedCheckoutListItemDto,
  RecoveryLinkDto,
} from "./abandoned-checkout-dto";
import type { CheckoutLinkPreviewDto } from "./public-checkout-link-routes";
import type { PublicCheckoutSessionDto } from "./public-checkout-routes";
import {
  abandonCheckout,
  completeCheckout,
  HOUR_MS,
  recoveryWorld,
  seedRecoveryProduct,
  unwrap,
  type RecoveryWorld,
} from "./testing/abandoned-harness";
import { HARNESS_TENANT, operatorStaff, viewerStaff } from "./testing/orders-harness";

const ORIGINAL_REF = "guest-original-ref";
const OPENER_REF = "guest-opener-ref";

async function setup() {
  const world = recoveryWorld();
  const tee = await seedRecoveryProduct(world, "TEE", 25000);
  const cap = await seedRecoveryProduct(world, "CAP", 9000);
  const mug = await seedRecoveryProduct(world, "MUG", 5000);
  const { checkoutSessionId } = await abandonCheckout(world, {
    sessionRef: ORIGINAL_REF,
    lines: [
      { product: tee, quantity: 2 },
      { product: cap, quantity: 1 },
    ],
    email: "sara@example.com",
  });
  world.clock.advance(2 * HOUR_MS);
  const link = unwrap<RecoveryLinkDto>(
    await world.staffCall(
      "POST",
      "/abandoned-checkouts/:checkoutSessionId/recovery-link",
      { params: { checkoutSessionId } },
      operatorStaff,
    ),
    "issue link",
  );
  return { world, tee, cap, mug, checkoutSessionId, token: link.path.slice("/c/".length) };
}

const claim = (world: RecoveryWorld, token: string, sessionRef: string, tenantId?: string) =>
  world.publicCall("POST", "/public/checkout-links/claim", {
    body: { token, sessionRef },
    ...(tenantId === undefined ? {} : { tenantId }),
  });
const preview = (world: RecoveryWorld, token: string, tenantId?: string) =>
  world.publicCall("GET", "/public/checkout-links/:token/preview", {
    params: { token },
    ...(tenantId === undefined ? {} : { tenantId }),
  });
const sessionAs = (world: RecoveryWorld, checkoutSessionId: string, sessionRef: string) =>
  world.publicCall("GET", "/public/checkouts/:checkoutSessionId", {
    params: { checkoutSessionId },
    sessionRef,
  });
const cartOf = async (world: RecoveryWorld, sessionRef: string) =>
  unwrap<{ cart: { items: { productId: string; quantity: number }[] } | null }>(
    await world.publicCall("GET", "/public/carts/current", { sessionRef }),
    "current cart",
  ).cart;
const linksOf = async (world: RecoveryWorld, checkoutSessionId: string) =>
  unwrap<AbandonedCheckoutDetailDto>(
    await world.staffCall(
      "GET",
      "/abandoned-checkouts/:checkoutSessionId",
      { params: { checkoutSessionId } },
      viewerStaff,
    ),
    "detail",
  ).links;

interface Claimed {
  readonly checkoutSessionId: string;
  readonly droppedItems: number;
}

describe("POST /public/checkout-links/claim (order operations Part 3)", () => {
  it("clones the lines into the opener's OWN new checkout at today's prices, with contact and address", async () => {
    const { world, tee, checkoutSessionId, token } = await setup();
    unwrap(
      await world.admin.publicReads.products.updateVariant({
        productId: tee.productId,
        variantId: tee.variantId,
        sku: "TEE-STD",
        priceAmountMinor: 27000,
        currency: "EGP",
        tenantId: HARNESS_TENANT,
      }),
      "reprice",
    );

    const reply = await claim(world, token, OPENER_REF);
    expect(reply.status).toBe(200);
    const claimed = reply.body as Claimed;
    expect(Object.keys(claimed).sort()).toEqual(["checkoutSessionId", "droppedItems"]);
    expect(claimed.droppedItems).toBe(0);
    expect(claimed.checkoutSessionId).not.toBe(checkoutSessionId);
    expect(JSON.stringify(reply.body)).not.toContain(ORIGINAL_REF);

    const clone = unwrap<PublicCheckoutSessionDto>(
      await sessionAs(world, claimed.checkoutSessionId, OPENER_REF),
      "read clone",
    );
    expect(clone.items.map((item) => [item.sku, item.quantity, item.unitPriceAmountMinor])).toEqual(
      [
        ["TEE-STD", 2, 27000],
        ["CAP-STD", 1, 9000],
      ],
    );
    expect(clone.contactEmail).toBe("sara@example.com");
    expect(clone.shippingAddress).toMatchObject({
      name: "Mona Ali",
      phone: "01001234567",
      city: "Cairo",
      province: "EG-C",
    });
    expect(clone.selectedShippingMethod).toBeNull();
    expect(clone.selectedPaymentMethod).toBeNull();
    expect(clone.discount.codes).toEqual([]);

    // Ownership never moves: the original's owner cannot read the clone, the opener cannot read the original.
    expect((await sessionAs(world, claimed.checkoutSessionId, ORIGINAL_REF)).status).toBe(404);
    expect((await sessionAs(world, checkoutSessionId, OPENER_REF)).status).toBe(404);
    expect((await linksOf(world, checkoutSessionId))[0]?.claimCount).toBe(1);
  });

  it("replaces whatever the opener already had in their cart", async () => {
    const { world, tee, cap, mug, token } = await setup();
    const cart = unwrap<{ id: string }>(
      await world.publicCall("POST", "/public/carts", {
        body: { sessionRef: OPENER_REF, currency: "EGP" },
      }),
      "opener cart",
    );
    unwrap(
      await world.publicCall("POST", "/public/carts/:cartId/items", {
        params: { cartId: cart.id },
        body: { sessionRef: OPENER_REF, productId: mug.productId, quantity: 5 },
      }),
      "opener item",
    );
    unwrap(await claim(world, token, OPENER_REF), "claim");
    expect((await cartOf(world, OPENER_REF))?.items.map((i) => [i.productId, i.quantity])).toEqual([
      [tee.productId, 2],
      [cap.productId, 1],
    ]);
  });

  it("drops lines that can no longer be sold and says how many", async () => {
    const { world, tee, cap, token } = await setup();
    unwrap(
      await world.admin.publicReads.products.unpublish({
        productId: cap.productId,
        tenantId: HARNESS_TENANT,
      }),
      "unpublish",
    );
    const claimed = unwrap<Claimed>(await claim(world, token, OPENER_REF), "claim");
    expect(claimed.droppedItems).toBe(1);
    const clone = unwrap<PublicCheckoutSessionDto>(
      await sessionAs(world, claimed.checkoutSessionId, OPENER_REF),
      "read clone",
    );
    expect(clone.items.map((item) => item.productId)).toEqual([tee.productId]);
  });

  it("nothing left to sell → 409 ITEMS_UNAVAILABLE, and the opener's cart is left as it was", async () => {
    const { world, tee, cap, mug, checkoutSessionId, token } = await setup();
    const cart = unwrap<{ id: string }>(
      await world.publicCall("POST", "/public/carts", {
        body: { sessionRef: OPENER_REF, currency: "EGP" },
      }),
      "opener cart",
    );
    unwrap(
      await world.publicCall("POST", "/public/carts/:cartId/items", {
        params: { cartId: cart.id },
        body: { sessionRef: OPENER_REF, productId: mug.productId, quantity: 1 },
      }),
      "opener item",
    );
    for (const product of [tee, cap]) {
      unwrap(
        await world.admin.publicReads.products.unpublish({
          productId: product.productId,
          tenantId: HARNESS_TENANT,
        }),
        "unpublish",
      );
    }
    const reply = await claim(world, token, OPENER_REF);
    expect(reply.status).toBe(409);
    expect((reply.body as { code: string }).code).toBe("ITEMS_UNAVAILABLE");
    expect((await cartOf(world, OPENER_REF))?.items.map((i) => [i.productId, i.quantity])).toEqual([
      [mug.productId, 1],
    ]);
    expect((await linksOf(world, checkoutSessionId))[0]?.claimCount).toBe(0);
  });

  it("a second tap by the same shopper resumes the same checkout instead of cloning again", async () => {
    const { world, checkoutSessionId, token } = await setup();
    const first = unwrap<Claimed>(await claim(world, token, OPENER_REF), "first tap");
    const second = unwrap<Claimed>(await claim(world, token, OPENER_REF), "second tap");
    expect(second).toEqual({ checkoutSessionId: first.checkoutSessionId, droppedItems: 0 });
    expect((await linksOf(world, checkoutSessionId))[0]?.claimCount).toBe(1);
  });

  it("another shopper's tap clones their own checkout", async () => {
    const { world, token } = await setup();
    const mine = unwrap<Claimed>(await claim(world, token, OPENER_REF), "mine");
    const theirs = unwrap<Claimed>(await claim(world, token, "guest-forwarded-to"), "theirs");
    expect(theirs.checkoutSessionId).not.toBe(mine.checkoutSessionId);
    expect((await sessionAs(world, theirs.checkoutSessionId, OPENER_REF)).status).toBe(404);
  });

  it("unknown, expired and other-shop tokens all answer the same 404 LINK_INVALID", async () => {
    const { world, token } = await setup();
    const unknown = await claim(world, "x".repeat(43), OPENER_REF);
    const otherShop = await claim(world, token, OPENER_REF, "shop-b");
    world.clock.advance(7 * 24 * HOUR_MS);
    const expired = await claim(world, token, OPENER_REF);
    for (const reply of [unknown, otherShop, expired]) {
      expect(reply.status).toBe(404);
      expect(reply.body).toEqual(unknown.body);
    }
    expect((unknown.body as { code: string }).code).toBe("LINK_INVALID");
  });

  it("a link whose checkout became an order is spent; the original browser cannot place it either (Review Focus 4)", async () => {
    const { world, checkoutSessionId, token } = await setup();
    const claimed = unwrap<Claimed>(await claim(world, token, OPENER_REF), "claim");
    const orderRef = await completeCheckout(world, claimed.checkoutSessionId, OPENER_REF);

    const again = await claim(world, token, "guest-forwarded-to");
    expect(again.status).toBe(404);
    expect((again.body as { code: string }).code).toBe("LINK_INVALID");

    const originalComplete = await world.publicCall(
      "POST",
      "/public/checkouts/:checkoutSessionId/complete",
      {
        params: { checkoutSessionId },
        body: { sessionRef: ORIGINAL_REF, idempotencyKey: "original-try" },
      },
    );
    expect(originalComplete.status).toBe(409);

    const row = unwrap<{ items: AbandonedCheckoutListItemDto[] }>(
      await world.staffCall(
        "GET",
        "/abandoned-checkouts",
        { query: { recovery: "recovered" } },
        viewerStaff,
      ),
      "list",
    ).items[0];
    expect(row?.id).toBe(checkoutSessionId);
    expect(row?.recoveryStatus).toBe("recovered");
    expect(row?.recoveredOrder?.id).toBe(orderRef);
    expect(typeof row?.recoveredOrder?.orderNumber).toBe("string");
  });

  it("is public, takes only { token, sessionRef }, and the public start cannot set recoveredFromRef", async () => {
    const { world } = await setup();
    const route = world.routes.find(
      (r) => r.method === "POST" && r.path === "/public/checkout-links/claim",
    );
    expect(route?.public).toBe(true);
    expect(route?.permission).toBe("checkout:start");
    expect(route?.schema.body?.safeParse({ token: "t", sessionRef: "s" }).success).toBe(true);
    expect(
      route?.schema.body?.safeParse({ token: "t", sessionRef: "s", priceMinor: 1 }).success,
    ).toBe(false);
    expect(route?.schema.body?.safeParse({ token: "t" }).success).toBe(false);
    const start = world.routes.find((r) => r.method === "POST" && r.path === "/public/checkouts");
    expect(
      start?.schema.body?.safeParse({
        sessionRef: "s",
        cartRef: "c",
        currency: "EGP",
        recoveredFromRef: "x",
      }).success,
    ).toBe(false);
  });
});

describe("GET /public/checkout-links/:token/preview", () => {
  it("shows the shop, the items and the total — never an email, phone, address or sessionRef", async () => {
    const { world, token } = await setup();
    const reply = await preview(world, token);
    expect(reply.status).toBe(200);
    const dto = reply.body as CheckoutLinkPreviewDto;
    expect(Object.keys(dto).sort()).toEqual([
      "currency",
      "itemCount",
      "items",
      "purpose",
      "shopName",
      "totalMinor",
    ]);
    expect(dto.purpose).toBe("recovery");
    expect(dto.itemCount).toBe(3);
    expect(dto.totalMinor).toBe(59000);
    expect(dto.currency).toBe("EGP");
    expect(dto.items.map((item) => Object.keys(item).sort())).toEqual([
      ["imageUrl", "quantity", "title", "variantTitle"],
      ["imageUrl", "quantity", "title", "variantTitle"],
    ]);
    const text = JSON.stringify(dto);
    for (const secret of ["sara@", "0100", "Nile", "Mona", "Cairo", ORIGINAL_REF]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("reading it never claims: no clone, no cart, no claim counted", async () => {
    const { world, checkoutSessionId, token } = await setup();
    await preview(world, token);
    await preview(world, token);
    expect((await linksOf(world, checkoutSessionId))[0]?.claimCount).toBe(0);
    expect(await cartOf(world, OPENER_REF)).toBeNull();
  });

  it("an invalid token answers exactly what the claim answers", async () => {
    const { world, token } = await setup();
    const fromPreview = await preview(world, token, "shop-b");
    const fromClaim = await claim(world, "x".repeat(43), OPENER_REF);
    expect(fromPreview.status).toBe(404);
    expect(fromPreview.body).toEqual(fromClaim.body);
  });
});
```

Run: `pnpm --filter @platform/admin exec vitest run src/http/public-checkout-link-routes.test.ts`
Expected: FAIL — `no POST /public/checkout-links/claim route`.

- [ ] **Step 2: Extract `checkoutItemsOf` from the public `items` route**

In `apps/admin/src/http/public-checkout-routes.ts`, change the `@platform/checkout` import to also bring
`type CheckoutController`, add above `export function publicCheckoutRoutes`:

```ts
/**
 * The item snapshot a checkout loads from a cart (Plan 2A: the variant snapshot rides along; every key
 * is absent on a legacy line). Prices come from the cart, which priced them server-side.
 */
export function checkoutItemsOf(
  cart: Cart,
): Parameters<CheckoutController["loadItems"]>[0]["items"] {
  return cart.items.map((item) => ({
    productId: item.productRef.value,
    quantity: item.quantity.value,
    unitPriceAmountMinor: item.unitPrice.amountMinor,
    currency: item.unitPrice.currency,
    ...(item.variantRef === undefined
      ? {}
      : {
          variantId: item.variantRef,
          sku: item.sku,
          title: item.title,
          variantTitle: item.variantTitle,
        }),
  }));
}
```

and in the `POST /public/checkouts/:checkoutSessionId/items` handler replace the inline
`const items = cart.items.map(…);` block with `const items = checkoutItemsOf(cart);`.

Run: `pnpm --filter @platform/admin exec vitest run src/http/public-checkout-routes.test.ts`
Expected: PASS (unchanged behaviour).

- [ ] **Step 3: Write the routes**

`apps/admin/src/http/public-checkout-link-routes.ts`:

```ts
import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { Cart } from "@platform/cart";
import {
  LINK_INVALID,
  type CheckoutSession,
  type ResolveCheckoutLinkOutput,
} from "@platform/checkout";
import { BusinessRuleError, NotFoundError, toErrorEnvelope } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import { resolveMerchandise, type MerchandiseResolution } from "./merchandise-resolution";
import { lineKey, resolveLineImages } from "./product-images";
import { checkoutItemsOf } from "./public-checkout-routes";
import { shopNameOf } from "./shop-link-url";

const token = z.string().min(1).max(128);
/** `.strict()`: a claim carries the bearer token and the caller's own session — never a price. */
const claimBody = z.object({ token, sessionRef: z.string().min(1) }).strict();
const tokenParams = z.object({ token });

export interface CheckoutLinkClaimDto {
  /** The CALLER's new (or resumed) checkout — never the abandoned one. */
  readonly checkoutSessionId: string;
  readonly droppedItems: number;
}

export interface CheckoutLinkPreviewDto {
  readonly purpose: "recovery";
  readonly shopName: string;
  readonly itemCount: number;
  readonly items: readonly {
    readonly title: string | null;
    readonly variantTitle: string | null;
    readonly quantity: number;
    readonly imageUrl: string | null;
  }[];
  /** The lines at the prices they were left at; the checkout re-prices them (spec §3.5). */
  readonly totalMinor: number;
  readonly currency: string;
}

const isOk = (response: AdminResponse): boolean => response.status >= 200 && response.status < 300;

/** Every link that cannot be used — unknown, expired, revoked, another shop's, spent — answers this. */
export function linkInvalidResponse(): AdminResponse {
  return {
    status: 404,
    body: {
      ...toErrorEnvelope(new NotFoundError("This link has expired or is no longer valid")),
      code: LINK_INVALID,
    },
  };
}

function itemsUnavailableResponse(): AdminResponse {
  return {
    status: 409,
    body: {
      ...toErrorEnvelope(
        new BusinessRuleError("None of this checkout's items can be sold any more"),
      ),
      code: "ITEMS_UNAVAILABLE",
    },
  };
}

async function resolve(
  admin: WiredAdmin,
  tenantId: string,
  value: string,
): Promise<ResolveCheckoutLinkOutput | null> {
  const resolved = await admin.publicReads.checkout.resolveLink({ tenantId, token: value });
  return resolved.status === 200 ? (resolved.body as ResolveCheckoutLinkOutput) : null;
}

/** Spec §3.5 step 2: the session the last claim made, if it is still open AND the caller's own. */
async function reusableResult(
  admin: WiredAdmin,
  tenantId: string,
  resultRef: string | null,
  sessionRef: string,
): Promise<string | null> {
  if (resultRef === null) return null;
  const response = await admin.publicReads.checkout.get({ tenantId, checkoutSessionId: resultRef });
  if (response.status !== 200) return null;
  const session = response.body as CheckoutSession;
  return session.sessionRef === sessionRef && session.state.isOpen ? resultRef : null;
}

type Priced = Extract<MerchandiseResolution, { status: "ok" }> & { readonly quantity: number };

/** Each abandoned line priced from Catalog NOW (never the snapshot); unsellable lines are counted. */
async function priceLines(
  admin: WiredAdmin,
  tenantId: string,
  abandoned: CheckoutSession,
): Promise<{ readonly priced: readonly Priced[]; readonly dropped: number }> {
  const priced: Priced[] = [];
  let dropped = 0;
  for (const line of abandoned.items) {
    const merchandise = await resolveMerchandise(
      admin,
      {
        productId: line.productRef,
        ...(line.variantRef === undefined ? {} : { variantId: line.variantRef }),
      },
      tenantId,
    );
    if (merchandise.status === "ok") priced.push({ ...merchandise, quantity: line.quantity });
    else dropped += 1;
  }
  return { priced, dropped };
}

/** The caller's current cart (created when there is none), emptied: Shopify's recovery replaces it. */
async function emptiedCart(
  admin: WiredAdmin,
  tenantId: string,
  sessionRef: string,
  currency: string,
): Promise<Cart | AdminResponse> {
  const current = await admin.publicReads.cart.getCurrent({ tenantId, sessionRef });
  if (!isOk(current)) return current;
  let cart = current.body as Cart | null;
  if (cart === null) {
    const created = await admin.publicReads.cart.create({ tenantId, sessionRef, currency });
    if (!isOk(created)) return created;
    const read = await admin.publicReads.cart.get({
      tenantId,
      cartId: (created.body as { readonly cartId: string }).cartId,
    });
    if (!isOk(read)) return read;
    cart = read.body as Cart;
  }
  if (cart.items.length > 0) {
    const cleared = await admin.publicReads.cart.clear({ tenantId, cartId: cart.id.toString() });
    if (!isOk(cleared)) return cleared;
  }
  return cart;
}

/** StartCheckout (marked as a recovery), items from the refilled cart, then contact and address. */
async function startRecoveredCheckout(
  admin: WiredAdmin,
  tenantId: string,
  sessionRef: string,
  cart: Cart,
  abandoned: CheckoutSession,
): Promise<string | AdminResponse> {
  const cartId = cart.id.toString();
  const started = await admin.publicReads.checkout.start({
    tenantId,
    cartRef: cartId,
    sessionRef,
    currency: cart.currency,
    recoveredFromRef: abandoned.id.toString(),
  });
  if (!isOk(started)) return started;
  const { checkoutSessionId } = started.body as { readonly checkoutSessionId: string };
  const refilled = await admin.publicReads.cart.get({ tenantId, cartId });
  if (!isOk(refilled)) return refilled;
  const loaded = await admin.publicReads.checkout.loadItems({
    tenantId,
    checkoutSessionId,
    items: checkoutItemsOf(refilled.body as Cart),
  });
  if (!isOk(loaded)) return loaded;
  // Best effort: an email or address that no longer validates is simply asked for again at checkout.
  // Shipping/payment choices and discount codes are NOT copied — the shopper re-chooses (spec §3.5).
  if (abandoned.contactEmail !== undefined) {
    await admin.publicReads.checkout.setContactEmail({
      tenantId,
      checkoutSessionId,
      email: abandoned.contactEmail.value,
    });
  }
  const address = abandoned.shippingAddress;
  if (address !== undefined) {
    await admin.publicReads.checkout.setShippingAddress({
      tenantId,
      checkoutSessionId,
      name: address.name,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      postalCode: address.postalCode,
      country: address.country,
      ...(address.province === undefined ? {} : { province: address.province }),
    });
  }
  return checkoutSessionId;
}

/**
 * Order operations Part 3 — the shopper's side of a recovery link (spec §3.5). Public like the
 * checkout routes; the token is the bearer proof for "resume this checkout", and the caller's
 * `sessionRef` (their own HttpOnly cookie, sent by the storefront's server) owns whatever is made.
 *
 * The claim CLONES: the abandoned session — and its owner's `sessionRef` — is never handed over or
 * echoed. Lines are re-priced from Catalog; the claim happens only on this POST (the storefront's
 * button), never on the preview GET that link-preview bots fetch.
 */
export function publicCheckoutLinkRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/public/checkout-links/claim",
      version: 1,
      permission: "checkout:start",
      public: true,
      summary:
        "Public: open a recovery link — clones its checkout into the caller's own, at today's prices",
      schema: { body: claimBody },
      handle: async ({ body, context }) => {
        const tenantId = context.tenantId;
        const resolved = await resolve(admin, tenantId, body.token);
        if (resolved === null) return linkInvalidResponse();

        const reused = await reusableResult(
          admin,
          tenantId,
          resolved.link.resultCheckoutRef,
          body.sessionRef,
        );
        if (reused !== null) {
          const dto: CheckoutLinkClaimDto = { checkoutSessionId: reused, droppedItems: 0 };
          return { status: 200, body: dto };
        }

        const abandoned = resolved.session;
        const { priced, dropped } = await priceLines(admin, tenantId, abandoned);
        if (priced.length === 0) return itemsUnavailableResponse();

        const cart = await emptiedCart(admin, tenantId, body.sessionRef, abandoned.currency);
        if (!("items" in cart)) return cart;
        let kept = 0;
        let droppedItems = dropped;
        for (const line of priced) {
          const added =
            line.currency === cart.currency
              ? await admin.publicReads.cart.add({
                  tenantId,
                  cartId: cart.id.toString(),
                  productId: line.productId,
                  quantity: line.quantity,
                  unitPriceAmountMinor: line.amountMinor,
                  currency: line.currency,
                  merchandise: {
                    variantRef: line.variantId,
                    sku: line.sku,
                    title: line.title,
                    variantTitle: line.variantTitle,
                  },
                })
              : null;
          if (added !== null && isOk(added)) kept += 1;
          else droppedItems += 1;
        }
        if (kept === 0) return itemsUnavailableResponse();

        const started = await startRecoveredCheckout(
          admin,
          tenantId,
          body.sessionRef,
          cart,
          abandoned,
        );
        if (typeof started !== "string") return started;
        const recorded = await admin.publicReads.checkout.recordLinkClaim({
          tenantId,
          linkId: resolved.link.id,
          resultCheckoutRef: started,
        });
        if (!isOk(recorded)) return linkInvalidResponse();
        const dto: CheckoutLinkClaimDto = { checkoutSessionId: started, droppedItems };
        return { status: 200, body: dto };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/public/checkout-links/:token/preview",
      version: 1,
      permission: "checkout:read",
      public: true,
      summary:
        "Public: what a recovery link holds (shop, items, total) — no personal data, claims nothing",
      schema: { params: tokenParams },
      handle: async ({ params, context }) => {
        const resolved = await resolve(admin, context.tenantId, params.token);
        if (resolved === null) return linkInvalidResponse();
        const { session } = resolved;
        const images = await resolveLineImages(
          admin,
          context.tenantId,
          session.items.map((item) => ({
            productId: item.productRef,
            variantId: item.variantRef ?? null,
          })),
        );
        const dto: CheckoutLinkPreviewDto = {
          purpose: "recovery",
          shopName: await shopNameOf(admin),
          itemCount: session.items.reduce((count, item) => count + item.quantity, 0),
          items: session.items.map((item) => ({
            title: item.title ?? null,
            variantTitle: item.variantTitle ?? null,
            quantity: item.quantity,
            imageUrl: images.get(lineKey(item.productRef, item.variantRef ?? null))?.url ?? null,
          })),
          totalMinor: session.items.reduce((sum, item) => sum + item.lineTotalMinor, 0),
          currency: session.currency,
        };
        return { status: 200, body: dto };
      },
    }),
  ] as readonly RouteDefinition[];
}
```

Notes for the implementer:

- `"items" in cart` distinguishes the `Cart` aggregate from an `AdminResponse` (`{ status, body }`): `in`
  also sees the `items` getter on `Cart`'s prototype, and an `AdminResponse` has no `items` key.
- `CheckoutSession` is imported as a type only; the session's `state.isOpen`, `contactEmail`,
  `shippingAddress`, `items` and `id` are the aggregate's existing getters.

In `apps/admin/src/http/admin-routes.ts` add `import { publicCheckoutLinkRoutes } from "./public-checkout-link-routes";`
and `...publicCheckoutLinkRoutes(admin),` right after `...publicCheckoutRoutes(admin),`.

- [ ] **Step 4: Run the route tests**

Run: `pnpm --filter @platform/admin exec vitest run src/http/public-checkout-link-routes.test.ts src/http/abandoned-checkout-routes.test.ts src/http/public-checkout-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Package checks**

Run: `pnpm --filter @platform/admin typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint && pnpm --filter @platform/admin test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/http/public-checkout-link-routes.ts \
  apps/admin/src/http/public-checkout-link-routes.test.ts \
  apps/admin/src/http/public-checkout-routes.ts apps/admin/src/http/admin-routes.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin): public recovery link claim and preview routes

POST /public/checkout-links/claim clones an abandoned checkout into the caller's own cart and
session at today's catalog prices, drops unsellable lines, reuses the result on a second tap
and never returns the original sessionRef. GET .../preview shows shop, items and total only.
Unknown, expired, other-shop and spent links answer the same 404 LINK_INVALID.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: admin-web — Orders → Abandoned checkouts navigation, API client and the list page

Model tier: **standard**.

**Files:**

- Modify: `apps/admin-web/src/components/navigation.ts` (Orders gets `children`), `apps/admin-web/src/components/navigation.test.tsx` (append three tests)
- Create: `apps/admin-web/src/lib/api/abandoned-checkouts.ts`, `apps/admin-web/src/lib/api/abandoned-checkouts.test.ts`
- Create: `apps/admin-web/src/lib/orders/abandoned-checkouts.ts`, `apps/admin-web/src/lib/orders/abandoned-checkouts.test.ts`
- Create: `apps/admin-web/src/components/abandoned-checkouts/abandoned-checkouts-table.tsx`, `abandoned-checkouts-table.test.tsx`
- Create: `apps/admin-web/src/components/abandoned-checkouts/abandoned-checkouts-filters.tsx`, `abandoned-checkouts-filters.test.tsx`
- Create: `apps/admin-web/src/app/abandoned-checkouts/page.tsx`
- Modify: `apps/admin-web/src/messages/en.ts`, `apps/admin-web/src/messages/ar.ts` (`nav.abandonedCheckouts` and a whole `abandonedCheckouts` section — Task 7 uses the rest)

**Interfaces:**

- Consumes: Task 4/5 API shapes (`GET /abandoned-checkouts`, `GET /abandoned-checkouts/:id`, `POST …/recovery-link` → `{ url, path, expiresAt, shopName }`); `getAdminApi`, `mutateAdminApi`, `ApiResult`, `MutationResult` (`lib/api/client.ts`); `AppShell`, `OrdersPagination`, `formatCurrency`, `formatShortDate`, `getCurrentUser`, i18n helpers.
- Produces:
  - `lib/api/abandoned-checkouts.ts`: types `AbandonedRecoveryStatus`, `AbandonedCheckoutListItemDto`, `AbandonedCheckoutLineDto`, `AbandonedCheckoutTotalsDto`, `AbandonedCheckoutAddressDto`, `AbandonedCheckoutLinkDto`, `AbandonedCheckoutDetailDto`, `AbandonedCheckoutsPageDto`, `AbandonedCheckoutsQuery`, `RecoveryLinkDto`; `fetchAbandonedCheckouts(query): Promise<ApiResult<AbandonedCheckoutsPageDto>>`, `fetchAbandonedCheckout(id): Promise<ApiResult<AbandonedCheckoutDetailDto>>`, `issueRecoveryLink(id, idempotencyKey): Promise<MutationResult<RecoveryLinkDto>>`.
  - `lib/orders/abandoned-checkouts.ts`: `ABANDONED_PAGE_SIZE = 50`, `parseRecoveryFilter(raw?: string): AbandonedRecoveryStatus | undefined`, `placedByLabel(item): string | null`, `canRecoverCheckout(role: string | undefined): boolean`, `recoveryLinkHref(link: { url; path }, storefrontUrl: string | null): string | null`, `type AbandonedTimelineKind`, `interface AbandonedTimelineEvent`, `abandonedTimeline(detail): AbandonedTimelineEvent[]`.
  - Components: `AbandonedCheckoutsTable({ checkouts, t, locale })`, `AbandonedCheckoutsFilters({ q, recovery, t })`.
  - Dictionary: `t.nav.abandonedCheckouts`, `t.abandonedCheckouts.{title, searchLabel, searchPlaceholder, search, recoveryFilterLabel, recoveryFilterAll, columns.*, notShared, shared, recovered, notRecovered, unknownCustomer, noRegion, empty, emptyBody, emptyFiltered, error, unauthorized, back, notFound, items.*, totals.*, customer.*, shippingAddress.*, recovery.*, timeline.*}`.
  - Route `/abandoned-checkouts` (`activeNavId="abandoned-checkouts"`).

- [ ] **Step 1: Add the strings (both dictionaries)**

In `apps/admin-web/src/messages/en.ts`, in `nav` after `orders: "Orders",` add `abandonedCheckouts: "Abandoned checkouts",`,
and add this section right before `orderPaymentStatus: {`:

```ts
  /** Order operations Part 3 — Orders → Abandoned checkouts (Shopify's wording). */
  abandonedCheckouts: {
    title: "Abandoned checkouts",
    searchLabel: "Search abandoned checkouts",
    searchPlaceholder: "Search by email, name or phone",
    search: "Search",
    recoveryFilterLabel: "Recovery status",
    recoveryFilterAll: "All",
    columns: {
      checkout: "Checkout",
      date: "Date",
      placedBy: "Placed by",
      region: "Region",
      recoveryLink: "Recovery link",
      recoveryStatus: "Recovery status",
      total: "Total",
    },
    notShared: "Not shared",
    shared: "Shared {date}",
    recovered: "Recovered",
    notRecovered: "Not recovered",
    unknownCustomer: "Unknown",
    noRegion: "—",
    empty: "No abandoned checkouts yet",
    emptyBody:
      "When a customer enters their email or phone at checkout and leaves without paying, the checkout appears here an hour later.",
    emptyFiltered: "No abandoned checkouts match your search.",
    error: "Couldn't load abandoned checkouts. Try again.",
    unauthorized: "You don't have access to abandoned checkouts.",
    back: "Abandoned checkouts",
    notFound: "This checkout doesn't exist or is no longer abandoned.",
    items: { title: "Items", quantity: "× {count}", noTitle: "Item" },
    totals: {
      title: "Payment",
      subtotal: "Subtotal",
      shipping: "Shipping",
      tax: "Taxes",
      discount: "Discount",
      total: "Total",
      notCalculated: "The customer hadn't chosen shipping yet.",
    },
    customer: { title: "Customer", email: "Email", phone: "Phone", none: "No contact information" },
    shippingAddress: { title: "Shipping address", none: "No shipping address" },
    recovery: {
      title: "Recovery",
      copy: "Copy recovery link",
      copied: "Copied",
      whatsapp: "Share on WhatsApp",
      issuing: "Creating link…",
      linkLabel: "Recovery link",
      expires: "This link works for 7 days. Each copy creates a new link.",
      comingSoon: "Automatic recovery messages are coming soon.",
      dialogTitle: "Share on WhatsApp",
      messageLabel: "Message",
      openWhatsApp: "Open WhatsApp",
      cancel: "Cancel",
      error: "Couldn't create the recovery link. Try again.",
      forbidden: "You don't have permission to send recovery links.",
      alreadyRecovered: "This checkout was already recovered.",
      noStoreAddress: "Your store has no web address yet, so a link can't be made.",
      whatsappMessage:
        "Hi {name}, we noticed you didn't finish your order from {shop}. You can complete it here: {url}",
      whatsappMessageNoName:
        "Hi, we noticed you didn't finish your order from {shop}. You can complete it here: {url}",
    },
    timeline: {
      title: "Timeline",
      started: "Checkout started",
      lastActivity: "Last activity",
      linkIssued: "Recovery link created",
      linkOpened: "Recovery link opened ({count})",
      recovered: "Recovered — order {order}",
    },
  },
```

In `apps/admin-web/src/messages/ar.ts`, in `nav` after `orders: "الطلبات",` (the first one, inside `nav`) add
`abandonedCheckouts: "عمليات الدفع المتروكة",`, and add before `orderPaymentStatus: {`:

```ts
  abandonedCheckouts: {
    title: "عمليات الدفع المتروكة",
    searchLabel: "البحث في عمليات الدفع المتروكة",
    searchPlaceholder: "ابحث بالبريد الإلكتروني أو الاسم أو الهاتف",
    search: "بحث",
    recoveryFilterLabel: "حالة الاسترداد",
    recoveryFilterAll: "الكل",
    columns: {
      checkout: "عملية الدفع",
      date: "التاريخ",
      placedBy: "بواسطة",
      region: "المنطقة",
      recoveryLink: "رابط الاسترداد",
      recoveryStatus: "حالة الاسترداد",
      total: "الإجمالي",
    },
    notShared: "لم تتم المشاركة",
    shared: "تمت المشاركة {date}",
    recovered: "تم الاسترداد",
    notRecovered: "لم يتم الاسترداد",
    unknownCustomer: "غير معروف",
    noRegion: "—",
    empty: "لا توجد عمليات دفع متروكة بعد",
    emptyBody:
      "عندما يكتب العميل بريده أو هاتفه في صفحة الدفع ويغادر دون أن يدفع، تظهر عملية الدفع هنا بعد ساعة.",
    emptyFiltered: "لا توجد عمليات دفع متروكة تطابق بحثك.",
    error: "تعذّر تحميل عمليات الدفع المتروكة. حاول مرة أخرى.",
    unauthorized: "ليست لديك صلاحية لعرض عمليات الدفع المتروكة.",
    back: "عمليات الدفع المتروكة",
    notFound: "عملية الدفع هذه غير موجودة أو لم تعد متروكة.",
    items: { title: "المنتجات", quantity: "× {count}", noTitle: "منتج" },
    totals: {
      title: "الدفع",
      subtotal: "المجموع الفرعي",
      shipping: "الشحن",
      tax: "الضرائب",
      discount: "الخصم",
      total: "الإجمالي",
      notCalculated: "لم يختر العميل طريقة الشحن بعد.",
    },
    customer: { title: "العميل", email: "البريد الإلكتروني", phone: "الهاتف", none: "لا توجد بيانات تواصل" },
    shippingAddress: { title: "عنوان الشحن", none: "لا يوجد عنوان شحن" },
    recovery: {
      title: "الاسترداد",
      copy: "نسخ رابط الاسترداد",
      copied: "تم النسخ",
      whatsapp: "مشاركة عبر واتساب",
      issuing: "جارٍ إنشاء الرابط…",
      linkLabel: "رابط الاسترداد",
      expires: "يعمل هذا الرابط لمدة 7 أيام. كل نسخ ينشئ رابطًا جديدًا.",
      comingSoon: "رسائل الاسترداد التلقائية قادمة قريبًا.",
      dialogTitle: "مشاركة عبر واتساب",
      messageLabel: "الرسالة",
      openWhatsApp: "فتح واتساب",
      cancel: "إلغاء",
      error: "تعذّر إنشاء رابط الاسترداد. حاول مرة أخرى.",
      forbidden: "ليست لديك صلاحية لإرسال روابط الاسترداد.",
      alreadyRecovered: "تم استرداد عملية الدفع هذه بالفعل.",
      noStoreAddress: "متجرك ليس له عنوان على الإنترنت بعد، لذلك لا يمكن إنشاء رابط.",
      whatsappMessage: "أهلاً {name}، لاحظنا إنك ما كملتش طلبك من {shop}. تقدر تكمله من هنا: {url}",
      whatsappMessageNoName: "أهلاً، لاحظنا إنك ما كملتش طلبك من {shop}. تقدر تكمله من هنا: {url}",
    },
    timeline: {
      title: "السجل",
      started: "بدأت عملية الدفع",
      lastActivity: "آخر نشاط",
      linkIssued: "تم إنشاء رابط الاسترداد",
      linkOpened: "تم فتح رابط الاسترداد ({count})",
      recovered: "تم الاسترداد — الطلب {order}",
    },
  },
```

Run: `pnpm --filter admin-web typecheck`
Expected: PASS (`ar` is typed against `en`, so a missing key would fail here).

- [ ] **Step 2: Write the failing navigation tests**

Append inside `describe("SidebarNav (Shopify layout)", …)` in `apps/admin-web/src/components/navigation.test.tsx`:

```tsx
it("lists Abandoned checkouts under Orders while an Orders page is current (order operations Part 3)", () => {
  renderNav("orders");
  expect(screen.getByRole("link", { name: en.nav.abandonedCheckouts })).toHaveAttribute(
    "href",
    "/abandoned-checkouts",
  );
});

it("marks Abandoned checkouts current on its own pages and keeps Orders in view", () => {
  renderNav("abandoned-checkouts");
  expect(screen.getByRole("link", { name: en.nav.abandonedCheckouts })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: en.nav.orders })).not.toHaveAttribute("aria-current");
});

it("Orders' sub-pages are Part 3's list (Part 4 inserts Drafts first)", () => {
  expect(PRIMARY_NAV.find((item) => item.id === "orders")?.children?.map((c) => c.id)).toEqual([
    "abandoned-checkouts",
  ]);
});
```

Run: `pnpm --filter admin-web exec vitest run src/components/navigation.test.tsx`
Expected: FAIL — no link named "Abandoned checkouts".

- [ ] **Step 3: Give Orders its sub-page**

In `apps/admin-web/src/components/navigation.ts`, add `ShoppingCartIcon` to the `lucide-react` import and
replace the Orders entry with:

```ts
  {
    id: "orders",
    label: (t) => t.nav.orders,
    href: "/orders",
    Icon: ShoppingBagIcon,
    // Shopify's order under Orders: Drafts (order operations Part 4) then Abandoned checkouts.
    children: [
      {
        id: "abandoned-checkouts",
        label: (t) => t.nav.abandonedCheckouts,
        href: "/abandoned-checkouts",
        Icon: ShoppingCartIcon,
      },
    ],
  },
```

Run the navigation test again. Expected: PASS (the existing "Shopify's order" test still lists only the
top-level sections, because sub-pages show only while their section is current).

- [ ] **Step 4: Write the failing API-client tests**

`apps/admin-web/src/lib/api/abandoned-checkouts.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: vi.fn() }));

const { fetchAbandonedCheckout, fetchAbandonedCheckouts, issueRecoveryLink } =
  await import("./abandoned-checkouts");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("abandoned checkouts API client (order operations Part 3)", () => {
  it("lists with the search, recovery filter and cursor in the query", async () => {
    const page = { items: [], pageInfo: { hasNextPage: false, endCursor: null } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAbandonedCheckouts({
      first: 50,
      after: "c-1",
      q: "mona",
      recovery: "recovered",
    });
    expect(result).toEqual({ outcome: "ok", data: page });
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(
      /\/api\/v1\/abandoned-checkouts\?first=50&after=c-1&q=mona&recovery=recovered$/,
    );
  });

  it("omits an empty search", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await fetchAbandonedCheckouts({ q: "" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/v1\/abandoned-checkouts$/);
  });

  it("reads one checkout, and a 404 is not_found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND" })));
    expect(await fetchAbandonedCheckout("a b")).toEqual({ outcome: "not_found" });
  });

  it("issues a link with POST and the caller's idempotency key", async () => {
    const link = {
      url: null,
      path: "/c/tok",
      expiresAt: "2026-10-25T12:00:00.000Z",
      shopName: "Lumo",
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, link));
    vi.stubGlobal("fetch", fetchMock);

    expect(await issueRecoveryLink("cs-1", "key-1")).toEqual({ outcome: "ok", data: link });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/abandoned-checkouts\/cs-1\/recovery-link$/);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });

  it("an unexpected body shape is an error, never a half-read link", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, { path: 1 })));
    expect((await issueRecoveryLink("cs-1", "key-1")).outcome).toBe("error");
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/lib/api/abandoned-checkouts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Write the API client**

`apps/admin-web/src/lib/api/abandoned-checkouts.ts`:

```ts
import { getAdminApi, mutateAdminApi, type ApiResult, type MutationResult } from "./client";

/** Order operations Part 3 — the wire shapes of `apps/admin`'s `abandoned-checkout-dto.ts`. */
export type AbandonedRecoveryStatus = "not_recovered" | "recovered";

export interface AbandonedCheckoutListItemDto {
  readonly id: string;
  readonly reference: string;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly customerName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly region: string | null;
  readonly country: string | null;
  readonly itemCount: number;
  readonly totalMinor: number;
  readonly currency: string;
  readonly recoveryStatus: AbandonedRecoveryStatus;
  readonly recoveredOrder: { readonly id: string; readonly orderNumber: string | null } | null;
  readonly lastLinkIssuedAt: string | null;
}

export interface AbandonedCheckoutLineDto {
  readonly productId: string;
  readonly variantId: string | null;
  readonly title: string | null;
  readonly variantTitle: string | null;
  readonly sku: string | null;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly imageUrl: string | null;
}

export interface AbandonedCheckoutTotalsDto {
  readonly subtotalMinor: number;
  readonly shippingMinor: number;
  readonly taxMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  readonly taxIncluded: boolean;
}

export interface AbandonedCheckoutAddressDto {
  readonly name: string | null;
  readonly phone: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly province: string | null;
  readonly postalCode: string;
  readonly country: string;
}

export interface AbandonedCheckoutLinkDto {
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly claimCount: number;
  readonly lastClaimedAt: string | null;
}

export interface AbandonedCheckoutDetailDto extends AbandonedCheckoutListItemDto {
  readonly items: readonly AbandonedCheckoutLineDto[];
  readonly totals: AbandonedCheckoutTotalsDto | null;
  readonly shippingAddress: AbandonedCheckoutAddressDto | null;
  readonly links: readonly AbandonedCheckoutLinkDto[];
}

export interface AbandonedCheckoutsPageDto {
  readonly items: readonly AbandonedCheckoutListItemDto[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
}

export interface AbandonedCheckoutsQuery {
  readonly first?: number;
  readonly after?: string;
  readonly q?: string;
  readonly recovery?: AbandonedRecoveryStatus;
}

export interface RecoveryLinkDto {
  readonly url: string | null;
  readonly path: string;
  readonly expiresAt: string;
  readonly shopName: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPage(value: unknown): value is AbandonedCheckoutsPageDto {
  return isObject(value) && Array.isArray(value["items"]) && isObject(value["pageInfo"]);
}

function isDetail(value: unknown): value is AbandonedCheckoutDetailDto {
  return (
    isObject(value) &&
    typeof value["id"] === "string" &&
    Array.isArray(value["items"]) &&
    Array.isArray(value["links"])
  );
}

function isRecoveryLink(value: unknown): value is RecoveryLinkDto {
  return (
    isObject(value) &&
    typeof value["path"] === "string" &&
    (value["url"] === null || typeof value["url"] === "string") &&
    typeof value["expiresAt"] === "string" &&
    typeof value["shopName"] === "string"
  );
}

const basePath = "/api/v1/abandoned-checkouts";
const checkoutPath = (id: string, suffix = "") => `${basePath}/${encodeURIComponent(id)}${suffix}`;

/** `GET /abandoned-checkouts` (`orders:read`). Server code only. */
export function fetchAbandonedCheckouts(
  query: AbandonedCheckoutsQuery,
): Promise<ApiResult<AbandonedCheckoutsPageDto>> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);
  if (query.q !== undefined && query.q !== "") params.set("q", query.q);
  if (query.recovery !== undefined) params.set("recovery", query.recovery);
  const search = params.toString();
  return getAdminApi(search === "" ? basePath : `${basePath}?${search}`, isPage);
}

/** `GET /abandoned-checkouts/:id` (`orders:read`). */
export function fetchAbandonedCheckout(id: string): Promise<ApiResult<AbandonedCheckoutDetailDto>> {
  return getAdminApi(checkoutPath(id), isDetail);
}

/** `POST /abandoned-checkouts/:id/recovery-link` (`orders:recover_checkout`, idempotent). A new link every call. */
export function issueRecoveryLink(
  id: string,
  idempotencyKey: string,
): Promise<MutationResult<RecoveryLinkDto>> {
  return mutateAdminApi(
    checkoutPath(id, "/recovery-link"),
    { method: "POST", idempotencyKey },
    isRecoveryLink,
  );
}
```

Run the API test, then `pnpm --filter admin-web exec vitest run src/lib/api/route-contract.test.ts`
Expected: PASS — the route-contract test finds all three paths in `abandoned-checkout-routes.ts`.

- [ ] **Step 6: Write the failing view-logic tests**

`apps/admin-web/src/lib/orders/abandoned-checkouts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  abandonedTimeline,
  canRecoverCheckout,
  parseRecoveryFilter,
  placedByLabel,
  recoveryLinkHref,
} from "./abandoned-checkouts";

describe("abandoned checkouts view logic (order operations Part 3)", () => {
  it("only operators and admins may send recovery links", () => {
    expect(canRecoverCheckout("admin")).toBe(true);
    expect(canRecoverCheckout("operator")).toBe(true);
    expect(canRecoverCheckout("viewer")).toBe(false);
    expect(canRecoverCheckout(undefined)).toBe(false);
  });

  it("reads the recovery filter from the URL, ignoring anything else", () => {
    expect(parseRecoveryFilter("recovered")).toBe("recovered");
    expect(parseRecoveryFilter("not_recovered")).toBe("not_recovered");
    expect(parseRecoveryFilter("all")).toBeUndefined();
    expect(parseRecoveryFilter(undefined)).toBeUndefined();
  });

  it("'Placed by' is the recipient's name, else the email, else the phone", () => {
    expect(placedByLabel({ customerName: "Mona", email: "m@x.co", phone: "010" })).toBe("Mona");
    expect(placedByLabel({ customerName: null, email: "m@x.co", phone: "010" })).toBe("m@x.co");
    expect(placedByLabel({ customerName: null, email: null, phone: "010" })).toBe("010");
    expect(placedByLabel({ customerName: null, email: null, phone: null })).toBeNull();
  });

  it("the link is the API's URL, else STOREFRONT_URL + path, else none", () => {
    expect(
      recoveryLinkHref({ url: "https://www.sara.shop/c/t", path: "/c/t" }, "https://x.test"),
    ).toBe("https://www.sara.shop/c/t");
    expect(recoveryLinkHref({ url: null, path: "/c/t" }, "https://shop.example/")).toBe(
      "https://shop.example/c/t",
    );
    expect(recoveryLinkHref({ url: null, path: "/c/t" }, "  ")).toBeNull();
    expect(recoveryLinkHref({ url: null, path: "/c/t" }, null)).toBeNull();
  });

  it("the timeline is newest first, with the recovery on top", () => {
    const events = abandonedTimeline({
      createdAt: "2026-10-18T09:00:00.000Z",
      lastActivityAt: "2026-10-18T09:20:00.000Z",
      links: [
        {
          issuedAt: "2026-10-18T12:00:00.000Z",
          expiresAt: "x",
          claimCount: 2,
          lastClaimedAt: "2026-10-18T13:00:00.000Z",
        },
        {
          issuedAt: "2026-10-18T11:00:00.000Z",
          expiresAt: "x",
          claimCount: 0,
          lastClaimedAt: null,
        },
      ],
      recoveredOrder: { id: "order-9", orderNumber: "1007" },
    });
    expect(events.map((event) => [event.kind, event.at])).toEqual([
      ["recovered", null],
      ["link_opened", "2026-10-18T13:00:00.000Z"],
      ["link_issued", "2026-10-18T12:00:00.000Z"],
      ["link_issued", "2026-10-18T11:00:00.000Z"],
      ["last_activity", "2026-10-18T09:20:00.000Z"],
      ["started", "2026-10-18T09:00:00.000Z"],
    ]);
    expect(events[1]?.count).toBe(2);
    expect(events[0]?.orderNumber).toBe("1007");
  });

  it("no separate 'last activity' when nothing happened after the start", () => {
    const events = abandonedTimeline({
      createdAt: "2026-10-18T09:00:00.000Z",
      lastActivityAt: "2026-10-18T09:00:00.000Z",
      links: [],
      recoveredOrder: null,
    });
    expect(events.map((event) => event.kind)).toEqual(["started"]);
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/lib/orders/abandoned-checkouts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Write the view logic**

`apps/admin-web/src/lib/orders/abandoned-checkouts.ts`:

```ts
import type {
  AbandonedCheckoutDetailDto,
  AbandonedCheckoutListItemDto,
  AbandonedRecoveryStatus,
} from "@/lib/api/abandoned-checkouts";

/** Shopify's page size; the API's maximum too. */
export const ABANDONED_PAGE_SIZE = 50;

export function parseRecoveryFilter(raw: string | undefined): AbandonedRecoveryStatus | undefined {
  return raw === "recovered" || raw === "not_recovered" ? raw : undefined;
}

/** Shopify's "Placed by": the recipient's name, else the email, else the phone. */
export function placedByLabel(
  item: Pick<AbandonedCheckoutListItemDto, "customerName" | "email" | "phone">,
): string | null {
  return item.customerName ?? item.email ?? item.phone;
}

/** `orders:recover_checkout` is held by operators and admins (the API decides; this only hides buttons). */
export function canRecoverCheckout(role: string | undefined): boolean {
  return role === "admin" || role === "operator";
}

/** The API's absolute URL (the shop's own domain), else `STOREFRONT_URL` + the path, else none. */
export function recoveryLinkHref(
  link: { readonly url: string | null; readonly path: string },
  storefrontUrl: string | null,
): string | null {
  if (link.url !== null) return link.url;
  const base = storefrontUrl?.trim().replace(/\/+$/, "") ?? "";
  return base === "" ? null : `${base}${link.path}`;
}

export type AbandonedTimelineKind =
  "started" | "last_activity" | "link_issued" | "link_opened" | "recovered";

export interface AbandonedTimelineEvent {
  readonly key: string;
  readonly kind: AbandonedTimelineKind;
  /** ISO time; null for "recovered" (the order page has the time). */
  readonly at: string | null;
  readonly count?: number;
  readonly orderId?: string;
  readonly orderNumber?: string | null;
}

/** The detail page's small timeline (spec §3.7): newest first, the recovery (when any) on top. */
export function abandonedTimeline(
  detail: Pick<
    AbandonedCheckoutDetailDto,
    "createdAt" | "lastActivityAt" | "links" | "recoveredOrder"
  >,
): AbandonedTimelineEvent[] {
  const dated: AbandonedTimelineEvent[] = [
    { key: "started", kind: "started", at: detail.createdAt },
  ];
  if (detail.lastActivityAt !== detail.createdAt) {
    dated.push({ key: "last-activity", kind: "last_activity", at: detail.lastActivityAt });
  }
  detail.links.forEach((link, index) => {
    dated.push({ key: `link-${index}`, kind: "link_issued", at: link.issuedAt });
    if (link.claimCount > 0 && link.lastClaimedAt !== null) {
      dated.push({
        key: `opened-${index}`,
        kind: "link_opened",
        at: link.lastClaimedAt,
        count: link.claimCount,
      });
    }
  });
  // ISO-8601 instants in UTC sort as strings.
  dated.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  const recovered = detail.recoveredOrder;
  return recovered === null
    ? dated
    : [
        {
          key: "recovered",
          kind: "recovered",
          at: null,
          orderId: recovered.id,
          orderNumber: recovered.orderNumber,
        },
        ...dated,
      ];
}
```

Run the test again. Expected: PASS.

- [ ] **Step 8: Write the failing table and filter tests**

`apps/admin-web/src/components/abandoned-checkouts/abandoned-checkouts-table.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { AbandonedCheckoutListItemDto } from "@/lib/api/abandoned-checkouts";
import { formatCurrency } from "@/lib/format";
import { en } from "@/messages/en";
import { AbandonedCheckoutsTable } from "./abandoned-checkouts-table";

function row(overrides: Partial<AbandonedCheckoutListItemDto> = {}): AbandonedCheckoutListItemDto {
  return {
    id: "01920000-0000-7000-8000-00000000abcd",
    reference: "#0000ABCD",
    createdAt: "2026-10-18T09:00:00.000Z",
    lastActivityAt: "2026-10-18T09:20:00.000Z",
    customerName: "Mona Ali",
    email: "sara@example.com",
    phone: "01001234567",
    region: "EG-C",
    country: "EG",
    itemCount: 2,
    totalMinor: 50000,
    currency: "EGP",
    recoveryStatus: "not_recovered",
    recoveredOrder: null,
    lastLinkIssuedAt: null,
    ...overrides,
  };
}

describe("AbandonedCheckoutsTable (Shopify's columns)", () => {
  it("shows the columns in Shopify's order", () => {
    render(<AbandonedCheckoutsTable checkouts={[row()]} t={en} locale="en" />);
    const c = en.abandonedCheckouts.columns;
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      c.checkout,
      c.date,
      c.placedBy,
      c.region,
      c.recoveryLink,
      c.recoveryStatus,
      c.total,
    ]);
  });

  it("a not-recovered, never-shared row", () => {
    render(<AbandonedCheckoutsTable checkouts={[row()]} t={en} locale="en" />);
    expect(screen.getByRole("link", { name: "#0000ABCD" })).toHaveAttribute(
      "href",
      "/abandoned-checkouts/01920000-0000-7000-8000-00000000abcd",
    );
    expect(screen.getByText("Mona Ali")).toHaveAttribute("dir", "auto");
    expect(screen.getByText(en.abandonedCheckouts.notShared)).toBeInTheDocument();
    expect(screen.getByText(en.abandonedCheckouts.notRecovered)).toBeInTheDocument();
    expect(screen.getByText(formatCurrency("en", 50000, "EGP"))).toBeInTheDocument();
  });

  it("a shared and recovered row links its order", () => {
    render(
      <AbandonedCheckoutsTable
        checkouts={[
          row({
            customerName: null,
            lastLinkIssuedAt: "2026-10-18T12:00:00.000Z",
            recoveryStatus: "recovered",
            recoveredOrder: { id: "order-9", orderNumber: "1007" },
          }),
        ]}
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByText("sara@example.com")).toBeInTheDocument();
    expect(screen.getByText("Shared Oct 18")).toBeInTheDocument();
    const recovered = screen.getByRole("link", { name: en.abandonedCheckouts.recovered });
    expect(recovered).toHaveAttribute("href", "/orders/order-9");
  });

  it("an anonymous row without a region still renders", () => {
    render(
      <AbandonedCheckoutsTable
        checkouts={[row({ customerName: null, email: null, phone: null, region: null })]}
        t={en}
        locale="en"
      />,
    );
    const cells = within(screen.getAllByRole("row")[1] as HTMLElement).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent(en.abandonedCheckouts.unknownCustomer);
    expect(cells[3]).toHaveTextContent(en.abandonedCheckouts.noRegion);
  });
});
```

`apps/admin-web/src/components/abandoned-checkouts/abandoned-checkouts-filters.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { AbandonedCheckoutsFilters } from "./abandoned-checkouts-filters";

describe("AbandonedCheckoutsFilters", () => {
  it("is a GET search form that keeps the current search and filter", () => {
    render(<AbandonedCheckoutsFilters q="mona" recovery="recovered" t={en} />);
    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/abandoned-checkouts");
    expect(screen.getByRole("searchbox", { name: en.abandonedCheckouts.searchLabel })).toHaveValue(
      "mona",
    );
    expect(
      screen.getByRole("combobox", { name: en.abandonedCheckouts.recoveryFilterLabel }),
    ).toHaveValue("recovered");
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/components/abandoned-checkouts`
Expected: FAIL — modules not found.

- [ ] **Step 9: Write the table and the filters**

`apps/admin-web/src/components/abandoned-checkouts/abandoned-checkouts-table.tsx`:

```tsx
import Link from "next/link";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { AbandonedCheckoutListItemDto } from "@/lib/api/abandoned-checkouts";
import { formatCurrency, formatShortDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { placedByLabel } from "@/lib/orders/abandoned-checkouts";
import type { Dictionary } from "@/messages/en";

/** Shopify's abandoned-checkouts table. Server-renderable: receives DTOs, imports no API code. */
export function AbandonedCheckoutsTable({
  checkouts,
  t,
  locale,
}: {
  readonly checkouts: readonly AbandonedCheckoutListItemDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const a = t.abandonedCheckouts;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{a.columns.checkout}</TableHead>
          <TableHead>{a.columns.date}</TableHead>
          <TableHead>{a.columns.placedBy}</TableHead>
          <TableHead>{a.columns.region}</TableHead>
          <TableHead>{a.columns.recoveryLink}</TableHead>
          <TableHead>{a.columns.recoveryStatus}</TableHead>
          <TableHead className="text-end">{a.columns.total}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {checkouts.map((checkout) => (
          <TableRow key={checkout.id}>
            <TableCell>
              <Link
                href={`/abandoned-checkouts/${encodeURIComponent(checkout.id)}`}
                className="font-medium hover:underline"
              >
                {checkout.reference}
              </Link>
            </TableCell>
            <TableCell>{formatShortDate(locale, checkout.createdAt)}</TableCell>
            <TableCell>
              <span dir="auto">{placedByLabel(checkout) ?? a.unknownCustomer}</span>
            </TableCell>
            <TableCell>{checkout.region ?? a.noRegion}</TableCell>
            <TableCell>
              {checkout.lastLinkIssuedAt === null
                ? a.notShared
                : a.shared.replace("{date}", () =>
                    formatShortDate(locale, checkout.lastLinkIssuedAt ?? ""),
                  )}
            </TableCell>
            <TableCell>
              {checkout.recoveredOrder !== null ? (
                <Link href={`/orders/${encodeURIComponent(checkout.recoveredOrder.id)}`}>
                  <Badge variant="success">{a.recovered}</Badge>
                </Link>
              ) : (
                <Badge variant="neutral">{a.notRecovered}</Badge>
              )}
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {formatCurrency(locale, checkout.totalMinor, checkout.currency)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

`apps/admin-web/src/components/abandoned-checkouts/abandoned-checkouts-filters.tsx`:

```tsx
import { SearchIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import type { AbandonedRecoveryStatus } from "@/lib/api/abandoned-checkouts";
import type { Dictionary } from "@/messages/en";

/**
 * Search ("Search by email, name or phone") and the Recovery status filter. A plain GET form: the URL
 * holds the state (shareable, back-button safe) and no client JavaScript is needed; submitting drops
 * the cursor, so a new search starts on page one.
 */
export function AbandonedCheckoutsFilters({
  q,
  recovery,
  t,
}: {
  readonly q: string | undefined;
  readonly recovery: AbandonedRecoveryStatus | undefined;
  readonly t: Dictionary;
}) {
  const a = t.abandonedCheckouts;
  return (
    <form
      role="search"
      method="get"
      action="/abandoned-checkouts"
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex min-w-60 flex-1 flex-col gap-1.5">
        <Label htmlFor="abandoned-search" className="sr-only">
          {a.searchLabel}
        </Label>
        <Input
          id="abandoned-search"
          type="search"
          name="q"
          dir="auto"
          defaultValue={q ?? ""}
          placeholder={a.searchPlaceholder}
          aria-label={a.searchLabel}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="abandoned-recovery">{a.recoveryFilterLabel}</Label>
        <select
          id="abandoned-recovery"
          name="recovery"
          defaultValue={recovery ?? ""}
          className="border-input bg-card text-foreground h-9 rounded-xl border px-3.5 text-base"
        >
          <option value="">{a.recoveryFilterAll}</option>
          <option value="not_recovered">{a.notRecovered}</option>
          <option value="recovered">{a.recovered}</option>
        </select>
      </div>
      <Button type="submit" variant="outline">
        <SearchIcon aria-hidden="true" />
        {a.search}
      </Button>
    </form>
  );
}
```

Run the component tests again. Expected: PASS.

- [ ] **Step 10: Write the list page**

`apps/admin-web/src/app/abandoned-checkouts/page.tsx`:

```tsx
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { AlertTriangleIcon, LockIcon, SearchXIcon, ShoppingCartIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { AbandonedCheckoutsFilters } from "@/components/abandoned-checkouts/abandoned-checkouts-filters";
import { AbandonedCheckoutsTable } from "@/components/abandoned-checkouts/abandoned-checkouts-table";
import { AppShell } from "@/components/app-shell";
import { OrdersPagination } from "@/components/orders/orders-pagination";
import { fetchAbandonedCheckouts } from "@/lib/api/abandoned-checkouts";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { ABANDONED_PAGE_SIZE, parseRecoveryFilter } from "@/lib/orders/abandoned-checkouts";

interface AbandonedCheckoutsPageProps {
  readonly searchParams: Promise<{
    readonly q?: string;
    readonly recovery?: string;
    readonly after?: string;
  }>;
}

/**
 * Orders → Abandoned checkouts (order operations Part 3, Shopify's screen): checkouts customers left
 * after entering an email or phone, an hour after their last activity, and the recovered ones.
 */
export default async function AbandonedCheckoutsPage({
  searchParams,
}: AbandonedCheckoutsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const a = t.abandonedCheckouts;
  const user = await getCurrentUser();
  const params = await searchParams;
  const q = params.q?.trim() || undefined;
  const recovery = parseRecoveryFilter(params.recovery);
  const filtered = q !== undefined || recovery !== undefined;
  const result = await fetchAbandonedCheckouts({
    first: ABANDONED_PAGE_SIZE,
    after: params.after,
    q,
    recovery,
  });

  let content: ReactNode;
  if (result.outcome === "unauthorized") {
    content = (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={a.unauthorized}
      />
    );
  } else if (result.outcome !== "ok") {
    content = (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={a.error}
      />
    );
  } else if (result.data.items.length === 0) {
    content = filtered ? (
      <StatePanel
        icon={<SearchXIcon aria-hidden="true" className="size-5" />}
        message={a.emptyFiltered}
      />
    ) : (
      <StatePanel
        icon={<ShoppingCartIcon aria-hidden="true" className="size-5" />}
        message={a.empty}
        detail={a.emptyBody}
      />
    );
  } else {
    content = (
      <Card>
        <CardContent className="p-0 sm:p-0">
          <AbandonedCheckoutsTable checkouts={result.data.items} t={t} locale={locale} />
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
    <AppShell t={t} locale={locale} activeNavId="abandoned-checkouts" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{a.title}</h1>
        </header>
        <AbandonedCheckoutsFilters q={q} recovery={recovery} t={t} />
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

- [ ] **Step 11: Package checks**

Run: `pnpm --filter admin-web typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint && pnpm --filter admin-web test`
Expected: all green (including `route-contract.test.ts`).

- [ ] **Step 12: Commit**

```bash
git add apps/admin-web/src/components/navigation.ts apps/admin-web/src/components/navigation.test.tsx \
  apps/admin-web/src/lib/api/abandoned-checkouts.ts apps/admin-web/src/lib/api/abandoned-checkouts.test.ts \
  apps/admin-web/src/lib/orders/abandoned-checkouts.ts apps/admin-web/src/lib/orders/abandoned-checkouts.test.ts \
  apps/admin-web/src/components/abandoned-checkouts/abandoned-checkouts-table.tsx \
  apps/admin-web/src/components/abandoned-checkouts/abandoned-checkouts-table.test.tsx \
  apps/admin-web/src/components/abandoned-checkouts/abandoned-checkouts-filters.tsx \
  apps/admin-web/src/components/abandoned-checkouts/abandoned-checkouts-filters.test.tsx \
  apps/admin-web/src/app/abandoned-checkouts/page.tsx \
  apps/admin-web/src/messages/en.ts apps/admin-web/src/messages/ar.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin-web): abandoned checkouts list under orders

Orders gets its Abandoned checkouts sub-page (Shopify's placement): search by email, name or
phone, a recovery status filter, Shopify's columns (checkout, date, placed by, region,
recovery link, recovery status, total) and cursor pagination, in English and Arabic.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: admin-web — the abandoned checkout page, Copy recovery link and Share on WhatsApp

Model tier: **standard** (the phone-number rules and the clipboard fallback are spelled out as tests).

**Files:**

- Create: `apps/admin-web/src/lib/whatsapp.ts`, `apps/admin-web/src/lib/whatsapp.test.ts`
- Create: `apps/admin-web/src/app/abandoned-checkouts/actions.ts`, `apps/admin-web/src/app/abandoned-checkouts/actions.test.ts`
- Create: `apps/admin-web/src/components/abandoned-checkouts/recovery-card.tsx`, `recovery-card.test.tsx`
- Create: `apps/admin-web/src/components/abandoned-checkouts/abandoned-checkout-timeline.tsx`, `abandoned-checkout-timeline.test.tsx`
- Create: `apps/admin-web/src/app/abandoned-checkouts/[checkoutId]/page.tsx`

**Interfaces:**

- Consumes: Task 6 `fetchAbandonedCheckout`, `issueRecoveryLink`, `AbandonedCheckoutDetailDto`, `RecoveryLinkDto`, `canRecoverCheckout`, `recoveryLinkHref`, `abandonedTimeline`, the `abandonedCheckouts` dictionary; `newIdempotencyKey` (`lib/api/mutation.ts`); `formatCurrency`, `formatDateTime`; `readSession`, `highestRole`, `getCurrentUser`.
- Produces:
  - `lib/whatsapp.ts`: `WHATSAPP_CALLING_CODES` (EG 20, SA 966, AE 971, KW 965, QA 974, BH 973, OM 968, JO 962), `toWhatsAppDigits(phone: string | null, country: string | null): string | null`, `whatsAppUrl(digits: string | null, text: string): string`, `fillTemplate(template: string, values: Readonly<Record<string, string>>): string`.
  - `app/abandoned-checkouts/actions.ts` (`"use server"`): `type RecoveryLinkActionResult = { ok: true; url: string; shopName: string } | { ok: false; message: string }`, `issueRecoveryLinkAction(checkoutId: string): Promise<RecoveryLinkActionResult>`.
  - `RecoveryCard({ checkoutId, customerName, phone, country, canRecover, t })` (client), `AbandonedCheckoutTimeline({ detail, t, locale })`.
  - Route `/abandoned-checkouts/[checkoutId]` (`activeNavId="abandoned-checkouts"`).

- [ ] **Step 1: Write the failing WhatsApp tests**

`apps/admin-web/src/lib/whatsapp.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fillTemplate, toWhatsAppDigits, whatsAppUrl } from "./whatsapp";

describe("toWhatsAppDigits (spec §3.7; Review Focus 1)", () => {
  it.each([
    ["01001234567", "EG", "201001234567"],
    ["0100 123 4567", "EG", "201001234567"],
    ["1001234567", "EG", "201001234567"],
    ["201001234567", "EG", "201001234567"],
    ["+20 100 123 4567", "EG", "201001234567"],
    ["+20 (100) 123-4567", null, "201001234567"],
    ["00971501234567", "AE", "971501234567"],
    ["0501234567", "SA", "966501234567"],
    ["٠١٠٠١٢٣٤٥٦٧", "EG", "201001234567"],
    ["۰۵۰۱۲۳۴۵۶۷", "SA", "966501234567"],
    ["0791234567", "jo", "962791234567"],
  ])("%s in %s → %s", (phone, country, expected) => {
    expect(toWhatsAppDigits(phone, country)).toBe(expected);
  });

  it.each([
    [null, "EG"],
    ["0123", "EG"],
    ["01001234567", "US"],
    ["01001234567", null],
    ["+1234567890123456", null],
  ])("%s in %s is unusable → null (WhatsApp's chat picker opens instead)", (phone, country) => {
    expect(toWhatsAppDigits(phone, country)).toBeNull();
  });
});

describe("whatsAppUrl", () => {
  it("opens the customer's chat with the encoded text", () => {
    expect(whatsAppUrl("201001234567", "Hi Mona & co: https://x.shop/c/a?b")).toBe(
      "https://wa.me/201001234567?text=Hi%20Mona%20%26%20co%3A%20https%3A%2F%2Fx.shop%2Fc%2Fa%3Fb",
    );
  });

  it("without a number, lets the merchant pick the chat", () => {
    expect(whatsAppUrl(null, "مرحبا")).toBe(`https://wa.me/?text=${encodeURIComponent("مرحبا")}`);
  });
});

describe("fillTemplate", () => {
  it("fills every placeholder, leaves unknown ones, and never expands $ patterns", () => {
    expect(
      fillTemplate("Hi {name} from {shop}: {url} {other}", {
        name: "Mona $&",
        shop: "Sara",
        url: "u",
      }),
    ).toBe("Hi Mona $& from Sara: u {other}");
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/lib/whatsapp.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Write `lib/whatsapp.ts`**

```ts
/**
 * Order operations Part 3 — sharing a recovery link through the merchant's own WhatsApp with a
 * `wa.me` deep link (spec §3.7, no WhatsApp Business API). Pure; safe in client components.
 */

/** Calling codes for the shop's markets (spec §3.7). */
export const WHATSAPP_CALLING_CODES: Readonly<Record<string, string>> = {
  EG: "20",
  SA: "966",
  AE: "971",
  KW: "965",
  QA: "974",
  BH: "973",
  OM: "968",
  JO: "962",
};

/** E.164 allows at most 15 digits; fewer than 8 is not a reachable mobile in these markets. */
const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

/** Arabic-Indic (U+0660–0669) and Persian (U+06F0–06F9) digits to ASCII. */
function asciiDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * The digits `wa.me` wants (country code + national number, no `+`). A number written
 * internationally (`+20…`, `0020…`) is used as written; a national one (`010…`, `10…`) gets the
 * shipping country's calling code, its national leading `0` dropped. Null when it cannot be made
 * usable — the caller then opens WhatsApp's chat picker instead of a wrong chat.
 */
export function toWhatsAppDigits(phone: string | null, country: string | null): string | null {
  if (phone === null) return null;
  const raw = asciiDigits(phone).trim();
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else {
    const code = country === null ? undefined : WHATSAPP_CALLING_CODES[country.toUpperCase()];
    if (code === undefined) return null;
    if (digits.startsWith("0")) digits = `${code}${digits.slice(1)}`;
    else if (!digits.startsWith(code)) digits = `${code}${digits}`;
  }
  return digits.length >= MIN_DIGITS && digits.length <= MAX_DIGITS ? digits : null;
}

export function whatsAppUrl(digits: string | null, text: string): string {
  const query = `text=${encodeURIComponent(text)}`;
  return digits === null ? `https://wa.me/?${query}` : `https://wa.me/${digits}?${query}`;
}

/** `{name}`-style placeholders; a function replacer, so `$&` in a value stays literal. */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
```

Run the test again. Expected: PASS.

- [ ] **Step 3: Write the failing server-action tests**

`apps/admin-web/src/app/abandoned-checkouts/actions.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/messages/en";

const api = vi.hoisted(() => ({ issueRecoveryLink: vi.fn() }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/abandoned-checkouts", () => ({ issueRecoveryLink: api.issueRecoveryLink }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const { issueRecoveryLinkAction } = await import("./actions");

const ID = "01920000-0000-7000-8000-00000000abcd";
const r = en.abandonedCheckouts.recovery;
const link = (url: string | null) => ({
  outcome: "ok",
  data: { url, path: "/c/tok", expiresAt: "2026-10-25T12:00:00.000Z", shopName: "Sara Shop" },
});

beforeEach(() => {
  vi.stubEnv("STOREFRONT_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("issueRecoveryLinkAction (order operations Part 3)", () => {
  it("answers the API's URL and the shop name, and refreshes the pages", async () => {
    api.issueRecoveryLink.mockResolvedValue(link("https://www.sara.shop/c/tok"));
    expect(await issueRecoveryLinkAction(ID)).toEqual({
      ok: true,
      url: "https://www.sara.shop/c/tok",
      shopName: "Sara Shop",
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/abandoned-checkouts/${ID}`);
  });

  it("falls back to STOREFRONT_URL + path when the shop has no domain", async () => {
    vi.stubEnv("STOREFRONT_URL", "https://shop.example/");
    api.issueRecoveryLink.mockResolvedValue(link(null));
    expect(await issueRecoveryLinkAction(ID)).toMatchObject({
      ok: true,
      url: "https://shop.example/c/tok",
    });
  });

  it("says so when there is no address at all", async () => {
    api.issueRecoveryLink.mockResolvedValue(link(null));
    expect(await issueRecoveryLinkAction(ID)).toEqual({ ok: false, message: r.noStoreAddress });
  });

  it("one fresh idempotency key per press", async () => {
    api.issueRecoveryLink.mockResolvedValue(link("https://x.shop/c/tok"));
    await issueRecoveryLinkAction(ID);
    await issueRecoveryLinkAction(ID);
    const keys = api.issueRecoveryLink.mock.calls.map((call) => call[1] as string);
    expect(keys[0]).not.toBe(keys[1]);
    expect(api.issueRecoveryLink.mock.calls[0]?.[0]).toBe(ID);
  });

  it("maps refusals to the merchant's words", async () => {
    api.issueRecoveryLink.mockResolvedValueOnce({ outcome: "forbidden" });
    expect(await issueRecoveryLinkAction(ID)).toEqual({ ok: false, message: r.forbidden });
    api.issueRecoveryLink.mockResolvedValueOnce({
      outcome: "conflict",
      message: "ALREADY_RECOVERED: x",
    });
    expect(await issueRecoveryLinkAction(ID)).toEqual({ ok: false, message: r.alreadyRecovered });
    api.issueRecoveryLink.mockResolvedValueOnce({ outcome: "error", message: "boom" });
    expect(await issueRecoveryLinkAction(ID)).toEqual({ ok: false, message: r.error });
  });

  it("refuses a malformed id without calling the API (the browser can send anything)", async () => {
    expect(await issueRecoveryLinkAction("../../orders")).toEqual({ ok: false, message: r.error });
    expect(api.issueRecoveryLink).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/app/abandoned-checkouts/actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the server action**

`apps/admin-web/src/app/abandoned-checkouts/actions.ts`:

```ts
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { issueRecoveryLink } from "@/lib/api/abandoned-checkouts";
import { newIdempotencyKey } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { recoveryLinkHref } from "@/lib/orders/abandoned-checkouts";

export type RecoveryLinkActionResult =
  | { readonly ok: true; readonly url: string; readonly shopName: string }
  | { readonly ok: false; readonly message: string };

const CHECKOUT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Order operations Part 3 — "Copy recovery link" and "Share on WhatsApp" both start here: a NEW link
 * per press (one idempotency key per press), its absolute URL (the shop's domain, else
 * `STOREFRONT_URL`), and the shop name for the WhatsApp text. The API decides the permission.
 */
export async function issueRecoveryLinkAction(
  checkoutId: string,
): Promise<RecoveryLinkActionResult> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const r = dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE).abandonedCheckouts.recovery;
  if (typeof checkoutId !== "string" || !CHECKOUT_ID.test(checkoutId)) {
    return { ok: false, message: r.error };
  }
  const result = await issueRecoveryLink(checkoutId, newIdempotencyKey());
  if (result.outcome !== "ok") {
    const message =
      result.outcome === "forbidden" || result.outcome === "unauthorized"
        ? r.forbidden
        : result.outcome === "conflict"
          ? r.alreadyRecovered
          : r.error;
    return { ok: false, message };
  }
  const url = recoveryLinkHref(result.data, process.env["STOREFRONT_URL"] ?? null);
  if (url === null) return { ok: false, message: r.noStoreAddress };
  revalidatePath(`/abandoned-checkouts/${checkoutId}`);
  revalidatePath("/abandoned-checkouts");
  return { ok: true, url, shopName: result.data.shopName };
}
```

Run the action test again. Expected: PASS.

- [ ] **Step 5: Write the failing recovery-card tests**

`apps/admin-web/src/components/abandoned-checkouts/recovery-card.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "@/messages/en";

const issueRecoveryLinkAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/abandoned-checkouts/actions", () => ({ issueRecoveryLinkAction }));

const { RecoveryCard } = await import("./recovery-card");

const r = en.abandonedCheckouts.recovery;
const URL = "https://www.sara.shop/c/tok";

function renderCard(overrides: Partial<Parameters<typeof RecoveryCard>[0]> = {}) {
  return render(
    <RecoveryCard
      checkoutId="cs-1"
      customerName="Mona"
      phone="01001234567"
      country="EG"
      canRecover
      t={en}
      {...overrides}
    />,
  );
}

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(writeText) },
    configurable: true,
  });
}

beforeEach(() => {
  issueRecoveryLinkAction.mockResolvedValue({ ok: true, url: URL, shopName: "Sara Shop" });
});

afterEach(() => {
  vi.restoreAllMocks();
  issueRecoveryLinkAction.mockReset();
});

describe("RecoveryCard (order operations Part 3)", () => {
  it("copies a fresh link, shows it, and says Copied", async () => {
    stubClipboard(async () => undefined);
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: r.copy }));
    expect(await screen.findByRole("button", { name: r.copied })).toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(URL);
    expect(screen.getByLabelText(r.linkLabel)).toHaveValue(URL);
    expect(issueRecoveryLinkAction).toHaveBeenCalledWith("cs-1");
  });

  it("shows the link when the clipboard is refused, and never says Copied (Review Focus 3)", async () => {
    stubClipboard(async () => {
      throw new Error("NotAllowedError");
    });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: r.copy }));
    expect(await screen.findByLabelText(r.linkLabel)).toHaveValue(URL);
    expect(screen.queryByRole("button", { name: r.copied })).toBeNull();
    expect(screen.getByRole("button", { name: r.copy })).toBeInTheDocument();
  });

  it("shares on WhatsApp with an editable message, to the customer's own chat", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: r.whatsapp }));
    const message = (await screen.findByLabelText(r.messageLabel)) as HTMLTextAreaElement;
    expect(message.value).toBe(
      "Hi Mona, we noticed you didn't finish your order from Sara Shop. You can complete it here: " +
        URL,
    );
    fireEvent.change(message, { target: { value: `Mona, here: ${URL}` } });
    fireEvent.click(screen.getByRole("button", { name: r.openWhatsApp }));
    expect(open).toHaveBeenCalledWith(
      `https://wa.me/201001234567?text=${encodeURIComponent(`Mona, here: ${URL}`)}`,
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("without a name or a usable phone: the nameless greeting and WhatsApp's chat picker", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderCard({ customerName: null, phone: null });
    fireEvent.click(screen.getByRole("button", { name: r.whatsapp }));
    const message = (await screen.findByLabelText(r.messageLabel)) as HTMLTextAreaElement;
    expect(message.value.startsWith("Hi, we noticed")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: r.openWhatsApp }));
    expect(open.mock.calls[0]?.[0]).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });

  it("shows the server's refusal and no link", async () => {
    issueRecoveryLinkAction.mockResolvedValue({ ok: false, message: r.forbidden });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: r.copy }));
    expect(await screen.findByRole("alert")).toHaveTextContent(r.forbidden);
    expect(screen.queryByLabelText(r.linkLabel)).toBeNull();
  });

  it("a viewer sees no recovery buttons, only the coming-soon note", async () => {
    renderCard({ canRecover: false });
    expect(screen.queryByRole("button", { name: r.copy })).toBeNull();
    expect(screen.queryByRole("button", { name: r.whatsapp })).toBeNull();
    await waitFor(() => expect(screen.getByText(r.comingSoon)).toBeInTheDocument());
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/components/abandoned-checkouts/recovery-card.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 6: Write the recovery card**

`apps/admin-web/src/components/abandoned-checkouts/recovery-card.tsx`:

```tsx
"use client";

import { useId, useState, useTransition } from "react";
import { CheckIcon, CopyIcon, MessageCircleIcon } from "lucide-react";
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
  Input,
  Label,
} from "@platform/ui";
import { issueRecoveryLinkAction } from "@/app/abandoned-checkouts/actions";
import { fillTemplate, toWhatsAppDigits, whatsAppUrl } from "@/lib/whatsapp";
import type { Dictionary } from "@/messages/en";

/** True only when the browser really put the text on the clipboard. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || navigator.clipboard === undefined) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Shopify's Recovery card (spec §3.7). Every press makes a NEW link through the server action (a link
 * cannot be shown twice — only its hash is stored). The link is always shown in a read-only field,
 * so a refused clipboard (Safari after an await, no permission, insecure context) still leaves the
 * merchant something to copy; "Copied" appears only after a real copy. WhatsApp opens `wa.me` with a
 * message the merchant can edit first.
 */
export function RecoveryCard({
  checkoutId,
  customerName,
  phone,
  country,
  canRecover,
  t,
}: {
  readonly checkoutId: string;
  readonly customerName: string | null;
  readonly phone: string | null;
  readonly country: string | null;
  readonly canRecover: boolean;
  readonly t: Dictionary;
}) {
  const r = t.abandonedCheckouts.recovery;
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [message, setMessage] = useState("");

  const issue = async () => {
    const result = await issueRecoveryLinkAction(checkoutId);
    if (!result.ok) {
      setError(result.message);
      return null;
    }
    setError(null);
    setLink(result.url);
    return result;
  };

  const copy = () =>
    startTransition(async () => {
      setCopied(false);
      const issued = await issue();
      if (issued === null) return;
      setCopied(await copyText(issued.url));
    });

  const share = () =>
    startTransition(async () => {
      const issued = await issue();
      if (issued === null) return;
      const template = customerName === null ? r.whatsappMessageNoName : r.whatsappMessage;
      setMessage(
        fillTemplate(template, {
          name: customerName ?? "",
          shop: issued.shopName,
          url: issued.url,
        }),
      );
      setShareOpen(true);
    });

  const openWhatsApp = () => {
    window.open(
      whatsAppUrl(toWhatsAppDigits(phone, country), message),
      "_blank",
      "noopener,noreferrer",
    );
    setShareOpen(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{r.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canRecover && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={copy} disabled={pending}>
              {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
              {copied ? r.copied : r.copy}
            </Button>
            <Button type="button" onClick={share} disabled={pending}>
              <MessageCircleIcon aria-hidden="true" />
              {r.whatsapp}
            </Button>
          </div>
        )}
        {pending && <p className="text-muted-foreground text-sm">{r.issuing}</p>}
        {link !== null && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-link`}>{r.linkLabel}</Label>
            <Input
              id={`${id}-link`}
              readOnly
              value={link}
              dir="ltr"
              onFocus={(event) => event.currentTarget.select()}
            />
            <p className="text-muted-foreground text-xs">{r.expires}</p>
          </div>
        )}
        <span role="status" className="sr-only">
          {copied ? r.copied : ""}
        </span>
        {error !== null && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <p className="text-muted-foreground text-sm">{r.comingSoon}</p>
      </CardContent>
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{r.dialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-message`}>{r.messageLabel}</Label>
            <textarea
              id={`${id}-message`}
              rows={5}
              dir="auto"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="border-input bg-card focus-visible:ring-ring min-h-28 w-full rounded-xl border px-3.5 py-2 text-base focus-visible:outline-none focus-visible:ring-2"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShareOpen(false)}>
              {r.cancel}
            </Button>
            <Button type="button" onClick={openWhatsApp} disabled={message.trim().length === 0}>
              {r.openWhatsApp}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
```

(Client component: it value-imports only the server action and `lib/whatsapp.ts` — never `lib/api/*`.)

Run the card test again. Expected: PASS.

- [ ] **Step 7: Write the timeline component with its test**

`apps/admin-web/src/components/abandoned-checkouts/abandoned-checkout-timeline.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { AbandonedCheckoutTimeline } from "./abandoned-checkout-timeline";

describe("AbandonedCheckoutTimeline", () => {
  it("lists the recovery (linking the order), link activity and the start", () => {
    render(
      <AbandonedCheckoutTimeline
        detail={{
          createdAt: "2026-10-18T09:00:00.000Z",
          lastActivityAt: "2026-10-18T09:00:00.000Z",
          links: [
            {
              issuedAt: "2026-10-18T12:00:00.000Z",
              expiresAt: "x",
              claimCount: 1,
              lastClaimedAt: "2026-10-18T13:00:00.000Z",
            },
          ],
          recoveredOrder: { id: "order-9", orderNumber: "1007" },
        }}
        t={en}
        locale="en"
      />,
    );
    const t = en.abandonedCheckouts.timeline;
    expect(
      screen.getByRole("link", { name: t.recovered.replace("{order}", "#1007") }),
    ).toHaveAttribute("href", "/orders/order-9");
    expect(screen.getByText(t.linkOpened.replace("{count}", "1"))).toBeInTheDocument();
    expect(screen.getByText(t.linkIssued)).toBeInTheDocument();
    expect(screen.getByText(t.started)).toBeInTheDocument();
  });
});
```

`apps/admin-web/src/components/abandoned-checkouts/abandoned-checkout-timeline.tsx`:

```tsx
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { AbandonedCheckoutDetailDto } from "@/lib/api/abandoned-checkouts";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { abandonedTimeline, type AbandonedTimelineEvent } from "@/lib/orders/abandoned-checkouts";
import type { Dictionary } from "@/messages/en";

function label(event: AbandonedTimelineEvent, t: Dictionary, locale: Locale): string {
  const l = t.abandonedCheckouts.timeline;
  switch (event.kind) {
    case "started":
      return l.started;
    case "last_activity":
      return l.lastActivity;
    case "link_issued":
      return l.linkIssued;
    case "link_opened":
      return l.linkOpened.replace("{count}", () => formatNumber(locale, event.count ?? 0));
    case "recovered":
      return l.recovered.replace("{order}", () =>
        event.orderNumber === null || event.orderNumber === undefined
          ? ""
          : `#${event.orderNumber}`,
      );
  }
}

/** The abandoned checkout's small timeline (spec §3.7): recovered on top, then newest first. */
export function AbandonedCheckoutTimeline({
  detail,
  t,
  locale,
}: {
  readonly detail: Pick<
    AbandonedCheckoutDetailDto,
    "createdAt" | "lastActivityAt" | "links" | "recoveredOrder"
  >;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.abandonedCheckouts.timeline.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="border-border flex flex-col gap-4 border-s ps-4">
          {abandonedTimeline(detail).map((event) => (
            <li key={event.key} className="flex flex-col gap-0.5">
              {event.kind === "recovered" && event.orderId !== undefined ? (
                <Link
                  href={`/orders/${encodeURIComponent(event.orderId)}`}
                  className="font-medium hover:underline"
                >
                  {label(event, t, locale)}
                </Link>
              ) : (
                <span className="text-sm">{label(event, t, locale)}</span>
              )}
              {event.at !== null && (
                <time dateTime={event.at} className="text-muted-foreground text-xs">
                  {formatDateTime(locale, event.at)}
                </time>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
```

Run: `pnpm --filter admin-web exec vitest run src/components/abandoned-checkouts/abandoned-checkout-timeline.test.tsx`
Expected: PASS (write the test first and see it fail with "module not found" before adding the component).

- [ ] **Step 8: Write the detail page**

`apps/admin-web/src/app/abandoned-checkouts/[checkoutId]/page.tsx`:

```tsx
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { AbandonedCheckoutTimeline } from "@/components/abandoned-checkouts/abandoned-checkout-timeline";
import { RecoveryCard } from "@/components/abandoned-checkouts/recovery-card";
import { AppShell } from "@/components/app-shell";
import {
  fetchAbandonedCheckout,
  type AbandonedCheckoutDetailDto,
} from "@/lib/api/abandoned-checkouts";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import { canRecoverCheckout } from "@/lib/orders/abandoned-checkouts";
import type { Dictionary } from "@/messages/en";

interface AbandonedCheckoutPageProps {
  readonly params: Promise<{ readonly checkoutId: string }>;
}

/**
 * One abandoned checkout (spec §3.7, Shopify's layout): left — items, payment totals, Recovery card,
 * timeline; right — customer contact and shipping address.
 */
export default async function AbandonedCheckoutPage({ params }: AbandonedCheckoutPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const a = t.abandonedCheckouts;
  const user = await getCurrentUser();
  const { checkoutId } = await params;
  const result = await fetchAbandonedCheckout(checkoutId);

  const shell = (children: ReactNode) => (
    <AppShell t={t} locale={locale} activeNavId="abandoned-checkouts" user={user}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <Link
          href="/abandoned-checkouts"
          className="text-muted-foreground inline-flex items-center gap-1.5 text-sm hover:underline"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
          {a.back}
        </Link>
        {children}
      </div>
    </AppShell>
  );

  if (result.outcome === "unauthorized") {
    return shell(
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={a.unauthorized}
      />,
    );
  }
  if (result.outcome === "not_found") {
    return shell(
      <StatePanel
        icon={<SearchXIcon aria-hidden="true" className="size-5" />}
        message={a.notFound}
      />,
    );
  }
  if (result.outcome === "error") {
    return shell(
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={a.error}
      />,
    );
  }

  const checkout = result.data;
  const canRecover = canRecoverCheckout(highestRole((await readSession())?.roles ?? []));

  return shell(
    <>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{checkout.reference}</h1>
        {checkout.recoveryStatus === "recovered" ? (
          <Badge variant="success">{a.recovered}</Badge>
        ) : (
          <Badge variant="neutral">{a.notRecovered}</Badge>
        )}
        <span className="text-muted-foreground text-sm">
          {formatDateTime(locale, checkout.createdAt)}
        </span>
      </header>
      <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <ItemsCard checkout={checkout} t={t} locale={locale} />
          <TotalsCard checkout={checkout} t={t} locale={locale} />
          {checkout.recoveryStatus === "not_recovered" && (
            <RecoveryCard
              checkoutId={checkout.id}
              customerName={checkout.customerName}
              phone={checkout.phone}
              country={checkout.country}
              canRecover={canRecover}
              t={t}
            />
          )}
          <AbandonedCheckoutTimeline detail={checkout} t={t} locale={locale} />
        </div>
        <div className="flex flex-col gap-6">
          <CustomerCard checkout={checkout} t={t} />
          <ShippingCard checkout={checkout} t={t} />
        </div>
      </div>
    </>,
  );
}

interface CardProps {
  readonly checkout: AbandonedCheckoutDetailDto;
  readonly t: Dictionary;
  readonly locale: Locale;
}

function ItemsCard({ checkout, t, locale }: CardProps) {
  const a = t.abandonedCheckouts;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{a.items.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {checkout.items.map((item, index) => (
            <li
              key={`${item.productId}:${item.variantId ?? ""}:${index}`}
              className="flex items-center gap-3"
            >
              {item.imageUrl !== null ? (
                // eslint-disable-next-line @next/next/no-img-element -- media URLs are already sized
                <img src={item.imageUrl} alt="" className="size-10 rounded-md object-cover" />
              ) : (
                <span aria-hidden="true" className="bg-muted size-10 rounded-md" />
              )}
              <div className="min-w-0 flex-1">
                <p dir="auto" className="truncate font-medium">
                  {item.title ?? a.items.noTitle}
                </p>
                <p className="text-muted-foreground text-sm">
                  {[item.variantTitle, item.sku].filter((part) => part !== null).join(" · ")}
                </p>
              </div>
              <span className="text-muted-foreground text-sm tabular-nums">
                {formatCurrency(locale, item.unitPriceMinor, checkout.currency)}{" "}
                {a.items.quantity.replace("{count}", () => formatNumber(locale, item.quantity))}
              </span>
              <span className="tabular-nums">
                {formatCurrency(locale, item.lineTotalMinor, checkout.currency)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function TotalsCard({ checkout, t, locale }: CardProps) {
  const a = t.abandonedCheckouts.totals;
  const money = (minor: number) => formatCurrency(locale, minor, checkout.currency);
  const totals = checkout.totals;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{a.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {totals === null ? (
          <>
            <Row label={a.subtotal} value={money(checkout.totalMinor)} />
            <p className="text-muted-foreground">{a.notCalculated}</p>
          </>
        ) : (
          <>
            <Row label={a.subtotal} value={money(totals.subtotalMinor)} />
            {totals.discountMinor > 0 && (
              <Row label={a.discount} value={`−${money(totals.discountMinor)}`} />
            )}
            <Row label={a.shipping} value={money(totals.shippingMinor)} />
            <Row label={a.tax} value={money(totals.taxMinor)} />
            <Row label={a.total} value={money(totals.totalMinor)} strong />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 ${strong === true ? "font-semibold" : ""}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function CustomerCard({ checkout, t }: Omit<CardProps, "locale">) {
  const a = t.abandonedCheckouts.customer;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{a.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        {checkout.customerName !== null && (
          <p dir="auto" className="font-medium">
            {checkout.customerName}
          </p>
        )}
        {checkout.email !== null && (
          <a href={`mailto:${checkout.email}`} dir="ltr" className="hover:underline">
            {checkout.email}
          </a>
        )}
        {checkout.phone !== null && (
          <a href={`tel:${checkout.phone}`} dir="ltr" className="hover:underline">
            {checkout.phone}
          </a>
        )}
        {checkout.email === null && checkout.phone === null && (
          <p className="text-muted-foreground">{a.none}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ShippingCard({ checkout, t }: Omit<CardProps, "locale">) {
  const a = t.abandonedCheckouts.shippingAddress;
  const address = checkout.shippingAddress;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{a.title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {address === null ? (
          <p className="text-muted-foreground">{a.none}</p>
        ) : (
          <address dir="auto" className="flex flex-col not-italic">
            {address.name !== null && <span>{address.name}</span>}
            <span>{address.line1}</span>
            {address.line2 !== null && <span>{address.line2}</span>}
            <span>
              {[address.city, address.province, address.postalCode]
                .filter((p) => p !== null && p !== "")
                .join(", ")}
            </span>
            <span>{address.country}</span>
          </address>
        )}
      </CardContent>
    </Card>
  );
}

function StatePanel({ icon, message }: { readonly icon: ReactNode; readonly message: string }) {
  return (
    <Card>
      <CardContent className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-16 text-center text-base sm:px-5">
        {icon}
        <p role="note">{message}</p>
      </CardContent>
    </Card>
  );
}
```

(If the admin-web ESLint config has no `@next/next/no-img-element` rule, drop that disable comment — an
unused disable directive is itself a lint error in this repo when `reportUnusedDisableDirectives` is on;
check `pnpm --filter admin-web lint` output and keep whichever form is clean. `order-items-card.tsx`
shows how order lines render their images today — mirror it if it uses a shared thumbnail component.)

- [ ] **Step 9: Package checks**

Run: `pnpm --filter admin-web typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint && pnpm --filter admin-web test`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add apps/admin-web/src/lib/whatsapp.ts apps/admin-web/src/lib/whatsapp.test.ts \
  apps/admin-web/src/app/abandoned-checkouts/actions.ts apps/admin-web/src/app/abandoned-checkouts/actions.test.ts \
  apps/admin-web/src/components/abandoned-checkouts/recovery-card.tsx \
  apps/admin-web/src/components/abandoned-checkouts/recovery-card.test.tsx \
  apps/admin-web/src/components/abandoned-checkouts/abandoned-checkout-timeline.tsx \
  apps/admin-web/src/components/abandoned-checkouts/abandoned-checkout-timeline.test.tsx \
  "apps/admin-web/src/app/abandoned-checkouts/[checkoutId]/page.tsx"
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin-web): abandoned checkout page with copy link and whatsapp share

The detail page shows items, totals, contact, address and a small timeline. Copy recovery
link and Share on WhatsApp each mint a new link; the link stays visible when the clipboard
is refused, and wa.me opens the customer's chat (EG/SA/AE/KW/QA/BH/OM/JO calling codes,
Arabic-Indic digits) with an editable localized message.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Storefront — `/c/[token]` landing page, the claim action, and the dropped-items notice

Model tier: **standard** (the "claim on the button, never on render" rule is pinned by a test).

**Files:**

- Create: `apps/storefront/src/lib/guest-session.ts`, `apps/storefront/src/lib/guest-session.test.ts`
- Modify: `apps/storefront/src/app/cart/actions.ts` (use the moved helper; delete its local copy)
- Modify: `apps/storefront/src/lib/runtime-api.ts` (two calls + two types, after `loadCheckoutItems`)
- Create: `apps/storefront/src/app/c/[token]/actions.ts`, `apps/storefront/src/app/c/[token]/actions.test.ts`
- Create: `apps/storefront/src/app/c/[token]/page.tsx`, `apps/storefront/src/app/c/[token]/page.test.tsx`
- Modify: `apps/storefront/src/app/checkout/page.tsx` (reads `?dropped=1`)
- Create: `apps/storefront/src/app/checkout/page.test.tsx`
- Modify: `apps/storefront/src/messages/en.ts`, `apps/storefront/src/messages/ar.ts`

**Interfaces:**

- Consumes: Task 5's `POST /public/checkout-links/claim` (`{ token, sessionRef }` → `{ checkoutSessionId, droppedItems }` | 404 `LINK_INVALID` | 409 `ITEMS_UNAVAILABLE`) and `GET /public/checkout-links/:token/preview`; `fetchItem`/`postItem` (private to `runtime-api.ts`); `GUEST_SESSION_COOKIE`, `GUEST_SESSION_COOKIE_OPTIONS`, `CHECKOUT_SESSION_COOKIE`, `CHECKOUT_SESSION_COOKIE_OPTIONS` (`lib/cart.ts`); `SiteHeader`, `StatePanel`, `LineThumb`, `formatCurrency`, i18n helpers.
- Produces:
  - `lib/guest-session.ts`: `currentOrNewSessionRef(): Promise<string>`.
  - `lib/runtime-api.ts`: `interface CheckoutLinkPreview`, `interface CheckoutLinkClaim`, `getCheckoutLinkPreview(token): Promise<{ status: number; body: CheckoutLinkPreview | null }>`, `claimCheckoutLink(token, sessionRef): Promise<{ status: number; body: CheckoutLinkClaim | null }>`.
  - `app/c/[token]/actions.ts` (`"use server"`): `claimCheckoutLink(token: string): Promise<void>` (always redirects).
  - Dictionary: `t.recovery.{metaTitle, title, fromShop, itemFallback, quantity, total, pricesNote, continue, invalidTitle, invalidBody, backToShop, errors.{invalid, unavailable, network}}`, `t.checkout.itemsDropped`.

- [ ] **Step 1: Add the strings**

In `apps/storefront/src/messages/en.ts`, inside `checkout` after `outOfStock: …,` add
`itemsDropped: "Some items are no longer available",`, and add before `account: {`:

```ts
  /** Order operations Part 3 — the recovery link landing page (`/c/<token>`). */
  recovery: {
    metaTitle: "Complete your order",
    title: "Complete your order",
    fromShop: "Your order from {shop}",
    itemFallback: "Item",
    quantity: "Qty {count}",
    total: "Total",
    pricesNote: "Prices and availability are confirmed at checkout.",
    continue: "Continue to checkout",
    invalidTitle: "This link has expired or is no longer valid",
    invalidBody: "Ask the store for a new link, or keep shopping.",
    backToShop: "Back to shop",
    errors: {
      invalid: "This link has expired or is no longer valid.",
      unavailable: "None of these items are available anymore.",
      network: "Couldn't open your checkout. Try again.",
    },
  },
```

In `apps/storefront/src/messages/ar.ts`, inside `checkout` add `itemsDropped: "بعض المنتجات لم تعد متاحة",`
and before `account: {`:

```ts
  recovery: {
    metaTitle: "أكمل طلبك",
    title: "أكمل طلبك",
    fromShop: "طلبك من {shop}",
    itemFallback: "منتج",
    quantity: "الكمية {count}",
    total: "الإجمالي",
    pricesNote: "يتم تأكيد الأسعار والتوفر عند الدفع.",
    continue: "أكمل الطلب",
    invalidTitle: "انتهت صلاحية هذا الرابط أو لم يعد صالحًا",
    invalidBody: "اطلب رابطًا جديدًا من المتجر، أو تابع التسوق.",
    backToShop: "العودة إلى المتجر",
    errors: {
      invalid: "انتهت صلاحية هذا الرابط أو لم يعد صالحًا.",
      unavailable: "لم تعد أي من هذه المنتجات متاحة.",
      network: "تعذّر فتح صفحة الدفع. حاول مرة أخرى.",
    },
  },
```

Run: `pnpm --filter storefront typecheck`
Expected: PASS.

- [ ] **Step 2: Move `currentOrNewSessionRef` into a server-only module (test first)**

`apps/storefront/src/lib/guest-session.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
const set = vi.fn((name: string, value: string) => void jar.set(name, value));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set,
  }),
}));
vi.mock("./runtime-api", () => ({}));

const { currentOrNewSessionRef } = await import("./guest-session");

beforeEach(() => {
  jar.clear();
  set.mockClear();
});

describe("currentOrNewSessionRef", () => {
  it("keeps the browser's guest session", async () => {
    jar.set("morbeh-storefront-guest-session", "guest-1");
    expect(await currentOrNewSessionRef()).toBe("guest-1");
    expect(set).not.toHaveBeenCalled();
  });

  it("mints an HttpOnly guest session when there is none", async () => {
    const minted = await currentOrNewSessionRef();
    expect(minted).toMatch(/^[0-9a-f-]{36}$/);
    expect(set).toHaveBeenCalledWith(
      "morbeh-storefront-guest-session",
      minted,
      expect.objectContaining({ httpOnly: true, path: "/" }),
    );
  });
});
```

Run: `pnpm --filter storefront exec vitest run src/lib/guest-session.test.ts` → FAIL (module not found).

`apps/storefront/src/lib/guest-session.ts`:

```ts
import { cookies } from "next/headers";
import { GUEST_SESSION_COOKIE, GUEST_SESSION_COOKIE_OPTIONS } from "./cart";

/**
 * The caller's guest session (the HttpOnly cookie that proves cart/checkout ownership), minted when
 * missing. Lives here — not in a `"use server"` module — because every export of such a module is a
 * Server Action the browser can call; this is a helper that only server actions use.
 */
export async function currentOrNewSessionRef(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(GUEST_SESSION_COOKIE)?.value;
  if (existing !== undefined && existing.length > 0) return existing;

  const sessionRef = crypto.randomUUID();
  jar.set(GUEST_SESSION_COOKIE, sessionRef, GUEST_SESSION_COOKIE_OPTIONS);
  return sessionRef;
}
```

In `apps/storefront/src/app/cart/actions.ts` delete the local `async function currentOrNewSessionRef()`
(lines 38–46) and add `import { currentOrNewSessionRef } from "@/lib/guest-session";` with the other imports.

Run: `pnpm --filter storefront exec vitest run src/lib/guest-session.test.ts src/app/cart/actions.test.ts`
Expected: PASS (the cart actions behave exactly as before).

- [ ] **Step 3: Add the two runtime-API calls**

In `apps/storefront/src/lib/runtime-api.ts`, after `loadCheckoutItems`:

```ts
/** Order operations Part 3: what a recovery link holds — shop, items, total; no personal data. */
export interface CheckoutLinkPreview {
  readonly purpose: "recovery";
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

/** The caller's OWN new (or resumed) checkout, and how many lines could not be sold any more. */
export interface CheckoutLinkClaim {
  readonly checkoutSessionId: string;
  readonly droppedItems: number;
}

/** A GET with no side effect: safe for page renders and link-preview bots. */
export function getCheckoutLinkPreview(
  token: string,
): Promise<{ readonly status: number; readonly body: CheckoutLinkPreview | null }> {
  return fetchItem<CheckoutLinkPreview>(
    `/api/v1/public/checkout-links/${encodeURIComponent(token)}/preview`,
  );
}

/** The ONLY call that claims a link — made by the landing page's button (a server action), never a render. */
export function claimCheckoutLink(
  token: string,
  sessionRef: string,
): Promise<{ readonly status: number; readonly body: CheckoutLinkClaim | null }> {
  return postItem<CheckoutLinkClaim>("/api/v1/public/checkout-links/claim", { token, sessionRef });
}
```

- [ ] **Step 4: Write the failing claim-action tests**

`apps/storefront/src/app/c/[token]/actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const claimApi = vi.hoisted(() => vi.fn());
vi.mock("@/lib/runtime-api", () => ({ claimCheckoutLink: claimApi }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect }));

const jar = new Map<string, string>();
const set = vi.fn((name: string, value: string) => void jar.set(name, value));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set,
  }),
}));

const { claimCheckoutLink } = await import("./actions");

const TOKEN = "a".repeat(43);

beforeEach(() => {
  jar.clear();
  set.mockClear();
  claimApi.mockReset();
  redirect.mockClear();
  revalidatePath.mockClear();
});

describe("claimCheckoutLink (the Continue to checkout button)", () => {
  it("claims with the browser's guest session, sets the checkout cookie and opens /checkout", async () => {
    jar.set("morbeh-storefront-guest-session", "guest-1");
    claimApi.mockResolvedValue({
      status: 200,
      body: { checkoutSessionId: "cs-new", droppedItems: 0 },
    });

    await expect(claimCheckoutLink(TOKEN)).rejects.toThrow("NEXT_REDIRECT /checkout");
    expect(claimApi).toHaveBeenCalledWith(TOKEN, "guest-1");
    expect(set).toHaveBeenCalledWith(
      "morbeh_checkout_session",
      "cs-new",
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it("mints a guest session first when the browser has none (a link opened in a fresh browser)", async () => {
    claimApi.mockResolvedValue({
      status: 200,
      body: { checkoutSessionId: "cs-new", droppedItems: 0 },
    });
    await expect(claimCheckoutLink(TOKEN)).rejects.toThrow("NEXT_REDIRECT /checkout");
    const minted = jar.get("morbeh-storefront-guest-session");
    expect(minted).toBeDefined();
    expect(claimApi).toHaveBeenCalledWith(TOKEN, minted);
  });

  it("tells the checkout when some items were dropped", async () => {
    jar.set("morbeh-storefront-guest-session", "guest-1");
    claimApi.mockResolvedValue({
      status: 200,
      body: { checkoutSessionId: "cs-new", droppedItems: 2 },
    });
    await expect(claimCheckoutLink(TOKEN)).rejects.toThrow("NEXT_REDIRECT /checkout?dropped=1");
  });

  it.each([
    [404, "invalid"],
    [409, "unavailable"],
    [0, "network"],
  ])(
    "a %s answer goes back to the link page with error=%s and sets no checkout cookie",
    async (status, error) => {
      jar.set("morbeh-storefront-guest-session", "guest-1");
      claimApi.mockResolvedValue({ status, body: null });
      await expect(claimCheckoutLink(TOKEN)).rejects.toThrow(
        `NEXT_REDIRECT /c/${TOKEN}?error=${error}`,
      );
      expect(jar.has("morbeh_checkout_session")).toBe(false);
    },
  );

  it("a malformed token never reaches the API", async () => {
    await expect(claimCheckoutLink("../../admin")).rejects.toThrow("NEXT_REDIRECT /");
    expect(claimApi).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter storefront exec vitest run "src/app/c/[token]/actions.test.ts"`
Expected: FAIL — module not found.

- [ ] **Step 5: Write the claim action**

`apps/storefront/src/app/c/[token]/actions.ts`:

```ts
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CHECKOUT_SESSION_COOKIE, CHECKOUT_SESSION_COOKIE_OPTIONS } from "@/lib/cart";
import { currentOrNewSessionRef } from "@/lib/guest-session";
import { claimCheckoutLink as claimCheckoutLinkApi } from "@/lib/runtime-api";

/** As the API mints them: 32 bytes, base64url. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function failureOf(status: number): "invalid" | "unavailable" | "network" {
  if (status === 404) return "invalid";
  if (status === 409) return "unavailable";
  return "network";
}

/**
 * Order operations Part 3 — the landing page's "Continue to checkout" (spec §3.8). The claim happens
 * HERE, on the button, never when `/c/<token>` renders: WhatsApp and other apps fetch links to build
 * previews, and a claim on GET would clone carts for crawlers. The checkout made belongs to THIS
 * browser's guest session (minted if missing); the abandoned one is never handed over.
 */
export async function claimCheckoutLink(token: string): Promise<void> {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) redirect("/");
  const sessionRef = await currentOrNewSessionRef();
  const result = await claimCheckoutLinkApi(token, sessionRef);
  if (result.status === 200 && result.body !== null) {
    const jar = await cookies();
    jar.set(
      CHECKOUT_SESSION_COOKIE,
      result.body.checkoutSessionId,
      CHECKOUT_SESSION_COOKIE_OPTIONS,
    );
    revalidatePath("/checkout");
    redirect(result.body.droppedItems > 0 ? "/checkout?dropped=1" : "/checkout");
  }
  redirect(`/c/${token}?error=${failureOf(result.status)}`);
}
```

Run the action test again. Expected: PASS.

- [ ] **Step 6: Write the failing landing-page tests**

`apps/storefront/src/app/c/[token]/page.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatCurrency } from "@/lib/format";
import type { CheckoutLinkPreview } from "@/lib/runtime-api";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    }),
}));
const getCheckoutLinkPreview = vi.hoisted(() => vi.fn());
const claimApi = vi.hoisted(() => vi.fn());
vi.mock("@/lib/runtime-api", () => ({ getCheckoutLinkPreview, claimCheckoutLink: claimApi }));
const claimAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ claimCheckoutLink: claimAction }));
vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));

const { default: CheckoutLinkPage, generateMetadata } = await import("./page");

const TOKEN = "b".repeat(43);
const PREVIEW: CheckoutLinkPreview = {
  purpose: "recovery",
  shopName: "Sara Shop",
  itemCount: 3,
  items: [
    { title: "T-shirt", variantTitle: "L", quantity: 2, imageUrl: null },
    { title: null, variantTitle: null, quantity: 1, imageUrl: null },
  ],
  totalMinor: 59000,
  currency: "EGP",
};

async function renderPage(token = TOKEN, error?: string) {
  render(
    await CheckoutLinkPage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve(error === undefined ? {} : { error }),
    }),
  );
}

beforeEach(() => {
  jar.clear();
  getCheckoutLinkPreview.mockReset();
  claimApi.mockReset();
  claimAction.mockReset();
});

describe("/c/[token] (order operations Part 3)", () => {
  it("shows the shop, the items, the total and one Continue button — and claims nothing on render", async () => {
    getCheckoutLinkPreview.mockResolvedValue({ status: 200, body: PREVIEW });
    await renderPage();
    expect(getCheckoutLinkPreview).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByRole("heading", { name: en.recovery.title })).toBeInTheDocument();
    expect(screen.getByText("Your order from Sara Shop")).toBeInTheDocument();
    expect(screen.getByText("T-shirt")).toBeInTheDocument();
    expect(screen.getByText(en.recovery.itemFallback)).toBeInTheDocument();
    expect(screen.getByText(formatCurrency("en", 59000, "EGP"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.recovery.continue })).toBeInTheDocument();
    expect(claimApi).not.toHaveBeenCalled();
    expect(claimAction).not.toHaveBeenCalled();
  });

  it("an invalid link shows the friendly panel with a way back to the shop", async () => {
    getCheckoutLinkPreview.mockResolvedValue({ status: 404, body: null });
    await renderPage();
    expect(screen.getByRole("heading", { name: en.recovery.invalidTitle })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.recovery.backToShop })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button", { name: en.recovery.continue })).toBeNull();
  });

  it("a malformed token is invalid without asking the API", async () => {
    await renderPage("not-a-token");
    expect(getCheckoutLinkPreview).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: en.recovery.invalidTitle })).toBeInTheDocument();
  });

  it("explains a failed claim", async () => {
    getCheckoutLinkPreview.mockResolvedValue({ status: 200, body: PREVIEW });
    await renderPage(TOKEN, "unavailable");
    expect(screen.getByRole("alert")).toHaveTextContent(en.recovery.errors.unavailable);
  });

  it("speaks Arabic", async () => {
    jar.set("morbeh-storefront-locale", "ar");
    getCheckoutLinkPreview.mockResolvedValue({ status: 200, body: PREVIEW });
    await renderPage();
    expect(screen.getByRole("button", { name: ar.recovery.continue })).toBeInTheDocument();
  });

  it("the preview title names the shop and nothing personal", async () => {
    getCheckoutLinkPreview.mockResolvedValue({ status: 200, body: PREVIEW });
    const metadata = await generateMetadata({ params: Promise.resolve({ token: TOKEN }) });
    expect(metadata.title).toBe(`Sara Shop — ${en.recovery.metaTitle}`);
    expect(metadata.openGraph?.title).toBe(`Sara Shop — ${en.recovery.metaTitle}`);
    getCheckoutLinkPreview.mockResolvedValue({ status: 404, body: null });
    expect((await generateMetadata({ params: Promise.resolve({ token: TOKEN }) })).title).toBe(
      en.recovery.metaTitle,
    );
  });
});
```

Run: `pnpm --filter storefront exec vitest run "src/app/c/[token]/page.test.tsx"`
Expected: FAIL — module not found. (The locale cookie name is `LOCALE_COOKIE` from `lib/i18n.ts`; if it
is not `morbeh-storefront-locale`, use the constant's value in the Arabic test.)

- [ ] **Step 7: Write the landing page**

`apps/storefront/src/app/c/[token]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { LineThumb } from "@/components/line-thumb";
import { SiteHeader } from "@/components/site-header";
import { StatePanel } from "@/components/state-panel";
import { formatCurrency } from "@/lib/format";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import { getCheckoutLinkPreview, type CheckoutLinkPreview } from "@/lib/runtime-api";
import { claimCheckoutLink } from "./actions";

/** As the API mints them: 32 bytes, base64url. Anything else is invalid without a lookup. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CLAIM_ERRORS = ["invalid", "unavailable", "network"] as const;

interface CheckoutLinkPageProps {
  readonly params: Promise<{ readonly token: string }>;
  readonly searchParams: Promise<{ readonly error?: string }>;
}

async function localized(): Promise<{
  readonly locale: Locale;
  readonly t: ReturnType<typeof dictionaryFor>;
}> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return { locale, t: dictionaryFor(locale) };
}

/** The preview is a plain GET with no side effect — rendering this page never claims the link. */
async function previewOf(token: string): Promise<CheckoutLinkPreview | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const response = await getCheckoutLinkPreview(token);
  return response.status === 200 ? response.body : null;
}

/** WhatsApp's link preview reads this: the shop's name, never anything about the shopper. */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const { t } = await localized();
  const preview = await previewOf(token);
  const title =
    preview === null || preview.shopName === ""
      ? t.recovery.metaTitle
      : `${preview.shopName} — ${t.recovery.metaTitle}`;
  return { title, openGraph: { title }, robots: { index: false, follow: false } };
}

/**
 * `/c/<token>` — a recovery link a merchant shared (order operations Part 3, spec §3.8): the items and
 * total, and ONE button. Pressing it runs the `claimCheckoutLink` server action, which makes this
 * browser's own checkout and opens `/checkout`.
 */
export default async function CheckoutLinkPage({ params, searchParams }: CheckoutLinkPageProps) {
  const { token } = await params;
  const { error } = await searchParams;
  const { locale, t } = await localized();
  const preview = await previewOf(token);
  const claimError = CLAIM_ERRORS.find((key) => key === error);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-8">
      <SiteHeader t={t} locale={locale} />
      {preview === null ? (
        <StatePanel
          icon={<AlertTriangleIcon className="size-6" />}
          title={t.recovery.invalidTitle}
          body={t.recovery.invalidBody}
          action={{ href: "/", label: t.recovery.backToShop }}
        />
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-5 p-6">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold">{t.recovery.title}</h1>
              {preview.shopName !== "" && (
                <p dir="auto" className="text-muted-foreground">
                  {t.recovery.fromShop.replace("{shop}", () => preview.shopName)}
                </p>
              )}
            </div>
            <ul className="flex flex-col gap-3">
              {preview.items.map((item, index) => (
                <li key={index} className="flex items-center gap-3">
                  <LineThumb
                    url={item.imageUrl}
                    alt={item.title ?? t.recovery.itemFallback}
                    size={48}
                    noImageLabel={t.product.gallery.noImage}
                  />
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="truncate font-medium">
                      {item.title ?? t.recovery.itemFallback}
                    </p>
                    {item.variantTitle !== null && (
                      <p dir="auto" className="text-muted-foreground text-sm">
                        {item.variantTitle}
                      </p>
                    )}
                  </div>
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {t.recovery.quantity.replace("{count}", () => String(item.quantity))}
                  </span>
                </li>
              ))}
            </ul>
            <div className="border-border flex items-center justify-between border-t pt-4 font-medium">
              <span>{t.recovery.total}</span>
              <span className="tabular-nums">
                {formatCurrency(locale, preview.totalMinor, preview.currency)}
              </span>
            </div>
            <p className="text-muted-foreground text-sm">{t.recovery.pricesNote}</p>
            {claimError !== undefined && (
              <p role="alert" className="text-destructive text-sm">
                {t.recovery.errors[claimError]}
              </p>
            )}
            <form action={claimCheckoutLink.bind(null, token)}>
              <Button type="submit" className="w-full">
                {t.recovery.continue}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
```

(If `@platform/ui`'s `Button` is not used elsewhere in the storefront, use the same button markup
`app/checkout` uses — check `components/checkout-view.tsx` and keep one style.)

Run the page test again. Expected: PASS.

- [ ] **Step 8: Show the dropped-items notice on `/checkout` (test first)**

`apps/storefront/src/app/checkout/page.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    }),
}));
vi.mock("@/lib/runtime-api", () => ({
  getCheckoutSession: vi.fn().mockResolvedValue({ status: 200, body: { id: "cs-1" } }),
  getPaymentMethods: vi.fn().mockResolvedValue([]),
  getShippableCountries: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/customer-session", () => ({
  CUSTOMER_SESSION_COOKIE: "customer",
  resolveCurrentCustomer: vi.fn().mockResolvedValue({ status: "signed-out" }),
}));
vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/checkout-view", () => ({ CheckoutView: () => <div>checkout-view</div> }));

const { default: CheckoutPage } = await import("./page");

beforeEach(() => {
  jar.clear();
  jar.set("morbeh-storefront-guest-session", "guest-1");
  jar.set("morbeh_checkout_session", "cs-1");
});

describe("/checkout after a recovery link (order operations Part 3)", () => {
  it("says some items are no longer available when the claim dropped lines", async () => {
    render(await CheckoutPage({ searchParams: Promise.resolve({ dropped: "1" }) }));
    expect(screen.getByRole("status")).toHaveTextContent(en.checkout.itemsDropped);
  });

  it("says nothing otherwise", async () => {
    render(await CheckoutPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByText(en.checkout.itemsDropped)).toBeNull();
  });
});
```

Run it → FAIL (the page takes no props / no notice).

In `apps/storefront/src/app/checkout/page.tsx` change the signature to

```tsx
export default async function CheckoutPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly dropped?: string }>;
}) {
```

read `const { dropped } = await searchParams;` after the dictionary lines, and render, right before the
`{session === null || …` ternary:

```tsx
{
  dropped === "1" && (
    <p
      role="status"
      className="bg-warning-subtle text-warning-foreground rounded-2xl px-4 py-3 text-sm"
    >
      {t.checkout.itemsDropped}
    </p>
  );
}
```

Run the checkout page test again. Expected: PASS.

- [ ] **Step 9: Package checks**

Run: `pnpm --filter storefront typecheck && pnpm --filter storefront lint && pnpm --filter storefront test`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add apps/storefront/src/lib/guest-session.ts apps/storefront/src/lib/guest-session.test.ts \
  apps/storefront/src/app/cart/actions.ts apps/storefront/src/lib/runtime-api.ts \
  "apps/storefront/src/app/c/[token]/actions.ts" "apps/storefront/src/app/c/[token]/actions.test.ts" \
  "apps/storefront/src/app/c/[token]/page.tsx" "apps/storefront/src/app/c/[token]/page.test.tsx" \
  apps/storefront/src/app/checkout/page.tsx apps/storefront/src/app/checkout/page.test.tsx \
  apps/storefront/src/messages/en.ts apps/storefront/src/messages/ar.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(storefront): recovery link landing page at /c/<token>

The page previews the shop, items and total and claims only when the shopper presses
Continue to checkout (link-preview bots never clone carts). The claim action mints a guest
session if needed, sets the checkout cookie and opens /checkout, which notes dropped items.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Final verification (after Task 8)

- [ ] `node scripts/dev/check-prisma-tenant-where.mjs` → exit 0.
- [ ] `DATABASE_URL=postgresql://u:p@localhost:5432/x DIRECT_URL=postgresql://u:p@localhost:5432/x pnpm --filter @platform/db exec prisma validate` → valid.
- [ ] For each of `@platform/db`, `@platform/auth`, `@platform/checkout`, `@platform/admin`, `admin-web`,
      `storefront`: `typecheck`, `lint` (with `NODE_OPTIONS=--max-old-space-size=8192` for the two admin
      apps) and `test` all green. Report that the `DATABASE_URL_TEST` integration suites were skipped unless
      a throwaway database was configured.
- [ ] Deploy note for the owner (do NOT run it): apply `20261018000000_order_archive`,
      `20261018010000_order_notes_tags_timeline` and `20261018020000_checkout_recovery_links` in that order
      from Railway's Console before the release that reads them.

## Self-review (done while writing this plan)

1. **Spec coverage.** §3.1 definition and 60-minute constant → Task 2 (`isAbandonedCheckout`, SQL, fixture);
   recovered rows listed → Tasks 2/4/5. §3.2 migration → Task 1. §3.3 token (32 bytes, base64url, hash
   only, tenant-scoped lookup, 7 days, new token per copy, `/c/` path, never the `sessionRef`) → Tasks 1, 3, 4. §3.4 `CheckoutLink`, recovery fields, `markRecovered`, `listAbandoned` (separate port, resolution 1),
   the five use cases, `CompleteCheckout` marking → Tasks 1–3. §3.5 claim steps 1–5, 409
   `ITEMS_UNAVAILABLE`, preview without PII → Task 5. §3.6 routes, permissions, DTOs, URL from the shop
   domain → Task 4. §3.7 navigation, list, detail, copy, WhatsApp (`toWhatsAppDigits` table) → Tasks 6–7.
   §3.8 landing page, claim on the button, cookies, dropped notice, runtime-api calls, metadata, strings →
   Task 8. §3.9 tests: each item has a test named in the owning task. Permissions table → Task 1 pin and
   Task 4 route tests. Public rate limiting is the pipeline's existing one (no code).
2. **Placeholders.** None: every code step has the code; the three "check and keep" notes (Cart
   discriminant, `img` lint rule, storefront `Button`) name the exact file to look at and both outcomes.
3. **Type consistency.** `CheckoutSessionRecord`, `AbandonedCheckoutQueries`, `CheckoutLink` getters,
   `ResolveCheckoutLinkOutput { link, session }`, `IssueRecoveryLinkOutput { linkId, token, expiresAt }`,
   `RecoveryLinkDto { url, path, expiresAt, shopName }` and `CheckoutLinkClaimDto { checkoutSessionId,
droppedItems }` are spelled the same in every task that produces or consumes them.
4. **Review Focus.** Five lines above, each pinned to a named test in Tasks 2, 3, 4, 5 and 7.

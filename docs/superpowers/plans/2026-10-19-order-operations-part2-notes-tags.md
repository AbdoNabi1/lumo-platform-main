# Order Operations — Part 2: Notes, Tags and Timeline Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every order can carry a staff note, case-insensitive tags and staff comments, shown in Shopify's places (Notes card, Tags card, a comment composer on the timeline), with tags filterable on the list, settable in bulk, and the note and tags filled into the export rows and packing slips.

**Architecture:** The note is a nullable `orders.orders.note` column; tags live in `orders.order_tags` (key `(order_id, tag_key)`, `tag_key` = the normalized tag lower-cased); comments and annotation activity live in `orders.order_timeline_entries`. None of it is in the `Order` aggregate: Part 1's `OrderAnnotationRepository` gains `setNote`/`addTags`/`removeTags`/`tagsInUse`, a new `OrderTimelineRepository` stores entries, and every annotation use case appends its activity line inside its own unit of work (Part 1's archive/unarchive start doing so). The comment author's name is snapshotted through a new `StaffDirectoryPort` (Prisma adapter in `apps/admin` reading Security's `principals.display_name`). `apps/admin` adds the note/tags/comments routes, `GET /order-tags`, the `tag` list filter, bulk `add_tags`/`remove_tags`, and fills note/tags into detail, list, export rows and slips; `admin-web` adds the Notes and Tags cards, the merged timeline with a composer, the list's Tags column, a "Tagged with" filter and the bulk tags dialog.

**Tech Stack:** TypeScript, Prisma 5 / PostgreSQL (hand-written SQL migration), zod routes on `@platform/http`, Vitest, Next.js 15 App Router + React 19 (admin-web), Tailwind (logical utilities), `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-10-18-order-operations-design.md` — Part 2 (§2.1–§2.5), "Global constraints", "Permissions", "Security and multi-tenancy", Decisions 4, 15 and 16, and the places Part 1 said Part 2 extends (§1.4 export row `tags`/`note`, `PackingSlipDto.note`, bulk body `tags`; §1.5 list Tags column and bulk Add/Remove tags; §1.2 archive/unarchive timeline rows). Read the spec and this plan together. Part 1's plan (`docs/superpowers/plans/2026-10-18-order-operations-part1-list.md`) is DONE on this branch; this plan extends its interfaces additively.

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
   `.strict()` bodies, DTOs never carry `sessionRef`. _(No public route in Part 2.)_
5. **Shopify placement and wording:** the sidebar's Orders item gets children **Drafts** and
   **Abandoned checkouts**, in that order (Shopify's). Labels below are Shopify's English and the
   matching Arabic. _(No sidebar change in Part 2.)_

Anti-goals that bind Part 2 (verbatim):

- No change to the order lifecycle transition table and no annotation write that bumps the `Order`
  aggregate's `version` (a note edit must never conflict with a payment webhook).

Permissions (verbatim rows used by Part 2):

| Permission                                         | Who has it today via the role table | Used by                                                                 |
| -------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| `orders:read`                                      | viewer, operator, admin             | lists, detail, drafts list/detail, abandoned list/detail, packing slips |
| `orders:archive`                                   | operator, admin                     | archive / unarchive (single and bulk)                                   |
| `orders:export`                                    | operator, admin                     | export rows                                                             |
| `orders:edit_note`, `orders:tag`, `orders:comment` | operator, admin                     | part 2                                                                  |

Operators get the three Part 2 permissions from the existing `orders:*` grant in `ROLE_PERMISSIONS`
(`packages/auth/src/role-table-access-control.ts`); admins from `*:*`; viewers hold only `orders:read`.
No role-table code changes — Task 1 pins it with a test.

Security and multi-tenancy (verbatim bullets that bind Part 2):

- **Tenant scoping.** Every new table has `tenant_id` + forced RLS `tenant_isolation`; every new
  repository method takes `tenantId` per call and reads through `runReadScoped` or the caller's `tx`;
  link lookup by token hash runs inside the request tenant's scope, so cross-shop tokens are unknown.
- **PII.** Export is operator/admin-only, capped, and formula-guarded; abandoned checkouts are behind
  `orders:read` like orders themselves.
- **Concurrency.** Annotations never touch the `Order` version; drafts use optimistic locking;
  completion is idempotent by `draft:<id>:<version>`; a merchant completion expires any open invoice
  session first, so a customer and the merchant cannot both create the order.

Limits (spec §2.1, verbatim): note ≤ 5,000 chars; tag ≤ 40 chars, ≤ 250 tags per order, no commas (a
comma splits into two tags in the input); comment ≤ 5,000 chars. Tags are case-insensitive
(`tag_key = lower(tag)`), first spelling wins for display.

Repository rules (from the owner): commit with
`git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit`, Conventional Commits in
lower case, body lines ≤ 100 chars, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`,
never `--no-verify`. Never run a migration against a real database.

## Where the spec and the code disagree (resolved here)

1. **"No FKs to `orders`" vs the tag filter.** §2.3 wants the tag filter as
   `id IN (SELECT order_id FROM order_tags WHERE tenant_id = $t AND tag_key = $k)` inside the list's one
   SQL page. Prisma can only express that as a relation filter (`tags: { some: … }` → `EXISTS`), Prisma
   only models a relation together with its foreign key, and CI's `prisma migrate diff --exit-code`
   (`.github/workflows/db-integration.yml`) fails on a relation the migrations did not create. So
   `order_tags.order_id` gets `order_tags_order_id_fkey … ON DELETE RESTRICT ON UPDATE CASCADE`, exactly
   like `order_items`/`order_events` (orders are never deleted, so it never fires).
   `order_timeline_entries` keeps no FK, as the spec says.
2. **"An admin may delete any comment" vs `TimelineEntryDto.canEdit` only.** The DTO additionally
   carries `canDelete` (additive). "Admin" is a new permission `comments:moderate` that only an admin's
   `*:*` grants (operators' `orders:*` does not match `comments:*`; the role table is unchanged and
   Task 1 pins it). The admin controller reads it with a new non-auditing `AdminGuard.allows()` probe —
   a presentation flag and an input to the use case, never a gate on its own; every action is still
   gated by `AdminGuard.ensure` (`orders:comment` / `orders:read`), and the use case enforces
   author-or-moderator.
3. **"First spelling wins" across the shop.** For one order the first spelling of a key is kept. For
   `GET /order-tags` the suggested spelling is the shop's EARLIEST row of that key
   (`(ARRAY_AGG(tag ORDER BY created_at, tag))[1]`).
4. **Tag order on an order.** The spec is silent; tags are listed alphabetically by `tag_key` in both
   stores (deterministic; Shopify lists tags alphabetically too).
5. **`tag` in admin-web's own URL.** The API takes repeated `tag` params (spec). admin-web keeps one
   comma list in its own URL (`/orders?tag=vip,urgent` — tags cannot contain commas) and sends repeated
   `tag` params to the API.
6. **`POST /orders/:orderId/tags` with both `add` and `remove`.** Runs `AddOrderTags` then
   `RemoveOrderTags` (each its own transaction) and answers the tags after both.
7. **Note activity data.** The kind list has no "note removed": `note_changed` carries
   `{ cleared: boolean }`, and the timeline reads "Ahmed edited the note" / "Ahmed removed the note".
8. **Staff directory offline.** Without `prisma` (tests, local) the author name comes from
   `InMemoryStaffDirectory` (names injectable); an unknown principal → `null` → shown as "Staff".
9. **Deleted comment text.** The row keeps its body (audit trail, spec §2.2) but the API never serves
   it again: a deleted entry's DTO has `body: null`.
10. **Migration name.** The spec's `20261018010000_order_notes_tags_timeline` is used as-is; it sorts
    after Part 1's (still undeployed) `20261018000000_order_archive`, and the owner deploys both in order.

## Review Focus

The five failure modes the spec implies but its test list does not exercise, most likely first. Each
line names the task whose tests pin it.

1. **A suggestion prefix containing `%`, `_` or `\`** (a merchant's tag "50% off") → it is matched
   literally, never as "every tag". Pinned in **Task 2** (`tagsInUse` raw-SQL test "matches the prefix
   literally" and the in-memory twin).
2. **A whitespace-only note** (" ↵") → saved as no note (the card says "No notes"), and saving the same
   note twice writes no second activity line. Pinned in **Task 1** (`normalizeNote`) and **Task 3**
   (`UpdateOrderNote` "whitespace-only clears" / "same note twice").
3. **Bulk "Add tags" on an order already holding 249 tags while adding 2** → that order fails
   `too_many_tags` with nothing half-applied, and the other selected orders are tagged. Pinned in
   **Task 3** (`AddOrderTags` "too many tags") and **Task 5** (bulk route "too_many_tags").
4. **A deleted comment** → its text is never served again ("Comment deleted"), it cannot be edited
   (409), and deleting it again is a harmless no-op. Pinned in **Task 3** (`EditOrderComment` /
   `DeleteOrderComment`) and **Task 4** (`toTimelineEntryDto` "never serves a deleted body").
5. **A comment id from another order (or another shop) used under this order's URL** → 404, and the
   other order's comment is untouched. Pinned in **Task 3** ("an entry of another order is not found")
   and **Task 4** (route test "PATCH with another order's entry id").

---

## File Structure

**packages/db**

- `prisma/schema/migrations/20261018010000_order_notes_tags_timeline/migration.sql` — `note` column, `order_tags`, `order_timeline_entries`, RLS.
- `prisma/schema/orders.prisma` — `Order.note`, `Order.tags`, `OrderTag`, `OrderTimelineEntry`.
- `src/schema-migration-consistency.test.ts` — asserts the migration matches the models.

**packages/auth**

- `src/role-table-access-control.test.ts` — pins the Part 2 permissions and `comments:moderate` (no code change).

**services/orders**

- `src/domain/order-tags.ts` — limits, `normalizeTag`, `tagKeyOf`, `parseTags`, `normalizeNote`, `sortTags`, `clampSuggestionLimit`, `OrderTag`, `TagUsage`.
- `src/domain/order-timeline.ts` — `OrderTimelineEntry`, kinds, `normalizeCommentBody`, `OrderTimelineRepository` port.
- `src/domain/order-annotations.ts` — widened `OrderAnnotations` and port.
- `src/domain/order-repository.ts` — `OrderListQuery.tags`.
- `src/application/ports.ts` — `StaffDirectoryPort`.
- `src/application/order-activity.ts` — `OrderActivityDeps`, `authorNameOf`, `activityEntry`.
- `src/application/order-annotations.use-cases.ts` — archive activity; `UpdateOrderNote`, `AddOrderTags`, `RemoveOrderTags`, `SuggestOrderTags`.
- `src/application/order-timeline.use-cases.ts` — `AddOrderComment`, `EditOrderComment`, `DeleteOrderComment`, `ListOrderTimeline`.
- `src/infrastructure/order-list-where.ts` — tag relation filter.
- `src/infrastructure/in-memory-order-repository.ts` — note/tags beside the aggregate + tag filter.
- `src/infrastructure/in-memory-order-annotation-repository.ts`, `prisma-order-annotation-repository.ts` — note/tags/suggestions.
- `src/infrastructure/in-memory-order-timeline-repository.ts`, `prisma-order-timeline-repository.ts` — the timeline.
- `src/infrastructure/in-memory-port-adapters.ts` — `InMemoryStaffDirectory`.
- `src/infrastructure/order-list-fixture.ts` — tagged fixture + tag cases for both stores.
- `src/interfaces/order.controller.ts`, `src/composition.ts`, `src/index.ts` — wiring/exports.

**apps/admin**

- `src/infrastructure/cross-context/staff-directory.adapter.ts` — `PrismaStaffDirectoryAdapter`.
- `src/interfaces/admin-guard.ts` — `allows()` probe.
- `src/interfaces/orders.admin-controller.ts` — note/tags/suggestions/comments/timeline methods.
- `src/interfaces/bulk-order-actions.ts` — `add_tags`, `remove_tags`.
- `src/http/order-timeline-dto.ts` — `TimelineEntryDto`, `toTimelineEntryDto`.
- `src/http/order-annotation-routes.ts` — note, tags, `GET /order-tags`, comments.
- `src/http/order-views.ts` — `tagFilterParam()`.
- `src/http/admin-routes.ts` — `tag` filter + `tags` on list items; `note`/`tags`/`timelineEntries` on the detail.
- `src/http/order-bulk-actions.ts`, `order-operations-routes.ts` — bulk tags; export-rows `tag`.
- `src/http/order-export-rows.ts` — fills `tags`/`note`.
- `src/http/testing/orders-harness.ts` — optional staff names.
- `src/composition.ts` — `staffDirectory` dep and the Prisma default.

**apps/admin-web**

- `src/lib/api/orders.ts` — DTO fields, note/tags/suggestions/comments calls, bulk `tags`, list/export `tags`.
- `src/lib/orders/order-tags.ts` — `splitTagInput`, `hasTag`, `parseTagFilter`, limits.
- `src/lib/orders/order-timeline.ts` — `mergeTimeline`, `activityLabel`.
- `src/lib/orders/order-views.ts` — `canEditNote`/`canTag`/`canComment`; tags kept in tab links and export context.
- `src/lib/orders/orders-export.ts` — export carries the tag filter.
- `src/app/orders/annotation-actions.ts` — note/tags/suggestions/comment server actions.
- `src/app/orders/actions.ts` — `runBulkOrderAction(action, ids, tags?)`.
- `src/app/orders/page.tsx`, `src/app/orders/[orderId]/page.tsx`.
- `src/components/orders/tag-input.tsx`, `order-notes-card.tsx`, `order-tags-card.tsx`,
  `order-comment-composer.tsx`, `order-comment-item.tsx`, `orders-bulk-tags-dialog.tsx` (new);
  `order-timeline.tsx`, `orders-table.tsx`, `orders-bulk-bar.tsx`, `orders-toolbar.tsx`,
  `orders-view-tabs.tsx`, `orders-export-dialog.tsx` (modified).
- `src/messages/en.ts`, `src/messages/ar.ts`.

## Commands

- Tests: `pnpm --filter <pkg> test`; one file: `pnpm --filter <pkg> exec vitest run <file>`.
- `pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> lint` (admin-web lint:
  `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint`).
- Packages: `@platform/db`, `@platform/auth`, `@platform/orders`, `@platform/admin`, `admin-web`.
- Prisma (dummy URLs, never a real DB):
  `DATABASE_URL=postgresql://u:p@localhost:5432/x DIRECT_URL=postgresql://u:p@localhost:5432/x pnpm --filter @platform/db exec prisma validate`
  and the same with `prisma generate` after a schema change.
- The Prisma tenant-filter guard runs inside `@platform/db`'s tests
  (`src/prisma-tenant-where.guard.test.ts`): every new `findMany/findFirst/updateMany/deleteMany`
  must name `tenantId` in a literal `where`.

Commit template used by every task (replace subject/body):

```bash
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
<type>(<scope>): <lower-case subject>

<body, lines <= 100 chars>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 1: Storage, the permission pin, and the tag / note / comment rules

Model tier: **standard** (SQL must match Prisma's DDL exactly or CI's drift check fails).

**Files:**

- Create: `packages/db/prisma/schema/migrations/20261018010000_order_notes_tags_timeline/migration.sql`
- Modify: `packages/db/prisma/schema/orders.prisma` (model `Order` and two new models after `OrderShippingAddress`)
- Modify: `packages/db/src/schema-migration-consistency.test.ts` (append a `describe` after the Part 1 one at the end)
- Modify: `packages/auth/src/role-table-access-control.test.ts` (append one `it` inside the last `describe`)
- Create: `services/orders/src/domain/order-tags.ts`, `services/orders/src/domain/order-tags.test.ts`
- Create: `services/orders/src/domain/order-timeline.ts`, `services/orders/src/domain/order-timeline.test.ts`

**Interfaces:**

- Consumes: nothing new (Part 1's `orders.prisma` `Order` model, `columnsEverAddedTo` in the db test).
- Produces:
  - Prisma: `Order.note: String?`, `Order.tags: OrderTag[]`; `model OrderTag { tenantId, orderId, tag, tagKey, createdAt, order }` (`@@id([orderId, tagKey])`); `model OrderTimelineEntry { id, tenantId, orderId, kind, authorRef?, authorName?, body?, data Json, createdAt, editedAt?, deletedAt? }`. Delegates: `client.orderTag`, `client.orderTimelineEntry`.
  - `order-tags.ts`: `MAX_TAG_LENGTH = 40`, `MAX_TAGS_PER_ORDER = 250`, `MAX_NOTE_LENGTH = 5000`, `TAG_SUGGESTION_LIMIT = 50`; `interface OrderTag { readonly tag: string; readonly tagKey: string }`; `interface TagUsage { readonly tag: string; readonly count: number }`; `characterCount(text: string): number`; `normalizeTag(raw: string): string`; `tagKeyOf(raw: string): string`; `parseTags(raw: readonly string[]): Result<readonly OrderTag[], ValidationError>`; `normalizeNote(raw: string | null): Result<string | null, ValidationError>`; `sortTags(tags: readonly string[]): string[]`; `clampSuggestionLimit(limit: number): number`.
  - `order-timeline.ts`: `ORDER_TIMELINE_KINDS`, `type OrderTimelineKind`, `type OrderActivityKind = Exclude<OrderTimelineKind, "comment">`, `MAX_COMMENT_LENGTH = 5000`, `TIMELINE_READ_LIMIT = 200`, `interface OrderTimelineData { tags?; cleared?; draftNumber? }`, `interface OrderTimelineEntry`, `isOrderTimelineKind(value: string): value is OrderTimelineKind`, `normalizeCommentBody(raw: string): Result<string, ValidationError>`, `interface OrderTimelineRepository { append; listForOrder; findById; update }` (exact signatures in Step 9).
  - Permissions pinned: operator/admin hold `orders:edit_note`, `orders:tag`, `orders:comment`; viewer none; only admin holds `comments:moderate`.

- [ ] **Step 1: Write the failing migration test**

Append to `packages/db/src/schema-migration-consistency.test.ts` (after the `"orders schema — order archive (order operations Part 1)"` describe):

```ts
describe("orders schema — notes, tags and timeline (order operations Part 2)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((dir) => readFileSync(join(migrationsDir, dir, "migration.sql"), "utf-8"))
    .join("\n");

  it("a migration adds orders.orders.note", () => {
    expect(columnsEverAddedTo("orders", "orders", allSql).has("note")).toBe(true);
  });

  it("order_tags has the model's columns, its (order, tag_key) key, the tenant tag index and the FK", () => {
    expect([...columnsEverAddedTo("orders", "order_tags", allSql)].sort()).toEqual([
      "created_at",
      "order_id",
      "tag",
      "tag_key",
      "tenant_id",
    ]);
    expect(allSql).toContain('CONSTRAINT "order_tags_pkey" PRIMARY KEY ("order_id", "tag_key")');
    expect(allSql).toContain(
      'CREATE INDEX "order_tags_tenant_id_tag_key_idx" ON "orders"."order_tags"("tenant_id", "tag_key");',
    );
    expect(allSql).toContain(
      'ADD CONSTRAINT "order_tags_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;',
    );
  });

  it("order_timeline_entries has the model's columns and accepts exactly the seven kinds", () => {
    expect([...columnsEverAddedTo("orders", "order_timeline_entries", allSql)].sort()).toEqual([
      "author_name",
      "author_ref",
      "body",
      "created_at",
      "data",
      "deleted_at",
      "edited_at",
      "id",
      "kind",
      "order_id",
      "tenant_id",
    ]);
    expect(allSql).toContain(
      `CHECK ("kind" IN ('comment','archived','unarchived','note_changed','tags_added','tags_removed','created_from_draft'))`,
    );
    expect(allSql).toContain(
      'CREATE INDEX "order_timeline_entries_order_id_created_at_idx" ON "orders"."order_timeline_entries"("order_id", "created_at");',
    );
  });

  it.each(["order_tags", "order_timeline_entries"])(
    "%s is RLS-forced with the tenant_isolation policy",
    (table) => {
      expect(allSql).toContain(`ALTER TABLE "orders"."${table}" ENABLE ROW LEVEL SECURITY;`);
      expect(allSql).toContain(`ALTER TABLE "orders"."${table}" FORCE ROW LEVEL SECURITY;`);
      expect(allSql).toContain(`DROP POLICY IF EXISTS tenant_isolation ON "orders"."${table}";`);
      expect(allSql).toContain(`CREATE POLICY tenant_isolation ON "orders"."${table}" FOR ALL`);
    },
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @platform/db exec vitest run src/schema-migration-consistency.test.ts`
Expected: FAIL — the four new tests (no `note` column, empty column sets, missing strings).

- [ ] **Step 3: Write the migration**

`packages/db/prisma/schema/migrations/20261018010000_order_notes_tags_timeline/migration.sql`:

```sql
-- Order operations Part 2 — the order's staff note, its tags and the staff timeline (comments and
-- annotation activity). Written by hand, NOT applied by the agent; the owner deploys it from Railway's
-- Console BEFORE the release that reads it, after 20261018000000_order_archive. Additive only, no
-- backfill. None of it belongs to the Order aggregate: OrderMapper never writes these columns or
-- tables, so a note, tag or comment never bumps "version" (no conflict with a payment webhook).
ALTER TABLE "orders"."orders" ADD COLUMN "note" TEXT;

-- tag is the spelling as typed (trimmed, inner spaces collapsed); tag_key is lower(tag), the identity
-- used for dedupe, filtering and suggestions.
CREATE TABLE "orders"."order_tags" (
  "tenant_id"  TEXT NOT NULL,
  "order_id"   UUID NOT NULL,
  "tag"        TEXT NOT NULL,
  "tag_key"    TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_tags_pkey" PRIMARY KEY ("order_id", "tag_key")
);
CREATE INDEX "order_tags_tenant_id_tag_key_idx" ON "orders"."order_tags"("tenant_id", "tag_key");
-- The list's tag filter is a Prisma relation filter (EXISTS over order_tags). Prisma models a relation
-- only with its foreign key, and CI's `migrate diff` fails on a relation without one. Orders are never
-- deleted, so RESTRICT (as on order_items and order_events) never fires.
ALTER TABLE "orders"."order_tags" ADD CONSTRAINT "order_tags_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders"."order_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders"."order_tags" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "orders"."order_tags";
CREATE POLICY tenant_isolation ON "orders"."order_tags" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- One table for staff comments and annotation activity ("Ahmed archived this order"). author_name is
-- snapshotted at write time; a deleted comment keeps its row (deleted_at) for the audit trail.
CREATE TABLE "orders"."order_timeline_entries" (
  "id"          UUID NOT NULL,
  "tenant_id"   TEXT NOT NULL,
  "order_id"    UUID NOT NULL,
  "kind"        TEXT NOT NULL,
  "author_ref"  TEXT,
  "author_name" TEXT,
  "body"        TEXT,
  "data"        JSONB NOT NULL DEFAULT '{}',
  "created_at"  TIMESTAMP(3) NOT NULL,
  "edited_at"   TIMESTAMP(3),
  "deleted_at"  TIMESTAMP(3),
  CONSTRAINT "order_timeline_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_timeline_entries_kind_check" CHECK ("kind" IN ('comment','archived','unarchived','note_changed','tags_added','tags_removed','created_from_draft'))
);
CREATE INDEX "order_timeline_entries_order_id_created_at_idx" ON "orders"."order_timeline_entries"("order_id", "created_at");
ALTER TABLE "orders"."order_timeline_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders"."order_timeline_entries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "orders"."order_timeline_entries";
CREATE POLICY tenant_isolation ON "orders"."order_timeline_entries" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
```

- [ ] **Step 4: Update the Prisma models**

In `packages/db/prisma/schema/orders.prisma`, model `Order`: add after the `archivedAt` line

```prisma
  /// Order operations Part 2: the staff note. Outside the aggregate — never written by OrderMapper.
  note           String?
```

and add `tags OrderTag[]` to the relation block (after `events OrderEvent[]`):

```prisma
  items  OrderItem[]
  events OrderEvent[]
  tags   OrderTag[]
```

Append after `model OrderShippingAddress { … }`:

```prisma
/// Order operations Part 2 — one tag on one order. `tag` is the spelling as typed (trimmed, inner
/// spaces collapsed); `tagKey` is its lower-case identity (dedupe, filter, suggestions). Outside the
/// aggregate. The relation exists for the list's tag filter (EXISTS), not for cascading.
model OrderTag {
  tenantId  String   @map("tenant_id")
  orderId   String   @map("order_id") @db.Uuid
  tag       String
  tagKey    String   @map("tag_key")
  createdAt DateTime @default(now()) @map("created_at")

  order Order @relation(fields: [orderId], references: [id], onDelete: Restrict)

  @@id([orderId, tagKey])
  @@index([tenantId, tagKey])
  @@map("order_tags")
  @@schema("orders")
}

/// Order operations Part 2 — staff comments and annotation activity on an order. `kind` is one of
/// comment | archived | unarchived | note_changed | tags_added | tags_removed | created_from_draft
/// (CHECK + domain-enforced). `authorName` is a snapshot. Comments are soft-deleted (`deletedAt`).
model OrderTimelineEntry {
  id         String    @id @db.Uuid
  tenantId   String    @map("tenant_id")
  orderId    String    @map("order_id") @db.Uuid // bare id — never an FK
  kind       String
  authorRef  String?   @map("author_ref")
  authorName String?   @map("author_name")
  body       String?
  data       Json      @default("{}")
  createdAt  DateTime  @map("created_at")
  editedAt   DateTime? @map("edited_at")
  deletedAt  DateTime? @map("deleted_at")

  @@index([orderId, createdAt])
  @@map("order_timeline_entries")
  @@schema("orders")
}
```

- [ ] **Step 5: Run the test, validate and generate**

Run: `pnpm --filter @platform/db exec vitest run src/schema-migration-consistency.test.ts`
Expected: PASS.

Run: `DATABASE_URL=postgresql://u:p@localhost:5432/x DIRECT_URL=postgresql://u:p@localhost:5432/x pnpm --filter @platform/db exec prisma validate`
Expected: "The schemas at prisma/schema are valid".

Run the same with `prisma generate`. Expected: "Generated Prisma Client".

- [ ] **Step 6: Pin the permissions (no code change)**

Append inside the last `describe` of `packages/auth/src/role-table-access-control.test.ts` (the one
holding "operators archive and export orders…"):

```ts
it("operators and admins write notes, tags and comments; viewers only read; only admins moderate comments (orders Part 2)", async () => {
  const op = who(["operator"]);
  const viewer = who(["viewer"]);
  const admin = who(["admin"]);
  for (const permission of ["orders:edit_note", "orders:tag", "orders:comment"]) {
    expect(await acl.authorize(op, permission), permission).toBe(true);
    expect(await acl.authorize(admin, permission), permission).toBe(true);
    expect(await acl.authorize(viewer, permission), permission).toBe(false);
  }
  expect(await acl.authorize(op, "comments:moderate")).toBe(false);
  expect(await acl.authorize(viewer, "comments:moderate")).toBe(false);
  expect(await acl.authorize(admin, "comments:moderate")).toBe(true);
  expect(await acl.authorize(who(["platform-admin"]), "comments:moderate")).toBe(true);
});
```

Run: `pnpm --filter @platform/auth exec vitest run src/role-table-access-control.test.ts`
Expected: PASS (the role table already grants this — the test pins it).

- [ ] **Step 7: Write the failing tag/note rule tests**

`services/orders/src/domain/order-tags.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  characterCount,
  clampSuggestionLimit,
  MAX_NOTE_LENGTH,
  normalizeNote,
  normalizeTag,
  parseTags,
  sortTags,
  tagKeyOf,
} from "./order-tags";

describe("normalizeTag / tagKeyOf", () => {
  it("trims, collapses inner whitespace, and lower-cases only the key", () => {
    expect(normalizeTag("  VIP   Customer\t")).toBe("VIP Customer");
    expect(tagKeyOf("  VIP   Customer\t")).toBe("vip customer");
  });

  it("leaves Arabic as typed (it has no case)", () => {
    expect(tagKeyOf(" عميل   مميز ")).toBe("عميل مميز");
  });

  it("composes to NFC, so the same letters typed two ways are one tag", () => {
    expect(tagKeyOf("Café")).toBe(tagKeyOf("Café"));
  });
});

describe("parseTags", () => {
  it("splits on commas, drops blanks and keeps the first spelling of a case-insensitive duplicate", () => {
    expect(parseTags(["VIP, urgent", " vip ", ",", "Urgent"])).toEqual({
      ok: true,
      value: [
        { tag: "VIP", tagKey: "vip" },
        { tag: "urgent", tagKey: "urgent" },
      ],
    });
  });

  it("counts characters, not UTF-16 units: 40 emoji or Arabic letters fit, 41 letters do not", () => {
    expect(parseTags(["😀".repeat(40)]).ok).toBe(true);
    expect(parseTags(["ب".repeat(40)]).ok).toBe(true);
    const tooLong = parseTags(["ok", "x".repeat(41)]);
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error.code).toBe("VALIDATION");
  });

  it("answers an empty list for only blanks (the caller decides whether that is an error)", () => {
    expect(parseTags([" ", ",", ""])).toEqual({ ok: true, value: [] });
  });
});

describe("normalizeNote", () => {
  it("trims the ends and keeps inner line breaks", () => {
    expect(normalizeNote("  Leave at the door\nRing twice  ")).toEqual({
      ok: true,
      value: "Leave at the door\nRing twice",
    });
  });

  it("turns null, empty and whitespace-only into no note (Review Focus 2)", () => {
    for (const raw of [null, "", "   \n\t "]) {
      expect(normalizeNote(raw)).toEqual({ ok: true, value: null });
    }
  });

  it("allows 5,000 characters and refuses 5,001", () => {
    expect(normalizeNote("a".repeat(MAX_NOTE_LENGTH)).ok).toBe(true);
    const tooLong = normalizeNote("ب".repeat(MAX_NOTE_LENGTH + 1));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error.code).toBe("VALIDATION");
  });
});

describe("sortTags / characterCount / clampSuggestionLimit", () => {
  it("sorts by key (case-insensitive), then by spelling", () => {
    expect(sortTags(["vip", "Urgent", "apple", "VIP"])).toEqual(["apple", "Urgent", "VIP", "vip"]);
  });

  it("counts code points", () => {
    expect(characterCount("😀ب")).toBe(2);
  });

  it("keeps a suggestion limit between 1 and 50", () => {
    expect(clampSuggestionLimit(500)).toBe(50);
    expect(clampSuggestionLimit(0)).toBe(1);
    expect(clampSuggestionLimit(7.9)).toBe(7);
    expect(clampSuggestionLimit(Number.NaN)).toBe(50);
  });
});
```

Run: `pnpm --filter @platform/orders exec vitest run src/domain/order-tags.test.ts`
Expected: FAIL — `Cannot find module './order-tags'`.

- [ ] **Step 8: Implement `order-tags.ts`**

`services/orders/src/domain/order-tags.ts`:

```ts
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

/** Shopify's limits (order operations spec §2.1). Lengths count characters (code points). */
export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS_PER_ORDER = 250;
export const MAX_NOTE_LENGTH = 5000;
/** `GET /order-tags` answers at most this many suggestions. */
export const TAG_SUGGESTION_LIMIT = 50;

/** One tag as stored: the display spelling and its case-insensitive identity (`tag_key`). */
export interface OrderTag {
  readonly tag: string;
  readonly tagKey: string;
}

/** One distinct tag of a shop and how many orders carry it (suggestions). */
export interface TagUsage {
  readonly tag: string;
  readonly count: number;
}

/** Characters as a person counts them: an emoji or an Arabic letter is one. */
export function characterCount(text: string): number {
  return [...text].length;
}

/** The display spelling: NFC, every run of whitespace one space, trimmed. */
export function normalizeTag(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/gu, " ").trim();
}

/** The identity used for dedupe and filtering (`tag_key`): the normalized tag, lower-cased. */
export function tagKeyOf(raw: string): string {
  return normalizeTag(raw).toLowerCase();
}

/**
 * Typed tags → the distinct tags to store. A comma splits one entry into two (Shopify's input rule),
 * blanks are dropped, and tags that differ only in case or spacing collapse to the FIRST spelling.
 * A tag longer than {@link MAX_TAG_LENGTH} characters refuses the whole list (nothing half-applied).
 */
export function parseTags(raw: readonly string[]): Result<readonly OrderTag[], ValidationError> {
  const seen = new Map<string, OrderTag>();
  for (const entry of raw) {
    for (const part of entry.split(",")) {
      const tag = normalizeTag(part);
      if (tag.length === 0) continue;
      if (characterCount(tag) > MAX_TAG_LENGTH) {
        return err(
          new ValidationError(`A tag can have at most ${MAX_TAG_LENGTH} characters`, [
            { field: "tags", message: `must be at most ${MAX_TAG_LENGTH} characters each` },
          ]),
        );
      }
      const tagKey = tag.toLowerCase();
      if (!seen.has(tagKey)) seen.set(tagKey, { tag, tagKey });
    }
  }
  return ok([...seen.values()]);
}

/** A note as stored: ends trimmed, inner line breaks kept; blank → null ("No notes"); ≤ 5,000 characters. */
export function normalizeNote(raw: string | null): Result<string | null, ValidationError> {
  if (raw === null) return ok(null);
  const note = raw.normalize("NFC").trim();
  if (note.length === 0) return ok(null);
  if (characterCount(note) > MAX_NOTE_LENGTH) {
    return err(
      new ValidationError(`A note can have at most ${MAX_NOTE_LENGTH} characters`, [
        { field: "note", message: `must be at most ${MAX_NOTE_LENGTH} characters` },
      ]),
    );
  }
  return ok(note);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** An order's tags in display order: by key (case-insensitive), then by spelling. */
export function sortTags(tags: readonly string[]): string[] {
  return [...tags].sort((a, b) => compareText(tagKeyOf(a), tagKeyOf(b)) || compareText(a, b));
}

/** A requested suggestion count, kept within 1..{@link TAG_SUGGESTION_LIMIT}. */
export function clampSuggestionLimit(limit: number): number {
  if (!Number.isFinite(limit)) return TAG_SUGGESTION_LIMIT;
  return Math.max(1, Math.min(Math.trunc(limit), TAG_SUGGESTION_LIMIT));
}
```

Run: `pnpm --filter @platform/orders exec vitest run src/domain/order-tags.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing timeline rule tests, then the timeline module**

`services/orders/src/domain/order-timeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isOrderTimelineKind,
  MAX_COMMENT_LENGTH,
  normalizeCommentBody,
  ORDER_TIMELINE_KINDS,
} from "./order-timeline";

describe("normalizeCommentBody", () => {
  it("trims the ends and keeps inner line breaks", () => {
    expect(normalizeCommentBody("  Called — no answer\nTry tomorrow ")).toEqual({
      ok: true,
      value: "Called — no answer\nTry tomorrow",
    });
  });

  it("refuses an empty or whitespace-only comment", () => {
    for (const raw of ["", "  \n "]) {
      const result = normalizeCommentBody(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    }
  });

  it("allows 5,000 characters and refuses 5,001", () => {
    expect(normalizeCommentBody("a".repeat(MAX_COMMENT_LENGTH)).ok).toBe(true);
    expect(normalizeCommentBody("a".repeat(MAX_COMMENT_LENGTH + 1)).ok).toBe(false);
  });
});

describe("isOrderTimelineKind", () => {
  it("knows exactly the seven kinds the migration's CHECK allows", () => {
    expect([...ORDER_TIMELINE_KINDS]).toEqual([
      "comment",
      "archived",
      "unarchived",
      "note_changed",
      "tags_added",
      "tags_removed",
      "created_from_draft",
    ]);
    for (const kind of ORDER_TIMELINE_KINDS) expect(isOrderTimelineKind(kind)).toBe(true);
    expect(isOrderTimelineKind("deleted")).toBe(false);
  });
});
```

Run: `pnpm --filter @platform/orders exec vitest run src/domain/order-timeline.test.ts`
Expected: FAIL — `Cannot find module './order-timeline'`.

`services/orders/src/domain/order-timeline.ts`:

```ts
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";
import { characterCount } from "./order-tags";

/** What one timeline line is (order operations spec §2.1) — mirrored by the migration's CHECK. */
export const ORDER_TIMELINE_KINDS = [
  "comment",
  "archived",
  "unarchived",
  "note_changed",
  "tags_added",
  "tags_removed",
  "created_from_draft",
] as const;
export type OrderTimelineKind = (typeof ORDER_TIMELINE_KINDS)[number];
/** Activity lines: written by the annotation use cases, never editable. */
export type OrderActivityKind = Exclude<OrderTimelineKind, "comment">;

export const MAX_COMMENT_LENGTH = 5000;
/** The order page shows the latest this-many entries (spec §2.3). */
export const TIMELINE_READ_LIMIT = 200;

/** The small structured payload of an activity line. */
export interface OrderTimelineData {
  /** tags_added / tags_removed: the tags actually added or removed, as spelled. */
  readonly tags?: readonly string[];
  /** note_changed: true when the note was removed. */
  readonly cleared?: boolean;
  /** created_from_draft (Part 4): "D3". */
  readonly draftNumber?: string;
}

/**
 * One line of an order's staff timeline. Outside the `Order` aggregate. `authorName` is a snapshot
 * taken at write time (renaming a staff member never rewrites history). A deleted comment keeps its
 * row and body for the audit trail; the API never serves that body again.
 */
export interface OrderTimelineEntry {
  readonly id: string;
  readonly orderId: string;
  readonly kind: OrderTimelineKind;
  /** The staff principal id; null for a system line. */
  readonly authorRef: string | null;
  readonly authorName: string | null;
  /** The comment text (kind = comment); null for activity. */
  readonly body: string | null;
  readonly data: OrderTimelineData;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly deletedAt: Date | null;
}

export function isOrderTimelineKind(value: string): value is OrderTimelineKind {
  return (ORDER_TIMELINE_KINDS as readonly string[]).includes(value);
}

/** A comment as stored: ends trimmed, inner line breaks kept; never blank; ≤ 5,000 characters. */
export function normalizeCommentBody(raw: string): Result<string, ValidationError> {
  const body = raw.normalize("NFC").trim();
  if (body.length === 0) {
    return err(
      new ValidationError("Write a comment first", [{ field: "body", message: "is empty" }]),
    );
  }
  if (characterCount(body) > MAX_COMMENT_LENGTH) {
    return err(
      new ValidationError(`A comment can have at most ${MAX_COMMENT_LENGTH} characters`, [
        { field: "body", message: `must be at most ${MAX_COMMENT_LENGTH} characters` },
      ]),
    );
  }
  return ok(body);
}

/** Persistence port for {@link OrderTimelineEntry}. ADR-0014: `tenantId` per call; writes need the unit of work's `tx`. */
export interface OrderTimelineRepository {
  append(entry: OrderTimelineEntry, tenantId: string, tx?: unknown): Promise<void>;
  /** This shop's entries of one order, newest first, at most `first` (≤ {@link TIMELINE_READ_LIMIT}). */
  listForOrder(
    orderId: string,
    tenantId: string,
    options: { readonly first: number },
    tx?: unknown,
  ): Promise<readonly OrderTimelineEntry[]>;
  /** One entry of this shop by id; null for an unknown id or another shop's entry. */
  findById(entryId: string, tenantId: string, tx?: unknown): Promise<OrderTimelineEntry | null>;
  /** Writes ONLY `body`, `editedAt` and `deletedAt` of an existing entry of this shop (an edit or a soft delete). */
  update(entry: OrderTimelineEntry, tenantId: string, tx?: unknown): Promise<void>;
}
```

Run: `pnpm --filter @platform/orders exec vitest run src/domain/order-timeline.test.ts src/domain/order-tags.test.ts`
Expected: PASS.

- [ ] **Step 10: Typecheck, lint, commit**

Run: `pnpm --filter @platform/orders typecheck && pnpm --filter @platform/orders lint && pnpm --filter @platform/db test && pnpm --filter @platform/auth test`
Expected: all PASS.

```bash
git add packages/db/prisma/schema/migrations/20261018010000_order_notes_tags_timeline/migration.sql \
  packages/db/prisma/schema/orders.prisma packages/db/src/schema-migration-consistency.test.ts \
  packages/auth/src/role-table-access-control.test.ts \
  services/orders/src/domain/order-tags.ts services/orders/src/domain/order-tags.test.ts \
  services/orders/src/domain/order-timeline.ts services/orders/src/domain/order-timeline.test.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(db): order notes, tags and timeline storage

Adds orders.note, order_tags (case-insensitive tag_key, FK for the list's EXISTS filter) and
order_timeline_entries with forced RLS, the Prisma models, and the tag, note and comment rules.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Note, tag and timeline repositories (in-memory + Prisma) and the tag list filter

Model tier: **most-capable** (tenant isolation on two new tables, a raw-SQL read, and two stores that must agree).

**Files:**

- Modify: `services/orders/src/domain/order-annotations.ts` (whole file)
- Modify: `services/orders/src/domain/order-repository.ts` (`OrderListQuery`)
- Modify: `services/orders/src/infrastructure/order-list-where.ts`, `order-list-where.test.ts`
- Modify: `services/orders/src/infrastructure/in-memory-order-repository.ts`
- Modify: `services/orders/src/infrastructure/in-memory-order-annotation-repository.ts` (whole file)
- Modify: `services/orders/src/infrastructure/prisma-order-annotation-repository.ts` (whole file), `prisma-order-annotation-repository.test.ts`
- Create: `services/orders/src/infrastructure/in-memory-order-timeline-repository.ts`
- Create: `services/orders/src/infrastructure/prisma-order-timeline-repository.ts`, `prisma-order-timeline-repository.test.ts`
- Modify: `services/orders/src/infrastructure/order-list-fixture.ts`, `in-memory-order-repository.views.test.ts`, `prisma-order-repository.integration.test.ts`
- Create: `services/orders/src/infrastructure/prisma-order-annotations.integration.test.ts`
- Modify: `services/orders/src/infrastructure/prisma-order-repository.archived-at.test.ts`
- Modify: `services/orders/src/infrastructure/tenant-isolation.test.ts`
- Modify: `services/orders/src/application/order-annotations.use-cases.test.ts` (two Part 1 tests the wider type touches)
- Modify: `apps/admin/src/http/order-export-rows.test.ts:112` (one fixture literal)

**Interfaces:**

- Consumes (Task 1): `OrderTag`, `TagUsage`, `tagKeyOf`, `sortTags`, `clampSuggestionLimit`, `TAG_SUGGESTION_LIMIT`, `OrderTimelineEntry`, `OrderTimelineData`, `OrderTimelineRepository`, `isOrderTimelineKind`, `TIMELINE_READ_LIMIT`; Prisma delegates `orderTag`, `orderTimelineEntry`, `Order.note`; Part 1's `uuidsOf`, `InMemoryOrderRepository.hasOrder/archivedAtOf/writeArchivedAt`.
- Produces:
  - `interface OrderAnnotations { readonly archivedAt: Date | null; readonly note: string | null; readonly tags: readonly string[] }` (tags sorted by `sortTags`).
  - `OrderAnnotationRepository` gains:
    `setNote(orderId: string, note: string | null, tenantId: string, tx?: unknown): Promise<boolean>`;
    `addTags(orderIds: readonly string[], tags: readonly OrderTag[], tenantId: string, tx?: unknown): Promise<ReadonlyMap<string, readonly string[]>>` (per order, the spellings it added);
    `removeTags(orderIds: readonly string[], tagKeys: readonly string[], tenantId: string, tx?: unknown): Promise<ReadonlyMap<string, readonly string[]>>` (per order, the stored spellings it removed);
    `tagsInUse(tenantId: string, prefix?: string, limit?: number): Promise<readonly TagUsage[]>`.
  - `OrderListQuery.tags?: readonly string[]` (as typed; matched by `tagKeyOf`, AND).
  - `InMemoryOrderRepository.noteOf/writeNote/tagsOf/writeTags/tagRowsOf`.
  - `InMemoryOrderTimelineRepository`, `PrismaOrderTimelineRepository({ prisma })` implementing `OrderTimelineRepository`.
  - `escapeLike(text: string): string` (exported from `prisma-order-annotation-repository.ts`).
  - `TAGGED_FIXTURE` + four tag cases in `ORDER_LIST_CASES`.

- [ ] **Step 1: Widen the port**

Replace `services/orders/src/domain/order-annotations.ts` with:

```ts
import type { OrderTag, TagUsage } from "./order-tags";

/**
 * What staff record ON an order, outside the `Order` aggregate (order operations, spec §1.2 / §2.1):
 * writing it never bumps the aggregate's `version` and never adds a history row, so it can never
 * conflict with a payment webhook or a fulfillment write.
 */
export interface OrderAnnotations {
  /** When the order was archived (Shopify's reversible Archive); null = not archived. */
  readonly archivedAt: Date | null;
  /** Part 2: the staff note; null = "No notes". */
  readonly note: string | null;
  /** Part 2: the order's tags (display spelling), sorted by key. */
  readonly tags: readonly string[];
}

/** Persistence port for {@link OrderAnnotations}. ADR-0014: `tenantId` per call; writes need the unit of work's `tx`. */
export interface OrderAnnotationRepository {
  /**
   * Sets (a Date) or clears (null) the archive timestamp of those given orders of this shop that are
   * not already in that state, and returns the ids it changed. Unknown ids and other shops' ids are
   * never changed. No version check, no history row.
   */
  setArchived(
    orderIds: readonly string[],
    archivedAt: Date | null,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly string[]>;
  /** The annotations of each given order of this shop; an id missing from the map is not an order of this shop. */
  annotationsOf(
    orderIds: readonly string[],
    tenantId: string,
    tx?: unknown,
  ): Promise<ReadonlyMap<string, OrderAnnotations>>;
  /** Part 2: writes the note of this shop's order; false when this shop has no such order. */
  setNote(orderId: string, note: string | null, tenantId: string, tx?: unknown): Promise<boolean>;
  /**
   * Part 2: adds each tag (by `tagKey`) that each given order of this shop does not carry yet, and
   * answers, per order, the spellings it added (orders that gained nothing are absent). Other shops'
   * and unknown ids are skipped.
   */
  addTags(
    orderIds: readonly string[],
    tags: readonly OrderTag[],
    tenantId: string,
    tx?: unknown,
  ): Promise<ReadonlyMap<string, readonly string[]>>;
  /** Part 2: removes those tag keys from each given order of this shop; per order, the stored spellings it removed. */
  removeTags(
    orderIds: readonly string[],
    tagKeys: readonly string[],
    tenantId: string,
    tx?: unknown,
  ): Promise<ReadonlyMap<string, readonly string[]>>;
  /**
   * Part 2: the shop's distinct tags whose key starts with `prefix` (literal, case-insensitive), most
   * used first then by key, at most `limit` (1..50, default 50). The spelling is the shop's earliest.
   */
  tagsInUse(tenantId: string, prefix?: string, limit?: number): Promise<readonly TagUsage[]>;
}
```

In `services/orders/src/domain/order-repository.ts`, add to `OrderListQuery` after `createdTo`:

```ts
  /** Order operations Part 2: only orders carrying EVERY one of these tags (case-insensitive). */
  readonly tags?: readonly string[];
```

- [ ] **Step 2: Write the failing where-builder tests**

Append inside `describe("orderListWhere (order operations Part 1)", …)` in `order-list-where.test.ts`:

```ts
it("tags → one EXISTS over order_tags per distinct key (AND), case-insensitive, blanks ignored (Part 2)", () => {
  expect(orderListWhere({ tags: [" VIP ", "Urgent", "vip", "  "] }, "t-1", undefined, [])).toEqual({
    tenantId: "t-1",
    AND: [
      { tags: { some: { tenantId: "t-1", tagKey: "vip" } } },
      { tags: { some: { tenantId: "t-1", tagKey: "urgent" } } },
    ],
  });
});

it("an empty tags list adds nothing", () => {
  expect(orderListWhere({ tags: [] }, "t-1", undefined, [])).toEqual({ tenantId: "t-1" });
});
```

Run: `pnpm --filter @platform/orders exec vitest run src/infrastructure/order-list-where.test.ts`
Expected: FAIL — the first new test (no `AND` produced).

- [ ] **Step 3: Add the tag predicate**

In `order-list-where.ts`, import `import { tagKeyOf } from "../domain/order-tags";` and add, right after
the `createdFrom`/`createdTo` block inside `orderListWhere`:

```ts
// Part 2 (spec §2.3): `id IN (SELECT order_id FROM order_tags WHERE tenant_id = $t AND tag_key = $k)`
// per tag, as Prisma relation filters (EXISTS) — exact pages, no scan. Several tags = AND.
for (const tagKey of new Set((query.tags ?? []).map(tagKeyOf))) {
  if (tagKey.length > 0) and.push({ tags: { some: { tenantId, tagKey } } });
}
```

Run the where tests again. Expected: PASS.

- [ ] **Step 4: Keep note and tags beside the in-memory aggregate, and filter by tag**

In `in-memory-order-repository.ts`:

1. Imports: add `import { tagKeyOf, type OrderTag } from "../domain/order-tags";`.
2. Above the class add:

```ts
interface StoredTag extends OrderTag {
  /** Insertion order across the store — the in-memory twin of `created_at` ("first spelling wins"). */
  readonly seq: number;
}

function bucketOf<V>(store: Map<string, Map<string, V>>, tenantId: string): Map<string, V> {
  let bucket = store.get(tenantId);
  if (bucket === undefined) {
    bucket = new Map();
    store.set(tenantId, bucket);
  }
  return bucket;
}
```

3. Inside the class, after `private readonly archived …` add the fields:

```ts
  private readonly notes = new Map<string, Map<string, string>>();
  private readonly tags = new Map<string, Map<string, StoredTag[]>>();
  private tagSeq = 0;
```

and after `writeArchivedAt` add the methods:

```ts
  noteOf(orderId: string, tenantId: string): string | null {
    return this.notes.get(tenantId)?.get(orderId) ?? null;
  }

  /** Sets or clears the note; false when this shop has no such order (an UPDATE that matched no row). */
  writeNote(orderId: string, tenantId: string, note: string | null): boolean {
    if (!this.hasOrder(orderId, tenantId)) return false;
    const bucket = bucketOf(this.notes, tenantId);
    if (note === null) bucket.delete(orderId);
    else bucket.set(orderId, note);
    return true;
  }

  tagsOf(orderId: string, tenantId: string): readonly OrderTag[] {
    return (this.tags.get(tenantId)?.get(orderId) ?? []).map(({ tag, tagKey }) => ({ tag, tagKey }));
  }

  /** Replaces the order's whole tag set; a key it already had keeps its first spelling and time. */
  writeTags(orderId: string, tenantId: string, next: readonly OrderTag[]): boolean {
    if (!this.hasOrder(orderId, tenantId)) return false;
    const bucket = bucketOf(this.tags, tenantId);
    const current = new Map((bucket.get(orderId) ?? []).map((row) => [row.tagKey, row]));
    bucket.set(
      orderId,
      next.map((tag) => current.get(tag.tagKey) ?? { ...tag, seq: (this.tagSeq += 1) }),
    );
    return true;
  }

  /** Every tag row of one shop, with its order and write order (the source of `tagsInUse`). */
  tagRowsOf(tenantId: string): readonly {
    readonly orderId: string;
    readonly tag: string;
    readonly tagKey: string;
    readonly seq: number;
  }[] {
    return [...(this.tags.get(tenantId)?.entries() ?? [])].flatMap(([orderId, rows]) =>
      rows.map((row) => ({ orderId, ...row })),
    );
  }
```

4. In `list`, replace the `filtered` computation with:

```ts
const filtered = sorted.filter((order) => {
  const id = order.id.toString();
  return matchesQuery(order, query, {
    archivedAt: this.archivedAtOf(id, tenantId),
    tagKeys: new Set(this.tagsOf(id, tenantId).map((tag) => tag.tagKey)),
  });
});
```

5. Change `matchesQuery`'s signature (keep every existing check unchanged; they read `archivedAt`):

```ts
function matchesQuery(
  order: Order,
  query: OrderListQuery,
  beside: { readonly archivedAt: Date | null; readonly tagKeys: ReadonlySet<string> },
): boolean {
  const archivedAt = beside.archivedAt;
```

and before its final `return true;` add:

```ts
if (query.tags !== undefined) {
  const wanted = query.tags.map(tagKeyOf).filter((key) => key.length > 0);
  if (!wanted.every((key) => beside.tagKeys.has(key))) return false;
}
```

- [ ] **Step 5: Add the tagged fixture and the shared tag cases**

In `order-list-fixture.ts`, after `ARCHIVED_FIXTURE_KEYS` add:

```ts
/** Part 2: the tags each fixture order carries, as typed (the filter is case-insensitive). */
export const TAGGED_FIXTURE: Readonly<Partial<Record<ListFixtureKey, readonly string[]>>> = {
  openUnpaid: ["VIP", "Urgent"],
  paid: ["vip"],
  cancelled: ["urgent"],
};
```

and append to `ORDER_LIST_CASES`:

```ts
  {
    name: "tags matches a tag case-insensitively (Part 2)",
    query: () => ({ tags: ["Vip"] }),
    expected: ["openUnpaid", "paid"],
  },
  {
    name: "several tags must all match (AND)",
    query: () => ({ tags: ["vip", "URGENT"] }),
    expected: ["openUnpaid"],
  },
  {
    name: "a tag no order carries matches nothing",
    query: () => ({ tags: ["nobody"] }),
    expected: [],
  },
  {
    name: "the tag filter combines with a tab's predicates",
    query: () => ({ tags: ["urgent"], open: true }),
    expected: ["openUnpaid"],
  },
```

In `in-memory-order-repository.views.test.ts`: import `TAGGED_FIXTURE` from `./order-list-fixture` and
`parseTags` from `../domain/order-tags`, and in `seeded()` after the archive loop add:

```ts
for (const [key, tags] of Object.entries(TAGGED_FIXTURE) as [ListFixtureKey, readonly string[]][]) {
  const parsed = parseTags(tags);
  if (!parsed.ok) throw new Error("fixture tags");
  repository.writeTags(idOf(key), TENANT, parsed.value);
}
```

and append inside the describe:

```ts
it("save() never clears a note or tags (Part 2)", async () => {
  const { repository, idOf } = await seeded();
  const id = idOf("openUnpaid");
  repository.writeNote(id, TENANT, "Ring twice");
  const order = await repository.findById(id, TENANT);
  if (order === null) throw new Error("setup");
  await repository.save(order, TENANT);
  expect(repository.noteOf(id, TENANT)).toBe("Ring twice");
  expect(repository.tagsOf(id, TENANT).map((tag) => tag.tag)).toEqual(["VIP", "Urgent"]);
});
```

In `prisma-order-repository.integration.test.ts`: import `TAGGED_FIXTURE` and `parseTags` the same way
and, in the views `beforeAll` after the archived loop, add:

```ts
for (const [key, tags] of Object.entries(TAGGED_FIXTURE) as [ListFixtureKey, readonly string[]][]) {
  const parsed = parseTags(tags);
  if (!parsed.ok) throw new Error("fixture tags");
  await prisma.orderTag.createMany({
    data: parsed.value.map((tag) => ({ tenantId, orderId: idOf(key), ...tag })),
  });
}
```

Run: `pnpm --filter @platform/orders exec vitest run src/infrastructure/in-memory-order-repository.views.test.ts`
Expected: PASS (all shared cases incl. the four tag cases; the Prisma suite skips without `DATABASE_URL_TEST`).

- [ ] **Step 6: Write the failing Prisma annotation repository tests**

Append to `prisma-order-annotation-repository.test.ts` (it already imports `createFakePrisma`,
`TransactionClient` and the repository; add `import type { Database } from "@platform/db";` and
`escapeLike` to the repository import):

```ts
const OTHER = "01900000-0000-7000-8000-00000000000b";
const THEIRS = "01900000-0000-7000-8000-00000000000c";

async function tagged() {
  const fake = createFakePrisma();
  for (const [id, tenantId] of [
    [ORDER, TENANT],
    [OTHER, TENANT],
    [THEIRS, "tenant-b"],
  ] as const) {
    await fake.database.order.create({
      data: { id, tenantId, archivedAt: null, note: null } as never,
    });
  }
  const repository = new PrismaOrderAnnotationRepository({ prisma: fake.database });
  return { fake, repository, tx: fake.database };
}

describe("PrismaOrderAnnotationRepository note and tags (Part 2, over fake-prisma)", () => {
  it("setNote writes the note of this shop's order and answers false for another shop's", async () => {
    const { repository, tx } = await tagged();
    expect(await repository.setNote(ORDER, "Ring twice", TENANT, tx)).toBe(true);
    expect(await repository.setNote(THEIRS, "mine now", TENANT, tx)).toBe(false);
    expect(await repository.setNote("not-a-uuid", "x", TENANT, tx)).toBe(false);
    expect((await repository.annotationsOf([ORDER], TENANT, tx)).get(ORDER)?.note).toBe(
      "Ring twice",
    );
  });

  it("addTags adds only missing keys, skips other shops' orders, and answers what it added", async () => {
    const { fake, repository, tx } = await tagged();
    await repository.addTags([ORDER], [{ tag: "VIP", tagKey: "vip" }], TENANT, tx);
    const added = await repository.addTags(
      [ORDER, OTHER, THEIRS],
      [
        { tag: "vip", tagKey: "vip" },
        { tag: "Urgent", tagKey: "urgent" },
      ],
      TENANT,
      tx,
    );
    expect([...added]).toEqual([
      [ORDER, ["Urgent"]],
      [OTHER, ["vip", "Urgent"]],
    ]);
    expect(fake.rowsOf("orderTag").filter((row) => row["orderId"] === THEIRS)).toEqual([]);
    expect((await repository.annotationsOf([ORDER], TENANT, tx)).get(ORDER)?.tags).toEqual([
      "Urgent",
      "VIP",
    ]);
  });

  it("removeTags removes by key and answers the stored spellings", async () => {
    const { repository, tx } = await tagged();
    await repository.addTags([ORDER], [{ tag: "VIP", tagKey: "vip" }], TENANT, tx);
    expect([...(await repository.removeTags([ORDER, OTHER], ["vip"], TENANT, tx))]).toEqual([
      [ORDER, ["VIP"]],
    ]);
    expect((await repository.removeTags([ORDER], ["vip"], TENANT, tx)).size).toBe(0);
  });

  it("writes need the unit of work's transaction", async () => {
    const { repository } = await tagged();
    await expect(repository.setNote(ORDER, "x", TENANT)).rejects.toThrow(/transaction/);
    await expect(repository.addTags([ORDER], [{ tag: "a", tagKey: "a" }], TENANT)).rejects.toThrow(
      /transaction/,
    );
    await expect(repository.removeTags([ORDER], ["a"], TENANT)).rejects.toThrow(/transaction/);
  });
});

describe("escapeLike", () => {
  it("escapes the LIKE wildcards and the escape character itself", () => {
    expect(escapeLike("50%_off\\x")).toBe("50\\%\\_off\\\\x");
  });
});

describe("PrismaOrderAnnotationRepository.tagsInUse (raw SQL)", () => {
  function rawDatabase(answer: readonly Record<string, unknown>[]) {
    const calls: { sql: string; values: unknown[] }[] = [];
    const client = {
      $executeRaw: async () => 0,
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ sql: strings.join("?").replace(/\s+/g, " "), values });
        return answer;
      },
    };
    const database = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
    } as unknown as Database;
    return { database, calls };
  }

  it("scopes to the tenant, matches the prefix literally and caps the limit at 50 (Review Focus 1)", async () => {
    const { database, calls } = rawDatabase([{ tag: "50% off", count: 3 }]);
    const repository = new PrismaOrderAnnotationRepository({ prisma: database });
    expect(await repository.tagsInUse("tenant-a", "  50%_Off\\ ", 500)).toEqual([
      { tag: "50% off", count: 3 },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('"tenant_id" = ?');
    expect(calls[0]?.sql).toContain("ESCAPE");
    expect(calls[0]?.values).toEqual(["tenant-a", "50\\%\\_off\\\\%", 50]);
  });

  it("with no prefix asks for every tag of the shop", async () => {
    const { database, calls } = rawDatabase([]);
    await new PrismaOrderAnnotationRepository({ prisma: database }).tagsInUse("tenant-a");
    expect(calls[0]?.values).toEqual(["tenant-a", "%", 50]);
  });
});
```

Run: `pnpm --filter @platform/orders exec vitest run src/infrastructure/prisma-order-annotation-repository.test.ts`
Expected: FAIL — `setNote is not a function` / `escapeLike` is not exported.

- [ ] **Step 7: Implement the Prisma annotation repository**

Replace `prisma-order-annotation-repository.ts` with:

```ts
import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { OrderAnnotationRepository, OrderAnnotations } from "../domain/order-annotations";
import {
  clampSuggestionLimit,
  sortTags,
  TAG_SUGGESTION_LIMIT,
  tagKeyOf,
  type OrderTag,
  type TagUsage,
} from "../domain/order-tags";
import { uuidsOf } from "./order-list-where";

export interface PrismaOrderAnnotationRepositoryDeps {
  readonly prisma: Database;
}

/** `LIKE` treats `%`, `_` and `\` specially; a typed prefix must match literally (Review Focus 1). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function writeClient(tx: unknown, method: string): TransactionClient {
  if (tx === undefined || tx === null) {
    throw new Error(
      `PrismaOrderAnnotationRepository.${method} requires the unit of work's transaction client (ADR-0003).`,
    );
  }
  return tx as TransactionClient;
}

interface TagUsageRow {
  readonly tag: string;
  readonly count: number | bigint;
}

/**
 * Production {@link OrderAnnotationRepository}: `orders.orders.archived_at` / `note` and
 * `orders.order_tags`, each a plain tenant-scoped write — no `version` condition, no history row, no
 * outbox event (spec §1.2, §2.1). Writes need the unit of work's `tx`; reads use it when given, else
 * `runReadScoped` (ADR-0014).
 */
export class PrismaOrderAnnotationRepository implements OrderAnnotationRepository {
  private readonly deps: PrismaOrderAnnotationRepositoryDeps;

  constructor(deps: PrismaOrderAnnotationRepositoryDeps) {
    this.deps = deps;
  }

  async setArchived(
    orderIds: readonly string[],
    archivedAt: Date | null,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly string[]> {
    const client = writeClient(tx, "setArchived");
    const ids = uuidsOf(orderIds);
    if (ids.length === 0) return [];
    // The target-state condition lives IN the UPDATE, so under concurrency exactly one writer's guarded
    // update matches a row: the loser affects 0 rows, reports it unchanged and cannot overwrite the
    // winner's timestamp. One guarded update per id because `updateMany` only returns a count.
    const targetState = archivedAt === null ? { not: null } : null;
    const changed: string[] = [];
    for (const id of ids) {
      const { count } = await client.order.updateMany({
        where: { tenantId, id, archivedAt: targetState },
        data: { archivedAt },
      });
      if (count > 0) changed.push(id);
    }
    return changed;
  }

  async annotationsOf(
    orderIds: readonly string[],
    tenantId: string,
    tx?: unknown,
  ): Promise<ReadonlyMap<string, OrderAnnotations>> {
    const ids = uuidsOf(orderIds);
    if (ids.length === 0) return new Map();
    const read = async (client: TransactionClient) => {
      const orders = await client.order.findMany({
        where: { tenantId, id: { in: ids } },
        select: { id: true, archivedAt: true, note: true },
      });
      const tags =
        orders.length === 0
          ? []
          : await client.orderTag.findMany({
              where: { tenantId, orderId: { in: orders.map((order) => order.id) } },
              select: { orderId: true, tag: true },
            });
      return { orders, tags };
    };
    const { orders, tags } =
      tx !== undefined && tx !== null
        ? await read(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, read);
    const tagsByOrder = new Map<string, string[]>();
    for (const row of tags) {
      tagsByOrder.set(row.orderId, [...(tagsByOrder.get(row.orderId) ?? []), row.tag]);
    }
    return new Map(
      orders.map((row) => [
        row.id,
        {
          archivedAt: row.archivedAt ?? null,
          note: row.note ?? null,
          tags: sortTags(tagsByOrder.get(row.id) ?? []),
        },
      ]),
    );
  }

  async setNote(
    orderId: string,
    note: string | null,
    tenantId: string,
    tx?: unknown,
  ): Promise<boolean> {
    const client = writeClient(tx, "setNote");
    const [id] = uuidsOf([orderId]);
    if (id === undefined) return false;
    const { count } = await client.order.updateMany({ where: { tenantId, id }, data: { note } });
    return count > 0;
  }

  async addTags(
    orderIds: readonly string[],
    tags: readonly OrderTag[],
    tenantId: string,
    tx?: unknown,
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    const client = writeClient(tx, "addTags");
    const ids = await this.ownedIds(client, orderIds, tenantId);
    if (ids.length === 0 || tags.length === 0) return new Map();
    const existing = await client.orderTag.findMany({
      where: { tenantId, orderId: { in: ids }, tagKey: { in: tags.map((tag) => tag.tagKey) } },
      select: { orderId: true, tagKey: true },
    });
    const present = new Set(existing.map((row) => `${row.orderId}\u0000${row.tagKey}`));
    const added = new Map<string, string[]>();
    const rows: { tenantId: string; orderId: string; tag: string; tagKey: string }[] = [];
    for (const orderId of ids) {
      for (const { tag, tagKey } of tags) {
        if (present.has(`${orderId}\u0000${tagKey}`)) continue;
        rows.push({ tenantId, orderId, tag, tagKey });
        added.set(orderId, [...(added.get(orderId) ?? []), tag]);
      }
    }
    // ON CONFLICT DO NOTHING: a concurrent add of the same tag never fails this call.
    if (rows.length > 0) await client.orderTag.createMany({ data: rows, skipDuplicates: true });
    return added;
  }

  async removeTags(
    orderIds: readonly string[],
    tagKeys: readonly string[],
    tenantId: string,
    tx?: unknown,
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    const client = writeClient(tx, "removeTags");
    const ids = uuidsOf(orderIds);
    const keys = [...new Set(tagKeys)];
    if (ids.length === 0 || keys.length === 0) return new Map();
    const rows = await client.orderTag.findMany({
      where: { tenantId, orderId: { in: ids }, tagKey: { in: keys } },
      select: { orderId: true, tag: true },
    });
    if (rows.length === 0) return new Map();
    await client.orderTag.deleteMany({
      where: { tenantId, orderId: { in: ids }, tagKey: { in: keys } },
    });
    const removed = new Map<string, string[]>();
    for (const row of rows)
      removed.set(row.orderId, [...(removed.get(row.orderId) ?? []), row.tag]);
    return removed;
  }

  async tagsInUse(
    tenantId: string,
    prefix = "",
    limit = TAG_SUGGESTION_LIMIT,
  ): Promise<readonly TagUsage[]> {
    const pattern = `${escapeLike(tagKeyOf(prefix))}%`;
    const take = clampSuggestionLimit(limit);
    // Tenant-filtered in the SQL itself (raw queries are outside the Prisma where-guard). The spelling
    // shown is the shop's EARLIEST row of the key; ties order by key in byte order, like the in-memory twin.
    const rows = await runReadScoped(
      this.deps.prisma,
      tenantId,
      (client) => client.$queryRaw<TagUsageRow[]>`
        SELECT (ARRAY_AGG("tag" ORDER BY "created_at", "tag"))[1] AS "tag", COUNT(*)::int AS "count"
        FROM "orders"."order_tags"
        WHERE "tenant_id" = ${tenantId} AND "tag_key" LIKE ${pattern} ESCAPE '\\'
        GROUP BY "tag_key"
        ORDER BY COUNT(*) DESC, "tag_key" COLLATE "C" ASC
        LIMIT ${take}`,
    );
    return rows.map((row) => ({ tag: row.tag, count: Number(row.count) }));
  }

  /** The ids among `orderIds` that are orders of THIS shop — tag rows are only ever written for those. */
  private async ownedIds(
    client: TransactionClient,
    orderIds: readonly string[],
    tenantId: string,
  ): Promise<string[]> {
    const ids = uuidsOf(orderIds);
    if (ids.length === 0) return [];
    const rows = await client.order.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true },
    });
    const owned = new Set(rows.map((row) => row.id));
    return ids.filter((id) => owned.has(id));
  }
}
```

Run: `pnpm --filter @platform/orders exec vitest run src/infrastructure/prisma-order-annotation-repository.test.ts`
Expected: PASS (Part 1's tests included).

- [ ] **Step 8: Implement the in-memory annotation repository**

Replace `in-memory-order-annotation-repository.ts` with:

```ts
import type { OrderAnnotationRepository, OrderAnnotations } from "../domain/order-annotations";
import {
  clampSuggestionLimit,
  sortTags,
  TAG_SUGGESTION_LIMIT,
  tagKeyOf,
  type OrderTag,
  type TagUsage,
} from "../domain/order-tags";
import type { InMemoryOrderRepository } from "./in-memory-order-repository";

export interface InMemoryOrderAnnotationRepositoryDeps {
  /** The order store whose rows the annotations sit beside (the "columns" and the tag rows live there). */
  readonly orders: Pick<
    InMemoryOrderRepository,
    | "hasOrder"
    | "archivedAtOf"
    | "writeArchivedAt"
    | "noteOf"
    | "writeNote"
    | "tagsOf"
    | "writeTags"
    | "tagRowsOf"
  >;
}

/** In-memory {@link OrderAnnotationRepository}, mirroring `PrismaOrderAnnotationRepository`. */
export class InMemoryOrderAnnotationRepository implements OrderAnnotationRepository {
  private readonly orders: InMemoryOrderAnnotationRepositoryDeps["orders"];

  constructor(deps: InMemoryOrderAnnotationRepositoryDeps) {
    this.orders = deps.orders;
  }

  async setArchived(
    orderIds: readonly string[],
    archivedAt: Date | null,
    tenantId: string,
  ): Promise<readonly string[]> {
    const changed: string[] = [];
    for (const orderId of new Set(orderIds)) {
      if (!this.orders.hasOrder(orderId, tenantId)) continue;
      const isArchived = this.orders.archivedAtOf(orderId, tenantId) !== null;
      if (isArchived === (archivedAt !== null)) continue;
      this.orders.writeArchivedAt(orderId, tenantId, archivedAt);
      changed.push(orderId);
    }
    return changed;
  }

  async annotationsOf(
    orderIds: readonly string[],
    tenantId: string,
  ): Promise<ReadonlyMap<string, OrderAnnotations>> {
    const found = new Map<string, OrderAnnotations>();
    for (const orderId of new Set(orderIds)) {
      if (!this.orders.hasOrder(orderId, tenantId)) continue;
      found.set(orderId, {
        archivedAt: this.orders.archivedAtOf(orderId, tenantId),
        note: this.orders.noteOf(orderId, tenantId),
        tags: sortTags(this.orders.tagsOf(orderId, tenantId).map((tag) => tag.tag)),
      });
    }
    return found;
  }

  async setNote(orderId: string, note: string | null, tenantId: string): Promise<boolean> {
    return this.orders.writeNote(orderId, tenantId, note);
  }

  async addTags(
    orderIds: readonly string[],
    tags: readonly OrderTag[],
    tenantId: string,
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    const added = new Map<string, readonly string[]>();
    for (const orderId of new Set(orderIds)) {
      if (!this.orders.hasOrder(orderId, tenantId)) continue;
      const current = this.orders.tagsOf(orderId, tenantId);
      const keys = new Set(current.map((tag) => tag.tagKey));
      const fresh = tags.filter((tag) => !keys.has(tag.tagKey));
      if (fresh.length === 0) continue;
      this.orders.writeTags(orderId, tenantId, [...current, ...fresh]);
      added.set(
        orderId,
        fresh.map((tag) => tag.tag),
      );
    }
    return added;
  }

  async removeTags(
    orderIds: readonly string[],
    tagKeys: readonly string[],
    tenantId: string,
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    const keys = new Set(tagKeys);
    const removed = new Map<string, readonly string[]>();
    for (const orderId of new Set(orderIds)) {
      if (!this.orders.hasOrder(orderId, tenantId)) continue;
      const current = this.orders.tagsOf(orderId, tenantId);
      const gone = current.filter((tag) => keys.has(tag.tagKey));
      if (gone.length === 0) continue;
      this.orders.writeTags(
        orderId,
        tenantId,
        current.filter((tag) => !keys.has(tag.tagKey)),
      );
      removed.set(
        orderId,
        gone.map((tag) => tag.tag),
      );
    }
    return removed;
  }

  async tagsInUse(
    tenantId: string,
    prefix = "",
    limit = TAG_SUGGESTION_LIMIT,
  ): Promise<readonly TagUsage[]> {
    // startsWith is literal: "%" or "_" in the prefix match only themselves, like the escaped LIKE.
    const start = tagKeyOf(prefix);
    const byKey = new Map<string, { tag: string; seq: number; count: number }>();
    for (const row of this.orders.tagRowsOf(tenantId)) {
      if (!row.tagKey.startsWith(start)) continue;
      const seen = byKey.get(row.tagKey);
      byKey.set(
        row.tagKey,
        seen === undefined
          ? { tag: row.tag, seq: row.seq, count: 1 }
          : {
              tag: row.seq < seen.seq ? row.tag : seen.tag,
              seq: Math.min(row.seq, seen.seq),
              count: seen.count + 1,
            },
      );
    }
    return [...byKey.entries()]
      .sort(([keyA, a], [keyB, b]) => b.count - a.count || (keyA < keyB ? -1 : keyA > keyB ? 1 : 0))
      .slice(0, clampSuggestionLimit(limit))
      .map(([, usage]) => ({ tag: usage.tag, count: usage.count }));
  }
}
```

Add a literal-prefix twin to the in-memory side, appended to
`in-memory-order-repository.views.test.ts`:

```ts
it("tagsInUse matches a typed prefix literally — '%' is not a wildcard (Review Focus 1)", async () => {
  const { repository, idOf } = await seeded();
  const annotations = new InMemoryOrderAnnotationRepository({ orders: repository });
  await annotations.addTags([idOf("paid")], [{ tag: "50% off", tagKey: "50% off" }], TENANT);
  expect(await annotations.tagsInUse(TENANT, "%")).toEqual([]);
  expect(await annotations.tagsInUse(TENANT, "50%")).toEqual([{ tag: "50% off", count: 1 }]);
  expect(await annotations.tagsInUse(TENANT, "v")).toEqual([{ tag: "VIP", count: 2 }]);
});
```

(import `InMemoryOrderAnnotationRepository` from `./in-memory-order-annotation-repository`; "VIP" on
`openUnpaid` was written before "vip" on `paid`, so the earliest spelling is "VIP").

Run: `pnpm --filter @platform/orders exec vitest run src/infrastructure/in-memory-order-repository.views.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing timeline repository tests, then both timeline repositories**

`services/orders/src/infrastructure/prisma-order-timeline-repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import type { OrderTimelineEntry, OrderTimelineRepository } from "../domain/order-timeline";
import { InMemoryOrderTimelineRepository } from "./in-memory-order-timeline-repository";
import { PrismaOrderTimelineRepository } from "./prisma-order-timeline-repository";

const TENANT = "tenant-a";
const ORDER = "01900000-0000-7000-8000-00000000000a";
const id = (n: number) => `01900000-0000-7000-8000-0000000001${n.toString().padStart(2, "0")}`;

function comment(n: number, overrides: Partial<OrderTimelineEntry> = {}): OrderTimelineEntry {
  return {
    id: id(n),
    orderId: ORDER,
    kind: "comment",
    authorRef: "staff-1",
    authorName: "Ahmed",
    body: `comment ${n}`,
    data: {},
    createdAt: new Date(Date.UTC(2026, 9, 19, 9, n)),
    editedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function layers(): readonly [string, OrderTimelineRepository, unknown][] {
  const fake = createFakePrisma();
  return [
    [
      "prisma over fake-prisma",
      new PrismaOrderTimelineRepository({ prisma: fake.database }),
      fake.database,
    ],
    ["in-memory", new InMemoryOrderTimelineRepository(), undefined],
  ];
}

describe("order timeline repositories (Part 2)", () => {
  it("lists one order's entries newest first, and finds one by id", async () => {
    for (const [layer, timeline, tx] of layers()) {
      await timeline.append(comment(1), TENANT, tx);
      await timeline.append(
        comment(3, { kind: "tags_added", body: null, data: { tags: ["VIP"] } }),
        TENANT,
        tx,
      );
      await timeline.append(comment(2), TENANT, tx);
      const listed = await timeline.listForOrder(ORDER, TENANT, { first: 200 }, tx);
      expect(
        listed.map((entry) => entry.id),
        layer,
      ).toEqual([id(3), id(2), id(1)]);
      expect(listed[0]?.data, layer).toEqual({ tags: ["VIP"] });
      expect(await timeline.findById(id(2), TENANT, tx), layer).toEqual(comment(2));
    }
  });

  it("update writes only body, editedAt and deletedAt", async () => {
    for (const [layer, timeline, tx] of layers()) {
      await timeline.append(comment(1), TENANT, tx);
      const edited = new Date(Date.UTC(2026, 9, 19, 10, 0));
      await timeline.update(
        {
          ...comment(1),
          body: "edited",
          editedAt: edited,
          authorName: "Someone else",
          kind: "archived",
        },
        TENANT,
        tx,
      );
      expect(await timeline.findById(id(1), TENANT, tx), layer).toEqual({
        ...comment(1),
        body: "edited",
        editedAt: edited,
      });
    }
  });

  it("an id that is not a uuid finds nothing and lists nothing (no query error)", async () => {
    for (const [layer, timeline, tx] of layers()) {
      expect(await timeline.findById("nope", TENANT, tx), layer).toBeNull();
      expect(await timeline.listForOrder("nope", TENANT, { first: 200 }, tx), layer).toEqual([]);
    }
  });

  it("the Prisma writes need the unit of work's transaction", async () => {
    const fake = createFakePrisma();
    const timeline = new PrismaOrderTimelineRepository({ prisma: fake.database });
    await expect(timeline.append(comment(1), TENANT)).rejects.toThrow(/transaction/);
    await expect(timeline.update(comment(1), TENANT)).rejects.toThrow(/transaction/);
  });
});
```

Run: `pnpm --filter @platform/orders exec vitest run src/infrastructure/prisma-order-timeline-repository.test.ts`
Expected: FAIL — modules not found.

`services/orders/src/infrastructure/in-memory-order-timeline-repository.ts`:

```ts
import {
  TIMELINE_READ_LIMIT,
  type OrderTimelineEntry,
  type OrderTimelineRepository,
} from "../domain/order-timeline";

function newestFirst(a: OrderTimelineEntry, b: OrderTimelineEntry): number {
  return b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** In-memory {@link OrderTimelineRepository}, keyed by `(tenantId, entryId)`; mirrors the Prisma one. */
export class InMemoryOrderTimelineRepository implements OrderTimelineRepository {
  private readonly store = new Map<string, Map<string, OrderTimelineEntry>>();

  async append(entry: OrderTimelineEntry, tenantId: string): Promise<void> {
    let bucket = this.store.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.store.set(tenantId, bucket);
    }
    bucket.set(entry.id, entry);
  }

  async listForOrder(
    orderId: string,
    tenantId: string,
    options: { readonly first: number },
  ): Promise<readonly OrderTimelineEntry[]> {
    const take = Math.max(1, Math.min(Math.trunc(options.first), TIMELINE_READ_LIMIT));
    return [...(this.store.get(tenantId)?.values() ?? [])]
      .filter((entry) => entry.orderId === orderId)
      .sort(newestFirst)
      .slice(0, take);
  }

  async findById(entryId: string, tenantId: string): Promise<OrderTimelineEntry | null> {
    return this.store.get(tenantId)?.get(entryId) ?? null;
  }

  async update(entry: OrderTimelineEntry, tenantId: string): Promise<void> {
    const bucket = this.store.get(tenantId);
    const current = bucket?.get(entry.id);
    if (bucket === undefined || current === undefined) return;
    bucket.set(entry.id, {
      ...current,
      body: entry.body,
      editedAt: entry.editedAt,
      deletedAt: entry.deletedAt,
    });
  }
}
```

(The in-memory store accepts any id string — the use-case tests use readable ids like `entry-1`.)

`services/orders/src/infrastructure/prisma-order-timeline-repository.ts`:

```ts
import type { Prisma } from "@prisma/client";
import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import { UnexpectedError } from "@platform/utils";
import {
  isOrderTimelineKind,
  TIMELINE_READ_LIMIT,
  type OrderTimelineData,
  type OrderTimelineEntry,
  type OrderTimelineRepository,
} from "../domain/order-timeline";
import { uuidsOf } from "./order-list-where";

export interface PrismaOrderTimelineRepositoryDeps {
  readonly prisma: Database;
}

interface TimelineRow {
  readonly id: string;
  readonly orderId: string;
  readonly kind: string;
  readonly authorRef: string | null;
  readonly authorName: string | null;
  readonly body: string | null;
  readonly data: unknown;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly deletedAt: Date | null;
}

function writeClient(tx: unknown, method: string): TransactionClient {
  if (tx === undefined || tx === null) {
    throw new Error(
      `PrismaOrderTimelineRepository.${method} requires the unit of work's transaction client (ADR-0003).`,
    );
  }
  return tx as TransactionClient;
}

/** Reads only the known keys of the JSONB payload; anything else is ignored. */
function readData(value: unknown): OrderTimelineData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const tags = raw["tags"];
  const cleared = raw["cleared"];
  const draftNumber = raw["draftNumber"];
  return {
    ...(Array.isArray(tags)
      ? { tags: tags.filter((tag): tag is string => typeof tag === "string") }
      : {}),
    ...(typeof cleared === "boolean" ? { cleared } : {}),
    ...(typeof draftNumber === "string" ? { draftNumber } : {}),
  };
}

function toEntry(row: TimelineRow): OrderTimelineEntry {
  if (!isOrderTimelineKind(row.kind)) {
    throw new UnexpectedError(
      `Corrupt order data: timeline entry ${row.id} has kind "${row.kind}"`,
    );
  }
  return {
    id: row.id,
    orderId: row.orderId,
    kind: row.kind,
    authorRef: row.authorRef ?? null,
    authorName: row.authorName ?? null,
    body: row.body ?? null,
    data: readData(row.data),
    createdAt: row.createdAt,
    editedAt: row.editedAt ?? null,
    deletedAt: row.deletedAt ?? null,
  };
}

function newestFirst(a: OrderTimelineEntry, b: OrderTimelineEntry): number {
  return b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** Production {@link OrderTimelineRepository} on `orders.order_timeline_entries` (tenant-scoped, ADR-0014). */
export class PrismaOrderTimelineRepository implements OrderTimelineRepository {
  private readonly deps: PrismaOrderTimelineRepositoryDeps;

  constructor(deps: PrismaOrderTimelineRepositoryDeps) {
    this.deps = deps;
  }

  async append(entry: OrderTimelineEntry, tenantId: string, tx?: unknown): Promise<void> {
    const client = writeClient(tx, "append");
    await client.orderTimelineEntry.create({
      data: {
        id: entry.id,
        tenantId,
        orderId: entry.orderId,
        kind: entry.kind,
        authorRef: entry.authorRef,
        authorName: entry.authorName,
        body: entry.body,
        data: entry.data as unknown as Prisma.InputJsonValue,
        createdAt: entry.createdAt,
        editedAt: entry.editedAt,
        deletedAt: entry.deletedAt,
      },
    });
  }

  async listForOrder(
    orderId: string,
    tenantId: string,
    options: { readonly first: number },
    tx?: unknown,
  ): Promise<readonly OrderTimelineEntry[]> {
    const [id] = uuidsOf([orderId]);
    if (id === undefined) return [];
    const take = Math.max(1, Math.min(Math.trunc(options.first), TIMELINE_READ_LIMIT));
    const read = (client: TransactionClient) =>
      client.orderTimelineEntry.findMany({
        where: { tenantId, orderId: id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await read(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, read);
    return rows.map(toEntry).sort(newestFirst);
  }

  async findById(
    entryId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<OrderTimelineEntry | null> {
    const [id] = uuidsOf([entryId]);
    if (id === undefined) return null;
    const read = (client: TransactionClient) =>
      client.orderTimelineEntry.findFirst({ where: { tenantId, id } });
    const row =
      tx !== undefined && tx !== null
        ? await read(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, read);
    return row === null ? null : toEntry(row);
  }

  async update(entry: OrderTimelineEntry, tenantId: string, tx?: unknown): Promise<void> {
    const client = writeClient(tx, "update");
    await client.orderTimelineEntry.updateMany({
      where: { tenantId, id: entry.id },
      data: { body: entry.body, editedAt: entry.editedAt, deletedAt: entry.deletedAt },
    });
  }
}
```

Run: `pnpm --filter @platform/orders exec vitest run src/infrastructure/prisma-order-timeline-repository.test.ts`
Expected: PASS.

- [ ] **Step 10: Pin "outside the aggregate" for note and tags**

Append inside `describe("archive stays outside the Order aggregate …")` in
`prisma-order-repository.archived-at.test.ts`:

```ts
it("OrderMapper.toOrderRow carries no note (Part 2)", () => {
  expect(OrderMapper.toOrderRow(order(0), "t-1")).not.toHaveProperty("note");
});

it("save() never writes the note and never touches order_tags or order_timeline_entries (Part 2)", async () => {
  for (const version of [0, 1]) {
    const { tx, calls } = recordingTx();
    const saved = order(version);
    if (version === 1) saved.markPaid("pay-1", "e-2", new Date(1));
    await repository().save(saved, "t-1", tx);
    expect(JSON.stringify(calls)).not.toContain('"note"');
    expect(calls.map((call) => call.model)).not.toContain("orderTag");
    expect(calls.map((call) => call.model)).not.toContain("orderTimelineEntry");
  }
});
```

Run: `pnpm --filter @platform/orders exec vitest run src/infrastructure/prisma-order-repository.archived-at.test.ts`
Expected: PASS (the mapper never had these fields — the tests pin it).

- [ ] **Step 11: Tenant isolation for both new stores**

In `tenant-isolation.test.ts`:

1. Change the Part 1 expectation `toEqual({ archivedAt: null })` to
   `toEqual({ archivedAt: null, note: null, tags: [] })`.
2. Add imports: `import type { OrderTimelineEntry, OrderTimelineRepository } from "../domain/order-timeline";`,
   `import { InMemoryOrderTimelineRepository } from "./in-memory-order-timeline-repository";`,
   `import { PrismaOrderTimelineRepository } from "./prisma-order-timeline-repository";`.
3. Append:

```ts
// ── order operations Part 2: note, tags and the timeline ────────────────────────────────────────
describe("order note and tags tenant isolation (order operations Part 2)", () => {
  it("tenant A can neither write nor read tenant B's note or tags; B can", async () => {
    for (const [layer, annotations, tx] of await annotationLayers()) {
      expect(await annotations.setNote(VICTIM, "mine now", "tenant-a", tx), layer).toBe(false);
      expect(
        (await annotations.addTags([VICTIM], [{ tag: "vip", tagKey: "vip" }], "tenant-a", tx)).size,
        layer,
      ).toBe(0);
      expect(await annotations.setNote(VICTIM, "Ring twice", "tenant-b", tx), layer).toBe(true);
      expect(
        [...(await annotations.addTags([VICTIM], [{ tag: "VIP", tagKey: "vip" }], "tenant-b", tx))],
        layer,
      ).toEqual([[VICTIM, ["VIP"]]]);
      expect((await annotations.removeTags([VICTIM], ["vip"], "tenant-a", tx)).size, layer).toBe(0);
      expect((await annotations.annotationsOf([VICTIM], "tenant-a", tx)).size, layer).toBe(0);
      expect(
        (await annotations.annotationsOf([VICTIM], "tenant-b", tx)).get(VICTIM),
        layer,
      ).toEqual({
        archivedAt: null,
        note: "Ring twice",
        tags: ["VIP"],
      });
    }
  });

  it("tenant A's suggestions never include tenant B's tags (in-memory; Prisma: the raw SQL filters tenant_id)", async () => {
    const memoryOrders = repository();
    await memoryOrders.save(placeOrder(VICTIM), "tenant-b");
    const annotations = new InMemoryOrderAnnotationRepository({ orders: memoryOrders });
    await annotations.addTags([VICTIM], [{ tag: "VIP", tagKey: "vip" }], "tenant-b");
    expect(await annotations.tagsInUse("tenant-a")).toEqual([]);
    expect(await annotations.tagsInUse("tenant-b")).toEqual([{ tag: "VIP", count: 1 }]);
  });
});

const COMMENT_ID = "01900000-0000-7000-8000-0000000000c1";
const victimComment = (): OrderTimelineEntry => ({
  id: COMMENT_ID,
  orderId: VICTIM,
  kind: "comment",
  authorRef: "staff-b",
  authorName: "B",
  body: "Call before delivery",
  data: {},
  createdAt: new Date(1),
  editedAt: null,
  deletedAt: null,
});

function timelineLayers(): readonly [string, OrderTimelineRepository, unknown][] {
  const fake = createFakePrisma();
  return [
    [
      "prisma over fake-prisma",
      new PrismaOrderTimelineRepository({ prisma: fake.database }),
      fake.database,
    ],
    ["in-memory", new InMemoryOrderTimelineRepository(), undefined],
  ];
}

describe("order timeline tenant isolation (order operations Part 2)", () => {
  it("tenant A can neither read nor edit tenant B's timeline", async () => {
    for (const [layer, timeline, tx] of timelineLayers()) {
      await timeline.append(victimComment(), "tenant-b", tx);
      expect(await timeline.listForOrder(VICTIM, "tenant-a", { first: 200 }, tx), layer).toEqual(
        [],
      );
      expect(await timeline.findById(COMMENT_ID, "tenant-a", tx), layer).toBeNull();
      await timeline.update(
        { ...victimComment(), body: "hijacked", editedAt: new Date(2) },
        "tenant-a",
        tx,
      );
      expect((await timeline.findById(COMMENT_ID, "tenant-b", tx))?.body, layer).toBe(
        "Call before delivery",
      );
    }
  });
});
```

Run: `pnpm --filter @platform/orders exec vitest run src/infrastructure/tenant-isolation.test.ts`
Expected: PASS.

- [ ] **Step 12: Real-database round trip (gated)**

`services/orders/src/infrastructure/prisma-order-annotations.integration.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { buildListFixture } from "./order-list-fixture";
import { OrderEventTranslator } from "./order-event-translator";
import { PrismaOrderAnnotationRepository } from "./prisma-order-annotation-repository";
import { PrismaOrderRepository } from "./prisma-order-repository";
import { PrismaOrderTimelineRepository } from "./prisma-order-timeline-repository";

/** Order operations Part 2 against a real PostgreSQL. HONESTLY GATED on `DATABASE_URL_TEST`. */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))(
  "Prisma order annotations and timeline (integration, order operations Part 2)",
  () => {
    const runPrefix = crypto.randomUUID().slice(0, 8);
    let n = 0;
    const nextId = () => `${runPrefix}-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
    const tenantId = `tenant-notes-${runPrefix}`;
    const fixture = buildListFixture(nextId);
    const first = fixture[0]?.order.id.toString() ?? "";
    const second = fixture[1]?.order.id.toString() ?? "";
    let prisma: ReturnType<typeof createTestPrismaClient>;
    let annotations: PrismaOrderAnnotationRepository;
    let timeline: PrismaOrderTimelineRepository;
    let unitOfWork: PrismaUnitOfWork;

    beforeAll(async () => {
      prisma = createTestPrismaClient(databaseUrl);
      const orders = new PrismaOrderRepository({
        prisma,
        outbox: new OutboxWriter({
          store: new PrismaOutboxStore(prisma),
          translator: new OrderEventTranslator(),
          serializer: new InMemoryEventSerializer(),
          clock: { now: () => new Date() },
          producer: "orders",
        }),
        context: rootEventContext({ generate: nextId }),
      });
      unitOfWork = new PrismaUnitOfWork(prisma);
      for (const { order } of fixture.slice(0, 2)) {
        await unitOfWork.run((tx) => orders.save(order, tenantId, tx));
      }
      annotations = new PrismaOrderAnnotationRepository({ prisma });
      timeline = new PrismaOrderTimelineRepository({ prisma });
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    it("adds tags once per key, lists them alphabetically and removes them by key", async () => {
      await unitOfWork.run((tx) =>
        annotations.addTags(
          [first, second],
          [
            { tag: "VIP", tagKey: "vip" },
            { tag: "Urgent", tagKey: "urgent" },
          ],
          tenantId,
          tx,
        ),
      );
      const again = await unitOfWork.run((tx) =>
        annotations.addTags([first], [{ tag: "vip", tagKey: "vip" }], tenantId, tx),
      );
      expect(again.size).toBe(0);
      expect((await annotations.annotationsOf([first], tenantId)).get(first)?.tags).toEqual([
        "Urgent",
        "VIP",
      ]);
      const removed = await unitOfWork.run((tx) =>
        annotations.removeTags([second], ["urgent"], tenantId, tx),
      );
      expect([...removed]).toEqual([[second, ["Urgent"]]]);
    });

    it("suggests by literal prefix, most used first, with the earliest spelling", async () => {
      expect(await annotations.tagsInUse(tenantId, "V")).toEqual([{ tag: "VIP", count: 2 }]);
      expect(await annotations.tagsInUse(tenantId, "%")).toEqual([]);
      expect(await annotations.tagsInUse(tenantId)).toEqual([
        { tag: "VIP", count: 2 },
        { tag: "Urgent", count: 1 },
      ]);
    });

    it("sets the note without touching the order's version", async () => {
      const before = await prisma.order.findFirst({ where: { tenantId, id: first } });
      await unitOfWork.run((tx) => annotations.setNote(first, "Ring twice", tenantId, tx));
      const after = await prisma.order.findFirst({ where: { tenantId, id: first } });
      expect(after?.note).toBe("Ring twice");
      expect(after?.version).toBe(before?.version);
    });

    it("appends, lists newest first and soft-deletes timeline entries", async () => {
      const entry = {
        id: nextId(),
        orderId: first,
        kind: "comment" as const,
        authorRef: "staff-1",
        authorName: "Ahmed",
        body: "Called — no answer",
        data: {},
        createdAt: new Date("2026-10-19T09:00:00.000Z"),
        editedAt: null,
        deletedAt: null,
      };
      const activity = {
        ...entry,
        id: nextId(),
        kind: "tags_added" as const,
        body: null,
        data: { tags: ["VIP"] },
        createdAt: new Date("2026-10-19T09:05:00.000Z"),
      };
      await unitOfWork.run(async (tx) => {
        await timeline.append(entry, tenantId, tx);
        await timeline.append(activity, tenantId, tx);
      });
      await unitOfWork.run((tx) =>
        timeline.update(
          { ...entry, deletedAt: new Date("2026-10-19T10:00:00.000Z") },
          tenantId,
          tx,
        ),
      );
      const listed = await timeline.listForOrder(first, tenantId, { first: 200 });
      expect(listed.map((line) => line.kind)).toEqual(["tags_added", "comment"]);
      expect(listed[0]?.data).toEqual({ tags: ["VIP"] });
      expect(listed[1]?.deletedAt).not.toBeNull();
      expect(listed[1]?.body).toBe("Called — no answer");
    });
  },
);
```

Run: `pnpm --filter @platform/orders exec vitest run src/infrastructure/prisma-order-annotations.integration.test.ts`
Expected: skipped without `DATABASE_URL_TEST` (CI's db-integration job runs it after `migrate deploy`).

- [ ] **Step 13: Update the two Part 1 tests the wider type touches**

In `services/orders/src/application/order-annotations.use-cases.test.ts`:

1. `GetOrderAnnotations` "answers each known order's archive timestamp…" — the expectation becomes:

```ts
expect(result.ok && [...result.value]).toEqual([
  ["o-1", { archivedAt: FIRST, note: null, tags: [] }],
  ["o-2", { archivedAt: null, note: null, tags: [] }],
]);
```

2. "answers an unchanged order's real archive time when a concurrent writer won the race" — replace
   the `real` + `racing` object literal (it no longer satisfies the wider port) with a subclass:

```ts
class RacingAnnotations extends InMemoryOrderAnnotationRepository {
  override async setArchived(
    ...args: Parameters<InMemoryOrderAnnotationRepository["setArchived"]>
  ): Promise<readonly string[]> {
    // Between this call's read and its guarded update, another request archives o-1 first.
    orders.writeArchivedAt("o-1", TENANT, CONCURRENT);
    return super.setArchived(...args);
  }
}
const racing = new RacingAnnotations({ orders });
```

In `apps/admin/src/http/order-export-rows.test.ts:112` change `annotations: { archivedAt: null },` to
`annotations: { archivedAt: null, note: null, tags: [] },`.

- [ ] **Step 14: Run everything touched, typecheck, lint, commit**

Run: `pnpm --filter @platform/orders test && pnpm --filter @platform/orders typecheck && pnpm --filter @platform/orders lint && pnpm --filter @platform/admin typecheck && pnpm --filter @platform/db exec vitest run src/prisma-tenant-where.guard.test.ts`
Expected: all PASS (the guard sees `tenantId` in every new literal `where`; the `$queryRaw` filters `tenant_id` itself).

```bash
git add services/orders/src apps/admin/src/http/order-export-rows.test.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(orders): note, tag and timeline repositories with a tag list filter

Both stores keep the note and tags beside the aggregate, filter the list by tag keys (AND) and
suggest tags by literal prefix; the timeline stores comments and activity per tenant.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Note, tag and comment use cases with timeline activity (services/orders)

Model tier: **most-capable** (transaction boundaries, the 250-tag rule and the edit/delete rules are the core of the part).

**Files:**

- Modify: `services/orders/src/application/ports.ts` (append `StaffDirectoryPort`)
- Modify: `services/orders/src/infrastructure/in-memory-port-adapters.ts` (append `InMemoryStaffDirectory`)
- Create: `services/orders/src/application/order-activity.ts`
- Modify: `services/orders/src/application/order-annotations.use-cases.ts` (whole file)
- Create: `services/orders/src/application/order-notes-tags.use-cases.test.ts`
- Create: `services/orders/src/application/order-timeline.use-cases.ts`, `order-timeline.use-cases.test.ts`
- Modify: `services/orders/src/interfaces/order.controller.ts`
- Modify: `services/orders/src/composition.ts`
- Create: `services/orders/src/composition.annotations.test.ts`
- Modify: `services/orders/src/index.ts`

**Interfaces:**

- Consumes (Tasks 1–2): `OrderAnnotationRepository` (widened), `OrderTimelineRepository`, `OrderTimelineEntry`, `OrderActivityKind`, `OrderTimelineData`, `normalizeNote`, `parseTags`, `normalizeTag`, `tagKeyOf`, `characterCount`, `clampSuggestionLimit`, `MAX_TAGS_PER_ORDER`, `MAX_TAG_LENGTH`, `TAG_SUGGESTION_LIMIT`, `normalizeCommentBody`, `TIMELINE_READ_LIMIT`, `InMemoryOrderTimelineRepository`, `PrismaOrderTimelineRepository`; Part 1's `ArchiveOrders`, `UnarchiveOrders`, `GetOrderAnnotations`, `MAX_ARCHIVE_BATCH`.
- Produces:
  - `interface StaffDirectoryPort { displayNameOf(principalId: string, tenantId: string): Promise<string | null> }`; `class InMemoryStaffDirectory(names?: Readonly<Record<string, string>>) { setName(principalId, name): void }`.
  - `interface OrderActivityDeps { timeline: OrderTimelineRepository; staff: StaffDirectoryPort; idGenerator: IdGenerator }`; `OrderAnnotationsDeps.activity?: OrderActivityDeps` (Part 1 deps otherwise unchanged).
  - `UpdateOrderNote` — input `UpdateOrderNoteInput { tenantId; orderId; note: string | null; actorRef }`, output `UpdateOrderNoteOutput { orderId; note: string | null; changed: boolean }`.
  - `AddOrderTags`, `RemoveOrderTags` — input `ChangeOrderTagsInput { tenantId; orderIds: readonly string[]; tags: readonly string[]; actorRef }` (1..50 orders, 1..250 tags after parsing), output `ChangeOrderTagsOutput { results: readonly OrderTagsResult[] }`, `OrderTagsResult { orderId; outcome: "changed" | "unchanged" | "not_found" | "too_many_tags"; tags: readonly string[]; changedTags: readonly string[] }`.
  - `SuggestOrderTags` — input `SuggestOrderTagsInput { tenantId; prefix?: string; limit?: number }`, output `SuggestOrderTagsOutput { tags: readonly TagUsage[] }`.
  - `AddOrderComment` (input `AddOrderCommentInput { tenantId; orderId; body; actorRef }`), `EditOrderComment` (`EditOrderCommentInput` = that + `entryId`), `DeleteOrderComment` (`DeleteOrderCommentInput { tenantId; orderId; entryId; actorRef; canModerate: boolean }`) → `OrderTimelineEntry`; `ListOrderTimeline` (`ListOrderTimelineInput { tenantId; orderId }`) → `readonly OrderTimelineEntry[]` (≤ 200, newest first).
  - Error codes: validation → `VALIDATION` (422); unknown order/entry or another order's entry → `NOT_FOUND` (404); not the author (and not a moderator for delete) → `FORBIDDEN` (403); editing a deleted comment → `CONFLICT` (409); editing/deleting an activity line → `BUSINESS_RULE` (409).
  - `OrderController.updateOrderNote / addOrderTags / removeOrderTags / suggestOrderTags / editOrderComment / deleteOrderComment / orderTimeline` (200) and `addOrderComment` (201).
  - `OrdersWiringDeps.staffDirectory?: StaffDirectoryPort` (absent ⇒ `InMemoryStaffDirectory()`).
  - `@platform/orders` exports the types above plus `OrderTimelineEntry`, `OrderTimelineKind`, `OrderTimelineData`, `TagUsage`, `InMemoryStaffDirectory`, `MAX_TAG_LENGTH`, `MAX_TAGS_PER_ORDER`, `MAX_NOTE_LENGTH`, `MAX_COMMENT_LENGTH`, `TAG_SUGGESTION_LIMIT`.

- [ ] **Step 1: Add the staff-directory port and its offline adapter**

Append to `services/orders/src/application/ports.ts`:

```ts
/**
 * Order operations Part 2: the display name of a staff principal, snapshotted onto timeline entries
 * ("Ahmed archived this order"). Unknown → null (shown as "Staff"). Never taken from the client.
 * ADR-0014: `tenantId` per call.
 */
export interface StaffDirectoryPort {
  displayNameOf(principalId: string, tenantId: string): Promise<string | null>;
}
```

Append to `services/orders/src/infrastructure/in-memory-port-adapters.ts` (add `StaffDirectoryPort` to
its existing `../application/ports` type import):

```ts
/** Offline {@link StaffDirectoryPort}: names are injected (tests, local runs); anyone else has none ("Staff"). */
export class InMemoryStaffDirectory implements StaffDirectoryPort {
  private readonly names: Map<string, string>;

  constructor(names: Readonly<Record<string, string>> = {}) {
    this.names = new Map(Object.entries(names));
  }

  /** Renames a staff member — history written before keeps the old snapshot. */
  setName(principalId: string, name: string): void {
    this.names.set(principalId, name);
  }

  async displayNameOf(principalId: string): Promise<string | null> {
    return this.names.get(principalId) ?? null;
  }
}
```

`services/orders/src/application/order-activity.ts`:

```ts
import type { IdGenerator } from "@platform/contracts";
import { logger } from "@platform/utils";
import type {
  OrderActivityKind,
  OrderTimelineData,
  OrderTimelineEntry,
  OrderTimelineRepository,
} from "../domain/order-timeline";
import type { StaffDirectoryPort } from "./ports";

/** What writing timeline lines needs (order operations Part 2). */
export interface OrderActivityDeps {
  readonly timeline: OrderTimelineRepository;
  readonly staff: StaffDirectoryPort;
  readonly idGenerator: IdGenerator;
}

/** Who did it: the principal id and the name snapshotted at write time. */
export interface ActivityAuthor {
  readonly actorRef: string;
  readonly authorName: string | null;
}

/**
 * The acting staff member's display name, read ONCE per call, before the transaction. An empty or
 * failed lookup is null ("Staff"): the name labels the line, it is never a reason to refuse the action.
 */
export async function authorNameOf(
  staff: StaffDirectoryPort,
  actorRef: string,
  tenantId: string,
): Promise<string | null> {
  try {
    const name = (await staff.displayNameOf(actorRef, tenantId))?.trim() ?? "";
    return name.length > 0 ? name : null;
  } catch (error) {
    logger.warn("staff name lookup failed; the timeline shows Staff", {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** One activity line (never a comment): no body, never edited, never deleted. */
export function activityEntry(
  id: string,
  orderId: string,
  kind: OrderActivityKind,
  author: ActivityAuthor,
  data: OrderTimelineData,
  at: Date,
): OrderTimelineEntry {
  return {
    id,
    orderId,
    kind,
    authorRef: author.actorRef,
    authorName: author.authorName,
    body: null,
    data,
    createdAt: at,
    editedAt: null,
    deletedAt: null,
  };
}
```

- [ ] **Step 2: Write the failing note/tag/archive-activity tests**

`services/orders/src/application/order-notes-tags.use-cases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { Order } from "../domain/order";
import { OrderItem } from "../domain/order-item";
import { MAX_NOTE_LENGTH, MAX_TAGS_PER_ORDER } from "../domain/order-tags";
import type { OrderTimelineEntry, OrderTimelineRepository } from "../domain/order-timeline";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import { InMemoryOrderAnnotationRepository } from "../infrastructure/in-memory-order-annotation-repository";
import { InMemoryOrderRepository } from "../infrastructure/in-memory-order-repository";
import { InMemoryOrderTimelineRepository } from "../infrastructure/in-memory-order-timeline-repository";
import { InMemoryStaffDirectory } from "../infrastructure/in-memory-port-adapters";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { OrderEventTranslator } from "../infrastructure/order-event-translator";
import {
  AddOrderTags,
  ArchiveOrders,
  RemoveOrderTags,
  SuggestOrderTags,
  UnarchiveOrders,
  UpdateOrderNote,
} from "./order-annotations.use-cases";

const TENANT = "tenant-a";
const NOW = new Date("2026-10-19T09:00:00.000Z");

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function placed(id: string): Order {
  const item = OrderItem.create(
    UniqueEntityId.from(`${id}-item`),
    must(ProductSnapshot.create("p-1", "Toy", must(Money.create(500, "EGP")))),
    1,
  );
  return Order.place(
    UniqueEntityId.from(id),
    must(OrderNumber.create(id)),
    "customer-1",
    "EGP",
    [item],
    must(AddressSnapshot.create("1 Nile St", "Cairo", "11511", "EG")),
    `${id}-evt`,
    new Date(0),
  );
}

/** A unit of work that hands its work the transaction "tx-1" — to prove where activity is written. */
const recordingUnitOfWork: TransactionalUnitOfWork<unknown> = {
  run: async (work) => work("tx-1"),
};

class TxRecordingTimeline extends InMemoryOrderTimelineRepository {
  readonly seenTx: unknown[] = [];

  override async append(entry: OrderTimelineEntry, tenantId: string, tx?: unknown): Promise<void> {
    this.seenTx.push(tx);
    return super.append(entry, tenantId);
  }
}

async function wire(
  orderIds: readonly string[] = ["o-1", "o-2"],
  options: {
    readonly unitOfWork?: TransactionalUnitOfWork<unknown>;
    readonly timeline?: OrderTimelineRepository;
  } = {},
) {
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
  for (const id of orderIds) await orders.save(placed(id), TENANT);
  await orders.save(placed("theirs"), "tenant-b");
  const annotations = new InMemoryOrderAnnotationRepository({ orders });
  const timeline = options.timeline ?? new InMemoryOrderTimelineRepository();
  const staff = new InMemoryStaffDirectory({ "staff-1": "Ahmed" });
  let n = 0;
  const deps = {
    annotations,
    unitOfWork: options.unitOfWork ?? new InMemoryUnitOfWork(),
    clock: { now: () => NOW },
    activity: { timeline, staff, idGenerator: { generate: () => `entry-${(n += 1)}` } },
  };
  return {
    orders,
    annotations,
    staff,
    note: new UpdateOrderNote(deps),
    addTags: new AddOrderTags(deps),
    removeTags: new RemoveOrderTags(deps),
    suggest: new SuggestOrderTags({ annotations }),
    archive: new ArchiveOrders(deps),
    unarchive: new UnarchiveOrders(deps),
    linesOf: async (orderId: string) =>
      (await timeline.listForOrder(orderId, TENANT, { first: 200 })).map((entry) => ({
        kind: entry.kind,
        authorName: entry.authorName,
        data: entry.data,
      })),
  };
}

const noteInput = (note: string | null, orderId = "o-1") => ({
  tenantId: TENANT,
  orderId,
  note,
  actorRef: "staff-1",
});
const tagInput = (orderIds: readonly string[], tags: readonly string[]) => ({
  tenantId: TENANT,
  orderIds,
  tags,
  actorRef: "staff-1",
});

describe("UpdateOrderNote (order operations Part 2)", () => {
  it("saves the trimmed note and writes one note_changed line by the actor's name", async () => {
    const { note, annotations, linesOf } = await wire();
    const result = await note.execute(noteInput("  Ring twice  "));
    expect(result).toEqual({
      ok: true,
      value: { orderId: "o-1", note: "Ring twice", changed: true },
    });
    expect((await annotations.annotationsOf(["o-1"], TENANT)).get("o-1")?.note).toBe("Ring twice");
    expect(await linesOf("o-1")).toEqual([
      { kind: "note_changed", authorName: "Ahmed", data: { cleared: false } },
    ]);
  });

  it("whitespace-only clears the note; saving the same note twice writes no second line (Review Focus 2)", async () => {
    const { note, annotations, linesOf } = await wire();
    await note.execute(noteInput("Ring twice"));
    const same = await note.execute(noteInput(" Ring twice "));
    expect(same.ok && same.value.changed).toBe(false);
    const cleared = await note.execute(noteInput("   \n "));
    expect(cleared).toEqual({ ok: true, value: { orderId: "o-1", note: null, changed: true } });
    expect((await annotations.annotationsOf(["o-1"], TENANT)).get("o-1")?.note).toBeNull();
    expect((await linesOf("o-1")).map((line) => line.data)).toEqual([
      { cleared: true },
      { cleared: false },
    ]);
  });

  it("refuses 5,001 characters and writes nothing", async () => {
    const { note, annotations, linesOf } = await wire();
    const result = await note.execute(noteInput("a".repeat(MAX_NOTE_LENGTH + 1)));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    expect((await annotations.annotationsOf(["o-1"], TENANT)).get("o-1")?.note).toBeNull();
    expect(await linesOf("o-1")).toEqual([]);
  });

  it("answers NOT_FOUND for another shop's order", async () => {
    const { note } = await wire();
    const result = await note.execute(noteInput("x", "theirs"));
    expect(!result.ok && result.error.code).toBe("NOT_FOUND");
  });

  it("writes the activity line inside the note's own transaction", async () => {
    const timeline = new TxRecordingTimeline();
    const { note } = await wire(["o-1"], { unitOfWork: recordingUnitOfWork, timeline });
    await note.execute(noteInput("Ring twice"));
    expect(timeline.seenTx).toEqual(["tx-1"]);
  });

  it("never touches the Order aggregate: same version, same history", async () => {
    const { note, orders } = await wire();
    const before = await orders.findById("o-1", TENANT);
    await note.execute(noteInput("Ring twice"));
    const after = await orders.findById("o-1", TENANT);
    expect(after?.version).toBe(before?.version);
    expect(after?.history).toHaveLength(before?.history.length ?? -1);
  });
});

describe("AddOrderTags / RemoveOrderTags (order operations Part 2)", () => {
  it("adds normalized, de-duplicated tags to every order and reports what each one gained", async () => {
    const { addTags, linesOf } = await wire();
    await addTags.execute(tagInput(["o-1"], ["VIP"]));
    const result = await addTags.execute(tagInput(["o-1", "o-2"], ["vip, Urgent", " urgent "]));
    expect(result.ok && result.value.results).toEqual([
      { orderId: "o-1", outcome: "changed", tags: ["Urgent", "VIP"], changedTags: ["Urgent"] },
      {
        orderId: "o-2",
        outcome: "changed",
        tags: ["Urgent", "vip"],
        changedTags: ["vip", "Urgent"],
      },
    ]);
    expect(await linesOf("o-1")).toEqual([
      { kind: "tags_added", authorName: "Ahmed", data: { tags: ["Urgent"] } },
      { kind: "tags_added", authorName: "Ahmed", data: { tags: ["VIP"] } },
    ]);
  });

  it("an order that already carries every tag (any case) is unchanged and gets no line", async () => {
    const { addTags, linesOf } = await wire();
    await addTags.execute(tagInput(["o-1"], ["VIP"]));
    const again = await addTags.execute(tagInput(["o-1"], ["vip"]));
    expect(again.ok && again.value.results).toEqual([
      { orderId: "o-1", outcome: "unchanged", tags: ["VIP"], changedTags: [] },
    ]);
    expect(await linesOf("o-1")).toHaveLength(1);
  });

  it("refuses to push an order past 250 tags — nothing added to it — while the others are tagged (Review Focus 3)", async () => {
    const { addTags, annotations } = await wire();
    const full = Array.from({ length: MAX_TAGS_PER_ORDER - 1 }, (_, i) => `tag-${i}`);
    await addTags.execute(tagInput(["o-1"], full));
    const result = await addTags.execute(tagInput(["o-1", "o-2"], ["new-a", "new-b"]));
    expect(result.ok && result.value.results.map((r) => [r.orderId, r.outcome])).toEqual([
      ["o-1", "too_many_tags"],
      ["o-2", "changed"],
    ]);
    expect((await annotations.annotationsOf(["o-1"], TENANT)).get("o-1")?.tags).toHaveLength(
      MAX_TAGS_PER_ORDER - 1,
    );
    const exactlyFull = await addTags.execute(tagInput(["o-1"], ["new-a"]));
    expect(exactlyFull.ok && exactlyFull.value.results[0]?.outcome).toBe("changed");
  });

  it("answers not_found for unknown and other shops' ids, and still tags the rest", async () => {
    const { addTags } = await wire();
    const result = await addTags.execute(tagInput(["o-1", "missing", "theirs"], ["vip"]));
    expect(result.ok && result.value.results.map((r) => r.outcome)).toEqual([
      "changed",
      "not_found",
      "not_found",
    ]);
  });

  it("refuses 0 or 51 orders, no tags, and a tag over 40 characters — writing nothing", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `o-${i}`);
    const { addTags, annotations } = await wire(ids);
    for (const input of [
      tagInput([], ["vip"]),
      tagInput(ids, ["vip"]),
      tagInput(["o-0"], [" ", ","]),
      tagInput(["o-0"], ["ok", "x".repeat(41)]),
    ]) {
      const result = await addTags.execute(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    }
    expect((await annotations.annotationsOf(["o-0"], TENANT)).get("o-0")?.tags).toEqual([]);
  });

  it("removes case-insensitively and records the stored spelling; nothing to remove is unchanged", async () => {
    const { addTags, removeTags, linesOf } = await wire();
    await addTags.execute(tagInput(["o-1"], ["VIP", "Urgent"]));
    const result = await removeTags.execute(tagInput(["o-1", "o-2"], ["vip"]));
    expect(result.ok && result.value.results).toEqual([
      { orderId: "o-1", outcome: "changed", tags: ["Urgent"], changedTags: ["VIP"] },
      { orderId: "o-2", outcome: "unchanged", tags: [], changedTags: [] },
    ]);
    expect((await linesOf("o-1"))[0]).toEqual({
      kind: "tags_removed",
      authorName: "Ahmed",
      data: { tags: ["VIP"] },
    });
  });

  it("writes tag lines inside the tag change's own transaction", async () => {
    const timeline = new TxRecordingTimeline();
    const { addTags } = await wire(["o-1"], { unitOfWork: recordingUnitOfWork, timeline });
    await addTags.execute(tagInput(["o-1"], ["vip"]));
    expect(timeline.seenTx).toEqual(["tx-1"]);
  });
});

describe("SuggestOrderTags", () => {
  it("answers the shop's tags by prefix, most used first", async () => {
    const { addTags, suggest } = await wire();
    await addTags.execute(tagInput(["o-1", "o-2"], ["VIP"]));
    await addTags.execute(tagInput(["o-1"], ["Village"]));
    expect(await suggest.execute({ tenantId: TENANT, prefix: " vi " })).toEqual({
      ok: true,
      value: {
        tags: [
          { tag: "VIP", count: 2 },
          { tag: "Village", count: 1 },
        ],
      },
    });
  });

  it("answers nothing for a prefix longer than any tag can be", async () => {
    const { suggest } = await wire();
    expect(await suggest.execute({ tenantId: TENANT, prefix: "x".repeat(41) })).toEqual({
      ok: true,
      value: { tags: [] },
    });
  });
});

describe("ArchiveOrders / UnarchiveOrders activity (Part 2 extends Part 1)", () => {
  it("writes archived / unarchived lines only for orders that changed", async () => {
    const { archive, unarchive, linesOf } = await wire();
    await archive.execute({ tenantId: TENANT, orderIds: ["o-1"], actorRef: "staff-1" });
    await archive.execute({ tenantId: TENANT, orderIds: ["o-1", "o-2"], actorRef: "staff-1" });
    await unarchive.execute({ tenantId: TENANT, orderIds: ["o-1"], actorRef: "staff-1" });
    expect((await linesOf("o-1")).map((line) => line.kind)).toEqual(["unarchived", "archived"]);
    expect((await linesOf("o-2")).map((line) => line.kind)).toEqual(["archived"]);
  });

  it("an unknown staff member is recorded with no name (shown as Staff)", async () => {
    const { archive, linesOf } = await wire();
    await archive.execute({ tenantId: TENANT, orderIds: ["o-1"], actorRef: "staff-unknown" });
    expect((await linesOf("o-1"))[0]?.authorName).toBeNull();
  });

  it("snapshots the name: renaming the staff member later keeps the line as written", async () => {
    const { archive, staff, linesOf } = await wire();
    await archive.execute({ tenantId: TENANT, orderIds: ["o-1"], actorRef: "staff-1" });
    staff.setName("staff-1", "Ahmed M.");
    expect((await linesOf("o-1"))[0]?.authorName).toBe("Ahmed");
  });
});
```

Note the two lines in "adds normalized, de-duplicated tags…" are listed newest first, and both have
the same `createdAt` (the fixed clock), so the in-memory list breaks the tie by id descending —
`entry-2` (Urgent) before `entry-1` (VIP).

Run: `pnpm --filter @platform/orders exec vitest run src/application/order-notes-tags.use-cases.test.ts`
Expected: FAIL — `UpdateOrderNote` (and the others) are not exported.

- [ ] **Step 3: Implement the annotation use cases**

Replace `services/orders/src/application/order-annotations.use-cases.ts` with:

```ts
import type { UseCase } from "@platform/application";
import type { Clock } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import type { OrderAnnotationRepository, OrderAnnotations } from "../domain/order-annotations";
import {
  characterCount,
  clampSuggestionLimit,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_ORDER,
  normalizeNote,
  normalizeTag,
  parseTags,
  TAG_SUGGESTION_LIMIT,
  tagKeyOf,
  type OrderTag,
  type TagUsage,
} from "../domain/order-tags";
import type { OrderActivityKind, OrderTimelineData } from "../domain/order-timeline";
import {
  activityEntry,
  authorNameOf,
  type ActivityAuthor,
  type OrderActivityDeps,
} from "./order-activity";

/** At most this many orders per archive/unarchive/tag call — the bulk action's cap (spec §1.4). */
export const MAX_ARCHIVE_BATCH = 50;
/** At most this many orders per annotations read — one export page (spec §1.4). */
export const MAX_ANNOTATION_READ = 250;

export interface ArchiveOrdersInput {
  /** ADR-0014: per-call tenant scope. */
  readonly tenantId: string;
  readonly orderIds: readonly string[];
  /** The acting staff principal; Part 2 writes it (and its name) on the timeline line. */
  readonly actorRef: string;
}

export interface OrderArchiveResult {
  readonly orderId: string;
  /** changed: this call archived/unarchived it · unchanged: already in that state · not_found: no such order in this shop. */
  readonly outcome: "changed" | "unchanged" | "not_found";
  /** The order's archive timestamp after the call (null: not archived, or not found). */
  readonly archivedAt: Date | null;
}

export interface ArchiveOrdersOutput {
  readonly results: readonly OrderArchiveResult[];
}

export interface OrderAnnotationsDeps {
  readonly annotations: OrderAnnotationRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly clock: Clock;
  /** Part 2: where annotation activity lines are written. Absent ⇒ none (Part 1's tests). */
  readonly activity?: OrderActivityDeps;
}

function batchOf(orderIds: readonly string[]): Result<readonly string[], DomainError> {
  const ids = [...new Set(orderIds)];
  if (ids.length === 0 || ids.length > MAX_ARCHIVE_BATCH) {
    return err(
      new ValidationError(`Choose between 1 and ${MAX_ARCHIVE_BATCH} orders`, [
        { field: "orderIds", message: `must hold 1 to ${MAX_ARCHIVE_BATCH} ids` },
      ]),
    );
  }
  return ok(ids);
}

/** The actor's name, read before the transaction — only when activity is recorded. */
async function authorFor(
  deps: OrderAnnotationsDeps,
  actorRef: string,
  tenantId: string,
): Promise<ActivityAuthor | undefined> {
  if (deps.activity === undefined) return undefined;
  return { actorRef, authorName: await authorNameOf(deps.activity.staff, actorRef, tenantId) };
}

interface ActivityLine {
  readonly orderId: string;
  readonly kind: OrderActivityKind;
  readonly data: OrderTimelineData;
}

/** Appends the lines INSIDE the caller's transaction (`tx`): they commit or roll back with the change. */
async function recordActivity(
  deps: OrderAnnotationsDeps,
  author: ActivityAuthor | undefined,
  lines: readonly ActivityLine[],
  at: Date,
  tenantId: string,
  tx: unknown,
): Promise<void> {
  const activity = deps.activity;
  if (activity === undefined || author === undefined) return;
  for (const line of lines) {
    await activity.timeline.append(
      activityEntry(
        activity.idGenerator.generate(),
        line.orderId,
        line.kind,
        author,
        line.data,
        at,
      ),
      tenantId,
      tx,
    );
  }
}

/** One transaction: read the current state, change only what differs, answer a result per order. */
async function setArchiveState(
  deps: OrderAnnotationsDeps,
  input: ArchiveOrdersInput,
  archive: boolean,
): Promise<Result<ArchiveOrdersOutput, DomainError>> {
  const batch = batchOf(input.orderIds);
  if (!batch.ok) return err(batch.error);
  const ids = batch.value;
  const now = deps.clock.now();
  const target = archive ? now : null;
  const author = await authorFor(deps, input.actorRef, input.tenantId);
  const results = await deps.unitOfWork.run(async (tx) => {
    const before = await deps.annotations.annotationsOf(ids, input.tenantId, tx);
    const known = ids.filter((orderId) => before.has(orderId));
    const changed = new Set(
      known.length === 0
        ? []
        : await deps.annotations.setArchived(known, target, input.tenantId, tx),
    );
    await recordActivity(
      deps,
      author,
      ids
        .filter((orderId) => changed.has(orderId))
        .map((orderId): ActivityLine => ({
          orderId,
          kind: archive ? "archived" : "unarchived",
          data: {},
        })),
      now,
      input.tenantId,
      tx,
    );
    // An order the guarded update left alone may have been changed by a concurrent writer after the
    // read above: answer its state AFTER the update (same tx), never that stale read.
    const unchanged = known.filter((orderId) => !changed.has(orderId));
    const after =
      unchanged.length === 0
        ? new Map<string, OrderAnnotations>()
        : await deps.annotations.annotationsOf(unchanged, input.tenantId, tx);
    return ids.map((orderId): OrderArchiveResult => {
      if (!before.has(orderId)) return { orderId, outcome: "not_found", archivedAt: null };
      if (changed.has(orderId)) return { orderId, outcome: "changed", archivedAt: target };
      const current = after.get(orderId);
      if (current === undefined) return { orderId, outcome: "not_found", archivedAt: null };
      return { orderId, outcome: "unchanged", archivedAt: current.archivedAt };
    });
  });
  return ok({ results });
}

/** Shopify's Archive for one or many orders (spec §1.2). Idempotent; never touches the aggregate. */
export class ArchiveOrders implements UseCase<
  ArchiveOrdersInput,
  ArchiveOrdersOutput,
  DomainError
> {
  private readonly deps: OrderAnnotationsDeps;

  constructor(deps: OrderAnnotationsDeps) {
    this.deps = deps;
  }

  execute(input: ArchiveOrdersInput): Promise<Result<ArchiveOrdersOutput, DomainError>> {
    return setArchiveState(this.deps, input, true);
  }
}

/** Shopify's Unarchive. Idempotent; never touches the aggregate. */
export class UnarchiveOrders implements UseCase<
  ArchiveOrdersInput,
  ArchiveOrdersOutput,
  DomainError
> {
  private readonly deps: OrderAnnotationsDeps;

  constructor(deps: OrderAnnotationsDeps) {
    this.deps = deps;
  }

  execute(input: ArchiveOrdersInput): Promise<Result<ArchiveOrdersOutput, DomainError>> {
    return setArchiveState(this.deps, input, false);
  }
}

export interface GetOrderAnnotationsInput {
  readonly tenantId: string;
  readonly orderIds: readonly string[];
}

/** The annotations of a page of orders in ONE read (the list's badge and tags, export rows, slips). */
export class GetOrderAnnotations implements UseCase<
  GetOrderAnnotationsInput,
  ReadonlyMap<string, OrderAnnotations>,
  DomainError
> {
  private readonly deps: Pick<OrderAnnotationsDeps, "annotations">;

  constructor(deps: Pick<OrderAnnotationsDeps, "annotations">) {
    this.deps = deps;
  }

  async execute(
    input: GetOrderAnnotationsInput,
  ): Promise<Result<ReadonlyMap<string, OrderAnnotations>, DomainError>> {
    const ids = [...new Set(input.orderIds)];
    if (ids.length > MAX_ANNOTATION_READ) {
      return err(
        new ValidationError(`At most ${MAX_ANNOTATION_READ} orders per read`, [
          { field: "orderIds", message: `must hold at most ${MAX_ANNOTATION_READ} ids` },
        ]),
      );
    }
    if (ids.length === 0) return ok(new Map());
    return ok(await this.deps.annotations.annotationsOf(ids, input.tenantId));
  }
}

// ── Part 2: the note ─────────────────────────────────────────────────────────────────────────────

export interface UpdateOrderNoteInput {
  readonly tenantId: string;
  readonly orderId: string;
  /** As typed; blank or null removes the note. */
  readonly note: string | null;
  readonly actorRef: string;
}

export interface UpdateOrderNoteOutput {
  readonly orderId: string;
  readonly note: string | null;
  /** false when the note was already exactly this (no line written). */
  readonly changed: boolean;
}

/** Shopify's Notes card (spec §2.2): writes the note and its `note_changed` line in one transaction. */
export class UpdateOrderNote implements UseCase<
  UpdateOrderNoteInput,
  UpdateOrderNoteOutput,
  DomainError
> {
  private readonly deps: OrderAnnotationsDeps;

  constructor(deps: OrderAnnotationsDeps) {
    this.deps = deps;
  }

  async execute(input: UpdateOrderNoteInput): Promise<Result<UpdateOrderNoteOutput, DomainError>> {
    const note = normalizeNote(input.note);
    if (!note.ok) return err(note.error);
    const author = await authorFor(this.deps, input.actorRef, input.tenantId);
    const now = this.deps.clock.now();
    return this.deps.unitOfWork.run(
      async (tx): Promise<Result<UpdateOrderNoteOutput, DomainError>> => {
        const before = (
          await this.deps.annotations.annotationsOf([input.orderId], input.tenantId, tx)
        ).get(input.orderId);
        if (before === undefined) return err(new NotFoundError("Order not found"));
        if (before.note === note.value) {
          return ok({ orderId: input.orderId, note: note.value, changed: false });
        }
        await this.deps.annotations.setNote(input.orderId, note.value, input.tenantId, tx);
        await recordActivity(
          this.deps,
          author,
          [
            {
              orderId: input.orderId,
              kind: "note_changed",
              data: { cleared: note.value === null },
            },
          ],
          now,
          input.tenantId,
          tx,
        );
        return ok({ orderId: input.orderId, note: note.value, changed: true });
      },
    );
  }
}

// ── Part 2: tags ─────────────────────────────────────────────────────────────────────────────────

export interface ChangeOrderTagsInput {
  readonly tenantId: string;
  /** 1..50 orders (the bulk cap); duplicates collapse. */
  readonly orderIds: readonly string[];
  /** As typed — commas split, case-insensitive duplicates collapse; 1..250 tags of ≤ 40 characters. */
  readonly tags: readonly string[];
  readonly actorRef: string;
}

export interface OrderTagsResult {
  readonly orderId: string;
  /**
   * changed: tags were added/removed · unchanged: it already had / never had them · not_found: no such
   * order in this shop · too_many_tags: adding would pass 250 tags, so nothing was added to it.
   */
  readonly outcome: "changed" | "unchanged" | "not_found" | "too_many_tags";
  /** The order's tags after the call ([] when not found). */
  readonly tags: readonly string[];
  /** What this call added or removed on this order, as spelled. */
  readonly changedTags: readonly string[];
}

export interface ChangeOrderTagsOutput {
  readonly results: readonly OrderTagsResult[];
}

function tagBatchOf(
  input: ChangeOrderTagsInput,
): Result<{ readonly ids: readonly string[]; readonly tags: readonly OrderTag[] }, DomainError> {
  const ids = batchOf(input.orderIds);
  if (!ids.ok) return err(ids.error);
  const tags = parseTags(input.tags);
  if (!tags.ok) return err(tags.error);
  if (tags.value.length === 0 || tags.value.length > MAX_TAGS_PER_ORDER) {
    return err(
      new ValidationError(`Give between 1 and ${MAX_TAGS_PER_ORDER} tags`, [
        { field: "tags", message: `must hold 1 to ${MAX_TAGS_PER_ORDER} tags` },
      ]),
    );
  }
  return ok({ ids: ids.value, tags: tags.value });
}

/** Adds or removes tags on up to 50 orders in ONE transaction, with a line per changed order. */
async function changeTags(
  deps: OrderAnnotationsDeps,
  input: ChangeOrderTagsInput,
  add: boolean,
): Promise<Result<ChangeOrderTagsOutput, DomainError>> {
  const batch = tagBatchOf(input);
  if (!batch.ok) return err(batch.error);
  const { ids, tags } = batch.value;
  const author = await authorFor(deps, input.actorRef, input.tenantId);
  const now = deps.clock.now();
  const results = await deps.unitOfWork.run(async (tx) => {
    const before = await deps.annotations.annotationsOf(ids, input.tenantId, tx);
    const known = ids.filter((orderId) => before.has(orderId));
    const tooMany = new Set<string>();
    let changed: ReadonlyMap<string, readonly string[]> = new Map();
    if (add) {
      const accepted = known.filter((orderId) => {
        const keys = new Set((before.get(orderId)?.tags ?? []).map(tagKeyOf));
        const fresh = tags.filter((tag) => !keys.has(tag.tagKey)).length;
        if (keys.size + fresh > MAX_TAGS_PER_ORDER) {
          tooMany.add(orderId);
          return false;
        }
        return true;
      });
      if (accepted.length > 0) {
        changed = await deps.annotations.addTags(accepted, tags, input.tenantId, tx);
      }
    } else if (known.length > 0) {
      changed = await deps.annotations.removeTags(
        known,
        tags.map((tag) => tag.tagKey),
        input.tenantId,
        tx,
      );
    }
    await recordActivity(
      deps,
      author,
      [...changed]
        .filter(([, list]) => list.length > 0)
        .map(([orderId, list]): ActivityLine => ({
          orderId,
          kind: add ? "tags_added" : "tags_removed",
          data: { tags: list },
        })),
      now,
      input.tenantId,
      tx,
    );
    const after =
      changed.size === 0 ? before : await deps.annotations.annotationsOf(known, input.tenantId, tx);
    return ids.map((orderId): OrderTagsResult => {
      const current = after.get(orderId) ?? before.get(orderId);
      if (current === undefined)
        return { orderId, outcome: "not_found", tags: [], changedTags: [] };
      if (tooMany.has(orderId)) {
        return { orderId, outcome: "too_many_tags", tags: current.tags, changedTags: [] };
      }
      const changedTags = changed.get(orderId) ?? [];
      return {
        orderId,
        outcome: changedTags.length > 0 ? "changed" : "unchanged",
        tags: current.tags,
        changedTags,
      };
    });
  });
  return ok({ results });
}

/** Shopify's Tags card and the bulk "Add tags" (spec §2.2). Idempotent per tag key. */
export class AddOrderTags implements UseCase<
  ChangeOrderTagsInput,
  ChangeOrderTagsOutput,
  DomainError
> {
  private readonly deps: OrderAnnotationsDeps;

  constructor(deps: OrderAnnotationsDeps) {
    this.deps = deps;
  }

  execute(input: ChangeOrderTagsInput): Promise<Result<ChangeOrderTagsOutput, DomainError>> {
    return changeTags(this.deps, input, true);
  }
}

/** The tag chip's × and the bulk "Remove tags" (case-insensitive). */
export class RemoveOrderTags implements UseCase<
  ChangeOrderTagsInput,
  ChangeOrderTagsOutput,
  DomainError
> {
  private readonly deps: OrderAnnotationsDeps;

  constructor(deps: OrderAnnotationsDeps) {
    this.deps = deps;
  }

  execute(input: ChangeOrderTagsInput): Promise<Result<ChangeOrderTagsOutput, DomainError>> {
    return changeTags(this.deps, input, false);
  }
}

export interface SuggestOrderTagsInput {
  readonly tenantId: string;
  readonly prefix?: string;
  readonly limit?: number;
}

export interface SuggestOrderTagsOutput {
  readonly tags: readonly TagUsage[];
}

/** The tag input's suggestions (`GET /order-tags`): the shop's tags by literal prefix, most used first. */
export class SuggestOrderTags implements UseCase<
  SuggestOrderTagsInput,
  SuggestOrderTagsOutput,
  DomainError
> {
  private readonly deps: Pick<OrderAnnotationsDeps, "annotations">;

  constructor(deps: Pick<OrderAnnotationsDeps, "annotations">) {
    this.deps = deps;
  }

  async execute(
    input: SuggestOrderTagsInput,
  ): Promise<Result<SuggestOrderTagsOutput, DomainError>> {
    const prefix = normalizeTag(input.prefix ?? "");
    if (characterCount(prefix) > MAX_TAG_LENGTH) return ok({ tags: [] });
    const limit = clampSuggestionLimit(input.limit ?? TAG_SUGGESTION_LIMIT);
    return ok({ tags: await this.deps.annotations.tagsInUse(input.tenantId, prefix, limit) });
  }
}
```

Run: `pnpm --filter @platform/orders exec vitest run src/application/order-notes-tags.use-cases.test.ts src/application/order-annotations.use-cases.test.ts`
Expected: PASS (Part 1's archive tests still pass — they pass no `activity`).

- [ ] **Step 4: Write the failing comment/timeline tests**

`services/orders/src/application/order-timeline.use-cases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Order } from "../domain/order";
import { OrderItem } from "../domain/order-item";
import { MAX_COMMENT_LENGTH } from "../domain/order-timeline";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import { InMemoryOrderAnnotationRepository } from "../infrastructure/in-memory-order-annotation-repository";
import { InMemoryOrderRepository } from "../infrastructure/in-memory-order-repository";
import { InMemoryOrderTimelineRepository } from "../infrastructure/in-memory-order-timeline-repository";
import { InMemoryStaffDirectory } from "../infrastructure/in-memory-port-adapters";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { OrderEventTranslator } from "../infrastructure/order-event-translator";
import {
  AddOrderComment,
  DeleteOrderComment,
  EditOrderComment,
  ListOrderTimeline,
} from "./order-timeline.use-cases";

const TENANT = "tenant-a";
const T0 = new Date("2026-10-19T09:00:00.000Z");
const T1 = new Date("2026-10-19T10:00:00.000Z");

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function placed(id: string): Order {
  const item = OrderItem.create(
    UniqueEntityId.from(`${id}-item`),
    must(ProductSnapshot.create("p-1", "Toy", must(Money.create(500, "EGP")))),
    1,
  );
  return Order.place(
    UniqueEntityId.from(id),
    must(OrderNumber.create(id)),
    "customer-1",
    "EGP",
    [item],
    must(AddressSnapshot.create("1 Nile St", "Cairo", "11511", "EG")),
    `${id}-evt`,
    new Date(0),
  );
}

async function wire() {
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
  for (const id of ["o-1", "o-2"]) await orders.save(placed(id), TENANT);
  const timeline = new InMemoryOrderTimelineRepository();
  const staff = new InMemoryStaffDirectory({ "staff-1": "Ahmed", "staff-2": "Mona" });
  let now = T0;
  let n = 0;
  const deps = {
    annotations: new InMemoryOrderAnnotationRepository({ orders }),
    timeline,
    staff,
    idGenerator: { generate: () => `entry-${(n += 1)}` },
    clock: { now: () => now },
    unitOfWork: new InMemoryUnitOfWork(),
  };
  return {
    timeline,
    staff,
    add: new AddOrderComment(deps),
    edit: new EditOrderComment(deps),
    remove: new DeleteOrderComment(deps),
    list: new ListOrderTimeline({ timeline }),
    later: () => {
      now = T1;
    },
  };
}

const comment = (body: string, actorRef = "staff-1", orderId = "o-1") => ({
  tenantId: TENANT,
  orderId,
  body,
  actorRef,
});

describe("AddOrderComment (order operations Part 2)", () => {
  it("stores the trimmed comment with the author's name snapshot and the time", async () => {
    const { add } = await wire();
    const result = await add.execute(comment("  Called — no answer  "));
    expect(result).toEqual({
      ok: true,
      value: {
        id: "entry-1",
        orderId: "o-1",
        kind: "comment",
        authorRef: "staff-1",
        authorName: "Ahmed",
        body: "Called — no answer",
        data: {},
        createdAt: T0,
        editedAt: null,
        deletedAt: null,
      },
    });
  });

  it("refuses an empty or a 5,001-character comment, and an unknown order", async () => {
    const { add, timeline } = await wire();
    for (const body of ["   ", "a".repeat(MAX_COMMENT_LENGTH + 1)]) {
      const result = await add.execute(comment(body));
      expect(!result.ok && result.error.code).toBe("VALIDATION");
    }
    const unknown = await add.execute(comment("hi", "staff-1", "missing"));
    expect(!unknown.ok && unknown.error.code).toBe("NOT_FOUND");
    expect(await timeline.listForOrder("o-1", TENANT, { first: 200 })).toEqual([]);
  });
});

describe("EditOrderComment", () => {
  it("lets the author edit: new body and an edited time", async () => {
    const { add, edit, later } = await wire();
    await add.execute(comment("first"));
    later();
    const result = await edit.execute({ ...comment("second"), entryId: "entry-1" });
    expect(result.ok && result.value).toMatchObject({
      body: "second",
      editedAt: T1,
      createdAt: T0,
    });
  });

  it("refuses anyone but the author (FORBIDDEN), even an admin", async () => {
    const { add, edit } = await wire();
    await add.execute(comment("first"));
    const result = await edit.execute({ ...comment("hijack", "staff-2"), entryId: "entry-1" });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN");
  });

  it("an entry of another order is not found, and the other order's comment is untouched (Review Focus 5)", async () => {
    const { add, edit, timeline } = await wire();
    await add.execute(comment("on o-2", "staff-1", "o-2"));
    const result = await edit.execute({ ...comment("moved"), entryId: "entry-1" });
    expect(!result.ok && result.error.code).toBe("NOT_FOUND");
    expect((await timeline.findById("entry-1", TENANT))?.body).toBe("on o-2");
  });

  it("a deleted comment cannot be edited (CONFLICT) (Review Focus 4)", async () => {
    const { add, edit, remove } = await wire();
    await add.execute(comment("first"));
    await remove.execute({
      tenantId: TENANT,
      orderId: "o-1",
      entryId: "entry-1",
      actorRef: "staff-1",
      canModerate: false,
    });
    const result = await edit.execute({ ...comment("again"), entryId: "entry-1" });
    expect(!result.ok && result.error.code).toBe("CONFLICT");
  });

  it("an activity line is never editable (BUSINESS_RULE)", async () => {
    const { edit, timeline } = await wire();
    await timeline.append(
      {
        id: "activity-1",
        orderId: "o-1",
        kind: "archived",
        authorRef: "staff-1",
        authorName: "Ahmed",
        body: null,
        data: {},
        createdAt: T0,
        editedAt: null,
        deletedAt: null,
      },
      TENANT,
    );
    const result = await edit.execute({ ...comment("x"), entryId: "activity-1" });
    expect(!result.ok && result.error.code).toBe("BUSINESS_RULE");
  });
});

describe("DeleteOrderComment", () => {
  const del = (entryId: string, actorRef: string, canModerate = false) => ({
    tenantId: TENANT,
    orderId: "o-1",
    entryId,
    actorRef,
    canModerate,
  });

  it("the author soft-deletes: the row stays (with its text) and reads as deleted", async () => {
    const { add, remove, timeline, later } = await wire();
    await add.execute(comment("secret"));
    later();
    const result = await remove.execute(del("entry-1", "staff-1"));
    expect(result.ok && result.value.deletedAt).toEqual(T1);
    expect(await timeline.findById("entry-1", TENANT)).toMatchObject({
      body: "secret",
      deletedAt: T1,
    });
  });

  it("a moderator (admin) deletes anyone's comment; anyone else is FORBIDDEN", async () => {
    const { add, remove } = await wire();
    await add.execute(comment("by Ahmed"));
    const refused = await remove.execute(del("entry-1", "staff-2"));
    expect(!refused.ok && refused.error.code).toBe("FORBIDDEN");
    const moderated = await remove.execute(del("entry-1", "staff-2", true));
    expect(moderated.ok).toBe(true);
  });

  it("deleting an already-deleted comment is a no-op that keeps the first time (Review Focus 4)", async () => {
    const { add, remove, later } = await wire();
    await add.execute(comment("x"));
    await remove.execute(del("entry-1", "staff-1"));
    later();
    const again = await remove.execute(del("entry-1", "staff-1"));
    expect(again.ok && again.value.deletedAt).toEqual(T0);
  });

  it("an entry of another order is not found (Review Focus 5)", async () => {
    const { add, remove } = await wire();
    await add.execute(comment("on o-2", "staff-1", "o-2"));
    const result = await remove.execute(del("entry-1", "staff-1", true));
    expect(!result.ok && result.error.code).toBe("NOT_FOUND");
  });
});

describe("ListOrderTimeline", () => {
  it("answers the order's latest 200 lines, newest first", async () => {
    const { add, list } = await wire();
    for (let i = 0; i < 201; i += 1) await add.execute(comment(`c${i}`));
    const result = await list.execute({ tenantId: TENANT, orderId: "o-1" });
    expect(result.ok && result.value).toHaveLength(200);
  });

  it("keeps the author name as written when the staff member is renamed later", async () => {
    const { add, list, staff } = await wire();
    await add.execute(comment("hello"));
    staff.setName("staff-1", "Ahmed M.");
    const result = await list.execute({ tenantId: TENANT, orderId: "o-1" });
    expect(result.ok && result.value[0]?.authorName).toBe("Ahmed");
  });
});
```

Run: `pnpm --filter @platform/orders exec vitest run src/application/order-timeline.use-cases.test.ts`
Expected: FAIL — `Cannot find module './order-timeline.use-cases'`.

- [ ] **Step 5: Implement the comment and timeline use cases**

`services/orders/src/application/order-timeline.use-cases.ts`:

```ts
import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import {
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  type DomainError,
  NotFoundError,
} from "@platform/utils";
import type { OrderAnnotationRepository } from "../domain/order-annotations";
import {
  normalizeCommentBody,
  TIMELINE_READ_LIMIT,
  type OrderTimelineEntry,
  type OrderTimelineRepository,
} from "../domain/order-timeline";
import { authorNameOf } from "./order-activity";
import type { StaffDirectoryPort } from "./ports";

export interface OrderTimelineDeps {
  /** Only to know the order exists in this shop (one read). */
  readonly annotations: Pick<OrderAnnotationRepository, "annotationsOf">;
  readonly timeline: OrderTimelineRepository;
  readonly staff: StaffDirectoryPort;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

export interface AddOrderCommentInput {
  readonly tenantId: string;
  readonly orderId: string;
  readonly body: string;
  /** The acting staff principal — the author. Never taken from the request body. */
  readonly actorRef: string;
}

export interface EditOrderCommentInput extends AddOrderCommentInput {
  readonly entryId: string;
}

export interface DeleteOrderCommentInput {
  readonly tenantId: string;
  readonly orderId: string;
  readonly entryId: string;
  readonly actorRef: string;
  /** The actor may delete ANY comment (an admin: `comments:moderate`) — decided by the caller. */
  readonly canModerate: boolean;
}

export interface ListOrderTimelineInput {
  readonly tenantId: string;
  readonly orderId: string;
}

/** The comment `entryId` of THIS order of this shop — another order's entry, or an activity line, is refused. */
async function commentOf(
  deps: OrderTimelineDeps,
  input: { readonly tenantId: string; readonly orderId: string; readonly entryId: string },
  tx: unknown,
): Promise<Result<OrderTimelineEntry, DomainError>> {
  const entry = await deps.timeline.findById(input.entryId, input.tenantId, tx);
  if (entry === null || entry.orderId !== input.orderId) {
    return err(new NotFoundError("Comment not found"));
  }
  if (entry.kind !== "comment") {
    return err(new BusinessRuleError("Activity lines are a record and can't be changed"));
  }
  return ok(entry);
}

/** Shopify's "Leave a comment..." (spec §2.2). The author and the name snapshot come from the server. */
export class AddOrderComment implements UseCase<
  AddOrderCommentInput,
  OrderTimelineEntry,
  DomainError
> {
  private readonly deps: OrderTimelineDeps;

  constructor(deps: OrderTimelineDeps) {
    this.deps = deps;
  }

  async execute(input: AddOrderCommentInput): Promise<Result<OrderTimelineEntry, DomainError>> {
    const body = normalizeCommentBody(input.body);
    if (!body.ok) return err(body.error);
    const authorName = await authorNameOf(this.deps.staff, input.actorRef, input.tenantId);
    const now = this.deps.clock.now();
    return this.deps.unitOfWork.run(
      async (tx): Promise<Result<OrderTimelineEntry, DomainError>> => {
        const known = await this.deps.annotations.annotationsOf(
          [input.orderId],
          input.tenantId,
          tx,
        );
        if (!known.has(input.orderId)) return err(new NotFoundError("Order not found"));
        const entry: OrderTimelineEntry = {
          id: this.deps.idGenerator.generate(),
          orderId: input.orderId,
          kind: "comment",
          authorRef: input.actorRef,
          authorName,
          body: body.value,
          data: {},
          createdAt: now,
          editedAt: null,
          deletedAt: null,
        };
        await this.deps.timeline.append(entry, input.tenantId, tx);
        return ok(entry);
      },
    );
  }
}

/** Only the author edits their own comment; a deleted comment and activity lines are never edited. */
export class EditOrderComment implements UseCase<
  EditOrderCommentInput,
  OrderTimelineEntry,
  DomainError
> {
  private readonly deps: OrderTimelineDeps;

  constructor(deps: OrderTimelineDeps) {
    this.deps = deps;
  }

  async execute(input: EditOrderCommentInput): Promise<Result<OrderTimelineEntry, DomainError>> {
    const body = normalizeCommentBody(input.body);
    if (!body.ok) return err(body.error);
    const now = this.deps.clock.now();
    return this.deps.unitOfWork.run(
      async (tx): Promise<Result<OrderTimelineEntry, DomainError>> => {
        const found = await commentOf(this.deps, input, tx);
        if (!found.ok) return found;
        const entry = found.value;
        if (entry.deletedAt !== null) return err(new ConflictError("This comment was deleted"));
        if (entry.authorRef !== input.actorRef) {
          return err(new AuthorizationError("Only its author can edit a comment"));
        }
        if (entry.body === body.value) return ok(entry);
        const edited: OrderTimelineEntry = { ...entry, body: body.value, editedAt: now };
        await this.deps.timeline.update(edited, input.tenantId, tx);
        return ok(edited);
      },
    );
  }
}

/** Soft delete (spec §2.2): the author, or a moderator (admin), may delete; the row stays for the audit trail. */
export class DeleteOrderComment implements UseCase<
  DeleteOrderCommentInput,
  OrderTimelineEntry,
  DomainError
> {
  private readonly deps: OrderTimelineDeps;

  constructor(deps: OrderTimelineDeps) {
    this.deps = deps;
  }

  async execute(input: DeleteOrderCommentInput): Promise<Result<OrderTimelineEntry, DomainError>> {
    const now = this.deps.clock.now();
    return this.deps.unitOfWork.run(
      async (tx): Promise<Result<OrderTimelineEntry, DomainError>> => {
        const found = await commentOf(this.deps, input, tx);
        if (!found.ok) return found;
        const entry = found.value;
        if (entry.authorRef !== input.actorRef && !input.canModerate) {
          return err(new AuthorizationError("Only its author or an admin can delete a comment"));
        }
        if (entry.deletedAt !== null) return ok(entry);
        const deleted: OrderTimelineEntry = { ...entry, deletedAt: now };
        await this.deps.timeline.update(deleted, input.tenantId, tx);
        return ok(deleted);
      },
    );
  }
}

/** The order page's timeline lines: the latest {@link TIMELINE_READ_LIMIT}, newest first. */
export class ListOrderTimeline implements UseCase<
  ListOrderTimelineInput,
  readonly OrderTimelineEntry[],
  DomainError
> {
  private readonly deps: Pick<OrderTimelineDeps, "timeline">;

  constructor(deps: Pick<OrderTimelineDeps, "timeline">) {
    this.deps = deps;
  }

  async execute(
    input: ListOrderTimelineInput,
  ): Promise<Result<readonly OrderTimelineEntry[], DomainError>> {
    return ok(
      await this.deps.timeline.listForOrder(input.orderId, input.tenantId, {
        first: TIMELINE_READ_LIMIT,
      }),
    );
  }
}
```

Run: `pnpm --filter @platform/orders exec vitest run src/application/order-timeline.use-cases.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing composition test**

`services/orders/src/composition.annotations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireOrders } from "./composition";
import type { OrderTimelineEntry } from "./domain/order-timeline";
import { InMemoryStaffDirectory } from "./infrastructure/in-memory-port-adapters";

describe("wireOrders — notes, tags and the timeline (order operations Part 2)", () => {
  it("records annotation activity and comments under the actor's name in the in-memory composition", async () => {
    let n = 0;
    const { orders } = wireOrders({
      serializer: new InMemoryEventSerializer(),
      idGenerator: {
        generate: () => `00000000-0000-7000-8000-${(n += 1).toString().padStart(12, "0")}`,
      },
      clock: { now: () => new Date("2026-10-19T09:00:00.000Z") },
      staffDirectory: new InMemoryStaffDirectory({ "staff-1": "Ahmed" }),
    });
    const placed = await orders.place({
      tenantId: "t-1",
      customerRef: "c-1",
      currency: "EGP",
      items: [{ productId: "p-1", name: "Toy", unitPriceAmountMinor: 1000, quantity: 1 }],
      shippingAddress: { line1: "1 Nile St", city: "Cairo", postalCode: "11511", country: "EG" },
    });
    const orderId = (placed.body as { orderId: string }).orderId;
    const actor = { tenantId: "t-1", actorRef: "staff-1" };

    expect((await orders.archiveOrders({ ...actor, orderIds: [orderId] })).status).toBe(200);
    expect((await orders.updateOrderNote({ ...actor, orderId, note: "Ring twice" })).status).toBe(
      200,
    );
    expect(
      (await orders.addOrderTags({ ...actor, orderIds: [orderId], tags: ["VIP"] })).status,
    ).toBe(200);
    expect((await orders.addOrderComment({ ...actor, orderId, body: "Called" })).status).toBe(201);

    const timeline = await orders.orderTimeline({ tenantId: "t-1", orderId });
    expect(timeline.status).toBe(200);
    expect(
      (timeline.body as readonly OrderTimelineEntry[]).map((entry) => [
        entry.kind,
        entry.authorName,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["archived", "Ahmed"],
        ["note_changed", "Ahmed"],
        ["tags_added", "Ahmed"],
        ["comment", "Ahmed"],
      ]),
    );
    const suggestions = await orders.suggestOrderTags({ tenantId: "t-1", prefix: "v" });
    expect(suggestions.body).toEqual({ tags: [{ tag: "VIP", count: 1 }] });
  });
});
```

Run: `pnpm --filter @platform/orders exec vitest run src/composition.annotations.test.ts`
Expected: FAIL — `orders.updateOrderNote is not a function` (and a type error on `staffDirectory`).

- [ ] **Step 7: Wire the controller, the composition and the exports**

`services/orders/src/interfaces/order.controller.ts` — extend the annotation import and add the timeline
import:

```ts
import type {
  AddOrderTags,
  ArchiveOrders,
  ArchiveOrdersInput,
  ChangeOrderTagsInput,
  GetOrderAnnotations,
  GetOrderAnnotationsInput,
  RemoveOrderTags,
  SuggestOrderTags,
  SuggestOrderTagsInput,
  UnarchiveOrders,
  UpdateOrderNote,
  UpdateOrderNoteInput,
} from "../application/order-annotations.use-cases";
import type {
  AddOrderComment,
  AddOrderCommentInput,
  DeleteOrderComment,
  DeleteOrderCommentInput,
  EditOrderComment,
  EditOrderCommentInput,
  ListOrderTimeline,
  ListOrderTimelineInput,
} from "../application/order-timeline.use-cases";
```

add to `OrderControllerDeps`:

```ts
  readonly updateOrderNote: UpdateOrderNote;
  readonly addOrderTags: AddOrderTags;
  readonly removeOrderTags: RemoveOrderTags;
  readonly suggestOrderTags: SuggestOrderTags;
  readonly addOrderComment: AddOrderComment;
  readonly editOrderComment: EditOrderComment;
  readonly deleteOrderComment: DeleteOrderComment;
  readonly listOrderTimeline: ListOrderTimeline;
```

and append to the class:

```ts
  /** Part 2: the order note (outside the aggregate; writes its `note_changed` line). */
  async updateOrderNote(input: UpdateOrderNoteInput): Promise<ControllerResponse> {
    return present(await this.deps.updateOrderNote.execute(input), 200);
  }

  async addOrderTags(input: ChangeOrderTagsInput): Promise<ControllerResponse> {
    return present(await this.deps.addOrderTags.execute(input), 200);
  }

  async removeOrderTags(input: ChangeOrderTagsInput): Promise<ControllerResponse> {
    return present(await this.deps.removeOrderTags.execute(input), 200);
  }

  async suggestOrderTags(input: SuggestOrderTagsInput): Promise<ControllerResponse> {
    return present(await this.deps.suggestOrderTags.execute(input), 200);
  }

  async addOrderComment(input: AddOrderCommentInput): Promise<ControllerResponse> {
    return present(await this.deps.addOrderComment.execute(input), 201);
  }

  async editOrderComment(input: EditOrderCommentInput): Promise<ControllerResponse> {
    return present(await this.deps.editOrderComment.execute(input), 200);
  }

  async deleteOrderComment(input: DeleteOrderCommentInput): Promise<ControllerResponse> {
    return present(await this.deps.deleteOrderComment.execute(input), 200);
  }

  /** The order's staff timeline (body: `readonly OrderTimelineEntry[]`, newest first, ≤ 200). */
  async orderTimeline(input: ListOrderTimelineInput): Promise<ControllerResponse> {
    return present(await this.deps.listOrderTimeline.execute(input), 200);
  }
```

`services/orders/src/composition.ts`:

1. Imports: add `AddOrderTags, RemoveOrderTags, SuggestOrderTags, UpdateOrderNote` to the
   `./application/order-annotations.use-cases` import; add
   `import { AddOrderComment, DeleteOrderComment, EditOrderComment, ListOrderTimeline } from "./application/order-timeline.use-cases";`,
   `import type { StaffDirectoryPort } from "./application/ports";` (merge into the existing ports
   import if there is one), `import type { OrderTimelineRepository } from "./domain/order-timeline";`,
   `import { InMemoryOrderTimelineRepository } from "./infrastructure/in-memory-order-timeline-repository";`,
   `import { PrismaOrderTimelineRepository } from "./infrastructure/prisma-order-timeline-repository";`,
   and `InMemoryStaffDirectory` to the `./infrastructure/in-memory-port-adapters` import.
2. `OrdersWiringDeps` — add:

```ts
  /**
   * Order operations Part 2: whose name a timeline line shows. Absent ⇒ `InMemoryStaffDirectory()`
   * (no names: "Staff"); `apps/admin` supplies the Security-backed adapter in production.
   */
  readonly staffDirectory?: StaffDirectoryPort;
```

3. `buildController` — add a `timeline: OrderTimelineRepository` parameter right after `annotations`,
   and replace the three Part 1 annotation entries at the end of `new OrderController({ … })` with:

```ts
    archiveOrders: new ArchiveOrders(annotationDeps),
    unarchiveOrders: new UnarchiveOrders(annotationDeps),
    getOrderAnnotations: new GetOrderAnnotations({ annotations }),
    updateOrderNote: new UpdateOrderNote(annotationDeps),
    addOrderTags: new AddOrderTags(annotationDeps),
    removeOrderTags: new RemoveOrderTags(annotationDeps),
    suggestOrderTags: new SuggestOrderTags({ annotations }),
    addOrderComment: new AddOrderComment(timelineDeps),
    editOrderComment: new EditOrderComment(timelineDeps),
    deleteOrderComment: new DeleteOrderComment(timelineDeps),
    listOrderTimeline: new ListOrderTimeline({ timeline }),
```

with, before `return new OrderController({`:

```ts
const staff = deps.staffDirectory ?? new InMemoryStaffDirectory();
const annotationDeps = {
  annotations,
  unitOfWork,
  clock: deps.clock,
  activity: { timeline, staff, idGenerator: deps.idGenerator },
};
const timelineDeps = {
  annotations,
  timeline,
  staff,
  idGenerator: deps.idGenerator,
  clock: deps.clock,
  unitOfWork,
};
```

4. The two `buildController(…)` calls pass the timeline right after the annotation repository:
   `new PrismaOrderTimelineRepository({ prisma: deps.prisma })` in the Prisma branch and
   `new InMemoryOrderTimelineRepository()` in the in-memory branch.

`services/orders/src/index.ts` — replace the Part 1 annotation export block with:

```ts
export type { OrderAnnotationRepository, OrderAnnotations } from "./domain/order-annotations";
export {
  MAX_ARCHIVE_BATCH,
  type ArchiveOrdersInput,
  type ArchiveOrdersOutput,
  type ChangeOrderTagsInput,
  type ChangeOrderTagsOutput,
  type OrderArchiveResult,
  type OrderTagsResult,
  type SuggestOrderTagsInput,
  type SuggestOrderTagsOutput,
  type UpdateOrderNoteInput,
  type UpdateOrderNoteOutput,
} from "./application/order-annotations.use-cases";
export type {
  AddOrderCommentInput,
  DeleteOrderCommentInput,
  EditOrderCommentInput,
  ListOrderTimelineInput,
} from "./application/order-timeline.use-cases";
export {
  MAX_COMMENT_LENGTH,
  type OrderTimelineData,
  type OrderTimelineEntry,
  type OrderTimelineKind,
} from "./domain/order-timeline";
export {
  MAX_NOTE_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_ORDER,
  TAG_SUGGESTION_LIMIT,
  type TagUsage,
} from "./domain/order-tags";
export { InMemoryStaffDirectory } from "./infrastructure/in-memory-port-adapters";
```

and add `StaffDirectoryPort` to the existing `export type { … } from "./application/ports";` list.

Run: `pnpm --filter @platform/orders exec vitest run src/composition.annotations.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the package, typecheck, lint, commit**

Run: `pnpm --filter @platform/orders test && pnpm --filter @platform/orders typecheck && pnpm --filter @platform/orders lint && pnpm --filter @platform/admin typecheck`
Expected: all PASS (`apps/admin` compiles: nothing it uses changed shape).

```bash
git add services/orders/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(orders): note, tag and comment use cases with timeline activity

UpdateOrderNote, Add/RemoveOrderTags (250-tag cap per order), SuggestOrderTags and the comment
use cases; archive/unarchive and every annotation change write their activity line in the same
transaction, with the author's name snapshotted through StaffDirectoryPort.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Admin API — staff names, note/tags/comments routes and the order detail

Model tier: **most-capable** (permissions, author-vs-moderator rules and a cross-context read).

**Files:**

- Create: `apps/admin/src/infrastructure/cross-context/staff-directory.adapter.ts`, `staff-directory.adapter.test.ts`
- Modify: `apps/admin/src/composition.ts` (`AdminWiringDeps.staffDirectory`; `ordersDeps` default)
- Modify: `apps/admin/src/interfaces/admin-guard.ts` (`allows`)
- Modify: `apps/admin/src/interfaces/orders.admin-controller.ts`, `orders.admin-controller.test.ts`
- Create: `apps/admin/src/http/order-timeline-dto.ts`, `order-timeline-dto.test.ts`
- Create: `apps/admin/src/http/order-annotation-routes.ts`, `order-annotation-routes.test.ts`
- Modify: `apps/admin/src/http/admin-routes.ts` (route list; `OrderDetailDto`, `toOrderDetailDto`, `GET /orders/:orderId`)
- Modify: `apps/admin/src/http/testing/orders-harness.ts` (`buildOrdersAdmin(options?)`)

**Interfaces:**

- Consumes (Task 3): `StaffDirectoryPort`, `InMemoryStaffDirectory`, `OrderController.updateOrderNote/addOrderTags/removeOrderTags/suggestOrderTags/addOrderComment/editOrderComment/deleteOrderComment/orderTimeline`, `UpdateOrderNoteOutput`, `ChangeOrderTagsOutput`, `OrderTimelineEntry`, `OrderTimelineKind`, `MAX_TAGS_PER_ORDER`; Part 1's `orderAnnotationsFor`, harness `callRoute`/`placeTestOrder`/`adminStaff`/`operatorStaff`/`viewerStaff`.
- Produces:
  - `PrismaStaffDirectoryAdapter({ prisma })` implementing `StaffDirectoryPort`; `AdminWiringDeps.staffDirectory?: StaffDirectoryPort`.
  - `AdminGuard.allows(principal: Principal, permission: Permission): Promise<boolean>` (no audit row; a probe, never a gate).
  - `COMMENT_MODERATION_PERMISSION = "comments:moderate"`; `interface OrderTimelineView { entries: readonly OrderTimelineEntry[]; canModerate: boolean }`.
  - `OrdersAdminController`: `updateOrderNote` (`orders:edit_note`), `addOrderTags` / `removeOrderTags` (`orders:tag`), `suggestOrderTags` (`orders:read`), `addOrderComment` / `editOrderComment` (`orders:comment`), `deleteOrderComment` (`orders:comment` + moderation probe), `orderTimeline` (`orders:read` → 200 `OrderTimelineView`). Every write runs as `actorRef = principal.id` (inputs omit `actorRef`).
  - `TimelineEntryDto = { id; kind: OrderTimelineKind; authorName: string | null; body: string | null; data: { tags?; cleared?; draftNumber? }; createdAt: string; editedAt: string | null; deleted: boolean; canEdit: boolean; canDelete: boolean }`, `toTimelineEntryDto(entry, viewer: { actorRef: string; canModerate: boolean })`.
  - Routes: `PUT /orders/:orderId/note` → `{ note }`; `POST /orders/:orderId/tags` → `{ tags }`; `GET /order-tags?q=` → `{ tags: { tag, count }[] }`; `POST /orders/:orderId/comments` → 201 `TimelineEntryDto`; `PATCH /orders/:orderId/comments/:entryId` → 200 DTO; `DELETE /orders/:orderId/comments/:entryId` → 200 DTO. Writes are `idempotent: true`.
  - `OrderDetailDto` gains `note: string | null`, `tags: readonly string[]`, `timelineEntries: readonly TimelineEntryDto[]`.
  - `buildOrdersAdmin(options?: { readonly staffNames?: Readonly<Record<string, string>> })`.

- [ ] **Step 1: Write the failing staff-directory adapter test, then the adapter**

`apps/admin/src/infrastructure/cross-context/staff-directory.adapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import { PrismaStaffDirectoryAdapter } from "./staff-directory.adapter";

describe("PrismaStaffDirectoryAdapter (order operations Part 2)", () => {
  it("reads this shop's principal display name by external id — never another shop's", async () => {
    const fake = createFakePrisma();
    await fake.database.securityPrincipal.create({
      data: { tenantId: "shop-a", externalId: "staff-1", displayName: "Ahmed" } as never,
    });
    await fake.database.securityPrincipal.create({
      data: { tenantId: "shop-b", externalId: "staff-2", displayName: "Other shop" } as never,
    });
    const staff = new PrismaStaffDirectoryAdapter({ prisma: fake.database });

    expect(await staff.displayNameOf("staff-1", "shop-a")).toBe("Ahmed");
    expect(await staff.displayNameOf("staff-2", "shop-a")).toBeNull();
    expect(await staff.displayNameOf("nobody", "shop-a")).toBeNull();
  });
});
```

Run: `pnpm --filter @platform/admin exec vitest run src/infrastructure/cross-context/staff-directory.adapter.test.ts`
Expected: FAIL — module not found.

`apps/admin/src/infrastructure/cross-context/staff-directory.adapter.ts`:

```ts
import { runReadScoped, type Database } from "@platform/db";
import type { StaffDirectoryPort } from "@platform/orders";

export interface PrismaStaffDirectoryAdapterDeps {
  readonly prisma: Database;
}

/**
 * Order operations Part 2 (spec §2.2): a timeline line's author name, read from Security's
 * `principals.display_name` by `external_id` (what a staff `Principal.id` carries). One tenant-scoped
 * row, read once per action and snapshotted onto the line. Read-only; Orders never writes Security.
 */
export class PrismaStaffDirectoryAdapter implements StaffDirectoryPort {
  private readonly deps: PrismaStaffDirectoryAdapterDeps;

  constructor(deps: PrismaStaffDirectoryAdapterDeps) {
    this.deps = deps;
  }

  async displayNameOf(principalId: string, tenantId: string): Promise<string | null> {
    const row = await runReadScoped(this.deps.prisma, tenantId, (client) =>
      client.securityPrincipal.findFirst({
        where: { tenantId, externalId: principalId },
        select: { displayName: true },
      }),
    );
    return row?.displayName ?? null;
  }
}
```

Run the test again. Expected: PASS.

- [ ] **Step 2: Wire the adapter and let the harness name staff**

`apps/admin/src/composition.ts`:

1. Import `PrismaStaffDirectoryAdapter` from `./infrastructure/cross-context/staff-directory.adapter`
   and add `type StaffDirectoryPort` to the existing `@platform/orders` import.
2. In `AdminWiringDeps`, after `paymentVerification`, add:

```ts
  /**
   * Order operations Part 2: whose name a timeline line shows. Absent ⇒ Security's
   * `principals.display_name` when `prisma` is present (`PrismaStaffDirectoryAdapter`), else no names
   * ("Staff"). Passed straight through to `wireOrders` like the other Orders ports.
   */
  readonly staffDirectory?: StaffDirectoryPort;
```

3. In `const ordersDeps = { ...deps, … }`, add as the last entry:

```ts
    ...(deps.staffDirectory === undefined && deps.prisma !== undefined
      ? { staffDirectory: new PrismaStaffDirectoryAdapter({ prisma: deps.prisma }) }
      : {}),
```

`apps/admin/src/http/testing/orders-harness.ts` — import `InMemoryStaffDirectory` from
`@platform/orders` and replace `buildOrdersAdmin` with:

```ts
export function buildOrdersAdmin(
  options: { readonly staffNames?: Readonly<Record<string, string>> } = {},
): WiredAdmin {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-7000-8000-${(n += 1).toString().padStart(12, "0")}`,
  };
  const clock: Clock = { now: () => HARNESS_NOW };
  return wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    tenantId: "tenant-local",
    accessControl: new RoleTableAccessControl(),
    ...(options.staffNames === undefined
      ? {}
      : { staffDirectory: new InMemoryStaffDirectory(options.staffNames) }),
  });
}
```

- [ ] **Step 3: Write the failing controller tests**

Append to `apps/admin/src/interfaces/orders.admin-controller.test.ts` (add `"updateOrderNote"`,
`"orderTimeline"` and `"deleteOrderComment"` to the `arrayContaining` list of the "every method
authorizes first" test):

```ts
describe("notes, tags and comments (order operations Part 2)", () => {
  it.each([
    ["updateOrderNote", "orders:edit_note"],
    ["addOrderTags", "orders:tag"],
    ["removeOrderTags", "orders:tag"],
    ["suggestOrderTags", "orders:read"],
    ["addOrderComment", "orders:comment"],
    ["editOrderComment", "orders:comment"],
  ] as const)(
    "%s asks for %s and writes as the signed-in principal",
    async (method, permission) => {
      const { guard, asked } = guardAnswering(true);
      const delegate = vi.fn().mockResolvedValue({ status: 200, body: {} });
      const target = controller(guard, {
        orders: { [method]: delegate } as unknown as OrderController,
      });
      const call = target[method] as unknown as (
        principal: Principal,
        input: Record<string, unknown>,
      ) => Promise<{ status: number }>;

      const response = await call(staff, { tenantId: "t-1", actorRef: "someone-else" });

      expect(response.status).toBe(200);
      expect(asked).toEqual([permission]);
      if (method !== "suggestOrderTags") {
        expect(delegate.mock.calls[0]?.[0]).toMatchObject({ actorRef: "staff-1" });
      }
    },
  );

  it("deleteOrderComment asks orders:comment, then probes comments:moderate and passes the answer on", async () => {
    for (const moderator of [true, false]) {
      const asked: Permission[] = [];
      const accessControl: AccessControl = {
        authorize: async (_principal, permission) => {
          asked.push(permission);
          return permission === "orders:comment" || moderator;
        },
      };
      const guard = new AdminGuard({
        accessControl,
        auditTrail: { record: async () => undefined },
        clock: { now: () => new Date(0) },
      });
      const deleteOrderComment = vi.fn().mockResolvedValue({ status: 200, body: {} });
      const target = controller(guard, {
        orders: { deleteOrderComment } as unknown as OrderController,
      });

      await target.deleteOrderComment(staff, { tenantId: "t-1", orderId: "o-1", entryId: "e-1" });

      expect(asked).toEqual(["orders:comment", "comments:moderate"]);
      expect(deleteOrderComment).toHaveBeenCalledWith({
        tenantId: "t-1",
        orderId: "o-1",
        entryId: "e-1",
        actorRef: "staff-1",
        canModerate: moderator,
      });
    }
  });

  it("orderTimeline answers the entries with this viewer's moderation flag, and records no audit row for the probe", async () => {
    const recorded: AuditEvent[] = [];
    const guard = new AdminGuard({
      accessControl: { authorize: async () => true },
      auditTrail: { record: async (entry) => void recorded.push(entry) },
      clock: { now: () => new Date(0) },
    });
    const orderTimeline = vi.fn().mockResolvedValue({ status: 200, body: [{ id: "e-1" }] });
    const target = controller(guard, { orders: { orderTimeline } as unknown as OrderController });

    const response = await target.orderTimeline(staff, { tenantId: "t-1", orderId: "o-1" });

    expect(response).toEqual({
      status: 200,
      body: { entries: [{ id: "e-1" }], canModerate: true },
    });
    expect(recorded.map((entry) => entry.permission)).toEqual(["orders:read"]);
  });
});
```

Run: `pnpm --filter @platform/admin exec vitest run src/interfaces/orders.admin-controller.test.ts`
Expected: FAIL — `updateOrderNote` (etc.) is not a function.

- [ ] **Step 4: Add `allows` and the controller methods**

`apps/admin/src/interfaces/admin-guard.ts` — add to the class:

```ts
  /**
   * A presentation probe ("may this person delete others' comments?"): asks the access control
   * WITHOUT recording a decision, because it decides what is SHOWN, not what is done. Never a gate on
   * its own — every action still passes {@link ensure} first.
   */
  async allows(principal: Principal, permission: Permission): Promise<boolean> {
    return this.deps.accessControl.authorize(principal, permission);
  }
```

`apps/admin/src/interfaces/orders.admin-controller.ts` — add
`import type { OrderTimelineEntry } from "@platform/orders";` (merge into the existing `@platform/orders`
import as a type import), and above the class:

```ts
/** Granted only by an admin's `*:*` (operators' `orders:*` does not match): delete anyone's comment (spec §2.2). */
export const COMMENT_MODERATION_PERMISSION = "comments:moderate";

/** What `orderTimeline` answers: the entries, and whether this viewer may delete others' comments. */
export interface OrderTimelineView {
  readonly entries: readonly OrderTimelineEntry[];
  readonly canModerate: boolean;
}

type WithoutActor<T> = Omit<T, "actorRef">;
```

and append to the class:

```ts
  /** Order operations Part 2: the staff note. Written as the signed-in principal. */
  async updateOrderNote(
    principal: Principal,
    input: WithoutActor<Parameters<OrderController["updateOrderNote"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:edit_note");
    if (denied) return denied;
    return this.orders.updateOrderNote({ ...input, actorRef: principal.id });
  }

  async addOrderTags(
    principal: Principal,
    input: WithoutActor<Parameters<OrderController["addOrderTags"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:tag");
    if (denied) return denied;
    return this.orders.addOrderTags({ ...input, actorRef: principal.id });
  }

  async removeOrderTags(
    principal: Principal,
    input: WithoutActor<Parameters<OrderController["removeOrderTags"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:tag");
    if (denied) return denied;
    return this.orders.removeOrderTags({ ...input, actorRef: principal.id });
  }

  /** The tag input's suggestions — part of reading orders, so `orders:read`. */
  async suggestOrderTags(
    principal: Principal,
    input: Parameters<OrderController["suggestOrderTags"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:read");
    if (denied) return denied;
    return this.orders.suggestOrderTags(input);
  }

  async addOrderComment(
    principal: Principal,
    input: WithoutActor<Parameters<OrderController["addOrderComment"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:comment");
    if (denied) return denied;
    return this.orders.addOrderComment({ ...input, actorRef: principal.id });
  }

  /** The use case refuses anyone but the author. */
  async editOrderComment(
    principal: Principal,
    input: WithoutActor<Parameters<OrderController["editOrderComment"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:comment");
    if (denied) return denied;
    return this.orders.editOrderComment({ ...input, actorRef: principal.id });
  }

  /** The author, or an admin (`comments:moderate`), may delete; the use case enforces which. */
  async deleteOrderComment(
    principal: Principal,
    input: Omit<Parameters<OrderController["deleteOrderComment"]>[0], "actorRef" | "canModerate">,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:comment");
    if (denied) return denied;
    const canModerate = await this.guard.allows(principal, COMMENT_MODERATION_PERMISSION);
    return this.orders.deleteOrderComment({ ...input, actorRef: principal.id, canModerate });
  }

  /** The order page's timeline lines plus this viewer's moderation flag (for each line's Delete button). */
  async orderTimeline(
    principal: Principal,
    input: Parameters<OrderController["orderTimeline"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:read");
    if (denied) return denied;
    const response = await this.orders.orderTimeline(input);
    if (response.status !== 200) return response;
    const view: OrderTimelineView = {
      entries: response.body as readonly OrderTimelineEntry[],
      canModerate: await this.guard.allows(principal, COMMENT_MODERATION_PERMISSION),
    };
    return { status: 200, body: view };
  }
```

Run the controller tests. Expected: PASS (the prototype-walking test still sees exactly one permission
check per method on the denied path).

- [ ] **Step 5: Write the failing DTO test, then the DTO**

`apps/admin/src/http/order-timeline-dto.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { OrderTimelineEntry } from "@platform/orders";
import { toTimelineEntryDto } from "./order-timeline-dto";

const AT = new Date("2026-10-19T09:00:00.000Z");

function entry(overrides: Partial<OrderTimelineEntry> = {}): OrderTimelineEntry {
  return {
    id: "e-1",
    orderId: "o-1",
    kind: "comment",
    authorRef: "staff-1",
    authorName: "Ahmed",
    body: "Called — no answer",
    data: {},
    createdAt: AT,
    editedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("toTimelineEntryDto (order operations Part 2)", () => {
  it("lets the author edit and delete their own live comment", () => {
    expect(toTimelineEntryDto(entry(), { actorRef: "staff-1", canModerate: false })).toEqual({
      id: "e-1",
      kind: "comment",
      authorName: "Ahmed",
      body: "Called — no answer",
      data: {},
      createdAt: AT.toISOString(),
      editedAt: null,
      deleted: false,
      canEdit: true,
      canDelete: true,
    });
  });

  it("someone else's comment: no edit; delete only for a moderator", () => {
    expect(toTimelineEntryDto(entry(), { actorRef: "staff-2", canModerate: false })).toMatchObject({
      canEdit: false,
      canDelete: false,
    });
    expect(toTimelineEntryDto(entry(), { actorRef: "staff-2", canModerate: true })).toMatchObject({
      canEdit: false,
      canDelete: true,
    });
  });

  it("never serves a deleted comment's text and offers nothing on it (Review Focus 4)", () => {
    const dto = toTimelineEntryDto(entry({ deletedAt: AT }), {
      actorRef: "staff-1",
      canModerate: true,
    });
    expect(dto).toMatchObject({ body: null, deleted: true, canEdit: false, canDelete: false });
  });

  it("an activity line carries its data and can be neither edited nor deleted", () => {
    const dto = toTimelineEntryDto(
      entry({ kind: "tags_added", body: null, data: { tags: ["VIP"] } }),
      { actorRef: "staff-1", canModerate: true },
    );
    expect(dto).toMatchObject({ data: { tags: ["VIP"] }, canEdit: false, canDelete: false });
  });
});
```

Run: `pnpm --filter @platform/admin exec vitest run src/http/order-timeline-dto.test.ts`
Expected: FAIL — module not found.

`apps/admin/src/http/order-timeline-dto.ts`:

```ts
import type { OrderTimelineEntry, OrderTimelineKind } from "@platform/orders";

/** One line of the order page's staff timeline (spec §2.3; `canDelete` added — see the plan's notes). */
export interface TimelineEntryDto {
  readonly id: string;
  readonly kind: OrderTimelineKind;
  /** Snapshotted at write time; null → shown as "Staff". */
  readonly authorName: string | null;
  /** The comment text; null for activity lines and for a deleted comment (never served again). */
  readonly body: string | null;
  readonly data: {
    readonly tags?: readonly string[];
    readonly cleared?: boolean;
    readonly draftNumber?: string;
  };
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly deleted: boolean;
  /** Decided on the server: only the author edits their own live comment. */
  readonly canEdit: boolean;
  /** The author, or a moderator (admin), may delete a live comment. */
  readonly canDelete: boolean;
}

/** Who is looking: their principal id and whether they may delete others' comments. */
export interface TimelineViewer {
  readonly actorRef: string;
  readonly canModerate: boolean;
}

export function toTimelineEntryDto(
  entry: OrderTimelineEntry,
  viewer: TimelineViewer,
): TimelineEntryDto {
  const deleted = entry.deletedAt !== null;
  const liveComment = entry.kind === "comment" && !deleted;
  const own = liveComment && entry.authorRef === viewer.actorRef;
  return {
    id: entry.id,
    kind: entry.kind,
    authorName: entry.authorName,
    body: deleted ? null : entry.body,
    data: entry.data,
    createdAt: entry.createdAt.toISOString(),
    editedAt: entry.editedAt?.toISOString() ?? null,
    deleted,
    canEdit: own,
    canDelete: own || (liveComment && viewer.canModerate),
  };
}
```

Run the DTO test. Expected: PASS.

- [ ] **Step 6: Write the failing route tests**

`apps/admin/src/http/order-annotation-routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Principal } from "@platform/contracts";
import type { RouteDefinition } from "@platform/http";
import { adminRoutes } from "./admin-routes";
import type { TimelineEntryDto } from "./order-timeline-dto";
import {
  adminStaff,
  buildOrdersAdmin,
  callRoute,
  operatorStaff,
  placeTestOrder,
  viewerStaff,
} from "./testing/orders-harness";

const NAMES = { "staff-admin": "Ahmed", "staff-op": "Mona" };
const UNKNOWN_ORDER = "00000000-0000-7000-8000-0000000000ff";

interface Detail {
  readonly note: string | null;
  readonly tags: readonly string[];
  readonly timelineEntries: readonly TimelineEntryDto[];
}

async function setup() {
  const admin = buildOrdersAdmin({ staffNames: NAMES });
  const orderId = await placeTestOrder(admin);
  const routes = adminRoutes(admin);
  const route = (method: RouteDefinition["method"], path: string) =>
    routes.find((candidate) => candidate.method === method && candidate.path === path);
  const call = (
    method: RouteDefinition["method"],
    path: string,
    input: { params?: Record<string, string>; body?: unknown; query?: Record<string, string> },
    principal: Principal = adminStaff,
  ) => {
    const schema = route(method, path)?.schema;
    return callRoute(
      routes,
      method,
      path,
      {
        ...(input.params === undefined ? {} : { params: input.params }),
        ...(input.body === undefined ? {} : { body: schema?.body?.parse(input.body) }),
        ...(input.query === undefined ? {} : { query: schema?.querystring?.parse(input.query) }),
      },
      principal,
    );
  };
  const detail = async (principal: Principal = adminStaff, id = orderId) =>
    (await call("GET", "/orders/:orderId", { params: { orderId: id } }, principal)).body as Detail;
  return { admin, orderId, route, call, detail };
}

describe("PUT /orders/:orderId/note (order operations Part 2)", () => {
  it("saves the note for an operator; the order page shows it with an activity line by name", async () => {
    const { orderId, call, detail } = await setup();
    const saved = await call(
      "PUT",
      "/orders/:orderId/note",
      { params: { orderId }, body: { note: "  Ring twice " } },
      operatorStaff,
    );
    expect(saved).toEqual({ status: 200, body: { note: "Ring twice" } });
    const page = await detail();
    expect(page.note).toBe("Ring twice");
    expect(page.timelineEntries.map((line) => [line.kind, line.authorName])).toEqual([
      ["note_changed", "Mona"],
    ]);
  });

  it("is orders:edit_note, idempotent, strict; refuses a viewer (403) and an unknown order (404)", async () => {
    const { route, call } = await setup();
    const definition = route("PUT", "/orders/:orderId/note");
    expect(definition?.permission).toBe("orders:edit_note");
    expect(definition?.idempotent).toBe(true);
    expect(definition?.schema.body?.safeParse({ note: null }).success).toBe(true);
    expect(definition?.schema.body?.safeParse({ note: "x", extra: 1 }).success).toBe(false);
    const viewer = await call(
      "PUT",
      "/orders/:orderId/note",
      { params: { orderId: UNKNOWN_ORDER }, body: { note: "x" } },
      viewerStaff,
    );
    expect(viewer.status).toBe(403);
    const missing = await call("PUT", "/orders/:orderId/note", {
      params: { orderId: UNKNOWN_ORDER },
      body: { note: "x" },
    });
    expect(missing.status).toBe(404);
  });
});

describe("POST /orders/:orderId/tags", () => {
  it("adds then removes, answering the order's tags sorted", async () => {
    const { orderId, call, detail } = await setup();
    const added = await call(
      "POST",
      "/orders/:orderId/tags",
      { params: { orderId }, body: { add: ["VIP", "urgent, Gift"] } },
      operatorStaff,
    );
    expect(added).toEqual({ status: 200, body: { tags: ["Gift", "urgent", "VIP"] } });
    const changed = await call("POST", "/orders/:orderId/tags", {
      params: { orderId },
      body: { add: ["new"], remove: ["vip"] },
    });
    expect(changed).toEqual({ status: 200, body: { tags: ["Gift", "new", "urgent"] } });
    expect((await detail()).tags).toEqual(["Gift", "new", "urgent"]);
  });

  it("refuses an empty change and a viewer; answers 422 past 250 tags", async () => {
    const { orderId, route, call } = await setup();
    const schema = route("POST", "/orders/:orderId/tags")?.schema.body;
    expect(schema?.safeParse({}).success).toBe(false);
    expect(schema?.safeParse({ add: [] }).success).toBe(false);
    expect(route("POST", "/orders/:orderId/tags")?.permission).toBe("orders:tag");
    const viewer = await call(
      "POST",
      "/orders/:orderId/tags",
      { params: { orderId }, body: { add: ["vip"] } },
      viewerStaff,
    );
    expect(viewer.status).toBe(403);
    const full = Array.from({ length: 250 }, (_, i) => `t${i}`);
    expect(
      (await call("POST", "/orders/:orderId/tags", { params: { orderId }, body: { add: full } }))
        .status,
    ).toBe(200);
    const tooMany = await call("POST", "/orders/:orderId/tags", {
      params: { orderId },
      body: { add: ["one-more"] },
    });
    expect(tooMany.status).toBe(422);
  });
});

describe("GET /order-tags", () => {
  it("suggests the shop's tags by literal prefix, for anyone who reads orders", async () => {
    const { orderId, route, call } = await setup();
    expect(route("GET", "/order-tags")?.permission).toBe("orders:read");
    await call("POST", "/orders/:orderId/tags", { params: { orderId }, body: { add: ["VIP"] } });
    const found = await call("GET", "/order-tags", { query: { q: "v" } }, viewerStaff);
    expect(found).toEqual({ status: 200, body: { tags: [{ tag: "VIP", count: 1 }] } });
    expect((await call("GET", "/order-tags", { query: { q: "%" } })).body).toEqual({ tags: [] });
  });
});

describe("comments on the timeline", () => {
  it("posts as the signed-in staff member and shows each viewer what they may do", async () => {
    const { orderId, call, detail } = await setup();
    const posted = await call(
      "POST",
      "/orders/:orderId/comments",
      { params: { orderId }, body: { body: "Called — no answer" } },
      operatorStaff,
    );
    expect(posted.status).toBe(201);
    expect(posted.body).toMatchObject({
      kind: "comment",
      authorName: "Mona",
      body: "Called — no answer",
      canEdit: true,
      canDelete: true,
    });
    await call("POST", "/orders/:orderId/comments", {
      params: { orderId },
      body: { body: "Paid by bank" },
    });

    const asAdmin = (await detail(adminStaff)).timelineEntries;
    const asOperator = (await detail(operatorStaff)).timelineEntries;
    const byAuthor = (lines: readonly TimelineEntryDto[], name: string) =>
      lines.find((line) => line.authorName === name);
    expect(byAuthor(asAdmin, "Mona")).toMatchObject({ canEdit: false, canDelete: true });
    expect(byAuthor(asOperator, "Ahmed")).toMatchObject({ canEdit: false, canDelete: false });
    expect(byAuthor(asOperator, "Mona")).toMatchObject({ canEdit: true, canDelete: true });
  });

  it("an operator cannot edit or delete an admin's comment; an admin deletes an operator's", async () => {
    const { orderId, call } = await setup();
    const byAdmin = (
      await call("POST", "/orders/:orderId/comments", { params: { orderId }, body: { body: "A" } })
    ).body as TimelineEntryDto;
    const byOperator = (
      await call(
        "POST",
        "/orders/:orderId/comments",
        { params: { orderId }, body: { body: "B" } },
        operatorStaff,
      )
    ).body as TimelineEntryDto;
    const params = (entryId: string) => ({ orderId, entryId });

    expect(
      (
        await call(
          "PATCH",
          "/orders/:orderId/comments/:entryId",
          { params: params(byAdmin.id), body: { body: "edited" } },
          operatorStaff,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "DELETE",
          "/orders/:orderId/comments/:entryId",
          { params: params(byAdmin.id) },
          operatorStaff,
        )
      ).status,
    ).toBe(403);

    const deleted = await call("DELETE", "/orders/:orderId/comments/:entryId", {
      params: params(byOperator.id),
    });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({ deleted: true, body: null });
    const editDeleted = await call(
      "PATCH",
      "/orders/:orderId/comments/:entryId",
      { params: params(byOperator.id), body: { body: "again" } },
      operatorStaff,
    );
    expect(editDeleted.status).toBe(409);
  });

  it("PATCH with another order's entry id is 404 and leaves that comment alone (Review Focus 5)", async () => {
    const { admin, orderId, call, detail } = await setup();
    const other = await placeTestOrder(admin);
    const onOther = (
      await call("POST", "/orders/:orderId/comments", {
        params: { orderId: other },
        body: { body: "keep" },
      })
    ).body as TimelineEntryDto;
    const moved = await call("PATCH", "/orders/:orderId/comments/:entryId", {
      params: { orderId, entryId: onOther.id },
      body: { body: "hijacked" },
    });
    expect(moved.status).toBe(404);
    expect((await detail(adminStaff, other)).timelineEntries[0]?.body).toBe("keep");
  });

  it("a viewer cannot comment; archiving shows on the timeline by name", async () => {
    const { orderId, call, detail } = await setup();
    const viewer = await call(
      "POST",
      "/orders/:orderId/comments",
      { params: { orderId }, body: { body: "x" } },
      viewerStaff,
    );
    expect(viewer.status).toBe(403);
    await call("POST", "/orders/:orderId/archive", { params: { orderId } });
    expect((await detail()).timelineEntries.map((line) => [line.kind, line.authorName])).toEqual([
      ["archived", "Ahmed"],
    ]);
  });
});
```

Run: `pnpm --filter @platform/admin exec vitest run src/http/order-annotation-routes.test.ts`
Expected: FAIL — `no PUT /orders/:orderId/note route`.

- [ ] **Step 7: Add the routes**

`apps/admin/src/http/order-annotation-routes.ts`:

```ts
import { z } from "zod";
import type { Principal } from "@platform/contracts";
import { defineRoute, type RouteDefinition } from "@platform/http";
import {
  MAX_TAGS_PER_ORDER,
  type ChangeOrderTagsOutput,
  type OrderTimelineEntry,
  type UpdateOrderNoteOutput,
} from "@platform/orders";
import { NotFoundError, toErrorEnvelope, ValidationError } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import { toTimelineEntryDto } from "./order-timeline-dto";

const orderIdParams = z.object({ orderId: z.string().min(1) });
const commentParams = z.object({ orderId: z.string().min(1), entryId: z.string().min(1) });
// Bodies are bounded generously by size here; the use cases apply the exact character limits.
const noteBody = z.object({ note: z.string().max(20_000).nullable() }).strict();
const tagList = z.array(z.string().max(400)).max(MAX_TAGS_PER_ORDER);
const tagsBody = z
  .object({ add: tagList.optional(), remove: tagList.optional() })
  .strict()
  .refine((body) => (body.add?.length ?? 0) + (body.remove?.length ?? 0) > 0, {
    message: "Add or remove at least one tag",
    path: ["add"],
  });
const commentBody = z.object({ body: z.string().max(20_000) }).strict();
const tagSuggestionsQuery = z.object({ q: z.string().max(200).optional() });

function notFound(message: string): AdminResponse {
  return { status: 404, body: toErrorEnvelope(new NotFoundError(message)) };
}

/** One order's tag change (spec §2.3): add first, then remove; answers the tags after both. */
async function changeTagsOfOne(
  admin: WiredAdmin,
  principal: Principal,
  tenantId: string,
  orderId: string,
  body: { readonly add?: readonly string[]; readonly remove?: readonly string[] },
): Promise<AdminResponse> {
  let tags: readonly string[] = [];
  for (const [list, add] of [
    [body.add, true],
    [body.remove, false],
  ] as const) {
    if (list === undefined || list.length === 0) continue;
    const input = { tenantId, orderIds: [orderId], tags: list };
    const response = add
      ? await admin.orders.addOrderTags(principal, input)
      : await admin.orders.removeOrderTags(principal, input);
    if (response.status !== 200) return response;
    const result = (response.body as ChangeOrderTagsOutput).results[0];
    if (result === undefined || result.outcome === "not_found") return notFound("Order not found");
    if (result.outcome === "too_many_tags") {
      return {
        status: 422,
        body: toErrorEnvelope(
          new ValidationError(`An order can have at most ${MAX_TAGS_PER_ORDER} tags`, [
            { field: "add", message: `would pass ${MAX_TAGS_PER_ORDER} tags` },
          ]),
        ),
      };
    }
    tags = result.tags;
  }
  return { status: 200, body: { tags } };
}

/** The DTO a writer gets back for their own comment (moderation does not change their own buttons). */
function ownEntry(response: AdminResponse, principal: Principal, status: number): AdminResponse {
  return {
    status,
    body: toTimelineEntryDto(response.body as OrderTimelineEntry, {
      actorRef: principal.id,
      canModerate: false,
    }),
  };
}

/** Order operations Part 2 — the note, tags and comments of one order (spec §2.3). */
export function orderAnnotationRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "PUT",
      path: "/orders/:orderId/note",
      version: 1,
      permission: "orders:edit_note",
      idempotent: true,
      summary:
        "Set or clear the order's staff note (outside the aggregate; never bumps its version)",
      schema: { params: orderIdParams, body: noteBody },
      handle: async ({ params, body, context }): Promise<AdminResponse> => {
        const response = await admin.orders.updateOrderNote(context.principal, {
          tenantId: context.tenantId,
          orderId: params.orderId,
          note: body.note,
        });
        if (response.status !== 200) return response;
        return { status: 200, body: { note: (response.body as UpdateOrderNoteOutput).note } };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/orders/:orderId/tags",
      version: 1,
      permission: "orders:tag",
      idempotent: true,
      summary: "Add and/or remove tags on one order (case-insensitive; at most 250 per order)",
      schema: { params: orderIdParams, body: tagsBody },
      handle: ({ params, body, context }) =>
        changeTagsOfOne(admin, context.principal, context.tenantId, params.orderId, body),
    }),
    defineRoute({
      method: "GET",
      path: "/order-tags",
      version: 1,
      permission: "orders:read",
      summary:
        "The shop's order tags starting with q, most used first (at most 50) — tag suggestions",
      schema: { querystring: tagSuggestionsQuery },
      handle: ({ query, context }) =>
        admin.orders.suggestOrderTags(context.principal, {
          tenantId: context.tenantId,
          ...(query.q === undefined ? {} : { prefix: query.q }),
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/orders/:orderId/comments",
      version: 1,
      permission: "orders:comment",
      idempotent: true,
      summary:
        "Leave a staff comment on the order's timeline (author = the signed-in staff member)",
      schema: { params: orderIdParams, body: commentBody },
      handle: async ({ params, body, context }): Promise<AdminResponse> => {
        const response = await admin.orders.addOrderComment(context.principal, {
          tenantId: context.tenantId,
          orderId: params.orderId,
          body: body.body,
        });
        return response.status === 201 ? ownEntry(response, context.principal, 201) : response;
      },
    }),
    defineRoute({
      method: "PATCH",
      path: "/orders/:orderId/comments/:entryId",
      version: 1,
      permission: "orders:comment",
      idempotent: true,
      summary: "Edit your own comment",
      schema: { params: commentParams, body: commentBody },
      handle: async ({ params, body, context }): Promise<AdminResponse> => {
        const response = await admin.orders.editOrderComment(context.principal, {
          tenantId: context.tenantId,
          orderId: params.orderId,
          entryId: params.entryId,
          body: body.body,
        });
        return response.status === 200 ? ownEntry(response, context.principal, 200) : response;
      },
    }),
    defineRoute({
      method: "DELETE",
      path: "/orders/:orderId/comments/:entryId",
      version: 1,
      permission: "orders:comment",
      idempotent: true,
      summary: "Delete a comment (yours, or anyone's as an admin); it stays on record as deleted",
      schema: { params: commentParams },
      handle: async ({ params, context }): Promise<AdminResponse> => {
        const response = await admin.orders.deleteOrderComment(context.principal, {
          tenantId: context.tenantId,
          orderId: params.orderId,
          entryId: params.entryId,
        });
        return response.status === 200 ? ownEntry(response, context.principal, 200) : response;
      },
    }),
  ];
}
```

In `admin-routes.ts`: `import { orderAnnotationRoutes } from "./order-annotation-routes";` and add
`...orderAnnotationRoutes(admin),` right after `...orderOperationsRoutes(admin),`.

- [ ] **Step 8: Put the note, tags and timeline on the order detail**

In `apps/admin/src/http/admin-routes.ts`:

1. Imports: `import { toTimelineEntryDto, type TimelineEntryDto } from "./order-timeline-dto";` and
   `import type { OrderTimelineView } from "../interfaces/orders.admin-controller";`.
2. `OrderDetailDto` — after `archivedAt` add:

```ts
  /** Order operations Part 2: the staff note; null = "No notes". */
  readonly note: string | null;
  /** Order operations Part 2: the order's tags, sorted. */
  readonly tags: readonly string[];
  /** Order operations Part 2: staff comments and activity, newest first (latest 200). */
  readonly timelineEntries: readonly TimelineEntryDto[];
```

3. `toOrderDetailDto` — replace its last parameter `archivedAt: Date | null` with
   `annotations: OrderAnnotations | undefined, timelineEntries: readonly TimelineEntryDto[]`, and replace
   the `archivedAt: archivedAt?.toISOString() ?? null,` line with:

```ts
    archivedAt: annotations?.archivedAt?.toISOString() ?? null,
    note: annotations?.note ?? null,
    tags: annotations?.tags ?? [],
    timelineEntries,
```

4. In the `GET /orders/:orderId` handler, after the annotations read add:

```ts
const timeline = await admin.orders.orderTimeline(context.principal, {
  tenantId: context.tenantId,
  orderId: order.id.toString(),
});
if (timeline.status !== 200) return timeline;
const view = timeline.body as OrderTimelineView;
```

and change the call's last argument from
`annotations.byOrder.get(order.id.toString())?.archivedAt ?? null,` to:

```ts
            annotations.byOrder.get(order.id.toString()),
            view.entries.map((entry) =>
              toTimelineEntryDto(entry, {
                actorRef: context.principal.id,
                canModerate: view.canModerate,
              }),
            ),
```

Run: `pnpm --filter @platform/admin exec vitest run src/http/order-annotation-routes.test.ts src/http/order-timeline-dto.test.ts src/interfaces/orders.admin-controller.test.ts`
Expected: PASS.

- [ ] **Step 9: Run the app's suite, typecheck, lint, commit**

Run: `pnpm --filter @platform/admin test && pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin lint && pnpm --filter @platform/db exec vitest run src/prisma-tenant-where.guard.test.ts`
Expected: all PASS (`admin-http.e2e.test.ts` reads the detail with `toMatchObject`, so the new fields do
not disturb it; the guard sees `tenantId` in the adapter's `where`).

```bash
git add apps/admin/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin): order note, tags and comments routes

Adds PUT note, POST tags, GET /order-tags and the comment routes, puts note, tags and the
timeline on the order detail, and snapshots author names from Security's principals.
Authors edit their own comments; admins (comments:moderate) may delete any.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Admin API — tag filter and tags on the list, bulk Add/Remove tags, tags and note in export rows and slips

Model tier: **standard** (extends Part 1's bulk/export code along its existing seams).

**Files:**

- Modify: `apps/admin/src/interfaces/bulk-order-actions.ts`, `apps/admin/src/interfaces/orders.admin-controller.test.ts` (two `authorizeBulkAction` rows)
- Modify: `apps/admin/src/http/order-bulk-actions.ts`, `order-bulk-actions.test.ts`
- Modify: `apps/admin/src/http/order-views.ts`, `order-views.test.ts` (`tagFilterParam`)
- Modify: `apps/admin/src/http/order-operations-routes.ts`, `order-operations-routes.test.ts`
- Modify: `apps/admin/src/http/admin-routes.ts` (`listOrdersQuery`, `OrderListItemDto`, `toOrderListItemDto`, `GET /orders` handler)
- Modify: `apps/admin/src/http/order-export-rows.ts`, `order-export-rows.test.ts`
- Modify: `apps/admin/src/http/admin-http.e2e.test.ts:292` (list item shape gains `tags: []`)

**Interfaces:**

- Consumes (Tasks 2–4): `OrderListQuery.tags`, `OrdersAdminController.addOrderTags/removeOrderTags` (input `{ tenantId; orderIds; tags }`), `ChangeOrderTagsOutput`, `OrderAnnotations.note/tags`, `PUT /orders/:orderId/note`; Part 1's `BULK_RUNNERS`, `bulkOrdersBody`, `BulkContext`, `listOrdersForView`, `orderAnnotationsFor`, `exportRowsQuery`, `toOrderExportRowDto`, `toPackingSlipDto`.
- Produces:
  - `BULK_ORDER_ACTIONS` += `"add_tags"`, `"remove_tags"`; `BULK_ACTION_PERMISSIONS.add_tags = BULK_ACTION_PERMISSIONS.remove_tags = "orders:tag"`.
  - `BulkContext.tags?: readonly string[]`; skip reasons `already_tagged`, `not_tagged`; fail reason `too_many_tags`.
  - `POST /orders/bulk` body members `{ action: "add_tags" | "remove_tags"; orderIds: string[1..50]; tags: string[1..20] }` (strict).
  - `tagFilterParam(): z.ZodType<string[], z.ZodTypeDef, string[]>` (one or repeated `tag`, 1..10).
  - `GET /orders?tag=…` (repeatable, AND) and `GET /orders/export-rows?tag=…`; `OrderListItemDto.tags: readonly string[]`.
  - `OrderExportRowDto.tags/note` and `PackingSlipDto.note` filled from the annotations.

- [ ] **Step 1: Write the failing runner tests**

Append to `apps/admin/src/http/order-bulk-actions.test.ts`:

```ts
describe("bulk add_tags / remove_tags (order operations Part 2)", () => {
  const results = (rows: readonly [string, string][]) => ({
    status: 200,
    body: {
      results: rows.map(([orderId, outcome]) => ({ orderId, outcome, tags: [], changedTags: [] })),
    },
  });

  function tagAdmin() {
    const base = stubAdmin([]);
    return {
      ...base,
      orders: {
        ...base.orders,
        addOrderTags: vi.fn().mockResolvedValue(
          results([
            ["o-1", "changed"],
            ["o-2", "unchanged"],
            ["o-3", "too_many_tags"],
            ["o-4", "not_found"],
          ]),
        ),
        removeOrderTags: vi.fn().mockResolvedValue(results([["o-1", "unchanged"]])),
      },
    };
  }

  it("passes the tags in one call and maps each order's outcome", async () => {
    const admin = tagAdmin();
    const added = await BULK_RUNNERS.add_tags({
      admin: admin as never,
      principal,
      tenantId: "t-1",
      orderIds: ["o-1", "o-2", "o-3", "o-4"],
      tags: ["VIP"],
    });
    expect(admin.orders.addOrderTags).toHaveBeenCalledWith(principal, {
      tenantId: "t-1",
      orderIds: ["o-1", "o-2", "o-3", "o-4"],
      tags: ["VIP"],
    });
    expect(added).toEqual({
      ok: true,
      results: [
        { orderId: "o-1", outcome: "ok" },
        { orderId: "o-2", outcome: "skipped", reason: "already_tagged" },
        { orderId: "o-3", outcome: "failed", reason: "too_many_tags" },
        { orderId: "o-4", outcome: "failed", reason: "not_found" },
      ],
    });
    const removed = await BULK_RUNNERS.remove_tags({
      admin: admin as never,
      principal,
      tenantId: "t-1",
      orderIds: ["o-1"],
      tags: ["VIP"],
    });
    expect(removed).toEqual({
      ok: true,
      results: [{ orderId: "o-1", outcome: "skipped", reason: "not_tagged" }],
    });
  });

  it("answers the use case's refusal (a tag over 40 characters) as the response", async () => {
    const admin = tagAdmin();
    admin.orders.addOrderTags.mockResolvedValue({ status: 422, body: { message: "too long" } });
    const outcome = await BULK_RUNNERS.add_tags({
      admin: admin as never,
      principal,
      tenantId: "t-1",
      orderIds: ["o-1"],
      tags: ["x".repeat(41)],
    });
    expect(outcome).toEqual({
      ok: false,
      response: { status: 422, body: { message: "too long" } },
    });
  });
});
```

In `apps/admin/src/interfaces/orders.admin-controller.test.ts`, add two rows to the
`authorizeBulkAction` `it.each`:

```ts
      ["add_tags", "orders:tag"],
      ["remove_tags", "orders:tag"],
```

Run: `pnpm --filter @platform/admin exec vitest run src/http/order-bulk-actions.test.ts src/interfaces/orders.admin-controller.test.ts`
Expected: FAIL — `BULK_RUNNERS.add_tags is not a function`; the new `it.each` rows fail.

- [ ] **Step 2: Add the two actions and their runner**

`apps/admin/src/interfaces/bulk-order-actions.ts`:

```ts
import type { Permission } from "@platform/contracts";

/** The bulk actions of the Orders list (spec §1.4; Part 2 adds add_tags / remove_tags, §2.3). */
export const BULK_ORDER_ACTIONS = [
  "archive",
  "unarchive",
  "fulfill",
  "capture_payments",
  "mark_cod_collected",
  "add_tags",
  "remove_tags",
] as const;
export type BulkOrderAction = (typeof BULK_ORDER_ACTIONS)[number];

/** The permission each action needs — checked ONCE, before any order is touched. Money stays admin-only. */
export const BULK_ACTION_PERMISSIONS: Readonly<Record<BulkOrderAction, Permission>> = {
  archive: "orders:archive",
  unarchive: "orders:archive",
  fulfill: "fulfillment:create",
  capture_payments: "orders:request_payment_capture",
  mark_cod_collected: "payments:confirm_cod_collection",
  add_tags: "orders:tag",
  remove_tags: "orders:tag",
};
```

`apps/admin/src/http/order-bulk-actions.ts`:

1. Add `type ChangeOrderTagsOutput` to the `@platform/orders` import.
2. Extend `BulkSkipReason` with `| "already_tagged" | "not_tagged"`.
3. In `BulkContext`, after `orderIds`, add:

```ts
  /** add_tags / remove_tags only: 1..20 tags as typed (the use case normalizes them). */
  readonly tags?: readonly string[];
```

4. After `archiveRunner`, add:

```ts
/**
 * "Add tags" / "Remove tags" (spec §2.3): one batch call to the same use case the Tags card uses — a
 * tag change per order, one transaction, one activity line per changed order. An order that would
 * pass 250 tags fails alone; the others are tagged.
 */
function tagsRunner(add: boolean): BulkRunner {
  return async ({ admin, principal, tenantId, orderIds, tags }) => {
    const input = { tenantId, orderIds, tags: tags ?? [] };
    const response = add
      ? await admin.orders.addOrderTags(principal, input)
      : await admin.orders.removeOrderTags(principal, input);
    if (response.status !== 200) return { ok: false, response };
    return {
      ok: true,
      results: (response.body as ChangeOrderTagsOutput).results.map((result) => {
        if (result.outcome === "changed") return done(result.orderId);
        if (result.outcome === "unchanged") {
          return skipped(result.orderId, add ? "already_tagged" : "not_tagged");
        }
        if (result.outcome === "too_many_tags") return failed(result.orderId, "too_many_tags");
        return failed(result.orderId, "not_found");
      }),
    };
  };
}
```

5. Replace the `BULK_RUNNERS` doc comment and add the two entries:

```ts
/** Each bulk action's runner. */
export const BULK_RUNNERS: Readonly<Record<BulkOrderAction, BulkRunner>> = {
  archive: archiveRunner(true),
  unarchive: archiveRunner(false),
  fulfill: fulfillRunner,
  capture_payments: capturePaymentsRunner,
  mark_cod_collected: markCodCollectedRunner,
  add_tags: tagsRunner(true),
  remove_tags: tagsRunner(false),
};
```

Run the two test files again. Expected: PASS.

- [ ] **Step 3: Write the failing tag-param, route and export tests**

Append to `apps/admin/src/http/order-views.test.ts` (import `tagFilterParam` from `./order-views`):

```ts
describe("tagFilterParam (order operations Part 2)", () => {
  const schema = tagFilterParam();

  it("reads one tag or a repeated tag as a list, trimmed", () => {
    expect(schema.parse("vip")).toEqual(["vip"]);
    expect(schema.parse(["vip", " urgent "])).toEqual(["vip", "urgent"]);
  });

  it("refuses only blanks, and more than 10 tags", () => {
    expect(schema.safeParse(" ").success).toBe(false);
    expect(schema.safeParse(Array.from({ length: 11 }, (_, i) => `t${i}`)).success).toBe(false);
  });
});
```

Append to `apps/admin/src/http/order-export-rows.test.ts`:

```ts
describe("tags and note (order operations Part 2)", () => {
  const annotations = { archivedAt: null, note: "Ring twice", tags: ["Gift", "VIP"] };

  it("fill the export row", () => {
    const row = toOrderExportRowDto(stubOrder(), {
      fulfillmentStatus: "unfulfilled",
      contact,
      customerLabels: new Map(),
      intent: cod,
      annotations,
    });
    expect(row).toMatchObject({ tags: ["Gift", "VIP"], note: "Ring twice" });
  });

  it("fill the packing slip's note", () => {
    const slip = toPackingSlipDto(stubOrder(), {
      customerLabels: new Map(),
      intent: cod,
      annotations,
    });
    expect(slip.note).toBe("Ring twice");
  });
});
```

Append to `apps/admin/src/http/order-operations-routes.test.ts`:

```ts
describe("Part 2: tags on the list, in bulk and in the export", () => {
  const listOf = async (admin: WiredAdmin, query: Record<string, unknown>) => {
    const routes = adminRoutes(admin);
    const route = routes.find((r) => r.method === "GET" && r.path === "/orders");
    const response = await callRoute(routes, "GET", "/orders", {
      query: route?.schema.querystring?.parse(query),
    });
    expect(response.status).toBe(200);
    return (response.body as { items: { id: string; tags: string[] }[] }).items;
  };

  it("accepts add_tags / remove_tags with 1..20 tags only", () => {
    const tags = (count: number) => Array.from({ length: count }, (_, i) => `t${i}`);
    expect(
      bulkOrdersBody.safeParse({ action: "add_tags", orderIds: ["o-1"], tags: tags(20) }).success,
    ).toBe(true);
    expect(
      bulkOrdersBody.safeParse({ action: "remove_tags", orderIds: ["o-1"], tags: tags(21) })
        .success,
    ).toBe(false);
    expect(
      bulkOrdersBody.safeParse({ action: "add_tags", orderIds: ["o-1"], tags: [] }).success,
    ).toBe(false);
    expect(bulkOrdersBody.safeParse({ action: "add_tags", orderIds: ["o-1"] }).success).toBe(false);
  });

  it("tags in bulk as an operator; refuses a viewer before touching any order", async () => {
    const admin = buildOrdersAdmin();
    const a = await placeTestOrder(admin);
    const b = await placeTestOrder(admin);
    const denied = await bulk(
      admin,
      { action: "add_tags", orderIds: [a], tags: ["vip"] },
      viewerStaff,
    );
    expect(denied.status).toBe(403);
    expect((await listOf(admin, {})).every((item) => item.tags.length === 0)).toBe(true);

    await bulk(admin, { action: "add_tags", orderIds: [a], tags: ["VIP"] }, operatorStaff);
    const both = await bulk(
      admin,
      { action: "add_tags", orderIds: [a, b], tags: ["vip"] },
      operatorStaff,
    );
    expect((both.body as BulkBody).results).toEqual([
      { orderId: a, outcome: "skipped", reason: "already_tagged" },
      { orderId: b, outcome: "ok" },
    ]);
    const removed = await bulk(
      admin,
      { action: "remove_tags", orderIds: [a, b], tags: ["Vip"] },
      operatorStaff,
    );
    expect((removed.body as BulkBody).results.map((result) => result.outcome)).toEqual([
      "ok",
      "ok",
    ]);
  });

  it("fails only the order that would pass 250 tags (Review Focus 3)", async () => {
    const admin = buildOrdersAdmin();
    const full = await placeTestOrder(admin);
    const other = await placeTestOrder(admin);
    for (let start = 0; start < 249; start += 20) {
      const size = Math.min(20, 249 - start);
      await bulk(admin, {
        action: "add_tags",
        orderIds: [full],
        tags: Array.from({ length: size }, (_, i) => `t${start + i}`),
      });
    }
    const response = await bulk(admin, {
      action: "add_tags",
      orderIds: [full, other],
      tags: ["new-a", "new-b"],
    });
    expect((response.body as BulkBody).results).toEqual([
      { orderId: full, outcome: "failed", reason: "too_many_tags" },
      { orderId: other, outcome: "ok" },
    ]);
  });

  it("GET /orders filters by every tag given (AND) and lists each order's tags", async () => {
    const admin = buildOrdersAdmin();
    const a = await placeTestOrder(admin);
    const b = await placeTestOrder(admin);
    const c = await placeTestOrder(admin);
    await bulk(admin, { action: "add_tags", orderIds: [a, b], tags: ["VIP"] });
    await bulk(admin, { action: "add_tags", orderIds: [a], tags: ["urgent"] });

    expect((await listOf(admin, { tag: "vip" })).map((item) => item.id).sort()).toEqual(
      [a, b].sort(),
    );
    expect((await listOf(admin, { tag: ["vip", "URGENT"] })).map((item) => item.id)).toEqual([a]);
    const all = await listOf(admin, {});
    expect(all.find((item) => item.id === a)?.tags).toEqual(["urgent", "VIP"]);
    expect(all.find((item) => item.id === c)?.tags).toEqual([]);
  });

  it("export rows (filtered by tag) and packing slips carry the tags and the note", async () => {
    const admin = buildOrdersAdmin();
    const a = await placeTestOrder(admin);
    await placeTestOrder(admin);
    const routes = adminRoutes(admin);
    await bulk(admin, { action: "add_tags", orderIds: [a], tags: ["VIP"] });
    await callRoute(routes, "PUT", "/orders/:orderId/note", {
      params: { orderId: a },
      body: { note: "Ring twice" },
    });
    const exportRoute = routes.find((r) => r.method === "GET" && r.path === "/orders/export-rows");
    const rows = await callRoute(routes, "GET", "/orders/export-rows", {
      query: exportRoute?.schema.querystring?.parse({ tag: "vip" }),
    });
    expect((rows.body as { items: unknown[] }).items).toEqual([
      expect.objectContaining({ orderId: a, tags: ["VIP"], note: "Ring twice" }),
    ]);
    const slipsRoute = routes.find((r) => r.method === "GET" && r.path === "/orders/packing-slips");
    const slips = await callRoute(routes, "GET", "/orders/packing-slips", {
      query: slipsRoute?.schema.querystring?.parse({ ids: a }),
    });
    expect((slips.body as { slips: { note: string | null }[] }).slips[0]?.note).toBe("Ring twice");
  });
});
```

(The file already imports `adminRoutes`, `bulkOrdersBody`, `callRoute`, `buildOrdersAdmin`,
`placeTestOrder`, `operatorStaff`, `viewerStaff`, `WiredAdmin`, and defines `bulk` and `BulkBody`.)

Run: `pnpm --filter @platform/admin exec vitest run src/http/order-views.test.ts src/http/order-export-rows.test.ts src/http/order-operations-routes.test.ts`
Expected: FAIL — `tagFilterParam` not exported; rows carry `tags: []`/`note: null`; the bulk body rejects `add_tags`.

- [ ] **Step 4: Add the tag parameter, the bulk members, the list filter and fill the export**

`apps/admin/src/http/order-views.ts` — add `import { z } from "zod";` and:

```ts
/**
 * Spec §2.3: `tag` may repeat (`?tag=vip&tag=urgent` — AND). Fastify hands one value as a string and
 * several as an array; both become a trimmed list of 1..10 tags. Typed input-as-output like
 * `commaIds` in order-operations-routes.ts, because `RouteDefinition` types a schema by its output.
 */
export function tagFilterParam(): z.ZodType<string[], z.ZodTypeDef, string[]> {
  return z
    .union([z.string(), z.array(z.string())])
    .transform((raw) =>
      (Array.isArray(raw) ? raw : [raw]).map((tag) => tag.trim()).filter((tag) => tag.length > 0),
    )
    .pipe(z.array(z.string().max(200)).min(1).max(10)) as unknown as z.ZodType<
    string[],
    z.ZodTypeDef,
    string[]
  >;
}
```

`apps/admin/src/http/order-operations-routes.ts`:

1. Import `tagFilterParam` from `./order-views`.
2. Below `bulkAction`, add and register the two members:

```ts
const bulkTags = z.array(z.string().min(1).max(400)).min(1).max(20);

function bulkTagsAction<A extends "add_tags" | "remove_tags">(action: A) {
  return z.object({ action: z.literal(action), orderIds: bulkOrderIds, tags: bulkTags }).strict();
}

/** One strict member per action; only add_tags / remove_tags carry `tags` (1..20). */
export const bulkOrdersBody = z.discriminatedUnion("action", [
  bulkAction("archive"),
  bulkAction("unarchive"),
  bulkAction("fulfill"),
  bulkAction("capture_payments"),
  bulkAction("mark_cod_collected"),
  bulkTagsAction("add_tags"),
  bulkTagsAction("remove_tags"),
]);
```

3. In the bulk handler, pass the tags:

```ts
const outcome = await BULK_RUNNERS[body.action]({
  admin,
  principal: context.principal,
  tenantId: context.tenantId,
  orderIds: [...new Set(body.orderIds)],
  ...("tags" in body ? { tags: body.tags } : {}),
});
```

4. `exportRowsQuery`: add `tag: tagFilterParam().optional(),` to the object; in its handler change the
   destructuring and the filters:

```ts
const { view, ids, first, tag, ...filters } = query;
const found = await listOrdersForView(admin, principal, tenantId, view ?? "all", {
  ...filters,
  ...(ids === undefined ? {} : { ids }),
  ...(tag === undefined ? {} : { tags: tag }),
  first: first ?? EXPORT_ROWS_PAGE_SIZE,
});
```

`apps/admin/src/http/admin-routes.ts`:

1. Import `tagFilterParam` from `./order-views` (beside `ORDER_STATUS_VALUES`, `ORDER_VIEWS`, …).
2. `listOrdersQuery` — add:

```ts
  /** Order operations Part 2: only orders carrying every tag given (`?tag=a&tag=b`, case-insensitive). */
  tag: tagFilterParam().optional(),
```

3. `OrderListItemDto` — after `archivedAt` add:

```ts
  /** Order operations Part 2: the order's tags, sorted (the list's Tags column). */
  readonly tags: readonly string[];
```

and in `toOrderListItemDto` after `archivedAt: …` add `tags: annotations?.tags ?? [],`. 4. `GET /orders` handler: `const { view, fulfillment, tag, ...filters } = query;` and pass
`{ ...filters, ...(tag === undefined ? {} : { tags: tag }) }` as the filters argument of
`listOrdersForView`.

`apps/admin/src/http/order-export-rows.ts` — in `toOrderExportRowDto` replace `tags: [], note: null,`
with:

```ts
    tags: facts.annotations?.tags ?? [],
    note: facts.annotations?.note ?? null,
```

in `toPackingSlipDto` replace `note: null,` with `note: facts.annotations?.note ?? null,`; and update
the two DTO doc comments ("Part 2 fills these; [] / null before it.") to
`/** Order operations Part 2: the order's tags and staff note. */` and
`/** Order operations Part 2: the staff note, printed on the slip. */`, and the `OrderExportFacts.annotations`
comment to `/** Archive time, note and tags. */`.

`apps/admin/src/http/admin-http.e2e.test.ts:292` — after `archivedAt: null,` add `tags: [],`.

Run: `pnpm --filter @platform/admin exec vitest run src/http/order-views.test.ts src/http/order-export-rows.test.ts src/http/order-operations-routes.test.ts src/http/order-bulk-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the app's suite, typecheck, lint, commit**

Run: `pnpm --filter @platform/admin test && pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin lint`
Expected: all PASS.

```bash
git add apps/admin/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin): tag filter, bulk tags, and tags and note in exports

GET /orders and export rows filter by tag (repeatable, AND) and list items carry tags; bulk
add_tags/remove_tags (orders:tag, 1..20 tags) fail only an order that would pass 250 tags; export
rows and packing slips carry the tags and the note.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: admin-web — the order page's Notes and Tags cards

Model tier: **standard**.

**Files:**

- Modify: `apps/admin-web/src/lib/api/orders.ts`, `orders.test.ts`
- Create: `apps/admin-web/src/lib/orders/order-tags.ts`, `order-tags.test.ts`
- Modify: `apps/admin-web/src/lib/orders/order-views.ts`, `order-views.test.ts`
- Create: `apps/admin-web/src/app/orders/annotation-actions.ts`, `annotation-actions.test.ts`
- Create: `apps/admin-web/src/components/orders/tag-input.tsx`, `tag-input.test.tsx`
- Create: `apps/admin-web/src/components/orders/order-notes-card.tsx`, `order-notes-card.test.tsx`
- Create: `apps/admin-web/src/components/orders/order-tags-card.tsx`, `order-tags-card.test.tsx`
- Modify: `apps/admin-web/src/app/orders/[orderId]/page.tsx`
- Modify: `apps/admin-web/src/messages/en.ts`, `apps/admin-web/src/messages/ar.ts`

**Interfaces:**

- Consumes (Tasks 4–5): `PUT /orders/:orderId/note` → `{ note }`; `POST /orders/:orderId/tags` (`{ add?, remove? }`) → `{ tags }`; `GET /order-tags?q=` → `{ tags: { tag, count }[] }`; `OrderDetailDto.note/tags/timelineEntries`; `OrderListItemDto.tags`; Part 1's `mutateAdminApi`, `getAdminApi`, `newIdempotencyKey`, `toFormState`, `FormState`, `orderActionPermissionsFor`.
- Produces:
  - `lib/api/orders.ts`: `OrderTimelineKind`, `TimelineEntryDto` (with `canEdit`, `canDelete`), `OrderTagUsageDto`; `OrderDetailDto.note?/tags?/timelineEntries?`; `OrderListItemDto.tags?`; `updateOrderNote(orderId, note: string | null, idempotencyKey): Promise<MutationResult<{ note: string | null }>>`; `changeOrderTags(orderId, change: { add?: readonly string[]; remove?: readonly string[] }, idempotencyKey): Promise<MutationResult<{ tags: readonly string[] }>>`; `fetchOrderTagSuggestions(prefix: string): Promise<readonly OrderTagUsageDto[] | null>`.
  - `lib/orders/order-tags.ts`: `MAX_TAG_LENGTH`, `MAX_NOTE_LENGTH`, `MAX_COMMENT_LENGTH`, `characterCount`, `normalizeTagText`, `hasTag(tags, tag): boolean`, `splitTagInput(raw: string): { tags: readonly string[]; tooLong: readonly string[] }`, `parseTagFilter(raw: string | readonly string[] | undefined): readonly string[]`.
  - `OrderActionPermissions` gains `canEditNote`, `canTag`, `canComment` (operator, admin).
  - Server actions: `saveOrderNoteAction(previous: FormState, formData: FormData): Promise<FormState>`; `changeOrderTagsAction(orderId: string, change: { add?: readonly string[]; remove?: readonly string[] }): Promise<TagsActionState>`, `TagsActionState = { status: "saved"; tags: readonly string[] } | { status: "error"; message: string }`; `suggestOrderTagsAction(prefix: string): Promise<readonly string[]>`.
  - Components: `TagInput({ label, tags, onAdd, onRemove, suggest?, disabled?, t })`, `TagChips({ tags, onRemove?, disabled?, t })`, `OrderNotesCard({ orderId, note, canEdit, t })`, `OrderTagsCard({ orderId, tags, canTag, t })`.
  - Messages: `orderNotes.*`, `orderTags.*` (keys in Step 1).

- [ ] **Step 1: Add the copy (English and Arabic)**

In `apps/admin-web/src/messages/en.ts`, right after the `orderPage: { … },` block, add:

```ts
  /** Order operations Part 2 — Shopify's Notes card on the order page. */
  orderNotes: {
    title: "Notes",
    empty: "No notes",
    edit: "Edit notes",
    dialogTitle: "Edit notes",
    label: "Note",
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",
    tooLong: "Notes can have at most 5,000 characters.",
  },
  /** Order operations Part 2 — Shopify's Tags card and the tag input. */
  orderTags: {
    title: "Tags",
    empty: "No tags",
    inputLabel: "Add tags",
    placeholder: "Find or create tags",
    listLabel: "Tags on this order",
    remove: "Remove {tag}",
    suggestions: "Suggested tags",
    tooLong: "A tag can have at most 40 characters.",
  },
```

and in `apps/admin-web/src/messages/ar.ts`, at the same place:

```ts
  orderNotes: {
    title: "ملاحظات",
    empty: "لا توجد ملاحظات",
    edit: "تعديل الملاحظات",
    dialogTitle: "تعديل الملاحظات",
    label: "الملاحظة",
    save: "حفظ",
    saving: "جارٍ الحفظ…",
    cancel: "إلغاء",
    tooLong: "الملاحظة لا تتجاوز ٥٬٠٠٠ حرف.",
  },
  orderTags: {
    title: "العلامات",
    empty: "لا توجد علامات",
    inputLabel: "إضافة علامات",
    placeholder: "ابحث عن علامة أو أنشئ واحدة",
    listLabel: "علامات هذا الطلب",
    remove: "إزالة {tag}",
    suggestions: "علامات مقترحة",
    tooLong: "العلامة لا تتجاوز ٤٠ حرفًا.",
  },
```

Run: `pnpm --filter admin-web exec vitest run src/lib/i18n.test.ts`
Expected: PASS (every key present in both, placeholders match, nothing copied).

- [ ] **Step 2: Write the failing tag-rule and API tests**

`apps/admin-web/src/lib/orders/order-tags.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { characterCount, hasTag, parseTagFilter, splitTagInput } from "./order-tags";

describe("splitTagInput", () => {
  it("splits on commas, trims, collapses spaces and keeps the first spelling of a duplicate", () => {
    expect(splitTagInput(" VIP ,  urgent   order, vip,,")).toEqual({
      tags: ["VIP", "urgent order"],
      tooLong: [],
    });
  });

  it("sets aside a tag over 40 characters (emoji count as one)", () => {
    expect(splitTagInput(`ok, ${"x".repeat(41)}`)).toEqual({
      tags: ["ok"],
      tooLong: ["x".repeat(41)],
    });
    expect(splitTagInput("😀".repeat(40)).tags).toHaveLength(1);
  });
});

describe("hasTag / characterCount", () => {
  it("compares case- and space-insensitively", () => {
    expect(hasTag(["VIP Customer"], " vip   customer ")).toBe(true);
    expect(hasTag(["VIP"], "VIPs")).toBe(false);
  });

  it("counts code points", () => {
    expect(characterCount("😀ب")).toBe(2);
  });
});

describe("parseTagFilter (the list URL's ?tag=)", () => {
  it("reads a comma list or repeated params, at most 10 tags", () => {
    expect(parseTagFilter("vip,urgent")).toEqual(["vip", "urgent"]);
    expect(parseTagFilter(["vip", "urgent,gift"])).toEqual(["vip", "urgent", "gift"]);
    expect(parseTagFilter(undefined)).toEqual([]);
    expect(parseTagFilter(Array.from({ length: 12 }, (_, i) => `t${i}`).join(","))).toHaveLength(
      10,
    );
  });
});
```

Append to `apps/admin-web/src/lib/api/orders.test.ts` (add `updateOrderNote`, `changeOrderTags`,
`fetchOrderTagSuggestions` to the `await import("./orders")` destructuring):

```ts
describe("note, tags and suggestions (order operations Part 2)", () => {
  it("puts the note with the idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { note: "Ring twice" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await updateOrderNote("o-1", "Ring twice", "key-1")).toEqual({
      outcome: "ok",
      data: { note: "Ring twice" },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/orders\/o-1\/note$/);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ note: "Ring twice" });
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });

  it("posts only the tag lists it was given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { tags: ["VIP"] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await changeOrderTags("o-1", { add: ["VIP"] }, "key-2")).toEqual({
      outcome: "ok",
      data: { tags: ["VIP"] },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/orders\/o-1\/tags$/);
    expect(JSON.parse(String(init.body))).toEqual({ add: ["VIP"] });
  });

  it("asks for suggestions by prefix and answers null on failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { tags: [{ tag: "VIP", count: 2 }] }))
      .mockResolvedValueOnce(jsonResponse(500, { message: "down" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchOrderTagSuggestions("v i")).toEqual([{ tag: "VIP", count: 2 }]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/v1\/order-tags\?q=v%20i$/);
    expect(await fetchOrderTagSuggestions("v")).toBeNull();
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/lib/orders/order-tags.test.ts src/lib/api/orders.test.ts`
Expected: FAIL — modules/functions missing.

- [ ] **Step 3: Implement the tag rules and the API calls**

`apps/admin-web/src/lib/orders/order-tags.ts`:

```ts
/** Shopify's limits, mirrored from the API (services/orders) so the inputs can say so before saving. */
export const MAX_TAG_LENGTH = 40;
export const MAX_NOTE_LENGTH = 5000;
export const MAX_COMMENT_LENGTH = 5000;
/** The list's "Tagged with" filter takes at most this many tags (the API's cap). */
const MAX_TAG_FILTER = 10;

/** Characters as a person counts them: an emoji or an Arabic letter is one. */
export function characterCount(text: string): number {
  return [...text].length;
}

/** A tag as the API stores it: NFC, each run of whitespace one space, trimmed. */
export function normalizeTagText(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/gu, " ").trim();
}

/** Whether `tags` already holds `tag`, ignoring case and spacing (the API's tag identity). */
export function hasTag(tags: readonly string[], tag: string): boolean {
  const key = normalizeTagText(tag).toLowerCase();
  return tags.some((existing) => normalizeTagText(existing).toLowerCase() === key);
}

export interface SplitTags {
  readonly tags: readonly string[];
  /** Entries over {@link MAX_TAG_LENGTH} characters, set aside so the input can say why. */
  readonly tooLong: readonly string[];
}

/**
 * What the merchant typed → tags: a comma splits (Shopify's rule), blanks drop, a case-insensitive
 * duplicate keeps the first spelling, and an entry over 40 characters is set aside.
 */
export function splitTagInput(raw: string): SplitTags {
  const tags: string[] = [];
  const tooLong: string[] = [];
  for (const part of raw.split(",")) {
    const tag = normalizeTagText(part);
    if (tag.length === 0) continue;
    if (characterCount(tag) > MAX_TAG_LENGTH) {
      tooLong.push(tag);
      continue;
    }
    if (!hasTag(tags, tag)) tags.push(tag);
  }
  return { tags, tooLong };
}

/** The list URL's `?tag=vip,urgent` (one comma list, or repeated) → at most 10 usable tags. */
export function parseTagFilter(raw: string | readonly string[] | undefined): readonly string[] {
  if (raw === undefined) return [];
  const joined = typeof raw === "string" ? raw : raw.join(",");
  return splitTagInput(joined).tags.slice(0, MAX_TAG_FILTER);
}
```

`apps/admin-web/src/lib/api/orders.ts`:

1. `OrderListItemDto` — after `archivedAt` add:

```ts
  /** Order operations Part 2: the order's tags; absent from an older API. */
  readonly tags?: readonly string[];
```

2. Before `export interface OrderDetailDto`, add:

```ts
/** Order operations Part 2 — what one staff-timeline line is. */
export type OrderTimelineKind =
  | "comment"
  | "archived"
  | "unarchived"
  | "note_changed"
  | "tags_added"
  | "tags_removed"
  | "created_from_draft";

/** One line of the order's staff timeline (`GET /orders/:id` → `timelineEntries`). */
export interface TimelineEntryDto {
  readonly id: string;
  readonly kind: OrderTimelineKind;
  /** null → shown as "Staff". */
  readonly authorName: string | null;
  /** The comment text; null for activity lines and for a deleted comment. */
  readonly body: string | null;
  readonly data: {
    readonly tags?: readonly string[];
    readonly cleared?: boolean;
    readonly draftNumber?: string;
  };
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly deleted: boolean;
  /** Decided by the API: this viewer may edit / delete this line. */
  readonly canEdit: boolean;
  readonly canDelete: boolean;
}

/** A tag suggestion (`GET /order-tags`). */
export interface OrderTagUsageDto {
  readonly tag: string;
  readonly count: number;
}
```

3. `OrderDetailDto` — after `archivedAt` add:

```ts
  /** Order operations Part 2 — absent from an older API. */
  readonly note?: string | null;
  readonly tags?: readonly string[];
  readonly timelineEntries?: readonly TimelineEntryDto[];
```

4. After `unarchiveOrder`, append:

```ts
function isNoteBody(value: unknown): value is { readonly note: string | null } {
  if (typeof value !== "object" || value === null) return false;
  const note = (value as { note?: unknown }).note;
  return note === null || typeof note === "string";
}

function isTagsBody(value: unknown): value is { readonly tags: readonly string[] } {
  return (
    typeof value === "object" && value !== null && Array.isArray((value as { tags?: unknown }).tags)
  );
}

/** `PUT /orders/:orderId/note` (`orders:edit_note`); null or blank removes the note. */
export function updateOrderNote(
  orderId: string,
  note: string | null,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly note: string | null }>> {
  return mutateAdminApi(
    orderPath(orderId, "/note"),
    { method: "PUT", body: { note }, idempotencyKey },
    isNoteBody,
  );
}

/** `POST /orders/:orderId/tags` (`orders:tag`): adds, then removes; answers the order's tags. */
export function changeOrderTags(
  orderId: string,
  change: { readonly add?: readonly string[]; readonly remove?: readonly string[] },
  idempotencyKey: string,
): Promise<MutationResult<{ readonly tags: readonly string[] }>> {
  return mutateAdminApi(
    orderPath(orderId, "/tags"),
    {
      method: "POST",
      body: {
        ...(change.add === undefined ? {} : { add: change.add }),
        ...(change.remove === undefined ? {} : { remove: change.remove }),
      },
      idempotencyKey,
    },
    isTagsBody,
  );
}

function isTagUsages(value: unknown): value is { readonly tags: readonly OrderTagUsageDto[] } {
  return isTagsBody(value);
}

/** `GET /order-tags?q=` — the shop's tags starting with `prefix`; null when the read failed. */
export async function fetchOrderTagSuggestions(
  prefix: string,
): Promise<readonly OrderTagUsageDto[] | null> {
  const result = await getAdminApi(
    `/api/v1/order-tags?q=${encodeURIComponent(prefix)}`,
    isTagUsages,
  );
  return result.outcome === "ok" ? result.data.tags : null;
}
```

Run the two test files. Expected: PASS.

- [ ] **Step 4: Permissions for the new controls (server-decided)**

In `apps/admin-web/src/lib/orders/order-views.ts`, add to `OrderActionPermissions`:

```ts
  /** `orders:edit_note` (operator, admin): the Notes card's pencil. */
  readonly canEditNote: boolean;
  /** `orders:tag` (operator, admin): the Tags card's input and the bulk Add / Remove tags. */
  readonly canTag: boolean;
  /** `orders:comment` (operator, admin): the timeline's comment composer. */
  readonly canComment: boolean;
```

set all three `false` in `NO_ORDER_ACTIONS`, and `true` in the object `orderActionPermissionsFor`
returns for admin/operator. In `order-views.test.ts` add `canEditNote: true, canTag: true,
canComment: true,` to both the operator and admin expectations.

Run: `pnpm --filter admin-web exec vitest run src/lib/orders/order-views.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing server-action tests**

`apps/admin-web/src/app/orders/annotation-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/api/mutation";

const orders = vi.hoisted(() => ({
  updateOrderNote: vi.fn(),
  changeOrderTags: vi.fn(),
  fetchOrderTagSuggestions: vi.fn(),
  addOrderComment: vi.fn(),
  editOrderComment: vi.fn(),
  deleteOrderComment: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/orders", () => orders);
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const { changeOrderTagsAction, saveOrderNoteAction, suggestOrderTagsAction } =
  await import("./annotation-actions");

const idle: FormState = { status: "idle" };

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  return formData;
}

beforeEach(() => {
  for (const mock of Object.values(orders)) mock.mockReset();
  revalidatePath.mockReset();
});

describe("saveOrderNoteAction", () => {
  it("saves the trimmed note with a fresh key and refreshes the order page", async () => {
    orders.updateOrderNote.mockResolvedValue({ outcome: "ok", data: { note: "Ring twice" } });
    const state = await saveOrderNoteAction(idle, form({ orderId: "o-1", note: "  Ring twice " }));
    expect(state).toEqual({ status: "success" });
    expect(orders.updateOrderNote).toHaveBeenCalledWith("o-1", "Ring twice", expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/orders/o-1");
  });

  it("sends null for a blank note (removes it)", async () => {
    orders.updateOrderNote.mockResolvedValue({ outcome: "ok", data: { note: null } });
    await saveOrderNoteAction(idle, form({ orderId: "o-1", note: "  \n " }));
    expect(orders.updateOrderNote).toHaveBeenCalledWith("o-1", null, expect.any(String));
  });

  it("refuses 5,001 characters without calling the API", async () => {
    const state = await saveOrderNoteAction(idle, form({ orderId: "o-1", note: "a".repeat(5001) }));
    expect(state.status).toBe("error");
    if (state.status === "error") expect(state.fieldErrors["note"]).toBeDefined();
    expect(orders.updateOrderNote).not.toHaveBeenCalled();
  });
});

describe("changeOrderTagsAction", () => {
  it("adds and answers the order's tags", async () => {
    orders.changeOrderTags.mockResolvedValue({ outcome: "ok", data: { tags: ["VIP"] } });
    expect(await changeOrderTagsAction("o-1", { add: ["VIP"] })).toEqual({
      status: "saved",
      tags: ["VIP"],
    });
    expect(orders.changeOrderTags).toHaveBeenCalledWith(
      "o-1",
      { add: ["VIP"] },
      expect.any(String),
    );
  });

  it("refuses an empty change or a bad order id without calling the API", async () => {
    expect((await changeOrderTagsAction("o-1", {})).status).toBe("error");
    expect((await changeOrderTagsAction("", { add: ["x"] })).status).toBe("error");
    expect(orders.changeOrderTags).not.toHaveBeenCalled();
  });

  it("answers the API's refusal as a message", async () => {
    orders.changeOrderTags.mockResolvedValue({ outcome: "forbidden" });
    const state = await changeOrderTagsAction("o-1", { remove: ["VIP"] });
    expect(state).toEqual({ status: "error", message: expect.any(String) });
  });
});

describe("suggestOrderTagsAction", () => {
  it("answers the suggested spellings, and nothing for a blank prefix or a failed read", async () => {
    orders.fetchOrderTagSuggestions.mockResolvedValueOnce([{ tag: "VIP", count: 2 }]);
    expect(await suggestOrderTagsAction(" v ")).toEqual(["VIP"]);
    expect(orders.fetchOrderTagSuggestions).toHaveBeenCalledWith("v");
    expect(await suggestOrderTagsAction("  ")).toEqual([]);
    orders.fetchOrderTagSuggestions.mockResolvedValueOnce(null);
    expect(await suggestOrderTagsAction("v")).toEqual([]);
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/app/orders/annotation-actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 6: Implement the server actions**

`apps/admin-web/src/app/orders/annotation-actions.ts`:

```ts
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { changeOrderTags, fetchOrderTagSuggestions, updateOrderNote } from "@/lib/api/orders";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { characterCount, MAX_NOTE_LENGTH } from "@/lib/orders/order-tags";

/**
 * Order operations Part 2 — the order page's Notes, Tags and comment actions. Every argument is
 * untrusted (a client component calls these directly): it is checked here, one idempotency key is
 * minted per call, and the API decides permissions and authorship (never this layer).
 */

const MAX_TAGS_PER_CALL = 250;

async function dictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** The Notes card's dialog. A blank note removes it. */
export async function saveOrderNoteAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const orderId = stringField(formData, "orderId");
  const note = stringField(formData, "note").trim();
  if (orderId.length === 0)
    return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
  if (characterCount(note) > MAX_NOTE_LENGTH) {
    return {
      status: "error",
      message: t.formErrors.invalid,
      fieldErrors: { note: t.orderNotes.tooLong },
    };
  }
  const result = await updateOrderNote(
    orderId,
    note.length === 0 ? null : note,
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidatePath(`/orders/${orderId}`);
    return { status: "success" };
  }
  return toFormState(result, t.formErrors);
}

/** What the Tags card shows after a change. */
export type TagsActionState =
  | { readonly status: "saved"; readonly tags: readonly string[] }
  | { readonly status: "error"; readonly message: string };

/** The Tags card: Enter/comma adds, × removes — saved immediately (Shopify). */
export async function changeOrderTagsAction(
  orderId: string,
  change: { readonly add?: readonly string[]; readonly remove?: readonly string[] },
): Promise<TagsActionState> {
  const t = await dictionary();
  const add = stringList(change.add);
  const remove = stringList(change.remove);
  if (
    typeof orderId !== "string" ||
    orderId.length === 0 ||
    add.length + remove.length === 0 ||
    add.length > MAX_TAGS_PER_CALL ||
    remove.length > MAX_TAGS_PER_CALL
  ) {
    return { status: "error", message: t.formErrors.invalid };
  }
  const result = await changeOrderTags(
    orderId,
    { ...(add.length > 0 ? { add } : {}), ...(remove.length > 0 ? { remove } : {}) },
    newIdempotencyKey(),
  );
  if (result.outcome !== "ok") {
    const state = toFormState(result, t.formErrors);
    return {
      status: "error",
      message: state.status === "error" ? state.message : t.formErrors.unexpected,
    };
  }
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  return { status: "saved", tags: result.data.tags };
}

/** The tag input's suggestions; a failed read simply suggests nothing. */
export async function suggestOrderTagsAction(prefix: string): Promise<readonly string[]> {
  if (typeof prefix !== "string") return [];
  const trimmed = prefix.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return [];
  const found = await fetchOrderTagSuggestions(trimmed);
  return found === null ? [] : found.map((usage) => usage.tag);
}
```

Run the action tests. Expected: PASS.

- [ ] **Step 7: Write the failing component tests**

`apps/admin-web/src/components/orders/tag-input.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { TagInput } from "./tag-input";

function renderInput(props: Partial<Parameters<typeof TagInput>[0]> = {}) {
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  render(
    <TagInput
      label="Add tags"
      tags={["VIP"]}
      onAdd={onAdd}
      onRemove={onRemove}
      t={en}
      {...props}
    />,
  );
  return { onAdd, onRemove, input: screen.getByLabelText("Add tags") as HTMLInputElement };
}

describe("TagInput (order operations Part 2)", () => {
  it("adds the typed tag on Enter and clears the input", () => {
    const { onAdd, input } = renderInput();
    fireEvent.change(input, { target: { value: "  urgent  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith(["urgent"]);
    expect(input.value).toBe("");
  });

  it("a comma adds what came before it and keeps typing after it", () => {
    const { onAdd, input } = renderInput();
    fireEvent.change(input, { target: { value: "gift, urg" } });
    expect(onAdd).toHaveBeenCalledWith(["gift"]);
    expect(input.value).toBe(" urg");
  });

  it("never re-adds a tag the order already has, in any case", () => {
    const { onAdd, input } = renderInput();
    fireEvent.change(input, { target: { value: "vip" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("refuses a tag over 40 characters and says why", () => {
    const { onAdd, input } = renderInput();
    fireEvent.change(input, { target: { value: "x".repeat(41) } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("A tag can have at most 40 characters.");
  });

  it("removes a chip with its × button", () => {
    const { onRemove } = renderInput();
    fireEvent.click(screen.getByRole("button", { name: "Remove VIP" }));
    expect(onRemove).toHaveBeenCalledWith("VIP");
  });

  it("offers the shop's tags while typing, leaving out ones already on the order", async () => {
    const suggest = vi.fn().mockResolvedValue(["VIP", "Village"]);
    const { onAdd, input } = renderInput({ suggest });
    fireEvent.change(input, { target: { value: "vi" } });
    fireEvent.click(await screen.findByRole("button", { name: "Village" }));
    expect(suggest).toHaveBeenCalledWith("vi");
    expect(screen.queryByRole("button", { name: "VIP" })).toBeNull();
    expect(onAdd).toHaveBeenCalledWith(["Village"]);
  });

  it("speaks Arabic on an Arabic page and lays out with logical spacing only", () => {
    render(
      <TagInput label="إضافة علامات" tags={["عاجل"]} onAdd={vi.fn()} onRemove={vi.fn()} t={ar} />,
    );
    const remove = screen.getByRole("button", { name: "إزالة عاجل" });
    expect(remove.className).not.toMatch(/\b(ml|mr|pl|pr)-/);
  });
});
```

`apps/admin-web/src/components/orders/order-notes-card.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { OrderNotesCard } from "./order-notes-card";

const actions = vi.hoisted(() => ({
  saveOrderNoteAction: vi.fn(),
  changeOrderTagsAction: vi.fn(),
  suggestOrderTagsAction: vi.fn(),
}));
vi.mock("@/app/orders/annotation-actions", () => actions);

beforeEach(() => {
  actions.saveOrderNoteAction.mockReset().mockResolvedValue({ status: "success" });
});

describe("OrderNotesCard (Shopify's Notes card)", () => {
  it('says "No notes" when there is none, and shows the note with its line breaks when there is', () => {
    const { rerender } = render(<OrderNotesCard orderId="o-1" note={null} canEdit t={en} />);
    expect(screen.getByText("No notes")).toBeInTheDocument();
    rerender(<OrderNotesCard orderId="o-1" note={"Ring twice\nLeave at door"} canEdit t={en} />);
    expect(screen.getByText(/Ring twice/).className).toContain("whitespace-pre-wrap");
  });

  it("offers no pencil to someone who may not edit notes", () => {
    render(<OrderNotesCard orderId="o-1" note={null} canEdit={false} t={en} />);
    expect(screen.queryByRole("button", { name: "Edit notes" })).toBeNull();
  });

  it("edits in a dialog prefilled with the note, saves through the action and closes", async () => {
    render(<OrderNotesCard orderId="o-1" note="Ring twice" canEdit t={en} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit notes" }));
    const textarea = screen.getByLabelText("Note") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Ring twice");
    fireEvent.change(textarea, { target: { value: "Call first" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(actions.saveOrderNoteAction).toHaveBeenCalled());
    const formData = actions.saveOrderNoteAction.mock.calls[0]?.[1] as FormData;
    expect(formData.get("orderId")).toBe("o-1");
    expect(formData.get("note")).toBe("Call first");
    await waitFor(() => expect(screen.queryByLabelText("Note")).toBeNull());
  });

  it("shows the refusal in the dialog", async () => {
    actions.saveOrderNoteAction.mockResolvedValue({
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: { note: "Notes can have at most 5,000 characters." },
    });
    render(<OrderNotesCard orderId="o-1" note={null} canEdit t={en} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Notes can have at most 5,000 characters.")).toBeInTheDocument();
  });

  it("is in Arabic on an Arabic page", () => {
    render(<OrderNotesCard orderId="o-1" note={null} canEdit t={ar} />);
    expect(screen.getByText("ملاحظات")).toBeInTheDocument();
    expect(screen.getByText("لا توجد ملاحظات")).toBeInTheDocument();
  });
});
```

`apps/admin-web/src/components/orders/order-tags-card.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "@/messages/en";
import { OrderTagsCard } from "./order-tags-card";

const actions = vi.hoisted(() => ({
  saveOrderNoteAction: vi.fn(),
  changeOrderTagsAction: vi.fn(),
  suggestOrderTagsAction: vi.fn(),
}));
vi.mock("@/app/orders/annotation-actions", () => actions);

beforeEach(() => {
  actions.changeOrderTagsAction.mockReset();
  actions.suggestOrderTagsAction.mockReset().mockResolvedValue([]);
});

describe("OrderTagsCard (Shopify's Tags card)", () => {
  it("saves an added tag immediately and shows the order's tags the API answered", async () => {
    actions.changeOrderTagsAction.mockResolvedValue({ status: "saved", tags: ["urgent", "VIP"] });
    render(<OrderTagsCard orderId="o-1" tags={["VIP"]} canTag t={en} />);
    const input = screen.getByLabelText("Add tags");
    fireEvent.change(input, { target: { value: "urgent" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(actions.changeOrderTagsAction).toHaveBeenCalledWith("o-1", { add: ["urgent"] }),
    );
    expect(await screen.findByRole("button", { name: "Remove urgent" })).toBeInTheDocument();
  });

  it("removes a tag with its ×", async () => {
    actions.changeOrderTagsAction.mockResolvedValue({ status: "saved", tags: [] });
    render(<OrderTagsCard orderId="o-1" tags={["VIP"]} canTag t={en} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove VIP" }));
    await waitFor(() =>
      expect(actions.changeOrderTagsAction).toHaveBeenCalledWith("o-1", { remove: ["VIP"] }),
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove VIP" })).toBeNull());
  });

  it("shows the refusal", async () => {
    actions.changeOrderTagsAction.mockResolvedValue({ status: "error", message: "Not allowed" });
    render(<OrderTagsCard orderId="o-1" tags={["VIP"]} canTag t={en} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove VIP" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not allowed");
  });

  it("a viewer sees the tags without any input or ×, or No tags", () => {
    const { rerender } = render(
      <OrderTagsCard orderId="o-1" tags={["VIP"]} canTag={false} t={en} />,
    );
    expect(screen.getByText("VIP")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add tags")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove VIP" })).toBeNull();
    rerender(<OrderTagsCard orderId="o-1" tags={[]} canTag={false} t={en} />);
    expect(screen.getByText("No tags")).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/components/orders/tag-input.test.tsx src/components/orders/order-notes-card.test.tsx src/components/orders/order-tags-card.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 8: Implement the tag input and the two cards**

`apps/admin-web/src/components/orders/tag-input.tsx`:

```tsx
"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { XIcon } from "lucide-react";
import { Badge, Input, Label } from "@platform/ui";
import { hasTag, splitTagInput } from "@/lib/orders/order-tags";
import type { Dictionary } from "@/messages/en";

const SUGGEST_DEBOUNCE_MS = 200;

/** Tags as chips; with `onRemove`, each chip has a × (logical spacing, so it mirrors in Arabic). */
export function TagChips({
  tags,
  onRemove,
  disabled = false,
  t,
}: {
  readonly tags: readonly string[];
  readonly onRemove?: ((tag: string) => void) | undefined;
  readonly disabled?: boolean;
  readonly t: Dictionary;
}) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t.orderTags.listLabel}>
      {tags.map((tag) => (
        <li key={tag}>
          <Badge variant="neutral" className="gap-1">
            <span>{tag}</span>
            {onRemove !== undefined && (
              <button
                type="button"
                className="hover:text-foreground focus-visible:ring-ring -me-0.5 ms-0.5 rounded focus-visible:outline-none focus-visible:ring-2"
                aria-label={t.orderTags.remove.replace("{tag}", tag)}
                disabled={disabled}
                onClick={() => onRemove(tag)}
              >
                <XIcon aria-hidden="true" className="size-3" />
              </button>
            )}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/**
 * Shopify's tag input: Enter or a comma adds what was typed (a comma splits, case-insensitive
 * duplicates and tags the list already has are dropped, over-long tags are refused with a message),
 * × removes, and — when `suggest` is given — the shop's matching tags are offered while typing.
 */
export function TagInput({
  label,
  tags,
  onAdd,
  onRemove,
  suggest,
  disabled = false,
  t,
}: {
  readonly label: string;
  readonly tags: readonly string[];
  readonly onAdd: (tags: readonly string[]) => void;
  readonly onRemove: (tag: string) => void;
  readonly suggest?: ((prefix: string) => Promise<readonly string[]>) | undefined;
  readonly disabled?: boolean;
  readonly t: Dictionary;
}) {
  const inputId = useId();
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<readonly string[]>([]);
  const [tooLong, setTooLong] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (suggest === undefined) return undefined;
    if (timer.current !== undefined) clearTimeout(timer.current);
    const prefix = value.trim();
    if (prefix.length === 0) {
      setSuggestions([]);
      return undefined;
    }
    let cancelled = false;
    timer.current = setTimeout(() => {
      suggest(prefix)
        .then((found) => {
          if (!cancelled) setSuggestions(found.filter((tag) => !hasTag(tags, tag)));
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        });
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
    };
  }, [value, suggest, tags]);

  const commit = (raw: string) => {
    const split = splitTagInput(raw);
    setTooLong(split.tooLong.length > 0);
    const fresh = split.tags.filter((tag) => !hasTag(tags, tag));
    if (fresh.length > 0) onAdd(fresh);
  };

  const onChange = (next: string) => {
    const cut = next.lastIndexOf(",");
    if (cut >= 0) {
      commit(next.slice(0, cut));
      setValue(next.slice(cut + 1));
      return;
    }
    setValue(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commit(value);
    setValue("");
  };

  const pick = (tag: string) => {
    onAdd([tag]);
    setValue("");
    setSuggestions([]);
  };

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        id={inputId}
        value={value}
        disabled={disabled}
        autoComplete="off"
        placeholder={t.orderTags.placeholder}
        aria-describedby={tooLong ? `${inputId}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {tooLong && (
        <p id={`${inputId}-error`} role="alert" className="text-destructive text-sm">
          {t.orderTags.tooLong}
        </p>
      )}
      {suggestions.length > 0 && (
        <ul
          aria-label={t.orderTags.suggestions}
          className="border-border bg-card flex flex-col rounded-xl border p-1"
        >
          {suggestions.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                className="hover:bg-muted focus-visible:ring-ring w-full rounded-lg px-2 py-1 text-start text-sm focus-visible:outline-none focus-visible:ring-2"
                onClick={() => pick(tag)}
              >
                {tag}
              </button>
            </li>
          ))}
        </ul>
      )}
      {tags.length > 0 && <TagChips tags={tags} onRemove={onRemove} disabled={disabled} t={t} />}
    </div>
  );
}
```

`apps/admin-web/src/components/orders/order-notes-card.tsx`:

```tsx
"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { PencilIcon } from "lucide-react";
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
  DialogTrigger,
  Label,
} from "@platform/ui";
import { saveOrderNoteAction } from "@/app/orders/annotation-actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * Shopify's Notes card, first in the order page's right column: the note (line breaks kept) or "No
 * notes"; a pencil opens a dialog with a textarea, saved through `saveOrderNoteAction`. `canEdit` is
 * decided on the server from the role (`orders:edit_note`).
 */
export function OrderNotesCard({
  orderId,
  note,
  canEdit,
  t,
}: {
  readonly orderId: string;
  readonly note: string | null;
  readonly canEdit: boolean;
  readonly t: Dictionary;
}) {
  const n = t.orderNotes;
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(saveOrderNoteAction, INITIAL_STATE);
  const fieldError = state.status === "error" ? state.fieldErrors["note"] : undefined;

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{n.title}</CardTitle>
        {canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="ghost" size="sm" aria-label={n.edit} title={n.edit}>
                <PencilIcon aria-hidden="true" className="size-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{n.dialogTitle}</DialogTitle>
              </DialogHeader>
              <form action={formAction} className="flex flex-col gap-4">
                <input type="hidden" name="orderId" value={orderId} />
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${formId}-note`}>{n.label}</Label>
                  <textarea
                    id={`${formId}-note`}
                    name="note"
                    rows={6}
                    defaultValue={note ?? ""}
                    aria-invalid={fieldError !== undefined || undefined}
                    className="border-input bg-card focus-visible:ring-ring min-h-32 w-full rounded-xl border px-3.5 py-2 text-base focus-visible:outline-none focus-visible:ring-2"
                  />
                  {fieldError !== undefined && (
                    <p className="text-destructive text-sm">{fieldError}</p>
                  )}
                </div>
                {state.status === "error" && fieldError === undefined && (
                  <p role="alert" className="text-destructive text-sm">
                    {state.message}
                  </p>
                )}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                    {n.cancel}
                  </Button>
                  <Button type="submit" loading={isPending} disabled={isPending}>
                    {isPending ? n.saving : n.save}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {note === null ? (
          <p className="text-muted-foreground text-sm">{n.empty}</p>
        ) : (
          <p className="whitespace-pre-wrap text-sm">{note}</p>
        )}
      </CardContent>
    </Card>
  );
}
```

`apps/admin-web/src/components/orders/order-tags-card.tsx`:

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import {
  changeOrderTagsAction,
  suggestOrderTagsAction,
  type TagsActionState,
} from "@/app/orders/annotation-actions";
import type { Dictionary } from "@/messages/en";
import { TagChips, TagInput } from "./tag-input";

/**
 * Shopify's Tags card (last in the order page's right column): chips with ×, an input with the shop's
 * suggestions; every change is saved immediately and the card shows the tags the API answered.
 * `canTag` (`orders:tag`) is decided on the server; a viewer sees the chips only.
 */
export function OrderTagsCard({
  orderId,
  tags,
  canTag,
  t,
}: {
  readonly orderId: string;
  readonly tags: readonly string[];
  readonly canTag: boolean;
  readonly t: Dictionary;
}) {
  const [current, setCurrent] = useState<readonly string[]>(tags);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setCurrent(tags);
  }, [tags]);

  const apply = (change: {
    readonly add?: readonly string[];
    readonly remove?: readonly string[];
  }) =>
    startTransition(async () => {
      let state: TagsActionState;
      try {
        state = await changeOrderTagsAction(orderId, change);
      } catch {
        state = { status: "error", message: t.formErrors.unexpected };
      }
      if (state.status === "saved") {
        setCurrent(state.tags);
        setError(null);
      } else {
        setError(state.message);
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.orderTags.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {canTag ? (
          <TagInput
            label={t.orderTags.inputLabel}
            tags={current}
            disabled={isPending}
            onAdd={(add) => apply({ add })}
            onRemove={(tag) => apply({ remove: [tag] })}
            suggest={suggestOrderTagsAction}
            t={t}
          />
        ) : current.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.orderTags.empty}</p>
        ) : (
          <TagChips tags={current} t={t} />
        )}
        {error !== null && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

Run the three component test files. Expected: PASS.

- [ ] **Step 9: Place the cards on the order page (Shopify's order)**

In `apps/admin-web/src/app/orders/[orderId]/page.tsx`:

1. Import `OrderNotesCard` from `@/components/orders/order-notes-card` and `OrderTagsCard` from
   `@/components/orders/order-tags-card`.
2. Replace `const { canArchive } = orderActionPermissionsFor(…)` with
   `const permissions = orderActionPermissionsFor(highestRole((await readSession())?.roles ?? []));`
   and pass `canArchive={permissions.canArchive}` to `OrderHeader`.
3. In the right column, put the Notes card first and the Tags card last:

```tsx
<div className="flex flex-col gap-6">
  <OrderNotesCard
    orderId={order.id}
    note={order.note ?? null}
    canEdit={permissions.canEditNote}
    t={t}
  />

  <Suspense fallback={<OrderCustomerCardSkeleton t={t} />}>
    <OrderCustomerCard order={order} t={t} />
  </Suspense>

  <OrderShippingAddressCard address={order.shippingAddress} t={t} locale={locale} />

  <OrderBillingAddressCard
    shippingAddress={order.shippingAddress}
    billingAddress={order.billingAddress}
    t={t}
    locale={locale}
  />

  <OrderTagsCard orderId={order.id} tags={order.tags ?? []} canTag={permissions.canTag} t={t} />
</div>
```

4. Update the page's doc comment's "Sidebar:" sentence to "Sidebar: Notes, the customer, the shipping
   address (copy + map), the billing address, then Tags (Shopify's order)."

- [ ] **Step 10: Run the app's suite, typecheck, lint, commit**

Run: `pnpm --filter admin-web test && pnpm --filter admin-web typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint`
Expected: all PASS (`route-contract.test.ts` finds `PUT /orders/:orderId/note`, `POST /orders/:orderId/tags`
and `GET /order-tags` among the API's routes).

```bash
git add apps/admin-web/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin-web): notes and tags cards on the order page

Shopify's Notes card (dialog editor, "No notes") first and the Tags card (chips, comma/Enter
input, suggestions, saved immediately) last in the right column, gated by the role on the server.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: admin-web — comments on the order timeline

Model tier: **standard**.

**Files:**

- Modify: `apps/admin-web/src/lib/api/orders.ts`, `orders.test.ts` (comment calls)
- Modify: `apps/admin-web/src/app/orders/annotation-actions.ts`, `annotation-actions.test.ts` (comment actions)
- Create: `apps/admin-web/src/lib/orders/order-timeline.ts`, `order-timeline.test.ts`
- Create: `apps/admin-web/src/components/orders/order-comment-composer.tsx`, `order-comment-composer.test.tsx`
- Create: `apps/admin-web/src/components/orders/order-comment-item.tsx`, `order-comment-item.test.tsx`
- Modify: `apps/admin-web/src/components/orders/order-timeline.tsx`, `order-timeline.test.tsx`
- Modify: `apps/admin-web/src/app/orders/[orderId]/page.tsx`
- Modify: `apps/admin-web/src/messages/en.ts`, `apps/admin-web/src/messages/ar.ts`

**Interfaces:**

- Consumes (Tasks 4, 6): `POST /orders/:orderId/comments` → 201 `TimelineEntryDto`; `PATCH`/`DELETE /orders/:orderId/comments/:entryId`; `TimelineEntryDto`, `OrderDetailDto.timelineEntries`, `OrderHistoryEntryDto`; `orderActionPermissionsFor(...).canComment`; `characterCount`, `MAX_COMMENT_LENGTH`; `zonedDay` (`lib/orders/zoned-time.ts`), `formatCalendarDay`, `formatDateTime` (`lib/format.ts`); `storeSettingsOrDefaults` (`lib/api/store-settings.ts`).
- Produces:
  - `lib/api/orders.ts`: `addOrderComment(orderId, body, idempotencyKey): Promise<MutationResult<TimelineEntryDto>>`, `editOrderComment(orderId, entryId, body, idempotencyKey)`, `deleteOrderComment(orderId, entryId, idempotencyKey)` (same result type).
  - Server actions `postOrderCommentAction`, `editOrderCommentAction`, `deleteOrderCommentAction` — each `(previous: FormState, formData: FormData) => Promise<FormState>`; fields `orderId`, `entryId` (edit/delete), `body` (post/edit).
  - `lib/orders/order-timeline.ts`: `type TimelineItem`, `interface TimelineDay { day: string; items: readonly TimelineItem[] }`, `mergeTimeline(history, entries, timeZone): readonly TimelineDay[]`, `activityLabel(entry: TimelineEntryDto, t: Dictionary): string`.
  - `OrderTimeline` gains optional props `entries` (default `[]`), `timeZone` (default `"UTC"`), `orderId`, `canComment` (default `false`).
  - `OrderCommentComposer({ orderId, t })`, `OrderCommentItem({ orderId, entry, t, locale })`.
  - Messages: `orderComments.*`, `orderTimeline.*`.

- [ ] **Step 1: Add the copy (English and Arabic)**

In `apps/admin-web/src/messages/en.ts`, after the `orderTags: { … },` block (Task 6), add:

```ts
  /** Order operations Part 2 — Shopify's comment composer and comments on the order timeline. */
  orderComments: {
    label: "Comment",
    placeholder: "Leave a comment...",
    post: "Post",
    posting: "Posting…",
    edit: "Edit",
    delete: "Delete",
    save: "Save",
    cancel: "Cancel",
    edited: "Edited",
    confirmDelete: "Delete this comment?",
    empty: "Write a comment first.",
    tooLong: "Comments can have at most 5,000 characters.",
  },
  /** Order operations Part 2 — staff activity lines on the order timeline. `{author}` is a staff name. */
  orderTimeline: {
    staff: "Staff",
    archived: "{author} archived this order",
    unarchived: "{author} unarchived this order",
    noteChanged: "{author} edited the note",
    noteRemoved: "{author} removed the note",
    tagsAdded: "{author} added tags {tags}",
    tagsRemoved: "{author} removed tags {tags}",
    createdFromDraft: "Order created from draft #{draft}",
    commentDeleted: "Comment deleted",
    tagSeparator: ", ",
  },
```

and in `ar.ts`, at the same place:

```ts
  orderComments: {
    label: "تعليق",
    placeholder: "اكتب تعليقًا...",
    post: "نشر",
    posting: "جارٍ النشر…",
    edit: "تعديل",
    delete: "حذف",
    save: "حفظ",
    cancel: "إلغاء",
    edited: "تم التعديل",
    confirmDelete: "حذف هذا التعليق؟",
    empty: "اكتب التعليق أولًا.",
    tooLong: "التعليق لا يتجاوز ٥٬٠٠٠ حرف.",
  },
  orderTimeline: {
    staff: "أحد الموظفين",
    archived: "{author} أرشف هذا الطلب",
    unarchived: "{author} ألغى أرشفة هذا الطلب",
    noteChanged: "{author} عدّل الملاحظة",
    noteRemoved: "{author} حذف الملاحظة",
    tagsAdded: "{author} أضاف العلامات {tags}",
    tagsRemoved: "{author} أزال العلامات {tags}",
    createdFromDraft: "تم إنشاء الطلب من المسودة #{draft}",
    commentDeleted: "تم حذف التعليق",
    tagSeparator: "، ",
  },
```

Run: `pnpm --filter admin-web exec vitest run src/lib/i18n.test.ts`
Expected: PASS.

- [ ] **Step 2: Write the failing API, action and timeline-rule tests**

Append to `apps/admin-web/src/lib/api/orders.test.ts` (add `addOrderComment`, `editOrderComment`,
`deleteOrderComment` to the import destructuring):

```ts
describe("comments (order operations Part 2)", () => {
  const entry = {
    id: "e-1",
    kind: "comment",
    authorName: "Ahmed",
    body: "Called",
    data: {},
    createdAt: "2026-10-19T09:00:00.000Z",
    editedAt: null,
    deleted: false,
    canEdit: true,
    canDelete: true,
  };

  it("posts, patches and deletes under the order's comments path with the idempotency key", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, entry)));
    vi.stubGlobal("fetch", fetchMock);
    expect(await addOrderComment("o-1", "Called", "k-1")).toEqual({ outcome: "ok", data: entry });
    await editOrderComment("o-1", "e 1", "Called again", "k-2");
    await deleteOrderComment("o-1", "e-1", "k-3");
    const calls = fetchMock.mock.calls as [string, RequestInit][];
    expect(calls.map(([url, init]) => [init.method, url.replace(/^.*\/api\/v1/, "")])).toEqual([
      ["POST", "/orders/o-1/comments"],
      ["PATCH", "/orders/o-1/comments/e%201"],
      ["DELETE", "/orders/o-1/comments/e-1"],
    ]);
    expect(JSON.parse(String(calls[1]?.[1].body))).toEqual({ body: "Called again" });
    expect((calls[2]?.[1].headers as Record<string, string>)["idempotency-key"]).toBe("k-3");
  });
});
```

Append to `apps/admin-web/src/app/orders/annotation-actions.test.ts` (add
`postOrderCommentAction`, `editOrderCommentAction`, `deleteOrderCommentAction` to the import):

```ts
describe("comment actions", () => {
  it("posts the trimmed comment and refreshes the order page", async () => {
    orders.addOrderComment.mockResolvedValue({ outcome: "ok", data: {} });
    const state = await postOrderCommentAction(idle, form({ orderId: "o-1", body: "  Called " }));
    expect(state).toEqual({ status: "success" });
    expect(orders.addOrderComment).toHaveBeenCalledWith("o-1", "Called", expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/orders/o-1");
  });

  it("refuses an empty or a 5,001-character comment without calling the API", async () => {
    for (const body of ["   ", "a".repeat(5001)]) {
      const state = await postOrderCommentAction(idle, form({ orderId: "o-1", body }));
      expect(state.status).toBe("error");
      if (state.status === "error") expect(state.fieldErrors["body"]).toBeDefined();
    }
    expect(orders.addOrderComment).not.toHaveBeenCalled();
  });

  it("edits and deletes by entry id, refusing a form without one", async () => {
    orders.editOrderComment.mockResolvedValue({ outcome: "ok", data: {} });
    orders.deleteOrderComment.mockResolvedValue({ outcome: "forbidden" });
    expect(
      await editOrderCommentAction(idle, form({ orderId: "o-1", entryId: "e-1", body: "x" })),
    ).toEqual({ status: "success" });
    expect(orders.editOrderComment).toHaveBeenCalledWith("o-1", "e-1", "x", expect.any(String));
    const refused = await deleteOrderCommentAction(idle, form({ orderId: "o-1", entryId: "e-1" }));
    expect(refused.status).toBe("error");
    expect((await deleteOrderCommentAction(idle, form({ orderId: "o-1" }))).status).toBe("error");
    expect(orders.deleteOrderComment).toHaveBeenCalledTimes(1);
  });
});
```

`apps/admin-web/src/lib/orders/order-timeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TimelineEntryDto } from "@/lib/api/orders";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { activityLabel, mergeTimeline } from "./order-timeline";

function line(overrides: Partial<TimelineEntryDto> = {}): TimelineEntryDto {
  return {
    id: "e-1",
    kind: "comment",
    authorName: "Ahmed",
    body: "Called",
    data: {},
    createdAt: "2026-10-19T08:00:00.000Z",
    editedAt: null,
    deleted: false,
    canEdit: false,
    canDelete: false,
    ...overrides,
  };
}

describe("mergeTimeline", () => {
  it("lists lifecycle events and staff lines newest first, grouped by the shop's calendar day", () => {
    const days = mergeTimeline(
      [
        { type: "created", occurredAt: "2026-10-18T20:00:00.000Z" }, // Cairo: Oct 18, 23:00
        { type: "confirmed", occurredAt: "2026-10-18T22:30:00.000Z" }, // Cairo: Oct 19, 01:30
      ],
      [line({ createdAt: "2026-10-19T08:00:00.000Z" })],
      "Africa/Cairo",
    );
    expect(days.map((day) => [day.day, day.items.map((item) => item.kind)])).toEqual([
      ["2026-10-19", ["entry", "event"]],
      ["2026-10-18", ["event"]],
    ]);
  });

  it("puts a staff line above a lifecycle event at the same instant, and keeps events' own newest-first order", () => {
    const at = "2026-10-19T08:00:00.000Z";
    const [day] = mergeTimeline(
      [
        { type: "created", occurredAt: at },
        { type: "confirmed", occurredAt: at },
      ],
      [line({ createdAt: at })],
      "UTC",
    );
    expect(
      day?.items.map((item) => (item.kind === "event" ? item.event.type : item.entry.kind)),
    ).toEqual(["comment", "confirmed", "created"]);
  });
});

describe("activityLabel", () => {
  it("says who did what, with Staff for an unknown author", () => {
    expect(activityLabel(line({ kind: "archived", body: null }), en)).toBe(
      "Ahmed archived this order",
    );
    expect(activityLabel(line({ kind: "unarchived", body: null, authorName: null }), en)).toBe(
      "Staff unarchived this order",
    );
    expect(
      activityLabel(line({ kind: "note_changed", body: null, data: { cleared: true } }), en),
    ).toBe("Ahmed removed the note");
    expect(
      activityLabel(line({ kind: "note_changed", body: null, data: { cleared: false } }), en),
    ).toBe("Ahmed edited the note");
    expect(
      activityLabel(
        line({ kind: "tags_added", body: null, data: { tags: ["VIP", "urgent"] } }),
        en,
      ),
    ).toBe("Ahmed added tags VIP, urgent");
    expect(
      activityLabel(
        line({ kind: "created_from_draft", body: null, data: { draftNumber: "D3" } }),
        en,
      ),
    ).toBe("Order created from draft #D3");
    expect(activityLabel(line({ deleted: true, body: null }), en)).toBe("Comment deleted");
  });

  it("is in Arabic, with the Arabic list separator", () => {
    expect(
      activityLabel(
        line({ kind: "tags_removed", body: null, data: { tags: ["VIP", "عاجل"] } }),
        ar,
      ),
    ).toBe("Ahmed أزال العلامات VIP، عاجل");
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/lib/api/orders.test.ts src/app/orders/annotation-actions.test.ts src/lib/orders/order-timeline.test.ts`
Expected: FAIL — functions/modules missing.

- [ ] **Step 3: Implement the API calls, the actions and the timeline rules**

Append to `apps/admin-web/src/lib/api/orders.ts`:

```ts
function isTimelineEntry(value: unknown): value is TimelineEntryDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { kind?: unknown }).kind === "string"
  );
}

/** `POST /orders/:orderId/comments` (`orders:comment`); the author is the signed-in staff member. */
export function addOrderComment(
  orderId: string,
  body: string,
  idempotencyKey: string,
): Promise<MutationResult<TimelineEntryDto>> {
  return mutateAdminApi(
    orderPath(orderId, "/comments"),
    { method: "POST", body: { body }, idempotencyKey },
    isTimelineEntry,
  );
}

/** `PATCH /orders/:orderId/comments/:entryId` — the API lets only the author edit. */
export function editOrderComment(
  orderId: string,
  entryId: string,
  body: string,
  idempotencyKey: string,
): Promise<MutationResult<TimelineEntryDto>> {
  return mutateAdminApi(
    orderPath(orderId, `/comments/${encodeURIComponent(entryId)}`),
    { method: "PATCH", body: { body }, idempotencyKey },
    isTimelineEntry,
  );
}

/** `DELETE /orders/:orderId/comments/:entryId` — the author, or an admin. */
export function deleteOrderComment(
  orderId: string,
  entryId: string,
  idempotencyKey: string,
): Promise<MutationResult<TimelineEntryDto>> {
  return mutateAdminApi(
    orderPath(orderId, `/comments/${encodeURIComponent(entryId)}`),
    { method: "DELETE", idempotencyKey },
    isTimelineEntry,
  );
}
```

In `apps/admin-web/src/app/orders/annotation-actions.ts`: add `addOrderComment`, `deleteOrderComment`,
`editOrderComment` to the `@/lib/api/orders` import and `MAX_COMMENT_LENGTH` to the
`@/lib/orders/order-tags` import, then append:

```ts
type Dictionary = Awaited<ReturnType<typeof dictionary>>;

/** Why a comment form cannot be sent, or null when it can. */
function commentProblem(orderId: string, body: string, t: Dictionary): FormState | null {
  if (orderId.length === 0)
    return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
  if (body.length === 0) {
    return {
      status: "error",
      message: t.formErrors.invalid,
      fieldErrors: { body: t.orderComments.empty },
    };
  }
  if (characterCount(body) > MAX_COMMENT_LENGTH) {
    return {
      status: "error",
      message: t.formErrors.invalid,
      fieldErrors: { body: t.orderComments.tooLong },
    };
  }
  return null;
}

/** The timeline's composer ("Leave a comment..." → Post). */
export async function postOrderCommentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const orderId = stringField(formData, "orderId");
  const body = stringField(formData, "body").trim();
  const problem = commentProblem(orderId, body, t);
  if (problem !== null) return problem;
  const result = await addOrderComment(orderId, body, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath(`/orders/${orderId}`);
    return { status: "success" };
  }
  return toFormState(result, t.formErrors);
}

/** A comment's Edit → Save. */
export async function editOrderCommentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const orderId = stringField(formData, "orderId");
  const entryId = stringField(formData, "entryId");
  const body = stringField(formData, "body").trim();
  if (entryId.length === 0)
    return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
  const problem = commentProblem(orderId, body, t);
  if (problem !== null) return problem;
  const result = await editOrderComment(orderId, entryId, body, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath(`/orders/${orderId}`);
    return { status: "success" };
  }
  return toFormState(result, t.formErrors);
}

/** A comment's Delete (after the browser's confirmation). */
export async function deleteOrderCommentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const orderId = stringField(formData, "orderId");
  const entryId = stringField(formData, "entryId");
  if (orderId.length === 0 || entryId.length === 0) {
    return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
  }
  const result = await deleteOrderComment(orderId, entryId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath(`/orders/${orderId}`);
    return { status: "success" };
  }
  return toFormState(result, t.formErrors);
}
```

`apps/admin-web/src/lib/orders/order-timeline.ts`:

```ts
import type { OrderHistoryEntryDto, TimelineEntryDto } from "@/lib/api/orders";
import type { Dictionary } from "@/messages/en";
import { zonedDay } from "./zoned-time";

/** One line of the merged timeline: a lifecycle event from `history`, or a staff entry. */
export type TimelineItem =
  | { readonly kind: "event"; readonly at: string; readonly event: OrderHistoryEntryDto }
  | { readonly kind: "entry"; readonly at: string; readonly entry: TimelineEntryDto };

/** The lines of one shop calendar day (`yyyy-mm-dd`), newest first. */
export interface TimelineDay {
  readonly day: string;
  readonly items: readonly TimelineItem[];
}

/**
 * Shopify's single timeline (spec §2.4): lifecycle history and staff entries as ONE list, newest first,
 * grouped by the shop's calendar day. At the same instant a staff line sits above the event it follows;
 * events keep their own newest-first order (the sort is stable over newest-first inputs).
 */
export function mergeTimeline(
  history: readonly OrderHistoryEntryDto[],
  entries: readonly TimelineEntryDto[],
  timeZone: string,
): readonly TimelineDay[] {
  const items: TimelineItem[] = [
    ...entries.map((entry): TimelineItem => ({ kind: "entry", at: entry.createdAt, entry })),
    ...[...history]
      .reverse()
      .map((event): TimelineItem => ({ kind: "event", at: event.occurredAt, event })),
  ];
  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const days: { day: string; items: TimelineItem[] }[] = [];
  for (const item of items) {
    const day = zonedDay(new Date(item.at), timeZone);
    const last = days[days.length - 1];
    if (last !== undefined && last.day === day) last.items.push(item);
    else days.push({ day, items: [item] });
  }
  return days;
}

/** An activity line (or a deleted comment) in words: "Ahmed added tags VIP, urgent". */
export function activityLabel(entry: TimelineEntryDto, t: Dictionary): string {
  const words = t.orderTimeline;
  const author = entry.authorName ?? words.staff;
  const tags = (entry.data.tags ?? []).join(words.tagSeparator);
  switch (entry.kind) {
    case "archived":
      return words.archived.replace("{author}", author);
    case "unarchived":
      return words.unarchived.replace("{author}", author);
    case "note_changed":
      return (entry.data.cleared === true ? words.noteRemoved : words.noteChanged).replace(
        "{author}",
        author,
      );
    case "tags_added":
      return words.tagsAdded.replace("{author}", author).replace("{tags}", tags);
    case "tags_removed":
      return words.tagsRemoved.replace("{author}", author).replace("{tags}", tags);
    case "created_from_draft":
      return words.createdFromDraft.replace("{draft}", entry.data.draftNumber ?? "");
    case "comment":
      return entry.deleted ? words.commentDeleted : (entry.body ?? "");
  }
}
```

Run the three test files. Expected: PASS.

- [ ] **Step 4: Write the failing component tests**

`apps/admin-web/src/components/orders/order-comment-composer.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { OrderCommentComposer } from "./order-comment-composer";

const actions = vi.hoisted(() => ({
  postOrderCommentAction: vi.fn(),
  editOrderCommentAction: vi.fn(),
  deleteOrderCommentAction: vi.fn(),
}));
vi.mock("@/app/orders/annotation-actions", () => actions);

beforeEach(() => {
  actions.postOrderCommentAction.mockReset().mockResolvedValue({ status: "success" });
});

describe("OrderCommentComposer (Shopify's Leave a comment...)", () => {
  it("keeps Post disabled until something is written", () => {
    render(<OrderCommentComposer orderId="o-1" t={en} />);
    const post = screen.getByRole("button", { name: "Post" });
    expect(post).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Leave a comment..."), {
      target: { value: "  " },
    });
    expect(post).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Leave a comment..."), {
      target: { value: "Called" },
    });
    expect(post).toBeEnabled();
  });

  it("posts the order id and text, shows Posting… while it runs, and clears on success", async () => {
    let finish: (state: unknown) => void = () => undefined;
    actions.postOrderCommentAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<OrderCommentComposer orderId="o-1" t={en} />);
    const box = screen.getByPlaceholderText("Leave a comment...") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Called — no answer" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByRole("button", { name: "Posting…" })).toBeDisabled();
    const formData = actions.postOrderCommentAction.mock.calls[0]?.[1] as FormData;
    expect(formData.get("orderId")).toBe("o-1");
    expect(formData.get("body")).toBe("Called — no answer");
    finish({ status: "success" });
    await waitFor(() => expect(box.value).toBe(""));
  });

  it("shows a refusal and keeps the text", async () => {
    actions.postOrderCommentAction.mockResolvedValue({
      status: "error",
      message: "Your account doesn't have permission to do this.",
      fieldErrors: {},
    });
    render(<OrderCommentComposer orderId="o-1" t={en} />);
    const box = screen.getByPlaceholderText("Leave a comment...") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Called" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("permission");
    expect(box.value).toBe("Called");
  });

  it("is in Arabic on an Arabic page", () => {
    render(<OrderCommentComposer orderId="o-1" t={ar} />);
    expect(screen.getByPlaceholderText("اكتب تعليقًا...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "نشر" })).toBeInTheDocument();
  });
});
```

`apps/admin-web/src/components/orders/order-comment-item.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TimelineEntryDto } from "@/lib/api/orders";
import { en } from "@/messages/en";
import { OrderCommentItem } from "./order-comment-item";

const actions = vi.hoisted(() => ({
  postOrderCommentAction: vi.fn(),
  editOrderCommentAction: vi.fn(),
  deleteOrderCommentAction: vi.fn(),
}));
vi.mock("@/app/orders/annotation-actions", () => actions);

function comment(overrides: Partial<TimelineEntryDto> = {}): TimelineEntryDto {
  return {
    id: "e-1",
    kind: "comment",
    authorName: "Mona",
    body: "Called — no answer",
    data: {},
    createdAt: "2026-10-19T09:00:00.000Z",
    editedAt: null,
    deleted: false,
    canEdit: true,
    canDelete: true,
    ...overrides,
  };
}

function renderItem(entry: TimelineEntryDto) {
  render(
    <ol>
      <OrderCommentItem orderId="o-1" entry={entry} t={en} locale="en" />
    </ol>,
  );
}

beforeEach(() => {
  actions.editOrderCommentAction.mockReset().mockResolvedValue({ status: "success" });
  actions.deleteOrderCommentAction.mockReset().mockResolvedValue({ status: "success" });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("OrderCommentItem", () => {
  it("shows the text, the author and Edited, with no buttons it may not use", () => {
    renderItem(comment({ editedAt: "2026-10-19T10:00:00.000Z", canEdit: false, canDelete: false }));
    expect(screen.getByText("Called — no answer")).toBeInTheDocument();
    expect(screen.getByText(/Mona/)).toHaveTextContent("Edited");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("edits in place: Save sends the entry id and new text, and closes on success", async () => {
    renderItem(comment());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByLabelText("Comment") as HTMLTextAreaElement;
    expect(box.value).toBe("Called — no answer");
    fireEvent.change(box, { target: { value: "Called twice" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.editOrderCommentAction).toHaveBeenCalled());
    const formData = actions.editOrderCommentAction.mock.calls[0]?.[1] as FormData;
    expect([formData.get("orderId"), formData.get("entryId"), formData.get("body")]).toEqual([
      "o-1",
      "e-1",
      "Called twice",
    ]);
    await waitFor(() => expect(screen.queryByLabelText("Comment")).toBeNull());
  });

  it("deletes only after the confirmation", async () => {
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    renderItem(comment({ canEdit: false }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(actions.deleteOrderCommentAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(actions.deleteOrderCommentAction).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith("Delete this comment?");
  });
});
```

Append to `apps/admin-web/src/components/orders/order-timeline.test.tsx` — first add, right after the
imports, a mock of the actions the composer/comment item import:

```tsx
vi.mock("@/app/orders/annotation-actions", () => ({
  postOrderCommentAction: vi.fn(),
  editOrderCommentAction: vi.fn(),
  deleteOrderCommentAction: vi.fn(),
}));
```

(add `vi` to the `vitest` import and `import type { TimelineEntryDto } from "@/lib/api/orders";`), then:

```tsx
describe("OrderTimeline — staff comments and activity (order operations Part 2)", () => {
  const staffLine = (overrides: Partial<TimelineEntryDto>): TimelineEntryDto => ({
    id: "e-1",
    kind: "comment",
    authorName: "Ahmed",
    body: "Called",
    data: {},
    createdAt: "2026-10-19T08:00:00.000Z",
    editedAt: null,
    deleted: false,
    canEdit: false,
    canDelete: false,
    ...overrides,
  });

  function renderMerged(entries: TimelineEntryDto[], canComment = false) {
    render(
      <OrderTimeline
        history={[
          { type: "created", occurredAt: "2026-10-18T20:00:00.000Z" },
          { type: "confirmed", occurredAt: "2026-10-18T22:30:00.000Z" },
        ]}
        totalMinor={1999}
        currency="USD"
        paymentProvider="cod"
        t={en}
        locale="en"
        entries={entries}
        timeZone="Africa/Cairo"
        orderId="o-1"
        canComment={canComment}
      />,
    );
  }

  it("merges events and staff lines newest first, one section per shop day", () => {
    renderMerged([
      staffLine({
        id: "e-2",
        kind: "tags_added",
        body: null,
        data: { tags: ["VIP", "urgent"] },
        createdAt: "2026-10-19T09:00:00.000Z",
      }),
      staffLine({}),
    ]);
    expect(screen.getAllByRole("region")).toHaveLength(2);
    expect(screen.getAllByRole("listitem").map(firstLine)).toEqual([
      "Ahmed added tags VIP, urgent",
      "Called",
      "Order confirmed",
      "Order placed",
    ]);
  });

  it('shows a deleted comment as "Comment deleted" with no buttons', () => {
    renderMerged([staffLine({ deleted: true, body: null, canEdit: false, canDelete: false })]);
    expect(screen.getByText("Comment deleted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("offers the composer only to staff who may comment", () => {
    renderMerged([], false);
    expect(screen.queryByPlaceholderText("Leave a comment...")).toBeNull();
    document.body.innerHTML = "";
    renderMerged([], true);
    expect(screen.getByPlaceholderText("Leave a comment...")).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/components/orders/order-comment-composer.test.tsx src/components/orders/order-comment-item.test.tsx src/components/orders/order-timeline.test.tsx`
Expected: FAIL — modules missing; the timeline ignores `entries`.

- [ ] **Step 5: Implement the composer, the comment line and the merged timeline**

`apps/admin-web/src/components/orders/order-comment-composer.tsx`:

```tsx
"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { Button, Label } from "@platform/ui";
import { postOrderCommentAction } from "@/app/orders/annotation-actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * Shopify's comment composer on top of the timeline: "Leave a comment..." and Post. Post is disabled
 * while empty and while posting (one submit = one idempotency key on the server, no double posts);
 * the text clears after a successful post and stays after a refusal.
 */
export function OrderCommentComposer({
  orderId,
  t,
}: {
  readonly orderId: string;
  readonly t: Dictionary;
}) {
  const c = t.orderComments;
  const id = useId();
  const [body, setBody] = useState("");
  const [state, formAction, isPending] = useActionState(postOrderCommentAction, INITIAL_STATE);
  const fieldError = state.status === "error" ? state.fieldErrors["body"] : undefined;

  useEffect(() => {
    if (state.status === "success") setBody("");
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <Label htmlFor={id} className="sr-only">
        {c.label}
      </Label>
      <textarea
        id={id}
        name="body"
        rows={2}
        value={body}
        placeholder={c.placeholder}
        onChange={(event) => setBody(event.target.value)}
        className="border-input bg-card focus-visible:ring-ring w-full rounded-xl border px-3.5 py-2 text-base focus-visible:outline-none focus-visible:ring-2"
      />
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-sm">
          {fieldError ?? state.message}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          loading={isPending}
          disabled={isPending || body.trim().length === 0}
        >
          {isPending ? c.posting : c.post}
        </Button>
      </div>
    </form>
  );
}
```

`apps/admin-web/src/components/orders/order-comment-item.tsx`:

```tsx
"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { Button, Label } from "@platform/ui";
import { deleteOrderCommentAction, editOrderCommentAction } from "@/app/orders/annotation-actions";
import type { TimelineEntryDto } from "@/lib/api/orders";
import type { FormState } from "@/lib/api/mutation";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * One staff comment on the timeline: text, author · time (· Edited), and — only when the API says so
 * (`canEdit`/`canDelete`) — Edit (in place) and Delete (after a confirmation). A `<li>` whose first
 * paragraph is the text, like every other timeline line.
 */
export function OrderCommentItem({
  orderId,
  entry,
  t,
  locale,
}: {
  readonly orderId: string;
  readonly entry: TimelineEntryDto;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const c = t.orderComments;
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [editState, editAction, editPending] = useActionState(
    editOrderCommentAction,
    INITIAL_STATE,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteOrderCommentAction,
    INITIAL_STATE,
  );

  useEffect(() => {
    if (editState.status === "success") setEditing(false);
  }, [editState]);

  const error =
    editState.status === "error"
      ? (editState.fieldErrors["body"] ?? editState.message)
      : deleteState.status === "error"
        ? deleteState.message
        : null;
  const byline = [
    entry.authorName ?? t.orderTimeline.staff,
    formatDateTime(locale, entry.createdAt),
    ...(entry.editedAt === null ? [] : [c.edited]),
  ].join(" · ");

  return (
    <li className="flex items-start gap-3">
      <span aria-hidden="true" className="bg-border mt-1.5 size-2.5 shrink-0 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {editing ? (
          <form action={editAction} className="flex flex-col gap-2">
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="entryId" value={entry.id} />
            <Label htmlFor={id} className="sr-only">
              {c.label}
            </Label>
            <textarea
              id={id}
              name="body"
              rows={2}
              defaultValue={entry.body ?? ""}
              className="border-input bg-card focus-visible:ring-ring w-full rounded-xl border px-3.5 py-2 text-base focus-visible:outline-none focus-visible:ring-2"
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={editPending} disabled={editPending}>
                {c.save}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {c.cancel}
              </Button>
            </div>
          </form>
        ) : (
          <p className="whitespace-pre-wrap text-sm">{entry.body}</p>
        )}
        <p className="text-muted-foreground text-xs">{byline}</p>
        {!editing && (entry.canEdit || entry.canDelete) && (
          <div className="flex gap-2">
            {entry.canEdit && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
                {c.edit}
              </Button>
            )}
            {entry.canDelete && (
              <form
                action={deleteAction}
                onSubmit={(event) => {
                  if (!window.confirm(c.confirmDelete)) event.preventDefault();
                }}
              >
                <input type="hidden" name="orderId" value={orderId} />
                <input type="hidden" name="entryId" value={entry.id} />
                <Button type="submit" size="sm" variant="ghost" disabled={deletePending}>
                  {c.delete}
                </Button>
              </form>
            )}
          </div>
        )}
        {error !== null && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
```

Replace `apps/admin-web/src/components/orders/order-timeline.tsx` with:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { OrderHistoryEntryDto, TimelineEntryDto } from "@/lib/api/orders";
import { formatCalendarDay, formatCurrency, formatDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { activityLabel, mergeTimeline } from "@/lib/orders/order-timeline";
import { paymentMethodLabel } from "@/lib/payment-method-label";
import type { Dictionary } from "@/messages/en";
import { OrderCommentComposer } from "./order-comment-composer";
import { OrderCommentItem } from "./order-comment-item";

/**
 * One timeline line in words: "Order placed", "Payment of $19.99 pending (Cash on delivery)",
 * "Payment of $19.99 received". `{total}` is the order total and `{method}` how the customer pays; a
 * pending payment with no known method drops the parenthesis. A lifecycle event this build has no
 * words for is shown as its raw name rather than hidden.
 */
function eventLabel(
  type: string,
  context: { readonly total: string; readonly paymentProvider: string | null },
  t: Dictionary,
): string {
  const labels = t.orderPage.timeline as Record<string, string>;
  const key =
    type === "payment_requested" && context.paymentProvider === null
      ? "payment_requestedNoMethod"
      : type;
  const template = labels[key];
  if (template === undefined) return type;
  return template
    .replace("{total}", context.total)
    .replace("{method}", paymentMethodLabel(context.paymentProvider, t));
}

function Line({
  label,
  at,
  newest,
  locale,
}: {
  readonly label: string;
  readonly at: string;
  readonly newest: boolean;
  readonly locale: Locale;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={
          newest
            ? "bg-primary mt-1.5 size-2.5 shrink-0 rounded-full"
            : "bg-border mt-1.5 size-2.5 shrink-0 rounded-full"
        }
      />
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-xs">{formatDateTime(locale, at)}</p>
      </div>
    </li>
  );
}

/**
 * Shopify's order timeline (spec §2.4): the comment composer on top (staff who may comment), then ONE
 * list merging the lifecycle `history` and the staff `entries`, newest first, grouped by the shop's
 * calendar day. Comments show author, time and text with Edit/Delete as the API allows; activity reads
 * "Ahmed archived this order".
 */
export function OrderTimeline({
  history,
  totalMinor,
  currency,
  paymentProvider,
  t,
  locale,
  entries = [],
  timeZone = "UTC",
  orderId,
  canComment = false,
}: {
  readonly history: readonly OrderHistoryEntryDto[];
  readonly totalMinor: number;
  readonly currency: string;
  readonly paymentProvider: string | null;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly entries?: readonly TimelineEntryDto[];
  /** The shop's time zone — the day groups follow its calendar. */
  readonly timeZone?: string;
  readonly orderId?: string;
  /** `orders:comment`, decided on the server. */
  readonly canComment?: boolean;
}) {
  const context = { total: formatCurrency(locale, totalMinor, currency), paymentProvider };
  const days = mergeTimeline(history, entries, timeZone);
  const newest = days[0]?.items[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.orderDetail.timeline}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {canComment && orderId !== undefined && <OrderCommentComposer orderId={orderId} t={t} />}
        {days.map((group) => {
          const dayLabel = formatCalendarDay(locale, group.day);
          return (
            <section key={group.day} aria-label={dayLabel} className="flex flex-col gap-3">
              <h4 className="text-muted-foreground text-xs font-medium">{dayLabel}</h4>
              <ol className="flex flex-col gap-4">
                {group.items.map((item) => {
                  if (item.kind === "event") {
                    return (
                      <Line
                        key={`${item.event.type}-${item.event.occurredAt}`}
                        label={eventLabel(item.event.type, context, t)}
                        at={item.at}
                        newest={item === newest}
                        locale={locale}
                      />
                    );
                  }
                  const entry = item.entry;
                  if (entry.kind === "comment" && !entry.deleted && orderId !== undefined) {
                    return (
                      <OrderCommentItem
                        key={entry.id}
                        orderId={orderId}
                        entry={entry}
                        t={t}
                        locale={locale}
                      />
                    );
                  }
                  return (
                    <Line
                      key={entry.id}
                      label={activityLabel(entry, t)}
                      at={item.at}
                      newest={item === newest}
                      locale={locale}
                    />
                  );
                })}
              </ol>
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
```

Run the three component test files plus the existing timeline tests. Expected: PASS.

- [ ] **Step 6: Feed the timeline on the order page**

In `apps/admin-web/src/app/orders/[orderId]/page.tsx`:

1. Import `storeSettingsOrDefaults` from `@/lib/api/store-settings`.
2. Replace `const result = await fetchOrder(orderId);` with
   `const [result, settings] = await Promise.all([fetchOrder(orderId), storeSettingsOrDefaults()]);`.
3. Pass the new props to `OrderTimeline`:

```tsx
<OrderTimeline
  history={order.history}
  totalMinor={order.totalMinor}
  currency={order.currency}
  paymentProvider={order.paymentProvider}
  t={t}
  locale={locale}
  entries={order.timelineEntries ?? []}
  timeZone={settings.timezone}
  orderId={order.id}
  canComment={permissions.canComment}
/>
```

- [ ] **Step 7: Run the app's suite, typecheck, lint, commit**

Run: `pnpm --filter admin-web test && pnpm --filter admin-web typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint`
Expected: all PASS (`route-contract.test.ts` finds the three comment routes).

```bash
git add apps/admin-web/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin-web): comments and staff activity on the order timeline

Shopify's composer on top of one timeline that merges lifecycle events with staff comments and
activity, newest first and grouped by the shop's day; Edit/Delete appear only where the API says.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: admin-web — Tags column, "Tagged with" filter and bulk Add / Remove tags on the list

Model tier: **standard**.

**Files:**

- Modify: `apps/admin-web/src/lib/api/orders.ts`, `orders.test.ts` (list/export `tags`, bulk `tags`)
- Modify: `apps/admin-web/src/lib/orders/order-views.ts`, `order-views.test.ts` (tags kept in tab links and the export context)
- Modify: `apps/admin-web/src/lib/orders/orders-export.ts`, `orders-export.test.ts`
- Modify: `apps/admin-web/src/app/orders/actions.ts`, `actions.test.ts` (`runBulkOrderAction(action, ids, tags?)`)
- Create: `apps/admin-web/src/components/orders/orders-bulk-tags-dialog.tsx`, `orders-bulk-tags-dialog.test.tsx`
- Modify: `apps/admin-web/src/components/orders/orders-bulk-bar.tsx`
- Modify: `apps/admin-web/src/components/orders/orders-table.tsx`, `orders-table.test.tsx`
- Modify: `apps/admin-web/src/components/orders/orders-toolbar.tsx`, `orders-toolbar.test.tsx`
- Modify: `apps/admin-web/src/components/orders/orders-view-tabs.tsx`
- Modify: `apps/admin-web/src/components/orders/orders-export-dialog.tsx`, `orders-export-dialog.test.tsx`
- Modify: `apps/admin-web/src/app/orders/page.tsx`
- Modify: `apps/admin-web/src/messages/en.ts`, `apps/admin-web/src/messages/ar.ts`

**Interfaces:**

- Consumes (Tasks 5–6): `GET /orders?tag=` / `GET /orders/export-rows?tag=` (repeatable), `POST /orders/bulk` `add_tags`/`remove_tags` with `tags` (1..20), skip reasons `already_tagged`/`not_tagged`, fail `too_many_tags`; `OrderListItemDto.tags`; `TagInput`, `TagChips`; `suggestOrderTagsAction`; `parseTagFilter`; `OrderActionPermissions.canTag`.
- Produces:
  - `OrdersListQuery.tags?: readonly string[]`, `OrderExportQuery.tags?: readonly string[] | undefined` (sent as repeated `tag`); `BULK_ORDER_ACTIONS` += `add_tags`, `remove_tags`; `bulkOrders(action, orderIds, idempotencyKey, tags?: readonly string[])`.
  - `runBulkOrderAction(action: string, orderIds: readonly string[], tags?: readonly string[]): Promise<BulkActionState>`.
  - `ordersViewHref(view, keep: { q?; status?; tags?: readonly string[] })`; `ordersExportContextFor(role, view, params: { q?; status?; after?; tags?: readonly string[] })`; `OrdersExportContext.tags?: readonly string[]`.
  - `OrdersBulkTagsDialog({ open, title, submitLabel, pending, onOpenChange, onSubmit, t })`.
  - The list URL keeps the tag filter as one comma list: `/orders?tag=vip,urgent`.
  - Messages: `ordersPage.columns.tags`, `ordersPage.taggedWith`, `ordersPage.moreTags`, `ordersPage.bulk.addTags/removeTags/tagsDialog.*`, `ordersPage.bulk.reasons.already_tagged/not_tagged/too_many_tags`.

- [ ] **Step 1: Add the copy (English and Arabic)**

`en.ts`, inside `ordersPage`:

- `columns`: add `tags: "Tags",` after `deliveryMethod`.
- after `filter: "Filter",` add `taggedWith: "Tagged with",` and `moreTags: "+{count} more",`.
- inside `bulk`, after `markCashReceived` add:

```ts
      addTags: "Add tags",
      removeTags: "Remove tags",
      tagsDialog: {
        addTitle: "Add tags to {count} orders",
        removeTitle: "Remove tags from {count} orders",
        inputLabel: "Tags",
        add: "Add",
        remove: "Remove",
        cancel: "Cancel",
      },
```

- inside `bulk.reasons`, add:

```ts
        already_tagged: "Already has these tags",
        not_tagged: "Has none of these tags",
        too_many_tags: "Would have more than 250 tags",
```

`ar.ts`, the same keys:

- `columns.tags: "العلامات",`; `taggedWith: "مُعلَّمة بـ",`; `moreTags: "+{count} أخرى",`.
- `bulk`:

```ts
      addTags: "إضافة علامات",
      removeTags: "إزالة علامات",
      tagsDialog: {
        addTitle: "إضافة علامات إلى {count} طلب",
        removeTitle: "إزالة علامات من {count} طلب",
        inputLabel: "العلامات",
        add: "إضافة",
        remove: "إزالة",
        cancel: "إلغاء",
      },
```

- `bulk.reasons`:

```ts
        already_tagged: "عليه هذه العلامات بالفعل",
        not_tagged: "ليس عليه أي من هذه العلامات",
        too_many_tags: "سيتجاوز ٢٥٠ علامة",
```

Run: `pnpm --filter admin-web exec vitest run src/lib/i18n.test.ts`
Expected: PASS.

- [ ] **Step 2: Write the failing API, URL, export and action tests**

Append to `apps/admin-web/src/lib/api/orders.test.ts`:

```ts
describe("tags on the list, the export and in bulk (order operations Part 2)", () => {
  it("sends each tag as its own tag param on the list and the export", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          jsonResponse(200, { items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await fetchOrdersPage({ tags: ["vip", "urgent"] });
    await fetchOrderExportRows({ tags: ["vip"] });
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.getAll("tag")).toEqual([
      "vip",
      "urgent",
    ]);
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.getAll("tag")).toEqual([
      "vip",
    ]);
  });

  it("bulk-tags with the tags in the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { results: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await bulkOrders("add_tags", ["o-1"], "key-1", ["VIP"]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      action: "add_tags",
      orderIds: ["o-1"],
      tags: ["VIP"],
    });
  });
});
```

In `apps/admin-web/src/lib/orders/order-views.test.ts` append:

```ts
describe("the tag filter in links and the export context (Part 2)", () => {
  it("tab links keep the tag filter as one comma list", () => {
    expect(ordersViewHref("open", { tags: ["vip", "urgent"] })).toBe(
      "/orders?view=open&tag=vip%2Curgent",
    );
    expect(ordersViewHref("all", { tags: [] })).toBe("/orders");
  });

  it("the export context carries the tags and counts them as a filter", () => {
    expect(ordersExportContextFor("operator", "all", { tags: ["vip"] })).toEqual({
      view: "all",
      tags: ["vip"],
      hasFilters: true,
    });
  });
});
```

In `apps/admin-web/src/lib/orders/orders-export.test.ts` append inside its first describe:

```ts
it("current page and matching carry the tag filter (Part 2)", () => {
  const params = new URLSearchParams({ scope: "matching", view: "open", tag: "vip,urgent" });
  expect(parseExportRequest(params, "Africa/Cairo")?.query).toEqual({
    view: "open",
    search: undefined,
    status: undefined,
    tags: ["vip", "urgent"],
  });
  const page = parseExportRequest(
    new URLSearchParams({ scope: "current_page", tag: "vip" }),
    "Africa/Cairo",
  );
  expect(page?.query.tags).toEqual(["vip"]);
});
```

In `apps/admin-web/src/app/orders/actions.test.ts`: extend the mocked `BULK_ORDER_ACTIONS` list with
`"add_tags", "remove_tags"`, and append:

```ts
describe("runBulkOrderAction with tags (order operations Part 2)", () => {
  it("passes the tags for add_tags / remove_tags and nothing extra for the others", async () => {
    orders.bulkOrders.mockResolvedValue({ outcome: "ok", data: { results: [] } });
    await runBulkOrderAction("add_tags", ["o-1"], ["VIP", " "]);
    expect(orders.bulkOrders).toHaveBeenLastCalledWith("add_tags", ["o-1"], expect.any(String), [
      "VIP",
    ]);
    await runBulkOrderAction("archive", ["o-1"]);
    expect(orders.bulkOrders).toHaveBeenLastCalledWith("archive", ["o-1"], expect.any(String));
  });

  it("refuses add_tags without tags, or with more than 20", async () => {
    orders.bulkOrders.mockClear();
    expect((await runBulkOrderAction("add_tags", ["o-1"])).status).toBe("error");
    const many = Array.from({ length: 21 }, (_, i) => `t${i}`);
    expect((await runBulkOrderAction("remove_tags", ["o-1"], many)).status).toBe("error");
    expect(orders.bulkOrders).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/lib/api/orders.test.ts src/lib/orders/order-views.test.ts src/lib/orders/orders-export.test.ts src/app/orders/actions.test.ts`
Expected: FAIL — no `tag` params, no `tags` in bodies/contexts, the action rejects the new actions.

- [ ] **Step 3: Implement them**

`apps/admin-web/src/lib/api/orders.ts`:

1. `OrdersListQuery` — add
   `/** Order operations Part 2: only orders carrying every one of these tags. */ readonly tags?: readonly string[];`
   and in `fetchOrdersPage`, after the `view` line:

```ts
for (const tag of Array.isArray(query.tags) ? query.tags : []) params.append("tag", tag);
```

2. `OrderExportQuery` — add `readonly tags?: readonly string[] | undefined;` and in
   `fetchOrderExportRows`, after the `ids` line, the same `for … params.append("tag", tag)` line.
3. `BULK_ORDER_ACTIONS` — append `"add_tags", "remove_tags"`.
4. `bulkOrders` — replace with:

```ts
/** `POST /orders/bulk` (`idempotent: true`; the action's own permission is checked by the API). */
export function bulkOrders(
  action: BulkOrderAction,
  orderIds: readonly string[],
  idempotencyKey: string,
  tags?: readonly string[],
): Promise<MutationResult<{ readonly results: readonly BulkOrderResultDto[] }>> {
  return mutateAdminApi(
    "/api/v1/orders/bulk",
    {
      method: "POST",
      body: { action, orderIds, ...(tags === undefined ? {} : { tags }) },
      idempotencyKey,
    },
    isBulkResults,
  );
}
```

`apps/admin-web/src/lib/orders/order-views.ts`:

```ts
/** A tab's link: the search, status and tag filters stay, the cursor does not (page 1 of the new tab). */
export function ordersViewHref(
  view: OrderView,
  keep: {
    readonly q?: string | undefined;
    readonly status?: string | undefined;
    readonly tags?: readonly string[] | undefined;
  },
): string {
  const params = new URLSearchParams();
  if (view !== "all") params.set("view", view);
  if (keep.q !== undefined && keep.q.length > 0) params.set("q", keep.q);
  if (keep.status !== undefined && keep.status.length > 0) params.set("status", keep.status);
  if (keep.tags !== undefined && keep.tags.length > 0) params.set("tag", keep.tags.join(","));
  const query = params.toString();
  return query.length > 0 ? `/orders?${query}` : "/orders";
}
```

and in `ordersExportContextFor` add `readonly tags?: readonly string[] | undefined;` to `params`, add
`...(params.tags === undefined || params.tags.length === 0 ? {} : { tags: params.tags }),` to the
returned object (after `after`), and change `hasFilters` to
`Boolean(params.q) || Boolean(params.status) || (params.tags?.length ?? 0) > 0 || view !== "all"`.

`apps/admin-web/src/lib/orders/orders-export.ts` — import `parseTagFilter` from `./order-tags`; in
`parseExportRequest` after `const view = …` add
`const tags = parseTagFilter(text("tag"));` and `const tagged = tags.length > 0 ? { tags } : {};`,
then spread `...tagged` into the `current_page` query (after `after`) and the `matching` query:

```ts
    case "matching":
      return {
        singlePage: false,
        query: { view, search: text("q"), status: text("status"), ...tagged },
      };
```

`apps/admin-web/src/app/orders/actions.ts` — replace `runBulkOrderAction` (keep its doc comment, adding
"add_tags/remove_tags also need 1..20 tags"):

```ts
const MAX_BULK_TAGS = 20;

export async function runBulkOrderAction(
  action: string,
  orderIds: readonly string[],
  tags?: readonly string[],
): Promise<BulkActionState> {
  const t = await formErrorDictionary();
  const ids = [
    ...new Set(orderIds.filter((id): id is string => typeof id === "string" && id.length > 0)),
  ];
  const needsTags = action === "add_tags" || action === "remove_tags";
  const cleanTags = Array.isArray(tags)
    ? tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : [];
  if (
    !isBulkOrderAction(action) ||
    ids.length === 0 ||
    ids.length > MAX_BULK_ORDERS ||
    (needsTags && (cleanTags.length === 0 || cleanTags.length > MAX_BULK_TAGS))
  ) {
    return { status: "error", message: t.invalid };
  }
  const key = newIdempotencyKey();
  const result = needsTags
    ? await bulkOrders(action, ids, key, cleanTags)
    : await bulkOrders(action, ids, key);
  if (result.outcome !== "ok") {
    const state = toFormState(result, t);
    return { status: "error", message: state.status === "error" ? state.message : t.unexpected };
  }
  revalidatePath("/orders");
  return { status: "done", results: result.data.results };
}
```

Run the four test files again. Expected: PASS.

- [ ] **Step 4: Write the failing component tests**

`apps/admin-web/src/components/orders/orders-bulk-tags-dialog.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { OrdersBulkTagsDialog } from "./orders-bulk-tags-dialog";

vi.mock("@/app/orders/annotation-actions", () => ({
  suggestOrderTagsAction: vi.fn().mockResolvedValue([]),
}));

describe("OrdersBulkTagsDialog", () => {
  it("collects up to 20 tags and submits them", () => {
    const onSubmit = vi.fn();
    render(
      <OrdersBulkTagsDialog
        open
        title="Add tags to 2 orders"
        submitLabel="Add"
        pending={false}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        t={en}
      />,
    );
    const submit = screen.getByRole("button", { name: "Add" });
    expect(submit).toBeDisabled();
    const input = screen.getByLabelText("Tags");
    fireEvent.change(input, {
      target: { value: Array.from({ length: 25 }, (_, i) => `t${i}`).join(",") + "," },
    });
    expect(screen.getAllByRole("button", { name: /^Remove t/ })).toHaveLength(20);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith(Array.from({ length: 20 }, (_, i) => `t${i}`));
  });
});
```

In `apps/admin-web/src/components/orders/orders-table.test.tsx`:

1. Add after the existing `vi.mock`:

```tsx
vi.mock("@/app/orders/annotation-actions", () => ({
  suggestOrderTagsAction: vi.fn().mockResolvedValue([]),
}));
```

2. In "has the columns in Shopify's order…", append `"Tags"` to the expected header list.
3. Append inside `describe("OrdersTable selection and bulk bar (order operations Part 1)", …)`:

```tsx
it("shows the first three tags and how many more (Part 2)", () => {
  renderTable([order({ tags: ["a", "b", "c", "d", "e"] })]);
  const row = rowOf(/1001/);
  for (const tag of ["a", "b", "c"]) expect(within(row).getByText(tag)).toBeInTheDocument();
  expect(within(row).queryByText("d")).toBeNull();
  expect(within(row).getByText("+2 more")).toBeInTheDocument();
});

it("adds tags to the selection through the dialog and reports the skipped ones (Part 2)", async () => {
  actions.runBulkOrderAction.mockResolvedValue({
    status: "done",
    results: [
      { orderId: "order-1", outcome: "ok" },
      { orderId: "order-2", outcome: "skipped", reason: "already_tagged" },
    ],
  });
  renderTable(two());
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all orders on this page" }));
  fireEvent.click(screen.getByRole("button", { name: "Add tags" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Add tags to 2 orders");
  const input = screen.getByLabelText("Tags");
  fireEvent.change(input, { target: { value: "VIP" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() =>
    expect(actions.runBulkOrderAction).toHaveBeenCalledWith(
      "add_tags",
      ["order-1", "order-2"],
      ["VIP"],
    ),
  );
  expect(await screen.findByText("#1002 — Already has these tags")).toBeInTheDocument();
});

it("offers no tag actions without orders:tag", () => {
  render(
    <OrdersTable
      orders={two()}
      t={en}
      locale="en"
      now={NOW}
      permissions={{ ...OPERATOR, canTag: false }}
    />,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all orders on this page" }));
  expect(screen.queryByRole("button", { name: "Add tags" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove tags" })).toBeNull();
});
```

In `apps/admin-web/src/components/orders/orders-toolbar.test.tsx`: add after the `next/navigation`
mock

```tsx
vi.mock("@/app/orders/annotation-actions", () => ({
  suggestOrderTagsAction: vi.fn().mockResolvedValue([]),
}));
```

and append inside the describe:

```tsx
it("Tagged with adds a tag to the URL as one comma list, and removing it drops the param (Part 2)", () => {
  navigation.search = "view=unpaid&tag=vip";
  render(<OrdersToolbar t={en} />);
  const input = screen.getByLabelText("Tagged with");
  fireEvent.change(input, { target: { value: "urgent" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(navigation.push).toHaveBeenLastCalledWith("/orders?view=unpaid&tag=vip%2Curgent");
  fireEvent.click(screen.getByRole("button", { name: "Remove vip" }));
  expect(navigation.push).toHaveBeenLastCalledWith("/orders?view=unpaid");
});
```

In `apps/admin-web/src/components/orders/orders-export-dialog.test.tsx` append inside the describe:

```tsx
it("carries the tag filter as one hidden comma list (Part 2)", () => {
  const { container } = renderDialog({
    context: { ...context, tags: ["vip", "urgent"] },
  });
  expect(container.ownerDocument.querySelector('input[name="tag"]')).toHaveValue("vip,urgent");
});
```

Run: `pnpm --filter admin-web exec vitest run src/components/orders/orders-bulk-tags-dialog.test.tsx src/components/orders/orders-table.test.tsx src/components/orders/orders-toolbar.test.tsx src/components/orders/orders-export-dialog.test.tsx`
Expected: FAIL — dialog module missing; no Tags column, no tag actions, no "Tagged with", no hidden `tag`.

- [ ] **Step 5: Implement the bulk tags dialog, the column, the filter and the export field**

`apps/admin-web/src/components/orders/orders-bulk-tags-dialog.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@platform/ui";
import { suggestOrderTagsAction } from "@/app/orders/annotation-actions";
import type { Dictionary } from "@/messages/en";
import { TagInput } from "./tag-input";

/** The API takes at most 20 tags per bulk call (spec §2.3). */
const MAX_BULK_TAGS = 20;

/**
 * Shopify's "Add tags" / "Remove tags" dialog for the selected orders: the same tag input as the
 * order page (comma/Enter, suggestions), at most 20 tags, submitted to the bulk action.
 */
export function OrdersBulkTagsDialog({
  open,
  title,
  submitLabel,
  pending,
  onOpenChange,
  onSubmit,
  t,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly submitLabel: string;
  readonly pending: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (tags: readonly string[]) => void;
  readonly t: Dictionary;
}) {
  const d = t.ordersPage.bulk.tagsDialog;
  const [tags, setTags] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!open) setTags([]);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <TagInput
          label={d.inputLabel}
          tags={tags}
          disabled={pending}
          onAdd={(added) => setTags((current) => [...current, ...added].slice(0, MAX_BULK_TAGS))}
          onRemove={(tag) => setTags((current) => current.filter((existing) => existing !== tag))}
          suggest={suggestOrderTagsAction}
          t={t}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {d.cancel}
          </Button>
          <Button
            type="button"
            loading={pending}
            disabled={pending || tags.length === 0}
            onClick={() => onSubmit(tags)}
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`apps/admin-web/src/components/orders/orders-bulk-bar.tsx`:

1. Imports: `useState` from react; `OrdersBulkTagsDialog` from `./orders-bulk-tags-dialog`.
2. Inside `OrdersBulkBar`, after `const run = …`, add:

```tsx
const [tagMode, setTagMode] = useState<"add" | "remove" | null>(null);
const runTags = (mode: "add" | "remove", tags: readonly string[]) =>
  startTransition(async () => {
    let state: BulkActionState;
    try {
      state = await runBulkOrderAction(mode === "add" ? "add_tags" : "remove_tags", orderIds, tags);
    } catch {
      state = { status: "error", message: t.formErrors.unexpected };
    }
    setTagMode(null);
    onFinished({ state, orderNumbers });
  });
```

3. `hasMenu` becomes
   `permissions.canArchive || permissions.canTag || permissions.canMarkCashReceived || onExportSelected !== undefined;`
4. In the ⋯ menu, after the archive pair, add:

```tsx
{
  permissions.canTag && (
    <>
      <MenuButton disabled={isPending} onClick={() => setTagMode("add")}>
        {b.addTags}
      </MenuButton>
      <MenuButton disabled={isPending} onClick={() => setTagMode("remove")}>
        {b.removeTags}
      </MenuButton>
    </>
  );
}
```

5. Before the `{isPending && …}` line, add:

```tsx
{
  tagMode !== null && (
    <OrdersBulkTagsDialog
      open
      title={(tagMode === "add" ? b.tagsDialog.addTitle : b.tagsDialog.removeTitle).replace(
        "{count}",
        formatNumber(locale, selected.length),
      )}
      submitLabel={tagMode === "add" ? b.tagsDialog.add : b.tagsDialog.remove}
      pending={isPending}
      onOpenChange={(open) => {
        if (!open) setTagMode(null);
      }}
      onSubmit={(tags) => runTags(tagMode, tags)}
      t={t}
    />
  );
}
```

`apps/admin-web/src/components/orders/orders-table.tsx`:

1. Import `Badge` is already imported; add `import { formatNumber, … }` (already) — no new imports beyond those.
2. Add above `OrdersTable`:

```tsx
/** The list's Tags column (spec §2.4): the first three tags as chips, then "+N more". */
function OrderTagsCell({
  tags,
  t,
  locale,
}: {
  readonly tags: readonly string[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  if (tags.length === 0) return null;
  const rest = tags.length - 3;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {tags.slice(0, 3).map((tag) => (
        <Badge key={tag} variant="neutral">
          {tag}
        </Badge>
      ))}
      {rest > 0 && (
        <span className="text-muted-foreground text-xs">
          {t.ordersPage.moreTags.replace("{count}", formatNumber(locale, rest))}
        </span>
      )}
    </span>
  );
}
```

3. Bulk-bar header cell: `colSpan={8}` → `colSpan={9}`.
4. Header row: append `<TableHead className={FROM_MD}>{t.ordersPage.columns.tags}</TableHead>`
   after the delivery-method head.
5. Body row: append after the delivery-method cell:

```tsx
<TableCell className={FROM_MD}>
  <OrderTagsCell tags={order.tags ?? []} t={t} locale={locale} />
</TableCell>
```

`apps/admin-web/src/components/orders/orders-toolbar.tsx`:

1. Imports: `parseTagFilter` from `@/lib/orders/order-tags`; `suggestOrderTagsAction` from
   `@/app/orders/annotation-actions`; `TagInput` from `./tag-input`.
2. After `const currentStatus = …` add:

```tsx
const currentTags = parseTagFilter(searchParams.get("tag") ?? undefined);
const setTags = (tags: readonly string[]) => pushParams({ tag: tags.join(",") });
```

3. The Filter indicator dot shows when `currentStatus.length > 0 || currentTags.length > 0`.
4. Inside the Filter popover, after the status `<select>`, add:

```tsx
<TagInput
  label={t.ordersPage.taggedWith}
  tags={currentTags}
  onAdd={(added) => setTags([...currentTags, ...added])}
  onRemove={(tag) => setTags(currentTags.filter((existing) => existing !== tag))}
  suggest={suggestOrderTagsAction}
  t={t}
/>
```

5. Update the component's doc comment: "(`?q=&status=&tag=`)" and "changing any control drops
   `after`/`stack`…".

`apps/admin-web/src/components/orders/orders-view-tabs.tsx` — add a
`readonly tags: readonly string[];` prop and pass `ordersViewHref(view, { q, status, tags })`.

`apps/admin-web/src/components/orders/orders-export-dialog.tsx` — `OrdersExportContext` gains
`readonly tags?: readonly string[];`, and after the `status` hidden input add:

```tsx
{
  context.tags !== undefined && context.tags.length > 0 && (
    <input type="hidden" name="tag" value={context.tags.join(",")} />
  );
}
```

Run the four component test files again. Expected: PASS.

- [ ] **Step 6: Read the tag filter on the list page**

`apps/admin-web/src/app/orders/page.tsx`:

1. Import `parseTagFilter` from `@/lib/orders/order-tags`.
2. `searchParams` type: add `/** Order operations Part 2: "Tagged with", one comma list. */ readonly tag?: string | string[];`.
3. After `const view = parseOrderView(params);` add `const tags = parseTagFilter(params.tag);`.
4. `ordersExportContextFor(role, view, { ...params, tags })` (instead of `params`), and
   `<OrdersViewTabs current={view} q={params.q} status={params.status} tags={tags} t={t} />`.
5. The `<Suspense key=…>` becomes
   ``key={`${view}:${params.q ?? ""}:${params.status ?? ""}:${tags.join(",")}:${params.after ?? ""}`}``
   and `OrdersResults` gets a `tags={tags}` prop (`readonly tags: readonly string[];`) that it passes to
   `fetchOrdersPage({ first, after, status, search, view, tags })`; its `hasFilters` becomes
   `Boolean(search) || Boolean(status) || tags.length > 0 || view !== "all"`.

- [ ] **Step 7: Run the app's suite, typecheck, lint, commit**

Run: `pnpm --filter admin-web test && pnpm --filter admin-web typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint`
Expected: all PASS.

```bash
git add apps/admin-web/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin-web): tags column, tagged-with filter and bulk tags on the orders list

The list shows the first three tags, filters by tags kept in the URL and the export, and the bulk
menu's Add tags / Remove tags dialog sends up to 20 tags with a per-order result.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Final verification (after Task 8)

- [ ] Run every touched package: `pnpm --filter @platform/db test`, `pnpm --filter @platform/auth test`,
      `pnpm --filter @platform/orders test`, `pnpm --filter @platform/admin test`,
      `pnpm --filter admin-web test`, plus `typecheck` and `lint` for each (admin-web lint with
      `NODE_OPTIONS=--max-old-space-size=8192`), and `prisma validate` with the dummy URLs. All PASS.
- [ ] Deploy note for the owner (not run by the agent): apply, from Railway's Console and in this order,
      `20261018000000_order_archive/migration.sql` (Part 1, still undeployed) and
      `20261018010000_order_notes_tags_timeline/migration.sql`, before the release that reads them.

## Spec coverage (self-review)

| Spec item                                                                                                                                                                                                                                                                                                                                   | Task       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| §2.1 `note` column, `order_tags` (key, tenant index), `order_timeline_entries` (kinds CHECK, order/time index), RLS on both, no FK on the timeline, Prisma models                                                                                                                                                                           | 1          |
| §2.1 limits (note 5,000; tag 40, 250 per order, comma splits; comment 5,000), case-insensitive tags with first spelling                                                                                                                                                                                                                     | 1, 2, 3, 6 |
| §2.2 widened `OrderAnnotations`; `setNote`, `addTags`, `removeTags`, `tagsInUse`; `OrderTimelineRepository` (`append`, `listForOrder` ≤ 200, `findById`, `update`)                                                                                                                                                                          | 2          |
| §2.2 `UpdateOrderNote`, `AddOrderTags`, `RemoveOrderTags` (bulk-capable), `AddOrderComment`, `EditOrderComment`, `DeleteOrderComment` (soft); activity in the same tx; archive/unarchive lines                                                                                                                                              | 3          |
| §2.2 `StaffDirectoryPort` + Security adapter (`principals.display_name` by `external_id`), unknown → "Staff", snapshot, never from the client                                                                                                                                                                                               | 3, 4       |
| §2.2 edit/delete rule (author edits/deletes own; admin deletes any; activity never editable)                                                                                                                                                                                                                                                | 3, 4       |
| §2.3 note/tags/order-tags/comments routes with permissions; bulk `add_tags`/`remove_tags` (1..20); `GET /orders` `tag` (repeatable, AND) + item `tags`; detail `note`/`tags`/`archivedAt`/`timelineEntries` (200); `TimelineEntryDto` with server-side `canEdit`; repository tag filter as per-tag subquery                                 | 2, 4, 5    |
| §2.3 export rows and packing slips fill `tags` and `note`                                                                                                                                                                                                                                                                                   | 5          |
| §2.4 Notes card first (dialog, "No notes"), Tags card (chips, ×, suggestions, Enter/comma, immediate save); timeline composer, merged/grouped list, Edit/Delete, activity wording; list Tags column, "Tagged with", bulk Add/Remove tags                                                                                                    | 6, 7, 8    |
| §2.5 tests: normalisation/limits, dedupe, note length, same-tx activity, author snapshot, edit/delete rules, `save()` leaves note/tags; Prisma integration + tenant isolation for both tables; routes, permissions, tag AND, bulk tags; admin-web notes dialog, tag input (comma, suggestions, RTL), merged timeline order, composer states | 1–8        |
| Part 1 hand-offs: export `tags`/`note`, list Tags column, bulk Add/Remove tags, packing slip note, archive/unarchive timeline rows                                                                                                                                                                                                          | 3, 5, 8    |
| Permissions (`orders:edit_note`, `orders:tag`, `orders:comment` → operator + admin; viewers read)                                                                                                                                                                                                                                           | 1, 4, 5, 6 |
| Security: tenant scoping (per-call `tenantId`, `runReadScoped`/tx, RLS, isolation tests), annotations never touch `version`                                                                                                                                                                                                                 | 1, 2, 3, 4 |

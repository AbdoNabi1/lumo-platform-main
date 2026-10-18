# Order Operations — Part 1: Order List Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admin Orders list Shopify's tabs (All / Unfulfilled / Unpaid / Open / Archived), a reversible Archive, multi-select with a bulk-action bar (Fulfill items, Capture payments, Print packing slips, Archive, Unarchive, Export selected, Mark cash as received), a courier-ready CSV export and printable packing slips.

**Architecture:** Archive is a nullable `orders.orders.archived_at` column written through a new `OrderAnnotationRepository` port that lives outside the `Order` aggregate (no version bump, no history row). Tabs are SQL predicates in `PrismaOrderRepository` (`NOT EXISTS` over `order_events`, built from the existing event-type constants) mirrored one-for-one by `InMemoryOrderRepository` and proved equal by one shared fixture. `apps/admin` gains a view-aware `GET /orders`, archive routes, `POST /orders/bulk` (per-order, non-atomic, each order through the controller call the single-order screen uses), `GET /orders/export-rows` and `GET /orders/packing-slips`, plus a batched payment-intent read in `services/payments`. `admin-web` gets a tab strip, a client `OrdersTable` with selection and a bulk bar, an export dialog posting to a Next route handler that builds the CSV, and a print page.

**Tech Stack:** TypeScript, Prisma 5 / PostgreSQL (hand-written SQL migrations), zod routes on `@platform/http`, Vitest, Next.js 15 App Router + React 19 (admin-web), Tailwind (logical utilities), `@platform/regions`.

**Spec:** `docs/superpowers/specs/2026-10-18-order-operations-design.md` — Part 1 (§1.1–§1.6), "Global constraints", "Permissions", "Security and multi-tenancy", Decisions 1–14. Read the spec and this plan together.

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
   `.strict()` bodies, DTOs never carry `sessionRef`. *(No public route in Part 1.)*
5. **Shopify placement and wording:** the sidebar's Orders item gets children **Drafts** and
   **Abandoned checkouts**, in that order (Shopify's). Labels below are Shopify's English and the
   matching Arabic. *(No sidebar change in Part 1.)*

Anti-goals that bind Part 1 (verbatim):

- No new way to mark an order paid that bypasses Payments (payment truth stays: a captured payment
  must exist for `order.paymentRef`).
- No change to the order lifecycle transition table and no annotation write that bumps the `Order`
  aggregate's `version` (a note edit must never conflict with a payment webhook).

Permissions (verbatim rows used by Part 1):

| Permission | Who has it today via the role table | Used by |
| --- | --- | --- |
| `orders:read` | viewer, operator, admin | lists, detail, drafts list/detail, abandoned list/detail, packing slips |
| `orders:archive` | operator, admin | archive / unarchive (single and bulk) |
| `orders:export` | operator, admin | export rows |
| `payments:confirm_cod_collection` | admin | bulk "Mark cash as received"; draft "Mark as paid" (checked in addition to `orders:complete_draft`) |

Security and multi-tenancy (verbatim bullets that bind Part 1):

- **Tenant scoping.** Every new table has `tenant_id` + forced RLS `tenant_isolation`; every new
  repository method takes `tenantId` per call and reads through `runReadScoped` or the caller's `tx`;
  link lookup by token hash runs inside the request tenant's scope, so cross-shop tokens are unknown.
- **Money.** Marking paid always produces a captured Payments record (`manual` provider, confirmed
  collection) and is admin-only; capture and COD settlement in bulk reuse the existing guarded calls.
- **PII.** Export is operator/admin-only, capped, and formula-guarded; abandoned checkouts are behind
  `orders:read` like orders themselves.
- **Concurrency.** Annotations never touch the `Order` version; drafts use optimistic locking;
  completion is idempotent by `draft:<id>:<version>`; a merchant completion expires any open invoice
  session first, so a customer and the merchant cannot both create the order.

Repository rules (from the owner): commit with
`git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit`, Conventional Commits in
lower case, body lines ≤ 100 chars, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`,
never `--no-verify`. Never run a migration against a real database.

## Where the spec and the code disagree (resolved here)

1. **Search parameter name.** The spec's export-rows query says `q`; the API's existing list filter is
   `search` (`listOrdersQuery`), and only admin-web's URL uses `q`. The API keeps `search` everywhere
   (GET /orders and GET /orders/export-rows); admin-web maps `?q=` to `search` as it does today.
2. **Page size 250.** `normalizePageSize` (`packages/repository`) caps every repository page at 100, so
   `first=250` on export-rows could never be honoured. Orders' repositories switch to
   `orderPageSize(first)` with `ORDER_LIST_MAX_PAGE_SIZE = 250`; each route keeps its own zod cap
   (GET /orders stays at 100, export-rows 250, packing slips 50).
3. **`archivedAt` on the order page.** §2.3 lists `archivedAt` as a Part 2 addition to the order detail,
   but §1.5 needs it in Part 1 (header badge, Archive/Unarchive). Part 1 adds it to `OrderDetailDto`.
4. **Home's "Orders to fulfill" card.** Its count comes from `SalesSummaryQuery.openOrderIds`, which
   knows nothing about archive; archiving would make the card and the Unfulfilled tab disagree (the
   spec requires one definition). Both sales-summary implementations exclude archived orders.
5. **"Capture payments".** `RequestPaymentCapture` only opens and captures a payment when the order has
   no linked payment; checkout orders (COD and card) link theirs at checkout, where the call is a silent
   no-op. Bulk capture therefore skips any pending order that already has a linked payment
   (`payment_already_requested`) — this also covers "provider settles at pay time (COD/manual)".
6. **"Created" date.** `orders.created_at` is a DB default (insert time); the list's `createdAt` is the
   first history event. The date filter uses the entry event (`placed`/`created`) so the export and the
   list agree.
7. **Formula guard.** The spec's rule ("`+`/`-` followed by a non-digit") lets `+20=cmd|' /C calc'!A0`
   through. The plan keeps a `+`/`-` cell unguarded only when the whole cell is phone/number-shaped
   (`^[+-][\d\s().-]*$`), and also guards a leading tab or carriage return; `+2010…` phones stay as typed.
8. **"N orders matching your search".** No count endpoint exists; the dialog says "Orders matching your
   search" without N. The CSV is built in memory (≤ 5,000 rows) and returned as one attachment rather
   than streamed.

## Review Focus

The five failure modes the spec implies but its test list does not exercise, most likely first. Each
line names the task whose tests pin it.

1. **A merchant types a phone the Egyptian way** (`010 1234 5678` or `01012345678`) for an order stored
   as `+201012345678` → the order is found. Pinned in **Task 1** (`phoneSearchNeedles` tests and the
   shared list case "search matches the phone typed with the national leading 0").
2. **Archiving an open, unfulfilled order** → it disappears from Home's "Orders to fulfill" count *and*
   from the Unfulfilled tab, which still agree. Pinned in **Task 2** (sales-summary tests) and **Task 3**
   (`order-views.e2e.test.ts` "archiving removes an order from the card and the tab together").
3. **The Payments read fails while exporting or printing slips** → the export/slips request fails
   instead of writing `COD amount 0` (a courier would not collect the cash). Pinned in **Task 6**
   ("export-rows answers the payments failure instead of rows").
4. **A phone-shaped cell that continues into a formula** (`+20=cmd|' /C calc'!A0`, a leading tab) → the
   cell is guarded; `+201012345678` and `-5` stay intact. Pinned in **Task 8** (`guardCell` tests).
5. **Selection survives a page change** (select on page 1, click Next) → the selection clears, so
   "Print packing slips" never prints orders the merchant cannot see. Pinned in **Task 7**
   (`orders-table.test.tsx` "clears the selection when the page changes").

## File Structure

**packages/db**
- `prisma/schema/migrations/20261018000000_order_archive/migration.sql` — new column + index.
- `prisma/schema/orders.prisma` — `Order.archivedAt`.
- `src/schema-migration-consistency.test.ts` — asserts the column is migrated.

**packages/auth**
- `src/role-table-access-control.test.ts` — pins operator/viewer/admin for the new permissions (no
  code change: `orders:*` already covers them).

**services/orders**
- `src/domain/order-statuses.ts` — event-type sets behind the SQL predicates.
- `src/domain/order-repository.ts` — `OrderListQuery` additions, `ORDER_LIST_MAX_PAGE_SIZE`.
- `src/domain/order-search.ts` — `phoneSearchNeedles`, `matchesOrderSearch` (in-memory mirror).
- `src/domain/order-annotations.ts` — `OrderAnnotations`, `OrderAnnotationRepository` port.
- `src/application/order-annotations.use-cases.ts` — `ArchiveOrders`, `UnarchiveOrders`, `GetOrderAnnotations`.
- `src/infrastructure/order-list-where.ts` — Prisma `where` builder, `orderPageSize`, `uuidsOf`.
- `src/infrastructure/order-list-fixture.ts` — shared fixture + cases run against both repositories.
- `src/infrastructure/prisma-order-repository.ts`, `in-memory-order-repository.ts` — the predicates.
- `src/infrastructure/prisma-order-annotation-repository.ts`, `in-memory-order-annotation-repository.ts`.
- `src/infrastructure/prisma-sales-summary-query.ts`, `in-memory-sales-summary-query.ts` — exclude archived.
- `src/interfaces/order.controller.ts`, `src/composition.ts`, `src/index.ts` — wiring/exports.

**services/payments**
- `src/domain/payment-intent-repository.ts` — `PaymentIntentBatchReader`.
- `src/application/get-payment-intents-by-ids.use-case.ts` — `GetPaymentIntentsByIds`, `PaymentIntentSummary`.
- `src/infrastructure/prisma-payment-intent-repository.ts`, `in-memory-payment-intent-repository.ts` — `findByIds`.
- `src/interfaces/payment.controller.ts`, `src/composition.ts`, `src/index.ts`.

**apps/admin**
- `src/http/order-views.ts` — `ORDER_VIEWS`, `ORDER_STATUS_VALUES`, `viewFilters`, `listOrdersForView`, `orderAnnotationsFor`.
- `src/http/order-payment-intents.ts` — `paymentIntentsOfOrders` (one batched read).
- `src/http/order-bulk-actions.ts` — the per-action runners.
- `src/http/order-export-rows.ts` — `OrderExportRowDto`, `PackingSlipDto` and their mappers.
- `src/http/order-operations-routes.ts` — archive/unarchive, bulk, export-rows, packing-slips routes.
- `src/http/admin-routes.ts` — view-aware `GET /orders`, `archivedAt` on list/detail DTOs.
- `src/http/unfulfilled-orders.ts` — passes every list filter (incl. `archived`) through.
- `src/http/order-customer-names.ts` — `customerContactsFor`, `customerLabelsOf`.
- `src/http/testing/orders-harness.ts` — in-memory admin + route caller for the e2e tests.
- `src/interfaces/bulk-order-actions.ts` — `BULK_ORDER_ACTIONS`, `BULK_ACTION_PERMISSIONS`.
- `src/interfaces/orders.admin-controller.ts` — `archiveOrders`, `unarchiveOrders`, `orderAnnotations`,
  `paymentIntentsOf`, `authorizeBulkAction`.

**apps/admin-web**
- `src/lib/api/orders.ts` — view, `archivedAt`, bulk, archive, export rows, packing slips.
- `src/lib/orders/order-views.ts` — `ORDER_VIEWS`, `parseOrderView`, `ordersViewHref`, `parseOrderIds`, `ORDERS_PAGE_SIZE`.
- `src/lib/orders/zoned-time.ts` — shop-time-zone day/time helpers.
- `src/lib/orders/orders-csv.ts` — CSV builder (BOM, RFC 4180, guard, amounts, provinces).
- `src/lib/orders/orders-export.ts` — export request parsing and paging.
- `src/app/orders/page.tsx`, `src/app/orders/actions.ts` — tabs, bulk/archive server actions.
- `src/app/orders/export/route.ts` — CSV route handler.
- `src/app/orders/packing-slips/page.tsx` — print page (outside `AppShell`).
- `src/components/orders/orders-view-tabs.tsx`, `orders-table.tsx`, `orders-bulk-bar.tsx`,
  `orders-toolbar.tsx`, `orders-export-dialog.tsx`, `packing-slip.tsx`, `auto-print.tsx`,
  `order-header.tsx`, `order-header-actions.tsx`.
- `src/components/dashboard/home-kpis.tsx` — card link → `/orders?view=unfulfilled`.
- `src/messages/en.ts`, `src/messages/ar.ts`.
- Deleted: `src/components/orders/unfulfilled-filter-note.tsx` (+ test) — the Unfulfilled tab replaces it.

## Commands

- Tests: `pnpm --filter <pkg> test`; one file: `pnpm --filter <pkg> exec vitest run <file>`.
- `pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> lint`.
- Packages: `@platform/orders`, `@platform/payments`, `@platform/auth`, `@platform/admin`, `admin-web`, `@platform/db`.
- Prisma (dummy URLs, never a real DB):
  `DATABASE_URL=postgresql://u:p@localhost:5432/x DIRECT_URL=postgresql://u:p@localhost:5432/x pnpm --filter @platform/db exec prisma validate`
  and the same with `prisma generate` after a schema change.

Commit template used by every task (replace subject/body):

```bash
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
<type>(<scope>): <lower-case subject>

<body, lines <= 100 chars>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 1: List predicates in both order repositories, and the archive column

Model tier: **most-capable** (two stores must implement identical query semantics).

**Files:**
- Create: `packages/db/prisma/schema/migrations/20261018000000_order_archive/migration.sql`
- Modify: `packages/db/prisma/schema/orders.prisma` (model `Order`)
- Modify: `packages/db/src/schema-migration-consistency.test.ts`
- Modify: `services/orders/src/domain/order-statuses.ts`, `services/orders/src/domain/order-statuses.test.ts`
- Modify: `services/orders/src/domain/order-repository.ts`
- Create: `services/orders/src/domain/order-search.ts`, `services/orders/src/domain/order-search.test.ts`
- Create: `services/orders/src/infrastructure/order-list-where.ts`, `services/orders/src/infrastructure/order-list-where.test.ts`
- Create: `services/orders/src/infrastructure/order-list-fixture.ts`
- Create: `services/orders/src/infrastructure/in-memory-order-repository.views.test.ts`
- Create: `services/orders/src/infrastructure/prisma-order-repository.archived-at.test.ts`
- Modify: `services/orders/src/infrastructure/in-memory-order-repository.ts`
- Modify: `services/orders/src/infrastructure/prisma-order-repository.ts`
- Modify: `services/orders/src/infrastructure/prisma-order-repository.integration.test.ts`

**Interfaces:**
- Consumes: existing `OrderListQuery`, `derivePaymentStatus`, `isOpenOrder`, `CANCELLED_EVENT_TYPE`,
  `CLOSED_EVENT_TYPE`, `REFUNDED_EVENT_TYPES`, `OrderMapper`, `buildPaginatedPage`, `decodeCursor`.
- Produces:
  - `OrderListQuery` gains `archived?: boolean; open?: boolean; paymentStatus?: "pending"; ids?: readonly string[]; createdFrom?: Date; createdTo?: Date` (`createdFrom` inclusive, `createdTo` exclusive, both on the entry event's time). `ORDER_LIST_MAX_PAGE_SIZE = 250`.
  - `order-statuses.ts`: `PAID_EVENT_TYPES`, `NOT_OPEN_EVENT_TYPES`, `PAYMENT_DECIDED_EVENT_TYPES`, `ORDER_ENTRY_EVENT_TYPES` (all `readonly OrderEventType[]`).
  - `order-search.ts`: `phoneSearchNeedles(search: string): readonly string[]`, `matchesOrderSearch(order: SearchableOrder, search: string): boolean`.
  - `order-list-where.ts`: `orderListWhere(query: OrderListQuery, tenantId: string, after: string | undefined, recipientOrderIds: readonly string[]): Prisma.OrderWhereInput`, `recipientSearchWhere(search, tenantId): Prisma.OrderShippingAddressWhereInput`, `orderPageSize(first?: number): number`, `uuidsOf(ids: readonly string[]): string[]`, `RECIPIENT_SEARCH_CAP = 500`.
  - `InMemoryOrderRepository.hasOrder(orderId, tenantId): boolean`, `.archivedAtOf(orderId, tenantId): Date | null`, `.writeArchivedAt(orderId, tenantId, archivedAt: Date | null): boolean` (false = no such order).
  - Prisma `Order.archivedAt: DateTime?` (`archived_at`).
  - **Part 2 extends additively:** `OrderListQuery.tags?: readonly string[]` is one more field, one more `and.push(...)` in `orderListWhere`, one more check in `matchesQuery`, one more `ORDER_LIST_CASES` entry. No existing signature changes.

- [ ] **Step 1: Write the failing migration test**

Append to `packages/db/src/schema-migration-consistency.test.ts` (reuses the file's `migrationsDir` and `columnsEverAddedTo`):

```ts
describe("orders schema — order archive (order operations Part 1)", () => {
  it("a migration adds orders.orders.archived_at", () => {
    const sql = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => readFileSync(join(migrationsDir, entry.name, "migration.sql"), "utf-8"))
      .join("\n");
    expect(columnsEverAddedTo("orders", "orders", sql).has("archived_at")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @platform/db exec vitest run src/schema-migration-consistency.test.ts`
Expected: FAIL — `expected false to be true` in "a migration adds orders.orders.archived_at".

- [ ] **Step 3: Add the migration and the Prisma field**

`packages/db/prisma/schema/migrations/20261018000000_order_archive/migration.sql`:

```sql
-- Order operations Part 1 — Shopify's reversible "Archive" on an order. Written by hand, NOT applied by
-- the agent; the owner deploys it from Railway's Console BEFORE the release that reads it. Additive and
-- nullable: NULL = not archived, so existing orders need no backfill. The column sits outside the
-- Order aggregate (OrderMapper never writes it), so archiving never bumps "version".
ALTER TABLE "orders"."orders" ADD COLUMN "archived_at" TIMESTAMP(3);
CREATE INDEX "orders_tenant_id_archived_at_idx" ON "orders"."orders"("tenant_id", "archived_at");
```

In `packages/db/prisma/schema/orders.prisma`, model `Order`, after `updatedAt`:

```prisma
  /// Order operations Part 1: Shopify's Archive. Outside the aggregate — never written by OrderMapper.
  archivedAt     DateTime? @map("archived_at")
```

and next to the existing `@@index([tenantId, customerRef, createdAt])`:

```prisma
  @@index([tenantId, archivedAt])
```

Run (dummy URLs, no database touched):
`DATABASE_URL=postgresql://u:p@localhost:5432/x DIRECT_URL=postgresql://u:p@localhost:5432/x pnpm --filter @platform/db exec prisma validate`
then the same with `prisma generate`.
Expected: "The schema … is valid", then "Generated Prisma Client".

- [ ] **Step 4: Run the migration test to verify it passes**

Run: `pnpm --filter @platform/db exec vitest run src/schema-migration-consistency.test.ts` — Expected: PASS.

- [ ] **Step 5: Write the failing event-type-set tests**

Append to `services/orders/src/domain/order-statuses.test.ts` (add the imports to the file's import list):

```ts
import type { OrderEventType } from "./order-event";
import {
  NOT_OPEN_EVENT_TYPES,
  ORDER_ENTRY_EVENT_TYPES,
  PAYMENT_DECIDED_EVENT_TYPES,
} from "./order-statuses";

const EVERY_EVENT_TYPE: readonly OrderEventType[] = [
  "placed", "paid", "refunded", "created", "confirmed", "cancelled", "held", "resumed",
  "awaiting_payment", "payment_requested", "payment_received", "payment_failed",
  "ready_for_fulfillment", "fulfillment_requested", "fulfilled", "partially_fulfilled",
  "delivered", "return_requested", "returned", "refund_requested", "closed",
];

describe("the event-type sets behind the list's SQL predicates (order operations Part 1)", () => {
  it("payment is pending exactly when the history holds none of PAYMENT_DECIDED_EVENT_TYPES", () => {
    for (const type of EVERY_EVENT_TYPE) {
      const history: { type: OrderEventType }[] = [{ type: "created" }, { type }];
      expect(derivePaymentStatus(history) === "pending", type).toBe(
        !PAYMENT_DECIDED_EVENT_TYPES.includes(type),
      );
    }
  });

  it("an order is open exactly when the history holds none of NOT_OPEN_EVENT_TYPES", () => {
    for (const type of EVERY_EVENT_TYPE) {
      const history: { type: OrderEventType }[] = [{ type: "created" }, { type }];
      expect(isOpenOrder(history), type).toBe(!NOT_OPEN_EVENT_TYPES.includes(type));
    }
  });

  it("every order starts with placed (legacy) or created (checkout)", () => {
    expect([...ORDER_ENTRY_EVENT_TYPES].sort()).toEqual(["created", "placed"]);
  });
});
```

(`derivePaymentStatus`/`isOpenOrder` are already imported by that file; if not, add them.)

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm --filter @platform/orders exec vitest run src/domain/order-statuses.test.ts`
Expected: FAIL — `PAYMENT_DECIDED_EVENT_TYPES` is not exported.

- [ ] **Step 7: Add the sets**

In `services/orders/src/domain/order-statuses.ts` replace

```ts
const PAID: ReadonlySet<OrderEventType> = new Set<OrderEventType>(["paid", "payment_received"]);
```

with

```ts
/** The events that make an order "paid" — exported so SQL predicates use exactly what {@link derivePaymentStatus} reads. */
export const PAID_EVENT_TYPES: readonly OrderEventType[] = ["paid", "payment_received"];
const PAID: ReadonlySet<OrderEventType> = new Set<OrderEventType>(PAID_EVENT_TYPES);
```

and append after `CLOSED_EVENT_TYPE`:

```ts
/** An order is open ({@link isOpenOrder}) exactly while its history holds none of these. */
export const NOT_OPEN_EVENT_TYPES: readonly OrderEventType[] = [
  CANCELLED_EVENT_TYPE,
  CLOSED_EVENT_TYPE,
];

/**
 * An order's payment is "pending" ({@link derivePaymentStatus}) exactly while its history holds none of
 * these: the list's Unpaid tab is a `NOT EXISTS` over them, so the tab and the badge cannot disagree.
 */
export const PAYMENT_DECIDED_EVENT_TYPES: readonly OrderEventType[] = [
  ...PAID_EVENT_TYPES,
  ...REFUNDED_EVENT_TYPES,
  CANCELLED_EVENT_TYPE,
];

/**
 * The event every order starts with — `placed` (legacy `Order.place`) or `created` (checkout). Its time
 * is when the order was placed: the list's `createdAt` and the export's date filter.
 */
export const ORDER_ENTRY_EVENT_TYPES: readonly OrderEventType[] = ["placed", "created"];
```

Also replace `types.includes("cancelled")` in `derivePaymentStatus` with `types.includes(CANCELLED_EVENT_TYPE)`
(it is declared above the function, so move the function below the constants if needed).

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm --filter @platform/orders exec vitest run src/domain/order-statuses.test.ts` — Expected: PASS.

- [ ] **Step 9: Write the failing search tests**

`services/orders/src/domain/order-search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { matchesOrderSearch, phoneSearchNeedles, type SearchableOrder } from "./order-search";

describe("phoneSearchNeedles", () => {
  it("is just the text for a name", () => {
    expect(phoneSearchNeedles("Mona")).toEqual(["Mona"]);
  });

  it("adds the bare digits and the national form without the leading 0", () => {
    expect(phoneSearchNeedles("01012345678")).toEqual(["01012345678", "1012345678"]);
  });

  it("ignores spaces, dashes and brackets the merchant typed", () => {
    expect(phoneSearchNeedles(" 010 1234-5678 ")).toEqual([
      "010 1234-5678",
      "01012345678",
      "1012345678",
    ]);
  });

  it("drops the plus of an international number so +20 … finds +201…", () => {
    expect(phoneSearchNeedles("+20 101 234 5678")).toEqual(["+20 101 234 5678", "201012345678"]);
  });

  it("adds nothing for fewer than four digits", () => {
    expect(phoneSearchNeedles("123")).toEqual(["123"]);
  });
});

function order(overrides: Partial<SearchableOrder["shippingAddress"]> = {}): SearchableOrder {
  return {
    orderNumber: { value: "1001" },
    customerRef: "customer-abc",
    shippingAddress: { recipientName: "Mona Ali", phone: "+201012345678", ...overrides },
  };
}

describe("matchesOrderSearch", () => {
  it("matches the order number, the customer ref and the recipient (case-insensitive)", () => {
    expect(matchesOrderSearch(order(), "1001")).toBe(true);
    expect(matchesOrderSearch(order(), "ABC")).toBe(true);
    expect(matchesOrderSearch(order(), "mona")).toBe(true);
  });

  it("matches the phone typed the Egyptian way", () => {
    expect(matchesOrderSearch(order(), "010 1234 5678")).toBe(true);
    expect(matchesOrderSearch(order(), "01012345678")).toBe(true);
  });

  it("does not match anything else, and an order with no phone never matches by phone", () => {
    expect(matchesOrderSearch(order(), "Ahmed")).toBe(false);
    expect(matchesOrderSearch(order({ phone: undefined }), "01012345678")).toBe(false);
  });

  it("a blank search matches everything", () => {
    expect(matchesOrderSearch(order(), "   ")).toBe(true);
  });
});
```

- [ ] **Step 10: Run to verify it fails**

Run: `pnpm --filter @platform/orders exec vitest run src/domain/order-search.test.ts`
Expected: FAIL — cannot find module `./order-search`.

- [ ] **Step 11: Implement the search helpers**

`services/orders/src/domain/order-search.ts`:

```ts
/** What the list search reads from an order — structurally a slice of `Order`. */
export interface SearchableOrder {
  readonly orderNumber: { readonly value: string };
  readonly customerRef: string;
  readonly shippingAddress: { readonly recipientName?: string; readonly phone?: string };
}

const PHONE_SHAPED = /^[+\d\s().-]+$/;
const MIN_PHONE_DIGITS = 4;

/**
 * The substrings a stored phone is searched for (order operations Part 1 — Egyptian merchants look
 * orders up by phone). The text as typed, plus — when it is phone-shaped — its bare digits and, for a
 * national number, the digits without the leading 0, so `010 1234 5678` finds `+201012345678`.
 */
export function phoneSearchNeedles(search: string): readonly string[] {
  const text = search.trim();
  const needles = new Set<string>([text]);
  if (PHONE_SHAPED.test(text)) {
    const digits = text.replace(/\D/g, "");
    if (digits.length >= MIN_PHONE_DIGITS) {
      needles.add(digits);
      if (digits.startsWith("0")) needles.add(digits.slice(1));
    }
  }
  return [...needles];
}

/**
 * The in-memory mirror of `PrismaOrderRepository`'s search: order number, customer ref or recipient
 * name (case-insensitive substring), or the phone in any of {@link phoneSearchNeedles}' forms.
 */
export function matchesOrderSearch(order: SearchableOrder, search: string): boolean {
  const text = search.trim();
  if (text.length === 0) return true;
  const lower = text.toLowerCase();
  const contains = (value: string | undefined) =>
    value !== undefined && value.toLowerCase().includes(lower);
  if (
    contains(order.orderNumber.value) ||
    contains(order.customerRef) ||
    contains(order.shippingAddress.recipientName)
  ) {
    return true;
  }
  const phone = order.shippingAddress.phone;
  return phone !== undefined && phoneSearchNeedles(text).some((needle) => phone.includes(needle));
}
```

- [ ] **Step 12: Run to verify it passes**

Run: `pnpm --filter @platform/orders exec vitest run src/domain/order-search.test.ts` — Expected: PASS.

- [ ] **Step 13: Extend `OrderListQuery`**

In `services/orders/src/domain/order-repository.ts`, replace the interface with:

```ts
/** The largest page any order list read may ask for (export pages are 250; GET /orders caps at 100 itself). */
export const ORDER_LIST_MAX_PAGE_SIZE = 250;

/**
 * A page request with optional filters, additive over the base {@link CursorPage}. `status` matches the
 * current lifecycle status (derived, never stored). `search` matches the order number, customer ref,
 * shipping recipient name or phone. Order operations Part 1 adds Shopify's tab predicates — each one
 * the exact SQL twin of a pure function in `order-statuses.ts`.
 */
export interface OrderListQuery extends CursorPage {
  readonly status?: OrderStatus;
  readonly search?: string;
  /** true = only archived, false = only not archived, absent = both. */
  readonly archived?: boolean;
  /** true = `isOpenOrder` (never cancelled, not closed); false = the opposite. */
  readonly open?: boolean;
  /** `derivePaymentStatus(history) === "pending"`. */
  readonly paymentStatus?: "pending";
  /** Only these orders (an export of a selection, a bulk action); unknown ids match nothing. */
  readonly ids?: readonly string[];
  /** Inclusive lower bound on the entry event's time (`placed`/`created`). */
  readonly createdFrom?: Date;
  /** Exclusive upper bound on the entry event's time. */
  readonly createdTo?: Date;
}
```

- [ ] **Step 14: Write the failing `where`-builder tests**

`services/orders/src/infrastructure/order-list-where.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { orderListWhere, orderPageSize, recipientSearchWhere, uuidsOf } from "./order-list-where";

const UUID_A = "0192f3a1-0000-7000-8000-000000000001";
const UUID_B = "0192f3a1-0000-7000-8000-000000000009";

describe("orderListWhere (order operations Part 1)", () => {
  it("scopes to the tenant and adds nothing for an empty query", () => {
    expect(orderListWhere({}, "t-1", undefined, [])).toEqual({ tenantId: "t-1" });
  });

  it("archived true → archived_at IS NOT NULL; false → IS NULL", () => {
    expect(orderListWhere({ archived: true }, "t-1", undefined, [])).toEqual({
      tenantId: "t-1",
      archivedAt: { not: null },
    });
    expect(orderListWhere({ archived: false }, "t-1", undefined, [])).toEqual({
      tenantId: "t-1",
      archivedAt: null,
    });
  });

  it("open true → NOT EXISTS a cancelled or closed event; false → EXISTS", () => {
    expect(orderListWhere({ open: true }, "t-1", undefined, [])).toEqual({
      tenantId: "t-1",
      AND: [{ events: { none: { type: { in: ["cancelled", "closed"] } } } }],
    });
    expect(orderListWhere({ open: false }, "t-1", undefined, [])).toEqual({
      tenantId: "t-1",
      AND: [{ events: { some: { type: { in: ["cancelled", "closed"] } } } }],
    });
  });

  it("paymentStatus pending → NOT EXISTS a paid, refunded or cancelled event", () => {
    expect(orderListWhere({ paymentStatus: "pending" }, "t-1", undefined, [])).toEqual({
      tenantId: "t-1",
      AND: [
        {
          events: {
            none: {
              type: {
                in: ["paid", "payment_received", "refunded", "refund_requested", "cancelled"],
              },
            },
          },
        },
      ],
    });
  });

  it("the Unpaid tab combines both NOT EXISTS predicates with archived = null", () => {
    const where = orderListWhere(
      { open: true, paymentStatus: "pending", archived: false },
      "t-1",
      undefined,
      [],
    );
    expect(where.archivedAt).toBeNull();
    expect(where.AND).toHaveLength(2);
  });

  it("ids keep only UUID-shaped ids (a uuid column cannot hold anything else) and join the cursor", () => {
    expect(orderListWhere({ ids: [UUID_A, "not-a-uuid", UUID_A] }, "t-1", UUID_B, [])).toEqual({
      tenantId: "t-1",
      id: { lt: UUID_B, in: [UUID_A] },
    });
  });

  it("dates filter the entry event's time: from inclusive, to exclusive", () => {
    const from = new Date("2026-10-01T00:00:00.000Z");
    const to = new Date("2026-10-02T00:00:00.000Z");
    expect(orderListWhere({ createdFrom: from, createdTo: to }, "t-1", undefined, [])).toEqual({
      tenantId: "t-1",
      AND: [
        {
          events: {
            some: { type: { in: ["placed", "created"] }, occurredAt: { gte: from, lt: to } },
          },
        },
      ],
    });
  });

  it("search ORs the order number, the customer ref and the recipient matches", () => {
    expect(orderListWhere({ search: " mona " }, "t-1", undefined, [UUID_A])).toEqual({
      tenantId: "t-1",
      OR: [
        { orderNumber: { contains: "mona", mode: "insensitive" } },
        { customerRef: { contains: "mona", mode: "insensitive" } },
        { id: { in: [UUID_A] } },
      ],
    });
  });

  it("a blank search adds nothing", () => {
    expect(orderListWhere({ search: "   " }, "t-1", undefined, [])).toEqual({ tenantId: "t-1" });
  });
});

describe("recipientSearchWhere", () => {
  it("matches the name case-insensitively and the phone in each typed form", () => {
    expect(recipientSearchWhere(" 010 1234 5678 ", "t-1")).toEqual({
      tenantId: "t-1",
      OR: [
        { recipientName: { contains: "010 1234 5678", mode: "insensitive" } },
        { phone: { contains: "010 1234 5678" } },
        { phone: { contains: "01012345678" } },
        { phone: { contains: "1012345678" } },
      ],
    });
  });
});

describe("orderPageSize", () => {
  it("defaults like every other repository and caps at 250, not 100", () => {
    expect(orderPageSize(undefined)).toBe(50);
    expect(orderPageSize(250)).toBe(250);
    expect(orderPageSize(1000)).toBe(250);
    expect(orderPageSize(0)).toBe(1);
  });
});

describe("uuidsOf", () => {
  it("dedupes and drops anything that is not a UUID", () => {
    expect(uuidsOf([UUID_A, "abc", UUID_A, UUID_B])).toEqual([UUID_A, UUID_B]);
  });
});
```

- [ ] **Step 15: Run to verify it fails**

Run: `pnpm --filter @platform/orders exec vitest run src/infrastructure/order-list-where.test.ts`
Expected: FAIL — cannot find module `./order-list-where`.

- [ ] **Step 16: Implement the `where` builder**

`services/orders/src/infrastructure/order-list-where.ts`:

```ts
import type { Prisma } from "@prisma/client";
import { normalizePageSize } from "@platform/repository";
import { ORDER_LIST_MAX_PAGE_SIZE, type OrderListQuery } from "../domain/order-repository";
import { phoneSearchNeedles } from "../domain/order-search";
import {
  NOT_OPEN_EVENT_TYPES,
  ORDER_ENTRY_EVENT_TYPES,
  PAYMENT_DECIDED_EVENT_TYPES,
} from "../domain/order-statuses";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSENSITIVE = "insensitive" as const;

/** How many shipping addresses one search may match (spec §1.3); their order ids are OR'd into the list. */
export const RECIPIENT_SEARCH_CAP = 500;

/**
 * The ids a `uuid` column can actually hold, deduped. Anything else can match no row, and sending it
 * would make Postgres fail the whole query ("invalid input syntax for type uuid").
 */
export function uuidsOf(ids: readonly string[]): string[] {
  return [...new Set(ids)].filter((id) => UUID_PATTERN.test(id));
}

/** Like `normalizePageSize`, but an order export page may hold up to {@link ORDER_LIST_MAX_PAGE_SIZE}. */
export function orderPageSize(first: number | undefined): number {
  if (first === undefined) return normalizePageSize(undefined);
  return Math.max(1, Math.min(Math.trunc(first), ORDER_LIST_MAX_PAGE_SIZE));
}

/** The recipient half of a search, on `order_shipping_addresses`: the name, or the phone in each typed form. */
export function recipientSearchWhere(
  search: string,
  tenantId: string,
): Prisma.OrderShippingAddressWhereInput {
  const text = search.trim();
  return {
    tenantId,
    OR: [
      { recipientName: { contains: text, mode: INSENSITIVE } },
      ...phoneSearchNeedles(text).map((needle) => ({ phone: { contains: needle } })),
    ],
  };
}

/**
 * The `orders` WHERE for one list read. Every tab predicate is a relation filter Prisma emits as
 * `EXISTS`/`NOT EXISTS` over `order_events`, built from the same event-type sets the pure functions
 * read — exact pages, no scan cap. `recipientOrderIds` is the first step of the two-step recipient
 * search (see {@link recipientSearchWhere}).
 */
export function orderListWhere(
  query: OrderListQuery,
  tenantId: string,
  after: string | undefined,
  recipientOrderIds: readonly string[],
): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [];
  if (query.open !== undefined) {
    const blocking = { type: { in: [...NOT_OPEN_EVENT_TYPES] } };
    and.push(query.open ? { events: { none: blocking } } : { events: { some: blocking } });
  }
  if (query.paymentStatus === "pending") {
    and.push({ events: { none: { type: { in: [...PAYMENT_DECIDED_EVENT_TYPES] } } } });
  }
  if (query.createdFrom !== undefined || query.createdTo !== undefined) {
    and.push({
      events: {
        some: {
          type: { in: [...ORDER_ENTRY_EVENT_TYPES] },
          occurredAt: {
            ...(query.createdFrom === undefined ? {} : { gte: query.createdFrom }),
            ...(query.createdTo === undefined ? {} : { lt: query.createdTo }),
          },
        },
      },
    });
  }

  const id: { lt?: string; in?: string[] } = {};
  if (after !== undefined) id.lt = after;
  if (query.ids !== undefined) id.in = uuidsOf(query.ids);

  const search = query.search?.trim() ?? "";
  return {
    tenantId,
    ...(id.lt !== undefined || id.in !== undefined ? { id } : {}),
    ...(query.archived === undefined
      ? {}
      : { archivedAt: query.archived ? { not: null } : null }),
    ...(search.length > 0
      ? {
          OR: [
            { orderNumber: { contains: search, mode: INSENSITIVE } },
            { customerRef: { contains: search, mode: INSENSITIVE } },
            ...(recipientOrderIds.length > 0 ? [{ id: { in: [...recipientOrderIds] } }] : []),
          ],
        }
      : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  };
}
```

- [ ] **Step 17: Run to verify it passes**

Run: `pnpm --filter @platform/orders exec vitest run src/infrastructure/order-list-where.test.ts` — Expected: PASS.

- [ ] **Step 18: Write the shared fixture and the failing in-memory views test**

`services/orders/src/infrastructure/order-list-fixture.ts` (a test helper, not exported from the package; it imports no test framework so both suites — and the integration suite — can use it):

```ts
import { Money, UniqueEntityId } from "@platform/domain";
import { Order } from "../domain/order";
import { OrderEvent, type OrderEventType } from "../domain/order-event";
import { OrderItem } from "../domain/order-item";
import type { OrderListQuery } from "../domain/order-repository";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";

/**
 * Order operations Part 1 — ONE fixture and ONE list of expectations that both `InMemoryOrderRepository`
 * and `PrismaOrderRepository` (integration) must satisfy, so the tab predicates cannot drift apart.
 */
export type ListFixtureKey =
  | "openUnpaid"
  | "codPending"
  | "paid"
  | "paymentReceived"
  | "refunded"
  | "cancelled"
  | "closedUnpaid"
  | "archivedUnpaid";

interface PlannedOrder {
  readonly key: ListFixtureKey;
  readonly events: readonly OrderEventType[];
  readonly paymentRef?: string;
  readonly recipient?: { readonly name: string; readonly phone: string };
}

const PLAN: readonly PlannedOrder[] = [
  {
    key: "openUnpaid",
    events: ["created", "confirmed", "awaiting_payment"],
    recipient: { name: "Mona Ali", phone: "+201012345678" },
  },
  {
    key: "codPending",
    events: ["created", "confirmed", "awaiting_payment", "payment_requested"],
    paymentRef: "cod-intent",
  },
  { key: "paid", events: ["placed", "paid"] },
  {
    key: "paymentReceived",
    events: ["created", "confirmed", "awaiting_payment", "payment_requested", "payment_received"],
  },
  { key: "refunded", events: ["placed", "paid", "refunded"] },
  { key: "cancelled", events: ["placed", "cancelled"] },
  { key: "closedUnpaid", events: ["created", "confirmed", "closed"] },
  { key: "archivedUnpaid", events: ["created", "confirmed", "awaiting_payment"] },
];

export const ARCHIVED_FIXTURE_KEYS: readonly ListFixtureKey[] = ["archivedUnpaid"];

const DAY = 86_400_000;
/** Order N of the plan is placed N days after this instant (index 2 = "paid" on Oct 3, 10:00 UTC). */
export const FIXTURE_START = new Date("2026-10-01T10:00:00.000Z");
const dayAfterStart = (days: number) => new Date(FIXTURE_START.getTime() + days * DAY);

function must<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok || result.value === undefined) throw new Error("order list fixture: invalid VO");
  return result.value;
}

export interface ListFixtureOrder {
  readonly key: ListFixtureKey;
  readonly order: Order;
}

/** Builds the plan as version-0 aggregates with exactly the planned history (reconstitute validates no transitions). */
export function buildListFixture(nextId: () => string): readonly ListFixtureOrder[] {
  return PLAN.map((plan, index) => {
    const placedAt = dayAfterStart(index);
    const item = OrderItem.create(
      UniqueEntityId.from(nextId()),
      must(ProductSnapshot.create(nextId(), "Toy", must(Money.create(1000, "EGP")))),
      1,
    );
    const address = must(
      AddressSnapshot.create(
        "1 Nile St",
        "Cairo",
        "11511",
        "EG",
        plan.recipient === undefined
          ? undefined
          : { recipientName: plan.recipient.name, phone: plan.recipient.phone },
      ),
    );
    const history = plan.events.map((type, step) =>
      OrderEvent.create(
        UniqueEntityId.from(nextId()),
        type,
        new Date(placedAt.getTime() + step * 60_000),
      ),
    );
    const order = Order.reconstitute(
      UniqueEntityId.from(nextId()),
      must(OrderNumber.create(String(1001 + index))),
      `customer-${plan.key}`,
      "EGP",
      [item],
      address,
      history,
      0,
      plan.paymentRef === undefined ? {} : { paymentRef: plan.paymentRef },
    );
    return { key: plan.key, order };
  });
}

export interface OrderListCase {
  readonly name: string;
  readonly query: (idOf: (key: ListFixtureKey) => string) => OrderListQuery;
  readonly expected: readonly ListFixtureKey[];
}

const ALL_KEYS = PLAN.map((plan) => plan.key);

export const ORDER_LIST_CASES: readonly OrderListCase[] = [
  { name: "no filter lists every order, archived included", query: () => ({}), expected: ALL_KEYS },
  {
    name: "archived: true lists only archived orders",
    query: () => ({ archived: true }),
    expected: ["archivedUnpaid"],
  },
  {
    name: "archived: false hides archived orders",
    query: () => ({ archived: false }),
    expected: ALL_KEYS.filter((key) => key !== "archivedUnpaid"),
  },
  {
    name: "open: true drops cancelled and closed orders",
    query: () => ({ open: true }),
    expected: ["openUnpaid", "codPending", "paid", "paymentReceived", "refunded", "archivedUnpaid"],
  },
  {
    name: "paymentStatus pending is derivePaymentStatus's pending (closed-but-unpaid included)",
    query: () => ({ paymentStatus: "pending" }),
    expected: ["openUnpaid", "codPending", "closedUnpaid", "archivedUnpaid"],
  },
  {
    name: "the Unpaid tab: open, payment pending, not archived",
    query: () => ({ open: true, paymentStatus: "pending", archived: false }),
    expected: ["openUnpaid", "codPending"],
  },
  {
    name: "the Open tab: open, not archived",
    query: () => ({ open: true, archived: false }),
    expected: ["openUnpaid", "codPending", "paid", "paymentReceived", "refunded"],
  },
  {
    name: "ids narrows to the selection",
    query: (idOf) => ({ ids: [idOf("paid"), idOf("cancelled")] }),
    expected: ["paid", "cancelled"],
  },
  {
    name: "ids that name no order match nothing (and never break the query)",
    query: () => ({ ids: ["not-a-uuid", "00000000-0000-7000-8000-ffffffffffff"] }),
    expected: [],
  },
  {
    name: "createdFrom is inclusive and createdTo exclusive, on the first event's time",
    query: () => ({ createdFrom: dayAfterStart(2), createdTo: dayAfterStart(4) }),
    expected: ["paid", "paymentReceived"],
  },
  {
    name: "search matches the recipient's name",
    query: () => ({ search: "mona" }),
    expected: ["openUnpaid"],
  },
  {
    name: "search matches the phone typed with the national leading 0",
    query: () => ({ search: "010 1234 5678" }),
    expected: ["openUnpaid"],
  },
  {
    name: "search still matches the order number",
    query: () => ({ search: "1003" }),
    expected: ["paid"],
  },
];
```

`services/orders/src/infrastructure/in-memory-order-repository.views.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { InMemoryOrderRepository } from "./in-memory-order-repository";
import {
  ARCHIVED_FIXTURE_KEYS,
  buildListFixture,
  ORDER_LIST_CASES,
  type ListFixtureKey,
} from "./order-list-fixture";
import { OrderEventTranslator } from "./order-event-translator";

const TENANT = "tenant-views";

async function seeded() {
  let n = 0;
  const nextId = () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
  const repository = new InMemoryOrderRepository({
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new OrderEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "orders",
    }),
    context: rootEventContext({ generate: nextId }),
  });
  const fixture = buildListFixture(nextId);
  for (const { order } of fixture) await repository.save(order, TENANT);
  const idOf = (key: ListFixtureKey) => {
    const found = fixture.find((entry) => entry.key === key);
    if (found === undefined) throw new Error(`no fixture order ${key}`);
    return found.order.id.toString();
  };
  for (const key of ARCHIVED_FIXTURE_KEYS) {
    repository.writeArchivedAt(idOf(key), TENANT, new Date("2026-10-18T00:00:00.000Z"));
  }
  const keyOf = (id: string) => fixture.find((entry) => entry.order.id.toString() === id)?.key;
  return { repository, idOf, keyOf };
}

describe("InMemoryOrderRepository list views (shared cases, order operations Part 1)", () => {
  for (const listCase of ORDER_LIST_CASES) {
    it(listCase.name, async () => {
      const { repository, idOf, keyOf } = await seeded();
      const page = await repository.list({ ...listCase.query(idOf), first: 100 }, TENANT);
      expect(page.items.map((order) => keyOf(order.id.toString())).sort()).toEqual(
        [...listCase.expected].sort(),
      );
    });
  }

  it("save() never clears an archive timestamp", async () => {
    const { repository, idOf } = await seeded();
    const id = idOf("archivedUnpaid");
    const order = await repository.findById(id, TENANT);
    if (order === null) throw new Error("setup");
    await repository.save(order, TENANT);
    expect(repository.archivedAtOf(id, TENANT)).toEqual(new Date("2026-10-18T00:00:00.000Z"));
  });

  it("writeArchivedAt refuses an order this shop does not have", async () => {
    const { repository, idOf } = await seeded();
    expect(repository.writeArchivedAt(idOf("paid"), "another-shop", new Date())).toBe(false);
    expect(repository.archivedAtOf(idOf("paid"), "another-shop")).toBeNull();
  });
});
```

- [ ] **Step 19: Run to verify it fails**

Run: `pnpm --filter @platform/orders exec vitest run src/infrastructure/in-memory-order-repository.views.test.ts`
Expected: FAIL — `repository.writeArchivedAt is not a function`.

- [ ] **Step 20: Implement the in-memory predicates and archive storage**

Replace `services/orders/src/infrastructure/in-memory-order-repository.ts` with:

```ts
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor } from "@platform/repository";
import type { Paginated } from "@platform/types";
import type { Order } from "../domain/order";
import type { OrderListQuery, OrderRepository } from "../domain/order-repository";
import { matchesOrderSearch } from "../domain/order-search";
import { derivePaymentStatus, isOpenOrder } from "../domain/order-statuses";
import { orderPageSize } from "./order-list-where";

export interface InMemoryOrderRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `OrderRepository`. Persists the aggregate and writes its events to the outbox on save.
 * ADR-0014: keyed by `(tenantId, orderId)`. Order operations Part 1: the archive timestamp is kept
 * BESIDE the aggregate (like the `archived_at` column beside the Prisma row) and `save()` never touches
 * it; `InMemoryOrderAnnotationRepository` writes it through {@link writeArchivedAt}.
 */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly store = new Map<string, Map<string, Order>>();
  private readonly archived = new Map<string, Map<string, Date>>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryOrderRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(order: Order, tenantId: string, tx?: unknown): Promise<void> {
    let bucket = this.store.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.store.set(tenantId, bucket);
    }
    bucket.set(order.id.toString(), order);
    await this.outbox.write(order.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  /** Every order of one shop: the source of the offline sales read model (`InMemorySalesSummaryQuery`). */
  ordersOf(tenantId: string): readonly Order[] {
    return [...(this.store.get(tenantId)?.values() ?? [])];
  }

  hasOrder(orderId: string, tenantId: string): boolean {
    return this.store.get(tenantId)?.has(orderId) === true;
  }

  archivedAtOf(orderId: string, tenantId: string): Date | null {
    return this.archived.get(tenantId)?.get(orderId) ?? null;
  }

  /** Sets (Date) or clears (null) the archive timestamp; false when this shop has no such order (an UPDATE that matched no row). */
  writeArchivedAt(orderId: string, tenantId: string, archivedAt: Date | null): boolean {
    if (!this.hasOrder(orderId, tenantId)) return false;
    let bucket = this.archived.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.archived.set(tenantId, bucket);
    }
    if (archivedAt === null) bucket.delete(orderId);
    else bucket.set(orderId, archivedAt);
    return true;
  }

  async findById(id: string, tenantId: string): Promise<Order | null> {
    return this.store.get(tenantId)?.get(id) ?? null;
  }

  /** Most-recently-placed-first cursor page, mirroring `PrismaOrderRepository.list` predicate for predicate. */
  async list(query: OrderListQuery, tenantId: string): Promise<Paginated<Order>> {
    const after = query.after !== undefined ? decodeCursor(query.after) : undefined;
    const limit = orderPageSize(query.first);
    const sorted = this.ordersOf(tenantId)
      .slice()
      .sort((a, b) => (a.id.toString() < b.id.toString() ? 1 : -1));
    const filtered = sorted.filter((order) =>
      matchesQuery(order, query, this.archivedAtOf(order.id.toString(), tenantId)),
    );
    const remaining =
      after !== undefined ? filtered.filter((order) => order.id.toString() < after) : filtered;
    return buildPaginatedPage(remaining.slice(0, limit + 1), limit, (order) => order.id.toString());
  }
}

function matchesQuery(order: Order, query: OrderListQuery, archivedAt: Date | null): boolean {
  if (query.status !== undefined && order.status !== query.status) return false;
  if (query.search !== undefined && !matchesOrderSearch(order, query.search)) return false;
  if (query.archived !== undefined && (archivedAt !== null) !== query.archived) return false;
  if (query.open !== undefined && isOpenOrder(order.history) !== query.open) return false;
  if (
    query.paymentStatus !== undefined &&
    derivePaymentStatus(order.history) !== query.paymentStatus
  ) {
    return false;
  }
  if (query.ids !== undefined && !query.ids.includes(order.id.toString())) return false;
  const placedAt = order.history[0]?.occurredAt;
  if (query.createdFrom !== undefined && (placedAt === undefined || placedAt < query.createdFrom)) {
    return false;
  }
  if (query.createdTo !== undefined && (placedAt === undefined || placedAt >= query.createdTo)) {
    return false;
  }
  return true;
}
```

- [ ] **Step 21: Run the in-memory tests to verify they pass**

Run: `pnpm --filter @platform/orders exec vitest run src/infrastructure/in-memory-order-repository.views.test.ts src/infrastructure/in-memory-order-repository.test.ts`
Expected: PASS (the existing search test keeps passing: order number and customer ref still match).

- [ ] **Step 22: Write the failing "save never writes archivedAt" test**

`services/orders/src/infrastructure/prisma-order-repository.archived-at.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { rootEventContext } from "@platform/messaging";
import { Order } from "../domain/order";
import { OrderEvent } from "../domain/order-event";
import { OrderItem } from "../domain/order-item";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import { OrderMapper } from "./order.mapper";
import { PrismaOrderRepository } from "./prisma-order-repository";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function order(version: number): Order {
  const item = OrderItem.create(
    UniqueEntityId.from("item-1"),
    must(ProductSnapshot.create("p-1", "Toy", must(Money.create(500, "EGP")))),
    1,
  );
  return Order.reconstitute(
    UniqueEntityId.from("0192f3a1-0000-7000-8000-000000000001"),
    must(OrderNumber.create("1001")),
    "customer-1",
    "EGP",
    [item],
    must(AddressSnapshot.create("1 Nile St", "Cairo", "11511", "EG")),
    [OrderEvent.create(UniqueEntityId.from("e-1"), "placed", new Date(0))],
    version,
  );
}

/** A transaction client that records every delegate call and answers enough for `save()`. */
function recordingTx() {
  const calls: { readonly model: string; readonly method: string; readonly args: unknown }[] = [];
  const delegate = (model: string) =>
    new Proxy(
      {},
      {
        get: (_target, method: string) => async (args: unknown) => {
          calls.push({ model, method, args });
          return method === "updateMany" ? { count: 1 } : {};
        },
      },
    );
  const tx = new Proxy({}, { get: (_target, model: string) => delegate(model) });
  return { tx, calls };
}

const repository = () =>
  new PrismaOrderRepository({
    prisma: {} as never,
    outbox: { write: async () => undefined } as never,
    context: rootEventContext({ generate: () => "evt" }),
  });

describe("archive stays outside the Order aggregate (order operations Part 1)", () => {
  it("OrderMapper.toOrderRow carries no archivedAt", () => {
    expect(OrderMapper.toOrderRow(order(0), "t-1")).not.toHaveProperty("archivedAt");
  });

  it("save() of a new order writes no archivedAt", async () => {
    const { tx, calls } = recordingTx();
    await repository().save(order(0), "t-1", tx);
    expect(JSON.stringify(calls)).not.toContain("archivedAt");
  });

  it("save() of an existing order never writes (and so never clears) archivedAt", async () => {
    const { tx, calls } = recordingTx();
    const existing = order(1);
    existing.markPaid("pay-1", "e-2", new Date(1));
    await repository().save(existing, "t-1", tx);
    expect(calls.some((call) => call.model === "order" && call.method === "updateMany")).toBe(true);
    expect(JSON.stringify(calls)).not.toContain("archivedAt");
  });
});
```

- [ ] **Step 23: Run to verify the state**

Run: `pnpm --filter @platform/orders exec vitest run src/infrastructure/prisma-order-repository.archived-at.test.ts`
Expected: PASS already for the mapper and both saves (they pin today's behaviour, which the spec
requires to stay). If any case fails, `OrderMapper.toOrderRow` or `save()` writes `archivedAt` — remove
it. Keep the test: it is the guard against a later change.

- [ ] **Step 24: Implement the Prisma predicates**

In `services/orders/src/infrastructure/prisma-order-repository.ts`:

1. Imports: drop `normalizePageSize` from the `@platform/repository` import; add
   `import { orderListWhere, orderPageSize, RECIPIENT_SEARCH_CAP, recipientSearchWhere } from "./order-list-where";`
2. Replace `listWith`, `fetchStatusFilteredPage`'s signature/first lines and `fetchOrders` as below
   (the body of `fetchStatusFilteredPage` after its first lines stays as is, except each
   `this.fetchOrders(client, tenantId, cursor, batchSize, search)` becomes
   `this.fetchOrders(client, tenantId, cursor, batchSize, query, recipientOrderIds)`):

```ts
  private async listWith(
    client: TransactionClient,
    query: OrderListQuery,
    tenantId: string,
  ): Promise<Paginated<Order>> {
    const limit = orderPageSize(query.first);
    const after = query.after !== undefined ? decodeCursor(query.after) : undefined;
    const search = query.search?.trim() ?? "";
    const recipientOrderIds =
      search.length > 0 ? await this.recipientMatches(client, tenantId, search) : [];

    if (query.status !== undefined) {
      return this.fetchStatusFilteredPage(
        client,
        tenantId,
        after,
        limit,
        query.status,
        query,
        recipientOrderIds,
      );
    }

    const orders = await this.fetchOrders(
      client,
      tenantId,
      after,
      limit + 1,
      query,
      recipientOrderIds,
    );
    return buildPaginatedPage(orders, limit, (order) => order.id.toString());
  }

  /** Step one of the recipient search (spec §1.3): the orders whose shipping recipient name or phone matches, capped. */
  private async recipientMatches(
    client: Database | TransactionClient,
    tenantId: string,
    search: string,
  ): Promise<readonly string[]> {
    const rows = await client.orderShippingAddress.findMany({
      where: recipientSearchWhere(search, tenantId),
      select: { orderId: true },
      take: RECIPIENT_SEARCH_CAP,
    });
    return rows.map((row) => row.orderId);
  }

  private async fetchStatusFilteredPage(
    client: Database | TransactionClient,
    tenantId: string,
    after: string | undefined,
    limit: number,
    status: string,
    query: OrderListQuery,
    recipientOrderIds: readonly string[],
  ): Promise<Paginated<Order>> {
    // An export page (250) must not turn one batch into 1,000 hydrated rows: never batch past the cap.
    const batchSize = Math.min(Math.max(limit * 4, 50), STATUS_FILTER_SCAN_CAP);
    // … unchanged loop, with the fetchOrders call shown above …
  }

  /** Fetches `take` orders (fully hydrated), `id desc`, filtered by {@link orderListWhere}. */
  private async fetchOrders(
    client: Database | TransactionClient,
    tenantId: string,
    after: string | undefined,
    take: number,
    query: OrderListQuery,
    recipientOrderIds: readonly string[],
  ): Promise<Order[]> {
    const rows = await client.order.findMany({
      where: orderListWhere(query, tenantId, after, recipientOrderIds),
      include: { items: true, events: { orderBy: { occurredAt: "asc" } } },
      orderBy: { id: "desc" },
      take,
    });
    // … the rest (address batch + OrderMapper.toDomain) unchanged …
  }
```

Update the class doc of `list` to mention the tab predicates.

- [ ] **Step 25: Add the shared cases to the integration suite**

Append to `services/orders/src/infrastructure/prisma-order-repository.integration.test.ts` (add the
imports `afterAll, beforeAll` from vitest and the fixture module):

```ts
describe.runIf(Boolean(databaseUrl))(
  "PrismaOrderRepository list views (integration, shared cases — order operations Part 1)",
  () => {
    const runPrefix = crypto.randomUUID().slice(0, 8);
    let n = 0;
    const nextId = () => `${runPrefix}-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
    const tenantId = `tenant-views-${runPrefix}`;
    const fixture = buildListFixture(nextId);
    const idOf = (key: ListFixtureKey) => {
      const found = fixture.find((entry) => entry.key === key);
      if (found === undefined) throw new Error(`no fixture order ${key}`);
      return found.order.id.toString();
    };
    const keyOf = (id: string) => fixture.find((entry) => entry.order.id.toString() === id)?.key;
    let prisma: ReturnType<typeof createTestPrismaClient>;
    let repository: PrismaOrderRepository;

    beforeAll(async () => {
      prisma = createTestPrismaClient(databaseUrl);
      repository = new PrismaOrderRepository({
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
      const unitOfWork = new PrismaUnitOfWork(prisma);
      for (const { order } of fixture) {
        await unitOfWork.run((tx) => repository.save(order, tenantId, tx));
      }
      for (const key of ARCHIVED_FIXTURE_KEYS) {
        await prisma.order.updateMany({
          where: { id: idOf(key), tenantId },
          data: { archivedAt: new Date() },
        });
      }
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    for (const listCase of ORDER_LIST_CASES) {
      it(listCase.name, async () => {
        const page = await repository.list({ ...listCase.query(idOf), first: 100 }, tenantId);
        expect(page.items.map((order) => keyOf(order.id.toString())).sort()).toEqual(
          [...listCase.expected].sort(),
        );
      });
    }

    it("save() never clears archived_at", async () => {
      const id = idOf("archivedUnpaid");
      const order = await repository.findById(id, tenantId);
      if (order === null) throw new Error("setup");
      order.transition("payment_requested", nextId(), new Date());
      await new PrismaUnitOfWork(prisma).run((tx) => repository.save(order, tenantId, tx));
      const row = await prisma.order.findFirst({ where: { id, tenantId } });
      expect(row?.archivedAt).not.toBeNull();
    });
  },
);
```

(`archivedUnpaid` is at `awaiting_payment`, which may move to `payment_requested`. Without
`DATABASE_URL_TEST` the block is skipped, like its siblings.)

- [ ] **Step 26: Run the whole package, typecheck and lint**

Run: `pnpm --filter @platform/orders test && pnpm --filter @platform/orders typecheck && pnpm --filter @platform/orders lint`
Expected: all PASS (integration blocks skipped without `DATABASE_URL_TEST`).

- [ ] **Step 27: Commit**

```bash
git add packages/db/prisma/schema/migrations/20261018000000_order_archive packages/db/prisma/schema/orders.prisma packages/db/src/schema-migration-consistency.test.ts services/orders/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(orders): list tab predicates and the order archive column

Adds archived/open/paymentStatus/ids/date filters as NOT EXISTS predicates in the Prisma
repository, mirrored by the in-memory one and proved equal by one shared fixture; search
also matches the recipient name and phone (national 0 form included). Adds the nullable
orders.archived_at column outside the aggregate.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Archive storage, use cases and wiring in services/orders

Model tier: **standard**.

**Files:**
- Create: `services/orders/src/domain/order-annotations.ts`
- Create: `services/orders/src/infrastructure/in-memory-order-annotation-repository.ts`
- Create: `services/orders/src/infrastructure/prisma-order-annotation-repository.ts`
- Create: `services/orders/src/application/order-annotations.use-cases.ts`, `services/orders/src/application/order-annotations.use-cases.test.ts`
- Modify: `services/orders/src/infrastructure/tenant-isolation.test.ts`
- Modify: `services/orders/src/interfaces/order.controller.ts`, `services/orders/src/composition.ts`, `services/orders/src/index.ts`
- Modify: `services/orders/src/infrastructure/prisma-sales-summary-query.ts`, `prisma-sales-summary-query.test.ts`
- Modify: `services/orders/src/infrastructure/in-memory-sales-summary-query.ts`, `in-memory-sales-summary-query.test.ts`

**Interfaces:**
- Consumes (Task 1): `InMemoryOrderRepository.hasOrder/archivedAtOf/writeArchivedAt`, `uuidsOf`, Prisma `Order.archivedAt`.
- Produces:
  - `interface OrderAnnotations { readonly archivedAt: Date | null }`
  - `interface OrderAnnotationRepository { setArchived(orderIds: readonly string[], archivedAt: Date | null, tenantId: string, tx?: unknown): Promise<readonly string[]>; annotationsOf(orderIds: readonly string[], tenantId: string, tx?: unknown): Promise<ReadonlyMap<string, OrderAnnotations>> }`
  - `ArchiveOrders`, `UnarchiveOrders` (input `ArchiveOrdersInput = { tenantId; orderIds: readonly string[]; actorRef: string }`, output `ArchiveOrdersOutput = { results: readonly OrderArchiveResult[] }`, `OrderArchiveResult = { orderId; outcome: "changed" | "unchanged" | "not_found"; archivedAt: Date | null }`), `GetOrderAnnotations` (input `{ tenantId; orderIds }`, output `ReadonlyMap<string, OrderAnnotations>`), `MAX_ARCHIVE_BATCH = 50`, `MAX_ANNOTATION_READ = 250`.
  - `OrderController.archiveOrders(input)`, `.unarchiveOrders(input)`, `.orderAnnotations(input)` → `ControllerResponse` (200 with the outputs above; 422 on a bad batch).
  - `@platform/orders` exports: `ArchiveOrdersInput`, `ArchiveOrdersOutput`, `OrderArchiveResult`, `OrderAnnotations`, `OrderAnnotationRepository`, `OrderListQuery`, `MAX_ARCHIVE_BATCH`.
  - Sales summary: `openOrderIds` excludes archived orders (Prisma SQL + in-memory `isArchived?` dep).
  - **Part 2 extends additively:** `OrderAnnotations` gains `note`, `tags`; the port gains `setNote`, `addTags`, `removeTags`, `tagsInUse`; `OrderAnnotationsDeps` gains an optional `timeline` that `setArchiveState` appends to inside the same `unitOfWork.run` (the `tx` is already threaded and `actorRef` already in the input). No signature here changes.

- [ ] **Step 1: Write the port**

`services/orders/src/domain/order-annotations.ts`:

```ts
/**
 * What staff record ON an order, outside the `Order` aggregate (order operations, spec §1.2): writing it
 * never bumps the aggregate's `version` and never adds a history row, so it can never conflict with a
 * payment webhook or a fulfillment write. Part 1: the archive timestamp. Part 2 adds the note and tags.
 */
export interface OrderAnnotations {
  /** When the order was archived (Shopify's reversible Archive); null = not archived. */
  readonly archivedAt: Date | null;
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
}
```

- [ ] **Step 2: Write the failing use-case tests**

`services/orders/src/application/order-annotations.use-cases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Order } from "../domain/order";
import { OrderItem } from "../domain/order-item";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import { InMemoryOrderAnnotationRepository } from "../infrastructure/in-memory-order-annotation-repository";
import { InMemoryOrderRepository } from "../infrastructure/in-memory-order-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { OrderEventTranslator } from "../infrastructure/order-event-translator";
import { ArchiveOrders, GetOrderAnnotations, UnarchiveOrders } from "./order-annotations.use-cases";

const TENANT = "tenant-a";
const FIRST = new Date("2026-10-18T09:00:00.000Z");
const LATER = new Date("2026-10-18T10:00:00.000Z");

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

async function wire(orderIds: readonly string[] = ["o-1", "o-2"]) {
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
  let now = FIRST;
  const deps = { annotations, unitOfWork: new InMemoryUnitOfWork(), clock: { now: () => now } };
  return {
    orders,
    archive: new ArchiveOrders(deps),
    unarchive: new UnarchiveOrders(deps),
    read: new GetOrderAnnotations({ annotations }),
    setNow: (instant: Date) => {
      now = instant;
    },
  };
}

const input = (orderIds: readonly string[]) => ({ tenantId: TENANT, orderIds, actorRef: "staff-1" });

describe("ArchiveOrders / UnarchiveOrders (order operations Part 1)", () => {
  it("archives each order and reports it changed, with the archive time", async () => {
    const { archive } = await wire();
    const result = await archive.execute(input(["o-1", "o-2"]));
    expect(result).toEqual({
      ok: true,
      value: {
        results: [
          { orderId: "o-1", outcome: "changed", archivedAt: FIRST },
          { orderId: "o-2", outcome: "changed", archivedAt: FIRST },
        ],
      },
    });
  });

  it("archiving an archived order is a no-op that keeps its first timestamp (idempotent)", async () => {
    const { archive, setNow, orders } = await wire();
    await archive.execute(input(["o-1"]));
    setNow(LATER);
    const again = await archive.execute(input(["o-1"]));
    expect(again.ok && again.value.results).toEqual([
      { orderId: "o-1", outcome: "unchanged", archivedAt: FIRST },
    ]);
    expect(orders.archivedAtOf("o-1", TENANT)).toEqual(FIRST);
  });

  it("unarchive clears the timestamp; unarchiving an order that is not archived is unchanged", async () => {
    const { archive, unarchive, orders } = await wire();
    await archive.execute(input(["o-1"]));
    const result = await unarchive.execute(input(["o-1", "o-2"]));
    expect(result.ok && result.value.results).toEqual([
      { orderId: "o-1", outcome: "changed", archivedAt: null },
      { orderId: "o-2", outcome: "unchanged", archivedAt: null },
    ]);
    expect(orders.archivedAtOf("o-1", TENANT)).toBeNull();
  });

  it("an id this shop does not have (or another shop's) is not_found, and the others still archive", async () => {
    const { archive, orders } = await wire();
    const result = await archive.execute(input(["o-1", "missing", "theirs"]));
    expect(result.ok && result.value.results.map((r) => r.outcome)).toEqual([
      "changed",
      "not_found",
      "not_found",
    ]);
    expect(orders.archivedAtOf("theirs", "tenant-b")).toBeNull();
  });

  it("collapses duplicate ids into one result", async () => {
    const { archive } = await wire();
    const result = await archive.execute(input(["o-1", "o-1"]));
    expect(result.ok && result.value.results).toHaveLength(1);
  });

  it("refuses 0 or 51 ids with a validation error and writes nothing", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `o-${i}`);
    const { archive, orders } = await wire(ids);
    for (const orderIds of [[], ids]) {
      const result = await archive.execute(input(orderIds));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    }
    expect(orders.archivedAtOf("o-0", TENANT)).toBeNull();
  });

  it("never touches the Order aggregate: same version, same history", async () => {
    const { archive, orders } = await wire();
    const before = await orders.findById("o-1", TENANT);
    await archive.execute(input(["o-1"]));
    const after = await orders.findById("o-1", TENANT);
    expect(after?.version).toBe(before?.version);
    expect(after?.history).toHaveLength(before?.history.length ?? -1);
  });
});

describe("GetOrderAnnotations", () => {
  it("answers each known order's archive timestamp and leaves unknown ids out", async () => {
    const { archive, read } = await wire();
    await archive.execute(input(["o-1"]));
    const result = await read.execute({ tenantId: TENANT, orderIds: ["o-1", "o-2", "missing"] });
    expect(result.ok && [...result.value]).toEqual([
      ["o-1", { archivedAt: FIRST }],
      ["o-2", { archivedAt: null }],
    ]);
  });

  it("refuses more than 250 ids", async () => {
    const { read } = await wire([]);
    const ids = Array.from({ length: 251 }, (_, i) => `o-${i}`);
    const result = await read.execute({ tenantId: TENANT, orderIds: ids });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @platform/orders exec vitest run src/application/order-annotations.use-cases.test.ts`
Expected: FAIL — cannot find module `./order-annotations.use-cases`.

- [ ] **Step 4: Implement both repositories and the use cases**

`services/orders/src/infrastructure/in-memory-order-annotation-repository.ts`:

```ts
import type { OrderAnnotationRepository, OrderAnnotations } from "../domain/order-annotations";
import type { InMemoryOrderRepository } from "./in-memory-order-repository";

export interface InMemoryOrderAnnotationRepositoryDeps {
  /** The order store whose rows the annotations sit beside (the archive "column" lives there). */
  readonly orders: Pick<InMemoryOrderRepository, "hasOrder" | "archivedAtOf" | "writeArchivedAt">;
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
      if (this.orders.hasOrder(orderId, tenantId)) {
        found.set(orderId, { archivedAt: this.orders.archivedAtOf(orderId, tenantId) });
      }
    }
    return found;
  }
}
```

`services/orders/src/infrastructure/prisma-order-annotation-repository.ts`:

```ts
import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { OrderAnnotationRepository, OrderAnnotations } from "../domain/order-annotations";
import { uuidsOf } from "./order-list-where";

export interface PrismaOrderAnnotationRepositoryDeps {
  readonly prisma: Database;
}

/**
 * Production {@link OrderAnnotationRepository} on `orders.orders.archived_at`: a plain `updateMany`
 * scoped by `tenantId` — no `version` condition, no history row, no outbox event (spec §1.2). Writes
 * need the unit of work's `tx`; reads use it when given, else `runReadScoped` (ADR-0014).
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
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaOrderAnnotationRepository.setArchived requires the unit of work's transaction client (ADR-0003).",
      );
    }
    const client = tx as TransactionClient;
    const ids = uuidsOf(orderIds);
    if (ids.length === 0) return [];
    const pending = await client.order.findMany({
      where: { tenantId, id: { in: ids }, archivedAt: archivedAt === null ? { not: null } : null },
      select: { id: true },
    });
    const changed = pending.map((row) => row.id);
    if (changed.length > 0) {
      await client.order.updateMany({
        where: { tenantId, id: { in: changed } },
        data: { archivedAt },
      });
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
    const read = (client: TransactionClient) =>
      client.order.findMany({
        where: { tenantId, id: { in: ids } },
        select: { id: true, archivedAt: true },
      });
    const rows =
      tx !== undefined && tx !== null
        ? await read(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, read);
    return new Map(rows.map((row) => [row.id, { archivedAt: row.archivedAt }]));
  }
}
```

`services/orders/src/application/order-annotations.use-cases.ts`:

```ts
import type { UseCase } from "@platform/application";
import type { Clock } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import type { OrderAnnotationRepository, OrderAnnotations } from "../domain/order-annotations";

/** At most this many orders per archive/unarchive call — the bulk action's cap (spec §1.4). */
export const MAX_ARCHIVE_BATCH = 50;
/** At most this many orders per annotations read — one export page (spec §1.4). */
export const MAX_ANNOTATION_READ = 250;

export interface ArchiveOrdersInput {
  /** ADR-0014: per-call tenant scope. */
  readonly tenantId: string;
  readonly orderIds: readonly string[];
  /** The acting staff principal. Part 1 records nothing with it; Part 2 writes it on the timeline entry. */
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

/** One transaction: read the current state, change only what differs, answer a result per order. */
async function setArchiveState(
  deps: OrderAnnotationsDeps,
  input: ArchiveOrdersInput,
  archive: boolean,
): Promise<Result<ArchiveOrdersOutput, DomainError>> {
  const batch = batchOf(input.orderIds);
  if (!batch.ok) return err(batch.error);
  const ids = batch.value;
  const target = archive ? deps.clock.now() : null;
  const results = await deps.unitOfWork.run(async (tx) => {
    const before = await deps.annotations.annotationsOf(ids, input.tenantId, tx);
    const known = ids.filter((orderId) => before.has(orderId));
    const changed = new Set(
      known.length === 0
        ? []
        : await deps.annotations.setArchived(known, target, input.tenantId, tx),
    );
    return ids.map((orderId): OrderArchiveResult => {
      const current = before.get(orderId);
      if (current === undefined) return { orderId, outcome: "not_found", archivedAt: null };
      if (changed.has(orderId)) return { orderId, outcome: "changed", archivedAt: target };
      return { orderId, outcome: "unchanged", archivedAt: current.archivedAt };
    });
  });
  return ok({ results });
}

/** Shopify's Archive for one or many orders (spec §1.2). Idempotent; never touches the aggregate. */
export class ArchiveOrders implements UseCase<ArchiveOrdersInput, ArchiveOrdersOutput, DomainError> {
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

/** The annotations of a page of orders in ONE read (the list's Archived badge, export rows). */
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
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @platform/orders exec vitest run src/application/order-annotations.use-cases.test.ts` — Expected: PASS.

- [ ] **Step 6: Write the tenant-isolation cases (Prisma over fake-prisma, and in-memory)**

Append to `services/orders/src/infrastructure/tenant-isolation.test.ts` (imports: `createFakePrisma`
from `@platform/db/testing`, the two annotation repositories, `OrderAnnotationRepository` type):

```ts
// ── order operations Part 1: the archive timestamp ──────────────────────────────────────────────
// `setArchived`/`annotationsOf` are plain `where` reads/writes, so the Prisma adapter runs over the
// fake that applies `where` literally: it cannot pass because of RLS.
const VICTIM = "01900000-0000-7000-8000-00000000000a";

async function annotationLayers(): Promise<
  readonly [string, OrderAnnotationRepository, unknown][]
> {
  const fake = createFakePrisma();
  // fake-prisma has no column defaults: seed archivedAt explicitly, as the column's NULL.
  await fake.database.order.create({
    data: { id: VICTIM, tenantId: "tenant-b", archivedAt: null } as never,
  });
  const memoryOrders = repository();
  await memoryOrders.save(placeOrder(VICTIM), "tenant-b");
  return [
    ["prisma over fake-prisma", new PrismaOrderAnnotationRepository({ prisma: fake.database }), fake.database],
    ["in-memory", new InMemoryOrderAnnotationRepository({ orders: memoryOrders }), undefined],
  ];
}

describe("order annotations tenant isolation (order operations Part 1)", () => {
  it("tenant A can neither archive nor read tenant B's order; B can archive its own", async () => {
    for (const [layer, annotations, tx] of await annotationLayers()) {
      expect(await annotations.setArchived([VICTIM], new Date(1), "tenant-a", tx), layer).toEqual([]);
      expect((await annotations.annotationsOf([VICTIM], "tenant-a", tx)).size, layer).toBe(0);
      expect((await annotations.annotationsOf([VICTIM], "tenant-b", tx)).get(VICTIM), layer).toEqual({
        archivedAt: null,
      });
      expect(await annotations.setArchived([VICTIM], new Date(1), "tenant-b", tx), layer).toEqual([
        VICTIM,
      ]);
    }
  });
});
```

Run: `pnpm --filter @platform/orders exec vitest run src/infrastructure/tenant-isolation.test.ts`
Expected: PASS (if the Prisma layer fails with "unsupported where operator", the repository used an
operator the fake does not model — use only `in`, `not` and equality as written above).

- [ ] **Step 7: Write the failing sales-summary tests (archived orders are not "to fulfill")**

Append to `services/orders/src/infrastructure/prisma-sales-summary-query.test.ts`, inside its
`describe`:

```ts
  it("leaves archived orders out of the open orders (Home's card = the Unfulfilled tab)", async () => {
    const withOpen = fakeDatabase([[], [], [], []]);
    await new PrismaSalesSummaryQuery({ prisma: withOpen.database }).summarize({
      ...RANGE,
      includeOpenOrderIds: true,
    });
    expect(withOpen.calls[3]?.sql).toContain('o."archived_at" IS NULL');
  });
```

Append to `services/orders/src/infrastructure/in-memory-sales-summary-query.test.ts`:

```ts
  it("leaves archived orders out of the open orders (order operations Part 1)", async () => {
    const orders = [
      order({ id: "open", createdAt: "2026-10-10T09:00:00Z", totalMinor: 1 }),
      order({ id: "archived", createdAt: "2026-10-10T09:00:00Z", totalMinor: 1 }),
    ];
    const summary = await new InMemorySalesSummaryQuery({
      ordersOf: () => orders,
      isArchived: (orderId) => orderId === "archived",
    }).summarize({ ...RANGE, includeOpenOrderIds: true });

    expect(summary.openOrderIds).toEqual(["open"]);
  });
```

Run both files: `pnpm --filter @platform/orders exec vitest run src/infrastructure/prisma-sales-summary-query.test.ts src/infrastructure/in-memory-sales-summary-query.test.ts`
Expected: FAIL — SQL lacks the clause; `isArchived` is not a known dep (type error at runtime is
ignored, the archived id is still listed).

- [ ] **Step 8: Exclude archived orders in both sales summaries**

In `prisma-sales-summary-query.ts` `openOrderIds`, after `WHERE o."tenant_id" = ${tenantId}` add the line
`AND o."archived_at" IS NULL` and extend the method doc: "…neither cancelled nor closed nor archived".

In `in-memory-sales-summary-query.ts`:

```ts
export interface InMemorySalesSummaryQueryDeps {
  /** Every order of ONE shop; the query never sees another shop's orders. */
  readonly ordersOf: (tenantId: string) => readonly Order[];
  /** Order operations Part 1: whether an order is archived (archived orders are not "to fulfill"). Absent = none are. */
  readonly isArchived?: (orderId: string, tenantId: string) => boolean;
}
```

and the `openOrderIds` expression becomes:

```ts
      openOrderIds:
        input.includeOpenOrderIds === true
          ? orders
              .filter(
                (order) =>
                  isOpenOrder(order.history) &&
                  !(this.deps.isArchived?.(order.id.toString(), input.tenantId) ?? false),
              )
              .map((order) => order.id.toString())
          : [],
```

Run the two files again — Expected: PASS.

- [ ] **Step 9: Wire the controller, composition and exports**

`services/orders/src/interfaces/order.controller.ts` — add to the imports and deps:

```ts
import type {
  ArchiveOrders,
  ArchiveOrdersInput,
  GetOrderAnnotations,
  GetOrderAnnotationsInput,
  UnarchiveOrders,
} from "../application/order-annotations.use-cases";
// in OrderControllerDeps:
  readonly archiveOrders: ArchiveOrders;
  readonly unarchiveOrders: UnarchiveOrders;
  readonly getOrderAnnotations: GetOrderAnnotations;
```

and the methods:

```ts
  /** Order operations Part 1: Shopify's Archive (outside the aggregate; idempotent). */
  async archiveOrders(input: ArchiveOrdersInput): Promise<ControllerResponse> {
    return present(await this.deps.archiveOrders.execute(input), 200);
  }

  async unarchiveOrders(input: ArchiveOrdersInput): Promise<ControllerResponse> {
    return present(await this.deps.unarchiveOrders.execute(input), 200);
  }

  /** The annotations of a page of orders, in one read (body: `ReadonlyMap<string, OrderAnnotations>`). */
  async orderAnnotations(input: GetOrderAnnotationsInput): Promise<ControllerResponse> {
    return present(await this.deps.getOrderAnnotations.execute(input), 200);
  }
```

`services/orders/src/composition.ts`:
- `buildController(orders, unitOfWork, orderNumbers, sales, annotations: OrderAnnotationRepository, deps)`
  and inside `new OrderController({ … })`:

```ts
    archiveOrders: new ArchiveOrders({ annotations, unitOfWork, clock: deps.clock }),
    unarchiveOrders: new UnarchiveOrders({ annotations, unitOfWork, clock: deps.clock }),
    getOrderAnnotations: new GetOrderAnnotations({ annotations }),
```

- Prisma branch: pass `new PrismaOrderAnnotationRepository({ prisma: deps.prisma })`.
- In-memory branch:

```ts
  const orders = new InMemoryOrderRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(
    orders,
    unitOfWork,
    new InMemoryOrderNumberAllocator(),
    new InMemorySalesSummaryQuery({
      ordersOf: (tenantId) => orders.ordersOf(tenantId),
      isArchived: (orderId, tenantId) => orders.archivedAtOf(orderId, tenantId) !== null,
    }),
    new InMemoryOrderAnnotationRepository({ orders }),
    deps,
  );
```

`services/orders/src/index.ts` — add:

```ts
export type { OrderListQuery } from "./domain/order-repository";
export type { OrderAnnotationRepository, OrderAnnotations } from "./domain/order-annotations";
export {
  MAX_ARCHIVE_BATCH,
  type ArchiveOrdersInput,
  type ArchiveOrdersOutput,
  type OrderArchiveResult,
} from "./application/order-annotations.use-cases";
```

- [ ] **Step 10: Run the package, typecheck, lint**

Run: `pnpm --filter @platform/orders test && pnpm --filter @platform/orders typecheck && pnpm --filter @platform/orders lint`
Then `pnpm --filter @platform/admin typecheck` (it builds `OrderController` through `wireOrders`).
Expected: all PASS.

- [ ] **Step 11: Commit**

```bash
git add services/orders/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(orders): archive and unarchive orders outside the aggregate

Adds the OrderAnnotationRepository port (Prisma updateMany on archived_at, in-memory twin),
idempotent ArchiveOrders/UnarchiveOrders and a batched annotations read. Archived orders
leave the dashboard's orders-to-fulfill count, so the card and the Unfulfilled tab agree.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Admin API — views on GET /orders, archive routes, archivedAt on list and detail

Model tier: **standard**.

**Files:**
- Create: `apps/admin/src/http/order-views.ts`
- Create: `apps/admin/src/http/order-operations-routes.ts`
- Create: `apps/admin/src/http/testing/orders-harness.ts`
- Create: `apps/admin/src/http/order-views.e2e.test.ts`
- Modify: `apps/admin/src/http/admin-routes.ts` (imports; `orderStatusValues` → `ORDER_STATUS_VALUES`; `listOrdersQuery`; `OrderListItemDto`/`toOrderListItemDto`; `OrderDetailDto`/`toOrderDetailDto`; `GET /orders`; `GET /orders/:orderId`; register `...orderOperationsRoutes(admin)`)
- Modify: `apps/admin/src/http/unfulfilled-orders.ts`
- Modify: `apps/admin/src/interfaces/orders.admin-controller.ts`, `orders.admin-controller.test.ts`
- Modify: `packages/auth/src/role-table-access-control.test.ts`

**Interfaces:**
- Consumes (Task 2): `OrderController.archiveOrders/unarchiveOrders/orderAnnotations`, `ArchiveOrdersOutput`, `OrderAnnotations`.
- Produces:
  - `OrdersAdminController.archiveOrders(principal, input: ArchiveOrdersInput)` (`orders:archive`), `.unarchiveOrders(principal, input)` (`orders:archive`), `.orderAnnotations(principal, { tenantId, orderIds })` (`orders:read`).
  - `order-views.ts`: `ORDER_VIEWS = ["all","unfulfilled","unpaid","open","archived"] as const`, `type OrderView`, `ORDER_STATUS_VALUES` (moved from admin-routes), `viewFilters(view)`, `resolveOrderView(view?, fulfillment?)`, `type OrderListFilters`, `listOrdersForView(admin, principal, tenantId, view, filters): Promise<OrderViewPage>`, `orderAnnotationsFor(admin, principal, tenantId, orderIds)`.
  - `order-operations-routes.ts`: `orderOperationsRoutes(admin: WiredAdmin): readonly RouteDefinition[]` with `POST /orders/:orderId/archive` and `/unarchive` → 200 `{ orderId, archivedAt: string | null }`, 404 unknown order.
  - `GET /orders` accepts `view`; items gain `archivedAt: string | null`. `GET /orders/:orderId` gains `archivedAt: string | null`.
  - `testing/orders-harness.ts`: `HARNESS_TENANT`, `HARNESS_NOW`, `adminStaff`, `operatorStaff`, `viewerStaff`, `buildOrdersAdmin()`, `placeTestOrder(admin, tenantId?)`, `callRoute(routes, method, path, input, principal?)`.
  - **Part 2 extends additively:** `toOrderListItemDto` takes the whole `OrderAnnotations` (not just `archivedAt`) so Part 2 adds `tags` without changing callers; `GET /orders` adds a `tag` filter field to `listOrdersQuery`; `orderOperationsRoutes` gains note/tag/comment routes.

- [ ] **Step 1: Pin the role table**

Append to `packages/auth/src/role-table-access-control.test.ts`, inside `describe("RoleTableAccessControl")`:

```ts
  it("operators archive and export orders; viewers do neither; cash stays admin-only (orders Part 1)", async () => {
    const op = who(["operator"]);
    const viewer = who(["viewer"]);
    expect(await acl.authorize(op, "orders:archive")).toBe(true);
    expect(await acl.authorize(op, "orders:export")).toBe(true);
    expect(await acl.authorize(viewer, "orders:archive")).toBe(false);
    expect(await acl.authorize(viewer, "orders:export")).toBe(false);
    expect(await acl.authorize(viewer, "orders:read")).toBe(true);
    expect(await acl.authorize(op, "payments:confirm_cod_collection")).toBe(false);
    expect(await acl.authorize(who(["admin"]), "payments:confirm_cod_collection")).toBe(true);
  });
```

Run: `pnpm --filter @platform/auth exec vitest run src/role-table-access-control.test.ts`
Expected: PASS immediately — `orders:*` already grants both; this pins the spec's decision that export
is not a viewer permission. No production change in `packages/auth`.

- [ ] **Step 2: Write the failing controller tests**

In `apps/admin/src/interfaces/orders.admin-controller.test.ts`:
- add `"archiveOrders", "unarchiveOrders", "orderAnnotations"` to the `expect.arrayContaining([...])`
  list of the prototype walk, and add `actorRef: "staff-1"` to the input bag it passes;
- append:

```ts
  describe("archive (order operations Part 1)", () => {
    it("archive and unarchive ask for orders:archive and pass the input through", async () => {
      const { guard, asked } = guardAnswering(true);
      const archiveOrders = vi.fn().mockResolvedValue({ status: 200, body: { results: [] } });
      const unarchiveOrders = vi.fn().mockResolvedValue({ status: 200, body: { results: [] } });
      const target = controller(guard, {
        orders: { archiveOrders, unarchiveOrders } as unknown as OrderController,
      });
      const input = { tenantId: "t-1", orderIds: ["o-1"], actorRef: "staff-1" };

      await target.archiveOrders(staff, input);
      await target.unarchiveOrders(staff, input);

      expect(asked).toEqual(["orders:archive", "orders:archive"]);
      expect(archiveOrders).toHaveBeenCalledWith(input);
      expect(unarchiveOrders).toHaveBeenCalledWith(input);
    });

    it("reads annotations under orders:read", async () => {
      const { guard, asked } = guardAnswering(true);
      const orderAnnotations = vi.fn().mockResolvedValue({ status: 200, body: new Map() });
      const target = controller(guard, {
        orders: { orderAnnotations } as unknown as OrderController,
      });

      await target.orderAnnotations(staff, { tenantId: "t-1", orderIds: ["o-1"] });

      expect(asked).toEqual(["orders:read"]);
      expect(orderAnnotations).toHaveBeenCalledWith({ tenantId: "t-1", orderIds: ["o-1"] });
    });
  });
```

Run: `pnpm --filter @platform/admin exec vitest run src/interfaces/orders.admin-controller.test.ts`
Expected: FAIL — `target.archiveOrders is not a function`.

- [ ] **Step 3: Add the controller methods**

In `apps/admin/src/interfaces/orders.admin-controller.ts`:

```ts
  /** Order operations Part 1: Shopify's Archive. The order's lifecycle and version are untouched. */
  async archiveOrders(
    principal: Principal,
    input: Parameters<OrderController["archiveOrders"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:archive");
    if (denied) return denied;
    return this.orders.archiveOrders(input);
  }

  async unarchiveOrders(
    principal: Principal,
    input: Parameters<OrderController["unarchiveOrders"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:archive");
    if (denied) return denied;
    return this.orders.unarchiveOrders(input);
  }

  /** Each order's annotations (Part 1: the archive timestamp) — part of reading an order, so `orders:read`. */
  async orderAnnotations(
    principal: Principal,
    input: Parameters<OrderController["orderAnnotations"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:read");
    if (denied) return denied;
    return this.orders.orderAnnotations(input);
  }
```

Run the controller test — Expected: PASS.

- [ ] **Step 4: Write the test harness**

`apps/admin/src/http/testing/orders-harness.ts`:

```ts
import { RoleTableAccessControl } from "@platform/auth";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin, type WiredAdmin } from "../../composition";

/** Order operations Part 1 — the real in-memory composition with the real role table. */
export const HARNESS_NOW = new Date("2026-07-05T00:00:00.000Z");
export const HARNESS_TENANT = "shop-a";

export const adminStaff: Principal = { id: "staff-admin", kind: "staff", roles: ["admin"], tenantId: HARNESS_TENANT };
export const operatorStaff: Principal = { id: "staff-op", kind: "staff", roles: ["operator"], tenantId: HARNESS_TENANT };
export const viewerStaff: Principal = { id: "staff-viewer", kind: "staff", roles: ["viewer"], tenantId: HARNESS_TENANT };

export function buildOrdersAdmin(): WiredAdmin {
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
  });
}

/** A legacy `placed` order (payment pending, open, unfulfilled) — returns its id. */
export async function placeTestOrder(admin: WiredAdmin, tenantId = HARNESS_TENANT): Promise<string> {
  const response = await admin.orders.placeOrder(adminStaff, {
    tenantId,
    customerRef: "customer-1",
    currency: "EGP",
    items: [{ productId: "p-1", name: "Toy Wagon", unitPriceAmountMinor: 1000, quantity: 1 }],
    shippingAddress: { line1: "1 Main St", city: "Cairo", postalCode: "11511", country: "EG" },
  });
  if (response.status !== 201) throw new Error(`placeOrder answered ${response.status}`);
  return (response.body as { orderId: string }).orderId;
}

/** Runs a route's handler directly (the route-level guard is the server's; controllers still authorize). */
export async function callRoute(
  routes: readonly RouteDefinition[],
  method: RouteDefinition["method"],
  path: string,
  input: { readonly params?: unknown; readonly query?: unknown; readonly body?: unknown },
  principal: Principal = adminStaff,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const route = routes.find((candidate) => candidate.method === method && candidate.path === path);
  if (route === undefined) throw new Error(`no ${method} ${path} route`);
  return route.handle({
    body: input.body,
    params: input.params,
    query: input.query ?? {},
    context: {
      tenantId: principal.tenantId ?? HARNESS_TENANT,
      principal,
      requestId: "req-1",
      correlationId: "corr-1",
    },
  } as never);
}
```

(If `Principal.tenantId` is typed as required, drop the `??` fallback.)

- [ ] **Step 5: Write the failing e2e test**

`apps/admin/src/http/order-views.e2e.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { WiredAdmin } from "../composition";
import { adminRoutes } from "./admin-routes";
import { salesAnalyticsRoutes } from "./sales-analytics-routes";
import {
  adminStaff,
  buildOrdersAdmin,
  callRoute,
  HARNESS_NOW,
  HARNESS_TENANT,
  placeTestOrder,
  viewerStaff,
} from "./testing/orders-harness";

interface ListBody {
  readonly items: readonly { readonly id: string; readonly archivedAt: string | null }[];
}

async function listed(admin: WiredAdmin, query: Record<string, string>): Promise<string[]> {
  const response = await callRoute(adminRoutes(admin), "GET", "/orders", { query });
  expect(response.status).toBe(200);
  return (response.body as ListBody).items.map((item) => item.id).sort();
}

async function archive(admin: WiredAdmin, orderId: string, principal = adminStaff) {
  return callRoute(adminRoutes(admin), "POST", "/orders/:orderId/archive", { params: { orderId } }, principal);
}

describe("GET /orders views (order operations Part 1, on the real in-memory composition)", () => {
  it("lists Shopify's tabs: All, Open, Unpaid, Archived and Unfulfilled (legacy link included)", async () => {
    const admin = buildOrdersAdmin();
    const open = await placeTestOrder(admin);
    const paid = await placeTestOrder(admin);
    const cancelled = await placeTestOrder(admin);
    const archived = await placeTestOrder(admin);
    expect(
      (await admin.orders.markOrderPaid(adminStaff, { tenantId: HARNESS_TENANT, orderId: paid, paymentRef: "pay-1" })).status,
    ).toBe(200);
    expect(
      (await admin.orders.advanceOrder(adminStaff, { tenantId: HARNESS_TENANT, orderId: cancelled, toStatus: "cancelled" })).status,
    ).toBe(200);
    expect((await archive(admin, archived)).status).toBe(200);

    expect(await listed(admin, {})).toEqual([open, paid, cancelled, archived].sort());
    expect(await listed(admin, { view: "all" })).toEqual([open, paid, cancelled, archived].sort());
    expect(await listed(admin, { view: "open" })).toEqual([open, paid].sort());
    expect(await listed(admin, { view: "unpaid" })).toEqual([open]);
    expect(await listed(admin, { view: "archived" })).toEqual([archived]);
    expect(await listed(admin, { view: "unfulfilled" })).toEqual([open, paid].sort());
    expect(await listed(admin, { fulfillment: "unfulfilled" })).toEqual([open, paid].sort());
  });

  it("shows archivedAt on the archived row only, and on the order page", async () => {
    const admin = buildOrdersAdmin();
    const kept = await placeTestOrder(admin);
    const archived = await placeTestOrder(admin);
    await archive(admin, archived);

    const list = await callRoute(adminRoutes(admin), "GET", "/orders", { query: {} });
    const byId = new Map((list.body as ListBody).items.map((item) => [item.id, item.archivedAt]));
    expect(byId.get(kept)).toBeNull();
    expect(byId.get(archived)).toBe(HARNESS_NOW.toISOString());

    const detail = await callRoute(adminRoutes(admin), "GET", "/orders/:orderId", { params: { orderId: archived } });
    expect((detail.body as { archivedAt: string | null }).archivedAt).toBe(HARNESS_NOW.toISOString());
  });
});

describe("POST /orders/:orderId/archive and /unarchive", () => {
  it("archives, answers the same timestamp again (idempotent) and unarchives", async () => {
    const admin = buildOrdersAdmin();
    const orderId = await placeTestOrder(admin);

    const first = await archive(admin, orderId);
    const again = await archive(admin, orderId);
    const undone = await callRoute(adminRoutes(admin), "POST", "/orders/:orderId/unarchive", { params: { orderId } });

    expect(first).toEqual({ status: 200, body: { orderId, archivedAt: HARNESS_NOW.toISOString() } });
    expect(again).toEqual(first);
    expect(undone).toEqual({ status: 200, body: { orderId, archivedAt: null } });
  });

  it("answers 404 for an order this shop does not have", async () => {
    const admin = buildOrdersAdmin();
    const theirs = await placeTestOrder(admin, "shop-b");
    expect((await archive(admin, theirs)).status).toBe(404);
    expect((await archive(admin, "00000000-0000-7000-8000-0000000000ff")).status).toBe(404);
  });

  it("refuses a viewer and archives nothing", async () => {
    const admin = buildOrdersAdmin();
    const orderId = await placeTestOrder(admin);
    expect((await archive(admin, orderId, viewerStaff)).status).toBe(403);
    expect(await listed(admin, { view: "archived" })).toEqual([]);
  });

  it("declares orders:archive on both routes", () => {
    const routes = adminRoutes(buildOrdersAdmin());
    for (const path of ["/orders/:orderId/archive", "/orders/:orderId/unarchive"]) {
      expect(routes.find((r) => r.method === "POST" && r.path === path)?.permission).toBe("orders:archive");
    }
  });
});

describe("Home's Orders to fulfill and the Unfulfilled tab stay one definition (Review Focus 2)", () => {
  it("archiving removes an order from the card and the tab together", async () => {
    const admin = buildOrdersAdmin();
    const kept = await placeTestOrder(admin);
    const archived = await placeTestOrder(admin);
    await archive(admin, archived);

    const card = await callRoute(
      salesAnalyticsRoutes(admin, { now: () => HARNESS_NOW }),
      "GET",
      "/analytics/sales",
      { query: { range: "today" } },
    );
    const tab = await listed(admin, { view: "unfulfilled" });

    expect(tab).toEqual([kept]);
    expect((card.body as { current: { ordersToFulfill: number } }).current.ordersToFulfill).toBe(tab.length);
  });
});
```

Run: `pnpm --filter @platform/admin exec vitest run src/http/order-views.e2e.test.ts`
Expected: FAIL — "no POST /orders/:orderId/archive route".

- [ ] **Step 6: Implement `order-views.ts`**

`apps/admin/src/http/order-views.ts`:

```ts
import type { Principal } from "@platform/contracts";
import type { Order, OrderAnnotations, OrderFulfillmentStatus } from "@platform/orders";
import type { Paginated } from "@platform/types";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import { fulfillmentStatusesOf } from "./fulfillment-statuses-of";
import { listUnfulfilledOrders } from "./unfulfilled-orders";

/** Shopify's default views, in Shopify's order (spec §1.1). */
export const ORDER_VIEWS = ["all", "unfulfilled", "unpaid", "open", "archived"] as const;
export type OrderView = (typeof ORDER_VIEWS)[number];

/** The 21 lifecycle statuses the Filter's status select offers (moved here from admin-routes.ts). */
export const ORDER_STATUS_VALUES = [
  "placed",
  "paid",
  "refunded",
  "created",
  "confirmed",
  "cancelled",
  "held",
  "resumed",
  "awaiting_payment",
  "payment_requested",
  "payment_received",
  "payment_failed",
  "ready_for_fulfillment",
  "fulfillment_requested",
  "fulfilled",
  "partially_fulfilled",
  "delivered",
  "return_requested",
  "returned",
  "refund_requested",
  "closed",
] as const;

type ListInput = Parameters<WiredAdmin["orders"]["listOrders"]>[1];
/** Everything a caller may filter on besides the view's own predicates. */
export type OrderListFilters = Omit<ListInput, "tenantId" | "archived" | "open" | "paymentStatus">;

/** Each tab as repository predicates; `unfulfilled` adds the Fulfillment-side check in `listUnfulfilledOrders`. */
export function viewFilters(view: OrderView): Pick<ListInput, "archived" | "open" | "paymentStatus"> {
  switch (view) {
    case "all":
      return {};
    case "unfulfilled":
      return { archived: false };
    case "unpaid":
      return { archived: false, open: true, paymentStatus: "pending" };
    case "open":
      return { archived: false, open: true };
    case "archived":
      return { archived: true };
  }
}

/** `view` wins; Home's old `fulfillment=unfulfilled` links read as the Unfulfilled tab; nothing = All. */
export function resolveOrderView(
  view: OrderView | undefined,
  fulfillment: "unfulfilled" | undefined,
): OrderView {
  return view ?? (fulfillment === "unfulfilled" ? "unfulfilled" : "all");
}

export type OrderViewPage =
  | {
      readonly ok: true;
      readonly page: Paginated<Order>;
      readonly statuses: ReadonlyMap<string, OrderFulfillmentStatus>;
    }
  | { readonly ok: false; readonly response: AdminResponse };

/** One page of a view, with each order's Plan 3B fulfillment status (one batched Fulfillment read). */
export async function listOrdersForView(
  admin: Pick<WiredAdmin, "orders">,
  principal: Principal,
  tenantId: string,
  view: OrderView,
  filters: OrderListFilters,
): Promise<OrderViewPage> {
  const query = { ...filters, ...viewFilters(view) };
  if (view === "unfulfilled") {
    const found = await listUnfulfilledOrders(admin, principal, tenantId, query);
    return found.ok ? { ok: true, page: found.page, statuses: found.statuses } : found;
  }
  const response = await admin.orders.listOrders(principal, { ...query, tenantId });
  if (response.status !== 200) return { ok: false, response };
  const page = response.body as Paginated<Order>;
  const statuses = await fulfillmentStatusesOf(
    admin,
    principal,
    tenantId,
    page.items.map((order) => order.id.toString()),
  );
  if (!statuses.ok) return { ok: false, response: statuses.response };
  return { ok: true, page, statuses: statuses.byOrder };
}

/** Each order's annotations from ONE read; a failed read is answered as the failure. */
export async function orderAnnotationsFor(
  admin: Pick<WiredAdmin, "orders">,
  principal: Principal,
  tenantId: string,
  orderIds: readonly string[],
): Promise<
  | { readonly ok: true; readonly byOrder: ReadonlyMap<string, OrderAnnotations> }
  | { readonly ok: false; readonly response: AdminResponse }
> {
  if (orderIds.length === 0) return { ok: true, byOrder: new Map() };
  const response = await admin.orders.orderAnnotations(principal, { tenantId, orderIds });
  if (response.status !== 200) return { ok: false, response };
  return { ok: true, byOrder: response.body as ReadonlyMap<string, OrderAnnotations> };
}
```

- [ ] **Step 7: Let `listUnfulfilledOrders` pass every filter through**

In `apps/admin/src/http/unfulfilled-orders.ts` change the `query` parameter type and the per-batch call:

```ts
  query: Omit<Parameters<WiredAdmin["orders"]["listOrders"]>[1], "tenantId">,
): Promise<UnfulfilledOrdersResult> {
  const { first, after, ...filters } = query;
  const limit = first ?? DEFAULT_PAGE;
  const matches: Order[] = [];
  let cursor = after;
  // …
    const response = await admin.orders.listOrders(principal, {
      ...filters,
      tenantId,
      first: Math.min(BATCH, UNFULFILLED_SCAN_CAP - scanned),
      ...(cursor === undefined ? {} : { after: cursor }),
    });
```

(The rest of the function is unchanged. `filters` now carries `archived: false` from the view, plus
`search`, `status`, `ids`, `createdFrom`, `createdTo` when the export asks for them.)
Run: `pnpm --filter @platform/admin exec vitest run src/http/unfulfilled-orders.test.ts` — Expected: PASS.

- [ ] **Step 8: Add the archive routes**

`apps/admin/src/http/order-operations-routes.ts`:

```ts
import { z } from "zod";
import type { Principal } from "@platform/contracts";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { ArchiveOrdersOutput } from "@platform/orders";
import { NotFoundError, toErrorEnvelope } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";

const orderIdParams = z.object({ orderId: z.string().min(1) });

/** Archive or unarchive ONE order through the same use case the bulk action runs (spec §1.4). */
async function setOneArchived(
  admin: WiredAdmin,
  principal: Principal,
  tenantId: string,
  orderId: string,
  archive: boolean,
): Promise<AdminResponse> {
  const input = { tenantId, orderIds: [orderId], actorRef: principal.id };
  const response = archive
    ? await admin.orders.archiveOrders(principal, input)
    : await admin.orders.unarchiveOrders(principal, input);
  if (response.status !== 200) return response;
  const result = (response.body as ArchiveOrdersOutput).results[0];
  if (result === undefined || result.outcome === "not_found") {
    return { status: 404, body: toErrorEnvelope(new NotFoundError("Order not found")) };
  }
  return {
    status: 200,
    body: { orderId: result.orderId, archivedAt: result.archivedAt?.toISOString() ?? null },
  };
}

/** Order operations Part 1 — the list's operations (archive here; bulk, export rows and packing slips follow). */
export function orderOperationsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/orders/:orderId/archive",
      version: 1,
      permission: "orders:archive",
      idempotent: true,
      summary: "Archive an order (Shopify's reversible Archive; the lifecycle and version are untouched)",
      schema: { params: orderIdParams },
      handle: ({ params, context }) =>
        setOneArchived(admin, context.principal, context.tenantId, params.orderId, true),
    }),
    defineRoute({
      method: "POST",
      path: "/orders/:orderId/unarchive",
      version: 1,
      permission: "orders:archive",
      idempotent: true,
      summary: "Unarchive an order",
      schema: { params: orderIdParams },
      handle: ({ params, context }) =>
        setOneArchived(admin, context.principal, context.tenantId, params.orderId, false),
    }),
  ];
}
```

- [ ] **Step 9: Make `GET /orders` and `GET /orders/:orderId` view- and archive-aware**

In `apps/admin/src/http/admin-routes.ts`:

1. Imports: remove `listUnfulfilledOrders`; add
   `import { ORDER_STATUS_VALUES, ORDER_VIEWS, listOrdersForView, orderAnnotationsFor, resolveOrderView } from "./order-views";`
   and `import { orderOperationsRoutes } from "./order-operations-routes";`
2. Delete the `const orderStatusValues = [...] as const;` block (its 21 values are exactly
   `ORDER_STATUS_VALUES` above — diff them before deleting); replace every `z.enum(orderStatusValues)`
   with `z.enum(ORDER_STATUS_VALUES)`.
3. `listOrdersQuery` gains `view: z.enum(ORDER_VIEWS).optional(),` (keep `fulfillment`).
4. `OrderListItemDto` gains
   `/** Order operations Part 1: when the order was archived (Shopify's badge); null when not. */ readonly archivedAt: string | null;`
   and `toOrderListItemDto(order, fulfillmentStatus, customerNames, annotations: OrderAnnotations | undefined)`
   sets `archivedAt: annotations?.archivedAt?.toISOString() ?? null` (import `type OrderAnnotations` from `@platform/orders`).
5. Replace the `GET /orders` handler body with:

```ts
      handle: async ({ query, context }): Promise<AdminResponse> => {
        const { view, fulfillment, ...filters } = query;
        const found = await listOrdersForView(
          admin,
          context.principal,
          context.tenantId,
          resolveOrderView(view, fulfillment),
          filters,
        );
        if (!found.ok) return found.response;
        const orders = found.page.items;
        const annotations = await orderAnnotationsFor(
          admin,
          context.principal,
          context.tenantId,
          orders.map((order) => order.id.toString()),
        );
        if (!annotations.ok) return annotations.response;
        const customerNames = await customerNamesFor(admin, context.principal, context.tenantId, orders);
        return {
          status: 200,
          body: {
            items: orders.map((order) =>
              toOrderListItemDto(
                order,
                found.statuses.get(order.id.toString()) ?? "unfulfilled",
                customerNames,
                annotations.byOrder.get(order.id.toString()),
              ),
            ),
            pageInfo: found.page.pageInfo,
          },
        };
      },
```

   Update the route `summary` to "List orders by Shopify view (all/unfulfilled/unpaid/open/archived), most recent first".
6. `OrderDetailDto` gains `readonly archivedAt: string | null;`; `toOrderDetailDto` takes a trailing
   `archivedAt: Date | null` and sets `archivedAt: archivedAt?.toISOString() ?? null`. In the
   `GET /orders/:orderId` handler, after the fulfillment read:

```ts
        const annotations = await orderAnnotationsFor(admin, context.principal, context.tenantId, [
          order.id.toString(),
        ]);
        if (!annotations.ok) return annotations.response;
```

   and pass `annotations.byOrder.get(order.id.toString())?.archivedAt ?? null` to `toOrderDetailDto`.
7. In `adminRoutes`' returned list, add `...orderOperationsRoutes(admin),` next to `...fulfillmentRoutes(admin),`.

- [ ] **Step 10: Run the e2e test and the whole admin suite**

Run: `pnpm --filter @platform/admin exec vitest run src/http/order-views.e2e.test.ts` — Expected: PASS.
Run: `pnpm --filter @platform/admin test && pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin lint`
Expected: PASS. If an existing test compares a whole list item or detail body with `toEqual`, add
`archivedAt: null` to its expectation (the field is new, never a behaviour change).

- [ ] **Step 11: Commit**

```bash
git add packages/auth/src/role-table-access-control.test.ts apps/admin/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin): order views and archive routes

GET /orders takes Shopify's view (legacy fulfillment=unfulfilled still accepted) and its
items, like the order page, carry archivedAt. Adds POST /orders/:orderId/archive and
/unarchive behind orders:archive, idempotent, 404 for another shop's order.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Batched payment-intent read (services/payments → OrdersAdminController)

Model tier: **cheap** (mechanical, fully specified).

**Files:**
- Modify: `services/payments/src/domain/payment-intent-repository.ts`
- Modify: `services/payments/src/infrastructure/prisma-payment-intent-repository.ts`
- Modify: `services/payments/src/infrastructure/in-memory-payment-intent-repository.ts`
- Create: `services/payments/src/application/get-payment-intents-by-ids.use-case.ts`, `services/payments/src/application/get-payment-intents-by-ids.use-case.test.ts`
- Create: `services/payments/src/infrastructure/prisma-payment-intent-repository.find-by-ids.test.ts`
- Modify: `services/payments/src/interfaces/payment.controller.ts`, `services/payments/src/composition.ts`, `services/payments/src/index.ts`
- Modify: `apps/admin/src/interfaces/orders.admin-controller.ts`, `orders.admin-controller.test.ts`
- Create: `apps/admin/src/http/order-payment-intents.ts`, `apps/admin/src/http/order-payment-intents.test.ts`

**Interfaces:**
- Consumes: `PaymentIntent` getters (`id`, `orderRef`, `provider`, `status.value`, `amount.amountMinor`, `amount.currency`), `ProviderCapabilityLookup`, `isSettledByOperatorConfirmation`.
- Produces:
  - `interface PaymentIntentBatchReader { findByIds(ids: readonly string[], tenantId: string, tx?: unknown): Promise<readonly PaymentIntent[]> }` (implemented by both repositories; a separate port so the many test doubles of `PaymentIntentRepository` need no change).
  - `interface PaymentIntentSummary { id; orderRef; provider: string; status: string; amountMinor: number; currency: string; settlesAtPayTime: boolean; settledByOperatorConfirmation: boolean }`; `GetPaymentIntentsByIds` (input `{ tenantId; paymentIntentIds: readonly string[] }`, ≤ 250 ids), `MAX_PAYMENT_INTENTS_PER_READ = 250`.
  - `PaymentController.getPaymentIntentsByIds(input): Promise<ControllerResponse>` (200 `readonly PaymentIntentSummary[]`).
  - `OrdersAdminController.paymentIntentsOf(principal, { tenantId, paymentIntentIds }): Promise<AdminResponse>` (`orders:read`).
  - `paymentIntentsOfOrders(admin: Pick<WiredAdmin,"orders">, principal, tenantId, orders: readonly Order[]): Promise<{ ok: true; byId: ReadonlyMap<string, PaymentIntentSummary> } | { ok: false; response: AdminResponse }>`.
  - **Part 2/4 extend additively:** Part 4's `manual` provider gets the right flags from its declared capabilities with no change here.

- [ ] **Step 1: Write the failing use-case test**

`services/payments/src/application/get-payment-intents-by-ids.use-case.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { PaymentIntent } from "../domain/payment-intent";
import type { ProviderCapabilities } from "../domain/value-objects/provider-capabilities";
import { InMemoryPaymentIntentRepository } from "../infrastructure/in-memory-payment-intent-repository";
import { PaymentEventTranslator } from "../infrastructure/payment-event-translator";
import { GetPaymentIntentsByIds } from "./get-payment-intents-by-ids.use-case";

const COD: ProviderCapabilities = {
  settlesAtPayTime: true,
  deliversWebhooks: false,
  requiresMerchantCredentials: false,
  chargesOffSession: false,
};
const STRIPE: ProviderCapabilities = {
  settlesAtPayTime: false,
  deliversWebhooks: true,
  requiresMerchantCredentials: false,
  chargesOffSession: true,
};
const providers = {
  capabilitiesOf: (provider: string) =>
    provider === "cod" ? COD : provider === "stripe" ? STRIPE : undefined,
};

function egp(amountMinor: number): Money {
  const result = Money.create(amountMinor, "EGP");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

async function wire() {
  const intents = new InMemoryPaymentIntentRepository({
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new PaymentEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "payments",
    }),
    context: rootEventContext({ generate: () => "evt" }),
  });
  await intents.save(PaymentIntent.createIntent(UniqueEntityId.from("i-cod"), "o-1", egp(45000), "cod"), "t-a");
  await intents.save(PaymentIntent.createIntent(UniqueEntityId.from("i-card"), "o-2", egp(1000), "stripe"), "t-a");
  await intents.save(PaymentIntent.createIntent(UniqueEntityId.from("i-gone"), "o-3", egp(1), "retired"), "t-a");
  await intents.save(PaymentIntent.createIntent(UniqueEntityId.from("i-theirs"), "o-9", egp(1), "cod"), "t-b");
  return intents;
}

describe("GetPaymentIntentsByIds (order operations Part 1)", () => {
  it("summarizes each intent with its provider's capabilities, never the aggregate", async () => {
    const result = await new GetPaymentIntentsByIds({ intents: await wire(), providers }).execute({
      tenantId: "t-a",
      paymentIntentIds: ["i-cod", "i-card", "i-gone"],
    });
    expect(result.ok && result.value).toEqual([
      { id: "i-cod", orderRef: "o-1", provider: "cod", status: "created", amountMinor: 45000, currency: "EGP", settlesAtPayTime: true, settledByOperatorConfirmation: true },
      { id: "i-card", orderRef: "o-2", provider: "stripe", status: "created", amountMinor: 1000, currency: "EGP", settlesAtPayTime: false, settledByOperatorConfirmation: false },
      { id: "i-gone", orderRef: "o-3", provider: "retired", status: "created", amountMinor: 1, currency: "EGP", settlesAtPayTime: false, settledByOperatorConfirmation: false },
    ]);
  });

  it("never returns another shop's intent", async () => {
    const result = await new GetPaymentIntentsByIds({ intents: await wire(), providers }).execute({
      tenantId: "t-a",
      paymentIntentIds: ["i-theirs"],
    });
    expect(result.ok && result.value).toEqual([]);
  });

  it("answers an empty list without reading anything", async () => {
    const intents = { findByIds: vi.fn() };
    const result = await new GetPaymentIntentsByIds({ intents, providers }).execute({
      tenantId: "t-a",
      paymentIntentIds: [],
    });
    expect(result.ok && result.value).toEqual([]);
    expect(intents.findByIds).not.toHaveBeenCalled();
  });

  it("refuses more than 250 ids", async () => {
    const result = await new GetPaymentIntentsByIds({ intents: await wire(), providers }).execute({
      tenantId: "t-a",
      paymentIntentIds: Array.from({ length: 251 }, (_, i) => `i-${i}`),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });
});
```

Run: `pnpm --filter @platform/payments exec vitest run src/application/get-payment-intents-by-ids.use-case.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Add the port and the in-memory `findByIds`**

Append to `services/payments/src/domain/payment-intent-repository.ts`:

```ts
/**
 * Order operations Part 1: many intents in ONE read (the orders list, export rows, packing slips and
 * the bulk "Mark cash as received"). A separate port so the many `PaymentIntentRepository` doubles in
 * tests stay valid. Ids of other shops and unknown ids are simply absent from the answer.
 */
export interface PaymentIntentBatchReader {
  findByIds(ids: readonly string[], tenantId: string, tx?: unknown): Promise<readonly PaymentIntent[]>;
}
```

In `in-memory-payment-intent-repository.ts`: `implements PaymentIntentRepository, PaymentIntentBatchReader` and

```ts
  /** Mirrors `PrismaPaymentIntentRepository.findByIds`: this shop's intents among `ids`, deduped. */
  async findByIds(ids: readonly string[], tenantId: string): Promise<readonly PaymentIntent[]> {
    const bucket = this.store.get(tenantId);
    if (bucket === undefined) return [];
    return [...new Set(ids)].flatMap((id) => {
      const intent = bucket.get(id);
      return intent === undefined ? [] : [intent];
    });
  }
```

- [ ] **Step 3: Implement the use case**

`services/payments/src/application/get-payment-intents-by-ids.use-case.ts`:

```ts
import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import type { PaymentIntentBatchReader } from "../domain/payment-intent-repository";
import { isSettledByOperatorConfirmation } from "../domain/value-objects/provider-capabilities";
import type { ProviderCapabilityLookup } from "./ports";

/** One export page of orders (spec §1.4). */
export const MAX_PAYMENT_INTENTS_PER_READ = 250;

export interface GetPaymentIntentsByIdsInput {
  /** ADR-0014: per-call tenant scope. */
  readonly tenantId: string;
  readonly paymentIntentIds: readonly string[];
}

/** What an order screen may know about a payment — never the aggregate (no PSP refs, no charges). */
export interface PaymentIntentSummary {
  readonly id: string;
  readonly orderRef: string;
  readonly provider: string;
  readonly status: string;
  readonly amountMinor: number;
  readonly currency: string;
  /** The provider settles when the shopper pays — no separate capture step (cash on delivery, Paymob). */
  readonly settlesAtPayTime: boolean;
  /** Only an operator confirming the money arrived settles it (cash on delivery) — by capability, not name. */
  readonly settledByOperatorConfirmation: boolean;
}

export interface GetPaymentIntentsByIdsDeps {
  readonly intents: PaymentIntentBatchReader;
  readonly providers: ProviderCapabilityLookup;
}

/** Many intents in one read, each with its provider's declared capabilities (an unregistered provider has none). */
export class GetPaymentIntentsByIds implements UseCase<
  GetPaymentIntentsByIdsInput,
  readonly PaymentIntentSummary[],
  DomainError
> {
  private readonly deps: GetPaymentIntentsByIdsDeps;

  constructor(deps: GetPaymentIntentsByIdsDeps) {
    this.deps = deps;
  }

  async execute(
    input: GetPaymentIntentsByIdsInput,
  ): Promise<Result<readonly PaymentIntentSummary[], DomainError>> {
    const ids = [...new Set(input.paymentIntentIds)];
    if (ids.length > MAX_PAYMENT_INTENTS_PER_READ) {
      return err(
        new ValidationError(`At most ${MAX_PAYMENT_INTENTS_PER_READ} payment intents per read`, [
          { field: "paymentIntentIds", message: `must hold at most ${MAX_PAYMENT_INTENTS_PER_READ} ids` },
        ]),
      );
    }
    if (ids.length === 0) return ok([]);
    const intents = await this.deps.intents.findByIds(ids, input.tenantId);
    return ok(
      intents.map((intent) => {
        const capabilities = this.deps.providers.capabilitiesOf(intent.provider);
        return {
          id: intent.id.toString(),
          orderRef: intent.orderRef,
          provider: intent.provider,
          status: intent.status.value,
          amountMinor: intent.amount.amountMinor,
          currency: intent.amount.currency,
          settlesAtPayTime: capabilities?.settlesAtPayTime ?? false,
          settledByOperatorConfirmation:
            capabilities !== undefined && isSettledByOperatorConfirmation(capabilities),
        };
      }),
    );
  }
}
```

Run the use-case test — Expected: PASS.

- [ ] **Step 4: Write the failing Prisma `findByIds` test**

`services/payments/src/infrastructure/prisma-payment-intent-repository.find-by-ids.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Database } from "@platform/db";
import { rootEventContext } from "@platform/messaging";
import { PrismaPaymentIntentRepository } from "./prisma-payment-intent-repository";

const UUID = "0192f3a1-0000-7000-8000-000000000001";

/** A database whose tenant-scoped transaction records what `paymentIntent.findMany` was asked. */
function recordingDatabase() {
  const asked: unknown[] = [];
  const client = {
    $executeRaw: async () => 0,
    paymentIntent: {
      findMany: async (args: unknown) => {
        asked.push(args);
        return [];
      },
    },
  };
  const database = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  } as unknown as Database;
  return { database, asked };
}

const repository = (database: Database) =>
  new PrismaPaymentIntentRepository({
    prisma: database,
    outbox: { write: async () => undefined } as never,
    context: rootEventContext({ generate: () => "evt" }),
  });

describe("PrismaPaymentIntentRepository.findByIds (order operations Part 1)", () => {
  it("asks for this tenant's intents only, among the UUID-shaped ids, deduped", async () => {
    const { database, asked } = recordingDatabase();
    await repository(database).findByIds([UUID, "payment-legacy-1", UUID], "t-a");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ where: { tenantId: "t-a", id: { in: [UUID] } } });
  });

  it("does not query at all when no id can be an intent (a legacy non-UUID paymentRef)", async () => {
    const { database, asked } = recordingDatabase();
    expect(await repository(database).findByIds(["payment-legacy-1"], "t-a")).toEqual([]);
    expect(asked).toEqual([]);
  });
});
```

Run: `pnpm --filter @platform/payments exec vitest run src/infrastructure/prisma-payment-intent-repository.find-by-ids.test.ts`
Expected: FAIL — `findByIds is not a function`.

- [ ] **Step 5: Implement the Prisma `findByIds`**

In `prisma-payment-intent-repository.ts`: `implements PaymentIntentRepository, PaymentIntentBatchReader`; add
at module level

```ts
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTENT_CHILDREN = {
  charges: { orderBy: { occurredAt: "asc" as const } },
  refunds: { orderBy: { occurredAt: "asc" as const } },
  attempts: { orderBy: { occurredAt: "asc" as const } },
};
```

use `include: INTENT_CHILDREN` in `findOne`, and add:

```ts
  /** Order operations Part 1: this shop's intents among `ids`, in one read. Non-UUID ids (legacy refs) can match no row and are not sent. */
  async findByIds(ids: readonly string[], tenantId: string, tx?: unknown): Promise<readonly PaymentIntent[]> {
    const wanted = [...new Set(ids)].filter((id) => UUID_PATTERN.test(id));
    if (wanted.length === 0) return [];
    const run = (client: TransactionClient) =>
      client.paymentIntent.findMany({
        where: { tenantId, id: { in: wanted } },
        include: INTENT_CHILDREN,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return rows.map((row) =>
      PaymentIntentMapper.toDomain(
        { ...row, paymentMethod: row.paymentMethod as { token: string; brand?: string } },
        row.charges,
        row.refunds,
        row.attempts,
      ),
    );
  }
```

Run the test — Expected: PASS.

- [ ] **Step 6: Wire it through the controller, composition and exports**

- `payment.controller.ts`: import the use case type; `readonly getPaymentIntentsByIds: GetPaymentIntentsByIds;` in deps;

```ts
  /** Order operations Part 1: many intents' summaries in one read. */
  async getPaymentIntentsByIds(input: GetPaymentIntentsByIdsInput): Promise<ControllerResponse> {
    return present(await this.deps.getPaymentIntentsByIds.execute(input), 200);
  }
```

- `composition.ts`: `buildController(intents: PaymentIntentRepository & PaymentIntentBatchReader, …)`
  and `getPaymentIntentsByIds: new GetPaymentIntentsByIds({ intents, providers }),`.
- `index.ts`: `export { MAX_PAYMENT_INTENTS_PER_READ, type PaymentIntentSummary } from "./application/get-payment-intents-by-ids.use-case";`

Run: `pnpm --filter @platform/payments test && pnpm --filter @platform/payments typecheck && pnpm --filter @platform/payments lint` — Expected: PASS.

- [ ] **Step 7: Write the failing admin-side tests**

In `apps/admin/src/interfaces/orders.admin-controller.test.ts`: widen the `payments` Pick in the
`controller()` helper to `"getPaymentIntent" | "refundLifecycle" | "getPaymentIntentsByIds"`, add
`"paymentIntentsOf"` to the prototype list and `paymentIntentIds: ["p-1"]` to the input bag, and append:

```ts
  describe("paymentIntentsOf (order operations Part 1)", () => {
    it("asks for orders:read and reads every intent in one call", async () => {
      const { guard, asked } = guardAnswering(true);
      const getPaymentIntentsByIds = vi.fn().mockResolvedValue({ status: 200, body: [] });
      const target = controller(guard, {
        payments: { getPaymentIntentsByIds } as unknown as Pick<
          PaymentController,
          "getPaymentIntent" | "refundLifecycle" | "getPaymentIntentsByIds"
        >,
      });

      await target.paymentIntentsOf(staff, { tenantId: "t-1", paymentIntentIds: ["p-1", "p-2"] });

      expect(asked).toEqual(["orders:read"]);
      expect(getPaymentIntentsByIds).toHaveBeenCalledWith({ tenantId: "t-1", paymentIntentIds: ["p-1", "p-2"] });
    });
  });
```

`apps/admin/src/http/order-payment-intents.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Order } from "@platform/orders";
import type { WiredAdmin } from "../composition";
import { paymentIntentsOfOrders } from "./order-payment-intents";

const principal = { id: "staff-1", kind: "staff", roles: ["admin"] } as never;
const order = (paymentRef: string | undefined) => ({ paymentRef }) as unknown as Order;

function adminAnswering(response: { status: number; body: unknown }) {
  const paymentIntentsOf = vi.fn().mockResolvedValue(response);
  return { admin: { orders: { paymentIntentsOf } } as unknown as WiredAdmin, paymentIntentsOf };
}

describe("paymentIntentsOfOrders", () => {
  it("reads every linked payment of the page in ONE call, deduped, and indexes them by id", async () => {
    const intent = { id: "i-1", orderRef: "o-1" };
    const { admin, paymentIntentsOf } = adminAnswering({ status: 200, body: [intent] });

    const found = await paymentIntentsOfOrders(admin, principal, "t-1", [order("i-1"), order(undefined), order("i-1")]);

    expect(paymentIntentsOf).toHaveBeenCalledTimes(1);
    expect(paymentIntentsOf).toHaveBeenCalledWith(principal, { tenantId: "t-1", paymentIntentIds: ["i-1"] });
    expect(found.ok && found.byId.get("i-1")).toEqual(intent);
  });

  it("makes no call when no order has a linked payment", async () => {
    const { admin, paymentIntentsOf } = adminAnswering({ status: 200, body: [] });
    const found = await paymentIntentsOfOrders(admin, principal, "t-1", [order(undefined)]);
    expect(found.ok).toBe(true);
    expect(paymentIntentsOf).not.toHaveBeenCalled();
  });

  it("answers a failed read as the failure, never as 'no payments'", async () => {
    const { admin } = adminAnswering({ status: 503, body: { message: "down" } });
    const found = await paymentIntentsOfOrders(admin, principal, "t-1", [order("i-1")]);
    expect(found).toEqual({ ok: false, response: { status: 503, body: { message: "down" } } });
  });
});
```

Run both files — Expected: FAIL (`paymentIntentsOf` missing; module missing).

- [ ] **Step 8: Implement the admin side**

`orders.admin-controller.ts`: widen `payments` to
`Pick<PaymentController, "getPaymentIntent" | "refundLifecycle" | "getPaymentIntentsByIds">` (deps
interface and field) and add:

```ts
  /** The payment intents of a page of orders in ONE read (order operations Part 1). `orders:read`, like `paymentIntentOf`. */
  async paymentIntentsOf(
    principal: Principal,
    input: { readonly tenantId: string; readonly paymentIntentIds: readonly string[] },
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:read");
    if (denied) return denied;
    return this.payments.getPaymentIntentsByIds(input);
  }
```

`apps/admin/src/http/order-payment-intents.ts`:

```ts
import type { Principal } from "@platform/contracts";
import type { Order } from "@platform/orders";
import type { PaymentIntentSummary } from "@platform/payments";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";

/**
 * The linked payment of each order on a page, from ONE batched Payments read. A failed read is the
 * failure — never "no payments": export rows and packing slips print a cash-to-collect amount from it.
 */
export async function paymentIntentsOfOrders(
  admin: Pick<WiredAdmin, "orders">,
  principal: Principal,
  tenantId: string,
  orders: readonly Order[],
): Promise<
  | { readonly ok: true; readonly byId: ReadonlyMap<string, PaymentIntentSummary> }
  | { readonly ok: false; readonly response: AdminResponse }
> {
  const paymentIntentIds = [
    ...new Set(orders.flatMap((order) => (order.paymentRef === undefined ? [] : [order.paymentRef]))),
  ];
  if (paymentIntentIds.length === 0) return { ok: true, byId: new Map() };
  const response = await admin.orders.paymentIntentsOf(principal, { tenantId, paymentIntentIds });
  if (response.status !== 200) return { ok: false, response };
  const summaries = response.body as readonly PaymentIntentSummary[];
  return { ok: true, byId: new Map(summaries.map((summary) => [summary.id, summary])) };
}
```

Run: `pnpm --filter @platform/admin exec vitest run src/interfaces/orders.admin-controller.test.ts src/http/order-payment-intents.test.ts`, then
`pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin lint` — Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add services/payments/src apps/admin/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(payments): read many payment intents in one call

Adds GetPaymentIntentsByIds (summaries with the provider's settle-at-pay-time and
operator-confirmation capabilities, never the aggregate) and exposes it to the order
screens as OrdersAdminController.paymentIntentsOf under orders:read.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: POST /orders/bulk

Model tier: **most-capable** (money and stock actions; per-order skip rules must be exact).

**Files:**
- Create: `apps/admin/src/interfaces/bulk-order-actions.ts`
- Modify: `apps/admin/src/interfaces/orders.admin-controller.ts`, `orders.admin-controller.test.ts`
- Create: `apps/admin/src/http/order-bulk-actions.ts`, `apps/admin/src/http/order-bulk-actions.test.ts`
- Modify: `apps/admin/src/http/order-operations-routes.ts`
- Create: `apps/admin/src/http/order-operations-routes.test.ts`

**Interfaces:**
- Consumes: `archiveOrders/unarchiveOrders/listOrders/requestPaymentCapture/fulfillmentsOfOrders/paymentIntentsOf` (OrdersAdminController), `admin.fulfillment.create`, `admin.payments.confirmCodCollection`, `fulfillmentStatusesOf`, `paymentIntentsOfOrders` (Task 4), `isOpenOrder`, `derivePaymentStatus`, harness (Task 3).
- Produces:
  - `BULK_ORDER_ACTIONS = ["archive","unarchive","fulfill","capture_payments","mark_cod_collected"] as const`, `type BulkOrderAction`, `BULK_ACTION_PERMISSIONS: Readonly<Record<BulkOrderAction, Permission>>`.
  - `OrdersAdminController.authorizeBulkAction(principal, { action }): Promise<AdminResponse | null>`.
  - `BulkOrderResultDto = { orderId: string; outcome: "ok" | "skipped" | "failed"; reason?: string }`; skip reasons `already_archived | not_archived | order_not_open | fulfillment_already_open | payment_not_pending | payment_already_requested | not_cash_on_delivery`; fail reasons `not_found | unexpected_error | <the refusing call's message>`.
  - `BULK_RUNNERS: Readonly<Record<BulkOrderAction, BulkRunner>>`, `bulkOrdersBody` (zod discriminated union, each member `.strict()`, `orderIds` 1..50).
  - `POST /orders/bulk` → 200 `{ results: BulkOrderResultDto[] }`; 403 when the action's permission is missing; 422 on a bad body; `idempotent: true`.
  - **Part 2 extends additively:** append `"add_tags" | "remove_tags"` to `BULK_ORDER_ACTIONS`, their permission (`orders:tag`) to `BULK_ACTION_PERMISSIONS`, two members with `tags: z.array(...).min(1).max(20)` to `bulkOrdersBody`, two runners to `BULK_RUNNERS`. Nothing existing changes.

- [ ] **Step 1: Write the permission table and the failing controller test**

`apps/admin/src/interfaces/bulk-order-actions.ts`:

```ts
import type { Permission } from "@platform/contracts";

/** The bulk actions of the Orders list (spec §1.4). Part 2 appends add_tags / remove_tags. */
export const BULK_ORDER_ACTIONS = [
  "archive",
  "unarchive",
  "fulfill",
  "capture_payments",
  "mark_cod_collected",
] as const;
export type BulkOrderAction = (typeof BULK_ORDER_ACTIONS)[number];

/** The permission each action needs — checked ONCE, before any order is touched. Money stays admin-only. */
export const BULK_ACTION_PERMISSIONS: Readonly<Record<BulkOrderAction, Permission>> = {
  archive: "orders:archive",
  unarchive: "orders:archive",
  fulfill: "fulfillment:create",
  capture_payments: "orders:request_payment_capture",
  mark_cod_collected: "payments:confirm_cod_collection",
};
```

In `orders.admin-controller.test.ts`: add `"authorizeBulkAction"` to the prototype list and
`action: "archive"` to the input bag, and append:

```ts
  describe("authorizeBulkAction (order operations Part 1)", () => {
    it.each([
      ["archive", "orders:archive"],
      ["unarchive", "orders:archive"],
      ["fulfill", "fulfillment:create"],
      ["capture_payments", "orders:request_payment_capture"],
      ["mark_cod_collected", "payments:confirm_cod_collection"],
    ] as const)("%s asks for %s", async (action, permission) => {
      const { guard, asked } = guardAnswering(true);
      expect(await controller(guard).authorizeBulkAction(staff, { action })).toBeNull();
      expect(asked).toEqual([permission]);
    });

    it("answers 403 when the caller lacks the action's permission", async () => {
      const { guard } = guardAnswering(false);
      expect((await controller(guard).authorizeBulkAction(staff, { action: "archive" }))?.status).toBe(403);
    });
  });
```

Run: `pnpm --filter @platform/admin exec vitest run src/interfaces/orders.admin-controller.test.ts`
Expected: FAIL — `authorizeBulkAction is not a function`.

- [ ] **Step 2: Add `authorizeBulkAction`**

```ts
import { BULK_ACTION_PERMISSIONS, type BulkOrderAction } from "./bulk-order-actions";
// …
  /**
   * The permission of a bulk action, checked ONCE before any order is touched (spec §1.4): a viewer, or
   * an operator asking for an admin-only action, gets one 403 instead of fifty. Each order's own call is
   * still authorized by its controller. `null` = allowed.
   */
  async authorizeBulkAction(
    principal: Principal,
    input: { readonly action: BulkOrderAction },
  ): Promise<AdminResponse | null> {
    return this.guard.ensure(principal, BULK_ACTION_PERMISSIONS[input.action]);
  }
```

Run the controller test — Expected: PASS.

- [ ] **Step 3: Write the failing runner tests**

`apps/admin/src/http/order-bulk-actions.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Order } from "@platform/orders";
import type { PaymentIntentSummary } from "@platform/payments";
import { BULK_RUNNERS } from "./order-bulk-actions";

const principal = { id: "staff-1", kind: "staff", roles: ["admin"], tenantId: "t-1" } as never;

function order(id: string, events: readonly string[], paymentRef?: string): Order {
  return {
    id: { toString: () => id },
    history: events.map((type) => ({ type, occurredAt: new Date(0) })),
    paymentRef,
    items: [{ snapshot: { productId: `p-${id}` }, quantity: 2 }],
  } as unknown as Order;
}

const page = (orders: readonly Order[]) => ({
  status: 200,
  body: { items: orders, pageInfo: { hasNextPage: false, endCursor: null } },
});

function cod(overrides: Partial<PaymentIntentSummary> = {}): PaymentIntentSummary {
  return {
    id: "i-1",
    orderRef: "o-1",
    provider: "cod",
    status: "created",
    amountMinor: 45000,
    currency: "EGP",
    settlesAtPayTime: true,
    settledByOperatorConfirmation: true,
    ...overrides,
  };
}

function stubAdmin(orders: readonly Order[]) {
  return {
    orders: {
      listOrders: vi.fn().mockResolvedValue(page(orders)),
      fulfillmentsOfOrders: vi.fn().mockResolvedValue({ status: 200, body: [] }),
      requestPaymentCapture: vi.fn().mockResolvedValue({ status: 200, body: {} }),
      paymentIntentsOf: vi.fn().mockResolvedValue({ status: 200, body: [] }),
      archiveOrders: vi.fn(),
      unarchiveOrders: vi.fn(),
    },
    fulfillment: { create: vi.fn().mockResolvedValue({ status: 201, body: {} }) },
    payments: { confirmCodCollection: vi.fn().mockResolvedValue({ status: 200, body: {} }) },
  };
}

const run = (action: keyof typeof BULK_RUNNERS, admin: ReturnType<typeof stubAdmin>, orderIds: readonly string[]) =>
  BULK_RUNNERS[action]({ admin: admin as never, principal, tenantId: "t-1", orderIds });

describe("bulk fulfill (Fulfill items)", () => {
  it("opens a fulfillment for every item of each eligible order, and skips or fails the rest", async () => {
    const admin = stubAdmin([
      order("o-1", ["placed"]),
      order("o-2", ["placed"]),
      order("o-3", ["placed", "cancelled"]),
      order("o-5", ["placed"]),
      order("o-6", ["placed"]),
    ]);
    admin.orders.fulfillmentsOfOrders.mockResolvedValue({
      status: 200,
      body: [{ orderRef: "o-2", status: { value: "picking_started" } }],
    });
    admin.fulfillment.create.mockImplementation(async (_p: unknown, input: { orderRef: string }) => {
      if (input.orderRef === "o-5") return { status: 409, body: { message: "Out of stock" } };
      if (input.orderRef === "o-6") throw new Error("boom");
      return { status: 201, body: {} };
    });

    const outcome = await run("fulfill", admin, ["o-1", "o-2", "o-3", "o-4", "o-5", "o-6"]);

    expect(outcome).toEqual({
      ok: true,
      results: [
        { orderId: "o-1", outcome: "ok" },
        { orderId: "o-2", outcome: "skipped", reason: "fulfillment_already_open" },
        { orderId: "o-3", outcome: "skipped", reason: "order_not_open" },
        { orderId: "o-4", outcome: "failed", reason: "not_found" },
        { orderId: "o-5", outcome: "failed", reason: "Out of stock" },
        { orderId: "o-6", outcome: "failed", reason: "unexpected_error" },
      ],
    });
    expect(admin.orders.listOrders).toHaveBeenCalledTimes(1);
    expect(admin.orders.listOrders).toHaveBeenCalledWith(principal, {
      tenantId: "t-1",
      ids: ["o-1", "o-2", "o-3", "o-4", "o-5", "o-6"],
      first: 6,
    });
    expect(admin.fulfillment.create).toHaveBeenCalledWith(principal, {
      tenantId: "t-1",
      orderRef: "o-1",
      items: [{ productRef: "p-o-1", quantity: 2 }],
    });
  });

  it("answers a failed list read as the response, touching nothing", async () => {
    const admin = stubAdmin([]);
    admin.orders.listOrders.mockResolvedValue({ status: 500, body: {} });
    expect(await run("fulfill", admin, ["o-1"])).toEqual({ ok: false, response: { status: 500, body: {} } });
    expect(admin.fulfillment.create).not.toHaveBeenCalled();
  });
});

describe("bulk capture_payments (Capture payments)", () => {
  it("requests payment only for open, pending orders with no linked payment", async () => {
    const admin = stubAdmin([
      order("o-1", ["placed"]),
      order("o-2", ["placed", "paid"]),
      order("o-3", ["created", "confirmed", "awaiting_payment", "payment_requested"], "i-3"),
      order("o-4", ["placed", "cancelled"]),
    ]);

    const outcome = await run("capture_payments", admin, ["o-1", "o-2", "o-3", "o-4"]);

    expect(outcome.ok && outcome.results).toEqual([
      { orderId: "o-1", outcome: "ok" },
      { orderId: "o-2", outcome: "skipped", reason: "payment_not_pending" },
      { orderId: "o-3", outcome: "skipped", reason: "payment_already_requested" },
      { orderId: "o-4", outcome: "skipped", reason: "order_not_open" },
    ]);
    expect(admin.orders.requestPaymentCapture).toHaveBeenCalledTimes(1);
    expect(admin.orders.requestPaymentCapture).toHaveBeenCalledWith(principal, { tenantId: "t-1", orderId: "o-1" });
  });
});

describe("bulk mark_cod_collected (Mark cash as received)", () => {
  const PENDING_COD = ["created", "confirmed", "awaiting_payment", "payment_requested"];

  it("settles each pending cash-on-delivery payment for the amount read from the intent", async () => {
    const admin = stubAdmin([
      order("o-1", PENDING_COD, "i-1"),
      order("o-2", PENDING_COD, "i-2"),
      order("o-3", PENDING_COD, "i-3"),
      order("o-4", PENDING_COD, "i-4"),
      order("o-5", ["placed", "paid"], "i-5"),
    ]);
    admin.orders.paymentIntentsOf.mockResolvedValue({
      status: 200,
      body: [
        cod(),
        cod({ id: "i-2", orderRef: "o-2", provider: "stripe", settlesAtPayTime: false, settledByOperatorConfirmation: false }),
        cod({ id: "i-3", orderRef: "o-3", status: "captured" }),
        cod({ id: "i-4", orderRef: "someone-else" }),
        cod({ id: "i-5", orderRef: "o-5" }),
      ],
    });

    const outcome = await run("mark_cod_collected", admin, ["o-1", "o-2", "o-3", "o-4", "o-5"]);

    expect(outcome.ok && outcome.results).toEqual([
      { orderId: "o-1", outcome: "ok" },
      { orderId: "o-2", outcome: "skipped", reason: "not_cash_on_delivery" },
      { orderId: "o-3", outcome: "skipped", reason: "not_cash_on_delivery" },
      { orderId: "o-4", outcome: "skipped", reason: "not_cash_on_delivery" },
      { orderId: "o-5", outcome: "skipped", reason: "payment_not_pending" },
    ]);
    expect(admin.orders.paymentIntentsOf).toHaveBeenCalledTimes(1);
    expect(admin.payments.confirmCodCollection).toHaveBeenCalledTimes(1);
    expect(admin.payments.confirmCodCollection).toHaveBeenCalledWith(principal, {
      tenantId: "t-1",
      paymentIntentId: "i-1",
      collectedAmountMinor: 45000,
      currency: "EGP",
    });
  });

  it("settles nothing when the payments read fails", async () => {
    const admin = stubAdmin([order("o-1", PENDING_COD, "i-1")]);
    admin.orders.paymentIntentsOf.mockResolvedValue({ status: 503, body: {} });
    expect((await run("mark_cod_collected", admin, ["o-1"])).ok).toBe(false);
    expect(admin.payments.confirmCodCollection).not.toHaveBeenCalled();
  });
});

describe("bulk archive / unarchive", () => {
  it("maps the use case's outcomes and passes the actor", async () => {
    const admin = stubAdmin([]);
    admin.orders.archiveOrders.mockResolvedValue({
      status: 200,
      body: {
        results: [
          { orderId: "o-1", outcome: "changed", archivedAt: new Date(0) },
          { orderId: "o-2", outcome: "unchanged", archivedAt: new Date(0) },
          { orderId: "o-3", outcome: "not_found", archivedAt: null },
        ],
      },
    });
    admin.orders.unarchiveOrders.mockResolvedValue({
      status: 200,
      body: { results: [{ orderId: "o-1", outcome: "unchanged", archivedAt: null }] },
    });

    const archived = await run("archive", admin, ["o-1", "o-2", "o-3"]);
    const unarchived = await run("unarchive", admin, ["o-1"]);

    expect(archived.ok && archived.results).toEqual([
      { orderId: "o-1", outcome: "ok" },
      { orderId: "o-2", outcome: "skipped", reason: "already_archived" },
      { orderId: "o-3", outcome: "failed", reason: "not_found" },
    ]);
    expect(unarchived.ok && unarchived.results).toEqual([
      { orderId: "o-1", outcome: "skipped", reason: "not_archived" },
    ]);
    expect(admin.orders.archiveOrders).toHaveBeenCalledWith(principal, {
      tenantId: "t-1",
      orderIds: ["o-1", "o-2", "o-3"],
      actorRef: "staff-1",
    });
  });
});
```

Run: `pnpm --filter @platform/admin exec vitest run src/http/order-bulk-actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the runners**

`apps/admin/src/http/order-bulk-actions.ts`:

```ts
import type { Principal } from "@platform/contracts";
import { derivePaymentStatus, isOpenOrder, type ArchiveOrdersOutput, type Order } from "@platform/orders";
import type { Paginated } from "@platform/types";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import type { BulkOrderAction } from "../interfaces/bulk-order-actions";
import { fulfillmentStatusesOf } from "./fulfillment-statuses-of";
import { paymentIntentsOfOrders } from "./order-payment-intents";

export type BulkSkipReason =
  | "already_archived"
  | "not_archived"
  | "order_not_open"
  | "fulfillment_already_open"
  | "payment_not_pending"
  | "payment_already_requested"
  | "not_cash_on_delivery";

/** One order's result: ok, skipped (with why) or failed (with the refusing call's message). */
export interface BulkOrderResultDto {
  readonly orderId: string;
  readonly outcome: "ok" | "skipped" | "failed";
  readonly reason?: string;
}

type BulkAdmin = Pick<WiredAdmin, "orders" | "fulfillment" | "payments">;

export interface BulkContext {
  readonly admin: BulkAdmin;
  readonly principal: Principal;
  readonly tenantId: string;
  /** Deduped, 1..50. */
  readonly orderIds: readonly string[];
}

export type BulkOutcome =
  | { readonly ok: true; readonly results: readonly BulkOrderResultDto[] }
  | { readonly ok: false; readonly response: AdminResponse };

export type BulkRunner = (context: BulkContext) => Promise<BulkOutcome>;

const done = (orderId: string): BulkOrderResultDto => ({ orderId, outcome: "ok" });
const skipped = (orderId: string, reason: BulkSkipReason): BulkOrderResultDto => ({
  orderId,
  outcome: "skipped",
  reason,
});
const failed = (orderId: string, reason: string): BulkOrderResultDto => ({
  orderId,
  outcome: "failed",
  reason,
});

const succeeded = (response: AdminResponse) => response.status >= 200 && response.status < 300;

/** The refusing call's message (what the merchant reads in the details list), else its status. */
export function reasonOf(response: AdminResponse): string {
  const body = response.body as { readonly message?: unknown } | null;
  return typeof body?.message === "string" ? body.message : `status ${response.status}`;
}

/** One call per order, one after another (each its own transaction); a throw fails that order only. */
async function perOrder(
  orderIds: readonly string[],
  run: (orderId: string) => Promise<BulkOrderResultDto>,
): Promise<BulkOrderResultDto[]> {
  const results: BulkOrderResultDto[] = [];
  for (const orderId of orderIds) {
    try {
      results.push(await run(orderId));
    } catch {
      results.push(failed(orderId, "unexpected_error"));
    }
  }
  return results;
}

/** The selected orders of this shop, in ONE list read; ids it does not have are simply absent. */
async function loadOrders(
  context: BulkContext,
): Promise<
  { readonly ok: true; readonly byId: ReadonlyMap<string, Order> } | { readonly ok: false; readonly response: AdminResponse }
> {
  const response = await context.admin.orders.listOrders(context.principal, {
    tenantId: context.tenantId,
    ids: context.orderIds,
    first: context.orderIds.length,
  });
  if (response.status !== 200) return { ok: false, response };
  const page = response.body as Paginated<Order>;
  return { ok: true, byId: new Map(page.items.map((order) => [order.id.toString(), order])) };
}

function archiveRunner(archive: boolean): BulkRunner {
  return async ({ admin, principal, tenantId, orderIds }) => {
    const input = { tenantId, orderIds, actorRef: principal.id };
    const response = archive
      ? await admin.orders.archiveOrders(principal, input)
      : await admin.orders.unarchiveOrders(principal, input);
    if (response.status !== 200) return { ok: false, response };
    return {
      ok: true,
      results: (response.body as ArchiveOrdersOutput).results.map((result) => {
        if (result.outcome === "changed") return done(result.orderId);
        if (result.outcome === "unchanged") {
          return skipped(result.orderId, archive ? "already_archived" : "not_archived");
        }
        return failed(result.orderId, "not_found");
      }),
    };
  };
}

/** "Fulfill items": the order page's button — open a fulfillment for every item (spec decision 7). */
const fulfillRunner: BulkRunner = async (context) => {
  const loaded = await loadOrders(context);
  if (!loaded.ok) return loaded;
  const statuses = await fulfillmentStatusesOf(
    context.admin,
    context.principal,
    context.tenantId,
    [...loaded.byId.keys()],
  );
  if (!statuses.ok) return { ok: false, response: statuses.response };
  const results = await perOrder(context.orderIds, async (orderId) => {
    const order = loaded.byId.get(orderId);
    if (order === undefined) return failed(orderId, "not_found");
    if (!isOpenOrder(order.history)) return skipped(orderId, "order_not_open");
    if ((statuses.byOrder.get(orderId) ?? "unfulfilled") !== "unfulfilled") {
      return skipped(orderId, "fulfillment_already_open");
    }
    const response = await context.admin.fulfillment.create(context.principal, {
      tenantId: context.tenantId,
      orderRef: orderId,
      items: order.items.map((item) => ({
        productRef: item.snapshot.productId,
        quantity: item.quantity,
      })),
    });
    return succeeded(response) ? done(orderId) : failed(orderId, reasonOf(response));
  });
  return { ok: true, results };
};

/**
 * "Capture payments": `requestPaymentCapture`, the order page's call. It only acts on an order with no
 * linked payment — checkout orders (cash on delivery, card) link theirs at checkout, where the call
 * would silently do nothing — so those are skipped as `payment_already_requested`.
 */
const capturePaymentsRunner: BulkRunner = async (context) => {
  const loaded = await loadOrders(context);
  if (!loaded.ok) return loaded;
  const results = await perOrder(context.orderIds, async (orderId) => {
    const order = loaded.byId.get(orderId);
    if (order === undefined) return failed(orderId, "not_found");
    if (!isOpenOrder(order.history)) return skipped(orderId, "order_not_open");
    if (derivePaymentStatus(order.history) !== "pending") return skipped(orderId, "payment_not_pending");
    if (order.paymentRef !== undefined) return skipped(orderId, "payment_already_requested");
    const response = await context.admin.orders.requestPaymentCapture(context.principal, {
      tenantId: context.tenantId,
      orderId,
    });
    return succeeded(response) ? done(orderId) : failed(orderId, reasonOf(response));
  });
  return { ok: true, results };
};

/** Intent statuses after which a collection can no longer be confirmed. */
const NOT_COLLECTIBLE = new Set([
  "captured",
  "refunded",
  "partially_refunded",
  "cancelled",
  "expired",
  "closed",
  "failed",
]);

/**
 * "Mark cash as received": `ConfirmCodCollection` for each pending cash-on-delivery payment of THESE
 * orders, with the amount read from the intent server-side — exactly what `confirmCodCollectionAction`
 * does for one order. Eligibility is by capability (`settledByOperatorConfirmation`), not by name.
 */
const markCodCollectedRunner: BulkRunner = async (context) => {
  const loaded = await loadOrders(context);
  if (!loaded.ok) return loaded;
  const intents = await paymentIntentsOfOrders(
    context.admin,
    context.principal,
    context.tenantId,
    [...loaded.byId.values()],
  );
  if (!intents.ok) return intents;
  const results = await perOrder(context.orderIds, async (orderId) => {
    const order = loaded.byId.get(orderId);
    if (order === undefined) return failed(orderId, "not_found");
    if (derivePaymentStatus(order.history) !== "pending") return skipped(orderId, "payment_not_pending");
    const intent = order.paymentRef === undefined ? undefined : intents.byId.get(order.paymentRef);
    if (
      intent === undefined ||
      !intent.settledByOperatorConfirmation ||
      intent.orderRef !== orderId ||
      NOT_COLLECTIBLE.has(intent.status)
    ) {
      return skipped(orderId, "not_cash_on_delivery");
    }
    const response = await context.admin.payments.confirmCodCollection(context.principal, {
      tenantId: context.tenantId,
      paymentIntentId: intent.id,
      collectedAmountMinor: intent.amountMinor,
      currency: intent.currency,
    });
    return succeeded(response) ? done(orderId) : failed(orderId, reasonOf(response));
  });
  return { ok: true, results };
};

/** Each bulk action's runner. Part 2 adds add_tags / remove_tags here. */
export const BULK_RUNNERS: Readonly<Record<BulkOrderAction, BulkRunner>> = {
  archive: archiveRunner(true),
  unarchive: archiveRunner(false),
  fulfill: fulfillRunner,
  capture_payments: capturePaymentsRunner,
  mark_cod_collected: markCodCollectedRunner,
};
```

Run the runner test — Expected: PASS.

- [ ] **Step 5: Write the failing route test**

`apps/admin/src/http/order-operations-routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { WiredAdmin } from "../composition";
import { adminRoutes } from "./admin-routes";
import { bulkOrdersBody } from "./order-operations-routes";
import {
  adminStaff,
  buildOrdersAdmin,
  callRoute,
  operatorStaff,
  placeTestOrder,
  viewerStaff,
} from "./testing/orders-harness";

interface BulkBody {
  readonly results: readonly { readonly orderId: string; readonly outcome: string; readonly reason?: string }[];
}

const bulk = (admin: WiredAdmin, body: unknown, principal = adminStaff) =>
  callRoute(adminRoutes(admin), "POST", "/orders/bulk", { body }, principal);

async function archivedIds(admin: WiredAdmin): Promise<string[]> {
  const list = await callRoute(adminRoutes(admin), "GET", "/orders", { query: { view: "archived" } });
  return (list.body as { items: { id: string }[] }).items.map((item) => item.id).sort();
}

describe("POST /orders/bulk body (order operations Part 1)", () => {
  const ids = (count: number) => Array.from({ length: count }, (_, i) => `o-${i}`);

  it("accepts 1 to 50 ids for each known action", () => {
    for (const action of ["archive", "unarchive", "fulfill", "capture_payments", "mark_cod_collected"]) {
      expect(bulkOrdersBody.safeParse({ action, orderIds: ids(50) }).success, action).toBe(true);
    }
  });

  it("rejects 51 ids, no ids, an unknown action and unknown keys (strict)", () => {
    expect(bulkOrdersBody.safeParse({ action: "archive", orderIds: ids(51) }).success).toBe(false);
    expect(bulkOrdersBody.safeParse({ action: "archive", orderIds: [] }).success).toBe(false);
    expect(bulkOrdersBody.safeParse({ action: "cancel", orderIds: ids(1) }).success).toBe(false);
    expect(bulkOrdersBody.safeParse({ action: "archive", orderIds: ids(1), tags: ["vip"] }).success).toBe(false);
  });
});

describe("POST /orders/bulk on the real in-memory composition", () => {
  it("answers a result per order — ok, skipped and failed mixed — and collapses duplicate ids", async () => {
    const admin = buildOrdersAdmin();
    const fresh = await placeTestOrder(admin);
    const already = await placeTestOrder(admin);
    await bulk(admin, { action: "archive", orderIds: [already] });

    const response = await bulk(admin, {
      action: "archive",
      orderIds: [fresh, fresh, already, "00000000-0000-7000-8000-0000000000ff"],
    });

    expect(response.status).toBe(200);
    expect((response.body as BulkBody).results).toEqual([
      { orderId: fresh, outcome: "ok" },
      { orderId: already, outcome: "skipped", reason: "already_archived" },
      { orderId: "00000000-0000-7000-8000-0000000000ff", outcome: "failed", reason: "not_found" },
    ]);
    expect(await archivedIds(admin)).toEqual([fresh, already].sort());
  });

  it("opens fulfillments through the order page's call", async () => {
    const admin = buildOrdersAdmin();
    const orderId = await placeTestOrder(admin);

    const response = await bulk(admin, { action: "fulfill", orderIds: [orderId] });
    const again = await bulk(admin, { action: "fulfill", orderIds: [orderId] });

    expect((response.body as BulkBody).results).toEqual([{ orderId, outcome: "ok" }]);
    expect((again.body as BulkBody).results).toEqual([
      { orderId, outcome: "skipped", reason: "fulfillment_already_open" },
    ]);
  });

  it("refuses a viewer before touching any order", async () => {
    const admin = buildOrdersAdmin();
    const orderId = await placeTestOrder(admin);
    expect((await bulk(admin, { action: "archive", orderIds: [orderId] }, viewerStaff)).status).toBe(403);
    expect(await archivedIds(admin)).toEqual([]);
  });

  it("checks each action's own permission: an operator archives but cannot mark cash received", async () => {
    const admin = buildOrdersAdmin();
    const orderId = await placeTestOrder(admin);
    expect((await bulk(admin, { action: "mark_cod_collected", orderIds: [orderId] }, operatorStaff)).status).toBe(403);
    expect((await bulk(admin, { action: "archive", orderIds: [orderId] }, operatorStaff)).status).toBe(200);
  });

  it("is idempotent by key at the transport", () => {
    const route = adminRoutes(buildOrdersAdmin()).find((r) => r.method === "POST" && r.path === "/orders/bulk");
    expect(route?.idempotent).toBe(true);
  });
});
```

Run: `pnpm --filter @platform/admin exec vitest run src/http/order-operations-routes.test.ts`
Expected: FAIL — `bulkOrdersBody` not exported.

- [ ] **Step 6: Add the bulk route**

In `apps/admin/src/http/order-operations-routes.ts` add the imports
`import { BULK_RUNNERS } from "./order-bulk-actions";` and
`import type { BulkOrderAction } from "../interfaces/bulk-order-actions";`, then:

```ts
const bulkOrderIds = z.array(z.string().min(1)).min(1).max(50);

function bulkAction<A extends BulkOrderAction>(action: A) {
  return z.object({ action: z.literal(action), orderIds: bulkOrderIds }).strict();
}

/** One strict member per action, so Part 2 can add `tags` to its own two members only. */
export const bulkOrdersBody = z.discriminatedUnion("action", [
  bulkAction("archive"),
  bulkAction("unarchive"),
  bulkAction("fulfill"),
  bulkAction("capture_payments"),
  bulkAction("mark_cod_collected"),
]);
```

and in the returned array:

```ts
    defineRoute({
      method: "POST",
      path: "/orders/bulk",
      version: 1,
      // The route's own gate only says "works with orders"; the ACTION's permission is checked first,
      // inside (BULK_ACTION_PERMISSIONS), before any order is touched.
      permission: "orders:read",
      idempotent: true,
      summary:
        "Run one action on up to 50 orders — each order on its own, through the single-order call — and answer a result per order",
      schema: { body: bulkOrdersBody },
      handle: async ({ body, context }): Promise<AdminResponse> => {
        const denied = await admin.orders.authorizeBulkAction(context.principal, { action: body.action });
        if (denied) return denied;
        const outcome = await BULK_RUNNERS[body.action]({
          admin,
          principal: context.principal,
          tenantId: context.tenantId,
          orderIds: [...new Set(body.orderIds)],
        });
        if (!outcome.ok) return outcome.response;
        return { status: 200, body: { results: outcome.results } };
      },
    }),
```

Run the route test — Expected: PASS.

- [ ] **Step 7: Run the admin suite, typecheck, lint**

Run: `pnpm --filter @platform/admin test && pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin): bulk order actions

POST /orders/bulk runs archive, unarchive, fulfill, capture payments or mark cash received
on up to 50 orders, each through the single-order call, and answers ok/skipped/failed per
order. The action's own permission is checked once first; cash stays admin-only.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Export rows and packing-slip data

Model tier: **standard**.

**Files:**
- Create: `apps/admin/src/http/order-export-rows.ts`, `apps/admin/src/http/order-export-rows.test.ts`
- Modify: `apps/admin/src/http/order-customer-names.ts`, `order-customer-names.test.ts`
- Modify: `apps/admin/src/http/order-operations-routes.ts`, `order-operations-routes.test.ts`

**Interfaces:**
- Consumes: `listOrdersForView`, `orderAnnotationsFor`, `ORDER_VIEWS`, `ORDER_STATUS_VALUES` (Task 3), `paymentIntentsOfOrders` (Task 4), `customerNameOf`, `customerNamesFor`, `derivePaymentStatus`.
- Produces:
  - `OrderExportRowDto` (exactly the spec's shape; `customerName: string | null`, `tags: readonly string[]` = `[]`, `note: string | null` = `null` in Part 1), `PackingSlipDto = { orderId; orderNumber; createdAt; shipTo: { name: string | null; phone: string | null; line1; line2: string | null; city; province: string | null; postalCode; country }; lines: { title; variantTitle: string | null; sku: string | null; quantity }[]; note: string | null; codAmountMinor: number; currency }`.
  - `codAmountOf(order, intent): number`, `toOrderExportRowDto(order, facts: OrderExportFacts)`, `toPackingSlipDto(order, facts: PackingSlipFacts)`.
  - `customerContactsFor(admin, principal, tenantId, orders): Promise<ReadonlyMap<string, CustomerContact>>`, `customerLabelsOf(contacts): ReadonlyMap<string, string>`.
  - `GET /orders/export-rows` (`orders:export`; query `view`, `search`, `status`, `ids` comma list ≤ 50, `createdFrom`, `createdTo` ISO instants (from < to), `first` ≤ 250, `after`) → `{ items: OrderExportRowDto[], pageInfo }`.
  - `GET /orders/packing-slips?ids=` (`orders:read`, 1..50 ids) → `{ slips: PackingSlipDto[] }` in the requested order, unknown ids left out.
  - **Part 2 extends additively:** `OrderExportFacts.annotations` already carries `OrderAnnotations`; Part 2 fills `tags`/`note` from it in the two mappers and adds `tag` to `exportRowsQuery`. No signature changes.

- [ ] **Step 1: Write the failing mapper tests**

`apps/admin/src/http/order-export-rows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CustomerContact } from "@platform/identity";
import type { Order } from "@platform/orders";
import type { PaymentIntentSummary } from "@platform/payments";
import { codAmountOf, toOrderExportRowDto, toPackingSlipDto } from "./order-export-rows";

const PLACED_AT = new Date("2026-10-18T09:05:00.000Z");
const PENDING = [
  { type: "created", occurredAt: PLACED_AT },
  { type: "payment_requested", occurredAt: PLACED_AT },
];

function stubOrder(overrides: Record<string, unknown> = {}): Order {
  return {
    id: { toString: () => "o-1" },
    orderNumber: { value: "1001" },
    customerRef: "c-1",
    currency: "EGP",
    history: PENDING,
    paymentRef: "i-1",
    shippingAddress: {
      recipientName: "Mona Ali",
      phone: "+201012345678",
      line1: "1 Nile St",
      line2: "Apt 4",
      city: "Cairo",
      province: "EG-C",
      postalCode: "11511",
      country: "EG",
    },
    items: [
      { snapshot: { name: "T-shirt", variantTitle: "L", sku: "SKU-1" }, quantity: 2, lineTotal: { amountMinor: 40000 } },
      { snapshot: { name: "Cap", variantTitle: undefined, sku: undefined }, quantity: 1, lineTotal: { amountMinor: 5000 } },
    ],
    totals: { subtotalMinor: 45000, shippingMinor: 5000, discountMinor: 0, totalMinor: 50000, shippingMethod: "standard" },
    totalAmount: () => ({ amountMinor: 50000 }),
    ...overrides,
  } as unknown as Order;
}

const cod: PaymentIntentSummary = {
  id: "i-1",
  orderRef: "o-1",
  provider: "cod",
  status: "created",
  amountMinor: 50000,
  currency: "EGP",
  settlesAtPayTime: true,
  settledByOperatorConfirmation: true,
};
const card: PaymentIntentSummary = { ...cod, provider: "stripe", settlesAtPayTime: false, settledByOperatorConfirmation: false };
const contact: CustomerContact = { id: "c-1", name: "Mona", email: "mona@example.com", isGuest: false };

describe("codAmountOf (spec §1.4)", () => {
  it("is the total while a cash-on-delivery payment is pending, else 0", () => {
    expect(codAmountOf(stubOrder(), cod)).toBe(50000);
    expect(codAmountOf(stubOrder(), card)).toBe(0);
    expect(codAmountOf(stubOrder(), undefined)).toBe(0);
    expect(
      codAmountOf(stubOrder({ history: [...PENDING, { type: "payment_received", occurredAt: PLACED_AT }] }), cod),
    ).toBe(0);
  });
});

describe("toOrderExportRowDto", () => {
  it("maps one order to one courier row", () => {
    expect(
      toOrderExportRowDto(stubOrder(), {
        fulfillmentStatus: "unfulfilled",
        contact,
        customerLabels: new Map([["c-1", "Mona"]]),
        intent: cod,
        annotations: { archivedAt: null },
      }),
    ).toEqual({
      orderId: "o-1",
      orderNumber: "1001",
      createdAt: "2026-10-18T09:05:00.000Z",
      customerName: "Mona Ali",
      email: "mona@example.com",
      phone: "+201012345678",
      line1: "1 Nile St",
      line2: "Apt 4",
      city: "Cairo",
      province: "EG-C",
      country: "EG",
      items: [
        { title: "T-shirt", variantTitle: "L", sku: "SKU-1", quantity: 2 },
        { title: "Cap", variantTitle: null, sku: null, quantity: 1 },
      ],
      itemCount: 3,
      subtotalMinor: 45000,
      shippingMinor: 5000,
      discountMinor: 0,
      totalMinor: 50000,
      codAmountMinor: 50000,
      currency: "EGP",
      paymentStatus: "pending",
      paymentProvider: "cod",
      fulfillmentStatus: "unfulfilled",
      shippingMethod: "standard",
      tags: [],
      note: null,
    });
  });

  it("reads an order placed before totals were captured from its lines", () => {
    const row = toOrderExportRowDto(stubOrder({ totals: undefined, paymentRef: undefined }), {
      fulfillmentStatus: "unfulfilled",
      contact: undefined,
      customerLabels: new Map(),
      intent: undefined,
      annotations: undefined,
    });
    expect(row).toMatchObject({
      subtotalMinor: 45000,
      shippingMinor: 0,
      discountMinor: 0,
      totalMinor: 50000,
      shippingMethod: null,
      paymentProvider: null,
      email: null,
    });
  });

  it("names the customer by label when the shopper typed no recipient", () => {
    const row = toOrderExportRowDto(
      stubOrder({ shippingAddress: { line1: "1 Nile St", city: "Cairo", postalCode: "", country: "EG" } }),
      { fulfillmentStatus: "unfulfilled", contact, customerLabels: new Map([["c-1", "Mona"]]), intent: undefined, annotations: undefined },
    );
    expect(row).toMatchObject({ customerName: "Mona", phone: null, line2: null, province: null });
  });
});

describe("toPackingSlipDto", () => {
  it("carries the ship-to block, the lines and the cash to collect", () => {
    expect(toPackingSlipDto(stubOrder(), { customerLabels: new Map(), intent: cod, annotations: undefined })).toEqual({
      orderId: "o-1",
      orderNumber: "1001",
      createdAt: "2026-10-18T09:05:00.000Z",
      shipTo: {
        name: "Mona Ali",
        phone: "+201012345678",
        line1: "1 Nile St",
        line2: "Apt 4",
        city: "Cairo",
        province: "EG-C",
        postalCode: "11511",
        country: "EG",
      },
      lines: [
        { title: "T-shirt", variantTitle: "L", sku: "SKU-1", quantity: 2 },
        { title: "Cap", variantTitle: null, sku: null, quantity: 1 },
      ],
      note: null,
      codAmountMinor: 50000,
      currency: "EGP",
    });
  });
});
```

Run: `pnpm --filter @platform/admin exec vitest run src/http/order-export-rows.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement the mappers**

`apps/admin/src/http/order-export-rows.ts`:

```ts
import type { CustomerContact } from "@platform/identity";
import {
  derivePaymentStatus,
  type Order,
  type OrderAnnotations,
  type OrderFulfillmentStatus,
  type OrderPaymentStatus,
} from "@platform/orders";
import type { PaymentIntentSummary } from "@platform/payments";
import { UnexpectedError } from "@platform/utils";
import { customerNameOf } from "./order-customer-names";

export interface OrderExportLineDto {
  readonly title: string;
  readonly variantTitle: string | null;
  readonly sku: string | null;
  readonly quantity: number;
}

/** One row per order — what a courier upload needs (spec §1.4, decision 12). */
export interface OrderExportRowDto {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly createdAt: string;
  readonly customerName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  /** ISO 3166-2; admin-web prints the `packages/regions` name. */
  readonly province: string | null;
  readonly country: string;
  readonly items: readonly OrderExportLineDto[];
  readonly itemCount: number;
  readonly subtotalMinor: number;
  readonly shippingMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  /** The total while a cash-on-delivery payment is pending, else 0 — what the courier collects. */
  readonly codAmountMinor: number;
  readonly currency: string;
  readonly paymentStatus: OrderPaymentStatus;
  readonly paymentProvider: string | null;
  readonly fulfillmentStatus: OrderFulfillmentStatus;
  readonly shippingMethod: string | null;
  /** Part 2 fills these; [] / null before it. */
  readonly tags: readonly string[];
  readonly note: string | null;
}

export interface PackingSlipDto {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly createdAt: string;
  readonly shipTo: {
    readonly name: string | null;
    readonly phone: string | null;
    readonly line1: string;
    readonly line2: string | null;
    readonly city: string;
    readonly province: string | null;
    readonly postalCode: string;
    readonly country: string;
  };
  readonly lines: readonly OrderExportLineDto[];
  /** Part 2 fills it; null before it. */
  readonly note: string | null;
  readonly codAmountMinor: number;
  readonly currency: string;
}

export interface OrderExportFacts {
  readonly fulfillmentStatus: OrderFulfillmentStatus;
  readonly contact: CustomerContact | undefined;
  readonly customerLabels: ReadonlyMap<string, string>;
  readonly intent: PaymentIntentSummary | undefined;
  /** Part 2 reads note and tags from here. */
  readonly annotations: OrderAnnotations | undefined;
}

export interface PackingSlipFacts {
  readonly customerLabels: ReadonlyMap<string, string>;
  readonly intent: PaymentIntentSummary | undefined;
  readonly annotations: OrderAnnotations | undefined;
}

/** What the courier collects: the order total while a payment settled only by an operator's confirmation (cash on delivery) is pending. */
export function codAmountOf(order: Order, intent: PaymentIntentSummary | undefined): number {
  return derivePaymentStatus(order.history) === "pending" && intent?.settledByOperatorConfirmation === true
    ? order.totalAmount().amountMinor
    : 0;
}

function placedAt(order: Order): string {
  const first = order.history[0];
  if (first === undefined) {
    throw new UnexpectedError(`Corrupt order data: order ${order.id.toString()} has no history`);
  }
  return first.occurredAt.toISOString();
}

function linesOf(order: Order): readonly OrderExportLineDto[] {
  return order.items.map((item) => ({
    title: item.snapshot.name,
    variantTitle: item.snapshot.variantTitle ?? null,
    sku: item.snapshot.sku ?? null,
    quantity: item.quantity,
  }));
}

export function toOrderExportRowDto(order: Order, facts: OrderExportFacts): OrderExportRowDto {
  const address = order.shippingAddress;
  const totals = order.totals;
  return {
    orderId: order.id.toString(),
    orderNumber: order.orderNumber.value,
    createdAt: placedAt(order),
    customerName: customerNameOf(order, facts.customerLabels),
    email: facts.contact?.email ?? null,
    phone: address.phone ?? null,
    line1: address.line1,
    line2: address.line2 ?? null,
    city: address.city,
    province: address.province ?? null,
    country: address.country,
    items: linesOf(order),
    itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalMinor:
      totals?.subtotalMinor ?? order.items.reduce((sum, item) => sum + item.lineTotal.amountMinor, 0),
    shippingMinor: totals?.shippingMinor ?? 0,
    discountMinor: totals?.discountMinor ?? 0,
    totalMinor: order.totalAmount().amountMinor,
    codAmountMinor: codAmountOf(order, facts.intent),
    currency: order.currency,
    paymentStatus: derivePaymentStatus(order.history),
    paymentProvider: facts.intent?.provider ?? null,
    fulfillmentStatus: facts.fulfillmentStatus,
    shippingMethod: totals?.shippingMethod ?? null,
    tags: [],
    note: null,
  };
}

export function toPackingSlipDto(order: Order, facts: PackingSlipFacts): PackingSlipDto {
  const address = order.shippingAddress;
  return {
    orderId: order.id.toString(),
    orderNumber: order.orderNumber.value,
    createdAt: placedAt(order),
    shipTo: {
      name: customerNameOf(order, facts.customerLabels),
      phone: address.phone ?? null,
      line1: address.line1,
      line2: address.line2 ?? null,
      city: address.city,
      province: address.province ?? null,
      postalCode: address.postalCode,
      country: address.country,
    },
    lines: linesOf(order),
    note: null,
    codAmountMinor: codAmountOf(order, facts.intent),
    currency: order.currency,
  };
}
```

Run the mapper test — Expected: PASS.

- [ ] **Step 3: Add the contacts read (email for the export)**

Append to `apps/admin/src/http/order-customer-names.test.ts`:

```ts
describe("customerContactsFor / customerLabelsOf (export emails)", () => {
  it("reads every order's customer in ONE call and labels guests by email", async () => {
    const contacts = [
      { id: "c-1", name: "Alice", email: "a@example.com", isGuest: false },
      { id: "c-2", name: "guest", email: "g@example.com", isGuest: true },
    ];
    const { admin, contactsOfCustomers } = adminAnswering({ status: 200, body: contacts });

    const found = await customerContactsFor(admin, principal, "tenant-a", [
      order("c-1", "Mona"),
      order("c-2", null),
      order("c-1", null),
    ]);

    expect(contactsOfCustomers).toHaveBeenCalledWith(principal, { tenantId: "tenant-a", customerIds: ["c-1", "c-2"] });
    expect(found.get("c-1")?.email).toBe("a@example.com");
    expect([...customerLabelsOf(found)]).toEqual([["c-1", "Alice"], ["c-2", "g@example.com"]]);
  });

  it("gives no contacts, rather than failing, when Identity cannot be read", async () => {
    const { admin } = adminAnswering(new Error("down"));
    expect((await customerContactsFor(admin, principal, "tenant-a", [order("c-1", null)])).size).toBe(0);
  });
});
```

(add `customerContactsFor, customerLabelsOf` to the file's import.) Run it — Expected: FAIL.

In `order-customer-names.ts` append:

```ts
/**
 * The contacts of EVERY order's customer on a page, in ONE Identity read (the export needs the email
 * even when a recipient was typed). A failed read gives none — the email column is informational.
 */
export async function customerContactsFor(
  admin: Pick<WiredAdmin, "customers">,
  principal: Principal,
  tenantId: string,
  orders: readonly Order[],
): Promise<ReadonlyMap<string, CustomerContact>> {
  const found = new Map<string, CustomerContact>();
  const customerIds = [...new Set(orders.map((order) => order.customerRef))];
  if (customerIds.length === 0) return found;
  try {
    const response = await admin.customers.contactsOfCustomers(principal, { tenantId, customerIds });
    if (response.status !== 200) {
      logger.warn("customer contacts unavailable", { tenantId, status: response.status });
      return found;
    }
    for (const contact of response.body as readonly CustomerContact[]) found.set(contact.id, contact);
  } catch (error) {
    logger.warn("customer contacts unavailable", {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return found;
}

/** The list label of each contact (see `labelOf`): what `customerNameOf` falls back to. */
export function customerLabelsOf(
  contacts: ReadonlyMap<string, CustomerContact>,
): ReadonlyMap<string, string> {
  return new Map([...contacts].map(([id, contact]) => [id, labelOf(contact)]));
}
```

Run it again — Expected: PASS.

- [ ] **Step 4: Write the failing route tests**

Append to `apps/admin/src/http/order-operations-routes.test.ts` (add `vi` to the vitest import and the
extra imports shown):

```ts
import { orderOperationsRoutes } from "./order-operations-routes";
import type { Order } from "@platform/orders";

describe("GET /orders/export-rows (order operations Part 1)", () => {
  const routeOf = (path: string) =>
    adminRoutes(buildOrdersAdmin()).find((r) => r.method === "GET" && r.path === path);

  it("is operator/admin only (orders:export) and validates its query", () => {
    const route = routeOf("/orders/export-rows");
    expect(route?.permission).toBe("orders:export");
    const schema = route?.schema.querystring;
    expect(schema?.safeParse({ first: "250" }).success).toBe(true);
    expect(schema?.safeParse({ first: "251" }).success).toBe(false);
    expect(schema?.safeParse({ ids: Array.from({ length: 51 }, (_, i) => `o-${i}`).join(",") }).success).toBe(false);
    expect(schema?.safeParse({ createdFrom: "2026-10-02T00:00:00Z", createdTo: "2026-10-01T00:00:00Z" }).success).toBe(false);
    expect(schema?.safeParse({ view: "unpaid", search: "mona", status: "placed" }).success).toBe(true);
  });

  it("pages, narrows to ids and filters by date on the real composition", async () => {
    const admin = buildOrdersAdmin();
    const a = await placeTestOrder(admin);
    const b = await placeTestOrder(admin);
    const c = await placeTestOrder(admin);
    const routes = adminRoutes(admin);
    const rows = async (query: Record<string, string>) => {
      const response = await callRoute(routes, "GET", "/orders/export-rows", { query: routeOf("/orders/export-rows")?.schema.querystring?.parse(query) });
      expect(response.status).toBe(200);
      return response.body as { items: { orderId: string; codAmountMinor: number; tags: string[] }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    };

    const first = await rows({ first: "2" });
    expect(first.items.map((r) => r.orderId)).toEqual([c, b]);
    expect(first.pageInfo.hasNextPage).toBe(true);
    const rest = await rows({ first: "2", after: first.pageInfo.endCursor ?? "" });
    expect(rest.items.map((r) => r.orderId)).toEqual([a]);
    expect((await rows({ ids: `${a},${c}` })).items.map((r) => r.orderId).sort()).toEqual([a, c].sort());
    expect((await rows({ createdFrom: "2026-07-04T00:00:00Z", createdTo: "2026-07-06T00:00:00Z" })).items).toHaveLength(3);
    expect((await rows({ createdFrom: "2026-07-06T00:00:00Z" })).items).toHaveLength(0);
    expect(first.items[0]).toMatchObject({ codAmountMinor: 0, tags: [] });
  });

  it("answers the payments failure instead of rows whose cash amounts would be 0 (Review Focus 3)", async () => {
    const order = {
      id: { toString: () => "o-1" },
      orderNumber: { value: "1001" },
      customerRef: "c-1",
      currency: "EGP",
      paymentRef: "i-1",
      history: [{ type: "payment_requested", occurredAt: new Date(0) }],
      shippingAddress: { line1: "1", city: "Cairo", postalCode: "", country: "EG" },
      items: [],
      totalAmount: () => ({ amountMinor: 100 }),
    } as unknown as Order;
    const admin = {
      orders: {
        listOrders: vi.fn().mockResolvedValue({ status: 200, body: { items: [order], pageInfo: { hasNextPage: false, endCursor: null } } }),
        fulfillmentsOfOrders: vi.fn().mockResolvedValue({ status: 200, body: [] }),
        orderAnnotations: vi.fn().mockResolvedValue({ status: 200, body: new Map() }),
        paymentIntentsOf: vi.fn().mockResolvedValue({ status: 503, body: { message: "payments down" } }),
      },
      customers: { contactsOfCustomers: vi.fn().mockResolvedValue({ status: 200, body: [] }) },
    } as unknown as WiredAdmin;
    const routes = orderOperationsRoutes(admin);

    const exported = await callRoute(routes, "GET", "/orders/export-rows", { query: {} });
    const slips = await callRoute(routes, "GET", "/orders/packing-slips", { query: { ids: ["o-1"] } });

    expect(exported).toEqual({ status: 503, body: { message: "payments down" } });
    expect(slips).toEqual({ status: 503, body: { message: "payments down" } });
  });
});

describe("GET /orders/packing-slips", () => {
  it("is readable by anyone who reads orders, and caps at 50 ids", () => {
    const route = adminRoutes(buildOrdersAdmin()).find((r) => r.method === "GET" && r.path === "/orders/packing-slips");
    expect(route?.permission).toBe("orders:read");
    const ids = (count: number) => Array.from({ length: count }, (_, i) => `o-${i}`).join(",");
    expect(route?.schema.querystring?.safeParse({ ids: ids(50) }).success).toBe(true);
    expect(route?.schema.querystring?.safeParse({ ids: ids(51) }).success).toBe(false);
    expect(route?.schema.querystring?.safeParse({ ids: "" }).success).toBe(false);
  });

  it("answers the slips in the order asked, leaving out ids this shop does not have", async () => {
    const admin = buildOrdersAdmin();
    const a = await placeTestOrder(admin);
    const b = await placeTestOrder(admin);
    const theirs = await placeTestOrder(admin, "shop-b");

    const response = await callRoute(adminRoutes(admin), "GET", "/orders/packing-slips", {
      query: { ids: [b, theirs, a] },
    }, viewerStaff);

    expect(response.status).toBe(200);
    expect((response.body as { slips: { orderId: string }[] }).slips.map((s) => s.orderId)).toEqual([b, a]);
  });
});
```

(Handlers receive the PARSED query, so tests that call `handle` directly pass `ids` as an array — the
schema's `transform` output — or run `schema.querystring.parse` first, as the paging test does.)

Run: `pnpm --filter @platform/admin exec vitest run src/http/order-operations-routes.test.ts`
Expected: FAIL — no `GET /orders/export-rows` route.

- [ ] **Step 5: Add the two routes**

In `apps/admin/src/http/order-operations-routes.ts` add the imports

```ts
import type { Order } from "@platform/orders";
import { customerContactsFor, customerLabelsOf, customerNamesFor } from "./order-customer-names";
import { toOrderExportRowDto, toPackingSlipDto } from "./order-export-rows";
import { paymentIntentsOfOrders } from "./order-payment-intents";
import { listOrdersForView, ORDER_STATUS_VALUES, ORDER_VIEWS, orderAnnotationsFor } from "./order-views";
```

then the schemas:

```ts
/** A comma list of ids (`?ids=a,b`), trimmed and deduped, 1..max. */
function commaIds(max: number) {
  return z
    .string()
    .transform((raw) => [...new Set(raw.split(",").map((id) => id.trim()).filter((id) => id.length > 0))])
    .pipe(z.array(z.string()).min(1).max(max));
}

export const EXPORT_ROWS_PAGE_SIZE = 250;

const exportRowsQuery = z
  .object({
    view: z.enum(ORDER_VIEWS).optional(),
    search: z.string().min(1).optional(),
    status: z.enum(ORDER_STATUS_VALUES).optional(),
    ids: commaIds(50).optional(),
    /** ISO instants; admin-web turns the shop-local days into them. createdFrom inclusive, createdTo exclusive. */
    createdFrom: z.coerce.date().optional(),
    createdTo: z.coerce.date().optional(),
    first: z.coerce.number().int().min(1).max(EXPORT_ROWS_PAGE_SIZE).optional(),
    after: z.string().min(1).optional(),
  })
  .refine(
    (query) =>
      query.createdFrom === undefined ||
      query.createdTo === undefined ||
      query.createdFrom < query.createdTo,
    { message: "createdFrom must be before createdTo", path: ["createdTo"] },
  );

const packingSlipsQuery = z.object({ ids: commaIds(50) });
```

and the routes:

```ts
    defineRoute({
      method: "GET",
      path: "/orders/export-rows",
      version: 1,
      permission: "orders:export",
      summary: "One courier-ready row per order, for the CSV export (cursor page of up to 250)",
      schema: { querystring: exportRowsQuery },
      handle: async ({ query, context }): Promise<AdminResponse> => {
        const { principal, tenantId } = context;
        const { view, ids, first, ...filters } = query;
        const found = await listOrdersForView(admin, principal, tenantId, view ?? "all", {
          ...filters,
          ...(ids === undefined ? {} : { ids }),
          first: first ?? EXPORT_ROWS_PAGE_SIZE,
        });
        if (!found.ok) return found.response;
        const orders = found.page.items;
        // A sheet whose cash-on-delivery amounts are guessed is worse than no sheet: fail instead.
        const intents = await paymentIntentsOfOrders(admin, principal, tenantId, orders);
        if (!intents.ok) return intents.response;
        const annotations = await orderAnnotationsFor(admin, principal, tenantId, orders.map((o) => o.id.toString()));
        if (!annotations.ok) return annotations.response;
        const contacts = await customerContactsFor(admin, principal, tenantId, orders);
        const customerLabels = customerLabelsOf(contacts);
        return {
          status: 200,
          body: {
            items: orders.map((order) =>
              toOrderExportRowDto(order, {
                fulfillmentStatus: found.statuses.get(order.id.toString()) ?? "unfulfilled",
                contact: contacts.get(order.customerRef),
                customerLabels,
                intent: order.paymentRef === undefined ? undefined : intents.byId.get(order.paymentRef),
                annotations: annotations.byOrder.get(order.id.toString()),
              }),
            ),
            pageInfo: found.page.pageInfo,
          },
        };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/orders/packing-slips",
      version: 1,
      permission: "orders:read",
      summary: "Printable packing slips for up to 50 orders, in the order asked",
      schema: { querystring: packingSlipsQuery },
      handle: async ({ query, context }): Promise<AdminResponse> => {
        const { principal, tenantId } = context;
        const found = await listOrdersForView(admin, principal, tenantId, "all", {
          ids: query.ids,
          first: query.ids.length,
        });
        if (!found.ok) return found.response;
        const orders = found.page.items;
        const intents = await paymentIntentsOfOrders(admin, principal, tenantId, orders);
        if (!intents.ok) return intents.response;
        const annotations = await orderAnnotationsFor(admin, principal, tenantId, orders.map((o) => o.id.toString()));
        if (!annotations.ok) return annotations.response;
        const customerLabels = await customerNamesFor(admin, principal, tenantId, orders);
        const byId = new Map<string, Order>(orders.map((order) => [order.id.toString(), order]));
        return {
          status: 200,
          body: {
            slips: query.ids.flatMap((id) => {
              const order = byId.get(id);
              if (order === undefined) return [];
              return [
                toPackingSlipDto(order, {
                  customerLabels,
                  intent: order.paymentRef === undefined ? undefined : intents.byId.get(order.paymentRef),
                  annotations: annotations.byOrder.get(id),
                }),
              ];
            }),
          },
        };
      },
    }),
```

Note for the stubbed test: `orderAnnotationsFor` is only reached after the payments read, and the
stub admin has no `orderAnnotations` result to fail on.

- [ ] **Step 6: Run the admin suite, typecheck, lint**

Run: `pnpm --filter @platform/admin test && pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin): order export rows and packing slip data

GET /orders/export-rows answers one courier row per order (view, search, status, ids,
dates, up to 250 per page; cash to collect from the linked payment's capability) and
GET /orders/packing-slips the slips for up to 50 orders. A failed payments read fails
the request rather than printing 0 to collect.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: admin-web — tabs, selectable table and the bulk bar

Model tier: **standard**.

**Files:**
- Modify: `apps/admin-web/src/lib/api/orders.ts`, `apps/admin-web/src/lib/api/orders.test.ts`
- Create: `apps/admin-web/src/lib/orders/order-views.ts`, `apps/admin-web/src/lib/orders/order-views.test.ts`
- Create: `apps/admin-web/src/components/orders/orders-view-tabs.tsx`, `orders-view-tabs.test.tsx`
- Modify: `apps/admin-web/src/components/orders/orders-table.tsx`, `orders-table.test.tsx`
- Create: `apps/admin-web/src/components/orders/orders-bulk-bar.tsx`
- Modify: `apps/admin-web/src/components/orders/orders-toolbar.tsx`
- Modify: `apps/admin-web/src/app/orders/actions.ts`, `apps/admin-web/src/app/orders/actions.test.ts`
- Modify: `apps/admin-web/src/app/orders/page.tsx`
- Delete: `apps/admin-web/src/components/orders/unfulfilled-filter-note.tsx`, `unfulfilled-filter-note.test.tsx`
- Modify: `apps/admin-web/src/components/dashboard/home-kpis.tsx`, `dashboard.test.tsx`
- Modify: `apps/admin-web/src/messages/en.ts`, `apps/admin-web/src/messages/ar.ts`

**Interfaces:**
- Consumes: `GET /orders?view=` + `archivedAt` (Task 3), `POST /orders/bulk` (Task 5).
- Produces:
  - `lib/api/orders.ts`: `type OrderView`, `OrdersListQuery.view?` (the `fulfillment` field is removed), `OrderListItemDto.archivedAt?: string | null`, `BULK_ORDER_ACTIONS`, `type BulkOrderAction`, `BulkOrderResultDto`, `bulkOrders(action, orderIds, idempotencyKey): Promise<MutationResult<{ results: readonly BulkOrderResultDto[] }>>`.
  - `lib/orders/order-views.ts`: `ORDER_VIEWS`, `ORDERS_PAGE_SIZE = 50`, `parseOrderView({ view?, fulfillment? }): OrderView`, `ordersViewHref(view, { q?, status? }): string`, `parseOrderIds(raw: string | undefined, max: number): readonly string[] | null`.
  - `app/orders/actions.ts`: `type BulkActionState = { status: "idle" } | { status: "done"; results: readonly BulkOrderResultDto[] } | { status: "error"; message: string }`, `runBulkOrderAction(action: string, orderIds: readonly string[]): Promise<BulkActionState>`.
  - `OrdersTable` (client) props `{ orders, t, locale, now?, canMarkCashReceived? }`; Task 8 adds `exportContext?`.
  - `OrdersBulkBar` props `{ selected, t, locale, canMarkCashReceived, onFinished(outcome: BulkOutcome), onExportSelected?() }`; `BulkResultNote` props `{ outcome, t, locale, onDismiss }`; `BulkOutcome = { state: BulkActionState; orderNumbers: ReadonlyMap<string,string> }`.
  - **Part 2 extends additively:** two more `MenuButton`s (Add tags / Remove tags) in the bar's ⋯ menu, `BULK_ORDER_ACTIONS` gains two values, `bulkOrders` gains an optional `tags` argument, the table gains a trailing Tags column, `reasons` gains keys.

- [ ] **Step 1: Write the failing helper tests**

`apps/admin-web/src/lib/orders/order-views.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ORDER_VIEWS, ordersViewHref, parseOrderIds, parseOrderView } from "./order-views";

describe("parseOrderView", () => {
  it("reads a known view, maps Home's legacy fulfillment link, and defaults to all", () => {
    expect(parseOrderView({ view: "unpaid" })).toBe("unpaid");
    expect(parseOrderView({ fulfillment: "unfulfilled" })).toBe("unfulfilled");
    expect(parseOrderView({ view: "archived", fulfillment: "unfulfilled" })).toBe("archived");
    expect(parseOrderView({ view: "bogus" })).toBe("all");
    expect(parseOrderView({})).toBe("all");
  });

  it("lists Shopify's tabs in Shopify's order", () => {
    expect(ORDER_VIEWS).toEqual(["all", "unfulfilled", "unpaid", "open", "archived"]);
  });
});

describe("ordersViewHref", () => {
  it("keeps the search and status, drops the cursor, and leaves All without a view param", () => {
    expect(ordersViewHref("all", {})).toBe("/orders");
    expect(ordersViewHref("unpaid", { q: "mona", status: "placed" })).toBe("/orders?view=unpaid&q=mona&status=placed");
    expect(ordersViewHref("all", { q: "mona" })).toBe("/orders?q=mona");
  });
});

describe("parseOrderIds", () => {
  it("splits, trims and dedupes a comma list", () => {
    expect(parseOrderIds(" a, b ,a,,", 50)).toEqual(["a", "b"]);
  });

  it("refuses nothing or more than the cap", () => {
    expect(parseOrderIds(undefined, 50)).toBeNull();
    expect(parseOrderIds(" , ", 50)).toBeNull();
    expect(parseOrderIds(Array.from({ length: 51 }, (_, i) => `o-${i}`).join(","), 50)).toBeNull();
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/lib/orders/order-views.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement the helpers and the API additions**

`apps/admin-web/src/lib/orders/order-views.ts`:

```ts
import type { OrderView } from "@/lib/api/orders";

/** Shopify's default views, in Shopify's order (spec §1.1). */
export const ORDER_VIEWS: readonly OrderView[] = ["all", "unfulfilled", "unpaid", "open", "archived"];

/** Shopify's orders page size (spec §1.5). */
export const ORDERS_PAGE_SIZE = 50;

/** `?view=` wins; Home's old `?fulfillment=unfulfilled` links read as the Unfulfilled tab; else All. */
export function parseOrderView(params: { readonly view?: string; readonly fulfillment?: string }): OrderView {
  const view = ORDER_VIEWS.find((candidate) => candidate === params.view);
  if (view !== undefined) return view;
  return params.fulfillment === "unfulfilled" ? "unfulfilled" : "all";
}

/** A tab's link: the search and status filter stay, the cursor does not (page 1 of the new tab). */
export function ordersViewHref(
  view: OrderView,
  keep: { readonly q?: string | undefined; readonly status?: string | undefined },
): string {
  const params = new URLSearchParams();
  if (view !== "all") params.set("view", view);
  if (keep.q !== undefined && keep.q.length > 0) params.set("q", keep.q);
  if (keep.status !== undefined && keep.status.length > 0) params.set("status", keep.status);
  const query = params.toString();
  return query.length > 0 ? `/orders?${query}` : "/orders";
}

/** A `?ids=a,b` list: trimmed, deduped, 1..max ids, else null. */
export function parseOrderIds(raw: string | undefined, max: number): readonly string[] | null {
  if (raw === undefined) return null;
  const ids = [...new Set(raw.split(",").map((id) => id.trim()).filter((id) => id.length > 0))];
  return ids.length === 0 || ids.length > max ? null : ids;
}
```

In `apps/admin-web/src/lib/api/orders.ts`:

```ts
/** Order operations Part 1: Shopify's default views of the list. */
export type OrderView = "all" | "unfulfilled" | "unpaid" | "open" | "archived";

// OrderListItemDto gains:
  /** Order operations Part 1: when the order was archived; null/absent when not (an older API omits it). */
  readonly archivedAt?: string | null;

// OrdersListQuery: remove `fulfillment`, add
  /** Order operations Part 1: Shopify's tab; absent or "all" sends no param. */
  readonly view?: OrderView;

// fetchOrdersPage: replace the `fulfillment` line with
  if (query.view !== undefined && query.view !== "all") params.set("view", query.view);
```

and append:

```ts
/** Order operations Part 1 — the list's bulk actions (`POST /orders/bulk`, one result per order). */
export const BULK_ORDER_ACTIONS = [
  "archive",
  "unarchive",
  "fulfill",
  "capture_payments",
  "mark_cod_collected",
] as const;
export type BulkOrderAction = (typeof BULK_ORDER_ACTIONS)[number];

export interface BulkOrderResultDto {
  readonly orderId: string;
  readonly outcome: "ok" | "skipped" | "failed";
  readonly reason?: string;
}

function isBulkResults(value: unknown): value is { readonly results: readonly BulkOrderResultDto[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { results?: unknown }).results)
  );
}

/** `POST /orders/bulk` (`idempotent: true`; the action's own permission is checked by the API). */
export function bulkOrders(
  action: BulkOrderAction,
  orderIds: readonly string[],
  idempotencyKey: string,
): Promise<MutationResult<{ readonly results: readonly BulkOrderResultDto[] }>> {
  return mutateAdminApi(
    "/api/v1/orders/bulk",
    { method: "POST", body: { action, orderIds }, idempotencyKey },
    isBulkResults,
  );
}
```

Append to `apps/admin-web/src/lib/api/orders.test.ts` (add `bulkOrders` to the dynamic-import list):

```ts
describe("fetchOrdersPage view (order operations Part 1)", () => {
  it("sends ?view= for a tab, and nothing for All", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [], pageInfo: { hasNextPage: false, endCursor: null } }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchOrdersPage({ view: "unpaid", first: 50 });
    await fetchOrdersPage({ view: "all" });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("view=unpaid");
    expect(String(fetchMock.mock.calls[1]?.[0])).not.toContain("view=");
  });
});

describe("bulkOrders", () => {
  it("posts the action and ids with the idempotency key and returns the per-order results", async () => {
    const results = [{ orderId: "o-1", outcome: "ok" }];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { results }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await bulkOrders("archive", ["o-1"], "key-1");

    expect(result).toEqual({ outcome: "ok", data: { results } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/orders\/bulk$/);
    expect(JSON.parse(String(init.body))).toEqual({ action: "archive", orderIds: ["o-1"] });
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/lib/orders/order-views.test.ts src/lib/api/orders.test.ts src/lib/api/route-contract.test.ts`
Expected: PASS (the route contract finds `POST /orders/bulk` from Task 5).

- [ ] **Step 3: Add the messages (both dictionaries, same keys and placeholders)**

`en.ts`, inside `ordersPage` (change `newOrder` and delete `unfulfilledFilter`):

```ts
    newOrder: "Create order",
    /** Order operations Part 1 — Shopify's default views, in Shopify's order. */
    tabsLabel: "Order views",
    tabs: { all: "All", unfulfilled: "Unfulfilled", unpaid: "Unpaid", open: "Open", archived: "Archived" },
    archivedBadge: "Archived",
    filter: "Filter",
    export: "Export",
    selectAll: "Select all orders on this page",
    selectOrder: "Select order {orderNumber}",
    bulk: {
      toolbarLabel: "Bulk actions",
      selectedCount: "{count} selected",
      fulfillItems: "Fulfill items",
      capturePayments: "Capture payments",
      printPackingSlips: "Print packing slips",
      moreActions: "More actions",
      archive: "Archive orders",
      unarchive: "Unarchive orders",
      exportSelected: "Export selected",
      markCashReceived: "Mark cash as received",
      working: "Working…",
      summary: "{updated} orders updated · {skipped} skipped",
      failedSuffix: " · {failed} failed",
      details: "Details",
      dismiss: "Dismiss",
      reasons: {
        not_found: "Order not found",
        already_archived: "Already archived",
        not_archived: "Not archived",
        order_not_open: "Order is cancelled or closed",
        fulfillment_already_open: "Fulfillment already started",
        payment_not_pending: "Payment isn't pending",
        payment_already_requested: "Payment already requested",
        not_cash_on_delivery: "Not an unpaid cash-on-delivery payment",
        unexpected_error: "Something went wrong",
      },
    },
```

`ar.ts`, inside `ordersPage` (same edits):

```ts
    newOrder: "إنشاء طلب",
    tabsLabel: "طرق عرض الطلبات",
    tabs: { all: "الكل", unfulfilled: "غير منفذة", unpaid: "غير مدفوعة", open: "مفتوحة", archived: "مؤرشفة" },
    archivedBadge: "مؤرشف",
    filter: "تصفية",
    export: "تصدير",
    selectAll: "تحديد كل الطلبات في هذه الصفحة",
    selectOrder: "تحديد الطلب {orderNumber}",
    bulk: {
      toolbarLabel: "إجراءات جماعية",
      selectedCount: "تم تحديد {count}",
      fulfillItems: "تنفيذ المنتجات",
      capturePayments: "تحصيل المدفوعات",
      printPackingSlips: "طباعة قسائم التعبئة",
      moreActions: "إجراءات أخرى",
      archive: "أرشفة الطلبات",
      unarchive: "إلغاء أرشفة الطلبات",
      exportSelected: "تصدير المحدد",
      markCashReceived: "تأكيد استلام النقدية",
      working: "جارٍ التنفيذ…",
      summary: "تم تحديث {updated} طلب · تم تخطي {skipped}",
      failedSuffix: " · فشل {failed}",
      details: "التفاصيل",
      dismiss: "إغلاق",
      reasons: {
        not_found: "الطلب غير موجود",
        already_archived: "مؤرشف بالفعل",
        not_archived: "غير مؤرشف",
        order_not_open: "الطلب ملغي أو مغلق",
        fulfillment_already_open: "بدأ التنفيذ بالفعل",
        payment_not_pending: "الدفع ليس معلّقًا",
        payment_already_requested: "تم طلب الدفع بالفعل",
        not_cash_on_delivery: "ليس دفعًا عند الاستلام لم يُحصَّل",
        unexpected_error: "حدث خطأ ما",
      },
    },
```

Delete `apps/admin-web/src/components/orders/unfulfilled-filter-note.tsx` and its test (first run
`git grep -n "unfulfilledFilter\|UnfulfilledFilterNote" apps/admin-web/src` — the page is the only
other user and Step 8 removes it).

- [ ] **Step 4: Write the failing tabs and server-action tests**

`apps/admin-web/src/components/orders/orders-view-tabs.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { OrdersViewTabs } from "./orders-view-tabs";

describe("OrdersViewTabs (order operations Part 1)", () => {
  it("shows Shopify's tabs in order, marks the current one, and keeps the search in each link", () => {
    render(<OrdersViewTabs current="unpaid" q="mona" status={undefined} t={en} />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["All", "Unfulfilled", "Unpaid", "Open", "Archived"]);
    expect(screen.getByRole("link", { name: "Unpaid" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "All" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Archived" })).toHaveAttribute("href", "/orders?view=archived&q=mona");
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("href", "/orders?q=mona");
  });

  it("is in Arabic", () => {
    render(<OrdersViewTabs current="all" q={undefined} status={undefined} t={ar} />);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "الكل",
      "غير منفذة",
      "غير مدفوعة",
      "مفتوحة",
      "مؤرشفة",
    ]);
  });
});
```

Append to `apps/admin-web/src/app/orders/actions.test.ts` (add `bulkOrders: orders.bulkOrders` to the
`@/lib/api/orders` mock via a hoisted `orders` object, and import `runBulkOrderAction`):

```ts
const orders = vi.hoisted(() => ({ bulkOrders: vi.fn() }));
// in the vi.mock("@/lib/api/orders", …) factory add:  bulkOrders: orders.bulkOrders,

describe("runBulkOrderAction (order operations Part 1)", () => {
  beforeEach(() => {
    orders.bulkOrders.mockReset().mockResolvedValue({
      outcome: "ok",
      data: { results: [{ orderId: "o-1", outcome: "ok" }] },
    });
  });

  it("sends the deduped ids with one fresh key, returns the results and refreshes the list", async () => {
    const state = await runBulkOrderAction("archive", ["o-1", "o-1"]);

    expect(state).toEqual({ status: "done", results: [{ orderId: "o-1", outcome: "ok" }] });
    expect(orders.bulkOrders).toHaveBeenCalledWith("archive", ["o-1"], expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/orders");
  });

  it("refuses an unknown action, no ids or more than 50 without calling the API", async () => {
    for (const [action, ids] of [
      ["cancel", ["o-1"]],
      ["archive", []],
      ["archive", Array.from({ length: 51 }, (_, i) => `o-${i}`)],
    ] as const) {
      expect((await runBulkOrderAction(action, ids)).status).toBe("error");
    }
    expect(orders.bulkOrders).not.toHaveBeenCalled();
  });

  it("turns a 403 into the form's forbidden message and does not refresh", async () => {
    orders.bulkOrders.mockResolvedValue({ outcome: "forbidden" });
    const state = await runBulkOrderAction("mark_cod_collected", ["o-1"]);
    expect(state.status).toBe("error");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/components/orders/orders-view-tabs.test.tsx src/app/orders/actions.test.ts`
Expected: FAIL (component and action missing).

- [ ] **Step 5: Implement the tabs and the server action**

`apps/admin-web/src/components/orders/orders-view-tabs.tsx`:

```tsx
import Link from "next/link";
import { cn } from "@platform/ui";
import type { OrderView } from "@/lib/api/orders";
import { ORDER_VIEWS, ordersViewHref } from "@/lib/orders/order-views";
import type { Dictionary } from "@/messages/en";

/** Shopify's tab strip over the list: each tab is a link (`?view=`), so every view is reachable by URL. */
export function OrdersViewTabs({
  current,
  q,
  status,
  t,
}: {
  readonly current: OrderView;
  readonly q: string | undefined;
  readonly status: string | undefined;
  readonly t: Dictionary;
}) {
  return (
    <nav aria-label={t.ordersPage.tabsLabel} className="border-border flex gap-1 overflow-x-auto border-b">
      {ORDER_VIEWS.map((view) => {
        const active = view === current;
        return (
          <Link
            key={view}
            href={ordersViewHref(view, { q, status })}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2",
              active
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {t.ordersPage.tabs[view]}
          </Link>
        );
      })}
    </nav>
  );
}
```

In `apps/admin-web/src/app/orders/actions.ts` add `bulkOrders, BULK_ORDER_ACTIONS, type BulkOrderAction, type BulkOrderResultDto` to the `@/lib/api/orders` import and:

```ts
/** What the bulk bar shows after an action (order operations Part 1). */
export type BulkActionState =
  | { readonly status: "idle" }
  | { readonly status: "done"; readonly results: readonly BulkOrderResultDto[] }
  | { readonly status: "error"; readonly message: string };

const MAX_BULK_ORDERS = 50;

function isBulkOrderAction(value: string): value is BulkOrderAction {
  return (BULK_ORDER_ACTIONS as readonly string[]).includes(value);
}

/**
 * Runs one bulk action on the selected orders (`POST /orders/bulk`). Called directly by the client bar,
 * so both arguments are untrusted: the action must be a known one and the ids 1..50 strings. One fresh
 * idempotency key per click.
 */
export async function runBulkOrderAction(
  action: string,
  orderIds: readonly string[],
): Promise<BulkActionState> {
  const t = await formErrorDictionary();
  const ids = [...new Set(orderIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (!isBulkOrderAction(action) || ids.length === 0 || ids.length > MAX_BULK_ORDERS) {
    return { status: "error", message: t.invalid };
  }
  const result = await bulkOrders(action, ids, newIdempotencyKey());
  if (result.outcome !== "ok") {
    const state = toFormState(result, t);
    return { status: "error", message: state.status === "error" ? state.message : t.unexpected };
  }
  revalidatePath("/orders");
  return { status: "done", results: result.data.results };
}
```

Run the two test files — Expected: PASS.

- [ ] **Step 6: Write the failing table tests**

In `apps/admin-web/src/components/orders/orders-table.test.tsx`:
- add at the top:

```tsx
const actions = vi.hoisted(() => ({ runBulkOrderAction: vi.fn() }));
vi.mock("@/app/orders/actions", () => actions);
```

  (and `vi`, `fireEvent`, `waitFor` to the imports);
- the existing header-order test's expected array gains a leading `""` (the checkbox column);
- append:

```tsx
describe("OrdersTable selection and bulk bar (order operations Part 1)", () => {
  const two = () => [order(), order({ id: "order-2", orderNumber: "1002", archivedAt: "2026-10-18T09:00:00.000Z" })];

  it("shows an Archived badge next to an archived order's number", () => {
    renderTable(two());
    expect(within(rowOf(/1002/)).getByText("Archived")).toBeInTheDocument();
    expect(within(rowOf(/1001/)).queryByText("Archived")).toBeNull();
  });

  it("replaces the header with 'N selected' and the actions once a row is selected", () => {
    renderTable(two());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select order 1001" }));

    expect(screen.getByRole("toolbar", { name: "Bulk actions" })).toHaveTextContent("1 selected");
    for (const name of ["Fulfill items", "Capture payments", "Print packing slips"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("columnheader", { name: "Customer" })).toBeNull();
  });

  it("select-all selects the whole page, and again clears it", () => {
    renderTable(two());
    const all = screen.getByRole("checkbox", { name: "Select all orders on this page" });
    fireEvent.click(all);
    expect(screen.getByRole("toolbar")).toHaveTextContent("2 selected");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all orders on this page" }));
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("offers Mark cash as received only to admins", () => {
    const { rerender } = render(<OrdersTable orders={two()} t={en} locale="en" now={NOW} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select order 1001" }));
    expect(screen.queryByRole("button", { name: "Mark cash as received" })).toBeNull();
    rerender(<OrdersTable orders={two()} t={en} locale="en" now={NOW} canMarkCashReceived />);
    expect(screen.getByRole("button", { name: "Mark cash as received" })).toBeInTheDocument();
  });

  it("clears the selection when the page changes (Review Focus 5)", () => {
    const { rerender } = render(<OrdersTable orders={two()} t={en} locale="en" now={NOW} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select order 1001" }));
    rerender(
      <OrdersTable orders={[order({ id: "order-3", orderNumber: "1003" })]} t={en} locale="en" now={NOW} />,
    );
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Select order 1003" })).not.toBeChecked();
  });

  it("runs the action on the selection and reports updated, skipped and why", async () => {
    actions.runBulkOrderAction.mockResolvedValue({
      status: "done",
      results: [
        { orderId: "order-1", outcome: "ok" },
        { orderId: "order-2", outcome: "skipped", reason: "already_archived" },
      ],
    });
    renderTable(two());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all orders on this page" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive orders" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 orders updated · 1 skipped"));
    expect(actions.runBulkOrderAction).toHaveBeenCalledWith("archive", ["order-1", "order-2"]);
    expect(screen.getByText("#1002 — Already archived")).toBeInTheDocument();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("opens the packing slips of the selection in a new tab", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderTable(two());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all orders on this page" }));
    fireEvent.click(screen.getByRole("button", { name: "Print packing slips" }));
    expect(open).toHaveBeenCalledWith("/orders/packing-slips?ids=order-1,order-2", "_blank", "noopener");
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/components/orders/orders-table.test.tsx`
Expected: FAIL (no checkboxes yet).

- [ ] **Step 7: Implement the bulk bar and the selectable table**

`apps/admin-web/src/components/orders/orders-bulk-bar.tsx`:

```tsx
"use client";

import { useTransition, type ReactNode } from "react";
import { MoreHorizontalIcon, XIcon } from "lucide-react";
import { Button } from "@platform/ui";
import { runBulkOrderAction, type BulkActionState } from "@/app/orders/actions";
import type { BulkOrderAction, OrderListItemDto } from "@/lib/api/orders";
import { formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/** The result of one bulk action, with the numbers of the orders it ran on (to name them in the details). */
export interface BulkOutcome {
  readonly state: BulkActionState;
  readonly orderNumbers: ReadonlyMap<string, string>;
}

function MenuButton({
  children,
  disabled,
  onClick,
}: {
  readonly children: ReactNode;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Button type="button" variant="ghost" className="w-full justify-start" disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}

/**
 * Shopify's bulk-action bar (spec §1.5): it replaces the table header while rows are selected. Every
 * action is the `runBulkOrderAction` server action (one API call, a result per order); Print packing
 * slips opens the print page in a new tab. The ⋯ menu is a native `<details>`, like the order page's.
 */
export function OrdersBulkBar({
  selected,
  t,
  locale,
  canMarkCashReceived,
  onFinished,
  onExportSelected,
}: {
  readonly selected: readonly OrderListItemDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly canMarkCashReceived: boolean;
  readonly onFinished: (outcome: BulkOutcome) => void;
  readonly onExportSelected?: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const b = t.ordersPage.bulk;
  const orderIds = selected.map((order) => order.id);
  const orderNumbers = new Map(selected.map((order) => [order.id, order.orderNumber]));

  const run = (action: BulkOrderAction) =>
    startTransition(async () => {
      const state = await runBulkOrderAction(action, orderIds);
      onFinished({ state, orderNumbers });
    });
  const printSlips = () => {
    window.open(`/orders/packing-slips?ids=${orderIds.map(encodeURIComponent).join(",")}`, "_blank", "noopener");
  };

  return (
    <div role="toolbar" aria-label={b.toolbarLabel} className="flex flex-wrap items-center gap-2 py-1">
      <span className="text-foreground me-2 text-sm font-semibold">
        {b.selectedCount.replace("{count}", formatNumber(locale, selected.length))}
      </span>
      <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => run("fulfill")}>
        {b.fulfillItems}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => run("capture_payments")}>
        {b.capturePayments}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={printSlips}>
        {b.printPackingSlips}
      </Button>
      <details className="relative">
        <summary
          aria-label={b.moreActions}
          title={b.moreActions}
          className="border-input bg-card hover:border-foreground/40 focus-visible:ring-ring inline-flex h-8 cursor-pointer list-none items-center rounded-lg border px-2 focus-visible:outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden"
        >
          <MoreHorizontalIcon aria-hidden="true" className="size-4" />
        </summary>
        <div className="border-border bg-card absolute end-0 z-20 mt-2 flex min-w-56 flex-col gap-1 rounded-xl border p-2 shadow-lg">
          <MenuButton disabled={isPending} onClick={() => run("archive")}>{b.archive}</MenuButton>
          <MenuButton disabled={isPending} onClick={() => run("unarchive")}>{b.unarchive}</MenuButton>
          {onExportSelected !== undefined && (
            <MenuButton disabled={isPending} onClick={onExportSelected}>{b.exportSelected}</MenuButton>
          )}
          {canMarkCashReceived && (
            <MenuButton disabled={isPending} onClick={() => run("mark_cod_collected")}>{b.markCashReceived}</MenuButton>
          )}
        </div>
      </details>
      {isPending && <span className="text-muted-foreground text-sm">{b.working}</span>}
    </div>
  );
}

/** "N orders updated · M skipped" (+ failed), with a details list naming each skipped/failed order and why. */
export function BulkResultNote({
  outcome,
  t,
  locale,
  onDismiss,
}: {
  readonly outcome: BulkOutcome;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly onDismiss: () => void;
}) {
  const b = t.ordersPage.bulk;
  const { state } = outcome;
  if (state.status === "idle") return null;
  const dismiss = (
    <Button type="button" variant="ghost" size="sm" onClick={onDismiss} aria-label={b.dismiss}>
      <XIcon aria-hidden="true" />
    </Button>
  );
  if (state.status === "error") {
    return (
      <div className="border-border flex items-start gap-3 border-b px-4 py-3 sm:px-5">
        <p role="alert" className="text-destructive min-w-0 flex-1 text-sm">{state.message}</p>
        {dismiss}
      </div>
    );
  }
  const count = (outcomeKind: "ok" | "skipped" | "failed") =>
    state.results.filter((result) => result.outcome === outcomeKind).length;
  const failed = count("failed");
  const summary =
    b.summary
      .replace("{updated}", formatNumber(locale, count("ok")))
      .replace("{skipped}", formatNumber(locale, count("skipped"))) +
    (failed > 0 ? b.failedSuffix.replace("{failed}", formatNumber(locale, failed)) : "");
  const problems = state.results.filter((result) => result.outcome !== "ok");
  const reasonLabel = (reason: string | undefined) =>
    reason === undefined ? "" : ((b.reasons as Record<string, string>)[reason] ?? reason);

  return (
    <div className="border-border bg-muted/40 flex items-start gap-3 border-b px-4 py-3 text-sm sm:px-5">
      <div role="status" className="min-w-0 flex-1">
        <p className="font-medium">{summary}</p>
        {problems.length > 0 && (
          <details className="mt-1">
            <summary className="text-muted-foreground cursor-pointer">{b.details}</summary>
            <ul className="mt-1 list-disc ps-5">
              {problems.map((problem) => (
                <li key={problem.orderId}>
                  {`#${outcome.orderNumbers.get(problem.orderId) ?? problem.orderId} — ${reasonLabel(problem.reason)}`}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {dismiss}
    </div>
  );
}
```

`apps/admin-web/src/components/orders/orders-table.tsx` — becomes a client component. Keep the helper
functions (`FROM_MD`, `dateLabel`, `itemCountLabel`, `deliveryLabel`) and the existing cells; the new
shape:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { OrderListItemDto } from "@/lib/api/orders";
import { formatCurrency, formatNumber, orderDateParts } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { BulkResultNote, OrdersBulkBar, type BulkOutcome } from "./orders-bulk-bar";
import { OrderFulfillmentStatusBadge, OrderPaymentStatusBadge } from "./order-status-badge";

// … FROM_MD, dateLabel, itemCountLabel, deliveryLabel unchanged …

function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  readonly checked: boolean;
  readonly indeterminate: boolean;
  readonly onChange: () => void;
  readonly label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input ref={ref} type="checkbox" className="accent-primary relative z-10 size-4" checked={checked} onChange={onChange} aria-label={label} />
  );
}

/**
 * The orders list, like Shopify's: a checkbox column (select all on this page), the short number with an
 * Archived badge, a relative date, the customer, the total and both statuses. While rows are selected the
 * header becomes the bulk-action bar. Selection is per page: it clears whenever the page's orders change.
 * The Order link is stretched over the row; the checkboxes sit above it (`z-10`).
 */
export function OrdersTable({
  orders,
  t,
  locale,
  now,
  canMarkCashReceived = false,
}: {
  readonly orders: readonly OrderListItemDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly now?: Date;
  /** Admins only (payments stay admin-only): shows "Mark cash as received". */
  readonly canMarkCashReceived?: boolean;
}) {
  const reference = now ?? new Date();
  const pageKey = orders.map((order) => order.id).join(",");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null);

  useEffect(() => {
    setSelected(new Set());
  }, [pageKey]);

  const selectedOrders = orders.filter((order) => selected.has(order.id));
  const allSelected = orders.length > 0 && selectedOrders.length === orders.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(orders.map((order) => order.id)));
  const toggleOne = (orderId: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });

  const selectAll = (
    <SelectAllCheckbox
      checked={allSelected}
      indeterminate={selectedOrders.length > 0 && !allSelected}
      onChange={toggleAll}
      label={t.ordersPage.selectAll}
    />
  );

  return (
    <div className="flex flex-col">
      {outcome !== null && (
        <BulkResultNote outcome={outcome} t={t} locale={locale} onDismiss={() => setOutcome(null)} />
      )}
      <Table aria-label={t.ordersPage.title}>
        <TableHeader>
          {selectedOrders.length > 0 ? (
            <TableRow>
              <TableHead className="w-10">{selectAll}</TableHead>
              <TableHead colSpan={8}>
                <OrdersBulkBar
                  selected={selectedOrders}
                  t={t}
                  locale={locale}
                  canMarkCashReceived={canMarkCashReceived}
                  onFinished={(next) => {
                    setOutcome(next);
                    setSelected(new Set());
                  }}
                />
              </TableHead>
            </TableRow>
          ) : (
            <TableRow>
              <TableHead className="w-10">{selectAll}</TableHead>
              {/* … the eight existing TableHead cells, unchanged … */}
            </TableRow>
          )}
        </TableHeader>
        <TableBody>
          {orders.map((order) => {
            const date = orderDateParts(locale, order.createdAt, reference);
            return (
              <TableRow
                key={order.id}
                className="hover:bg-muted/50 relative"
                data-state={selected.has(order.id) ? "selected" : undefined}
              >
                <TableCell className="relative z-10 w-10">
                  <input
                    type="checkbox"
                    className="accent-primary size-4"
                    checked={selected.has(order.id)}
                    onChange={() => toggleOne(order.id)}
                    aria-label={t.ordersPage.selectOrder.replace("{orderNumber}", order.orderNumber)}
                  />
                </TableCell>
                <TableCell className="font-semibold">
                  <span className="inline-flex items-center gap-2">
                    {/* … the existing stretched Link to /orders/{id} … */}
                    {order.archivedAt ? <Badge variant="neutral">{t.ordersPage.archivedBadge}</Badge> : null}
                  </span>
                </TableCell>
                {/* … the seven remaining existing cells, unchanged … */}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
```

(`formatNumber` stays imported for `itemCountLabel`.) Run:
`pnpm --filter admin-web exec vitest run src/components/orders/orders-table.test.tsx` — Expected: PASS.

- [ ] **Step 8: Wire the page, the Filter button and Home's link**

`apps/admin-web/src/app/orders/page.tsx`:
- imports: drop `UnfulfilledFilterNote`; add `OrdersViewTabs`, `parseOrderView`, `ORDERS_PAGE_SIZE`,
  `highestRole, readSession` from `@/lib/auth/session`, `type OrderView`;
- `const PAGE_SIZE = ORDERS_PAGE_SIZE;` (20 → 50);
- `searchParams` gains `readonly view?: string;` (keep `fulfillment`);
- in the page:

```tsx
  const params = await searchParams;
  const view = parseOrderView(params);
  const session = await readSession();
  const canMarkCashReceived = highestRole(session?.roles ?? []) === "admin";
```

- header: title only (drop the subtitle `<p>`, Shopify shows none) and the buttons; then
  `<OrdersViewTabs current={view} q={params.q} status={params.status} t={t} />`, then `<OrdersToolbar t={t} />`;
- the `<Suspense key>` becomes `` `${view}:${params.q ?? ""}:${params.status ?? ""}:${params.after ?? ""}` ``
  and `OrdersResults` receives `view` (instead of `fulfillment`) and `canMarkCashReceived`;
- `OrdersResults`: `hasFilters = Boolean(search) || Boolean(status) || view !== "all"`,
  `fetchOrdersPage({ first, after, status, search, view })`,
  `<OrdersTable orders={result.items} t={t} locale={locale} canMarkCashReceived={canMarkCashReceived} />`.

`apps/admin-web/src/components/orders/orders-toolbar.tsx`: wrap the status `Label` + `select` in a
Filter disclosure (no behaviour change to `pushParams`, which already keeps `view`):

```tsx
      <details className="relative">
        <summary className="border-input bg-card text-foreground hover:border-foreground/40 focus-visible:ring-ring inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-xl border px-3.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
          <FilterIcon aria-hidden="true" className="size-4" />
          {t.ordersPage.filter}
          {currentStatus.length > 0 && <span aria-hidden="true" className="bg-primary size-2 rounded-full" />}
        </summary>
        <div className="border-border bg-card absolute start-0 z-20 mt-2 flex min-w-64 flex-col gap-2 rounded-xl border p-3 shadow-lg">
          {/* the existing <Label htmlFor="orders-status-filter"> and <select id="orders-status-filter">, unchanged */}
        </div>
      </details>
```

(`FilterIcon` from `lucide-react`.)

`apps/admin-web/src/components/dashboard/home-kpis.tsx`: `href="/orders?view=unfulfilled"`; in
`dashboard.test.tsx` the expected href becomes `"/orders?view=unfulfilled"`.

- [ ] **Step 9: Run admin-web, typecheck, lint**

Run: `pnpm --filter admin-web test && pnpm --filter admin-web typecheck && pnpm --filter admin-web lint`
Expected: PASS (the i18n test confirms every new Arabic string differs from its English one).

- [ ] **Step 10: Commit**

```bash
git add -A apps/admin-web/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin-web): order tabs, selection and the bulk action bar

The Orders list gets Shopify's tabs (All, Unfulfilled, Unpaid, Open, Archived), a Filter
button for the status, 50 per page, an Archived badge and per-page selection whose bar runs
fulfill, capture, print slips, archive, unarchive and (admins) mark cash received, then
reports updated/skipped with reasons. Home's card links to the Unfulfilled tab.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: admin-web — export dialog, CSV builder and the export route handler

Model tier: **standard** (pure functions carry the risk; each is pinned by unit tests).

**Files:**
- Create: `apps/admin-web/src/lib/orders/zoned-time.ts`, `zoned-time.test.ts`
- Create: `apps/admin-web/src/lib/orders/orders-csv.ts`, `orders-csv.test.ts`
- Create: `apps/admin-web/src/lib/orders/orders-export.ts`, `orders-export.test.ts`
- Modify: `apps/admin-web/src/lib/api/orders.ts`, `orders.test.ts`
- Create: `apps/admin-web/src/app/orders/export/route.ts`
- Create: `apps/admin-web/src/components/orders/orders-export-dialog.tsx`, `orders-export-dialog.test.tsx`
- Modify: `apps/admin-web/src/components/orders/orders-table.tsx` (Export selected), `apps/admin-web/src/app/orders/page.tsx` (Export button, error note)
- Modify: `apps/admin-web/src/messages/en.ts`, `ar.ts`

**Interfaces:**
- Consumes: `GET /orders/export-rows` (Task 6), `parseOrderView`, `parseOrderIds`, `ORDERS_PAGE_SIZE` (Task 7), `storeSettingsOrDefaults`, `provinceName` (`@platform/regions`), `paymentMethodLabel`, `currencyExponent` (`@/lib/products/money`).
- Produces:
  - `zoned-time.ts`: `zonedDay(instant: Date, timeZone): string` (`yyyy-mm-dd`), `zonedDateTimeLabel(iso: string, timeZone): string` (`yyyy-mm-dd HH:mm`), `startOfZonedDay(day: string, timeZone): Date`, `nextDay(day): string`, `isCalendarDay(value): boolean`.
  - `orders-csv.ts`: `ORDERS_CSV_COLUMNS` (24 keys, spec order), `guardCell(value)`, `csvCell(value)`, `plainAmount(amountMinor, currency)`, `itemsCell(items)`, `buildOrdersCsv(rows, { t, locale, timeZone }): string`.
  - `orders-export.ts`: `EXPORT_ROW_CAP = 5000`, `EXPORT_PAGE_SIZE = 250`, `MAX_EXPORT_REQUESTS = 60`, `type ExportScope = "current_page" | "all" | "selected" | "matching" | "dates"`, `ExportPlan = { query: OrderExportQuery; singlePage: boolean }`, `parseExportRequest(params: URLSearchParams, timeZone): ExportPlan | null`, `collectExportRows(fetchPage, plan, cap?): Promise<{ outcome: "ok"; rows } | { outcome: "too_many" | "error" | "unauthorized" }>`.
  - `lib/api/orders.ts`: `OrderExportRowDto`, `OrderExportQuery`, `FetchOrderExportRowsResult`, `fetchOrderExportRows(query)`.
  - `OrdersExportDialog` props `{ open, onOpenChange, context: OrdersExportContext, selectedIds, defaultScope?, t }`, `OrdersExportButton` props `{ context, t }`, `OrdersExportContext = { view; q?; status?; after?; hasFilters }`; `OrdersTable` gains `exportContext?: OrdersExportContext`.
  - **Part 2 extends additively:** the Tags and Notes columns already exist and print `row.tags`/`row.note`; Part 2 only fills them server-side, and adds `tag` to `OrderExportQuery`.

- [ ] **Step 1: Write the failing time-zone tests**

`apps/admin-web/src/lib/orders/zoned-time.test.ts` (Asia/Riyadh is UTC+3 all year — no DST in the expectations):

```ts
import { describe, expect, it } from "vitest";
import { isCalendarDay, nextDay, startOfZonedDay, zonedDateTimeLabel, zonedDay } from "./zoned-time";

describe("shop time-zone helpers (order export)", () => {
  it("prints an instant as the shop's local date and time", () => {
    expect(zonedDateTimeLabel("2026-10-18T09:05:00.000Z", "Asia/Riyadh")).toBe("2026-10-18 12:05");
    expect(zonedDateTimeLabel("2026-10-18T21:30:00.000Z", "Asia/Riyadh")).toBe("2026-10-19 00:30");
  });

  it("names the shop's calendar day of an instant", () => {
    expect(zonedDay(new Date("2026-10-17T22:30:00.000Z"), "Asia/Riyadh")).toBe("2026-10-18");
  });

  it("finds the instant a shop-local day starts", () => {
    expect(startOfZonedDay("2026-10-18", "Asia/Riyadh").toISOString()).toBe("2026-10-17T21:00:00.000Z");
    expect(startOfZonedDay("2026-10-18", "UTC").toISOString()).toBe("2026-10-18T00:00:00.000Z");
  });

  it("steps to the next calendar day across months and years", () => {
    expect(nextDay("2026-10-31")).toBe("2026-11-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });

  it("accepts only real yyyy-mm-dd days", () => {
    expect(isCalendarDay("2026-02-28")).toBe(true);
    expect(isCalendarDay("2026-02-30")).toBe(false);
    expect(isCalendarDay("2026-2-3")).toBe(false);
    expect(isCalendarDay("")).toBe(false);
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/lib/orders/zoned-time.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implement them**

`apps/admin-web/src/lib/orders/zoned-time.ts`:

```ts
interface ZonedParts {
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly hour: string;
  readonly minute: string;
  readonly second: string;
}

function partsIn(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** The shop's calendar day (`yyyy-mm-dd`) of an instant. */
export function zonedDay(instant: Date, timeZone: string): string {
  const p = partsIn(instant, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `yyyy-mm-dd HH:mm` in the shop's time zone — the CSV's Date column (spec §1.5). */
export function zonedDateTimeLabel(iso: string, timeZone: string): string {
  const p = partsIn(new Date(iso), timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** How far the zone's wall clock is ahead of UTC at `instant`, in ms. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

function utcMidnight(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1);
}

/** The instant a shop-local day starts (offset re-read once, so a DST change at midnight lands right). */
export function startOfZonedDay(day: string, timeZone: string): Date {
  const midnight = utcMidnight(day);
  const guess = midnight - offsetMs(new Date(midnight), timeZone);
  return new Date(midnight - offsetMs(new Date(guess), timeZone));
}

export function nextDay(day: string): string {
  return new Date(utcMidnight(day) + 86_400_000).toISOString().slice(0, 10);
}

/** A real calendar day written `yyyy-mm-dd` (what `<input type="date">` submits). */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(utcMidnight(value)).toISOString().slice(0, 10) === value;
}
```

Run the test — Expected: PASS.

- [ ] **Step 3: Add the export messages**

`en.ts` — new top-level section:

```ts
  /** Order operations Part 1 — Shopify's "Export orders" dialog and the CSV's columns. */
  ordersExport: {
    title: "Export orders",
    scopeLegend: "Export",
    currentPage: "Current page",
    all: "All orders",
    selected: "Selected: {count} orders",
    matching: "Orders matching your search",
    dates: "Orders by date",
    from: "From",
    to: "To",
    formatLabel: "Export as",
    format: "CSV for Excel",
    cap: "Up to 5,000 orders per export.",
    submit: "Export orders",
    cancel: "Cancel",
    errors: {
      too_many: "More than 5,000 orders match. Narrow the date range and export again.",
      failed: "Couldn't export the orders. Try again.",
      invalid: "Choose what to export.",
    },
    columns: {
      order: "Order",
      date: "Date",
      customerName: "Customer name",
      phone: "Phone",
      email: "Email",
      line1: "Address line 1",
      line2: "Address line 2",
      city: "City",
      province: "Province",
      country: "Country",
      items: "Items",
      itemCount: "Item count",
      subtotal: "Subtotal",
      shipping: "Shipping",
      discount: "Discount",
      total: "Total",
      codAmount: "COD amount",
      currency: "Currency",
      paymentStatus: "Payment status",
      paymentMethod: "Payment method",
      fulfillmentStatus: "Fulfillment status",
      shippingMethod: "Shipping method",
      tags: "Tags",
      notes: "Notes",
    },
  },
```

`ar.ts`:

```ts
  ordersExport: {
    title: "تصدير الطلبات",
    scopeLegend: "تصدير",
    currentPage: "الصفحة الحالية",
    all: "كل الطلبات",
    selected: "المحدد: {count} طلب",
    matching: "الطلبات المطابقة لبحثك",
    dates: "الطلبات حسب التاريخ",
    from: "من",
    to: "إلى",
    formatLabel: "التصدير بصيغة",
    format: "ملف CSV لبرنامج Excel",
    cap: "حتى 5,000 طلب في كل تصدير.",
    submit: "تصدير الطلبات",
    cancel: "إلغاء",
    errors: {
      too_many: "أكثر من 5,000 طلب مطابق. ضيّق نطاق التاريخ وصدّر مرة أخرى.",
      failed: "تعذّر تصدير الطلبات. حاول مرة أخرى.",
      invalid: "اختر ما تريد تصديره.",
    },
    columns: {
      order: "الطلب",
      date: "التاريخ",
      customerName: "اسم العميل",
      phone: "الهاتف",
      email: "البريد الإلكتروني",
      line1: "العنوان 1",
      line2: "العنوان 2",
      city: "المدينة",
      province: "المحافظة",
      country: "الدولة",
      items: "المنتجات",
      itemCount: "عدد المنتجات",
      subtotal: "المجموع الفرعي",
      shipping: "الشحن",
      discount: "الخصم",
      total: "الإجمالي",
      codAmount: "مبلغ التحصيل",
      currency: "العملة",
      paymentStatus: "حالة الدفع",
      paymentMethod: "طريقة الدفع",
      fulfillmentStatus: "حالة التنفيذ",
      shippingMethod: "طريقة الشحن",
      tags: "العلامات",
      notes: "ملاحظات",
    },
  },
```

- [ ] **Step 4: Add the export-rows API call**

In `apps/admin-web/src/lib/api/orders.ts`:

```ts
export interface OrderExportLineDto {
  readonly title: string;
  readonly variantTitle: string | null;
  readonly sku: string | null;
  readonly quantity: number;
}

/** One courier row per order (`GET /orders/export-rows`, spec §1.4). */
export interface OrderExportRowDto {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly createdAt: string;
  readonly customerName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly province: string | null;
  readonly country: string;
  readonly items: readonly OrderExportLineDto[];
  readonly itemCount: number;
  readonly subtotalMinor: number;
  readonly shippingMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  readonly codAmountMinor: number;
  readonly currency: string;
  readonly paymentStatus: OrderPaymentStatus;
  readonly paymentProvider: string | null;
  readonly fulfillmentStatus: OrderFulfillmentStatus;
  readonly shippingMethod: string | null;
  readonly tags: readonly string[];
  readonly note: string | null;
}

export interface OrderExportQuery {
  readonly view?: OrderView | undefined;
  readonly search?: string | undefined;
  readonly status?: string | undefined;
  readonly ids?: readonly string[] | undefined;
  /** ISO instants (the route handler turns shop-local days into them). */
  readonly createdFrom?: string | undefined;
  readonly createdTo?: string | undefined;
  readonly first?: number | undefined;
  readonly after?: string | undefined;
}

export type FetchOrderExportRowsResult =
  | { readonly outcome: "ok"; readonly items: readonly OrderExportRowDto[]; readonly pageInfo: OrdersPageInfo }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

function isExportRowsPage(value: unknown): value is { items: readonly OrderExportRowDto[]; pageInfo: OrdersPageInfo } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items) &&
    typeof (value as { pageInfo?: unknown }).pageInfo === "object"
  );
}

/** One page of export rows (`orders:export`). Server-only, like every `lib/api` call. */
export async function fetchOrderExportRows(query: OrderExportQuery): Promise<FetchOrderExportRowsResult> {
  const params = new URLSearchParams();
  if (query.view !== undefined && query.view !== "all") params.set("view", query.view);
  if (query.search !== undefined) params.set("search", query.search);
  if (query.status !== undefined) params.set("status", query.status);
  if (query.ids !== undefined) params.set("ids", query.ids.join(","));
  if (query.createdFrom !== undefined) params.set("createdFrom", query.createdFrom);
  if (query.createdTo !== undefined) params.set("createdTo", query.createdTo);
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);
  const result = await getAdminApi(`/api/v1/orders/export-rows?${params.toString()}`, isExportRowsPage);
  if (result.outcome === "ok") return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  return { outcome: "error", message: result.outcome === "not_found" ? "Not found" : result.message };
}
```

Append to `orders.test.ts` (add `fetchOrderExportRows` to the import list):

```ts
describe("fetchOrderExportRows", () => {
  it("sends the API's own parameter names (search, not q) and the ids as one comma list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [], pageInfo: { hasNextPage: false, endCursor: null } }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchOrderExportRows({ view: "unpaid", search: "mona", ids: ["a", "b"], first: 250 });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/v1/orders/export-rows");
    expect(Object.fromEntries(url.searchParams)).toEqual({ view: "unpaid", search: "mona", ids: "a,b", first: "250" });
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/lib/api/orders.test.ts src/lib/api/route-contract.test.ts` — Expected: PASS.

- [ ] **Step 5: Write the failing CSV tests**

`apps/admin-web/src/lib/orders/orders-csv.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { OrderExportRowDto } from "@/lib/api/orders";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { buildOrdersCsv, csvCell, guardCell, itemsCell, plainAmount } from "./orders-csv";

function row(overrides: Partial<OrderExportRowDto> = {}): OrderExportRowDto {
  return {
    orderId: "o-1",
    orderNumber: "1001",
    createdAt: "2026-10-18T09:05:00.000Z",
    customerName: "Mona Ali",
    email: "mona@example.com",
    phone: "+201012345678",
    line1: "1 Nile St",
    line2: null,
    city: "Cairo",
    province: "EG-C",
    country: "EG",
    items: [
      { title: "T-shirt", variantTitle: "L", sku: "SKU-1", quantity: 2 },
      { title: "Cap", variantTitle: null, sku: null, quantity: 1 },
    ],
    itemCount: 3,
    subtotalMinor: 120000,
    shippingMinor: 5000,
    discountMinor: 0,
    totalMinor: 125000,
    codAmountMinor: 125000,
    currency: "EGP",
    paymentStatus: "pending",
    paymentProvider: "cod",
    fulfillmentStatus: "unfulfilled",
    shippingMethod: "standard",
    tags: [],
    note: null,
    ...overrides,
  };
}

const options = { t: en, locale: "en" as const, timeZone: "Asia/Riyadh" };
const lines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n");

describe("guardCell — formula injection (Review Focus 4)", () => {
  it("prefixes ' to a cell Excel would run", () => {
    expect(guardCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(guardCell("@cmd")).toBe("'@cmd");
    expect(guardCell("+abc")).toBe("'+abc");
    expect(guardCell("-abc")).toBe("'-abc");
    expect(guardCell("\t=1")).toBe("'\t=1");
    expect(guardCell("\r=1")).toBe("'\r=1");
  });

  it("guards a phone-shaped start that continues into a formula", () => {
    expect(guardCell("+20=cmd|' /C calc'!A0")).toBe("'+20=cmd|' /C calc'!A0");
  });

  it("keeps phones and numbers exactly as typed", () => {
    expect(guardCell("+201012345678")).toBe("+201012345678");
    expect(guardCell("+20 (10) 123-4567")).toBe("+20 (10) 123-4567");
    expect(guardCell("-5")).toBe("-5");
    expect(guardCell("01012345678")).toBe("01012345678");
    expect(guardCell("")).toBe("");
  });
});

describe("csvCell — RFC 4180", () => {
  it("quotes a cell holding a comma, quote or line break, doubling quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell("plain")).toBe("plain");
  });
});

describe("plainAmount", () => {
  it("prints minor units as plain decimals in the currency's own exponent", () => {
    expect(plainAmount(125000, "EGP")).toBe("1250.00");
    expect(plainAmount(5, "EGP")).toBe("0.05");
    expect(plainAmount(1250, "JPY")).toBe("1250");
    expect(plainAmount(1250, "KWD")).toBe("1.250");
    expect(plainAmount(0, "EGP")).toBe("0.00");
  });
});

describe("itemsCell", () => {
  it("joins the lines as 'qty × title (variant) [SKU]'", () => {
    expect(itemsCell(row().items)).toBe("2 × T-shirt (L) [SKU-1]; 1 × Cap");
  });
});

describe("buildOrdersCsv", () => {
  it("starts with a UTF-8 BOM, ends lines with CRLF, and prints headers in the spec's order", () => {
    const csv = buildOrdersCsv([row()], options);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(lines(csv)[0]).toBe(
      "Order,Date,Customer name,Phone,Email,Address line 1,Address line 2,City,Province,Country,Items,Item count,Subtotal,Shipping,Discount,Total,COD amount,Currency,Payment status,Payment method,Fulfillment status,Shipping method,Tags,Notes",
    );
  });

  it("writes one row per order in the shop's time zone, with province names and plain amounts", () => {
    expect(lines(buildOrdersCsv([row()], options))[1]).toBe(
      "#1001,2026-10-18 12:05,Mona Ali,+201012345678,mona@example.com,1 Nile St,,Cairo,Cairo,EG,2 × T-shirt (L) [SKU-1]; 1 × Cap,3,1200.00,50.00,0.00,1250.00,1250.00,EGP,Payment pending,Cash on delivery,Unfulfilled,Standard,,",
    );
  });

  it("prints Arabic headers and the Arabic province name for an Arabic admin", () => {
    const [header, body] = lines(buildOrdersCsv([row()], { ...options, t: ar, locale: "ar" }));
    expect(header?.startsWith("الطلب,التاريخ,اسم العميل")).toBe(true);
    expect(body).toContain(",القاهرة,");
  });
});
```

The exact payment status, payment method and shipping method labels in the second test come from
`en.orderPaymentStatus.pending`, `en.orderPage.paymentMethodName.cod` and `en.shippingMethodLabel.standard`
— if any differs from "Payment pending" / "Cash on delivery" / "Standard", use the dictionary's value
in the expectation (never change the dictionary for the test).

Run: `pnpm --filter admin-web exec vitest run src/lib/orders/orders-csv.test.ts` — Expected: FAIL.

- [ ] **Step 6: Implement the CSV builder**

`apps/admin-web/src/lib/orders/orders-csv.ts`:

```ts
import { provinceName } from "@platform/regions";
import type { OrderExportLineDto, OrderExportRowDto } from "@/lib/api/orders";
import type { Locale } from "@/lib/i18n";
import { paymentMethodLabel } from "@/lib/payment-method-label";
import { currencyExponent } from "@/lib/products/money";
import type { Dictionary } from "@/messages/en";
import { zonedDateTimeLabel } from "./zoned-time";

/** The CSV's columns, in the spec's order (§1.5). */
export const ORDERS_CSV_COLUMNS = [
  "order", "date", "customerName", "phone", "email", "line1", "line2", "city", "province", "country",
  "items", "itemCount", "subtotal", "shipping", "discount", "total", "codAmount", "currency",
  "paymentStatus", "paymentMethod", "fulfillmentStatus", "shippingMethod", "tags", "notes",
] as const;

const BOM = "﻿";
const CRLF = "\r\n";
/** A `+`/`-` cell that is entirely phone/number-shaped is data, not a formula. */
const PHONE_OR_NUMBER = /^[+-][\d\s().-]*$/;

/**
 * Formula-injection guard (spec decision 13, tightened): a cell Excel would evaluate gets a leading
 * apostrophe. `=`, `@`, tab and carriage return always; `+`/`-` unless the whole cell is phone/number-
 * shaped — so `+201012345678` reaches the courier portal as typed while `+20=cmd|…` is guarded.
 */
export function guardCell(value: string): string {
  const first = value.charAt(0);
  if (first === "=" || first === "@" || first === "\t" || first === "\r") return `'${value}`;
  if ((first === "+" || first === "-") && !PHONE_OR_NUMBER.test(value)) return `'${value}`;
  return value;
}

/** RFC 4180: guarded, then quoted when it holds a comma, quote or line break (quotes doubled). */
export function csvCell(value: string): string {
  const guarded = guardCell(value);
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Minor units as a plain decimal in the currency's exponent: 125000 EGP → "1250.00" (no grouping, no symbol). */
export function plainAmount(amountMinor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  const sign = amountMinor < 0 ? "-" : "";
  const digits = String(Math.abs(amountMinor));
  if (exponent === 0) return `${sign}${digits}`;
  const padded = digits.padStart(exponent + 1, "0");
  return `${sign}${padded.slice(0, -exponent)}.${padded.slice(-exponent)}`;
}

/** `2 × T-shirt (L) [SKU-1]; 1 × Cap`. */
export function itemsCell(items: readonly OrderExportLineDto[]): string {
  return items
    .map(
      (item) =>
        `${item.quantity} × ${item.title}` +
        (item.variantTitle !== null ? ` (${item.variantTitle})` : "") +
        (item.sku !== null ? ` [${item.sku}]` : ""),
    )
    .join("; ");
}

function label(table: unknown, key: string): string {
  return (table as Record<string, string>)[key] ?? key;
}

/** The whole file: BOM, header row in the admin's language, one row per order, CRLF line ends. */
export function buildOrdersCsv(
  rows: readonly OrderExportRowDto[],
  options: { readonly t: Dictionary; readonly locale: Locale; readonly timeZone: string },
): string {
  const { t, locale, timeZone } = options;
  const header = ORDERS_CSV_COLUMNS.map((column) => csvCell(t.ordersExport.columns[column])).join(",");
  const body = rows.map((row) =>
    [
      `#${row.orderNumber}`,
      zonedDateTimeLabel(row.createdAt, timeZone),
      row.customerName ?? "",
      row.phone ?? "",
      row.email ?? "",
      row.line1,
      row.line2 ?? "",
      row.city,
      row.province === null ? "" : provinceName(row.province, locale),
      row.country,
      itemsCell(row.items),
      String(row.itemCount),
      plainAmount(row.subtotalMinor, row.currency),
      plainAmount(row.shippingMinor, row.currency),
      plainAmount(row.discountMinor, row.currency),
      plainAmount(row.totalMinor, row.currency),
      plainAmount(row.codAmountMinor, row.currency),
      row.currency,
      label(t.orderPaymentStatus, row.paymentStatus),
      row.paymentProvider === null ? "" : paymentMethodLabel(row.paymentProvider, t),
      label(t.orderFulfillmentStatus, row.fulfillmentStatus),
      row.shippingMethod === null ? "" : label(t.shippingMethodLabel, row.shippingMethod),
      row.tags.join(", "),
      row.note ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return BOM + [header, ...body].join(CRLF) + CRLF;
}
```

Run the CSV test — Expected: PASS.

- [ ] **Step 7: Write the failing export-plan tests**

`apps/admin-web/src/lib/orders/orders-export.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { FetchOrderExportRowsResult, OrderExportRowDto } from "@/lib/api/orders";
import { collectExportRows, MAX_EXPORT_REQUESTS, parseExportRequest } from "./orders-export";

const params = (values: Record<string, string>) => new URLSearchParams(values);
const TZ = "Asia/Riyadh";

describe("parseExportRequest (Shopify's five export scopes)", () => {
  it("current page: the list's own view, search, status and cursor, one page of 50", () => {
    expect(parseExportRequest(params({ scope: "current_page", view: "unpaid", q: "mona", status: "placed", after: "c-1" }), TZ)).toEqual({
      singlePage: true,
      query: { view: "unpaid", search: "mona", status: "placed", after: "c-1", first: 50 },
    });
  });

  it("all orders: every view, every page", () => {
    expect(parseExportRequest(params({ scope: "all", view: "unpaid", q: "mona" }), TZ)).toEqual({
      singlePage: false,
      query: { view: "all" },
    });
  });

  it("selected: up to 50 ids, deduped; more is refused", () => {
    expect(parseExportRequest(params({ scope: "selected", ids: "a,b,a" }), TZ)).toEqual({
      singlePage: true,
      query: { view: "all", ids: ["a", "b"], first: 2 },
    });
    const many = Array.from({ length: 51 }, (_, i) => `o-${i}`).join(",");
    expect(parseExportRequest(params({ scope: "selected", ids: many }), TZ)).toBeNull();
  });

  it("matching: the search and filters, every page", () => {
    expect(parseExportRequest(params({ scope: "matching", view: "open", q: "mona" }), TZ)).toEqual({
      singlePage: false,
      query: { view: "open", search: "mona", status: undefined },
    });
  });

  it("by date: whole shop-local days, the end day included", () => {
    expect(parseExportRequest(params({ scope: "dates", from: "2026-10-01", to: "2026-10-31" }), TZ)).toEqual({
      singlePage: false,
      query: { view: "all", createdFrom: "2026-09-30T21:00:00.000Z", createdTo: "2026-10-31T21:00:00.000Z" },
    });
  });

  it("refuses reversed or invalid dates and an unknown scope", () => {
    expect(parseExportRequest(params({ scope: "dates", from: "2026-10-31", to: "2026-10-01" }), TZ)).toBeNull();
    expect(parseExportRequest(params({ scope: "dates", from: "2026-02-30", to: "2026-03-01" }), TZ)).toBeNull();
    expect(parseExportRequest(params({ scope: "everything" }), TZ)).toBeNull();
    expect(parseExportRequest(params({}), TZ)).toBeNull();
  });
});

const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ orderId: `o-${i}` }) as OrderExportRowDto);
const ok = (count: number, next: string | null): FetchOrderExportRowsResult => ({
  outcome: "ok",
  items: rows(count),
  pageInfo: { hasNextPage: next !== null, endCursor: next },
});

describe("collectExportRows", () => {
  it("pages 250 at a time, following the cursor, until the last page", async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce(ok(250, "c-1")).mockResolvedValueOnce(ok(10, null));
    const result = await collectExportRows(fetchPage, { singlePage: false, query: { view: "all" } });
    expect(result.outcome === "ok" && result.rows).toHaveLength(260);
    expect(fetchPage).toHaveBeenNthCalledWith(1, { view: "all", first: 250 });
    expect(fetchPage).toHaveBeenNthCalledWith(2, { view: "all", first: 250, after: "c-1" });
  });

  it("reads one page only for the current page or a selection", async () => {
    const fetchPage = vi.fn().mockResolvedValue(ok(50, "c-1"));
    const result = await collectExportRows(fetchPage, { singlePage: true, query: { view: "all", first: 50 } });
    expect(result.outcome === "ok" && result.rows).toHaveLength(50);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("stops with too_many past the cap rather than writing a cut-off file", async () => {
    const fetchPage = vi.fn().mockResolvedValue(ok(250, "c"));
    expect((await collectExportRows(fetchPage, { singlePage: false, query: {} }, 500)).outcome).toBe("too_many");
  });

  it("stops with too_many when pages never end (a scan that keeps answering short pages)", async () => {
    const fetchPage = vi.fn().mockResolvedValue(ok(0, "c"));
    expect((await collectExportRows(fetchPage, { singlePage: false, query: {} })).outcome).toBe("too_many");
    expect(fetchPage).toHaveBeenCalledTimes(MAX_EXPORT_REQUESTS);
  });

  it("passes a failed or refused read through", async () => {
    expect((await collectExportRows(vi.fn().mockResolvedValue({ outcome: "error", message: "x" }), { singlePage: false, query: {} })).outcome).toBe("error");
    expect((await collectExportRows(vi.fn().mockResolvedValue({ outcome: "unauthorized" }), { singlePage: false, query: {} })).outcome).toBe("unauthorized");
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/lib/orders/orders-export.test.ts` — Expected: FAIL.

- [ ] **Step 8: Implement the export plan**

`apps/admin-web/src/lib/orders/orders-export.ts`:

```ts
import type { FetchOrderExportRowsResult, OrderExportQuery, OrderExportRowDto } from "@/lib/api/orders";
import { ORDERS_PAGE_SIZE, parseOrderIds, parseOrderView } from "./order-views";
import { isCalendarDay, nextDay, startOfZonedDay } from "./zoned-time";

/** Synchronous export cap (spec decision 12); above it the merchant narrows the date range. */
export const EXPORT_ROW_CAP = 5000;
export const EXPORT_PAGE_SIZE = 250;
/** A guard against a view whose pages keep coming back short (the Unfulfilled scan). */
export const MAX_EXPORT_REQUESTS = 60;

export type ExportScope = "current_page" | "all" | "selected" | "matching" | "dates";

export interface ExportPlan {
  readonly query: OrderExportQuery;
  /** Current page and Selected read exactly one page. */
  readonly singlePage: boolean;
}

/** The dialog's submission → what to ask the API for; null for anything malformed. */
export function parseExportRequest(params: URLSearchParams, timeZone: string): ExportPlan | null {
  const text = (name: string) => {
    const value = params.get(name)?.trim();
    return value !== undefined && value.length > 0 ? value : undefined;
  };
  const view = parseOrderView({ view: text("view") });
  switch (params.get("scope")) {
    case "current_page":
      return {
        singlePage: true,
        query: { view, search: text("q"), status: text("status"), after: text("after"), first: ORDERS_PAGE_SIZE },
      };
    case "all":
      return { singlePage: false, query: { view: "all" } };
    case "selected": {
      const ids = parseOrderIds(text("ids"), 50);
      return ids === null ? null : { singlePage: true, query: { view: "all", ids, first: ids.length } };
    }
    case "matching":
      return { singlePage: false, query: { view, search: text("q"), status: text("status") } };
    case "dates": {
      const from = text("from") ?? "";
      const to = text("to") ?? "";
      if (!isCalendarDay(from) || !isCalendarDay(to) || from > to) return null;
      return {
        singlePage: false,
        query: {
          view: "all",
          createdFrom: startOfZonedDay(from, timeZone).toISOString(),
          createdTo: startOfZonedDay(nextDay(to), timeZone).toISOString(),
        },
      };
    }
    default:
      return null;
  }
}

export type CollectedExport =
  | { readonly outcome: "ok"; readonly rows: readonly OrderExportRowDto[] }
  | { readonly outcome: "too_many" | "error" | "unauthorized" };

/** Reads every page of the plan (or one), refusing to go past `cap` rows or {@link MAX_EXPORT_REQUESTS} calls. */
export async function collectExportRows(
  fetchPage: (query: OrderExportQuery) => Promise<FetchOrderExportRowsResult>,
  plan: ExportPlan,
  cap: number = EXPORT_ROW_CAP,
): Promise<CollectedExport> {
  const rows: OrderExportRowDto[] = [];
  let after = plan.query.after;
  for (let request = 0; request < MAX_EXPORT_REQUESTS; request += 1) {
    const page = await fetchPage({
      ...plan.query,
      first: plan.singlePage ? (plan.query.first ?? EXPORT_PAGE_SIZE) : EXPORT_PAGE_SIZE,
      ...(after === undefined ? {} : { after }),
    });
    if (page.outcome !== "ok") return { outcome: page.outcome };
    rows.push(...page.items);
    if (rows.length > cap) return { outcome: "too_many" };
    if (plan.singlePage || !page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) {
      return { outcome: "ok", rows };
    }
    after = page.pageInfo.endCursor;
  }
  return { outcome: "too_many" };
}
```

(The first test expects `{ view: "all", first: 250 }` — `after` is absent, not `undefined`; keep the
conditional spread and do not spread `after: undefined` from `plan.query` — `"all"`'s query has none.)
Run the test — Expected: PASS.

- [ ] **Step 9: Add the route handler**

`apps/admin-web/src/app/orders/export/route.ts`:

```ts
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { fetchOrderExportRows } from "@/lib/api/orders";
import { storeSettingsOrDefaults } from "@/lib/api/store-settings";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { buildOrdersCsv } from "@/lib/orders/orders-csv";
import { collectExportRows, parseExportRequest } from "@/lib/orders/orders-export";
import { zonedDay } from "@/lib/orders/zoned-time";
import { publicOrigin } from "@/lib/public-origin";

/**
 * Shopify's "Export orders" (spec §1.5): the dialog submits here (GET, server side), this pages
 * `GET /orders/export-rows` 250 at a time and answers `orders_export_<shop-local date>.csv` — UTF-8
 * with a BOM so Excel reads Arabic. Over 5,000 orders, a failure or a malformed request goes back to
 * the list with `?exportError=` instead of a partial file.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const back = (error: "too_many" | "failed" | "invalid") =>
    NextResponse.redirect(new URL(`/orders?exportError=${error}`, publicOrigin(request)), 303);

  const settings = await storeSettingsOrDefaults();
  const plan = parseExportRequest(request.nextUrl.searchParams, settings.timezone);
  if (plan === null) return back("invalid");

  const collected = await collectExportRows(fetchOrderExportRows, plan);
  if (collected.outcome === "too_many") return back("too_many");
  if (collected.outcome !== "ok") return back("failed");

  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const csv = buildOrdersCsv(collected.rows, { t: dictionaryFor(locale), locale, timeZone: settings.timezone });
  const day = zonedDay(new Date(), settings.timezone);
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="orders_export_${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}
```

(Check `publicOrigin`'s parameter type in `lib/public-origin.ts`; `app/logout/route.ts` passes the
`NextRequest` the same way.)

- [ ] **Step 10: Write the failing dialog test**

`apps/admin-web/src/components/orders/orders-export-dialog.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { OrdersExportDialog, type OrdersExportContext } from "./orders-export-dialog";

const context: OrdersExportContext = { view: "unpaid", q: "mona", after: "c-1", hasFilters: true };

function renderDialog(props: Partial<Parameters<typeof OrdersExportDialog>[0]> = {}) {
  return render(
    <OrdersExportDialog open onOpenChange={vi.fn()} context={context} selectedIds={[]} t={en} {...props} />,
  );
}

describe("OrdersExportDialog (Shopify's Export orders)", () => {
  it("offers the five scopes and one format, with Selected disabled when nothing is selected", () => {
    renderDialog();
    for (const name of ["Current page", "All orders", "Orders matching your search", "Orders by date"]) {
      expect(screen.getByRole("radio", { name })).toBeEnabled();
    }
    expect(screen.getByRole("radio", { name: "Selected: 0 orders" })).toBeDisabled();
    expect(screen.getByText("CSV for Excel")).toBeInTheDocument();
  });

  it("hides 'matching your search' when no search or filter is active", () => {
    renderDialog({ context: { view: "all", hasFilters: false } });
    expect(screen.queryByRole("radio", { name: "Orders matching your search" })).toBeNull();
  });

  it("submits a GET to /orders/export carrying the list's view, search, cursor and the selection", () => {
    const { container } = renderDialog({ selectedIds: ["o-1", "o-2"], defaultScope: "selected" });
    const form = container.ownerDocument.querySelector("form");
    expect(form).toHaveAttribute("action", "/orders/export");
    expect(form).toHaveAttribute("method", "get");
    expect(screen.getByRole("radio", { name: "Selected: 2 orders" })).toBeChecked();
    const hidden = Object.fromEntries(
      [...(form?.querySelectorAll("input[type=hidden]") ?? [])].map((input) => [
        input.getAttribute("name"),
        input.getAttribute("value"),
      ]),
    );
    expect(hidden).toEqual({ view: "unpaid", q: "mona", after: "c-1", ids: "o-1,o-2" });
  });

  it("asks for both dates, in order, before exporting by date", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: "Orders by date" }));
    const submit = screen.getByRole("button", { name: "Export orders" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-31" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-01" } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-01" } });
    expect(submit).toBeEnabled();
  });
});
```

Run: `pnpm --filter admin-web exec vitest run src/components/orders/orders-export-dialog.test.tsx` — Expected: FAIL.

- [ ] **Step 11: Implement the dialog and the Export button**

`apps/admin-web/src/components/orders/orders-export-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { DownloadIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@platform/ui";
import type { Dictionary } from "@/messages/en";

export type ExportScope = "current_page" | "all" | "selected" | "matching" | "dates";

/** What the list is showing — carried into the export so "Current page"/"matching" mean the same rows. */
export interface OrdersExportContext {
  readonly view: string;
  readonly q?: string;
  readonly status?: string;
  readonly after?: string;
  readonly hasFilters: boolean;
}

/**
 * Shopify's "Export orders" dialog (spec §1.5). A native GET form to the `/orders/export` route handler:
 * the browser downloads the file and the page stays. Format: one, "CSV for Excel".
 */
export function OrdersExportDialog({
  open,
  onOpenChange,
  context,
  selectedIds,
  defaultScope,
  t,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly context: OrdersExportContext;
  readonly selectedIds: readonly string[];
  readonly defaultScope?: ExportScope;
  readonly t: Dictionary;
}) {
  const e = t.ordersExport;
  const [scope, setScope] = useState<ExportScope>(defaultScope ?? (selectedIds.length > 0 ? "selected" : "current_page"));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const canSubmit = scope !== "dates" || (from.length > 0 && to.length > 0 && from <= to);
  const options: readonly { value: ExportScope; label: string; disabled: boolean }[] = [
    { value: "current_page", label: e.currentPage, disabled: false },
    { value: "all", label: e.all, disabled: false },
    { value: "selected", label: e.selected.replace("{count}", String(selectedIds.length)), disabled: selectedIds.length === 0 },
    ...(context.hasFilters ? [{ value: "matching" as const, label: e.matching, disabled: false }] : []),
    { value: "dates", label: e.dates, disabled: false },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{e.title}</DialogTitle>
          <DialogDescription>{e.cap}</DialogDescription>
        </DialogHeader>
        <form method="get" action="/orders/export" onSubmit={() => onOpenChange(false)} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{e.scopeLegend}</legend>
            {options.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="scope"
                  value={option.value}
                  checked={scope === option.value}
                  disabled={option.disabled}
                  onChange={() => setScope(option.value)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          {scope === "dates" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="orders-export-from">{e.from}</Label>
                <Input id="orders-export-from" type="date" name="from" value={from} onChange={(event) => setFrom(event.target.value)} required />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="orders-export-to">{e.to}</Label>
                <Input id="orders-export-to" type="date" name="to" value={to} onChange={(event) => setTo(event.target.value)} required />
              </div>
            </div>
          )}
          <p className="text-sm">
            <span className="text-muted-foreground">{e.formatLabel}</span> {e.format}
          </p>
          <input type="hidden" name="view" value={context.view} />
          {context.q !== undefined && <input type="hidden" name="q" value={context.q} />}
          {context.status !== undefined && <input type="hidden" name="status" value={context.status} />}
          {context.after !== undefined && <input type="hidden" name="after" value={context.after} />}
          {selectedIds.length > 0 && <input type="hidden" name="ids" value={selectedIds.join(",")} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {e.cancel}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {e.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The page header's secondary "Export" button. */
export function OrdersExportButton({ context, t }: { readonly context: OrdersExportContext; readonly t: Dictionary }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <DownloadIcon aria-hidden="true" />
        {t.ordersPage.export}
      </Button>
      {open && <OrdersExportDialog open onOpenChange={setOpen} context={context} selectedIds={[]} t={t} />}
    </>
  );
}
```

(`Button`'s default variant is the primary one — check `create-menu.tsx` and pass `variant="primary"`
on Submit if the default is not primary.) Run the dialog test — Expected: PASS.

- [ ] **Step 12: Wire Export into the table and the page**

`orders-table.tsx`: add the prop `readonly exportContext?: OrdersExportContext;`, state
`const [exportOpen, setExportOpen] = useState(false);`, pass
`onExportSelected={exportContext === undefined ? undefined : () => setExportOpen(true)}` to
`OrdersBulkBar`, and render after the `Table`:

```tsx
      {exportOpen && exportContext !== undefined && (
        <OrdersExportDialog
          open
          onOpenChange={setExportOpen}
          context={exportContext}
          selectedIds={selectedOrders.map((order) => order.id)}
          defaultScope="selected"
          t={t}
        />
      )}
```

Add to `orders-table.test.tsx`:

```tsx
  it("offers Export selected when the page passes its export context, preselecting the selection", () => {
    render(<OrdersTable orders={two()} t={en} locale="en" now={NOW} exportContext={{ view: "all", hasFilters: false }} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select order 1001" }));
    fireEvent.click(screen.getByRole("button", { name: "Export selected" }));
    expect(screen.getByRole("radio", { name: "Selected: 1 orders" })).toBeChecked();
  });
```

`page.tsx`:
- `searchParams` gains `readonly exportError?: string;`;
- build once: `const exportContext = { view, q: params.q, status: params.status, after: params.after, hasFilters: Boolean(params.q) || Boolean(params.status) || view !== "all" };`
  (omit keys whose value is `undefined` if the props type is strict);
- header buttons: `<OrdersExportButton context={exportContext} t={t} />` before Create order;
- under the toolbar, when `params.exportError` is `too_many`, `failed` or `invalid`:

```tsx
        {exportError !== undefined && (
          <p role="alert" className="bg-warning-subtle text-warning-foreground rounded-2xl px-4 py-3 text-base">
            {t.ordersExport.errors[exportError]}
          </p>
        )}
```

  with `const exportError = (["too_many", "failed", "invalid"] as const).find((e) => e === params.exportError);`;
- pass `exportContext` through `OrdersResults` to `OrdersTable`.

- [ ] **Step 13: Run admin-web, typecheck, lint**

Run: `pnpm --filter admin-web test && pnpm --filter admin-web typecheck && pnpm --filter admin-web lint`
Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add apps/admin-web/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin-web): export orders as a courier-ready csv

Shopify's Export dialog (current page, all, selected, matching search, by date) posts to a
route handler that pages export rows 250 at a time, caps at 5,000 and answers a UTF-8 BOM
CSV: localized headers and province names, plain amounts, shop-time dates, RFC 4180
quoting and a formula guard that keeps +20 phones as typed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: admin-web — packing slips page and Archive on the order page

Model tier: **standard**.

**Files:**
- Modify: `apps/admin-web/src/lib/api/orders.ts`, `orders.test.ts`
- Modify: `apps/admin-web/src/app/orders/actions.ts`, `actions.test.ts`
- Create: `apps/admin-web/src/components/orders/packing-slip.tsx`, `packing-slip.test.tsx`
- Create: `apps/admin-web/src/components/orders/auto-print.tsx`, `auto-print.test.tsx`
- Create: `apps/admin-web/src/app/orders/packing-slips/page.tsx`
- Modify: `apps/admin-web/src/components/orders/order-header.tsx`, `order-header.test.tsx`
- Modify: `apps/admin-web/src/components/orders/order-header-actions.tsx`, `order-header-actions.test.tsx`
- Modify: `apps/admin-web/src/messages/en.ts`, `ar.ts`

**Interfaces:**
- Consumes: `GET /orders/packing-slips`, `POST /orders/:orderId/archive|unarchive`, `archivedAt` on the detail (Task 3/6), `parseOrderIds` (Task 7), `storeSettingsOrDefaults`, `formatCurrency`, `formatLongDate`, `formatNumber`.
- Produces:
  - `lib/api/orders.ts`: `PackingSlipDto`, `fetchPackingSlips(ids): Promise<{ outcome: "ok"; slips } | { outcome: "unauthorized" } | { outcome: "error"; message }>`, `archiveOrder(orderId, key)`, `unarchiveOrder(orderId, key)`, `OrderDetailDto.archivedAt?: string | null`.
  - `archiveOrderAction`, `unarchiveOrderAction` (FormData `orderId`) → `FormState`.
  - `PackingSlip` props `{ slip, shopName, t, locale }`; `AutoPrint` (no props).
  - `OrderMoreActions` gains `archived: boolean`.
  - **Part 2 extends additively:** the slip already renders `slip.note` when present; Part 2 only fills it server-side.

- [ ] **Step 1: Messages**

`en.ts` — new top-level `packingSlips` and three `orderPage` keys:

```ts
  /** Order operations Part 1 — the printable packing slips. */
  packingSlips: {
    title: "Packing slips",
    orderLabel: "Order #{orderNumber}",
    shipTo: "Ship to",
    items: "Items",
    quantity: "Qty",
    sku: "SKU {sku}",
    note: "Note",
    collect: "Collect: {amount}",
    empty: "No orders to print.",
    tooMany: "Print up to 50 orders at a time.",
    error: "Couldn't load the packing slips. Try again.",
  },
// inside orderPage:
    archive: "Archive",
    unarchive: "Unarchive",
    archiving: "Archiving…",
```

`ar.ts`:

```ts
  packingSlips: {
    title: "قسائم التعبئة",
    orderLabel: "الطلب #{orderNumber}",
    shipTo: "الشحن إلى",
    items: "المنتجات",
    quantity: "الكمية",
    sku: "رمز المنتج {sku}",
    note: "ملاحظة",
    collect: "تحصيل: {amount}",
    empty: "لا توجد طلبات للطباعة.",
    tooMany: "اطبع حتى 50 طلبًا في كل مرة.",
    error: "تعذّر تحميل قسائم التعبئة. حاول مرة أخرى.",
  },
// inside orderPage:
    archive: "أرشفة",
    unarchive: "إلغاء الأرشفة",
    archiving: "جارٍ الحفظ…",
```

- [ ] **Step 2: API calls and server actions (tests first)**

Append to `apps/admin-web/src/lib/api/orders.test.ts` (import `archiveOrder, fetchPackingSlips`):

```ts
describe("fetchPackingSlips / archiveOrder (order operations Part 1)", () => {
  it("asks for the slips of the ids as one comma list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { slips: [] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchPackingSlips(["a", "b"])).toEqual({ outcome: "ok", slips: [] });
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/v1\/orders\/packing-slips\?ids=a,b$/);
  });

  it("archives through POST /orders/:id/archive with the idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { orderId: "o-1", archivedAt: "x" }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await archiveOrder("o-1", "key-1")).outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/orders\/o-1\/archive$/);
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });
});
```

Append to `apps/admin-web/src/app/orders/actions.test.ts` (add `archiveOrder`, `unarchiveOrder` to the
hoisted `orders` mock and the `@/lib/api/orders` factory; import the two actions):

```ts
describe("archiveOrderAction / unarchiveOrderAction", () => {
  beforeEach(() => {
    orders.archiveOrder.mockReset().mockResolvedValue({ outcome: "ok", data: {} });
    orders.unarchiveOrder.mockReset().mockResolvedValue({ outcome: "ok", data: {} });
  });

  it("archives the order named in the form and refreshes the list and the page", async () => {
    expect(await archiveOrderAction(idle, form({ orderId: "order-1" }))).toEqual({ status: "success" });
    expect(orders.archiveOrder).toHaveBeenCalledWith("order-1", expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/orders");
    expect(revalidatePath).toHaveBeenCalledWith("/orders/order-1");
  });

  it("unarchives, and refuses a form without an order id", async () => {
    expect(await unarchiveOrderAction(idle, form({ orderId: "order-1" }))).toEqual({ status: "success" });
    expect((await archiveOrderAction(idle, form({}))).status).toBe("error");
  });
});
```

(Extend Task 7's hoisted mock to `const orders = vi.hoisted(() => ({ bulkOrders: vi.fn(), archiveOrder: vi.fn(), unarchiveOrder: vi.fn() }));`
and map all three in the `@/lib/api/orders` factory.)

Run both files — Expected: FAIL.

In `lib/api/orders.ts`:

```ts
// OrderDetailDto gains:
  /** Order operations Part 1: when the order was archived; null/absent when not (an older API omits it). */
  readonly archivedAt?: string | null;

/** A printable packing slip (`GET /orders/packing-slips`). */
export interface PackingSlipDto {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly createdAt: string;
  readonly shipTo: {
    readonly name: string | null;
    readonly phone: string | null;
    readonly line1: string;
    readonly line2: string | null;
    readonly city: string;
    readonly province: string | null;
    readonly postalCode: string;
    readonly country: string;
  };
  readonly lines: readonly OrderExportLineDto[];
  readonly note: string | null;
  readonly codAmountMinor: number;
  readonly currency: string;
}

function isPackingSlips(value: unknown): value is { readonly slips: readonly PackingSlipDto[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { slips?: unknown }).slips);
}

export async function fetchPackingSlips(
  ids: readonly string[],
): Promise<
  | { readonly outcome: "ok"; readonly slips: readonly PackingSlipDto[] }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string }
> {
  const result = await getAdminApi(
    `/api/v1/orders/packing-slips?ids=${ids.map(encodeURIComponent).join(",")}`,
    isPackingSlips,
  );
  if (result.outcome === "ok") return { outcome: "ok", slips: result.data.slips };
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  return { outcome: "error", message: result.outcome === "not_found" ? "Not found" : result.message };
}

/** `POST /orders/:orderId/archive` (`idempotent: true`, `orders:archive`). */
export function archiveOrder(orderId: string, idempotencyKey: string): Promise<MutationResult<unknown>> {
  return mutateAdminApi(orderPath(orderId, "/archive"), { method: "POST", idempotencyKey }, isUnknown);
}

/** `POST /orders/:orderId/unarchive` (`idempotent: true`, `orders:archive`). */
export function unarchiveOrder(orderId: string, idempotencyKey: string): Promise<MutationResult<unknown>> {
  return mutateAdminApi(orderPath(orderId, "/unarchive"), { method: "POST", idempotencyKey }, isUnknown);
}
```

In `app/orders/actions.ts` (import `archiveOrder`, `unarchiveOrder`, and `type MutationResult` from `@/lib/api/client`):

```ts
async function setArchived(
  formData: FormData,
  call: (orderId: string, idempotencyKey: string) => Promise<MutationResult<unknown>>,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  if (orderId.length === 0) return { status: "error", message: t.invalid, fieldErrors: {} };
  const result = await call(orderId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/orders");
    revalidatePath(`/orders/${orderId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** "More actions → Archive" on the order page (order operations Part 1). */
export async function archiveOrderAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return setArchived(formData, archiveOrder);
}

export async function unarchiveOrderAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return setArchived(formData, unarchiveOrder);
}
```

Run both test files — Expected: PASS. Run `src/lib/api/route-contract.test.ts` too — Expected: PASS.

- [ ] **Step 3: Write the failing slip and auto-print tests**

`apps/admin-web/src/components/orders/packing-slip.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PackingSlipDto } from "@/lib/api/orders";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { PackingSlip } from "./packing-slip";

function slip(overrides: Partial<PackingSlipDto> = {}): PackingSlipDto {
  return {
    orderId: "o-1",
    orderNumber: "1001",
    createdAt: "2026-10-18T09:05:00.000Z",
    shipTo: { name: "Mona Ali", phone: "+201012345678", line1: "1 Nile St", line2: null, city: "Cairo", province: "EG-C", postalCode: "11511", country: "EG" },
    lines: [
      { title: "T-shirt", variantTitle: "L", sku: "SKU-1", quantity: 2 },
      { title: "Cap", variantTitle: null, sku: null, quantity: 1 },
    ],
    note: null,
    codAmountMinor: 125000,
    currency: "EGP",
    ...overrides,
  };
}

describe("PackingSlip (order operations Part 1)", () => {
  it("prints the shop, the order, the ship-to block, the lines and the cash to collect", () => {
    render(<PackingSlip slip={slip()} shopName="Morbeh Shop" t={en} locale="en" />);
    expect(screen.getByText("Morbeh Shop")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Order #1001" })).toBeInTheDocument();
    expect(screen.getByText("Mona Ali")).toBeInTheDocument();
    expect(screen.getByText("+201012345678")).toBeInTheDocument();
    expect(screen.getByText("Cairo, Cairo")).toBeInTheDocument();
    expect(screen.getByText("T-shirt")).toBeInTheDocument();
    expect(screen.getByText("SKU SKU-1")).toBeInTheDocument();
    expect(screen.getByText(/^Collect: /)).toHaveTextContent("1,250.00");
  });

  it("has no Collect line when nothing is due on delivery", () => {
    render(<PackingSlip slip={slip({ codAmountMinor: 0 })} shopName="Shop" t={en} locale="en" />);
    expect(screen.queryByText(/^Collect: /)).toBeNull();
  });

  it("names the province in Arabic for an Arabic admin", () => {
    render(<PackingSlip slip={slip()} shopName="Shop" t={ar} locale="ar" />);
    expect(screen.getByText(/القاهرة/)).toBeInTheDocument();
  });
});
```

`apps/admin-web/src/components/orders/auto-print.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { AutoPrint } from "./auto-print";

describe("AutoPrint", () => {
  it("opens the print dialog exactly once, even under StrictMode's double effects", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(
      <StrictMode>
        <AutoPrint />
      </StrictMode>,
    );
    expect(print).toHaveBeenCalledTimes(1);
  });
});
```

Run both — Expected: FAIL.

- [ ] **Step 4: Implement the slip, auto-print and the page**

`apps/admin-web/src/components/orders/packing-slip.tsx`:

```tsx
import { provinceName } from "@platform/regions";
import type { PackingSlipDto } from "@/lib/api/orders";
import { formatCurrency, formatLongDate, formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/** One printed slip (one per page: `break-after-page`). "Collect: …" only when cash is due on delivery. */
export function PackingSlip({
  slip,
  shopName,
  t,
  locale,
}: {
  readonly slip: PackingSlipDto;
  readonly shopName: string;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const p = t.packingSlips;
  const to = slip.shipTo;
  const cityLine = [to.city, to.province === null ? null : provinceName(to.province, locale)]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(", ");
  return (
    <article className="flex break-after-page flex-col gap-5 p-8 print:p-0">
      <header className="border-border flex items-start justify-between gap-4 border-b pb-3">
        <div>
          <p className="text-lg font-semibold">{shopName}</p>
          <h2 className="text-base font-medium">{p.orderLabel.replace("{orderNumber}", slip.orderNumber)}</h2>
        </div>
        <p className="text-sm">{formatLongDate(locale, slip.createdAt)}</p>
      </header>
      <section>
        <h3 className="mb-1 text-sm font-semibold">{p.shipTo}</h3>
        <address className="text-sm not-italic leading-6">
          {to.name !== null && <div>{to.name}</div>}
          {to.phone !== null && <div dir="ltr" className="text-start">{to.phone}</div>}
          <div>{to.line1}</div>
          {to.line2 !== null && <div>{to.line2}</div>}
          <div>{cityLine}</div>
          <div>{[to.postalCode, to.country].filter((part) => part.length > 0).join(" ")}</div>
        </address>
      </section>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-1 text-start font-semibold">{p.items}</th>
            <th className="py-1 text-end font-semibold">{p.quantity}</th>
          </tr>
        </thead>
        <tbody>
          {slip.lines.map((line, index) => (
            <tr key={`${line.title}-${index}`} className="border-border border-b">
              <td className="py-1">
                <div>{line.title}</div>
                {line.variantTitle !== null && <div className="text-muted-foreground">{line.variantTitle}</div>}
                {line.sku !== null && <div className="text-muted-foreground">{p.sku.replace("{sku}", line.sku)}</div>}
              </td>
              <td className="py-1 text-end tabular-nums">{formatNumber(locale, line.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {slip.note !== null && (
        <section>
          <h3 className="mb-1 text-sm font-semibold">{p.note}</h3>
          <p className="whitespace-pre-wrap text-sm">{slip.note}</p>
        </section>
      )}
      {slip.codAmountMinor > 0 && (
        <p className="border-foreground rounded-md border-2 px-3 py-2 text-lg font-bold">
          {p.collect.replace("{amount}", formatCurrency(locale, slip.codAmountMinor, slip.currency))}
        </p>
      )}
    </article>
  );
}
```

`apps/admin-web/src/components/orders/auto-print.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";

/** Opens the browser's print dialog once the slips are on screen (once, even under StrictMode). */
export function AutoPrint() {
  const printed = useRef(false);
  useEffect(() => {
    if (printed.current) return;
    printed.current = true;
    window.print();
  }, []);
  return null;
}
```

`apps/admin-web/src/app/orders/packing-slips/page.tsx` (a server page OUTSIDE `AppShell`; the
middleware still requires a session for it):

```tsx
import { cookies } from "next/headers";
import { AutoPrint } from "@/components/orders/auto-print";
import { PackingSlip } from "@/components/orders/packing-slip";
import { fetchPackingSlips } from "@/lib/api/orders";
import { storeSettingsOrDefaults } from "@/lib/api/store-settings";
import { DEFAULT_LOCALE, dictionaryFor, directionFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { parseOrderIds } from "@/lib/orders/order-views";

const MAX_SLIPS = 50;

function SlipsMessage({ text }: { readonly text: string }) {
  return <p role="note" className="text-muted-foreground p-8 text-center text-base">{text}</p>;
}

/** Packing slips for up to 50 orders (`?ids=a,b`), one per printed page, printing on open (spec §1.5). */
export default async function PackingSlipsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly ids?: string }>;
}) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const { ids: raw } = await searchParams;
  const ids = parseOrderIds(raw, MAX_SLIPS);
  if (ids === null) {
    const tooMany = (parseOrderIds(raw, Number.MAX_SAFE_INTEGER)?.length ?? 0) > MAX_SLIPS;
    return <SlipsMessage text={tooMany ? t.packingSlips.tooMany : t.packingSlips.empty} />;
  }
  const [result, settings] = await Promise.all([fetchPackingSlips(ids), storeSettingsOrDefaults()]);
  if (result.outcome !== "ok") return <SlipsMessage text={t.packingSlips.error} />;
  if (result.slips.length === 0) return <SlipsMessage text={t.packingSlips.empty} />;
  return (
    <main dir={directionFor(locale)} className="bg-background text-foreground mx-auto max-w-3xl print:max-w-none">
      <style>{"@page { margin: 12mm; }"}</style>
      <h1 className="sr-only">{t.packingSlips.title}</h1>
      {result.slips.map((slip) => (
        <PackingSlip key={slip.orderId} slip={slip} shopName={settings.storeName} t={t} locale={locale} />
      ))}
      <AutoPrint />
    </main>
  );
}
```

Run the two component tests — Expected: PASS.

- [ ] **Step 5: Archive / Unarchive and the print link on the order page (tests first)**

In `order-header-actions.test.tsx`: add `archiveOrderAction`, `unarchiveOrderAction` to the hoisted
`actions` (reset to `{ status: "success" }`), pass `archived={false}` in every existing
`<OrderMoreActions …/>`, replace the "prints the packing slip with the browser's print dialog" test
and the first test's Print assertion with:

```tsx
  it("links Print packing slip to the print page for this order, in a new tab", () => {
    render(<OrderMoreActions orderId="order-1" canCancel archived={false} t={en} />);
    const link = screen.getByRole("link", { name: "Print packing slip" });
    expect(link).toHaveAttribute("href", "/orders/packing-slips?ids=order-1");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("offers Archive for an order that is not archived, and Unarchive for one that is", async () => {
    const { rerender } = render(<OrderMoreActions orderId="order-1" canCancel={false} archived={false} t={en} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(actions.archiveOrderAction).toHaveBeenCalledTimes(1));
    rerender(<OrderMoreActions orderId="order-1" canCancel={false} archived t={en} />);
    expect(screen.getByRole("button", { name: "Unarchive" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });
```

In `order-header.test.tsx`: add `archiveOrderAction: vi.fn(), unarchiveOrderAction: vi.fn()` to the
`@/app/orders/actions` mock and append:

```tsx
  it("shows an Archived badge on an archived order", () => {
    render(<OrderHeader order={order({ archivedAt: "2026-10-18T09:00:00.000Z" })} t={en} locale="en" />);
    expect(screen.getByText("Archived")).toBeInTheDocument();
    render(<OrderHeader order={order({ id: "order-2", orderNumber: "1002" })} t={en} locale="en" />);
    expect(screen.getAllByText("Archived")).toHaveLength(1);
  });
```

Run both — Expected: FAIL.

`order-header-actions.tsx` — `OrderMoreActions` gains `archived` and renders, after the Cancel form:

```tsx
        {archived ? (
          <OrderArchiveForm orderId={orderId} action={unarchiveOrderAction} label={t.orderPage.unarchive} t={t} />
        ) : (
          <OrderArchiveForm orderId={orderId} action={archiveOrderAction} label={t.orderPage.archive} t={t} />
        )}
        <Button asChild variant="ghost" className="w-full justify-start">
          <a href={`/orders/packing-slips?ids=${encodeURIComponent(orderId)}`} target="_blank" rel="noopener">
            {t.orderPage.printPackingSlip}
          </a>
        </Button>
```

(the old `window.print()` button is removed) with:

```tsx
/** Archive / Unarchive (order operations Part 1): one form per action, each with its own pending state. */
function OrderArchiveForm({
  orderId,
  action,
  label,
  t,
}: {
  readonly orderId: string;
  readonly action: (previous: FormState, formData: FormData) => Promise<FormState>;
  readonly label: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" variant="ghost" className="w-full justify-start" loading={isPending} disabled={isPending}>
        {isPending ? t.orderPage.archiving : label}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive px-3 text-xs">{state.message}</p>
      )}
    </form>
  );
}
```

(import `archiveOrderAction, unarchiveOrderAction` with the existing actions.)

`order-header.tsx`: next to the two status badges,

```tsx
          {order.archivedAt ? <Badge variant="neutral">{t.ordersPage.archivedBadge}</Badge> : null}
```

(import `Badge` from `@platform/ui`) and
`<OrderMoreActions orderId={order.id} canCancel={canCancelFrom(order.status)} archived={Boolean(order.archivedAt)} t={t} />`.

Run both tests — Expected: PASS.

- [ ] **Step 6: Run admin-web, typecheck, lint**

Run: `pnpm --filter admin-web test && pnpm --filter admin-web typecheck && pnpm --filter admin-web lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin-web): packing slips and archive on the order page

Adds the print page for up to 50 orders (one slip per page, opens the print dialog, shows
the cash to collect on delivery), Archive/Unarchive under More actions with an Archived
badge in the header, and points Print packing slip at the print page.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Final verification (after Task 9)

- [ ] Run every touched package: `pnpm --filter @platform/db test`, `pnpm --filter @platform/auth test`,
  `pnpm --filter @platform/orders test`, `pnpm --filter @platform/payments test`,
  `pnpm --filter @platform/admin test`, `pnpm --filter admin-web test`, plus `typecheck` and `lint` for
  each, and `prisma validate` with the dummy URLs. All PASS.
- [ ] Deploy note for the owner (not run by the agent): apply
  `20261018000000_order_archive/migration.sql` from Railway's Console before the release that reads
  `archived_at`.

## Spec coverage (self-review)

| Spec item | Task |
| --- | --- |
| §1.1 tabs, `?view=`, legacy `fulfillment=unfulfilled`, Filter button, Home link | 1, 3, 7 |
| §1.2 `archived_at` column + index, mapper never writes it, port, Prisma/in-memory, ArchiveOrders/UnarchiveOrders idempotent | 1, 2 |
| §1.3 `OrderListQuery` fields, NOT EXISTS predicates, in-memory mirror + shared cases, recipient name/phone search (cap 500), `listUnfulfilledOrders` passes `archived: false` | 1, 3 |
| §1.4 GET /orders `view` + `archivedAt`; archive/unarchive routes; POST /orders/bulk (per-action permission, per-order results, 50 cap, idempotent); export-rows; packing-slips; `GetPaymentIntentsByIds` + `paymentIntentsOf` | 3, 4, 5, 6 |
| §1.5 header (Export, Create order), tabs, page size 50, client table with selection, Archived badge, bulk bar + admin-only cash, toast + details; export dialog (5 scopes, CSV for Excel, BOM), route handler (250 per page, 5,000 cap), CSV format/guard/columns; packing slips page + order page entry; order page Archive/Unarchive + badge | 7, 8, 9 |
| §1.6 tests: repository predicates (both stores, same fixture), `save()` vs `archived_at`, tenant isolation of `setArchived`; use-case idempotency; routes (view mapping, bulk mix/permissions/51/viewer, export filters/ids/dates/page size/COD rule, slips cap); admin-web (tabs, selection/bar, dialog, CSV builder, slip render) | 1–9 |
| Permissions table (`orders:archive`, `orders:export`, `payments:confirm_cod_collection` admin-only) | 3, 5, 6 |
| Security: tenant scoping, money via existing guarded calls, PII (export operator/admin, capped, guarded), annotations never touch `version` | 1, 2, 5, 6, 8 |


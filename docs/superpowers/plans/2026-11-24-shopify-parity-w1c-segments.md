# Shopify parity — Wave 1c: Customers > Segments

`OPUS: AGREED · Sol: AGREED (w1c/plan-review-3.md, round 3)`

**Branch / worktree:** `morbeh/shopify-parity-w1c` in `F:/New folder/morbeh-shopify-parity-w1b` (dependencies installed), BASE `ec8e599d` (origin/main with Waves 1a and 1b merged).
**Evidence:** `docs/superpowers/plans/w1c/survey-segments.md` (read-only survey, file:line). Wave 1b conventions: `docs/superpowers/plans/2026-11-23-shopify-parity-w1b.md` and the shipped `apps/admin/src/http/customer-routes.ts`, `apps/admin-web/src/app/customers/*`.

**Owner decisions (defaults taken; owner may reverse):**

- D8 Wave 1c = Segments only. Users & permissions (staff invite, roles, deactivate, own 2FA, login code step, require-2FA policy, activity log) becomes Wave 1d with its own plan, because it changes the login flow and needs a security migration.
- D9 Shopify-style FIXED filters only (no query language, no `@platform/rules`); conditions are ANDed (1..10). The customer-360 `SegmentDefinition` code is left untouched (it cannot express these facts; survey §7.1).
- D10 Four read-only default segments (Shopify's): purchased at least once, email subscribers, purchased more than once, haven't purchased. "Abandoned checkouts in the last 30 days" is deferred.
- D11 Membership is computed live by SQL on every read (no stored membership, no entered/exited history, no segment automations in 1c).

**Amendment precedence:** round 2 > round 1 > original task text; within a task a later block wins over an earlier one.

**Implementers:** Task 1 `terra` (identity: migration, domain, repository, CRUD use cases), Task 2 `sonnet` (apps/admin: SQL segment query, controller, routes; backend, even number), Task 3 `sonnet` (admin-web UI-only).

## Global Constraints (binding for every task)

- G1 Hard rules: never `git stash/checkout/reset/force-push`, never `--no-verify`; stage only the task's files; commit identity `git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com"`, conventional type, lowercase subject, trailer `Co-Authored-By: <your model>`; `git commit` in the foreground with a ≥400 s tool timeout, after `export PATH="$TMPDIR/pnpmshim:$PATH"`. Never skip hooks. Do NOT run `next build`. Dependencies are installed; do not run `pnpm install`.
- G2 Exactly ONE migration, in Task 1, hand-written and additive; never run `prisma migrate`/`db push` or connect to any database.
- G3 Tenant comes from `context.tenantId`, never the body. Validation through `defineRoute` zod schemas for structure (transport 422 `VALIDATION`) plus domain validation for semantics (422 with field names); no handler-side 400.
- G4 Writes: `POST` + `idempotent: true` (update = `POST /customer-segments/:segmentId`, delete = `POST /customer-segments/:segmentId/delete`), matching the repo convention used by collections.
- G5 Permissions: reads `customers:read`; writes `customers:manage_segments` (operator holds it via `customers:*`, viewer denied, admin `*:*`). No role-table edit. Do not use `customer360:*`.
- G6 Raw SQL: every table reference carries its own `tenant_id = $n`; executed inside `runReadScoped(prisma, tenantId, …)` (from `@platform/db`) so RLS is the backstop. SQL text is built ONLY from closed switches; every user value is a bound positional parameter.
- G7 Brand lock and i18n as in Wave 1b: `@platform/ui` components, semantic tokens, Lucide icons, no hex/font/radius/button-shape change; new strings in `en.ts` AND `ar.ts`; logical CSS; names/emails/tags in `<bdi dir="auto">`.
- G8 admin-web UI rules: destructive confirms use the real `Dialog` (title, `DialogDescription`, initial focus on Cancel, Escape closes, focus returns to the trigger, trigger mounted until restored); server actions `revalidatePath` every affected path after EVERY API-reaching write, ok or not; dialog / non-disclosure tests query `document.body`; `expect.hasAssertions()` inside each test or `beforeEach`; viewers see no write controls (`canEdit = role === "operator" || role === "admin"` from `highestRole((await readSession())?.roles ?? [])`, as in `app/settings/policies/page.tsx`).
- G9 Every command below is complete and runnable in bash; prefix `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false;` and PNPM = `node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs`.

---

### Task 1 — Identity: segment model, filter vocabulary, repository, CRUD use cases (implementer: terra)

**Migration** `packages/db/prisma/schema/migrations/20261125000000_customer_segments/migration.sql` (header in the house style of `20261124000000_customer_profile_tags`: hand-written, NOT applied by the agent, owner deploys before the release, additive only):

```sql
CREATE TABLE "identity"."customer_segments" (
  "id" UUID NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "name_key" TEXT NOT NULL,
  "conditions" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_segments_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "customer_segments_tenant_id_name_key_key" ON "identity"."customer_segments"("tenant_id", "name_key");
CREATE INDEX "customer_segments_tenant_id_created_at_idx" ON "identity"."customer_segments"("tenant_id", "created_at");
-- ENABLE + FORCE ROW LEVEL SECURITY, DROP POLICY IF EXISTS tenant_isolation, CREATE POLICY tenant_isolation
-- FOR ALL USING / WITH CHECK (tenant_id = current_setting('app.tenant_id', true)) — copied from customer_tags.
```

Prisma model in `identity.prisma`, exactly:

```prisma
model CustomerSegment {
  id         String   @id @db.Uuid
  tenantId   String   @map("tenant_id")
  name       String
  nameKey    String   @map("name_key")
  conditions Json
  version    Int      @default(1)
  createdBy  String?  @map("created_by")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@unique([tenantId, nameKey])
  @@index([tenantId, createdAt])
  @@map("customer_segments")
  @@schema("identity")
}
```

`packages/db/src/schema-migration-consistency.test.ts`: new describe `identity customer segments (20261125000000)` modelled on the `identity customer profile and tags (20261124000000)` block (~line 367): columns + types + defaults, PK, unique `(tenant_id, name_key)`, index `(tenant_id, created_at)`, ENABLE + FORCE RLS, full USING/WITH CHECK predicate.

**Domain** `services/identity/src/domain/customer-segment.ts` (pure):

```ts
export type SegmentCmp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
export type SegmentCondition =
  | { readonly field: "orders_count"; readonly op: SegmentCmp; readonly value: number } // integer 0..1_000_000
  | { readonly field: "amount_spent"; readonly op: SegmentCmp; readonly valueMinor: number } // integer 0..10^12
  | {
      readonly field: "last_order_date";
      readonly op: "within_last_days" | "not_within_last_days";
      readonly days: number;
    } // 1..3650
  | {
      readonly field: "last_order_date";
      readonly op: "on_or_after" | "before";
      readonly date: string;
    } // YYYY-MM-DD, a real date
  | { readonly field: "last_order_date"; readonly op: "never" }
  | { readonly field: "email_subscribed"; readonly value: boolean }
  | { readonly field: "sms_subscribed"; readonly value: boolean }
  | {
      readonly field: "tags";
      readonly op: "has_any" | "has_all" | "has_none";
      readonly values: readonly string[];
    } // 1..20, stored normalized with normalizeTag; matched by tagKeyOf
  | { readonly field: "country"; readonly op: "in" | "not_in"; readonly values: readonly string[] } // 1..20, /^[A-Z]{2}$/ after trim+upper-case
  | {
      readonly field: "created_date";
      readonly op: "within_last_days" | "not_within_last_days";
      readonly days: number;
    }
  | { readonly field: "created_date"; readonly op: "on_or_after" | "before"; readonly date: string }
  | { readonly field: "language"; readonly op: "eq" | "neq"; readonly value: "en" | "ar" }
  | { readonly field: "language"; readonly op: "unset" };
export const MAX_SEGMENT_CONDITIONS = 10;
export const MAX_SEGMENT_NAME_LENGTH = 100; // code points after trim
export const MAX_CUSTOM_SEGMENTS = 100; // per tenant
export function parseSegmentConditions(
  raw: unknown,
): Result<readonly SegmentCondition[], ValidationError>;
export function segmentNameKey(name: string): string; // NFC, collapse whitespace, trim, toLowerCase
export interface DefaultSegment {
  readonly id: `default:${string}`;
  readonly key: string;
  readonly conditions: readonly SegmentCondition[];
}
export const DEFAULT_SEGMENTS: readonly DefaultSegment[];
export function isDefaultSegmentId(id: string): boolean; // starts with "default:"
```

`parseSegmentConditions` collects every problem into ONE `ValidationError("Invalid segment", issues)` with field paths `conditions`, `conditions.<i>`, `conditions.<i>.value|valueMinor|days|date|values|op|field`; 0 or more than 10 conditions → field `conditions`. Unknown field/op → field `conditions.<i>.field` / `.op`. Tags: each normalized with `normalizeTag` (from `./customer-annotations`), blanks rejected, de-duplicated by `tagKeyOf`, 1..20 after de-duplication, each ≤40 code points. Dates: `YYYY-MM-DD` that round-trips through `Date.UTC` (rejects `2026-02-30`). Countries: trim + upper-case, `/^[A-Z]{2}$/`, de-duplicated.
`DEFAULT_SEGMENTS` (in this order): `default:purchased_at_least_once` key `purchasedAtLeastOnce` `[{field:"orders_count",op:"gte",value:1}]`; `default:email_subscribers` key `emailSubscribers` `[{field:"email_subscribed",value:true}]`; `default:purchased_more_than_once` key `purchasedMoreThanOnce` `[{field:"orders_count",op:"gt",value:1}]`; `default:not_purchased` key `notPurchased` `[{field:"orders_count",op:"eq",value:0}]`.

`CustomerSegment` aggregate (same file or `customer-segment.aggregate.ts`): props `{ name: string; nameKey: string; conditions: readonly SegmentCondition[]; createdBy: string | null; createdAt: Date; updatedAt: Date }`, `version` from `AggregateRoot`; `static create(id, name, conditions, createdBy, now)`, `static reconstitute(id, name, conditions, version, createdBy, createdAt, updatedAt)`, `rename(name, now)`, `replaceConditions(conditions, now)`. No domain events.

**Port** `services/identity/src/domain/customer-segment-repository.ts`:

```ts
export interface CustomerSegmentRepository {
  list(tenantId: string, tx?: unknown): Promise<readonly CustomerSegment[]>; // ordered by nameKey asc
  findById(id: string, tenantId: string, tx?: unknown): Promise<CustomerSegment | null>; // non-UUID id → null without querying
  count(tenantId: string, tx?: unknown): Promise<number>;
  save(segment: CustomerSegment, tenantId: string, tx?: unknown): Promise<void>; // version 0 → create; else update WHERE version = expected, bump; 0 rows → ConcurrencyError; unique name_key violation → ConflictError("A segment with this name already exists")
  delete(
    id: string,
    expectedVersion: number,
    tenantId: string,
    tx?: unknown,
  ): Promise<"deleted" | "not_found" | "stale">;
}
```

Adapters: `prisma-customer-segment-repository.ts` (`{ prisma: Database }`; `save`/`delete` REQUIRE the UoW tx and throw `Error("PrismaCustomerSegmentRepository.<method> requires the unit of work's transaction client (ADR-0003).")` without it; reads fall back to `runReadScoped`; every where has `tenantId`) and `in-memory-customer-segment-repository.ts` (same semantics incl. unique name key, version check). Mapper validates stored `conditions` with `parseSegmentConditions`; an invalid stored row throws (corruption, not user input).

**Use cases** (`services/identity/src/application`, each `UseCase<In, Out, DomainError>` returning `Result`):

- `ListCustomerSegments {segments}` — `{ tenantId }` → `{ items: readonly SegmentView[] }` where `SegmentView = { id: string; kind: "default" | "custom"; key: string | null; name: string | null; version: number | null; conditions: readonly SegmentCondition[]; updatedAt: string | null }`; defaults first (in `DEFAULT_SEGMENTS` order, `name: null`, `key` set), then custom by `nameKey`.
- `GetCustomerSegment {segments}` — `{ tenantId; segmentId }` → `SegmentView`; default ids resolve from `DEFAULT_SEGMENTS`; unknown → NOT_FOUND.
- `CreateCustomerSegment {segments, unitOfWork, idGenerator, clock}` — `{ tenantId; name; conditions: unknown; createdBy: string | null }` → `{ segmentId }`. Validate name (trim, 1..100 code points, field `name`) and conditions together into ONE ValidationError; then in one UoW: `count ≥ 100` → `BusinessRuleError("A store can have at most 100 segments")`; save (ConflictError on duplicate name passes through as CONFLICT).
- `UpdateCustomerSegment {segments, unitOfWork, clock}` — `{ tenantId; segmentId; expectedVersion: number; name?: string; conditions?: unknown }` → `{ segmentId; version }`. Default id → `BusinessRuleError("Default segments can't be changed")`; neither key → ValidationError field `body`; validate; load; NOT_FOUND; `version !== expectedVersion` → `ConflictError("This segment was changed by someone else")` (CONFLICT); save.
- `DeleteCustomerSegment {segments, unitOfWork}` — `{ tenantId; segmentId; expectedVersion: number }` → `{ segmentId }`. Default id → BUSINESS_RULE; `not_found` → NOT_FOUND; `stale` → CONFLICT.
  New `CustomerSegmentController` in `services/identity/src/interfaces/customer-segment.controller.ts` with `list`, `get` (200), `create` (201), `update`, `delete` (200) via `present`; `WiredIdentity` gains `customerSegments: CustomerSegmentController`; `composition.ts` wires Prisma and in-memory branches; exports from `services/identity/src/index.ts` (types, `DEFAULT_SEGMENTS`, `parseSegmentConditions`, `isDefaultSegmentId`, controller, use cases).

**Tests (input → expected):** parse: every field's happy path; `orders_count` −1 / 1.5 → issue `conditions.0.value`; 11 conditions → `conditions`; unknown field → `conditions.0.field`; `date:"2026-02-30"` → `conditions.0.date`; tags `["VIP"," vip ","Cairo"]` → `["VIP","Cairo"]` (first spelling kept); 21 distinct tags → `conditions.0.values`; country `[" eg ","US"]` → `["EG","US"]`, `["EGY"]` → issue. Name key: `"  VIP   Buyers "` → `"vip buyers"`. Use cases: create ok; duplicate name (different case/spacing) → CONFLICT; 101st → BUSINESS_RULE; invalid name + invalid condition → ONE ValidationError with both fields; update stale version → CONFLICT; update default → BUSINESS_RULE; update `{}` → VALIDATION `body`; delete stale → CONFLICT, unknown → NOT_FOUND, default → BUSINESS_RULE; list order (4 defaults then custom by name); tenant isolation (other tenant's id → NOT_FOUND). Repository (in-memory + gated Prisma in a new `prisma-customer-segment-repository.integration.test.ts`, `describe.runIf(DATABASE_URL_TEST)` like the identity integration suites): round-trip, unique name per tenant (same name in two tenants ok), version CAS, required tx error, non-UUID id → null.

**Commands:**

- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/identity exec vitest run`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/db exec vitest run schema-migration-consistency`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/identity exec tsc --noEmit --incremental false`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin exec tsc --noEmit --incremental false`
- `cd "F:/New folder/morbeh-shopify-parity-w1b/packages/db" && DATABASE_URL="postgresql://u:p@localhost:5432/x" DIRECT_URL="postgresql://u:p@localhost:5432/x" node node_modules/prisma/build/index.js validate`
- `cd "F:/New folder/morbeh-shopify-parity-w1b/packages/db" && node node_modules/prisma/build/index.js generate`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs arch`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && node -e "import('./scripts/dev/check-prisma-tenant-where.mjs').then(async m=>console.log(JSON.stringify(await m.scanPrismaTenantWhere(process.cwd()))))"`
  Keep test fixtures that import `@platform/messaging` OUT of `src/application/` (dependency-cruiser rule `application-no-messaging-no-infra`); put shared fixtures in `services/identity/src/testing/`.

**Amendments (binding) — Plan review 1, Task 1 (the amendment wins over the task text above)**

_Plan review 1, finding 8 — persisted versions and snapshots._ Create: aggregate version 0 → row `version = 1`. Update: the loaded aggregate carries version v; `save` writes `version = v + 1` with `WHERE id = $id AND tenant_id = $t AND version = v` (0 rows → `ConcurrencyError`), and NEVER mutates the aggregate's readonly version. `CustomerSegmentRepository.save` returns `Promise<number>` = the persisted version (1 on create, v+1 on update); the update use case returns that number. The in-memory adapter stores immutable plain snapshots `{ id, tenantId, name, nameKey, conditions, version, createdBy, createdAt, updatedAt }` and returns freshly reconstituted aggregates on every read (never the stored reference). Parity tests (in-memory and gated Prisma): create → get v1; update expected 1 → response and get v2; update expected 2 → v3; two separately loaded v1 objects: the first save wins, the second fails with ConcurrencyError (use case → CONFLICT) and stored name/conditions stay the first writer's.

_Plan review 1, finding 6 — serialized cap._ Port gains `lockTenantSegments(tenantId: string, tx: unknown): Promise<void>`. Prisma: inside the required tx, `await client.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', 'identity.customer_segments:' + tenantId)` (throws the required-tx error without a tx). In-memory: resolves immediately (single-threaded). `CreateCustomerSegment` calls `lockTenantSegments` FIRST inside its UoW, then `count`, then `save`. Gated concurrent test at 99 segments: two different-name creates in parallel → exactly one ok and one BUSINESS_RULE, final count 100; tenant B can still create.

_Plan review 1, finding 10 — order of commands._ Edit schema + migration → `prisma validate` → `prisma generate` → tests and typechecks → `arch` → tenant scanner. DB-gated suites stay skipped locally (no DATABASE_URL_TEST; never point them at Supabase); they run in CI's disposable Postgres job.

**Amendments round 2 (binding) — Plan review 2, finding R6 (wins over Task 1's round-1 block)**

- Prisma `lockTenantSegments` executes the lock as a side effect, without reading its `void` result: `await client.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', 'identity.customer_segments:' + tenantId)` inside the required tx (same key, transaction-level lock, lock → count → save order unchanged). A recording-client unit test asserts this exact call happens before the count and the insert.
- In-memory `lockTenantSegments` is a real per-tenant mutex: the in-memory repository keeps `Map<tenantId, Promise<void>>` chains; `lockTenantSegments(tenantId, tx)` waits for the previous holder and registers a release that runs when the surrounding unit-of-work callback settles. Because `InMemoryUnitOfWork.run` only invokes the callback, implement the hold by exposing `withTenantSegmentsLock<T>(tenantId: string, fn: () => Promise<T>): Promise<T>` on the PORT (Prisma: `fn` runs after the advisory lock in the same tx — the use case passes the tx through; in-memory: queued mutex around `fn`). `CreateCustomerSegment` runs `count` + `save` INSIDE `withTenantSegmentsLock` within its UoW. In-memory concurrency test at 99: two parallel creates → outcomes one ok / one BUSINESS_RULE, final count 100; tenant B unaffected.

---

### Task 2 — apps/admin: live segment query, controller, routes (implementer: sonnet; backend)

**Orders exports.** Add to `services/orders/src/index.ts`: `export { CANCELLED_EVENT_TYPE, REFUNDED_EVENT_TYPES } from "./domain/order-statuses";` (no behaviour change).

**Port** (in `apps/admin/src/infrastructure/cross-context/customer-segment-query.ts`):

```ts
export interface SegmentMemberRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly isGuest: boolean;
  readonly ordersCount: number;
  readonly amountSpentMinor: number;
  readonly lastOrderAt: string | null;
  readonly emailSubscribed: boolean;
  readonly smsSubscribed: boolean;
}
export interface SegmentMembersInput {
  readonly tenantId: string;
  readonly conditions: readonly SegmentCondition[];
  readonly currency: string;
  readonly timezone: string;
  readonly now: Date;
  readonly first: number;
  readonly after?: string;
  readonly search?: string;
}
export interface SegmentMembersPage {
  readonly items: readonly SegmentMemberRow[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
  readonly total: number;
}
export interface CustomerSegmentQuery {
  members(input: SegmentMembersInput): Promise<SegmentMembersPage>;
}
export function compileSegmentQuery(input: SegmentMembersInput): {
  readonly listSql: string;
  readonly countSql: string;
  readonly params: readonly unknown[];
};
```

- `compileSegmentQuery` is pure and builds SQL text ONLY from fixed fragments chosen by closed switches over `field`/`op`, with positional placeholders `$1…$n`; every value (tenant, currency, timezone, numbers, dates, tag keys, country codes, search pattern, cursor, limit) goes into `params`. Shape (survey §7.6): CTE `oa` = per `customer_ref` over `orders.orders` in the shop `currency`, excluding orders with a cancelled event, with `orders_count`, `spent_minor` (refunded orders count 0, total from `totals->>'totalMinor'` else the item sum — the exact rule of `services/orders/src/infrastructure/prisma-sales-summary-query.ts`), `last_order_at = max(created_at)`; `FROM identity.customers c LEFT JOIN oa ON oa.customer_ref = c.id::text WHERE c.tenant_id = $1 AND c.deleted_at IS NULL AND <conditions>`. Subscriptions = latest `identity.consent_records` row per scope (`marketing` = email, `marketing_sms` = SMS) ordered `occurred_at DESC, id DESC`; no record = not subscribed. Tags = `EXISTS/NOT EXISTS` over `identity.customer_tags` by `tag_key = ANY($n)` (has_all = count of distinct matching keys = array length). Country = ANY address `upper(trim(a.country)) = ANY($n)` (`not_in` = NOT EXISTS). Days/dates: `within_last_days d` = `x >= ($now::timestamptz - make_interval(days => $d)) AT TIME ZONE 'UTC'`; calendar dates use the shop timezone like the sales summary (`(($date::date)::timestamp AT TIME ZONE $tz) AT TIME ZONE 'UTC'`); `last_order_date` conditions on `oa.last_order_at` treat no orders as NULL (so `never` = `oa.last_order_at IS NULL`, and `not_within_last_days` includes never-ordered customers). Search = `(c.name ILIKE $n OR c.email ILIKE $n)` with `%`/`_`/`\` escaped. Keyset: `ORDER BY c.id DESC`, `c.id < $n::uuid` when `after` is a UUID (non-UUID `after` → empty page), `LIMIT first + 1`. `countSql` = same FROM/WHERE without cursor/limit, `SELECT count(*)::bigint`.
- `PrismaCustomerSegmentQuery { prisma: Database }` runs both via `runReadScoped(prisma, tenantId, client => client.$queryRawUnsafe(sql, ...params))`, maps bigint → number, ISO dates. `UnavailableCustomerSegmentQuery` throws `AppError("Segments need the database", { code: "UNAVAILABLE" })` from `@platform/utils`.
- Wiring: `AdminHttpDeps` (`apps/admin/src/http/server.ts`) and the admin wiring deps gain optional `customerSegmentQuery?: CustomerSegmentQuery`; default = Prisma adapter when `deps.prisma` is set, else `UnavailableCustomerSegmentQuery`.

**Controller** `apps/admin/src/interfaces/customer-segments.admin-controller.ts` (deps `{ segments: CustomerSegmentController; query: CustomerSegmentQuery; tenancy: TenancyAdminController; guard: AdminGuard; clock: Clock }`), each method guards first: `list`, `get` (`customers:read`), `create`, `update`, `delete` (`customers:manage_segments`; `createdBy` = `principal.id`), `members(principal, { tenantId, segmentId, first, after?, search? })` and `preview(principal, { tenantId, conditions: unknown, first? })` (`customers:read`): resolve conditions (segment via `segments.get`, or `parseSegmentConditions` for preview → 422 field paths prefixed `conditions`), read `tenancy.getStoreRegion(principal, tenantId)` (non-200 returned as is), call `query.members`; an `UNAVAILABLE` AppError → 503 envelope. Add `customerSegments` to `WiredAdmin` in `apps/admin/src/composition.ts` next to `customers`.

**Routes** `apps/admin/src/http/customer-segment-routes.ts`, spread in `admin-routes.ts` right after `...customerRoutes(admin)`:

| Method                                                                                                                                                                                                           | Path                                    | Schema                                                                                                                                              | Permission                  | Response                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------- |
| GET                                                                                                                                                                                                              | `/customer-segments`                    | —                                                                                                                                                   | `customers:read`            | 200 `{ items: SegmentView[] }`                  |
| GET                                                                                                                                                                                                              | `/customer-segments/:segmentId`         | params `segmentId` string 1..100                                                                                                                    | `customers:read`            | 200 `SegmentView` / 404                         |
| POST                                                                                                                                                                                                             | `/customer-segments`                    | `{ name: z.string().max(1000), conditions: z.array(z.unknown()).max(50) }.strict()`                                                                 | `customers:manage_segments` | 201 `{ segmentId }`, 409 duplicate, 422         |
| POST                                                                                                                                                                                                             | `/customer-segments/preview`            | `{ conditions: z.array(z.unknown()).max(50), first: z.number().int().min(1).max(50).optional() }.strict()`                                          | `customers:read`            | 200 `SegmentMembersPage`                        |
| POST                                                                                                                                                                                                             | `/customer-segments/:segmentId`         | `{ expectedVersion: z.number().int().min(1), name: z.string().max(1000).optional(), conditions: z.array(z.unknown()).max(50).optional() }.strict()` | `customers:manage_segments` | 200 `{ segmentId, version }`, 409 stale/default |
| POST                                                                                                                                                                                                             | `/customer-segments/:segmentId/delete`  | `{ expectedVersion: z.number().int().min(1) }.strict()`                                                                                             | `customers:manage_segments` | 200, 409, 404                                   |
| GET                                                                                                                                                                                                              | `/customer-segments/:segmentId/members` | `first` 1..100 default 50, `after`, `search` 1..100                                                                                                 | `customers:read`            | 200 `SegmentMembersPage`                        |
| Register `/customer-segments/preview` BEFORE `/customer-segments/:segmentId`. All POSTs `idempotent: true` except `preview` (a read; NOT idempotent).                                                            |
| `GET /customers` gains optional `segmentId` (string 1..100): when present the handler answers from `customerSegments.members(...)` mapped to the existing list item shape `{ id, name, email }` plus `pageInfo`. |

**Tests:**

- `customer-segment-query.test.ts` (pure compiler): each condition kind produces its fixed fragment and pushes the expected params; an injection probe — tag value `"x'); DROP TABLE identity.customers; --"`, search `"%_\\"` — never appears in `listSql`/`countSql` and appears (escaped for search) only in `params`; every table alias in the SQL has a `tenant_id = $1` predicate (assert by counting occurrences of `"tenant_id" = $1` ≥ number of table references); `after` non-UUID → compile returns a query that cannot match (or the adapter short-circuits to an empty page — pick one and test it).
- `prisma-customer-segment-query.integration.test.ts` (`describe.runIf(DATABASE_URL_TEST)`, seeded two tenants via Prisma create calls on `identity.customers`, `customer_tags`, `consent_records`, `addresses`, `orders.orders` + `order_events`): orders_count / amount_spent with a cancelled and a refunded order; last_order_date within/not within/never; email/sms latest consent wins; tags any/all/none; country; created_date; language eq/unset; search; keyset pages + total; tenant B rows never returned.
- `customer-segment-routes.test.ts` (in-process `createAdminHttpApi`, real `RoleTableAccessControl` with admin/operator/viewer tokens, `crypto.randomUUID`, own Idempotency-Key per POST, an injected recording `customerSegmentQuery` fake): list shows 4 defaults; create 201 → get; duplicate name 409; invalid conditions 422 with `conditions.0.value`; update stale 409; update/delete default 409; delete 200 then get 404; viewer 403 on create/update/delete, 200 on list/get/members/preview; members passes the segment's conditions, shop currency/timezone and first/after/search to the fake; preview validates (422) before calling the fake; `GET /customers?segmentId=default:not_purchased` uses the fake; foreign tenant's segment id → 404; with no fake and no Prisma → members 503 `UNAVAILABLE`.
- Re-run `admin-http.e2e`, `customer`, `sales` suites.

**Commands:**

- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin exec vitest run segment customer sales admin-http.e2e`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/orders exec vitest run`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin exec tsc --noEmit --incremental false`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs arch`

**Amendments (binding) — Plan review 1, Task 2 (the amendment wins over the task text above)**

_Plan review 1, finding 3 — two statements, two bind arrays._ `compileSegmentQuery` returns `{ list: { sql: string; params: readonly unknown[] }; count: { sql: string; params: readonly unknown[] } }`. Compile the shared filter fragments once into a base params array; `count.params` = base params only; `list.params` = a copy of base params + the cursor (when present) + `first + 1`. Each statement is executed with its OWN array: `client.$queryRawUnsafe(list.sql, ...list.params)`, `client.$queryRawUnsafe(count.sql, ...count.params)`. Tests: a recording TransactionClient fake for `PrismaCustomerSegmentQuery` (records every `$queryRawUnsafe(sql, ...values)` call in order; queued answers; `runReadScoped` is exercised through an injected `prisma.$transaction` double that records `set_config` before the queries) asserting, for page 1, page 2 (with `after`), a search, and an empty result: the number of `$n` placeholders in each SQL equals the length of its array, the count array never contains the cursor or limit, and `total` is identical on page 1 and page 2.

_Plan review 1, finding 4 — zero orders and NULLs in predicates._ Every predicate and every output column uses `COALESCE(oa.orders_count, 0)` and `COALESCE(oa.spent_minor, 0)`; `oa.last_order_at` stays NULL for customers without counted orders. Semantics: `last_order_date within_last_days d` = `oa.last_order_at IS NOT NULL AND oa.last_order_at >= <bound>`; `not_within_last_days d` = `oa.last_order_at IS NULL OR oa.last_order_at < <bound>`; `on_or_after D` = `oa.last_order_at IS NOT NULL AND oa.last_order_at >= <D bound>`; `before D` = `oa.last_order_at IS NOT NULL AND oa.last_order_at < <D bound>`; `never` = `oa.last_order_at IS NULL`. `language eq L` = `c.language = $n`; `language neq L` = `c.language IS DISTINCT FROM $n` (unset customers INCLUDED); `language unset` = `c.language IS NULL`. Gated fixtures with exact expectations: no orders, cancelled-only, other-currency-only → orders 0 / spent 0 / last null and members of `default:not_purchased`; refunded-only (shop currency) → orders 1 / spent 0 / last = that order's time; `amount_spent eq 0` and `lte 0` include the zero-order customer; language unset vs `neq "en"`.

_Plan review 1, finding 5 — per-alias tenant isolation._ Use these fixed aliases: `c` (identity.customers), `o` (orders.orders), `i` (orders.order_items in the total fallback), `xc` (cancelled-event subquery), `xr` (refunded-event subquery), `cr` (consent_records, one alias per scope subquery: `cre` email, `crs` sms), `t` (customer_tags), `a` (addresses). The compiler unit test asserts, for BOTH list and count SQL, that every alias occurring in the SQL is followed somewhere by its own `<alias>."tenant_id" = $1` predicate (regex per alias), for a filter that uses every field. Gated adversarial fixtures: a tenant-B order whose `customer_ref` is a tenant-A customer id; a tenant-B cancelled/refunded event pointing at a tenant-A order id; tenant-B consent, tag and address rows pointing at a tenant-A customer id — each with values that would flip tenant A's membership/count/spend if its alias predicate were missing. Assert tenant A's results are unchanged and no tenant-B row appears.

_Plan review 1, finding 1 — currency for the editor._ New route `GET /customer-segments/store-currency` (permission `customers:read`, registered BEFORE `/customer-segments/:segmentId`) → `tenancy.getStoreRegion(principal, tenantId)`; non-200 returned as is; 200 `{ currency: string }`. `SegmentMembersPage` also carries `currency: string` (the shop currency used for amounts). No settings permission is added.

_Plan review 1, finding 12 — money and time oracles._ `within_last_days d` is a rolling duration in UTC: the adapter passes `now` as an ISO UTC string bound as `$n::timestamp` (timestamp WITHOUT time zone holding UTC) and the bound is `$n::timestamp - make_interval(days => $m)` — independent of the DB session time zone. Calendar dates (`on_or_after`/`before`) use the shop zone exactly like the sales summary. Gated oracles: totals JSON overriding disagreeing items; missing totals → item sum with the bigint cast before multiplication (a 2_000_000_000 × 3 item); both `refunded` and `refund_requested` events → spend 0; an other-currency order ignored; a shop-zone midnight boundary (Africa/Cairo) for `on_or_after`.

_Plan review 1, finding 11 — consent ties._ Latest consent per scope = `ORDER BY occurred_at DESC, id DESC LIMIT 1`. Gated fixture: equal-time grant and revoke per channel → the higher id wins. Aligning the older detail/export reads (which order by occurred_at only) is recorded as a follow-up, not done here.

_Commands (complete)._

- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin exec vitest run segment customer sales admin-http.e2e`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/orders exec vitest run`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin exec tsc --noEmit --incremental false`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs arch`

---

### Task 3 — admin-web: Customers > Segments (implementer: sonnet, UI-only)

**Client** `apps/admin-web/src/lib/api/customer-segments.ts` (+ test): types mirroring Task 2 (`SegmentView`, `SegmentCondition`, `SegmentMembersPage`) with full guards; `fetchCustomerSegments(): Promise<ApiResult<{ items: readonly SegmentView[] }>>`, `fetchCustomerSegment(id)`, `fetchSegmentMembers(id, { first?, after?, search? })` via `getAdminApi`; `createCustomerSegment(body, idempotencyKey)`, `updateCustomerSegment(id, body, idempotencyKey)`, `deleteCustomerSegment(id, expectedVersion, idempotencyKey)` via `mutateAdminApi` (`MutationResult`); `previewCustomerSegment(conditions, first?)` via `mutateAdminApi` WITHOUT an idempotency key; ids through `encodeURIComponent`.

**Pages** (`canEdit` per G8):

- `/customers/segments` "Segments": table with Name (defaults show their localized label from `t.segments.defaults.<key>`), Type ("Default"/"Custom"), Last edited; "Create segment" button (operator+).
- `/customers/segments/new` and `/customers/segments/[segmentId]`: name input + condition rows (one row = field select → op select → value input appropriate to the field: number, money in shop currency (major units in the input, converted to minor), days, date, yes/no, tag chips, country codes, language select); "Add condition" up to 10; live preview "N customers" + first 10 members from `previewCustomerSegment` (debounced 400 ms, stale responses dropped); Save (create → redirect to the segment; update with `expectedVersion`); 409 stale → "This segment was changed by someone else. Reload to see the latest version."; 409 duplicate → under Name; 422 field paths `conditions.<i>.<x>` shown on the matching row. Defaults open read-only with "Duplicate" (prefills /new with the conditions and name "Copy of …"). Delete (custom only) in a real destructive Dialog (G8).
- Members table on the segment page: Name, Email, Orders, Amount spent (shop currency), Last order, Email subscription; search; pagination with the `stack` algorithm of `components/customers/customers-pagination.tsx`; total "N customers".
- Customers list: a "Segment" select in `customers-toolbar.tsx` writing `?segment=<id>` (clears `after`/`stack`), passed to `fetchCustomersPage({ segmentId })` (extend the client and `CustomersListQuery`).
- Navigation: `customers` item gains children `[{ id: "customers-segments", label: t => t.nav.segments, href: "/customers/segments" }]`; update the navigation and global-search oracles that list customers children/order. Middleware: `["/customers/segments/new", "operator"]` before `["/customers", "viewer"]`; segment detail stays viewer-readable.
- Server actions `app/customers/segments/actions.ts`: `createSegmentAction`, `updateSegmentAction`, `deleteSegmentAction` (each revalidates `/customers/segments` and the segment page on every API-reaching outcome; create redirects on success), `previewSegmentAction(conditions)`.
- 503 `UNAVAILABLE` → an empty state "Segments need the store database" instead of a crash.
- en/ar strings; `SHARED_VERBATIM` additions only for genuinely identical strings, with a comment.

**Tests:** client paths/guards/no idempotency key on preview; actions revalidation (ok + error), stale/duplicate/422 mapping; condition row editor per field (value inputs, money major→minor, tag chips de-dupe with the Wave 1b `tagKeyOf`), add/remove rows, 10 max; preview debounce + stale-drop (fake timers); default read-only + Duplicate prefill; delete Dialog contract; members table + pagination stack; toolbar segment select resets cursor; viewer sees no Create/Save/Delete/Duplicate (document.body); navigation/global-search/middleware oracles; Arabic render with bdi.

**Commands:**

- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec vitest run segments customers navigation middleware global-search i18n --maxWorkers=1 --minWorkers=1 --no-file-parallelism`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec tsc --noEmit --incremental false`

---

**Amendments (binding) — Plan review 1, Task 3 (the amendment wins over the task text above)**

_Plan review 1, finding 1 — currency._ Client `fetchSegmentStoreCurrency(): Promise<ApiResult<{ currency: string }>>` (GET `/api/v1/customer-segments/store-currency`). The new/detail pages read it on the server and pass `currency` to the editor and the members table; when it fails the page shows an error state "Couldn't load the store currency" with no editor (never fall back to EGP). Money input uses `toMinorUnits` / `fromMinorUnits` / `currencyExponent` from `apps/admin-web/src/lib/products/money.ts` (excess precision → field error "Too many decimal places"); display uses `formatCurrency` from `lib/format.ts` with the members page's `currency`. Tests: EGP `0.29` → 29, JPY `29` → 29, KWD `0.029` → 29, JPY `1.5` → error, Arabic digits `١٢٫٣٤` EGP → 1234; display of 29 in EGP/JPY/KWD.

_Plan review 1, finding 2 — unavailable vs other failures._ Extend the shared GET helper backward-compatibly: in `apps/admin-web/src/lib/api/client.ts`, `ApiResult`'s `error` branch gains optional `status?: number` and `code?: string`; `getAdminApi` parses the JSON envelope of a non-2xx response (when parseable) and fills them; existing consumers are unaffected. Add `client.test.ts` cases: 503 + `{code:"UNAVAILABLE"}` → `{outcome:"error", status:503, code:"UNAVAILABLE"}`; 500 → status 500 without code; network failure → neither; malformed body → status only. Segment pages show "Segments need the store database" ONLY for `status === 503 && code === "UNAVAILABLE"`; any other error shows the generic error state.

_Plan review 1, finding 7 — existing Customers page integration._ Deliverables include `app/customers/page.tsx`, `app/customers/page.test.tsx`, `components/customers/customers-toolbar.tsx` (+ test), `lib/api/customers.ts` (+ test). Thread `segment` (URL) → `segmentId` (client) through page props, the Suspense key and the result reader; `hasFilters = Boolean(search) || Boolean(segment)`. Render pagination whenever `after` or `stack` is present, even on an empty page; the "no customers yet" store-empty message only on page 1 with no search and no segment; an empty filtered page says "No customers match". An unknown/deleted segment id (404 from the API) shows "This segment no longer exists" with a link that clears `segment`. Toolbar: the segment select reads the CURRENT `useSearchParams()` when it writes (not a stale closure), cancels any pending search debounce timer before navigating, and clears `after` and `stack`; changing search keeps `segment` and clears `after`/`stack`. Tests: Next/Previous/deep link keep `q` + `segment`; search change and segment change both reset the cursor; pending-search-then-segment-change ends with the new segment and the typed search; empty later page keeps Previous; store-empty only unfiltered page 1; page.test.tsx mocks updated for the new props.

_Plan review 1, finding 9 — action contracts._ `app/customers/segments/actions.ts` (`"use server"`):

| Action                               | Signature                                                                                                                                     | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createSegmentAction`                | `(input: { name: string; conditions: readonly SegmentCondition[] }) => Promise<SegmentFormState>`                                             | new idempotency key; ok → revalidate `/customers/segments` + `/customers/segments/<id>`, `redirect` to it; else revalidate `/customers/segments`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `updateSegmentAction`                | `(segmentId: string, input: { expectedVersion: number; name: string; conditions: readonly SegmentCondition[] }) => Promise<SegmentFormState>` | new key; revalidate list + detail on every API-reaching outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `deleteSegmentAction`                | `(segmentId: string, expectedVersion: number) => Promise<SegmentFormState>`                                                                   | new key; revalidate list + detail; ok → `redirect("/customers/segments")`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `previewSegmentAction`               | `(conditions: readonly SegmentCondition[]) => Promise<SegmentPreviewState>`                                                                   | `first: 10`, no key, no revalidation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `SegmentFormState = { status: "idle" | "success" }                                                                                                                                   | { status: "error"; message: string; fieldErrors: Readonly<Record<string, string>> }`. 409 mapping: message exactly `"A segment with this name already exists"`→`fieldErrors.name`=`t.segments.errors.duplicateName`; exactly `"This segment was changed by someone else"`→`t.segments.errors.stale`; `"Default segments can't be changed"`→`t.segments.errors.readOnly`; any other 409 → `t.formErrors.conflict`. 422 fields keep the server path (`conditions.0.value`) and are shown on the matching row. Duplicate: the default/custom page links to `/customers/segments/new?from=<segmentId>`; the new page loads that segment server-side and prefills (no query-string payload). Tests in `app/customers/segments/actions.test.ts` for every row above. |

_Commands (complete)._

- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec vitest run segments customers client navigation middleware global-search i18n --maxWorkers=1 --minWorkers=1 --no-file-parallelism`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec tsc --noEmit --incremental false`

## Execution order

Task 1 → Task 2 (consumes Task 1's controller and domain) → Task 3 (consumes Task 2's routes). Each task: implement → Sol review → Opus acceptance. Then whole-branch review, push, PR, merge after green CI (owner's standing go-ahead). Owner applies `20261125000000_customer_segments` on Supabase before release.

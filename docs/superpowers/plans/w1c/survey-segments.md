# Wave 1c survey: Customers > Segments (facts file)

Worktree `F:/New folder/morbeh-shopify-parity-w1b`, branch `morbeh/shopify-parity-w1c` = origin/main `ec8e599d` (includes Wave 1a + 1b). Static read only; nothing run, nothing changed except this file. Paths are relative to the worktree. `NOT FOUND` = looked for it, it is not in the source. Line numbers are from the files as read; a few are approximate (`~`).

## TL;DR (read this first)

1. `services/customer-360` has full segment create/update/delete/members/evaluate use cases, but they are **unusable for Shopify-style customer filters**. The customer-360 profile holds exactly one order-derived field (`lastOrderRef`). It has no order count, no amount spent, no tags, no consents, no country, no language. Nothing from Wave 1b reaches it. Membership rows only exist after something evaluates an identifier, and no production code does.
2. `@platform/rules` is a generic boolean-expression engine (dot-path refs, scalars only, no arrays, no dates). A tag set cannot be expressed in it. Reusing it would mean building a second customer-fact projection into customer-360 for data that already lives in SQL.
3. All 9 required filters can be answered in **one tenant-scoped SQL statement** over `identity.customers`, `identity.customer_tags`, `identity.consent_records`, `identity.addresses` and a per-customer aggregate of `orders.orders`. Existing indexes are adequate for ~50k customers. Precedent for the raw-SQL pattern: `services/orders/src/infrastructure/prisma-sales-summary-query.ts`.
4. Recommendation: a **new additive table `identity.customer_segments`** (typed fixed-filter JSON, not a RuleSet). A typed filter vocabulary is compiled to parameterised SQL by an adapter in `apps/admin/src/infrastructure/cross-context/`. Default templates are read-only code constants. Routes under `/customer-segments`. Permissions `customers:read` / `customers:manage_segments` (NOT `customer360:*`, which only admin has). Leave customer-360 segments untouched. **Migration needed: yes**, one additive migration.

---

## Q1. services/customer-360 segments

### Prisma models (`packages/db/prisma/schema/customer-360.prisma`, schema `customer_360`)

- `SegmentDefinition` -> `segment_definitions` (:247-265): `id` uuid PK, `tenantId` (`tenant_id`), `segmentId` (`segment_id`), `name`, `description?`, `version` Int, `ruleSet` Json (`rule_set`), `createdAt`, `updatedAt`. `@@unique([tenantId, segmentId])` (:262). No other index. Delete is a hard delete.
- `SegmentMembership` -> `segment_memberships` (:267-294): one row per `(identifier, segmentId)`: `identifierType/identifierValue`, `segmentId`, `status` (entered|exited), `enteredAt?`, `exitedAt?`, `definitionId`, `definitionVersion`, `matchedRuleIds` Json, `inputs` Json, `evaluatedAt`, `version`, timestamps. `@@unique([tenantId, identifierType, identifierValue, segmentId])` (:290), `@@index([tenantId, segmentId, status])` (:291).
- `SegmentHistory` -> `segment_history` (:296-321): append-only ledger, same columns plus `capturedAt` and `reason` (entered|exited|refreshed|rebuilt). Index `(tenantId, identifierType, identifierValue, segmentId, capturedAt)` (:318).
- Tables were created in `packages/db/prisma/schema/migrations/20260722010000_customer_360_durable_storage/migration.sql` (segment_definitions :219, segment_memberships :234, indexes :323-329). That migration has no RLS statements. The generic `20260823000000_rls_tenant_isolation/migration.sql:55-91` loops every base table with a `tenant_id` column and enables + forces RLS with policy `tenant_isolation USING/WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`. customer_360 tables pre-date it, so they are covered. Reads go through `readScoped` (`services/customer-360/src/infrastructure/scoped-read.ts:6-15`): reuse the caller's `tx`, else `runReadScoped(prisma, tenantId, ...)`.

### SegmentDefinition shape (`services/customer-360/src/ports/segment-definition.ts:20-34`)

`{ id: string (the segmentId, single key); name; description?; version: number; ruleSet: RuleSet<boolean>; createdAt: ISO; updatedAt: ISO }`. `INITIAL_SEGMENT_DEFINITION_VERSION = 0` (:39). `id` is a caller-chosen string, not a uuid.

### Use cases (`services/customer-360/src/application/`, all `UseCase<In, Out, DomainError>` returning `Result`)

```ts
// create-segment.use-case.ts:16-28
export interface CreateSegmentInput {
  readonly tenantId: string;
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly ruleSet: RuleSet<boolean>;
}
export interface CreateSegmentOutput {
  readonly definition: SegmentDefinition;
}

// update-segment.use-case.ts:13-26
export interface UpdateSegmentInput {
  readonly tenantId: string;
  readonly id: string;
  readonly expectedVersion: number;
  readonly name?: string;
  readonly description?: string;
  readonly ruleSet?: RuleSet<boolean>;
}
export interface UpdateSegmentOutput {
  readonly definition: SegmentDefinition;
}

// delete-segment.use-case.ts:10-20
export interface DeleteSegmentInput {
  readonly tenantId: string;
  readonly id: string;
  readonly expectedVersion: number;
}
export interface DeleteSegmentOutput {
  readonly deleted: boolean;
}

// get-segment-members.use-case.ts:7-18
export interface GetSegmentMembersInput {
  readonly tenantId: string;
  readonly segmentId: string;
  /** Defaults to "entered" */
  readonly status?: SegmentMembershipStatus;
}
export interface GetSegmentMembersOutput {
  readonly members: readonly SegmentMembership[];
}

// evaluate-segment.use-case.ts:16-26
export interface EvaluateSegmentInput {
  readonly tenantId: string;
  readonly identifier: IdentifierRef;
  readonly definition: SegmentDefinition;
}
export interface EvaluateSegmentOutput {
  readonly result: SegmentEvaluationResult;
}
```

Also present: `EvaluateAllSegments` (`evaluate-all-segments.use-case.ts:13-29`, one identifier x many definitions, persists through `UpdateSegmentMembershipProjection`), `RecalculateMemberships`, `RebuildSegmentMembership`, `GetCustomerSegments`, `SegmentProjectionWorker`, `SegmentMembershipWorker`.

### Error codes / behaviour

- Create: id already exists -> `BusinessRuleError` "already exists" (create-segment.use-case.ts:68-75). Any rule failing `validateExpressionStructure` -> `ValidationError`, field `ruleSet`, message = JSON of the structure errors (:77-84). Version starts at 1 (:91). Save is CAS with expectedVersion 0 (:106-112).
- Update: missing -> `BusinessRuleError` "does not exist" (update-segment.use-case.ts:54-61). Invalid rule set -> `ValidationError` (:63-72). `version = existing.version + 1` (:79). `name ?? existing`, `description ?? existing`, so a description cannot be cleared (:77-78).
- Delete: missing -> `BusinessRuleError` (delete-segment.use-case.ts:47-55). Never cascades into membership/history rows (`prisma-segment-definition-registry.ts:145-168`).
- Stale `expectedVersion`: the Prisma registry **throws** `ConcurrencyError` rather than returning a Result (`prisma-segment-definition-registry.ts:129-138`, :160-164). The customer-360 presenter maps `VALIDATION 422, NOT_FOUND 404, CONFLICT/CONCURRENCY/BUSINESS_RULE 409, UNAUTHENTICATED 401, FORBIDDEN 403`, default 422 (`services/customer-360/src/interfaces/presenter.ts:8-16`). A controller must catch the thrown `ConcurrencyError` itself. "Does not exist" is `BUSINESS_RULE` (409), not 404.
- Events `SegmentCreated/Updated/Deleted` go to the outbox in the same tx (`prisma-segment-definition-registry.ts:140-142`); `save`/`delete` throw if an event is given without a tx (:174-183).
- No list use case for definitions: `SegmentDefinitionRegistry.list(tenantId, tx?)` exists on the port and adapter (`ports/segment-definition-registry.ts:13` region; `prisma-segment-definition-registry.ts:60-67`) but nothing wraps it as a use case or controller method.

### How evaluation runs

- Not on demand for a list/filter. Not scheduled by anything wired. Evaluation is per identifier: `EvaluateSegment` builds a context from three namespaces, `profile.*` (merged customer-360 profile fields), `journey.*` (visitor sessionCount/identified/hasCurrentSession, only for `visitor_id`), `attributes.*` (computed attributes) (`evaluate-segment.use-case.ts:77-131`), then calls `evaluateRuleSet` (:131). `isMember = evaluation.outcomes[0] ?? false` (:138).
- Results are **materialised** into `segment_memberships` + `segment_history` by `UpdateSegmentMembershipProjection`. `GetSegmentMembers` is a plain `listMembers(segmentId, tenantId, status)` (`get-segment-members.use-case.ts:42-51`). **No pagination, no limit** on the port or adapter (`ports/segment-store.ts` `listMembers`, ~:51-56).
- Triggers: `RecalculateMemberships` (fact change -> incremental closure) and `SegmentMembershipWorker.execute` (`segment-membership-worker.ts:54-76`). The worker only re-evaluates identifiers that already have a membership row (`listIdentifiers`), so an identifier that was never evaluated is never picked up by the sweep.
- Production callers of the segment machinery: **NOT FOUND**. `apps/admin/src/composition.ts:1057` only calls `wireCustomer360(deps)` and uses `.customer360`; no scheduler or consumer drives segment evaluation.

---

## Q2. @platform/rules RuleSet<boolean>

- Types (`packages/rules/src/rule.ts`): `RuleSet<T> { id; version; mode: "first_match"|"all_matches"; rules: Rule<T>[]; onError?: "skip"|"fail_closed"|"fail"; fallback?: T }` (:29-41). `Rule<T> { id; priority; when: Expression; then: T; enabled?; description? }` (:18-27). `orderRules` sorts by priority then declaration order (:44-49).
- Expression AST (`packages/expression/src/expression.ts:29-46`): `literal | ref(path) | exists(path) | not | and | or | compare(op,left,right) | in(value, set)`. Scalars only: `string|number|boolean|null` (:11); no dates, no objects. Operators (:14-27): `eq neq gt gte lt lte contains starts_with ends_with`. No regex (ADR-0053 §4). Builders `Expr.*` (:61-83).
- Attribute reference: dot-path via `{kind:"ref", path:"profile.lastOrderRef"}`, resolved by `resolvePath` against an `EvaluationContext` (`packages/expression/src/evaluate.ts:58-68`). **Arrays are not traversable** (:63 returns undefined), so "customer has tag X" is not expressible; `in` takes a literal set on the right only, not a context array. Ordering compares need the same type; number vs string is `type_mismatch` (:86-103). A missing ref is an `unknown_reference` error, not `false`.
- Evaluation: `evaluateRuleSet(ruleSet, context)` (`packages/rules/src/evaluate-rules.ts:45-95` in-file) returns `{ outcomes, usedFallback, degraded, trace }`. Default policy `fail_closed` marks `degraded` and continues; `fail` throws `RuleEvaluationError`. Segment membership = `outcomes[0] ?? false`.
- Limits: `MAX_EXPRESSION_DEPTH = 32`, `MAX_EXPRESSION_NODES = 512` (expression.ts:90,93). `validateExpressionStructure` rejects empty and/or, empty `in` set and empty path (:148-192). Create/Update only call it per rule `when`; they do not check rule count, ids or priority uniqueness.
- Pure and in memory, one context at a time. No SQL pushdown exists. Evaluating 50k customers means 50k x (profile + journey + attributes reads), then writing 50k membership rows.

---

## Q3. customer-360 attribute/profile model, sources, freshness

- Profile = `CustomerProfileCache.fields` Json (`customer-360.prisma:65-78`), keyed by `(tenantId, identifierType, identifierValue)`, open-ended `Record<string, ProfileField{value,source,updatedAt,confidence,version}>`. Append-only `ProfileSnapshot` ledger (:84-97). Computed attributes: `ComputedAttributeCache.attributes` Json (:194-207) and `ComputedAttributeDefinition` (:231-245, seed-only, no CRUD).
- **The only production writer of profile fields** is `Customer360OrdersPaidConsumer` in `apps/runtime/src/consumers/orders-paid.consumers.ts` (class ~~:357-388). It writes `field: "lastOrderRef"` = order number (:380), `source: "orders"`, `confidence: "verified"`, identifier `{type:"customer_id", value: customerRef}`. Its doc comment calls this a "placeholder projection decision" and says richer derived fields are deferred (~~:342-346). `OrderPaidPayload` carries `orderNumber, customerRef, paymentRef, currency, totalAmountMinor` (:71-77), so count/spend/last-order could be projected but are NOT.
- Per customer today: `lastOrderRef` only. orders count: NOT FOUND. total spent: NOT FOUND. last order at: NOT FOUND (only that one field's `updatedAt`). country: NOT FOUND. tags: NOT FOUND. consents: NOT FOUND. language/phone/note: NOT FOUND.
- Wave 1b fields reaching customer-360: **NO**. A search of `services/customer-360/src` for `marketing_sms|customer_tags|language|totalSpent|ordersCount` finds nothing relevant. No consumer of identity events feeds customer-360; `UpdateProfileProjection` has one production caller (the orders-paid consumer).
- Freshness: whatever last event touched it. `profileFreshness` (`domain/profile-views.ts`) is a read-time view only. Segment membership freshness is "last time something evaluated that identifier", effectively never for new customers.
- Identity mismatch: customer-360 keys by identifier (visitor_id, email_hash, customer_id, ...), merged across clusters. Admin Customers are `identity.customers` rows. A segment "member" is an identifier, not a customer (`get-segment-members.use-case.ts:24-30` says per-person dedup is deferred). Mapping back to customers needs `identifierType = "customer_id"` rows only.
- `apps/admin-web/src/lib/api/customer-360.ts:12-27` documents that profile `Map` fields serialise as `{}` over the wire; the existing 360 read API is partly broken for field values.

---

## Q4. What apps/admin wires for customer-360 today

- `apps/admin/src/composition.ts:1057` `const customer360 = wireCustomer360(deps);` and `:1424-1427` `customer360: new Customer360AdminController({ customer360: customer360.customer360, guard })` (type slot `:545`). Only the `Customer360Controller` facade (4 reads) is exposed. None of the segment use cases on `WiredCustomer360` are exposed: no controller method, no route.
- `services/customer-360/src/interfaces/customer-360.controller.ts:58-97`: `getProfile`, `getIdentityTimeline`, `getJourneyTimeline`, `getJourneyState`. Deps (:21-27) hold only those four use cases + clock.
- Admin controller `apps/admin/src/interfaces/customer-360.admin-controller.ts:12-56`: each method does `guard.ensure(principal, "customer360:read")`.
- Routes `apps/admin/src/http/customer-360-routes.ts:26-82`, spread at `apps/admin/src/http/admin-routes.ts:2345`:
  - `GET /customer-360/profile/:identifierType/:identifierValue` (query `expectedFields[]`) :28-41
  - `GET /customer-360/identity-timeline/:identifierType/:identifierValue` :42-54
  - `GET /customer-360/journeys/:visitorId/timeline` :55-67
  - `GET /customer-360/journeys/:visitorId/state` :68-80
    All `permission: "customer360:read"`, tenant from `context.tenantId`.
- **Permission gap**: `packages/auth/src/role-table-access-control.ts:4-30` `SHOP_RESOURCES` includes `customers` but NOT `customer360`. `ROLE_PERMISSIONS` (:37-47): admin `*:*`; operator `${resource}:*` for SHOP_RESOURCES plus read-only extras; viewer `:read` only. So `customer360:read` is **admin-only**. Permissions under `customers:` work for operator/viewer with no auth change (`permissionMatches` :55-60).
- NOT wired: create/update/delete/list/members/evaluate segments, membership workers, any customer-360 projection except the orders-paid `lastOrderRef` consumer in apps/runtime.
- Pattern to copy: guard in `apps/admin/src/interfaces/*.admin-controller.ts`; `defineRoute({method, path, version:1, permission, summary, schema:{params,querystring,body}, idempotent?, handle})` in `apps/admin/src/http/*-routes.ts`; spread in `admin-routes.ts` (Wave 1b: `...customerRoutes(admin)` immediately before `GET /customers`, ~:1712).

---

## Q5. Answering each fixed filter for <= ~50k customers (SQL, tenant-scoped)

Source tables/columns (`packages/db/prisma/schema/identity.prisma`, `orders.prisma`):

| Filter           | Read                                                                                                                                                                                                                                                                                                                                                                                | Indexes today                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| orders count     | `orders.orders` grouped by `customer_ref` (TEXT bare id = `identity.customers.id::text`), excluding orders with a `cancelled` event                                                                                                                                                                                                                                                 | `orders` `@@index([tenantId, customerRef, createdAt])` (orders.prisma:29); `order_events` `@@index([orderId, occurredAt])` (:68) |
| amount spent     | `COALESCE((o.totals->>'totalMinor')::bigint, sum(order_items.unit_price_amount_minor*quantity))`, 0 when a `refunded`/`refund_requested` event exists, shop currency only. Exactly the expression in `services/orders/src/infrastructure/prisma-sales-summary-query.ts:97-124`                                                                                                      | same; `order_items` `@@index([orderId])` (:51)                                                                                   |
| last order date  | `max(o.created_at)` over the same counted orders                                                                                                                                                                                                                                                                                                                                    | same                                                                                                                             |
| email subscribed | latest `identity.consent_records` row with `scope='marketing'` (`identity.prisma:78-91`); `granted` of the newest `occurred_at`; none => false. Reference semantic: `marketingOf` in `apps/admin/src/http/customer-routes.ts:48-57`                                                                                                                                                 | `@@index([customerId, scope, occurredAt])` (:88); no tenant_id in the index, filter still carries `tenant_id`                    |
| SMS subscribed   | same with `scope='marketing_sms'`                                                                                                                                                                                                                                                                                                                                                   | same                                                                                                                             |
| customer tags    | `identity.customer_tags(tenant_id, customer_id, tag, tag_key)` (`identity.prisma:29-41`). Match on `tag_key`, normalised by `tagKeyOf` (`services/identity/src/domain/customer-annotations.ts:25-27`)                                                                                                                                                                               | PK `(customer_id, tag_key)`, `@@index([tenantId, tagKey])`                                                                       |
| location/country | `identity.addresses.country` (`identity.prisma:60-75`). Free text: `Address.create` only rejects empty (`services/identity/src/domain/address.ts:19-32`); storefront writes ISO codes ("EG"/"US"). **No default-address concept**; the CSV export uses the first address by createdAt (`customer-routes.ts:109`). `orders.order_shipping_addresses.country` exists but is per order | `@@index([customerId])` only; no `(tenant_id, country)`                                                                          |
| created date     | `identity.customers.created_at`                                                                                                                                                                                                                                                                                                                                                     | none on `created_at`; the list orders by `id desc` (UUIDv7, time-ordered)                                                        |
| language         | `identity.customers.language` ('en'/'ar'/NULL, CHECK in `20261124000000_customer_profile_tags/migration.sql`)                                                                                                                                                                                                                                                                       | none                                                                                                                             |

Customers base: `identity.customers` has PK(id) and `@@unique([tenantId,email])`. Soft-deleted rows are excluded with `deleted_at IS NULL` (as `prisma-customer-repository.ts` list does). Guests (`is_guest`) are rows in the same table.

Feasibility at ~50k customers:

- One statement with a single `GROUP BY customer_ref` CTE over `orders.orders` (tenant filtered; uses the `(tenant_id, customer_ref, created_at)` index), `LEFT JOIN` customers on `c.id::text = oa.customer_ref`, correlated `EXISTS` / `LIMIT 1` subqueries for tags, consents and country (index-backed, at most 50k lookups), keyset pagination on `c.id` desc. Expect hundreds of ms at worst at this size. Cost is dominated by the order aggregate, computed once per request.
- Total count: a second `count(*)` over the same filtered set. Fine at 50k.
- **SQL per request is clearly better than evaluating a RuleSet in memory.** No materialised membership table is needed at this scale, and it removes staleness entirely (always live). If a tenant outgrows it, a materialised `customer_segment_members` table can be added later without changing the filter vocabulary.
- Raw SQL must carry `tenant_id = ${tenantId}` on **every** table reference (precedent: header comment `prisma-sales-summary-query.ts:56-60`) AND run inside `runReadScoped(prisma, tenantId, ...)` so RLS (`app.tenant_id` GUC) is the second wall.
- Cross-schema reads: no precedent of a service reading another context's tables in service code (only `apps/runtime/src/seed.ts`/`seed-demo.ts`); `.dependency-cruiser.cjs:80` (`no-cross-service-internals`) forbids cross-service imports. Precedent for an app-level adapter holding prisma: `apps/admin/src/composition.ts` builds `PrismaStaffDirectoryAdapter({ prisma: deps.prisma })` (~:1050), and `apps/admin/src/infrastructure/cross-context/` holds the cross-context adapters. Put the cross-schema query there.

---

## Q6. admin-web today

- `/customers` list: `apps/admin-web/src/app/customers/page.tsx:34-74` is a server component. URL params: `?q=` (search), `?after=` (cursor), `?exportError=` (:19-26). `PAGE_SIZE = 20` (:17). It calls `fetchCustomersPage({first, after, search})` (:88), defined in `apps/admin-web/src/lib/api/customers.ts:28-63`, which hits `GET /api/v1/customers?first&after&search`. `CustomerListItemDto = {id,name,email}` only (:4-8). Toolbar `components/customers/customers-toolbar.tsx:15-71` (debounced `?q=`, resets `after`/`stack`); header `customers-header.tsx` (Export dialog + "Add customer" for operator/admin; role from `highestRole(session.roles)`, page.tsx:42-44); `customers-table.tsx`, `customers-pagination.tsx` (cursor with previous stack).
- Backend list: `GET /customers` at `apps/admin/src/http/admin-routes.ts:1713-1731`, query `listCustomersQuery {first (1..100), after, search}` (:188-192), permission `customers:read`. Repo `prisma-customer-repository.ts` list (~:152-198): `id desc` cursor, `search` = name OR email ILIKE, `deletedAt: null`, includes addresses + consents for each row. `CustomerListQuery extends CursorPage { search? }` (`services/identity/src/domain/customer-repository.ts:5-7`).
- Other customer pages: `/customers/new`, `/customers/[customerId]` (detail: tags, note, consent, marketing cards, plus read-only Customer 360 profile and identity-timeline cards via `lib/api/customer-360.ts`, `components/customers/customer-profile-card.tsx`, `customer-identity-timeline-card.tsx`), `/customers/export` route handler.
- **Segments UI: NOT FOUND.** 360 UI exists only as read-only cards on the customer detail page.
- Nav: `apps/admin-web/src/components/navigation.ts:116` `{ id: "customers", href: "/customers", Icon: UserIcon }` is a leaf with no `children`. Precedent for children: `marketing` (:117-128, `children: [{ id: "automations", ... }]`); products section uses `children` + `sectionIds` (~:95-113).
- i18n: `apps/admin-web/src/messages/en.ts` (`customersPage:` at :1566) and `ar.ts`; every string needs both (`Dictionary` type).
- Where Segments goes: `/customers/segments` (list), `/customers/segments/new`, `/customers/segments/[segmentId]` (members table + edit). Static `segments` should win over dynamic `[customerId]` in Next routing, but cover it with a test. Nav: add `children: [{ id: "customer-segments", href: "/customers/segments" }]` to the customers item (Shopify: Customers > Segments), plus a segment selector on `/customers` using `?segment=`.

---

## Q7. Recommended design

### 7.1 Do not reuse customer-360 `SegmentDefinition`

(a) The facts do not exist in customer-360 (Q3). (b) `RuleSet<boolean>` cannot express tag-set or latest-consent semantics, and a missing ref fails with `unknown_reference`. (c) Membership is event-driven and nothing triggers it (Q1), so lists would be empty or stale. (d) `GetSegmentMembers` is unpaginated and returns identifiers, not customers. (e) `customer360:*` is admin-only. (f) `CreateSegment/UpdateSegment` structure-validate RuleSets, so a typed fixed-filter payload cannot be stored there without bypassing validation. Leave customer-360 segmentation as is for a future "advanced rules" path.

### 7.2 Data model (migration needed: YES, additive only)

New model in `packages/db/prisma/schema/identity.prisma` (identity owns customers, tags, consents):

```
model CustomerSegment {
  id        String   @id @db.Uuid
  tenantId  String   @map("tenant_id")
  name      String
  nameKey   String   @map("name_key")   // lower(trim(name)) uniqueness, same idea as tag_key
  query     Json                         // SegmentFilterV1 (typed, versioned)
  version   Int      @default(1)         // CAS token for PUT/DELETE
  createdBy String?  @map("created_by")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  @@unique([tenantId, nameKey])
  @@index([tenantId, createdAt])
  @@map("customer_segments")
  @@schema("identity")
}
```

Hand-written migration `packages/db/prisma/schema/migrations/<timestamp>_customer_segments/migration.sql`: `CREATE TABLE`, indexes, `ENABLE` + `FORCE ROW LEVEL SECURITY`, `DROP POLICY IF EXISTS tenant_isolation` + `CREATE POLICY tenant_isolation ... USING/WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`. Same shape as `20261124000000_customer_profile_tags/migration.sql` (the generic RLS loop only covered tables that existed on 2026-08-23). Header: "written by hand, NOT applied by the agent; additive, no backfill". Add matching assertions to `packages/db/src/schema-migration-consistency.test.ts` (the customer_tags precedent is at :394-404). Optional indexes `identity.customers (tenant_id, created_at)` and `identity.addresses (tenant_id, country)` only if measured; not required at 50k.
Defaults are NOT stored (7.4): no seeding, no backfill.

### 7.3 Fixed filter vocabulary (typed, no free text, no query language)

```ts
// services/identity/src/domain/customer-segment.ts (pure)
type Cmp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
type SegmentCondition =
  | { field: "orders_count"; op: Cmp; value: number } // int 0..1_000_000
  | { field: "amount_spent"; op: Cmp; valueMinor: number } // shop currency, int >= 0
  | { field: "last_order_date"; op: "within_last_days" | "not_within_last_days"; days: number } // 1..3650
  | { field: "last_order_date"; op: "on_or_after" | "before"; date: string } // YYYY-MM-DD in shop tz
  | { field: "last_order_date"; op: "never" }
  | { field: "email_subscribed"; value: boolean }
  | { field: "sms_subscribed"; value: boolean }
  | { field: "tags"; op: "has_any" | "has_all" | "has_none"; values: string[] } // <=20, normalised with tagKeyOf
  | { field: "country"; op: "in" | "not_in"; values: string[] } // <=20 ISO alpha-2, upper-cased
  | { field: "created_date"; op: "within_last_days" | "not_within_last_days"; days: number }
  | { field: "created_date"; op: "on_or_after" | "before"; date: string }
  | { field: "language"; op: "eq" | "neq"; value: "en" | "ar" }
  | { field: "language"; op: "unset" };
interface SegmentFilterV1 {
  version: 1;
  conditions: SegmentCondition[];
} // 1..10 conditions, AND only
```

- Two-layer validation like Wave 1b (`customer-routes.ts:11-14`): strict zod at the route for structure, domain `parseSegmentFilter()` for bounds and semantics, field-level `ValidationError` (422).
- Compile to SQL fragments with **bound parameters only**. Each field maps to one predicate over aliases `c` (customers), `oa` (order aggregate) plus `EXISTS`/scalar subqueries. Dates/days become UTC instants using the shop time zone the same way `prisma-sales-summary-query.ts:61-64` does. Column names and operators come from a closed switch, never from input.
- Not compiled to `RuleSet`. A `toRuleSet()` can be added later if an advanced mode appears.
- Semantics to decide in the plan: orders count/spent/last-order use non-cancelled orders in the shop currency (refunded counts as an order, 0 spent), matching the sales read model; country matches ANY address on file; `email_subscribed:false` includes customers with no consent record; guests included; soft-deleted excluded.

### 7.4 Default templates (code constants, read-only, returned by list)

Stable string ids that cannot collide with uuids:

1. `default:purchased_at_least_once` "Customers who have purchased at least once": `[{field:"orders_count",op:"gte",value:1}]`
2. `default:email_subscribers` "Email subscribers": `[{field:"email_subscribed",value:true}]`
3. `default:purchased_more_than_once` "Customers who have purchased more than once": `[{field:"orders_count",op:"gt",value:1}]`
4. `default:not_purchased` "Customers who haven't purchased": `[{field:"orders_count",op:"eq",value:0}]`
5. "Abandoned checkouts in the last 30 days": **recommend skipping in Wave 1c.** Data exists (`checkout.checkout_sessions` `state, updated_at, customer_ref, contact_email, items`; `checkout.prisma:6-40`; index `(tenant_id, state, updated_at)`), but "abandoned" is a derived rule (open, idle > 60 min, >= 1 item, reachable email/phone, not a draft; `services/checkout/src/domain/abandoned-checkouts.ts:1-3,45-52`). The customer link is `customer_ref` (NULL for guests) or `contact_email = customers.email`, and it would add a third context's table to the cross-schema query. Defer as a later `abandoned_checkout_within_days` condition.
   Labels are i18n keys in admin-web (en/ar); the API returns `key` + `kind:"default"`. Defaults are read-only (409 on PUT/DELETE for `default:*`); "Duplicate" = POST with the same conditions. Not seeding avoids a per-tenant write on first read (race), a backfill for existing tenants, and lets templates evolve in code.

### 7.5 Admin routes (all `version: 1`, tenant from `context.tenantId`, same prefix as `/customers`)

Permissions: `customers:read` for reads (operator + viewer), `customers:manage_segments` for writes (operator via `customers:*`; viewer denied; admin `*:*`). No change to `packages/auth`. Do not use `customer360:*`.

| Method | Path                                    | Body / query                                     | Permission                  | Notes                                                                                                                                                             |
| ------ | --------------------------------------- | ------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/customer-segments`                    | none                                             | `customers:read`            | defaults first, then custom by name; each `{id, kind:"default"\|"custom", key?, name?, version?, conditions, updatedAt?}`. No member counts (avoids N aggregates) |
| GET    | `/customer-segments/:segmentId`         |                                                  | `customers:read`            | 404 `NOT_FOUND` if unknown                                                                                                                                        |
| POST   | `/customer-segments`                    | `{ name (1..100), conditions }` strict           | `customers:manage_segments` | `idempotent: true`; 422 field errors; 409 duplicate name; cap 100 custom segments per tenant                                                                      |
| PUT    | `/customer-segments/:segmentId`         | `{ expectedVersion, name?, conditions? }` strict | `customers:manage_segments` | CAS on `version`, 409 on stale; `default:*` -> 409 read-only                                                                                                      |
| DELETE | `/customer-segments/:segmentId`         | query `expectedVersion`                          | `customers:manage_segments` | hard delete; no membership table to cascade                                                                                                                       |
| POST   | `/customer-segments/preview`            | `{ conditions }`                                 | `customers:read`            | editor preview: `{ total, items }` first page; nothing persisted                                                                                                  |
| GET    | `/customer-segments/:segmentId/members` | `first (1..100, default 20), after, search`      | `customers:read`            | keyset by customer id desc; `{ items:[{id,name,email,isGuest,ordersCount,amountSpentMinor,lastOrderAt,country,emailSubscribed}], pageInfo, total }`               |
| GET    | `/customers` (existing, :1713)          | add optional `segmentId`                         | `customers:read`            | when present, served by the same segment query so the Customers list can be filtered by a segment; keeps `first/after/search`                                     |

PUT/DELETE already exist as route methods in `admin-routes.ts` (:1315, :1330), so they are allowed. No path conflicts with `/customers/*`.

### 7.6 Members query (sketch, parameterised)

```sql
WITH oa AS (
  SELECT o.customer_ref,
         count(*)::int AS orders_count,
         COALESCE(sum(CASE WHEN <refunded EXISTS> THEN 0 ELSE <total expr> END),0)::bigint AS spent_minor,
         max(o.created_at) AS last_order_at
  FROM orders.orders o
  WHERE o.tenant_id = $tenant AND o.currency = $currency
    AND NOT EXISTS (SELECT 1 FROM orders.order_events e
                    WHERE e.order_id = o.id AND e.tenant_id = $tenant AND e.type = ANY($cancelled))
  GROUP BY o.customer_ref)
SELECT c.id, c.name, c.email, c.is_guest, COALESCE(oa.orders_count,0), ...
FROM identity.customers c
LEFT JOIN oa ON oa.customer_ref = c.id::text
WHERE c.tenant_id = $tenant AND c.deleted_at IS NULL
  AND <compiled conditions, ANDed>
  AND ($after IS NULL OR c.id < $after::uuid)
  [AND (c.name ILIKE ... OR c.email ILIKE ...)]
ORDER BY c.id DESC
LIMIT $first + 1;
```

Plus `count(*)` over the same WHERE for `total`. Executed inside `runReadScoped(prisma, tenantId, client => client.$queryRaw...)`. Cursor helpers: reuse `decodeCursor` / `buildPaginatedPage` as used by `prisma-customer-repository.ts` list.

### 7.7 Files to touch (all additive)

- DB: `packages/db/prisma/schema/identity.prisma` (+model); new `packages/db/prisma/schema/migrations/<ts>_customer_segments/migration.sql`; `packages/db/src/schema-migration-consistency.test.ts` (new assertions).
- `services/identity`: `src/domain/customer-segment.ts` (+test: filter types, validation, defaults); `src/domain/customer-segment-repository.ts` (port: list/find/save-CAS/delete) and a `CustomerSegmentQuery` port (`members`, `count`); use cases `list-customer-segments`, `get-customer-segment`, `create-customer-segment`, `update-customer-segment`, `delete-customer-segment`, `list-segment-members`, `preview-customer-segment`; `src/infrastructure/prisma-customer-segment-repository.ts` + in-memory twin; controller (new, or extend `CustomerController`); `src/composition.ts`; `src/index.ts` exports.
- `apps/admin`: `src/infrastructure/cross-context/customer-segment-query.adapter.ts` (Prisma raw SQL; the only code that touches `orders.*` for this feature) + in-memory twin for the no-prisma wiring; `src/interfaces/customer-segments.admin-controller.ts` (guard); `src/http/customer-segment-routes.ts`; `src/composition.ts` (wire after `orders` and `identity`, add `customerSegments` to `WiredAdmin` near :545/:1423); `src/http/admin-routes.ts` (spread routes ~:1712; add `segmentId` to `listCustomersQuery` :188-192 and the handler :1722).
- `apps/admin-web`: `src/lib/api/customer-segments.ts` (+test); `src/app/customers/segments/{page,new/page,[segmentId]/page}.tsx`; `src/components/customers/segments/*` (list, fixed-field editor rows, members table); `src/components/navigation.ts` (children under customers); `src/app/customers/page.tsx` + `customers-toolbar.tsx` (`?segment=`); `src/messages/en.ts` + `ar.ts`; server actions following `app/customers/actions.ts`. Respect the Nusuj brand lock (AGENTS.md): reuse existing components, no colour/font/radius/button changes.
- NOT touched: `services/customer-360/*`, `packages/rules`, `packages/expression`, `packages/auth`.

### 7.8 Risks

1. **Performance**: the order aggregate is recomputed per request. Fine to roughly 50k customers / low hundreds of thousands of orders, not beyond. `count(*)` doubles the cost. `ILIKE '%x%'` search (already used by `GET /customers`) is a seq scan over the tenant's customers. No index on `customers.created_at` or `addresses.country`. Add a statement timeout, `first <= 100`, and run `EXPLAIN` on a seeded 50k tenant before shipping.
2. **Tenant isolation**: raw SQL bypasses Prisma's tenant guard (`prisma-sales-summary-query.ts:56-60`). Every table reference needs `tenant_id = $tenant`; run in `runReadScoped` so RLS is the backstop; write a two-tenant test for the adapter. `orders.customer_ref` is a bare TEXT id: join on `c.id::text`. The new table needs its own `FORCE ROW LEVEL SECURITY` + policy (the generic migration loop will not cover it).
3. **Staleness**: none by design (live SQL). There is no materialised membership, so no entered/exited history and no segment-triggered automations in Wave 1c. If automations later need membership events, that is where customer-360 segmentation could return.
4. **Semantic divergence**: amount spent must use the exact sales-summary rule or dashboard and segments will disagree; non-shop-currency orders are excluded (like `otherCurrencyOrders`); COD/unpaid orders count as purchases; country is free text (normalise `upper(trim())`, validate 2 letters); the existing Prisma consent list orders by `occurredAt asc` with no tiebreak, so SQL should add `id desc` and the domain rule should be stated.
5. **Cross-context coupling**: one adapter in `apps/admin` reads `identity` and `orders` tables directly; raw SQL is not type-checked, so renames fail silently. Add parity tests against the in-memory twin (precedent: `in-memory-sales-summary-query.test.ts`, `prisma-sales-summary-query.test.ts`).
6. **Input safety**: bound parameters only; closed enum of fields/ops; bounded arrays; `.strict()` bodies; server-side normalisation of tags/countries. No free-form query language, no regex.
7. **Permissions**: do not gate on `customer360:*`. `customers:read` lets a viewer see member emails, same as `GET /customers` today. Segment export is out of scope (would need `customers:export`).
8. **Concurrency**: CAS on `version` for PUT/DELETE; unique `(tenant_id, name_key)`; create idempotency via the existing `idempotent: true` flag.
9. **Dead-but-working customer-360 segment code stays**: document that it is not the Shopify-segment backend, to avoid a later second implementation.
10. **Next routing**: `/customers/segments` sits beside `[customerId]`; add a page-level test.
11. **In-memory wiring** (no `deps.prisma`): needs an in-memory segment query; if skipped, return an explicit "unavailable" instead of empty lists.
12. **Wave 1b data completeness**: tags and consents are staff-asserted only (no storefront consent capture), so "Email subscribers" may be empty for most tenants. Expected, not a bug.

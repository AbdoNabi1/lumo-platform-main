# ADR-0014: Per-request tenant scoping for repository composition, with RLS as defense-in-depth

- **Status:** Accepted
- **Date:** 2026-09-09
- **Deciders:** Staff architecture (`WP-10`, per `docs/plans/phase-7/WP-10-multi-tenant-runtime.md` T10.2)
- **Affected documents:** `docs/plans/phase-7/WP-10-multi-tenant-runtime.md`, `packages/db/prisma/MIGRATIONS.md`, `docs/architecture/23-platform-gap-register.md` (G-53, G-63, G-64), `docs/DECISIONS.md`

> **Amended 2026-09-09, same day as acceptance, before T10.3 began.** Three amendments, inline at
> their original decision points and summarized here: **(1)** the `runReadScoped` benchmark (point 3) is a gate on continuing the migration past context #1, not something deferred to "a slice"
> later, with a stated fallback and numeric threshold. **(2)** the RLS-migration bookkeeping (point 6) is a hard gate on Phase 2 (the connection-role switch), not on T10.3's start — the original text
> contradicted itself by calling it both. **(3)** Phase 1's `current_setting` assertion (point 5) is
> specified as an automated integration test enumerating every registered route/consumer with a
> countable N-of-N denominator, not a judgment call. No amendment reverses the Decision itself.
>
> **Corrected 2026-09-09, later the same day, after T10.3's first-context commit.** That commit's
> benchmark read a 16x-over-threshold result as a settled "take the fallback" signal. It was not:
> the bare-read baseline alone (118ms) is 12x the 10ms threshold, so the measurement's noise floor
> exceeds what it was trying to resolve, and the 16x number cannot discriminate `runReadScoped`'s
> real cost from this session's round-trip time to Supabase. A cheaper batched-array alternative
> (`runReadScopedBatched`) was implemented and benchmarked (point 3) — a modest, not dramatic,
> improvement. No production-representative (co-located) network path was available this session to
> re-measure from, stated plainly rather than substituted. **The fallback remains available and
> UN-TAKEN; contexts #2-40 stay unconverted until this is settled from a representative
> environment.**
>
> **Settled without a third benchmark, 2026-09-09, later still.** The mechanism reduces to a
> formula (point 3): `delta ≈ 3 × RTT`, so the ADR's 10ms p50 threshold is really a threshold on
> round-trip time to Supabase (≤3ms keep RLS, ≥4ms fallback justified — table in point 3). Checked
> from configuration rather than measuring again: the runtime's deployment region is **not decided
> or recorded anywhere in this repository** (`deploy.yml` applies to whatever cluster a secret
> points to; the k8s manifests are region-agnostic; no infra-as-code provisions a cluster anywhere;
> the only recorded region decision, Redis at `eu-west-1`, is about Redis, not the runtime compute).
> Recorded as **G-65**. The fallback stays UN-TAKEN — it is not being used to route around a missing
> deployment decision — and contexts #2-40 stay unconverted until a region is decided and its RTT to
> Supabase is measured.
>
> **Amended 2026-09-10 (Amendment 4).** The line above was itself wrong in the same shape Amendment
> 2 already corrected once: G-65 blocks PHASE 2 (the connection-role switch, where RLS starts
> enforcing and an unwrapped read would matter), not T10.3's start. The `tenantId`-threading
> migration is identical work regardless of which way G-65 resolves, `runReadScoped` is inert while
> still on `postgres`, and converting with it now is the reversible direction. **T10.3 proceeds for
> contexts #2-40, per context #1's exact shape including `runReadScoped`. G-65 remains open and
> remains a hard gate on Phase 2 only.**
>
> **PRINCIPLE APPROVED 2026-09-19 by the operator (in session); implementation still gated per
> sub-point — proposed 2026-09-17 (Amendment 5).** The operator approved naming the
> platform-operator exception category and the separate privileged database role it rests on. What
> was approved is the _principle_: no code implements any of it yet, and each sub-point below still
> needs its own sign-off before it is built, unchanged from the original proposal. T10.3's
> context-by-context sweep
> (contexts #2-40, now complete) closed the WRITE-side half of G-64 in every in-scope context and,
> along the way, surfaced three findings this Amendment records and proposes to resolve: **(1)** no
> context ever needed a genuinely platform-global (cross-tenant) write method — the `licensing`/
> `feature-registry` contexts were checked specifically per this WP's own caveat and both came back
> zero — so Option A's per-request scoping needed no exception category to convert #2-40. **(2)**
> `services/tenancy`'s own `Tenant` aggregate has a `tenantId`-semantics inconsistency worth fixing
> before Phase 2, detailed in point 8 below. **(3)** those two findings together motivate naming a
> **platform-operator exception category** now, ahead of any concrete caller needing it, rather than
> improvising one under pressure the first time an operator tool (tenant suspension, a support
> break-glass read, a cross-tenant migration script) needs to bypass per-request scoping legitimately.
> This amendment is **docs-only — no code in this repository implements it yet** — and requires
> explicit operator sign-off before any of it is built, for the same reason Amendment 2's
> `migrate resolve` step does: it touches live database roles and grants. See point 8 for the full
> proposal.
>
> **Amended 2026-09-18 (Amendment 6 — scope correction: T10.3's done-criterion was narrower than
> the actual defect).** `WP-10`'s own T10.3 task description was read in practice as "Prisma
> repositories converted," which let two non-Prisma-repository sites pass as complete for their
> context even though they pinned `tenantId` at construction the identical way: a non-Prisma store
> (`services/analytics`' `ClickHouseAnalyticsReadStore`, unexercised today but built against WP-3's
> future schema) and a non-repository adapter (`services/feature-flags`' `AggregateFeatureFlags`,
> which this WP's own T10.3 sweep should have caught but scoped past). Both are fixed as of this
> amendment. `docs/plans/phase-7/WP-10-multi-tenant-runtime.md`'s T10.3 entry now states the
> corrected done-criterion directly — **repositories, adapters, ports and stores alike, Prisma or
> otherwise** — plus a widened verification command (the original `deps\.tenantId|this\.tenantId
= |private readonly tenantId` pattern alone would still miss a third shape found this session:
> `apps/runtime/src/consumers/finance-settlement.consumers.ts:134` pins its tenant via
> `config.TENANT_DEFAULT_ID` with no `deps.tenantId` field at all). A full inventory of every
> remaining construction-time pin, classified against Decision point 3/4/7 below, lives under
> `WP-10`'s own T10.7 section rather than duplicated here. **This also corrects Decision point 7
> below**, unchanged in its own text but narrower than intended as written: "fail to boot if any
> repository is still constructed with a `deps.tenantId` field" must be read as "any repository,
> adapter, port, or store" — the boot-time assertion T10.4 builds needs to check the same wider
> shape this amendment names, not repository deps alone, or it would pass exactly the two sites
> this amendment just fixed.

> **Amended 2026-09-18 (Amendment 7 — the per-call `tenantId` must reach the event envelope, not only
> the repository query).** T10.3's sweep moved `tenantId` to a per-call repository parameter and, in
> doing so, briefly dropped it from the composition-time `EventContext` too
> (`rootEventContext(deps.idGenerator)` with one argument, e.g. `services/coupons/src/composition.ts:85`).
> Every integration event a converted context emitted therefore carried no `tenantId` in the outbox
> envelope (`packages/messaging/src/outbox/outbox-writer.ts:61` only stamps it when the context has
> one) — which made Decision point 4's G-64 fix (`followOnEventContext({ ..., tenantId:
envelope.tenantId })`) read nothing, and turned gap F-02 ("`tenantId` is optional on the envelope")
> into "absent". Inert only because the runtime is single-tenant. It was caught in review, by grepping
> `rootEventContext(` for one-argument calls, before the remaining 14 contexts converted and repeated it.
> **The rule:** the composition-time `EventContext` is a singleton and carries `correlationId` and
> `causationId` only; it must not carry a tenant (Decision point 3 forbids the construction-time pin).
> Every outbox write attaches the tenant at write time from the per-call value —
> `{ ...this.deps.context, tenantId }` — in the Prisma and in-memory branches alike. `rootEventContext`'s
> signature and every `…Deps` interface are unchanged. **identity** is the Decision point 1 case:
> `save(user | organization | membership, tx?)` takes no `tenantId` parameter because the aggregate
> carries it, so those six sites merge `aggregate.tenantId`
> (`services/identity/src/infrastructure/prisma-access-repositories.ts:57,96,135`, in-memory
> counterparts). **`services/example`** has no tenant at all and is excluded, with a comment at its
> write site, because `turbo/generators/config.ts:5` names it the canonical reference for generated
> contexts. **Guard:** `assertWriteTimeTenant` (`@platform/messaging/testing`) is called from each
> converted context's suite; it only catches contexts that call it, so
> `scripts/dev/check-outbox-tenant.mjs` (T10.3's done-criterion) separately fails any converted
> context's `outbox.write` call that never mentions `tenantId`. Making `tenantId` required on the
> envelope type remains the F-02/G-64 work and was deliberately not taken here.
>
> **Addendum, 2026-09-26 — G-64 took it.** `IntegrationEvent.tenantId` is now required, the six event-path
> sites that pinned `TENANT_DEFAULT_ID` read it per message, and a consumer that cannot find one never
> defaults: writes that add standing are refused, removals throw to the DLQ (D-067).
>
> **Addendum, 2026-09-18 — the check covers `packages` and `apps` too.** The first version of
> `scripts/dev/check-outbox-tenant.mjs` scanned `services` only and so missed
> `packages/usage/src/usage-recorder.port.ts:39` (`OutboxUsageRecorder`, the canonical port for
> `platform.usage.recorded`), which wrote `this.deps.context` with no tenant although
> `record.tenant` was in scope. Latent, not live: nothing constructs `OutboxUsageRecorder` today.
> Fixed by merging `record.tenant`; with no argument the script now scans `services`, `packages` and
> `apps`, and treats every package and app as converted (shared infrastructure must always merge
> the per-call tenant). `services/example` remains the only exemption, keyed by path.

> **Amended 2026-09-18 (Amendment 8 — non-uniform shapes found converting pricing, reporting,
> promotions, notifications and shipping).** Three shapes T10.3 will meet again; none is new design:
> (1) **"Leaf" is not "no port in `apps/*`".** These five were measured as leaves by checking which
> `apps/*` classes implement their ports. That misses the other direction: point 1 puts `tenantId`
> on every use-case input and controller call, so every caller in `apps/admin` (routes, admin
> controllers) and `apps/runtime` (seeds, consumers) changes in the same commit. Convert a context
> together with its callers; do not batch by "no adapter implements it".
> (2) **Non-repository dedup stores were keyed without a tenant.** `ProcessedProviderCallbackStore`
> (notifications) and `ProcessedCarrierWebhookStore` (shipping) keyed on `(provider, id)` alone, so
> one tenant's callback id would mark another tenant's as already processed — a leak with no
> `this.tenantId` for the T10.3 grep to find. Both ports now take `tenantId` per call and the
> in-memory adapters key on `(tenantId, provider, id)`. When converting a context, check every
> `has…`/`mark…` style store, not only repositories.
> (3) **A cross-context adapter for an unconverted port keeps a construction-time tenant.**
> `PricingValidationAdapter` (checkout), `OrdersNotificationAdapter` (orders) and
> `PaymentsNotificationAdapter` (payments) implement ports that carry no tenant, and widening those
> ports is the owning context's own conversion. Until then each captures the tenant at
> construction, is optional only because `AdminWiringDeps.tenantId` is, and fails closed without one
> — the same pin `PromotionValidationAdapter` already had. They are class (A) rows in the T10.7
> inventory and go away when checkout, orders and payments convert.

> **Amended 2026-09-26 (Amendment 9 — reconciliation with the code, at WP-10's definition of done).**
> This ADR was written before T10.3–T10.7 and amended around them; this amendment reads it against
> what the code does today and records every place they differ. Nothing here changes the Decision. Where
> an earlier paragraph is now wrong, the paragraph carries an inline `[As built 2026-09-26]` note rather
> than being rewritten, so the history stays legible. The differences, most important first:
>
> 1. **Tenant isolation rests entirely on application code, and only two Prisma repositories had a test
>    that could prove it.** Point 6 says RLS protects nothing on the application's path (the connecting
>    role has `BYPASSRLS`); that is still true. A mutation pass over WP-10 removed the `tenantId` filter
>    from the orders, catalog and inventory Prisma repositories one at a time and **nothing went red** —
>    their Prisma branches are covered only by `DATABASE_URL_TEST`-gated integration suites. Only
>    finance accounts and security principals had a fake-backed isolation test. Closed uniformly by
>    `scripts/dev/check-prisma-tenant-where.mjs`, run in the normal suite by
>    `packages/db/src/prisma-tenant-where.guard.test.ts`: every Prisma read/update/delete must name the
>    tenant in its `where`, with a keyed exemption list. It does **not** prove the value is the right
>    tenant. It found three id-only upserts/lookups, recorded as open in the script and the register
>    (G-75, G-76), of which **G-75 is a live cross-tenant defect** (below).
> 2. **Decision 2 is not implemented as written.** It says `PrismaUnitOfWork.run` takes `tenantId` and
>    issues `set_config('app.tenant_id', $1, true)` first. In the code `PrismaUnitOfWork.run(work)` takes no
>    tenant and calls plain `runInTransaction`. What exists is `runInTenantTransaction` and `runReadScoped`
>    (`packages/db/src/transaction.ts`), which do set it, and 122 call sites use `runReadScoped` **when no
>    `tx` was supplied**. A repository given a `tx` from `PrismaUnitOfWork` reuses it — and that
>    transaction does **not** carry `app.tenant_id`, contrary to the comment at
>    `services/catalog/src/infrastructure/prisma-catalog-repositories.ts:46`. Harmless today (the role
>    bypasses RLS); **a hard blocker for Phase 2**: under `lumo_app`, every write and every read inside a
>    unit of work would see or write nothing.
> 3. **Amendment 3's automated "N of N entry points" assertion does not exist**, so Phase 2's gate is unmet
>    and there is no count to report. No test asserts `current_setting('app.tenant_id', true)` is non-null
>    at any entry point.
> 4. **Decision 3's dependency-cruiser rule was not built.** `check-prisma-tenant-where.mjs` (item 1) is
>    a different, tenant-in-`where` check; it does not enforce "no bare `prisma.<model>` outside the two
>    helpers".
> 5. **Decision 7 is a runtime graph scan, not a lint.** `assertMultiTenantReady`
>    (`apps/admin/src/tenant-mode-guard.ts`) walks the composed graph at boot and probes the resolver chain
>    behaviourally. As of this amendment the probe also refuses the G-69 shape (a client header naming a
>    tenant for an authenticated principal) and a chain that resolves a blank value; before, its "real
>    chain" fixture used `headerTenantResolver` and would have passed the very bug G-69 fixed. The worker
>    has its own check, `assertWorkerTenantModeSupported`, with empty pin lists since G-64 and T10.6.
> 6. **Decision 4 (consumers) landed as G-64/D-067**: `IntegrationEvent.tenantId` is required and
>    consumers read it through `readEnvelopeTenant`/`requireEnvelopeTenant`. Two consumers had bypassed
>    the helper (`services/security` relation sync and `services/finance` ledger consumers) and accepted
>    `null`, whitespace and non-string tenants; the relation-sync **delete** acknowledged such a
>    revocation without applying it. Fixed. The wire deserializer is a bare `JSON.parse` cast, so every
>    consumer must validate for itself.
> 7. **Point 6's migration bookkeeping.** The two RLS migrations now exist in the repository
>    (`packages/db/prisma/schema/migrations/20260823000000_rls_tenant_isolation`,
>    `…20260823010000_rls_nullable_tenant_write_check`). Whether `migrate resolve` was run against the live
>    table is an operator matter this pass cannot check (no database access).
> 8. **Tenant lifecycle (T10.6, D-068) is not described above and is part of the design.** After
>    resolution and before authorization the pipeline consults a `TenantGate` (`packages/http`
>    `executeRoute` step 2b): suspended, cancelled and unknown tenants are refused, an unreadable status is
>    a 503. The platform tenant is protected from suspension. Point 8f's exemption is unchanged.
> 9. **Two fail-open defaults found and closed.** `createAdminHttpApi` under multi with no `tenantId` left
>    the tenancy routes **unpinned** (any tenant could create tenants); it now pins to `""`, i.e. nobody
>    (`deploymentScope`, `apps/admin/src/http/server.ts`). `KratosSessionAuthenticator` spread user-editable
>    `traits` **after** the verified `tenant_id` claim, so a trait named `tenant_id` overrode it; the
>    operator-written fields now come last. Neither was reachable in the shipped configuration (the runtime
>    always passes `tenantId`; the dev identity schema forbids extra traits) — both were one config change
>    away.
> 10. **Still future work, unchanged:** Phase 2 (the `lumo_app` role switch), `runReadScoped`'s latency
>     decision (G-65), the `lumo_app` grant narrowing (point 5), and the platform-operator role (8a–8e). None
>     was started and none should be as a side effect of this reconciliation.
>
> **Open cross-tenant defect (G-75), stated here because it decides whether multi is safe.**
> `apps/runtime/src/tracking/prisma-event-record-store.ts` `appendHistory` and `get` locate the base row
> with `findFirst({ where: { eventId } })` — no tenant — although the table's key is `(tenantId, eventId)`
> and the collector accepts a client-supplied `eventId`. Two tenants can share one; history recorded while
> delivering one tenant's event is written onto whichever tenant's row is found first. The port
> (`EventRecordWriterPort.appendHistory`) carries no tenant, so the fix is a `packages/tracking` port change,
> not a filter. Held as an executable `it.fails` in `prisma-event-record-store.tenant.test.ts`. **Not fixed in
> the pass that found it.**

## Context

ADR-0004 (2026-07-04) reserved `tenantId` on the integration-event envelope but explicitly deferred
the tenancy model itself: _"a follow-up ADR must decide tenant-per-deployment vs. shared schema,
unique-constraint scoping, and partition-key layout — before Phase 2 freezes DB schemas and
topics."_ ADR-0008 (same date) then decided the model — tenant-aware core, pooled default, tiered
isolation, Postgres RLS "as a second enforcement layer once real persistence lands" — but left the
runtime's actual composition unaddressed. This ADR is that follow-up: Phase 2 froze schemas and
topics on the ADR-0008 model over two months ago, and the runtime has run single-tenant since,
correctly refusing to boot in `TENANT_MODE=multi` (`apps/runtime/src/composition.ts:139-145`)
rather than silently mis-scoping requests. **[As built 2026-09-26: that refusal was removed in T10.4 and
replaced by `assertMultiTenantReady` (API) and `assertWorkerTenantModeSupported` (worker); see Amendment 9.]**

**What T10.1's reading pass found, verified against the actual code rather than assumed:**

1. **The request-level tenant resolution is already correct.** `packages/http/src/tenant-
resolution.ts`'s `resolveTenant` runs a resolver chain (header → verified-claim → domain) and
   returns `null` on no match; `packages/http/src/server.ts:339-348` calls it before any route
   handler runs and `throw`s `AuthorizationError` on `null` — genuinely fail-closed, no default
   tenant, for every route including public ones. **This part of T10.4's requirement is already
   done.** The gap is entirely downstream: `request.tenantId` is computed and stored, then never
   consumed by anything that builds a repository.
2. **Every composition-root call site pins `TENANT_DEFAULT_ID` at construction, uniformly.**
   `apps/runtime/src/composition.ts` builds ONE `PrismaClient` (`buildRuntimeCore`, shared process-
   wide) and every `wireX`/`buildX` function reads `core.config.TENANT_DEFAULT_ID` directly —
   `buildReturnsPaymentsPortAdapter:470`, `buildPaymentCapturedRuntime:502-503,515`,
   `buildTrackingIngestRuntime:566`, and `apps/runtime/src/api.ts:370,373,380` for the HTTP/admin
   surface. `apps/runtime/src/consumers/orders-paid.consumers.ts:429` and
   `apps/runtime/src/consumers/finance-settlement.consumers.ts:134` do the same for the Kafka
   consumer fleet (recorded separately as G-64 — inert today, a cross-tenant ledger write once a
   second tenant exists). This is not a handful of stragglers; it is the composition root's uniform
   pattern, end to end.
3. **Prisma repositories are not perfectly uniform in how they capture `tenantId` — this is useful,
   not just an obstacle.** Sampled across five contexts (`orders`, `catalog`, `finance`, `tenancy`,
   `security`): all five capture `tenantId: string` on a `deps` object at **constructor** time and
   read `this.deps.tenantId` in every method — one repository instance per tenant, built once.
   `services/identity/src/infrastructure/prisma-access-repositories.ts` is the exception:
   `PrismaUserRepository.findById(id, tenantId, tx?)` takes `tenantId` as a **per-call parameter**;
   `save(user, tx?)` needs none because the `User` aggregate already carries its own `tenantId` and
   the mapper reads it from there. **This is the shape Option A needs everywhere** — identity is a
   working precedent, not a bug to fix into conformance with the majority.
4. **`packages/db/src/prisma-repository.ts` — the shared base every concrete repository extends —
   carries no tenant concept at all**, and neither does `PrismaUnitOfWork.run`/`runInTransaction`
   (`packages/db/src/transaction.ts`). There is no single choke point already doing tenant work;
   `PrismaUnitOfWork.run` IS, however, the single choke point every transactional write already
   passes through (per ADR-0003), making it the natural site to add tenant scoping to, rather than
   inventing a new one.
5. **`followOnEventContext` (`packages/messaging/src/outbox/event-context.ts:22-32`) already exists
   to propagate an incoming message's `tenantId` into the context of events raised while handling
   it — and neither consumer builder in finding #2 calls it.** Both call `rootEventContext(idGen,
TENANT_DEFAULT_ID)` instead, which is why G-64 is a hardcoded value, not a missing feature.
6. **The live database already carries a second enforcement layer, exactly per ADR-0008 point 3,
   found by a prior read-only investigation (G-63) rather than built by this WP:** 130
   `tenant_isolation` RLS policies with `FORCE ROW LEVEL SECURITY` across 128 tables, applied
   2026-08-23 by two migrations that exist live but not in this repo's git history. **It currently
   protects nothing on the application's path** — both `DATABASE_URL`/`DIRECT_URL` connect as
   `postgres`, confirmed `rolbypassrls = true` — and nothing in this codebase ever sets
   `app.tenant_id`. **[As built 2026-09-26: `runInTenantTransaction` and `runReadScoped` now set it, and 122
   read call sites use the latter when no `tx` is supplied; `PrismaUnitOfWork` still does not (Amendment 9,
   item 2). RLS remains inert: the connecting role is still `postgres` with `rolbypassrls = true`, re-confirmed
   against the live database 2026-09-26.]** A second role, `lumo_app` (`rolbypassrls = false`, 558 grants), exists unused.
   `docs/plans/phase-7/WP-10-multi-tenant-runtime.md`'s "RLS interaction" section (approved
   2026-09-09, commit `33ece2d`, amended for rollout order, non-request paths, and the env-var
   split) is the design for turning this into real defense-in-depth; this ADR adopts it as binding
   and folds its rollout into the plan below rather than repeating it — see that section for detail
   this ADR does not re-derive.
7. **`lumo_app`'s grant set was audited further for this ADR (read-only) and needs narrowing before
   adoption, not just review.** Beyond the expected DML on business schemas, it holds `SELECT` +
   `DELETE` on `vault.secrets` (Supabase's own encrypted-secrets table — this runtime has no
   business reading or deleting rows there directly), full DML on `public._prisma_migrations` (the
   runtime's `PrismaClient` never touches this table — only the CLI does, via `DIRECT_URL`), and DML
   on `storage.buckets`/`storage.objects` (this runtime uses Supabase Storage through its S3-
   compatible API via `@platform/storage`'s `S3StorageService`, never through direct Postgres table
   access to `storage.*`). None of these three is a capability this runtime's own code path
   exercises. It has no other role memberships (cannot `SET ROLE` to anything more privileged) and
   no DDL-shaped grants (no `TRUNCATE`/`TRIGGER`/`REFERENCES`, confirmed). **Decision below revises
   the approved RLS section's "audit before trusting it" into "narrow before trusting it."**

## Decision

**We adopt Option A — per-request repository scoping — extending ADR-0003's existing transaction-
context threading to also carry `tenantId`, using `services/identity`'s access repositories as the
target shape rather than inventing a new one.**

1. **Repository ports gain `tenantId` as an explicit per-call parameter**, the same way `tx?:
unknown` already rides on every port method (ADR-0003). Concretely: a read method's signature
   grows a `tenantId` parameter (`findById(id, tenantId, tx?)`, matching
   `PrismaUserRepository.findById` today); a write method derives `tenantId` from the aggregate
   being saved, which already carries it, wherever the aggregate shape allows this (matching
   `PrismaUserRepository.save`). Composition builds every repository **once**, as a process-wide
   singleton — no `deps.tenantId` field, no per-tenant instance, no per-tenant cache to invalidate.
   This is the ~40-context mechanical migration `WP-10`'s own estimate already names; this ADR does
   not shrink that estimate, it confirms the target shape the migration converges on.
2. **[As built 2026-09-26: NOT implemented as written — `PrismaUnitOfWork.run(work)` takes no tenant and does
   not set `app.tenant_id`; see Amendment 9, item 2. A Phase 2 blocker.]**
   **`TransactionalUnitOfWork.run` (`PrismaUnitOfWork`, `packages/db/src/prisma-repository.ts`)
   grows a `tenantId` parameter and issues `SET LOCAL app.tenant_id = <tenantId>` (via
   `set_config('app.tenant_id', $1, true)`, parameterized — never string-interpolated) as the
   FIRST statement inside the transaction it opens, before invoking `work(tx)`.** This is the exact
   site ADR-0003 already made every transactional write pass through, so it is where the approved
   RLS section's "same transaction wrapper" concretely lives — no second wrapper is introduced.
3. **Non-transactional reads get an equivalent, not an exemption.** The approved RLS section already
   flags plain `findMany`-outside-`$transaction` as the sharp edge; this ADR resolves it by requiring
   every read call site to route through a `runReadScoped(tenantId, fn)` helper (new, alongside
   `runInTransaction`) that opens a single-statement Prisma interactive transaction, sets
   `app.tenant_id` the same way, and runs `fn(tx)` — never a bare `prisma.<model>.findX(...)` outside
   either helper. `pnpm arch` should gain a dependency-cruiser rule forbidding direct `this.prisma.
<model>` calls in a concrete repository outside these two helpers, once T10.3 lands, so this stays
   enforced rather than a convention someone can silently drift from. **[As built 2026-09-26: the rule was
   not built (Amendment 9, item 4).]**

   **Amended 2026-09-09 (Amendment 1 — benchmark is a gate on context #2, not a later slice).**
   `runReadScoped` turns every previously-bare read into `BEGIN` + `SET LOCAL` + query + `COMMIT` —
   one to two extra network round trips per read, against a pooled Supabase connection where round-
   trip time is not free. The benchmark T10.3 was going to run "once a slice exists" instead runs on
   the FIRST converted context, before any second context is touched, on a realistic paginated list
   read (a storefront product listing — `catalog.products` — not a single `findById`, which would
   hide the round-trip cost inside noise). Recorded p50/p99, bare read vs. `runReadScoped`-wrapped,
   same query (`WHERE tenant_id = 'tenant-local' AND deleted_at IS NULL ... LIMIT 21` +
   `variants` include), same 13-row live dataset, live Supabase session pooler, 30 iterations each,
   measured **2026-09-09**:

   |                         | p50           | p99           |
   | ----------------------- | ------------- | ------------- |
   | Bare read               | 118.21ms      | 137.43ms      |
   | `runReadScoped`-wrapped | 283.48ms      | 333.60ms      |
   | Delta                   | **+165.28ms** | **+196.16ms** |

   **Retracted 2026-09-09, same day, before contexts #2-40 started: the "not a borderline call"
   conclusion originally written here was wrong, for a reason stronger than the network-path caveat
   that followed it.** The bare-read baseline itself is 118ms p50 — **12x the 10ms threshold on its
   own, before `runReadScoped` adds anything.** When the noise floor a measurement is taken against
   exceeds the decision threshold by an order of magnitude, the measurement cannot discriminate: a
   16x-over reading here is an artifact of this dev session's round-trip time to
   `aws-1-eu-west-3`, not evidence about `runReadScoped`'s actual cost. The number above is
   **retained as a data point, explicitly marked as not decision-grade** — nobody should re-read
   "16x" later as a settled result.

   **The mechanism is knowable without measuring, and explains the number without needing to trust
   it:** a bare read is 1 network round trip; the interactive `runReadScoped` form is `BEGIN` +
   `SET LOCAL` + the query + `COMMIT` = 4, awaited in sequence (the engine cannot pipeline them
   without knowing in advance what the client will do next — see `runReadScopedBatched` below for
   the form that removes exactly this constraint). `118ms × ~2.4 ≈ 283ms` accounts for the entire
   observed delta — consistent with round-trip count, not with some fixed, RTT-independent
   processing cost `runReadScoped` adds. Co-located with the database in production at roughly 1ms
   RTT, the same 4-vs-1 ratio is a **~3ms delta** — under the 10ms threshold. The 16x number and the
   "~3ms in production" estimate are the same underlying ratio at two different RTTs; neither
   contradicts the other, and neither is a decision on its own.

   **Cheaper implementation, tried before deciding anything (same day, same session):**
   `runReadScopedBatched` (`packages/db/src/transaction.ts`) uses Prisma's `$transaction([...])`
   ARRAY form — `[prisma.$executeRaw`SET LOCAL ...`, operation]` — instead of the interactive
   `async (tx) => {...}` form, so the engine receives every statement up front and does not have to
   round-trip back to the JS event loop between them. **Hard constraint:** the array form cannot
   interleave application logic between statements, so it only fits a call site that is a single,
   already-constructed query with nothing to branch on first — `runReadScoped`'s interactive form
   stays the right tool for any call site that is not. Measured the same way, same session, same
   query, 30 iterations:

   |                                | p50      | p99      | ratio to bare |
   | ------------------------------ | -------- | -------- | ------------- |
   | Bare read                      | 137.00ms | 210.86ms | 1x            |
   | `runReadScoped` (interactive)  | 316.10ms | 736.42ms | 2.31x         |
   | `runReadScopedBatched` (array) | 292.87ms | 737.38ms | 2.14x         |

   The array form improved p50 by only ~23ms (7.3%) over the interactive form and showed no
   improvement on p99 (within noise, possibly worse) — a smaller win than "roughly halving the round
   trips" would predict. Recorded honestly rather than assumed: batching does not resolve the
   discrimination problem above either, since it is still being measured against the same
   noise-dominated baseline. It remains available as the lower-overhead option once a real decision
   can be made, and is deliberately **not wired into any repository yet** — `PrismaProductRepository`
   still uses interactive `runReadScoped` from the previous commit, unchanged by this finding.

   **Amended again 2026-09-09, later the same day: the decision does not need another benchmark —
   it needs one number, from configuration, and that number turns out not to exist yet.**

   **The formula, stated once so nobody re-derives it under time pressure:**

   ```
   delta ≈ 3 × RTT
   ```

   `runReadScoped` costs 4 round trips (`BEGIN`, `SET LOCAL`, the query, `COMMIT`) against a bare
   read's 1 — 3 EXTRA round trips, and Postgres's own server-side work for each (`BEGIN`/`COMMIT`
   are near-free; `set_config` is a single in-memory GUC write) is negligible next to network
   latency. The two live measurements above are consistent with this: session 1 (118ms bare, 283ms
   wrapped) implies RTT ≈ (283-118)/3 ≈ 55ms; session 2 (137ms bare, 316ms wrapped) implies RTT ≈
   (316-137)/3 ≈ 60ms — both point to roughly the same ~55-60ms round trip, which is a plausible
   dev-machine-to-`aws-1-eu-west-3` figure, not a production one. **Given the formula, the ADR's
   10ms p50 threshold resolves to a threshold on RTT itself:**

   | Measured RTT (e.g. a single `SELECT 1` from the deployment environment) | Implied delta | Decision                             |
   | ----------------------------------------------------------------------- | ------------- | ------------------------------------ |
   | ≤ 3ms                                                                   | ≤ 9ms         | **Keep RLS on reads — no fallback.** |
   | ≥ 4ms                                                                   | ≥ 12ms        | **Fallback justified.**              |

   No full benchmark is required once this number is known — a single `SELECT 1` timed from the
   actual runtime deployment environment gives RTT directly, and the table above gives the answer.

   **What this session could not do, stated plainly rather than substituted:** re-measuring from a
   network path representative of production (co-located with the database, same AWS region) needs
   infrastructure this sandboxed session does not have access to — no such environment was available,
   and no substitute (e.g. an estimate or a scaled-down proxy) was used in its place.

   **Checked from configuration instead, per this amendment's own instruction — and this is the
   actual finding, not a formality on the way to one:** the runtime's deployment region is not
   decided or recorded anywhere in this repository.
   - `.github/workflows/deploy.yml` decodes a `KUBECONFIG_B64` secret and runs `kubectl apply` —
     the cluster it targets, and therefore its region, is opaque to the repo; nothing here pins it.
   - `infrastructure/k8s/*.yaml` (kustomize manifests) are cloud- and region-agnostic workload
     definitions — `topologySpreadConstraints` reference generic zone/hostname topology keys, not
     an actual region. No Terraform, Pulumi, or other infra-as-code exists anywhere in this repo to
     provision a cluster in a specific place; the manifests assume a cluster already exists
     somewhere, reached however ops configures `kubectl` out-of-band.
   - `docs/operations/DEPLOYMENT_GUIDE.md` describes the pipeline (`validate → security → build →
sign → kubectl apply`) generically, with `ghcr.io/<org>/...` still a literal placeholder — a
     template, not a configured target.
   - The only region decision actually on record anywhere is Upstash Redis's, and it is about
     Redis, not the runtime: `docs/operations/CLOUD_RUNBOOK.md:42-43` (sourced from
     `docs/superpowers/plans/2026-09-04-run-platform-on-supabase-and-production-readiness.md:162`)
     places Redis in `eu-west-1`, deliberately, as "closest to Supabase's `eu-west-3`." That is a
     real co-location decision — but it says nothing about where the compute that would actually
     run `runReadScoped` (the `api`/`worker`/`scheduler` processes) lands. A cluster in, say,
     `us-east-1` would have low Redis-Supabase latency and high runtime-Supabase latency
     simultaneously — the Redis decision does not transfer.
   - `.env.example:72` sets `S3_REGION=us-east-1` — a third, inconsistent region for object storage,
     unexplained and un-reconciled with the other two. Noted for completeness; not the blocking
     finding, but evidence the region question has never been asked holistically.

   **This is recorded as G-65** (`docs/architecture/23-platform-gap-register.md`,
   `docs/KNOWN_GAPS.md`): the RLS-on-reads decision is blocked on a deployment-topology decision
   nobody has made, and — because the formula above is RTT-driven, not specific to this one query —
   the same undecided region blocks reasoning about latency for every other latency-sensitive path
   in the runtime, not just this one. **The fallback is NOT taken to route around the missing
   decision.** Once a region is decided (or an existing cluster's region is confirmed) and its RTT
   to Supabase is measured (one `SELECT 1`), the table above settles this without re-running the
   benchmark.

   **Fallback, stated now so it is a conscious choice and not a rediscovery under pressure:** reads
   may skip the transaction wrapper entirely and rely solely on Option A's TypeScript-layer
   `where: { tenantId }` predicate — the same isolation every repository already provides today,
   independent of RLS. This is strictly weaker defense-in-depth (a bug in the TypeScript predicate on
   a read is no longer caught by RLS at the database layer; it still is on a write, since writes
   already sit inside a transaction for the outbox append and pay no _additional_ round trip for
   `SET LOCAL`) but avoids a per-read transaction entirely. **Threshold for taking it, now resolved
   to the RTT table above:** deployment-environment RTT to Supabase ≥ 4ms (delta ≥ 12ms, over the
   ADR's 10ms p50 threshold) justifies the fallback for reads specifically; RTT ≤ 3ms (delta ≤ 9ms)
   keeps `runReadScoped`/`runReadScopedBatched` and no fallback is needed. Writes get `SET LOCAL`
   regardless of this decision either way, since they pay no extra round trip for it — they are
   already inside a transaction for the outbox append. **Status: the fallback remains available and
   UN-TAKEN.** The number the table needs (deployment-environment RTT to Supabase) has not been
   measured, because the deployment environment itself has not been decided (G-65) — there is
   nothing yet to measure RTT from.

   **Why this caution, stated as the asymmetry it actually is:** reverting a performance decision
   later is cheap — swap `runReadScoped` for the TypeScript-only fallback in each converted context,
   a mechanical change with no correctness risk either direction. Discovering a missed or buggy
   TypeScript tenant predicate across 40 contexts, with no RLS backstop because the fallback was
   taken, is not cheap — it is exactly the cross-tenant data leak this entire WP exists to prevent,
   found late, possibly in production. An unresolved performance question is worth sitting with
   longer than an unresolved isolation question.

   **Amended 2026-09-10 (Amendment 4 — G-65/the RLS-on-reads decision gates PHASE 2, not T10.3 —
   the same move Amendment 2 already made for migration bookkeeping, for the same kind of reason).**
   The original text here said contexts #2-40 "stay unconverted" pending G-65. That conflated two
   independent things, the same way the pre-Amendment-2 text conflated migration bookkeeping with
   T10.3's start:
   - **The 40-context cost is the `tenantId`-threading migration** (repository ports, use-case
     inputs, composition, callers) — identical work, identical shape, regardless of which way the
     RLS-on-reads question resolves. Nothing about G-65 changes what that migration looks like.
   - **`runReadScoped` is one line inside each converted read method**, behind the exact
     `tx`-reuse-or-wrap conditional context #1 established
     (`services/catalog/src/infrastructure/prisma-catalog-repositories.ts`'s `findById`/`paginate`
     — reuse the caller's `tx` if one exists, else wrap via `runReadScoped`). Converting **with**
     the wrapper now is the reversible direction: if the fallback is later taken, removing it is a
     mechanical, uniform, single-pattern deletion across contexts already converted. Converting
     **without** it and later needing it means touching all 40 contexts a second time — the exact
     "no context touched twice" waste `WP-10`'s own instructions warn against.
   - **Phase 2 (the `lumo_app` connection-role switch) is where the RTT question actually bites** —
     that is the moment RLS starts enforcing and an unwrapped read would start returning empty. T10.3
     never reaches that moment; it stays on `postgres` (RLS-bypassing) throughout, per the two-phase
     rollout above. `runReadScoped` is inert (a harmless extra round trip, no isolation effect) until
     Phase 2 flips the role — identical reasoning to why Phase 1's own `SET LOCAL` wrapper was safe
     to land while still on `postgres`.

   **Hard gate: Phase 2 does not start until G-65 (deployment region) is decided and the RTT
   threshold table is evaluated against a real number. T10.3 (contexts #2-40) is NOT gated on it and
   proceeds now**, converting every context with `runReadScoped` in place per context #1's shape —
   not the TypeScript-only fallback shape — so no context needs a second pass regardless of how G-65
   resolves.

4. **Consumers and other non-request paths obtain `tenantId` per the approved RLS section's per-path
   answers, not a single blanket rule:** Kafka consumers switch from `rootEventContext(idGen,
TENANT_DEFAULT_ID)` to `followOnEventContext({messageId, correlationId, tenantId:
envelope.tenantId})` (the function already exists for this — finding #5) and reject/dead-letter a
   message whose envelope has no `tenantId` when the event type requires one, never defaulting; the
   outbox relay and the two current scheduler jobs stay on a role that bypasses RLS, permanently, by
   design (they are genuinely cross-tenant sweeps, not per-request work — narrowing that would
   require redesigning what those processes do, which is out of scope here); the `WP-11` backfill
   script and any future per-tenant script call `runReadScoped`/the write equivalent explicitly with
   the one tenant they already know.
5. **Rollout stays two-phase, per the approved RLS section, with one addition: narrow `lumo_app`'s
   grants before Phase 2, not just audit them.** Revoke `vault.secrets` (`SELECT`, `DELETE`),
   `public._prisma_migrations` (all), and `storage.buckets`/`storage.objects` (all) from `lumo_app`
   — none is exercised by this runtime's actual code path (finding #7) — before the connection-role
   switch, as part of Phase 2's own precondition rather than a follow-up. Phase 1 (the `SET LOCAL`
   wrapper, landed while still on `postgres`, verified via a `current_setting('app.tenant_id',
true)` non-null assertion at every entry point) and Phase 2 (the role switch to the now-narrowed
   `lumo_app`, `DATABASE_URL` only, `DIRECT_URL` stays `postgres`) are otherwise unchanged from the
   approved section.

   **Amended 2026-09-09 (Amendment 3 — Phase 1's assertion must be automated and countable, not a
   judgment call).** "Verified via an assertion at every entry point" understates what has to exist
   before Phase 2 is allowed to run: an **integration test suite that programmatically enumerates
   every registered HTTP route and every registered Kafka consumer**, drives one request/message
   through each, and asserts `current_setting('app.tenant_id', true)` is non-null inside the
   transaction that entry point opens. The denominator is countable by construction — it comes from
   the same registration lists `packages/http`'s router and `apps/runtime/src/worker.ts`'s
   `supervisor.register(...)` calls already build, not a hand-maintained list that can silently go
   stale as routes/consumers are added. The suite reports **N of N covered**; Phase 2 does not start
   below N of N. **[As built 2026-09-26: this suite does not exist, so Phase 2's gate is unmet (Amendment 9,
   item 3).]** Without this, "the assertion holds everywhere" is exactly the kind of claim that
   feels true until the one route nobody thought to check ships 200s full of nothing — the precise
   failure mode Amendment 3 exists to close before it can happen, not after.

6. **The two untracked RLS migrations (G-63) are reconstructed and committed, then marked applied
   via `prisma migrate resolve --applied <name>` before PHASE 2 (the connection-role switch) — not
   before T10.3 starts.**

   **Amended 2026-09-09 (Amendment 2 — resolves a self-contradiction in the original text, which
   said both "before T10.3 starts" and "independent of T10.3's repository changes" in the same
   point).** The repository-signature migration (points 1-3 above) touches TypeScript only and does
   not depend on migration bookkeeping in any way — gating T10.3's start on it would block 40
   contexts of mechanical, low-risk work behind an operator sign-off (`migrate resolve` writes to the
   live migration-tracking table) that may not land on that timeline. Flipping `DATABASE_URL` to
   `lumo_app` on a migration history that still disagrees with the live database is a different kind
   of risk: `prisma migrate deploy` or `migrate status` behaving on stale assumptions during or after
   a role switch is exactly the class of surprise Phase 2 should not be carrying. **[As built 2026-09-26: the two migration files are now in the repository; the `migrate resolve` state of the
   live table is an operator matter (Amendment 9, item 7).]** **Hard gate: Phase
   2 does not start until the two migrations are committed and resolved. Strong preference, not a
   gate: land it before or during T10.3 anyway, since nothing is lost by doing it early and the
   operator sign-off it needs is independent of engineering time.** `migrate resolve` remains an
   operator action requiring explicit sign-off, not something this ADR authorizes this session to
   execute.

7. **`TENANT_MODE=multi`'s boot refusal (T10.4) is replaced by a boot-time assertion that per-request
   resolution is wired**, not simply deleted: composition must fail to boot if any repository is
   still constructed with a `deps.tenantId` field (a lint/arch-level check, not a runtime one, once
   #1 is complete) and a request/message with no resolvable tenant must be rejected at the
   transport/consumer boundary, never reach `runReadScoped`/`PrismaUnitOfWork.run` with an empty
   tenant.

8. **PRINCIPLE APPROVED 2026-09-19 (Amendment 5, proposed 2026-09-17) — a named platform-operator
   exception category, for the rare, legitimate case of a call that must read or write across
   tenants (tenant lifecycle management, a support break-glass read, a cross-tenant migration
   script), instead of improvising one the first time such a caller shows up.** The operator
   approved the principle in session on 2026-09-19. **Nothing below is built yet, and the
   implementation gate is unchanged: every sub-point still needs its own explicit operator sign-off
   before it is implemented**, the same class of gate Amendment 2 already put on `migrate resolve`
   (live database roles and grants, not TypeScript). Approving the category is not approving a
   privileged role in a live database.

   **8a. A distinct privileged database role — never `lumo_app`, never `postgres`.** Point 5 above
   already establishes two roles: `postgres` (`rolbypassrls = true`, used today, superuser-shaped)
   and `lumo_app` (`rolbypassrls = false`, 558 grants, the future request-serving role after Phase
   2's narrowing). Neither is the right handle for platform-operator work: `postgres` is far wider
   than any operator tool needs, and reusing `lumo_app` would mean either giving the request-serving
   role cross-tenant reach (defeating the entire point of Phase 2) or forking its connection string
   per-caller with no way to distinguish an operator action from an ordinary request in an audit log.
   **Proposed: a third role, e.g. `lumo_platform_operator`, with its own credentials, its own
   `DATABASE_URL`-equivalent env var, used by nothing except the specific, narrow set of
   platform-operator code paths named in 8d.**

   **8b. `BYPASSRLS` on that role, but grants narrowed to exactly what platform-operator tools need
   — not a second copy of `lumo_app`'s 558 grants, and not `postgres`'s superuser reach.** The
   attribute itself (`BYPASSRLS`) is appropriate here — a platform-operator action is, by
   definition, the one legitimate case of "not scoped to one tenant" — but finding #7's own
   discipline (`lumo_app`'s grant audit: revoke `vault.secrets`, `_prisma_migrations`,
   `storage.buckets`/`storage.objects` because this runtime's code never touches them) applies with
   more force here, not less: this role should hold DML on exactly the tables the concrete
   operator use-cases in 8d touch (starting with `tenancy.*`, per point 8f below), and nothing
   else, audited the same way before it is ever granted, not audited-later the way finding #7 had
   to catch `lumo_app` after the fact.

   **8c. No RLS escape hatch via a settable session variable.** A tempting shortcut is to keep one
   connection pool and let application code flip an in-band signal — e.g. `SET LOCAL
app.tenant_id = NULL` or a second GUC like `app.platform_operator = true` — to widen a policy's
   effective scope for "just this transaction." Rejected, for the same reason point 3's alternatives
   already rejected setting `app.tenant_id` outside a transaction wrapper: anything settable from
   the request-serving connection pool is one bug (a missing `if`, a copy-pasted branch, an
   injectable parameter) away from silently granting cross-tenant access from an ordinary request —
   the exact failure this whole ADR exists to close, reintroduced through a side door. **The
   privileged role from 8a is the only escape hatch; it is a distinct connection with distinct
   credentials, never a flag inside the shared connection's session state.**

   **8d. Every call gated by a distinct platform permission, and audited via the existing
   `Delegation` aggregate (`services/security/src/domain/delegation.ts`) — not a new audit
   mechanism.** `Delegation` (the domain class; `SecurityDelegation` is only its Prisma model name,
   `packages/db/prisma/schema/security.prisma:203-222`) already models "one principal may act
   [...] within a scope, optionally narrowed to specific permissions, and time-boxed," is
   WORM-audited per ADR-0023, and already defaults its `scope` to `SecurityScope.platform()`
   (`delegation.ts:22-27,54`) when none is given — i.e., it already has a platform-scoped shape,
   just never a target-tenant-scoped one, because it was built for principal-to-principal
   impersonation (`delegatorRef`/`delegateRef`), not "the platform, acting on tenant X." Proposed
   fit, not a new aggregate: grant a `Delegation` with `delegatorRef` naming the platform system
   account, `delegateRef` naming the human/service operator, `scope = SecurityScope.platform()`,
   and `permissions` naming the **one narrow platform permission that specific tool requires** (a
   new `platform:operator:*` family, e.g. `platform:operator:tenant-lifecycle`, mirroring the
   existing `"tenancy:create"`/`"warehouse:register"` string-permission convention rather than one
   blanket `platform:operator` permission covering every tool). Every privileged call: (i) checks
   the caller holds an active, unexpired `Delegation` grant for that exact permission — the same
   `AdminGuard.ensure` shape every other admin route already uses, extended with this one extra
   check — then (ii) opens its own transaction on the role from 8a, then (iii) records the action
   through the SAME `recordAudit(...)` helper `GrantDelegation`/`RevokeDelegation`/
   `StartImpersonation` already call
   (`services/security/src/application/delegation.use-cases.ts:75-80,103-107,164-169`), so
   platform-operator actions land in the one audit trail this codebase already has, not a second one.

   **8e. Tenancy's admin routes need to move, or at minimum be re-gated, once 8a-8d exist.**
   `apps/admin/src/http/tenancy-routes.ts` is currently spread into the same single route array as
   ordinary per-tenant business routes (`apps/admin/src/http/admin-routes.ts:1755`, alongside
   `cartRoutes`/`checkoutRoutes`/`promotionsRoutes`/etc.), served by the one Fastify instance whose
   `singleTenantGuardedResolver` (`apps/admin/src/http/server.ts:50-55`) guards every route against
   "the single tenant every Prisma repository was pinned to at composition time" — the ordinary
   per-request path this entire ADR scopes. But creating, activating, suspending, or rebranding a
   _tenant_ is inherently a platform-operator operation, not a per-tenant business operation — it
   does not make sense to route it through a resolver whose entire job is confirming the request
   matches the one tenant already pinned, because tenant-management requests are, by definition,
   not about "the" tenant. Proposed: once 8a-8d land, tenancy's create/activate/suspend/rebrand
   routes (not `tenancy:read`, which is a legitimate per-tenant self-service read) move to a
   separate router mounted on the privileged role, gated by the `platform:operator:*` permission
   family from 8d instead of the ordinary `"tenancy:create"`/`"tenancy:update"` strings they use
   today, and go through the `Delegation`-backed audit path in 8d instead of the ordinary
   `AdminGuard` path. Until this lands, tenancy write routes stay exactly as they are — this is a
   proposal, not a directive to move them as part of this WP.

   **8f. Finding: `Tenant.tenantId` — the aggregate that defines what a tenant IS has a `tenantId`
   scoping value that is neither self-referential nor domain-modeled, and this needs resolving as
   part of adopting 8a-8e, not left as-is.** `Tenant`'s own doc comment asserts `` `tenant.id` **is**
the platform `tenantId` primitive `` (`services/tenancy/src/domain/tenant.ts:25-26`) — i.e., a
   `Tenant` row's identity and its scoping key are meant to be the same value. But the Prisma row
   carries a **separate** `tenantId` column (`packages/db/prisma/schema/tenancy.prisma:4-19`,
   `@@unique([tenantId, slug])`), populated by `TenantMapper.toRow(tenant, tenantId)` as an
   **externally supplied second argument**, distinct from `tenant.id.toString()`
   (`services/tenancy/src/infrastructure/mappers.ts:44-56`) — the identical constructor-pinned-
   `deps.tenantId` shape point 1 above requires eliminating from every OTHER aggregate is still
   present here, on the one aggregate that defines what a tenant is. Confirmed not self-referential
   in practice: the integration test constructs it as an independent random value (e.g.
   `` `tenant-itest-tenants-${crypto.randomUUID()}` ``,
   `services/tenancy/src/infrastructure/prisma-repositories.integration.test.ts:50-51`), unrelated
   to any `Tenant` row's own `id`. The doc comment and the schema/repository code disagree about
   what this value is. Under this Amendment, the resolution is direct: a `Tenant` row's scoping
   `tenantId` should BE the platform-operator's own scope (i.e., every `Tenant` row this platform
   operates is scoped to the single platform-operator "tenant" from 8a-8d, not to the tenant the
   row describes — a `Tenant` record is platform-operator data, not tenant-self data), making the
   `tenancy` context's `save()`/finder methods candidates for reading their `tenantId` from the
   privileged connection's fixed scope rather than a per-request value, once 8a-8e land. Until then,
   `services/tenancy` stays parked (per Task A of this session) and this finding is recorded, not
   acted on.

   **Recorded exemption (2026-09-19, T10.4).** Because 8a-8d do not exist, `services/tenancy` is the ONE
   context `TENANT_MODE=multi`'s boot assertion exempts (`TENANT_PIN_EXEMPTIONS` in
   `apps/admin/src/tenant-mode-guard.ts`, a frozen single-entry list; a test fails if it grows). It stays
   pinned to the deployment tenant, and its admin routes 403 every other tenant under multi mode. This is
   a decision, not an oversight: removing the exemption is the work item once 8a-8d land, and a second
   entry is a finding to report, never a configuration to add.

   **Interaction with T10.6 (2026-09-26, D-068).** The exemption is unchanged and no entry was added. The
   request-boundary lifecycle gate reads a tenant's status through the existing pinned tenancy
   repository (`wireTenancy(...).tenantAvailability`), so the `Tenant` rows are still operator data read
   under the operator scope. The platform tenant is the deployment scope this point already names, and is
   now additionally refused suspension/cancellation (`protectedTenantIds`).

## Consequences

- **Positive:** the ~40-context migration converges on a shape (identity's access repositories)
  that already exists and is already tested in this codebase, rather than a novel pattern; RLS
  becomes real defense-in-depth instead of 130 policies enforcing nothing; G-64's cross-tenant write
  risk is closed by the same change that closes G-53, not a separate fix; the rollout order (wrapper
  first, role switch second, gated on an assertion) makes the failure mode of getting Phase 1
  incomplete a loud test failure, not a silent production incident.
- **Negative / trade-offs:** every repository port method touched by #1 changes its signature —
  this is the acknowledged ~40-context cost Option A always carried, not a new cost this ADR adds.
  `runReadScoped` adds one Prisma interactive transaction per read that previously ran as a bare
  query — a latency cost (an extra `BEGIN`/`SET LOCAL`/`COMMIT` round trip per read) that should be
  measured once T10.3 has a slice to benchmark, not assumed acceptable. Narrowing `lumo_app`'s
  grants before Phase 2 is one more precondition on an already-large rollout, but shipping Phase 2
  with `DELETE` on `vault.secrets` live on the request-serving role is a worse trade.
- **Follow-ups:** the dependency-cruiser rule in #3; a benchmark of `runReadScoped`'s per-read
  transaction overhead; T10.6 (tenant lifecycle) and T10.7 (cross-cutting sweep — Redis keys, cache,
  idempotency, rate limits, metrics labels, object-storage prefixes, ClickHouse) remain entirely
  their own work, unaffected by this ADR's scope; a future ADR if the outbox relay's permanent RLS-
  bypass exemption (#4) ever needs to change (e.g., moving it fully to CDC per `WP-11`'s F-06 removes
  the relay's need for this exemption at all, but does not obligate revisiting it now).

## Alternatives considered

- **Option B — a per-tenant composition cache.** Rejected per `WP-10`'s own pre-existing
  recommendation: a stale or mis-keyed cached graph serving one tenant another's repositories is
  exactly the failure this whole WP exists to prevent, and T10.1 found no concrete blocker in Option
  A that would justify it — if anything, finding #3 (identity's existing per-call precedent) makes
  Option A cheaper than the original estimate assumed, not harder.
- **Implicit tenant propagation via `AsyncLocalStorage`.** Rejected for the same reason ADR-0003
  rejected it for `tx`: explicit parameters are verifiable by the compiler and by review; this
  codebase's ethos is explicit wiring, no runtime magic (D-013). Extending the existing explicit
  `tx` parameter to also carry `tenantId` is consistent with that precedent; `AsyncLocalStorage`
  would not be.
- **Set `app.tenant_id` via a bare `$executeRaw` outside any transaction.** Rejected — the approved
  RLS section's own finding: Prisma's client-side connection pool can hand the next logical query to
  a different physical connection than the one that ran the `SET`, even under Supavisor's session-
  mode pooler, so this would work by accident under low concurrency and fail silently under load.
  `SET LOCAL` inside `PrismaUnitOfWork.run`/`runReadScoped` ties the setting to the transaction that
  needs it, with no reliance on connection affinity.
- **Skip narrowing `lumo_app`'s grants before Phase 2; revoke them opportunistically after.**
  Rejected — `DELETE` on `vault.secrets` and write access to `_prisma_migrations` are exactly the
  kind of "unexpected privileged grant" the approved RLS section already told T10.1 to check for;
  deferring the fix past the role switch means shipping the wider blast radius live, even briefly,
  for no benefit over narrowing first.

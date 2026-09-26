# WP-10 — Make the runtime actually multi-tenant

> **Read first:** [`../README.md`](../README.md) and [`README.md`](README.md), completely.
> **Depends on:** nothing. **Conflicts with:** WP-3, WP-5, WP-6, WP-7, WP-9 (`composition.ts`).
> **Closes:** G-53. This is the largest architectural change in Phase 7 — treat its ADR as the deliverable that matters most.

## Why this exists

Morbeh is sold as a SaaS. The database is built for it. The runtime is not, and it says so out loud.

`apps/runtime/src/composition.ts:134-146`:

```ts
// C2-6: every wireX({ prisma, tenantId }) branch pins its repositories to ONE tenantId at
// construction (ADR-0008), never per request. There is no per-request re-composition, so
// TENANT_MODE=multi would boot successfully and then either silently mis-scope every
// non-default-tenant request to TENANT_DEFAULT_ID's rows (if the HTTP tenant guard were absent)
// or reject every one of them (with it present) — neither is multi-tenancy. Fail closed at boot
// rather than advertise a mode nothing here implements.
if (config.TENANT_MODE === "multi") {
  throw new Error("Runtime composition does not support TENANT_MODE=multi: …");
}
```

That comment is correct, honest, and the right call for its time. It is also the thing standing
between this platform and its business model.

**Everything below the runtime is already tenant-aware:**

- ADR-0008 decided the model: tenant-aware core, pooled default, tiered isolation.
- Every business table carries `tenant_id` with tenant-led unique constraints (sprint 2.1).
- Every Prisma repository is tenant-scoped (sprint 2.2).
- `packages/http`'s pipeline resolves the tenant **first**, via a header/claim/domain chain
  (sprint 2.6).
- The event envelope carries `tenantId` (sprint H.1, ADR-0004).
- Storage keys are tenant-prefixed: `tenants/<t>/<ns>/<yyyy>/<mm>/<uuid>` (sprint 2.4).
- `services/tenancy` exists.

**The single missing piece is composition.** The object graph is built once, at boot, with one
tenant baked in.

## The decision you must make — and its two candidates

This is a genuine architectural fork. Pick one, and write the ADR **before** the code.

**Option A — per-request repository scoping.** Repositories stop capturing `tenantId` at
construction and instead take it from the transaction/request context that is already threaded
through every repository port and use case (ADR-0003 did that threading in sprint H.1 — read it).
The object graph stays a singleton.
_Cost:_ touching every repository signature — ~40 contexts.
_Benefit:_ one graph, constant memory, no cold start per tenant, and the change is mechanical and
uniformly verifiable.

**Option B — a per-tenant composition cache.** Build (and LRU-cache) one graph per tenant, resolved
per request from the tenant the HTTP pipeline already determined.
_Cost:_ memory grows with active tenants; a cold tenant pays construction latency; the cache becomes
a correctness surface (eviction, invalidation on config change) and a place tenants can leak into
each other.
_Benefit:_ far smaller diff.

**Recommendation: Option A.** The threading it needs already exists, it has no per-tenant runtime
state to get wrong, and the failure mode of Option B — a stale or mis-keyed cached graph serving one
tenant another's repositories — is exactly the failure this whole WP exists to prevent. Take Option B
only if you find a concrete blocker in Option A, and record that blocker in the ADR.

## RLS interaction — APPROVED 2026-09-09 (with amendments A/B/C); T10.2 still not started

**This section's design is approved.** It was written by a read-only investigation session
(2026-09-09) that did not touch runtime code and did not write to any database, then amended by the
operator the same day (rollout ordering, non-request-path coverage, and naming the env-var split —
see the sections below marked with each amendment letter). **Approval of this design is not
approval to start implementation**: T10.2's ADR has not been written, T10.3 has not started, and no
runtime code has changed as a result of this section. Everything below is additive to the Option
A/B decision above, not a replacement for it — Option A's per-request scoping is still the primary
isolation mechanism; RLS is defense-in-depth, and until Phase 2 below actually lands, it is not even
that. See G-63 (`docs/architecture/23-platform-gap-register.md`) and `docs/plans/BLOCKERS.md`'s
2026-09-09 entry for how this was found.

### What's actually true today, verified read-only against the live database

- **The live database already carries 130 `tenant_isolation` RLS policies with `FORCE ROW LEVEL
SECURITY` across 128 business tables** (`tenant_id = current_setting('app.tenant_id', true)` on
  both `USING` and `WITH CHECK`; `platform.outbox`/`platform.audit_events` get a nullable variant).
  These were applied directly to Supabase on 2026-08-23 by two migrations that exist in the live
  `_prisma_migrations` table but nowhere in this repo's git history (G-63).
- **Both `DATABASE_URL` and `DIRECT_URL` in `.env` connect as `postgres.<project-ref>`, which
  resolves to the underlying Postgres role `postgres`.** Queried directly:
  `rolbypassrls = true`. **RLS therefore currently protects nothing on the application's own
  connection path.** The 130 policies are real and enforced against every OTHER access surface —
  the Supabase SQL editor, PostgREST via the `anon`/`authenticated` roles, any future direct-psql
  session — but the runtime itself sails straight through them. Every bit of tenant isolation the
  application provides today is exactly what `WP-10`'s own "Why this exists" section already says:
  entirely absent above the database, and inside the database, entirely absent too, because the
  connecting role opts out of the mechanism that would otherwise enforce it.
- **Nothing in this codebase ever sets `app.tenant_id`.** Repo-wide search for
  `app.tenant_id`/`current_setting`/`SET LOCAL`/`set_config` across `packages/`, `services/`,
  `apps/` returns zero matches in source. `packages/db/src/client.ts`'s `createPrismaClient` builds
  a plain `PrismaClient` with no `$extends`/`$use`; `packages/db/src/transaction.ts`'s
  `runInTransaction` is a bare `$transaction(fn, options)` wrapper with no statement before `fn`
  runs; `packages/db/prisma/seed.ts` constructs its own unconfigured `PrismaClient` too. So this
  is not a case of an existing mechanism that merely needs a role swap — the session-variable-
  setting mechanism does not exist at all yet, on top of the role bypassing RLS. **Answer to the
  investigation's three-way question: (a) — the role bypasses RLS, and (independently) nothing
  sets the variable either.** Not (c)'s "app cannot read its own rows" — because (a) is also true,
  the app reads everything today regardless of tenant, which is the actual live exposure this
  section exists to close, not a crash.
- **A second role already exists in the database, unused: `lumo_app`.** `rolbypassrls = false`,
  `rolcanlogin = true`, 558 grants (SELECT/INSERT/UPDATE/DELETE across every business schema, plus
  read-only `SELECT` on `auth.*`). No comment/description is recorded on it. It was almost
  certainly created alongside the two untracked RLS migrations as the intended
  RLS-respecting application role, then never wired into `.env` — the same class of gap as the
  migrations themselves (G-63): infrastructure work landed directly against the live database and
  the corresponding application/config change was never made or never committed.
- **Both connection strings use Supabase's Supavisor pooler in session mode (port `5432`), not
  transaction mode (`6543`)** — a deliberate prior choice (`docs/operations/CLOUD_RUNBOOK.md` §1,
  to avoid the transaction-mode pooler's prepared-statement collisions). Session mode holds one
  dedicated backend connection per logical client connection for its lifetime, which is what makes
  `SET LOCAL` reliable — but only within a single Prisma interactive transaction
  (`prisma.$transaction(fn)`). Outside of that, Prisma's own client-side pool (sized via
  `connection_limit` in `buildDatasourceUrl`) can and does multiplex separate logical queries
  across different physical backend connections. A bare, non-transactional
  `$executeRaw` `SET app.tenant_id` would not reliably apply to whatever physical connection
  serves the very next query.

### Proposed design (for review, not yet approved) — APPROVED 2026-09-09 with amendments A/B/C below

**Amendment A changed the rollout to two ordered phases; doing the role switch before the wrapper
is verified is the difference between a safe rollout and a silent, product-wide outage. Phase 2
must not start until Phase 1's assertion holds everywhere.**

**Phase 1 — land the `SET LOCAL` wrapper first, while the role is still `postgres`.**

1. Set `app.tenant_id` via `SET LOCAL`/`set_config(..., true)`, as the first statement inside the
   same Prisma interactive transaction a request's repository calls run in — not as a detached
   `$executeRaw`. The transaction wrapper that already threads `tx` per ADR-0003, and Option A's
   per-request `tenantId` threading above, become the same wrapper: whatever opens a request's root
   transaction sets `app.tenant_id` from the same verified tenant the HTTP pipeline already
   resolved — never from a caller-supplied field, matching this WP's own existing "do not make
   `tenantId` a parameter the caller can pass freely" trap below.
2. Because the connection is still `postgres` (`rolbypassrls = true`) during this phase, `SET LOCAL
app.tenant_id` is a genuine no-op as far as query results go — RLS isn't evaluating it yet, so
   nothing can break and nothing needs to be rolled back if a call site is missed. That is exactly
   what makes this phase safe to land and verify incrementally, context by context, alongside T10.3.
3. **Verify coverage before moving on**: add an assertion (test-suite and/or a runtime debug check)
   that `current_setting('app.tenant_id', true)` is non-null inside every entry point's transaction
   — every HTTP route, every Kafka consumer's per-message handler, every scheduled job that touches
   tenant-scoped data. This assertion is the gate for Phase 2, not a nice-to-have: a call site that
   fails it today will silently return nothing under Phase 2's role, not throw, so this is the only
   point in the rollout where a gap is easy to see.
4. Read-only call sites are the sharp edge here too, not just writes — a plain `findMany` outside
   `$transaction` has no `app.tenant_id` set. Recommendation unchanged from the original proposal:
   every per-request entry point, reads included, opens its own `app.tenant_id`-scoped transaction;
   do not special-case which operations "need" it, and do not treat "it's just a read" as a reason
   to skip the assertion.

**Phase 2 — switch the connection role, conditional on Phase 1's assertion passing everywhere.**

5. Only once step 3's assertion holds across every entry point (request paths, consumers, and the
   non-request paths in the next section — see Amendment B), switch the runtime's request-serving
   connection role from `postgres` to `lumo_app` (env-var mechanics in the next section — Amendment
   C). Before relying on it, audit its 558 grants as part of T10.1's reading pass — it predates this
   WP, was never reviewed against ADR-0008's tenant model, and its provenance is unrecorded; confirm
   it has no unexpected privileged grants (sequence ownership, `platform.*` schema access beyond
   what the runtime needs, any path to `SET ROLE` into something more privileged) before trusting it
   as the isolation boundary.
6. After the switch, a call site Phase 1 missed stops being invisible: `tenant_id =
current_setting(...)` with a NULL setting matches nothing, so a FORCE-RLS `SELECT` returns an
   empty result — 200, empty body, no error, indistinguishable in monitoring from "this tenant
   genuinely has no data" (exactly the outage shape Amendment A calls out). A `WITH CHECK` failure
   on a write is louder (Postgres raises a real policy-violation error), so writes fail faster than
   reads do — reads are the ones Phase 1's assertion has to actually catch before Phase 2 runs.
7. **Treat RLS as defense-in-depth, never a substitute for T10.3's application-level scoping and
   T10.4's reject-on-unresolved-tenant guard**, in both phases. During Phase 1, RLS enforces nothing
   at all (role bypasses it), so the TypeScript-layer guard is the only real protection. After
   Phase 2, RLS adds a second layer, but nothing here reduces what T10.3/T10.4/T10.5 must still do.

### Non-request paths (Amendment B) — no HTTP request, no HTTP-resolved tenant

The proposal above only covers per-request entry points. Five paths in this codebase run with no
request and no HTTP-resolved tenant; each is addressed on its own terms below rather than assumed
to fit the request-path pattern.

- **Kafka consumers** (`OrdersPaidConsumer`/`FinanceOrdersPaidConsumer`,
  `PaymentsCapturedConsumer`/`RefundsIssuedConsumer`'s atomic wrappers). **Contrary to what might be
  assumed, these do NOT currently read `tenantId` off the event envelope at all**, even though
  `IntegrationEventEnvelope.tenantId` exists on the wire as an optional field
  (`packages/domain-events/src/integration-event.ts:35`). Both consumer builders hardcode
  `const tenantId = core.config.TENANT_DEFAULT_ID` at construction time
  (`apps/runtime/src/consumers/orders-paid.consumers.ts:429`,
  `apps/runtime/src/consumers/finance-settlement.consumers.ts:134`) — the same boot-time-pinned,
  single-tenant pattern this whole WP exists to remove from the request path, just not previously
  called out for the consumer path specifically. **This means "read the envelope's tenantId" is not
  something to layer on top of the existing consumers — it is a T10.3-scope change to make first**
  (per-message, not per-builder), and only after that lands can a consumer's per-message handler
  open a `SET LOCAL app.tenant_id`-scoped transaction from the tenant it just read. Where the
  envelope's `tenantId` is genuinely absent (it's optional — platform-level events can omit it),
  the consumer needs an explicit policy per event type, not a silent fallback to
  `TENANT_DEFAULT_ID`, matching this WP's "never default a missing tenant" rule.
- **The outbox relay** (`packages/messaging/src/outbox/outbox-relay.ts`, backed by
  `PrismaOutboxStore.fetchPending` — `packages/db/src/messaging/prisma-outbox-store.ts:46-51`).
  **Legitimately exempt, not a gap to close.** `fetchPending` queries
  `where: { status: "pending" }` with no tenant filter, by design — a single relay process draining
  every tenant's pending rows from one shared table in one pass. **The nullable RLS variant on
  `platform.outbox`/`platform.audit_events` is NOT sufficient for this** — confirmed by reading the
  policy, not assumed: `(tenant_id IS NULL) OR (tenant_id = current_setting(...))` adds visibility
  into platform-level (null-tenant) rows _alongside_ whatever single tenant `app.tenant_id` happens
  to be set to; it does not grant visibility into every tenant's rows at once. Under `lumo_app` with
  any single tenant set (or unset), the relay would drain at most one tenant's backlog per pass,
  silently — the exact "stops publishing with no error" failure this amendment named. The relay
  must keep connecting via a role that bypasses RLS (or, if that becomes unacceptable later, would
  need a dedicated policy exception scoped to a named relay role — a separate, larger design
  question, not this WP's to resolve as a side effect). In production this table is meant to be
  streamed by Debezium (CDC) rather than drained by this relay at all (see `WP-11`'s F-06/T11.5) —
  worth noting as a reason this exemption may matter less over time, not a reason to skip stating it
  now.
- **Scheduler jobs.** As of this reading, exactly two jobs are registered
  (`apps/runtime/src/scheduler.ts`): `outbox-prune` (prunes `platform.outbox` once CDC confirms a
  flush past a row — cross-tenant by the same nature as the relay above) and `cdc-watchdog` (polls
  Kafka Connect's REST API for connector health — touches no tenant data at all). **Correction: this
  amendment's premise that "scheduled jobs were classified platform-global vs merchant-scoped in
  WP-0" does not check out** — grepped `docs/plans/phase-7/WP-0-baseline-truth.md` for
  "platform-global"/"merchant-scoped" and found no matches; those terms appear only in `WP-14`/
  `WP-15`, in unrelated contexts (SaaS billing, platform-console RBAC), not scheduler jobs. Stating
  this plainly rather than citing a classification that doesn't exist. Both current jobs are
  legitimately exempt on the same reasoning as the relay (`outbox-prune`) or trivially (
  `cdc-watchdog` touches no business data). `WP-10`'s own T10.7 already anticipates a
  future _merchant-scoped_ job might be added ("a job that runs 'for the tenant' must now run per
  tenant") — when that happens, that job (not either of these two) would need to loop tenants and
  open one `app.tenant_id`-scoped transaction per tenant per tick; no such job exists in this
  codebase today.
- **`WP-11`'s finance-settlement backfill** (`apps/runtime/src/backfill-finance-settlement.ts`,
  `apps/runtime/src/backfill/prisma-payment-settlement-source.ts`). **Not exempt — already
  app-level tenant-scoped, but only for one tenant per run, and will need the same `SET LOCAL`
  treatment as any other path once `lumo_app` is live.**
  `PrismaPaymentSettlementSource` takes an explicit `tenantId` constructor argument and filters
  every query by it (`prisma-payment-settlement-source.ts:40,52`) — this part is already correct
  and does not rely on RLS today. But the runnable script hardcodes
  `const tenantId = core.config.TENANT_DEFAULT_ID` (`backfill-finance-settlement.ts:26`) — one
  tenant per invocation, not a loop over all tenants; a pre-existing scope gap, independent of RLS,
  noted here but not fixed by this proposal. Once `DATABASE_URL` becomes `lumo_app`, this script
  must open its own `SET LOCAL app.tenant_id = <the tenantId it already has>` before its queries —
  otherwise its already-correct `where: { tenantId }` filter returns nothing anyway, the same silent
  emptiness described above for any other unset-variable path.
- **`packages/db/prisma/seed.ts`.** Read in full: it is currently a no-op stub ("Empty seed
  infrastructure (Sprint 0.2). No business data is seeded" — it connects, logs, and disconnects,
  zero `tenantId` references). **Trivially exempt today, but not by any tenant-aware design** — it
  constructs a bare `new PrismaClient()` with no `datasourceUrl` override, so it inherits the
  schema's own `url = env("DATABASE_URL")` directly; once `DATABASE_URL` becomes `lumo_app`, this
  script's connection changes too (unlike `migrate`, which uses `directUrl`/`DIRECT_URL` — see
  Amendment C below). Whatever script actually populated the live database's demo dataset (3 orders,
  13 products, per `docs/operations/CLOUD_RUNBOOK.md` Task 8) is **not** this file — it was some
  other, unidentified script or manual action. That script is out of scope for this investigation to
  track down, but whoever implements T10.3 should find it before relying on `pnpm db:seed` as "the"
  seeding path, and apply the same per-tenant `SET LOCAL` treatment as the backfill script above if
  it's ever pointed at `lumo_app`.

### Naming the environment-variable split (Amendment C)

Confirmed against how `packages/db` actually reads these two variables, not assumed from their
names:

- **`DATABASE_URL` is what the runtime's `PrismaClient` actually queries through.**
  `packages/config/src/server/config.ts:144` sets `DatabaseConfig.url` directly from
  `e.DATABASE_URL` (validated in `env.ts:22`); `packages/db/src/client.ts`'s `createPrismaClient`
  passes `datasourceUrl: buildDatasourceUrl(config)` — a full override of the schema's own `url`
  field for every request-serving `PrismaClient` instance. `packages/db/prisma/seed.ts`'s separate,
  raw `new PrismaClient()` has no override, so it falls through to the schema's own
  `url = env("DATABASE_URL")` too — same variable, same effective role. **`DATABASE_URL` becomes
  `lumo_app`.**
- **`DIRECT_URL` is read only by the Prisma CLI itself** (`main.prisma`'s `directUrl =
env("DIRECT_URL")`), for `migrate deploy`/`migrate dev`/`db pull`/`studio` — operations needing
  real DDL rights (`CREATE`/`ALTER TABLE`, `CREATE POLICY`) that `lumo_app`'s 558 grants do not
  include (confirmed: SELECT/INSERT/UPDATE/DELETE only, no DDL grants). It is never consulted by a
  running `PrismaClient` at request time. **`DIRECT_URL` stays `postgres`.**
- **One inconsistency worth flagging, not silently correcting**: `main.prisma`'s own inline comment
  (dated "Phase A.43") claims `DATABASE_URL` points at the _transaction_ pooler (port `6543`) and
  `directUrl` at the _session/direct_ connection (port `5432`) — but the live `.env` and
  `docs/operations/CLOUD_RUNBOOK.md` §1 both show **both** variables currently pointing at the
  _session_ pooler (port `5432`), deliberately, specifically to avoid the transaction-mode pooler's
  prepared-statement collisions (`packages/db/src/client.ts` never sends `?pgbouncer=true`). The
  comment describes a plan that was never carried out; the runbook wins per this session's own
  reading order. Practical implication for this amendment: after the role split, `DATABASE_URL`
  (now `lumo_app`) and `DIRECT_URL` (still `postgres`) should both keep pointing at the session
  pooler, port `5432` — do not "fix" `DATABASE_URL` to the transaction pooler port while doing this,
  or the prepared-statement issue CLOUD_RUNBOOK already worked around comes back.

### Migration bookkeeping (unchanged from the original proposal, still flagged for approval)

8. The two untracked RLS migrations should be reconstructed from the live introspection already
   recorded in `docs/plans/BLOCKERS.md`'s 2026-09-09 entry, committed to this repo, and then marked
   applied via `prisma migrate resolve --applied <name>` for each — not re-run through `migrate
deploy`, since the DDL they contain already exists live and re-applying it would either error
   (policy already exists) or risk a subtly different result if the reconstruction doesn't match
   the original byte-for-byte. This should land before or alongside T10.2's ADR so migration history
   stops drifting from deployed reality and any future `migrate diff` has an accurate baseline.
   `migrate resolve` writes to the live migration-tracking table — still out of scope for a
   read-only investigation, still flagged here for explicit operator approval, still not executed.

**Open question this proposal does not resolve:** whether `lumo_app`'s existing 558 grants are
actually correct for what `WP-10` needs, or whether they were sized for a narrower purpose and need
widening/narrowing — that audit is T10.1 work, not something a read-only session should conclude
from grant counts alone.

## Tasks

- [x] **T10.1 — Read before touching anything.**
      ADR-0008, ADR-0003, ADR-0004 read in full; `apps/runtime/src/composition.ts` read in full
      (confirmed every `wireX`/`buildX` call site pins `TENANT_DEFAULT_ID`, including
      `api.ts:370,373,380`'s HTTP/admin surface — `request.tenantId` is resolved correctly by
      `packages/http` but never consumed downstream); `packages/http`'s tenant-resolution chain read
      in full (already correct and fail-closed — `resolveTenant` + `server.ts:339-348`'s
      `AuthorizationError` throw on an unresolved tenant); `services/tenancy/src/` sampled (`Tenant`
      aggregate, `PrismaTenantRepository`/`PrismaWorkspaceRepository` — same constructor-injected
      pattern as everywhere else); five Prisma repositories sampled across contexts (`orders`,
      `catalog`, `finance`, `tenancy`, `security` — all constructor-inject `tenantId`;
      `services/identity`'s access repositories are the one exception, taking `tenantId` per-call —
      the exception T10.1 asked to find, and the shape ADR-0014 adopts as the target). Additionally,
      per the approved RLS section: `lumo_app`'s full grant set audited (558 grants — clean DML only,
      no DDL, no other role memberships, but `vault.secrets`/`_prisma_migrations`/`storage.*` grants
      this runtime never uses, revoke before Phase 2 per ADR-0014); the two reconstructed RLS
      migrations reviewed (content already recorded in `docs/plans/BLOCKERS.md`'s 2026-09-09 entry).
      Findings recorded in [ADR-0014](../../architecture/adr/0014-per-request-tenant-scoping.md).

- [x] **T10.2 — Write the ADR first.**
      [ADR-0014: Per-request tenant scoping for repository composition, with RLS as defense-in-depth](../../architecture/adr/0014-per-request-tenant-scoping.md),
      registered as D-053 in `docs/DECISIONS.md`. Option A adopted, extending ADR-0003's `tx`
      threading to also carry `tenantId` rather than a new mechanism; migration path and RLS rollout
      both specified with exact file/site targets (`PrismaUnitOfWork.run`, a new `runReadScoped`
      helper, `followOnEventContext` for consumers); tenant isolation verification specified as a
      dependency-cruiser rule (once T10.3 lands) plus the approved RLS section's
      `current_setting`-non-null assertion gate between Phase 1 and Phase 2. **T10.3 has NOT
      started** — this ADR is submitted for review before any implementation begins, per this
      task's own instruction.

- [ ] **T10.3 — Implement it.**
      Mechanically, context by context. Keep the gates green between contexts rather than at the
      end; a 40-context change that only compiles at the end is unreviewable and unbisectable.
      Every non-uniform repository you find is worth a note in the ADR.

      **Done when (corrected 2026-09-18): no construction-time tenant pinning anywhere in the
                                                                                          converted context — repositories, adapters, ports and stores alike, Prisma or otherwise —
                                                                                          not "Prisma repositories converted."** The original, narrower wording let a context pass as
                                                                                          "done" while a non-Prisma store (`services/analytics`' `ClickHouseAnalyticsReadStore`) or a
                                                                                          non-repository adapter (`services/feature-flags`' `AggregateFeatureFlags`) still pinned
                                                                                          `tenantId` at construction — both found and fixed in the session that made this correction
                                                                                          (see the T10.7 inventory above for the sites still outstanding under the wider definition).
                                                                                          **Verification command is the T10.7 inventory's own repo-wide grep, not a `services/`-only
                                                                                          one** — the T10.3 sweep's original pattern (`grep ... packages apps services`, restricted in
                                                                                          practice to `services/*/src/infrastructure/prisma-*.ts`) would have missed
                                                                                          `apps/runtime/src/consumers/finance-settlement.consumers.ts:134`, which pins its tenant via
                                                                                          `config.TENANT_DEFAULT_ID` with no `deps.tenantId`/`this.tenantId =` shape at all:

                                                                                          ```bash
                                                                                          grep -rnE "deps\.tenantId|this\.tenantId = |private readonly tenantId" \
                                                                                            --include="*.ts" packages apps services | grep -v node_modules | grep -v "\.test\." | grep -v coverage
                                                                                          grep -rn "TENANT_DEFAULT_ID" --include="*.ts" apps services packages | grep -v node_modules | grep -v "\.test\."
                                                                                          ```

                                                                                          A context is done when every match for it (repository, adapter, port, or store) is gone from
                                                                                          the first command's output, and every match for it in the second command's output is
                                                                                          classified (A)/(B)/(C)/(D) per the T10.7 inventory's own scheme — not merely absent from a
                                                                                          hand-picked list of Prisma files.

                                                                                          **Event-envelope tenant (added 2026-09-18, ADR-0014 Amendment 7).** Repository-side
                                                                                          conversion is not complete until the tenant also reaches the outbox envelope. Two more
                                                                                          conditions, both required:

                                                                                          - The context's suite calls `assertWriteTimeTenant` (`@platform/messaging/testing`,
                                                                                            `packages/messaging/src/testing/write-time-tenant.ts`) against its repository. It only
                                                                                            catches contexts that call it — a context that forgets passes silently — which is why the
                                                                                            next check exists.
                                                                                          - This exits 0 (no output). It lists every `outbox.write(...)` call in a converted context, package or app
                                                                                            whose argument list never mentions `tenantId`:

                                                                                          ```bash
                                                                                          node scripts/dev/check-outbox-tenant.mjs
                                                                                          ```

                                                                                          "Converted" is derived: a context still building `rootEventContext(deps.idGenerator, tenantId)`
                                                                                          in its composition is skipped, so unconverted contexts cause no false positives and a
                                                                                          context joins the check the moment it converts. With no argument it scans `services`,
                                                                                          `packages` and `apps` (packages and apps are always checked; it first scanned `services` only and
                                                                                          missed `packages/usage`). Verified 2026-09-18 by breaking
                                                                                          `services/coupons/src/infrastructure/prisma-coupon-repository.ts:50` to pass the bare
                                                                                          singleton context: the command printed that site and exited 1; restored, it exits 0. It
                                                                                          does **not** catch a merge of the *wrong* tenant, a write hidden behind a helper, or a
                                                                                          context that never writes; `services/example` is exempt (template, no tenant).

- [x] **T10.4 — Remove the boot refusal, and replace it with a real guard.** _Done 2026-09-19. **This makes `TENANT_MODE=multi` possible, not safe** — T10.5's adversarial isolation suite is what makes it safe, and it has not been written. Do not set `TENANT_MODE=multi` in any env file, manifest or CI job until it has._
      Deleting the `TENANT_MODE === "multi"` throw was the last step, not the first. What replaced it: - **API** — `createAdminHttpApi` (`apps/admin/src/http/server.ts`) resolves the tenant per request under multi (`claimTenantResolver` then `headerTenantResolver`; claim first so a forged header cannot override a verified tenant) and runs `assertMultiTenantReady` (`apps/admin/src/tenant-mode-guard.ts`) before serving. It (1) **probes the actual resolver chain** with two distinct tenants and with no tenant — a pinned resolver, an empty chain, or one that defaults all fail — and (2) **scans the composed graph** for any object still carrying a `tenantId` (ADR-0014 point 7 as widened by Amendment 6). All failed checks are named in one error, same shape as `apps/runtime/src/api.ts`'s `assertProduction*` guards. `resolveTenant` is untouched: still no default, unresolved is an error. - **The one exemption** — `services/tenancy`, ADR-0014 point 8f (a `Tenant` row is platform-operator data; the operator identity, 8a-8d, does not exist yet). `TENANT_PIN_EXEMPTIONS` is a frozen single-entry list keyed on the exact graph key `tenancy`; `tenant-mode-guard.test.ts` fails if it grows. Because tenancy stays pinned to `TENANT_DEFAULT_ID`, its routes are wrapped (`pinRoutesToTenant`) to 403 every other tenant. **Removing the exemption is the work item**: when 8a-8d land, tenancy reads the operator scope and the list becomes empty. - **Worker — refused multi until G-64; since 2026-09-26 it refused only `bootstrapSecurity`, and since T10.6 (2026-09-26) nothing in the inventory — `BOOT_TENANT_PINS` and `EVENT_PATH_TENANT_PINS` are both empty; the guard still refuses if either gains an entry.** _Historical text:_ its event consumers took `TENANT_DEFAULT_ID` at construction (T10.7 class D, G-64; the envelope had no required `tenantId`). `assertWorkerTenantModeSupported` (`apps/runtime/src/tenant-mode-guard.ts`) refuses before anything is built and names each pinned consumer. This is a separate, still-failing check, not an exemption. - **`TENANT_DEFAULT_ID`** — all 28 references classified (14 code, 14 comment-only); `TENANT_DEFAULT_ID_SITES` has exactly one `request-path` site (`apps/runtime/src/api.ts`), and a test diffs the table against the source tree. - **Evidence** — the assertion against a deliberately pinned graph (`singleTenantGuardedResolver` + an `orders.repo.tenantId` pin), from `tenant-mode-guard.test.ts`:

      ```text
                                          admin: refusing to boot with TENANT_MODE=multi — 2 checks failed:

                                          1. resolver-chain: the configured chain is not a real per-request resolver — probe tenant "probe-tenant-a" resolved to null (a pinned resolver rejects or rewrites every tenant but its own); probe tenant "probe-tenant-b" resolved to null (a pinned resolver rejects or rewrites every tenant but its own).

                                          2. construction-time-tenant: these objects in the composed graph still carry a tenantId fixed at construction (ADR-0014 point 7 / Amendment 6): orders.repo.tenantId.
                                          ```

                                          And on the real graph with the exemption removed, only `tenancy.tenancy.deps.createTenant.deps.tenants.deps.tenantId` and `…deps.context.tenantId` are reported.
                                          **Known limits, stated plainly:** the graph scan sees object fields, not values closed over in lambdas; and a principal with no `tenant_id` claim still falls through to the `x-tenant-id` header — T10.5's forged-header case must decide whether that fallback survives. _(Resolved by T10.5: it does not survive — G-69.)_

- [x] **T10.5 — Tenant isolation tests. This is the deliverable.** _Done 2026-09-20 — and it found that multi mode is **not** safe: two open findings (G-67 authorization, G-68 storage keys) and one found-and-fixed (G-69, the header fallback)._
      **Update 2026-09-20 (later): G-68 is closed** (both storage doors check the key against the tenant; the client still names the key, validated not minted — G-71). Multi remains forbidden on G-70.
      **Update 2026-09-20 (same day): G-67 was split.** The decision cache and audit record are fixed (ADR-0015: `Principal.tenantId`, tenant-scoped cache key, tenant on the audit record) and G-67 is closed. The Keto tuple model still carries no tenant — a grant is global per principal — and that is **G-70**, open, Critical under multi, held executable as an `it.fails()`. G-68 is unchanged and open, also `it.fails()`. Multi mode is not closer to safe: both must close first.
      Not a smoke test — an adversarial one. The suite is a shared harness plus per-context opt-ins, not one-offs.

      **Harness.** `tenantRowIsolationCases(fixture)` in `@platform/messaging/testing` (next to `assertWriteTimeTenant`, the convention it extends): a context adds ONE call and a small `TenantRowStore` adapter (insert / find / list / count / update / remove). It uses the *same key under two tenants* on purpose — distinct keys would let a tenant-blind lookup pass by accident. `createFakePrisma()` in `@platform/db/testing` runs the shipped Prisma repositories with every `where` applied literally (no RLS), so a dropped `tenantId` leaks exactly as it does under the `postgres` role. Both are self-tested: `tenant-isolation.test.ts` feeds the harness deliberately leaky stores (read, list, count, update, delete, key-overwrite) and requires each to be caught.

                                      **Which layer each case tests — none can pass because of RLS** (inert under `postgres` until ADR-0014 Phase 2): 1 and 3 → application layer (adapter filter); 2 → transport; 4 → application (use case); 5 → application cache key; 6 and 7 → transport key construction.

                                      | # | Case | Contexts | Result | How it was shown able to fail |
                                      |---|------|----------|--------|-------------------------------|
                                      | 1 | A cannot read / write / delete / **count** B's rows | finance (account: in-memory + Prisma; read-model store: in-memory + ClickHouse, count = `query().total`), security (principal: in-memory + Prisma), orders (in-memory) | **pass** | Production tenant filters removed one at a time (Prisma `where` in findById / list / updateMany, ClickHouse `WHERE tenant_id` in get and query, in-memory map keys) — each turned the suite red; the count case alone caught the ClickHouse `query()` break. Harness also self-tested. |
                                      | 2 | Forged `x-tenant-id` vs verified claim | admin HTTP pipeline, real chain, multi mode | **fail → fixed (G-69)** | claim-less token + header returned 201 into tenant B; fixed by `publicHeaderTenantResolver`. |
                                      | 3 | Event under A not consumed into B's projection | security identity + consent consumers | **pass, as-is (class D, G-64)** | Pins current behaviour: consumers write to their construction-time tenant and ignore `event.tenantId`, so the event reaches neither B nor A. Making a consumer write to B, or honour the envelope, each turns it red; it must be flipped deliberately when G-64 lands. |
                                      | 4 | Storage key written by A unreachable from B | media | **PASS — closed 2026-09-20 (G-68)** | Was: A registers B's key → 201 → receives a signed URL. Both doors now check the key against the tenant (registration, and signing of the row's key); the two `it.fails()` reproductions were flipped to `it()` with the fix. Client still names the key, validated not minted (G-71). |
                                      | 5 | Cache entry populated by A not served to B | response cache (shared with 6), entitlement cache + guard, kratos session cache, cart cache; **authz decision cache: FAIL — open (G-67)** | pass, except authz | Entitlement, kratos, cart and response-cache keys each mutated → red. A first draft of the guard-level entitlement case survived its own mutation (it used `can()`, which never writes the cache); it was rewritten on `evaluate()` and re-proven. |
                                      | 6 | A's idempotency key doesn't suppress B | admin HTTP, multi mode | **pass** | `${tenantId}` deleted from the idempotency/response-cache key in `packages/http/src/server.ts` → red; a same-tenant control proves dedup works at all. |
                                      | 7 | Rate-limit bucket not shared | admin HTTP (public route, same IP; authenticated, same principal id) | **pass** | `${tenantId}` deleted from each of the two key forms → red; a control proves the limiter bites. |

                                      **Representative contexts, one line each:** *security* — its principals are the identity the authorization model stands on; *finance* — money, the only real count / pagination-total surface, and the only ClickHouse store; *orders* — money and PII, the largest aggregate; *media* — the only object-storage consumer; *entitlement / auth / cart* — each owns a Redis-backed cache keyed independently of the transport. Orders' Prisma repository is **not** in case 1: it reads through `include` relations the fake does not model, so its scoping is covered only by the `DATABASE_URL_TEST`-gated integration suite (which does not run here).

                                      **Decision — claim-then-header.** The header fallback for an authenticated principal does **not** survive. The header is client-controlled: if a verified token that merely lacks `tenant_id` may pick its tenant by header, any valid token can act inside any tenant by naming it — the claim would only rank first and protect nobody. A claim-less token is bound to no tenant → 403. The header remains valid where no identity exists to protect: public storefront routes. **Cost:** under multi every authenticated token must carry `tenant_id`.

                                      **Existing per-context files.** Folded: the hand-rolled two-tenant cases in `services/orders/src/infrastructure/tenant-isolation.test.ts` and `services/security/src/infrastructure/tenant-isolation.test.ts` were replaced by harness calls (the roles / audit-chain / projection cases and every `assertWriteTimeTenant` case stay — they test different properties). Finance's and cart's new cases sit in their existing files. Left separate and untouched: catalog, checkout, customer-360, fulfillment, identity, payments, returns — they cover write-time tenant or context-specific behaviour and adopt the harness with one call when wanted. `services/tenancy` stays a recorded exemption (ADR-0014 8f); its property — 403 for every tenant but the pinned one — is asserted in `apps/admin/src/http/server.multi-tenant.test.ts`.

                                      **Multi mode is still not safe.** G-67 (cache and audit) and G-68 (storage keys) are closed; **G-70 — grants are still global per principal — must close first**, and legacy storage-key rows must be counted and migrated before multi is ever enabled (G-68).

- [ ] **T10.6 — Tenant lifecycle.**
      Provisioning a tenant (create the row, seed defaults, register the domain), suspending one,
      and deleting one — including what deletion means for data the platform is legally required to
      erase. G-32 (tenant lifecycle ops) and G-25 (GDPR erasure runbook) are both open; this task
      may only _narrow_ them. Say precisely what you closed and what you did not.

      **Progress 2026-09-26 (D-068).** Done: (1) **suspension/cancellation are enforced** — once, where
              the tenant is resolved (`packages/http` `executeRoute`, step 2b, before authorization), through
              a `TenantGate` the admin API mounts under `TENANT_MODE=multi`; (2) **provisioning is a working
              store, not a row** — `TenantProvisioner` (`apps/admin/src/tenant-provisioning.ts`) runs the
              security baseline for the new tenant and makes a named owner its administrator, idempotently and
              resumably, and reports completeness from what is STORED; (3) **the platform tenant cannot be
              suspended or cancelled** through the lifecycle. Not done, on purpose: **erasure** (see D-068 for
              what it would have to do), custom-domain registration, seeding defaults for contexts other than
              Security, per-tenant backup/restore, billing hooks.

- [x] **T10.7 — Cross-cutting sweep.** _(closed 2026-09-26; see "T10.7 wider sweep" below)_
      Walk every shared singleton in the runtime and ask "is this keyed by tenant?": metrics labels,
      log context, health checks, the scheduler's jobs (a job that runs "for the tenant" must now
      run per tenant), the outbox relay, consumer runtimes, feature flags
      (`packages/feature-flags` supports org-level targeting — verify it is actually resolved
      per request), and entitlements (`packages/entitlement` is explicitly tenant×feature — verify).

### T10.7 inventory — every remaining construction-time tenant pin (2026-09-18)

T10.3's own done-criterion said "Prisma repositories," which let non-Prisma stores and
non-repository adapters pass as complete (see the corrected done-criterion below). This inventory
is the complete, classified sweep the corrected criterion asks for, produced while closing
feature-flags' and analytics' adapters this session. Command run (widened once from the plan's own
starting pattern, which missed the `config.TENANT_DEFAULT_ID`-sourced shape entirely):

```bash
grep -rnE "deps\.tenantId|this\.tenantId = |private readonly tenantId" \
  --include="*.ts" packages apps services | grep -v node_modules | grep -v "\.test\." | grep -v coverage
grep -rn "TENANT_DEFAULT_ID" --include="*.ts" apps services packages | grep -v node_modules | grep -v "\.test\."
```

The unfiltered run of the first command returns every Prisma repository in the 1 not-yet-converted
context (the parked `tenancy` branch) — 1 unconverted in all (security converted 2026-09-19) (corrected 2026-09-19:
`customer-360`, `finance`, then `pricing`, `reporting`, `promotions`, `notifications` and
`shipping`, then `cart`, `inventory`, `payments`, `orders`, `fulfillment`, `checkout` and `returns`
converted after this paragraph was written; the count comes from `rootEventContext(`
call arity in each `composition.ts` — `grep -rnE "rootEventContext(s*deps.idGenerators*,s*w+" services/*/src/composition.ts`
lists exactly `tenancy` — not from this prose) — expected, already tracked by the roadmap's Status
section, not re-listed row-by-row here. The table below is everything **else**: sites outside an
unconverted context's own repository sweep, or found only by the second, widened command.

| Site                                                                                                                                                                                                                                                                                    | Class                                                                                                                                                          | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/finance/src/infrastructure/clickhouse-read-model-store.ts:34,39` (`ClickHouseReadModelStore`)                                                                                                                                                                                 | **CLOSED** — finance                                                                                                                                           | **Stale row, corrected 2026-09-20 (found by T10.5).** It was class A when written, but `finance` converted during T10.3 and this store went with it: `put`/`get` take `tenantId` as a per-call parameter (clickhouse-read-model-store.ts:60,76) and the class doc comment at :31 says so explicitly. Nothing here is pinned at construction. Kept as a closed row rather than deleted, because the row outlived the pin it described by a day and that is worth seeing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/runtime/src/security/wire-security-identity.ts:87` (`const tenantId = config.TENANT_DEFAULT_ID`, handed to `ConsentChangedConsumer` and the five Identity-projection consumers `identity-projection.consumers.ts` `deps.tenantId`, `consent-changed.consumer.ts` `deps.tenantId`) | **CLOSED** — G-64 (2026-09-26)                                                                                                                                 | Added 2026-09-19 when security converted. `PrismaIdentityProjectionStore`/`PrismaConsentProjectionStore` now take `tenantId` per call; their reads are called by use cases that hold the request tenant, but their only writers are event consumers with no per-message tenant until `tenantId` is required on the envelope (a contract change). Same shape and same fix dependency as `orders-paid.consumers.ts`. The Identity entity's own `userTenant`/`orgTenant` are business columns, not this scope. **Closed 2026-09-26:** the consumer(s) read the envelope's required `tenantId` per message; nothing here reads `TENANT_DEFAULT_ID` any more (D-067). Kept as a closed row, like the finance ClickHouse row, because the row outlived the pin.                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/runtime/src/security/wire-security-provisioning.ts:52` → `security-provisioning.consumers.ts` (`ProvisioningDeps.tenantId`, 3 consumers)                                                                                                                                          | **CLOSED** — G-64 (2026-09-26)                                                                                                                                 | Added 2026-09-19 when security converted: every `SecurityController` use case takes `tenantId`, and the three provisioning consumers have no per-message tenant to hand it. Same fix dependency as above. **Closed 2026-09-26:** the consumer(s) read the envelope's required `tenantId` per message; nothing here reads `TENANT_DEFAULT_ID` any more (D-067). Kept as a closed row, like the finance ClickHouse row, because the row outlived the pin.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/runtime/src/security/wire-security-provisioning.ts:45` (`bootstrapSecurity(..., core.config.TENANT_DEFAULT_ID, ...)`)                                                                                                                                                             | **CLOSED** — T10.6 (2026-09-26)                                                                                                                                | Reclassified from A on 2026-09-19 (was pinned at `wireSecurity` construction; now a plain argument). It provisions the baseline roles/policy/profile for the ONE deployment tenant at boot — there is no request or envelope to source a tenant from. Per-tenant provisioning under `TENANT_MODE=multi` belongs to tenant lifecycle (T10.4 / tenancy), not to this boot path. Not platform-global: it writes only rows scoped to that tenant. **Closed 2026-09-26 (T10.6):** the function always took the tenant as an argument; what was missing was anything that called it for a tenant other than the deployment one. `TenantProvisioner` now does, when a tenant is created (`POST /tenants`) or its provisioning is resumed (`POST /tenants/:id/provision`), so the baseline the provisioning consumers assign FROM exists for every provisioned tenant and `BOOT_TENANT_PINS` is empty. The boot call that remains provisions the PLATFORM tenant's own baseline (that tenant is not created through the lifecycle) and is classified `platform-boot`, not a pin. Kept as a closed row, like the others, because the row outlived the pin. |
| `apps/runtime/src/entitlement/licensing-entitlement.adapter.ts:65`, `apps/runtime/src/entitlement/wire-entitlement.ts:59` (`LicensingEntitlementPort`)                                                                                                                                  | **CLOSED** — T10.7 (2026-09-26)                                                                                                                                | T10.7's own scope names entitlements explicitly ("`packages/entitlement` is explicitly tenant×feature — verify"). Also currently fully unwired in production composition (`wireEntitlement` has no caller outside its own tests) — dormant, not exercised. `check()` already receives `request.tenant` per call for the Licensing half of the decision but uses the construction-time `tenantId` for the Feature Registry half — worth resolving as part of T10.7, not assumed identical without checking. **Closed 2026-09-26 (T10.7):** decided on the evidence — a feature definition is a PER-TENANT row (`FeatureDefinition` is stored `(tenantId, key)`, `findByKey(key, tenantId)`, and every Feature Registry write route registers under the request's tenant), so the construction-time tenant was the bug, not just its comment. `LicensingEntitlementPort` and `wireEntitlement` no longer take a tenant; the Registry read uses `request.tenant`, the same value Licensing already got as `tenantRef` and the guard uses as cache and audit tenant. Kept as a closed row because the row outlived the pin.                           |
| `apps/admin/src/http/server.ts:60` (`singleTenantGuardedResolver`)                                                                                                                                                                                                                      | **C** — survives, scoped to `TENANT_MODE=single` (reclassified 2026-09-19; the row previously said it is removed once T10.4 lands, and cited `:79`, now stale) | It is a **lock, not a leak**: a request tenant that differs from the pinned one gets `null` and is rejected — it fails closed. T10.4 did not delete it: under `single` it is still the correct guard, because every repository there is still one deployment's. Under `multi`, `createAdminHttpApi` swaps it for the claim → header chain and `assertMultiTenantReady` fails boot if a pinned resolver is used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/runtime/src/backfill/prisma-payment-settlement-source.ts:31,35` (`PrismaPaymentSettlementSource`)                                                                                                                                                                                 | **C**                                                                                                                                                          | WP-11's finance-settlement backfill script — operates on one known tenant per invocation, per ADR-0014 Decision point 4 / the approved RLS section's Amendment B ("the WP-11 backfill script... call `runReadScoped`/the write equivalent explicitly with the one tenant they already know"). Given as an example in this session's own instructions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/runtime/src/backfill-finance-settlement.ts:26`                                                                                                                                                                                                                                    | **C**, with a caveat already on record                                                                                                                         | Same backfill-script shape as above, but sources the tenant from `core.config.TENANT_DEFAULT_ID` rather than accepting it as an explicit argument — ADR-0014 Amendment B already names this exact line as "a pre-existing scope gap, independent of RLS, noted here but not fixed by this proposal." Not re-opened as new scope by this inventory; recorded so it isn't lost.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/runtime/src/security/security-context-propagation.ts:61` (`SecurityPropagationContext`)                                                                                                                                                                                           | **C**                                                                                                                                                          | A plain value object constructed fresh per request/event from HTTP headers or event metadata (`fromHttpHeaders`/`fromEventMetadata`), not a boot-time singleton — carries the already-resolved `tenantId` as trace/correlation metadata. This is the shape T10.3 wants, not an instance of the defect it fixes. Currently unwired into production composition (only its own tests call the factories).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/runtime/src/consumers/orders-paid.consumers.ts:286,323,373,429` (sourced from `:470`'s `const tenantId = core.config.TENANT_DEFAULT_ID`)                                                                                                                                          | **CLOSED** — G-64 (2026-09-26)                                                                                                                                 | One of "the two consumer sites" named in this session's own instructions. Re-verified when customer-360 converted (2026-09-18): `:373` is `Customer360OrdersPaidConsumer`, whose tenant was previously buried inside `PrismaProfileStore`/`PrismaProfileHistoryStore` construction and is now a visible `deps.tenantId` — same class, same fix. `:429` is `NotificationsOrdersPaidConsumer`, which joined the same way when notifications converted. Fix depends on making `tenantId` required on the event envelope first (a contract change) — out of scope this session, per the roadmap's own "explicitly NOT touched" note. **Closed 2026-09-26:** the consumer(s) read the envelope's required `tenantId` per message; nothing here reads `TENANT_DEFAULT_ID` any more (D-067). Kept as a closed row, like the finance ClickHouse row, because the row outlived the pin.                                                                                                                                                                                                                                                                    |
| `apps/runtime/src/consumers/finance-settlement.consumers.ts:134` (`const tenantId = core.config.TENANT_DEFAULT_ID`)                                                                                                                                                                     | **CLOSED** — G-64 (2026-09-26)                                                                                                                                 | The second of "the two consumer sites" — found only by widening the grep to `TENANT_DEFAULT_ID` (this file has no `deps.tenantId`/`this.tenantId =` field at all, so the plan's own starting pattern would have missed it). Same fix dependency as the orders-paid consumer above. **Closed 2026-09-26:** the consumer(s) read the envelope's required `tenantId` per message; nothing here reads `TENANT_DEFAULT_ID` any more (D-067). Kept as a closed row, like the finance ClickHouse row, because the row outlived the pin.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/runtime/src/composition.ts:534` (`buildPaymentCapturedRuntime`), `services/orders/src/interfaces/payment-captured.consumer.ts:22,52` (`PaymentCapturedConsumer`)                                                                                                                  | **CLOSED** — G-64 (2026-09-26)                                                                                                                                 | Added 2026-09-19 when orders converted: `MarkOrderPaid` now takes `tenantId` per call, and the consumer has no per-message tenant to hand it until `tenantId` is required on the event envelope (a contract change), so its deps carry one sourced from `core.config.TENANT_DEFAULT_ID` — the same shape and the same fix dependency as `orders-paid.consumers.ts` above. Before this the tenant was buried in `PrismaOrderRepository`/`PrismaPaymentVerificationAdapter` construction at the same `TENANT_DEFAULT_ID` site. **Closed 2026-09-26:** the consumer(s) read the envelope's required `tenantId` per message; nothing here reads `TENANT_DEFAULT_ID` any more (D-067). Kept as a closed row, like the finance ClickHouse row, because the row outlived the pin.                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/runtime/src/composition.ts` `buildTrackingIngestRuntime` (`const tenantId = core.config.TENANT_DEFAULT_ID`, registry + watcher)                                                                                                                                                   | **CLOSED** — G-64 (2026-09-26)                                                                                                                                 | **Missing from this inventory until T10.4 (2026-09-19)** — found by classifying every `TENANT_DEFAULT_ID` reference. Loads and hot-reloads the tracking registry for one tenant and ingests every tenant's `tracking.event.captured.v1` against it. Same fix dependency as the other consumer rows; the worker refuses multi mode while it stands. **Closed 2026-09-26:** the consumer(s) read the envelope's required `tenantId` per message; nothing here reads `TENANT_DEFAULT_ID` any more (D-067). Kept as a closed row, like the finance ClickHouse row, because the row outlived the pin.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Totals: (A) 1 · (B) 1 · (C) 4 · (D) 6 — 12 sites, none unclassifiable** (2026-09-19, after T10.3 batch 2: the seven class-A cross-context adapter rows that were pinned "pending this context's own conversion" were deleted as `payments`, `orders`, `checkout` and `returns` converted; one class-D row was added for `PaymentCapturedConsumer`. Two adapters that batch 2 itself had to pin temporarily — `InventoryValidationAdapter`/`OrdersInventoryAdapter`, and `OrdersPaymentAdapter`/`OrderCreationAdapter` — were unpinned again by `checkout` and `orders` within the same batch and never reached this table; ADR-0014 Amendment 8).

**Update 2026-09-19 (T10.4):** one class-D row added (tracking ingest, above) → **(A) 1 · (B) 1 · (C) 4 · (D) 7 — 13 sites**. `services/tenancy` is a recorded exemption (ADR-0014 8f), not unfinished work: see T10.4 and `apps/admin/src/tenant-mode-guard.ts`. The complete, tested classification of every `TENANT_DEFAULT_ID` reference now lives in `apps/runtime/src/tenant-mode-guard.ts` (`TENANT_DEFAULT_ID_SITES`), not in this prose.

**Update 2026-09-20 (T10.5):** the finance ClickHouse row above is CLOSED — it was stale, not open: finance converted in T10.3 batch 2 and the store takes `tenantId` per call. Running totals are therefore **(A) 0 · (B) 1 · (C) 4 · (D) 7 — 12 sites**. Re-derive from the rows, never from this prose: three separate counts in this document have been wrong by carrying a number forward instead of recounting.

**Update 2026-09-26 (G-64 closed) — recounted from the rows, not carried forward.** The table has 13 rows: 7 CLOSED (the finance ClickHouse row and the six G-64 rows above) and 6 open — (B) 1 entitlements · (C) 4 (`singleTenantGuardedResolver`, `PrismaPaymentSettlementSource`, `backfill-finance-settlement.ts`, `SecurityPropagationContext`) · (D) 1, the boot-time `bootstrapSecurity` row, which stays class D on purpose (per-tenant provisioning is T10.6, not an envelope problem). Running totals are therefore **(A) 0 · (B) 1 · (C) 4 · (D) 1 — 6 open sites**, down from 12. The second grep command now returns 8 code references (`api.ts`, `wire-security-provisioning.ts` bootstrap, `backfill-finance-settlement.ts`, `config.ts`, two in `admin-web`, one in `storefront`, one in `e2e`), and `tenant-mode-guard.test.ts` diffs them against `TENANT_DEFAULT_ID_SITES`. The worker guard still refuses `TENANT_MODE=multi`, now only for `bootstrapSecurity` while `SECURITY_PRINCIPAL_PROVISIONING` is on.

**Update 2026-09-26 (T10.6) — recounted from the rows, not carried forward.** The table has 13 rows: 8 CLOSED (the finance ClickHouse row, the six G-64 rows, and now the boot-time `bootstrapSecurity` row) and 5 open — (B) 1 entitlements · (C) 4 (`singleTenantGuardedResolver`, `PrismaPaymentSettlementSource`, `backfill-finance-settlement.ts`, `SecurityPropagationContext`) · (D) 0. Running totals are therefore **(A) 0 · (B) 1 · (C) 4 · (D) 0 — 5 open sites**, down from 6. There are no class-D sites left. The second grep command still returns 8 code references; `bootstrapSecurity`'s is now classed `platform-boot` in `TENANT_DEFAULT_ID_SITES` rather than a pin, and `BOOT_TENANT_PINS` is empty, so `assertWorkerTenantModeSupported` no longer refuses `TENANT_MODE=multi` for anything in the inventory. **That is not a claim the worker is multi-ready:** T10.7's own list (scheduler jobs "per tenant", metrics labels, log context, health checks, feature flags, entitlements) is broader than this inventory's grep, and the rest of it has not been swept.

**Update 2026-09-26 (T10.7) — recounted from the rows, not carried forward.** The table has 13 rows: 9 CLOSED (finance ClickHouse, six G-64, `bootstrapSecurity`, and now entitlements) and 4 open — (A) 0 · (B) 0 · (C) 4 (`singleTenantGuardedResolver`, `PrismaPaymentSettlementSource`, `backfill-finance-settlement.ts`, `SecurityPropagationContext`) · (D) 0. Running totals: **(A) 0 · (B) 0 · (C) 4 · (D) 0 — 4 open sites, all class C (correct as they are).** The wider T10.7 sweep below is a separate table with its own totals.

### T10.7 wider sweep — shared singletons in the runtime (2026-09-26)

Classes here: **T** = made per-tenant (changed), **G** = correctly platform-global (left alone, reason written), **OK** = already tenant-keyed (verified), **X** = blocked on something named.

| Site                                                                                                                                      | Class                            | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/runtime/src/scheduler.ts` jobs `outbox-prune`, `cdc-watchdog` (`buildJobs`)                                                         | **G**                            | Both act on shared infrastructure — one `platform.outbox` table, one Kafka Connect cluster — and touch no tenant's business data. Running once per tick for the platform is the point; per-tenant copies would prune the same table N times. The lock `job:<name>` (`startJobLoop`) is global: right for a global job, WRONG for a tenant-business job (one tenant's slow run would starve the rest) — a future job that processes business data must loop tenants under `job:<name>:<tenant>`. Pinned by `scheduler.test.ts` "scheduled jobs are classified for tenancy": the job set must equal the classification table, so a new job fails until classified. **Precondition, not code:** prune and relay read/delete across tenants, so under RLS they must connect through a role that bypasses it (Amendment on the relay). The role is a property of `DATABASE_URL`, so no code guard can refuse it; I could not check it (no DB access this task). |
| `apps/runtime/src/outbox-relay-runtime.ts` (`startOutboxRelay`), `PrismaOutboxStore`                                                      | **G**                            | One shared table, one lock `outbox-relay`, one producer. Every row carries its own tenant in `headers.tenantId` (G-64) and the relay forwards headers verbatim — it does not re-stamp, group by, or reorder across tenants (global `createdAt` order). Its metric and log lines are aggregate counts. Known coupling, not attribution: a batch is all-or-nothing, so one poison row blocks every tenant's rows behind it (noisy neighbour) — inherent to a single global relay; production streams via Debezium. Pinned by `outbox-relay-runtime.test.ts` "across tenants".                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/runtime/src/health-server.ts`; `composition.ts` `health.register` (postgres, redis, consumer supervisor)                            | **G**                            | Every check probes shared infrastructure; none probes "the tenant". A per-tenant readiness would let one tenant's problem take the pod out of rotation for all. `runtime_dependency_up{name}` is labelled by dependency only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/runtime/src/metrics.ts` (`RuntimeMetrics`, every series)                                                                            | **G — no tenant label anywhere** | Decision: **no metric gets a tenant label.** Cardinality: tenants are unbounded and each series is already a product (topic×group, method×status, connector×task); a tenant label multiplies every one by the tenant count, and Prometheus pays per series. Privacy: `/metrics` is an operator scrape target for all tenants. Attribution moved to where it is cheap and access-controlled: log lines and traces. Adding a label would also widen the shared `MessagingMetrics`/`HttpMetricsSink` contracts. Revisit only for a bounded set (e.g. DLQ count per tenant that has one) with an explicit cap. Pinned by `metrics-tenant-scope.test.ts` (no tenant string in any exposition).                                                                                                                                                                                                                                                                  |
| `packages/kafka/src/consumer-runtime.ts` retry and dead-letter log lines                                                                  | **T**                            | Carried `messageId` only: a dead-lettered message could not be attributed to a tenant. Both now carry the envelope's `tenantId`. Tests: `consumer-runtime.test.ts` "failure log lines name the tenant".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/http/src/server.ts` "http request failed" (5xx) log line                                                                        | **T**                            | The success line already carried `tenantId`; the 5xx line did not, so a failing request could not be tied to a tenant. Now `tenantId: request.tenantId` (absent, never defaulted, if the failure preceded resolution). Test: `server.test.ts` "log lines name the tenant".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/utils/src/logger.ts` (`logger`, `createLogger`)                                                                                 | **G**                            | Stateless: no per-call mutable context, so nothing leaks from one tenant's line into another's. There is no ambient (AsyncLocalStorage) tenant context; attribution is by field at the call site. Adding one is a shared-package design (the logger is isomorphic, so no `node:async_hooks`) and is not needed for correctness — a follow-up, not done. Lines still without a tenant: boot/infra lines (no tenant exists) and worker lines that carry `messageId` but not `tenantId` (tracking ingest, loyalty) — investigable by `messageId`; listed so they are not mistaken for a decision.                                                                                                                                                                                                                                                                                                                                                             |
| `apps/runtime/src/entitlement/licensing-entitlement.adapter.ts`, `wire-entitlement.ts`                                                    | **T**                            | See the closed B row above. Tests: `entitlement-tenant-scope.test.ts` (three tenants, three answers, one instance; a shared L2 across two pods).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `services/feature-registry/src/infrastructure/in-memory-repositories.ts`                                                                  | **T**                            | **Found by the entitlement test.** Its doc comment said "keyed by `(tenantId, key)`" but the map was keyed by `key` alone, so a second tenant registering the same key overwrote the first's (the Prisma repositories were right). Now a composite key. Test: `in-memory-repositories.test.ts` "the same key registered by two tenants".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `packages/entitlement/src/cache.ts` (`EntitlementCache`)                                                                                  | **OK**                           | Key `entitlement:<tenant>:<feature>:<action>` before and after (unchanged); L1 indexes `byTenant`/`byFeature`. Feature keys cannot contain `:` (`^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$`), so the key is injective even for a tenant id containing it. `invalidateFeature` evicts a feature across ALL tenants: safe over-invalidation (extra misses), now coarser than needed since definitions are per tenant — left, because `onEvent(type, payload)` does not receive the envelope tenant and threading it widens a contract. Tests: `tenant-isolation.test.ts` (T10.5) plus "cache key shape".                                                                                                                                                                                                                                                                                                                                                              |
| `apps/runtime/src/entitlement/entitlement-invalidation.consumer.ts`                                                                       | **OK**                           | Invalidates by the tenant in the event payload. Unwired in production.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/feature-flags` `InMemoryFeatureFlags`                                                                                           | **G**                            | Static config map for dev/tests; holds no tenant data, so it must not vary by tenant. A test pins it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `services/feature-flags` `AggregateFeatureFlags` and repository                                                                           | **OK**                           | Verified: `isEnabled(key, tenantId, ctx)` refuses an empty tenant and calls `findByKey(key, tenantId)` per call on one process-wide instance. Two tenants, same flag, different answers: `aggregate-feature-flags.test.ts`. **Finding:** nothing in the runtime CALLS `isEnabled` on a request path yet — the admin app only manages flags (CRUD under the request tenant). "Resolved per request" holds for the evaluator and is vacuous for the runtime.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/config/src/flags.ts` (`setFlagProvider`, module-level `activeProvider`)                                                         | **G, dormant**                   | A process-global with no tenant parameter. Nothing outside the package imports it, and it would be wrong for tenant flags. Pinned by `tenant-mode-guard.test.ts` "the process-global flag provider stays unused".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/runtime/src/tracking/tenant-runtimes.ts` (`TenantRuntimes`, G-64)                                                                   | **OK**                           | Keyed by envelope tenant, one runtime and registry watcher per tenant, failed loads not cached (pinned by `tracking-ingest-tenant.test.ts`). Scaling note: kept for the process lifetime, one poll timer per active tenant, no eviction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `inbox_processed_events` (`PrismaProcessedEventStore`, key `(consumerGroup, messageId)`)                                                  | **G**                            | Idempotency on a globally unique id (`message_id` is `uuid`). **Residual risk, not fixed:** the tracking collector uses the client-supplied `eventId` as `messageId`; a holder of one tenant's write key who knows another tenant's not-yet-processed UUID could get it dropped as a duplicate. That needs foreknowledge of a UUIDv7, and the fix (tenant in the inbox key) is a schema change, out of scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `packages/http/src/server.ts` idempotency (`tenant:<t>:idem:…`), rate limit (`rl:<t>:<principal>`), tenant gate; `api.ts` `responseCache` | **OK**                           | Already tenant-prefixed; covered by T10.5/G-67 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/runtime/src/telemetry.ts`                                                                                                           | **G**                            | Service-level OTel resource; no tenant data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**Guard result:** the sweep found no site that blocks multi in code, so `EVENT_PATH_TENANT_PINS` and `BOOT_TENANT_PINS` stay empty and `assertWorkerTenantModeSupported` still refuses nothing. Stated as a result, not assumed: the one candidate (relay/prune needing an RLS-bypassing DB role) is a deployment precondition the code cannot see. **Totals, recounted from the 18 rows: T 4 · G 9 · OK 5 · X 0 — 18 rows.** Not a claim of multi-readiness: the two-tenant definition-of-done tests remain, and `TENANT_MODE=multi` is not enabled anywhere.

Not re-listed: `tenancy` (parked; see ADR-0014 point 8f) — 1 unconverted in all. Security converted 2026-09-19 (its class-A row was deleted; three class-D rows added above).

**Coverage limit, stated explicitly:** the Prisma branch of the converted repositories (e.g.
`services/coupons/src/infrastructure/prisma-coupon-repository.ts:50`) has **no database test** for
the write-time tenant merge. It is covered by the static `scripts/dev/check-outbox-tenant.mjs`
check alone, which only proves the write mentions `tenantId`, not that it is the right one.

## Definition of done

- [ ] `TENANT_MODE=multi` boots, and two tenants serve correct, isolated data through the same process.
- [ ] Every test in T10.5 passes, and each one **fails** if you deliberately remove the guard it
      covers. A tenant-isolation test that cannot fail is worse than none.
- [ ] A request with no resolvable tenant is rejected, never defaulted.
- [ ] The ADR is written, registered, and matches what the code does.
- [ ] G-53 closed; G-23/G-32/G-38 updated with what actually changed.
- [ ] Repo-wide gates green, plus `pnpm arch`.

## Known traps

- **The database is the easy half.** Every leak you will find is somewhere else: Redis keys, the
  cache, idempotency keys, rate-limit buckets, metrics labels, object-storage prefixes, the search
  index, ClickHouse (WP-3 — its sort key must lead with `tenant_id`), log context, and any
  in-process memoisation someone added for speed.
- **Do not default a missing tenant.** Ever. Reject.
- **Do not make `tenantId` a parameter the caller can pass freely.** It comes from the verified
  principal or the resolved domain, through the request context — never from a body field, a query
  parameter, or an argument an LLM tool could supply (see WP-5).
- **This WP will surface unrelated bugs.** Anything that quietly assumed one tenant will break.
  Record each one in `BLOCKERS.md` rather than expanding scope to fix them all here.

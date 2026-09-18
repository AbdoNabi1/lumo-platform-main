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

- [ ] **T10.4 — Remove the boot refusal, and replace it with a real guard.**
      Deleting the `TENANT_MODE === "multi"` throw is the last step, not the first. What replaces it
      is a boot-time assertion that per-request tenant resolution is actually wired: a request
      arriving with no resolvable tenant must be **rejected**, never defaulted to
      `TENANT_DEFAULT_ID`. Silent defaulting is how one tenant reads another's data.

- [ ] **T10.5 — Tenant isolation tests. This is the deliverable.**
      Not a smoke test — an adversarial one. For a representative set of contexts: - Tenant A's request cannot read, write, or _count_ tenant B's rows. - A forged tenant header does not override the tenant from a verified claim. - An event published under tenant A is not consumed into tenant B's projections. - A storage key written by tenant A is unreachable from tenant B. - A cache entry (`packages/redis`) populated by tenant A is not served to tenant B —
      check `REDIS_KEY_PREFIX` handling, because a shared cache is the classic leak that survives
      a perfectly tenant-scoped database. - An idempotency key from tenant A does not suppress tenant B's identical request. - A rate-limit bucket is not shared across tenants.
      Write these as a reusable suite, not one-offs, so a new context can be added to it cheaply.

- [ ] **T10.6 — Tenant lifecycle.**
      Provisioning a tenant (create the row, seed defaults, register the domain), suspending one,
      and deleting one — including what deletion means for data the platform is legally required to
      erase. G-32 (tenant lifecycle ops) and G-25 (GDPR erasure runbook) are both open; this task
      may only _narrow_ them. Say precisely what you closed and what you did not.

- [ ] **T10.7 — Cross-cutting sweep.**
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

The unfiltered run of the first command returns every Prisma repository in the 15 not-yet-converted
contexts (`cart`, `checkout`, `customer-360`, `finance`, `fulfillment`, `inventory`,
`notifications`, `orders`, `payments`, `pricing`, `promotions`, `reporting`, `returns`, `security`,
`shipping`) plus the parked `tenancy` branch — expected, already tracked by the roadmap's Status
section, not re-listed row-by-row here. The table below is everything **else**: sites outside an
unconverted context's own repository sweep, or found only by the second, widened command.

| Site                                                                                                                                                    | Class                                  | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/admin/src/composition.ts:647`, `apps/admin/src/infrastructure/cross-context/promotion-validation.adapter.ts:55,75` (`PromotionValidationAdapter`) | **A** — checkout                       | Implements checkout's own `PromotionValidationPort` (`services/checkout/src/application/ports.ts`); captures `tenantId` at construction per its own doc comment, pending checkout's own T10.3 conversion which would widen that port to carry `tenantId` per call.                                                                                                                                                                                                                                         |
| `apps/runtime/src/composition.ts:298,302` + `apps/runtime/src/api.ts:371-374` (`PrismaPaymentVerificationAdapter`)                                      | **A** — orders                         | Implements orders' own `PaymentVerificationPort` (`services/orders/src/application/ports.ts:64`); reads Payments' tables directly, tenant-scoped at construction, pending orders' own T10.3 conversion.                                                                                                                                                                                                                                                                                                    |
| `apps/runtime/src/composition.ts:326,330` + `apps/runtime/src/api.ts:378-381` (`PrismaRefundVerificationAdapter`)                                       | **A** — returns                        | Implements returns' own `RefundVerificationPort` (`services/returns/src/application/ports.ts:27`); same shape as the payment-verification adapter above.                                                                                                                                                                                                                                                                                                                                                   |
| `apps/runtime/src/composition.ts:406,411,479` (`PrismaPaymentsPortAdapter`)                                                                             | **A** — returns                        | Implements returns' own `ReturnsPaymentsPort`; bridges to Payments' real refund execution path, tenant-scoped at construction, pending returns' own T10.3 conversion.                                                                                                                                                                                                                                                                                                                                      |
| `services/finance/src/infrastructure/clickhouse-read-model-store.ts:34,39` (`ClickHouseReadModelStore`)                                                 | **A** — finance                        | Same construction-time-pin shape Task 2 fixed in analytics' `ClickHouseAnalyticsReadStore` — checked per Task 2's own instruction, left unconverted because finance itself is out of scope this session.                                                                                                                                                                                                                                                                                                   |
| `apps/runtime/src/security/wire-security-identity.ts:68,74`, `wire-security-runtime.ts:53,65,70`, `wire-security-provisioning.ts:45`                    | **A** — security                       | The runtime-composition-root half of security's own wiring (`services/security` is one of the 15 unconverted contexts); all source `config.TENANT_DEFAULT_ID` directly at boot, the same pattern as every other unconverted context's `wireX({ prisma, tenantId })` call.                                                                                                                                                                                                                                  |
| `apps/runtime/src/entitlement/licensing-entitlement.adapter.ts:65`, `apps/runtime/src/entitlement/wire-entitlement.ts:59` (`LicensingEntitlementPort`)  | **B** — T10.7                          | T10.7's own scope names entitlements explicitly ("`packages/entitlement` is explicitly tenant×feature — verify"). Also currently fully unwired in production composition (`wireEntitlement` has no caller outside its own tests) — dormant, not exercised. `check()` already receives `request.tenant` per call for the Licensing half of the decision but uses the construction-time `tenantId` for the Feature Registry half — worth resolving as part of T10.7, not assumed identical without checking. |
| `apps/admin/src/http/server.ts:79` (`singleTenantGuardedResolver`)                                                                                      | **C**                                  | Own doc comment states it explicitly: exists only while every repository is pinned to one tenant at composition time, and is removed once T10.4 replaces the model. Given as an example in this session's own instructions.                                                                                                                                                                                                                                                                                |
| `apps/runtime/src/backfill/prisma-payment-settlement-source.ts:31,35` (`PrismaPaymentSettlementSource`)                                                 | **C**                                  | WP-11's finance-settlement backfill script — operates on one known tenant per invocation, per ADR-0014 Decision point 4 / the approved RLS section's Amendment B ("the WP-11 backfill script... call `runReadScoped`/the write equivalent explicitly with the one tenant they already know"). Given as an example in this session's own instructions.                                                                                                                                                      |
| `apps/runtime/src/backfill-finance-settlement.ts:26`                                                                                                    | **C**, with a caveat already on record | Same backfill-script shape as above, but sources the tenant from `core.config.TENANT_DEFAULT_ID` rather than accepting it as an explicit argument — ADR-0014 Amendment B already names this exact line as "a pre-existing scope gap, independent of RLS, noted here but not fixed by this proposal." Not re-opened as new scope by this inventory; recorded so it isn't lost.                                                                                                                              |
| `apps/runtime/src/security/security-context-propagation.ts:61` (`SecurityPropagationContext`)                                                           | **C**                                  | A plain value object constructed fresh per request/event from HTTP headers or event metadata (`fromHttpHeaders`/`fromEventMetadata`), not a boot-time singleton — carries the already-resolved `tenantId` as trace/correlation metadata. This is the shape T10.3 wants, not an instance of the defect it fixes. Currently unwired into production composition (only its own tests call the factories).                                                                                                     |
| `apps/runtime/src/consumers/orders-paid.consumers.ts:271,308` (sourced from `:438`'s `const tenantId = core.config.TENANT_DEFAULT_ID`)                  | **D** — G-64                           | One of "the two consumer sites" named in this session's own instructions. Fix depends on making `tenantId` required on the event envelope first (a contract change) — out of scope this session, per the roadmap's own "explicitly NOT touched" note.                                                                                                                                                                                                                                                      |
| `apps/runtime/src/consumers/finance-settlement.consumers.ts:134` (`const tenantId = core.config.TENANT_DEFAULT_ID`)                                     | **D** — G-64                           | The second of "the two consumer sites" — found only by widening the grep to `TENANT_DEFAULT_ID` (this file has no `deps.tenantId`/`this.tenantId =` field at all, so the plan's own starting pattern would have missed it). Same fix dependency as the orders-paid consumer above.                                                                                                                                                                                                                         |

**Totals: (A) 6 · (B) 1 · (C) 4 · (D) 2 — 13 sites, none unclassifiable.**

Not re-listed: the 15 unconverted contexts' own Prisma repositories (all (A), tracked by the
roadmap's Status section already) and `tenancy` (parked, per Task A).

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

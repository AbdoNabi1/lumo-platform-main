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

## Context

ADR-0004 (2026-07-04) reserved `tenantId` on the integration-event envelope but explicitly deferred
the tenancy model itself: _"a follow-up ADR must decide tenant-per-deployment vs. shared schema,
unique-constraint scoping, and partition-key layout — before Phase 2 freezes DB schemas and
topics."_ ADR-0008 (same date) then decided the model — tenant-aware core, pooled default, tiered
isolation, Postgres RLS "as a second enforcement layer once real persistence lands" — but left the
runtime's actual composition unaddressed. This ADR is that follow-up: Phase 2 froze schemas and
topics on the ADR-0008 model over two months ago, and the runtime has run single-tenant since,
correctly refusing to boot in `TENANT_MODE=multi` (`apps/runtime/src/composition.ts:139-145`)
rather than silently mis-scoping requests.

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
   `app.tenant_id`. A second role, `lumo_app` (`rolbypassrls = false`, 558 grants), exists unused.
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
2. **`TransactionalUnitOfWork.run` (`PrismaUnitOfWork`, `packages/db/src/prisma-repository.ts`)
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
   enforced rather than a convention someone can silently drift from.

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

   **What this session could not do, stated plainly rather than substituted:** re-measuring from a
   network path representative of production (co-located with the database, same AWS region) needs
   infrastructure this sandboxed session does not have access to — no such environment was available,
   and no substitute (e.g. an estimate or a scaled-down proxy) was used in its place. **This
   measurement has not happened. It is a precondition for deciding the fallback, not an optional
   nice-to-have.**

   **Fallback, stated now so it is a conscious choice and not a rediscovery under pressure:** reads
   may skip the transaction wrapper entirely and rely solely on Option A's TypeScript-layer
   `where: { tenantId }` predicate — the same isolation every repository already provides today,
   independent of RLS. This is strictly weaker defense-in-depth (a bug in the TypeScript predicate on
   a read is no longer caught by RLS at the database layer; it still is on a write, since writes
   already sit inside a transaction for the outbox append and pay no _additional_ round trip for
   `SET LOCAL`) but avoids a per-read transaction entirely. **Threshold for taking it:** if
   `runReadScoped`/`runReadScopedBatched` adds more than ~10ms to p50 or more than ~30ms to p99 on
   the benchmark read, measured from a production-representative network path (RLS's own added round
   trip should be a small constant there, not a multiplier), stop converting reads to either helper
   and fall back to TypeScript-only enforcement for reads specifically; writes still get `SET LOCAL`
   regardless, since they pay no extra round trip for it. **Status: the fallback remains available
   and UN-TAKEN.** Neither measurement so far (interactive or batched) is decision-grade, for the
   noise-floor reason above — the threshold has not actually been evaluated against a number capable
   of answering it yet.

   **Why this caution, stated as the asymmetry it actually is:** reverting a performance decision
   later is cheap — swap `runReadScoped` for the TypeScript-only fallback in each converted context,
   a mechanical change with no correctness risk either direction. Discovering a missed or buggy
   TypeScript tenant predicate across 40 contexts, with no RLS backstop because the fallback was
   taken, is not cheap — it is exactly the cross-tenant data leak this entire WP exists to prevent,
   found late, possibly in production. An unresolved performance question is worth sitting with
   longer than an unresolved isolation question. **Contexts #2-40 stay unconverted until this
   benchmark question is actually settled from a representative environment — not decided by the
   session that happened to be available.**

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
   below N of N. Without this, "the assertion holds everywhere" is exactly the kind of claim that
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
   a role switch is exactly the class of surprise Phase 2 should not be carrying. **Hard gate: Phase
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

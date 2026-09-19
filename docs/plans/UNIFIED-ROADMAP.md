# Unified Roadmap — Phase 7 (base) + Morbeh (business-model layer)

## Status — 2026-09-19 (T10.3 batch 3: security converted; 39 of 40)

`security` converted to per-request `tenantId` (b389e9f), so **39 of the 40 service compositions are converted** and **1 is not** (`tenancy`, parked) — from `rootEventContext(` call arity, not prose. T10.3 is NOT complete: `tenancy` stops on ADR-0014 point 8f (which reading of `Tenant.tenantId`), pending operator decision. T10.7: security's class-A row deleted; three class-D rows added (identity/consent projection consumers, provisioning consumers, boot-time bootstrap).

## Status — 2026-09-19 (T10.3 batch 2: cart, inventory, payments, orders, fulfillment, checkout, returns converted)

Seven more contexts moved to per-request `tenantId`, one commit each, so **38 of the 40 service
compositions are converted** and **2 are not** (`security`, and `tenancy`, parked) — derived from
`rootEventContext(` call arity in each `composition.ts`, not from prose. Unlike batch 1 these were not
leaves: `payments`, `orders`, `checkout` and `returns` each had ports the earlier batch's cross-context
adapters were pinned behind, and widening them unpinned seven class-A T10.7 rows (all deleted, not
edited). Also fixed: payments' `ProcessedWebhookStore`, orders' in-memory reservation/shipment stubs and
fulfillment's carrier-webhook dedup were keyed without a tenant, and payments passed the literal tenant
`"default"` to the PSP. Left open: `PaymentCapturedConsumer` takes a config-sourced tenant (new class-D
row, G-64), and fulfillment's webhook dedup is in-memory only in both compositions (G-66).

## Status — 2026-09-18 (T10.3 batch 1: pricing, reporting, promotions, notifications, shipping converted)

Five more contexts moved to per-request `tenantId`, one commit each, so **31 of the 40 service
compositions are converted** (that count includes `services/example`, the exempt template) and
**9 are not** (cart, checkout, fulfillment, inventory, orders, payments, returns, security, and
`tenancy`, parked) — derived from `rootEventContext(` call arity in each `composition.ts`, not from
prose. The earlier "23 converted + 14 unconverted" totals 37, not 40, so read it as an undercount. They were
measured as leaves by "no `apps/*` class implements their ports", which was the wrong test: each
context's use-case inputs and controller now carry `tenantId`, so their `apps/admin` routes and
controllers, `apps/runtime` seeds and the orders-paid consumer changed in the same commits (ADR-0014
Amendment 8). Also fixed: notifications' and shipping's provider-callback / carrier-webhook dedup
stores were keyed without a tenant. Three cross-context adapters keep a construction-time tenant until
checkout, orders and payments convert (T10.7 inventory, class A). Not touched:
`AnalyticsQueryPort.run` in reporting still takes no tenant (in-memory adapter only today).

## Status — 2026-09-18 (addendum: converted contexts emitted tenant-less events — fixed)

The T10.3 sweep dropped `tenantId` from the composition-time `EventContext`
(`rootEventContext(deps.idGenerator)`, one argument) when it moved the tenant to a per-call
repository parameter, so every event a converted context wrote carried no `tenantId` in the outbox
envelope (`packages/messaging/src/outbox/outbox-writer.ts:61`). Fixed by merging the per-call tenant
at every outbox write (`{ ...this.deps.context, tenantId }`; identity uses `aggregate.tenantId`,
`services/example` is a documented exception) — ADR-0014 Amendment 7. Guarded by
`assertWriteTimeTenant` per converted context plus `scripts/dev/check-outbox-tenant.mjs` in T10.3's
done-criterion, so the remaining contexts cannot repeat it. The script first scanned `services` only
and missed `packages/usage` (`OutboxUsageRecorder`, latent — nothing constructs it); it now scans
`services`, `packages` and `apps`, and the recorder merges `record.tenant`.

**Corrected counts (command output, not the prose below):** **23 contexts converted** — the 21 listed
in the next section plus **finance** and **customer-360**, which converted after that section was
written — and **14 unconverted**: cart, checkout, fulfillment, inventory, notifications, orders,
payments, pricing, promotions, reporting, returns, security, shipping, and **tenancy** (parked on
`morbeh/wp10-tenancy-wip`). Read "15 contexts" / "21 contexts" in the section below as the state on
its own date. G-64's consumer side (`orders-paid.consumers.ts`, `finance-settlement.consumers.ts`)
is still open and still needs `tenantId` required on the envelope (F-02) — that is not done here.

## Status — 2026-09-18 (WP-10 leftovers: feature-flags + analytics closed, scope corrected)

**What this session did.** Followed up on 2026-09-17's T10.3 write-path sweep, which scoped itself
to "Prisma repositories converted" and, by that narrower reading, left two sites pinning `tenantId`
at construction the identical way: **feature-flags** (`AggregateFeatureFlags`, a non-repository
adapter — the sweep converted its Prisma repository but missed this evaluator) and **analytics**
(`ClickHouseAnalyticsReadStore`, a non-Prisma store — unexercised today, no ClickHouse tables exist
yet per WP-3/G-44, but built against WP-3's future schema so converting now avoids a second pass).
Both fixed this session — `FeatureFlags.isEnabled`/`AnalyticsReadStore.fetch` both take `tenantId`
per call now, matching every other T10.3 conversion's shape. **Re-ran the repo-wide grep across all
21 previously-converted contexts to confirm nothing else was missed: identity's only remaining match
was inside a doc comment** (`services/identity/src/composition.ts:51`, a comment literally
containing the string `deps.tenantId` while describing why the context has none — not live code);
every other of the 21 contexts had zero matches. **21 contexts are therefore now fully converted**
(write path, read path, and every adapter/store) — the 19 from 2026-09-17 plus **identity** and
**catalog**, which the previous session's own text already counted in the 21 but is restated here
for clarity: identity, catalog, feature-flags, wishlist, reviews, loyalty, coupons,
recommendations, experimentation, media, search, seo, theme, components, content, experience,
pages, automation, localization, licensing, feature-registry.

**Also produced this session:** a complete, classified inventory of every remaining
construction-time tenant pin outside the 15 unconverted contexts' own repositories — 13 sites,
**(A) 6** converting with their owning context (checkout, orders, returns ×2, finance, security —
all sites the T10.3 sweep will pick up when those contexts convert), **(B) 1** belonging to T10.7's
cross-cutting sweep (`LicensingEntitlementPort`/`wireEntitlement`, T10.7's own scope already names
entitlements by package — also currently unwired into production composition entirely), **(C) 4**
legitimate by design and not a gap (`singleTenantGuardedResolver`, removed by T10.4; the WP-11
backfill script's per-run tenant; the finance-settlement backfill's same shape, already flagged in
ADR-0014 Amendment B; `SecurityPropagationContext`, a per-request value object, not a boot-pinned
singleton), and **(D) 2** recorded but not fixed this session — `orders-paid.consumers.ts` and
`finance-settlement.consumers.ts` (G-64's consumer side; needs the event envelope's `tenantId` to
become required first, a contract change). Full table: `WP-10-multi-tenant-runtime.md`'s T10.7
section. This also surfaced that T10.3's own done-criterion was too narrow — corrected in the same
WP file and in ADR-0014 Amendment 6 to "no construction-time tenant pinning anywhere in the
converted context — repositories, adapters, ports and stores alike, Prisma or otherwise," with the
repo-wide grep (plus a `TENANT_DEFAULT_ID` pass — the original pattern alone misses
`finance-settlement.consumers.ts:134`, which has no `deps.tenantId`/`this.tenantId =` shape at all)
named as the verification command instead of a `services/`-only one.

**Explicitly NOT touched this session** (unchanged scope boundary from 2026-09-17): `cart`,
`checkout`, `customer-360`, `finance`, `fulfillment`, `inventory`, `notifications`, `orders`,
`payments`, `pricing`, `promotions`, `reporting`, `returns`, `security`, `shipping` — 15 contexts
whose repositories (and, per this session's inventory, several cross-context adapters bridging
them) still read a composition-time-pinned `tenantId` and remain G-64-affected — and `tenancy`,
parked separately (below). **`security` (~90 construction-time-pinned references),
`customer-360` (~53), and `finance` (~49, plus its own `ClickHouseReadModelStore`) are, together,
roughly two thirds of the remaining conversion work** across all 15 contexts by reference count —
the three to plan for first if sequencing the remaining sweep by size.

**Task A — tenancy's conversion parked, not abandoned.** `packages/db/prisma/schema/tenancy.prisma`
and the tenancy context's repository/domain files were uncommitted WIP unrelated to this session's
identity-context work; moved intact to a new branch, `morbeh/wp10-tenancy-wip`
(commit `cd78169`), pending the platform-path ADR decision ADR-0014 Amendment 5 (below) proposes —
`Tenant`'s own `tenantId` semantics need resolving as part of that decision, not before it.

**Discovered gaps:**

- **G-64 (composition-time-pinned `tenantId`)** — write-side closed for the 21 contexts above;
  **still open** for the 15 not-touched contexts' write paths, and **still open** on the consumer
  side entirely (`apps/runtime/src/consumers/orders-paid.consumers.ts`,
  `finance-settlement.consumers.ts` still hardcode `TENANT_DEFAULT_ID` at builder construction —
  out of scope for this session per the runbook, which asked only for call sites to compile against
  an explicit-but-still-construction-time-sourced tenantId dep, not a full consumer-side fix).
- **New, not yet gap-registered:** six of the 19 contexts (**experience, pages, automation,
  localization, licensing, feature-registry**) had in-memory repositories whose read methods already
  accepted a `tenantId` parameter (from a prior session's read-path conversion) but silently
  **ignored** it — a cross-tenant leak strictly worse than G-64's composition-time-pinning, since it
  was invisible even after per-call `tenantId` threading. Found and fixed while adding this session's
  required per-context isolation test (the exact test that would have caught it). Needs a gap-
  register entry and a sweep of the 15 not-yet-converted contexts' in-memory repositories for the
  same pattern, since this session only checked the 19 it converted.
- **G-63** (untracked live RLS migrations) and **G-65** (undecided deployment region) — unchanged by
  this session; both remain exactly as ADR-0014 describes them, still pending an operator decision.

**Task C — ADR-0014 Amendment 5, proposed, not adopted.** A new "PROPOSED — REQUIRES APPROVAL"
amendment to `docs/architecture/adr/0014-per-request-tenant-scoping.md` (docs only, no tenancy/
security code changed) names a platform-operator exception category for legitimate cross-tenant
calls (tenant lifecycle management, a support break-glass read, a cross-tenant migration script):
a third database role distinct from both `postgres` and `lumo_app`; `BYPASSRLS` narrowed to exactly
the grants platform-operator tools need; no RLS escape hatch via a settable session variable; every
call gated by a distinct `platform:operator:*` permission and audited via the existing `Delegation`
aggregate (`services/security/src/domain/delegation.ts`); tenancy's admin write routes proposed to
move off the ordinary per-tenant-pinned router onto this path; and the `Tenant.tenantId` semantics
finding (its own doc comment asserts `tenant.id` **is** the platform `tenantId`, but the Prisma row
carries a separate, externally-supplied `tenantId` column — confirmed not self-referential in the
integration test).

**Pending operator decisions:**

1. ADR-0014 Amendment 5 sign-off (new DB role + grants, `Delegation`-based audit wiring, tenancy
   admin route relocation) — nothing in Amendment 5 is implemented; it is a proposal only.
2. The platform-path ADR decision Task A's parked branch is waiting on, which also resolves the
   `Tenant.tenantId` finding above.
3. G-63's reconstructed-migration commit + `prisma migrate resolve --applied` sign-off (unchanged
   from ADR-0014 Amendment 2 — still not done).
4. G-65's deployment-region decision (unchanged — still not done).

> **Audience: the implementing agent, starting cold.** Read this file, then
> [`phase-7/README.md`](phase-7/README.md) and [`README.md`](README.md) completely, in that order,
> before opening any WP file. This document is now the single entry point for planning work in this
> repository — it supersedes the "Phase 7 is the open work" pointer at the bottom of `README.md`'s
> table without changing anything else in that file.
>
> **This document contains no task-level work itself.** It reconciles two independently written
> plans that both target this repository — `phase-7/` (product-gap closure against the Lumo brief,
> measured 2026-09-06) and a separate "Lumo → Morbeh" execution manual (SaaS business-model
> transformation, dated 2026-09-08) — into one ordered set of work packages. Every task lives in a
> WP file; this document is the map between them.

## 1. Why two plans exist, and why neither is discarded

Phase 7 answers: _"Does the product this platform is supposed to be actually work?"_ — event
tracking, analytics storage, AI, growth engines, SEO/CMS, guest checkout, real multi-tenancy.

Morbeh answers a different question: _"Is this a SaaS business, correctly named, financially
sound, and able to charge its own merchants?"_ — rebrand, decimal money, registered finance
consumers, merchant payment methods, platform-level billing, a platform control plane.

They overlap in exactly one place — **multi-tenancy** — because both plans independently found the
same fact (`apps/runtime/src/composition.ts` throws on `TENANT_MODE=multi`) and both call it their
biggest single item. Where Phase 7's `WP-10` already has task-level design for this (including a
resolved architecture fork — see §4), Morbeh's version stays at goal-level. **`WP-10` wins; Morbeh's
tenancy goals are folded into it as additional acceptance checks, not a second implementation.**

Everywhere else, the two plans are disjoint: Phase 7 never mentions rebrand, decimal money, finance
consumer registration, merchant payment methods, SaaS billing, or a platform control plane. Morbeh
never mentions tracking, ClickHouse, AI-as-a-copilot-feature (it mentions an AI plane, which is
`WP-5` — see §4), growth engines, SEO/CMS, or guest checkout. Running both to completion, in the
order this document sets out, produces the union of both — nothing from either source document is
silently dropped, and nothing is built twice.

## 2. Verified state — reconciling the two measurements

Both plans independently measured the repository within 48 hours of each other. Where they differ,
this is why, and which number to trust going forward.

| Fact                           | Phase 7 (2026-09-06)                                                                                | Morbeh (2026-09-08)                                                                                                                                                                 | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Services                       | 40                                                                                                  | 40                                                                                                                                                                                  | Agree.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Prisma schema files            | 40                                                                                                  | 41                                                                                                                                                                                  | Off by one, immaterial — re-glob `packages/db/prisma/schema/*.prisma` at the start of any task that depends on the count.                                                                                                                                                                                                                                                                                                        |
| Prisma models / tenant-scoped  | not stated                                                                                          | 132 / 130                                                                                                                                                                           | No conflict — take Morbeh's, re-verify with `grep -c "^model " packages/db/prisma/schema/*.prisma` before relying on it in `WP-10`.                                                                                                                                                                                                                                                                                              |
| Typecheck / tests              | 79/79 packages, 0 errors; 3,124 tests pass, 77 packages                                             | "295,816 source lines," "554 test files" (different unit — files, not pass/fail)                                                                                                    | Not a real conflict — different metrics. Phase 7's numbers are the ones with a pass/fail verdict; use them as the gate baseline.                                                                                                                                                                                                                                                                                                 |
| `turbo` on this host           | Confirmed broken (`STATUS_DLL_NOT_FOUND`, exit 127)                                                 | Not investigated — Morbeh's §04 "Full gate" assumes bare `pnpm lint`/`typecheck`/`build`/`test`/`test:coverage` work                                                                | **Phase 7 is right, and it's worse than either doc states**: `pnpm build` also shells to `turbo run build` (`package.json`) and will fail the same way, not just lint/typecheck/test/coverage. See §3.                                                                                                                                                                                                                           |
| ClickHouse                     | 0 DDL files anywhere; never wired into `apps/runtime`                                               | F-21 audits _whether the ClickHouse read stores enforce tenant scoping_, as if the tables exist                                                                                     | **Morbeh's F-21 is currently unanswerable and not worth auditing today** — the read stores query tables that do not exist yet. `WP-3` builds ClickHouse from nothing, with `tenant_id` as the mandatory first sort-key column (`WP-3` §T3.3) baked into the schema before a single row is written. F-21 is closed _by construction_ once `WP-3` lands, not by a separate audit. Do not spend time auditing code that cannot run. |
| Guest checkout                 | Cannot complete an order (G-52); `apps/e2e/tests/guest-purchase.spec.ts` is `test.fail()`-annotated | Not mentioned at all                                                                                                                                                                | Real gap in Morbeh's coverage. `WP-1` (unchanged) closes it. This document does not ask Morbeh to re-derive it — Phase 7's finding stands as-is.                                                                                                                                                                                                                                                                                 |
| Float financial columns        | Not mentioned                                                                                       | F-07: `licensing.prisma:79,95`, `pricing.prisma:66`, `finance.prisma:133` are `Float`                                                                                               | **Verified independently in this session** (`grep -n Float` against all four cited lines — all four are exactly as Morbeh states). Real gap in Phase 7's coverage. `WP-11` closes it.                                                                                                                                                                                                                                            |
| Finance consumers unregistered | Not mentioned                                                                                       | F-11: `PaymentsCapturedConsumer`/`RefundsIssuedConsumer` (`services/finance/src/interfaces/finance-consumers.ts:77,100`) never instantiated, confirmed by `composition.test.ts:318` | **Verified independently in this session** — the cited test literally asserts the string `"nothing instantiates them"` and the two class names exist at those exact lines. Real gap in Phase 7's coverage. `WP-11` closes it.                                                                                                                                                                                                    |

### The repository-identity claim that is simply wrong

`docs/plans/README.md` §"Rules of engagement" states: _"Do not run `git` commands. This working
copy is not an initialised git repository."_ **This is false as of this session** — `.git/` exists,
`git status`, `git log`, and branches (`main`, `feat/cloud-platform-runtime-2`, others) all work.
This was evidently true when that file was first written and has not been true for some time
(`docs/plans/phase-7/WP-0-baseline-truth.md` T0.4 already notes work is committed on
`feat/cloud-platform-runtime-2`). **Use Morbeh's git discipline instead — it is the version written
against a real repository:** branch per workstream, Conventional Commits (husky `commit-msg` hook
enforces the format), one task per commit, never mix a rename with a behaviour change. `WP-0`'s T0.2
should correct this line in `docs/plans/README.md` when it is next touched; until then, treat this
section as the override.

## 3. Environment — the gate commands every WP must actually use

`turbo` does not run on this Windows host, in any form (`pnpm exec turbo --version` produces no
output and exits 127 in this session — the same failure class `docs/plans/BLOCKERS.md` has recorded
three times, each with a slightly different symptom, at lines 36, 87 and 300). Root `package.json`
routes **five** scripts through it, not the three Phase 7's README calls out:

```
build      → turbo run build       ← also broken, not previously flagged
lint       → turbo run lint
typecheck  → turbo run typecheck
test       → turbo run test
test:coverage → turbo run test:coverage
arch       → depcruise ...         ← does NOT use turbo; works
```

**Every WP in this roadmap (0 through 18) uses these forms, never the bare root scripts:**

```bash
# per-package, after touching that package
pnpm --filter <name> run typecheck && pnpm --filter <name> run lint && pnpm --filter <name> run test

# repo-wide, before declaring any WP done
pnpm -r --workspace-concurrency=4 run typecheck
pnpm -r --workspace-concurrency=4 --no-bail run test
pnpm -r --workspace-concurrency=4 --no-bail run test:coverage   # if a WP's done-criteria need coverage
pnpm arch
```

`--no-bail` is not optional on the two `test`/`test:coverage` lines: `pnpm -r` stops at the first
failing package by default, so without it a gate run silently covers only however many packages
ran before the first failure and reports that partial result as green — `WP-0` hit exactly this
(the first run covered 27 of ~79 packages before stopping).

`build` has no documented repo-wide workaround yet — if a WP's definition of done requires a
production build, run `pnpm --filter <name> run build` per package touched and record in
`docs/plans/BLOCKERS.md` if a repo-wide build is genuinely required and still blocked.

Two known concurrency-only flakes — re-run either file alone
(`pnpm --filter <name> run test`) before treating a failure in it as a regression:

- `apps/runtime/src/security/wire-security-provisioning.test.ts` times out at 5s only under
  `--workspace-concurrency=4`, passes in 789ms run alone.
- `packages/http/src/server.test.ts` ("omits bearerAuth from the OpenAPI security requirement for
  a public route") times out at 5s only under `--workspace-concurrency=4`, passes in 530ms
  (all 28 tests in the file) run alone. Found during `WP-0`'s gate measurement, not previously
  documented.

## 4. The master work-package table

Numbering continues Phase 7's own (`WP-0`…`WP-10` unchanged). Morbeh's contribution becomes
`WP-11`…`WP-18`, filed alongside the existing WPs in `docs/plans/phase-7/`.

| WP  | File                               | Source       | Depends on                            | Closes                                                        |
| --- | ---------------------------------- | ------------ | ------------------------------------- | ------------------------------------------------------------- |
| 0   | `WP-0-baseline-truth.md`           | Phase 7      | —                                     | doc drift                                                     |
| 1   | `WP-1-guest-checkout.md`           | Phase 7      | —                                     | G-52                                                          |
| 2   | `WP-2-storefront-events.md`        | Phase 7      | —                                     | G-43                                                          |
| 3   | `WP-3-clickhouse-analytics.md`     | Phase 7      | 10 (moved — see §5); useful after 2   | G-44, Morbeh F-21 (by construction)                           |
| 4   | `WP-4-attribution.md`              | Phase 7      | 3                                     | G-54                                                          |
| 5   | `WP-5-ai-copilot.md`               | Phase 7      | 3, 10 (moved — see §5)                | G-45, Morbeh F-17 (phase 1 of it — see note below)            |
| 6   | `WP-6-automation-engine.md`        | Phase 7      | —                                     | G-48, G-49                                                    |
| 7   | `WP-7-growth-engines.md`           | Phase 7      | 2, 3                                  | G-46, G-47                                                    |
| 8   | `WP-8-storefront-seo-cms.md`       | Phase 7      | —                                     | G-50, G-51                                                    |
| 9   | `WP-9-marketing-integrations.md`   | Phase 7      | 6                                     | G-55                                                          |
| 10  | `WP-10-multi-tenant-runtime.md`    | Phase 7      | —                                     | G-53, Morbeh F-01–F-05, F-13, F-22–F-24 (folded in — see §4a) |
| 11  | `WP-11-financial-integrity.md`     | Morbeh (new) | —                                     | Morbeh F-06, F-07, F-11                                       |
| 12  | `WP-12-brand-rename.md`            | Morbeh (new) | 0                                     | Morbeh F-20                                                   |
| 13  | `WP-13-merchant-payments.md`       | Morbeh (new) | 1 (order/checkout shape)              | Morbeh F-19                                                   |
| 14  | `WP-14-saas-billing.md`            | Morbeh (new) | 11, 13                                | Morbeh F-16                                                   |
| 15  | `WP-15-platform-control-plane.md`  | Morbeh (new) | 10, 14                                | Morbeh F-08, F-18                                             |
| 16  | `WP-16-governance-continuous.md`   | Morbeh (new) | none hard; attaches opportunistically | Morbeh F-09, F-14 (partly — see WP-17)                        |
| 17  | `WP-17-enforceable-invariants.md`  | Morbeh (new) | 0                                     | Morbeh F-14 (the `/testing`-import rule)                      |
| 18  | `WP-18-order-total-correctness.md` | Morbeh (new) | 1                                     | Morbeh F-12                                                   |

### 4a. What "folded into WP-10" means, precisely

Morbeh's audit workstream (its "W0": F-21 ClickHouse, F-22 storage keys, F-23 scheduler
propagation, F-24 in-memory caller coverage) and its tenancy workstream (its "W4": F-01 through
F-05, F-13) are **not** a separate WP in this roadmap. Here is where each one actually goes:

- **F-21** (ClickHouse tenant scoping) — moot until `WP-3` exists; closed by construction per §2.
  Re-open only if `WP-3`'s delivered schema does _not_ lead with `tenant_id`.
- **F-22** (object-storage key scoping) — `WP-10`'s T10.7 ("cross-cutting sweep") already names
  "object-storage prefixes" as one of the singletons to re-key by tenant. Treat Morbeh's F-22 as
  the citation backing that line item; no separate audit task needed.
- **F-23** (scheduler/job tenant propagation) — same T10.7 sweep names "the scheduler's jobs...
  must now run per tenant" explicitly. Same fold.
- **F-24** (in-memory caller coverage repo-wide) — this one is **not** already covered. Add it as
  an explicit task inside `WP-10` (see that file's amendment note) rather than a standalone audit,
  because the only findings that matter are the ones reachable from `apps/*` after `WP-10`'s
  per-request repository scoping lands — auditing today's boot-time-pinned graph produces answers
  that `WP-10` immediately invalidates.
- **F-01–F-05, F-13** (repositories pinned at boot, optional `tenantId` on events/audit context,
  storefront's constant tenant header, auth-cache key, Redis namespace enforcement, erasure into
  ClickHouse) — these are exactly what `WP-10`'s Option A (per-request repository scoping) and
  T10.7 (cross-cutting sweep) already do. `WP-10`'s existing task list, unmodified, closes all of
  them. Do not open a parallel tenancy effort.

**Practical instruction for whoever runs `WP-10`:** read `WP-10-multi-tenant-runtime.md` as
written, and additionally read Morbeh's F-01 through F-05, F-13, F-22, F-23, F-24 as extra
citations and acceptance detail for T10.1, T10.5 and T10.7 — they name concrete file:line evidence
(`packages/auth/src/keto.ts:125` for the cache-key gap, `packages/redis/src/{cache,locks,
idempotency,rate-limiter}.ts` for Redis namespace enforcement, `apps/storefront/src/lib/
runtime-api.ts:109,148,177,202` for the constant tenant header) that sharpens what T10.5's
adversarial test suite must cover. `docs/plans/phase-7/WP-10-multi-tenant-runtime.md` itself is not
edited by this roadmap; carry these citations forward at dispatch time instead.

### 4b. What "phase 1 of F-17" means for WP-5

Morbeh's F-17/W9 ("no AI plane... orchestrator, permission layer, tool registry... a per-request AI
ledger feeding cost and margin") and Phase 7's `WP-5` ("a read-only Copilot with tool calling,
built into the existing `AiGovernanceProfile` guard rail") are the same gap, described at two
different altitudes. `WP-5` is the task-level plan; it is explicitly phase 1 (read-only). Morbeh's
fuller ambition — action execution (propose → confirm → execute) and the AI cost ledger feeding
`WP-15`'s margin reporting — has no task-level design anywhere and is recorded here as **future
work, not a WP**: do not create a new WP for it until `WP-5` has shipped and a phase-2 design
exists (it would be `WP-19` when that day comes — `WP-18` is already spoken for, see §4c).
`WP-5`'s own doc comment already calls this out ("Brief §37's write flow... is phase 2 and needs
its own design round").

### 4c. Two more items, for completeness

- **F-12** (tax is a flat 10% stub, shipping is hardcoded, no product carries a weight) is not
  folded into any existing WP — it is genuinely uncovered by Phase 7 and was missed in the first
  draft of this roadmap. Independently verified in this session against
  `apps/runtime/src/api.ts`'s boot guard and `services/shipping`'s `weightGrams` requirement.
  **`WP-18` (new) closes it**, carrying Morbeh's D5 (ports and in-house rate tables first; no
  external tax/shipping provider without separate approval) as its governing decision.
- **F-15** (raw SQL surface is three benign sites — `health.ts:9`, `composition.ts:216`,
  `scheduler.ts:216`) needs no WP. Morbeh's own verdict was `KEEP`; nothing in Phase 7 contradicts
  it. Listed here only so it doesn't read as silently dropped.
- Morbeh's D6 ("the audit freeze is amended to permit test code... a red suite at the end of W0 is
  a pass") governed Morbeh's own standalone audit phase. That phase does not exist in this
  roadmap — §4a folds its findings into `WP-3`/`WP-10` directly — so D6 does not carry forward as a
  rule for any WP here. It is recorded in this paragraph only so nobody goes looking for it.

## 5. Ordering and conflicts

### Recommended sequence

```
WP-0                                          (always first, alone)
  ├─ WP-12 (rename)                           (early: cost only grows; low logic risk)
  ├─ WP-17 (arch rule for /testing imports)   (cheap, hardens the build for everything after)
  └─ WP-11 (financial integrity)              (independent of tracking/tenancy; do any time after 0)

WP-10 (tenancy)                               (before the chain below — see note)

WP-1 ──────────────┐
WP-2 → WP-3 → WP-5 │  (the Phase-7 critical chain, now sequenced after WP-10)
                    │
WP-4, WP-6, WP-7, WP-8, WP-9   (any order, per Phase 7's own conflict table)

WP-18 (order total: tax/shipping/weight) → after WP-1 (shares the order-creation path)
WP-13 (merchant payments)   → after WP-1 (needs the finalized order/checkout shape)
WP-14 (SaaS billing)        → after WP-11 (decimal ledger) and WP-13 (shared orchestrator contract)
WP-15 (platform control plane) → after WP-10 (tenancy) and WP-14 (billing/ledger to report on)
WP-16 (governance)          → continuous; attach each item to whichever WP first makes it relevant
```

**`WP-10` moved ahead of the `WP-2 → WP-3 → WP-5` chain, not parallel to it, as of this revision.**
The extended hot-file table below already shows why this was wrong as first written: `WP-3` and
`WP-5` both edit `apps/runtime/src/composition.ts` (Phase 7's own conflict table), and `WP-10` is
precisely the workstream that rewrites that file's repository-construction pattern wholesale (boot-
time-pinned `wireX({ prisma, tenantId })` calls become per-request). Landing `WP-3`/`WP-5` first
means writing their `composition.ts` wiring against a construction pattern `WP-10` immediately
tears out — either that wiring gets rewritten a second time once `WP-10` lands, or `WP-10`'s "keep
gates green between contexts" requirement (its own T10.3) has to thread through two other WPs'
fresh changes to the same file mid-refactor. Sequencing `WP-10` first means `WP-2` (which does not
touch `composition.ts`) can still start immediately, but `WP-3` and `WP-5` now wait for `WP-10` to
land first.

`WP-10` is the single largest item in the combined roadmap (Phase 7 calls it "the largest
architectural change in Phase 7"; Morbeh independently called its own version "one atomic
workstream, not eight tickets"). Both agree it should not be split, and both agree an ADR must be
written and reviewed before implementation starts. Nothing about folding Morbeh's citations into it
changes that requirement.

### Extended hot-file conflict table

Phase 7's own table (`phase-7/README.md` §3) lists which of its WPs collide on `composition.ts`,
`apps/storefront/src/**`, `admin-routes.ts`, and the two message dictionaries. The Morbeh-derived
WPs add to it:

| Hot file                                 | Also claimed by                                                                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/runtime/src/composition.ts`        | + `WP-14` (dunning consumer wiring), `WP-15` (platform-admin composition), `WP-16` (DLQ replay wiring)                                                                                                                                |
| `apps/admin/src/http/admin-routes.ts`    | + `WP-13` (merchant payment settings routes), `WP-14` (billing analytics routes), `WP-15` (platform-console routes)                                                                                                                   |
| `apps/admin-web/src/messages/{en,ar}.ts` | + every Morbeh WP with a screen (`WP-13`, `WP-14`, `WP-15`) — and **`WP-12` touches every existing key's surrounding brand string**, which is exactly why it runs early, before more WPs add more strings that would need re-touching |
| `apps/storefront/src/**`                 | + `WP-13` (payment method selection at checkout)                                                                                                                                                                                      |

`WP-11`, `WP-17`, and `WP-18` touch neither list — they are the safest WPs to run in parallel with
anything (though `WP-18` should still sequence after `WP-1` per the dependency above, to avoid two
WPs reshaping the same order-creation path at once).

## 6. Milestones (renumbered against this roadmap)

| Milestone                 | WPs                                    | Meaning                                                                                                                                  |
| ------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Safe Baseline             | 0, 11, 12, 17                          | Correctly named, build-enforced invariants active, ledger complete and decimal. Nothing shipped to customers yet, nothing quietly wrong. |
| Sellable                  | 1, 2, 3, 5, 18                         | A guest can buy something at a correct total (real tax, real shipping); the data plane has a producer, a store, and a first AI surface.  |
| Multi-Merchant Foundation | 10                                     | More than one merchant can exist with no cross-tenant leak, through any surface.                                                         |
| Growth-Complete           | 4, 6, 7, 8, 9                          | Attribution, automation, recommendations/experiments, SEO/CMS, marketing/integrations all real.                                          |
| Commercial GA             | 13, 14, 15                             | Merchants can get paid, Morbeh can charge merchants, and the platform is operated without a database console.                            |
| Governed                  | 16 (continuous throughout, not a gate) | Every non-negotiable has a named CI check or a named gap ticket.                                                                         |

## 7. Rules that apply across both source plans

All non-negotiables in `docs/plans/README.md` §"Architecture you must respect" and
`phase-7/README.md` §4 hold for every WP in this table, Morbeh-sourced ones included. In addition,
carry these Morbeh operating rules forward, because they are not duplicated anywhere in Phase 7 and
they are good rules:

1. **Trace the caller before classifying anything as a defect.** Morbeh's own Rev 1 got a P0 wrong
   this way (it inferred production exposure from an `deps.X ?? new InMemoryY()` pattern without
   finding the real caller — `apps/runtime/src/api.ts:397` passes a real adapter). The pattern is a
   composition seam, not evidence.
2. **Every claim carries a `path:line`.** In commits, in reports, in code comments.
3. **One workstream per branch** (`morbeh/w{n}-{slug}` or `phase7/wp{n}-{slug}`, either convention
   is fine — pick one per WP and stay consistent within it), **one task per commit**, Conventional
   Commits (husky enforces the format already).
4. **Stop and report rather than working around.** If a WP's premise is false — already fixed,
   file doesn't exist, needs a decision this document doesn't make — stop, cite what you found, and
   append it to `docs/plans/BLOCKERS.md` in the shape that file already uses. Do not substitute a
   different task or expand scope to "while I'm here."

## 8. What this document deliberately does not do

It does not rewrite any existing WP file (`WP-0` through `WP-10` are untouched — cross-references
from Morbeh are recorded here, in §4a–§4c, precisely so those files stay the single-session,
paste-and-go briefs they were designed as). It does not create a WP for Morbeh's D1–D2 (package
naming stays `@platform/*`; design-system token values are unchanged) because those are negative
decisions, not tasks — they are binding constraints on `WP-12`, not separate work. It does not
create a WP for the AI plane's phase 2 (§4b) or for a data-driven attribution model (`WP-4`'s own
"Known traps" already defers that) — both are explicitly future work with no task-level design yet.

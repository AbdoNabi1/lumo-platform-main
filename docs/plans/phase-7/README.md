# Phase 7 — Close the product gap between the built platform and the Lumo brief

> **Audience: the implementing agent, starting cold in a fresh session.**
> Read this file **and** [`../README.md`](../README.md) completely before opening any WP file.
> `../README.md` holds the architecture contract, the non-negotiable rules, the file-to-copy
> table, and the `--filter` name map. Everything in it still applies. This file only adds what
> changed since it was written, and what Phase 7 is for.

---

## 1. Verified state — measured on 2026-09-06, not quoted from docs

Every number below was produced by running the command, not read from a report. Earlier status
documents in this repo (`README.md`, `docs/PROJECT_STATE.md`) are **stale by many sprints** and
must not be trusted; WP-0 fixes them.

### Gates (measured)

| Gate        | Command                                             | Result                                                                                           |
| ----------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Typecheck   | `pnpm -r --workspace-concurrency=4 run typecheck`   | **PASS** — 79/79 packages, 0 TS errors                                                           |
| Tests       | `pnpm -r --workspace-concurrency=4 run test`        | **3,124 tests pass** across 77 packages                                                          |
| Known flake | `apps/runtime` `wire-security-provisioning.test.ts` | times out at 5 s **only under concurrency**; passes in 789 ms in isolation. Not a logic failure. |

> **`turbo` is broken on this Windows host.** `pnpm exec turbo run <task>` exits with
> `-1073741515` (`STATUS_DLL_NOT_FOUND`) and produces no output; `turbo --version` prints
> nothing. **Do not use `pnpm typecheck` / `pnpm test` / `pnpm lint` (they shell out to turbo).**
> Use `pnpm -r --workspace-concurrency=4 run <task>` for repo-wide runs and
> `pnpm --filter <name> run <task>` for a single package. `pnpm arch` does not use turbo and works.

### Size (measured)

| Layer                                 | Measured                                       |
| ------------------------------------- | ---------------------------------------------- |
| `services/*` bounded contexts         | 40                                             |
| HTTP routes in `apps/admin/src/http/` | **461** total, **44** of them `/public/*`      |
| `apps/admin-web`                      | ~73,000 lines, ~80 routes                      |
| `apps/runtime`                        | ~15,000 lines                                  |
| `packages/tracking`                   | ~10,500 lines                                  |
| Postgres migrations                   | 38, across 40 Prisma schema files              |
| ClickHouse DDL                        | **0 files — none exists anywhere in the repo** |

**Conclusion: the backend skeleton is real, clean, and compiles.** Phase 7 is not a rescue. It
closes specific, named product gaps.

---

## 2. The four structural gaps Phase 7 closes

### Gap A — The data plane has an engine but no fuel

`packages/tracking` is a complete, sophisticated event pipeline (envelope, click-ids, identity
graph, queue, router, delivery adapters with **real** seeded Meta CAPI / Google Ads / GA4 / TikTok
/ Snapchat destination + mapping profiles in `packages/tracking/src/delivery/platform-profiles.ts`).
`services/customer-360` is a genuine CDP — 72 use cases including identity resolution, session
merge, computed attributes, segment projection workers. `services/analytics` is a genuine semantic
layer — metric/dimension catalogs, an expression evaluator, a query compiler, and a
`ClickHouseAnalyticsReadStore`.

**None of it receives a single event.** Verified:

- `grep -r "@platform/tracking" apps/storefront/src` → **0 hits**. The dependency is declared in
  `apps/storefront/package.json` and never imported. The storefront emits nothing.
- No ClickHouse DDL exists (`find . -name '*.sql'` returns only Postgres files), so
  `ClickHouseAnalyticsReadStore` and `services/finance`'s `ClickHouseReadModelStore` query tables
  that do not exist.
- `grep -rn "ClickHouse" apps/runtime/src/*.ts` → **0 hits**. ClickHouse is never wired into the
  runtime, despite `CLICKHOUSE_URL`/`_USER`/`_PASSWORD`/`_DATABASE` existing in `.env.example`.

→ **WP-2** (producers) and **WP-3** (storage + wiring) close this. Everything downstream —
analytics, attribution, personalisation, the AI layer's data — depends on them.

### Gap B — There is no AI layer

The brief devotes 11 sections (28–38) to AI. Repo-wide search for `copilot`, `@anthropic-ai`,
`openai` across all `src` directories returns **one hit, in an unrelated security test**. Zero AI
code exists.

**But the AI _safety_ layer from brief §38 already exists and is production-grade.**
`services/security/src/domain/ai-governance-profile.ts` defines `AiGovernanceProfile`: per-identity
token budgets, call quotas on a rolling window, `allowedTools` / `allowedResources` sandboxing,
`isolationLevel` (`none` | `sandboxed` | `isolated`), a `suspended` kill-switch, and a
`security.ai_identity.budget_exceeded` recorded-fact event. There is an admin screen for it at
`apps/admin-web/src/app/security/ai-governance/page.tsx` with a "check AI action" simulation panel.

→ **WP-5** builds the Copilot _into_ that existing guard rail. It must not invent a parallel one.

### Gap C — The growth engines are CRUD shells

Each of these exists as a well-formed aggregate with status transitions, a Prisma repository, admin
routes and an admin screen — and no engine behind it:

| Context                    | What is missing (verified)                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/recommendations` | No algorithm. `GenerateRecommendationSet` scores `1 / (index + 1)` over `SearchQueryPort`, whose only implementation is `InMemorySearchQueryPort` returning `[]`. All 7 strategies (`related`, `frequently_bought_together`, `personalized`, …) produce identical empty output.                                              |
| `services/experimentation` | No assignment. Grep for `assign` / `bucket` / `hash` across the context returns nothing — variants carry an `allocationPercentage` that nothing ever allocates against. No statistical evaluation; `ExperimentResult` is a plain `{variantKey, metricValue, sampleSize}` row. Nothing in the storefront reads an experiment. |
| `services/automation`      | `AutomationTrigger` is `event \| scheduled`; `AutomationAction` is `{actionType, params}`. There is **no delay, condition, branch, wait or goal step**. The brief's abandoned-cart workflow is not expressible.                                                                                                              |
| `services/notifications`   | Channels `email \| sms \| push \| webhook \| in_app` are defined; every provider is `InMemoryEmailProvider` / `InMemorySmsProvider` / … in `in-memory-port-adapters.ts`. Nothing is ever actually sent.                                                                                                                      |
| `services/search`          | No query execution. The storefront's `/search` page does a case-insensitive substring match over Catalog products (see its own doc comment) and never touches the Search context.                                                                                                                                            |

→ **WP-6** (automation + real senders) and **WP-7** (recommendations + experimentation) close this.

### Gap D — Named brief modules that do not exist at all

| Brief section                     | Status                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §16, §31–32 Marketing / Campaigns | No `services/marketing`. No campaign aggregate. `campaignRef` is an opaque optional string on Coupon/Promotion. `apps/admin-web/src/app/marketing/page.tsx` renders an honest "this does not exist" state — **keep that honesty rule**.                                                                                |
| §48 Integrations                  | `docs/growth/03-INTEGRATIONS_HUB_SPEC.md` is marked `Status: CONTRACT — No application code`. No connection registry, no OAuth, no feeds.                                                                                                                                                                              |
| §20 Attribution                   | Tracking _collects_ `utm_*` + click-ids into `AttributionContext`. There is no attribution **model** — no first/last/linear/position/time-decay computation anywhere.                                                                                                                                                  |
| §25 SEO (storefront half)         | `services/seo` has profiles, redirects, robots policies and sitemaps. The storefront renders **none** of it: `grep -rn "generateMetadata\|ld+json\|sitemap\|robots" apps/storefront/src` → 0 hits. No `sitemap.ts`, no `robots.ts`, no JSON-LD, no per-page metadata.                                                  |
| §5 CMS (storefront half)          | `services/pages`, `services/components`, `services/content`, `services/theme` all exist with admin CRUD. No `/public/pages` route exists, and `apps/storefront/src/app/page.tsx` is hardcoded — the storefront renders no CMS content. There is no visual page builder (`pages/[pageId]/page.tsx` is a 146-line form). |

→ **WP-4** (attribution), **WP-8** (SEO + CMS), **WP-9** (marketing + integrations).

### Two blockers that sit outside the four gaps

1. **Guest checkout cannot complete an order.**
   `apps/admin/src/infrastructure/cross-context/order-creation.adapter.ts:71` throws when
   `customerRef === undefined`, which every unauthenticated storefront session is by definition.
   `apps/e2e/tests/guest-purchase.spec.ts` marks the final assertion `test.fail()` because of it.
   The platform cannot currently sell to a guest. → **WP-1**.

2. **The runtime is single-tenant.**
   `apps/runtime/src/composition.ts` throws at boot on `TENANT_MODE=multi`, because every
   `wireX({ prisma, tenantId })` pins its repositories to one `tenantId` at construction — there is
   no per-request re-composition. The Postgres schema _is_ tenant-aware (`tenant_id` + tenant-led
   uniques on every business table, per ADR-0008); the runtime is not. For a SaaS this is a
   product-level gap, not a config switch. → **WP-10**.

---

## 3. Work packages

Each WP file is a **complete, standalone brief**. To run one, open a fresh session in this repo and
paste the one-line prompt from the table. The agent reads the file and executes it.

| WP  | File                                                               | Prompt to paste                                             | Depends on         |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------ |
| 0   | [`WP-0-baseline-truth.md`](WP-0-baseline-truth.md)                 | `Execute docs/plans/phase-7/WP-0-baseline-truth.md`         | —                  |
| 1   | [`WP-1-guest-checkout.md`](WP-1-guest-checkout.md)                 | `Execute docs/plans/phase-7/WP-1-guest-checkout.md`         | —                  |
| 2   | [`WP-2-storefront-events.md`](WP-2-storefront-events.md)           | `Execute docs/plans/phase-7/WP-2-storefront-events.md`      | —                  |
| 3   | [`WP-3-clickhouse-analytics.md`](WP-3-clickhouse-analytics.md)     | `Execute docs/plans/phase-7/WP-3-clickhouse-analytics.md`   | — (better after 2) |
| 4   | [`WP-4-attribution.md`](WP-4-attribution.md)                       | `Execute docs/plans/phase-7/WP-4-attribution.md`            | 3                  |
| 5   | [`WP-5-ai-copilot.md`](WP-5-ai-copilot.md)                         | `Execute docs/plans/phase-7/WP-5-ai-copilot.md`             | 3                  |
| 6   | [`WP-6-automation-engine.md`](WP-6-automation-engine.md)           | `Execute docs/plans/phase-7/WP-6-automation-engine.md`      | —                  |
| 7   | [`WP-7-growth-engines.md`](WP-7-growth-engines.md)                 | `Execute docs/plans/phase-7/WP-7-growth-engines.md`         | 2, 3               |
| 8   | [`WP-8-storefront-seo-cms.md`](WP-8-storefront-seo-cms.md)         | `Execute docs/plans/phase-7/WP-8-storefront-seo-cms.md`     | —                  |
| 9   | [`WP-9-marketing-integrations.md`](WP-9-marketing-integrations.md) | `Execute docs/plans/phase-7/WP-9-marketing-integrations.md` | 6                  |
| 10  | [`WP-10-multi-tenant-runtime.md`](WP-10-multi-tenant-runtime.md)   | `Execute docs/plans/phase-7/WP-10-multi-tenant-runtime.md`  | —                  |

### Recommended order

**WP-0 first, alone.** It is small and every later WP reads the docs it corrects.

Then the critical chain, in order — this is the path that turns Lumo from a well-built admin CRUD
into the product the brief describes:

```
WP-1  →  WP-2  →  WP-3  →  WP-5
(sellable) (events) (storage) (AI)
```

Then, in any order: WP-4, WP-6, WP-7, WP-8, WP-9, WP-10.

### Running two WPs in parallel

Safe only when their path sets do not overlap. They do overlap more than you would expect:

| Hot file                                 | Claimed by                          |
| ---------------------------------------- | ----------------------------------- |
| `apps/runtime/src/composition.ts`        | WP-3, WP-5, WP-6, WP-7, WP-9, WP-10 |
| `apps/storefront/src/**`                 | WP-2, WP-7, WP-8                    |
| `apps/admin/src/http/admin-routes.ts`    | WP-4, WP-5, WP-6, WP-8, WP-9        |
| `apps/admin-web/src/messages/{en,ar}.ts` | every WP with a screen              |

**Pairs that are genuinely safe to run at the same time:**

- WP-1 ∥ WP-8 (orders/identity vs. storefront pages — no shared file)
- WP-2 ∥ WP-10 (storefront vs. runtime composition — but WP-10 must land first if both touch `composition.ts`)
- WP-6 ∥ WP-8

Anything else: run serially, or expect to resolve conflicts in `composition.ts`, `admin-routes.ts`
and the two dictionaries by hand.

---

## 4. Rules that apply to every WP

All the non-negotiables in [`../README.md`](../README.md) still hold. Re-read them. The four that
get broken most often in this kind of work:

1. **Never fabricate data in a UI.** If a value cannot be read from the backend, render an explicit
   unavailable state. `apps/admin-web/src/app/marketing/page.tsx` is the reference. A tile that
   shows sample data must keep `provenance: "demo"`.
2. **Domain aggregates never go on the wire.** Map through an explicit, fully-primitive DTO.
   `Entity` exposes `props` / `_id` / `_domainEvents` / `_version` at runtime.
3. **`packages/*` and `services/*` never import from `apps/*`.** Enforced by `pnpm arch`.
4. **Every user-facing string goes in both `en.ts` and `ar.ts`.** Missing an `ar.ts` key is a type
   error, so this one fails loudly — but only if you actually run typecheck.

And three that are specific to Phase 7:

5. **Do not weaken an existing security control to make a feature work.** Several WPs touch
   `AdminGuard`, `EntitlementGuard`, `CustomerGuard` and the AI governance profile. If a control
   blocks you, that is a design question — record it in `docs/plans/BLOCKERS.md` and continue.
6. **Do not delete the honest "this does not exist" screens** until the thing actually exists.
   Replace them in the same commit that makes them untrue.
7. **Never ship a secret.** `apps/storefront` runs in the browser; a tracking **write key** is
   public by design, an API key is not. Check which one you are handling.

## 5. Verification — run after every task

```bash
pnpm --filter <name> run typecheck && pnpm --filter <name> run lint && pnpm --filter <name> run test
```

When you touch `services/*` or `packages/*`, also:

```bash
pnpm arch
```

Before declaring a WP done, run the repo-wide gates (turbo is broken — use these exact commands):

```bash
pnpm -r --workspace-concurrency=4 run typecheck
```

```bash
pnpm -r --workspace-concurrency=4 --no-bail run test
```

`--no-bail` matters here: `pnpm -r` stops at the first failing package by default, so without it a
run silently covers only however many packages ran before the first failure and reports that
partial result as green — `WP-0` hit exactly this (the first run covered 27 of ~79 packages before
stopping). Add `--no-bail` to a `test:coverage` run the same way if a WP's done-criteria need it.

Two known concurrency-only flakes — re-run either file alone
(`pnpm --filter <name> run test`) before treating a failure in it as a regression:

- `apps/runtime/src/security/wire-security-provisioning.test.ts` (5s timeout under concurrency,
  789ms in isolation — described in §1).
- `packages/http/src/server.test.ts` ("omits bearerAuth from the OpenAPI security requirement for
  a public route"; 5s timeout under concurrency, 530ms in isolation). Found during `WP-0`'s gate
  measurement, not previously documented here.

## 6. If you get stuck

Append to [`../BLOCKERS.md`](../BLOCKERS.md) in the shape that file already uses (Expected / Found /
Why blocked / Ruling made), tick nothing, and move to the next task. Do not stop the whole WP for
one blocked task, and do not invent a design decision the plan did not make for you.

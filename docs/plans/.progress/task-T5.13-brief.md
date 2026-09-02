# Task T5.13 brief — Live dashboard

This task is different in character from every other Phase 5 task: it is not "wire N routes to a
new screen," it is "convert an existing demo-data page to real data, tile by tile, being honest
about which tiles genuinely can't be converted yet." Read `apps/admin-web/src/data/dashboard.ts`
and `apps/admin-web/src/app/page.tsx` fully before starting — both are already read for you below,
this brief summarizes their current state and the research already done into what's realistically
convertible.

## Current state (confirmed by reading the files)

- `DashboardData` (in `data/dashboard.ts`) has **one `provenance` field for the entire payload**.
  Because `getDashboardData()` always returns `"demo"`, `app/page.tsx`'s single
  `data.provenance === "demo"` branch means **only the demo banner + Recent Orders render today —
  the KPIs/Sales Overview/Top Products/Sales By Channel sections never render at all**, not even
  with demo data, because the whole non-demo branch is gated behind that one check.
- Recent Orders (`RecentOrdersSection`, `@/data/recent-orders`) already reads real data
  independently, in its own `Suspense` boundary, with its own loading/empty/error/unauthorized
  states — outside `DashboardData` entirely. This is the pattern to extend to every other section:
  each section gets its own provenance, not the whole page one flag.

## The core refactor (do this first)

Split `DashboardData`'s single `provenance` into **one provenance per section** —
`kpis`/`sales`/`topProducts`/`channels` each become `{ provenance: DataProvenance; ...data }`
(or four separate exported types/fetchers, your call on the exact shape — the constraint is that
`page.tsx` must be able to render each section independently, live or demo, without one section's
demo status hiding another section's real data). Keep whichever sections stay demo rendering with
the existing demo banner treatment (`t.data.demoExplanation`) **scoped to that section**, not the
whole page. `DashboardHeader`'s single `provenance` prop will need to become either an aggregate
("mixed" state, e.g. "some live, some demo") or be removed in favor of per-section badges — your
call, but never claim the page is fully live when any section still isn't, and never claim it's
fully demo when a section is real.

## What's realistically convertible — research already done, verify before committing to it

**Revenue KPI → `GET /finance/income-statement`** (already wired, `fetchIncomeStatement` in
`lib/api/finance.ts` from T3.2, real accounting-grade figures: revenue/cogs/expenses/netIncome for
a date range). Call it twice — once for the current period, once for the comparison period (the
existing `DashboardPeriod` shape already has both ranges) — to compute `delta`. There is **no
daily-granularity endpoint**, so the KPI's `trend` sparkline cannot be built from real daily
points without N separate income-statement calls (one per day in the period, run in parallel, not
sequential). This is a legitimate but heavier approach — your call whether the trend sparkline is
worth that many calls or should stay a flat/omitted line for the live case; do not fabricate a
shape for it either way.

**Orders count KPI + Sales Overview chart → `GET /orders`** (already wired). **Important limit
found:** `OrdersPageDto`'s `pageInfo` has only `hasNextPage`/`endCursor`, **no total count** — this
app has no way to get an exact order count for a period beyond counting returned items. Two honest
options: (a) fetch a capped page (e.g. `first=100`) and show the exact count with a "100+" /
"showing first 100" qualifier when `hasNextPage` is true (same honesty pattern T5.1's
brand/category picker used for its "unlisted option" fallback), or (b) leave the Orders-count KPI
and the Sales Overview chart on demo data and document why in `docs/plans/BLOCKERS.md` (no
period-scoped, aggregated orders-count/revenue-by-day endpoint exists). Either is acceptable;
choose based on how honest a capped count actually reads to an operator — do not present a capped
count as if it were exact.

**AverageOrderValue KPI**: derivable from Revenue ÷ Orders-count only if both of the above are
live; if either stays demo, this KPI must stay demo too (do not half-compute it from one real and
one fake number).

**ConversionRate KPI**: **no data source exists anywhere in this codebase** (no traffic/analytics
capability) — this KPI must stay demo. Document in `docs/plans/BLOCKERS.md` if not already covered
by an existing gap entry (check for G-8/reporting-related entries first, this may already be
covered).

**Top Products → `GET /products`** (already wired, `fetchProductsPage`). This endpoint returns
catalog data (id/sku/name/slug/status/variantCount/price) — **it has no `unitsSold`, `views`, or
`conversion`**, and there is no sales-ranking endpoint anywhere (same G-8 reporting gap Phase 4
already documented: no populated analytics read store). Converting this tile to genuinely "top
selling products" is not possible with what exists. Do not invent a ranking (e.g. "most recently
updated" is not "top products" and would be misleading under that label). This tile most likely
stays demo — document why in `docs/plans/BLOCKERS.md`, cross-referencing G-8, unless you find a
real capability this research missed.

**Sales By Channel**: no channel-attribution data exists anywhere (Orders/Finance carry no channel
dimension in their DTOs). Stays demo — document why.

## What to build

1. Refactor `data/dashboard.ts`'s types per "The core refactor" above.
2. Wire the Revenue KPI (and AOV/Orders-count if you choose the capped-count approach) to real
   data via `lib/api/finance.ts`/`lib/api/orders.ts` — new fetch/aggregation logic can live in
   `data/dashboard.ts` itself (it's already an async data-resolution module) or a new
   `data/dashboard-live.ts`, your call.
3. Update `app/page.tsx` to render each section based on its own provenance, each with the
   existing demo-explanation treatment scoped to itself when not live.
4. Update `dashboard-header.tsx`/`kpi-card.tsx`/etc. only as needed to support per-section
   provenance — do not do an unrelated visual redesign.
5. For every tile that stays demo, leave `t.data.demoExplanation` (or a per-tile variant of it, if
   you need different wording per section — add dictionary keys as needed in both `en.ts`/`ar.ts`)
   and add/update the `docs/plans/BLOCKERS.md` entries explaining exactly why, per the research
   above, so a future phase with a real reporting backend (G-8/G-39, per `docs/KNOWN_GAPS.md` and
   Phase 4's BLOCKERS.md entries) knows exactly what to wire.
6. **Never flip `provenance` to `"live"` for a section still reading sample data** — this is the
   task's own explicit, load-bearing rule from the plan text.

## Global constraints (every Phase 5 task)

1. `packages/*`/`services/*` never import from `apps/*`.
2. Domain aggregates never go on the wire (not directly relevant here — this task consumes
   existing DTOs, doesn't add routes).
3. Never fabricate data — this task's entire point is enforcing this rule more precisely than the
   current all-or-nothing flag does.
4. Every new/changed user-facing string in both `messages/en.ts` and `messages/ar.ts`.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md` — this task is expected to
   produce several such entries, that's normal, not a failure.
7. Mark this task's checkbox (`- [ ] **T5.13 Live dashboard.**` → `- [x] **T5.13 Live dashboard.**`)
   when done — "done" here means the refactor is complete and every tile's provenance is accurate,
   not that every tile is live.
8. One `Idempotency-Key` per user-initiated submit (not applicable — this task is read-only).
9. Never call the runtime API from browser JS — this page is already a Server Component, keep it
   that way.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

Existing tests (`data/dashboard.test.ts`, `components/dashboard/dashboard.test.tsx`) will need
updating for the new per-section shape — update them, don't delete coverage.

## Report

Write your full report to `docs/plans/.progress/task-T5.13-report.md`, including a clear per-tile
table: which sections are now live, which stayed demo, and why (linking the BLOCKERS.md entries).
Return to the controller only: status, files changed, one-line test summary, concerns.

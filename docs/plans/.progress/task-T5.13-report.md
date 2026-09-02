# T5.13 — Live dashboard: report

## What changed

`apps/admin-web/src/data/dashboard.ts`'s `DashboardData` had **one page-wide `provenance` field**.
Because `getDashboardData()` always returned `"demo"`, `app/page.tsx`'s single
`data.provenance === "demo"` branch meant the KPI row, Sales Overview chart, Top Products table, and
Sales By Channel donut **never rendered at all** — only the demo banner and Recent Orders did.

This task replaced the single flag with **per-section provenance** (`kpis.kpis[].provenance` per
KPI, `sales.provenance`, `topProducts.provenance`, `channels.provenance`), wired the Revenue KPI to
the real `GET /finance/income-statement` endpoint, and updated every dashboard component to render
unconditionally with its own honest "Live"/"Demo" tag and, where still demo, a scoped one-line
explanation of exactly why. `DashboardHeader`'s single badge now shows a page-level summary
(`summarizePageProvenance`: "live" / "demo" / "mixed") folded from all the per-section/per-KPI
flags — a display convenience only, never the source of truth for what actually renders.

**Never flipped a section's provenance to `"live"` while it still reads sample data** — every
`provenance: "live"` in the code is set only after a successful, real fetch (`fetchRevenueKpi` in
`data/dashboard.ts`); every other value is a literal `"demo"`.

## Per-tile table

| Tile | Provenance now | Why |
| --- | --- | --- |
| **Revenue KPI** | **Live** | `GET /finance/income-statement`, called for the current period and the comparison period (in parallel), via the already-wired `fetchIncomeStatement` (T3.2). Value and delta are computed from the real response. Falls back to a truthfully-labelled demo figure on any fetch failure (network error, unauthorized, unexpected shape) — never breaks the KPI row, never mislabels a stale/fake number as live. |
| **Revenue KPI trend (sparkline)** | Empty (`[]`), not fabricated | Finance has no daily-granularity endpoint; building one from 7+ parallel income-statement calls was judged not worth the request fan-out for a decorative sparkline. `Sparkline` renders nothing for fewer than 2 points, so this is an honest "no trend data" state. |
| **Orders-count KPI** | Demo | `GET /orders` has no date-range filter at all (`listOrdersQuery` in `admin-routes.ts`: only `first`/`after`/`status`/`search`) — worse than the brief's own research anticipated (which only flagged the missing total-count field). A period-scoped count (even a capped "first 100" one) cannot be built when the endpoint cannot be scoped to a period in the first place. See BLOCKERS.md T5.13. |
| **Sales Overview chart** | Demo | Same root cause as Orders-count: no endpoint returns orders/revenue aggregated by day or scoped to a date range. |
| **AverageOrderValue KPI** | Demo | Only derivable from Revenue ÷ Orders-count when both are live; since Orders-count is demo, AOV must stay demo too rather than being half-computed from one real and one fake number (the brief's own explicit rule). |
| **ConversionRate KPI** | Demo | No traffic/analytics/session data source exists anywhere in this codebase — the same G-8 reporting-read-model gap `docs/KNOWN_GAPS.md` and Phase 4's BLOCKERS.md (T4.20, T4.3) already documented. |
| **Top Products** | Demo | `GET /products` returns catalog data only (id/sku/name/slug/status/variantCount/price) — no `unitsSold`/`views`/`conversion`, and no sales-ranking endpoint exists anywhere. Same G-8 gap. Ranking by a proxy (e.g. "most recently updated") was considered and rejected as misleading under the "top products" label. |
| **Sales By Channel** | Demo | No Orders or Finance DTO carries a sales-channel dimension anywhere in this codebase — verified by reading every field on `OrderListItemDto`/`OrderDetailDto` and the Finance DTOs. |
| **Recent Orders** | Live (unchanged) | Already real before this task (`GET /orders` via `@/data/recent-orders`), in its own Suspense boundary — untouched by this task except that it now always sits in the same grid position regardless of the rest of the page's provenance. |

Full findings, verification detail, and suggested fixes for each still-demo tile are in
`docs/plans/BLOCKERS.md`'s **T5.13** entry.

## Design decisions

- **Per-KPI provenance inside the `kpis` section**, not one flag for the whole KPI row: Revenue is
  live while the other three are demo, and a single section-level flag could not honestly represent
  that (it would either falsely claim ConversionRate is live, or hide that Revenue is real).
  `sales`/`topProducts`/`channels` stay single-flag sections since each is one indivisible figure
  with no partially-live sub-parts.
- **`summarizePageProvenance`** (`"live"` only if every KPI/section is live, `"demo"` only if every
  one is demo, `"mixed"` otherwise) is a header-badge convenience only. Every component below the
  header renders from its own real per-section/per-KPI provenance, never from this summary.
- **The trailing period is now computed from the real clock** (`computeTrailingPeriod`, a 7-day
  window ending yesterday, plus the preceding 7-day comparison window) instead of a hardcoded
  2025-05-12..05-18 date range, so the one live figure this page has is always requested for a
  period the operator recognizes as "now." The demo `sales` sample data was relabeled onto this
  same computed period (same relative revenue/order magnitudes, new dates) so the chart's dates
  stay consistent with the header's displayed range.
- **Revenue fetch failure falls back to demo, not an error state.** Unlike Recent Orders (which
  surfaces "sign in" / "couldn't load" states), a KPI card has no established error-state pattern
  and forcing one in for a single tile was judged a larger change than warranted. A failure degrades
  to a truthfully-labelled demo figure instead — still honest, never silently broken.
- **UI additions kept minimal, no redesign:** a small "Live"/"Demo" `Badge` next to each KPI card's
  title (`t.data.liveTag`/`t.data.demoTag`), the same badge plus a one-line scoped explanation in
  the `CardHeader` of Sales Overview/Top Products/Sales By Channel when still demo, and a
  `"mixed"` variant of the existing header badge (`t.data.partialBadge`) plus a new page-banner
  copy (`t.data.partialExplanation`) for the "some tiles live, most still demo" state. The full
  page-wide demo banner (`t.data.demoExplanation`, unchanged wording) is still shown verbatim in the
  genuine "everything is demo" case (e.g. Finance also unreachable).

## Files changed

- `apps/admin-web/src/data/dashboard.ts` — core refactor: per-section/per-KPI `DataProvenance`,
  `summarizePageProvenance`, `computeTrailingPeriod`, `fetchRevenueKpi` (live Finance wiring),
  demo constants restructured.
- `apps/admin-web/src/app/page.tsx` — renders every section unconditionally from its own
  provenance; single demo/mixed banner driven by `summarizePageProvenance`.
- `apps/admin-web/src/components/dashboard/dashboard-header.tsx` — `provenance` prop is now
  `PageProvenance` (`"live" | "demo" | "mixed"`); new "Partially live" badge for `"mixed"`.
- `apps/admin-web/src/components/dashboard/kpi-card.tsx` — per-KPI "Live"/"Demo" tag.
- `apps/admin-web/src/components/dashboard/sales-overview.tsx` — `provenance` prop, demo tag +
  scoped explanation.
- `apps/admin-web/src/components/dashboard/top-products.tsx` — same.
- `apps/admin-web/src/components/dashboard/sales-by-channel.tsx` — same.
- `apps/admin-web/src/messages/en.ts` / `apps/admin-web/src/messages/ar.ts` — new keys:
  `data.partialBadge`, `data.partialExplanation`, `data.demoTag`, `data.liveTag`,
  `sales.demoExplanation`, `topProducts.demoExplanation`, `channels.demoExplanation`.
- `apps/admin-web/src/data/dashboard.test.ts` — rewritten for the new shape; `fetchIncomeStatement`
  mocked (not the network), covering the live-success, fetch-error, and unauthorized paths, plus
  `computeTrailingPeriod` and `summarizePageProvenance`.
- `apps/admin-web/src/components/dashboard/dashboard.test.tsx` — rewritten for the new shape;
  added coverage for the "mixed" header badge, per-KPI live/demo tags, and each section's scoped
  demo explanation.
- `docs/plans/BLOCKERS.md` — new **T5.13** entry (full findings above).
- `docs/plans/PHASE-5-6-backlog.md` — `T5.13` checkbox marked done.

## Verification

```
cd "D:\lumo-platform-main-main\lumo-platform-main-main"
pnpm --filter admin-web typecheck   # clean, no errors
pnpm --filter admin-web lint        # 0 errors, 1 pre-existing warning (next.config.ts, unrelated to this task)
pnpm --filter admin-web test        # 63 files, 592 tests, all passing
```

No Docker/runtime available in this environment (same standing limitation prior BLOCKERS.md entries
document), so this was verified at the code/test level only, not in a running browser. A later
session with the runtime stack available should load `/dashboard` once to confirm the Revenue tile
renders "Live" against a real Finance backend and every other tile renders its "Demo" tag with the
correct scoped explanation.

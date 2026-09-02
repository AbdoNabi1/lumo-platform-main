# Analytics V2 — Investigation and Deferral — Report

**Status:** Intentionally deferred (not partially implemented, not skipped without review). No code
changed in `services/analytics/**` or anywhere else.

---

## 1. Investigation

`services/analytics/src/composition.ts` wires a deliberately minimal composition root: it registers
Finance's canonical semantics (`registerFinanceSemantics`, D-064) into a `SemanticRegistry` and
exposes read-only catalog browsing — `listMetrics`/`getMetric`/`listDimensions`/`getDimension` —
through `AnalyticsConsoleController`. That is the entire wired, production-reachable surface, and
it is already admin-wired (`SPRINT_S1_M10_ANALYTICS_REPORT.md`) and gate-green.

A candidate gap was found and evaluated: `services/analytics/src/infrastructure/
clickhouse-analytics-read-store.ts` implements `AnalyticsReadStore` completely (tenant-scoped,
every table/column identifier validated against an allowlist before being spliced into SQL, every
filter value bound as a query parameter — no injection surface) but is never constructed or wired
anywhere. Superficially this looks like the same "written but orphaned" shape Finance M2 found and
fixed (the Prisma persistence layer). It is not the same situation, for two reasons found directly
in the code, not inferred:

1. `AnalyticsConsoleController`'s own doc comment already records the reasoning for leaving query
   execution unwired: _"Running a real `SemanticEngine` query needs a populated
   `AnalyticsReadStore` (ClickHouse in production); no CDC/projection pipeline feeds one yet in
   this environment... wiring a query-execution endpoint here would either require a new engine
   (out of scope) or would silently return empty results against an unpopulated store — a
   placeholder dressed as a working endpoint."_ This is a recorded, deliberate decision, not an
   omission.
2. `ClickHouseAnalyticsReadStore`'s own doc comment discloses it was "never exercised against a
   live ClickHouse instance this session (offline environment) — written to the described shape,
   not integration-verified." Wiring it now would expose a query-execution endpoint that cannot be
   verified in this environment and, absent any CDC/projection pipeline populating ClickHouse,
   would return empty results in production — exactly the anti-pattern the controller's own comment
   warns against.

No CDC/event-ingestion/projection pipeline capable of feeding `AnalyticsReadStore` exists anywhere
in this repository today (confirmed: no such pipeline is referenced by any composition root, any
`apps/runtime` module, or any doc under `docs/implementation`/`docs/architecture` found during this
investigation). Building one would be new capability — the "Data Platform/CDC" work the
controller's own comment names as a separate, future concern — not a minimal, additive wiring task.

---

## 2. Decision

**Analytics V2 is marked intentionally deferred, by explicit user decision**, on these grounds:

- The ClickHouse query-execution branch is intentionally deferred in the code itself, not an
  oversight.
- It depends on a future CDC/projection pipeline that does not exist yet anywhere in this
  repository.
- There is currently no evidence-backed data pipeline capable of feeding it.
- Wiring it now would mean exposing an endpoint that cannot be integration-verified in this
  environment and would return empty results in production — a placeholder dressed as a working
  endpoint, which the canonical branch must not contain.
- The current Analytics implementation (catalog-only) is considered **complete for this stage** —
  internally consistent, gate-green, and admin-wired.

**Do not revisit Analytics again unless a real event-ingestion/projection pipeline exists** to feed
`AnalyticsReadStore`. When one does, re-investigate from the current code (this report, the
`AnalyticsConsoleController` doc comment, and `ClickHouseAnalyticsReadStore`'s own doc comment) —
not from this report's staleness assumption.

---

## 3. Quality gates

Not applicable — no code changed. The repository's gate state is exactly what it was after Finance
M2 (`ef564d1`): typecheck 76/76, lint 76/76, test 76/76, arch 0 violations/1531 modules.

---

## 4. Next

Runtime Module Framework.

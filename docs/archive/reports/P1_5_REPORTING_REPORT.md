# P1.5 — Runtime Composition Hardening: Reporting

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Reporting slice
**Baseline:** `main` @ `06467e7` (P1.5 Recommendations)
**Pattern reused verbatim from:** `services/catalog/src/composition.ts` (P1.5) — multi-repository shape.

---

## 1. Change

`services/reporting/src/composition.ts` — added a Prisma branch to `wireReporting`.

- `ReportingWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ all 3 Prisma repositories (`PrismaReportDefinitionRepository`/`PrismaDashboardRepository`/`PrismaAnalyticsReportRepository`, all sharing one `PrismaReportingRepositoriesDeps` shape) + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(repos, unitOfWork, deps)`.
- `analytics` (already-optional, defaults to `InMemoryAnalyticsQuery`) stays in-memory in both branches — out of scope for C-01.

**One correction during this milestone:** the 3 repository interfaces are not one-file-per-interface (`ReportDefinitionRepository`/`DashboardRepository`/`AnalyticsReportRepository` all live in one `domain/repositories.ts`, unlike Catalog/Pricing where each has its own file) — first typecheck caught the wrong guessed paths, fixed to the real barrel before re-running gates.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both fields optional; `WiredReporting` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                                |
| ------------ | ---------------- | --------------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76 (first run caught 3 import-path errors, fixed, re-run clean) |
| Lint         | `pnpm lint`      | ✅ 76/76                                                              |
| Test         | `pnpm test`      | ✅ 76/76                                                              |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6604 dependencies)         |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**20 of 39 contexts durable.** Next: Reviews.

# P1.5 — Runtime Composition Hardening: Automation

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Automation slice
**Baseline:** `main` @ `7e9e33e` (P1.5 Notifications)
**Pattern reused verbatim from:** `services/returns/src/composition.ts` (P1.5) — single-repository shape.

---

## 1. Change

`services/automation/src/composition.ts` — added a Prisma branch to `wireAutomation`.

- `AutomationWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaAutomationWorkflowRepository` + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(workflows, unitOfWork, deps)`.
- `dispatcher` (already-optional, defaults to `InMemoryActionDispatcher`) and `processedTriggers` stay in-memory in both branches — reference-only/idempotency concerns, out of scope for C-01.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both new fields optional; `WiredAutomation` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6592 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**17 of 39 contexts durable.** First of the remaining 21 (of 23) unnamed contexts — analytics and
platform-console excluded, no Prisma repository files exist for either (see forthcoming
`RUNTIME_COMPOSITION_BLOCKER_REPORT.md`). Next: Promotions.

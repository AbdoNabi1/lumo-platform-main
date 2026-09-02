# P1.5 — Runtime Composition Hardening: Feature Flags

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Feature Flags slice
**Baseline:** `main` @ `43945f7` (P1.5 Experimentation)
**Pattern reused verbatim from:** `services/promotions/src/composition.ts` (P1.5) — single-repository shape.

---

## 1. Change

`services/feature-flags/src/composition.ts` — added a Prisma branch to `wireFeatureFlags`.

- `FeatureFlagsWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaFeatureFlagRepository` + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(flags, unitOfWork, deps)`.
- `evaluator: AggregateFeatureFlags` (the `@platform/feature-flags` contract implementation other contexts consume) is built from whichever `flags` repository is actually wired, in both branches — not left pointing at the in-memory one.

No change to `apps/admin/src/composition.ts`. (Note: this is `@platform/feature-flags-service`, distinct from the `@platform/feature-flags` contract package it implements — not to be confused with `services/feature-registry`, converted separately as one of the 4 already-durable contexts before P1.5 began.)

## 2. Public contract impact

**None.** Both fields optional; `WiredFeatureFlags` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6652 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**32 of 39 contexts durable.** Next: Pages.

# P1.5 — Runtime Composition Hardening: Components

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Components slice
**Baseline:** `main` @ `d9e03d5` (P1.5 SEO)
**Pattern reused verbatim from:** `services/promotions/src/composition.ts` (P1.5) — single-repository shape, no outbound ports.

---

## 1. Change

`services/components/src/composition.ts` — added a Prisma branch to `wireComponents`.

- `ComponentsWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaComponentDefinitionRepository` (from `infrastructure/prisma-repositories.ts`) + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(definitions, unitOfWork, deps)`.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both fields optional; `WiredComponents` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6636 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**28 of 39 contexts durable.** Next: Theme.

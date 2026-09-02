# P1.5 — Runtime Composition Hardening: Experience

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Experience slice
**Baseline:** `main` @ `c417a6c` (P1.5 Theme)
**Pattern reused verbatim from:** `services/promotions/src/composition.ts` (P1.5) — single-repository shape, no outbound ports.

---

## 1. Change

`services/experience/src/composition.ts` — added a Prisma branch to `wireExperience`.

- `ExperienceWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaExperienceRepository` + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(experiences, unitOfWork, deps)`.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both fields optional; `WiredExperience` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6644 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**30 of 39 contexts durable.** Next: Experimentation.

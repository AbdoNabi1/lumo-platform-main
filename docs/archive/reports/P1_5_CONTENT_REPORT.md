# P1.5 — Runtime Composition Hardening: Content

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Content slice
**Baseline:** `main` @ `01ee814` (P1.5 Search)
**Pattern reused verbatim from:** `services/promotions/src/composition.ts` (P1.5) — single-repository shape, no outbound ports.

---

## 1. Change

`services/content/src/composition.ts` — added a Prisma branch to `wireContent`.

- `ContentWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaContentBlockRepository` (from `infrastructure/prisma-repositories.ts`) + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(blocks, unitOfWork, deps)`.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both fields optional; `WiredContent` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6616 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**23 of 39 contexts durable.** Next: Coupons.

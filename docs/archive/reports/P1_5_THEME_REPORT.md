# P1.5 — Runtime Composition Hardening: Theme

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Theme slice
**Baseline:** `main` @ `fb002bb` (P1.5 Components)
**Pattern reused verbatim from:** `services/promotions/src/composition.ts` (P1.5) — single-repository shape with an already-optional cross-context port.

---

## 1. Change

`services/theme/src/composition.ts` — added a Prisma branch to `wireTheme`.

- `ThemeWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaThemeRepository` + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(themes, unitOfWork, deps)`.
- `presets` (already-optional, defaults to `InMemoryDesignPresetProvider`) stays in-memory in both branches — out of scope for C-01.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both new fields optional; `WiredTheme` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6640 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**29 of 39 contexts durable.** Next: Experience.

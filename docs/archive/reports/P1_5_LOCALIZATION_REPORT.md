# P1.5 — Runtime Composition Hardening: Localization

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Localization slice
**Baseline:** `main` @ `e198004` (P1.5 Coupons)
**Pattern reused verbatim from:** `services/inventory/src/composition.ts` (P1.5) — 2-repository shape sharing one Prisma deps type.

---

## 1. Change

`services/localization/src/composition.ts` — added a Prisma branch to `wireLocalization`.

- `LocalizationWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaLocaleRepository` + `PrismaTranslationSetRepository` (sharing one `PrismaLocalizationRepositoriesDeps` shape) + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(repos, unitOfWork, deps)`.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both fields optional; `WiredLocalization` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6624 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**25 of 39 contexts durable.** Next: Loyalty.

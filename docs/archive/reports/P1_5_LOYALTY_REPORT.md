# P1.5 — Runtime Composition Hardening: Loyalty

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Loyalty slice
**Baseline:** `main` @ `0ccc5b3` (P1.5 Localization)
**Pattern reused verbatim from:** `services/promotions/src/composition.ts` (P1.5) — single-repository shape.

---

## 1. Change

`services/loyalty/src/composition.ts` — added a Prisma branch to `wireLoyalty`.

- `LoyaltyWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaLoyaltyAccountRepository` + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(accounts, unitOfWork, tiers, deps)`.
- **One real difference from the standard shape, preserved not flattened:** `PrismaLoyaltyAccountRepositoryDeps` takes a `tiers` field the other Prisma repos don't have (the reward-tier ladder — composition-root config, not a persisted column). `tiers` is resolved once (`deps.tiers ?? DEFAULT_TIERS`) before branching so both the Prisma repo and the use-case wiring receive the same ladder.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both new fields optional; `WiredLoyalty` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6628 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**26 of 39 contexts durable.** Next: SEO.

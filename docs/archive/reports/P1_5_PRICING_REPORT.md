# P1.5 — Runtime Composition Hardening: Pricing

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Pricing slice
**Baseline:** `main` @ `0276087` (P1.5 Catalog)
**Pattern reused verbatim from:** `services/catalog/src/composition.ts` (P1.5) — same multi-repository shape.

---

## 1. Change

`services/pricing/src/composition.ts` — added a Prisma branch to `wirePricing`.

- `PricingWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ all 4 Prisma repositories: `PrismaPriceRepository` + `PrismaPriceListRepository` (from `prisma-pricing-repositories.ts`, sharing `PrismaPricingRepositoryDeps`) and `PrismaTaxClassRepository` + `PrismaPricingRuleRepository` (from `prisma-pricing-registry-repositories.ts`, sharing `PrismaPricingRegistryRepositoryDeps` — a distinct-but-identically-shaped deps type) + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildControllers(repos, unitOfWork, deps)` (all 3 controllers) so the use-case wiring is written once.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both fields optional; `WiredPricing` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6566 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**11 of 39 contexts durable.** Next: Identity.

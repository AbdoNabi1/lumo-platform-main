# P1.5 — Runtime Composition Hardening: Coupons

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Coupons slice
**Baseline:** `main` @ `45c0bc5` (P1.5 Content)
**Pattern reused verbatim from:** `services/reviews/src/composition.ts` (P1.5) — single-repository shape with an already-optional cross-context port.

---

## 1. Change

`services/coupons/src/composition.ts` — added a Prisma branch to `wireCoupons`.

- `CouponsWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaCouponRepository` + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(coupons, unitOfWork, deps)`.
- `promotions` (already-optional, defaults to `InMemoryPromotionsPort`) stays in-memory in both branches — out of scope for C-01.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both new fields optional; `WiredCoupons` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6620 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**24 of 39 contexts durable.** Next: Localization.

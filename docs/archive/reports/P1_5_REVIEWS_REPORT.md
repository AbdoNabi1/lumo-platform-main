# P1.5 — Runtime Composition Hardening: Reviews

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Reviews slice
**Baseline:** `main` @ `6d21d8a` (P1.5 Reporting)
**Pattern reused verbatim from:** `services/promotions/src/composition.ts` (P1.5) — single-repository shape with an already-optional cross-context port.

---

## 1. Change

`services/reviews/src/composition.ts` — added a Prisma branch to `wireReviews`.

- `ReviewsWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaReviewRepository` + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(reviews, unitOfWork, deps)`.
- `orders` (already-optional, defaults to `InMemoryOrdersPort`) and `processedModerations` stay in-memory in both branches — out of scope for C-01.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both new fields optional; `WiredReviews` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6608 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**21 of 39 contexts durable.** Next: Search.

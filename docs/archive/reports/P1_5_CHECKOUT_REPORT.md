# P1.5 — Runtime Composition Hardening: Checkout

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Checkout slice
**Baseline:** `main` @ `42fe4ba` (P1.5 Cart)
**Pattern reused verbatim from:** `services/orders/src/composition.ts` (P1.5).

---

## 1. Change

`services/checkout/src/composition.ts` — added a Prisma branch to `wireCheckout`.

- `CheckoutWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaCheckoutSessionRepository` + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(sessions, unitOfWork, deps)`.
- The 5 orchestration ports (`InMemoryPricingValidationAdapter`/`InMemoryInventoryValidationAdapter`/`InMemoryTaxCalculationAdapter`/`InMemoryShippingCalculationAdapter`/`InMemoryPromotionValidationAdapter`) stay in-memory in both branches — reference-only stubs, out of scope for C-01.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both fields optional; `WiredCheckout` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6551 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**9 of 39 contexts durable.** Next: Catalog.

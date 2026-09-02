# P1.5 — Runtime Composition Hardening: Cart

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Cart slice
**Baseline:** `main` @ `6bce5fc` (P1.5 Inventory)
**Pattern reused verbatim from:** `services/orders/src/composition.ts` (P1.5).

---

## 1. Change

`services/cart/src/composition.ts` — added a Prisma branch to `wireCart`.

- `CartWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaCartRepository` + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(carts, unitOfWork, deps)` so the 13-use-case wiring is written once.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both fields optional; `WiredCart` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6547 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**8 of 39 contexts durable.** Next: Checkout.

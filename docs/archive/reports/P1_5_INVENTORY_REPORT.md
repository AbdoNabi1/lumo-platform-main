# P1.5 — Runtime Composition Hardening: Inventory

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Inventory slice
**Baseline:** `main` @ `18df8fc` (P1.5 Payments)
**Pattern reused verbatim from:** `services/orders/src/composition.ts` (P1.5).

---

## 1. Change

`services/inventory/src/composition.ts` — added a Prisma branch to `wireInventory`.

- `InventoryWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaInventoryItemRepository` + `PrismaWarehouseRepository` (both sharing one
  Prisma-backed `OutboxWriter`) + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildControllers(items, warehouses, unitOfWork, deps)` so the two-controller use-case wiring is written once, shared by both branches.
- Two repositories converted together (not two separate milestones) because they already share a single `wireInventory` call, a single outbox, and both are named in the same C-01 entry — splitting would invent an intermediate composition state that never existed.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both fields optional; `WiredInventory` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6543 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**7 of 39 contexts durable.** Next: Cart.

# P1.5 — Runtime Composition Hardening: Orders

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Orders slice
**Baseline:** `main` @ `65e767d`
**Pattern reused verbatim from:** `services/finance/src/composition.ts` (the `prisma?`/`tenantId?`-presence composition branch already proven by Finance/Security/Customer-360/Feature-Registry)

---

## 1. Change

`services/orders/src/composition.ts` — added a Prisma branch to `wireOrders`. No new abstraction: same shape as the existing Finance/Security pattern.

- `OrdersWiringDeps` gained two **additive optional** fields: `prisma?: Database`, `tenantId?: string`.
- When `deps.prisma` is present: constructs `PrismaOrderRepository` (already existed, exported, previously zero construction sites outside its own barrel/tests) + `PrismaUnitOfWork(deps.prisma)` + an `OutboxWriter` backed by `PrismaOutboxStore` instead of `InMemoryOutboxStore`. `drainOutbox`/`deliveredEventTypes` return the same no-op shape Finance uses for its Prisma branch (Prisma outbox rows are drained by CDC, not the in-process relay).
- When absent: byte-identical in-memory behaviour to before — extracted the use-case wiring into a shared `buildController(orders, unitOfWork, deps)` helper so it isn't duplicated between branches (same technique as Finance's `buildController`).
- The 4 outbound ports (`InMemoryPaymentAdapter`/`InMemoryInventoryAdapter`/`InMemoryShippingAdapter`/`InMemoryNotificationAdapter`) and `paymentVerification` stay untouched in both branches — out of scope for C-01 (persistence only), same exclusion Finance made for `security`/`forecast`/`readModels`.

No change to `apps/admin/src/composition.ts` — `AdminWiringDeps` already carries `prisma?`/`tenantId?` and passes `deps` straight through to every `wireX(deps)` call (confirmed by reading the file: `orders = wireOrders(deps)`), so threading is automatic.

## 2. Public contract impact

**None.** Both new fields are optional; `WiredOrders`'s shape is unchanged; every existing caller (tests, `apps/admin`) that omits `prisma`/`tenantId` compiles and behaves identically.

## 3. Gates

| Gate         | Command          | Result                                                                                    |
| ------------ | ---------------- | ----------------------------------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                                                  |
| Lint         | `pnpm lint`      | ✅ 76/76                                                                                  |
| Test         | `pnpm test`      | ✅ 76/76 (orders: 6 passed, 1 skipped — pre-existing integration test gated on a live DB) |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6533 dependencies)                             |

## 4. Not done (deliberately out of scope)

- The C-01 Step-1 boot-time `assertDurablePersistence` guardrail — not requested by this milestone's brief (composition swap only); `DURABLE_CONTEXTS` does not exist yet anywhere in this repo.
- Actually running `PrismaOrderRepository` against a live database — no DB host reachable (G-41), same constraint recorded by P1.4.

## 5. State after this milestone

Orders now has a real Prisma composition branch, matching Finance/Security/Customer-360/Feature-Registry. **5 of 39 contexts durable.** Next: Payments.

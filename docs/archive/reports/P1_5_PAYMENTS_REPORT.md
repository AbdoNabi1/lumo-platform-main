# P1.5 — Runtime Composition Hardening: Payments

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Payments slice
**Baseline:** `main` @ `75b6478` (P1.5 Orders)
**Pattern reused verbatim from:** `services/orders/src/composition.ts` (P1.5), itself matching Finance/Security.

---

## 1. Change

`services/payments/src/composition.ts` — added a Prisma branch to `wirePayments`.

- `PaymentsWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaPaymentIntentRepository` + `PrismaUnitOfWork(deps.prisma)` + `OutboxWriter` on `PrismaOutboxStore`; `drainOutbox`/`deliveredEventTypes` return the no-op shape (CDC-drained), same as Orders/Finance.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(intents, unitOfWork, deps)` so the use-case wiring is written once.
- `PaymentProvider`/`ordersPort`/`financePort`/`notifications`/`processedWebhooks` stay in-memory in both branches — reference-only outbound ports and a webhook-idempotency store, not persistence of Payments' own aggregate; out of scope for C-01 (same exclusion class as Orders' outbound ports).

No change to `apps/admin/src/composition.ts` — `deps` already threads through.

## 2. Public contract impact

**None.** Both fields optional; `WiredPayments` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6537 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as P1.5 Orders: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**6 of 39 contexts durable.** Next: Inventory.

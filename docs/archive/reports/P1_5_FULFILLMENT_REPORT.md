# P1.5 — Runtime Composition Hardening: Fulfillment

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Fulfillment slice
**Baseline:** `main` @ `043a8b6` (P1.5 Shipping)
**Pattern reused verbatim from:** `services/shipping/src/composition.ts` (P1.5) — single-repository shape.

---

## 1. Change

`services/fulfillment/src/composition.ts` — added a Prisma branch to `wireFulfillment`.

- `FulfillmentWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaFulfillmentOrderRepository` + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(fulfillmentOrders, unitOfWork, deps)`.
- `ordersPort`/`inventoryPort`/`shippingProvider`/`notifications`/`processedCarrierWebhooks` stay in-memory in both branches — reference-only outbound ports, out of scope for C-01.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both fields optional; `WiredFulfillment` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6580 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**14 of 39 contexts durable.** Next: Returns.

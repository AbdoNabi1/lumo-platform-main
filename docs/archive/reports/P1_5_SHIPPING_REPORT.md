# P1.5 — Runtime Composition Hardening: Shipping

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Shipping slice
**Baseline:** `main` @ `7cca22e` (P1.5 Identity)
**Pattern reused verbatim from:** `services/orders/src/composition.ts` (P1.5) — single-repository shape.

---

## 1. Change

`services/shipping/src/composition.ts` — added a Prisma branch to `wireShipping`.

- `ShippingWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaShipmentRepository` + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(shipments, unitOfWork, deps)`.
- `carrierProvider`/`fulfillmentPort`/`notifications`/`processedCarrierWebhooks` stay in-memory in both branches — reference-only outbound ports, out of scope for C-01.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both fields optional; `WiredShipping` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6576 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**13 of 39 contexts durable.** Next: Fulfillment.

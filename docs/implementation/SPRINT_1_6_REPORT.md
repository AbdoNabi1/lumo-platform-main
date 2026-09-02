# Sprint 1.6 — Admin Wiring (final Phase-1 sprint) — Implementation Report

> **Date:** 2026-06-30 · **Status:** ✅ COMPLETE (all gates green) · **Phase 1 — COMPLETE.**
> Not committed/pushed (per instructions).

## 1. Summary

Wired the **frozen** Phase-1 admin screens to their owning bounded contexts via a new **app** package,
**`@platform/admin`** at `apps/admin`. It is a framework-agnostic composition/BFF layer (no HTTP
server, no framework) whose **facade controllers delegate** to each context's existing public
controller and return its `ControllerResponse` unchanged. **No business behaviour, no UI, and no
existing source was changed** — purely additive wiring. This is the last Phase-1 sprint; **Phase 1 is
now complete** (9 business contexts + admin wiring).

## 2. Scope (from the docs)

`docs/admin/01-ADMIN_DASHBOARD_SPEC.md` + the roadmap scope Phase-1 admin to six frozen screens →
five contexts:

| Frozen screen(s)    | Facade                     | Owning context        |
| ------------------- | -------------------------- | --------------------- |
| Products            | `ProductsAdminController`  | `@platform/catalog`   |
| Inventory           | `InventoryAdminController` | `@platform/inventory` |
| Orders              | `OrdersAdminController`    | `@platform/orders`    |
| Customers           | `CustomersAdminController` | `@platform/identity`  |
| Discounts + Coupons | `PricingAdminController`   | `@platform/pricing`   |

Each facade exposes only the actions an existing use-case backs. Media/Cart/Checkout/Payments are not
Phase-1 admin screens; the other 19 admin screens are later phases.

## 3. Implemented components

- **`wireAdmin(deps)`** (composition root) — composes the five contexts (shared serializer/id/clock),
  builds the five facades, and exposes `drainOutbox()` / `deliveredEventTypes` aggregated across
  contexts (for demonstration/tests).
- **Five facade controllers** — thin, typed pass-through via `Parameters<Controller["method"]>`; they
  return `AdminResponse` (structurally identical to each context's `ControllerResponse`).
- **`AdminResponse`** — the admin boundary's response type; presentation stays owned by the context
  presenters (never re-mapped).

## 4. Files created (13 + report)

- **Config (4):** `apps/admin/{package.json, tsconfig.json, vitest.config.ts, README.md}`.
- **`src` (3):** `index.ts`, `composition.ts`, `admin.e2e.test.ts`.
- **`src/interfaces` (6):** `admin-response.ts`, `products.admin-controller.ts`,
  `inventory.admin-controller.ts`, `orders.admin-controller.ts`, `customers.admin-controller.ts`,
  `pricing.admin-controller.ts`.
- Plus `docs/implementation/SPRINT_1_6_REPORT.md`.

## 5. Files modified

- Docs only: `PROJECT_STATE.md`, `AI_CONTEXT.md`, `DECISIONS.md` (append D-033),
  `docs/development/WORKSPACE_GUIDE.md`; `pnpm-lock.yaml` (1 new workspace package). **No existing
  source package or service modified.**

## 6. Validation results

| Gate                             | Result                                  |
| -------------------------------- | --------------------------------------- |
| `pnpm install --frozen-lockfile` | ✅ PASS                                 |
| `pnpm lint`                      | ✅ PASS (34 packages)                   |
| `pnpm typecheck`                 | ✅ PASS (34 packages)                   |
| `pnpm test` (serialized)         | ✅ PASS (34 task) — `@platform/admin` 4 |
| `pnpm build`                     | ✅ PASS                                 |
| `pnpm arch`                      | ✅ PASS — 0 violations                  |

The baseline was green before implementation. No fixes were required. `arch` crawls
`packages/`+`services/` (not `apps/`), so the module count is unchanged; the admin app imports only
public `@platform/*` entries and introduces no context↔context coupling.

## 7. Design decisions (see DECISIONS D-033)

- **Placement in `apps/`** — the `no-cross-service-internals` fitness rule forbids a _service_ from
  importing another service; `apps/` is the composition root and is exempt. An app is therefore the
  only arch-legal home for cross-context wiring.
- **Delegation only** — facades add no logic; presentation is delegated to the context presenters
  (single source of truth). Typed via `Parameters<…>` so contexts need not export input types.
- **Only backed actions exposed** — unbacked screen actions (fulfillment, returns, transfers,
  segmentation, dedicated coupon/discount-rule codes) are deferred, not stubbed. Discounts/Coupons map
  to Pricing's existing Price/PriceList surface.
- **No HTTP** — the transport adapter + admin cross-cutting baseline (tracking, audit-on-mutation,
  RBAC/ReBAC, flag gating, bulk-action jobs) are deferred.

## 8. Trade-offs

- Facades are near-passthrough — accepted: their value is the screen→context mapping + the arch-legal
  composition seam, not new logic.
- The wiring is only reachable in-process/tests until a transport adapter is built.
- The Discounts/Coupons screens operate on Pricing's price-list surface until `Coupon`/`DiscountRule`
  aggregates exist.

## 9. Technical debt

- No HTTP/RPC transport for the frozen UI to call these facades.
- Admin cross-cutting baseline (audit/RBAC/flags/tracking/bulk jobs) not implemented.
- `Coupon`/`DiscountRule` aggregates (0.5 design's Pricing shape) not built.

## 10. Deferred work

Transport adapter (HTTP/GraphQL + gRPC); admin baseline (audit `audit.entry.recorded`, Ory/Keto
RBAC/ReBAC, feature-flag gating, Temporal bulk-action jobs); the remaining 19 admin screens; the
storefront + admin React front-ends consuming this wiring.

## 11. Phase 1 completion audit

All nine planned Phase-1 bounded contexts exist and each has the full slice
(domain / application / infrastructure / interfaces + composition + index + README):

| Context   | domain | app | infra | interfaces | composition | index | README | outbox translator | repo port | presenter | controllers | tests |
| --------- | :----: | :-: | :---: | :--------: | :---------: | :---: | :----: | :---------------: | :-------: | :-------: | :---------: | :---: |
| catalog   |   ✅   | ✅  |  ✅   |     ✅     |     ✅      |  ✅   |   ✅   |        ✅         |    ✅     |    ✅     |      2      |   3   |
| media     |   ✅   | ✅  |  ✅   |     ✅     |     ✅      |  ✅   |   ✅   |        ✅         |    ✅     |    ✅     |      1      |   2   |
| pricing   |   ✅   | ✅  |  ✅   |     ✅     |     ✅      |  ✅   |   ✅   |        ✅         |    ✅     |    ✅     |      2      |   3   |
| inventory |   ✅   | ✅  |  ✅   |     ✅     |     ✅      |  ✅   |   ✅   |        ✅         |    ✅     |    ✅     |      1      |   3   |
| cart      |   ✅   | ✅  |  ✅   |     ✅     |     ✅      |  ✅   |   ✅   |        ✅         |    ✅     |    ✅     |      1      |   3   |
| checkout  |   ✅   | ✅  |  ✅   |     ✅     |     ✅      |  ✅   |   ✅   |        ✅         |    ✅     |    ✅     |      1      |   3   |
| orders    |   ✅   | ✅  |  ✅   |     ✅     |     ✅      |  ✅   |   ✅   |        ✅         |    ✅     |    ✅     |      1      |   3   |
| payments  |   ✅   | ✅  |  ✅   |     ✅     |     ✅      |  ✅   |   ✅   |        ✅         |    ✅     |    ✅     |      1      |   3   |
| identity  |   ✅   | ✅  |  ✅   |     ✅     |     ✅      |  ✅   |   ✅   |        ✅         |    ✅     |    ✅     |      1      |   3   |

- **Dependency rules:** `pnpm arch` green (0 violations) — domain purity, no cross-context imports, no
  deep imports, no cycles, correct direction.
- **Outbox:** every context writes its events to the outbox on save + has an `IntegrationEventTranslator`.
- **Repository ports:** one per aggregate, declared in `domain/`.
- **Framework-neutral interfaces:** every context has `present()` + framework-agnostic controllers
  (no HTTP server anywhere).
- **Tests / README / composition:** present for all nine + the admin app.
- **Missing implementation:** none for Phase-1 scope. Known deferrals (infra-dependent) are listed in
  §10 and PROJECT_STATE "Next: Phase 2".

## 12. Git

Not committed/pushed. Working tree adds `apps/admin` + doc updates (on top of the still-uncommitted
Sprints 1.3–1.5). **Recommended Conventional Commit message:**

```
feat(admin): wire frozen phase-1 admin screens to their contexts (Sprint 1.6)
```

## 13. Is Phase 1 officially complete?

**Yes — Phase 1 is functionally complete** (all 9 contexts + admin wiring, all gates green). Before
**Phase 2** may begin, these Phase-1 exit prerequisites (deferred only because there is no Docker
host / real infra here) must be done — see PROJECT_STATE "Next: Phase 2":

1. **Commit + push** the uncommitted Phase-1 work (Sprints 1.3, 1.4, 1.5, 1.6) to `origin/main`.
2. **Real persistence** — Prisma + per-context Postgres (+ Redis, S3/MinIO), outbox in the DB tx.
3. **Broker** — Redpanda + Debezium + Apicurio + a production `EventSerializer`; live-broker tests.
4. **Purchase saga** — Temporal orchestration + gRPC clients (`@platform/api-clients`).
5. **Transport + admin baseline** — HTTP/GraphQL + gRPC; audit/RBAC/flags/tracking/bulk jobs.
6. **Verify Phase-1 exit criteria** end-to-end on real infra (order placed + paid via test PSP,
   atomic stock, immutable order events, refunds, admin 1:1 on real data, contract tests green).

**Sprint 1.6 is complete. Phase 1 is complete. Stopping — not beginning Phase 2.**

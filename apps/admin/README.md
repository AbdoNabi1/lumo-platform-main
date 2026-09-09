# @platform/admin

## Purpose

The **admin application wiring** (Phase 1, Sprint 1.6). It binds the admin screens to
their owning bounded contexts through framework-agnostic **facade controllers** — the operator-facing
application surface. It changes **no** business behaviour: every method delegates to an existing
context controller, which keeps its own domain logic, persistence, and outbox.

> This package is **backend only** — it contains no React and renders nothing. The admin's visual
> surface is `apps/admin-web`, built on the Morbeh Design System
> ([`docs/ui/MORBEH_DESIGN_SYSTEM.md`](../../docs/ui/MORBEH_DESIGN_SYSTEM.md)). Screen behaviour is
> specified in [`docs/admin/01-ADMIN_DASHBOARD_SPEC.md`](../../docs/admin/01-ADMIN_DASHBOARD_SPEC.md).

## Screen → context mapping (Phase-1 scope)

Per the roadmap, Phase-1 admin covers six screens:

| Screen(s)           | Facade                     | Owning context        |
| ------------------- | -------------------------- | --------------------- |
| Products            | `ProductsAdminController`  | `@platform/catalog`   |
| Inventory           | `InventoryAdminController` | `@platform/inventory` |
| Orders              | `OrdersAdminController`    | `@platform/orders`    |
| Customers           | `CustomersAdminController` | `@platform/identity`  |
| Discounts + Coupons | `PricingAdminController`   | `@platform/pricing`   |

Each facade exposes only the actions the context actually supports (e.g. Orders →
place/markPaid/refund). Screen actions with no backing use-case yet — fulfillment, returns, transfers,
segmentation, dedicated coupon/discount-rule codes — are **deferred**, not stubbed.

## Architecture

- **`apps/admin`** is the composition/BFF layer, not a bounded context. It is the one place allowed to
  import several contexts' **public** APIs (`@platform/<context>`) — `apps/` is exempt from the
  `no-cross-service-internals` fitness rule, which forbids contexts importing each other. `pnpm arch`
  stays green.
- **Delegation only:** facades forward typed inputs (`Parameters<Controller["method"]>`) to the
  context controllers and return the context's own `ControllerResponse` (aliased as `AdminResponse`).
  Presentation (status + error envelope) is owned by each context's presenter — never re-mapped here.
- **composition.ts** — `wireAdmin(deps)` composes the five contexts (shared serializer/id/clock) and
  builds the facades; `drainOutbox()` / `deliveredEventTypes` aggregate across contexts (for tests).

## Deferred

An HTTP/RPC transport adapter that lets `apps/admin-web` call these facades (no HTTP server in Phase 1);
tracking/audit-on-mutation, RBAC/ReBAC per screen, feature-flag gating, and bulk-action jobs (admin
cross-cutting baseline — `docs/admin/01` §2/§4); Prisma-backed contexts; the remaining 19 admin
screens (Analytics, Marketing, Experimentation, Settings, …) belonging to later phases.

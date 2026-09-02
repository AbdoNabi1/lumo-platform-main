# Frontend↔Backend Wiring Plan — Execution Guide

> **Audience: the implementing agent.** Read this file completely before opening any phase file.
> Everything you need is written down. Do not ask questions — see "If you get stuck" below.

## Context (what is already true)

This monorepo has a **complete, wired backend** and an **almost empty frontend**.

| Fact                                                     | Value                                          |
| -------------------------------------------------------- | ---------------------------------------------- |
| Backend services in `services/`                           | 40 (all wired into `apps/admin/src/composition.ts`) |
| Route modules in `apps/admin/src/http/`                    | 41 (all registered in `admin-routes.ts`)        |
| Total HTTP endpoints                                       | 371 (67 GET, 301 POST, 2 PUT, 1 DELETE)         |
| Endpoints actually called by a frontend                    | 25                                              |
| Write endpoints called by `apps/admin-web`                 | **0**                                           |
| Domains with **zero** read endpoints                       | 19                                              |

The backend is not broken. The gap is the wiring layer plus a missing read side.

## Architecture you must respect

Requests flow through exactly one pipeline. Do not build a parallel one.

```
apps/runtime/src/api.ts          →  boots the process, runs 5 production guards
  apps/admin/src/http/server.ts  →  createAdminHttpApi(): auth, tenant, rate limit,
                                     zod, idempotency, guard, error mapping
    apps/admin/src/http/admin-routes.ts  →  aggregates all 41 route modules
      apps/admin/src/http/<x>-routes.ts  →  defineRoute({...}) — thin, pure delegation
        apps/admin/src/interfaces/<x>.admin-controller.ts  →  AdminGuard wrapper
          services/<x>/src/interfaces/<x>.controller.ts     →  framework-agnostic
            services/<x>/src/application/<y>.use-case.ts    →  business logic
              services/<x>/src/domain/<z>-repository.ts     →  port
```

Frontends are **separate Next.js apps** that call the runtime API over HTTP:

- `apps/admin-web` — the operator dashboard. Server-side only; a Bearer token or the
  logged-in staff session is forwarded. **Never call the runtime API from browser JS** —
  the API has no CORS configured and the token must not reach the client.
- `apps/storefront` — the public shop. Calls only `public: true` routes, no token.

### Non-negotiable rules

1. **`packages/*` and `services/*` never import from `apps/*`.** Enforced by
   `pnpm arch` (dependency-cruiser). Dependencies are injected structurally.
2. **Domain aggregates never go on the wire.** Every route that returns an entity must
   map it through an explicit, fully-primitive DTO interface. `Entity` exposes `props`,
   `_id`, `_domainEvents` and `_version` at runtime; returning one leaks the domain-event
   stream and the optimistic lock. See the long comment at the top of
   `apps/admin/src/http/public-catalog-routes.ts` for the incident this rule came from.
3. **Never trust a client-supplied price, amount, or rate.** Re-derive it server-side.
   See `apps/admin/src/http/pricing-resolution.ts` and the H-01 / F-01 / Phase-17.2
   comments in `public-cart-routes.ts` and `checkout-routes.ts`.
4. **Never fabricate data in the UI.** If a value cannot be read from the backend, render an
   explicit unavailable state. Existing examples: `apps/admin-web/src/app/marketing/page.tsx`,
   `apps/admin-web/src/data/dashboard.ts` (`provenance: "demo"`).
5. **Every user-facing string goes in both dictionaries.** `apps/admin-web/src/messages/en.ts`
   (the source of truth — `Dictionary` is inferred from it) and `.../ar.ts` (typed
   `const ar: Dictionary`). Adding a key to `en.ts` and not `ar.ts` is a type error.
   The storefront has its own pair under `apps/storefront/src/messages/`.

## Conventions to copy, not invent

| You need to…                    | Copy this exact file                                            |
| ------------------------------- | --------------------------------------------------------------- |
| Add a route                     | `apps/admin/src/http/wishlist-routes.ts` (smallest complete one) |
| Add a public route              | `apps/admin/src/http/public-cart-routes.ts`                      |
| Add a read use case             | `services/catalog/src/application/get-product.use-case.ts`       |
| Map an entity to a DTO          | `apps/admin/src/http/public-catalog-routes.ts` (`toProductDto`)  |
| Fetch from admin-web            | `apps/admin-web/src/lib/api/orders.ts`                           |
| Mutate from a Next.js app       | `apps/storefront/src/app/cart/actions.ts`                        |
| Build a list page               | `apps/admin-web/src/app/orders/page.tsx`                         |
| Build a detail page             | `apps/admin-web/src/app/orders/[orderId]/page.tsx`               |
| Build an unavailable state      | `apps/admin-web/src/app/marketing/page.tsx`                      |

## Phases — execute in order

Each phase depends on the one before it. Do not start a later phase early: the screens in
Phase 3 have no data source until Phase 1 exists, and the Phase 5 screens have no data
source until Phase 4 exists.

| File                                                                 | What                                            | Depends on |
| -------------------------------------------------------------------- | ----------------------------------------------- | ---------- |
| [`PHASE-0-quick-fixes.md`](PHASE-0-quick-fixes.md)                     | Dead links, catalog by-slug, draft-price leak    | —          |
| [`PHASE-1-admin-write-layer.md`](PHASE-1-admin-write-layer.md)         | The mutation client + first proven write screen  | Phase 0    |
| [`PHASE-2-public-checkout.md`](PHASE-2-public-checkout.md)             | Public checkout routes + storefront checkout     | Phase 0    |
| [`PHASE-3-readonly-screens.md`](PHASE-3-readonly-screens.md)           | Screens over the 47 unused GET endpoints         | Phase 1    |
| [`PHASE-4-read-side-backend.md`](PHASE-4-read-side-backend.md)         | List/get endpoints for the 19 blocked domains    | Phase 1    |
| [`PHASE-5-6-backlog.md`](PHASE-5-6-backlog.md)                         | Remaining admin + storefront screens, hardening  | Phase 4    |

## Before you start — one-time setup

Dependencies are **not installed** in this working copy. Nothing builds until you do this.

```bash
corepack enable && pnpm install
```

Then confirm the baseline is green **before changing anything**:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

If the baseline is already red, record exactly what fails in `docs/plans/BLOCKERS.md`
(create it) and continue anyway — do not try to fix pre-existing failures as part of a task
unless a task says so.

## Verification — run after every task

Always scope to the package you touched; the full turbo run is slow.

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

Package names for `--filter`:

| Path                  | Name               |
| --------------------- | ------------------ |
| `apps/admin-web`      | `admin-web`        |
| `apps/storefront`     | `storefront`       |
| `apps/admin`          | `@platform/admin`  |
| `apps/runtime`        | `@platform/runtime`|
| `apps/e2e`            | `@platform/e2e`    |
| `services/<name>`     | `@platform/<name>` |
| `packages/<name>`     | `@platform/<name>` |

Two exceptions to the `services/<name>` rule, because the package name differs from the folder:

- `services/feature-flags` → `@platform/feature-flags-service`
- `services/media` → `@platform/media`

When you touch a `services/*` or `packages/*` file, also run:

```bash
pnpm arch
```

## Rules of engagement

- **Do not ask questions.** Every decision this plan needs is already made below. If a task
  turns out to be genuinely impossible, write what you found and why into
  `docs/plans/BLOCKERS.md`, skip that task, and continue to the next one.
- **Do not run `git` commands.** This working copy is not an initialised git repository.
- **Do not reformat files you are not changing.** `prettier` runs via lint-staged; leave it.
- **Do not delete or rewrite the existing doc comments.** They record real security
  incidents and design decisions. Add to them; do not replace them.
- **Do not change `.env.example`, Docker, CI, or infrastructure files** unless a task
  explicitly says to.
- **Write a test for every new use case and every new route.** Co-located `*.test.ts`,
  vitest, matching the neighbouring test file's style.
- **Mark each task done** by ticking its checkbox in the phase file as you complete it.

## If you get stuck

Append to `docs/plans/BLOCKERS.md` in this shape, then move on:

```markdown
## <TASK-ID> — <one-line summary>

**Expected:** what the plan said to do.
**Found:** what the code actually contains (with file:line).
**Why blocked:** the specific mismatch.
**Suggested fix:** what you would do with one decision from a human.
```

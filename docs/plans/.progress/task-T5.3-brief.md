# Task T5.3 brief — Returns screen

Same write-screen recipe as T5.1/T5.2 (`apps/admin-web/README.md`). Route → typed `lib/api/`
function via `mutateAdminApi` → `"use server"` action → `"use client"` form → both dictionaries →
`middleware.ts`.

## Ruling already made — read before you start (do not re-derive this)

The plan text says "give returns their own list and detail screens." The backend
(`services/returns/src/interfaces/returns.controller.ts`) has **no list-all-returns capability**
and **no `GET /returns/:returnId`** — the only read route is `GET /orders/:orderId/return`
(`returns-routes.ts`, already wired as `fetchReturnByOrder` in `lib/api/returns.ts`, used
read-only today by `OrderReturnsCard`). Building a "Returns list" screen would require fabricating
data or inventing a backend endpoint, both against `docs/plans/README.md` rule 4 ("never fabricate
data") and outside a frontend-only task's scope.

**Ruling:** build the **detail** screen only, keyed by `orderId` (the only key the backend
supports): `apps/admin-web/src/app/orders/[orderId]/returns/page.tsx`. Do not build a `/returns`
list screen. Add one line to `docs/plans/BLOCKERS.md` (in the shape at the bottom of
docs/plans/README.md) recording that a returns list screen needs a new `GET /returns` (list,
paginated, filterable by status) backend endpoint that does not exist yet, and that direct
by-id access would additionally need `GET /returns/:returnId`. This is a documentation task, not
a backend-build task — do not add the backend endpoint yourself.

## Routes — all in `apps/admin/src/http/returns-routes.ts` (already read in full for you below)

| Route | Method | Permission | Idempotent | Body (zod, verbatim) |
| --- | --- | --- | --- | --- |
| `/returns` (create) | POST | `returns:create` | yes | `{ orderRef: string.min(1), items: Array<{ orderItemRef, productRef, quantity: int().positive(), reasonCode, reasonNote?: string.min(1) }>.min(1) }` |
| `/returns/:returnId/decision` | POST | `returns:decision` | yes | `{ approved: boolean, note?: string.min(1) }` |
| `/returns/:returnId/rma` | POST | `returns:rma` | yes | `{ rmaNumber: string.min(1) }` |
| `/returns/:returnId/receive` | POST | `returns:receive` | **no** | `{ source: string.min(1), callbackId: string.min(1) }` |
| `/returns/:returnId/inspection` | POST | `returns:inspection` | **no** | `{ itemRef: string.min(1), passed: boolean, note?: string.min(1) }` — one call per item |
| `/returns/:returnId/accept` | POST | `returns:accept` | yes | `{ items: Array<{ orderItemRef, disposition: string.min(1) }>.min(1) }` |
| `/returns/:returnId/transitions` (advance) | POST | `returns:advance` | yes | `{ toStatus: string.min(1) }` |
| `/returns/:returnId/resolution` | POST | `returns:resolution` | yes | `{ outcome: "refund"\|"replacement"\|"repair", amountMinor?: int().positive(), currency?: length(3) }` |

`returnIdParams = { returnId: string.min(1) }` for all `:returnId` routes.

## Return lifecycle transition table — gate the "advance" control

Copy verbatim as a UI-only constant (do not import `services/returns` from `apps/*`), same
technique as T5.2's order-lifecycle table — comment it as a hand-kept copy of
`services/returns/src/domain/value-objects/return-status.ts`'s `TRANSITIONS`:

```
requested: [approved, rejected]
approved: [rma_generated]
rejected: [closed]
rma_generated: [package_received]
package_received: [inspection_completed]
inspection_completed: [items_accepted, items_rejected]
items_accepted: [refund_requested, replacement_requested, repair_requested]
items_rejected: [closed]
refund_requested: [closed]
replacement_requested: [closed]
repair_requested: [closed]
closed: []
```

Use it to gate which of `decision` / `rma` / `receive` / `inspection` / `accept` / `resolution` /
the generic "advance" dropdown are offered for the current status — most of these routes already
imply a specific transition (e.g. `decision` only makes sense at `requested`, `rma` only at
`approved`), so prefer showing exactly the one relevant action for the current status over a
generic dropdown; use the raw "advance" dropdown only as a fallback for any transition not covered
by a dedicated action (there is none uncovered per the table above — every edge has a dedicated
route except possibly none; if you find one, use the generic transitions route for it).

## What to build

1. `apps/admin-web/src/lib/api/returns.ts` (existing file) — add mutate functions for all 8 routes
   above, next to the existing `fetchReturnByOrder`.
2. `apps/admin-web/src/app/orders/[orderId]/returns/page.tsx` (new) — full detail screen: reuse the
   read rendering from `OrderReturnsCard` (or factor its display logic into a shared component both
   this page and the card use — your call, keep it simple) plus every write action gated by the
   status table above. Also include the **create** action here: if `fetchReturnByOrder` returns
   `not_found`, show the "open a return request" form (`orderRef` is the page's own `orderId` param;
   items must be picked from the order's actual line items — fetch the order via the existing
   `fetchOrder` from `lib/api/orders.ts` to populate the item picker, do not let the operator
   free-type `orderItemRef`/`productRef`).
3. `apps/admin-web/src/components/orders/order-returns-card.tsx` (existing) — add a "Manage return"
   / "Open a return" link to the new page (both cases: whether a return already exists or not).
   Keep the card's own read-only rendering intact (it is also used read-only in this exact spot per
   T3.x's Order Detail work — do not break it).
4. `middleware.ts` — verify `/orders` already covers `/orders/[orderId]/returns` by prefix; if not,
   add the appropriate entry (same role as the parent `/orders` write actions — check what T5.2
   used, likely `operator`).

## Global constraints (apply to every Phase 5 admin task)

1. `packages/*` and `services/*` never import from `apps/*`; this task must not import
   `services/returns` either — copy the transition table as data.
2. Domain aggregates never go on the wire — `ReturnDetailDto` in `lib/api/returns.ts` is already
   correctly hand-typed; keep any new response types the same way.
3. Never fabricate data in the UI — explicit unavailable/empty/error states only; the "no list
   screen" ruling above is exactly this rule applied to a whole screen, not just a field.
4. Every user-facing string goes in both `messages/en.ts` and `messages/ar.ts`.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Mark this task's checkbox (`- [ ] **T5.3 Returns screen.**` → `- [x] **T5.3 Returns screen.**`)
   in `docs/plans/PHASE-5-6-backlog.md` when done, and also add the BLOCKERS.md entry from the
   ruling section above — both are required for this task to count as complete.
8. One `Idempotency-Key` per user-initiated submit, minted once in the action, for every route
   regardless of its own `idempotent` flag (match `mutateAdminApi`'s existing behavior, do not
   change it).
9. Never call the runtime API from browser JS.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

## Report

Write your full report to `docs/plans/.progress/task-T5.3-report.md`. Return to the controller
only: status (DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED), files changed, a one-line test
summary (pass count), and any concerns.

# Task T5.3 report — Returns screen

## Status: DONE

## What was built

Per the brief's own ruling (already resolved, not re-derived): the backend has no
`GET /returns` (list) and no `GET /returns/:returnId` (by id) — only
`GET /orders/:orderId/return`. Building a list or by-id screen would fabricate data or require a
new backend endpoint, both against the repo-wide rules. Built the **detail** screen only, keyed by
`orderId`, at `apps/admin-web/src/app/orders/[orderId]/returns/page.tsx`.

### 1. `apps/admin-web/src/lib/api/returns.ts` (edited)

Added typed mutate functions for all 8 write routes in `returns-routes.ts`, next to the existing
`fetchReturnByOrder`: `createReturn`, `decideReturn`, `generateReturnRma`, `receiveReturnPackage`,
`recordReturnInspection`, `acceptReturnItems`, `advanceReturn`, `resolveReturn`. None of the 8
routes' handlers map their response through a DTO (`returns-routes.ts` — only `getByOrder` calls
`toReturnDetailDto`), so every one of these follows `orders.ts`'s established `isUnknown` pattern:
type nothing off the response, `revalidatePath` the returns screen afterward to re-fetch the real,
DTO-mapped state via `fetchReturnByOrder`.

### 2. `apps/admin-web/src/lib/return-lifecycle.ts` (new)

Hand-kept UI-only copy of `services/returns/src/domain/value-objects/return-status.ts`'s
`TRANSITIONS` table (`RETURN_LIFECYCLE_TRANSITIONS`), plus `hasDedicatedActionFrom`/
`advanceableReturnStatusesFrom` helpers — same technique as T5.2's `lib/order-lifecycle.ts`. Every
edge in the table has a dedicated write route except five statuses (`rejected`, `items_rejected`,
`refund_requested`, `replacement_requested`, `repair_requested`), which only ever advance to
`closed` via the generic `POST /returns/:returnId/transitions` route — confirmed by reading every
route's `summary` in `returns-routes.ts` and mapping each to the one status it implies.

### 3. `apps/admin-web/src/app/orders/[orderId]/returns/page.tsx` (new) + `actions.ts` (new)

The full detail screen. Fetches the order (`fetchOrder`, for header + real line items) and the
return (`fetchReturnByOrder`). Three states:
- **`ok`** — read summary (`ReturnSummary`, factored out of `OrderReturnsCard`) +
  `ReturnLifecycleActions`, gated by current status: exactly one dedicated action per status
  (decision at `requested`, rma at `approved`, receive at `rma_generated`, inspection — one form
  per item — at `package_received`, accept at `inspection_completed`, resolution at
  `items_accepted`), falling back to the generic "advance to…" dropdown only for the five
  no-dedicated-action statuses above.
- **`not_found`** — `ReturnCreateForm`: one row per the order's real line items, a checkbox to
  include it, quantity/reasonCode/reasonNote inputs. The operator never free-types
  `orderItemRef`/`productRef` — both come from the order's own `fetchOrder` data, read back by
  `actions.ts` keyed on the item's real id, not by array position.
- **`unauthorized`/`error`** — explicit `t.orderDetail.returnsUnavailable` message, no fabrication.

`actions.ts` lives in this route's own segment (not `app/orders/actions.ts`, which is T5.2's file
and was left untouched) — 8 actions, one per write route plus `createReturnAction`, each parsing
`FormData` defensively, minting one `Idempotency-Key` per submit via `newIdempotencyKey()`
(including for the two `idempotent: false` routes, `receive`/`inspection`, matching
`mutateAdminApi`'s existing always-send behavior), and projecting non-`ok` outcomes through
`toFormState`.

### 4. `apps/admin-web/src/components/orders/return-create-form.tsx` (new) and `return-lifecycle-actions.tsx` (new)

Client components implementing the two forms above. `ReturnLifecycleActions` renders one dedicated
mini-form per status (`DecisionForm`, `RmaForm`, `ReceiveForm`, `InspectionForm` × N items,
`AcceptForm`, `ResolutionForm`) or `AdvanceForm` as the fallback, returning `null` entirely at the
terminal `closed` status.

### 5. `apps/admin-web/src/components/orders/order-returns-card.tsx` (edited)

Factored the read-only rendering into an exported `ReturnSummary` component, reused by both the
card and the new page. Added a "Manage return" / "Open a return" link to
`/orders/:orderId/returns` in the `ok` and `not_found` outcomes (per the brief, "both cases"). The
card's own read-only body and its `not_found`/`error` states are otherwise unchanged.

### 6. `middleware.ts` — no change needed

Verified: `/orders` (viewer) already covers `/orders/[orderId]/returns` by prefix
(`pathname.startsWith("/orders/")`) — there is no more specific entry to shadow it, and none of
`ROUTE_ROLE_REQUIREMENTS`' existing entries for `/orders/new`/`/orders/from-checkout` apply here
since those are literal sibling segments, not a prefix of a dynamic `orderId` segment (a fixed
prefix cannot target "any orderId, then `/returns`" without also covering the rest of `/orders`).
This mirrors T5.2's own precedent: the order detail page's inline lifecycle actions
(refund/advance/mark-paid/etc.) are likewise not middleware-gated above `viewer` — the actual
write authorization boundary is the backend's own per-route `permission` check
(`returns:create`/`returns:decision`/etc. via `AdminGuard`), which a `viewer`-role JWT will not
carry regardless of which page the request came from; a `viewer` who reaches this page can view it
but any submit attempt still comes back `forbidden` from the API, handled by the normal
`toFormState` error path.

### 7. Both dictionaries (`messages/en.ts`, `messages/ar.ts`)

Added `returnScreen`, `returnCreateForm`, `returnLifecycle` sections, plus `orderDetail.manageReturn`/
`orderDetail.openReturn`, to both locales.

### 8. `docs/plans/BLOCKERS.md` and `docs/plans/PHASE-5-6-backlog.md`

Added the required T5.3 entry to `BLOCKERS.md` recording the missing `GET /returns` (list) and
`GET /returns/:returnId` (by-id) gap per the ruling. Ticked T5.3's checkbox in the backlog.

## Files changed

- `apps/admin-web/src/lib/api/returns.ts` (edited)
- `apps/admin-web/src/lib/api/returns.test.ts` (new)
- `apps/admin-web/src/lib/return-lifecycle.ts` (new)
- `apps/admin-web/src/lib/return-lifecycle.test.ts` (new)
- `apps/admin-web/src/components/orders/order-returns-card.tsx` (edited)
- `apps/admin-web/src/components/orders/return-create-form.tsx` (new)
- `apps/admin-web/src/components/orders/return-lifecycle-actions.tsx` (new)
- `apps/admin-web/src/app/orders/[orderId]/returns/page.tsx` (new)
- `apps/admin-web/src/app/orders/[orderId]/returns/actions.ts` (new)
- `apps/admin-web/src/messages/en.ts` (edited)
- `apps/admin-web/src/messages/ar.ts` (edited)
- `docs/plans/BLOCKERS.md` (edited)
- `docs/plans/PHASE-5-6-backlog.md` (edited)
- `apps/admin-web/src/middleware.ts` — verified, not changed

No file under T5.1's or T5.2's off-limits scope was touched (`order-returns-card.tsx` and
`app/orders/[orderId]/page.tsx` were the two expected-overlap files, both edited only as described
above and in the brief).

## Verification

```
cd "D:\lumo-platform-main-main\lumo-platform-main-main"
pnpm --filter admin-web typecheck   # clean
pnpm --filter admin-web lint        # clean (1 pre-existing warning in next.config.ts, unrelated)
pnpm --filter admin-web test        # 40 files, 359 tests passed (24 new: 17 in returns.test.ts, 7 in return-lifecycle.test.ts)
```

Not verified in a live browser — no Docker available in this environment to run
`apps/runtime` + `admin-web` together (same standing limitation `BLOCKERS.md` already records for
prior phases). Verification is code/typecheck/lint/test only, consistent with those prior entries.

## Concerns / judgment calls

1. **`accept`'s two possible outcomes (`items_accepted`/`items_rejected`) both routed through one
   dedicated action.** The transition table lists both as valid targets from
   `inspection_completed`, but there is only one route (`POST /returns/:returnId/accept`) at that
   status — assumed the resulting status depends on the dispositions submitted (domain-side
   decision), so `ReturnLifecycleActions` offers `AcceptForm` alone, no generic advance dropdown
   alongside it. This is exactly what the brief anticipated ("every edge has a dedicated route
   except possibly none").
2. **`AcceptForm` allows a partial submit** (rows left blank are simply omitted, not required to
   all be filled at once) — a UX simplification not specified either way by the brief; any real
   validation error from the backend still surfaces as a normal field/form error.
3. Import path `@/app/orders/[orderId]/returns/actions` (a literal bracket-directory segment) has
   no prior precedent elsewhere in this repo — verified it resolves correctly (`tsc --noEmit`
   clean, and the two consuming client components typecheck and are exercised transitively by the
   full test suite passing) before relying on it.

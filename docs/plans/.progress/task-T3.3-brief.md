# Task T3.3 brief — Customer 360 inside the customer detail page

## Method (condensed)

1. Read `apps/admin/src/http/customer-360-routes.ts` first — record each route's exact path,
   `schema`, `permission`, and (critically) the accepted `identifierType` enum values in the
   params schema — an unaccepted value returns 422.
2. Read the admin controller and the `services/customer-360/src/interfaces/` controller to learn
   the real response shape. Do not guess field names.
3. Add `apps/admin-web/src/lib/api/customer-360.ts`, copying
   `apps/admin-web/src/lib/api/content.ts`'s pattern: narrow types, `isX` guards, `fetch…`
   functions via `getAdminApi<T>(path, isX)`.
4. Merge into the existing `apps/admin-web/src/app/customers/[customerId]/page.tsx` — do NOT
   build a separate page.
5. Handle all four `ApiResult` outcomes on each new card independently.
6. Add every string to both `messages/en.ts` and `messages/ar.ts`.
7. No nav/middleware changes needed — this is a card on an existing, already-reachable page.
8. Test the API module (stub `global.fetch`, follow `lib/api/orders.test.ts`).

## T3.3 — Customer 360 inside the customer detail page

Four rich GET endpoints, none of them called. Do **not** build a separate page — merge them into
the customer detail screen that already exists.

| Route | Params |
| --- | --- |
| `GET /customer-360/profile/:identifierType/:identifierValue` | identifier type + value |
| `GET /customer-360/identity-timeline/:identifierType/:identifierValue` | same |
| `GET /customer-360/journeys/:visitorId/timeline` | visitor id |
| `GET /customer-360/journeys/:visitorId/state` | visitor id |

**Steps**

1. `apps/admin-web/src/lib/api/customer-360.ts` — four fetch functions.
2. `apps/admin-web/src/app/customers/[customerId]/page.tsx` — add a "Unified profile" card and an
   "Identity timeline" card below the existing detail. Fetch them in parallel with the existing
   `fetchCustomer` call using `Promise.all`, so the page does not serialise three round trips.
3. Each new card owns its own outcome handling: if Customer 360 returns `not_found` for a
   customer that exists in Identity, render "no unified profile for this customer yet" — that is
   a normal state, not an error.
4. The journey endpoints key on `visitorId`, not `customerId`. If the customer record does not
   carry a visitor id, do not fabricate one — render the journey cards only when a visitor id is
   actually available, and omit them otherwise.

**Acceptance:** the customer detail page shows unified-profile and identity-timeline data when it
exists, and a clean empty state when it does not, without slowing the page down serially.

## Global constraints

Same as every Phase 3 task: domain aggregates never go on the wire (hand-type DTOs), never
fabricate data, every string in both dictionaries, no `git` commands, do not ask questions
(blockers → `docs/plans/BLOCKERS.md`, continue with the rest), tick `- [ ] Task complete` under
`## T3.3 — Customer 360 inside the customer detail page` in
`docs/plans/PHASE-3-readonly-screens.md` when done and verified.

Note: this task edits an existing shared page (`customers/[customerId]/page.tsx`) — read the
whole current file first so your addition composes with what's already there rather than
replacing it.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

Repo root: `D:\lumo-platform-main-main\lumo-platform-main-main`. `pnpm exec turbo` fails on this
Windows host — use the `--filter admin-web` commands directly.

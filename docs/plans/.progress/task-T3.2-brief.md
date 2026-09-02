# Task T3.2 brief — Finance

## Method (condensed from docs/plans/PHASE-3-readonly-screens.md's top section)

1. Read `apps/admin/src/http/admin-routes.ts`'s `/finance/*` block (starts ~line 1304). Record
   each route's exact path, its `schema` (`querystring`/`params`), and its `permission`.
2. Read the admin controller it delegates to and the context controller under
   `services/finance/src/interfaces/` to learn the real response shape. Do not guess field
   names.
3. Add `apps/admin-web/src/lib/api/finance.ts`, copying `apps/admin-web/src/lib/api/content.ts`:
   a narrow response type per endpoint, an `isX` guard checking only the fields you render, and
   one `fetch…` function per endpoint calling `getAdminApi<T>(path, isX)`.
4. Add the page(s), copying the preamble from `apps/admin-web/src/app/orders/page.tsx`: locale
   cookie → `dictionaryFor` → `getCurrentUser()` → `<AppShell t={t} locale={locale}
   activeNavId="…" user={user}>`.
5. Handle all four `ApiResult` outcomes — `ok`, `unauthorized`, `not_found`, `error`. An error
   must never render as an empty table. `apps/admin-web/src/app/content/page.tsx` is the
   reference.
6. Add every string to both `messages/en.ts` and `messages/ar.ts`.
7. Add the nav entry to `PRIMARY_NAV` in `apps/admin-web/src/components/navigation.ts`, and
   `["/finance", "admin"]` to `ROUTE_ROLE_REQUIREMENTS` in `apps/admin-web/src/middleware.ts`
   (longest-prefix matched, unlisted defaults to `admin`; never lower an existing requirement).
8. Test the API module (stub `global.fetch`, follow `lib/api/orders.test.ts`) and any component
   with branching render logic.

## T3.2 — Finance

**Route file:** `apps/admin/src/http/admin-routes.ts`, the `/finance/*` block (starts around
line 1304).

| Route | Query / params |
| --- | --- |
| `GET /finance/trial-balance` | `periodRangeQuery` = `{ startDate: date, endDate: date, currency: 3 }` |
| `GET /finance/income-statement` | same `periodRangeQuery` |
| `GET /finance/balance-sheet` | same `periodRangeQuery` |
| `GET /finance/read-models/:model` | params `{ model }`, query `readModelQuery` (`{ dimension?, … }`) |
| `GET /finance/read-models/:model/:key` | params `{ model, key }` |
| all | permission `finance:read` |

`startDate`/`endDate` are `z.coerce.date()` — send ISO date strings (`YYYY-MM-DD`); the route
coerces them. `currency` must be exactly 3 characters.

**Read `periodRangeQuery` at `admin-routes.ts:482` and `readModelQuery` at `:489` for the exact
field list before writing the query builder.**

**Steps**

1. `apps/admin-web/src/lib/api/finance.ts` — five fetch functions.
2. `apps/admin-web/src/app/finance/page.tsx` — a period picker (start, end, currency) held in the
   URL search params, and three tabs: Trial balance, Income statement, Balance sheet. Render each
   as a table with `font-variant-numeric: tabular-nums` on every amount column so the digits
   align.
3. `apps/admin-web/src/app/finance/read-models/page.tsx` — a model explorer: pick a model, list
   its rows, drill into one by key.
4. Format every amount with the app's existing currency formatter — check
   `apps/admin-web/src/lib/` for one before writing a new one, and reuse
   `apps/storefront/src/lib/format.ts`'s approach if none exists. **Amounts from Finance are
   minor units** — divide by 100 only at the formatting boundary, never in the fetch layer.
5. `navigation.ts` + `middleware.ts`: `["/finance", "admin"]`.

**Acceptance:** the three statements render for a chosen period and currency. Changing the period
re-fetches. An unsupported model name renders the not-found state, not a crash.

## Global constraints

Same as every Phase 3 task — see the "Global constraints" section pattern: domain aggregates
never go on the wire (hand-type the DTOs), never fabricate data (explicit empty/error states),
every string in both dictionaries, no `git` commands (not a git repo), do not ask questions —
blockers go to `docs/plans/BLOCKERS.md` and you continue with the rest of the task, and tick the
`- [ ] Task complete` checkbox under `## T3.2 — Finance` in
`docs/plans/PHASE-3-readonly-screens.md` when done and verified.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

Repo root: `D:\lumo-platform-main-main\lumo-platform-main-main`. `pnpm exec turbo` fails to load
its native binary on this Windows host (see `docs/plans/BLOCKERS.md`) — use the
`--filter admin-web` commands directly, not a turbo/root-level run.

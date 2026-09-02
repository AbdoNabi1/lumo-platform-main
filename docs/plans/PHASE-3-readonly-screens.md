# Phase 3 — Screens over read endpoints that already exist

**Goal:** surface the 47 GET endpoints that are fully built, wired, and called by nothing.

**No backend work in this phase.** Every endpoint below already exists and returns real data. If
you find yourself writing a use case, you are in the wrong phase — that is Phase 4.

**Estimated size:** 6 tasks, ~10 days.

**Depends on:** Phase 1 (for `AppShell` conventions and the API-client patterns; these screens are
read-only, but Phase 1's `client.ts` refactor lands first so there is one client to extend).

---

## The method every task in this phase follows

For each screen, in this order:

1. **Read the route file** named in the task. Record every route's exact path, its `schema`
   (`querystring` / `params`), and its `permission`.
2. **Read the admin controller** it delegates to
   (`apps/admin/src/interfaces/<domain>.admin-controller.ts`) and then the context controller under
   `services/<domain>/src/interfaces/`, to learn the **real response shape**. Do not guess field
   names — every task below tells you where to look, and a wrong guess produces a silently empty
   screen rather than a type error, because `getAdminApi` validates with a hand-written guard.
3. **Add `apps/admin-web/src/lib/api/<domain>.ts`**, copying
   `apps/admin-web/src/lib/api/content.ts`: a narrow response type, a
   `function isX(value: unknown): value is X` guard that checks the fields you actually render, and
   one `fetch…` function per endpoint calling `getAdminApi<T>(path, isX)`.
4. **Add the page(s)** under `apps/admin-web/src/app/…`, copying the preamble from
   `apps/admin-web/src/app/orders/page.tsx`: read the locale cookie → `dictionaryFor` →
   `getCurrentUser()` → `<AppShell t={t} locale={locale} activeNavId="…" user={user}>`.
5. **Handle all four `ApiResult` outcomes** — `ok`, `unauthorized`, `not_found`, `error`. An error
   must never render as an empty table. `apps/admin-web/src/app/content/page.tsx` is the reference.
6. **Add every string to both dictionaries** — `messages/en.ts` and `messages/ar.ts`.
7. **Add the nav entry** to `PRIMARY_NAV` in `apps/admin-web/src/components/navigation.ts`, and the
   matching role requirement to `ROUTE_ROLE_REQUIREMENTS` in `apps/admin-web/src/middleware.ts`.
   That list is longest-prefix matched and **unlisted routes default to `admin`** — so a new page
   is deny-by-default until you add it. Never lower an existing requirement.
8. **Test** the API module (stub `global.fetch`, follow `lib/api/orders.test.ts`) and any component
   with branching render logic.

**Verify after every task:**

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

---

## T3.1 — Security Console

- [x] Task complete

The largest block of finished, unused backend in the repo: **23 GET endpoints**, all returning
purpose-built console read models, with zero UI.

**Route files to read:** `apps/admin/src/http/security-operations-routes.ts`,
`security-identity-routes.ts`, `security-authorization-routes.ts`, `security-sessions-routes.ts`,
`security-secrets-routes.ts`, `security-ai-governance-routes.ts`.

**Endpoints, grouped as the screens should be grouped:**

| Screen                      | Route(s)                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/security` (overview)      | `GET /security/console/dashboard`, `GET /security/console/trust-center`, `GET /security/console/analytics`                    |
| `/security/identity`        | `GET /security/console/identity-overview`, `GET /security/console/machine-identity-explorer`                                  |
| `/security/access`          | `GET /security/console/permission-explorer`, `.../policy-explorer`, `.../registry-explorer`                                   |
| `/security/sessions`        | `GET /security/console/session-explorer`, `.../device-explorer`, `.../risk-explorer`                                          |
| `/security/audit`           | `GET /security/console/audit-explorer`, `GET /security/console/incident-explorer`, `GET /security/audit-chain/verify`         |
| `/security/secrets`         | `GET /security/console/secret-explorer`                                                                                       |
| `/security/ai-governance`   | `GET /security/console/ai-governance-explorer`                                                                                |

**Querystring:** every `console/*` route takes the same optional `tenantRefQuery`
(`{ tenantRef?: string }` — `security-operations-routes.ts:50`), and the handler passes
`query.tenantRef ?? null`. `audit-chain/verify` takes `verifyAuditChainQuery`, the same shape.
So: one optional tenant filter, applied uniformly. Render it as a single filter control on the
`/security` layout, persisted in the URL as `?tenantRef=`.

**Lookup routes** — these take a path param and belong on the relevant screen as a search box, not
as their own page: `GET /security/resolve/principals/:subjectRef`,
`/security/resolve/memberships/:userId`, `/security/resolve/organizations/:organizationId`,
`/security/resolve/machine-identities/:externalId`, `/security/consent/:subjectRef`,
`/security/credentials/:credentialId/lineage`, `/security/sessions/:sessionId/introspect`.

**Permissions:** each route declares its own, e.g. `security:security_dashboard`,
`security:audit_explorer`, `security:device_explorer`. Read each one; do not assume a shared
`security:read`.

**Steps**

1. `apps/admin-web/src/lib/api/security.ts` — one fetch function per endpoint. This file will be
   long; that is fine. Group the functions in the same order as the table above and separate the
   groups with a comment.
2. `apps/admin-web/src/app/security/layout.tsx` — the shared `AppShell` + a sub-navigation across
   the seven screens + the `tenantRef` filter.
3. Seven `page.tsx` files under `apps/admin-web/src/app/security/…`.
4. `navigation.ts`: add one `security` entry pointing at `/security`, using `ShieldIcon` from
   `lucide-react`.
5. `middleware.ts`: add `["/security", "admin"]` to `ROUTE_ROLE_REQUIREMENTS`. Security surfaces
   are admin-only.

**Do not** add any write control on these screens. The security write routes exist (57 of them)
but they are Phase 5, and shipping a half-wired incident-triage button is worse than shipping none.

**Acceptance:** all 23 GET endpoints are reachable from the UI. Each screen renders real data, an
explicit empty state, and an explicit error state.

---

## T3.2 — Finance

- [x] Task complete

**Route file:** `apps/admin/src/http/admin-routes.ts`, the `/finance/*` block (starts around
line 1304).

| Route                              | Query / params                                                        |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `GET /finance/trial-balance`       | `periodRangeQuery` = `{ startDate: date, endDate: date, currency: 3 }`  |
| `GET /finance/income-statement`    | same `periodRangeQuery`                                                |
| `GET /finance/balance-sheet`       | same `periodRangeQuery`                                                |
| `GET /finance/read-models/:model`  | params `{ model }`, query `readModelQuery` (`{ dimension?, … }`)        |
| `GET /finance/read-models/:model/:key` | params `{ model, key }`                                             |
| all                                | permission `finance:read`                                              |

`startDate` / `endDate` are `z.coerce.date()` — send ISO date strings (`YYYY-MM-DD`); the route
coerces them. `currency` must be exactly 3 characters.

**Read `periodRangeQuery` at `admin-routes.ts:482` and `readModelQuery` at `:489` for the exact
field list before writing the query builder.**

**Steps**

1. `apps/admin-web/src/lib/api/finance.ts` — five fetch functions.
2. `apps/admin-web/src/app/finance/page.tsx` — a period picker (start, end, currency) held in the
   URL search params, and three tabs: Trial balance, Income statement, Balance sheet. Render each
   as a table with `font-variant-numeric: tabular-nums` on every amount column so the digits align.
3. `apps/admin-web/src/app/finance/read-models/page.tsx` — a model explorer: pick a model, list its
   rows, drill into one by key.
4. Format every amount with the app's existing currency formatter — check
   `apps/admin-web/src/lib/` for one before writing a new one, and reuse
   `apps/storefront/src/lib/format.ts`'s approach if none exists. **Amounts from Finance are minor
   units** — divide by 100 only at the formatting boundary, never in the fetch layer.
5. `navigation.ts` + `middleware.ts`: `["/finance", "admin"]`.

**Acceptance:** the three statements render for a chosen period and currency. Changing the period
re-fetches. An unsupported model name renders the not-found state, not a crash.

---

## T3.3 — Customer 360 inside the customer detail page

- [x] Task complete

Four rich GET endpoints, none of them called. Do **not** build a separate page — merge them into
the customer detail screen that already exists.

| Route                                                         | Params                                      |
| ------------------------------------------------------------- | -------------------------------------------- |
| `GET /customer-360/profile/:identifierType/:identifierValue`    | identifier type + value                      |
| `GET /customer-360/identity-timeline/:identifierType/:identifierValue` | same                                |
| `GET /customer-360/journeys/:visitorId/timeline`                | visitor id                                   |
| `GET /customer-360/journeys/:visitorId/state`                   | visitor id                                   |

**Read `apps/admin/src/http/customer-360-routes.ts` first** to learn the accepted
`identifierType` values — it is an enum in the params schema, and passing an unaccepted value
returns 422.

**Steps**

1. `apps/admin-web/src/lib/api/customer-360.ts` — four fetch functions.
2. `apps/admin-web/src/app/customers/[customerId]/page.tsx` — add a "Unified profile" card and an
   "Identity timeline" card below the existing detail. Fetch them in parallel with the existing
   `fetchCustomer` call using `Promise.all`, so the page does not serialise three round trips.
3. Each new card owns its own outcome handling: if Customer 360 returns `not_found` for a customer
   that exists in Identity, render "no unified profile for this customer yet" — that is a normal
   state, not an error.
4. The journey endpoints key on `visitorId`, not `customerId`. If the customer record does not
   carry a visitor id, do not fabricate one — render the journey cards only when a visitor id is
   actually available, and omit them otherwise.

**Acceptance:** the customer detail page shows unified-profile and identity-timeline data when it
exists, and a clean empty state when it does not, without slowing the page down serially.

---

## T3.4 — Feature Registry explorer

- [x] Task complete

Five GET endpoints, zero UI. Useful to the team immediately.

| Route                                     | Notes                                   |
| ----------------------------------------- | ---------------------------------------- |
| `GET /feature-registry/features`           | the catalog                             |
| `GET /feature-registry/features/:key/resolve` | resolution for one feature key       |
| `GET /feature-registry/capability-graph`   | the graph                               |
| `GET /feature-registry/validate`           | registry validation result              |
| `GET /feature-registry/bundles`            | bundles                                 |

**Read `apps/admin/src/http/feature-registry-routes.ts`** for each route's querystring — several
take filters.

**Steps**

1. `apps/admin-web/src/lib/api/feature-registry.ts`.
2. `apps/admin-web/src/app/feature-registry/page.tsx` — features table with a key search that calls
   the `resolve` endpoint, a bundles list, and the validation result rendered as a pass/fail
   summary with the failures listed.
3. **Capability graph:** render it as a **table of edges** (from → to → relationship), not a
   drawn graph. Do not add a graph-drawing dependency. If a visual is wanted later that is a
   separate, approved task.
4. `navigation.ts` + `middleware.ts`: `["/feature-registry", "admin"]`.

**Acceptance:** the registry's contents and its validation result are visible without opening a
terminal.

---

## T3.5 — Licensing usage counters in Settings

- [x] Task complete

**Route:** `GET /usage-counters` (`apps/admin/src/http/licensing-routes.ts`).

`apps/admin-web/src/app/settings/page.tsx` currently renders a "Workspace & billing" section as
unavailable, and its doc comment explains why: admin-web cannot resolve *which* workspace is
current. That reasoning holds for Tenancy's `Workspace` and Licensing's `Plan`/`Subscription` —
but **not** for `GET /usage-counters`, which is tenant-scoped by the `x-tenant-id` header the
client already sends.

**Steps**

1. `apps/admin-web/src/lib/api/licensing.ts` with `fetchUsageCounters()`.
2. In the settings page, replace only the usage portion of the unavailable card with a real
   counters table. **Leave the workspace/plan/subscription unavailable state exactly as it is** and
   leave its doc comment intact — that gap is real and closes in Phase 4 (Tenancy read side).
3. Update the settings doc comment to say which half is now live and which half is still blocked,
   and why.

**Acceptance:** real usage counters render in Settings. The workspace/plan gap is still stated
honestly.

---

## T3.6 — Media asset download links

- [x] Task complete

**Route:** `GET /media/assets/:mediaAssetId/download-url`
(`apps/admin/src/http/media-library-routes.ts`).

There is **no list endpoint** for media assets — this route takes an id you must already have. So
there is no media library screen to build in this phase.

**Scope this task to exactly one thing:** wire the download link on the product detail page's
attached-media rows, where the media asset ids are already known from the product aggregate.

1. `apps/admin-web/src/lib/api/media.ts` with `fetchMediaDownloadUrl(mediaAssetId)`.
2. In `apps/admin-web/src/app/products/[productId]/page.tsx`, render each attached media id as a
   link resolved through that endpoint.

**Deployment note:** `apps/runtime/src/api.ts` guard `M2-2` fails the boot outside `local` when no
real object storage is configured. In `local`, `InMemoryObjectStorage.getDownloadUrl()` returns a
URL template that has never pointed at real storage — so **the link will not resolve to a file in
local development**. That is expected. Do not treat it as a bug, and do not add a fallback that
hides it; render the URL the API returns.

Record in `docs/plans/BLOCKERS.md` that a media library screen needs a
`GET /media/assets` list endpoint, and that it is scheduled in Phase 4.

**Acceptance:** product media rows link to the API-issued download URL.

---

## Phase 3 exit criteria

- [ ] All 23 security console GETs are reachable from `/security`.
- [ ] The three finance statements and the read-model explorer render.
- [ ] Customer 360 data appears on the customer detail page.
- [ ] The feature registry and its validation result are visible.
- [ ] Usage counters render in Settings.
- [x] Every new route has an entry in `ROUTE_ROLE_REQUIREMENTS`.
- [x] Every new string exists in both `en.ts` and `ar.ts`.
- [x] `pnpm --filter admin-web typecheck && lint && test` pass.
- [x] No screen in this phase contains a write control.

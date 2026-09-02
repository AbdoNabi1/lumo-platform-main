# Task T3.1 brief — Security Console

Extracted verbatim from docs/plans/PHASE-3-readonly-screens.md (the "method every task in this
phase follows" section applies to this task too — read it in that file first, or follow the
condensed version below).

## Method (from the top of PHASE-3-readonly-screens.md)

For each screen, in this order:

1. Read the route file named below. Record every route's exact path, its `schema`
   (`querystring` / `params`), and its `permission`.
2. Read the admin controller it delegates to
   (`apps/admin/src/interfaces/<domain>.admin-controller.ts`) and then the context controller
   under `services/<domain>/src/interfaces/`, to learn the real response shape. Do not guess
   field names — a wrong guess produces a silently empty screen rather than a type error,
   because `getAdminApi` validates with a hand-written guard.
3. Add `apps/admin-web/src/lib/api/<domain>.ts`, copying `apps/admin-web/src/lib/api/content.ts`:
   a narrow response type, a `function isX(value: unknown): value is X` guard that checks the
   fields you actually render, and one `fetch…` function per endpoint calling
   `getAdminApi<T>(path, isX)`.
4. Add the page(s) under `apps/admin-web/src/app/…`, copying the preamble from
   `apps/admin-web/src/app/orders/page.tsx`: read the locale cookie → `dictionaryFor` →
   `getCurrentUser()` → `<AppShell t={t} locale={locale} activeNavId="…" user={user}>`.
5. Handle all four `ApiResult` outcomes — `ok`, `unauthorized`, `not_found`, `error`. An error
   must never render as an empty table. `apps/admin-web/src/app/content/page.tsx` is the
   reference.
6. Add every string to both dictionaries — `messages/en.ts` and `messages/ar.ts`.
7. Add the nav entry to `PRIMARY_NAV` in `apps/admin-web/src/components/navigation.ts`, and the
   matching role requirement to `ROUTE_ROLE_REQUIREMENTS` in `apps/admin-web/src/middleware.ts`.
   That list is longest-prefix matched and unlisted routes default to `admin` — so a new page is
   deny-by-default until you add it. Never lower an existing requirement.
8. Test the API module (stub `global.fetch`, follow `lib/api/orders.test.ts`) and any component
   with branching render logic.

Verify after every task:

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

## T3.1 — Security Console

The largest block of finished, unused backend in the repo: **23 GET endpoints**, all returning
purpose-built console read models, with zero UI.

**Route files to read:** `apps/admin/src/http/security-operations-routes.ts`,
`security-identity-routes.ts`, `security-authorization-routes.ts`, `security-sessions-routes.ts`,
`security-secrets-routes.ts`, `security-ai-governance-routes.ts`.

**Endpoints, grouped as the screens should be grouped:**

| Screen | Route(s) |
| --- | --- |
| `/security` (overview) | `GET /security/console/dashboard`, `GET /security/console/trust-center`, `GET /security/console/analytics` |
| `/security/identity` | `GET /security/console/identity-overview`, `GET /security/console/machine-identity-explorer` |
| `/security/access` | `GET /security/console/permission-explorer`, `.../policy-explorer`, `.../registry-explorer` |
| `/security/sessions` | `GET /security/console/session-explorer`, `.../device-explorer`, `.../risk-explorer` |
| `/security/audit` | `GET /security/console/audit-explorer`, `GET /security/console/incident-explorer`, `GET /security/audit-chain/verify` |
| `/security/secrets` | `GET /security/console/secret-explorer` |
| `/security/ai-governance` | `GET /security/console/ai-governance-explorer` |

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

1. `apps/admin-web/src/lib/api/security.ts` — one fetch function per endpoint (including the 7
   lookup routes above). This file will be long; that is fine. Group the functions in the same
   order as the table above and separate the groups with a comment.
2. `apps/admin-web/src/app/security/layout.tsx` — the shared `AppShell` + a sub-navigation across
   the seven screens + the `tenantRef` filter.
3. Seven `page.tsx` files under `apps/admin-web/src/app/security/…` (overview at
   `apps/admin-web/src/app/security/page.tsx`, then `identity/`, `access/`, `sessions/`,
   `audit/`, `secrets/`, `ai-governance/`). Each lookup route's search box lives on its matching
   screen: principals/memberships/organizations/machine-identities on `identity` or `access`
   (pick by what the endpoint resolves), consent on `identity`, credential lineage on `secrets`,
   session introspect on `sessions`.
4. `navigation.ts`: add one `security` entry pointing at `/security`, using `ShieldIcon` from
   `lucide-react`.
5. `middleware.ts`: add `["/security", "admin"]` to `ROUTE_ROLE_REQUIREMENTS`. Security surfaces
   are admin-only.

**Do not** add any write control on these screens. The security write routes exist (57 of them)
but they are Phase 5, and shipping a half-wired incident-triage button is worse than shipping
none.

**Acceptance:** all 23 GET endpoints are reachable from the UI. Each screen renders real data, an
explicit empty state, and an explicit error state.

## Global constraints (apply to every Phase 3 task, from docs/plans/README.md)

1. `packages/*` and `services/*` never import from `apps/*` — you are not touching those here,
   but do not add any import that would violate this.
2. Domain aggregates never go on the wire — every DTO type in `security.ts` must be hand-typed
   to the primitive fields you actually render, never the raw controller response cast through.
   If a controller returns a value object/entity with a nested `props`, do NOT type through it —
   read `docs/plans/BLOCKERS.md`'s "T0.6" entry for the exact failure mode this rule prevents,
   and if you hit the same problem here, follow the same fix (map to a flat DTO at the point you
   discover the leak — but note: this task is explicitly told not to touch route files unless
   you find this exact leak, in which case fix it the same way T0.6 did and record it in
   BLOCKERS.md).
3. Never fabricate data in the UI — explicit unavailable/empty/error states only.
4. Every user-facing string goes in both `messages/en.ts` and `messages/ar.ts`.
5. Do not run `git` commands — this working copy is not a git repository.
6. Do not ask questions. If something is genuinely blocked, append an entry to
   `docs/plans/BLOCKERS.md` in the shape shown at the bottom of `docs/plans/README.md`, skip
   just that piece, and continue with the rest of the task.
7. Mark the task's checkbox (`- [ ] Task complete` → `- [x] Task complete`) under `## T3.1 —
   Security Console` in `docs/plans/PHASE-3-readonly-screens.md` when done.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

Repo root: `D:\lumo-platform-main-main\lumo-platform-main-main`. Windows host — this session's
prior phases found `pnpm exec turbo` fails to load its native binary here
(`docs/plans/BLOCKERS.md`, "Environment note (Phase 2 addendum)"); use the `--filter admin-web`
commands above directly, not a turbo/root-level run.

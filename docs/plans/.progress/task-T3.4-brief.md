# Task T3.4 brief — Feature Registry explorer

## Method (condensed)

1. Read `apps/admin/src/http/feature-registry-routes.ts` for each route's exact path, querystring
   (several take filters), and `permission`.
2. Read the admin controller and the `services/feature-registry/src/interfaces/` controller to
   learn the real response shape.
3. Add `apps/admin-web/src/lib/api/feature-registry.ts`, copying
   `apps/admin-web/src/lib/api/content.ts`'s pattern: narrow types, `isX` guards, `fetch…`
   functions via `getAdminApi<T>(path, isX)`.
4. Add the page, copying the preamble from `apps/admin-web/src/app/orders/page.tsx`.
5. Handle all four `ApiResult` outcomes; error must never render as an empty table.
6. Add every string to both `messages/en.ts` and `messages/ar.ts`.
7. Nav entry in `navigation.ts` + `["/feature-registry", "admin"]` in `middleware.ts`'s
   `ROUTE_ROLE_REQUIREMENTS`.
8. Test the API module (stub `global.fetch`, follow `lib/api/orders.test.ts`).

## T3.4 — Feature Registry explorer

Five GET endpoints, zero UI.

| Route | Notes |
| --- | --- |
| `GET /feature-registry/features` | the catalog |
| `GET /feature-registry/features/:key/resolve` | resolution for one feature key |
| `GET /feature-registry/capability-graph` | the graph |
| `GET /feature-registry/validate` | registry validation result |
| `GET /feature-registry/bundles` | bundles |

**Steps**

1. `apps/admin-web/src/lib/api/feature-registry.ts`.
2. `apps/admin-web/src/app/feature-registry/page.tsx` — features table with a key search that
   calls the `resolve` endpoint, a bundles list, and the validation result rendered as a
   pass/fail summary with the failures listed.
3. **Capability graph:** render it as a **table of edges** (from → to → relationship), not a
   drawn graph. Do not add a graph-drawing dependency. If a visual is wanted later that is a
   separate, approved task — do not attempt it here.
4. `navigation.ts` + `middleware.ts`: `["/feature-registry", "admin"]`.

**Acceptance:** the registry's contents and its validation result are visible without opening a
terminal.

## Global constraints

Same as every Phase 3 task: domain aggregates never go on the wire (hand-type DTOs), never
fabricate data, every string in both dictionaries, no `git` commands, do not ask questions
(blockers → `docs/plans/BLOCKERS.md`, continue with the rest), tick `- [ ] Task complete` under
`## T3.4 — Feature Registry explorer` in `docs/plans/PHASE-3-readonly-screens.md` when done and
verified.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

Repo root: `D:\lumo-platform-main-main\lumo-platform-main-main`. `pnpm exec turbo` fails on this
Windows host — use the `--filter admin-web` commands directly.

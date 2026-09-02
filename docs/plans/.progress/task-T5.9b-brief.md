# Task T5.9b brief — SEO (read screens from scratch + write, 4 sub-resources)

Part 2 of 3 covering T5.9. Same write-screen recipe as every prior Phase 5 task. **No frontend
exists for this domain at all** — build both read and write for all four SEO sub-resources
(profiles, redirects, sitemaps, robots policies). Scope (`apps/seo`, `lib/api/seo.ts`) does not
overlap T5.9a or T5.9c or any earlier Phase 5 task.

`apps/admin/src/http/seo-routes.ts` (read in full, verbatim below) already has fully DTO-mapped
list+get for all four resources.

## DTOs (already correct on the backend, mirror them exactly)

- `SeoProfileDto`: `{ id, pageRef, title: string|null, description: string|null, canonicalUrl:
  string|null, ogImageRef: string|null }`
- `RedirectDto`: `{ id, fromPath, toPath, statusCode: number, active: boolean }`
- `SitemapDto`: `{ id, name, urls: string[], lastGeneratedAt: string|null }`
- `RobotsPolicyDto`: `{ id, userAgent, rules: Array<{ type: "allow"|"disallow", path }> }`

## Routes

| Route | Method | Permission | Body |
| --- | --- | --- | --- |
| `/seo/profiles` (set) | POST | `seo:set_profile` | `{ pageRef: string.min(1), title?: string.min(1), description?: string.min(1), canonicalUrl?: string.min(1), ogImageRef?: string.min(1) }` — this is create-or-update keyed by `pageRef`, not a separate update route |
| `/seo/redirects` (create) | POST | `seo:create_redirect` | `{ fromPath: string.min(1), toPath: string.min(1), statusCode: 301\|302 }` |
| `/seo/sitemaps` (create) | POST | `seo:create_sitemap` | `{ name: string.min(1) }` |
| `/seo/sitemaps/:sitemapId/regenerate` | POST | `seo:regenerate_sitemap` | `{ urls: string[] }` |
| `/seo/robots-policies` (set) | POST | `seo:set_robots_policy` | `{ userAgent: string.min(1), rules: Array<{type: "allow"\|"disallow", path: string.min(1)}> }` — also create-or-update, keyed by `userAgent` |
| `/seo/profiles` (list) | GET | `seo:read` | `{ first?, after?, last?, before? }` |
| `/seo/profiles/:profileId` (get) | GET | `seo:read` | — |
| `/seo/redirects` (list) | GET | `seo:read` | same |
| `/seo/redirects/:redirectId` (get) | GET | `seo:read` | — |
| `/seo/sitemaps` (list) | GET | `seo:read` | same |
| `/seo/sitemaps/:sitemapId` (get) | GET | `seo:read` | — |
| `/seo/robots-policies` (list) | GET | `seo:read` | same |
| `/seo/robots-policies/:policyId` (get) | GET | `seo:read` | — |

No `Redirect`/`Sitemap`/`RobotsPolicy` delete/deactivate routes exist — do not invent one; a
redirect's `active` field is read-only from this task's perspective (no route sets it directly
except implicitly via re-`POST`ing `/seo/redirects`? No — check: there is no update route for
redirects at all, only create. If `active` needs to be toggled, that capability does not exist yet;
do not fabricate a control for it, note it plainly if you find operators would expect one, but do
not add a BLOCKERS.md entry unless you're certain — a create-only redirect resource may be
intentional (redirects are typically immutable once created in most systems).

## What to build

One screen per sub-resource, each following the same shape (list + create form; profiles/
robots-policies also need their "set" form to double as an edit, since POST re-creates/updates by
key):

- `apps/admin-web/src/lib/api/seo.ts` (new) — list/get for all 4 resources + the 5 mutate
  functions.
- `apps/admin-web/src/app/seo/profiles/page.tsx` (list) + `.../new/page.tsx` (create/set form,
  `pageRef` plain text input — no page picker in this task's scope even though T5.9a builds a
  Pages screen; cross-domain pickers are out of scope, plain text is fine) +
  `.../[profileId]/page.tsx` (detail, read-only display — editing means re-submitting the set form
  with the same `pageRef`, which the detail page can link to pre-filled if convenient, not
  required).
- `apps/admin-web/src/app/seo/redirects/page.tsx` (list) + `.../new/page.tsx` (create) —
  no detail page needed (nothing to edit once created, per the ruling above).
- `apps/admin-web/src/app/seo/sitemaps/page.tsx` (list) + `.../new/page.tsx` (create) +
  `.../[sitemapId]/page.tsx` (detail: shows `urls`/`lastGeneratedAt`, has the "Regenerate" form
  taking a new `urls` list — a simple repeated-text-row array, same technique
  `OrderLineItemsField`/`parseVariants` established).
- `apps/admin-web/src/app/seo/robots-policies/page.tsx` (list) + `.../new/page.tsx` (create/set
  form: `userAgent` text input + a repeated `{type, path}` rule-row array).
- A shared `apps/admin-web/src/app/seo/layout.tsx` with `AppShell` + sub-navigation across the four
  screens (mirror T3.1's Security Console layout pattern — `apps/admin-web/src/app/security/
  layout.tsx` — if that pattern exists; if not, four independent top-level pages under `/seo/*` are
  fine too, your call, keep it simple).

## Navigation, middleware, dictionaries

- `PRIMARY_NAV`: one `seo` entry pointing at `/seo/profiles` (or `/seo` if you build the shared
  layout at that path).
- `middleware.ts`: `["/seo", "viewer"]` for the list/detail screens, `["/seo/profiles/new",
  "operator"]` / `["/seo/redirects/new", "operator"]` / `["/seo/sitemaps/new", "operator"]` /
  `["/seo/robots-policies/new", "operator"]` for the write forms (longest-prefix match — write
  paths need to be more specific than the `viewer` list prefix).
- Every new string in both `messages/en.ts` and `messages/ar.ts`.

## Global constraints (every Phase 5 task)

1. `packages/*`/`services/*` never import from `apps/*`.
2. Domain aggregates never go on the wire — the four DTOs above are already correctly typed, keep
   them that way.
3. Never fabricate data — the "no redirect update route" note above is exactly this rule.
4. Every user-facing string in both dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Do NOT tick T5.9's checkbox yourself — the controller ticks it once all three sub-briefs land.
   Note in your report that Part (SEO) of T5.9 is complete.
8. One `Idempotency-Key` per user-initiated submit.
9. Never call the runtime API from browser JS.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

## Report

Write your full report to `docs/plans/.progress/task-T5.9b-report.md`. Return to the controller
only: status, files changed, one-line test summary, concerns.

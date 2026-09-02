# Task T5.9a brief — Content write + Pages (read screen from scratch + write)

Part 1 of 3 covering T5.9 ("Content, pages, SEO, theme, components editors") — split for
manageable dispatch size; T5.9's checkbox is ticked only after all three sub-briefs land (the
controller does that, not you). Same write-screen recipe as every prior Phase 5 task
(`apps/admin-web/README.md`). Six prior tasks (T5.1-T5.6, plus T5.7/T5.8 may be in flight) touched
unrelated files — this task's scope (`apps/content`, new `apps/pages`, new `apps/templates`,
`lib/api/content.ts`, new `lib/api/pages.ts`) does not overlap any of them.

## Part A — Content Blocks (write only; read screen already exists)

`apps/admin-web/src/app/content/page.tsx` + `lib/api/content.ts` already list content blocks
read-only (`GET /content-blocks`, no get-by-id exists on the backend either — do not add one).
Add the 3 write routes from `apps/admin/src/http/content-routes.ts`:

| Route | Method | Permission | Body |
| --- | --- | --- | --- |
| `/content-blocks` (create) | POST | `content:create` | `{ name: string.min(1), blockType: string.min(1), format: "html"\|"markdown"\|"json", content: string.min(1), locale?: string.min(1) }` |
| `/content-blocks/:contentBlockId/transitions` | POST | `content:advance` | `{ toStatus: "draft"\|"scheduled"\|"published"\|"archived", scheduledAt?: z.coerce.date() }` |
| `/content-blocks/:contentBlockId/body` | POST | `content:update` | `{ format: "html"\|"markdown"\|"json", content: string.min(1) }` |

Add a "New content block" link/page (`apps/content/new/page.tsx`) and per-row advance/edit-body
actions on the existing list (no detail page needed — there's no get-by-id backend route to back
one; edit-body and advance can be inline row actions/expanders on the list itself, mirroring how
T5.1 put per-row edit directly on `ProductVariantsCard`'s table rows).

## Part B — Pages + Templates (read screen from scratch + write)

**No frontend exists for this domain at all** — build both the read and write sides.
`apps/admin/src/http/pages-routes.ts` (read in full, verbatim below) already has fully DTO-mapped
list+get for both `Page` and `Template`.

`PageDto`: `{ id, name, routePath, templateRef: string|null, experienceRef: string|null,
seoProfileRef: string|null, localeRef: string|null, status }`. `TemplateDto`: `{ id, name,
experienceRef, status }`.

| Route | Method | Permission | Body |
| --- | --- | --- | --- |
| `/pages` (create) | POST | `pages:create_page` | `{ name: string.min(1), routePath: string.min(1), templateRef?: string.min(1), experienceRef?: string.min(1), seoProfileRef?: string.min(1), localeRef?: string.min(1) }` |
| `/pages/:pageId/transitions` | POST | `pages:advance_page` | `{ toStatus: "draft"\|"published"\|"archived" }` |
| `/templates` (create) | POST | `pages:create_template` | `{ name: string.min(1), experienceRef: string.min(1) }` |
| `/templates/:templateId/archive` | POST | `pages:archive_template` | none |
| `/pages` (list) | GET | `pages:read` | `{ first?, after?, last?, before? }` |
| `/pages/:pageId` (get) | GET | `pages:read` | — |
| `/templates` (list) | GET | `pages:read` | same query shape |
| `/templates/:templateId` (get) | GET | `pages:read` | — |

Build: `apps/admin-web/src/lib/api/pages.ts` (fetch list/get for both Page and Template, mirroring
`lib/api/products.ts`'s pattern; plus the 4 mutate functions), `apps/admin-web/src/app/pages/
page.tsx` (list, `products/page.tsx`'s pattern) + `apps/admin-web/src/app/pages/new/page.tsx`
(create) + `apps/admin-web/src/app/pages/[pageId]/page.tsx` (detail: fields + advance control) +
`apps/admin-web/src/app/templates/page.tsx` (list) + `apps/admin-web/src/app/templates/new/
page.tsx` (create) + `apps/admin-web/src/app/templates/[templateId]/page.tsx` (detail: fields +
archive button) + `actions.ts` files as needed. `templateRef`/`experienceRef`/`seoProfileRef`/
`localeRef` fields on the page-create form are plain text ids (no picker source in this task's
scope — `experienceRef` may be pickable from an existing Experience screen if one exists, check
`apps/admin-web/src/lib/api/` for an `experiences.ts`; if not, plain text, do not build one here).

Page status transition table (copy verbatim as UI-only data; sourced from wherever
`services/pages`' page-status value object defines it — read that file yourself, same technique
every prior Phase 5 task used, do not guess the table). Same for Template's status if it has one
(check whether Template even has a lifecycle beyond create/archive — if archive is its only
transition, no table is needed, just gate the archive button on "not already archived").

## Navigation, middleware, dictionaries

- `PRIMARY_NAV`: add `pages` and `templates` entries (or group under one "Pages" nav item with
  sub-links — match whatever grouping convention `navigation.ts` already has).
- `middleware.ts`: `["/content", ...]` should already exist (verify, don't lower it);
  add `["/pages", "viewer"]`, `["/pages/new", "operator"]`, `["/templates", "viewer"]`,
  `["/templates/new", "operator"]`.
- Every new string in both `messages/en.ts` and `messages/ar.ts`.

## Global constraints (every Phase 5 task)

1. `packages/*`/`services/*` never import from `apps/*`.
2. Domain aggregates never go on the wire — `PageDto`/`TemplateDto` are already correctly typed.
3. Never fabricate data.
4. Every user-facing string in both dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Do NOT tick T5.9's checkbox yourself — the controller ticks it once all three T5.9 sub-briefs
   are done. Do note in your report that Part A and Part B of this sub-brief are complete.
8. One `Idempotency-Key` per user-initiated submit.
9. Never call the runtime API from browser JS.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

## Report

Write your full report to `docs/plans/.progress/task-T5.9a-report.md`. Return to the controller
only: status, files changed, one-line test summary, concerns.

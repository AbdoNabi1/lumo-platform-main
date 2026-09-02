# Task T5.9a report — Content write + Pages (read screen from scratch + write)

Status: **DONE**. Part A (Content Blocks write actions) and Part B (Pages + Templates domain,
built from scratch) are both complete and verified. Per the brief, T5.9's own checkbox in
`docs/plans/PHASE-5-6-backlog.md` was **not** ticked — that's the controller's job once all three
T5.9 sub-briefs (this one, T5.9b SEO, T5.9c Theme + Component Library) have landed.

## Part A — Content Blocks (write)

Added the 3 write routes from `apps/admin/src/http/content-routes.ts` on top of the existing
read-only list screen. No detail page was added — no `GET /content-blocks/:id` route exists on the
backend to back one (confirmed by re-reading `content-routes.ts`) — so "advance status" and "edit
body" are inline row actions/expanders directly on the list, mirroring how T5.1 put per-row edit
directly on `ProductVariantsCard`'s table rows (`editingId` state, one row's editor open at a time).

- `apps/admin-web/src/lib/api/content.ts` — added `createContentBlock`, `advanceContentBlock`,
  `updateContentBlockBody`, calling `mutateAdminApi` exactly like every other Phase 5 write route.
- `apps/admin-web/src/lib/content-lifecycle.ts` (+ `.test.ts`) — a hand-kept UI-only copy of
  `services/content/src/domain/value-objects/content-status.ts`'s `TRANSITIONS` table
  (draft→scheduled/published/archived, scheduled→published/archived, published→archived,
  archived→terminal), same technique as `lib/order-lifecycle.ts`. Not explicitly required by the
  brief for Part A, but added anyway (same discipline the brief's global constraint #3 — "never
  fabricate data" — asks for) so the "advance to…" dropdown only ever offers real transitions
  instead of guessing.
- `apps/admin-web/src/app/content/actions.ts` (new) — `createContentBlockAction`,
  `advanceContentBlockAction`, `updateContentBlockBodyAction`. Each parses `FormData` defensively,
  mints one `Idempotency-Key` per submit, and `revalidatePath("/content")` on success (the list is
  the only stale surface — there's no detail page).
- `apps/admin-web/src/components/content/content-create-form.tsx` (new) + `apps/admin-web/src/app/
  content/new/page.tsx` (new) — the create screen.
- `apps/admin-web/src/components/content/content-blocks-table.tsx` (new, client component) — the
  list's row actions: an always-visible "advance to…" mini-form (gated by
  `contentAdvanceableStatusesFrom`, rendered as no control at all when terminal) and an "Edit body"
  toggle that expands an inline `format`+`content` editor row, closing itself via `useEffect` on
  success (same pattern as `VariantEditRow`).
- `apps/admin-web/src/app/content/page.tsx` — wired in `ContentBlocksTable`, added the "New content
  block" header button, updated the file's own doc comment (previously said "List-only for now").

## Part B — Pages + Templates (read + write, from scratch)

No frontend existed for this domain at all before this task. Built both sides against
`apps/admin/src/http/pages-routes.ts`'s fully DTO-mapped list/get routes for both `Page` and
`Template`, plus its 4 write routes.

- `apps/admin-web/src/lib/api/pages.ts` (new) — `fetchPagesPage`, `fetchPage`, `fetchTemplatesPage`,
  `fetchTemplate` (read side, `PageDto`/`TemplateDto` exactly as specified in the brief) plus
  `createPage`, `advancePage`, `createTemplate`, `archiveTemplate` (write side). Same
  `getAdminApi`/`mutateAdminApi` pattern as `lib/api/products.ts`.
- `apps/admin-web/src/lib/pages-lifecycle.ts` (+ `.test.ts`) — read `services/pages/src/domain/
  page.ts` and `template.ts` directly (not guessed):
  - `Page`'s `TRANSITIONS` table (draft→published/archived, published→archived, archived→terminal)
    copied verbatim as `PAGE_LIFECYCLE_TRANSITIONS`, same hand-kept-copy technique as
    `order-lifecycle.ts`/`content-lifecycle.ts` — never an import from `services/*`.
  - `Template` has **no** transition table at all in the backend — `archive()` is its only
    lifecycle move, and the aggregate itself throws `BusinessRuleError("Template is already
    archived")` once `status === "archived"`. So per the brief's own guidance, no table was
    invented for it; `templateCanArchive(status)` just gates the archive button on
    `status !== "archived"`.
- Pages screens: `apps/admin-web/src/app/pages/page.tsx` (list, `products/page.tsx`'s pattern),
  `apps/admin-web/src/app/pages/new/page.tsx` (create), `apps/admin-web/src/app/pages/[pageId]/
  page.tsx` (detail: fields + `PageLifecycleActions` advance control), `apps/admin-web/src/app/
  pages/actions.ts` (`createPageAction`, `advancePageAction`).
- Templates screens: `apps/admin-web/src/app/templates/page.tsx` (list), `apps/admin-web/src/app/
  templates/new/page.tsx` (create), `apps/admin-web/src/app/templates/[templateId]/page.tsx`
  (detail: fields + `TemplateLifecycleActions` archive button), `apps/admin-web/src/app/templates/
  actions.ts` (`createTemplateAction`, `archiveTemplateAction`).
- Supporting components: `apps/admin-web/src/components/pages/{page-status-badge,pages-pagination,
  pages-table,page-create-form,page-lifecycle-actions}.tsx`, `apps/admin-web/src/components/
  templates/{template-status-badge,templates-pagination,templates-table,template-create-form,
  template-lifecycle-actions}.tsx`.
- `templateRef`/`experienceRef`/`seoProfileRef`/`localeRef` on the page-create form, and
  `experienceRef` on the template-create form, are plain text inputs — confirmed no
  `lib/api/experiences.ts` (or any Experience read API) exists anywhere in `apps/admin-web/src/lib/
  api/` to back a picker, so per the brief they stay plain text, not built here.

## Navigation, middleware, dictionaries

- `apps/admin-web/src/components/navigation.ts` — added flat `pages` and `templates` `PRIMARY_NAV`
  entries right after `content` (the existing nav has no sub-link/grouping convention to follow —
  it's a flat list throughout, so these are flat too, matching every other domain).
- `apps/admin-web/src/middleware.ts` — verified `["/content", "operator"]` already existed (did not
  lower it); added `["/pages", "viewer"]`, `["/pages/new", "operator"]`, `["/templates", "viewer"]`,
  `["/templates/new", "operator"]` to `ROUTE_ROLE_REQUIREMENTS`.
- `apps/admin-web/src/messages/en.ts` and `.../ar.ts` — every new string added to both, in the same
  relative position in each file. New sections: `contentCreateForm`, `contentRowActions`,
  `contentPage.newContentBlock`; `pagesPage`, `pageStatus`, `pageCreate`, `pageDetail`,
  `pageLifecycle`; `templatesPage`, `templateStatus`, `templateCreate`, `templateDetail`,
  `templateLifecycle`; `nav.pages`, `nav.templates`. Since `ar.ts` is typed `Dictionary` (inferred
  from `en.ts`), a missing key would have been a compile error — typecheck passing confirms parity.
- `apps/admin-web/src/lib/i18n.test.ts` — added `contentCreateForm.formatHtml/formatMarkdown/
  formatJson` to `SHARED_VERBATIM`. "HTML"/"Markdown"/"JSON" are technical format identifiers, not
  natural-language words, and are conventionally left untransliterated in Arabic UI copy — same
  rationale as the file's existing `topbar.searchHint` ("Ctrl K") and
  `pricingPage.datetimePlaceholder` entries. Without this, the existing "is actually translated, not
  copied" test correctly flagged these three as suspicious copies.

## Global constraints checked

1. No `apps/*` file imports `services/*` — `content-lifecycle.ts`/`pages-lifecycle.ts` are
   hand-kept copies with a doc comment explaining why, not imports.
2. No domain aggregate goes on the wire from the new lib functions — `PageDto`/`TemplateDto` are
   used as specified; the 3 content-block/4 pages-and-templates write routes read at most an `id`
   off an unmapped create response (documented in each file, same discipline as
   `lib/api/products.ts`'s existing doc comment on its own write routes).
3. No fabricated data — both lifecycle tables were read from `services/content`'s and
   `services/pages`'s actual domain source, not guessed.
4. Every new user-facing string is in both `messages/en.ts` and `messages/ar.ts`.
5. No `git` commands were run (repo has no `.git` anyway).
6. No questions were asked; nothing was blocked, so `docs/plans/BLOCKERS.md` was not touched.
7. `docs/plans/PHASE-5-6-backlog.md`'s T5.9 checkbox was **not** ticked.
8. Every write action mints exactly one `Idempotency-Key` (`newIdempotencyKey()`) per invocation.
9. No fetch to the runtime API happens in a Client Component — all `getAdminApi`/`mutateAdminApi`
   calls are in Server Components or `"use server"` actions.

## Files changed

New:
- `apps/admin-web/src/lib/content-lifecycle.ts`, `.test.ts`
- `apps/admin-web/src/lib/pages-lifecycle.ts`, `.test.ts`
- `apps/admin-web/src/lib/api/pages.ts`
- `apps/admin-web/src/app/content/actions.ts`
- `apps/admin-web/src/app/content/new/page.tsx`
- `apps/admin-web/src/components/content/content-create-form.tsx`
- `apps/admin-web/src/components/content/content-blocks-table.tsx`
- `apps/admin-web/src/app/pages/page.tsx`, `new/page.tsx`, `[pageId]/page.tsx`, `actions.ts`
- `apps/admin-web/src/app/templates/page.tsx`, `new/page.tsx`, `[templateId]/page.tsx`, `actions.ts`
- `apps/admin-web/src/components/pages/page-status-badge.tsx`, `pages-pagination.tsx`,
  `pages-table.tsx`, `page-create-form.tsx`, `page-lifecycle-actions.tsx`
- `apps/admin-web/src/components/templates/template-status-badge.tsx`,
  `templates-pagination.tsx`, `templates-table.tsx`, `template-create-form.tsx`,
  `template-lifecycle-actions.tsx`

Modified:
- `apps/admin-web/src/lib/api/content.ts` (added the 3 write functions)
- `apps/admin-web/src/app/content/page.tsx` (row actions + "New content block" link)
- `apps/admin-web/src/components/navigation.ts` (`pages`/`templates` nav entries)
- `apps/admin-web/src/middleware.ts` (`/pages`, `/pages/new`, `/templates`, `/templates/new` role
  requirements)
- `apps/admin-web/src/messages/en.ts`, `apps/admin-web/src/messages/ar.ts` (new dictionary sections)
- `apps/admin-web/src/lib/i18n.test.ts` (`SHARED_VERBATIM` additions for the 3 format names)

## Verification

```
cd "D:\lumo-platform-main-main\lumo-platform-main-main"
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

- `typecheck` (`tsc --noEmit`): **0 errors**.
- `lint` (`eslint .`): **0 errors**, 1 pre-existing warning in `next.config.ts` (unrelated to this
  task — `Async method 'headers' has no 'await' expression`).
- `test` (`vitest run`): **453 passed / 453, 0 failed, 50 test files** (includes the two new
  `content-lifecycle.test.ts` and `pages-lifecycle.test.ts` files, 13 new tests total, plus the
  `i18n.test.ts` fix above).

## Concerns / follow-ups

None blocking. Two intentional, documented scope limits carried over from the brief itself:

- No picker exists for `templateRef`/`experienceRef`/`seoProfileRef`/`localeRef` — they're plain
  text id inputs, as the brief anticipated (no `lib/api/experiences.ts` or equivalent exists).
- The Content Blocks list has no detail page, by design — there is no `GET /content-blocks/:id`
  backend route to back one, same ruling the brief made explicit.

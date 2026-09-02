# Task T5.9b report — SEO (Part 2 of 3 of T5.9)

## Status: DONE

Built the SEO domain (`apps/seo`) from scratch — no frontend existed for it before this task. All
four sub-resources (profiles, redirects, sitemaps, robots policies) now have full read (list + get)
and write screens in `apps/admin-web`, wired to the already-DTO-mapped
`apps/admin/src/http/seo-routes.ts` backend, per the brief at
`docs/plans/.progress/task-T5.9b-brief.md`.

## What was built

### `lib/api/seo.ts` (new)
- DTOs mirrored exactly: `SeoProfileDto`, `RedirectDto`, `SitemapDto`, `RobotsPolicyDto` (+
  `RobotsRule`/`RobotsRuleType`).
- Read: `fetchSeoProfilesPage`/`fetchSeoProfile`, `fetchRedirectsPage`/`fetchRedirect`,
  `fetchSitemapsPage`/`fetchSitemap`, `fetchRobotsPoliciesPage`/`fetchRobotsPolicy` — same
  cursor-pagination/typed-outcome pattern as `lib/api/pages.ts`.
- Write: `setSeoProfile`, `createRedirect`, `createSitemap`, `regenerateSitemap`,
  `setRobotsPolicy` — same "read only an id off the response, let the caller `revalidatePath`"
  discipline `lib/api/pages.ts`'s doc comment establishes.

### Screens (`app/seo/*`)
- `app/seo/layout.tsx` + `components/seo/seo-sub-nav.tsx` — shared `AppShell` + sub-navigation
  across all four screens, mirroring T3.1's `SecurityLayout`/`SecuritySubNav` pattern.
- `components/seo/seo-pagination.tsx` — one shared cursor-pagination client component reused by
  all four list screens (same `{first, after}` shape and `t.seoNav` labels).
- **Profiles**: `profiles/page.tsx` (list), `profiles/new/page.tsx` (create/set form, `pageRef`
  plain text — no page picker, per the brief), `profiles/[profileId]/page.tsx` (read-only detail
  with an "Edit" link that pre-fills the set form via query params, since `POST /seo/profiles`
  create-or-updates keyed by `pageRef`). `profiles/actions.ts`, `components/seo/seo-profile-form.tsx`,
  `components/seo/seo-profiles-table.tsx`.
- **Redirects**: `redirects/page.tsx` (list), `redirects/new/page.tsx` (create only — no detail
  page, no update route exists). `redirects/actions.ts`, `components/seo/redirect-create-form.tsx`,
  `components/seo/redirects-table.tsx`.
- **Sitemaps**: `sitemaps/page.tsx` (list), `sitemaps/new/page.tsx` (create),
  `sitemaps/[sitemapId]/page.tsx` (detail: shows `urls`/`lastGeneratedAt` + the "Regenerate" form).
  `sitemaps/actions.ts`, `components/seo/sitemap-create-form.tsx`,
  `components/seo/sitemap-regenerate-form.tsx` (repeated-URL-row array, same technique
  `OrderLineItemsField`/`parseVariants` established), `components/seo/sitemaps-table.tsx`.
- **Robots policies**: `robots-policies/page.tsx` (list — each row links to the pre-filled set form
  via `?policyId=`), `robots-policies/new/page.tsx` (create/set form: `userAgent` + a repeated
  `{type, path}` rule-row array; resolves `?policyId=` server-side to pre-fill both `userAgent` and
  `rules` for editing). `robots-policies/actions.ts`, `components/seo/robots-policy-form.tsx`,
  `components/seo/robots-policies-table.tsx`.

### Navigation / middleware / dictionaries
- `components/navigation.ts`: added a `seo` `PRIMARY_NAV` entry -> `/seo/profiles` (`SearchIcon`).
- `middleware.ts`: added `["/seo/profiles/new", "operator"]`, `["/seo/redirects/new", "operator"]`,
  `["/seo/sitemaps/new", "operator"]`, `["/seo/robots-policies/new", "operator"]`,
  `["/seo", "viewer"]` to `ROUTE_ROLE_REQUIREMENTS` (longest-prefix match, same pattern as
  `/pages`/`/pages/new`).
- `messages/en.ts` / `messages/ar.ts`: added `nav.seo` plus 12 new sections (`seoNav`,
  `seoProfilesPage`, `seoProfileForm`, `seoProfileDetail`, `redirectsPage`, `redirectCreate`,
  `sitemapsPage`, `sitemapCreate`, `sitemapDetail`, `sitemapRegenerate`, `robotsPoliciesPage`,
  `robotsPolicyForm`) — every new user-facing string is in both dictionaries, `ar.ts` typed against
  `Dictionary` so a missing key is a compile error.

## Global constraints checked
1. No `packages/*`/`services/*` touched; only `apps/admin-web/*` edited.
2. DTOs kept exactly as specified — no domain aggregates on the wire.
3. No fabricated data or controls: the redirect `active` field has no route that sets it directly
   (only `POST /seo/redirects`, which creates); per the brief's explicit ruling this is treated as
   intentional (redirects are typically immutable once created), so no toggle control was built and
   **no `docs/plans/BLOCKERS.md` entry was added** — the brief says not to add one unless certain,
   and a create-only redirect resource reads as a plausible intentional design, not a gap.
4. Every user-facing string is in both `messages/en.ts` and `messages/ar.ts`.
5. No `git` commands were run (repo has no `.git`).
6. No questions were asked.
7. `docs/plans/PHASE-5-6-backlog.md`'s T5.9 checkbox was **not** ticked — that's the controller's
   job once all three sub-briefs (T5.9a/b/c) land. This report only confirms Part 2 (SEO) is done.
8. Every write action mints one `Idempotency-Key` per submit via `newIdempotencyKey()`.
9. The runtime API is only ever called from Server Actions / Server Components
   (`lib/api/seo.ts` -> `getAdminApi`/`mutateAdminApi`, both server-only), never from browser JS.

## Verification

```
$ pnpm --filter admin-web typecheck
> tsc --noEmit
(clean — no output)

$ pnpm --filter admin-web lint
> eslint .
D:\...\apps\admin-web\next.config.ts
  64:3  warning  Async method 'headers' has no 'await' expression  @typescript-eslint/require-await
✖ 1 problem (0 errors, 1 warning)
(pre-existing warning in next.config.ts, unrelated to this task's changes — 0 errors)

$ pnpm --filter admin-web test
Test Files  50 passed (50)
     Tests  453 passed (453)
```

All three commands are clean. No new `lib/api/seo.test.ts` was added — consistent with T5.9a's
precedent (`lib/api/pages.ts` also has no test file; the existing 453 tests, including
`middleware.test.ts`'s 13 role-gating tests, all still pass unmodified after the `middleware.ts`
edit).

## Files changed

New (27):
- `apps/admin-web/src/lib/api/seo.ts`
- `apps/admin-web/src/app/seo/layout.tsx`
- `apps/admin-web/src/app/seo/profiles/page.tsx`
- `apps/admin-web/src/app/seo/profiles/new/page.tsx`
- `apps/admin-web/src/app/seo/profiles/[profileId]/page.tsx`
- `apps/admin-web/src/app/seo/profiles/actions.ts`
- `apps/admin-web/src/app/seo/redirects/page.tsx`
- `apps/admin-web/src/app/seo/redirects/new/page.tsx`
- `apps/admin-web/src/app/seo/redirects/actions.ts`
- `apps/admin-web/src/app/seo/sitemaps/page.tsx`
- `apps/admin-web/src/app/seo/sitemaps/new/page.tsx`
- `apps/admin-web/src/app/seo/sitemaps/[sitemapId]/page.tsx`
- `apps/admin-web/src/app/seo/sitemaps/actions.ts`
- `apps/admin-web/src/app/seo/robots-policies/page.tsx`
- `apps/admin-web/src/app/seo/robots-policies/new/page.tsx`
- `apps/admin-web/src/app/seo/robots-policies/actions.ts`
- `apps/admin-web/src/components/seo/seo-sub-nav.tsx`
- `apps/admin-web/src/components/seo/seo-pagination.tsx`
- `apps/admin-web/src/components/seo/seo-profiles-table.tsx`
- `apps/admin-web/src/components/seo/seo-profile-form.tsx`
- `apps/admin-web/src/components/seo/redirects-table.tsx`
- `apps/admin-web/src/components/seo/redirect-create-form.tsx`
- `apps/admin-web/src/components/seo/sitemaps-table.tsx`
- `apps/admin-web/src/components/seo/sitemap-create-form.tsx`
- `apps/admin-web/src/components/seo/sitemap-regenerate-form.tsx`
- `apps/admin-web/src/components/seo/robots-policies-table.tsx`
- `apps/admin-web/src/components/seo/robots-policy-form.tsx`

Modified (4):
- `apps/admin-web/src/components/navigation.ts`
- `apps/admin-web/src/middleware.ts`
- `apps/admin-web/src/messages/en.ts`
- `apps/admin-web/src/messages/ar.ts`

## Concerns for the controller
- None blocking. The only judgment call worth flagging: robots-policy editing pre-fills via
  `?policyId=` (resolved server-side through `GET /seo/robots-policies/:policyId`) rather than
  `?userAgent=`, so the existing `rules` array is preserved on edit instead of being silently wiped
  by a re-submit that only had `userAgent` in the URL. This is a strict improvement over the
  minimum the brief asked for, not a scope change.

# Task T3.6 brief — Media asset download links

## Method (condensed)

1. Read `apps/admin/src/http/media-library-routes.ts`'s `GET /media/assets/:mediaAssetId/download-url`
   route — exact path, `schema`, `permission`.
2. Read the admin controller and the `services/media/src/interfaces/` controller to learn the
   real response shape.
3. Add `apps/admin-web/src/lib/api/media.ts` with `fetchMediaDownloadUrl(mediaAssetId)`, copying
   `apps/admin-web/src/lib/api/content.ts`'s pattern.
4. Edit the existing `apps/admin-web/src/app/products/[productId]/page.tsx` — do not create a new
   page or a media library list screen (there is no list endpoint; out of scope, see below).
5. Add every string to both `messages/en.ts` and `messages/ar.ts`.
6. No nav/middleware changes needed.
7. Test the API module (stub `global.fetch`, follow `lib/api/orders.test.ts`).

## T3.6 — Media asset download links

**Route:** `GET /media/assets/:mediaAssetId/download-url`
(`apps/admin/src/http/media-library-routes.ts`).

There is **no list endpoint** for media assets — this route takes an id you must already have.
So there is no media library screen to build in this phase.

**Scope this task to exactly one thing:** wire the download link on the product detail page's
attached-media rows, where the media asset ids are already known from the product aggregate.

1. `apps/admin-web/src/lib/api/media.ts` with `fetchMediaDownloadUrl(mediaAssetId)`.
2. In `apps/admin-web/src/app/products/[productId]/page.tsx`, render each attached media id as a
   link resolved through that endpoint.

**Deployment note:** `apps/runtime/src/api.ts` guard `M2-2` fails the boot outside `local` when
no real object storage is configured. In `local`, `InMemoryObjectStorage.getDownloadUrl()`
returns a URL template that has never pointed at real storage — so **the link will not resolve
to a file in local development**. That is expected. Do not treat it as a bug, and do not add a
fallback that hides it; render the URL the API returns.

Record in `docs/plans/BLOCKERS.md` that a media library screen needs a `GET /media/assets` list
endpoint, and that it is scheduled in Phase 4.

**Acceptance:** product media rows link to the API-issued download URL.

## Global constraints

Same as every Phase 3 task: domain aggregates never go on the wire (hand-type DTOs), never
fabricate data, every string in both dictionaries, no `git` commands, do not ask questions
(blockers → `docs/plans/BLOCKERS.md`, continue with the rest), tick `- [ ] Task complete` under
`## T3.6 — Media asset download links` in `docs/plans/PHASE-3-readonly-screens.md` when done and
verified.

Note: `products/[productId]/page.tsx` is a shared, already-populated page (Phase 1's T1.4 also
touches it, for an edit form) — read the whole current file first so your addition composes with
what's already there.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

Repo root: `D:\lumo-platform-main-main\lumo-platform-main-main`. `pnpm exec turbo` fails on this
Windows host — use the `--filter admin-web` commands directly.

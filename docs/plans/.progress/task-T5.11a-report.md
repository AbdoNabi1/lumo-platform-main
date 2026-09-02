# Task T5.11a report — Notifications + Localization (Part 1 of 2)

## Status: DONE

Both domains (Notifications, Localization) built from scratch per the brief. This is Part 1 of
T5.11 — the sibling T5.11b (Feature Flags + Experimentation) is independent and has not been
touched. **T5.11's checkbox in `docs/plans/PHASE-5-6-backlog.md` was NOT ticked** — per the brief,
the controller ticks it once both sub-briefs land. This report only confirms my part (Notifications
+ Localization) is complete.

No blockers encountered; `docs/plans/BLOCKERS.md` was not touched.

## Scope respected

Only `apps/admin-web/` was touched. `apps/admin`, `services/*`, `packages/*` were read for
reference (route files, DTOs) but never edited. No `git` commands were run (repo has no `.git`
anyway). Read `apps/admin/src/http/notifications-routes.ts` and
`apps/admin/src/http/localization-routes.ts` in full and confirmed every route/permission/
idempotent flag/zod body in the brief matches the actual source verbatim.

## Files created

### Notifications

- `apps/admin-web/src/lib/notification-lifecycle.ts` — hand-kept copy of the transition table from
  the brief, plus `canQueueFrom`/`canSendFrom`/`canRetryFrom`/`advanceableNotificationStatusesFrom`
  (same `canXFrom`/`DEDICATED_COVERED_TARGETS` pattern as `lib/fulfillment-lifecycle.ts` (T5.4) and
  `lib/review-lifecycle.ts` (T5.10)).
- `apps/admin-web/src/lib/notification-lifecycle.test.ts` — 14 tests.
- `apps/admin-web/src/lib/api/notifications.ts` — `fetchNotificationsPage`, `fetchNotification`,
  and 6 mutate functions (`createNotification`, `queueNotification`, `sendNotification`,
  `retryNotification`, `advanceNotification`, `recordNotificationCallback`).
- `apps/admin-web/src/lib/api/notifications.test.ts` — 11 tests.
- `apps/admin-web/src/components/notifications/`: `notification-status-badge.tsx`,
  `notifications-table.tsx`, `notifications-pagination.tsx`, `notification-create-form.tsx`
  (variables rendered as a repeated key/value row array, same technique as T5.9c's
  `ThemeVariablesEditor`), `notification-lifecycle-actions.tsx` (dedicated queue/send/retry
  buttons + generic advance dropdown + a callback form offered for completeness/testing).
- `apps/admin-web/src/app/notifications/actions.ts`, `page.tsx` (list), `new/page.tsx` (create),
  `[notificationId]/page.tsx` (detail — full field display including `attempts`/`history` tables).

### Localization

- `apps/admin-web/src/lib/api/localization.ts` — list/get for both `LocaleDto` and
  `TranslationSetDto`, plus 4 mutate functions (`createLocale`, `createTranslationSet`,
  `setTranslation`, `publishTranslation`).
- `apps/admin-web/src/lib/api/localization.test.ts` — 12 tests.
- `apps/admin-web/src/components/locales/`: `locales-table.tsx`, `locales-pagination.tsx`,
  `locale-create-form.tsx`.
- `apps/admin-web/src/app/locales/actions.ts`, `page.tsx` (list), `new/page.tsx` (create),
  `[localeId]/page.tsx` (detail — **read-only**, no update/delete route exists).
- `apps/admin-web/src/components/translation-sets/`: `translation-sets-table.tsx`,
  `translation-sets-pagination.tsx`, `translation-set-create-form.tsx`,
  `translation-set-translations.tsx` (translations table + upsert key/value form + a "Publish"
  action offered unconditionally per row — see Concerns below).
- `apps/admin-web/src/app/translation-sets/actions.ts`, `page.tsx` (list), `new/page.tsx`
  (create), `[translationSetId]/page.tsx` (detail).

## Files modified

- `apps/admin-web/src/components/navigation.ts` — added flat `notifications`, `locales`,
  `translation-sets` entries (confirmed `NavItem` has no grouping field, so flat matches T5.9a's
  finding the brief anticipated).
- `apps/admin-web/src/middleware.ts` — added the 6 `ROUTE_ROLE_REQUIREMENTS` entries exactly as
  specified in the brief (`/notifications` viewer, `/notifications/new` operator, `/locales`
  viewer, `/locales/new` operator, `/translation-sets` viewer, `/translation-sets/new` operator).
- `apps/admin-web/src/messages/en.ts` / `messages/ar.ts` — added every new string (`nav.*` entries
  plus `notificationsPage`, `notificationStatus`, `notificationCreateForm`, `notificationDetail`,
  `notificationLifecycle`, `localesPage`, `localeCreateForm`, `localeDetail`,
  `translationSetsPage`, `translationSetCreateForm`, `translationSetDetail`,
  `translationSetTranslations`). `lib/i18n.test.ts`'s "actually translated, not copied" check
  caught one accidentally-identical value (`localesPage.defaultNo` was "—" in both locales); fixed
  to "Not default" / "غير افتراضي".

## Verification

```
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

- **typecheck**: clean, no errors.
- **lint**: 0 errors, 1 pre-existing warning in `next.config.ts` (unrelated to this task,
  `@typescript-eslint/require-await` on an existing `headers()` method).
- **test**: 59 test files passed, 544 tests passed, 0 failed (37 new tests from this task: 14 in
  `notification-lifecycle.test.ts`, 11 in `notifications.test.ts`, 12 in `localization.test.ts`).

## Design decisions / concerns

1. **`send`/`callback` idempotency-key omission.** The brief marks both `POST
   /notifications/:id/send` and `POST /notifications/:id/callback` "Idempotent: no". Two
   conflicting precedents exist elsewhere in this codebase for non-idempotent routes:
   `lib/api/reviews.ts`'s `reportReview` (T5.10) omits the `Idempotency-Key` header entirely for
   its non-idempotent route, while `lib/api/fulfillment.ts`'s `reserveFulfillment` (T5.4) mints and
   sends a key anyway ("the backend simply won't dedupe replays by it for this route"). I followed
   the T5.10 (reviews) precedent — the more recent of the two — and omit the key for `send`/
   `callback`. This is a judgment call between two valid existing patterns; flagging it in case the
   controller prefers the T5.4 convention for consistency.
2. **Translation `status` enum.** Per the brief's explicit instruction, `TranslationSetTranslations`
   renders the "Publish" action unconditionally on every row rather than gating on a guessed status
   enum — a same-status resubmit is a harmless no-op/backend-rejected attempt.
3. **`createNotification`'s double-idempotency-field.** `idempotencyKey` is minted once via
   `newIdempotencyKey()` in `app/notifications/actions.ts` and passed to `createNotification`,
   which embeds it into both the request body (`{ ...input, idempotencyKey }`) and the
   `Idempotency-Key` header — same double-field pattern as T5.8's coupon-redeem / T5.10's
   `moderateReview`, confirmed by a dedicated test in `notifications.test.ts`.
4. **Navigation placement.** `notifications` was placed after `reviews` in the nav list (adjacent
   operational domains); `locales`/`translation-sets` were placed after `components-library` (
   content/localization tooling). Placement is my judgment — the brief did not specify exact
   ordering, only that entries exist and middleware/nav conventions are matched.

## Not done (explicitly out of scope, per brief)

- T5.11's checkbox in `docs/plans/PHASE-5-6-backlog.md` — controller's responsibility once T5.11b
  also lands.
- Feature Flags + Experimentation (T5.11b) — separate sub-brief, not touched.

# Task T5.11a brief — Notifications + Localization (read screens from scratch + write)

Part 1 of 2 covering T5.11 ("Notifications, localization, feature flags, experimentation") — split
for manageable dispatch size; T5.11's checkbox is ticked only after both sub-briefs land (the
controller does that, not you). Same write-screen recipe as every prior Phase 5 task
(`apps/admin-web/README.md`). **No frontend exists for either domain** — build both read and write
from scratch. Scope (`apps/notifications`, `apps/locales`, `apps/translation-sets`,
`lib/api/notifications.ts`, `lib/api/localization.ts`) does not overlap any earlier Phase 5 task or
its sibling T5.11b (feature flags + experimentation).

## A. Notifications — `apps/admin/src/http/notifications-routes.ts` (read in full, verbatim below)

`NotificationDto`: `{ id, idempotencyKey, sourceRef, recipientRef, channels: string[],
currentChannel, templateId, status, attempts: Array<{channel, outcome, providerRef: string|null,
occurredAt}>, history: Array<{status, occurredAt}>, deliveredAt: string|null }`.

| Route | Method | Permission | Idempotent | Body |
| --- | --- | --- | --- | --- |
| `/notifications` (create) | POST | `notifications:create` | yes | `{ idempotencyKey: string.min(1), sourceRef, recipientRef, channels: string[].min(1), templateId, bodyPattern: string.min(1), subjectPattern?: string.min(1), variables: Record<string,string>, maxAttempts: int().positive(), expiresAt?: z.coerce.date() }` — note this body carries its OWN `idempotencyKey` field, separate from the `Idempotency-Key` HTTP header; mint one value with `newIdempotencyKey()` and pass it to both, same double-field pattern as T5.8's coupon-redeem/T5.10's moderate |
| `/notifications/:notificationId/queue` | POST | `notifications:queue` | yes | none |
| `/notifications/:notificationId/send` | POST | `notifications:send` | **no** | none |
| `/notifications/:notificationId/retry` | POST | `notifications:retry` | yes | none |
| `/notifications/:notificationId/transitions` (advance) | POST | `notifications:advance` | yes | `{ toStatus: string.min(1) }` |
| `/notifications/:notificationId/callback` | POST | `notifications:callback` | **no** | `{ provider: string.min(1), callbackId: string.min(1), kind: string.min(1) }` |
| `/notifications` (list) | GET | `notifications:read` | — | `{ first?, after?, last?, before? }` |
| `/notifications/:notificationId` (get) | GET | `notifications:read` | — | — |

Notification status transition table (copy verbatim as UI-only data into a new
`lib/notification-lifecycle.ts`, commented as a hand-kept copy of
`services/notifications/src/domain/value-objects/notification-status.ts`'s `TRANSITIONS`, never
import `services/*`):
```
created: [queued, cancelled]
queued: [sent, failed, cancelled]
sent: [delivered, failed]
delivered: []
failed: [retrying, dead_letter, expired]
retrying: [sent, failed, dead_letter, expired]
dead_letter: []
cancelled: []
expired: []
```
`queue`/`send`/`retry` are dedicated actions implying specific targets (queue: created→queued;
send: queued/retrying→sent; retry: failed→retrying) — gate each by its source status(es), same
`canXFrom`/`DEDICATED_COVERED_TARGETS` pattern T5.4 established, with the generic advance dropdown
covering the residual (e.g. `queued`→`cancelled`, `failed`→`dead_letter`/`expired` directly without
retrying).

Build: `apps/admin-web/src/lib/api/notifications.ts` (list/get + 6 mutate functions),
`apps/admin-web/src/app/notifications/page.tsx` (list) + `.../new/page.tsx` (create — `variables`
is a `Record<string,string>`, render as a repeated key/value row array like T5.9c's theme
variables) + `.../[notificationId]/page.tsx` (detail: full field display including attempts/history
tables, lifecycle actions gated by the table above).

## B. Localization — `apps/admin/src/http/localization-routes.ts` (read in full, verbatim below)

`LocaleDto`: `{ id, code, name, isDefault: boolean, fallbackLocaleRef: string|null, status }`.
`TranslationSetDto`: `{ id, localeRef, namespace, translations: Array<{key, value, status}> }`.

| Route | Method | Permission | Idempotent | Body |
| --- | --- | --- | --- | --- |
| `/locales` (create) | POST | `localization:create_locale` | yes | `{ code: string.min(1), name: string.min(1), isDefault: boolean, fallbackLocaleRef?: string.min(1) }` |
| `/translation-sets` (create) | POST | `localization:create_set` | yes | `{ localeRef: string.min(1), namespace: string.min(1) }` |
| `/translation-sets/:translationSetId/translations` (upsert) | POST | `localization:set_translation` | yes | `{ key: string.min(1), value: string.min(1) }` |
| `/translation-sets/:translationSetId/translations/publish` | POST | `localization:publish_translation` | yes | `{ key: string.min(1) }` |
| `/locales` (list) | GET | `localization:read` | — | `{ first?, after?, last?, before? }` |
| `/locales/:localeId` (get) | GET | `localization:read` | — | — |
| `/translation-sets` (list) | GET | `localization:read` | — | same |
| `/translation-sets/:translationSetId` (get) | GET | `localization:read` | — | — |

No advance/delete route exists for locales or translation sets — `isDefault`/`status` on
`LocaleDto` and each translation's `status` are read-only from this task's perspective except via
the "publish" route. Do not fabricate controls for anything not listed above.

Build: `apps/admin-web/src/lib/api/localization.ts` (list/get for both resources + 4 mutate
functions), `apps/admin-web/src/app/locales/page.tsx` (list) + `.../new/page.tsx` (create) +
`.../[localeId]/page.tsx` (detail, read-only display — no locale update route exists) +
`apps/admin-web/src/app/translation-sets/page.tsx` (list) + `.../new/page.tsx` (create) +
`.../[translationSetId]/page.tsx` (detail: translations table + an "upsert translation"
key/value form + a "publish" action per translation key, gated to only offer publish on a
non-published translation — check each translation's own `status` field for what values it takes;
if unclear from the DTO alone, render the publish action unconditionally per-row and let a
same-status resubmit be a harmless no-op/backend-rejected attempt, do not guess a status enum you
haven't confirmed).

## Navigation, middleware, dictionaries

- `PRIMARY_NAV`: `notifications`, `locales`, `translation-sets` entries (or group locales +
  translation-sets under one "Localization" nav item if `navigation.ts` supports grouping — check
  first, match whatever convention exists, likely flat per T5.9a's finding).
- `middleware.ts`: `["/notifications", "viewer"]`, `["/notifications/new", "operator"]`,
  `["/locales", "viewer"]`, `["/locales/new", "operator"]`, `["/translation-sets", "viewer"]`,
  `["/translation-sets/new", "operator"]`.
- Every new string in both `messages/en.ts` and `messages/ar.ts`.

## Global constraints (every Phase 5 task)

1. `packages/*`/`services/*` never import from `apps/*`; copy the notification transition table as
   data.
2. Domain aggregates never go on the wire — both DTOs above are already correctly typed.
3. Never fabricate data — the "no locale/translation-set update or delete route" note is this rule.
4. Every user-facing string in both dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Do NOT tick T5.11's checkbox yourself — the controller ticks it once both sub-briefs land. Note
   in your report that your part (Notifications + Localization) is complete.
8. One `Idempotency-Key` per user-initiated submit (see the notification-create double-field note
   above for the one exception where a value is also needed in the body).
9. Never call the runtime API from browser JS.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

## Report

Write your full report to `docs/plans/.progress/task-T5.11a-report.md`. Return to the controller
only: status, files changed, one-line test summary, concerns.

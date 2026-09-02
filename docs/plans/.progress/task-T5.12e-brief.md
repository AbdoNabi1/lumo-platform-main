# Task T5.12e brief — Security write actions: Sessions & Authentication (session revocation tier)

Part 5 of 6 covering T5.12. See `docs/plans/.progress/task-T5.12b-brief.md`'s "Revised split"
section. This part is the plan's explicit **"session revocation"** high-blast-radius category —
the single largest remaining part (~17 write routes across sessions/auth-methods/devices/MFA/risk)
— dispatch only after T5.12a/b/c/d have landed, and only before T5.12f (Authorization, the very
last part). T5.12's own checkbox is ticked only after all 6 parts land — do not tick it yourself.

Same write-screen recipe as every prior Phase 5 task. Extends the existing
`apps/admin-web/src/app/security/sessions/page.tsx` (Phase 3 T3.1, read-only) and
`apps/admin-web/src/lib/api/security.ts`. **Read the existing page fully first**, and read
`apps/admin/src/http/security-sessions-routes.ts` in full yourself (332 lines) — this brief
summarizes it; the file itself is the authority for exact zod shapes.

## Routes — grouped by sub-area, all in `security-sessions-routes.ts`

**Sessions** (the literal "session revocation" controls — treat these as the highest-risk group in
this part):
- `POST /security/sessions` (establish) — `security:establish_session`, idempotent
- `POST /security/sessions/:sessionId/refresh` — `security:refresh_session`, idempotent
- `POST /security/sessions/:sessionId/revoke` — `security:revoke_session`, idempotent. **Confirm
  before submit.**
- `POST /security/principals/:externalId/sessions/revoke-all` — `security:revoke_all_sessions`,
  idempotent. "Force logout everywhere" — **the highest-blast-radius control in this part; confirm
  with an explicit dialog naming the principal.**
- `GET /security/sessions/:sessionId/introspect` — already wired read-only, do not touch.

**Auth methods & authentication:**
- `POST /security/auth-methods` (register/update) — `security:register_auth_method`, idempotent,
  body has an 11-value `kind` enum (`password`/`passkey`/`magic_link`/`otp`/`email_verification`/
  `phone_verification`/`oauth`/`oidc`/`saml`/`ldap`/`enterprise_sso`) — render as `<select>`.
- `POST /security/authenticate` — `security:authenticate`, not idempotent. This is a
  simulation/testing tool for this console (real authentication happens outside the admin app) —
  treat as a "try it" preview panel, no `revalidatePath`.

**Devices:**
- `POST /security/devices` (register) — `security:register_device`, idempotent
- `POST /security/devices/:fingerprint/signals` (record) — `security:record_device_signal`, not
  idempotent
- `POST /security/devices/:fingerprint/trust` — `security:trust_device`, idempotent
- `POST /security/devices/:fingerprint/block` — `security:block_device`, idempotent. Confirm
  before submit.

**MFA:**
- `POST /security/mfa/enrollments` (enroll) — `security:enroll_mfa`, idempotent
- `POST /security/mfa/enrollments/:enrollmentId/verify` — `security:verify_mfa_enrollment`,
  idempotent
- `POST /security/mfa/enrollments/:enrollmentId/backup-codes` (generate) —
  `security:generate_backup_codes`, not idempotent. **The response returns codes once — display
  them prominently in the success state with a copy affordance/selectable text, since they cannot
  be retrieved again; do not let this success state look like every other silent-success form.**
- `POST /security/mfa/enrollments/:enrollmentId/revoke` — `security:revoke_mfa`, idempotent.
  Confirm before submit.
- `POST /security/mfa/decide` — `security:decide_mfa`, not idempotent, "read-only" per its own
  summary despite being a POST — a simulation/preview panel (what MFA would this risk band
  require), not a mutation.
- `POST /security/mfa/methods` (register/update) — `security:register_mfa_method`, idempotent,
  5-value `kind` enum (`totp`/`webauthn`/`sms_otp`/`email_otp`/`backup_code`).

**Risk:**
- `POST /security/risk/evaluate` — `security:evaluate_risk`, not idempotent, a preview/explainer
  tool ("explainable factors") — no `revalidatePath`.

`security/console/session-explorer`, `security/console/device-explorer`, `security/console/
risk-explorer` (all GET) are already wired read-only — do not touch them.

## What to build

1. `apps/admin-web/src/lib/api/security.ts` (existing, append) — one typed mutate function per
   write route above (17 total), following the established `isUnknown`-unless-DTO-mapped pattern.
2. `apps/admin-web/src/app/security/sessions/page.tsx` — organize into clearly-labeled sub-sections
   matching the grouping above (Sessions / Auth Methods & Authenticate / Devices / MFA / Risk), each
   with its forms. This is a lot of UI for one page — it's fine (and expected) for this to be a
   long screen; do not artificially split it into multiple routes, this is one console screen with
   many sub-sections, matching T5.9b's SEO sub-nav precedent if you'd rather add a light in-page
   sub-nav for the 5 groups (your call, keep it simple — a single scrollable page with clear
   `<h2>`s per group is also fine).
3. Every new string in both `messages/en.ts` and `messages/ar.ts`. No nav/middleware changes
   needed.

## Global constraints (every Phase 5 task, security tasks especially)

1. `packages/*`/`services/*` never import from `apps/*`.
2. Domain aggregates never go on the wire.
3. Never fabricate data.
4. Every user-facing string in both dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Do NOT tick T5.12's checkbox yourself — one more part (Authorization) remains after this one.
8. One `Idempotency-Key` per user-initiated submit, regardless of the route's own `idempotent`
   flag.
9. Never call the runtime API from browser JS.
10. Every write control is `admin`-only. **This part is the plan's named "session revocation"
    high-blast-radius category** — `revoke`/`revoke-all`/`block`/`revoke MFA` must all be
    confirmed before submit, `revoke-all` (force logout everywhere) most emphatically so. Backup
    codes are a secret shown once — never log them, never persist them client-side beyond the
    success render.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

## Report

Write your full report to `docs/plans/.progress/task-T5.12e-report.md`. Return to the controller
only: status, files changed, one-line test summary, concerns.

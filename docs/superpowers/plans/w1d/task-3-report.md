# Wave 1d — Task 3 report (admin-web: Users and permissions, accept-invite, owner-only state)

Branch `morbeh/shopify-parity-w1d` (draft PR #19), on top of `48b69fe8`. UI only: no backend change, no migration, nothing pushed.

## Commits (hooks ran: lint-staged eslint --fix + prettier, commitlint; nothing skipped)

1. `80b5180d` feat(admin-web): staff api client, server actions and users messages
2. `0ae16b45` feat(admin-web): users and permissions page, table and dialogs
3. `ad593712` feat(admin-web): accept-invite page, submit route and sign-in notice
4. `4fa32c77` feat(admin-web): owner-only state on the security console for a 403
5. `74bb2353` fix(admin-web): report a 403 on reads only for the owner-only pages (found by the full-suite run)

Not staged (not mine): `apps/admin-web/src/components/customers/*` line-ending noise, `docs/*`. This report is uncommitted.

## Backend contract read first (committed code wins; every difference from the plan text)

- Routes as planned (`staff-routes.ts`): `GET /staff`, `POST /staff/invitations`, `.../:id/resend`, `.../:id/revoke`, `POST /staff/:principalExternalId/role` and `/active`. Bodies strict. Success bodies: invite 201 `{ invitationId, principalExternalId }`; resend 200 `{ invitationId, version }`; revoke 200 `{ invitationId }`; role 200 `{ role }`; active 200 `{ status: "active" | "deactivated" }`.
- Errors are the FLAT envelope `{ code, message, retryable, fields }`: 503 `NOT_CONFIGURED` ("Email isn't set up, so invitations can't be sent"), 502 `EMAIL_FAILED` (retryable), 410 `INVITATION_INVALID`, 429 `RATE_LIMITED`. (Task 2 deviation 93 about a nested 503 was fixed in fix round 1; I read the flat shape.) `mutateAdminApi` already maps 502/503 to `outcome: "error"` with `status` + `code`, so no client change was needed for them.
- Exact 409/BUSINESS_RULE sentences, all mapped (en + ar): "The store owner's role can't be changed", "You can't change your own role", "A store needs at least one admin", "The store owner can't be deactivated", "You can't deactivate yourself", "Revoke the invitation instead", "This person is already on your staff", "This email already has a pending invitation", "This email is already used by another store", "This invitation was changed by someone else". Also mapped two real sentences the plan list lacks: "Only a pending invitation can be resent" / "...revoked" (BUSINESS_RULE 409, from `staff-invitation.ts`) -> `notPending`. Any other 409 -> `t.formErrors.conflict`.
- Last-admin 409 is unreachable (Task 1 deviation 4); a race loser gets **403**, which `mutateAdminApi` returns as `forbidden`; the dialogs show `formErrors.forbidden` ("Your account doesn't have permission to do this.") in the open dialog. Tested (change-role dialog and deactivate dialog).
- Accept routes: staff `POST /public/auth/staff/invitations/accept` `{ token, password }`; merchant `.../merchant/invitations/accept` `{ store, token, password }`; both uniform 410, 422 on `password`, 429 `RATE_LIMITED`. Both are public and read the tenant header; the page posts with `nativeTenantId()` exactly like reset-password.

## Differences from the Task 3 text

1. **`getAdminApi` gained an opt-in `{ reportForbidden: true }`** (third argument). With it a 403 returns `{ outcome: "unauthorized", status: 403 }` (a 401 never carries a status); WITHOUT it every caller gets exactly the old `{ outcome: "unauthorized" }`. The plan says "use the `status` on the GET error branch if present", but a 403 never reached that branch (it collapsed to `unauthorized`), so the owner-only state could not tell 403 from 401. My first version changed the 403 result for everyone; the full admin-web run caught five older tests (collections, customers x2, media, store-domains) that pin the exact result, so I made it opt-in instead and left those tests untouched (commit 5). `fetchStaff` and every console read in `lib/api/security.ts` opt in (a local `getAdminApi` wrapper there; 25 call sites unchanged; the `unauthorized` result types gained `status?` and a small `unauthorizedOf` helper keeps it through `toSimpleResult`).
2. **Role control is a radio group, not a `<select>`**: the plan wants one-line role descriptions, which a native select cannot show. `<fieldset>` + native radios (keyboard + RTL for free).
3. **Reactivate acts at once** (no confirm; only Deactivate and Revoke are destructive, as the plan says) and shows a success notice. Resend likewise.
4. **Change role is a Dialog** (the plan allowed submenu or Dialog).
5. **Accept submit is a route handler** `app/accept-invite/submit/route.ts` (`/accept-invite` prefix is public, so no separate middleware entry); same structure as `app/auth/reset/route.ts`. Weak password (outside 8..256) and mismatch are checked in the route before any request. A dead link (410) is redirected back WITHOUT `token`/`store` in the query so a dead token is not echoed; retryable errors (weak/limited/unavailable/mismatch) keep it, like reset-password.
6. Login: `?invited=1` shows "Your account is ready. Sign in." (en + ar in the page's existing bilingual style). An error outranks the notice; only the exact value `1` triggers it.
7. 502 flow: the invitation IS saved, the dialog closes, a warning banner (`role="alert"`) shows with Resend. The server action does not return the new invitation id (the 502 body has none), so Resend is disabled until the refreshed list contains the saved invitation, then uses its id + version. 503 stays inline in the dialog (nothing written, no Resend).
8. Banner/notice emails are in `<bdi dir="auto">` too.

## Files

Client / logic: `lib/api/staff.ts` (+test), `lib/api/client.ts` (+test), `lib/api/security.ts`, `lib/staff/errors.ts` (+test), `lib/staff/last-signed-in.ts` (+test), `lib/security/owner-only.ts` (+test), `lib/auth/invitation.ts` (+test).
Users page: `app/settings/users/{page,actions}.tsx|ts` (+tests), `components/settings/users/{staff-panel,staff-table,staff-row-actions,staff-dialog,invite-staff-form,change-role-form,role-choice,with-email}.tsx`, `staff-panel.test.tsx`.
Accept: `app/accept-invite/{page.tsx,page.test.tsx,submit/route.ts,submit/route.test.ts}`; `app/login/{page.tsx,native-login-form.tsx,native-login-form.test.tsx}`; `middleware.ts` (+`/accept-invite` in `PUBLIC_PREFIXES`).
Nav/oracles: `components/settings/settings-nav.tsx` (users `available: true`), `settings-nav.test.tsx`, `app/settings/[section]/page.test.tsx`, `middleware.test.ts`; `messages/{en,ar}.ts` (`settingsNav.users` = "Users and permissions" / "المستخدمون والصلاحيات", new `users.*`, `securityOwnerOnly.message`).
Security pages (O6): `app/security/{page,access,ai-governance,audit,identity,secrets,sessions}/page.tsx`, new `app/security/page.test.tsx`.

## Test case -> test name -> result (all PASS)

- Client paths/guards: `lib/api/staff.test.ts` (17): "isStaffMemberView accepts exactly the shape" + 8 refusal rows; "fetchStaff GETs /staff…", "refuses a malformed row", 403 keeps `status`; "inviteStaff POSTs…one Idempotency-Key"; "resend and revoke encode the id and send the loaded version"; "changeStaffRole and setStaffActive encode the principal id"; "keeps a 409's exact message and a 503 / 502's code and status"; "refuses a success body of the wrong shape". `lib/api/route-contract.test.ts` (unchanged, green: all 6 new paths exist in `adminRoutes()`). `client.test.ts` 403 case.
- Actions revalidate on ok + every error: `app/settings/users/actions.test.ts` (65): per action x5 "fresh Idempotency-Key per invocation", "revalidates the page after a success", `it.each` unauthorized/forbidden/not_found/error/unknown-409 "revalidates the page after %s too", Arabic; arg refusals revalidate nothing and call nothing; the 10 exact 409 sentences -> en and ar; 503 NOT_CONFIGURED, 502 EMAIL_FAILED (code carried), 422 email, 422 other.
- Invite Dialog: `staff-panel.test.tsx` "the invite dialog" (9): opens titled/described, focus in email, role descriptions; Escape -> focus Add staff; validation before send (empty and malformed never reach the action); sends trimmed email + role, closes, announces; 409 inline and input kept; 422 under the field; 503 text inline; 502 closes + banner + Resend (disabled until list refresh, then calls `resendInvitationAction("inv-new", 1)`); pending -> busy/disabled, Escape closes, reopen shows the same single request.
- Table: "the staff table" (6): every status badge + roles + last signed in + Owner badge; owner and self rows have NO actions (checked on `document.body`); bdi emails; menu contents per status (4 rows); no internal id/invitation id/secret strings in the DOM; Arabic render (headings, badges, "(أنت)", dialog description regex) with bdi.
- Deactivate/Revoke contract: "the deactivate confirmation" (7) + "resend and revoke" (5) + "focus after the revoked row disappears" (5): title+description with bdi email; focus on Cancel not the destructive button; Escape and Cancel restore focus to the row's still-mounted button; confirm sends once; pending busy + Escape/Cancel close + no duplicate request; 403 text inside the dialog; error after Escape goes to the page notice and does not reopen; revoke focus -> next surviving row, else previous, skips actionless rows, else Add staff, Escape-racing-success lands on a survivor, `document.body` never focused.
- Page: `app/settings/users/page.test.tsx` (4): frame + current nav entry; Arabic; 403 says only a store admin can manage staff (no table/Add staff); 401 / load error / not_found.
- Nav/oracles: `settings-nav.test.tsx` (label row "Users and permissions", UNAVAILABLE 9 -> 8, Soon badges 8, Arabic labels); `[section]/page.test.tsx` (`users` removed from coming-soon cases and now calls `notFound`; frame test uses `checkout`); `middleware.test.ts` (`/accept-invite` and `/accept-invite/submit` public with no jwt check; `/settings/users` admin-only: operator and viewer -> /forbidden, admin passes; placeholders list minus users).
- Accept: `app/accept-invite/page.test.tsx` (13): no-referrer metadata; non-native -> /login; form posts to `/accept-invite/submit` with hidden token/store only, password fields 8..256 + new-password; no store field without store; token never in visible text, links or any attribute other than the hidden input value; no token -> invalid state with no form; mismatch/invalid/weak/limited/unavailable messages bilingual; unknown error code echoes nothing. `submit/route.test.ts` (12): merchant route with store, staff route without, success -> 303 `/login?invited=1`; mismatch and short/long password never reach the API; 410 returns WITHOUT token; retryable codes keep the link and never the password; missing token; non-native. `lib/auth/invitation.test.ts` (12): URLs, bodies, status mapping, network failure. `native-login-form.test.tsx` (+2): `?invited=1` notice en + ar; other values and error precedence.
- O6: `app/security/page.test.tsx` (5): three cards say "Only the store owner can open this page." on a mocked 403; Arabic string; 401 keeps "sign in"; 500 keeps the generic error and never claims owner-only; mixed 403/ok/error per card. `lib/security/owner-only.test.ts` (2). Mutation check: replacing the `status === 403` branch with the fallback fails 4 tests (reverted).
- `expect.hasAssertions()` is in a `beforeEach` of every new suite or in each test; dialogs and non-disclosure use `within(document.body)`.

## Real output tails

```
vitest run settings staff accept-invite login middleware route-contract i18n security --maxWorkers=1 --minWorkers=1 --no-file-parallelism
  Test Files  44 passed (44)   Tests  587 passed (587)
tsc --noEmit --incremental false (admin-web)  -> no output (exit 0)
eslint --max-warnings=0 on all 48 files changed since 48b69fe8 (apps/admin-web) -> exit 0, no warnings
```

Full admin-web vitest run (after commit 5): Test Files 336 passed (336), Tests 3954 passed (3954). The first full run (before commit 5) had 5 failures in 4 older files, all caused by my first 403 approach; fixed.

## Gaps and notes

- Red phase: the oracle tests (nav, section page, middleware accept-invite) were edited first and failed (6 failures seen) before the implementation; `staff.test.ts` was written before `staff.ts`. The component, page, accept and security tests were written together with or right after the code, not red-first; the O6 mutation check stands in for that one.
- Focus after a Radix menu item opens a dialog is handled with a shared `keepFocusAway` flag so the menu does not steal focus back; covered by the "returns focus to the row's button" tests in jsdom, not verified in a real browser (no `next build` / browser run, by rule).
- "Last signed in" is a relative phrase for the last 30 days (Intl.RelativeTimeFormat) then a medium date; `nowIso` is taken once on the server render.
- The Users page is not linked from anywhere else; the Settings nav entry is the only door. The signed-in member's own change-role/deactivate are hidden (server still refuses with 409).
- The other `app/security/**` sub-pages share the same helper; only the overview page has a dedicated 403 test (as the plan asks for one representative).
- Invite does not pre-validate against the 254-character server limit beyond the same regex (the server is the authority).

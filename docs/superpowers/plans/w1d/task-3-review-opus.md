# Task 3 review (Opus, per owner ruling)

Range 48b69fe8..74bb2353 (5 commits, 48 files +3946). Re-ran on HEAD: admin-web settings/staff/accept-invite/login/middleware/route-contract/i18n/security 44 files / 587 pass. Implementer: full admin-web 336 files / 3954 pass, tsc clean, eslint --max-warnings=0 on all touched files.
Read: accept-invite submit route (token only in the form body; a dead link is not echoed back; password never in a URL; merchant route when store present else staff, same x-tenant-id pattern as reset), lib/auth/invitation.ts (uniform 410 → invalid), getAdminApi opt-in reportForbidden (other callers unchanged), PUBLIC_PREFIXES + /accept-invite.
Deviations accepted: opt-in 403 reporting; radio group for roles (shows descriptions); change-role Dialog; route-handler submit; 502 Resend enabled once the refreshed list has the invitation.
Not verified: real-browser focus behaviour between the dropdown menu and dialogs (jsdom only).
SPEC: COMPLIANT
QUALITY: APPROVED

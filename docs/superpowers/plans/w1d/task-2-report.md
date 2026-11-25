# Wave 1d — Task 2 report (apps/admin + tenancy + runtime)

Branch `morbeh/shopify-parity-w1d` (draft PR #19), on top of `50061622`. Packages: `@platform/admin`, `@platform/tenancy`, `@platform/runtime`, `@platform/auth`, `@platform/security` (names as in the plan). No schema change, no migration, no DB contact. Nothing pushed.

## Commits (hooks ran: lint-staged eslint --fix + prettier, commitlint; nothing skipped)

1. `922602ef89b830fab4dd3426d8a6fe40a3d4de91` feat(tenancy): reserve and release a staff email in the store directory (9 files, +413)
2. `89bb238069b8deb3c145147890fc67f987830aec` feat(admin): bilingual staff invitation email template (2 files)
3. `29a63b6dbb663819b32a9befeb2939006a237316` test(auth): staff permissions are admin-only in the role table (1 file)
4. `6dcce5ecaea2b9404fa70f6c0a59f635b54115cd` feat(admin): users and permissions API, live staff access and invitations (15 files, +2643/-9)
5. `328f011692896d5ae809503a71ba15f265133833` feat(runtime): staff invitations need a real email delivery (3 files)

(First attempt of commit 4 was rejected by the pre-commit hook: eslint `no-this-alias` in a test; fixed, no `--no-verify`. First attempt of commit 1 was rejected by commitlint body-line-length; fixed.) Uncommitted and not mine: `docs/superpowers/plans/*` (plan, progress, w1b files) and this report.

## Files

Tenancy (`services/tenancy/src`): `domain/staff-directory.ts` (`createActive`, `withOwner`), `domain/repositories.ts` (`delete(entry, tx?) -> boolean`, a compare-and-delete), `infrastructure/in-memory-repositories.ts`, `infrastructure/prisma-repositories.ts` (`deleteMany` where email + tenantId + shopRef + ownerExternalId), `application/staff-directory.use-cases.ts` (`ReserveStaffEmail`, `ReleaseStaffEmail`), `interfaces/tenancy.controller.ts` (`reserveStaffEmail`, `releaseStaffEmail`), `composition.ts`. Tests: `application/staff-email.use-cases.test.ts` (12), `infrastructure/prisma-staff-directory-delete.test.ts` (2).

Admin (`apps/admin/src`): `interfaces/staff.admin-controller.ts` (new), `interfaces/live-staff-access-control.ts` (new: `LiveStaffAccessControl`, `securityStaffAccessReader`), `interfaces/staff-auth.admin-controller.ts` (`TOKEN_ROLE` exported, nothing else), `infrastructure/email-templates.ts` (`staffInviteEmail`), `http/staff-routes.ts` (new), `http/admin-routes.ts` (spread next to `customerSegmentRoutes`), `http/public-staff-auth-routes.ts` + `http/public-merchant-routes.ts` (accept routes), `http/server.ts` (HTTP guard uses `admin.liveAccessControl`; unused `AllowAllAccessControl` import removed), `composition.ts` (`staffInviteEmailSender` dep; one `LiveStaffAccessControl` built before the facade `AdminGuard`; `WiredAdmin.staff`, `WiredAdmin.liveAccessControl`).

Runtime (`apps/runtime/src`): `email-wiring.ts` (`deliveryConfigured`, `staffInviteDelivery`), `api.ts` (spreads `staffInviteDelivery(email, runtime.config)`).

## Test cases -> test names -> result (all PASS)

Tenancy (`staff-email.use-cases.test.ts`, `prisma-staff-directory-delete.test.ts`; red observed first)

- Reserve: unknown email -> `active` row, normalised -> "inserts an ACTIVE row (not pending)..."; same shop+owner no-op; other owner same shop refused without `replaceSameShop`; `replaceSameShop` takes over (status kept); another shop's row never touched even with `replaceSameShop`; malformed email -> validation, nothing written; parallel reservations for two shops -> exactly one wins.
- Release: deletes only when email+shop+owner match; keeps on owner mismatch; keeps another shop's; no-op when absent; removes a matching pending row. Prisma `delete` is a compare-and-delete on all four columns.

Email (`email-templates.test.ts`, 5): link once, both languages, role in both, "7 days"/"٧ أيام"; store name when known; omitted cleanly for `null`; "ignore"/"تجاهل" in both; `passwordResetEmail` unchanged.

Role table (`role-table-access-control.test.ts`, +1): `staff:read|invite|change_role|deactivate` allowed for admin and platform-admin, denied for operator, viewer and no role (G5; no role-table edit).

`live-staff-access-control.test.ts` (22): non-staff untouched (no read); unknown (null) -> denied; suspended -> denied without asking inner; active -> inner decides with token roles; role removed -> denied after `invalidate` on the same instance (same instance still allowed before); TTL 29 999 ms cached / 30 001 ms re-read (fake clock); deactivated -> denied after invalidate; token never widened (snapshot admin, token viewer -> still viewer; token admin, snapshot viewer -> dropped); reader throws -> denied, not cached, next call retries; per-(tenant,id) cache; oldest evicted past the cap; an `invalidate` during an in-flight read is not overwritten by the stale read; owner-only (R5): invited admin denied `security:*`, `users:*`, `memberships:*`, `organizations:*` but not `orders:*`/`staff:*`; owner (platform-admin) allowed; operator/viewer denied; `security:authenticate` exempt (O4); look-alike resource names not caught; reader maps 404 -> null, active -> roles via `TOKEN_ROLE` + raw `roleKeys`, suspended/disabled -> `active:false`, other status/rejection -> throws.

`staff-routes.test.ts` (39; real `createAdminHttpApi`, `tenantMode: "multi"`, real merchant sign-up for stores Alpha and Beta, real `RoleTableAccessControl`, `JwtVerifier` + `NativeTokenIssuer`, injected `HashedPasswordAuthProvider`, recording `EmailSender`; every member is created by invite -> emailed link -> accept -> sign-in)

- list: owner first / isSelf / emails asc, no token/hash/password in the body; tenant-scoped.
- operator and viewer 403 on all 6 staff routes with state unchanged and nothing emailed; an invited admin may use them.
- invite: 201 `{invitationId, principalExternalId}` only, one email to the normalised address with `accept-invite?token=` + `store=<tenant>`, listed `invited`; same email again 409 "already has a pending invitation", existing member / owner 409 "already on your staff"; other store's email 409 "already used by another store" with no principal created, store B's directory row intact and its owner still merchant-signs in; 422 for bad shape/role/unknown key with no reservation call; email sender throws -> 502 `EMAIL_FAILED`, invitation listed, Resend delivers a working link; no delivery capability -> 503 `{error:{code:NOT_CONFIGURED,...}}`, list unchanged, zero reserve calls, no email, resend 503 too; an invited admin can invite.
- accept (staff public route): 200 `{}`, staff login 200 and merchant login 200 (before accept both 401), replay 410 and first password not overwritten, the new operator's token works on an operator route and 403s staff routes; uniform 410 (identical body) for unknown token / other store's tenant / malformed / 512-char; unknown store id never reaches the route (tenant gate 403); 7-char and 257-char password 422 on `password` and the link still works; 7 d + 1 s -> 410, listed `invitation_expired`, Resend revives it, old link 410, new link 200; 11th attempt per token 429; merchant twin: 403 on a non-platform tenant, 200, replay 410, 11th 429; plain staff and merchant reset-request for an invited email -> 202 and nothing sent, invitation still acceptable.
- resend: new email, old link 410, new link 200, `{invitationId, version: 2}`; stale version 409 with the plain text, unknown or other store's invitation 404, nothing emailed. revoke: gone from list, directory row released, link 410, re-invite same email 201 (new principal), old link still 410; revoke with a failing release still 200 and the next invite replaces the leftover row.
- injected failures: `createStaffInvitation` throws / answers 500 -> failure returned, reservation released, nothing listed or emailed, next invite 201; failure + failing release -> leftover row, next invite recovers (201).
- live revocation (existing tokens): operator -> viewer: old token loses operator routes immediately (403 on `POST /customer-segments`, and narrows to nothing, never widens to viewer), fresh sign-in is a viewer; viewer -> admin: old token not widened, fresh token is admin; deactivate: existing token 403 on plain `GET /customers` and `GET /staff`, staff and merchant login 401, listed `deactivated`; reactivate: login works; idempotency replay of an earlier 201 by the deactivated member is 403 (control: replay is the cached 201 while active); self/owner protections 409 with the plain texts and nothing changed; invited target "Revoke the invitation instead"; another store's principal id 404 for role and active, nothing changes there.
- owner-only with an ACCEPTED invited admin: 403 on `POST /security/role-assignments` (grant `platform-admin` to self), `/security/role-assignments/:id/revoke`, `/security/principals/:owner/transitions`, `/security/principals`, `/memberships`, `/users`, `/organizations`; operator and viewer 403 too; list unchanged, still exactly one owner; the owner passes the same guard (422/404, not 403); a staff token on the public sign-in route behaves as before (200 right password, 401 wrong, for admin/viewer/garbage tokens).
- customer and service tokens: 403 as before with no `staffAccess` lookup; a public route needs no token and no lookup.

`staff-live-access-wiring.test.ts` (5): one live instance on `WiredAdmin`; the FACADE guard denies a deactivated member at once and allows after reactivation; role change seen by the facade, token never widens; invited admin denied `security:*`, owner allowed; with no native issuer the control is a pass-through; no delivery capability -> 503 and nothing written.
`public-staff-auth-routes.test.ts` (+4) and `public-merchant-routes.test.ts` (+4): public/not idempotent/`security:authenticate`, strict structure, uniform 410 and 422, limit 10 per 15 min keyed by a sha256 of the token (token never in the key), merchant gate 403/503, store taken from the body.
`email-wiring.test.ts` (runtime, +6; red observed first): `deliveryConfigured` false without a key (logging sender) and true with Resend; `staffInviteDelivery` passes the sender only with real delivery AND `ADMIN_PUBLIC_URL`; the admin composed the way runtime composes it answers invite 503 with zero writes (no key; key without URL) and 201 with exactly one Resend call (key + URL).

Mutation checks (tests bite): HTTP guard reverted to the raw `deps.accessControl` -> the replay test and the owner-only test fail; owner-only line removed -> the unit test and the e2e adversarial test fail. Both reverted.

## Real output tails

```
admin  vitest run staff live-staff email-templates public-merchant public-staff security admin-http.e2e customer
  Test Files  21 passed | 1 skipped (22)   Tests  364 passed | 21 skipped (385)
admin  vitest run (FULL)         Test Files  155 passed | 1 skipped (156)   Tests  1745 passed | 21 skipped (1766)
tenancy vitest run               Test Files  14 passed | 1 skipped (15)     Tests  93 passed | 2 skipped (95)
auth   vitest run role-table     Test Files  1 passed (1)                   Tests  19 passed (19)
runtime vitest run email         Test Files  2 passed (2)                   Tests  11 passed (11)
security vitest run              Test Files  53 passed | 6 skipped (59)     Tests  336 passed | 23 skipped (359)
tsc --noEmit --incremental false: admin, runtime, tenancy -> exit 0, no output
pnpm arch -> ✔ no dependency violations found (3751 modules, 16374 dependencies cruised)
tenant scanner -> {"violations":[],"stale":[],"open":[]}
```

The 21 admin skips are the pre-existing DB-gated ones; the 1 skipped file is pre-existing. No failing test remains. The full-suite run was done twice (before and after the commit-time prettier pass): same counts.

## What the FIRST full-suite run found (explained, then fixed by a decision to flag)

With the live control always on, the full admin suite had 605 failures in 74 files: almost every HTTP/e2e test authenticates with a fabricated `{ kind: "staff", id: "staff-1" }` principal that does not exist in Security, and the live check (correctly, per the plan) denies a staff principal Security does not know. See deviation 1.

## Deviations from the plan text (committed code and the amendments win; every difference)

1. **The live check is ON only under native sign-in** (`enabled: deps.staffTokenIssuer !== undefined`; `LiveStaffAccessControl` option `enabled`, default `true`). The plan says `wireAdmin` always wraps. Reasons: (a) with Ory/Keto auth (`AUTH_MODE != native`) staff ids and roles live in the IdP, Security's tables do not know them, and an always-on lookup would lock every staff member out of the admin; (b) the 605 fixture failures above. There is still exactly ONE instance, still exposed as `WiredAdmin.liveAccessControl`, still shared by both guards; when disabled it is a plain pass-through (the owner-only rule is off too: there are no invitations without native sign-in). **Owner/Opus please confirm or reverse**; the alternative is always-on plus a reader seam injected in ~74 test harnesses.
2. One existing test fixture changed: `merchant-onboarding.test.ts` `operator` principal `kind: "staff"` -> `"service"` (it is "any principal" against the default allow-all control; with an issuer wired a fake staff principal is looked up and denied).
3. `StaffAdminController` deps: `directory` (a closure port with `find/reserve/release`) instead of `tenancy: <controller>` (the multi-tenant boot check walks the graph for `tenantId`; closures are the repo's convention, like `customerSegments`); no `passwordReset`/`passwordRegistrar`/`emailSender` (R6: Security accepts and hashes the password); `staffInviteEmailSender` + `adminPublicUrl` drive the 503 precondition (R1). `idGenerator`/`logger` not injected: `randomUUID()` and the shared `logger`.
4. Invite does a `listStaff` pre-check for the two 409 texts (as the amendment says) and ALSO remembers the directory row it is about to replace (`find`), and on a failed `createStaffInvitation` restores that row (same shop, previous owner) instead of releasing it. This protects an existing member whose `staff:` credential has no staff role (not listed, so the pre-check misses them). Not in the plan; covered by the release path tests, the restore branch itself has no dedicated test.
5. `ReserveStaffEmail` keeps the existing row's status when it replaces the owner (a same-shop leftover is `active`); `ReleaseStaffEmail` answers `{ released: boolean }` and treats a malformed email as a no-op success. Repository gained `delete(entry, tx?) -> boolean` (compare-and-delete). `StaffDirectoryEntry.createActive` and `withOwner` added.
6. `staffInviteEmail` contains the link ONCE (the task text asks for that; the password-reset template has it twice). Arabic copy is Egyptian-dialect like the existing templates.
7. Accept mapping: Security 404 or 409 -> uniform 410 `{code:"INVITATION_INVALID", message, retryable:false, fields:[]}` (flat envelope like the other public errors); 422 passes through untouched (field `password`); anything else passes through. The staff accept route buckets by `context.tenantId`, the merchant twin by `body.store`, both by sha256 of the token.
8. The plan's "self/owner/last-admin -> 409" test: last-admin is unreachable through the commands (Task 1 deviation 4: the actor re-check keeps the actor an admin); the test covers self (role and active), owner (role and active) and the invited target instead. A cross-demotion loser is 403, covered by Task 1's race tests.
9. Resend looks the role up in `listStaff` (renew returns no role) only to label the email; fallback label "Staff / عضو فريق".
10. `TOKEN_ROLE` is exported (not copied); `STAFF_IDENTIFIER_PREFIX` duplication in the admin controller left alone (only touched the one `export const`).
11. Test-first: red was observed for tenancy and runtime. The live-control, template, route, wiring and public-route tests were written before/with the controller but first run after it, so no red run for those; the two mutation checks above stand in for it.

## Gaps and concerns

- Not run: the gated Prisma suites (no DB). `PrismaStaffDirectoryRepository.delete` is covered with a recording fake only; the real `deleteMany` runs only in CI's Postgres job if an integration test is added (none added: `prisma-repositories.integration.test.ts` has no staff-directory case today).
- The HTTP idempotency replay cache is keyed by tenant + key, not principal (pre-existing, `packages/http`). The new guard-before-replay order makes a deactivated member's replay 403, but one member who knows another's key could replay that response; not changed here.
- Owner-only (R5) also denies an invited admin `security:revoke_session` / `security:refresh_session` style routes; admin-web uses none outside the console, and Task 3 (O6) already covers the 403 state.
- With native auth, a staff token whose principal was never created in Security (e.g. a hand-minted token) is now denied everywhere; every real sign-in path (`merchant-signup`, `bootstrapOwner`, invitations) creates the principal.
- Multi-instance: `invalidate` is local; other instances see a change within the 30 s TTL (D13 as designed).
- Accept error responses differ in shape from the 503 `NOT_CONFIGURED` (`{ error: {...} }` as the plan prescribes) vs the flat envelope elsewhere; Task 3's client has to read both.

## Fix round 1

Commit: `48b69fe8` (on top of `328f0116`).

- **F1 lint cap.** eslint over the 67 `.ts` files changed since `5362eef6`: 65 warnings before, 57 after. The 8 new ones were all `require-await` and are gone: `services/security` 51 -> 43 (3 in `in-memory-repositories.ts`, 5 in `in-memory-staff-invitation-repository.ts`), `apps/admin` 1 -> 1, `services/tenancy` 13 -> 13 (the rest predate this branch). 481 - 8 = 473, the cap. Adapters now drop `async` and return `Promise.resolve(...)`. `save` runs through a small `settle()` helper so a throw still becomes a rejection. No eslint-disable comments, and `MAX_WARNINGS` is unchanged.
- **F2 error envelope.** `NOT_CONFIGURED` (503, was nested `{error:{...}}`), `INVITATION_INVALID` (410) and `EMAIL_FAILED` (502, still `retryable: true`) are built with `toErrorEnvelope(...)`, so every staff error is flat. Status codes and messages are unchanged. Tests now assert top-level `code` / `message` (`staff-routes.test.ts`, `runtime/email-wiring.test.ts`).
- **F3 restore test.** New `it.each` (create throws / answers 500) in `staff-routes.test.ts`: a previous same-store directory row survives a failed create (restored, `release` not called), and the next invite recovers it.
- **Wiring.** The comment at `composition.ts` (live check only under native sign-in) was already there. `staff-live-access-wiring.test.ts` already covers both modes: native deactivation denies at once, external IdP is a pass-through.
- **Checks.** admin vitest 1747 passed / 21 skipped; security 336 / 23 skipped; tenancy 93 / 2 skipped; runtime `email` 11 passed; `staff-routes.test.ts` 41 passed. tsc `--noEmit` is clean for admin, security, tenancy and runtime. `pnpm arch`: no dependency violations.

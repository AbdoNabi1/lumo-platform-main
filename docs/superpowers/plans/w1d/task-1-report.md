# Wave 1d — Task 1 report — checkpoint A (migration, invitation model, lock, tx-aware credential save)

Branch `morbeh/shopify-parity-w1d`, base `5362eef6`. Security package: `@platform/security` (`services/security/package.json` name matches the plan).

## Commit

- `01fb58d0a18dbcefadda9a7685f72c651778afa4` feat(security): staff invitations migration, aggregate, repository and tenant lock (24 files, +1702/-17). Hooks ran (lint-staged eslint + prettier, commitlint); nothing skipped.
- `ed683aaa` chore(db): document the sql-only pending index on the staff invitation model (`///` doc comment on the Prisma model; validate + generate re-run green).
- First attempts were rejected by hooks (eslint `no-control-regex`: my "purely additive" regex had a literal `\x08` from a Python-escaped `\b`; then commitlint body line length). Both fixed; no `--no-verify`.

## Files

Migration / DB (`packages/db`)

- `prisma/schema/migrations/20261126000000_staff_invitations/migration.sql` — house-style header; table incl. `token_hash TEXT NOT NULL`; 3 CHECKs (`staff_invitations_email_normalized`, `_role_key_check`, `_status_check`); unique `staff_invitations_token_hash_key`; partial unique `staff_invitations_one_pending_per_email ... WHERE "status" = 'pending'`; index `(tenant_id,status)`; ENABLE + FORCE RLS + `tenant_isolation` policy (copied from password_credentials). Not applied; no DB contact.
- `prisma/schema/security.prisma` — `SecurityStaffInvitation` (`tokenHash String @unique @map("token_hash")`, `@@index([tenantId, status])`, `@@map`, `@@schema`, `///` doc comment above the model explaining the SQL-only partial index).
- `src/schema-migration-consistency.test.ts` — new describe `security staff invitations (20261126000000)`.

Security service (`services/security/src`)

- `domain/staff.ts` — `StaffRole`, `STAFF_ROLES`, `OWNER_ROLE_KEY`, `StaffStatus`, `StaffMemberView` (exactly the shared vocabulary).
- `domain/staff-invitation.ts` — aggregate + `INVITATION_TTL_MS` + `STAFF_INVITATION_STATUSES`.
- `domain/repositories.ts` — ports `StaffInvitationRepository`, `StaffMutationLock`.
- `infrastructure/prisma-staff-invitation-repository.ts`, `in-memory-staff-invitation-repository.ts`.
- `infrastructure/prisma-staff-mutation-lock.ts`, `in-memory-staff-mutation-lock.ts`.
- `application/password-credentials.ts` (+ `prisma-password-credential-store.ts`, `in-memory-password-credential-store.ts`) — `save(input, tx?)`.
- `application/deps.ts` (`staffInvitations`, `staffMutationLock` on `SecurityDeps`), `composition.ts` (Prisma + in-memory branches, passed into `securityDeps`), `index.ts` (exports vocabulary, `StaffInvitation`, `INVITATION_TTL_MS`, `StaffInvitationStatus`).
- Tests: `domain/staff.test.ts`, `domain/staff-invitation.test.ts`, `infrastructure/staff-invitation-repository.contract.ts` (shared contract), `in-memory-staff-invitation-repository.test.ts`, `prisma-staff-invitation-repository.test.ts` (recording fake), `prisma-staff-invitation-repository.integration.test.ts` (gated), `staff-mutation-lock.test.ts`, `prisma-password-credential-store.test.ts`.

## API chosen (for checkpoint C)

- `StaffInvitation.create(id, { tenantId, email, principalExternalId, roleKey, invitedBy, tokenHash }, now, ttlMs = INVITATION_TTL_MS)`; email must already be normalised (else `BusinessRuleError`). `reconstitute(id, { ...props, version })`. Version starts at 0 and is persistence-owned.
- `accept(now)` → `BusinessRuleError("This invitation is no longer valid")` when non-pending or `expiresAt <= now`. `revoke(now)` → `BusinessRuleError("Only a pending invitation can be revoked")`. `renew(now, ttlMs, tokenHash)` → `BusinessRuleError("Only a pending invitation can be resent")` when non-pending; pending-but-expired is allowed.
- `StaffInvitationRepository`: `save(inv, tx?) → persisted version` (tenant read from the aggregate), `findById(tenantId,id,tx?)`, `findPendingByEmail`, `findByTokenHash`, `listPending` (ordered by email). Prisma writes throw `PrismaStaffInvitationRepository.save requires the unit of work's transaction client (ADR-0003).` P2002 → `ConflictError` ("This email already has a pending invitation"; token-hash / pkey targets get their own message).
- `StaffMutationLock.withTenantStaffLock(tenantId, tx, fn)`; Prisma throws `PrismaStaffMutationLock.withTenantStaffLock requires the unit of work's transaction client (ADR-0003).` without tx.
- `PasswordCredentialStore.save(input, tx?)`: Prisma store upserts with the given tx client and opens no transaction; without tx unchanged.
- `PasswordResetService`: untouched (amendment R6 drops ttl/consume).

## Test cases → names → result (all PASS)

- Migration: `security staff invitations (20261126000000)` : columns/types/defaults/PK; 3 CHECKs; partial unique index text incl. `WHERE "status" = 'pending'` + token_hash unique + status index; ENABLE/FORCE RLS + full policy predicate; purely-additive guard. (db suite: 82 passed.)
- Aggregate (`staff-invitation.test.ts`, 10): TTL 7d; create pending/v0/expires now+ttl; create validation; isExpired boundary; accept ok; accept expired → BusinessRuleError; accept non-pending → BusinessRuleError; revoke pending / non-pending; renew rotates hash + expiry (also expired); renew rejects non-pending/empty hash/bad ttl; reconstitute.
- Repository parity — in-memory (runs 9 contract cases + 2 own = 11) and gated Prisma (same 9 contract cases + 3 extra; SKIPPED locally, no `DATABASE_URL_TEST`): create v1 → update v2 and aggregate version unchanged; stale save → ConcurrencyError and row untouched; fresh aggregate per read; second pending same email → ConflictError while revoked/accepted do not block; renew rotates hash; tenant isolation across findPendingByEmail/findById/findByTokenHash/listPending; listPending ordering/filter; non-UUID findById → null; findPendingByEmail ignores non-pending / findByTokenHash still resolves it; immutable snapshot; token-hash reuse → ConflictError. Gated extras: writes without tx throw, advisory lock serializes, DB-enforced partial unique + CAS.
- Prisma adapter without DB (`prisma-staff-invitation-repository.test.ts`, 9): exact tx-required text; non-UUID no query; create v1 with tenantId; update where `{id, tenantId, version}` + increment; 0 rows → ConcurrencyError; P2002 mapping; non-unique rethrown; every read has tenantId in where; corrupt role/status → UnexpectedError.
- Lock (`staff-mutation-lock.test.ts`, 7): exact `$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))','security.staff:tenant-a')` before fn; throws without tx; fn not run if lock fails; in-memory serializes same tenant, not across tenants, releases on throw, returns value.
- Credential save (`prisma-password-credential-store.test.ts`, 3): with tx uses tx client and never `$transaction`; without tx still own tenant transaction; in-memory ignores tx.

Not covered by this checkpoint (as scoped): the parallel A/B demote race and byte-identical-snapshot tests need the use cases (checkpoint C).

## Real output tails

```
@platform/db  vitest run schema-migration-consistency
 ✓ src/schema-migration-consistency.test.ts (82 tests)   Test Files 1 passed | Tests 82 passed
prisma validate: The schemas at prisma\schema are valid 🚀
prisma generate: ✔ Generated Prisma Client (v6.19.3)
@platform/security vitest run
 Test Files  49 passed | 4 skipped (53)   Tests  259 passed | 18 skipped (277)
@platform/security tsc --noEmit --incremental false → no output (exit 0)
@platform/admin    tsc --noEmit --incremental false → no output (exit 0)
pnpm arch → ✔ no dependency violations found (3744 modules, 16300 dependencies cruised)
tenant scanner → {"violations":[],"stale":[],"open":[]}
```

Red phase was observed first (security run failed: missing `in-memory-staff-mutation-lock`, `staff-invitation`, and the credential-save test hitting `$transaction`).

## Deviations / notes

- Migration CREATE TABLE closes with `\n);` (the style `columnsEverAddedTo` parses) rather than the plan's one-line `)));`.
- Repository `save(inv, tx?)` takes `tenantId` from the aggregate (plan signature); in-memory ignores `tx`.
- ESLint warnings (not errors): `require-await` on the in-memory async methods, same pattern as other in-memory adapters.
- New files are LF; touched pre-existing CRLF files kept CRLF (git normalises).
- `index.ts` exports only vocabulary + aggregate + TTL now; use-case/controller exports come with B/C.

## Remaining (not in this run)

- Checkpoint B: read ports (`listByPrefix`, `listActiveByTenant`, `lastEstablishedByPrincipals`, principal reader with `createdAt`), `ListStaff`.
- Checkpoint C: `ensureStaffRoles`, guarded use cases (change role / set active / create / renew / revoke / accept with `passwordHasher`), `Principal.registerSuspended` (or reconstitute), audit, controller methods + exports, the parallel-admin race tests and snapshot-identical rejection tests.
- Push draft PR after Task 1 so CI's Postgres job runs the gated `prisma-staff-invitation-repository.integration.test.ts` (and applies the migration).

## Checkpoints B and C

Branch `morbeh/shopify-parity-w1d` (draft PR #19), on top of `ed683aaa`. Package name unchanged: `@platform/security`.

### Commits

- `6c1a00b6e09f41a326c6ab3e1e8c21aef044157d` feat(security): staff read model, list staff and staff access read (checkpoint B, 19 files, +1619/-11).
- `500616220fca606e7172d3f2c06f160e50268b92` feat(security): guarded staff commands under the tenant staff lock (checkpoint C, 7 files, +2120).
- Hooks ran on both (lint-staged eslint --fix + prettier, commitlint); nothing skipped, no force, no stash by me (the `git stash` lines in the hook log are lint-staged's own backup). Pre-existing modified/untracked docs were not staged.

### Files

Checkpoint B (`services/security/src`)

- `domain/repositories.ts`: new `PrincipalSummary` / `PrincipalReader` (`listSummaries(tenantId, tx?)`); `SessionRepository.lastEstablishedByPrincipals(tenantId, refs, tx?) -> ReadonlyMap<string, Date>`; `RoleAssignmentRepository.listActiveByTenant(tenantId, now, tx?)`.
- `application/password-credentials.ts` (+ Prisma / in-memory stores): `PasswordCredentialStore.listByPrefix(tenantId, prefix)` -> `{ identifier, principalExternalId }[]` (no hash; Prisma selects only those two columns).
- `infrastructure/in-memory-repositories.ts`, `prisma-repositories.ts`, `prisma-mappers.ts` (`PrincipalMapper.toSummary`): the three read ports on both adapters. Prisma: every `where` carries `tenantId`; reads go through the existing `read()` (tx reuse, else `runReadScoped`); sessions use `groupBy ... _max.establishedAt`.
- `application/deps.ts`: `SecurityDeps` gains `principalReader`, `staffCredentials`, `passwordHasher`; new `AuditDeps` / `StaffDeps` slices (`recordAudit` / `securityEvent` now accept the narrower types, backward compatible).
- `application/staff-support.ts`: `loadStaffDirectory`, `requireActiveStaffAdmin`, `adminsAfterChange`, `ensureStaffRoles`, `runStaffCommand`, `staffIdentifier`, `STAFF_IDENTIFIER_PREFIX`.
- `application/staff.use-cases.ts`: `ListStaff`, `StaffAccess` (round 2 O1).
- `interfaces/security.controller.ts`, `composition.ts`, `index.ts`: `listStaff`, `staffAccess`; wiring; exports.
- `infrastructure/hashed-password-auth-provider.ts`: new `passwordHasher` getter (the SAME scrypt hasher the provider verifies with).
- Tests: `application/staff.use-cases.test.ts` (12), `application/staff.controller.test.ts` (B part 2), `infrastructure/staff-read-ports.test.ts` (8), gated `infrastructure/prisma-staff-read-ports.integration.test.ts`; test kit `infrastructure/staff-test-kit.ts`.

Checkpoint C

- `application/staff-commands.use-cases.ts`: `ChangeStaffRole`, `SetStaffActive`, `CreateStaffInvitation`, `RenewStaffInvitation`, `RevokeStaffInvitation`, `AcceptStaffInvitation`, `normalizeStaffEmail`.
- `interfaces/security.controller.ts`: `changeStaffRole`, `setStaffActive` (200), `createStaffInvitation` (201), `renewStaffInvitation`, `revokeStaffInvitation`, `acceptStaffInvitation` (200); `composition.ts` + `index.ts` wiring/exports.
- Tests: `application/staff-commands.use-cases.test.ts` (51), `application/staff.controller.test.ts` (6 total), gated `infrastructure/prisma-staff-commands.integration.test.ts`.

### Test cases -> test names -> result (all PASS locally; gated ones SKIPPED without `DATABASE_URL_TEST`)

ListStaff (`staff.use-cases.test.ts`)

- owner + admin + operator + viewer + customer + invitee -> 5 rows, customer absent, owner first then email asc, statuses, `isSelf` only the actor, `addedAt`, invitation `{id, version 1, expiresAt now+7d}` -> "lists owner + admin + operator + viewer + an invitee, never a customer; owner first then email asc".
- lastSignInAt = latest of two sessions / null -> "lastSignInAt is the latest of two sessions; null when the person never signed in".
- expired invitation -> `invitation_expired`; suspended -> `deactivated` -> "an invitation past its expiry shows invitation_expired; ...".
- revoked invitee, disabled principal, credential with no staff role not listed -> "omits revoked invitees ...".
- highest role wins; owner wins over every key -> "reports the highest staff role ...".
- tenant isolation -> "is tenant-scoped ...". No hash/token in response -> "never carries a hash, token or token hash in the response".

StaffAccess (O1): "an active admin -> { active, [admin] }", "the owner's keys include platform-admin", "a suspended principal reports suspended", "a revoked assignment and an expired one are excluded", "another tenant's principal and an unknown one -> NOT_FOUND"; controller: "staffAccess answers 200 { status, roleKeys } and 404 ..." (`staff.controller.test.ts`).

Read ports (`staff-read-ports.test.ts`): `listByPrefix` in-memory (prefix/tenant/order/no hash) + Prisma (where/select); `listActiveByTenant` in-memory + Prisma (status + expiry guard); `lastEstablishedByPrincipals` in-memory + Prisma (groupBy; empty list never queries); `listSummaries` in-memory (createdAt stable across saves) + Prisma (select + toSummary). Gated: "principal summaries, active assignments, last sign-in and staff credentials, tenant-scoped" (real Postgres, incl. a temporary grant that expires).

ChangeStaffRole (`staff-commands.use-cases.test.ts`)

- operator -> viewer ok, old revoked / new active, audit `{actor,target,from,to}` -> "operator -> viewer: ...".
- roles defined on first use, idempotent, no permissions -> "defines the three staff roles on first use ...".
- demote the only `admin` with an owner present -> ok. Owner target -> BUSINESS_RULE + snapshot identical; self -> BUSINESS_RULE + identical.
- tenant whose only admin-level principal is the target -> BUSINESS_RULE, snapshot identical; a non-admin actor there -> FORBIDDEN, identical -> "a store whose only admin-level principal is the target: ...".
- last-admin rule itself (pure) -> "the last-admin rule itself (defence in depth) ...".
- non-admin / suspended / unknown actor -> FORBIDDEN, identical; unknown, other-tenant, customer, revoked-invitee target -> NOT_FOUND, identical; unchanged role -> no-op, identical; bad role -> VALIDATION; invited target (O3) pending assignment replaced, still `invited`, not counted as admin.
- race: "two ownerless admins demoting each other in parallel: exactly one wins, one admin remains" (in-memory mutex); control "without the staff lock the same race leaves ZERO admins". Gated Prisma twin: "two ownerless admins demoting each other in parallel: one success, one rejection, one admin remains".

SetStaffActive: deactivate (suspended + both sessions revoked + audit `.deactivated`), reactivate (`.reactivated`), owner/self texts + identical, invited target "Revoke the invitation instead" + identical, repeat no-op + identical, non-admin FORBIDDEN / NOT_FOUND cases + identical, cross-deactivation race (one wins, one stays active; gated Prisma twin included).

CreateStaffInvitation: ok (suspended principal, role assigned, pending, expiresAt = now + 7 d, NO credential, audit `.invited`, returns `{invitationId, principalExternalId, identifier}`); `" Sam@Example.COM "` normalised; existing staff email -> CONFLICT "This person is already on your staff"; pending -> CONFLICT "This email already has a pending invitation"; 5 bad emails -> VALIDATION `email`; bad role / empty token hash -> VALIDATION; non-admin -> FORBIDDEN; reused principal id / token hash -> CONFLICT; every rejection snapshot-identical; no token hash in list/audit.

Renew / Revoke: renew rotates hash, restarts 7 d, version 2, old hash stops resolving, audit; expired pending renewable; stale -> CONFLICT "This invitation was changed by someone else" (renew and revoke); unknown / other-tenant -> NOT_FOUND, non-admin -> FORBIDDEN; revoke -> invitation revoked, assignments revoked, principal `disabled`, audit, list no longer shows it; non-pending -> BUSINESS_RULE; revoke -> re-invite same email -> new principal, old token dead.

AcceptStaffInvitation: credential saved (hash from `passwordHasher`) + principal active + invitation accepted + audit `{actor:"invitee"}` + role kept + no password in audit; 7-char / 257-char password -> VALIDATION `password`, snapshot identical and token still works; expired / unknown / empty / revoked token -> BUSINESS_RULE "This invitation is no longer valid", identical; second accept rejected, first password untouched; old token after resend rejected, new works; a staff credential that appeared meanwhile -> BUSINESS_RULE, identical; atomic ("when the credential write fails nothing else was written"); other tenant's token never resolves; revoked invitee NOT_FOUND for SetStaffActive. Controller level (real hashed provider): password unusable before accept (`authenticate` false), usable after (true), used token dead (409); revoke -> reinvite -> accept -> sign-in works. Gated Prisma: password works only after accept; double accept in parallel -> exactly one 200.

Controller mapping (`staff.controller.test.ts`): 200 / 201 / 403 / 404 / 409 / 422 for the six writes; reference mode (no injected provider) still lists and invites.

### Real output tails

```
@platform/security vitest run          Test Files  53 passed | 6 skipped (59)   Tests  336 passed | 23 skipped (359)
@platform/security tsc --noEmit --incremental false   -> no output (exit 0)
@platform/admin    tsc --noEmit --incremental false   -> no output (exit 0)
@platform/runtime  tsc --noEmit --incremental false   -> no output (exit 0)
@platform/admin vitest run staff-auth public-staff admin-http.e2e   Test Files  2 passed (2)   Tests  51 passed (51)
pnpm arch -> ✔ no dependency violations found (3748 modules, 16354 dependencies cruised)
tenant scanner -> {"violations":[],"stale":[],"open":[]}
eslint on all touched files -> 0 errors (warnings: require-await on in-memory async methods, same pattern as before)
```

The red phase: checkpoint C was test-first (the first run failed on the missing module). Checkpoint B was NOT test-first (implementation and tests were written together; red not observed). A mutation check confirmed the byte-identical snapshots bite (writing `ensureStaffRoles` before validation in `SetStaffActive` failed 2 tests; reverted).

### Differences from the plan text / checkpoint A (committed code and amendments win)

1. `listActiveByTenant(tenantId, now, tx?)` takes `now` (the plan has only `tenantId`): "active" must exclude past-expiry temporary grants, and the port has no clock.
2. Principal reader is a new port `PrincipalReader.listSummaries` implemented by both principal repositories (no `createdAt` added to the `Principal` aggregate). In-memory `createdAt` = the `registered` domain event's `occurredAt` at the first save (Prisma: `created_at`).
3. `ensureStaffRoles` runs AFTER validation and immediately BEFORE the first write, not literally first: the plan also demands rejected commands leave state byte-identical, and defining roles would otherwise be a write on a rejected command. Roles are still always defined before any assignment references them.
4. The last-admin rule is implemented (`adminsAfterChange`, defence in depth) but is unreachable through `ChangeStaffRole` / `SetStaffActive`: the actor re-check guarantees the actor (an active admin-level principal who is not the target) remains. The plan's "only admin-level principal is the target" case therefore ends in the self rule (BUSINESS_RULE) or FORBIDDEN, and the cross-demotion loser is FORBIDDEN (actor no longer admin), which the amendment allows.
5. `ChangeStaffRole` / `SetStaffActive` take no `now` (use `deps.clock`); invitation commands take `now` as specified. `RenewStaffInvitation` / `RevokeStaffInvitation` include `actorExternalId` (amendment). `SetStaffActive` returns `{ status: "active" | "deactivated" }`. The owner is refused by `SetStaffActive` in both directions.
6. `ChangeStaffRole` on an invitee swaps the pending ASSIGNMENT only; the invitation aggregate's `roleKey` is immutable (no mutator in checkpoint A), so `invitation.roleKey` can go stale. `ListStaff` therefore reads the role from assignments (invitation role only as fallback). Accept does not use `invitation.roleKey`.
7. Deactivation revokes sessions via the sessions repository in the same tx (not the public `RevokeAllSessions`) and publishes the same `security.session.revoked_all` outbox event for human principals; the `.deactivated` audit carries `revokedSessions`.
8. `ensureStaffRoles` writes a `security.role.defined` audit (`principalRef: "system"`) per newly defined role, like `DefineRole`.
9. Wiring of the two new deps: `staffCredentials` / `passwordHasher` = the injected `HashedPasswordAuthProvider`'s store and hasher (new getter `passwordHasher`). With no hashed provider (reference mode) a private in-memory store + `ScryptPasswordHasher({log2N:10})` back the staff use cases; credentials accepted there are NOT visible to the reference `InMemoryPasswordAuthProvider` login (tests/local only; the real runtime and the admin harness inject the hashed provider).
10. Files not named in the plan: `application/staff-support.ts` (shared helpers), `application/staff-commands.use-cases.ts` (writes), `infrastructure/staff-test-kit.ts` (the kit imports messaging, so it cannot live under `application/` — `application-no-messaging-no-infra`; arch caught it and I moved it).
11. `AcceptStaffInvitation` does a cheap pre-read (outside the lock, so garbage tokens never cost a scrypt run) and hashes before the lock, then re-reads everything under the lock; the credential is its first write so an infrastructure failure leaves everything else untouched. The Prisma store's `find` (conflict check) uses its own read connection, not the tx (only `save` is tx-aware).
12. All rejections are thrown inside the unit of work and converted to `err(...)` outside it, so Postgres rolls back on rejection; the in-memory store relies on validate-before-write (proved by the snapshot tests).
13. `STAFF_IDENTIFIER_PREFIX` is exported from the package; the admin app still has its own constant in `staff-auth.admin-controller.ts` (Task 2 may import the exported one).

### Gaps I left

- The three gated Prisma suites (`prisma-staff-read-ports`, `prisma-staff-commands`, and checkpoint A's invitation repository) were written and type-checked but not run (no DB by rule); they run in CI's Postgres job. The Prisma `groupBy` / `OR` expiry queries are only covered by recording-fake tests locally.
- No new migration or schema change was needed (none touched).
- Task 2 still has to: generate tokens/hashes, call the pre-checks, send email, directory reservation, live access check using `staffAccess`, and the HTTP routes.

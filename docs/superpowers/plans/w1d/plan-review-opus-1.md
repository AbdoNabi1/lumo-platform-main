# Wave 1d — plan review (Opus, standing in for Sol per owner ruling)

Scope: the parts Sol's partial round 1 did not reach (read model, guards vs real Principal/repositories, live access reader, owner-only rule side effects, harness, admin-web), plus a check that the round-1 amendments resolve R1-R7 (they do).

- O1 BLOCKING (T1 B / T2): plan reader used `security.resolvePrincipal`, which takes `subjectRef` (`services/security/src/application/resolution.use-cases.ts:14-19`), not the externalId the token carries. Fix: new `staffAccess` read (Task 1) consumed by the reader (Task 2).
- O2 OPTIONAL (T1 C): `Principal.register` + `suspend()` before the first save exist (`services/security/src/domain/principal.ts` register/suspend); no new factory. Assignments need defined roles → `ensureStaffRoles` first.
- O3 BLOCKING (T1): invited/revoked targets were unspecified for ChangeStaffRole/SetStaffActive/ListStaff after the R6 redesign (invitees have no credential). Fixed.
- O4 BLOCKING (T2): owner-only rule covers resource `security`, which includes the public sign-in permission `security:authenticate` (10 public routes). Exempted + test. Public principal is kind customer (`packages/http/src/server.ts:351-355`).
- O5 OPTIONAL (T2): store name for the invite email had no source → null in 1d.
- O6 BLOCKING (T3): invited admins now get 403 on `/security/**` loaders; pages need an owner-only state.
- Package names verified: @platform/security, @platform/tenancy, @platform/admin, @platform/runtime, @platform/auth, @platform/db, admin-web.

VERDICT: AGREED (after round 2 amendments)

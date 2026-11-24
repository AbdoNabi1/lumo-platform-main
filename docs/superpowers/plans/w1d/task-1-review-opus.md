# Task 1 review (Opus, per owner ruling)

Range ed683aaa..50061622 (B 6c1a00b6, C 50061622; 22 files +3739) plus A (01fb58d0, ed683aaa).
Re-ran on HEAD: @platform/security 336 pass / 23 gated skipped; db consistency 82 (A).
Read: migration, Prisma lock, in-memory mutex, tx-aware credential save, AcceptStaffInvitation (password check -> early token check -> hash outside lock -> under lock re-check pending/expiry/credential/principal -> credential, principal active, invitation accepted, audit; one tx), runStaffCommand (UoW + lock), requireActiveStaffAdmin (actor re-read under lock).
Deviations accepted: listActiveByTenant(now); ensureStaffRoles after validation (keeps rejected commands write-free); last-admin rule as pure helper (unreachable through the commands because the actor stays admin and self is refused — the invariant holds by construction; race loser gets 403); invitee role change swaps assignment only (ListStaff reads assignments); test kit in infrastructure/ (arch rule).
Carried into Task 2: the admin harness must inject HashedPasswordAuthProvider so accepted credentials are visible to login; use the package's STAFF_IDENTIFIER_PREFIX/staffIdentifier instead of the admin copy where touched.
Pending: CI Postgres run of the 3 gated suites (PR #19).
SPEC: COMPLIANT
QUALITY: APPROVED

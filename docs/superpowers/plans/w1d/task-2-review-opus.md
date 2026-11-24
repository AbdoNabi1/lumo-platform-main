# Task 2 review (Opus, per owner ruling)

Range 50061622..328f0116 (5 commits, 30 files +3341). Implementer: admin full suite 1745 pass / 21 gated skipped.
Read: LiveStaffAccessControl (non-staff delegate; fail closed without caching; owner-only resources security/users/memberships/organizations with security:authenticate exempt; roles intersected, never widened; tenant in cache key; epoch guard against a stale read racing invalidate; bounded LRU), securityStaffAccessReader (404 → null, non-200 throws → denied), server.ts HTTP guard now uses admin.liveAccessControl (one instance).
CI at 50061622: gated suites passed on Postgres (staff commands 4 incl. parallel cross-demotion and double accept, read ports 1, invitation repository) → SQL proven. Lint cap failed (481 > 473).
Findings → fix round 1:

- F1 Important: new eslint warnings exceed the CI cap (require-await in in-memory adapters). Remove them; do not raise the cap.
- F2 Important: staff error bodies (NOT_CONFIGURED etc.) hand-built as nested {error:{...}} while every admin error is the flat toErrorEnvelope shape. Use the standard envelope.
- F3 Minor: invite's same-shop directory restore branch has no test.
  Deviations accepted: live check wired only with native staff sign-in (Ory/Keto staff are not in Security tables; always-on would lock them out) — comment + test both modes; directory closure port instead of the tenancy controller; no passwordReset/registrar deps (Security hashes on accept); merchant-onboarding fixture principal kind staff → service.
  Noted, not in scope: HTTP idempotency replay cache keyed by tenant+key (pre-existing, packages/http); invalidate is per instance (≤30 s elsewhere, D13).
  SPEC: COMPLIANT after fix round 1
  QUALITY: CHANGES_REQUESTED (F1, F2) → fixed in 48b69fe8 (warnings 65→57 on touched files, the 8 new ones removed; flat envelopes; restore test). Scoped re-review by Opus: QUALITY: APPROVED (lint cap to be confirmed by CI)

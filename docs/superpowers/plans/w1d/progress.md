# Wave 1d progress — Settings > Users and permissions

BASE 3b4dc994 (main with 1a, 1b, 1c).
Scope (D8): staff list/invite/roles (fixed admin/operator/viewer)/deactivate, own 2FA enrolment, login code step, require-2FA policy (only after the login code step exists), staff activity.

- Prior survey copied: survey-users-prior.md (from 1b). Fresh survey → impl-sonnet.
- 2026-11-24 21:0x Fresh survey dispatched (deleg_0f507cb0, impl-sonnet) → w1d/survey-users.md.
- 2026-11-24 Survey done (survey-users.md, needs_migration). D12-D17 defaults taken (1d = Users page; 2FA + activity → 1e; live access check 30 s; owner protected; one store per email; label 'Users and permissions'). Plan written: 2026-11-24-shopify-parity-w1d-users.md (3 tasks). Plan review round 1 → reviewer-sol.
- 2026-11-24 21:25 Plan review 1 (Sol) cut off by 429 (usage limit, resets 2026-11-29 12:43) after R1-R7 (all blocking, no VERDICT). All verified + accepted; amendments in plan (preamble, T1, T2). Round 1 to be continued after reset. Owner decision pending: wait vs build on impl-sonnet with reviews deferred (no merge before Sol).
- 2026-11-24 21:35 Ruling (owner): don't wait for Sol; continue with Claude. All tasks → impl-sonnet; reviews on Claude (Sonnet reviewer + Opus acceptance); Sol reviews afterwards. Task 1 checkpoint A → impl-sonnet; parallel read-only Sonnet plan review → w1d/plan-review-claude-1.md.
- 2026-11-24 21:45 Ruling (owner): Opus plans + reviews, Sonnet implements; no Sol hold. Stopped the Sonnet plan reviewer. Opus review → plan-review-opus-1.md (O1-O6), Amendments round 2 in T1/T2/T3. OPUS: AGREED.
- 2026-11-24 22:02 Task 1 checkpoint A (sonnet): 01fb58d0 + ed683aaa (24 files +1702). Opus re-ran: security 259 pass/18 skipped, db consistency 82; reviewed migration/lock/credential store. Accepted. Pushing draft PR for CI Postgres. Checkpoint B+C → impl-sonnet.
- 2026-11-24 22:30 Task 1 B+C (sonnet): 6c1a00b6 + 50061622. Opus review task-1-review-opus.md: COMPLIANT/APPROVED; security 336/23. Pushed (CI gated suites pending). Task 2 → impl-sonnet (BASE 50061622).
- 2026-11-24 23:15 Task 2 (sonnet): 922602ef..328f0116 (admin full 1745 pass/21 gated). CI at 50061622: gated staff suites PASSED on Postgres (commands 4, read ports 1, invitation repo); lint cap FAILED 481>473 (new require-await warnings). Opus review: accepted native-only live check deviation; fix round 1 → impl-sonnet (F1 lint warnings, F2 flat error envelope, F3 restore-branch test).
- 2026-11-24 23:33 Fix round 1 48b69fe8 (sonnet); Opus re-ran staff tests; pushed for CI lint cap. Task 2 accepted pending CI. Task 3 → impl-sonnet (BASE 48b69fe8).
- 2026-11-25 00:55 Task 3 (sonnet) 80b5180d..74bb2353; Opus review COMPLIANT/APPROVED (587 pass). CI 13/13 green at 48b69fe8. Branch review (Opus) APPROVED. Push + ready + merge after green CI.

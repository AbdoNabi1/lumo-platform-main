# Wave 1d progress — Settings > Users and permissions

BASE 3b4dc994 (main with 1a, 1b, 1c).
Scope (D8): staff list/invite/roles (fixed admin/operator/viewer)/deactivate, own 2FA enrolment, login code step, require-2FA policy (only after the login code step exists), staff activity.

- Prior survey copied: survey-users-prior.md (from 1b). Fresh survey → impl-sonnet.
- 2026-11-24 21:0x Fresh survey dispatched (deleg_0f507cb0, impl-sonnet) → w1d/survey-users.md.
- 2026-11-24 Survey done (survey-users.md, needs_migration). D12-D17 defaults taken (1d = Users page; 2FA + activity → 1e; live access check 30 s; owner protected; one store per email; label 'Users and permissions'). Plan written: 2026-11-24-shopify-parity-w1d-users.md (3 tasks). Plan review round 1 → reviewer-sol.
- 2026-11-24 21:25 Plan review 1 (Sol) cut off by 429 (usage limit, resets 2026-11-29 12:43) after R1-R7 (all blocking, no VERDICT). All verified + accepted; amendments in plan (preamble, T1, T2). Round 1 to be continued after reset. Owner decision pending: wait vs build on impl-sonnet with reviews deferred (no merge before Sol).
- 2026-11-24 21:35 Ruling (owner): don't wait for Sol; continue with Claude. All tasks → impl-sonnet; reviews on Claude (Sonnet reviewer + Opus acceptance); Sol reviews afterwards. Task 1 checkpoint A → impl-sonnet; parallel read-only Sonnet plan review → w1d/plan-review-claude-1.md.

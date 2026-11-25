# Wave 1e progress — two-step verification + staff activity

BASE a83a0215 (main with 1a-1d).
Scope (D12): login code step (TOTP + backup codes, challenge token, attempt limit, replay guard), own 2FA enrolment page (/account/security), require-2FA policy (only enforceable when the code step exists and every active staff member is enrolled), staff activity view.
Roles (owner ruling 2026-11-24): Opus plans + reviews, Sonnet implements.

- 1d survey copied as survey-users-1d.md (§2.3-2.5, §5, §6 cover 2FA/audit at 3b4dc994). Delta survey → impl-sonnet.
- 2026-11-25 Delta survey dispatched (impl-sonnet) → w1e/survey-2fa.md.
- 2026-11-25 Survey done (needs_migration: last_used_step). Plan written: 2026-11-25-shopify-parity-w1e-two-step.md (3 tasks, D18-D24 defaults). Opus review 1: 4 blocking + 1 optional folded in; OPUS: AGREED. Task 1 checkpoint A → impl-sonnet.

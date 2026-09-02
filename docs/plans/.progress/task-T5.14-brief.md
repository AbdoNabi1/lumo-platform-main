# Task T5.14 brief — Marketing and Integrations screens (re-audit)

This is a small, quick task: re-verify two honest "no such context exists" screens are still
accurate after every other Phase 5 task has landed, and either wire what's real now or refresh the
comments. Do not build either screen against invented data under any circumstances — that is the
one hard rule this task exists to enforce.

## What to check

1. **Marketing** (`apps/admin-web/src/app/marketing/page.tsx`) — its doc comment says: no
   `services/marketing` context, no campaign aggregate anywhere, only a bare `campaignRef` string
   on Coupon/Promotion with no owning data. Re-verify:
   - Does `services/marketing` exist now? (It did not as of Phase 4/5's other tasks — check
     directly, do not trust this brief's memory.)
   - Did T5.8 (Coupons and promotions, already shipped this phase) surface anything real about
     campaigns beyond the bare `campaignRef` string? Read `apps/admin-web/src/lib/api/promotions.ts`
     and `.../discounts.ts` (both already built) — if `campaignRef` is still just an opaque string
     with no backing entity/endpoint, the gap is unchanged.
2. **Integrations** (`apps/admin-web/src/app/integrations/page.tsx`) — its doc comment says
   `docs/growth/03-INTEGRATIONS_HUB_SPEC.md` is contract-only, no application code, explicitly
   requires approval before any UI is built. Re-verify:
   - Read that spec file again — has its "Status" changed from "CONTRACT"?
   - Does any `services/*` directory implementing it now exist?

## What to do with the result

- **If either gap has genuinely closed** (a real backend now exists): wire that screen for real,
  following the standard Phase 5 write-screen recipe (`apps/admin-web/README.md`) — route table,
  DTOs, list/detail, write actions if applicable, both dictionaries, middleware. Do not do this
  unless you've confirmed real backend capability exists; re-read this brief's "hard rule" above
  first.
- **If both gaps are still open** (the expected outcome — nothing in Phases 4-5 built a marketing
  or integrations backend): leave both screens' behavior unchanged, but update each doc comment's
  audit note with today's date and a one-line confirmation that the gap was re-checked and remains
  open as of this phase (e.g. "Re-audited at T5.14 (Phase 5): still no `services/marketing`
  context — gap unchanged"). This closes the task either way; a confirmed-still-absent gap is a
  valid, complete outcome, not a failure to find something to build.

## Global constraints (every Phase 5 task)

1. `packages/*`/`services/*` never import from `apps/*`.
2. Domain aggregates never go on the wire (if you do end up wiring something real).
3. **Never fabricate data in either UI** — this task's entire reason to exist.
4. Every new/changed user-facing string in both `messages/en.ts` and `messages/ar.ts` (only
   relevant if you wire something real; a comment-only update needs no dictionary change).
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md` if genuinely blocked (unlikely for
   this task — it's a re-audit, "still not built" is an expected, complete answer, not a blocker).
7. Mark this task's checkbox (`- [ ] **T5.14 Marketing and Integrations screens.**` →
   `- [x] **T5.14 Marketing and Integrations screens.**`) when done — either outcome (wired-for-real
   or comments-refreshed) counts as done.
8. N/A (read-only re-audit unless a real backend was found).
9. Never call the runtime API from browser JS.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

## Report

Write your full report to `docs/plans/.progress/task-T5.14-report.md` stating clearly, for each
screen: what you checked, what you found, and which outcome (wired-for-real vs. comment-refreshed)
you took. Return to the controller only: status, files changed, one-line test summary, concerns.

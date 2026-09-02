# Phase 3 ledger (no-git working copy — this repo has no .git, so no worktree/commit tracking; progress tracked here + checkboxes in PHASE-3-readonly-screens.md)

Plan: docs/plans/PHASE-3-readonly-screens.md
Depends on: Phase 1 (complete, verified via checkboxes in PHASE-1-admin-write-layer.md)

## Pre-flight scan

- T3.1..T3.6 each add new files under apps/admin-web/src/lib/api/<domain>.ts and
  apps/admin-web/src/app/<domain>/... — mostly disjoint. Shared-file collision risk:
  navigation.ts, middleware.ts, messages/en.ts, messages/ar.ts — every task edits these.
  Ruling: dispatch tasks strictly sequentially (never in parallel) to avoid clobbering
  concurrent edits to these four shared files. Cost if wrong: N/A, sequential dispatch has
  no downside besides wall-clock time.
- No git repo present (confirmed: no .git dir). The subagent-driven-development skill's
  worktree/commit/diff-script machinery (sdd-workspace, task-brief, review-package) assumes
  git and cannot run here. Ruling: adapt the skill's spirit (fresh implementer subagent per
  task, then a review pass) without git tooling — track state in this ledger file instead of
  commits, and review each task's diff by reading the changed files directly (Read/Grep)
  plus re-running the verify command, instead of a git-diff-based reviewer package. Cost if
  wrong: less mechanical rigor in the review step than the full skill provides; mitigated by
  running the same pnpm verify commands and reading every new/changed file per task.
- Tasks run "Do not ask questions" per repo's own docs/plans/README.md — any blocker goes to
  docs/plans/BLOCKERS.md, not back to the user.

## Tasks

- [x] T3.1 Security Console — complete, review clean. Implementer hit one transient API-error
  drop mid-task (after finishing overview/identity, before access), resumed via SendMessage from
  the same agent with full context; no rework needed. Independently re-verified: typecheck clean,
  163/163 tests pass (21 new in security.test.ts), grep-confirmed 23/23 endpoint paths present in
  security.ts, all 7 page.tsx files + layout present, nav entry present, middleware
  `["/security", "admin"]` present. Lint independently re-verified: 0 errors, 1 pre-existing
  unrelated warning (next.config.ts). No BLOCKERS.md entry needed (no domain-aggregate leak
  found in security read models).
- [x] T3.2 Finance — complete, review clean. Implementer stalled twice (both times mid-research,
  before writing files; resumed via SendMessage both times with no rework needed — the second
  resume completed the whole task). Independently re-verified: typecheck clean, 188/188 tests
  pass (+25 new: finance.test.ts 18, finance-period-picker.test.tsx 4, finance-model-picker
  .test.tsx 3), grep-confirmed 5/5 endpoints in finance.ts, nav entry + middleware
  `["/finance", "admin"]` present, lint clean (same pre-existing warning). Confirmed minor-units
  division happens only in page.tsx (formatting boundary), not in the fetch layer, per the
  brief's explicit requirement. Checkbox ticked by controller (implementer stalled just before
  ticking it itself).
- [x] T3.3 Customer 360 — complete, review clean, no stall this time. Independently re-verified:
  typecheck clean, 214/214 tests pass (+26: customer-360.test.ts 16, customer-profile-card.test
  6, customer-identity-timeline-card.test 4), grep-confirmed 4/4 endpoints. Merged into existing
  customers/[customerId]/page.tsx as instructed (no new page, no nav/middleware change). Two
  sound judgment calls recorded in BLOCKERS.md, not blockers: (1) found a real backend bug —
  `profile.fields`/`freshness`/`sources` are backend `ReadonlyMap`s that Fastify's default
  JSON serializer always turns into `{}`; frontend renders generically so it self-heals once
  backend is fixed, out of scope to fix here; (2) journey cards (visitorId-keyed) correctly
  omitted per brief's own instruction, since CustomerDetailDto carries no visitorId — implemented
  and tested but not wired into the page, which is exactly what "omit them otherwise" meant.
- [x] T3.4 Feature Registry explorer — complete, review clean, no stall. Independently
  re-verified: typecheck clean, 260/260 tests pass (+46), grep-confirmed 5/5 endpoints
  (fetchFeatures, resolveFeature, fetchCapabilityGraph, fetchRegistryValidation,
  fetchFeatureBundles). Sound judgment call verified against the route file: capability-graph
  route returns `{nodes, cycles, acyclic, focus?}` with no edge list, so edges are derived
  client-side (`deriveCapabilityEdges`) from each feature's own `dependencies`/
  `compatibility.requires` fields already present on `/features` responses — mirrors the
  backend's own `CapabilityGraph.fromFeatures` construction rather than fabricating data or
  adding a graph-drawing dependency (brief forbade the latter). No BLOCKERS.md entry needed.
- [x] T3.5 Licensing usage counters — complete, review clean, no stall. Independently
  re-verified: typecheck clean, 269/269 tests pass (+9), fetchUsageCounters + currentTenantRef
  confirmed present, settings/page.tsx's workspace/plan/subscription unavailable badge/doc
  comment confirmed intact (only appended, not rewritten). Sound judgment call: no list-all
  endpoint exists, so fans out one request per resource in the canonical USAGE_RESOURCES
  registry rather than fabricating a table; short-circuits to unauthorized/error rather than a
  partially-zeroed table. Minor scope note (not a defect): added `currentTenantRef()` export to
  client.ts to avoid duplicating tenant-resolution logic — small, low-risk shared-file touch.
  No BLOCKERS.md entry needed.
- [x] T3.6 Media asset download links — complete, review clean, no stall. Independently
  re-verified: typecheck clean, 279/279 tests pass (+10), fetchMediaDownloadUrl present, T1.4's
  ProductEditForm confirmed still intact on the same page, required BLOCKERS.md entry re:
  missing GET /media/assets list endpoint confirmed present. No fabricated fallback for the
  known-broken local-dev download URL, per brief.

## Phase 3 complete

All 6 tasks done, each independently re-verified by the controller (not just trusting the
implementer's self-report): typecheck clean, lint clean (1 pre-existing unrelated warning
throughout), 279/279 tests passing cumulatively. Exit criteria: 4/9 ticked (route-role coverage,
both-dictionaries coverage, verify commands passing, no write controls). The remaining 5 are
domain-specific "renders/reachable in the running app" assertions that cannot be confirmed
without Docker (none available this session) — documented in BLOCKERS.md's new "Phase 3 screens
not verified in a live browser" note, same precedent as Phase 0's `/analytics` note.

Two stalls this session (T3.2 twice, transient — both resumed via SendMessage with no rework
needed) and one transient API-error drop (T3.1, resumed with no rework needed). No task required
an escalation to a fresh implementer or a more capable model — every resume completed on the
first retry.

This workspace (briefs + this ledger) is left in place as the session's record, per the no-git
constraint noted in the pre-flight scan — there is no commit history to fall back on instead.

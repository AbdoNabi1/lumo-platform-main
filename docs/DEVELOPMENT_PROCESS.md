# DEVELOPMENT_PROCESS — how every feature/sprint is built

> The mandatory, repeatable workflow for Morbeh. Applies to every sprint and every AI session.
> Companion: [MASTER_PROMPT.md](MASTER_PROMPT.md) (paste into the session) and
> [AI_CONTEXT.md](AI_CONTEXT.md) (project memory).

## Phase 1 — Read

- Read [`AI_CONTEXT.md`](AI_CONTEXT.md), [`PROJECT_STATE.md`](PROJECT_STATE.md), [`DECISIONS.md`](DECISIONS.md).
- Read only the architecture docs, coding standards, and packages **relevant to this sprint**.
- Inspect only the files that will actually be affected.
- **If documentation conflicts or scope is ambiguous → STOP, explain, and wait for clarification. Never guess.**

## Phase 2 — Plan

Produce a **concise** plan containing only:

- affected packages
- files to create
- files to modify
- architecture decisions
- risks

**STOP. Wait for explicit approval. Do not write any code.**

## Phase 3 — Implementation (only after approval)

- Implement **exactly** the approved sprint — nothing more.
- Production-ready: no TODOs, placeholders, mocks, disabled lint rules, or duplicated logic.
- Strict TypeScript; deterministic; immutable where applicable; composition over inheritance.
- Reuse/extend existing abstractions; respect layer boundaries and the freeze list.

## Phase 4 — Validation (all must pass)

Run, and fix every issue until all are green — never ignore a failure:

```
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Phase 5 — Documentation

Update, as applicable:

- [`AI_CONTEXT.md`](AI_CONTEXT.md) — package structure / rules / sprint status, if changed.
- [`PROJECT_STATE.md`](PROJECT_STATE.md) — move the sprint to completed; set the next sprint.
- [`DECISIONS.md`](DECISIONS.md) — append any new decision (Decision · Reason · Trade-offs); add an [ADR](architecture/adr/) if the architecture contract changed.
- `docs/implementation/SPRINT_X_REPORT.md` — implemented features, architecture decisions, files created/modified, validation results, remaining work (keep concise).

## Commit gate

**Only after Phases 4 and 5 are complete and all four commands are green** is the work commit-ready
(Conventional Commits). Then **stop** — do not start the next sprint until instructed.

## Sprint-close contract (Sprint 3.0A, D-051 — MANDATORY)

A sprint is NOT complete until ALL of these are updated in the same change set:

1. `PROJECT_STATE.md` — new sprint row (chronological order) + current/next sprint.
2. `DECISIONS.md` — append-only D-entry for any new convention (ADR first if architectural, D-017).
3. `AI_CONTEXT.md` — a dated addendum section (never rewrite history).
4. `CHANGELOG_AI.md` — one index row (summary, key files, breaking/migration).
5. `KNOWN_GAPS.md` + `architecture/23-platform-gap-register.md` — both, for any gap opened/closed.
6. `implementation/SPRINT_<n>_REPORT.md` — the full record.
   Then run every gate (lint/typecheck/test/build/arch) and report results honestly — gated ≠ green.

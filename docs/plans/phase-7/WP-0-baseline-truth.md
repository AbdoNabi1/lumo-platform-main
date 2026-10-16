# WP-0 — Baseline truth: make the status documents match the repository

> **Read first:** [`../README.md`](../README.md) and [`README.md`](README.md), completely.
> **Depends on:** nothing. **Run this before every other WP.**
> **Size:** small — documentation only. No `src` file changes.

## Why this exists

Three documents in this repository describe a codebase that no longer exists. Any agent (or human)
who reads them forms a wrong model of the project and then makes wrong decisions, and every Phase-7
WP begins by reading them. The cost of the drift compounds with every session.

| File                    | Claims                                                                                                                                       | Reality                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`             | "**Phase 2, Sprint 0.1 — foundation bootstrap only** (no business features)… **No** auth, database, APIs, business components, or features"  | 40 bounded contexts, 461 HTTP routes, 38 Postgres migrations, Ory-based auth, a deployed cloud runtime                                             |
| `docs/PROJECT_STATE.md` | "As of **2026-06-29**… Phase 1 COMPLETE… Phase 2 is **not authorized yet**… All six require a Docker-capable host… that is unavailable here" | Phases 0–6 of `docs/plans/` are all executed; the cloud topology (Supabase + Upstash + Ory Network) is live per `docs/operations/CLOUD_RUNBOOK.md` |
| `docs/KNOWN_GAPS.md`    | "Sprint 3.0A snapshot" with G-0 "all work uncommitted"                                                                                       | Work is committed on `feat/cloud-platform-runtime-2`; several listed gaps are closed and several real gaps are absent                              |

## Tasks

- [x] **T0.1 — Record the measured gate status.**
      Run all three and capture the real output. `turbo` is broken on this host (see
      [`README.md`](README.md) §1) — use these exact commands, not `pnpm typecheck`:

      ```bash
              pnpm -r --workspace-concurrency=4 run typecheck
              pnpm -r --workspace-concurrency=4 run test
              pnpm arch
              ```

              Record the results in `docs/PROJECT_STATE.md` under a new `## Verified gates` section, with
              the date you ran them and the exact command used. If a result differs from
              [`README.md`](README.md) §1's numbers (79/79 typecheck, 3,124 tests, one concurrency-only
              timeout flake in `apps/runtime/src/security/wire-security-provisioning.test.ts`), record what
              you actually got — **do not copy the numbers from that file.**

- [x] **T0.2 — Rewrite `README.md`'s scope section.**
      Delete the "Scope of Sprint 0.1" section and the "Phase 2, Sprint 0.1 — foundation bootstrap
      only" line at the top. Replace with a short, accurate description: what the platform is, the
      four apps, the count of contexts and routes, and a pointer to `docs/plans/README.md` and
      `docs/plans/phase-7/README.md`. Keep the Quick start, Tech, Structure and Scripts sections —
      but **fix the Scripts section** to warn that `pnpm typecheck` / `pnpm lint` / `pnpm test`
      shell out to `turbo`, which is broken on Windows hosts, and give the `pnpm -r
--workspace-concurrency=4 run <task>` form as the working alternative.

- [x] **T0.3 — Rewrite `docs/PROJECT_STATE.md`.**
      Keep the completed-sprint table — it is real history and worth keeping. Replace the
      "Current sprint", "Next: Phase 2 (not started)", "Pending work" and "Future planned sprints"
      sections, all four of which are false. The new state must say: Phases 0–6 of `docs/plans/`
      are executed; the open work is Phase 7; the cloud topology is live. Update the "As of" date.

- [x] **T0.4 — Reconcile `docs/KNOWN_GAPS.md` with `docs/architecture/23-platform-gap-register.md`.**
      That register is the master ledger (per its own header) — read it, then update **both** files: - Close **G-0** (work is committed; verify with `git log --oneline -5` and name the branch). - Close **G-41** (first live boot happened — `docs/operations/CLOUD_RUNBOOK.md` documents the
      live topology; verify before closing). - Add these gaps, which are real, verified, and currently absent from both files. Use the
      register's existing column shape (ID / Description / Impact / Owner / Status):

        | New ID | Description | Impact |
              | --- | --- | --- |
              | G-43 | Storefront emits zero tracking events — `@platform/tracking` is a declared dependency of `apps/storefront` and never imported | the entire data plane has no producer |
              | G-44 | No ClickHouse DDL exists anywhere; ClickHouse is never wired into `apps/runtime` | `ClickHouseAnalyticsReadStore` and `ClickHouseReadModelStore` query tables that do not exist |
              | G-45 | No AI layer — brief §§28–38 have zero implementation (the AI *governance* profile in `services/security` exists and is the guard rail it will plug into) | the product's stated differentiator is absent |
              | G-46 | Recommendation engine has no algorithm — `GenerateRecommendationSet` scores `1/(index+1)` over a stub port returning `[]`; all 7 strategies are identical | recommendations return nothing |
              | G-47 | Experimentation has no variant assignment and no statistical evaluation; nothing in the storefront reads an experiment | A/B testing is config CRUD, not an engine |
              | G-48 | Automation workflows have no delay / condition / branch / goal step — only `trigger → action` | the brief's abandoned-cart workflow is not expressible |
              | G-49 | All notification providers are in-memory stubs; nothing is ever sent | no email/SMS/push/webhook delivery |
              | G-50 | Storefront renders no SEO — no `generateMetadata`, JSON-LD, `sitemap.ts` or `robots.ts`, despite `services/seo` owning profiles/redirects/robots/sitemaps | organic acquisition is impossible |
              | G-51 | Storefront renders no CMS content — no `/public/pages` route exists and the homepage is hardcoded | `services/pages`/`components`/`content`/`theme` reach no customer |
              | G-52 | Guest checkout cannot complete an order — `order-creation.adapter.ts` throws without a `customerRef` (C-2); `apps/e2e/tests/guest-purchase.spec.ts` is `test.fail()`-annotated for it | the platform cannot sell to a guest |
              | G-53 | Runtime is single-tenant — `composition.ts` throws at boot on `TENANT_MODE=multi`; repositories are pinned to one `tenantId` at construction while the schema is tenant-aware | not a multi-tenant SaaS at runtime |
              | G-54 | No attribution model (first/last/linear/position/time-decay) exists; tracking collects `utm_*` and click-ids but nothing computes credit | marketing spend cannot be tied to revenue |
              | G-55 | No `services/marketing` and no integrations hub — `docs/growth/03-INTEGRATIONS_HUB_SPEC.md` is `Status: CONTRACT` | no campaigns, no ad-platform or feed connections |
              | G-56 | No AI cost/contribution/margin accounting per merchant — `WP-5` T5.6 meters tokens against a per-principal governance *budget* (a quota, via `CheckAiAction`), but nothing computes AI revenue minus AI cost per merchant | `WP-15`'s merchant-profitability reporting has no AI cost line to reconcile against; currently recorded only as a prose paragraph in `docs/plans/UNIFIED-ROADMAP.md` §4b with no owning task |

              Cross-reference each new gap to the WP that closes it (`docs/plans/phase-7/WP-N-*.md`). G-56
              has no closing WP yet — it is future work per `UNIFIED-ROADMAP.md` §4b (the AI plane's phase 2,
              which needs its own design round after `WP-5` ships) — record its "Due" column as such rather
              than naming a WP that does not exist.

- [x] **T0.5 — Record the turbo breakage as a permanent environment note.**
      Append an entry to `docs/plans/BLOCKERS.md` in the shape that file already uses. The existing
      "Environment note — `turbo run <task>` at default concurrency crashes on this Windows host"
      entry describes exit code `3221225781` (`STATUS_ACCESS_VIOLATION`) and says
      `--concurrency=4` succeeds. That is now **out of date**: `pnpm exec turbo` fails at
      `--concurrency=4` too, with `-1073741515` (`STATUS_DLL_NOT_FOUND`), and `turbo --version`
      prints nothing at all. Do not delete the old entry — add a dated update beneath it recording
      the new symptom and the `pnpm -r --workspace-concurrency=4 run <task>` workaround.

## Definition of done

- All five tasks ticked.
- A reader who opens `README.md`, `docs/PROJECT_STATE.md` and `docs/KNOWN_GAPS.md` cold forms a
  correct model of the repository — no claim in any of the three contradicts something you can
  verify with a command in under a minute.
- `docs/KNOWN_GAPS.md` and `docs/architecture/23-platform-gap-register.md` agree with each other.
- No file under `apps/`, `packages/` or `services/` was modified. This WP is documentation only.
- The gates still pass (nothing here should touch them, but confirm — a malformed Markdown table in
  a file some test snapshots would be caught here).

## Rules specific to this WP

- **Verify before you close a gap.** Do not close G-0 or G-41 because this file told you to — run
  the command that proves it, and if it does not prove it, leave the gap open and say why.
- **Do not delete recorded history.** The completed-sprint table, the ADR references, and the
  incident doc comments are the reason this repo is navigable. Add and correct; do not prune.
- **Dates are absolute.** Never write "recently" or "last sprint" — write the date.

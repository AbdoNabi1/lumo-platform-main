# Final Execution Plan — V5 (rebuilt from scratch)

RA-1 Phase 7 core deliverable, produced only after Phases 1-6 completed. Planning only — no code
modified, nothing staged, nothing committed, no milestone executed, no recovery branch touched.
Strict rule applied: **an "Executable" status requires every file in that milestone's list to be
High confidence** (per the tier clarification in `EXECUTION_TIMELINE_V5.md`: structurally-attested
composition/translator/barrel files count as High; genuinely undiscussed boilerplate does not).
Any milestone with a genuine Medium/Unknown remainder is marked **Executable (Core only)** with the
deferred file list stated explicitly, or **Blocked/Not Executable** if the remainder dominates.

## Milestone status table

| #     | Milestone              | Status                                                                  | Deferred files (Medium/Unknown, explicitly held back)                                                                                                                                                                                                                                                |
| ----- | ---------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Tier 9 (docs)          | Executable                                                              | none                                                                                                                                                                                                                                                                                                 |
| 2-3   | K1, K2                 | Already committed                                                       | n/a                                                                                                                                                                                                                                                                                                  |
| 4     | K3-Core                | **Completed (Inherited)** — Verify inherited implementation (completed) | n/a — no reconstruction required; see `K3_EXISTENCE_PROOF.md`/`K3_CLOSURE_REPORT.md`. The base/patch line-split inside `kratos.ts`/`server.ts` remains a live concern for **P2/P2.0.2/P2.0.3/R3**, whichever milestone lands the corresponding patch — not for K3, which owns no outstanding action. |
| 5     | K4                     | Executable                                                              | `packages/{registry,entitlement}/{package.json,tsconfig.json}` (Medium)                                                                                                                                                                                                                              |
| 6     | K5                     | Executable                                                              | none                                                                                                                                                                                                                                                                                                 |
| 7     | K6                     | Executable                                                              | none                                                                                                                                                                                                                                                                                                 |
| 8     | K7-Core                | Executable (Core only, ~35 files)                                       | ~40 files under `definitions/execution/intelligence/pipeline/inspector/envelope/delivery` (Unknown)                                                                                                                                                                                                  |
| 9     | T1-Core                | Executable (Core only)                                                  | `ShippingRateCard`/`ShippingRate`/`QuoteShippingRates` cluster + fragments (Unknown)                                                                                                                                                                                                                 |
| 10    | T2-Core                | Executable (Core only)                                                  | none within T2 itself — the composition/interfaces files simply belong to R3 now, not held-back T2 scope                                                                                                                                                                                             |
| 11    | C1-C12                 | Executable                                                              | C4's `validate-price-lines.use-case.ts` (Unknown); C7's `payment-captured.consumer.ts` staged with Created-In left explicitly Unknown; C5's `cached-cart-repository.test.ts`, C7/C8's ungrouped `get-order`/`get-payment-intent` use-case files (Medium, undiscussed)                                |
| 12    | G1-G5                  | Executable                                                              | `services/media/package.json` (downgraded to Medium)                                                                                                                                                                                                                                                 |
| 13    | P1                     | Executable                                                              | none                                                                                                                                                                                                                                                                                                 |
| 14    | P2 (expanded)          | Executable                                                              | none — this milestone's scope was expanded specifically because every added file (auth/H-2, secrets/H-3, telemetry.ts, observability's H-5 bump, the full H-5 cluster) is High                                                                                                                       |
| 15    | P3                     | Executable                                                              | none                                                                                                                                                                                                                                                                                                 |
| 16    | P4                     | Executable                                                              | none                                                                                                                                                                                                                                                                                                 |
| 17    | Phase 6.1-Core         | Executable (Core only, 6 files)                                         | ~15-file remainder (Medium/Unknown)                                                                                                                                                                                                                                                                  |
| 18-21 | N1, N2, N3(+6.4.1), N4 | Executable (all four)                                                   | `interfaces/customer-360.controller.ts` (Unknown, no report names it at any phase)                                                                                                                                                                                                                   |
| 22    | E1                     | **Not Executable**                                                      | entire scope is Medium (context-level only)                                                                                                                                                                                                                                                          |
| 23    | E2                     | **Not Executable**                                                      | entire scope is Medium (context-level only)                                                                                                                                                                                                                                                          |
| 24    | R1 (severely narrowed) | Executable (Core only, 3 files: `seed.ts`, `dev-all.mjs`, `page.tsx`)   | `module.ts`, `module.test.ts`, `modules/**`, `platform.ts`, `platform.smoke.test.ts`, `jobs.ts`, `diagnostics.ts`, `shutdown.ts`, `metrics.ts`, `health-server.ts` (all Unknown for creation)                                                                                                        |
| 25    | R2                     | **Blocked**                                                             | entire scope (Unknown — no report exists anywhere)                                                                                                                                                                                                                                                   |
| 26    | R3 (narrowed)          | Executable (Core only)                                                  | none within the narrowed scope — the previously-included H-5 cluster moved to P2                                                                                                                                                                                                                     |
| 27    | GOV                    | **Not Executable**                                                      | nearly the entire file set (Unknown for creation); only the FF-FR-01 rule inside `scripts/governance/run.mjs` is High (attributable to P1, could in principle land as part of P1 instead of a standalone GOV commit)                                                                                 |
| 28    | A1g                    | Executable (Medium, aggregate — disclosed, not hidden)                  | the whole milestone is Medium by its own nature (no single owning report); scheduled anyway because it's the standing, already-accepted exception (no other way to commit `apps/admin` incrementally, confirmed infeasible without a real refactor)                                                  |
| 29    | A1                     | Executable                                                              | none — already gate-verified this session                                                                                                                                                                                                                                                            |

## What this means concretely

- **K3 is Completed (Inherited)**, closed by verification rather than by commit — see
  `K3_EXISTENCE_PROOF.md`/`K3_CLOSURE_REPORT.md` in `lumo-platform-recovery`. This is a new status
  distinct from both "Executable" and "Not Executable"/"Blocked": no reconstruction was required
  because the content already exists, byte-identical, in the branch's inherited history.
- **21 of the remaining 28 milestones are fully or Core-executable now.**
- **3 are explicitly Not Executable** (E1, E2, GOV) — held back until either a dedicated file-level
  re-review raises their confidence to High, or (for GOV specifically) a real primary source for
  the governance suite's own creation is located.
- **1 is Blocked outright** (R2) — no citation exists anywhere; do not assign it a step number until
  one is found or the code is gate-checked directly and a fresh report is written.
- **A1g remains the one standing, deliberate exception** to "Executable requires High confidence" —
  carried forward from every prior pass's own finding that its aggregate nature cannot be split
  without a real code refactor, and disclosed here rather than silently scheduled as if it met the
  bar.
- Every other milestone's deferred-file list is explicit and short — most milestones are now either
  fully clean or missing only 1-3 specifically-named files, not vague fractions.

## Corrections applied in this plan versus V4's (now superseded)

1. H-5 production-readiness cluster + `packages/observability/package.json`: **R3 → P2** (real
   citation found).
2. GOV: **Executable → Not Executable** (its citations were invalid; no replacement found for most
   of its scope).
3. E1/E2: **Executable (inconsistently, contradicting their own Medium label) → Not Executable**
   (made consistent with their actual confidence).
4. `apps/runtime/src/{module.ts,platform.ts,jobs.ts,diagnostics.ts,metrics.ts,shutdown.ts,
health-server.ts}`: remain excluded from R1, now with the corrected split for `jobs.ts`/
   `metrics.ts`/`health-server.ts` (pre-existence attested, creation still Unknown) versus
   `module.ts`/`platform.ts`/`diagnostics.ts`/`shutdown.ts` (nothing found either way).
5. `services/media/package.json`: High → Medium (its own text doesn't support the claimed
   attribution; only `src/index.ts` does).
6. G1-G5/C1-C12's per-file evidence is now **actually inlined** in `PATCH_OWNERSHIP_MATRIX_V5.md`
   rather than referencing a document that doesn't exist — this is what makes 12 and 11 legitimately
   schedulable as "Executable" this time, rather than resting on an invalid citation as V4 did.

---

No document referenced above was deleted. No git state was modified. No code was modified. Nothing
was staged. Nothing was committed. No milestone was executed. **Do not begin K3 or any later
milestone until `FINAL_VERDICT_V5.md` returns outcome A.**

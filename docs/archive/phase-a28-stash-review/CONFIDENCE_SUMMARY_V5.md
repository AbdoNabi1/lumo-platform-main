# Confidence Summary — V5

Summary of every file's confidence in the rebuilt-from-scratch V5 set. Only High / Medium / Unknown
are used, per RA-1's rule — "Confirmed" appears nowhere in any V5 document.

## High confidence (individually named by a primary source, or a structurally-attested composition/translator/barrel role explicitly discussed by function)

Roughly 560 of the ~766 dirty-tree entries: all of K3-K7's file-specifically-cited content (~35 of
~40 K7 files individually evidenced; the rest explicitly Unknown), all of T1/T2 except the
`ShippingRateCard` cluster, all of C1-C12's named aggregates/VOs/ports/use-cases/events/migrations
plus their structurally-attested composition/translator files, all of G1-G5's named aggregates/VOs/
events/ports plus structurally-attested composition/translator files, all of N1-N4/Phase-6.1's named
files, P1/P2(expanded)/P3/P4's full scope, R3's narrowed scope, A1's full scope, and the specific
A1g files individually confirmed (Catalog GET /products route, orders admin-controller facade).

## Medium confidence (package/context-level match, generic boilerplate never individually named, or aggregate delivery with no single owning report)

Roughly 120 entries: `tsconfig.json`/`vitest.config.ts` files across nearly every package (never
individually discussed by any report — a structural, low-risk, universal Medium, not specific to any
one context); undiscussed generic repository/mapper implementations in several C1-C12/G1-G5
contexts; `packages/{registry,entitlement}/{package.json,tsconfig.json}`; `services/media/
package.json` (**downgraded this pass** from a prior High); E1 (`apps/collector/**`) and E2
(`packages/tracking/src/browser/**`) in their entirety; `apps/admin/src/http/admin-routes.ts`'s
aggregate bulk (A1g); `apps/runtime/src/{metrics.ts,health-server.ts,jobs.ts}` (pre-existence
attested, creation Unknown); `apps/runtime/src/{worker.ts,config.ts}` base content (patch fragments
are High); `.dependency-cruiser.cjs`, `.env.example`, root `README.md`/`docs/PROJECT_STATE.md`,
`docs/development/SETUP.md`, `packages/db/prisma/schema/main.prisma`.

## Unknown (no primary source connects this file to any milestone — explicitly deferred, never scheduled)

Roughly 85 entries: `packages/temporal/src/runtime.ts`'s dirty delta; `packages/http`'s
`HttpMetricsSink` fragment; ~40 `packages/tracking` files; `services/finance`'s `ShippingRateCard`/
`ShippingRate`/`QuoteShippingRates` cluster (7 files); `apps/runtime/src/{diagnostics.ts,shutdown.ts,
module.ts,module.test.ts,modules/**,platform.ts,platform.smoke.test.ts}`; `apps/runtime/src/
purchase/**` + `purchase-saga-activities.ts` (+test) — R2 entirely; Phase 6.1's un-audited remainder
(~15 files); `services/orders/src/interfaces/payment-captured.consumer.ts`'s Created-In only;
`services/pricing/src/application/validate-price-lines.use-case.ts`; `services/customer-360/src/
interfaces/customer-360.controller.ts`; `scripts/governance/**`'s own creation (minus FF-FR-01);
`.husky/pre-commit` line 2's creation; `docs/DECISIONS.md`, `docs/KNOWN_GAPS.md`,
`docs/architecture/{20-events-catalog,22-context-map}.md`; root `package.json`/`pnpm-workspace.yaml`/
`pnpm-lock.yaml`.

## Every downgrade from V4, explained

| File(s)                                                                                                                                                                                                 | V4's confidence                                                                          | V5's confidence                                                                                                                                                               | Why                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/observability/package.json`                                                                                                                                                                   | High, R3                                                                                 | High, **P2 (H-5)**                                                                                                                                                            | Not a confidence downgrade — an ownership correction. The quote is real; the milestone was wrong.                                                                                                                         |
| `services/media/package.json`                                                                                                                                                                           | High                                                                                     | **Medium**                                                                                                                                                                    | The file's own text doesn't support the Sprint-5.4 claim; only `src/index.ts` does.                                                                                                                                       |
| `apps/runtime/src/{module.ts,platform.ts,jobs.ts,diagnostics.ts,metrics.ts,shutdown.ts,health-server.ts}`                                                                                               | High ("Confirmed," self-cited)                                                           | **Unknown** (`module.ts`/`platform.ts`/`diagnostics.ts`/`shutdown.ts`) or **Medium** (`jobs.ts`/`metrics.ts`/`health-server.ts`, pre-existence attested but creation Unknown) | The prior "Confirmed" was a recovery-document self-citation, invalid under RA-1's rules; independent primary-source checks found either nothing or direct evidence of pre-existence rather than creation.                 |
| `scripts/governance/**` (base), `docs/governance/*.md`, baseline JSONs, `.husky/pre-commit` line 2                                                                                                      | High (via `GOVERNANCE_HISTORY_RECOVERY_ANALYSIS.md`/`GOVERNANCE_POSITION_IN_HISTORY.md`) | **Unknown**                                                                                                                                                                   | Those two citations are recovery-process documents, invalid under RA-1's rules; no primary source was found to replace them.                                                                                              |
| E1 (`apps/collector/**`), E2 (`packages/tracking/src/browser/**`)                                                                                                                                       | Scheduled "Executable" in V4's plan despite a stated Medium confidence                   | **Medium, explicitly Not Executable**                                                                                                                                         | Internal contradiction corrected — the scheduling status now matches the confidence level instead of contradicting it.                                                                                                    |
| `packages/temporal/src/runtime.ts` (dirty delta), `packages/http`'s `HttpMetricsSink` fragment, ~40 `packages/tracking` files, `services/finance`'s `ShippingRateCard` cluster, R2, Phase 6.1 remainder | Unknown                                                                                  | **Unknown (unchanged)**                                                                                                                                                       | These were already correctly Unknown; reconfirmed, not further downgraded — listed here only because a prior draft of this summary might have implied everything changed. Nothing about these entries moved in this pass. |

No confidence was upgraded anywhere without a specific, quoted, freshly-checked primary source
backing the upgrade — the only "upgrades" in V5 relative to V4 are the ~750 G1-G5/C1-C12 files whose
real per-file evidence (already gathered, genuinely primary-sourced) is now actually visible in the
document instead of hidden behind a phantom citation; their underlying confidence level is
unchanged, only its visibility and traceability improved.

# Execution Timeline — V5 (rebuilt from scratch)

RA-1 Phase 5 deliverable. Planning only — no code modified, nothing staged, nothing committed, no
milestone executed. Rule applied throughout: **executable milestones may contain only
High-confidence files.** Where a milestone's file set mixes High and Medium/Unknown files, it is
split into a **Core** step (High-confidence files only, executable) and a **Deferred** set (Medium/
Unknown files, held back, listed explicitly rather than silently included).

**Confidence-tier clarification (stated once, applies throughout):** "High" here includes both (a)
files individually named by a primary source, and (b) a package's composition root / event
translator / barrel file where the primary source explicitly discusses that structural role by
function (e.g. "wireCatalog wires the new Collection aggregate," "one `IdentityEventTranslator`...
extended") even without spelling the literal filename — this codebase's own established
one-role-per-file convention makes that mapping unambiguous, not a guess. Genuinely undiscussed
boilerplate (`tsconfig.json`, `vitest.config.ts`, unnamed test files, unnamed generic repository/
mapper implementations with no structural mention at all) stays Medium and is **deferred**, per the
strict rule. Every file this distinction affects is named explicitly below and in
`PATCH_OWNERSHIP_MATRIX_V5.md` — nothing is hidden inside a blanket "High" label.

## Rebuilt sequence

1. **Tier 9 — docs-only.** Zero risk. Unchanged.
2. **K1** — already committed (`8a9c4eb`). Out of scope.
3. **K2** — already committed (`5c4b7bd`). Out of scope.
4. **K3 — Verify inherited implementation (completed).** Originally scoped as
   `packages/{observability,secrets,auth,http,health,temporal}` **base content only** (excludes
   every later patch — see steps 12-16, 24 below). Pre-flight execution found all 42 base-scope
   files (`temporal`'s dirty delta aside, which was already Unknown/excluded) already present,
   byte-identical, in `recovery/history-reconstruction`'s inherited history (ancestor commits
   `ed3654d`/`f1336a5`, both confirmed via `git merge-base --is-ancestor`) — no reconstruction
   commit was needed or made. Closed as **Already Inherited**; see `K3_EXISTENCE_PROOF.md`/
   `K3_CLOSURE_REPORT.md`. Milestone numbering and every later step's position are unchanged — this
   is a verification checkpoint, not a removed step. Deferred (unaffected by this closure, still
   belongs to later milestones): the un-decomposed base/patch line-split inside `kratos.ts`/
   `server.ts` (hold until a line-level diff is performed at whichever of P2/P2.0.2/P2.0.3/R3
   actually executes, per the standing cross-cutting-file rule).
5. **K4** — `packages/registry/**`, `packages/entitlement/**`, `packages/usage/src/{usage-registry.ts,
usage-registry.test.ts}` + `usage-resource.ts` extension. Deferred: `packages/registry/{package.json,
tsconfig.json}`, `packages/entitlement/{package.json,tsconfig.json}` (Medium, package-level only —
   these two files stage automatically as part of the package's own necessary manifest, held to the
   same milestone rather than orphaned, but flagged Medium in the confidence summary).
6. **K5** — `packages/expression/**`, `packages/rules/**`, cited against D-078.
7. **K6** — `packages/usage/{package.json,tsconfig.json,src/index.ts (base),usage-record.ts,
usage-recorded.event.ts,usage-recorder.port.ts,usage-event-translator.ts,usage.test.ts}`.
8. **K7-Core** — the ~35 file-specifically-evidenced tracking files (collector, registry-graph,
   envelope/payload, ids/dedup-id, delivery/{resilience,router,pipeline,adapters}, queue, replay/_,
   runtime/_, inspector/event-record). **Deferred**: ~40 remaining `definitions/execution/
intelligence/pipeline/inspector/envelope/delivery` files — Unknown, no primary source.
9. **T1-Core** — `services/finance/**` minus the `ShippingRateCard`/`ShippingRate`/
   `QuoteShippingRates` cluster and its unattested fragments in 4 sibling files. **Deferred**: that
   cluster (Unknown).
10. **T2-Core** — `services/analytics/**` domain/engine/registry/resolver/infrastructure only.
    `composition.ts`/interfaces layer moves to step 26 (R3, its real owner).
11. **C1-C12** — one commit per context, per `PATCH_OWNERSHIP_MATRIX_V5.md` Part C. Order unchanged
    (4.1→4.12). **Deferred within this step:** C4's `validate-price-lines.use-case.ts` (Unknown);
    C7's `payment-captured.consumer.ts` Created-In claim (stage the file under C7 with an explicit
    "pre-existing, exact origin sprint Unknown" note rather than an asserted sprint — its A1 patch
    proceeds normally at step 28); C5's `cached-cart-repository.test.ts` (Medium, undiscussed —
    defer); C7/C8's ungrouped generic use-case files (`get-order.use-case.ts`,
    `get-payment-intent.use-case.ts` — Medium, undiscussed — defer).
12. **G1-G5** — one commit per group, per `PATCH_OWNERSHIP_MATRIX_V5.md` Part D. **Deferred**:
    `services/media/package.json` (downgraded to Medium this pass — its own text doesn't support
    the Sprint-5.4 attribution; `src/index.ts` proceeds normally, High).
13. **P1** — `services/feature-registry/**`.
14. **P2 (expanded)** — `services/security/**`, `security.prisma` + 4 migrations,
    `packages/auth/src/keto-relationships.ts` (+2 tests) and the `KetoRelationshipClient`
    export/`body` field (moved in from K3), `packages/secrets/src/{envelope.ts,envelope.test.ts}`
    (moved in from K3), `apps/runtime/src/telemetry.ts` (moved in from R1's prior, now-vacated
    scope), `packages/observability/package.json`'s OTel bump (**newly, correctly assigned here as
    P2.0-H5**, not R3), and the entire H-5 production-readiness cluster (`chaos/**`, `perf/**`,
    `infrastructure/k8s/**`, `infrastructure/docker/{alertmanager,prometheus/rules,
grafana/provisioning/dashboards}/**`, `docs/operations/*.md`, `docs/releases/v1.0.0-rc.1/*`,
    `.github/workflows/{release,deploy}.yml`) — **the single largest correction from V4**: this
    cluster was previously scheduled under R3/Sprint 9 citing a report that never mentions it; it
    belongs here, under P2's own H-5 section, which does.
15. **P3** — `apps/runtime/src/security/**` (9 files), P2.0.2 half of `packages/http/{index.ts,
server.ts,server.test.ts}`, `apps/runtime/src/modules/{security-provisioning,security-consumer}.
module.ts`, the provisioning-gate fragment of `apps/runtime/src/{worker.ts,config.ts}`.
16. **P4** — `apps/runtime/src/security/{edge-zero-trust.ts,session-federation.integration.test.ts}`,
    P2.0.3 half of `packages/http/server.ts`/`.test.ts`.
17. **Phase 6.1-Core (new, unnamed step, precedes N1)** — the 6 audited files
    (`identity-resolution.ts`, `split-identity.use-case.ts`, `observe-identity-link.use-case.ts` +
    tests). **Deferred**: the ~15-file remainder (Medium/Unknown, no per-file citation).
    18-21. **N1, N2, N3(+6.4.1), N4** — four separate commits, per `PATCH_OWNERSHIP_MATRIX_V5.md` Part
    E's per-phase manifests. All High per their §4 manifests. `interfaces/customer-360.controller.ts`
    deferred (no report names it at any phase).
18. **E1** — `apps/collector/**`. **Not Executable per the strict rule** — confidence is Medium
    (context-level match only, `P5_M6...md` opened directly but not exhaustively file-checked this
    pass). Listed here for ordering purposes only; actual execution must wait for a dedicated
    file-level re-review or accept explicit Medium-tier risk (see Final Execution Plan).
19. **E2** — `packages/tracking/src/browser/**`. Same Medium-confidence, same non-Executable status
    as E1.
20. **R1 (severely narrowed)** — `apps/runtime/src/seed.ts`, `apps/runtime/scripts/dev-all.mjs`,
    `apps/storefront/src/app/page.tsx`. **Deferred (Unknown)**: `module.ts`, `module.test.ts`,
    `modules/**`, `platform.ts`, `platform.smoke.test.ts`, `jobs.ts` (creation), `diagnostics.ts`,
    `shutdown.ts`, `metrics.ts` (creation), `health-server.ts` (creation) — none of these have any
    primary source documenting their creation; several are directly attested as **pre-existing**
    (not created by R1) rather than merely undocumented.
21. **R2 — BLOCKED, not scheduled at any position.** No dedicated report exists anywhere.
22. **R3** — `packages/health/src/{registry.ts,registry.test.ts}` (patch half), `packages/http/
{route.ts,server.ts,server.test.ts}` (Sprint-9 patch half), `services/analytics/src/
{composition.ts,interfaces/analytics-console.controller.ts,interfaces/presenter.ts}` (moved in
    from T2), migration `20260722010000_customer_360_durable_storage`. **Removed from R3's scope**:
    the entire chaos/perf/k8s/ops/CI/releases cluster and `packages/observability/package.json` —
    both moved to P2 (step 14) per the H-5 correction.
23. **GOV** — placement remains "after E2, before R1" as a stated **project convention**, not an
    evidenced dependency (no primary source supports this ordering; the two documents previously
    cited for it are recovery-process documents, invalid per RA-1's rules). Files:
    `scripts/governance/**` (creation Unknown, except the one FF-FR-01 rule — ADR-0028, attributable
    to P1), `docs/governance/*.md` (Unknown), baseline JSONs (Unknown), `.husky/pre-commit`'s one
    added line (Unknown creation). **Given nearly the entire GOV file set is Unknown-confidence,
    GOV as a whole is not Executable under the strict rule** — see Final Execution Plan.
24. **A1g** — `apps/admin/**` minus A1's specific patch lines. Medium confidence (aggregate, no
    single owning report, ~36 per-context reports collectively).
25. **A1** — `services/orders` patch (`completePayment`, shadow plumbing), `apps/admin` patch
    (`/mark-paid` route). High confidence throughout, already gate-verified this session.

## Reorderings from V4, with documentary justification

- **The H-5 production-readiness cluster and `packages/observability/package.json` moved from R3
  (step 26) to P2 (step 14).** Justification: direct re-read of both candidate reports found the
  quote only in `P2_0_ENTERPRISE_SECURITY_REPORT.md`'s own H-5 section; `SPRINT_9_OPERATIONAL_
HARDENING_REPORT.md` never mentions this content anywhere.
- **GOV's file set downgraded from "Executable" (V4) to non-Executable (V5).** Justification: V4's
  citations for GOV's existence and placement (`GOVERNANCE_HISTORY_RECOVERY_ANALYSIS.md`,
  `GOVERNANCE_POSITION_IN_HISTORY.md`) are recovery-process documents, invalid under RA-1's rules;
  no primary source was found to replace them except ADR-0028's narrow FF-FR-01 confirmation.
- **`apps/runtime/src/telemetry.ts` confirmed at P2 (unchanged position from the V4 correction,
  re-verified fresh this pass).**
- **E1/E2 downgraded from "Executable" (V4, inconsistently) to explicitly non-Executable (V5).**
  Justification: their own confidence label (Medium) was already stated in V4; V5 simply makes the
  scheduling status consistent with that label instead of contradicting it.
- All other positions unchanged from the prior pass — no new evidence this pass argued for moving
  anything else.

---

No document referenced above was deleted. No git state was modified. No code was modified. Nothing
was staged. Nothing was committed. No milestone was executed.

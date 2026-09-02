# Medium Findings Remediation Plan

**Source:** `MEDIUM_VERIFICATION_REPORT.md` (2026-08-06, `HEAD` `8781f07`). Includes only findings
classified **VERIFIED** or **PARTIALLY VERIFIED** in that report. All 7 re-investigated Medium findings
were classified VERIFIED; zero were FIXED INDIRECTLY, NOT REPRODUCED, or DUPLICATE, so all 7 appear
below.

**Status: PLAN ONLY.** Per the sprint's own rules, nothing in this document has been implemented. Do
not begin remediation until explicitly instructed.

---

## Risk Classification and Sequencing

Each finding is scored across the five required risk dimensions (High / Medium / Low / None), then
sorted by the mandated priority order: **Production Risk → Runtime Risk → Data Integrity Risk →
Operational Risk → Performance Risk.**

| ID   | Production Risk | Runtime Risk | Data Integrity Risk | Operational Risk | Performance Risk |
| ---- | --------------- | ------------ | ------------------- | ---------------- | ---------------- |
| M2-3 | High            | Medium       | High                | Medium           | None             |
| M2-2 | High            | Low          | Medium              | Low              | None             |
| M2-7 | Medium          | Medium       | Low                 | Low              | None             |
| M2-1 | Medium          | Low          | None                | Medium           | None             |
| M2-6 | Medium          | None         | None                | High             | None             |
| M2-4 | Low             | Medium       | None                | Low              | None             |
| M2-5 | None            | None         | None                | Low              | None             |

**Rationale for the top two:** M2-3 and M2-2 are the only findings where production users (or, for
licensing, paying merchants) receive an outcome that silently misrepresents reality — a "collected"
invoice with no money taken, or a media asset URL that resolves to nothing while the system reports it
as existing. Both are High production risk. M2-3 ranks above M2-2 because its data-integrity
consequence is financial (ledger state) rather than presentational (a broken image), and financial data
integrity issues compound (refunds, revenue recognition, compliance) in ways a broken thumbnail does
not.

---

## Remediation Sequence (highest priority first)

### 1. M2-3 — Licensing billing never moves money

**Production impact:** Merchants can hold an active paid subscription and consume licensed capability
while zero money has actually been collected — a direct revenue-integrity gap, worse than M2-2 because
it's silent at the ledger level, not just the presentation level.

**Recommended remediation (guardrail phase — matches the existing `deps.X ?? default` pattern used
five times elsewhere in this composition root):**

1. Add optional `payments?: PaymentsPort` and `financeLedger?: FinanceLedgerPort` fields to
   `LicensingWiringDeps`, defaulting to today's in-memory stubs so no existing test or environment
   changes behavior.
2. Fail closed at boot when `APP_ENV !== "local"` and either resolves to the in-memory default —
   mirrors the pattern already used for MFA (C2-4) and the KMS/crypto/identity seams in Security.
3. Building the real PSP-backed adapter and a real Finance-ledger adapter is **out of scope for this
   plan** — it is the same class of engineering work as the still-open C2-2 (Critical) real-PSP-adapter
   long pole, and the audit already notes M2-3 is "blocked behind" C2-2. Do not duplicate that
   adapter-building effort here; once C2-2's real PSP adapter exists, Licensing should consume it rather
   than growing a second one.

**Implementation complexity:** Medium (guardrail phase only — adding the injection seam plus a boot
check, no new adapter). Building the real adapter (deferred) would be Large-to-XL, shared work with
C2-2.
**Regression risk:** Low — both new fields are optional and default to current behavior; no existing
test exercises a non-default path today.
**Expected commit count:** 2 (one for the `LicensingWiringDeps` seam + defaults, one for the fail-closed
boot check with its own test) for the guardrail phase; the real-adapter phase is unscoped and excluded
from this estimate.

---

### 2. M2-2 — Media object storage is a stub that reports every object as existing

**Production impact:** Every media asset's existence check and download URL resolve through a stub
that always says "yes, it exists" and returns a URL template that has never pointed at real storage —
directly customer/admin-visible (broken images, dead download links) once Media's already-durable
Postgres asset rows are browsed in any real environment.

**Recommended remediation:**

1. Implement `StorageServiceObjectStorage`'s two methods (`exists`, `getDownloadUrl`) against the
   already-complete `@platform/storage` S3-compatible client — this is explicitly the smallest possible
   fix per the audit ("a complete S3-compatible client — has zero importers... the wiring is one field
   in one object literal" pattern used elsewhere in this codebase for comparable gaps).
2. Pass the real adapter through `wireAdmin` → `wireMediaLibrary`'s existing `deps.objectStorage` seam
   (the seam already exists, unlike M2-3 — this is strictly additive wiring, no new interface).
3. Fail closed at boot outside `local` if the resolved adapter is still `InMemoryObjectStorage`,
   consistent with the guardrail pattern used for M2-3 and the audit's C2-4 precedent.

**Implementation complexity:** Medium — the client already exists; this is adapter-implementation plus
wiring, not new infrastructure.
**Regression risk:** Low — `deps.objectStorage` is already optional and already defaults to the
in-memory stub for every existing test; only production composition changes.
**Expected commit count:** 2 (adapter implementation + test, then the `wireAdmin` wiring + fail-closed
boot check).

---

### 3. M2-7 — Consumer-path payment verification is optional

**Production impact:** Currently defensible by design (the consumer's input is Payments' own capture
event), but the audit's own concern stands: an optional field makes a _future_ regression on this path
silent rather than loud, unlike the admin path which would reject an unverified ref outright.

**Recommended remediation:** make the trust boundary explicit rather than implicit, without changing
today's behavior:

1. Either (a) rename/document the omission at the `buildPaymentCapturedRuntime` call site with an
   explicit named justification (e.g., a `TRUSTED_EVENT_SOURCE` marker or a required-but-self-documenting
   parameter) so a future refactor cannot silently drop verification without a visible diff, or
   (b) add a lightweight assertion/log at consumption time confirming the event's `payments.payment_intent.captured.v1`
   provenance before calling `MarkOrderPaid`, so the "trust" is asserted in code, not just in a comment.
   Option (a) is smaller and lower-risk; recommend it as the default unless the remediation team wants
   the extra observability of (b).
2. Do **not** make `paymentVerification` required — that would reintroduce the redundant-verification
   cost the audit found defensible to skip on this path.

**Implementation complexity:** Small.
**Regression risk:** Low — no behavior change, only makes an existing implicit contract explicit/loud
for future changes.
**Expected commit count:** 1.

---

### 4. M2-1 — The purchase saga cannot complete

**Production impact:** The durable Temporal saga path is entirely inert (zero `.signal()` call sites,
zero `@platform/temporal` importers); the platform depends solely on the synchronous HTTP fallback.
Currently moot in practice because the real-PSP-adapter gap (C2-2) blocks purchases earlier in the
chain regardless — this is why the audit downgraded it from Critical to Medium.

**Recommended remediation:** do not schedule independently. Per the standing
`ARCHITECTURE_EXECUTION_MATRIX.md` dependency analysis (already on file in `docs/implementation/`), the
saga-completion work should be sequenced alongside the real-PSP-adapter chain (C2-2/A4a-c), not before
it — building saga completion first would exercise a code path that still cannot take a real payment,
which has limited verification value. Recommend explicitly flagging this as **deferred, dependency-
gated on C2-2**, rather than scheduling a standalone Medium-priority sprint item.

**Implementation complexity:** Large-to-XL (Temporal workflow + activity + signal wiring, compensation
logic) — shares critical-path length with the PSP adapter chain per the existing dependency graph.
**Regression risk:** Medium — touches the synchronous fallback's relationship to the saga; needs careful
cutover sequencing (same caution the architecture remediation plan already documented for A1's payment-
truth cutover).
**Expected commit count:** not estimated here — this is XL, multi-sprint work; out of proportion for a
single remediation-plan line item. Recommend a dedicated design pass when C2-2 lands, not a commit
estimate now.

---

### 5. M2-6 — The storefront is built but not deployed

**Production impact:** The customer-facing storefront tier has no path to production at all — no
container image job, no Kubernetes manifests. High operational-readiness risk (blocks launch) but,
correctly per the audit, no active production-safety bug in anything already running.

**Recommended remediation:** mirror the collector's H-07 fix pattern exactly (same shape of gap, already
solved once in this repo):

1. Add a `storefront-image` job to `build.yml` (Dockerfile already exists —
   `infrastructure/docker/web.Dockerfile`), matching the `collector-image` job's structure.
2. Add `infrastructure/k8s/2N-deployment-storefront.yaml` + Service + Ingress entries, following the
   existing manifest conventions (security context, PDB, HPA, NetworkPolicy) already applied to
   api/worker/scheduler/collector.
3. Point `apps/storefront/src/lib/runtime-api.ts`'s production default at the real in-cluster API
   service rather than `localhost:3080` (config-driven, not hardcoded).

**Implementation complexity:** Medium — the Dockerfile and CI patterns to copy already exist and were
proven out for the collector in H-07; this is repetition of a known-good pattern, not new design.
**Regression risk:** Low — purely additive (new image, new manifests); does not touch any currently
running service.
**Expected commit count:** 3 (image build job; k8s Deployment/Service manifests; Ingress + config
default fix), matching the granularity H-07 used for the structurally identical collector gap.

---

### 6. M2-4 — Type checking is defeated at two runtime composition seams

**Production impact:** No active bug today; the risk is purely latent — a future Prisma
model/delegate rename at either site would compile cleanly and fail only at runtime, and per H2-9
(still unaddressed, see Carryover Context in the verification report) no integration test exists that
would catch it first.

**Recommended remediation:** widen `PrismaTrackingRegistryStore`'s and `PrismaEventRecordStore`'s
constructor parameter types from implicit-`never`-compatible to the shared `Database` type (from
`@platform/db`), then drop both `as never` casts. This is exactly the fix the audit itself recommended
and requires no behavior change if the types already line up (which they do — the cast was defeating a
check, not working around a real mismatch).

**Implementation complexity:** Trivial — two-line type change per site.
**Regression risk:** Low. Small residual risk that the cast was silently papering over an actual latent
type mismatch (the whole point of the finding) — if so, removing it will surface a real compile error,
which is the desired outcome, not a regression.
**Expected commit count:** 1.

---

### 7. M2-5 — Analytics and Platform Console are non-durable (disclosed, accepted)

**Production impact:** Low and explicitly accepted — both are correctly-scoped in-process read-models
with no aggregate to persist; the only residual action is documenting the restart-resets-KPIs behavior
for operators.

**Recommended remediation:** add a note to the operations runbook (not a code change) stating that
Platform Console KPIs and the Analytics semantic registry reset on every restart/rollout, so on-call
does not mistake a redeploy for a data-loss incident.

**Implementation complexity:** Trivial (documentation only).
**Regression risk:** None.
**Expected commit count:** 1 (docs).

---

## Summary

| Priority | ID   | Complexity                                    | Regression Risk | Commits (est.) |
| -------- | ---- | --------------------------------------------- | --------------- | -------------- |
| 1        | M2-3 | Medium (guardrail phase)                      | Low             | 2              |
| 2        | M2-2 | Medium                                        | Low             | 2              |
| 3        | M2-7 | Small                                         | Low             | 1              |
| 4        | M2-1 | Large–XL (deferred, dependency-gated on C2-2) | Medium          | not estimated  |
| 5        | M2-6 | Medium                                        | Low             | 3              |
| 6        | M2-4 | Trivial                                       | Low             | 1              |
| 7        | M2-5 | Trivial (docs only)                           | None            | 1              |

**Total estimated commits (excluding M2-1, unscoped):** 10, across 6 findings.

**Explicitly out of scope for this plan** (per this sprint's own rules): no fixes have been applied; no
architecture has been redesigned; no public APIs or event contracts have changed. This document is a
sequencing and estimation artifact only, to be used when a remediation sprint is separately authorized.

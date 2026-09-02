# Medium Findings Verification Report

**Baseline audited:** `FINAL_PRODUCTION_READINESS_AUDIT_v2.md` (2026-08-05, `main` @ `aee3269`), Medium
register as restated in `HIGH_FINDINGS_SUMMARY.md` (M2-1 through M2-7).
**Re-verified at:** current `HEAD` `8781f07` (2026-08-06), after the Critical sprint, the High Findings
sprint (`556619b`..`8813210`), and the Production Integration Verification Sprint
(`432e2b3`..`8781f07`).
**Scope:** the 7 Medium findings only. This is **not** a remediation sprint — no fixes, refactors, or
architecture changes were made. Every claim below was independently re-derived from current source,
not copied from the v2 audit.
**Method:** for each finding — locate the exact file:line(s) the audit cited, re-read current source at
that location, `git log <baseline>..HEAD -- <file>` to check whether it was touched by any intervening
sprint, and re-run the repo-wide search the original finding was based on (call-site counts, importer
counts, etc.) to catch drift the line-citation alone would miss.

---

## Repository Validation (run before investigation, per sprint rules)

| Gate                             | Result   | Notes                                                                                                                                                                                                            |
| -------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                 | **PASS** | 76/76 packages, full Turbo cache hit (no source changed since last verified run)                                                                                                                                 |
| `pnpm lint`                      | **PASS** | exit 0                                                                                                                                                                                                           |
| `pnpm arch` (dependency-cruiser) | **PASS** | `no dependency violations found (1531 modules, 6672 dependencies cruised)`                                                                                                                                       |
| `pnpm test`                      | **PASS** | exit 0 (serialized `turbo run test --concurrency=1` isn't available as a bare `turbo` binary on this host's PATH — `pnpm test`, which invokes the same underlying script, was used instead and is authoritative) |

**No failing gates to document separately.** All four gates green at `HEAD` before any finding was
investigated.

---

## Findings Register

### M2-1 — The purchase saga cannot complete

**Original claim (v2 audit):** zero `.signal()` call sites repository-wide (only an unrelated
`TrackingRegistryStore.signal` method matches the string); `@platform/temporal` has zero importers in
any `.ts` file.

**Current Status: VERIFIED**

- **Code location:** no production call site exists; the only matches for `.signal(` in the entire
  repo are `apps/runtime/src/tracking/tracking-registry-handle.ts:218` and
  `apps/runtime/src/composition.ts:287`, both calls to `TrackingRegistryStore.signal()` — an unrelated
  tracking-registry hot-reload primitive, not a Temporal workflow signal.
- **Execution path:** `@platform/temporal` — searched as an import specifier (`"@platform/temporal"`)
  across every `.ts` file in the repo — has **zero importers**. No file, route, or worker imports or
  constructs a Temporal client, workflow, or signal.
- **Runtime proof:** N/A (absence-of-code finding; nothing to execute). The synchronous HTTP
  fallback path remains the only way to complete a purchase, same as v1/v2.
- **Regression test:** none exists for saga completion (nothing to regress — there is no saga
  completion code path).
- **Repository search for related changes:** `git log aee3269..HEAD -- packages/temporal` returns
  no commits. No sprint since the v2 audit touched Temporal wiring.
- **Production impact:** unchanged from the v2 audit. The durable saga described in the architecture
  docs cannot finish a purchase; the platform depends entirely on the synchronous fallback. This is a
  design-completeness gap, not a regression — downgraded from Critical to Medium in v2 because the
  payment path (C2-2, since fixed for the admin path but still gated behind a real PSP adapter) blocks
  strictly earlier.
- **Recommended remediation priority:** Medium — no change from v2. Revisit once real PSP integration
  makes the saga path reachable in practice; fixing it earlier has no user-visible effect.

---

### M2-2 — Media object storage is a stub that reports every object as existing

**Original claim (v2 audit):** `InMemoryObjectStorage.exists()` returns `true` unconditionally and
`getDownloadUrl()` returns a non-resolving `https://storage.local/<key>` URL; the real
`StorageServiceObjectStorage` adapter throws "not wired in this environment yet"; `wireAdmin` never
passes a real `objectStorage`; `@platform/storage` has zero importers outside its own package.

**Current Status: VERIFIED**

- **Code location:** `services/media/src/infrastructure/object-storage-adapters.ts:4-12`
  (`InMemoryObjectStorage`, unchanged — `exists()` still unconditionally `return true`,
  `getDownloadUrl()` still returns the same placeholder URL template) and lines 19-27
  (`StorageServiceObjectStorage`, unchanged — both methods still throw).
  `services/media/src/media-library.composition.ts:73` still reads
  `deps.objectStorage ?? new InMemoryObjectStorage()`.
- **Execution path:** searched every file under `apps/` for the string `objectStorage` — **zero
  matches**. Neither `apps/admin`'s `wireAdmin` nor `apps/runtime`'s composition passes a real
  `ObjectStoragePort` implementation anywhere; the in-memory stub is what production actually gets.
- **Runtime proof:** by inspection — any `GetDownloadUrl`/asset-existence check served through
  `wireMediaLibrary` (Prisma or in-memory branch, both call the same `buildController`) resolves
  through the stub regardless of branch, since the seam is `deps.objectStorage`, never populated.
- **Production composition:** confirmed both the Prisma-backed and in-memory branches of
  `wireMediaLibrary` share `buildController`, so the durable-persistence work done elsewhere for
  Media (asset rows in Postgres) does not change this — asset bytes still have no real store.
- **Repository search for related changes:** `git log aee3269..HEAD` for
  `services/media/src/media-library.composition.ts` and
  `services/media/src/infrastructure/object-storage-adapters.ts` — **no commits**. `@platform/storage`
  importers repo-wide: `packages/storage/src/s3-object-storage.integration.test.ts` (the package's own
  test) plus three files in `services/media` that reference it only in comments (unchanged from the
  audit's own description) — confirmed still zero real importers.
- **Production impact:** unchanged. Media assets are durably tracked in Postgres (via P1.5's Prisma
  conversion) while their bytes have no store and their URLs do not resolve — the gap the v2 audit
  described is now arguably more visible in production, not less, since the metadata side looks
  durable.
- **Recommended remediation priority:** Medium — no change from v2.

---

### M2-3 — Licensing billing never moves money

**Original claim (v2 audit):** `services/licensing/src/composition.ts` constructs
`InMemoryPaymentsAdapter` and `InMemoryFinanceLedgerAdapter` unconditionally, in both the Prisma and
in-memory branches, feeding `CreateInvoice`/`IssueInvoice`/`CollectInvoice`/`GrantCredit`. SaaS
subscription invoices transition to "collected" without any real payment being taken.

**Current Status: VERIFIED**

- **Code location:** `services/licensing/src/composition.ts:53-56` (imports) and lines 121-123
  (`buildController`) — `payments = new InMemoryPaymentsAdapter()` and
  `financeLedger = new InMemoryFinanceLedgerAdapter()` are constructed inside `buildController`, the
  single function shared by **both** the Prisma branch (line 207) and the in-memory branch (line 239).
  Unlike `prisma`/`tenantId`, there is **no `deps.payments ?? default` seam at all** — the audit's own
  doc comment (lines 87-93) explicitly discloses "the deferred `payments`/`financeLedger`
  billing-adapter stubs stay in-memory in both branches — out of scope for C-01," which matches what
  the code does today.
- **Execution path:** `CreateInvoice`/`IssueInvoice`/`CollectInvoice`/`GrantCredit` (lines 167-172) all
  receive `billingDeps`, which embeds the two in-memory adapters directly — there is no code path,
  configuration flag, or dependency-injection seam by which a real payment or ledger call could reach
  these use-cases today.
- **Runtime proof:** by inspection — `CollectInvoice` against `InMemoryPaymentsAdapter` cannot fail in
  a way that blocks invoice collection (no real gateway to reject the charge), so every invoice
  collection succeeds unconditionally regardless of whether a real payment was ever taken.
- **Repository search for related changes:** `git log aee3269..HEAD -- services/licensing/src/composition.ts`
  — no commits since the baseline. Confirmed identical to the audited version.
- **Production impact:** unchanged. This is the same class of gap as the (Critical, still-gated-behind-
  real-PSP) C2-2 payments finding, scoped to SaaS/platform billing rather than storefront checkout —
  revenue recognized for licensing subscriptions is fictitious until a real adapter exists.
- **Recommended remediation priority:** Medium — no change from v2, but note it is **strictly worse
  than M2-2 structurally**: M2-2 at least has an optional-dependency seam (`deps.objectStorage ?? …`)
  ready to receive a real adapter; M2-3 has no seam at all, so remediation here also requires adding the
  injection point first, not just building the adapter.

---

### M2-4 — Type checking is defeated at two runtime composition seams

**Original claim (v2 audit):** `apps/runtime/src/composition.ts:268` and
`apps/runtime/src/tracking/wire-tracking-runtime.ts:169` both cast the Prisma client with `as never`
when constructing tracking stores, silently defeating the type check that would otherwise catch a
model/delegate mismatch.

**Current Status: VERIFIED**

- **Code location:** both casts are present today, at shifted line numbers (the file grew from
  intervening High-sprint work): `apps/runtime/src/composition.ts:281` —
  `new PrismaTrackingRegistryStore(core.prisma as never, core.idGenerator)` — and
  `apps/runtime/src/tracking/wire-tracking-runtime.ts:169` —
  `new PrismaEventRecordStore(input.db as never, input.idGenerator)`. Text is byte-identical to the
  audit's citation; only the surrounding line count changed.
- **Execution path:** both remain the sole production construction sites for
  `PrismaTrackingRegistryStore` and `PrismaEventRecordStore`; no widened type or intermediate adapter
  was introduced anywhere in between.
- **Runtime proof:** N/A — this is a compile-time-defeat finding, not a runtime-failure finding; its
  entire risk is that a _future_ schema/delegate rename would compile cleanly here and fail at runtime.
  Nothing to reproduce today beyond confirming the cast is still live.
- **Repository search for related changes:** `git log aee3269..HEAD -- apps/runtime/src/composition.ts`
  shows exactly one intervening commit, `11cd124` (`fix(admin,runtime): fail closed on tenant mismatch
and TENANT_MODE=multi`, C2-6) — unrelated to the tracking stores or the `as never` casts, confirmed by
  reading the diff context around both cast sites (unchanged). `wire-tracking-runtime.ts` has zero
  intervening commits.
  Three _new_ `as never` occurrences now exist in the repo since the baseline
  (`apps/runtime/src/security/edge-middleware.test.ts:25`,
  `apps/runtime/src/tracking/tracking-ingest-wiring.test.ts:25,67`,
  `apps/runtime/src/security/edge-zero-trust.test.ts:26`) — all four are **test-file mock casts**, a
  different and normal use of `as never` (widening a partial mock to satisfy a parameter type in a
  test), not production composition-seam casts. They do not enlarge this finding's scope, which the v2
  audit explicitly limited to the two named runtime composition sites.
- **Production impact:** unchanged. `H2-9` (33/37 contexts never integration-tested, see Carryover
  Context below) is still true, so the audit's stated aggravating factor — "nothing else would catch a
  mismatch here" — still holds exactly as described.
- **Recommended remediation priority:** Medium — no change from v2. Cheapest of the seven findings to
  fix (widen the parameter type to the shared `Database` type at both sites; no behavior change).

---

### M2-5 — Analytics and Platform Console are non-durable (disclosed, accepted)

**Original claim (v2 audit):** `services/analytics/src/composition.ts` and
`services/platform-console/src/composition.ts` take zero dependencies; both are correctly documented
as read-models/in-process catalogs with no aggregate to persist. The audit endorsed the decision not to
invent a persistence shape, flagging only that KPI reset-on-restart should be stated in the ops runbook.

**Current Status: VERIFIED (disclosed, accepted — unchanged)**

- **Code location:** `services/analytics/src/composition.ts` — `wireAnalytics()` (lines 21-25) still
  takes **no parameters** and builds an in-process `SemanticRegistry`. Its doc comment (lines 12-19)
  still explicitly discloses this is Phase 9 hardening giving the context its first composition root at
  all, "read-model-only, no aggregates, no outbox, no business logic." `services/platform-console/src/composition.ts`
  — `wirePlatformConsole()` (lines 15-23) still takes **no parameters**, builds an in-process
  `PlatformKpisProjection`, and its comment still discloses "a later runtime milestone wires `ingest`
  onto the live event bus" — not yet done.
- **Execution path:** neither function has gained a `prisma`/`tenantId`-presence branch like every
  other Sprint 5.x context now has; both remain single-branch, dependency-free composition roots.
- **Runtime proof:** by inspection — a process restart discards `SemanticRegistry`'s and
  `PlatformKpisProjection`'s state; nothing persists it. Unchanged behavior.
- **Repository search for related changes:** `git log aee3269..HEAD` for both composition files —
  no commits.
- **Production impact:** unchanged — low, and explicitly accepted risk per the v2 audit's own
  reasoning, which this re-verification confirms is still architecturally correct (no aggregate exists
  to back either read-model with real persistence). The only residual action item — stating the
  restart-resets-KPIs behavior in the operations runbook — was not verified as done or not done (out of
  code-evidence scope; a documentation check, not a code-behavior check).
- **Recommended remediation priority:** Low-Medium (documentation only) — no change from v2. Not
  included in the remediation plan below since it requires no code change, only an ops-runbook note.

---

### M2-6 — The storefront is built but not deployed

**Original claim (v2 audit):** `infrastructure/docker/web.Dockerfile` builds the storefront and
`ci.yml` uploads the `.next` artifact, but no storefront `Deployment`/`Service`/`Ingress` exists in
`infrastructure/k8s/`, and `build.yml` pushes only the runtime image. The customer-facing tier has no
deployment path.

**Current Status: VERIFIED**

- **Code location:** current `infrastructure/k8s/` manifest set is
  `00-namespace.yaml, 10-config.yaml, 20-deployment-api.yaml, 21-deployment-worker.yaml,
22-deployment-scheduler.yaml, 25-collector-config.yaml, 26-deployment-collector.yaml,
30-services.yaml, 40-autoscaling.yaml, 50-networkpolicy.yaml, 60-ingress.yaml, 70-debezium.yaml,
kustomization.yaml, secret.example.yaml`. **No storefront Deployment/Service/Ingress file exists.**
  The only two occurrences of the word "storefront" anywhere under `infrastructure/k8s/` are comments
  in `25-collector-config.yaml` about CORS allowed-origins for the collector — not a deployment
  artifact.
- **Execution path:** `.github/workflows/build.yml` builds exactly two container images —
  `image` (runtime, `infrastructure/docker/runtime.Dockerfile`) and, new since the v2 audit,
  `collector-image` (`infrastructure/docker/collector.Dockerfile`, added by the H-07 High-sprint fix for
  H2-6). There is still no `storefront`/`web` image job; the `monorepo build` job runs `pnpm build`
  (which includes `next build`) but produces no container artifact.
- **Runtime proof:** N/A — absence-of-deployment finding, nothing to execute.
- **Repository search for related changes:** `git log aee3269..HEAD -- infrastructure/k8s` shows four
  intervening commits (`995e3b2` NetworkPolicy egress/ingress fix, `2885f93` H-07 collector
  deployability, `f58b277` H-06 tracking topic config, `0d582d2` C2-1 Ory ConfigMap fix) — none add a
  storefront manifest; all four are accounted for by other, already-tracked findings (H2-5, H2-6, C2-1).
  `git log aee3269..HEAD -- .github/workflows/build.yml` — the collector-image job (H-07) is the only
  change; still no storefront image job.
- **Production impact:** unchanged. The customer-facing storefront tier still has no path to
  production; `apps/storefront/src/lib/runtime-api.ts` still targets `http://localhost:3080` by default
  (spot-checked, unchanged).
- **Recommended remediation priority:** Medium — no change from v2. High business value (it's the
  customer-facing tier) but, as the audit correctly notes, no active production-safety bug — it simply
  cannot ship yet.

---

### M2-7 — Consumer-path payment verification is optional

**Original claim (v2 audit):** the admin path passes a real `PrismaPaymentVerificationAdapter` into
`MarkOrderPaid` and rejects unverified refs; the Kafka-consumer path
(`buildPaymentCapturedRuntime`) constructs `MarkOrderPaid` **without** `paymentVerification`, and the
field is optional on the use-case, so the check is silently skipped on that path. The audit judged
this defensible (the consumer's input is Payments' own capture event) but flagged the optional field as
a latent risk: a future regression on this path would be silent.

**Current Status: VERIFIED**

- **Code location:** `services/orders/src/application/mark-order-paid.use-case.ts:35` —
  `readonly paymentVerification?: PaymentVerificationPort;` — still optional. Lines 60-61: the
  verification call is still wrapped in `if (this.deps.paymentVerification !== undefined)`, i.e. still
  silently skipped when the field is absent.
  `apps/runtime/src/composition.ts:209-251` (`buildPaymentCapturedRuntime`, now at these line numbers
  after intervening growth) — the `MarkOrderPaid` construction at lines 226-231 still passes only
  `orders`, `unitOfWork`, `idGenerator`, `clock`. **No `paymentVerification` field is passed on the
  consumer path today**, identical to the audit's citation.
- **Execution path:** admin path — `apps/admin/src/http/api.ts` still passes a real
  `PrismaPaymentVerificationAdapter` (spot-checked; consistent with the audit's "admin path: verified"
  finding, which this re-verification did not find any reason to revisit). Consumer path — unchanged,
  confirmed above.
- **Runtime proof:** by inspection — any `payments.payment_intent.captured.v1` message reaching
  `PaymentCapturedConsumer` still marks the order paid via `MarkOrderPaid` with no independent
  verification that a matching `PaymentIntent` row exists in `captured` status; the check that exists
  on the admin path is architecturally absent here, exactly as described.
- **Repository search for related changes:** `git log aee3269..HEAD` for
  `services/orders/src/application/mark-order-paid.use-case.ts` — no commits.
  `apps/runtime/src/composition.ts` — only the unrelated `11cd124` (C2-6 tenant fix) commit, confirmed
  not touching `buildPaymentCapturedRuntime`.
- **Production impact:** unchanged from the audit's own assessment — defensible today (the consumer's
  input is Payments asserting its own capture), but the optional field is a footgun: any future change
  that lets an unrelated event type or a malformed payload reach this consumer would fail silently
  rather than being rejected the way the admin path would reject it.
- **Recommended remediation priority:** Medium — no change from v2. Note per the audit's own framing
  this is a defensive-hardening item, not a confirmed defect in current behavior; it belongs in the
  remediation plan as a "make the implicit trust explicit" item, not a "fix broken verification" item.

---

## Carryover Context (not a Medium finding — reported for completeness only)

**H2-9 · 33 of 37 durable contexts have never executed against a real database — HIGH (unchanged,
carried, not re-classified here)**

The v2 audit's own High Findings sprint summary (`HIGH_FINDINGS_SUMMARY.md`) explicitly left H2-9 out
of the 9-item High sprint and suggested it become either the first post-Medium item or be folded into
the Medium pass. This sprint's brief scoped the register strictly to M2-1 through M2-7 (the "Remaining
Medium findings" table), so H2-9 was **not** independently re-classified with a verdict here — doing so
would exceed this sprint's stated scope (Medium findings only) and risk conflating a High-severity
carryover with the Medium register the deliverables must stay strictly to.

For situational awareness only: re-counted at current HEAD, integration test files gated on
`DATABASE_URL_TEST` remain exactly **9, covering the same 3 contexts** (customer-360, orders,
security) as the v2 audit found — unchanged. Recommend a dedicated sprint scope this explicitly rather
than absorbing it into Medium remediation, consistent with the High-sprint summary's own
recommendation.

---

## Summary Table

| ID   | Finding                                            | Verdict  | Changed since v2?  |
| ---- | -------------------------------------------------- | -------- | ------------------ |
| M2-1 | Purchase saga cannot complete                      | VERIFIED | No                 |
| M2-2 | Media object storage is a stub                     | VERIFIED | No                 |
| M2-3 | Licensing billing never moves money                | VERIFIED | No                 |
| M2-4 | `as never` defeats type checking at two seams      | VERIFIED | No                 |
| M2-5 | Analytics/Platform Console non-durable (disclosed) | VERIFIED | No (accepted risk) |
| M2-6 | Storefront built but not deployed                  | VERIFIED | No                 |
| M2-7 | Consumer-path payment verification optional        | VERIFIED | No                 |

**Zero findings were FIXED INDIRECTLY, PARTIALLY VERIFIED, NOT REPRODUCED, or DUPLICATE.** The nine
intervening commits since the v2 audit baseline (six from the High Findings sprint that touched files
also cited by Medium findings — `apps/runtime/src/composition.ts` via C2-6, `infrastructure/k8s/` via
H2-5/H2-6/C2-1/the NetworkPolicy fix) were all independently confirmed, by reading the diff context at
each cited location, to leave every M2 finding's actual defect untouched. This is a genuinely stable,
independently-scoped register — none of it overlapped with what the Critical, High, or Integration
Verification sprints touched.

**No duplicates found.** M2-1 through M2-7 describe seven structurally distinct gaps (a missing
orchestration mechanism, two independent unwired provider adapters, a type-safety hole, a disclosed
accepted-risk design decision, a missing deployment artifact, and an optional-field defensive gap) —
none subsume another.

**No findings removed as already-fixed.** All seven remain live defects (or, for M2-5, a live disclosed
risk) in the current codebase.

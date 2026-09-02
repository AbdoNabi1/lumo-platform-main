# Recovery Errata — V4

Deliverable 5 of Repository History Recovery Phase V4 (file-level forensic reconstruction).
Planning only — no source code modified, nothing staged, nothing committed, no milestone executed.

## Method

Produced by four parallel, independent, read-only investigations (one per tier group), each of
which re-opened its own cited sprint reports/ADRs/migrations fresh this pass rather than trusting
`REPOSITORY_HISTORY_RECOVERY.md`/`_V2.md`/`_V3.md`/`PATCH_OWNERSHIP_MATRIX.md`/`EVIDENCE_MATRIX.md`
at face value. Every entry below traces to an exact quote opened during this pass. Per the phase's
own rule, nothing above is silently edited — this file is the append-only contradiction log.

---

### ERRATA-4.1 — `packages/auth` (ERRATA-1 reconfirmed, with fresh quotes)

- **Original claim:** `PATCH_OWNERSHIP_MATRIX.md` rows 121/122/371 — "K3, Confirmed... V2 §3 K3 names
  `packages/auth` directly."
- **Documentary evidence:** `P2_0_ENTERPRISE_SECURITY_REPORT.md` §H-2 "New implementation" (L509-515)
  names `KetoRelationshipClient` and the `HttpFetch` `body` addition as H-2's own new work; its
  Rule-1 findings (L480-483) describe the true pre-existing K3 baseline as only
  `KetoAccessControl`/`KratosSessionAuthenticator`/`KratosIdentityService`.
- **Correct conclusion:** `packages/auth/src/keto-relationships.ts` (+2 test files) and the specific
  `HttpFetch.body` addition in `kratos.ts` belong to **P2/H-2**, not K3. `index.ts`'s export of
  `KetoRelationshipClient` is the same P2/H-2 patch.
- **Resolution:** Re-scope K3 to exclude these files; re-propose them under P2, citing
  `P2_0_ENTERPRISE_SECURITY_REPORT.md` §H-2 directly. Matches ERRATA-1 exactly — independently
  reconfirmed this pass, not carried forward on trust.

### ERRATA-4.2 — `packages/temporal/src/runtime.ts` (origin found; dirty delta still unowned)

- **Original claim:** `PATCH_OWNERSHIP_MATRIX.md` row 147 — "K3, Confirmed... V2 §3 K3 names
  `packages/temporal` directly." ERRATA-1 called this an "open attribution gap."
- **Documentary evidence:** `SPRINT_2_8_REPORT.md` ("Sprint 2.8 — Purchase Saga Architecture
  (Temporal)") is the real origin of the file's _committed_ baseline content
  (`createPurchaseWorker`, `runPurchaseSaga`, etc.) — a citation neither V3's ERRATA-1 nor the
  matrix had surfaced. However, the actual **uncommitted diff** on this file is a narrow
  `.bind(activities)` fix (a prototype-methods-vanish-on-spread bug) that appears in **zero**
  documents anywhere in the repo (sprint reports, ADRs, `docs/DECISIONS.md`).
- **Correct conclusion:** The _file_ predates K3 (Sprint 2.8, already-baseline). The _dirty delta_
  has no owning milestone at all — neither K3 nor R2 nor any other tier.
- **Resolution:** Do not assign this delta to any milestone. Mark **Missing Evidence**. If R2
  (Purchase Saga) ever gets a dedicated report, check there first; otherwise this stays an open gap
  requiring a direct code-level decision, not a citation.

### ERRATA-4.3 — `packages/secrets/src/envelope.ts` (resolves V3 open risk #5)

- **Original claim:** `REPOSITORY_HISTORY_RECOVERY_V3.md` §3 risk #5 — "attribution to P2 not
  independently re-verified this pass... flagged per the Evidence Closure Rule rather than
  asserted."
- **Documentary evidence:** `P2_0_ENTERPRISE_SECURITY_REPORT.md` §H-3 (L728-733): "`@platform/secrets`
  extended with `EnvelopeCipher` + `KeyAliasRegistry`" — matches `packages/secrets/src/index.ts`'s
  actual diff (adds exactly those two re-exports) exactly.
- **Correct conclusion:** `packages/secrets/src/envelope.ts`, `envelope.test.ts`, and the
  `index.ts` re-export line are **P2/H-3**, High confidence.
- **Resolution:** V3 risk #5 is closed. Update future passes to cite this directly rather than
  re-flagging as unverified.

### ERRATA-4.4 — `packages/http/src/server.ts` (multi-owner patch + new orphan citation)

- **Original claim:** `PATCH_OWNERSHIP_MATRIX.md` rows 140-143 partially separate `route.ts`/
  `server.ts` into "K3 base / R3 patch" but treat `server.test.ts` as "Inferred, not independently
  diffed" and `index.ts` as a pure K3 barrel.
- **Documentary evidence:** Direct diff read shows `server.ts` layers **three** distinct patches:
  (a) P2.0.2's `GuardRequestContext` plumbing; (b) P2.0.3's `sessionClaim` sid/session_id fix
  ("`packages/http/src/server.ts` read only the `sid` claim... Now read under either name"); (c)
  Sprint 9/R3's public-route pipeline + security headers ("nosniff/frame-options/referrer-policy/
  HSTS"). A fourth code comment — `/** Optional metrics sink (F5 / G-19). ... */` — names
  `HttpMetricsSink`, which appears in **zero** documents searched (`docs/architecture/
23-platform-gap-register.md`'s G-19 describes generic OTel wiring, not this specific port; "F5"
  resolves nowhere).
- **Correct conclusion:** `server.ts`/`server.test.ts`/`index.ts` are a genuine 3-to-4-way
  overlapping patch (K3 base + P2.0.2 + P2.0.3 + R3), **and** the `HttpMetricsSink`/F5 portion has
  no owner at all.
- **Resolution:** Diff-decompose at P2.0.2/P2.0.3/R3 execution time, per the standing cross-cutting-
  file rule. Flag the `HttpMetricsSink`/F5 fragment as **Missing Evidence** — do not fold it into
  any of the three confirmed patches without new evidence.

### ERRATA-4.5 — K5 (`packages/expression`/`packages/rules`) miscited creation source

- **Original claim:** `PATCH_OWNERSHIP_MATRIX.md`/`EVIDENCE_MATRIX.md` cite
  `SPRINT_6_4_COMPUTED_ATTRIBUTES_REPORT.md` as K5's evidence.
- **Documentary evidence:** That report's own Rule-1 findings say verbatim: "`@platform/rules` and
  `@platform/expression` already exist (ADR-0053, drafted the day before this sprint)... Neither
  package had a consumer anywhere in the repo yet — this sprint is the kernel's first real
  consumer." The report explicitly disclaims building them. `docs/DECISIONS.md` **D-078** ("Engine
  Kernel ratified") independently gives a full API-level account (AST node types, depth/node
  limits, `Result`-typed errors, cross-type ordering refusal) matching the actual source files far
  more precisely.
- **Correct conclusion:** K5's real creation-level citation is **D-078**, not SPRINT_6_4 (which is a
  downstream consumer, correctly still cited for N3's _use_ of K5, just not K5's _creation_).
- **Resolution:** Re-cite K5 against D-078 for creation evidence; keep SPRINT_6_4 as N3's own
  evidence only.

### ERRATA-4.6 — K7 (`packages/tracking`) — most files remain unattested at file level

- **Original claim:** `PATCH_OWNERSHIP_MATRIX.md` rows 363-368 mark K7 "package-directory-level"
  without individually-meaningful per-file diffing, implicitly "Confirmed" via package match.
- **Documentary evidence:** `P5_M6_TRACKING_RUNTIME_COMPLETION_REPORT.md` states outright: "This is
  the first on-disk implementation report for P5; M0–M6.6 detail lives in the session record and is
  summarized here rather than restated." That "session record" does not exist as a file. Cross-
  referencing `docs/DECISIONS.md` D-077 (M1 envelope/consent/dedup-id/destination-config), D-079
  (M4 delivery/queue ordering), and D-080 (M5 replay/business-payload/EventRecord) upgraded roughly
  15 of ~75 in-scope tracking files to High confidence via file-specific quotes.
- **Correct conclusion:** The clear majority of `definitions/*`, `execution/*`, most of `pipeline/*`,
  `intelligence/*`, most of `delivery/*`, most of `inspector/*`, and most of `envelope/*` have **no
  file-specific evidence anywhere** — Low confidence, honestly, not a fabricated Medium/High.
- **Resolution:** Do not schedule these files for execution until either the referenced "session
  record" is located or each file is independently gate-checked against actual code behavior.

### ERRATA-4.7 — R1's "core runtime files" were self-cited, not independently evidenced

- **Original claim:** `PATCH_OWNERSHIP_MATRIX.md:373` — `apps/runtime/src/{module.ts, modules/,
platform.ts, jobs.ts, diagnostics.ts, metrics.ts, shutdown.ts, seed.ts, telemetry.ts,
health-server.ts}` marked **"Confirmed"**, evidence stated as **"V2 §3 R1's own file list,
  verbatim."**
- **Documentary evidence:** That is circular — the plan citing itself, not an independent source.
  Re-checking against real sprint reports: `SPRINT_6_2_CUSTOMER_PROFILE_REPORT.md` (line 26)
  describes `jobs.ts`'s `ScheduledJob`/`startJobLoop` pattern as **already existing** (i.e.
  predating Sprint 6.2, many tiers before R1/Tier 7). `SPRINT_8_RUNTIME_PLATFORM_REPORT.md`'s own
  discovery section treats the module registry (`platform.ts`) as pre-existing infrastructure it
  _found_, not created. `P2_0_1_RUNTIME_ACTIVATION_REPORT.md` §"B — OpenTelemetry" states: "New
  `apps/runtime/src/telemetry.ts` — `startRuntimeTelemetry(config, role)`..." — directly
  contradicting an R1 attribution. Full-text grep across every `docs/implementation/*.md` file for
  `diagnostics.ts`, `metrics.ts`, `shutdown.ts`, `health-server.ts` returned **zero hits**.
- **Correct conclusion:** `telemetry.ts` is **P2.0.1**, not R1. `jobs.ts` and the module-registry
  pattern **predate** R1's own reports' framing of them as new. `diagnostics.ts`, `metrics.ts`,
  `shutdown.ts`, `health-server.ts` have **no supporting citation anywhere** — the same defect class
  as ERRATA-1/ERRATA-4.2, just not yet caught before this pass.
- **Resolution:** Downgrade all of `apps/runtime/src/{module.ts, modules/, platform.ts, jobs.ts,
diagnostics.ts, metrics.ts, shutdown.ts, health-server.ts}` from "Confirmed" to **Low/Unknown**.
  `telemetry.ts` reassigned to P2.0.1. `seed.ts` remains R1 (independently confirmed via
  `SPRINT_8_RUNTIME_PLATFORM_REPORT.md` §9, a real file-specific quote, unaffected by this errata).

### ERRATA-4.8 — `docs/architecture/adr/0010-third-party-extension-model.md` (V3 risk #11 resolved — to neither candidate V3 named)

- **Original claim:** `REPOSITORY_HISTORY_RECOVERY_V3.md` §3 risk #11 framed this as "G4 or P1,
  whichever executes first."
- **Documentary evidence:** Direct diff read: the file's only change is one dated section,
  "Addendum — 2026-07-13 (**Sprint 5.8 prep**): the Marketplace commerce layer."
  `SPRINT_5_6_SAAS_REFINEMENTS_REPORT.md` independently confirms "Marketplace (Sprint 5.8)" as a
  distinct, later, **not-yet-built** milestone.
- **Correct conclusion:** Neither G4 nor P1 is correct. This addendum belongs to an unscoped future
  Sprint 5.8 (Marketplace), not any milestone currently in the K1-A1 sequence.
- **Resolution:** Remove this file from both G4's and P1's scope. Leave it un-scheduled — it belongs
  to a milestone that doesn't exist yet in the recovery plan.

### ERRATA-4.9 — `apps/storefront/src/app/page.tsx` (V3 risk #10 resolved — to neither candidate V3 named)

- **Original claim:** `REPOSITORY_HISTORY_RECOVERY_V3.md` §3 risk #10 framed this as "E2 vs. R3."
- **Documentary evidence:** Full-text grep of `M7_BROWSER_SDK_COMPLETION_REPORT.md` (E2 candidate)
  and `SPRINT_9_OPERATIONAL_HARDENING_REPORT.md` (R3 candidate) for "page.tsx"/"storefront" returned
  **zero hits in both**. `SPRINT_8_RUNTIME_PLATFORM_REPORT.md` and `SPRINT_8_1_PLATFORM_COMPLETION_
REPORT.md` (both R1) quote specific, concrete edits to this exact file ("`page.tsx` is now an
  async Server Component rendering the product list..."; "home page renders Categories/Collections
  cards...").
- **Correct conclusion:** Owner is **R1 (Sprint 8 base, Sprint 8.1 continuation)**, not E2 or R3.
- **Resolution:** Reassign to R1. The only remaining ambiguity is Sprint 8 vs. 8.1 internally to R1,
  not a cross-milestone one.

### ERRATA-4.10 — Two different, unrelated things are both called "H-5"

- **Original claim:** None explicit, but `FINAL_RECOVERY_CHECKLIST.md`/V3 treat "H-5" as one
  concept belonging to R3.
- **Documentary evidence:** `.changeset/h5-production-readiness.md` self-describes a platform-wide
  production-readiness body of work (cosign signing, Prometheus/Alertmanager/Grafana, backup/DR,
  perf/chaos). Separately, `P2_0_ENTERPRISE_SECURITY_REPORT.md`/`P2_0_1_RUNTIME_ACTIVATION_REPORT.md`
  use "H-5" for Security's own internal H-1→H-5 hardening sub-sequence (KMS/observability/CI), a
  narrower and entirely different scope.
- **Correct conclusion:** These are two unrelated namesakes. Conflating them would misattribute
  files.
- **Resolution:** Whoever executes R3 must explicitly disambiguate "H-5" in its own milestone report
  (per V3 risk #3), citing `.changeset/h5-production-readiness.md` for the platform-wide meaning and
  never the Security report's H-5 for R3's scope.

### ERRATA-4.11 — `services/finance` — unattested `ShippingRateCard`/`ShippingRate`/`QuoteShippingRates` cluster

- **Original claim:** `PATCH_OWNERSHIP_MATRIX.md`/V3 treat all of `services/finance` as a single
  T1-owned package with no internal distinction.
- **Documentary evidence:** `domain/shipping-rate-card.ts`, `domain/value-objects/shipping-rate.ts`,
  `application/quote-shipping-rates.use-case.ts`, plus partial content of
  `reference-data.commands.ts`, `finance.mappers.ts`, `in-memory-repositories.ts`,
  `prisma-finance-repositories.ts` have **zero citation** in any of the 79
  `docs/implementation/SPRINT_*.md` files. The only place these names appear is
  `docs/generated/KNOWLEDGE_INDEX.md` — an auto-generated code index, not sprint evidence.
- **Correct conclusion:** This is real, delivered code with no documented owner — the same
  attribution-gap shape as ERRATA-1/ERRATA-4.2/ERRATA-4.7, discovered independently in a completely
  different tier.
- **Resolution:** Do not fold into T1's "Confirmed" bucket. Mark Low/Unknown, flag for whoever next
  investigates Finance follow-up work.

### ERRATA-4.12 — `services/analytics` composition/controller/presenter mislabeled

- **Original claim:** `PATCH_OWNERSHIP_MATRIX.md` treats all of `services/analytics` as one
  T2/Sprint-3.2 package-level row.
- **Documentary evidence:** `SPRINT_3_2_ANALYTICS_CORE_ENGINE_IMPLEMENTATION_REPORT.md` never
  mentions a controller/composition/HTTP layer ("No... frontend/admin-pages"). Instead,
  `SPRINT_9_OPERATIONAL_HARDENING_REPORT.md` Workstream 2 states: "`services/analytics` had zero
  composition root, zero `interfaces/` layer, zero HTTP exposure... New `services/analytics`
  composition root (`wireAnalytics()`) + `AnalyticsConsoleController` + presenter."
- **Correct conclusion:** `src/composition.ts`, `interfaces/analytics-console.controller.ts`, and
  `interfaces/presenter.ts` are **Sprint 9 (R3)**, not T2/Sprint 3.2.
- **Resolution:** Split T2's scope: domain/engine/registry/resolver/infrastructure stay Sprint 3.2;
  the three interface/composition files move to R3.

### ERRATA-4.13 — Catalog's real provenance is a 4-layer chain, not 2

- **Original claim:** Sprint 7.0's own self-summary says "Built Sprint 1.1, extended Sprint 4.2" —
  a framing the matrix inherited.
- **Documentary evidence:** `SPRINT_C1_CATALOG_CORE_REPORT.md` ("Commerce Sprint 1", 2026-07-10) is
  where `Brand`, scheduling, the variant matrix, `seo`/`options` VOs, Prisma persistence, and the
  HTTP API actually landed — 10 of the 25 domain events in the dirty tree originate here.
  `SPRINT_4_2_CATALOG_CORE_REPORT.md` explicitly disclaims building `category.ts`/
  `create-category.use-case.ts`/`create-product.use-case.ts` ("Catalog already implemented...
  reused, untouched"; Sprint 4.2 built only ProductMedia lifecycle).
- **Correct conclusion:** Real chain is **Sprint 1.1 → "Commerce Sprint 1"/C1 → Sprint 4.2 → Sprint
  7.0**. `PATCH_OWNERSHIP_MATRIX.md`'s rows labeling `category.ts`/`create-category.use-case.ts`/
  `create-product.use-case.ts` as "Base Sprint-4.2" are mislabeled — true origin is Sprint
  1.1+C1.
- **Resolution:** Re-cite these three files (and the ~30 other C1-sourced files) against
  `SPRINT_C1_CATALOG_CORE_REPORT.md`, inserting the missing middle layer.

### ERRATA-4.14 — C2's "1.x"-numbered catalog design docs (V3 risk #4) — false alarm, resolved

- **Original claim:** V3 §3 risk #4 flagged `SPRINT_1_6`/`1_7`/`1_8`/`1_9`/`M2_5`/`F2` as an
  unreconciled risk that "`services/catalog` may carry more superposed, harder-to-separate history
  than assumed."
- **Documentary evidence:** All of `SPRINT_1_6_CATALOG_DISTRIBUTION_DESIGN.md`,
  `SPRINT_1_7_CATALOG_INTELLIGENCE_DESIGN.md`, `SPRINT_1_8_RECOMMENDATION_MERCHANDISING_DESIGN.md`,
  `SPRINT_1_9_PROMOTIONS_DISCOUNT_DESIGN.md`, `SPRINT_M2_5_CATALOG_SYNDICATION_DESIGN.md` are
  explicitly `"Status: DESIGN (design only)... No code, no infrastructure... STOP — awaiting
approval"`, and three of the four describe entirely different bounded contexts
  (`@platform/feed-engine`, `@platform/catalog-intelligence`, `@platform/recommendations`) that
  don't exist in the dirty tree at all. `SPRINT_F2_ATTRIBUTE_STORE_CONCURRENCY_REPORT.md` is real
  and complete but lives entirely in `services/customer-360`, unrelated to Catalog despite the
  superficially similar naming.
- **Correct conclusion:** Zero dirty files in `services/catalog` trace to any of these six docs
  beyond `SPRINT_C1_CATALOG_CORE_REPORT.md` (already covered by ERRATA-4.13).
- **Resolution:** Close V3 risk #4 as a false alarm — worth having checked, resolves cleanly.

### ERRATA-4.15 — Customer-360 N1–N4 CAN be file-separated (major correction)

- **Original claim:** V3/`PATCH_OWNERSHIP_MATRIX.md` frame `services/customer-360` as effectively
  one combined unit, implying N1-N4 "cannot be file-separated cleanly."
- **Documentary evidence:** Each of `SPRINT_6_2_CUSTOMER_PROFILE_REPORT.md`,
  `SPRINT_6_3_SESSION_STITCHING_REPORT.md`, `SPRINT_6_4_COMPUTED_ATTRIBUTES_REPORT.md`, and
  `SPRINT_6_5_SEGMENTATION_REPORT.md` contains an explicit **"§4 New implementation"** file-by-file
  manifest, independently cross-corroborated by `customer-360.prisma`'s own section comments
  ("Phase 6.2 — Profile Engine," "Phase 6.3 — Session Stitching Engine," "Phase 6.4 — Computed
  Attributes Engine").
- **Correct conclusion:** Every file in the package CAN be assigned to a specific phase (N1/N2/N3/N4
  or the pre-N1 "Phase 6.1 Identity Engine") with File-level evidence — a full breakdown was
  produced this pass (see `PATCH_OWNERSHIP_MATRIX_V4.md`).
- **Resolution:** Drop the "one combined unit" framing. Schedule N1-N4 as four separable file sets,
  per §4 manifests, not one bundled commit — this reverses `FINAL_RECOVERY_CHECKLIST.md`'s guidance
  ("N1-N4's possible combined commit").

### ERRATA-4.16 — Phase 6.1 (Identity Engine) has no dedicated sprint report

- **Original claim:** Implicit — every later N-report (6.2-6.5) refers back to "Phase 6.1's Identity
  Engine" as an established prior fact, and `customer-360.prisma`'s header says "Phase 6.1," but no
  prior pass flagged that its own build was never separately documented.
- **Documentary evidence:** No `SPRINT_6_1_*.md` exists anywhere in `docs/implementation/` (Glob
  confirmed). Only `CUSTOMER360_ARCHITECTURE_AUDIT.md` (an audit of Identity Engine, not its build
  report) substantiates specific files — `identity-resolution.ts`, `split-identity.use-case.ts`,
  `observe-identity-link.use-case.ts` — and only because it found and fixed bugs in them.
- **Correct conclusion:** Most Phase 6.1 files (ports, events, infra adapters not named in the
  audit's bug list) are Medium confidence at best — package/phase-level only, never individually
  opened by name in any document. This is a new gap, same class as ERRATA-4.2/4.7/4.11.
- **Resolution:** Flag explicitly in whichever milestone eventually owns Phase 6.1's base (currently
  unscheduled — precedes N1 in the tier sequence, not itself one of the named K/T/C/G/N/P/E/R/A
  milestones). Do not fabricate a report citation for it.

### ERRATA-4.17 — G1-G4 and N2-N4 sprint-report citations upgrade Weak → Confirmed

- **Original claim:** `EVIDENCE_MATRIX.md` marks G1-G4's and N2-N4's own sprint reports "Weak"
  (package assignment corroborated only via Prisma headers, narrative never independently opened).
- **Documentary evidence:** This pass opened every one of
  `SPRINT_5_1_COMMERCE_GROWTH_REPORT.md`/`SPRINT_5_2_CUSTOMER_EXPERIENCE_REPORT.md`/
  `SPRINT_5_3_PLATFORM_INTELLIGENCE_REPORT.md`/`SPRINT_5_4_EXPERIENCE_PLATFORM_REPORT.md`/
  `SPRINT_6_3_SESSION_STITCHING_REPORT.md`/`SPRINT_6_4_COMPUTED_ATTRIBUTES_REPORT.md`/
  `SPRINT_6_5_SEGMENTATION_REPORT.md` directly, with exact per-file quotes.
- **Correct conclusion:** No contradiction found — package-level and narrative evidence reinforce
  each other for these tiers. This is a real, positive correction, not a new problem.
- **Resolution:** Update `EVIDENCE_MATRIX_V4.md` to mark these Confirmed.

### ERRATA-4.18 — `SPRINT_5_4_EXPERIENCE_PLATFORM_REPORT.md` exists and fully covers G4

- **Original claim:** `REPOSITORY_HISTORY_RECOVERY_V3.md` §1 (carried framing) implied this report
  was "not yet individually confirmed by filename."
- **Documentary evidence:** The file exists, was opened in full this pass, and its "Contexts
  delivered (8)" table matches G4's scope file-for-file, including the Media Library extension
  inside `services/media`.
- **Correct conclusion:** No gap — this closes what V3 flagged as unconfirmed.
- **Resolution:** Remove the "not yet confirmed" caveat from future passes.

### ERRATA-4.19 — `RECOVERY_IMPLEMENTATION_METHODOLOGY.md` — phantom citation, reconfirmed

- **Original claim:** Cited repeatedly (for an "Evidence Closure Rule" and "Implementation Source
  Precedence") in `REPOSITORY_HISTORY_RECOVERY_V2.md`, `_V3.md` (including inside V3's own
  ERRATA-1 text), `EVIDENCE_MATRIX.md`, and `FINAL_RECOVERY_CHECKLIST.md`.
- **Documentary evidence:** Glob for `**/RECOVERY_IMPLEMENTATION_METHODOLOGY*` across the entire
  repo returns **zero results**, confirmed independently at both the start of this V4 pass and
  again inside the K3-K7 sub-investigation.
- **Correct conclusion:** This document does not exist. Every "Evidence Closure Rule"/"Implementation
  Source Precedence" citation resting on it is resting on nothing. Notably, even V3's own ERRATA-1 —
  the document that caught the `packages/auth` misattribution — cites this same phantom file for
  its "Sprint Report... higher-precedence source" reasoning.
- **Resolution:** Either write this methodology document for real (state its rules explicitly,
  in-line, in whichever document needs them) or stop citing it. Until then, treat every reference
  to "the Evidence Closure Rule" or "Implementation Source Precedence" as an unwritten convention
  this project has been following in practice, not a ratified document.

### ERRATA-4.20 — `services/orders/src/interfaces/payment-captured.consumer.ts` — creation sprint unverified

- **Documentary evidence:** Not in `SPRINT_1_4_REPORT.md`'s file list; `SPRINT_4_7_ORDERS_CORE_
REPORT.md` calls it merely "already present" without claiming credit for creating it.
- **Correct conclusion:** Genuine small gap — Low/Unknown for Created-In only (the A1 patch on top
  of it remains High confidence, independently confirmed).
- **Resolution:** Flag for whoever next investigates Orders' pre-4.7 history.

### ERRATA-4.21 — `services/pricing/src/application/validate-price-lines.use-case.ts` — unattested

- **Documentary evidence:** Not named in `SPRINT_1_2_REPORT.md` or `SPRINT_4_4_PRICING_CORE_REPORT.
md`, nor `SPRINT_7_0_COMMERCE_FOUNDATION_REPORT.md`.
- **Correct conclusion:** Low/Unknown confidence — same open-attribution-gap shape as the others in
  this list, smaller scale.
- **Resolution:** Flag for whoever next investigates Pricing.

### ERRATA-4.22 — Base sprint reports for C3-C8 were never cited before this pass

- **Original claim:** `PATCH_OWNERSHIP_MATRIX.md`/V3 cite only the 4.x reports for C3 (Inventory),
  C4 (Pricing), C5 (Cart), C6 (Checkout), C7 (Orders), C8 (Payments) — the 4.x reports themselves
  say "already existed" without naming their own source.
- **Documentary evidence:** `SPRINT_1_2_REPORT.md` (Pricing+Inventory), `SPRINT_1_3_REPORT.md`
  (Cart), `SPRINT_1_4_REPORT.md` (Checkout/Orders/Payments) all exist, are real, and were opened
  fresh this pass — each names the genuine base-layer files.
- **Correct conclusion:** These six contexts have a real two-layer history (Sprint 1.2/1.3/1.4 base
  → 4.x extension), not an unexplained "already existed."
- **Resolution:** Cite the 1.x base reports alongside the 4.x reports going forward, per the
  per-file tables in `PATCH_OWNERSHIP_MATRIX_V4.md`.

---

No document referenced above was deleted. No git state was modified in `lumo-platform`,
`lumo-platform-recovery`, or `lumo-platform-a0-lockfile-repair`. No code was modified. Nothing was
staged. Nothing was committed. No milestone was executed.

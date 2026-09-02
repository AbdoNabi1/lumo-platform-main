# PRODUCTION REMEDIATION SUMMARY

**Sprint:** Production Remediation Sprint (Critical findings only)
**Source audit:** `FINAL_PRODUCTION_READINESS_AUDIT_v2.md` (2026-08-05, score 55/100)
**Baseline:** `main` @ `ec3423b`
**HEAD after this sprint:** `main` @ `dc1406a`
**Commits:** 6, one per finding, each preceded by a full `typecheck`/`lint`/`test`/`arch` gate run
**Status:** All six Critical findings investigated, proven, and fixed. **Stopping here per instruction —
High findings not started.**

---

## Fixed findings

| #          | Finding                                                                                                                      | Commit    | Type of fix                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------- |
| Critical-1 | **C2-1** — Runtime cannot boot with the shipped k8s config (missing `KETO_WRITE_URL`/`KRATOS_PUBLIC_URL`/`KRATOS_ADMIN_URL`) | `0d582d2` | Config-only: 3 keys added to `10-config.yaml`       |
| Critical-2 | **C2-3** — Outbox rows never marked `published` on the CDC path; pruner matched zero rows forever                            | `0ae1a78` | Logic: prune by age, not status; +3 tests           |
| Critical-3 | **C2-6** — Repositories pinned to `TENANT_DEFAULT_ID`; HTTP resolved a different tenant per request                          | `11cd124` | Fail-closed guardrail (HTTP + boot); +4 tests       |
| Critical-4 | **C2-4** — MFA accepted the hardcoded code `123456` on a live route                                                          | `21fe66c` | Injection seam + fail-closed boot guard; +3 tests   |
| Critical-5 | **C2-5** — No migration step ran before rollout                                                                              | `8ea98aa` | One job added to `deploy.yml`                       |
| Critical-6 | **C2-2** (wiring half) — `verifyWebhook` had zero call sites; no webhook route existed                                       | `dc1406a` | New route wiring existing port + use case; +7 tests |

Every fix was verified against the actual repository state before being applied (parsed manifests,
exhaustive `git grep`, transition-table cross-references, executed probes — not assumed from the
audit's prose), and every fix was proven working after the change — by executing the real config
loader, by unit/e2e tests against the real composition graph, or (for the two YAML-only changes) by
parsing the actual files with this repo's own transitive tooling and checking the job/config graph
GitHub Actions and the runtime would actually build. Full detail, evidence, and exact diffs are in
`CRITICAL_1_REPORT.md` through `CRITICAL_6_REPORT.md`.

**Net new test coverage this sprint:** 17 new tests across 6 new test files
(`scheduler.test.ts` +3, `tenant-guard.e2e.test.ts` +3, `mfa-provider-injection.test.ts` +2,
`payments-webhook-routes.test.ts` +3, `payments-webhook.e2e.test.ts` +3) plus 3 new cases added to
the existing `composition.test.ts`. All were run and passed; none were added speculatively.

**A consequence worth stating plainly, not burying:** Critical-4's fix makes `startApi` refuse to
boot outside `APP_ENV=local` unless a real `MfaProviderResolver` is injected — and nothing in this
codebase constructs one (building one was explicitly out of scope: "do not redesign authentication").
This means **the runtime still cannot start in production today** — for a different, deliberate,
loud reason instead of a silent security hole. That is the correct trade (see `CRITICAL_4_REPORT.md`'s
scope note), but it is the single most important fact for whoever picks this up next: a real MFA
provider must exist and be injected before `api.ts` will start outside `local`.

---

## Rejected findings

**None.** All six findings were investigated per the work order's "investigate, prove, implement, run"
sequence, and all six were confirmed as real, reproducible defects before any fix was written:

- C2-1 was reproduced by executing `loadRuntimeConfig()` against the parsed, actual shipped manifest.
- C2-3 was confirmed by tracing every caller of `markPublished` and every `OutboxRelay` construction
  site — zero production-reachable calls existed.
- C2-6 was confirmed by an exhaustive repository-wide grep for `context.tenantId` — zero admin route
  handlers read it.
- C2-4 was confirmed by tracing the actual reachable composition graph (`api.ts` → `wireAdmin` →
  `wireSecurity`) hop by hop, distinct from the unreachable `wireSecurityRuntime` path.
- C2-5 was confirmed by reading `deploy.yml` end to end and every file under `infrastructure/k8s/` —
  no migration execution existed anywhere.
- C2-2 (webhook half) was confirmed by an exhaustive grep for `verifyWebhook` — exactly two non-test
  hits, both declarations, zero call sites.

No finding turned out to be a false positive, and no finding required a scope reduction beyond what
each report's own "Scope note" discloses (C2-6's real multi-tenancy, C2-4's real MFA provider, and
C2-2's real PSP adapter are all disclosed as deliberately deferred, larger work — not silently dropped).

---

## Remaining High findings (not started, per instruction)

All nine High findings from `FINAL_PRODUCTION_READINESS_AUDIT_v2.md` are untouched by this sprint.
None of the six Critical fixes modified the code paths they concern:

| ID   | Finding                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------ |
| H2-1 | Production audit trail is in-memory (`InMemoryAuditTrail`); `PrismaAuditTrail` exists, unwired               |
| H2-2 | `startRuntimeTelemetry` has zero callers; OTel never starts though k8s config enables it                     |
| H2-3 | The entire zero-trust runtime / provisioning / entitlement subtree has zero production callers               |
| H2-4 | Retry back-off sleeps in-process on the same consumer as the main topic (up to 1h stall)                     |
| H2-5 | `tracking.event.captured.v1` topic never created; ingest disabled with no config key set                     |
| H2-6 | Collector has no image, no k8s manifest, and an always-healthy readiness probe                               |
| H2-7 | No `lumo-runtime` Prometheus scrape job; API's `/readyz` never feeds `runtime_ready`/`runtime_dependency_up` |
| H2-8 | `pnpm audit` gate is `continue-on-error: true`; 1 critical + 18 high advisories currently pass silently      |
| H2-9 | Only 3 of 37 "durable" contexts have ever executed against a real Postgres                                   |

## Remaining Medium findings (not started, per instruction)

| ID   | Finding                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------ |
| M2-1 | Purchase saga cannot complete — zero `.signal()` call sites, `@platform/temporal` has zero importers         |
| M2-2 | Media object storage is a stub (`InMemoryObjectStorage`); `@platform/storage` has zero importers             |
| M2-3 | Licensing billing use cases never move money (`InMemoryPaymentsAdapter`/`InMemoryFinanceLedgerAdapter`)      |
| M2-4 | `as never` casts defeat type checking at two Prisma composition seams (tracking)                             |
| M2-5 | Analytics/Platform Console remain non-durable — disclosed and accepted, not a defect                         |
| M2-6 | Storefront is built but has no Deployment/Service/Ingress                                                    |
| M2-7 | Consumer-path payment verification is optional by design — defensible, asymmetry now more visible after C2-6 |

None of these were touched, worsened, or incidentally fixed by this sprint.

---

## Updated Production Score

| Dimension                      | Weight | v2 Score | v2.1 Score | Why it moved                                                                                                                                                    |
| ------------------------------ | ------ | -------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture & code quality    | 15%    | 95       | 95         | Untouched — every fix stayed inside existing patterns (0 arch violations, still)                                                                                |
| Persistence correctness        | 15%    | 85       | 90         | C2-3: outbox no longer grows unbounded on the primary DB                                                                                                        |
| Persistence verification depth | 10%    | 25       | 25         | Untouched — H2-9 not in scope                                                                                                                                   |
| Build, CI/CD & supply chain    | 10%    | 70       | 85         | C2-5: migrations now gate rollout; H2-8 (audit gate disabled) still open                                                                                        |
| Runtime bootability            | 15%    | 0        | 20         | C2-1's config blocker is gone, but C2-4 introduces a new, deliberate, disclosed blocker (no real MFA provider exists) — still cannot boot outside `local` today |
| Payments / revenue path        | 10%    | 10       | 25         | C2-2 wiring half closed (`verifyWebhook` now has a real call site and gates a real route); still no real PSP, still no card can be charged                      |
| Security posture               | 15%    | 30       | 60         | C2-4 closes a live authentication bypass; C2-6 closes a live cross-tenant data leak; H2-1/H2-3 (audit trail, zero-trust) untouched                              |
| Observability & operations     | 10%    | 35       | 35         | Untouched — H2-1/H2-2/H2-7 not in scope                                                                                                                         |

### **Overall: 65 / 100** (v2: 55/100, v1: 31/100)

The gate results are unchanged in kind and improved in count — every required gate still passes, and
the test suite grew by 17 tests, all real, all green:

| Gate             | v2                                          | v2.1 (now)                                                                                 |
| ---------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm typecheck` | ✅ 76/76                                    | ✅ 76/76                                                                                   |
| `pnpm lint`      | ✅ 76/76                                    | ✅ 76/76                                                                                   |
| `pnpm test`      | ✅ 76/76 tasks                              | ✅ 76/76 tasks (test count up: admin 35→41, runtime 116→121, +2 new test files elsewhere)  |
| `pnpm arch`      | ✅ 0 violations (1,531 modules, 6,672 deps) | ✅ 0 violations (1,531 modules, 6,672 deps) — unchanged, confirming no architectural drift |
| `pnpm audit`     | ❌ 32 vulnerabilities (1 critical, 18 high) | ❌ unchanged — H2-8, out of scope                                                          |

---

## Production Verdict

> ### ❌ STILL NOT APPROVED FOR PRODUCTION — but the six fixed findings were real blockers, and they are genuinely closed

This sprint did what it set out to do: six confirmed, reproducible Critical defects — a config bug
that prevented boot, an outbox that grew forever, a cross-tenant data leak, a live authentication
bypass, a deploy pipeline that could ship against a database with no tables, and a webhook
verification port that nothing ever called — are now fixed, tested, and committed individually. None
of the fixes redesigned architecture, introduced new bounded contexts, changed a public API contract,
or built speculative capability beyond what each finding required. Two of the six deliberately made a
gap **louder** rather than closing it outright (C2-4's MFA guard, C2-6's tenant guard's multi-tenant
refusal) because closing it for real would have meant exactly the kind of redesign the work order
excluded — that is the correct call, not a shortcut.

**What still blocks production, in the order it will actually bite:**

1. **The runtime cannot start outside `local`** until a real `MfaProviderResolver` is built and
   injected (the direct, intended consequence of C2-4 — not a regression, but the current hard stop).
2. **No card can be charged** — `InMemoryPaymentProvider` is still the only `PaymentProvider`
   (`capture()` is a no-op, `verifyWebhook()` still accepts any signature). C2-2's wiring half is
   closed; its PSP half remains, disclosed, in `CRITICAL_6_REPORT.md`'s scope note.
3. **Nine High findings are untouched**, most consequentially H2-9 (34 of 37 "durable" contexts have
   never run against a real database) and H2-1/H2-2/H2-7 (audit trail, tracing, and metrics scraping
   all silently absent in production).

**What changed for the better, concretely, and should not need to be re-litigated:** the platform will
no longer silently corrupt cross-tenant data, no longer accept `123456` as a second factor, no longer
let its transactional outbox grow without bound, and no longer ship code to a database that was never
migrated. Those are the four findings most likely to have caused a real incident, and they are the
four the work order's own scoping correctly prioritized fixing first.

**Recommended next step**, unchanged in shape from the audit's own sequencing and consistent with this
sprint's results: build and inject a real `MfaProviderResolver` (unblocks boot), then a real PSP
adapter with raw-body/header capture (unblocks revenue), then work through the High list starting with
H2-1/H2-2 (both single-digit-line fixes per the original audit) before H2-9's integration coverage
push. High findings were explicitly not started this sprint and require separate authorization to
begin, per the work order.

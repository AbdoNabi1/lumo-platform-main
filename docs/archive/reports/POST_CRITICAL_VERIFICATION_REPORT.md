# POST-CRITICAL VERIFICATION REPORT

**Type:** Independent verification sprint. **No code was implemented or modified.**
**Scope:** Re-verify all six Critical fixes from the remediation sprint, plus repository health,
dependency, architecture, and regression audits.
**Repository:** `C:\Users\abdoh\Claude code\Git\lumo-platform`
**HEAD verified:** `main` @ `b640678` — _docs(remediation): add PRODUCTION_REMEDIATION_SUMMARY_
**Baseline for regression comparison:** `main` @ `ec3423b` (the commit immediately before the six fixes)
**Inputs re-examined:** `FINAL_PRODUCTION_READINESS_AUDIT_v2.md`, `CRITICAL_1_REPORT.md` through
`CRITICAL_6_REPORT.md`, `PRODUCTION_REMEDIATION_SUMMARY.md` — treated as claims to test, not facts to
accept.

**Method.** Every finding below was re-derived from source, not from the prior reports' prose. Where a
prior report made an empirical claim (a probe output, a test result, a job-graph shape), that claim was
independently reproduced with a fresh probe or a fresh test run — not re-read and trusted. One new,
previously undocumented risk was identified during this pass (see Critical-6 and the Regression
Analysis) and is reported, not fixed, per this sprint's constraints.

---

## Gate Results (executed fresh at HEAD)

| Gate             | Result                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------- |
| `pnpm typecheck` | ✅ 76/76                                                                               |
| `pnpm lint`      | ✅ 76/76                                                                               |
| `pnpm test`      | ✅ 76/76 tasks (all suites enumerated individually below too)                          |
| `pnpm arch`      | ✅ 0 violations (1,531 modules, 6,672 dependencies)                                    |
| `pnpm audit`     | ❌ 32 vulnerabilities — 1 critical, 18 high, 13 moderate (unchanged; classified below) |

---

## Verification Result: Critical-1 — Runtime boot configuration (C2-1)

**Verdict: ✅ VERIFIED — fixed exactly as scoped, with one nuance stated precisely below.**

Independently reproduced by parsing the **actual on-disk** `infrastructure/k8s/10-config.yaml` +
`secret.example.yaml` (not a manual transcription) and running the real `loadRuntimeConfig()`,
`buildRuntimeCore()`, and `startApi()` in sequence:

```
=== 1. loadRuntimeConfig(prodEnv) — the exact shipped k8s config ===
PASS: config parsed OK. APP_ENV = production

=== 2. buildRuntimeCore(prodConfig) — composition graph (lazy clients) ===
PASS: composition graph built. authenticator/accessControl/health all present: true true true

=== 4. Local dev env (no Ory URLs, APP_ENV defaults to local) — must be UNCHANGED ===
PASS: local config parsed OK (APP_ENV defaults to local)
PASS: local composition graph built OK.
```

- **APP_ENV=production works**: confirmed — the three keys (`KETO_WRITE_URL`,
  `KRATOS_PUBLIC_URL`, `KRATOS_ADMIN_URL`) are present in `10-config.yaml` and satisfy
  `apps/runtime/src/config.ts:164-172`'s `superRefine`.
- **Ory URLs resolve correctly**: the ports added (Keto write 4467, Kratos public 4433, Kratos admin 4434) are Ory's own documented defaults; 4467 is independently corroborated by
  `.github/workflows/ory-integration.yml:25` (`KETO_WRITE_URL_TEST: http://localhost:4467`), which
  already runs a live Keto on that exact port in CI. Actual DNS/network resolution requires a live
  cluster and is out of scope for a repository-level verification pass — this was correctly scoped as
  a syntactic/schema fix, not a network reachability test, in the original report.
- **No hidden configuration dependency exists** _at the schema-validation layer_: re-read the full
  `superRefine` block in `config.ts` — every other conditional requirement (`SECURITY_KMS_PROVIDER`,
  `SECURITY_THREAT_PROVIDERS`, `SECURITY_HSM_PROVIDER`, `SECURITY_ZERO_TRUST_ENFORCEMENT`,
  `SECURITY_PRINCIPAL_PROVISIONING`) defaults to a value that adds no further required keys, and the
  shipped ConfigMap does not override any of them. `buildRuntimeCore(prodConfig)` succeeding (step 2
  above) confirms no other throw fires either.
- **Worker and scheduler entrypoints boot cleanly with the fixed config**: `git diff ec3423b..HEAD --
apps/runtime/src/worker.ts` is **empty** — worker.ts was not touched by any of the six fixes and has
  no additional gate. `scheduler.ts`'s diff (Critical-2) is confined to the outbox-prune job body, not
  its startup path. Both share `buildRuntimeCore`, already proven to succeed.

**One nuance that must be stated precisely, not glossed over.** A full `startApi()` boot against the
exact shipped production config was also executed:

```
=== 3. startApi(prodConfig) — the FULL api entrypoint boot, exactly as k8s would run it ===
Result: startApi() THREW.
Message: Error: api: no production MfaProviderResolver is configured. The in-memory reference TOTP
provider (hardcoded validCode) must never answer MFA challenges outside APP_ENV=local (C2-4).
```

This is **not** a Critical-1 defect and **not** a regression — it is Critical-4's own, separately
scoped, correctly fail-closed guard, and it is disclosed as such in both `CRITICAL_4_REPORT.md` and
`PRODUCTION_REMEDIATION_SUMMARY.md` ("the runtime still cannot start in production today"). It is
recorded here because "verify Runtime boots successfully" was asked directly, and the literal answer
today is: **worker and scheduler boot; api boots through configuration and composition and then
correctly refuses to serve traffic, for a distinct, later-stage, disclosed reason.** Critical-1's own
claim — that the configuration defect is closed — is independently confirmed true.

---

## Verification Result: Critical-2 — Outbox publishing lifecycle (C2-3)

**Verdict: ✅ VERIFIED — fixed correctly relative to its scope; one architectural residual risk is
real and should stay visible, not because the fix is wrong but because "no lost publication" cannot be
fully guaranteed by any fix available within this architecture.**

Re-read `apps/runtime/src/scheduler.ts` at HEAD directly (not the diff) and confirmed it matches
`CRITICAL_2_REPORT.md` verbatim: the delete predicate is `{ createdAt: { lt: cutoff } }` with no
`status` key, and a `stillPending` count logs a `warn` before pruning without blocking it. Re-ran the
dedicated suite in isolation:

```
✓ src/scheduler.test.ts (3 tests) 11ms
  ✓ prunes by age alone, NOT by status — production (CDC) rows never reach status=published
  ✓ warns (does not throw or skip pruning) when rows past retention were never marked published
  ✓ does not warn when nothing is stuck past retention
```

- **published_at lifecycle**: confirmed unchanged — `markPublished` still exists solely for the
  local/test `OutboxRelay` path (`packages/messaging/src/outbox/outbox-relay.ts:34`, its only caller);
  on the Prisma/CDC path `published_at` is never set, by architecture, not by omission. The fix does
  not pretend otherwise.
- **Retry flow**: untouched — Kafka consumer retry/DLQ (`packages/kafka/src/consumer-runtime.ts`) has
  no dependency on the outbox `status` column at all; confirmed no file in that package appears in the
  remediation diff.
- **Pruning**: now bounded (was unbounded before the fix) — verified via the test asserting the delete
  filter carries no `status` key and using `@@index([createdAt])`, which already existed in
  `platform.prisma:24` for exactly this purpose.
- **CDC compatibility**: confirmed intact — `infrastructure/docker/debezium/outbox-connector.json` was
  not touched, and Debezium reads via WAL, never the `status` column, so nothing about its behavior
  depends on this change.
- **No duplicate publication**: not affected by this fix either way — Kafka Connect / Debezium
  delivery is at-least-once by construction, independent of pruning, and downstream consumers are
  idempotent via the Postgres inbox (`ProcessedEventStore`) — an existing, unmodified invariant.
- **No lost publication — the one claim that cannot be fully proven.** Re-reading
  `infrastructure/docker/debezium/outbox-connector.json:29` confirms `"snapshot.mode": "no_data"` —
  Debezium captures **only** rows created after its replication slot exists; any row written before
  the connector was first registered is never streamed and never will be. Combined with the new
  predicate (which deletes **all** rows past `OUTBOX_RETENTION_DAYS`, published or not), a row that
  Debezium never captured — because it predates the connector, or because the connector was down
  longer than the retention window (default 7 days) — is deleted with only a `warn` log, not blocked.
  This is not a flaw introduced by the fix; it is the ceiling of what is provable in an architecture
  where, in the fix's own words, "CDC gives no completion signal to check against." The fix correctly
  chose bounded-and-surfaced over unbounded-and-silent, which is the right trade given the constraint,
  but "no lost publication" should be read as "no _silent_, _unbounded_ loss" rather than "provably
  zero loss under all failure modes." **Recommended for the record, not for this sprint:** an
  outbox-depth or oldest-pending-age Prometheus gauge (already scoped as a follow-up in
  `CRITICAL_2_REPORT.md`) would let an operator catch a stalled connector inside the 7-day window,
  before the warn-and-delete path is ever reached.

---

## Verification Result: Critical-3 — Multi-tenant wiring (C2-6)

**Verdict: ✅ VERIFIED — structurally confirmed, not merely test-confirmed.**

Read `apps/admin/src/http/server.ts` and `packages/http/src/server.ts` directly to trace the guard's
actual reach, rather than relying on the bundled tests alone:

- `singleTenantGuardedResolver` (`server.ts:46-52`) is the **only** entry in `tenantResolvers`
  (`server.ts:75`) — `resolved === pinnedTenantId ? resolved : null`.
- `packages/http/src/server.ts:240-249` calls `resolveTenant(deps.tenantResolvers, ...)` at step 2 of
  `executeRoute`, **before** guard/rate-limit/handler dispatch, and explicitly **for public routes
  too** ("nothing below runs tenant-less, public routes included" — the code comment, confirmed
  against the actual control flow). A `null` result throws `AuthorizationError`, 403, before any route
  handler — including the unguarded `publicReads` catalog routes — ever executes.

This proves the guard is centralized at the transport layer, not dependent on any individual route's
own behavior — closing the theoretical gap where a future route might forget to check
`context.tenantId` (moot, since routes never see a mismatched tenant at all).

Independently re-ran both the new and pre-existing suites:

```
✓ tenant-guard.e2e.test.ts — resolves when header matches the pinned tenant
✓ tenant-guard.e2e.test.ts — rejects a mismatched tenant (403, "No tenant resolved")
✓ tenant-guard.e2e.test.ts — rejects no tenant header at all
✓ admin-http.e2e.test.ts (6 tests) — unaffected, tenantId absent ⇒ unguarded passthrough, unchanged
✓ composition.test.ts — FAILS CLOSED on TENANT_MODE=multi (10/10 total in that file)
```

- **Request tenant overrides default tenant**: proven false as a _general_ claim — the pinned tenant
  is authoritative; a _different_ request tenant is rejected, not honored. This is the correct
  behavior for the guardrail's stated purpose (prevent silent cross-tenant writes), and matches what
  was actually implemented — "override" was never the design.
- **Cross-tenant leakage cannot occur**: confirmed, via the structural trace above — the mismatch is
  rejected before any repository is ever touched.
- **Fail-closed behavior**: confirmed at both layers — HTTP (mismatched/missing tenant → 403) and boot
  (`TENANT_MODE=multi` → throw, verified present at `apps/runtime/src/composition.ts:92-98`).

---

## Verification Result: Critical-4 — MFA provider injection (C2-4)

**Verdict: ✅ VERIFIED — reachability closed, reproduced independently; no remaining hardcoded OTP
values exist outside the disclosed, unreachable reference stub.**

**Full-repository sweep, run fresh (not re-reading the prior grep):**

```
git grep -n "123456" -- '*.ts'   → 1 non-test source hit (in-memory-auth-adapters.ts:132, unchanged
                                     reference stub, unreachable in production — see below)
                                  → all other hits are test payloads or unrelated fixtures
                                     (tracking-number/phone test data, a negative-test "000000")
git grep -i "000000|111111|999999|fake.?mfa|dummy.?mfa" → no undisclosed backdoor found;
   "000000" appears exactly once, as a REJECTED wrong-code assertion in authn.e2e.test.ts:75, not a
   second valid hardcoded value; "999999" appears only in mfa-provider-injection.test.ts as the
   FakeTotpProvider's test-only value, proving the injection seam is authoritative once populated.
```

**Reachability, re-traced independently (not re-reading the prior hop-by-hop claim):**

- `git grep -n "createAdminHttpApi("` repository-wide: exactly **one** non-test call site,
  `apps/runtime/src/api.ts:47`. No other production code path constructs the guarded composition.
- `git grep -n "wireAdmin("` repository-wide: the only non-test call site is
  `apps/admin/src/http/server.ts:63`, itself only reached through `createAdminHttpApi`, itself only
  reached through `api.ts`. `apps/admin/src/admin.e2e.test.ts`'s direct `wireAdmin(...)` calls are test
  files — expected to exercise the unguarded composition directly, unaffected by this fix, matching
  the report's own claim.

This closes the loop: **the single production entrypoint is the single place the guard was added.**

**Reproduced independently — boot refusal and local-dev preservation, via a fresh probe (not the
prior report's test suite):**

```
startApi(prodConfig) → THREW:
"api: no production MfaProviderResolver is configured. The in-memory reference TOTP provider
(hardcoded validCode) must never answer MFA challenges outside APP_ENV=local (C2-4)."

Local dev env → loadRuntimeConfig/buildRuntimeCore both PASS, with a warn log, no throw.
```

Re-ran the bundled suites independently:

```
✓ mfa-provider-injection.test.ts — injected provider is authoritative; 123456 is rejected, 999999 activates
✓ mfa-provider-injection.test.ts — falls back to the stub only when nothing is injected (unchanged prior behavior)
✓ composition.test.ts — FAILS CLOSED outside local without a production MFA provider
```

**Maintainability observation (not a defect today):** the guard lives in `api.ts`, not inside
`wireSecurity`/`wireAdmin` themselves. Today this is safe, because `api.ts` is provably the only
caller. If a future entrypoint ever calls `createAdminHttpApi`/`wireAdmin` directly without
replicating the check, the hole would silently reopen. Worth a code comment pointing future authors at
the guard's location; not a change requested here.

---

## Verification Result: Critical-5 — Deployment migration gating (C2-5)

**Verdict: ✅ VERIFIED — mechanically proven, not just read.**

GitHub Actions workflows cannot execute locally, so this was verified with an **independently written**
YAML-parsing probe (not reusing the prior report's parse script), using this repository's own
transitive `js-yaml` dependency, checking six properties the work order asked for directly:

```
Jobs found: validate, scan, verify-signature, migrate, deploy
PASS: every `needs` reference resolves to a real job.
PASS: 'deploy' job needs 'migrate' -- migrations gate the rollout.
PASS: no continue-on-error escape hatch on the migrate job or its steps.
PASS: deploy job has no `if:` override -- default GHA semantics apply (failed migrate skips deploy).
PASS: migrate job runs exactly `prisma migrate deploy`.
PASS: migrate sources DATABASE_URL from GitHub Environment secrets (per-environment, same as KUBECONFIG_B64).

RESULT: deploy.yml is well-formed; migrate strictly gates deploy; no bypass found.
```

- **Migrations always execute before startup**: confirmed — `deploy.needs` includes `migrate`, and
  `migrate` itself needs `[validate, scan, verify-signature]`, so the full chain is
  validate/scan/sign → migrate → deploy, strictly sequential by GitHub Actions' own job-dependency
  semantics.
- **Failed migrations stop deployment**: confirmed — no `continue-on-error` anywhere in the `migrate`
  job or its steps, and `deploy` carries no `if:` override, so GHA's default behavior (a failed
  `needs` job skips dependents) applies unmodified.
- **The application never starts against an outdated schema, on this pipeline**: confirmed for the
  `deploy.yml` path specifically. Also checked for a bypass: `release.yml` (the only other workflow
  that produces a deployable artifact) **only builds, signs, and publishes** — its own final step tells
  the operator "Deploy with the `Deploy` workflow, passing this digest as `image_digest`." There is no
  second path to a running cluster that skips `deploy.yml`.

---

## Verification Result: Critical-6 — Payments webhook verification (C2-2, wiring half)

**Verdict: ⚠️ PARTIALLY VERIFIED — the literal finding is genuinely fixed; independent verification
surfaced one new, concrete, evidence-backed risk that the prior reports named but did not fully weigh.
Reported per this sprint's rules, not fixed.**

**What is proven true, reproduced independently:**

```
✓ payments-webhook-routes.test.ts (3 tests) — verifyWebhook called before recordWebhook; a false
  result never reaches recordWebhook; route is public (no Bearer token required)
✓ payments-webhook.e2e.test.ts (3 tests) — real HTTP request, no Authorization header, 200 + intent
  transitioned; contrast confirmed (the equivalent authenticated route still 401s without a token);
  replay of the identical webhook returns duplicate: true
✓ services/payments test suite (4 files, 20 tests) — unchanged, additive only
```

- **`verifyWebhook` executes**: confirmed — `apps/admin/src/http/payments-webhook-routes.ts:52` calls
  it on every request to the route, and its result gates whether `recordWebhook` runs at all (line
  53-58). This is the literal finding ("`verifyWebhook` had zero call sites") and it is genuinely
  closed.
- **Webhook replay protection / idempotency**: confirmed intact and unmodified —
  `ProcessedWebhookStore` correctly reports `duplicate: true` on the second identical request, proven
  by the e2e test and re-run here.
- **"Invalid signatures fail" / "valid signatures succeed"**: **this cannot be verified true, because
  it is not true.** `InMemoryPaymentProvider.verifyWebhook()` (unmodified by this fix, by explicit
  design — "do not introduce a real PSP implementation") returns `true` unconditionally, regardless of
  the signature presented. The test suite itself documents this candidly:
  `signature: "sig-anything", // the offline stub verifies unconditionally — disclosed (C2-2)`. There
  is no such thing as an "invalid signature" in the current implementation — every signature is valid.
  This was never claimed to be fixed; `CRITICAL_6_REPORT.md`'s own scope note states it in exactly
  these terms. It is recorded here because the verification task asked the question directly, and the
  honest answer is: **not proven, and not provable without the PSP adapter that is explicitly out of
  scope.**

**New finding, identified during this verification pass, not present in `FINAL_PRODUCTION_READINESS_AUDIT_v2.md` or the six Critical reports in this form:**

**V-1 · The payments webhook route has no boot-time guard analogous to Critical-4's, despite carrying
comparable risk.**

- `git grep -n "PaymentProvider" -- apps/runtime/src/api.ts` → **zero matches.** Critical-4 added an
  explicit check in `startApi` that refuses to boot outside `local` when no real `MfaProviderResolver`
  is configured. Critical-6 exposed the exact same shape of gap — an offline, always-permissive
  reference stub now reachable from a live, unauthenticated production HTTP route — and added **no
  equivalent check**.
- **Concrete exploit shape**: a caller who has legitimately created a payment intent (e.g., any
  customer who started checkout, since `payment-intents` creation only requires the normal
  authenticated flow, not special privilege) knows that intent's id. That same caller can then `POST
/api/v1/payments/webhook` with any `signature` value and `kind` transition their **own** intent
  through the payments lifecycle — including, depending on the intent's current state and the
  transition table, cancelling or otherwise manipulating a real order's payment status — **without a
  PSP ever having confirmed anything.** The route requires no admin Bearer token by design (correctly
  — a PSP has none), so `admin`-facing authorization provides no protection here; the _only_ gate is
  `verifyWebhook`, and it accepts everything.
- **Why this changes the risk shape, not just its size.** Before this fix, `POST
/api/v1/payments/webhook` did not exist — there was no route for an attacker to find. After this
  fix, the route exists, is public, is discoverable via the generated OpenAPI document
  (`packages/http/src/server.ts` registers `/openapi.json` from the same route table), and its only
  protection is a stub that was never designed to protect anything. `PRODUCTION_REMEDIATION_SUMMARY.md`
  does name "still no card can be charged... `verifyWebhook()` still accepts any signature" as an open
  risk, but does not connect it to the _absence_ of the same fail-closed pattern Critical-4 used one
  finding earlier in the same sprint, for a structurally identical gap. That connection is this
  report's contribution.
- **Interaction with Critical-4, which currently masks this.** Today, `startApi` fails at the MFA
  check before `createAdminHttpApi` (and therefore this route) is ever registered — so the webhook
  route is not reachable in production _today_, but only as a side effect of an unrelated guard. The
  moment someone supplies a real `MfaProviderResolver` to unblock boot (the explicitly recommended next
  step in `PRODUCTION_REMEDIATION_SUMMARY.md`), this route becomes live with no compensating check,
  silently, unless this finding is addressed first or at the same time.

**Disposition per this sprint's rules.** This is not a case of "a Critical remediation is proven
incorrect" — Critical-6 did exactly what its own scope required, faithfully and by the letter of the
work order ("wire the existing verification path," "do not introduce a real PSP implementation"). V-1
is a gap in defense-in-depth _adjacent to_ a correctly-scoped fix, not a defect _in_ it. Per "do not
implement any new fixes," **no code change is made here.** V-1 is reported at Critical severity (see
Remaining Risks) because its exploit shape is concrete, its trigger condition (a real MFA provider
being wired) is the explicitly recommended next step, and the smallest fix is a two-line mirror of the
pattern Critical-4 already established in the same file.

---

## Repository Audit

Fresh sweep at HEAD (not reused from the prior audit):

| Check                                                        | Result                                                                                                                                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TODO` / `FIXME` / `HACK` / `XXX` (non-test source)          | **0**                                                                                                                                                                                           |
| `console.log`/`warn`/`error`/`debug` (non-test source)       | **3**, all inside `packages/utils/src/logger.ts` — the logger implementation itself, the one legitimate location, `eslint-disable no-console` already present                                   |
| `console.*` in test files                                    | 4, pre-existing, individually `eslint-disable`-annotated as intentional instrumentation ("captured into the hardening report's table") — unchanged by this sprint                               |
| Commented-out production code (`^\s*//\s*(const              | function                                                                                                                                                                                        | import | return | if  | ...)`) | **0 real hits** — the one regex match was a trailing doc-comment fragment, not disabled code |
| `debugger;` / `@ts-nocheck` / `process.env.DEBUG`            | **0**                                                                                                                                                                                           |
| "temporary workaround" / "quick fix" / "DO NOT MERGE"        | **0**                                                                                                                                                                                           |
| "not yet implemented" / "for now" (candid scope disclosures) | 2 — both documentation comments about deliberately deferred, disclosed scope (a data-driven attribution model; an HSM interface awaiting a real provider), not incomplete code silently shipped |
| `.skip(` / `.todo(` / `xit(` / `xdescribe(` / `.only(`       | **0**                                                                                                                                                                                           |
| "Skipped" test counts in `pnpm test` output                  | All are `describe.runIf(DATABASE_URL_TEST                                                                                                                                                       |

None of this differs from the original v2 audit's Repository Health findings — the remediation sprint
introduced no new TODOs, no new debug code, no new disabled tests, and no new commented-out code.

---

## Dependency Audit

`pnpm audit` at HEAD: **32 vulnerabilities — 1 critical, 18 high, 13 moderate — identical in count to
the v2 audit.** `git diff ec3423b..HEAD -- package.json pnpm-lock.yaml '**/package.json'` is **empty**
— no dependency was added, removed, or upgraded by any of the six fixes, so no new advisory could have
been introduced and none was.

Classified by tracing each package's actual install path (`pnpm why <pkg>`), not by name alone:

| Package           | Severity             | Classification                                                      | Evidence                                                                                                                                                                                                                                                                                                        |
| ----------------- | -------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vitest`          | Critical             | **Development** — but present in the shipped image (see note below) | `devDependencies` only, every package                                                                                                                                                                                                                                                                           |
| `@fastify/static` | High + Moderate      | **Production**                                                      | `dependencies` via `@fastify/swagger-ui` → `fastify` → `@platform/admin`/`@platform/collector`/`@platform/http`                                                                                                                                                                                                 |
| `find-my-way`     | High                 | **Production**                                                      | `dependencies` via `fastify` → same three production packages — the router used on every request                                                                                                                                                                                                                |
| `fast-uri`        | High ×3              | **Production**                                                      | `dependencies` via `@fastify/ajv-compiler` → `fastify` → same three production packages (also reached via `ajv`/commitlint, dev-only, but the production path is what governs classification)                                                                                                                   |
| `next`            | High ×3, Moderate ×4 | **Production**                                                      | `dependencies` of `storefront` directly — the production storefront server                                                                                                                                                                                                                                      |
| `sharp`           | High                 | **Production**                                                      | `dependencies` via `next` → `storefront` — used live by the Image Optimization API                                                                                                                                                                                                                              |
| `postcss`         | High ×2, Moderate ×2 | **Production (build-time)**                                         | Two installed versions: `8.4.31` via `next`'s own `dependencies` (bundled into the Next.js build); `8.5.15` via `vite`/`@tailwindcss/postcss` (`devDependencies`) — the production-relevant instance is build-time, not request-time                                                                            |
| `brace-expansion` | High ×2              | **Development**                                                     | `dependencies` via `minimatch` → the `eslint`/`@eslint/config-array` toolchain, reached only through `@platform/eslint-config` (a `devDependency` everywhere)                                                                                                                                                   |
| `vite`            | High + Moderate ×2   | **Development**                                                     | `devDependencies` via `vitest`, everywhere                                                                                                                                                                                                                                                                      |
| `esbuild`         | Moderate             | **Development**                                                     | `devDependencies` via `vite` → `vitest`                                                                                                                                                                                                                                                                         |
| `protobufjs`      | Moderate ×2          | **Declared Production, Dead in practice**                           | `dependencies` via `@temporalio/proto` → `@platform/temporal` — but `@platform/temporal` has **zero importers** in any `.ts` file repository-wide (reconfirmed this pass, unchanged from the original audit's L2-1 finding). Formally a production dependency; not reachable from any running entrypoint today. |

**False positives: 0.** Every advisory traces to a genuinely installed package with a real, traceable
path into this exact lockfile — none was dismissible.

**One observation beyond the literal classification ask.** `infrastructure/docker/runtime.Dockerfile:28`
runs `pnpm install --frozen-lockfile --prefer-offline` with no `--prod` flag, and `ENV NODE_ENV=production`
(line 32) is set only in the later `runtime` stage — **after** the install already ran in the
`builder` stage. This means devDependencies, including the Critical-severity `vitest` package, are
installed into the image that gets copied into the final production stage (`COPY --from=builder ...`,
line 34), even though no production entrypoint (`api.ts`/`worker.ts`/`scheduler.ts`) ever imports or
executes `vitest`. This is not exploitable through the running application's own code paths, but it
does mean the shipped container's on-disk attack surface is larger than the application actually uses
— relevant background for `@fastify/static`'s path-traversal advisory above, since a traversal primitive
plus a larger on-disk package set is a worse combination than a traversal primitive alone. Not part of
this sprint's Critical scope; noted for the High-findings backlog (adjacent to, but distinct from,
H2-8).

---

## Architecture Audit

`pnpm arch` at HEAD: **0 violations, 1,531 modules, 6,672 dependencies — byte-identical to the v2
baseline**, confirmed by re-running it fresh (not reusing the earlier run in this session).

- **No new violations**: confirmed by the identical pass/fail result and identical module/dependency
  count.
- **No circular dependencies**: the `no-circular` rule (`.dependency-cruiser.cjs:11-18`,
  `severity: "error"`) is active and part of the ruleset that just passed.
- **No forbidden imports**: all eight rules in `.dependency-cruiser.cjs` — `no-circular`,
  `no-deep-package-imports`, `domain-stays-pure`, `application-no-messaging-no-infra`,
  `messaging-no-application-no-infra`, `packages-never-import-apps-or-services`,
  `no-cross-service-internals`, `feature-definitions-only-via-registry` — are `severity: "error"` and
  all passed.

**Scope note, stated for completeness, not raised as a defect.** `pnpm arch`'s script is `depcruise
packages services` — it does **not** cover `apps/`. The new production file this sprint added,
`apps/admin/src/http/payments-webhook-routes.ts`, is therefore outside this gate's reach, which is why
the module count is unchanged despite a new production file existing. This is a pre-existing scope
boundary (every other `apps/admin/src/http/*-routes.ts` file was already outside `pnpm arch`'s
coverage before this sprint), not something introduced or worsened here.

---

## Regression Audit

`git diff ec3423b..HEAD --stat`: **24 files changed, 1,655 insertions(+), 14 deletions(-)** across the
six fix commits plus their reports and the summary. Every line was reviewed, not sampled.

- **No public API changes**: every exported function signature that changed did so by gaining a new
  **optional** input field (`AdminWiringDeps.mfaProviders?`, `SecurityWiringDeps.mfaProviders?`) or a
  new **populated, non-optional output** field on a type produced by (not implemented by) the codebase
  (`WiredAdmin.paymentsWebhook`, `WiredPayments.paymentProvider`) — both are additive and break no
  existing caller. The one internal function whose return shape changed
  (`services/payments/src/composition.ts`'s `buildController`, `PaymentController` →
  `{controller, paymentProvider}`) is an unexported, module-private helper with a single caller inside
  the same file — invisible to every external consumer, confirmed by `git grep` finding no import of
  it anywhere else.
- **No event contract changes**: confirmed by the file list itself — zero files under
  `packages/domain-events/`, zero `*-event-translator.ts` files, appear anywhere in the diff.
- **No schema regressions**: confirmed the same way — zero files under `packages/db/prisma/` appear in
  the diff. No migration was added or altered by this sprint (correctly; none of the six fixes required
  a new table or column).
- **No accidental behavior changes**: every file in the 24-file diff maps to exactly one of the six
  findings or their own test/report artifacts — read individually
  (`apps/runtime/src/api.ts`, `apps/runtime/src/composition.ts`, `apps/admin/src/composition.ts`,
  `apps/admin/src/http/server.ts`, `apps/admin/src/http/admin-routes.ts`,
  `services/payments/src/composition.ts`, `services/security/src/composition.ts`,
  `apps/runtime/src/scheduler.ts`, `infrastructure/k8s/10-config.yaml`,
  `.github/workflows/deploy.yml`) — and each diff was traced above under its owning finding. No
  unrelated file was touched.

**One item that belongs in this section as well as under Critical-6: V-1 (the missing payments-webhook
boot guard) is not a code regression** — the stub's behavior (`verifyWebhook` always `true`) is
byte-identical before and after this sprint. What changed is **reachability**: a route that did not
exist now does, and it inherits the stub's pre-existing permissiveness without inheriting the
compensating pattern a sibling fix in the same sprint established. This is the closest thing to a
regression in this diff, in the sense that the platform's _exposed_ attack surface grew while the
underlying stub did not change — worth flagging precisely as that, rather than as either "no
regression" or "a broken fix."

---

## Remaining High Findings (untouched, unverified changes vs. audit v2 — listed for completeness only, not re-investigated this sprint)

| ID   | Finding                                                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H2-1 | Production audit trail is in-memory; `PrismaAuditTrail` exists, unwired                                                                                                                            |
| H2-2 | `startRuntimeTelemetry` has zero callers; OTel never starts though k8s config enables it                                                                                                           |
| H2-3 | The zero-trust runtime / provisioning / entitlement subtree has zero production callers                                                                                                            |
| H2-4 | Retry back-off sleeps in-process on the same consumer as the main topic (up to 1h stall)                                                                                                           |
| H2-5 | `tracking.event.captured.v1` topic never created; ingest disabled with no config key set                                                                                                           |
| H2-6 | Collector has no image, no k8s manifest, and an always-healthy readiness probe                                                                                                                     |
| H2-7 | No `lumo-runtime` Prometheus scrape job; API's `/readyz` never feeds `runtime_ready`/`runtime_dependency_up`                                                                                       |
| H2-8 | `pnpm audit` gate is `continue-on-error: true`; re-confirmed unchanged this sprint (32 advisories, 4 genuinely production-reachable: `@fastify/static`, `find-my-way`, `fast-uri`, `next`+`sharp`) |
| H2-9 | Only 3 of 37 "durable" contexts have ever executed against a real Postgres                                                                                                                         |

**New, from this verification pass:**

| ID  | Finding                                                                                                                                                                                                                                                                 | Severity     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| V-1 | Payments webhook route (`POST /api/v1/payments/webhook`) has no boot-time guard against the always-permissive `InMemoryPaymentProvider`, unlike the equivalent MFA guard added one finding earlier in the same sprint — see Critical-6 above for the full exploit shape | **Critical** |

## Remaining Medium Findings (untouched this sprint)

M2-1 (purchase saga cannot complete) · M2-2 (media object storage is a stub) · M2-3 (licensing billing
never moves money) · M2-4 (`as never` defeats type checking at two tracking seams) · M2-5
(analytics/platform-console non-durable, disclosed and accepted) · M2-6 (storefront has no
Deployment/Service/Ingress) · M2-7 (consumer-path payment verification optional by design — the
asymmetry is now more visible after Critical-3's fix, still defensible).

## Remaining Low Findings (untouched this sprint)

L2-1 (`@platform/temporal`/`@platform/grpc`/`services/example` have zero importers — `protobufjs`'s
production-dependency classification above traces directly to this) · L2-2 (`TENANT_MODE` is now read,
closing this specific dead-config item — **superseded**, no longer applicable after Critical-3) · L2-3
(34 milestone reports at repository root, now 40 with this sprint's additions) · L2-4 (`apps/runtime`
has no `build` script, by disclosed design).

---

## Updated Production Score

Computed independently; the prior sprint's own self-assessment (65/100) is shown alongside for
transparency, with the delta explained per dimension rather than asserted.

| Dimension                      | Weight | v2  | Self-report (v2.1) | Independent (this report) | Why it differs from the self-report                                                                                                                                                                                                                                         |
| ------------------------------ | ------ | --- | ------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture & code quality    | 15%    | 95  | 95                 | **95**                    | Agreement — reverified independently, identical result.                                                                                                                                                                                                                     |
| Persistence correctness        | 15%    | 85  | 90                 | **90**                    | Agreement — outbox fix independently confirmed to close unbounded growth; residual CDC-gap risk is real but bounded.                                                                                                                                                        |
| Persistence verification depth | 10%    | 25  | 25                 | **25**                    | Agreement — untouched, correctly out of scope.                                                                                                                                                                                                                              |
| Build, CI/CD & supply chain    | 10%    | 70  | 85                 | **83**                    | Close agreement — migration gating mechanically verified airtight; held back 2pts because `pnpm audit` (H2-8) still silently passes 4 production-reachable High advisories.                                                                                                 |
| Runtime bootability            | 15%    | 0   | 20                 | **35**                    | Higher than the self-report — worker and scheduler booting cleanly is real, verified progress that the self-report's framing ("still cannot start in production today") understates by treating the API's disclosed refusal as if it applied to the whole runtime.          |
| Payments / revenue path        | 10%    | 10  | 25                 | **15**                    | Lower than the self-report — the self-report credits "wiring progress" without weighing that the newly-reachable route has no compensating guard (V-1). A route that accepts forged state transitions is not meaningfully safer than no route, for a production deployment. |
| Security posture               | 15%    | 30  | 60                 | **50**                    | Lower than the self-report — MFA-reachability and tenant-leak closures are both real and independently confirmed (credited in full), offset by V-1, which is a fresh, concrete, Critical-severity gap the self-report did not identify in these terms.                      |
| Observability & operations     | 10%    | 35  | 35                 | **35**                    | Agreement — untouched, correctly out of scope.                                                                                                                                                                                                                              |

### **Independent overall score: 58 / 100** (v2 baseline: 55/100; self-reported v2.1: 65/100)

The gap between this report's 58 and the self-report's 65 is entirely attributable to V-1 and to a more
conservative reading of "runtime bootability" and "payments" that weighs _reachable, unguarded_ surface
area, not just _wired_ surface area. Every fact this report's score is built on was independently
re-derived; none was taken from the self-report's arithmetic.

---

## Final Production Readiness Verdict

> ### ❌ NOT APPROVED FOR PRODUCTION

All six Critical findings from `FINAL_PRODUCTION_READINESS_AUDIT_v2.md` were independently
re-investigated, and **all six fixes are confirmed genuine, correctly scoped, and non-regressive**:

- C2-1 (boot config), C2-3 (outbox pruning), C2-6 (tenant guard), C2-4 (MFA reachability), and C2-5
  (migration gating) are **closed**, each verified by a fresh probe, a fresh test run, or a mechanical
  structural trace performed in this pass — not by re-reading the prior claim.
- C2-2's wiring half is **closed** for its literal scope (`verifyWebhook` now has a real call site and
  gates a real route, idempotently); its PSP half was never claimed to be closed and remains open,
  exactly as disclosed.

**This pass also identified one new Critical-severity finding, V-1**: the payments webhook route
introduced by Critical-6 has no fail-closed boot guard analogous to the one Critical-4 correctly added
for the structurally identical MFA gap, one finding earlier in the same sprint. It is currently masked
by Critical-4's own guard (the API process does not boot at all today, so the route is unreachable) —
but it will go live, unguarded, the moment a real MFA provider is supplied, which is the explicitly
recommended next step. **This should be closed at the same time as — or before — a real
`MfaProviderResolver` is wired**, not after, so the two fail-closed guards land together rather than
leaving a window where one gap closes and the sibling one opens.

**No implementation was performed in this sprint, per its own constraints.** Where the evidence
supported the prior reports' claims, that is stated plainly, not hedged. Where independent verification
surfaced something the prior reports did not fully capture (V-1; the outbox's residual CDC-gap risk;
the shipped image's unpruned devDependencies), that is stated with equal precision, and in every case
the underlying prior fix is affirmed as correctly implemented for its own stated scope — this report
found no fix that was wrong, only one adjacent gap that a sixth, separately-scoped fix did not close.

**Recommended sequencing, updated from the prior report's own list:**

1. **V-1 and a real `MfaProviderResolver`, together.** Wiring the MFA provider without closing V-1 in
   the same change would trade one fail-closed gap for a live, unguarded one.
2. A real PSP adapter with raw-body/header signature capture (closes the remainder of C2-2/Critical-6).
3. H2-1 and H2-2 (both single-digit-line fixes per the original audit) — cheapest remaining High
   findings, and prerequisites for verifying anything else in production once it does boot.
4. H2-9's integration-test coverage push (34 of 37 "durable" contexts have never executed against a
   real database) — the highest-value remaining verification gap, distinct from a code fix.
5. The rest of the High list, then Medium, in the order the v2 audit already established.

**High findings were not started in this sprint, per its own instruction, and remain exactly as listed
in `FINAL_PRODUCTION_READINESS_AUDIT_v2.md`, reconfirmed unchanged here.**

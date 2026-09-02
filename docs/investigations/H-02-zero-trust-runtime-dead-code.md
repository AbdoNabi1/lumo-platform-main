# H-02 — The entire zero-trust security runtime is unreachable, and its config flags are never read

| Field                      | Value                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**               | High                                                                                                                                                           |
| **Area**                   | Security / Runtime composition                                                                                                                                 |
| **Baseline**               | `main` @ `756bce3`                                                                                                                                             |
| **Blocker verdict**        | **Intentional deferral, misreported as an activatable feature.** The dead code is not itself a blocker; the _config flags that imply it can be turned on_ are. |
| **Public contract change** | **No.**                                                                                                                                                        |

---

## 1. Location

| File                                                           | Lines      | What is there                                                                            |
| -------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| `apps/runtime/src/security/wire-security-runtime.ts`           | 38         | `export function wireSecurityRuntime(core: RuntimeCore): WiredSecurity` — 0 callers      |
| `apps/runtime/src/security/wire-security-runtime.ts`           | 90         | `export function buildSecurityHttpGuard(core: RuntimeCore): PermissionGuard` — 0 callers |
| `apps/runtime/src/security/bootstrap-security.ts`              | 46         | `export async function bootstrapSecurity(...)` — 0 callers                               |
| `apps/runtime/src/security/security-provisioning.consumers.ts` | 56, 76, 92 | Three `EventHandler` classes — 0 callers                                                 |
| `apps/runtime/src/entitlement/wire-entitlement.ts`             | 47         | `export function wireEntitlement(...)` — 0 callers                                       |
| `apps/runtime/src/config.ts`                                   | 101–111    | `SECURITY_PRINCIPAL_PROVISIONING` — validated, **never read**                            |
| `apps/runtime/src/config.ts`                                   | 112–125    | `SECURITY_ZERO_TRUST_ENFORCEMENT` — validated, **never read**                            |
| `apps/runtime/src/config.ts`                                   | 154–160    | A cross-field rule enforcing an ordering between two flags nothing consumes              |
| `apps/runtime/src/{api,worker,scheduler}.ts`                   | —          | Import only `./config` and `./composition`                                               |
| `apps/runtime/src/index.ts`                                    | 1–5        | The barrel exports only config/composition/api/worker/scheduler                          |

---

## 2. Current implementation

### 2a. The subtrees are complete and well built

`apps/runtime/src/security/` contains 45 files: Ory adapters, AWS SigV4 signing, cloud KMS providers (AWS/GCP/Azure/Vault), HSM providers, six threat-intel feeds, an edge zero-trust guard, an edge cache, OTel security telemetry, security instrumentation, context propagation, resilience, and session federation — with 15 accompanying test files. `apps/runtime/src/entitlement/` contains 9 more.

`buildSecurityHttpGuard` is the intended production authorization point:

```ts
// apps/runtime/src/security/wire-security-runtime.ts:90-99
export function buildSecurityHttpGuard(core: RuntimeCore): PermissionGuard {
  const wired = wireSecurityRuntime(core);
  const providers = wireSecurityProviders({ config: core.config, logger: core.logger });
  const edge = wireSecurityEdge({
    logger: core.logger,
    sessionTtlSeconds: core.config.SECURITY_SESSION_MIRROR_TTL_SECONDS,
  });
  return edge.buildGuard(wired.sdk, providers.threatIntel, wired.sdk);
}
```

It returns a `PermissionGuard`, which is exactly the type `HttpServerDeps.guard` accepts (`packages/http/src/server.ts:61`). The seam it needs to plug into already exists.

### 2b. Nothing calls any of it

Checking each exported symbol for references **outside its own subtree**:

```
wireEntitlement                    totalRefs=2   refsOutsideOwnSubtree=0
bootstrapSecurity                  totalRefs=1   refsOutsideOwnSubtree=0
wireSecurityRuntime                totalRefs=4   refsOutsideOwnSubtree=0
buildSecurityHttpGuard             totalRefs=1   refsOutsideOwnSubtree=0
ProvisionPrincipalOnUserCreated    totalRefs=1   refsOutsideOwnSubtree=0
AssignRoleOnMembershipCreated      totalRefs=1   refsOutsideOwnSubtree=0
wireSecurityEdge                   totalRefs=4   refsOutsideOwnSubtree=0
wireSecurityProviders              totalRefs=5   refsOutsideOwnSubtree=0
```

`bootstrapSecurity`, `buildSecurityHttpGuard`, `ProvisionPrincipalOnUserCreated`, and `AssignRoleOnMembershipCreated` have **exactly one** reference each — their own definition.

The three entrypoints import nothing from these subtrees, and `apps/runtime/src/index.ts` does not re-export them:

```ts
// apps/runtime/src/index.ts — the complete file
export { loadRuntimeConfig, type RuntimeConfig } from "./config";
export { buildPaymentCapturedRuntime, buildRuntimeCore, type RuntimeCore } from "./composition";
export { startApi } from "./api";
export { startWorker } from "./worker";
export { buildJobs, startJobLoop, startScheduler, type ScheduledJob } from "./scheduler";
```

### 2c. The config flags are the actual defect

```ts
// apps/runtime/src/config.ts:112-125
/**
 * Mounts `SecurityPermissionGuard` as the HTTP authorization point (P2.0.2/C): every protected
 * request runs `EvaluateAccess` (authn → threat → risk → device → policy → RBAC/ABAC → step-up →
 * WORM audit). Default `off` ⇒ the existing `AdminGuard` + Keto path stays the enforcement point…
 */
SECURITY_ZERO_TRUST_ENFORCEMENT: z.string().default("off").transform((v) => ...),
```

with a carefully-written cross-field rule:

```ts
// apps/runtime/src/config.ts:154-160
if (cfg.SECURITY_ZERO_TRUST_ENFORCEMENT && !cfg.SECURITY_PRINCIPAL_PROVISIONING) {
  ctx.addIssue({ ..., message:
    "SECURITY_ZERO_TRUST_ENFORCEMENT requires SECURITY_PRINCIPAL_PROVISIONING=on (enforcement fails closed against an unprovisioned store)." });
}
```

```
$ git grep -n "SECURITY_ZERO_TRUST_ENFORCEMENT\|SECURITY_PRINCIPAL_PROVISIONING" -- '*.ts'
apps/runtime/src/config.ts:101,112,154,157,159      (definition + the cross-field rule)
```

**No consumer.** Both flags are parsed, validated, cross-checked — and then discarded.

Note also: the Security context **is** reached in production, but by a different route. `apps/runtime/src/api.ts:41-42` → `createAdminHttpApi` → `wireAdmin` → `wireSecurity(deps)` takes the Prisma branch (`services/security/src/composition.ts:273`). So Security's _data_ is durable; its _decision engine_ is never the enforcement point.

---

## 3. Why it is incorrect

The dead code is not the defect. Deferring activation is a legitimate choice, and `docs/KNOWN_GAPS.md` records the reasons.

The defect is that **the deferral is invisible to an operator and looks like a supported toggle.**

1. Two documented, validated environment variables imply a supported activation path. An operator reading `config.ts:112-125` would set `SECURITY_ZERO_TRUST_ENFORCEMENT=on`, observe no error (the cross-field rule passes once both are `on`), and conclude that zero-trust enforcement — _"authn → threat → risk → device → policy → RBAC/ABAC → step-up → WORM audit"_ — is now active. **Nothing would change.** That is worse than the feature not existing: it manufactures false assurance about a security control.
2. The same applies to `SECURITY_PRINCIPAL_PROVISIONING`. Setting it `on` does not start the provisioning consumers, so the Security principal store stays empty — and an empty store is exactly the fail-closed hazard the cross-field rule was written to prevent.
3. ~54 files, 15 test suites, and 6 cloud provider integrations are carried, linted, typechecked, and tested on every CI run while contributing nothing to the running system. That is a maintenance liability with no offsetting benefit, and it is invisible because `pnpm arch` does not cruise `apps/` (M-8).

---

## 4. Production impact

**No functional degradation today** — `AdminGuard` + Keto remains the enforcement point and works (`apps/runtime/src/composition.ts:101-119`, fail-closed outside `local`). Authorization is not broken.

The impact is on **assurance and on the fixes that depend on this code**:

- The P2.0 Security Platform — 77 source files, 51 events, RBAC/ABAC/ReBAC/PBAC, risk scoring, device trust, step-up, WORM audit — never participates in a request. Any statement that the platform enforces zero trust is false.
- `OtelSecurityTelemetry` (`security-telemetry-otel.ts:15`) is instantiated only by `wireSecurityEdge` (`wire-security-edge.ts:50`), which is only called by `buildSecurityHttpGuard`, which is called by nobody. So all security metrics — failed logins, step-up challenges, risk distribution, device-trust distribution, policy cache hits, active sessions — are never emitted. This is a direct contributor to **H-04**.
- The only circuit-breaker implementations in the repository live here (`security/resilience.ts`, `security/threat-resilience.ts`). Because the subtree is dead, the platform has **no** circuit breaker on any live outbound integration.
- The principal-provisioning consumers are the mechanism that would populate the Security store from Identity events. Without them, **H-03**'s stub MFA provider is masked rather than mitigated: enforcement is off, so the `123456` code is never exercised. Fixing H-02 without H-03 would expose it.

---

## 5. Smallest additive fix

The right fix is **not** to activate the subtree. Activating it would expose H-03 and depends on a live Ory stack that `main` cannot even configure (C-09). The right fix is to stop the configuration from lying.

### Step 1 — make the flags fail closed (~10 lines, in the existing `superRefine`)

`apps/runtime/src/config.ts` already contains three `superRefine` clauses (lines 143–160). Add a fourth, immediately after the existing cross-field rule:

```ts
// P2.0.2 (C) is composed but not mounted: `buildSecurityHttpGuard` has no caller in any entrypoint.
// Accepting these flags silently would tell an operator that zero-trust enforcement is active when
// the request path still runs AdminGuard + Keto. Refuse them until the guard is actually mounted.
for (const key of ["SECURITY_ZERO_TRUST_ENFORCEMENT", "SECURITY_PRINCIPAL_PROVISIONING"] as const) {
  if (cfg[key]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [key],
      message:
        `${key}=on is not supported yet: the security runtime (buildSecurityHttpGuard / ` +
        `security provisioning consumers) is not mounted in any entrypoint. Enabling it has no effect.`,
    });
  }
}
```

This is additive, cannot break any current deployment (both flags default `off`), and converts a false assurance into an explicit boot error. **Remove this clause as part of whichever sprint actually mounts the guard.**

### Step 2 — record the state where it will be seen (documentation, no code)

Add a `docs/KNOWN_GAPS.md` row. G-39, G-40, G-41 are tracked there; the security-runtime activation gap is not. It is currently discoverable only by grepping for callers.

### Step 3 (later sprint, not now) — mount it

When mounted, the change is small because the seam already exists:

```ts
// apps/runtime/src/api.ts
const guard = config.SECURITY_ZERO_TRUST_ENFORCEMENT ? buildSecurityHttpGuard(runtime) : undefined;
```

`createAdminHttpApi` would need an optional `guard?: PermissionGuard` passthrough to `HttpServerDeps.guard`. **Prerequisites: H-03 (stub MFA provider), C-09 (a live Kratos/Keto stack — whose configuration is also missing from `main`), and the provisioning consumers registered in `worker.ts` so the store is populated before enforcement is switched on.** The ordering is exactly the one `config.ts:154-160` already encodes.

---

## 6. Public contract impact

**None.**

- Step 1 adds a validation clause. `RuntimeConfig`'s inferred type is unchanged — the fields already exist.
- No exported function is removed, renamed, or re-signed. `apps/runtime/src/index.ts` is untouched.
- No HTTP route, event schema, or package export changes.
- Step 3 would add an **optional** `guard?: PermissionGuard` to `AdminHttpDeps` — additive, and `PermissionGuard` is already the declared type of `HttpServerDeps.guard`.

---

## 7. Blocker or intentional deferral?

**An intentional deferral whose _surface area_ is the blocker.**

The deferral is real and documented in the code. `apps/runtime/src/config.ts:112-125` explains the design: _"Default `off` ⇒ the existing `AdminGuard` + Keto path stays the enforcement point, so production is never bricked. When `on`, the runtime REQUIRES the Prisma-backed Security context to build (fail-closed at boot; never falls open). Enable only after provisioning has seeded the store."_ That is careful thinking, and defaulting to `off` was the right call.

What was missed is that **the `on` branch was never implemented at the call site.** The flag documents behaviour that does not exist. `docs/KNOWN_GAPS.md` does not track this, so it is not visible in the project's own gap ledger.

**Verdict: the dead code is not a blocker; the misleading configuration is.** The Step 1 fix is ten lines and makes the deferral honest, which is all this finding needs before a deployment.

---

## 8. How this was verified

- For each exported symbol, `git grep -n <symbol> -- '*.ts'` with test files and the symbol's own subtree filtered out → **0 external references** for all eight symbols listed in §2b.
- `apps/runtime/src/{api,worker,scheduler,composition,index}.ts` read in full — no import from `./security`, `./entitlement`, or `./telemetry`.
- `apps/runtime/src/index.ts` (5 lines) read in full — the subtrees are not re-exported.
- `git grep -n "SECURITY_ZERO_TRUST_ENFORCEMENT\|SECURITY_PRINCIPAL_PROVISIONING"` → `config.ts` and its own test only.
- `apps/runtime/src/security/wire-security-runtime.ts` read in full (101 lines).
- `services/security/src/composition.ts:271-313` read — confirms the Prisma branch **is** taken via the `wireAdmin` path.
- `git ls-files apps/runtime` → 70 files, 45 under `src/security/`, 9 under `src/entitlement/`.
- No code was modified.

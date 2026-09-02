# HIGH-04 — Security Bootstrap / Entitlement Wiring

**Source finding:** `H2-3` in `FINAL_PRODUCTION_READINESS_AUDIT_v2.md` (provisioning-fleet half) — _"The
entire zero-trust runtime, security provisioning and entitlement layer has zero production callers."_
**Type:** Remediation. Code changed. **Public contract impact: none** (new file + additive call sites).

---

## 1. Investigate

Repository-wide search (excluding tests and each symbol's own subtree), current `HEAD`:

| Symbol                              | Location                                                              | Non-test callers              |
| ----------------------------------- | --------------------------------------------------------------------- | ----------------------------- |
| `bootstrapSecurity`                 | `apps/runtime/src/security/bootstrap-security.ts:46`                  | **0**                         |
| `ProvisionPrincipalOnUserCreated`   | `apps/runtime/src/security/security-provisioning.consumers.ts:56`     | **0**                         |
| `DisablePrincipalOnUserDeactivated` | `apps/runtime/src/security/security-provisioning.consumers.ts:76`     | **0**                         |
| `AssignRoleOnMembershipCreated`     | `apps/runtime/src/security/security-provisioning.consumers.ts:92`     | **0**                         |
| `SECURITY_PRINCIPAL_PROVISIONING`   | `apps/runtime/src/config.ts:122`                                      | **0** (validated, never read) |
| `wireEntitlement`                   | `apps/runtime/src/entitlement/wire-entitlement.ts:47`                 | **0** (barrel re-export only) |
| `EntitlementCacheInvalidator`       | `apps/runtime/src/entitlement/entitlement-invalidation.consumer.ts:9` | **0** (test only)             |

`apps/runtime/src/security/consumer-runtime.ts:14-17` already documents the intent: _"the H-2 identity
consumer fleet and the P2.0.2 principal-provisioning fleet share exactly one construction."_ The H-2 half
(`wire-security-identity.ts`) is built on this shared helper; the provisioning half was never assembled
into a call site.

## 2. Prove

`apps/runtime/src/security/wire-security-provisioning.test.ts` (new): asserts `wireSecurityProvisioning`
returns `null` and never calls `bootstrapSecurity` when `SECURITY_PRINCIPAL_PROVISIONING` is off
(default — every current deployment); and, with the flag on, provisions the baseline model exactly once
and returns exactly 3 built-not-started consumers. `bootstrapSecurity` is mocked (not the surrounding
composition) because it is the one call that performs real Prisma writes — the composition graph itself
is lazy, the same convention `composition.test.ts` proves throughout.

## 3. Implement — security provisioning (closed)

New `apps/runtime/src/security/wire-security-provisioning.ts`: `wireSecurityProvisioning(core, metrics?)`
— config-gated on `SECURITY_PRINCIPAL_PROVISIONING` (returns `null` when off), it calls the existing
`bootstrapSecurity` (idempotent — seeds baseline roles/policy/tenant profile) via `wireSecurityRuntime(core)`
and registers the three provisioning `EventHandler`s through the already-built `buildProcessedConsumer`
helper (tx-scoped inbox idempotency, retry topics, DLQ — ADR-0005), exactly the reliability envelope
`wire-security-identity.ts` already uses. No new use-cases, no new adapters, no new event runtime.

`apps/runtime/src/worker.ts`: calls `wireSecurityProvisioning(runtime, runtime.metrics)` and registers
any returned consumers with the supervisor, following the identical `if (x !== null) supervisor.register`
pattern already used for `buildTrackingIngestRuntime`.

This populates the Security principal/role-assignment store from already-published `identity.*` events.
It does **not** mount any HTTP enforcement — `AdminGuard` + Keto remains the authorization point (see
`HIGH_01_REPORT.md`). Populating the store first is the correct order: mounting enforcement before the
store is populated would deny 100% of traffic, which is why `config.ts`'s existing cross-field rule
already requires `SECURITY_PRINCIPAL_PROVISIONING=on` before `SECURITY_ZERO_TRUST_ENFORCEMENT=on`.

## 4. Entitlement — investigated, deliberately NOT wired (documented gap, not a new lie)

`wireEntitlement` requires a `LicensingDecider` implementing `checkEntitlement(...)`. Reading the
existing `entitlement-wiring.test.ts` (lines 39-53) surfaces a prior, already-documented finding: the
real, gate-verified `LicensingController` (`G5_MILESTONE_REPORT.md` / `SPRINT_5_5_SAAS_FOUNDATION_
REPORT.md`) exposes `createPlan`/`publishPlanVersion`/`createSubscription`/`activateSubscription` —
**no `checkEntitlement` PDP endpoint exists on the committed Licensing service.** Every existing use of
`wireEntitlement`, including its own test suite, passes either a structural fake or an in-memory decider.

There is therefore no real production adapter to wire `wireEntitlement` against. Building one would mean
adding a new method to Licensing's public controller — a public API change and speculative new surface,
both forbidden by this sprint's rules, and the same class of gap this sprint has deliberately left
guardrailed rather than built elsewhere (C2-2's PSP adapter, C2-4's MFA provider). Wiring `wireEntitlement`
with any adapter available today would either (a) use the structural fake, manufacturing exactly the
false assurance `HIGH_01` exists to prevent, or (b) require new Licensing surface, which is out of scope.

**This is left as a disclosed gap, not silently dropped:** unlike the two config flags `HIGH_01` had to
guardrail, nothing in the shipped configuration claims entitlement enforcement is active — there is no
misleading flag to fix. It is in the same category as `M2-2`/`M2-3` (disclosed, accepted stub adapters)
in `FINAL_PRODUCTION_READINESS_AUDIT_v2.md`. Wiring it for real is future work gated on Licensing gaining
a real `checkEntitlement` PDP — a separate, larger piece of engineering, not a wiring gap.

## 5. Run

| Gate             | Result                                                             |
| ---------------- | ------------------------------------------------------------------ |
| `pnpm typecheck` | ✅ 76/76                                                           |
| `pnpm lint`      | ✅ 76/76                                                           |
| `pnpm test`      | ✅ 76/76 tasks; `@platform/runtime` 30 files / 132 tests (was 130) |
| `pnpm arch`      | ✅ no dependency violations (1,531 modules, 6,672 deps)            |

## 6. Scope discipline

No architecture change, no new bounded context, no public API change. One new file
(`wire-security-provisioning.ts`), following the exact composition shape already established by
`wire-security-identity.ts` and `consumer-runtime.ts` — no new patterns introduced. `SECURITY_PRINCIPAL_
PROVISIONING` still defaults `off`; no current deployment is affected.

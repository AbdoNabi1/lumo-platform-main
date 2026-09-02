# Sprint 0.7 — Authentication Foundation & Cross-Cutting Seams — Implementation Report

> **Date:** 2026-06-30 · **Status:** ✅ COMPLETE (all validation green) · **Phase 0 — Foundations.**

## 1. Summary

Added the **minimum auth/authz/flags seams** Phase 1 will consume — as **ports**, provider-agnostic,
with no new "security" package and no audit subsystem (per the approved scope reduction). Two new
authentication/authorization ports were added to the existing `@platform/contracts`; two error
types were added to `@platform/utils`; and a deliberately minimal `@platform/feature-flags` package
was created. No DI tokens, no Identity bounded context, no consent VOs — all deferred.

## 2. Scope reductions applied (as approved)

- **No `@platform/security`.** Authentication + authorization are **ports only**, added additively
  to `@platform/contracts` (the generic cross-platform-contract home) — no new package.
- **No audit subsystem** (deferred until a real producer exists).
- **`@platform/feature-flags`** provides only `FeatureFlags`, `EvaluationContext`, and
  `InMemoryFeatureFlags`. **No** rollout engine, percentage hashing, multivariate evaluation, or
  targeting (those belong to the future Experimentation implementation).
- Dropped as speculative (no immediate Phase-1 consumer): `Credential` type (use a token string),
  `ResourceRef`/resource-level authz, `Principal.scopes`, audit, RBAC/Ory adapters.
- `AuthenticationError` + `AuthorizationError` kept in `@platform/utils` (D-005).

## 3. Components implemented

- **`@platform/contracts` (ports, additive):**
  - `Principal` (`id`, `kind: customer | staff | service`, `roles`) + `PrincipalKind` — the
    customer/staff identity seam.
  - `Authenticator` — `verify(token): Promise<Principal | null>` (Ory adapter later; interfaces-layer
    consumer).
  - `Permission` (`"<module>:<action>"`) + `AccessControl` — `authorize(principal, permission):
Promise<boolean>` (RBAC for Phase 1; ReBAC/resource-level later).
- **`@platform/utils` (additive):** `AuthenticationError` (`UNAUTHENTICATED`, 401) and
  `AuthorizationError` (`FORBIDDEN`, 403), both `DomainError`s flowing through the existing error
  envelope.
- **`@platform/feature-flags` (new):** `FeatureFlags` port, `EvaluationContext` (`{ subjectId }`),
  `InMemoryFeatureFlags` (static key→enabled map; unknown ⇒ disabled = kill-switch safe; context
  ignored).

Every interface has an immediate Phase-1 (1.x) consumer: `Principal`/`Authenticator` at the
interfaces boundary; `AccessControl`/`Permission` for staff actions (e.g. `orders:refund`); the
errors at those boundaries; flags for gated features (DoD: behind a flag with a kill switch).

## 4. Files created

- `@platform/contracts`: `src/principal.ts`, `src/authenticator.ts`, `src/permission.ts`,
  `src/access-control.ts`.
- `@platform/feature-flags` (9): `package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`,
  `src/{evaluation-context.ts, feature-flags.ts, in-memory-feature-flags.ts, index.ts,
in-memory-feature-flags.test.ts}`.

## 5. Files modified

- `@platform/contracts`: `src/index.ts` (export the 4 new ports), `README.md`.
- `@platform/utils`: `src/domain-errors.ts` (+2 error classes), `src/domain-errors.test.ts` (+tests).
- `pnpm-lock.yaml` (workspace link). No other existing source touched; `@platform/application`
  untouched (no DI tokens this sprint — consumers inject by constructor at their composition root).

## 6. Dependency direction (verified)

`@platform/contracts` and `@platform/feature-flags` remain dependency-graph leaves (no runtime
deps). Auth/authz ports return `Principal | null` / `boolean`, so contracts stays free of `Result`
and error imports. Nothing inner depends on these; application/interfaces consume the ports;
infrastructure implements them later — `domain ← application ← messaging ← infrastructure`
preserved.

## 7. Validation results

| Gate             | Result                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`      | ✅ PASS                                                                                                                       |
| `pnpm typecheck` | ✅ PASS                                                                                                                       |
| `pnpm test`      | ✅ PASS (serialized) — `@platform/utils` 5, `@platform/feature-flags` 3; `@platform/contracts` has no tests (pure interfaces) |
| `pnpm build`     | ✅ PASS                                                                                                                       |

**Note (environmental, not Sprint 0.7):** under turbo's parallel test execution this Windows host
intermittently crashes one unrelated package's vitest worker (`-1073740791` / a transient exit 1 —
seen on `health`, `secrets`, `config` on different runs; all pass in isolation and on retry). The
**serialized** run (`turbo run test --concurrency=1`) is **23/23 green**. The changed packages pass
cleanly in isolation. Worth addressing later by capping test concurrency in CI.

## 8. Deferred (explicitly NOT in 0.7)

Audit subsystem; Ory/Hydra/Kratos & Keto/OpenFGA adapters; MFA/step-up; RBAC implementation;
rollout/percentage/multivariate/targeting flag evaluation + the Experimentation-backed source; DI
tokens; the Identity bounded context (Customer/Staff aggregates); consent VOs; households; child
profiles; multi-tenancy; billing; plugins; workflow; AI; marketing; notifications; SaaS.

## 9. Remaining work

None for Sprint 0.7. Next (per the roadmap): **0.8 — dependency-cruiser fitness functions +
generators + walking skeleton**, then Phase 1 contexts (1.1–1.6).

**Sprint 0.7 is complete. Stopping — not continuing to Sprint 0.8.**

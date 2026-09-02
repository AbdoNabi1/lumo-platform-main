# Phase S1.5.2 — Security Admin Wiring (Sessions & Authentication) — Report

**Status:** Complete. Second of six Security sub-milestones. Reuses the single `wireSecurity()`
composition call established in S1.5.1 — no second composition-root call.

**Trigger:** continuation of S1.5 — the Sessions & Authentication slice of `SecurityController`
had zero admin-app exposure.

---

## 1. Scope

**In scope:** session lifecycle (`establishSession`, `refreshSession`, `revokeSession`,
`introspectSession`, `revokeAllSessions`), authentication (`registerAuthMethod`, `authenticate`),
device trust (`registerDevice`, `recordDeviceSignal`, `trustDevice`, `blockDevice`), MFA
(`enrollMfa`, `verifyMfaEnrollment`, `generateBackupCodes`, `revokeMfa`, `decideMfa`,
`registerMfaMethod`), and risk (`evaluateRisk`) — 18 commands + 3 console read models
(`sessionExplorer`, `deviceExplorer`, `riskExplorer`) = 21 of `SecurityController`'s ~80 methods.

**Explicitly not touched:** `services/security/**`, any other context's wiring, `apps/runtime`,
any public contract/event shape, no auth/MFA redesign.

---

## 2. Files changed, and why

| File                                                                    | Change                                                                                                                                                                                                                                                                                                                                                                 | Why                                                                                            |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `apps/admin/src/interfaces/security-sessions.admin-controller.ts` (new) | `SecuritySessionsAdminController` — wraps 18 command methods (guarded, pure delegation) + 3 read-model methods (guarded, manually wrapped in `{ status: 200, body }`, same pattern established in S1.5.1)                                                                                                                                                              | Same delegation shape as `SecurityIdentityAdminController`                                     |
| `apps/admin/src/http/security-sessions-routes.ts` (new)                 | `securitySessionsRoutes(admin)` — 21 routes                                                                                                                                                                                                                                                                                                                            | Same shape as `security-identity-routes.ts`                                                    |
| `apps/admin/src/composition.ts`                                         | Added `securitySessions` field on `WiredAdmin` + controller construction, referencing the **same** `security` variable `wireSecurity()`'d in S1.5.1 — no new composition call, no new drain-array entry                                                                                                                                                                | One `wireSecurity()` call serves all six S1.5 sub-milestones, as documented in S1.5.1's report |
| `apps/admin/src/http/admin-routes.ts`                                   | Added import + spread                                                                                                                                                                                                                                                                                                                                                  | Exposes the new routes                                                                         |
| `apps/admin/src/admin.e2e.test.ts`                                      | Added one regression test: register principal → register auth method + MFA method → enroll MFA → verify (fixed test code `123456` from `InMemoryTotpMfaProvider`) → generate backup codes → register/signal/trust a device → decide MFA → evaluate risk → establish/refresh/introspect/revoke session → revoke-all → revoke MFA → block device → all three read models | Closes coverage gap; isolated `it()` block                                                     |

No `package.json`/`pnpm-lock.yaml` change needed — `@platform/security` was already added in
S1.5.1. No changes to `services/security/**`, any other service, any event contract, or any public
API shape outside `apps/admin`.

---

## 3. Quality gates

| Gate        | Scope         | Result                                                    |
| ----------- | ------------- | --------------------------------------------------------- |
| `typecheck` | full monorepo | 76/76, 0 errors                                           |
| `lint`      | full monorepo | 76/76, 0 errors                                           |
| `test`      | full monorepo | 76/76 green, `@platform/admin` 26/26 (was 25/25; +1 new)  |
| `arch`      | full          | 0 violations, 1531 modules, 6522 dependencies — unchanged |

---

## 4. Pattern deviation

**None beyond the read-model wrapping already established in S1.5.1.** One test-writing fix
needed: three `present()`-wrapped command methods return `201` (`registerAuthMethod`,
`registerMfaMethod`, `enrollMfa` — all "creates a versioned/new entity" actions), not `200` as
first assumed by analogy with the mostly-`200` shape of S1.5.1's methods; corrected after the test
suite caught the mismatch, no wiring code affected. Also verified before writing the test:
`InMemoryTotpMfaProvider`'s fixed verification code is `"123456"` (deterministic, offline-safe),
and `authenticate()`/full login was deliberately **not** exercised in the regression test since it
requires seeding `InMemoryPasswordAuthProvider`'s account map, a capability exposed only on the raw
`WiredSecurity.passwordProvider` object, not on the admin composition surface — exercising it would
require either extending `AdminWiringDeps` (out of this sub-milestone's "wire only" scope) or
reaching into internals, so `registerAuthMethod` is exercised but `authenticate` itself is left to
its own domain/service-level test coverage (already existing).

---

## 5. Remaining blockers / next steps

Next: **S1.5.3 — Authorization** (roles, permissions, policies, authorization explorers). Then
S1.5.4 Secrets, S1.5.5 Security Operations, S1.5.6 AI Governance.

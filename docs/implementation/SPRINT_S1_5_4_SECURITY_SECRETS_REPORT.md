# Phase S1.5.4 — Security Admin Wiring (Secrets) — Report

**Status:** Complete. Fourth of six Security sub-milestones — the smallest. Reuses the single
`wireSecurity()` composition call established in S1.5.1.

**Trigger:** continuation of S1.5 — the Secrets slice of `SecurityController` (credential
rotation scheduling, scheduler-driven due-rotation, emergency revoke, rotation lineage) had zero
admin-app exposure.

---

## 1. Scope

**In scope:** `scheduleCredentialRotation`, `rotateDueCredentials`, `emergencyRevokeCredentials`,
`getCredentialLineage` — 4 commands + 1 console read model (`secretExplorer`) = 5 of
`SecurityController`'s ~80 methods.

**Explicitly not touched:** `services/security/**`, any other context's wiring, `apps/runtime`,
any public contract/event shape.

---

## 2. Files changed, and why

| File                                                                   | Change                                                                                                                                                                                                                                                                                                  | Why                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `apps/admin/src/interfaces/security-secrets.admin-controller.ts` (new) | `SecuritySecretsAdminController` — wraps 4 command methods + 1 read-model method (same wrapping pattern from S1.5.1)                                                                                                                                                                                    | Same delegation shape as prior S1.5 controllers  |
| `apps/admin/src/http/security-secrets-routes.ts` (new)                 | `securitySecretsRoutes(admin)` — 5 routes                                                                                                                                                                                                                                                               | Same shape as prior S1.5 route files             |
| `apps/admin/src/composition.ts`                                        | Added `securitySecrets` field + controller construction, referencing the shared `security` variable — no new `wireSecurity()` call, no new drain-array entry                                                                                                                                            | Same shared-composition pattern as S1.5.1–S1.5.3 |
| `apps/admin/src/http/admin-routes.ts`                                  | Added import + spread                                                                                                                                                                                                                                                                                   | Exposes the new routes                           |
| `apps/admin/src/admin.e2e.test.ts`                                     | Added one regression test: register principal → issue credential → schedule rotation (asserts `rotationDueAt` set) → run due-rotation (asserts `rotated: 0`, since a 90-day interval isn't due yet) → get lineage (asserts a 1-entry chain) → emergency-revoke (asserts `revoked: 1`) → secret explorer | Closes coverage gap; isolated `it()` block       |

No `package.json`/`pnpm-lock.yaml` change needed. No changes to `services/security/**`, any other
service, any event contract, or any public API shape outside `apps/admin`.

---

## 3. Quality gates

| Gate        | Scope         | Result                                                    |
| ----------- | ------------- | --------------------------------------------------------- |
| `typecheck` | full monorepo | 76/76, 0 errors                                           |
| `lint`      | full monorepo | 76/76, 0 errors                                           |
| `test`      | full monorepo | 76/76 green, `@platform/admin` 28/28 (was 27/27; +1 new)  |
| `arch`      | full          | 0 violations, 1531 modules, 6522 dependencies — unchanged |

---

## 4. Pattern deviation

**None.** All four command inputs are flat, fully-known shapes (no recursive/open-ended types like
S1.5.3's policy expressions) — clean on the first typecheck and test pass. Verified before writing
the test that `RotateDueCredentials` filters by `rotationDueAt <= now`, so a freshly-scheduled
90-day rotation is correctly asserted as `rotated: 0` rather than assuming it would fire.

---

## 5. Remaining blockers / next steps

Next: **S1.5.5 — Security Operations** (incidents, threat intelligence, compliance, audit-chain
verification, and their read models). Then S1.5.6 AI Governance (last sub-milestone).

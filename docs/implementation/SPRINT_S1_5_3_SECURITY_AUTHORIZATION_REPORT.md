# Phase S1.5.3 — Security Admin Wiring (Authorization) — Report

**Status:** Complete. Third of six Security sub-milestones. Reuses the single `wireSecurity()`
composition call established in S1.5.1.

**Trigger:** continuation of S1.5 — the Authorization slice of `SecurityController` (roles,
policies, ReBAC, unified access checks, delegation, consent read, tenant security profile) had
zero admin-app exposure.

---

## 1. Scope

**In scope:** roles (`defineRole`, `grantRolePermission`, `assignRole`,
`revokeRoleAssignment`), policy (`definePolicy`, `publishPolicyVersion`, `archivePolicy`,
`simulatePolicy`), ReBAC + unified access (`writeRelationTuple`, `deleteRelationTuple`,
`checkAccess`), zero-trust decision (`evaluateAccess`), registry (`registerPolicyFragment`,
`registerPermission`), delegation (`grantDelegation`, `revokeDelegation`, `startImpersonation`),
consent read (`checkConsent`), and tenant security config (`configureTenantSecurity`) — 19
commands + 3 console read models (`permissionExplorer`, `policyExplorer`, `registryExplorer`) =
22 of `SecurityController`'s ~80 methods.

**Explicitly not touched:** `services/security/**`, any other context's wiring, `apps/runtime`,
any public contract/event shape, no authorization-model redesign.

---

## 2. Files changed, and why

| File                                                                         | Change                                                                                                                                                                                                                                                                                                              | Why                                                                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `apps/admin/src/interfaces/security-authorization.admin-controller.ts` (new) | `SecurityAuthorizationAdminController` — wraps 19 command methods + 3 read-model methods (same wrapping pattern from S1.5.1)                                                                                                                                                                                        | Same delegation shape as prior S1.5 controllers                                         |
| `apps/admin/src/http/security-authorization-routes.ts` (new)                 | `securityAuthorizationRoutes(admin)` — 22 routes                                                                                                                                                                                                                                                                    | Same shape as prior S1.5 route files; see §4 for three real type-level fixes found here |
| `apps/admin/src/composition.ts`                                              | Added `securityAuthorization` field + controller construction, referencing the shared `security` variable — no new `wireSecurity()` call, no new drain-array entry                                                                                                                                                  | Same shared-composition pattern as S1.5.1/S1.5.2                                        |
| `apps/admin/src/http/admin-routes.ts`                                        | Added import + spread                                                                                                                                                                                                                                                                                               | Exposes the new routes                                                                  |
| `apps/admin/src/admin.e2e.test.ts`                                           | Added one regression test spanning role define/grant/assign/revoke, policy define/publish/simulate/archive, ReBAC write/check/delete, zero-trust `evaluateAccess`, policy-fragment + permission registration, delegation grant/impersonate/revoke, consent check, tenant security config, and all three read models | Closes coverage gap; isolated `it()` block                                              |

No `package.json`/`pnpm-lock.yaml` change needed. No changes to `services/security/**`, any other
service, any event contract, or any public API shape outside `apps/admin`.

---

## 3. Quality gates

| Gate        | Scope         | Result                                                       |
| ----------- | ------------- | ------------------------------------------------------------ |
| `typecheck` | full monorepo | 76/76, 0 errors (three fixes required mid-milestone, see §4) |
| `lint`      | full monorepo | 76/76, 0 errors                                              |
| `test`      | full monorepo | 76/76 green, `@platform/admin` 27/27 (was 26/26; +1 new)     |
| `arch`      | full          | 0 violations, 1531 modules, 6522 dependencies — unchanged    |

---

## 4. Pattern deviations — three real type-level fixes, all resolved before commit

This is the first S1.5 sub-milestone touching Security's genuinely recursive/open-ended domain
types (`PolicyCondition`/`PolicyExpression`/`AbacCondition`), and it surfaced real issues:

**1. Wrong assumed enum values, caught by `tsc`.** Guessed `PolicyEffect` as
`"allow" | "deny" | "challenge"` by analogy with other lifecycle enums; the actual domain type
(`services/security/src/domain/policy.ts`) is `"allow" | "challenge" | "block" | "review"` — no
`"deny"` member, two extra members. Fixed the zod enum to match exactly, verified against the
domain source rather than guessed a second time.

**2. `PolicyExpression`'s real shape, caught by `tsc` in the regression test.** Initially guessed
a `{ type: "leaf", condition: {...} }` shape for `registerPolicyFragment`'s `expression` field;
the actual type (`services/security/src/domain/policy-expression.ts`) is a discriminated union of
bare-keyed variants — `{ leaf: PolicyCondition } | { allOf: [...] } | { anyOf: [...] } | { not: ... } | { fragment: string }`
— no `type` discriminant field at all. Since the admin controller method is called directly in the
regression test (bypassing the route's zod-cast escape hatch), this was caught by `tsc` against the
real exported type, not silently accepted. Fixed the test to `{ leaf: {} }`.

**3. A recurrence of the M7/M10 "spread doesn't narrow a conditionally-added property" trap, in a
new form.** For `checkAccess`'s optional `abac?: AbacCondition` field (typed `z.unknown()` in the
zod schema, matching the recursive `AbacCondition` type this milestone doesn't attempt to model
exactly), the M7-style fix (`{ ...body, ...(body.abac !== undefined ? { abac: body.abac as AbacCondition } : {}) }`)
was **not sufficient** here: spreading `...body` first still contributes `abac?: unknown` to the
literal's _static_ type, and TypeScript computes the merged spread type as a union that still
includes `unknown`, so the later conditional spread doesn't fully narrow it away — `tsc` still
rejected the assignment. Fixed by destructuring `abac` out of `body` first (`const { abac, ...rest } = body`)
so `rest`'s type never contains the `abac` key at all, then conditionally re-adding the cast value.
This is a stronger version of the M7 fix and is the pattern to reuse for any future optional
`unknown`-typed field in this batch.

**Composition-shape note (informational, no code impact):** `RiskSignals`/`TrustSignals`
(`evaluateAccess`'s `risk`/`trust` inputs) are small, fully-known interfaces (not open-ended), so
they were given precise zod schemas rather than `z.unknown()` — `z.record(z.unknown())` would not
have been assignable to either type (both have specific optional fields, not an index signature),
another case where a generic "accept anything" schema would have failed typecheck rather than
silently under-validating.

---

## 5. Remaining blockers / next steps

Next: **S1.5.4 — Secrets** (credential rotation scheduling/emergency-revoke/lineage, secret
explorer). Then S1.5.5 Security Operations, S1.5.6 AI Governance.

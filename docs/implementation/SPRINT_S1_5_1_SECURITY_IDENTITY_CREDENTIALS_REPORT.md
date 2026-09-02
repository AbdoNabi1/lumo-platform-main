# Phase S1.5.1 — Security Admin Wiring (Identity & Credentials) — Report

**Status:** Complete. First of six Security sub-milestones (S1.5.1–S1.5.6), scoped separately from
the S1 business batch per your explicit decision — Security's ~80-method controller is too large
and too sensitive to wire in one pass. This sub-milestone establishes the shared `wireSecurity()`
composition wiring (used by all six sub-milestones) and wires the Identity & Credentials slice.

**Trigger:** repository audit found the Security bounded context (`@platform/security`, committed,
working `wireSecurity()` + `SecurityController`) had zero admin-app exposure.

---

## 1. Scope

**In scope, this sub-milestone only:** principal registration/lifecycle (`registerPrincipal`,
`transitionPrincipal`), credential issue/rotate/revoke (`issueCredential`, `rotateCredential`,
`revokeCredential`), machine-identity governance (`governMachineIdentity`,
`suspendMachineIdentity`), live identity resolution (`resolvePrincipal`, `resolveMembership`,
`resolveOrganization`, `resolveMachineIdentity`), and two console read models
(`identityOverview`, `machineIdentityExplorer`) — 11 commands + 2 read models, 13 of
`SecurityController`'s ~80 methods.

**Also in scope (shared, one-time):** the `wireSecurity()` composition call itself, added to
`apps/admin/src/composition.ts` — this single call underlies all six S1.5 sub-milestones; later
sub-milestones only add their own `Security*AdminController` construction referencing the same
already-wired `security` variable, not a second `wireSecurity()` call.

**Explicitly not touched:** `services/security/**` (already correctly exports `wireSecurity`/
`SecurityController` from its own `index.ts` — no export gap like Analytics, M10), any other
context's wiring, `apps/runtime`, any public contract/event shape, any authentication/authorization
redesign, any new security feature.

---

## 2. Files changed, and why

| File                                                                    | Change                                                                                                                                                                                                                                                                                                           | Why                                                                                                               |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apps/admin/src/interfaces/security-identity.admin-controller.ts` (new) | `SecurityIdentityAdminController` — wraps 11 `SecurityController` command methods (guarded, pure delegation) + 2 read-model methods (guarded, manually wrapped in `{ status: 200, body }` since the upstream read-model methods return the raw type directly, not a pre-shaped `ControllerResponse`)             | Same delegation shape as `CouponsAdminController`, adapted for read-model methods that aren't `present()`-wrapped |
| `apps/admin/src/http/security-identity-routes.ts` (new)                 | `securityIdentityRoutes(admin)` — 13 routes                                                                                                                                                                                                                                                                      | Same shape as `coupons-routes.ts`                                                                                 |
| `apps/admin/src/composition.ts`                                         | Added `wireSecurity` import, **one** `wireSecurity(deps)` call, `securityIdentity` field on `WiredAdmin`, drain-array entry (`WiredSecurity` has `drainOutbox`/`deliveredEventTypes`, unlike Analytics/PlatformConsole), controller construction                                                                 | Establishes the shared composition root for all six S1.5 sub-milestones                                           |
| `apps/admin/src/http/admin-routes.ts`                                   | Added import + spread                                                                                                                                                                                                                                                                                            | Exposes the new routes                                                                                            |
| `apps/admin/package.json`                                               | Added `@platform/security: workspace:*`                                                                                                                                                                                                                                                                          | Was missing                                                                                                       |
| `pnpm-lock.yaml`                                                        | Updated via `pnpm install`                                                                                                                                                                                                                                                                                       | Mechanical                                                                                                        |
| `apps/admin/src/admin.e2e.test.ts`                                      | Added one regression test: register a `service_account` principal (non-human, so no `IdentityDirectoryPort` seeding needed) → issue credential → rotate → revoke the rotated credential → govern machine identity → resolve it (asserts `owner`) → suspend it → suspend the principal → both console read models | Closes coverage gap; isolated `it()` block                                                                        |

No changes to `services/security/**`, any other service, any event contract, or any public API
shape outside `apps/admin`.

---

## 3. Quality gates

| Gate        | Scope         | Result                                                                                                                                                                                     |
| ----------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `typecheck` | full monorepo | 76/76, 0 errors                                                                                                                                                                            |
| `lint`      | full monorepo | 76/76, 0 errors                                                                                                                                                                            |
| `test`      | full monorepo | 76/76 green, `@platform/admin` 25/25 (was 24/24; +1 new)                                                                                                                                   |
| `arch`      | full          | 0 violations, 1531 modules, 6522 dependencies — unchanged (arch only scans `packages`/`services`, not `apps`, so the new admin→security edge isn't counted, same as every prior milestone) |

---

## 4. Pattern deviation

**One structural note, not a deviation requiring a stop:** `SecurityController`'s console
read-model methods (`identityOverview`, `machineIdentityExplorer`, and 13 more across later
sub-milestones) return their read-model type directly (e.g. `Promise<IdentityOverview>`), not a
`present()`-wrapped `ControllerResponse` the way every command method and every other context's
controller does. The admin wrapper manually constructs `{ status: 200, body: ... }` after the
guard check for these — still pure delegation, no business logic, just a different return shape
to normalize into `AdminResponse`. This is a one-time pattern note that applies to all six S1.5
sub-milestones, not something specific to this one.

**Verified before writing the regression test:** `Principal.register()` only requires an
`IdentityDirectoryPort` lookup for **human** principals (`isHumanKind`); non-human kinds
(`service_account`, `machine`, `api_key`, `robot`, `partner`, `marketplace`, `ai`) are "owned
outright" with no external check — so the test uses `kind: "service_account"` to avoid needing to
seed `SecurityWiringDeps.knownSubjects`. Also verified `Credential.revoke()` is a no-op-safe,
not-only-`active` operation (only `expired` credentials reject revocation; `rotated` credentials
can still be revoked) before revoking the post-rotation credential in the test.

---

## 5. Remaining blockers / next steps

Next: **S1.5.2 — Sessions & Authentication** (sessions, MFA, devices, risk, authentication flows).
Then S1.5.3 Authorization, S1.5.4 Secrets, S1.5.5 Security Operations, S1.5.6 AI Governance, in
that order — each its own isolated commit/report/gate run, all sharing this sub-milestone's
`wireSecurity()` call.

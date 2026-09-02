# Phase S1.5.5 — Security Admin Wiring (Security Operations) — Report

**Status:** Complete. Fifth of six Security sub-milestones. Reuses the single `wireSecurity()`
composition call established in S1.5.1.

**Trigger:** continuation of S1.5 — the Security Operations slice of `SecurityController`
(incident response, threat intelligence, compliance, audit-chain verification) had zero admin-app
exposure.

---

## 1. Scope

**In scope:** incident lifecycle (`openIncident`, `triageIncident`, `mitigateIncident`,
`resolveIncident`, `closeIncident`, `addIncidentEvidence`), threat intelligence
(`checkThreatIndicator`), audit-chain verification (`verifyAuditChain`), and compliance
(`evaluateCompliance`, `registerComplianceRule`) — 10 commands + 5 console read models
(`incidentExplorer`, `auditExplorer`, `securityDashboard`, `trustCenter`, `securityAnalytics`) =
15 of `SecurityController`'s ~80 methods.

**Explicitly not touched:** `services/security/**`, any other context's wiring, `apps/runtime`,
any public contract/event shape.

---

## 2. Files changed, and why

| File                                                                      | Change                                                                                                                                                                                                                                                                                                                                                          | Why                                              |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `apps/admin/src/interfaces/security-operations.admin-controller.ts` (new) | `SecurityOperationsAdminController` — wraps 10 command methods + 5 read-model methods (three of the read models — `auditExplorer`/`securityDashboard`/`trustCenter` — take an optional `tenantRef` parameter directly rather than an input object, matching `SecurityController`'s own signature; wrapped consistently with S1.5.1's pattern)                   | Same delegation shape as prior S1.5 controllers  |
| `apps/admin/src/http/security-operations-routes.ts` (new)                 | `securityOperationsRoutes(admin)` — 15 routes                                                                                                                                                                                                                                                                                                                   | Same shape as prior S1.5 route files             |
| `apps/admin/src/composition.ts`                                           | Added `securityOperations` field + controller construction, referencing the shared `security` variable — no new `wireSecurity()` call, no new drain-array entry                                                                                                                                                                                                 | Same shared-composition pattern as S1.5.1–S1.5.4 |
| `apps/admin/src/http/admin-routes.ts`                                     | Added import + spread                                                                                                                                                                                                                                                                                                                                           | Exposes the new routes                           |
| `apps/admin/src/admin.e2e.test.ts`                                        | Added one regression test: full incident lifecycle (open → triage → mitigate → add evidence → resolve → close, asserting status/evidence count at each step) → threat-indicator check → audit-chain verify (asserts `valid: true`) → compliance evaluation against the pre-registered `soc2` rule pack → compliance-control registration → all five read models | Closes coverage gap; isolated `it()` block       |

No `package.json`/`pnpm-lock.yaml` change needed. No changes to `services/security/**`, any other
service, any event contract, or any public API shape outside `apps/admin`.

---

## 3. Quality gates

| Gate        | Scope         | Result                                                    |
| ----------- | ------------- | --------------------------------------------------------- |
| `typecheck` | full monorepo | 76/76, 0 errors                                           |
| `lint`      | full monorepo | 76/76, 0 errors                                           |
| `test`      | full monorepo | 76/76 green, `@platform/admin` 29/29 (was 28/28; +1 new)  |
| `arch`      | full          | 0 violations, 1531 modules, 6522 dependencies — unchanged |

---

## 4. Pattern deviation

**None requiring a fix.** One structural difference from S1.5.1–S1.5.4's read models, handled
consistently rather than deviating from it: `auditExplorer`/`securityDashboard`/`trustCenter`
accept an optional `tenantRef: string | null = null` positional parameter on `SecurityController`
itself (not wrapped in an input object like every command method), so the admin wrapper mirrors
that exact signature (`(principal, tenantRef?)`) rather than forcing it into an object-input shape
that doesn't exist upstream.

Verified before writing the test: `DefaultComplianceRulePackResolver`
(`services/security/src/infrastructure/compliance-packs.ts`) pre-registers rule packs for
`soc2`/`gdpr`/`iso27001`/`hipaa`/`pci_dss` by default, so `evaluateCompliance({ framework: "soc2" })`
works without first calling `registerComplianceRule` (a different concept — that registers
individual controls into the versioned catalog, not rule packs). Also verified
`Incident.addEvidence()` only rejects on `status === "closed"`, so evidence is added mid-lifecycle
(after mitigate, before resolve/close) in the test.

---

## 5. Remaining blockers / next steps

Next: **S1.5.6 — AI Governance** (the last S1.5 sub-milestone: `governAiIdentity`,
`suspendAiIdentity`, `checkAiAction`, `aiGovernanceExplorer`). Completes the full Security
admin-wiring batch.

# ADR-0009: Immutable audit trail behind a platform port; guards are policy-enforcement points

- **Status:** Accepted
- **Date:** 2026-07-04
- **Deciders:** Staff architecture (future-proofing review)
- **Affected documents:** 07, 14 §6, 20 §14

## Context

Audit logging is a compliance blocker (SOC2 CC7, ISO 27001 A.12.4, PCI DSS 10.x) and was pure
plan: doc 20 defines `audit.entry.recorded` and `identity.permission.decision.v1`, but no port,
no writer, no consumer existed. Bolting audit on later tends to produce transport-level access
logs — not the tamper-evident, decision-level trail auditors require. Separately, ADR-0007's
`ensureAuthorized` helper was a free function; combining authorization and audit in one seam is
the standard policy-enforcement-point (PEP) shape used by mature platforms.

## Decision

1. **`AuditTrail` is an outbound port in `@platform/contracts`** (`record(AuditEvent)`), append-only
   by contract: implementations MUST never update or delete entries. `AuditEvent` carries
   principal, permission, decision (`allow`/`deny`), timestamp (caller-supplied via `Clock`),
   optional `tenantId` (ADR-0008) and metadata.
2. **Guards are PEPs.** The admin boundary's `AdminGuard` authorizes and audits in one call;
   every admin action flows through it today (in-memory trail). A failed audit write fails the
   guarded action — an unauditable mutation is worse than a rejected one.
3. **Production shape (deferred, designed):** the adapter appends audit rows in the same
   transaction as the guarded mutation where one exists, and publishes `audit.entry.recorded`
   via the existing outbox to 7-year archival storage (doc 20 retention). Tamper evidence comes
   from append-only storage + hash chaining at the archival layer, not from the port.
4. The same PEP pattern extends to the Phase-2 transport middleware and any future context
   controller that becomes externally reachable.

## Consequences

- **Positive:** authorization decisions are evidenced from day one; the auditor-facing seam
  exists before any real traffic; RBAC provider swap (Ory/Keto) does not touch audit.
- **Negative / trade-offs:** decision-level audit only for now (action _outcome_ audit — what
  changed — arrives with transport middleware and the outbox adapter); in-memory trail is
  volatile by design.
- **Follow-ups:** outbox-backed adapter + archival retention (Phase 2); hash chaining at the
  archive; outcome audit on mutations.

## Alternatives considered

- **Audit inside each use case** — rejected: scatters a cross-cutting concern through the
  application layer and misses denied attempts entirely.
- **Transport access logs as audit** — rejected: not decision-level, not tamper-evident, absent
  until a transport exists.

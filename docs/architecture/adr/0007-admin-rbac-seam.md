# ADR-0007: Every admin action authorizes an explicit `Principal` (RBAC seam)

- **Status:** Accepted
- **Date:** 2026-07-04
- **Deciders:** Staff architecture (platform-hardening review)
- **Affected documents:** 07, admin/01

## Context

The auth **ports** (`Principal`/`AccessControl`/`Permission`, Sprint 0.7) had zero consumers:
admin facade methods took bare input and executed for an anonymous caller — including refunds,
price changes, and inventory adjustments. The real RBAC provider (Ory/Keto) is a Phase-2
concern, but retrofitting a principal parameter later would change every controller signature
and every test in one sweep, exactly when the transport sprint is busiest. Broken Object Level
Authorization is OWASP API #1; the seam must exist before any transport does.

## Decision

1. Every admin facade method takes `principal: Principal` as its first parameter and calls
   `AccessControl.authorize(principal, "<module>:<action>")` (coarse permissions per doc 07)
   before delegating. Denial returns a transport-neutral `403` with the uniform error envelope —
   the only response shape the admin layer owns; success and domain errors stay delegated to the
   owning context's presenter (D-033).
2. `wireAdmin` accepts an optional `AccessControl` and defaults to a permissive
   `AllowAllAccessControl` (app-infrastructure) until the real provider lands. Swapping in
   Ory/Keto is a composition-root change only; signatures and tests stay frozen.
3. Context-level controllers (`services/*/interfaces`) stay principal-free for now: they are
   in-process seams not yet exposed by any transport, and the admin facade is the sole
   composed surface. When the HTTP/gRPC transport lands, the same pattern extends to whichever
   controllers it exposes (tracked as a Phase-2 prerequisite).

## Consequences

- **Positive:** authorization is structurally unavoidable on the admin path; the deny path is
  tested today; RBAC arrives without signature churn.
- **Negative / trade-offs:** authorization is permissive until Phase 2 (unchanged risk profile:
  the wiring is only reachable in-process); resource-level (ReBAC/ownership) checks remain
  future per doc 07.
- **Follow-ups:** Ory/Keto adapter (Phase 2); audit log on denied/allowed mutations
  (`audit.entry.recorded`); principal threading on transport-exposed context controllers.

## Alternatives considered

- **Thread principals through all 12 context controllers now** — deferred: triples the churn for
  surfaces no transport exposes; the admin facade is the only composed boundary today.
- **Ambient principal (request context / ALS)** — rejected: implicit identity is how
  confused-deputy bugs happen; explicit parameters match D-013.

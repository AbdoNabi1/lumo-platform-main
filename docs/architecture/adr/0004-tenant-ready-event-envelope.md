# ADR-0004: Tenant-ready integration-event envelope and catalog reconciliation

- **Status:** Accepted
- **Date:** 2026-07-04
- **Deciders:** Staff architecture (platform-hardening review)
- **Affected documents:** 05, 20

## Context

The platform targets many merchants, but no aggregate, event, or key carried a tenant
discriminator, and the events catalog (doc 20 §1) mandated `tenant` and `producer` headers the
envelope did not have. Adding a field to live broker topics later is a breaking schema change
(new event version + dual-publish window); reserving it now is free. Separately, several catalog
rows use 2-segment shorthand names (`cart.abandoned.v1`) that the code's own
`EVENT_TYPE_PATTERN` (`<context>.<aggregate>.<event>`) rejects, and a handful of implemented
names diverge from their catalog rows — contract drift at 17 events, cheap to fix today and a
topic migration after broker wiring.

## Decision

1. `IntegrationEvent` gains **optional** `tenantId` and `producer` fields; `EventContext` gains
   optional `tenantId`; `OutboxWriter` is constructed with its context's `producer` name and
   stamps both onto envelopes and message headers when present.
2. The **tenancy model itself is deliberately not decided here.** Single-tenant deployments omit
   `tenantId`. If shared multi-tenancy is chosen, `tenantId` becomes mandatory at the
   transport/composition boundary (a follow-up ADR must decide tenant-per-deployment vs. shared
   schema, unique-constraint scoping, and partition-key layout — before Phase 2 freezes DB
   schemas and topics).
3. Event naming is canonically **3-segment** (`<context>.<aggregate>.<event>`, enforced by
   `topicFor`). Doc 20 gains a reconciliation section listing the implemented Phase-1 topics as
   the source of truth; divergent shorthand rows in the catalog are superseded by it.

## Consequences

- **Positive:** no schema migration when tenancy or producer tracing arrives; the catalog and
  the code agree on every implemented event; conformance is checkable.
- **Negative / trade-offs:** optional fields are weaker than required ones — the envelope cannot
  yet _enforce_ tenancy; two unimplemented header fields from doc 20 (`trace_id` via OTel
  propagation) remain future work.
- **Follow-ups:** the tenancy-model ADR (before Phase 2); a translator↔catalog conformance test
  once a shared test home exists; OTel trace-context propagation with the broker adapter.

## Alternatives considered

- **Decide full multi-tenancy now** — rejected: it is a business-model decision (deployment
  topology, isolation guarantees, pricing) the platform team cannot make unilaterally; the
  envelope reservation removes the schema-migration cost of waiting.
- **Leave the envelope untouched** — rejected: a required-field addition to live topics is one of
  the most expensive migrations in event-driven systems.

# ADR-0008: Tenancy architecture — tenant-aware core, tiered isolation

- **Status:** Accepted
- **Date:** 2026-07-04
- **Deciders:** Staff architecture (future-proofing review)
- **Affected documents:** 03, 05, 07, 14, 15, 20

## Context

The platform's stated future is SaaS for thousands of merchants, marketplace, and white-label —
yet until ADR-0004 no aggregate, event, key, or constraint carried a tenant dimension, and no
document decided the tenancy model. This is the single most expensive decision to retrofit:
it shapes unique constraints, shard keys, topic layout, cache keys, compliance boundaries
(data residency), and unit economics. Deferring it past Phase 2 means re-cutting Postgres
schemas and live topics later.

## Decision

The platform is **tenant-aware at the core, with tiered physical isolation** (the
Shopify/commercetools shape):

1. **Logical model: every commercial aggregate belongs to exactly one tenant.** `tenantId` is a
   platform primitive (an opaque string id), not a domain concept — bounded contexts do not model
   tenants; they _carry_ the tenant of the flow that created the aggregate. The Identity of
   merchants/organizations (org hierarchy, billing, white-label branding) is a **future
   `Tenancy` bounded context**, upstream of everything.
2. **Propagation, not parameters:** the tenant enters at the boundary (transport/session →
   `Principal`-adjacent tenant context → `EventContext.tenantId` → envelope/headers, per
   ADR-0004) and is enforced at the persistence adapter (every query scoped by `tenantId`) — the
   domain layer stays tenant-silent. Cross-tenant access is structurally impossible when no query
   path omits the discriminator (the defense against IDOR-class cross-tenant attacks, doc 14 §1).
3. **Default physical model: pooled (shared schema), `tenantId` column on every row**, composite
   unique constraints `(tenant_id, natural_key)` — e.g. customer email uniqueness becomes
   per-tenant — composite indexes led by `tenant_id`, and Postgres RLS as a second enforcement
   layer once real persistence lands. Partition/shard key is `tenant_id` (hash) with
   per-aggregate ordering preserved by the existing `aggregateId` message key within a tenant.
4. **Isolation tiers:** pooled (default SaaS) → dedicated schema → dedicated database/deployment
   (enterprise, white-label, or residency-constrained tenants). The clean-architecture seams make
   the tier a composition/infrastructure choice, invisible to domain and application code.
5. **Immediate consequences for Phase 2 (blocking):** Prisma schemas add `tenant_id` from the
   first migration; every repository adapter scopes by it; topic partitioning uses it; the
   transport injects it from the authenticated session. Single-tenant deployments run pooled with
   one tenant row — no special mode.

## Consequences

- **Positive:** SaaS/marketplace/white-label become deployment decisions, not re-architecture;
  compliance isolation (PCI/GDPR residency) maps to isolation tiers; the retrofit cliff is gone.
- **Negative / trade-offs:** every future query/index/constraint pays the composite-key tax now;
  RLS + adapter scoping is defense-in-depth that must be tested per adapter; the `Tenancy`
  context is new scope (deferred until first multi-merchant customer, but its id format is fixed
  today).
- **Follow-ups:** `Tenancy` context design (post-MVP); RLS policies with the Prisma sprint;
  tenant-scoped rate limits and cache keys with the transport sprint.

## Alternatives considered

- **Tenant-per-deployment only** — simplest, but thousands of merchants ⇒ thousands of stacks;
  ruinous unit economics for a SaaS tier; keeps none of the marketplace options open.
- **Dedicated-schema-per-tenant as default** — better isolation than pooled, but schema-count
  explosion (migrations × tenants) caps merchant count far below target scale.
- **Defer the decision** — rejected: Phase 2 freezes schemas and topics; this was the last cheap
  moment.

# ADR-0011: Metafields & custom attributes

- **Status:** Accepted
- **Date:** 2026-07-05
- **Deciders:** Staff architecture (Sprint 2.8 Phase A; closes gap G-34's decision half)
- **Affected documents:** 03, 24, 25; Prisma schemas (additive)

## Context

Merchant-defined data on core entities is Shopify's central extensibility primitive; without a
decision, every custom attribute becomes a schema migration and the storefront API/read models/
search would each invent their own answer. The decision must precede the tables it attaches to
maturing further — the implementation itself is NOT this sprint (no speculative build).

## Decision

1. **Typed definitions, then values.** A `MetafieldDefinition` (per tenant) declares
   `namespace` + `key` (unique per owner type per tenant), owner type
   (`product | variant | customer | order | collection | app`), value type
   (`string | integer | decimal | boolean | date | json | reference`), validation rules
   (regex/min/max/enum), visibility (`admin | storefront`), and required permission scope.
   Values may exist ONLY against a definition — no schemaless bags (Shopify's own hard lesson).
2. **Namespacing:** merchant definitions live under merchant-chosen namespaces; app-owned
   definitions are forced into `app--<appId>` namespaces (doc 24 isolation — an app can never
   collide with or shadow merchant data; app scopes gate access).
3. **Storage:** one `platform.metafield_definitions` table + one `metafield_values` table per
   owner context schema (`catalog.product_metafields`, …): `(tenant_id, owner_id,
definition_id)` unique, typed value columns (`value_text`, `value_number`, `value_json`) with
   the definition deciding which is live. No cross-context FKs (D-002) — `definition_id` is a
   bare id. Values carry `version` int for optimistic locking like every row (D-042).
4. **Versioning & migration:** definitions are append-only versioned (`definition_version`);
   type changes create a new version + a background revalidation job; values reference the
   version they were written under. Removing a definition soft-deletes it and freezes its values
   (read-only) — never destructive.
5. **Search/filtering:** metafields marked `filterable` are projected into the CDC-fed read
   models/search index (G-8/G-29) — the WRITE side never queries by metafield (no GIN-index
   temptation on the command path).
6. **API exposure:** storefront/admin APIs expose metafields only through the owning entity's
   endpoints, gated by definition visibility + permission (`metafields:read|write` scopes for
   apps).

## Consequences

- **Positive:** zero-migration merchant/app extensibility; app isolation by construction;
  search/filter capability is an explicit, indexed opt-in rather than an accidental full scan.
- **Negative:** definitions add a management surface (admin UI later); typed columns cost one
  sparse row-width vs. a single jsonb (accepted: validation + indexing beat compactness).
- **Follow-ups:** implementation lands with the storefront/read-model phase; Prisma models are
  additive (new tables only — current schemas unchanged, which is why deciding now is free).

## Alternatives rejected

- **jsonb bag on each entity** — unvalidated, unindexable-by-intent, app-collision-prone.
- **EAV single global table** — hot, unshardable by context, cross-context FK pressure.
- **Defer until storefront** — rejected: the definition/value split shapes read models and the
  app scopes (doc 24) being designed now.

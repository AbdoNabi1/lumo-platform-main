# 04 — API architecture and service communication

> **Status: CONTRACT — 2026-06-28.** Defines the public/partner/internal API surfaces and how
> services talk to each other.

## 1. API tiers

| Tier | Protocol | Audience | Notes |
|---|---|---|---|
| Storefront API | GraphQL + REST | Anonymous + authed customers | Read-heavy; CDN-cached with surrogate keys |
| Customer API | GraphQL | Authenticated household scope | Field-level auth, cursor pagination |
| Admin API | GraphQL | Operators | Full CRUD; RBAC+ReBAC per field; async bulk ops with job polling |
| Partner / Integration API | REST (OpenAPI 3.1) + Webhooks | B2B/partners | OAuth2 client-credentials; URL-versioned; 12-month deprecation |
| Internal | gRPC (Protobuf) + events | Service-to-service | Not publicly exposed; mTLS |

Client-facing aggregation is **GraphQL federation** via Apollo Router: each context owns a
subgraph; the router composes. Partner/external integrations use **REST**.

## 2. Cross-cutting API standards

- **Errors:** uniform envelope `{ code, message, traceId, fields[], retryable }` across REST and GraphQL extensions.
- **Pagination:** cursor only (`first/after/last/before`); offset pagination is prohibited.
- **Idempotency:** `Idempotency-Key` header required on all mutating REST endpoints; mutation IDs in GraphQL.
- **Versioning:** REST via URL (`/v1`); GraphQL via field-level `@deprecated`; events via topic version suffix.
- **Caching:** `ETag`/`If-None-Match` + `Cache-Control` + surrogate keys; event-driven purge.
- **Rate limiting:** sliding window per principal × route class (at the gateway).
- **Specs are generated, not hand-written:** OpenAPI from code, GraphQL SDL from resolvers, Protobuf for gRPC; published to the developer portal.

### 2.1 Read-side contract (list/get use cases)

Every list use case in the Admin API (REST tier, `apps/admin/src/http/*-routes.ts`) returns exactly:

```ts
Result<Paginated<TAggregate>, DomainError>
```

where `Paginated<T>` comes from `@platform/types`:
`{ items: readonly T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }`. A use case
must never return a flat `{ items, hasNextPage, endCursor }` — `hasNextPage`/`endCursor` live only
inside `pageInfo`.

Every list route returns exactly this on the wire:

```json
{ "items": [ /* flat DTOs, never aggregates */ ], "pageInfo": { "hasNextPage": false, "endCursor": null } }
```

**DTO rule:** a route never returns a domain aggregate. `Entity`/`ValueObject` expose `props`,
`_id`, `_domainEvents` and `_version` as ordinary enumerable properties at runtime — returning one
leaks the domain-event stream and the optimistic-lock counter over the wire. Every route that
returns an entity maps it through an explicit, fully-primitive DTO interface first (see
`apps/admin/src/http/public-catalog-routes.ts`'s `toProductDto`/`mapPage` for the reference
shape). This is the same rule as the cursor-pagination-only standard in §2 — it exists because it
was violated once in production; see the header comment of that file for the incident.

## 3. Service communication

### 3.1 Synchronous vs asynchronous

| Need | Mechanism | When |
|---|---|---|
| Composed client read | GraphQL federation | Client needs data from several contexts |
| Internal request/response | gRPC | Low-latency, typed, within cluster |
| State change notification | Domain event (Redpanda) | Default for cross-context effects |
| External partner | REST + signed webhooks | Outbound integrations |

**Rule:** synchronous calls never cross a transaction boundary and never chain > 2 hops deep. If
a flow needs ≥3 contexts with rollback, it is a saga (doc 05), not a call chain.

### 3.2 Anti-corruption layers (ACL)

Every context translates inbound external/other-context messages at its boundary into its own
model. No domain model depends on another context's or vendor's schema.

### 3.3 Contract testing

Every service boundary is covered by **Pact** consumer-driven contracts in CI. Producers cannot
break a contract a consumer depends on without a versioned migration.

### 3.4 Orchestration vs choreography

- **Choreography (default):** services react to events independently.
- **Orchestration (Temporal):** flows spanning ≥3 contexts with rollback — checkout, returns, multi-warehouse fulfillment, subscription renewals.

## 4. Webhooks (outbound)

HMAC-signed, retried with exponential backoff + jitter, idempotent delivery IDs, replayable from
the event log, with per-subscriber dead-lettering and a delivery dashboard.

## Requires ADR to change

- Adding a new public API tier or protocol.
- Relaxing the idempotency, cursor-pagination, or generated-spec rules.
- Changing federation (Apollo Router) or the gRPC-internal decision.

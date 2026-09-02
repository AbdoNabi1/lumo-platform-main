# 06 — State management strategy

> **Status: CONTRACT — 2026-06-28.** Defines where state lives, on the client and the server, and
> how it stays consistent.

## 1. Principle

State is owned at exactly one tier and cached deliberately elsewhere. We separate **UI state**,
**server (domain) state**, and **derived read state**, and never conflate them.

## 2. Client state (storefront / admin)

| Kind | Tool | Notes |
|---|---|---|
| Server cache (remote data) | TanStack Query | Caching, revalidation, optimistic updates; the source of truth is always the server |
| UI/ephemeral state | Zustand (small stores) + React state | Cart drawer open, filters, wizard step — never persisted as domain truth |
| URL state | route params / search params | Shareable, back-button-correct filters and pagination |
| Server components | Next.js RSC | Data fetched on the server; client boundary explicit |

Rule: domain truth (cart contents, order status) is never authoritatively held in client state — the client mirrors server state and reconciles via TanStack Query invalidation on events/mutations.

## 3. Server state

| State | Owner | Store | Consistency |
|---|---|---|---|
| Cart (live) | Cart context | Redis (TTL) | Strong within session; event log in PostgreSQL for replay |
| Sessions | Identity | Redis + signed cookies | Server-revocable refresh tokens |
| Inventory counters | Inventory | Redis (hot) reconciled to PostgreSQL ledger | Atomic decrement (Lua/optimistic lock); ledger is truth |
| Orders/payments | Orders/Payments | PostgreSQL | ACID; immutable event log |
| Experiment assignment | Experimentation | Deterministic hash (no read needed) + idempotent record | Same subject ⇒ same variant |

## 4. Caching tiers and invalidation

| Tier | Scope | Example | Invalidation |
|---|---|---|---|
| L1 | In-process LRU per pod | hot small lookups (flags, config) | TTL + event purge |
| L2 | Redis (cross-pod) | product read model, sessions | event-driven key purge |
| L3 | CDN edge | catalog/PDP responses | surrogate-key purge on `catalog.product.updated` |

Invalidation is **event-driven**: a state change emits an event that triggers cache purge with the
relevant surrogate key — never time-only invalidation for catalog/pricing.

## 5. Consistency model

- **Strong** within an aggregate/transaction (orders, payments, inventory decrement).
- **Eventual** across contexts (read models, search index, analytics) — UX is designed to tolerate it (e.g. "processing" states), never to hide a broken invariant.
- Optimistic concurrency (`version` column) on every mutable aggregate root.

## Requires ADR to change

- The client state tool split (TanStack Query / Zustand) or the "domain truth not in client" rule.
- The three-tier caching model or the event-driven invalidation rule.

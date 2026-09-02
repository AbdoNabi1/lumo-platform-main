# 03 — Domain and database boundaries

> **Status: CONTRACT — 2026-06-28.** Defines the bounded contexts, who owns which data, and the
> hard rules for database boundaries. Table-level DDL is in the separate database design; this
> document governs ownership and boundaries.

## 1. Bounded contexts (data owners)

Each context owns its data exclusively and exposes it only via API or events. One PostgreSQL
schema per context (logical isolation now; physical DB on extraction).

| Context | Owns | Store |
|---|---|---|
| Catalog | products, variants, attributes, categories, collections, bundles, upsell/cross-sell relations, media links | PostgreSQL `catalog` |
| Inventory | warehouses, stock items, reservations, movement ledger | PostgreSQL `inventory` + Redis counters |
| Pricing | tax categories/rates, discount rules, coupons, redemptions | PostgreSQL `pricing` |
| Identity | customers, households, child profiles (encrypted), addresses, staff users, roles, permissions, consent | PostgreSQL `identity` |
| Cart | carts, cart items, abandonment | Redis (live) + PostgreSQL `orders` (event log) |
| Checkout | checkout sessions, flow definitions | PostgreSQL + Temporal |
| Orders | orders, order items, order events, shipments, returns | PostgreSQL `orders` (partitioned) |
| Payments | payment intents, charges, refunds, payment methods config | PostgreSQL `orders` + vault |
| Content (CMS) | pages, sections, reusable sections, landing pages | PostgreSQL `cms` |
| Experimentation | experiments, variants, assignments, feature flags | PostgreSQL `experiment` |
| Tracking | raw events, sessions, identity edges | Edge + ClickHouse (+ PostgreSQL buffer) |
| Attribution | touchpoints, journeys, attributed conversions | ClickHouse + PostgreSQL |
| Analytics | event definitions, materialized funnels/cohorts | ClickHouse |
| Marketing | campaigns, segments, sends, automations | PostgreSQL `marketing` |
| Feed engine | feed definitions, feed snapshots, sync status | PostgreSQL + object storage |
| Reviews | reviews, UGC | PostgreSQL `social` |
| Loyalty | points ledger, tiers, referrals | PostgreSQL |
| Search | the OpenSearch index (read model) | OpenSearch |
| Recommendations | models, embeddings | pgvector + model store |
| Notifications | templates, delivery log | PostgreSQL + provider |
| Media | asset metadata | PostgreSQL `media` + S3/R2 |

## 2. Database boundary rules (hard invariants)

1. **One database per bounded context** (logical schema minimum; physical on extraction).
2. **No cross-context foreign keys.** A reference to another context is a bare `*_id` (no DB FK); integrity is guaranteed by the owning service and events. This is what makes extraction mechanical.
3. **No cross-context joins or direct reads.** A context reads another's data only via that context's API or via the analytics read model.
4. **Snapshots over live references for history.** Orders store a product/price/address snapshot at purchase time — the orders "Product" is a different aggregate from the catalog "Product", by design (DRY is not a license to couple).
5. **CQRS read models** (OpenSearch, ClickHouse, Redis) are derived via CDC/events — never written to directly by other contexts.
6. **Financial/audit data is append-only** (order events, ledgers, consent, audit log); status is derived, not mutated.

## 3. Data classification and residency

| Class | Examples | Handling |
|---|---|---|
| Children's data | child profiles (age, interests) | Encrypted per-household key; never in analytics; cryptographic-erase deletable. See doc 14. |
| PII | email, phone, address | Hashed for ad CAPIs; redacted in logs; consent-gated. |
| Payment | PAN | Never stored; PSP-tokenized; PCI scope minimized. |
| Behavioral | events, touchpoints | First-party; consent-respecting; retention-capped (see doc 10). |

## Requires ADR to change

- The list of bounded contexts (adding/merging/splitting a context).
- Any relaxation of the no-cross-context-FK or no-cross-context-join rules.

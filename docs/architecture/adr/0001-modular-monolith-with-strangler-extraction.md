# ADR-0001: Modular monolith with strangler extraction

- **Status:** Accepted
- **Date:** 2026-06-28
- **Deciders:** Staff architecture
- **Affected documents:** 02, 03, 04, 05, 15

## Context

We are building an enterprise commerce platform that must outperform Shopify on flexibility for
CRO, attribution, analytics, and customization. A microservices-first topology is the most common
cause of early failure: distributed transactions, eventual-consistency UX bugs, and operational
overhead crush velocity before product-market fit. We still need the *option* to scale specific
capabilities (tracking, attribution, analytics, feeds, search) independently because their load
profiles differ by orders of magnitude from the transactional core.

## Decision

We will build the **transactional core** (catalog, inventory, pricing, cart, checkout, orders,
payments, identity) as a **modular monolith**: a single deployable with strict, lint-enforced
module boundaries per bounded context. We will run a small number of capabilities as **separate
services from day one** where their scaling/latency profile demands it: tracking collector,
attribution, analytics, feed engine, search, recommendations, notifications. Extraction of further
modules into services happens by **Strangler Fig** — only when a measured need arises — and is
mechanical because boundaries (no cross-context FKs, communication via events/contracts) are
enforced from the start.

## Consequences

- **Positive:** high early velocity, simple local transactions in the core, low ops overhead, and a clean path to extraction without rewrites.
- **Negative / trade-offs:** discipline required to keep boundaries from eroding; some duplication (e.g. a "Product" snapshot in orders vs. the catalog aggregate) is accepted by design.
- **Follow-ups:** dependency-cruiser fitness functions (doc 02), no-cross-context-FK rule (doc 03), event contracts (doc 05).

## Alternatives considered

- **Microservices-first** — rejected: premature distribution cost, no PMF yet.
- **Single unstructured monolith** — rejected: boundaries would erode, making future scaling impossible without a rewrite.
- **Buy Shopify/commercetools** — rejected: the data model (developmental outcomes, multi-touch attribution, first-party tracking) and CRO flexibility requirements exceed what they expose.

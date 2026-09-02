# Architecture contract — Phase 1: System architecture

> **Status: CONTRACT (Phase 1 approved baseline) — 2026-06-28.**
> This directory is the permanent system-architecture contract for the platform (premium
> educational toys commerce, "Tiny Scholars"). Implementation in later phases must conform to
> these documents. Changes are made only through the ADR process in [§5](#5-change-process--adrs).
>
> This is a **design contract**, not code. No application code, React components, or pages are
> defined here. The **UI** contract lives separately in [`../ui/`](../ui/) and is not
> superseded by anything here.

---

## 1. Scope

In scope: the complete backend + platform architecture — how the system is structured, how
services communicate, how data is owned, how the growth/data plane (marketing, tracking,
analytics, feeds) works, and the cross-cutting concerns (auth, flags, config, observability,
security, scalability, deployment).

Out of scope (other phases / contracts): UI implementation (frozen — see `../ui/`), database
table-level DDL (see the database design), concrete vendor account setup, and code.

## 2. How to use this contract

- Every implementation decision must trace to a document here. If it isn't covered, write an ADR.
- **Precedence:** ADRs (newest wins) → these documents → conventions. The UI contract in `../ui/` is independent and authoritative for anything visual.
- Each document carries its own status banner and a "**Requires ADR to change**" section listing its frozen invariants.

## 3. Architecture principles (non-negotiable)

1. **Modular monolith first, microservices by extraction.** Strict module boundaries from day one; extract to services only when scale/independence demands it (Strangler Fig). See [ADR-0001](adr/0001-modular-monolith-with-strangler-extraction.md).
2. **Domain-Driven Design.** Bounded contexts own their language, model, and data. No shared mutable tables across contexts.
3. **Clean Architecture.** Dependencies point inward: domain ← application ← infrastructure/interfaces. Domain is framework-free.
4. **Feature-first organization.** Code is organized by capability (vertical slice), not by technical layer, with one public entry point per feature.
5. **Event-driven with guarantees.** State changes emit domain events via the transactional outbox; consumers are idempotent; schemas are versioned and registry-enforced.
6. **First-party data ownership.** Tracking, attribution, and analytics data live in our stores (ClickHouse/PostgreSQL), never primarily in a vendor. This is a core competitive requirement.
7. **Privacy and child-safety by design.** COPPA / GDPR-K / consent are first-class architectural constraints, not add-ons. Children's data is minimized, isolated, and never used for profiling.
8. **API-first / headless / composable.** Every capability is exposed through versioned APIs consumed by all channels.
9. **Everything-as-config for change-prone behavior.** Experiments, feature flags, promotions, checkout flows, and feeds are data/config — changing them must not require a deploy.
10. **Secure, observable, reproducible by default.** Infra-as-code, GitOps, OpenTelemetry everywhere, least-privilege, secrets in a manager — these are defaults, not options.

## 4. Document index

| #   | Document                                                                         | Covers                                                                              |
| --- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 01  | [overview-and-technology](01-overview-and-technology.md)                         | System context, container view, technology decisions + justifications               |
| 02  | [monorepo-packages-and-feature-first](02-monorepo-packages-and-feature-first.md) | Monorepo structure, package strategy, feature-first, module boundaries              |
| 03  | [domain-and-database-boundaries](03-domain-and-database-boundaries.md)           | Bounded contexts, data ownership, database boundaries                               |
| 04  | [api-and-service-communication](04-api-and-service-communication.md)             | API architecture, service communication (sync/async, ACL, contracts)                |
| 05  | [events-queues-workers-and-jobs](05-events-queues-workers-and-jobs.md)           | Event-driven architecture, queue architecture, worker architecture, background jobs |
| 06  | [state-management](06-state-management.md)                                       | Client + server state, caching tiers, consistency                                   |
| 07  | [auth-and-authorization](07-auth-and-authorization.md)                           | Authentication and authorization                                                    |
| 08  | [marketing-core](08-marketing-core.md)                                           | Marketing Core architecture                                                         |
| 09  | [tracking-and-server-side-tracking](09-tracking-and-server-side-tracking.md)     | Tracking architecture, server-side tracking                                         |
| 10  | [analytics-and-feed-engine](10-analytics-and-feed-engine.md)                     | Analytics architecture, feed engine architecture                                    |
| 11  | [integration-and-plugins](11-integration-and-plugins.md)                         | Integration architecture, plugin system                                             |
| 12  | [feature-flags-and-configuration](12-feature-flags-and-configuration.md)         | Feature flags, configuration management                                             |
| 13  | [observability](13-observability.md)                                             | Logging, monitoring, error handling                                                 |
| 14  | [security](14-security.md)                                                       | Security                                                                            |
| 15  | [scalability-and-deployment](15-scalability-and-deployment.md)                   | Scalability, deployment strategy                                                    |
| 16  | [tracking-specification](16-tracking-specification.md)                           | Single source of truth for all tracking events (extends 09)                         |
| 17  | [attribution-specification](17-attribution-specification.md)                     | Enterprise attribution: models, identity, offline, consent mode                     |
| 18  | [product-feed-specification](18-product-feed-specification.md)                   | Enterprise feed engine: channels, formats, sync, health (extends 10)                |
| 19  | [marketing-data-model](19-marketing-data-model.md)                               | Logical marketing data model + KPI/metric definitions                               |
| 20  | [events-catalog](20-events-catalog.md)                                           | Complete domain/system event catalog (complements 05)                               |
| 21  | [experimentation-and-cro](21-experimentation-and-cro.md)                         | CRO platform: A/B, MVT, personalization, modules (integrates 16)                    |

> **Docs 16–21** are deep specifications added in the Phase 1 extension; they refine 09/10/12 and
> the experimentation context. The original 28-concern coverage matrix (§5) is unchanged.

## 5. Coverage matrix (the 28 requested concerns → document)

| Requested concern                 | Document |
| --------------------------------- | -------- |
| Monorepo structure                | 02       |
| Package strategy                  | 02       |
| Feature-first architecture        | 02       |
| Module boundaries                 | 02       |
| Event-driven architecture         | 05       |
| Service communication             | 04       |
| State management strategy         | 06       |
| API architecture                  | 04       |
| Authentication & Authorization    | 07       |
| Database boundaries               | 03       |
| Worker architecture               | 05       |
| Queue architecture                | 05       |
| Background jobs                   | 05       |
| Marketing Core architecture       | 08       |
| Tracking architecture             | 09       |
| Analytics architecture            | 10       |
| Feed Engine architecture          | 10       |
| Server-Side Tracking architecture | 09       |
| Integration architecture          | 11       |
| Plugin system                     | 11       |
| Feature Flags                     | 12       |
| Configuration management          | 12       |
| Logging                           | 13       |
| Monitoring                        | 13       |
| Error handling                    | 13       |
| Security                          | 14       |
| Scalability                       | 15       |
| Deployment strategy               | 15       |

## 6. Change process — ADRs

- Any change to a frozen invariant requires an **Architecture Decision Record** in [`adr/`](adr/), using [`adr/TEMPLATE.md`](adr/TEMPLATE.md).
- ADRs are numbered, append-only, and immutable once `Accepted`. A later ADR can `Supersede` an earlier one but must say so explicitly.
- Seed: [ADR-0001 — modular monolith with strangler extraction](adr/0001-modular-monolith-with-strangler-extraction.md).
- The contract documents are updated only after the corresponding ADR is `Accepted`.

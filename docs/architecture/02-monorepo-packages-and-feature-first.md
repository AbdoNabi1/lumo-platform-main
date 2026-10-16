# 02 — Monorepo, package strategy, feature-first, module boundaries

> **Status: CONTRACT — 2026-06-28.** Defines repository layout, how shared code is packaged, the
> feature-first organization inside every app/service, and the enforced module boundaries.

## 1. Monorepo structure

Single **Turborepo** monorepo, pnpm workspaces. Top level separates by deployment axis; feature-first lives _inside_ apps and services.

```
/
├── apps/            FRONTEND — deployable UIs (storefront, admin [UI frozen], mobile)
├── services/        BACKEND — bounded-context services (clean arch + feature slices)
├── edge/            Edge compute (Cloudflare Workers): ab-assignment, tracking-beacon, geo-router
├── packages/        SHARED — reusable libraries (never deployed alone)
├── infrastructure/  IaC, k8s, ci-cd, argocd, observability, database (partition automation)
├── tooling/         generators (new-feature/new-service), codemods, shared lint/ts config
└── docs/            architecture/ (this contract), ui/ (Morbeh Design System contract), adr/
```

This is the same physical layout established for the project; the admin app's UI is governed by
`../ui/` and is not re-specified here.

## 2. Package strategy

Three tiers; promotion follows the **rule of three** (≥3 consumers ⇒ promote to `packages/`).

| Tier                            | Examples                                                                           | Rule                                              |
| ------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------- |
| Shared kernel (`packages/core`) | Money, Email, Address, Slug, Result, IDs (UUIDv7), typed errors                    | Strict semver; breaking change ⇒ ADR              |
| Cross-cutting libs              | logger, telemetry, http, cache, outbox, validation, feature-flags, config, testing | Stable, framework-light                           |
| Contracts                       | `domain-events` (Avro/Protobuf), `api-clients` (generated)                         | The **only** allowed coupling between services    |
| Growth kits                     | tracking SDK, analytics SDK, page-builder-kit, marketing-kit, automation-kit       | Single source of truth for each growth capability |

Rules: packages never import from `apps/` or `services/`. Apps/services import packages, never each other's internals. Versioning via changesets; alignment via Renovate.

## 3. Feature-first architecture

Inside an app or service, code is organized by **capability (vertical slice)**, not by technical layer. Frontend slice anatomy (one capability per folder, one public door):

```
features/<capability>/
├── components/  hooks/  api/  model/  lib/  __tests__/
└── index.ts     # PUBLIC API — the only import surface
```

Backend service interior is Clean Architecture, with the application layer sliced by use-case:

```
services/<context>/src/
├── domain/          pure: aggregates, value objects, events, repository interfaces
├── application/     use-cases (one folder each) + ports (outbound interfaces)
├── infrastructure/  adapters: persistence, messaging (outbox), external (ACL)
├── interfaces/      inbound: http, graphql, grpc, event consumers
├── config/  main
```

## 4. Module boundaries (the dependency rules)

Enforced in CI via `dependency-cruiser` + ESLint `no-restricted-imports` (build fails on violation):

1. `domain/` imports nothing outside `packages/core`. `application` → `domain` only. `infrastructure`/`interfaces` → `application` + `domain`. Never the reverse.
2. **No feature imports another feature's internals** — only its `index.ts`. Cross-feature needs go through `packages/` or domain events.
3. **No service imports another service's source** — only `packages/domain-events` (async) and `packages/api-clients` (sync).
4. App routing layers contain no business logic — they wire URLs to feature entry points.
5. New features/services are **scaffolded** (`tooling/generators`), never hand-rolled — identical anatomy every time.

Fitness functions (automated tests in CI): "domain has no framework imports", "no cross-service source import", "no feature deep-import", "no cross-context DB access".

## Requires ADR to change

- The top-level monorepo axes, the dependency-rule set, or the rule-of-three promotion policy.
- Introducing any new allowed coupling between services beyond `domain-events` and `api-clients`.

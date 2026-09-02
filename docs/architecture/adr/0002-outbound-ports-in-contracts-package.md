# ADR-0002: Outbound ports live in dedicated contract packages, never inside a layer

- **Status:** Accepted
- **Date:** 2026-06-29
- **Deciders:** Staff architecture
- **Affected documents:** 02, 03; DECISIONS D-006, D-009, D-018, D-019

## Context

Sprint 0.4 introduced the `IdGenerator` outbound port and placed its interface **inside**
`@platform/application` (the application-layer package). Persistence ports, by contrast, already
live in their own leaf package, `@platform/repository` (D-006). This produced two problems flagged
in the Sprint 0.4 architecture review:

1. **Inconsistency** — two different homes for outbound ports (a dedicated package vs. inside a
   layer package).
2. **Interface-segregation violation** — an infrastructure adapter (`@platform/id`) had to depend
   on the **entire** `@platform/application` package (DI container, CQRS buses, middleware) just to
   obtain one interface, whereas `@platform/db` depends only on the lean `@platform/repository`.

As more cross-cutting outbound ports appear (e.g. `Clock`), this divergence would compound.

## Decision

Outbound port **interfaces** live in dedicated leaf packages, never inside a layer package:

- **Persistence ports** stay in `@platform/repository` (unchanged, D-006).
- **Other cross-cutting outbound ports** (`IdGenerator`, `Clock`, and future peers) live in a new
  `@platform/contracts` package: **interfaces only**, **no runtime dependencies**, no DI, no
  implementations, no framework code.
- **DI tokens remain in `@platform/application`** (co-located with the DI container, which owns
  `createToken`). The application owns orchestration and wiring; the contract package owns only the
  abstraction.
- **Infrastructure adapters depend only on the contract package** (`@platform/contracts` /
  `@platform/repository`), never on `@platform/application`.

Dependency direction stays strictly inward: `contracts` is a graph leaf; `application` and all
infrastructure adapters depend on it; the application no longer leaks into adapters.

## Consequences

- **Positive:** consistent rule for every outbound port; lean adapters (no dependency on the
  application kernel); clean, inward-only dependency direction; the domain stays untouched.
- **Negative / trade-offs:** one extra package; a port's **interface** (in `contracts`) and its
  **DI token** (in `application`) live in different packages — accepted, because they are different
  concerns (a contract you implement vs. a wiring handle you register).
- **Follow-ups:** dependency-cruiser fitness functions (doc 02) should encode "infra adapters may
  depend on `contracts`/`repository`, not on `application`."

## Alternatives considered

- **Keep ports inside `@platform/application`** — rejected: the coupling and inconsistency above.
- **One unified ports package (move `@platform/repository` into `@platform/contracts`)** — deferred:
  would modify completed Sprint 0.3 (`repository`) and its consumer `@platform/db`; persistence
  ports are a distinct, larger concept that justifies their own package.
- **Relocate the DI token primitive (`createToken`) into `@platform/contracts` so interface +
  token co-locate** — rejected: would refactor the Sprint 0.3 DI container (out of scope) and pull
  DI concerns into a pure-interface package.

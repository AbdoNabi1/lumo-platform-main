# @platform/domain

The **domain foundation** — the innermost Clean Architecture layer. Pure and deterministic:
depends only on the kernel (`@platform/types`, `@platform/utils`), and contains **no** framework,
infrastructure, persistence, messaging, HTTP, or id/clock generation.

## Building blocks (`src/shared/`)

| Folder           | Exports                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `value-object/`  | `ValueObject<T>` (immutable, structural equality), `UniqueEntityId` (+ `UniqueEntityId.from(value)`) |
| `entity/`        | `Entity<TProps>` (identity-based equality, read-only props)                                          |
| `aggregate/`     | `AggregateRoot<TProps>` (collects domain events, `version` for optimistic concurrency)               |
| `events/`        | `DomainEvent` (abstract; `eventId`/`aggregateId`/`occurredAt` supplied), `DomainEventCollection`     |
| `guards/`        | `Guard` validation helpers → `Result<T, ValidationError>`                                            |
| `specification/` | `Specification<T>` + `and`/`or`/`not` combinators                                                    |
| `services/`      | `DomainService` marker (abstraction only)                                                            |
| `errors/`        | curated re-export of the kernel `DomainError` hierarchy (no duplication)                             |

## Identity & determinism

The domain never generates ids or reads the clock. Identity is supplied:

- **New aggregates:** the application generates an id via the `IdGenerator` port
  (`@platform/application`, implemented by `@platform/id`'s `CryptoIdGenerator`) and passes it in.
- **Rehydration:** repositories call `UniqueEntityId.from(existingId)`.
- **Domain events:** `eventId` and `occurredAt` are supplied at construction (no `crypto`, no `Date.now`).

This keeps the domain reusable by every bounded context and fully testable without infrastructure.

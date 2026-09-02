# @platform/identity

## Purpose

The **Identity** bounded context (Phase 1 Commerce Core, the last one): customers, their postal
addresses, and an append-only consent log. The natural key is the customer's email. Owns its data;
no cross-context import — other contexts reference a customer only by bare id.

## Architecture (clean-architecture slice)

- **domain/** — `Customer` (aggregate; raises `customer.registered` + `consent.changed`; consent for
  a scope is **derived** from the latest record), `Address` + `ConsentRecord` (append-only) entities;
  value objects `Email`, `ConsentScope`; `CustomerRepository` port (incl. `findByEmail`). Pure.
- **application/** — `RegisterCustomer` (enforces email uniqueness → `ConflictError`), `AddAddress`,
  `ChangeConsent` (`@platform/application` `UseCase`). VO validation returns `Result`; conflicts /
  not-found are `DomainError`s mapped by the presenter.
- **infrastructure/** — in-memory repository (writes the outbox on save; email lookup),
  `InMemoryUnitOfWork`, `IdentityEventTranslator` (→ `identity.customer.{registered,consent_changed}.v1`).
- **interfaces/** — `CustomerController` (register/addAddress/changeConsent) + `present()` (no HTTP).
- **composition.ts** — wires the slice with in-memory adapters (serializer/id/clock injected).

## Scope (Phase 1)

Customer + address + consent only. **Out (YAGNI):** households, child profiles, fine-grained ReBAC.
Staff authentication via Ory and the auth/authz **ports** already live in `@platform/contracts`
(Sprint 0.7); wiring an Ory adapter is deferred. Consent fields are not yet encrypted (the
encrypted-field seam is a later concern).

## Dependencies

`@platform/{domain, application, contracts, repository, messaging, domain-events, types, utils}`.
Dependency direction enforced by `pnpm arch`.

## Extension points

Replace the in-memory repository with Postgres (`identity` schema; unique index on email; outbox in
the DB transaction); add an Ory adapter behind the `Authenticator`/`AccessControl` ports; encrypted
PII fields; `customer.registered` is consumed (later) by Notifications/marketing. All deferred.

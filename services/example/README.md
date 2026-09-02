# @platform/example — walking skeleton (reference, NON-business)

## Purpose

A **reference implementation**, not a bounded context. It proves the platform architecture wires
end to end **in-process** — API → application → domain → repository → outbox → messaging — using a
deliberately neutral `ExampleAggregate`. It is also the canonical output shape of the `service`
generator (`pnpm gen`). It contains **no business logic** and must never be mistaken for a real
context.

## Architecture (clean-architecture slice, docs/architecture/02)

- **domain/** — `ExampleAggregate` (raises `ExampleRegistered`), `ExampleRepository` port. Pure:
  imports only `@platform/domain`.
- **application/** — `RegisterExample` use-case (`@platform/application` `UseCase`). Depends on the
  domain + ports (`@platform/contracts`, `@platform/repository`) only — never on messaging.
- **infrastructure/** — `InMemoryExampleRepository` (persists + writes the **outbox** via
  `@platform/messaging` on save), `InMemoryUnitOfWork`, `ExampleEventTranslator`. This is where the
  outbox/messaging dependency lives.
- **interfaces/** — `RegisterExampleController` (**framework-agnostic** boundary — no HTTP server,
  no NestJS/Express/Fastify) and `ExampleRegisteredConsumer` (`EventHandler`).
- **composition.ts** — wires everything with in-memory adapters; `serializer`/`idGenerator`/`clock`
  are injected so production code never imports test-only adapters. `example.e2e.test.ts` drives the
  full chain.

## Dependencies

`@platform/{domain, contracts, repository, application, messaging, domain-events, utils, types}`.
Dependency direction `domain ← application ← messaging ← infrastructure` is enforced by
`pnpm arch` (dependency-cruiser).

## Extension points

- Replace the in-memory repository/unit-of-work with Prisma adapters (outbox inside the DB
  transaction); replace the in-memory bus/publisher with Redpanda; add a real transport adapter
  (Phase 1) around the controller. None of these change the domain/application code.

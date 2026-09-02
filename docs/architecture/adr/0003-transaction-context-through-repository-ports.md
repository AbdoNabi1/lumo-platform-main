# ADR-0003: Transaction context flows through repository ports

- **Status:** Accepted
- **Date:** 2026-07-04
- **Deciders:** Staff architecture (platform-hardening review)
- **Affected documents:** 02, 03, 05

## Context

The transactional outbox (doc 05 §1.1) requires the aggregate write and the outbox append to
commit in **one database transaction**. `TransactionalUnitOfWork<TContext>.run(work(context))`
already yields a transaction context, but no use case consumed it and repositories were
constructed at composition time with no way to reach it — `OutboxWriter.write(events, context,
tx)` received `undefined`. With in-memory adapters this is invisible; with Prisma it would have
been impossible to implement the outbox guarantee without changing every use-case and repository
signature mid-sprint. The dual-write failure mode (aggregate saved, event lost — or the reverse)
is precisely what the outbox exists to exclude.

## Decision

The transaction context is threaded **explicitly** end to end:

1. Every domain repository port method accepts a trailing optional `tx?: unknown`
   (`save(order, tx)`, `findById(id, tx)`). The type stays `unknown` because the domain layer
   must not know persistence types (D-008); adapters narrow it.
2. Use cases pass the context they receive from `unitOfWork.run(async (tx) => …)` to **every**
   repository call inside the boundary — reads included, so read-your-writes holds inside the
   transaction.
3. Infrastructure repositories forward `tx` to `OutboxWriter.write`/`OutboxStore.append`.
   In-memory adapters ignore it; the Prisma adapter narrows it to the interactive transaction
   client and MUST fail loudly if it is missing.

We explicitly rejected implicit propagation via `AsyncLocalStorage`: the codebase's ethos is
explicit wiring with no runtime magic (D-013), and an explicit parameter is verifiable by the
compiler and by review.

## Consequences

- **Positive:** the Prisma sprint implements the outbox guarantee without touching use-case or
  port shapes; the seam is visible in every signature; in-memory and production behavior share
  one code path.
- **Negative / trade-offs:** an `unknown` parameter rides on otherwise persistence-free domain
  ports (documented on each port); callers must remember to pass `tx` — the Prisma adapter's
  fail-loud check is the backstop.
- **Follow-ups:** the Prisma `UnitOfWork`/repository adapters (Phase 2) enforce the fail-loud
  rule; generators emit the new port shape (done for the aggregate template).

## Alternatives considered

- **AsyncLocalStorage tx carrier** — rejected: implicit, unverifiable at signatures, contradicts
  D-013 (no runtime magic).
- **Transaction-scoped repository factories from `run`** — clean but a much larger reshape of
  every composition root and use-case deps object; deferred as an option if the explicit
  parameter proves noisy at scale.
- **Do nothing until Prisma lands** — rejected: the change is mechanical today and a critical-path
  emergency later.

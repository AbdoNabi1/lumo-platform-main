# ADR-0005: Atomic consumer idempotency (`recordIfNew`)

- **Status:** Accepted
- **Date:** 2026-07-04
- **Deciders:** Staff architecture (platform-hardening review)
- **Affected documents:** 05, 20

## Context

`ProcessedEventStore` exposed `has()` + `record()`, and `EventConsumer` used them as
check-then-act: two concurrent deliveries of the same message (routine during broker partition
rebalances) both pass `has()` and both execute the handler. For handlers with financial side
effects (capture payment → mark order paid), duplicate execution is a money bug. The port shape
also made the _correct_ production implementation (a unique-constraint INSERT inside the
handler's transaction) inexpressible.

## Decision

The port becomes `has()` (fast pre-check only) + `recordIfNew(messageId, processedAt, tx?)`,
which MUST be an atomic compare-and-set returning whether this call won. `EventConsumer` keeps
the pre-check for cheap skips, handles, then calls `recordIfNew` and logs a warning when it
detects a concurrent duplicate. Contract requirements written on the port:

- Production adapters implement `recordIfNew` as an INSERT guarded by a unique constraint —
  ideally inside the handler's transaction (`tx`), which upgrades at-least-once delivery to
  exactly-once _effect_ for that handler.
- `has()` alone is never a sufficient guard; handlers must remain idempotent regardless.
- Implementations must plan retention (the processed set grows with total event volume).

## Consequences

- **Positive:** the duplicate window is detectable today and fully closable by the production
  adapter; the port can no longer be implemented "correctly" in a way that is wrong.
- **Negative / trade-offs:** the in-memory consumer still executes a concurrent duplicate's
  handler before detecting it (single-process tests make this unobservable); true exactly-once
  effect requires the handler's side effects and the marker in one transaction, which arrives
  with the Prisma adapter.
- **Follow-ups:** Prisma `ProcessedEventStore` with unique-constraint semantics + retention job
  (broker-wiring sprint).

## Alternatives considered

- **Record before handling** — rejected: a crash between record and handle permanently loses the
  message (marked processed, never handled).
- **Keep `record()` and document harder** — rejected: the port shape itself invited the racy
  implementation; contracts belong in signatures where possible.

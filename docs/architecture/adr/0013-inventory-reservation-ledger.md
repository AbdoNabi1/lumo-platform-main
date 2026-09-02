# ADR-0013: Inventory reservation ledger

- **Status:** Accepted
- **Date:** 2026-07-05
- **Deciders:** Staff architecture (Sprint 2.8 Phase A; closes gap G-7)
- **Affected documents:** 03, 20, 26; ADR-0012; Prisma `inventory` schema (evolves additively)

## Context

Today every reservation mutates the `InventoryItem` aggregate row (optimistic version bump) and
replaces the reservation set — correct, but a single hot row per (product, warehouse) under
flash-sale concurrency becomes a version-conflict storm. The fix must not change the domain's
invariant (never oversell) or the ports.

## Decision

1. **Reservations become an immutable, append-only ledger.** `inventory.reservation_entries`:
   `(id, tenant_id, item_id, kind, quantity, reference, expires_at, created_at)` where
   `kind ∈ {reserve, release, commit, expire}`. Rows are NEVER updated or deleted (mutable
   history is forbidden — audit/analytics read the ledger directly; the doc-20 event stream and
   the ledger reconcile by construction).
2. **Lifecycle:** `reserve` (with TTL per ADR-0012) → exactly one of `commit` (stock leaves;
   decrements on-hand), `release` (compensation), or `expire` (sweeper appends on TTL breach —
   expiry is an EXPLICIT ledger row, not an implied state). Each lifecycle append is keyed by
   `(reservation_id, kind)` unique — idempotent under saga retries (ADR-0012) and replays
   (ADR-0005).
3. **Overselling prevention without a hot aggregate row:** the invariant check moves to the
   insert itself — `reserve` appends inside a transaction that asserts
   `on_hand − active_reserved ≥ quantity` where `active_reserved` is maintained as a
   **counter column** updated in the same transaction (`UPDATE … SET reserved = reserved + q
WHERE … AND on_hand − reserved ≥ q`; zero rows ⇒ insufficient stock). The counter row is
   touched by a single-statement conditional UPDATE (row-lock held for microseconds), not an
   aggregate read-modify-write — contention drops from version-conflict retries to plain row
   locking, which Postgres handles at flash-sale rates. The aggregate keeps its API; its
   repository adapter changes (D-042 anticipated exactly this: "the G-7 redesign changes only
   this adapter + mapper").
4. **Partitioning:** the ledger partitions by month (`created_at`) like the outbox; the counter
   table stays small (one row per tenant × product × warehouse — shardable by `tenant_id`,
   ADR-0008).
5. **Read models/analytics/audit:** availability read models project from the ledger via CDC;
   the ledger IS the audit trail for stock movements (no separate history table); ClickHouse
   ingests ledger rows for velocity/forecast analytics (doc 10).

## Consequences

- **Positive:** flash-sale safe; immutable stock history for free; saga compensation and expiry
  are idempotent appends; domain/ports unchanged.
- **Negative:** availability = counter (fast) + ledger (truth) — a reconciliation job asserts
  they agree (drift alarm); the sweeper is new operational surface.
- **Follow-ups:** implementation with the next inventory sprint (additive migration: new ledger
  table + counter semantics in the adapter); reconciliation job + sweeper in the worker process.

## Alternatives rejected

- **Keep aggregate-embedded reservations** — the measured-contention failure mode this ADR
  exists to prevent.
- **Redis-only token buckets** — fast but not the system of record; a crash loses truth. Redis
  may CACHE availability (D-044), never own it.
- **Serializable transactions** — retry storms at scale; the conditional-update counter gives
  the same guarantee cheaper.

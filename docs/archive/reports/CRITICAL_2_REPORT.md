# CRITICAL-2 REPORT — Outbox rows never marked published; pruner deletes nothing

**Finding closed:** C2-3, `FINAL_PRODUCTION_READINESS_AUDIT_v2.md`
**Type:** Publishing/pruning flow fix. No API, event contract, or CDC configuration changed.

## Investigate

`apps/runtime/src/scheduler.ts` (pre-fix) pruned `platform.outbox` with:

```ts
where: { status: "published", createdAt: { lt: cutoff } }
```

Traced who ever sets `status: "published"`:

- `packages/db/src/messaging/prisma-outbox-store.ts:65-70` — `PrismaOutboxStore.markPublished` is the
  only thing that writes it.
- `markPublished` has exactly one caller: `OutboxRelay.drainOnce()`
  (`packages/messaging/src/outbox/outbox-relay.ts:34`).
- `OutboxRelay`'s own doc comment (same file, lines 14-18): _"Used for local development and tests. In
  **production** Debezium (CDC) streams the outbox table directly, so this relay is not deployed."_
- Cross-checked all 36 `new OutboxRelay(...)` sites: every one is inside the **in-memory** branch of a
  `wireX` composition, constructed with `InMemoryOutboxStore`, never `PrismaOutboxStore`
  (representative: `services/wishlist/src/composition.ts:132-136`, after the Prisma branch has already
  returned at line 106). Every Prisma branch returns `drainOutbox: async () => 0` instead
  (representative: `services/payments/src/composition.ts:159`).
- `infrastructure/docker/debezium/outbox-connector.json` confirms the production publish mechanism:
  a Postgres logical-replication (WAL) connector with the `EventRouter` transform. It reads the table;
  it has no configured write-back path, and Debezium's outbox pattern does not have one.

**Conclusion:** on the Prisma/CDC path — the only path in production — no code ever transitions a row
out of `status: "pending"`. The prune predicate matched zero production rows by construction, not by
bug-in-logic; `platform.outbox` grows without bound on the primary transactional database.

## Prove

Confirmed via `git grep`: `PrismaOutboxStore` is imported for `append`/`OutboxWriter` construction in
all 34 Prisma composition branches; `markPublished` is called from exactly one production-reachable
call site, and that call site (`OutboxRelay`) is never constructed in any Prisma branch. Zero counter-
evidence found.

## Implement

Changed the prune predicate to age alone (`apps/runtime/src/scheduler.ts`), matching the
`@@index([createdAt])` already declared in `platform.prisma:24` specifically "// pruning" — the schema
already anticipated this. Before deleting, the job now counts rows that are still `pending` past the
retention window and logs a `warn` (not an error, not a skip) — a defensively old row is not
necessarily lost, since CDC gives no completion signal to check against, but it is old enough that
normal CDC lag shouldn't explain it, so an operator should see it rather than have it vanish silently.

```ts
const stillPending = await core.prisma.outboxEntry.count({
  where: { status: "pending", createdAt: { lt: cutoff } },
});
if (stillPending > 0) {
  core.logger.warn("outbox pruning rows CDC never confirmed published", {
    count: stillPending,
    retentionDays: core.config.OUTBOX_RETENTION_DAYS,
  });
}
const result = await core.prisma.outboxEntry.deleteMany({
  where: { createdAt: { lt: cutoff } },
});
```

**What did not change:**

- `OutboxRelay` / `markPublished` / `InMemoryOutboxStore` — untouched. Local dev and tests still mark
  rows published and still prune correctly under the old predicate, because in that path `status`
  really does reach `"published"`.
- `PrismaOutboxStore.append`'s transaction requirement (ADR-0003) — untouched.
- The Debezium connector config — untouched. CDC compatibility is unaffected because CDC never read or
  wrote `status` in the first place; it streams on `created_at`-ordered inserts via WAL, independent of
  this column.
- Kafka consumer retry/DLQ (`packages/kafka/src/consumer-runtime.ts`) — untouched; entirely separate
  from the outbox table.

## Run

**New test** (`apps/runtime/src/scheduler.test.ts`, 3 cases) exercises `buildJobs(core)[0].run()`
against a fake Prisma client and proves:

1. The delete filter has **no `status` key** — it prunes by `createdAt` alone.
2. When stale `pending` rows exist, the job logs the CDC-never-confirmed warning **and still prunes**
   (the warning is a signal, not a skip).
3. When nothing is stuck, no warning is logged.

```
✓ src/scheduler.test.ts (3 tests) 11ms
  ✓ prunes by age alone, NOT by status — production (CDC) rows never reach status=published
  ✓ warns (does not throw or skip pruning) when rows past retention were never marked published
  ✓ does not warn when nothing is stuck past retention
```

Quality gates:

| Gate      | Result                                             |
| --------- | -------------------------------------------------- |
| typecheck | ✅ 76/76                                           |
| lint      | ✅ 76/76                                           |
| test      | ✅ 25 files / 119 tests passed (+1 file, +3 tests) |
| arch      | ✅ 0 violations (1,531 modules, 6,672 deps)        |

## Scope note

The audit also suggested an outbox-depth Prometheus gauge for earlier operational visibility. Not
implemented — the `warn` log added here gives an operator a signal without adding a new metrics
series, and a gauge is naturally scoped with the metrics work (H2-7), not this finding.

## Status: FIXED

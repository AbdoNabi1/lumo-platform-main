# C-08 — Outbox rows are never marked published, so the retention job matches zero rows forever

| Field                      | Value                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Severity**               | Critical                                                                                                                                                     |
| **Area**                   | Event system / Database / Reliability                                                                                                                        |
| **Baseline**               | `main` @ `756bce3`                                                                                                                                           |
| **Blocker verdict**        | **True blocker.** Unbounded table growth with no retention path. Not a deferral — it is an unnoticed interaction between two individually-correct decisions. |
| **Public contract change** | **No.**                                                                                                                                                      |

---

## 1. Location

| File                                                   | Lines | What is there                                                                                            |
| ------------------------------------------------------ | ----- | -------------------------------------------------------------------------------------------------------- |
| `apps/runtime/src/scheduler.ts`                        | 22–38 | `buildJobs` — the only scheduled job, `outbox-prune`                                                     |
| `apps/runtime/src/scheduler.ts`                        | 31–33 | The `deleteMany` predicate that never matches                                                            |
| `packages/db/src/messaging/prisma-outbox-store.ts`     | 66–71 | `markPublished` — the only writer of `status: "published"`                                               |
| `packages/messaging/src/outbox/outbox-relay.ts`        | 14–19 | Doc: _"In production Debezium (CDC) streams the outbox table directly, so this relay is not deployed"_   |
| `packages/messaging/src/outbox/outbox-relay.ts`        | 30–35 | The only caller of `markPublished`                                                                       |
| `apps/runtime/src/worker.ts`                           | 18–46 | No `OutboxRelay` is registered                                                                           |
| `services/security/src/composition.ts`                 | 310   | `drainOutbox: async () => 0, // the OutboxRelay runs in the worker entrypoint in production` — **false** |
| `packages/db/prisma/schema/platform.prisma`            | 10–27 | `OutboxEntry` model, `@@map("outbox")`, `@@schema("platform")`                                           |
| `infrastructure/docker/debezium/outbox-connector.json` | 14–15 | `"table.include.list": "platform.outbox"`                                                                |
| `infrastructure/k8s/70-debezium.yaml`                  | 1–11  | Production CDC Deployment                                                                                |

---

## 2. Current implementation

### 2a. Production drains the outbox with CDC, not the relay — and that is deliberate and correct

```ts
// packages/messaging/src/outbox/outbox-relay.ts:14-19
/**
 * Drains pending outbox entries, publishes them, then marks them published. Used for local
 * development and tests. In **production** Debezium (CDC) streams the outbox table directly, so
 * this relay is not deployed (docs/architecture/05 §1.1). Safe to re-run: a still-pending entry
 * re-published is deduped by idempotent consumers.
 */
```

The CDC configuration is correct and I verified the alignment: the schema maps to `platform.outbox` (`platform.prisma:25-26`), the connector targets `platform.outbox` (`outbox-connector.json:15`), and the `EventRouter` field mappings (`id`, `key`, `payload`, `topic`) match the model's columns exactly. `infrastructure/k8s/70-debezium.yaml` deploys it. **This part is right.**

### 2b. But only the relay ever sets `status = 'published'`

```ts
// packages/db/src/messaging/prisma-outbox-store.ts:66-71
async markPublished(ids: readonly string[], publishedAt: string): Promise<void> {
  await this.prisma.outboxEntry.updateMany({
    where: { id: { in: [...ids] }, status: "pending" },
    data: { status: "published", publishedAt: new Date(publishedAt) },
  });
}
```

```
$ git grep -n "markPublished" -- '*.ts'   # production callers only
packages/messaging/src/outbox/outbox-relay.ts:32
```

Debezium reads the WAL. It never issues an `UPDATE`. So in production **every row stays `status: 'pending'` permanently.**

### 2c. The only retention job filters on the status that is never set

```ts
// apps/runtime/src/scheduler.ts:25-35
{
  name: "outbox-prune",
  intervalMs: 60 * 60 * 1000,
  run: async () => {
    const cutoff = new Date(
      core.clock.now().getTime() - core.config.OUTBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const result = await core.prisma.outboxEntry.deleteMany({
      where: { status: "published", createdAt: { lt: cutoff } },
    });
    core.logger.info("outbox pruned", { deleted: result.count });
  },
}
```

`status: "published"` matches **zero rows, permanently**. The job runs hourly, logs `{deleted: 0}`, and does nothing.

### 2d. A related false comment

```ts
// services/security/src/composition.ts:310
drainOutbox: async () => 0, // the OutboxRelay runs in the worker entrypoint in production
```

`apps/runtime/src/worker.ts` contains no relay. Returning `0` is correct behaviour (CDC drains it); the justification is wrong and would mislead the next reader.

---

## 3. Why it is incorrect

Two individually-defensible decisions that were never reconciled:

1. **The relay is the only component that closes the lifecycle**, and it is correctly not deployed in production.
2. **The pruner assumes the relay's lifecycle**, and was written as if it were.

Nobody owns the `pending → published` transition under CDC. The `status` column is effectively write-once in production, and every consumer of it — the pruner, `fetchPending`, and the `@@index([status, createdAt])` — is built around a state machine that only advances in dev and test.

A second, compounding defect: **35 of 39 contexts do not write to this table at all.** Per C-01 they construct `new InMemoryOutboxStore()` (e.g. `services/payments/src/composition.ts:58`), so their events never reach `platform.outbox` and are invisible to CDC regardless of the status problem.

---

## 4. Production impact

**Two distinct failures.**

**(a) Unbounded table growth with no retention path.** `OUTBOX_RETENTION_DAYS` defaults to 7 (`apps/runtime/src/config.ts:38`) and is honoured by a predicate that never matches. At commerce volume the outbox accumulates one row per domain event forever. Consequences in order of appearance:

- The `@@index([status, createdAt])` degenerates — every row shares `status = 'pending'`, so the index provides almost no selectivity and `fetchPending` (used by any dev/test relay, and by any future replay tooling) scales linearly with total history.
- Table and index bloat inflate autovacuum cost on a table that is on the **write path of every transaction in the platform** (`OutboxWriter.write` runs inside the aggregate's transaction, ADR-0003).
- Eventually: disk exhaustion on the primary.
- The one signal an operator would look for — `outbox pruned {deleted: N}` — reports `0` and looks healthy.

**(b) The four Prisma-backed contexts publish; the other 35 do not.** Only `customer-360`, `feature-registry`, `finance`, and `security` write to `platform.outbox`. Every integration event from Orders, Payments, Inventory, Catalog, Cart, Checkout, Shipping, Fulfillment, Returns, and Notifications is written to a per-process in-memory store and discarded on restart. Cross-context choreography does not function.

**No monitoring would catch either.** Per H-04 there is no `outbox_pending_rows` gauge — in fact no runtime metrics at all.

---

## 5. Smallest additive fix

Deleting rows that CDC has not yet streamed would lose events permanently, so the fix must be conservative. Two changes, both small.

### Step 1 — make the growth visible before changing deletion behaviour (~10 lines)

Add a gauge to the scheduler's job set. Under H-04 there is currently nowhere to publish it, so this depends on H-04 landing first — which is the correct order anyway.

```ts
{
  name: "outbox-depth",
  intervalMs: 60_000,
  run: async () => {
    const pending = await core.prisma.outboxEntry.count({ where: { status: "pending" } });
    const oldest = await core.prisma.outboxEntry.findFirst({
      where: { status: "pending" }, orderBy: { createdAt: "asc" }, select: { createdAt: true },
    });
    core.metrics.gauge("outbox_pending_rows", pending);
    if (oldest !== null) {
      core.metrics.gauge("outbox_oldest_pending_age_seconds",
        (core.clock.now().getTime() - oldest.createdAt.getTime()) / 1000);
    }
  },
}
```

`outbox_oldest_pending_age_seconds` is the true CDC-lag signal and should carry a page-level alert.

### Step 2 — make retention CDC-aware (change one predicate, ~15 lines)

Under CDC the safe deletion condition is _"Debezium's replication slot has advanced past this row"_, which Postgres exposes directly:

```ts
// Age-based retention, gated on the CDC slot having caught up. A row older than the retention
// window whose LSN the slot has already confirmed has certainly been streamed to Kafka.
const [slot] = await core.prisma.$queryRaw<{ confirmed_flush_lsn: string | null }[]>`
  SELECT confirmed_flush_lsn FROM pg_replication_slots WHERE slot_name = 'lumo_outbox'
`;
if (slot?.confirmed_flush_lsn == null) {
  core.logger.warn("outbox prune skipped: CDC slot not found or not streaming");
  return; // fail safe: never delete unstreamed events
}
const result = await core.prisma.outboxEntry.deleteMany({
  where: { createdAt: { lt: cutoff } }, // status no longer part of the predicate
});
```

The slot name `lumo_outbox` matches `outbox-connector.json:13` (`"slot.name": "lumo_outbox"`). Skipping the prune when the slot is missing is the fail-safe branch — it is better to grow than to delete an event that never reached Kafka.

### Step 3 — correct the false comment (1 line)

`services/security/src/composition.ts:310` — replace _"the OutboxRelay runs in the worker entrypoint in production"_ with _"Debezium CDC streams `platform.outbox` in production; no relay is deployed."_

**Do not** "fix" this by deploying `OutboxRelay` in the worker. That would create a second publisher racing Debezium and produce duplicate Kafka messages for every event. Consumers are idempotent, so it would not corrupt state — but it doubles broker load and defeats the point of CDC.

---

## 6. Public contract impact

**None.**

- `OutboxStore` (`@platform/messaging`) is unchanged — `append`, `fetchPending`, `markPublished` keep their signatures. `markPublished` remains in use by the dev/test relay.
- The `OutboxEntry` Prisma model is unchanged; no migration is required. The `status` column keeps its meaning (`pending | published`), it simply stops being part of the retention predicate.
- Adding scheduled jobs is additive — `buildJobs` returns an array and `startJobLoop` iterates it.
- `ScheduledJob` (exported from `apps/runtime/src/index.ts:5`) is unchanged.

---

## 7. Blocker or intentional deferral?

**True blocker, and not a deferral.**

`docs/KNOWN_GAPS.md` contains no gap covering outbox retention. On the contrary, both halves were built as if complete: `OUTBOX_RETENTION_DAYS` is a first-class validated config field, the pruner is the _only_ scheduled job in the platform, and `scheduler.ts:17-18` states its purpose plainly — _"Jobs today: outbox pruning (the outbox is a queue, not an event store — OutboxStore port contract)."_

That comment is exactly the right principle, and it is the one the current implementation fails to deliver: under CDC the outbox **is** behaving as an unbounded event store.

This is a genuine defect of the class that only appears when two correct decisions meet — and it is invisible without a live database, which is why C-09 (never booted) allowed it to survive review.

---

## 8. How this was verified

- `git grep -n "markPublished"` → 1 production caller (`outbox-relay.ts:32`), plus the store's own definition.
- `git grep -n 'status: "published"'` → `scheduler.ts:32` and `prisma-outbox-store.ts:69` only.
- `apps/runtime/src/scheduler.ts` read in full (85 lines).
- `packages/db/src/messaging/prisma-outbox-store.ts` read in full.
- `packages/messaging/src/outbox/outbox-relay.ts` read in full.
- `apps/runtime/src/worker.ts` read in full — no relay.
- `git grep -n "OutboxRelay"` → 41 hits, all in `services/*/src/composition.ts` (in-memory branches) and the package itself; none in `apps/`.
- Debezium ↔ schema alignment checked field-by-field: `platform.outbox`, `id`, `key`, `payload`, `topic`, `slot.name = lumo_outbox`.
- No code was modified.

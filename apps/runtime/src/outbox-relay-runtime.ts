import { PrismaOutboxStore } from "@platform/db";
import type { EventPublisher } from "@platform/messaging";
import { OutboxRelay } from "@platform/messaging";
import type { RuntimeCore } from "./composition";

export interface OutboxRelayHandle {
  stop(): void;
}

/**
 * C-8: publishes `platform.outbox` rows to Kafka on a timer.
 *
 * Every Prisma repository already appends integration events to the outbox inside the aggregate's
 * own transaction (ADR-0003) — that half has always worked. The publishing half did not exist on
 * the production path: `OutboxRelay` was instantiated only in each context's IN-MEMORY composition
 * branch, and production was designed around Debezium CDC streaming the table directly
 * (`infrastructure/k8s/70-debezium.yaml`). Debezium needs Kafka Connect, which needs Docker, which
 * this deployment target does not have. So outbox rows accumulated and nothing ever consumed them.
 *
 * Single-flight across instances via the same `RedisDistributedLock` the scheduler already uses:
 * two workers must not publish the same batch. `markPublished` is conditional on
 * `status = 'pending'` (`PrismaOutboxStore.markPublished`), so even a lock failure degrades to
 * at-least-once delivery, which every consumer already tolerates (Postgres inbox idempotency,
 * ADR-0005).
 *
 * Returns `null` when `OUTBOX_RELAY_ENABLED` is off, so an unmigrated deployment is unchanged.
 */
export function startOutboxRelay(
  core: RuntimeCore,
  producer: EventPublisher,
): OutboxRelayHandle | null {
  if (!core.config.OUTBOX_RELAY_ENABLED) return null;

  const relay = new OutboxRelay({
    store: new PrismaOutboxStore(core.prisma),
    publisher: producer,
    clock: core.clock,
    batchSize: core.config.OUTBOX_RELAY_BATCH_SIZE,
  });

  const intervalMs = core.config.OUTBOX_RELAY_INTERVAL_MS;
  const timer = setInterval(() => {
    void (async () => {
      const handle = await core.distributedLock.acquire("outbox-relay", intervalMs * 2);
      if (handle === null) return;
      try {
        const published = await relay.drainOnce();
        if (published > 0) {
          core.logger.info("outbox relay published", { count: published });
          core.metrics.recordOutboxPublished(published);
        }
      } catch (error) {
        core.logger.error("outbox relay failed", { error: String(error) });
        core.metrics.recordOutboxRelayFailure();
      } finally {
        await handle.release();
      }
    })();
  }, intervalMs);

  return { stop: () => clearInterval(timer) };
}

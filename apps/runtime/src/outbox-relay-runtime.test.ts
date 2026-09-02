import { describe, expect, it, vi } from "vitest";
import type { Clock } from "@platform/contracts";
import type { Logger } from "@platform/utils";
import type { EventPublisher } from "@platform/messaging";
import { startOutboxRelay } from "./outbox-relay-runtime";
import type { RuntimeCore } from "./composition";

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

/** A single pending `platform.outbox` row, shaped like what `PrismaOutboxStore.fetchPending` reads. */
function pendingEntryRow() {
  return {
    id: "outbox-1",
    topic: "orders.paid.v1",
    key: "order-1",
    contentType: "application/json",
    payload: new Uint8Array([1, 2, 3]),
    headers: {},
    status: "pending",
    createdAt: new Date("2026-08-23T00:00:00.000Z"),
    publishedAt: null,
  };
}

function fakeCore(overrides: {
  enabled: boolean;
  intervalMs?: number;
  batchSize?: number;
  lockAcquire?: ReturnType<typeof vi.fn>;
  findMany?: ReturnType<typeof vi.fn>;
  updateMany?: ReturnType<typeof vi.fn>;
}): RuntimeCore & {
  metricsSpies: {
    recordOutboxPublished: ReturnType<typeof vi.fn>;
    recordOutboxRelayFailure: ReturnType<typeof vi.fn>;
  };
} {
  const clock: Clock = { now: () => new Date("2026-08-23T00:00:00.000Z") };
  const release = vi.fn().mockResolvedValue(true);
  const lockAcquire = overrides.lockAcquire ?? vi.fn().mockResolvedValue({ release });
  const recordOutboxPublished = vi.fn();
  const recordOutboxRelayFailure = vi.fn();

  const core = {
    config: {
      OUTBOX_RELAY_ENABLED: overrides.enabled,
      OUTBOX_RELAY_INTERVAL_MS: overrides.intervalMs ?? 1000,
      OUTBOX_RELAY_BATCH_SIZE: overrides.batchSize ?? 200,
    } as RuntimeCore["config"],
    clock,
    logger: silentLogger,
    distributedLock: { acquire: lockAcquire } as unknown as RuntimeCore["distributedLock"],
    metrics: {
      recordOutboxPublished,
      recordOutboxRelayFailure,
    } as unknown as RuntimeCore["metrics"],
    prisma: {
      outboxEntry: {
        findMany: overrides.findMany ?? vi.fn().mockResolvedValue([]),
        updateMany: overrides.updateMany ?? vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as RuntimeCore["prisma"],
  } as RuntimeCore;

  return Object.assign(core, { metricsSpies: { recordOutboxPublished, recordOutboxRelayFailure } });
}

function fakeProducer(publishBatch = vi.fn().mockResolvedValue(undefined)): EventPublisher {
  return { publish: vi.fn(), publishBatch };
}

describe("outbox relay runtime (C-8)", () => {
  it("returns null when the relay is disabled", () => {
    const core = fakeCore({ enabled: false });
    expect(startOutboxRelay(core, fakeProducer())).toBeNull();
  });

  it("drains pending entries on each tick while holding the distributed lock", async () => {
    vi.useFakeTimers();
    try {
      const publishBatch = vi.fn().mockResolvedValue(undefined);
      const updateMany = vi.fn().mockResolvedValue({ count: 1 });
      const core = fakeCore({
        enabled: true,
        intervalMs: 1000,
        findMany: vi.fn().mockResolvedValue([pendingEntryRow()]),
        updateMany,
      });

      const handle = startOutboxRelay(core, fakeProducer(publishBatch));
      expect(handle).not.toBeNull();

      await vi.advanceTimersByTimeAsync(1000);

      expect(publishBatch).toHaveBeenCalledTimes(1);
      expect(updateMany).toHaveBeenCalledTimes(1);
      expect(core.metricsSpies.recordOutboxPublished).toHaveBeenCalledWith(1);

      handle?.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the tick when another instance holds the lock", async () => {
    vi.useFakeTimers();
    try {
      const publishBatch = vi.fn().mockResolvedValue(undefined);
      const core = fakeCore({
        enabled: true,
        intervalMs: 1000,
        lockAcquire: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([pendingEntryRow()]),
      });

      const handle = startOutboxRelay(core, fakeProducer(publishBatch));
      await vi.advanceTimersByTimeAsync(1000);

      expect(publishBatch).not.toHaveBeenCalled();

      handle?.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("records a failure and still releases the lock when a tick throws", async () => {
    vi.useFakeTimers();
    try {
      const release = vi.fn().mockResolvedValue(true);
      const core = fakeCore({
        enabled: true,
        intervalMs: 1000,
        lockAcquire: vi.fn().mockResolvedValue({ release }),
        findMany: vi.fn().mockRejectedValue(new Error("db unreachable")),
      });

      const handle = startOutboxRelay(core, fakeProducer());
      await vi.advanceTimersByTimeAsync(1000);

      expect(core.metricsSpies.recordOutboxRelayFailure).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);

      handle?.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop() clears the interval so no further ticks fire", async () => {
    vi.useFakeTimers();
    try {
      const publishBatch = vi.fn().mockResolvedValue(undefined);
      const core = fakeCore({
        enabled: true,
        intervalMs: 1000,
        findMany: vi.fn().mockResolvedValue([pendingEntryRow()]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      });

      const handle = startOutboxRelay(core, fakeProducer(publishBatch));
      handle?.stop();

      await vi.advanceTimersByTimeAsync(5000);

      expect(publishBatch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

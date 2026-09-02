import { describe, expect, it, vi } from "vitest";
import type { Clock } from "@platform/contracts";
import type { Logger } from "@platform/utils";
import { buildJobs, createCdcWatchdogState, runCdcWatchdog } from "./scheduler";
import type { RuntimeCore } from "./composition";

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

/** A healthy, actively-streaming replication slot — the default for tests not exercising the gate itself. */
function healthySlot(): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue([{ confirmed_flush_lsn: "0/1A2B3C4" }]);
}

function fakeCore(prisma: {
  count: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
  queryRaw?: ReturnType<typeof vi.fn>;
}): RuntimeCore {
  const clock: Clock = { now: () => new Date("2026-08-12T00:00:00.000Z") };
  return {
    config: { OUTBOX_RETENTION_DAYS: 7 } as RuntimeCore["config"],
    clock,
    logger: silentLogger,
    // Deliberately partial fixture (only the fields this suite exercises) — needs the `unknown`
    // hop since it has no structural overlap with the full `RuntimeCore["prisma"]` (Database) type.
    prisma: {
      outboxEntry: { count: prisma.count, deleteMany: prisma.deleteMany },
      $queryRaw: prisma.queryRaw ?? healthySlot(),
    } as unknown as RuntimeCore["prisma"],
  } as RuntimeCore;
}

describe("outbox-prune job (C2-3)", () => {
  it("prunes by age alone, NOT by status — production (CDC) rows never reach status=published", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const core = fakeCore({ count, deleteMany });

    await buildJobs(core)[0]!.run();

    // The predicate must be age-only: no `status` key anywhere in the delete filter.
    expect(deleteMany).toHaveBeenCalledTimes(1);
    const deleteArgs = deleteMany.mock.calls[0]![0];
    expect(deleteArgs.where).not.toHaveProperty("status");
    expect(deleteArgs.where.createdAt.lt).toBeInstanceOf(Date);
    expect(deleteArgs.where.createdAt.lt.toISOString()).toBe("2026-08-05T00:00:00.000Z");
  });

  it("warns (does not throw or skip pruning) when rows past retention were never marked published", async () => {
    const count = vi.fn().mockResolvedValue(5); // 5 stale "pending" rows — CDC never confirmed
    const deleteMany = vi.fn().mockResolvedValue({ count: 5 });
    const core = fakeCore({ count, deleteMany });
    const warn = vi.fn();
    // `Logger`'s methods don't structurally overlap with a bare mock-fn shape (comparability fails).
    (core.logger as unknown as { warn: typeof warn }).warn = warn;

    await buildJobs(core)[0]!.run();

    expect(warn).toHaveBeenCalledWith(
      "outbox pruning rows CDC never confirmed published",
      expect.objectContaining({ count: 5 }),
    );
    // Still prunes — the warning is a signal, not a skip.
    expect(deleteMany).toHaveBeenCalledTimes(1);
  });

  it("does not warn when nothing is stuck past retention", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const core = fakeCore({ count, deleteMany });
    const warn = vi.fn();
    // `Logger`'s methods don't structurally overlap with a bare mock-fn shape (comparability fails).
    (core.logger as unknown as { warn: typeof warn }).warn = warn;

    await buildJobs(core)[0]!.run();

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("outbox-prune job — relay mode (C-8)", () => {
  it("prunes by status=published + age, and never queries the replication slot", async () => {
    const count = vi.fn().mockResolvedValue(0); // no stuck pending rows
    const deleteMany = vi.fn().mockResolvedValue({ count: 4 });
    const queryRaw = vi.fn(); // must not be called in relay mode
    const core = fakeCore({ count, deleteMany, queryRaw });
    (core.config as unknown as { OUTBOX_RELAY_ENABLED: boolean }).OUTBOX_RELAY_ENABLED = true;

    await buildJobs(core)[0]!.run();

    expect(queryRaw).not.toHaveBeenCalled();
    expect(deleteMany).toHaveBeenCalledTimes(1);
    const deleteArgs = deleteMany.mock.calls[0]![0];
    expect(deleteArgs.where.status).toBe("published");
    expect(deleteArgs.where.createdAt.lt).toBeInstanceOf(Date);
  });

  it("errors (does not throw) when rows past retention are still unpublished", async () => {
    const count = vi.fn().mockResolvedValue(3); // 3 stale pending rows the relay never delivered
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const core = fakeCore({ count, deleteMany });
    (core.config as unknown as { OUTBOX_RELAY_ENABLED: boolean }).OUTBOX_RELAY_ENABLED = true;
    const error = vi.fn();
    (core.logger as unknown as { error: typeof error }).error = error;

    await buildJobs(core)[0]!.run();

    expect(error).toHaveBeenCalledWith(
      "outbox rows past retention are still unpublished",
      expect.objectContaining({ count: 3 }),
    );
    expect(deleteMany).toHaveBeenCalledTimes(1); // still prunes the published rows
  });
});

describe("outbox-prune job — CDC replication-slot fail-safe (Phase A.13, Task 8)", () => {
  it("skips pruning entirely when the Debezium replication slot does not exist (never provisioned / dropped)", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const queryRaw = vi.fn().mockResolvedValue([]); // no matching slot row
    const core = fakeCore({ count, deleteMany, queryRaw });
    const warn = vi.fn();
    (core.logger as unknown as { warn: typeof warn }).warn = warn;

    await buildJobs(core)[0]!.run();

    expect(deleteMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "outbox prune skipped: CDC replication slot not found or not streaming",
    );
  });

  it("skips pruning when the slot exists but has never confirmed a flush (confirmed_flush_lsn is null)", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const queryRaw = vi.fn().mockResolvedValue([{ confirmed_flush_lsn: null }]);
    const core = fakeCore({ count, deleteMany, queryRaw });

    await buildJobs(core)[0]!.run();

    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("prunes normally when the slot is present and actively streaming", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const core = fakeCore({ count, deleteMany }); // default healthySlot()

    await buildJobs(core)[0]!.run();

    expect(deleteMany).toHaveBeenCalledTimes(1);
  });
});

describe("cdc-watchdog job (Phase A.23, Task 3/4)", () => {
  const silent: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => silent,
  };

  function fakeMetrics(): {
    recordCdcTaskState: ReturnType<typeof vi.fn>;
    recordCdcWatchdogRestart: ReturnType<typeof vi.fn>;
    recordCdcWatchdogRestartSkipped: ReturnType<typeof vi.fn>;
  } {
    return {
      recordCdcTaskState: vi.fn(),
      recordCdcWatchdogRestart: vi.fn(),
      recordCdcWatchdogRestartSkipped: vi.fn(),
    };
  }

  function statusResponse(tasks: { id: number; state: string }[]): Response {
    return {
      ok: true,
      status: 200,
      json: async () => ({ name: "x", connector: { state: "RUNNING" }, tasks }),
    } as unknown as Response;
  }

  function restartResponse(status = 204): Response {
    return { ok: status < 300, status } as unknown as Response;
  }

  // Case A — healthy connector: watchdog does nothing.
  it("does not call restart when every task is RUNNING", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(statusResponse([{ id: 0, state: "RUNNING" }]));
    const metrics = fakeMetrics();
    const clock: Clock = { now: () => new Date("2026-08-14T00:00:00.000Z") };

    await runCdcWatchdog({
      connectUrl: "http://connect:8083",
      connectors: ["lumo-outbox"],
      maxRestarts: 5,
      restartWindowMs: 60 * 60 * 1000,
      state: createCdcWatchdogState(),
      clock,
      logger: silent,
      metrics,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1); // status only, no restart call
    expect(metrics.recordCdcTaskState).toHaveBeenCalledWith("lumo-outbox", "0", false);
    expect(metrics.recordCdcWatchdogRestart).not.toHaveBeenCalled();
  });

  // Case B — transient non-FAILED states (task mid-recovery) must never trigger a restart either.
  it.each(["UNASSIGNED", "PAUSED", "RESTARTING"])(
    "does not call restart for a transient task state (%s)",
    async (state) => {
      const fetchImpl = vi.fn().mockResolvedValue(statusResponse([{ id: 0, state }]));
      const metrics = fakeMetrics();
      const clock: Clock = { now: () => new Date("2026-08-14T00:00:00.000Z") };

      await runCdcWatchdog({
        connectUrl: "http://connect:8083",
        connectors: ["lumo-outbox"],
        maxRestarts: 5,
        restartWindowMs: 60 * 60 * 1000,
        state: createCdcWatchdogState(),
        clock,
        logger: silent,
        metrics,
        fetchImpl,
      });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  // Case C — FAILED task: watchdog detects and restarts it.
  it("restarts a FAILED task via POST /connectors/:name/tasks/:id/restart", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(statusResponse([{ id: 0, state: "FAILED" }]))
      .mockResolvedValueOnce(restartResponse(204));
    const metrics = fakeMetrics();
    const clock: Clock = { now: () => new Date("2026-08-14T00:00:00.000Z") };

    await runCdcWatchdog({
      connectUrl: "http://connect:8083",
      connectors: ["lumo-outbox"],
      maxRestarts: 5,
      restartWindowMs: 60 * 60 * 1000,
      state: createCdcWatchdogState(),
      clock,
      logger: silent,
      metrics,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://connect:8083/connectors/lumo-outbox/tasks/0/restart",
      { method: "POST" },
    );
    expect(metrics.recordCdcWatchdogRestart).toHaveBeenCalledWith("lumo-outbox", "0");
  });

  // Case D — repeated failure must not create an infinite restart loop.
  it("stops restarting once the rolling-window cap is reached, and reports it as skipped", async () => {
    const metrics = fakeMetrics();
    let nowMs = Date.parse("2026-08-14T00:00:00.000Z");
    const clock: Clock = { now: () => new Date(nowMs) };
    const state = createCdcWatchdogState();
    const maxRestarts = 3;

    for (let tick = 0; tick < 6; tick++) {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(statusResponse([{ id: 0, state: "FAILED" }]))
        .mockResolvedValueOnce(restartResponse(204));

      await runCdcWatchdog({
        connectUrl: "http://connect:8083",
        connectors: ["lumo-outbox"],
        maxRestarts,
        restartWindowMs: 60 * 60 * 1000,
        state,
        clock,
        logger: silent,
        metrics,
        fetchImpl,
      });

      nowMs += 30_000; // next poll tick, well inside the 1h window
    }

    // Exactly maxRestarts real restarts were issued across the 6 ticks, never more.
    expect(metrics.recordCdcWatchdogRestart).toHaveBeenCalledTimes(maxRestarts);
    // Every tick beyond the cap was recorded as skipped, not silently dropped.
    expect(metrics.recordCdcWatchdogRestartSkipped).toHaveBeenCalledTimes(6 - maxRestarts);
  });

  // Case D (continued) — the cap is a rolling window, not a permanent lockout: once old restarts
  // age out of the window, recovery attempts resume (so a connector fixed hours later isn't stuck).
  it("resumes restarting once earlier attempts age out of the rolling window", async () => {
    const metrics = fakeMetrics();
    let nowMs = Date.parse("2026-08-14T00:00:00.000Z");
    const clock: Clock = { now: () => new Date(nowMs) };
    const state = createCdcWatchdogState();
    const restartWindowMs = 60 * 60 * 1000;

    const run = async (): Promise<void> => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(statusResponse([{ id: 0, state: "FAILED" }]))
        .mockResolvedValueOnce(restartResponse(204));
      await runCdcWatchdog({
        connectUrl: "http://connect:8083",
        connectors: ["lumo-outbox"],
        maxRestarts: 1,
        restartWindowMs,
        state,
        clock,
        logger: silent,
        metrics,
        fetchImpl,
      });
    };

    await run(); // 1st restart — under the cap of 1
    await run(); // 2nd attempt, same window — capped, skipped
    expect(metrics.recordCdcWatchdogRestart).toHaveBeenCalledTimes(1);
    expect(metrics.recordCdcWatchdogRestartSkipped).toHaveBeenCalledTimes(1);

    nowMs += restartWindowMs + 1_000; // advance past the window
    await run(); // window reset — restart allowed again

    expect(metrics.recordCdcWatchdogRestart).toHaveBeenCalledTimes(2);
  });

  // Case G — multiple tasks/connectors: only the affected task/connector is restarted.
  it("only restarts the FAILED connector's task, leaving a healthy connector untouched", async () => {
    const metrics = fakeMetrics();
    const clock: Clock = { now: () => new Date("2026-08-14T00:00:00.000Z") };
    const fetchImpl = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/connectors/lumo-outbox/status")) {
        return statusResponse([{ id: 0, state: "FAILED" }]);
      }
      if (url.endsWith("/connectors/lumo-other/status")) {
        return statusResponse([{ id: 0, state: "RUNNING" }]);
      }
      if (url.includes("/lumo-outbox/tasks/0/restart") && init?.method === "POST") {
        return restartResponse(204);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await runCdcWatchdog({
      connectUrl: "http://connect:8083",
      connectors: ["lumo-outbox", "lumo-other"],
      maxRestarts: 5,
      restartWindowMs: 60 * 60 * 1000,
      state: createCdcWatchdogState(),
      clock,
      logger: silent,
      metrics,
      fetchImpl,
    });

    expect(metrics.recordCdcWatchdogRestart).toHaveBeenCalledTimes(1);
    expect(metrics.recordCdcWatchdogRestart).toHaveBeenCalledWith("lumo-outbox", "0");
    expect(fetchImpl).not.toHaveBeenCalledWith(
      expect.stringContaining("/lumo-other/tasks"),
      expect.anything(),
    );
  });

  // Resilience: a status-endpoint failure (Connect briefly unreachable) must not throw and must not
  // be mistaken for a FAILED task — no restart call is made on top of an already-uncertain read.
  it("does not throw and does not attempt a restart when the status check itself fails", async () => {
    const metrics = fakeMetrics();
    const clock: Clock = { now: () => new Date("2026-08-14T00:00:00.000Z") };
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      runCdcWatchdog({
        connectUrl: "http://connect:8083",
        connectors: ["lumo-outbox"],
        maxRestarts: 5,
        restartWindowMs: 60 * 60 * 1000,
        state: createCdcWatchdogState(),
        clock,
        logger: silent,
        metrics,
        fetchImpl,
      }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(metrics.recordCdcWatchdogRestart).not.toHaveBeenCalled();
  });

  // The job itself is a no-op (never calls fetch) when KAFKA_CONNECT_URL is unset — local/tests
  // never require Kafka Connect to build or run the scheduler's job list.
  it("the scheduled job no-ops when KAFKA_CONNECT_URL is not configured", async () => {
    const clock: Clock = { now: () => new Date("2026-08-14T00:00:00.000Z") };
    const core = {
      config: {
        KAFKA_CONNECT_URL: undefined,
        KAFKA_CONNECT_CDC_CONNECTORS: "lumo-outbox",
        CDC_WATCHDOG_INTERVAL_MS: 30_000,
        CDC_WATCHDOG_MAX_RESTARTS: 5,
        CDC_WATCHDOG_RESTART_WINDOW_MS: 60 * 60 * 1000,
        OUTBOX_RETENTION_DAYS: 7,
      } as unknown as RuntimeCore["config"],
      clock,
      logger: silent,
      metrics: fakeMetrics() as unknown as RuntimeCore["metrics"],
      prisma: {
        outboxEntry: { count: vi.fn(), deleteMany: vi.fn() },
        $queryRaw: vi.fn(),
      } as unknown as RuntimeCore["prisma"],
    } as RuntimeCore;

    const job = buildJobs(core).find((j) => j.name === "cdc-watchdog");
    expect(job).toBeDefined();
    await expect(job!.run()).resolves.toBeUndefined();
  });
});

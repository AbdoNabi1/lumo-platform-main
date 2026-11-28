import type { Clock } from "@platform/contracts";
import type { RetrySweepReport } from "@platform/tracking";
import type { Logger } from "@platform/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeCore } from "./composition";
import { DELIVERY_RETRY_LOCK_KEY, startDeliveryRetrySweep } from "./delivery-retry-runtime";

const T0 = Date.parse("2026-11-27T10:00:00.000Z");
const clock: Clock = { now: () => new Date() };

function fakeCore(overrides: { lockAcquire?: ReturnType<typeof vi.fn>; intervalMs?: number } = {}) {
  const release = vi.fn().mockResolvedValue(true);
  const lockAcquire = overrides.lockAcquire ?? vi.fn().mockResolvedValue({ release });
  const info = vi.fn();
  const error = vi.fn();
  const logger = {
    debug: vi.fn(),
    info,
    warn: vi.fn(),
    error,
    child: () => logger,
  } as unknown as Logger;
  const core = {
    config: { TRACKING_RETRY_SWEEP_INTERVAL_MS: overrides.intervalMs ?? 1_000 },
    clock,
    logger,
    distributedLock: { acquire: lockAcquire },
  } as unknown as RuntimeCore;
  return { core, lockAcquire, release, info, error };
}

const REPORT: RetrySweepReport = {
  claimed: 3,
  delivered: 2,
  rescheduled: 1,
  deadLettered: 0,
  errored: 0,
};
const EMPTY: RetrySweepReport = {
  claimed: 0,
  delivered: 0,
  rescheduled: 0,
  deadLettered: 0,
  errored: 0,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("delivery retry runtime (P1-D2)", () => {
  it("sweeps on the interval under the single-flight lock and releases it", async () => {
    const { core, lockAcquire, release } = fakeCore({ intervalMs: 1_000 });
    const sweep = vi.fn().mockResolvedValue(REPORT);
    const handle = startDeliveryRetrySweep(core, sweep);

    expect(sweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(lockAcquire).toHaveBeenCalledWith(DELIVERY_RETRY_LOCK_KEY, expect.any(Number));
    expect(lockAcquire.mock.calls[0]?.[1]).toBeGreaterThanOrEqual(6 * 60_000);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it("logs counts only, and nothing for an empty pass", async () => {
    const { core, info } = fakeCore();
    const sweep = vi.fn().mockResolvedValueOnce(REPORT).mockResolvedValue(EMPTY);
    const handle = startDeliveryRetrySweep(core, sweep);

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("tracking delivery retry sweep", { ...REPORT });
    handle.stop();
  });

  it("another worker holding the lock is not a failure and no sweep runs", async () => {
    const lockAcquire = vi.fn().mockResolvedValue(null);
    const { core, error } = fakeCore({ lockAcquire });
    const sweep = vi.fn().mockResolvedValue(REPORT);
    const handle = startDeliveryRetrySweep(core, sweep);

    await vi.advanceTimersByTimeAsync(3_000);

    expect(sweep).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    handle.stop();
  });

  it("a failing sweep is logged without its message, releases the lock and tries again next tick", async () => {
    const { core, error, release } = fakeCore();
    const sweep = vi
      .fn()
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED postgres://u:secret@db"))
      .mockResolvedValue(EMPTY);
    const handle = startDeliveryRetrySweep(core, sweep);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(error).toHaveBeenCalledWith("tracking delivery retry sweep failed", { error: "Error" });
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret");
    expect(release).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sweep).toHaveBeenCalledTimes(2);
    handle.stop();
  });

  it("a slow pass is not overlapped by the next tick", async () => {
    const { core } = fakeCore();
    let finish: (report: RetrySweepReport) => void = () => undefined;
    const sweep = vi.fn().mockImplementation(
      () =>
        new Promise<RetrySweepReport>((resolve) => {
          finish = resolve;
        }),
    );
    const handle = startDeliveryRetrySweep(core, sweep);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(sweep).toHaveBeenCalledTimes(1);

    finish(EMPTY);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sweep).toHaveBeenCalledTimes(2);
    handle.stop();
  });

  it("stop() ends the timer", async () => {
    const { core } = fakeCore();
    const sweep = vi.fn().mockResolvedValue(EMPTY);
    const handle = startDeliveryRetrySweep(core, sweep);
    handle.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sweep).not.toHaveBeenCalled();
  });
});

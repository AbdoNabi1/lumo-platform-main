import type { Clock } from "@platform/contracts";
import type { Logger } from "@platform/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeCore } from "./composition";
import { LEAD_TRACKING_LOCK_KEY, startLeadTrackingSweep } from "./lead-tracking-sweep-runtime";

const T0 = Date.parse("2026-11-28T10:00:00.000Z");
const clock: Clock = { now: () => new Date() };

interface Report {
  readonly tenants: number;
  readonly scanned: number;
  readonly sent: number;
  readonly expired: number;
  readonly errored: number;
}

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

const REPORT: Report = { tenants: 1, scanned: 3, sent: 2, expired: 1, errored: 0 };
const EMPTY: Report = { tenants: 0, scanned: 0, sent: 0, expired: 0, errored: 0 };

beforeEach(() => {
  expect.hasAssertions();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("lead tracking sweep runtime (P2-D9)", () => {
  it("sweeps on the interval under its own single-flight lock and releases it", async () => {
    const { core, lockAcquire, release } = fakeCore({ intervalMs: 1_000 });
    const sweep = vi.fn().mockResolvedValue(REPORT);
    const handle = startLeadTrackingSweep(core, sweep);

    expect(sweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(LEAD_TRACKING_LOCK_KEY).toBe("tracking-lead-sweep");
    expect(lockAcquire).toHaveBeenCalledWith(LEAD_TRACKING_LOCK_KEY, expect.any(Number));
    // a pass can run its own 4-minute budget plus the sends already in flight: the lock outlives that
    expect(lockAcquire.mock.calls[0]?.[1]).toBeGreaterThanOrEqual(6 * 60_000);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it("logs counts only, and nothing for an empty pass", async () => {
    const { core, info } = fakeCore();
    const sweep = vi.fn().mockResolvedValueOnce(REPORT).mockResolvedValue(EMPTY);
    const handle = startLeadTrackingSweep(core, sweep);

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("lead tracking sweep", { ...REPORT });
    handle.stop();
  });

  it("another worker holding the lock is not a failure and no sweep runs", async () => {
    const lockAcquire = vi.fn().mockResolvedValue(null);
    const { core, error } = fakeCore({ lockAcquire });
    const sweep = vi.fn().mockResolvedValue(REPORT);
    const handle = startLeadTrackingSweep(core, sweep);

    await vi.advanceTimersByTimeAsync(3_000);

    expect(sweep).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    handle.stop();
  });

  it("a failing sweep is logged by error name only, releases the lock and tries again next tick", async () => {
    const { core, error, release } = fakeCore();
    const sweep = vi
      .fn()
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED postgres://u:secret@db"))
      .mockResolvedValue(EMPTY);
    const handle = startLeadTrackingSweep(core, sweep);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(error).toHaveBeenCalledWith("lead tracking sweep failed", { error: "Error" });
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret");
    expect(release).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sweep).toHaveBeenCalledTimes(2);
    handle.stop();
  });

  it("a slow pass is not overlapped by the next tick", async () => {
    const { core } = fakeCore();
    let finish: (report: Report) => void = () => undefined;
    const sweep = vi.fn().mockImplementation(
      () =>
        new Promise<Report>((resolve) => {
          finish = resolve;
        }),
    );
    const handle = startLeadTrackingSweep(core, sweep);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(sweep).toHaveBeenCalledTimes(1);

    finish(EMPTY);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sweep).toHaveBeenCalledTimes(2);
    handle.stop();
  });

  it("does not share the delivery-retry lock: the two sweeps run side by side", () => {
    expect(LEAD_TRACKING_LOCK_KEY).not.toBe("tracking-delivery-retry");
  });

  it("stop() ends the timer", async () => {
    const { core } = fakeCore();
    const sweep = vi.fn().mockResolvedValue(EMPTY);
    const handle = startLeadTrackingSweep(core, sweep);
    handle.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sweep).not.toHaveBeenCalled();
  });
});

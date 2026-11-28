import type { Clock } from "@platform/contracts";
import type { TrackingRetentionReport } from "@platform/tracking";
import type { Logger } from "@platform/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeCore } from "./composition";
import { loadRuntimeConfig } from "./config";
import { TRACKING_RETENTION_LOCK_KEY, startTrackingRetention } from "./tracking-retention-runtime";

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
    config: { TRACKING_RETENTION_INTERVAL_MS: overrides.intervalMs ?? 60_000 },
    clock,
    logger,
    distributedLock: { acquire: lockAcquire },
  } as unknown as RuntimeCore;
  return { core, lockAcquire, release, info, error };
}

const REPORT: TrackingRetentionReport = {
  profilesDeleted: 4,
  eventsRedacted: 120,
  snapshotsRedacted: 0,
  snapshotsDeleted: 0,
  tenantsVisited: 2,
  errored: 0,
};
const EMPTY: TrackingRetentionReport = {
  profilesDeleted: 0,
  eventsRedacted: 0,
  snapshotsRedacted: 0,
  snapshotsDeleted: 0,
  tenantsVisited: 0,
  errored: 0,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("tracking retention runtime (P1-D10)", () => {
  it("runs a pass on the interval under the single-flight lock and releases it", async () => {
    const { core, lockAcquire, release } = fakeCore({ intervalMs: 60_000 });
    const run = vi.fn().mockResolvedValue(REPORT);
    const handle = startTrackingRetention(core, run);

    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(lockAcquire).toHaveBeenCalledWith(TRACKING_RETENTION_LOCK_KEY, expect.any(Number));
    expect(lockAcquire.mock.calls[0]?.[1]).toBeGreaterThanOrEqual(6 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it("logs counts only, and nothing for a pass that found no work", async () => {
    const { core, info } = fakeCore();
    const run = vi.fn().mockResolvedValueOnce(REPORT).mockResolvedValue(EMPTY);
    const handle = startTrackingRetention(core, run);

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("tracking retention pass", { ...REPORT });
    handle.stop();
  });

  it("a pass that only cleaned attribution snapshots is still logged (counts only)", async () => {
    const { core, info } = fakeCore();
    const onlySnapshots: TrackingRetentionReport = {
      ...EMPTY,
      snapshotsRedacted: 3,
      snapshotsDeleted: 1,
      tenantsVisited: 1,
    };
    const run = vi.fn().mockResolvedValue(onlySnapshots);
    const handle = startTrackingRetention(core, run);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(info).toHaveBeenCalledWith("tracking retention pass", { ...onlySnapshots });
    handle.stop();
  });

  it("another worker holding the lock is not a failure and no pass runs", async () => {
    const lockAcquire = vi.fn().mockResolvedValue(null);
    const { core, error } = fakeCore({ lockAcquire });
    const run = vi.fn().mockResolvedValue(REPORT);
    const handle = startTrackingRetention(core, run);

    await vi.advanceTimersByTimeAsync(180_000);

    expect(run).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    handle.stop();
  });

  it("a failing pass is logged by error name only, releases the lock and tries again next tick", async () => {
    const { core, error, release } = fakeCore();
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED postgres://u:secret@db"))
      .mockResolvedValue(EMPTY);
    const handle = startTrackingRetention(core, run);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(error).toHaveBeenCalledWith("tracking retention pass failed", { error: "Error" });
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret");
    expect(release).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    handle.stop();
  });

  it("a slow pass is not overlapped by the next tick", async () => {
    const { core } = fakeCore();
    let finish: (report: TrackingRetentionReport) => void = () => undefined;
    const run = vi.fn().mockImplementation(
      () =>
        new Promise<TrackingRetentionReport>((resolve) => {
          finish = resolve;
        }),
    );
    const handle = startTrackingRetention(core, run);

    await vi.advanceTimersByTimeAsync(180_000);
    expect(run).toHaveBeenCalledTimes(1);

    finish(EMPTY);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    handle.stop();
  });

  it("stop() ends the timer", async () => {
    const { core } = fakeCore();
    const run = vi.fn().mockResolvedValue(EMPTY);
    const handle = startTrackingRetention(core, run);
    handle.stop();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("config: TRACKING_RETENTION_INTERVAL_MS", () => {
  const base = {
    DATABASE_URL: "postgresql://lumo:***@localhost:5432/lumo",
    REDIS_URL: "redis://localhost:6379",
    AUTH_ISSUER_URL: "https://auth.morbeh.local",
    AUTH_JWKS_URL: "https://auth.morbeh.local/.well-known/jwks.json",
    APP_ENV: "local",
  } as NodeJS.ProcessEnv;

  it("defaults to six hours and refuses a busy loop", () => {
    expect(loadRuntimeConfig(base).TRACKING_RETENTION_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
    expect(() => loadRuntimeConfig({ ...base, TRACKING_RETENTION_INTERVAL_MS: "1000" })).toThrow();
  });
});

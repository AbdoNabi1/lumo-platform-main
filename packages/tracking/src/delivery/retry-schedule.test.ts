import { describe, expect, it } from "vitest";

import {
  DEFAULT_VENDOR_WINDOW_MS,
  DURABLE_RETRY_BACKOFF_MS,
  planNextRetry,
  vendorWindowMs,
  windowExpiresAtMs as windowExpiryOf,
} from "./retry-schedule";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-11-27T12:00:00.000Z");

describe("vendor windows (P1-D2)", () => {
  it("GA4 is 72 hours; Meta, TikTok and Snap are 7 days minus a 1 hour safety margin", () => {
    expect(vendorWindowMs("ga4")).toBe(72 * HOUR);
    for (const platform of ["meta", "tiktok", "snap"]) {
      expect(vendorWindowMs(platform)).toBe(7 * DAY - HOUR);
    }
  });

  it("an unknown platform gets the narrowest known window, never a longer one", () => {
    expect(vendorWindowMs("some_new_vendor")).toBe(DEFAULT_VENDOR_WINDOW_MS);
    expect(DEFAULT_VENDOR_WINDOW_MS).toBe(72 * HOUR);
  });

  it("runs from the event's own time, not from when it was received or first failed", () => {
    expect(windowExpiryOf("ga4", T0)).toBe(T0 + 72 * HOUR);
  });
});

describe("durable backoff (P1-D2)", () => {
  it("is 1m, 5m, 30m, 2h, 6h, 12h, 24h", () => {
    expect(DURABLE_RETRY_BACKOFF_MS).toEqual([
      MINUTE,
      5 * MINUTE,
      30 * MINUTE,
      2 * HOUR,
      6 * HOUR,
      12 * HOUR,
      24 * HOUR,
    ]);
  });

  it("walks the schedule round by round and then repeats the last delay", () => {
    const windowExpiresAtMs = T0 + 30 * DAY;
    const delays = [1, 2, 3, 4, 5, 6, 7, 8, 20].map((roundsFailed) => {
      const next = planNextRetry({ roundsFailed, nowMs: T0, windowExpiresAtMs });
      if (next.kind !== "retry") throw new Error("expected a retry");
      return next.atMs - T0;
    });
    expect(delays).toEqual([
      MINUTE,
      5 * MINUTE,
      30 * MINUTE,
      2 * HOUR,
      6 * HOUR,
      12 * HOUR,
      24 * HOUR,
      24 * HOUR,
      24 * HOUR,
    ]);
  });

  it("treats round 0 like round 1 rather than indexing before the table", () => {
    const next = planNextRetry({ roundsFailed: 0, nowMs: T0, windowExpiresAtMs: T0 + DAY });
    expect(next).toEqual({ kind: "retry", atMs: T0 + MINUTE });
  });

  it("a non-failure deferral (open circuit, empty bucket) uses its own delay, not the backoff", () => {
    const next = planNextRetry({
      roundsFailed: 5,
      nowMs: T0,
      windowExpiresAtMs: T0 + DAY,
      delayMs: 45_000,
    });
    expect(next).toEqual({ kind: "retry", atMs: T0 + 45_000 });
  });
});

describe("the window caps the schedule (P1-D2)", () => {
  it("places ONE final try just before the window closes when the regular slot would overshoot it", () => {
    // 6 h backoff would land after a window that closes in 3 h: try once at (close - 2 min) instead.
    const windowExpiresAtMs = T0 + 3 * HOUR;
    const next = planNextRetry({ roundsFailed: 5, nowMs: T0, windowExpiresAtMs });
    expect(next).toEqual({ kind: "retry", atMs: windowExpiresAtMs - 2 * MINUTE });
  });

  it("after that final try fails there is nothing left: window_closed", () => {
    const windowExpiresAtMs = T0 + 3 * HOUR;
    const lastTry = windowExpiresAtMs - 2 * MINUTE;
    expect(planNextRetry({ roundsFailed: 6, nowMs: lastTry, windowExpiresAtMs })).toEqual({
      kind: "window_closed",
    });
  });

  it("past the window, or too close to it to run another try, is window_closed", () => {
    expect(
      planNextRetry({ roundsFailed: 1, nowMs: T0 + 10 * HOUR, windowExpiresAtMs: T0 + HOUR }),
    ).toEqual({ kind: "window_closed" });
    expect(
      planNextRetry({
        roundsFailed: 1,
        nowMs: T0 + HOUR - 2 * MINUTE - 10_000,
        windowExpiresAtMs: T0 + HOUR,
      }),
    ).toEqual({ kind: "window_closed" });
  });

  it("a GA4 event that keeps failing is retried for 72 hours and not one minute longer", () => {
    const windowExpiresAtMs = windowExpiryOf("ga4", T0);
    let now = T0;
    let rounds = 1;
    let retries = 0;
    for (;;) {
      const next = planNextRetry({ roundsFailed: rounds, nowMs: now, windowExpiresAtMs });
      if (next.kind === "window_closed") break;
      expect(next.atMs).toBeGreaterThan(now);
      expect(next.atMs).toBeLessThanOrEqual(windowExpiresAtMs - 2 * MINUTE);
      now = next.atMs;
      rounds += 1;
      retries += 1;
      expect(retries).toBeLessThan(50); // terminates
    }
    expect(now).toBeLessThanOrEqual(windowExpiresAtMs);
    expect(retries).toBeGreaterThanOrEqual(8);
  });
});

describe("jitter (P1-D2)", () => {
  it("spreads the delay over ±20% and is exact without a random source", () => {
    const windowExpiresAtMs = T0 + 30 * DAY;
    const at = (random: () => number): number => {
      const next = planNextRetry({ roundsFailed: 3, nowMs: T0, windowExpiresAtMs, random });
      if (next.kind !== "retry") throw new Error("expected a retry");
      return next.atMs - T0;
    };
    expect(at(() => 0)).toBe(24 * MINUTE); // 30 min × 0.8
    expect(at(() => 0.5)).toBe(30 * MINUTE); // centre
    expect(at(() => 0.999999)).toBeLessThan(36 * MINUTE);
    expect(at(() => 0.999999)).toBeGreaterThan(35 * MINUTE);
  });

  it("never schedules past the last useful moment, however the dice fall", () => {
    const windowExpiresAtMs = T0 + 3 * HOUR;
    for (const random of [0, 0.25, 0.5, 0.75, 0.999999]) {
      for (let roundsFailed = 1; roundsFailed <= 8; roundsFailed += 1) {
        const next = planNextRetry({
          roundsFailed,
          nowMs: T0,
          windowExpiresAtMs,
          random: () => random,
        });
        if (next.kind === "retry") {
          expect(next.atMs).toBeLessThanOrEqual(windowExpiresAtMs - 2 * MINUTE);
          expect(next.atMs).toBeGreaterThan(T0);
        }
      }
    }
  });
});

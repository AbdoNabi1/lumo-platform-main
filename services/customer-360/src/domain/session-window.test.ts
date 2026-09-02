import { describe, expect, it } from "vitest";
import { DEFAULT_SESSION_TIMEOUT_MS, withinSessionWindow } from "./session-window";

describe("withinSessionWindow", () => {
  it("is true for activity right at the start (zero gap)", () => {
    expect(withinSessionWindow("2026-07-21T00:00:00.000Z", "2026-07-21T00:00:00.000Z")).toBe(true);
  });

  it("is true for activity within the timeout", () => {
    expect(withinSessionWindow("2026-07-21T00:00:00.000Z", "2026-07-21T00:29:00.000Z")).toBe(true);
  });

  it("is false for activity past the timeout", () => {
    expect(withinSessionWindow("2026-07-21T00:00:00.000Z", "2026-07-21T00:31:00.000Z")).toBe(false);
  });

  it("is exactly on the boundary at the default timeout (inclusive)", () => {
    const lastActivityAt = "2026-07-21T00:00:00.000Z";
    const occurredAt = new Date(
      Date.parse(lastActivityAt) + DEFAULT_SESSION_TIMEOUT_MS,
    ).toISOString();
    expect(withinSessionWindow(lastActivityAt, occurredAt)).toBe(true);
  });

  it("is false for a negative gap (event older than last activity)", () => {
    expect(withinSessionWindow("2026-07-21T00:10:00.000Z", "2026-07-21T00:00:00.000Z")).toBe(false);
  });

  it("respects a custom timeout", () => {
    expect(withinSessionWindow("2026-07-21T00:00:00.000Z", "2026-07-21T00:00:05.000Z", 1000)).toBe(
      false,
    );
    expect(withinSessionWindow("2026-07-21T00:00:00.000Z", "2026-07-21T00:00:00.500Z", 1000)).toBe(
      true,
    );
  });
});

import { describe, expect, it } from "vitest";
import { SystemClock } from "./system-clock";

describe("SystemClock", () => {
  const clock = new SystemClock();

  it("returns the current time as a Date", () => {
    const before = Date.now();
    const now = clock.now();
    const after = Date.now();

    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
  });
});

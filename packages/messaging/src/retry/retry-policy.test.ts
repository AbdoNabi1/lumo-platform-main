import { describe, expect, it } from "vitest";
import { RetryPolicy } from "./retry-policy";

describe("RetryPolicy", () => {
  it("grows exponentially and caps at maxDelayMs (jitter = 1 → full delay)", () => {
    const policy = new RetryPolicy({
      maxAttempts: 5,
      baseDelayMs: 100,
      factor: 2,
      maxDelayMs: 1000,
      jitter: () => 1,
    });
    expect(policy.delayForAttempt(1)).toBe(100);
    expect(policy.delayForAttempt(2)).toBe(200);
    expect(policy.delayForAttempt(3)).toBe(400);
    expect(policy.delayForAttempt(4)).toBe(800);
    expect(policy.delayForAttempt(5)).toBe(1000); // 1600 capped to 1000
  });

  it("scales to 50% at jitter = 0", () => {
    const policy = new RetryPolicy({
      maxAttempts: 3,
      baseDelayMs: 100,
      factor: 2,
      maxDelayMs: 10000,
      jitter: () => 0,
    });
    expect(policy.delayForAttempt(1)).toBe(50);
    expect(policy.delayForAttempt(2)).toBe(100);
  });

  it("exposes maxAttempts and validates its options", () => {
    expect(
      new RetryPolicy({ maxAttempts: 4, baseDelayMs: 1, factor: 1, maxDelayMs: 1 }).maxAttempts,
    ).toBe(4);
    expect(
      () => new RetryPolicy({ maxAttempts: 0, baseDelayMs: 1, factor: 1, maxDelayMs: 1 }),
    ).toThrow();
    expect(
      () => new RetryPolicy({ maxAttempts: 1, baseDelayMs: 1, factor: 0.5, maxDelayMs: 1 }),
    ).toThrow();
  });
});

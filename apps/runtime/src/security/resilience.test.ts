import { describe, expect, it } from "vitest";
import {
  CircuitBreaker,
  CircuitOpenError,
  retry,
  TimeoutError,
  TtlCache,
  withTimeout,
} from "./resilience";

const noSleep = async (): Promise<void> => undefined;

describe("withTimeout", () => {
  it("resolves a fast operation", async () => {
    await expect(withTimeout(async () => "ok", 1000, "fast")).resolves.toBe("ok");
  });

  it("rejects a slow operation with TimeoutError", async () => {
    const never = (): Promise<string> => new Promise(() => undefined);
    await expect(withTimeout(never, 10, "slow")).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe("retry", () => {
  it("retries until success and returns the value", async () => {
    let calls = 0;
    const result = await retry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("transient");
        return "done";
      },
      { attempts: 3, sleep: noSleep },
    );
    expect(result).toBe("done");
    expect(calls).toBe(3);
  });

  it("re-throws the last error when attempts are exhausted", async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls += 1;
          throw new Error(`fail-${calls}`);
        },
        { attempts: 2, sleep: noSleep },
      ),
    ).rejects.toThrow("fail-2");
    expect(calls).toBe(2);
  });

  it("fails fast on a non-retryable error", async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls += 1;
          throw new Error("fatal");
        },
        {
          attempts: 5,
          sleep: noSleep,
          retryable: (e) => !(e instanceof Error && e.message === "fatal"),
        },
      ),
    ).rejects.toThrow("fatal");
    expect(calls).toBe(1);
  });
});

describe("CircuitBreaker", () => {
  it("opens after the failure threshold and short-circuits with CircuitOpenError", async () => {
    const clock = 0;
    const breaker = new CircuitBreaker({
      name: "t",
      failureThreshold: 2,
      cooldownMs: 1000,
      now: () => clock,
    });
    const boom = (): Promise<never> => Promise.reject(new Error("boom"));
    await expect(breaker.exec(boom)).rejects.toThrow("boom");
    await expect(breaker.exec(boom)).rejects.toThrow("boom");
    expect(breaker.status).toBe("open");
    await expect(breaker.exec(async () => "x")).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("half-opens after cooldown and closes on a successful trial", async () => {
    let clock = 0;
    const breaker = new CircuitBreaker({
      name: "t",
      failureThreshold: 1,
      cooldownMs: 1000,
      now: () => clock,
    });
    await expect(breaker.exec(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(breaker.status).toBe("open");
    clock = 1001;
    expect(breaker.status).toBe("half-open");
    await expect(breaker.exec(async () => "recovered")).resolves.toBe("recovered");
    expect(breaker.status).toBe("closed");
  });

  it("re-opens when the half-open trial fails", async () => {
    let clock = 0;
    const breaker = new CircuitBreaker({
      name: "t",
      failureThreshold: 1,
      cooldownMs: 100,
      now: () => clock,
    });
    await expect(breaker.exec(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    clock = 200;
    await expect(breaker.exec(() => Promise.reject(new Error("still-bad")))).rejects.toThrow(
      "still-bad",
    );
    expect(breaker.status).toBe("open");
  });
});

describe("TtlCache", () => {
  it("serves fresh entries and evicts expired ones", () => {
    let clock = 0;
    const cache = new TtlCache<string>(100, () => clock);
    cache.set("k", "v");
    expect(cache.get("k")).toBe("v");
    clock = 150;
    expect(cache.get("k")).toBeUndefined();
  });
});

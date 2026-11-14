import { beforeEach, describe, expect, it } from "vitest";
import { ConcurrencyError } from "@platform/utils";
import { withConcurrencyRetry } from "./concurrency-retry";

beforeEach(() => {
  expect.hasAssertions();
});

describe("withConcurrencyRetry", () => {
  it("retries a ConcurrencyError and returns the later success", async () => {
    let calls = 0;
    const result = await withConcurrencyRetry(5, () => {
      calls += 1;
      return calls < 3 ? Promise.reject(new ConcurrencyError("stale")) : Promise.resolve("ok");
    });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("rethrows the ConcurrencyError once attempts are exhausted", async () => {
    let calls = 0;
    await expect(
      withConcurrencyRetry(2, () => {
        calls += 1;
        return Promise.reject(new ConcurrencyError("stale"));
      }),
    ).rejects.toBeInstanceOf(ConcurrencyError);
    expect(calls).toBe(2);
  });

  it("does not retry any other error", async () => {
    let calls = 0;
    await expect(
      withConcurrencyRetry(5, () => {
        calls += 1;
        return Promise.reject(new Error("boom"));
      }),
    ).rejects.toThrow("boom");
    expect(calls).toBe(1);
  });
});

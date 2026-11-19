import { beforeEach, describe, expect, it } from "vitest";
import { isWellFormedCarrierKey } from "./carrier-key";

beforeEach(() => {
  expect.hasAssertions();
});

describe("carrier key", () => {
  it.each(["bosta", "j_t-1"])("accepts %s", (key) => {
    expect(isWellFormedCarrierKey(key)).toBe(true);
  });
  it.each(["Bosta", "b", "1bosta", "bosta:webhook", "a".repeat(33)])("rejects %s", (key) => {
    expect(isWellFormedCarrierKey(key)).toBe(false);
  });
});

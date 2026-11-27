import { beforeEach, describe, expect, it } from "vitest";
import { attemptIdFor } from "./attempt-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  expect.hasAssertions();
});

describe("attemptIdFor (Ruling 7)", () => {
  it("is a valid UUID, deterministic, and distinct per index and aggregate", () => {
    const a = attemptIdFor("019a0000-0000-7000-8000-000000000001", 0);
    expect(a).toMatch(UUID);
    expect(attemptIdFor("019a0000-0000-7000-8000-000000000001", 0)).toBe(a);
    expect(attemptIdFor("019a0000-0000-7000-8000-000000000001", 1)).not.toBe(a);
    expect(attemptIdFor("019a0000-0000-7000-8000-000000000002", 0)).not.toBe(a);
  });

  it("hashes `<aggregateId>:attempt:<index>`", () => {
    // Same vector as @platform/domain's deterministicEntityId test.
    expect(attemptIdFor("order-1", 0)).toBe("39f62dcf-c5b4-56b6-80d6-05f705cf3b3a");
  });
});

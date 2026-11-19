import { beforeEach, describe, expect, it } from "vitest";
import { deterministicEntityId } from "./deterministic-entity-id";
import { UniqueEntityId } from "./unique-entity-id";

const UUID_V5_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  expect.hasAssertions();
});

describe("deterministicEntityId", () => {
  it("derives an RFC-4122-shaped id (version 5, variant 10) from SHA-256 of the seed", () => {
    // SHA-256("order-1:attempt:0") starts 39f62dcf c5b4 36b6 c0d6 05f705cf3b3a: byte 6 (0x36)
    // becomes 0x56 (version 5) and byte 8 (0xc0) becomes 0x80 (variant 10).
    expect(deterministicEntityId("order-1:attempt:0").toString()).toBe(
      "39f62dcf-c5b4-56b6-80d6-05f705cf3b3a",
    );
  });

  it("is deterministic and distinct per seed", () => {
    const a = deterministicEntityId("agg-1:attempt:0");
    expect(a).toBeInstanceOf(UniqueEntityId);
    expect(a.toString()).toMatch(UUID_V5_SHAPE);
    expect(deterministicEntityId("agg-1:attempt:0").equals(a)).toBe(true);
    expect(deterministicEntityId("agg-1:attempt:1").equals(a)).toBe(false);
    expect(deterministicEntityId("agg-2:attempt:0").equals(a)).toBe(false);
  });
});

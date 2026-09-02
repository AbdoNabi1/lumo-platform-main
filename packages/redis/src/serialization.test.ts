import { describe, expect, it } from "vitest";
import { jsonSerializer } from "./serialization";

interface Sample {
  id: number;
  name: string;
  tags: string[];
}

describe("jsonSerializer", () => {
  it("round-trips a typed value", () => {
    const value: Sample = { id: 1, name: "rainbow stacker", tags: ["wooden", "stem"] };
    const restored = jsonSerializer.deserialize<Sample>(jsonSerializer.serialize(value));
    expect(restored).toEqual(value);
  });

  it("serializes to a JSON string", () => {
    expect(jsonSerializer.serialize({ a: 1 })).toBe('{"a":1}');
  });
});

import { describe, expect, it } from "vitest";
import { Quantity } from "./quantity";

describe("Quantity", () => {
  it("requires a positive integer and adds", () => {
    const two = Quantity.create(2);
    const three = Quantity.create(3);
    if (!two.ok || !three.ok) throw new Error("invalid fixture");
    expect(two.value.add(three.value).value).toBe(5);
    expect(Quantity.create(0).ok).toBe(false);
  });
});

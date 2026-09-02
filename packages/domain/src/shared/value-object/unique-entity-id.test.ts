import { ValidationError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "./unique-entity-id";

describe("UniqueEntityId", () => {
  it("rehydrates from an existing value and exposes it", () => {
    const id = UniqueEntityId.from("018f-abc");
    expect(id.value).toBe("018f-abc");
    expect(id.toString()).toBe("018f-abc");
  });

  it("is equal when the value matches", () => {
    expect(UniqueEntityId.from("a").equals(UniqueEntityId.from("a"))).toBe(true);
    expect(UniqueEntityId.from("a").equals(UniqueEntityId.from("b"))).toBe(false);
  });

  it("rejects an empty value", () => {
    expect(() => UniqueEntityId.from("")).toThrow(ValidationError);
  });

  it("rejects a whitespace-only value", () => {
    expect(() => UniqueEntityId.from("   ")).toThrow(ValidationError);
  });
});

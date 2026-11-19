import { describe, expect, it } from "vitest";
import { InMemoryUnitOfWork } from "./in-memory-unit-of-work";

describe("InMemoryUnitOfWork", () => {
  it("runs the work with no transaction context and returns its result", async () => {
    const result = await new InMemoryUnitOfWork().run(async (tx) => ({ tx, done: true }));
    expect(result).toEqual({ tx: undefined, done: true });
  });
});

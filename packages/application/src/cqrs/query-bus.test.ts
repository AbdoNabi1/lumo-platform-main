import { describe, expect, it } from "vitest";
import { InMemoryQueryBus } from "./query-bus";
import type { Query, QueryHandler } from "./query";
import { HandlerNotFoundError } from "./errors";

interface GetThing extends Query<{ name: string } | null> {
  readonly type: "thing.get";
  readonly id: string;
}

class GetThingHandler implements QueryHandler<GetThing> {
  execute(query: GetThing): Promise<{ name: string } | null> {
    return Promise.resolve(query.id === "1" ? { name: "found" } : null);
  }
}

describe("InMemoryQueryBus", () => {
  it("dispatches to the registered handler with a typed result", async () => {
    const bus = new InMemoryQueryBus();
    bus.register<GetThing>("thing.get", new GetThingHandler());
    const found = await bus.execute<GetThing>({ type: "thing.get", id: "1" });
    expect(found).toEqual({ name: "found" });
    const missing = await bus.execute<GetThing>({ type: "thing.get", id: "2" });
    expect(missing).toBeNull();
  });

  it("throws when no handler is registered", async () => {
    const bus = new InMemoryQueryBus();
    await expect(bus.execute<GetThing>({ type: "thing.get", id: "1" })).rejects.toBeInstanceOf(
      HandlerNotFoundError,
    );
  });
});

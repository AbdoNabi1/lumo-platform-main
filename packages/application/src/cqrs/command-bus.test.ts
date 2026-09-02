import { describe, expect, it } from "vitest";
import type { Middleware } from "../middleware";
import { InMemoryCommandBus } from "./command-bus";
import type { Command, CommandHandler } from "./command";
import { DuplicateHandlerError, HandlerNotFoundError } from "./errors";

interface CreateThing extends Command<{ id: string }> {
  readonly type: "thing.create";
  readonly name: string;
}

class CreateThingHandler implements CommandHandler<CreateThing> {
  execute(command: CreateThing): Promise<{ id: string }> {
    return Promise.resolve({ id: `id-${command.name}` });
  }
}

describe("InMemoryCommandBus", () => {
  it("dispatches to the registered handler with a typed result", async () => {
    const bus = new InMemoryCommandBus();
    bus.register<CreateThing>("thing.create", new CreateThingHandler());
    const command: CreateThing = { type: "thing.create", name: "rainbow" };
    const result = await bus.execute(command);
    expect(result.id).toBe("id-rainbow");
  });

  it("rejects duplicate registration", () => {
    const bus = new InMemoryCommandBus();
    bus.register<CreateThing>("thing.create", new CreateThingHandler());
    expect(() => bus.register<CreateThing>("thing.create", new CreateThingHandler())).toThrowError(
      DuplicateHandlerError,
    );
  });

  it("throws when no handler is registered", async () => {
    const bus = new InMemoryCommandBus();
    const command: CreateThing = { type: "thing.create", name: "x" };
    await expect(bus.execute(command)).rejects.toBeInstanceOf(HandlerNotFoundError);
  });

  it("runs middleware around the handler", async () => {
    const calls: string[] = [];
    const tracer: Middleware = {
      async handle(context, next) {
        calls.push(`before:${context.messageType}`);
        const result = await next();
        calls.push("after");
        return result;
      },
    };
    const bus = new InMemoryCommandBus([tracer]);
    bus.register<CreateThing>("thing.create", new CreateThingHandler());
    await bus.execute<CreateThing>({ type: "thing.create", name: "y" });
    expect(calls).toEqual(["before:thing.create", "after"]);
  });
});

import { describe, expect, it } from "vitest";
import type { Middleware } from "./middleware";
import { Pipeline } from "./pipeline";

function tracing(label: string, order: string[]): Middleware {
  return {
    async handle(_context, next) {
      order.push(`>${label}`);
      const result = await next();
      order.push(`<${label}`);
      return result;
    },
  };
}

describe("Pipeline", () => {
  it("runs middlewares outside-in and returns the handler result", async () => {
    const order: string[] = [];
    const pipeline = new Pipeline([tracing("a", order), tracing("b", order)]);
    const result = await pipeline.run({ messageType: "test", metadata: {} }, () =>
      Promise.resolve("done"),
    );
    expect(result).toBe("done");
    expect(order).toEqual([">a", ">b", "<b", "<a"]);
  });

  it("runs the handler directly when there are no middlewares", async () => {
    const result = await pipelineResult();
    expect(result).toBe(7);
  });
});

function pipelineResult(): Promise<number> {
  return new Pipeline().run({ messageType: "n", metadata: {} }, () => Promise.resolve(7));
}

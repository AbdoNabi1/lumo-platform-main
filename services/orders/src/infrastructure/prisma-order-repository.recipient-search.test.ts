import { describe, expect, it } from "vitest";
import { rootEventContext } from "@platform/messaging";
import { PrismaOrderRepository } from "./prisma-order-repository";

/** A transaction client that records every delegate call; every read answers an empty list. */
function recordingTx() {
  const calls: { readonly model: string; readonly method: string; readonly args: unknown }[] = [];
  const delegate = (model: string) =>
    new Proxy(
      {},
      {
        get: (_target, method: string) => async (args: unknown) => {
          calls.push({ model, method, args });
          return method === "findMany" ? [] : null;
        },
      },
    );
  const tx = new Proxy({}, { get: (_target, model: string) => delegate(model) });
  return { tx, calls };
}

describe("PrismaOrderRepository recipient search (order operations Part 1)", () => {
  it("caps the recipient match newest-first, so the capped set is deterministic", async () => {
    const { tx, calls } = recordingTx();
    const repository = new PrismaOrderRepository({
      prisma: {} as never,
      outbox: { write: async () => undefined } as never,
      context: rootEventContext({ generate: () => "evt" }),
    });

    await repository.list({ search: "Mona" }, "t-1", tx);

    const recipientQuery = calls.find(
      (call) => call.model === "orderShippingAddress" && call.method === "findMany",
    );
    expect(recipientQuery?.args).toMatchObject({
      orderBy: { orderId: "desc" },
      take: expect.any(Number),
    });
  });
});

import { describe, expect, it } from "vitest";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { CheckoutEventTranslator } from "../infrastructure/checkout-event-translator";
import { InMemoryCheckoutSessionRepository } from "../infrastructure/in-memory-checkout-session-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { StartCheckout } from "./start-checkout.use-case";

function setup() {
  const sessions = new InMemoryCheckoutSessionRepository({
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new CheckoutEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "checkout",
    }),
    context: rootEventContext({ generate: () => "evt-x" }),
  });
  let n = 0;
  const start = new StartCheckout({
    sessions,
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator: { generate: () => `cs-${(n += 1)}` },
  });
  return { sessions, start };
}

describe("StartCheckout — recovered sessions (order operations Part 3)", () => {
  it("remembers the abandoned checkout a recovery started from", async () => {
    const { sessions, start } = setup();
    const result = await start.execute({
      tenantId: "t",
      cartRef: "cart-1",
      sessionRef: "ref-1",
      currency: "EGP",
      recoveredFromRef: "cs-abandoned",
    });
    if (!result.ok) throw new Error("start failed");
    expect((await sessions.findById(result.value.checkoutSessionId, "t"))?.recoveredFromRef).toBe(
      "cs-abandoned",
    );
  });

  it("an ordinary start has none", async () => {
    const { sessions, start } = setup();
    const result = await start.execute({
      tenantId: "t",
      cartRef: "c",
      sessionRef: "r",
      currency: "EGP",
    });
    if (!result.ok) throw new Error("start failed");
    expect(
      (await sessions.findById(result.value.checkoutSessionId, "t"))?.recoveredFromRef,
    ).toBeUndefined();
  });
});

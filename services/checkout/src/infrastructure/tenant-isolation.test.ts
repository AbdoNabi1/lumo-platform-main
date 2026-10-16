import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { CheckoutSession } from "../domain/checkout-session";
import { CheckoutEventTranslator } from "./checkout-event-translator";
import { InMemoryCheckoutSessionRepository } from "./in-memory-checkout-session-repository";

/** ADR-0014 (WP-10, T10.3): one Checkout repository serves every tenant. */
function newSession(id: string): CheckoutSession {
  return CheckoutSession.start(UniqueEntityId.from(id), "cart-1", "customer-1", "session-1", "USD");
}

function repository(outbox?: OutboxWriter) {
  const writer =
    outbox ??
    new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new CheckoutEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "checkout",
    });
  return new InMemoryCheckoutSessionRepository({
    outbox: writer,
    context: rootEventContext({ generate: () => "evt-x" }),
  });
}

describe("checkout tenant isolation (ADR-0014)", () => {
  it("two tenants sharing one repository and an identical session id never see each other's sessions", async () => {
    const repo = repository();
    await repo.save(newSession("cs-1"), "tenant-a");

    expect(await repo.findById("cs-1", "tenant-b")).toBeNull();
    expect(await repo.findById("cs-1", "tenant-a")).not.toBeNull();
  });

  it("merges the per-call tenantId into the outbox event context at write time", async () => {
    await assertWriteTimeTenant("checkout", async (outbox, tenantId) => {
      const session = newSession("cs-1");
      session.fail("payment declined", "evt-1", new Date(0));
      await repository(outbox).save(session, tenantId);
    });
  });
});

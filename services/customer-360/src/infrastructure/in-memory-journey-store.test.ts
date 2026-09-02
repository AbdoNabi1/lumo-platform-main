import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import {
  InMemoryEventBus,
  InMemoryEventPublisher,
  InMemoryOutboxStore,
  OutboxRelay,
  OutboxWriter,
  rootEventContext,
} from "@platform/messaging";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { UniqueEntityId } from "@platform/domain";
import { SessionMerged } from "../events/session-merged.event";
import { IdentityEventTranslator } from "./identity-event-translator";
import { InMemoryJourneyStore } from "./in-memory-journey-store";

const clock: Clock = { now: () => new Date("2026-07-21T00:00:00.000Z") };
const ids: IdGenerator = { generate: () => crypto.randomUUID() };

function wire() {
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new IdentityEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "customer360",
  });
  const context = rootEventContext(ids);
  const bus = new InMemoryEventBus();
  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock,
  });
  const journey = new InMemoryJourneyStore({ outbox, context });
  return { journey, relay };
}

describe("InMemoryJourneyStore", () => {
  it("records a transition silently (no event) for organic kinds", async () => {
    const { journey, relay } = wire();
    await journey.record({
      id: "t1",
      kind: "timed_out",
      visitorId: "v1",
      fromSessionId: "s1",
      toSessionId: "s2",
      occurredAt: "t1",
    });
    expect(await relay.drainOnce()).toBe(0);
    expect(await journey.listForVisitor("v1")).toHaveLength(1);
  });

  it("publishes the supplied event for explicit kinds", async () => {
    const { journey, relay } = wire();
    const event = new SessionMerged(
      { eventId: ids.generate(), aggregateId: UniqueEntityId.from("t1"), occurredAt: clock.now() },
      {
        transitionId: "t1",
        visitorId: "v1",
        fromSessionId: "s1",
        toSessionId: "s2",
        reason: "r",
        actor: "a",
      },
    );
    await journey.record(
      {
        id: "t1",
        kind: "explicit_merge",
        visitorId: "v1",
        fromSessionId: "s1",
        toSessionId: "s2",
        reason: "r",
        actor: "a",
        occurredAt: "t1",
      },
      event,
    );
    expect(await relay.drainOnce()).toBe(1);
  });

  it("listForVisitor filters to only that visitor's transitions", async () => {
    const { journey } = wire();
    await journey.record({ id: "t1", kind: "timed_out", visitorId: "v1", occurredAt: "t1" });
    await journey.record({ id: "t2", kind: "timed_out", visitorId: "v2", occurredAt: "t1" });

    const result = await journey.listForVisitor("v1");
    expect(result.map((t) => t.id)).toEqual(["t1"]);
  });
});

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
import { openSession } from "../domain/customer-session";
import { toSnapshot } from "../domain/session-snapshot";
import { SessionStarted } from "../events/session-started.event";
import { IdentityEventTranslator } from "./identity-event-translator";
import { InMemorySessionHistoryStore } from "./in-memory-session-history-store";

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
  const history = new InMemorySessionHistoryStore({ outbox, context });
  return { history, relay };
}

describe("InMemorySessionHistoryStore", () => {
  it("appends and lists snapshots for a session, oldest first", async () => {
    const { history } = wire();
    const session = openSession({ sessionId: "s1", visitorId: "v1", startedAt: "t0" });
    const event = new SessionStarted(
      {
        eventId: ids.generate(),
        aggregateId: UniqueEntityId.from(session.sessionId),
        occurredAt: clock.now(),
      },
      { sessionId: session.sessionId, visitorId: session.visitorId },
    );

    await history.append(toSnapshot(session, "started", "t0"), event);
    const listed = await history.listFor("s1");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.reason).toBe("started");
  });

  it("latestFor returns null when there is no history, and the last snapshot otherwise", async () => {
    const { history } = wire();
    expect(await history.latestFor("never-seen")).toBeNull();

    const session = openSession({ sessionId: "s1", visitorId: "v1", startedAt: "t0" });
    const event = new SessionStarted(
      {
        eventId: ids.generate(),
        aggregateId: UniqueEntityId.from(session.sessionId),
        occurredAt: clock.now(),
      },
      { sessionId: session.sessionId, visitorId: session.visitorId },
    );
    await history.append(toSnapshot(session, "started", "t0"), event);
    await history.append(toSnapshot(session, "activity", "t1"), undefined);

    const latest = await history.latestFor("s1");
    expect(latest?.reason).toBe("activity");
  });

  it("publishes an event only when one is supplied (RebuildSessions calls with none)", async () => {
    const { history, relay } = wire();
    const session = openSession({ sessionId: "s1", visitorId: "v1", startedAt: "t0" });

    await history.append(toSnapshot(session, "rebuilt", "t0"), undefined);
    expect(await relay.drainOnce()).toBe(0);
  });
});

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
import { TENANT_A, TENANT_B } from "../test-support/tenants";

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

    await history.append(toSnapshot(session, "started", "t0"), TENANT_A, event);
    const listed = await history.listFor("s1", TENANT_A);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.reason).toBe("started");
  });

  it("latestFor returns null when there is no history, and the last snapshot otherwise", async () => {
    const { history } = wire();
    expect(await history.latestFor("never-seen", TENANT_A)).toBeNull();

    const session = openSession({ sessionId: "s1", visitorId: "v1", startedAt: "t0" });
    const event = new SessionStarted(
      {
        eventId: ids.generate(),
        aggregateId: UniqueEntityId.from(session.sessionId),
        occurredAt: clock.now(),
      },
      { sessionId: session.sessionId, visitorId: session.visitorId },
    );
    await history.append(toSnapshot(session, "started", "t0"), TENANT_A, event);
    await history.append(toSnapshot(session, "activity", "t1"), TENANT_A, undefined);

    const latest = await history.latestFor("s1", TENANT_A);
    expect(latest?.reason).toBe("activity");
  });

  it("publishes an event only when one is supplied (RebuildSessions calls with none)", async () => {
    const { history, relay } = wire();
    const session = openSession({ sessionId: "s1", visitorId: "v1", startedAt: "t0" });

    await history.append(toSnapshot(session, "rebuilt", "t0"), TENANT_A, undefined);
    expect(await relay.drainOnce()).toBe(0);
  });

  it("isolates tenants — a snapshot appended under one tenant is invisible to another (ADR-0014)", async () => {
    const { history } = wire();
    const session = openSession({ sessionId: "s1", visitorId: "v1", startedAt: "t0" });
    await history.append(toSnapshot(session, "started", "t0"), TENANT_A);

    expect(await history.listFor("s1", TENANT_B)).toEqual([]);
    expect(await history.latestFor("s1", TENANT_B)).toBeNull();
    expect(await history.listFor("s1", TENANT_A)).toHaveLength(1);
  });
});

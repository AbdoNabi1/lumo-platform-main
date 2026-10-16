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
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { UniqueEntityId } from "@platform/domain";
import { SessionMerged } from "../events/session-merged.event";
import { IdentityEventTranslator } from "./identity-event-translator";
import { InMemoryJourneyStore } from "./in-memory-journey-store";
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
  const journey = new InMemoryJourneyStore({ outbox, context });
  return { journey, relay };
}

describe("InMemoryJourneyStore", () => {
  it("records a transition silently (no event) for organic kinds", async () => {
    const { journey, relay } = wire();
    await journey.record(
      {
        id: "t1",
        kind: "timed_out",
        visitorId: "v1",
        fromSessionId: "s1",
        toSessionId: "s2",
        occurredAt: "t1",
      },
      TENANT_A,
    );
    expect(await relay.drainOnce()).toBe(0);
    expect(await journey.listForVisitor("v1", TENANT_A)).toHaveLength(1);
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
      TENANT_A,
      event,
    );
    expect(await relay.drainOnce()).toBe(1);
  });

  it("listForVisitor filters to only that visitor's transitions", async () => {
    const { journey } = wire();
    await journey.record(
      { id: "t1", kind: "timed_out", visitorId: "v1", occurredAt: "t1" },
      TENANT_A,
    );
    await journey.record(
      { id: "t2", kind: "timed_out", visitorId: "v2", occurredAt: "t1" },
      TENANT_A,
    );

    const result = await journey.listForVisitor("v1", TENANT_A);
    expect(result.map((t) => t.id)).toEqual(["t1"]);
  });

  it("isolates tenants — a transition recorded under one tenant is invisible to another (ADR-0014)", async () => {
    const { journey } = wire();
    await journey.record(
      { id: "t1", kind: "timed_out", visitorId: "v1", fromSessionId: "s1", occurredAt: "t1" },
      TENANT_A,
    );

    expect(await journey.listForVisitor("v1", TENANT_B)).toEqual([]);
    expect(await journey.listForVisitor("v1", TENANT_A)).toHaveLength(1);
  });
});

describe("InMemoryJourneyStore write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("carries each call's tenantId into the outbox envelope, not the singleton context's", async () => {
    await assertWriteTimeTenant("customer-360", async (outbox, tenantId) => {
      const journey = new InMemoryJourneyStore({ outbox, context: rootEventContext(ids) });
      const event = new SessionMerged(
        {
          eventId: ids.generate(),
          aggregateId: UniqueEntityId.from("t1"),
          occurredAt: clock.now(),
        },
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
        tenantId,
        event,
      );
    });
  });
});

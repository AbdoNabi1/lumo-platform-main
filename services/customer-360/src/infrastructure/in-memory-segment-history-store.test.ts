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
import { applyMembershipUpdate } from "../domain/segment-membership";
import { toSnapshot } from "../domain/segment-history";
import { CustomerEnteredSegment } from "../events/customer-entered-segment.event";
import { IdentityEventTranslator } from "./identity-event-translator";
import { InMemorySegmentHistoryStore } from "./in-memory-segment-history-store";
import { TENANT_A, TENANT_B } from "../test-support/tenants";

const clock: Clock = { now: () => new Date("2026-07-21T00:00:00.000Z") };
const ids: IdGenerator = { generate: () => crypto.randomUUID() };
const identifier = { type: "customer_id" as const, value: "cust-1" };
const segmentId = "high_value";

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
  const history = new InMemorySegmentHistoryStore({ outbox, context });
  return { history, relay };
}

function entered() {
  return applyMembershipUpdate(null, identifier.type, identifier.value, segmentId, {
    isMember: true,
    definitionId: segmentId,
    definitionVersion: 1,
    matchedRuleIds: ["rule-1"],
    inputs: new Map(),
    evaluatedAt: "t0",
  }).membership!;
}

describe("InMemorySegmentHistoryStore", () => {
  it("appends and lists entries for a pair, oldest first", async () => {
    const { history } = wire();
    const event = new CustomerEnteredSegment(
      {
        eventId: ids.generate(),
        aggregateId: UniqueEntityId.from(identifier.value),
        occurredAt: clock.now(),
      },
      {
        identifierType: identifier.type,
        identifierValue: identifier.value,
        segmentId,
        definitionId: segmentId,
        definitionVersion: 1,
        version: 1,
      },
    );

    await history.append(toSnapshot(entered(), "entered", "t0"), TENANT_A, event);
    const listed = await history.listFor(identifier, segmentId, TENANT_A);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.reason).toBe("entered");
  });

  it("latestFor returns null when there is no history, and the last entry otherwise", async () => {
    const { history } = wire();
    expect(await history.latestFor(identifier, segmentId, TENANT_A)).toBeNull();

    await history.append(toSnapshot(entered(), "entered", "t0"), TENANT_A, undefined);
    const exited = applyMembershipUpdate(entered(), identifier.type, identifier.value, segmentId, {
      isMember: false,
      definitionId: segmentId,
      definitionVersion: 1,
      matchedRuleIds: [],
      inputs: new Map(),
      evaluatedAt: "t1",
    }).membership!;
    await history.append(toSnapshot(exited, "exited", "t1"), TENANT_A, undefined);

    const latest = await history.latestFor(identifier, segmentId, TENANT_A);
    expect(latest?.reason).toBe("exited");
  });

  it("publishes an event only when one is supplied (RebuildSegmentMembership calls with none)", async () => {
    const { history, relay } = wire();
    await history.append(toSnapshot(entered(), "rebuilt", "t0"), TENANT_A, undefined);
    expect(await relay.drainOnce()).toBe(0);
  });

  it("isolates tenants — an entry appended under one tenant is invisible to another (ADR-0014)", async () => {
    const { history } = wire();
    await history.append(toSnapshot(entered(), "entered", "t0"), TENANT_A);

    expect(await history.listFor(identifier, segmentId, TENANT_B)).toEqual([]);
    expect(await history.latestFor(identifier, segmentId, TENANT_B)).toBeNull();
    expect(await history.listFor(identifier, segmentId, TENANT_A)).toHaveLength(1);
  });
});

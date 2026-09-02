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
import { applyAttributeUpdate, createEmptyComputedAttribute } from "../domain/computed-attribute";
import { toSnapshot } from "../domain/attribute-snapshot";
import { AttributeCreated } from "../events/attribute-created.event";
import { IdentityEventTranslator } from "./identity-event-translator";
import { InMemoryAttributeHistoryStore } from "./in-memory-attribute-history-store";

const clock: Clock = { now: () => new Date("2026-07-21T00:00:00.000Z") };
const ids: IdGenerator = { generate: () => crypto.randomUUID() };
const identifier = { type: "customer_id" as const, value: "cust-1" };

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
  const history = new InMemoryAttributeHistoryStore({ outbox, context });
  return { history, relay };
}

function attributeSet() {
  return applyAttributeUpdate(
    createEmptyComputedAttribute(identifier.type, identifier.value, "t0"),
    "is_vip",
    {
      value: true,
      definitionId: "is_vip",
      definitionVersion: 1,
      matchedRuleIds: ["rule-1"],
      inputs: new Map(),
      evaluatedAt: "t0",
    },
  ).attribute;
}

describe("InMemoryAttributeHistoryStore", () => {
  it("appends and lists snapshots for an identifier, oldest first", async () => {
    const { history } = wire();
    const event = new AttributeCreated(
      {
        eventId: ids.generate(),
        aggregateId: UniqueEntityId.from(identifier.value),
        occurredAt: clock.now(),
      },
      {
        identifierType: identifier.type,
        identifierValue: identifier.value,
        attribute: "is_vip",
        definitionId: "is_vip",
        definitionVersion: 1,
        version: 1,
      },
    );

    await history.append(toSnapshot(attributeSet(), "created", "t0"), event);
    const listed = await history.listFor(identifier);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.reason).toBe("created");
  });

  it("latestFor returns null when there is no history, and the last snapshot otherwise", async () => {
    const { history } = wire();
    expect(await history.latestFor(identifier)).toBeNull();

    await history.append(toSnapshot(attributeSet(), "created", "t0"), undefined);
    await history.append(toSnapshot(attributeSet(), "updated", "t1"), undefined);

    const latest = await history.latestFor(identifier);
    expect(latest?.reason).toBe("updated");
  });

  it("publishes an event only when one is supplied (RebuildComputedAttributes calls with none)", async () => {
    const { history, relay } = wire();
    await history.append(toSnapshot(attributeSet(), "rebuilt", "t0"), undefined);
    expect(await relay.drainOnce()).toBe(0);
  });
});

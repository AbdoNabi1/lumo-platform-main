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
import { Expr } from "@platform/expression";
import type { RuleSet } from "@platform/rules";
import { SegmentCreated } from "../events/segment-created.event";
import { InMemorySegmentDefinitionRegistry } from "./in-memory-segment-definition-registry";
import { IdentityEventTranslator } from "./identity-event-translator";
import { runSegmentDefinitionRegistryContractTests } from "./segment-definition-registry.contract";
import { TENANT_A } from "../test-support/tenants";

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
  const registry = new InMemorySegmentDefinitionRegistry({ outbox, context });
  return { registry, relay };
}

runSegmentDefinitionRegistryContractTests("in-memory", () => wire().registry);

function ruleSet(): RuleSet<boolean> {
  return {
    id: "high_value",
    version: 1,
    mode: "first_match",
    rules: [{ id: "rule-1", priority: 1, when: Expr.literal(true), then: true }],
    fallback: false,
  };
}

describe("InMemorySegmentDefinitionRegistry — event publishing", () => {
  it("publishes an event only when one is supplied", async () => {
    const { registry, relay } = wire();
    await registry.save(
      {
        id: "high_value",
        name: "High value",
        version: 1,
        ruleSet: ruleSet(),
        createdAt: "t0",
        updatedAt: "t0",
      },
      TENANT_A,
      0,
      undefined,
    );
    expect(await relay.drainOnce()).toBe(0);
  });

  it("publishes the supplied event on a successful save", async () => {
    const { registry, relay } = wire();
    const event = new SegmentCreated(
      {
        eventId: ids.generate(),
        aggregateId: UniqueEntityId.from("high_value"),
        occurredAt: clock.now(),
      },
      { segmentId: "high_value", name: "High value", version: 1 },
    );
    await registry.save(
      {
        id: "high_value",
        name: "High value",
        version: 1,
        ruleSet: ruleSet(),
        createdAt: "t0",
        updatedAt: "t0",
      },
      TENANT_A,
      0,
      event,
    );
    expect(await relay.drainOnce()).toBe(1);
  });

  it("can be pre-seeded via the constructor", async () => {
    const outboxStore = new InMemoryOutboxStore();
    const outbox = new OutboxWriter({
      store: outboxStore,
      translator: new IdentityEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "customer360",
    });
    const context = rootEventContext(ids);
    const registry = new InMemorySegmentDefinitionRegistry(
      { outbox, context },
      {
        tenantId: TENANT_A,
        definitions: [
          {
            id: "seeded",
            name: "Seeded",
            version: 1,
            ruleSet: ruleSet(),
            createdAt: "t0",
            updatedAt: "t0",
          },
        ],
      },
    );
    expect(await registry.getById("seeded", TENANT_A)).not.toBeNull();
  });
});

describe("InMemorySegmentDefinitionRegistry write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("carries each call's tenantId into the outbox envelope, for save and delete", async () => {
    await assertWriteTimeTenant("customer-360", async (outbox, tenantId) => {
      const registry = new InMemorySegmentDefinitionRegistry({
        outbox,
        context: rootEventContext(ids),
      });
      const event = new SegmentCreated(
        {
          eventId: ids.generate(),
          aggregateId: UniqueEntityId.from("high_value"),
          occurredAt: clock.now(),
        },
        { segmentId: "high_value", name: "High value", version: 1 },
      );
      await registry.save(
        {
          id: "high_value",
          name: "High value",
          version: 1,
          ruleSet: ruleSet(),
          createdAt: "t0",
          updatedAt: "t0",
        },
        tenantId,
        0,
        event,
      );
    });
  });
});

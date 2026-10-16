import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Expr } from "@platform/expression";
import {
  InMemoryEventBus,
  InMemoryEventPublisher,
  InMemoryOutboxStore,
  OutboxRelay,
  OutboxWriter,
  rootEventContext,
} from "@platform/messaging";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RuleSet } from "@platform/rules";
import { IdentityEventTranslator } from "../infrastructure/identity-event-translator";
import { InMemorySegmentDefinitionRegistry } from "../infrastructure/in-memory-segment-definition-registry";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { CreateSegment } from "./create-segment.use-case";
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
  const definitions = new InMemorySegmentDefinitionRegistry({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const bus = new InMemoryEventBus();
  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock,
  });
  const useCase = new CreateSegment({ definitions, unitOfWork, idGenerator: ids, clock });
  return { useCase, definitions, relay };
}

function validRuleSet(): RuleSet<boolean> {
  return {
    id: "high_value",
    version: 1,
    mode: "first_match",
    rules: [{ id: "r1", priority: 1, when: Expr.where("profile.ltv", "gte", 1000), then: true }],
    fallback: false,
  };
}

describe("CreateSegment", () => {
  it("creates a new segment at version 1 and publishes SegmentCreated", async () => {
    const { useCase, definitions, relay } = wire();
    const result = await useCase.execute({
      tenantId: TENANT_A,
      id: "high_value",
      name: "High value",
      ruleSet: validRuleSet(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.definition.version).toBe(1);

    const stored = await definitions.getById("high_value", TENANT_A);
    expect(stored?.name).toBe("High value");
    expect(await relay.drainOnce()).toBe(1);
  });

  it("rejects creating a segment id that already exists", async () => {
    const { useCase } = wire();
    await useCase.execute({
      tenantId: TENANT_A,
      id: "high_value",
      name: "High value",
      ruleSet: validRuleSet(),
    });

    const result = await useCase.execute({
      tenantId: TENANT_A,
      id: "high_value",
      name: "Dup",
      ruleSet: validRuleSet(),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a structurally invalid rule set before persisting anything", async () => {
    const { useCase, definitions } = wire();
    const invalidRuleSet: RuleSet<boolean> = {
      id: "bad",
      version: 1,
      mode: "first_match",
      rules: [{ id: "r1", priority: 1, when: Expr.and(), then: true }], // empty "and" -- structurally invalid
    };

    const result = await useCase.execute({
      tenantId: TENANT_A,
      id: "bad_segment",
      name: "Bad",
      ruleSet: invalidRuleSet,
    });
    expect(result.ok).toBe(false);
    expect(await definitions.getById("bad_segment", TENANT_A)).toBeNull();
  });
});

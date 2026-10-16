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
import { IdentityEventTranslator } from "../infrastructure/identity-event-translator";
import { InMemoryAttributeHistoryStore } from "../infrastructure/in-memory-attribute-history-store";
import { InMemoryAttributeStore } from "../infrastructure/in-memory-attribute-store";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import type { AttributeEvaluationResult } from "../ports/attribute-evaluation";
import { UpdateComputedAttributeProjection } from "./update-computed-attribute-projection.use-case";
import { TENANT_A } from "../test-support/tenants";

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
  const attributes = new InMemoryAttributeStore();
  const history = new InMemoryAttributeHistoryStore({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const bus = new InMemoryEventBus();
  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock,
  });
  const useCase = new UpdateComputedAttributeProjection({
    attributes,
    history,
    unitOfWork,
    idGenerator: ids,
    clock,
  });
  return { useCase, attributes, history, relay };
}

function evaluationResult(
  overrides: Partial<AttributeEvaluationResult> = {},
): AttributeEvaluationResult {
  return {
    identifier,
    definitionId: "is_vip",
    definitionVersion: 1,
    value: true,
    matchedRuleIds: ["vip-rule"],
    usedFallback: false,
    degraded: false,
    ruleTrace: [{ ruleId: "vip-rule", status: "matched" }],
    inputs: new Map([["profile.lifetime_value", 5000]]),
    contributingSources: new Map([
      ["profile.lifetime_value", { source: "orders", observedAt: "t0" }],
    ]),
    source: "computed-attribute:is_vip",
    evaluatedAt: "2026-07-21T00:00:01.000Z",
    ...overrides,
  };
}

describe("UpdateComputedAttributeProjection", () => {
  it("persists the first evaluated value ever and publishes AttributeCreated", async () => {
    const { useCase, attributes, relay } = wire();
    const result = await useCase.execute({
      tenantId: TENANT_A,
      identifier,
      result: evaluationResult(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.applied).toBe(true);
    expect(result.value.version).toBe(1);

    const stored = await attributes.getCurrent(identifier, TENANT_A);
    expect(stored?.attributes.get("is_vip")?.value).toBe(true);
    expect(await relay.drainOnce()).toBe(1);
  });

  it("is a no-op (applied: false) when re-persisting the same value from the same definition version", async () => {
    const { useCase } = wire();
    await useCase.execute({ tenantId: TENANT_A, identifier, result: evaluationResult() });
    const second = await useCase.execute({
      tenantId: TENANT_A,
      identifier,
      result: evaluationResult({ evaluatedAt: "t5" }),
    });

    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.value.applied).toBe(false);
  });

  it("applies and publishes AttributeUpdated when the value actually changes", async () => {
    const { useCase, relay } = wire();
    await useCase.execute({ tenantId: TENANT_A, identifier, result: evaluationResult() });
    await relay.drainOnce();

    const second = await useCase.execute({
      tenantId: TENANT_A,
      identifier,
      result: evaluationResult({ value: false, evaluatedAt: "t5" }),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.value.applied).toBe(true);
    expect(second.value.version).toBe(2);
    expect(await relay.drainOnce()).toBe(1); // AttributeUpdated, not AttributeCreated
  });

  it("persists nothing and publishes nothing when the evaluation produced no value (no rule matched, no fallback)", async () => {
    const { useCase, attributes, relay } = wire();
    const result = await useCase.execute({
      tenantId: TENANT_A,
      identifier,
      result: evaluationResult({ value: undefined, matchedRuleIds: [] }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.applied).toBe(false);
    expect(await attributes.getCurrent(identifier, TENANT_A)).toBeNull();
    expect(await relay.drainOnce()).toBe(0);
  });
});

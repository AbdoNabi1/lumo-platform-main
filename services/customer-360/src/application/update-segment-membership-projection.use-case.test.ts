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
import { InMemorySegmentHistoryStore } from "../infrastructure/in-memory-segment-history-store";
import { InMemorySegmentStore } from "../infrastructure/in-memory-segment-store";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import type { SegmentEvaluationResult } from "../ports/segment-evaluation";
import { UpdateSegmentMembershipProjection } from "./update-segment-membership-projection.use-case";

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
  const segments = new InMemorySegmentStore();
  const history = new InMemorySegmentHistoryStore({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const bus = new InMemoryEventBus();
  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock,
  });
  const useCase = new UpdateSegmentMembershipProjection({
    segments,
    history,
    unitOfWork,
    idGenerator: ids,
    clock,
  });
  return { useCase, segments, history, relay };
}

function evaluationResult(
  overrides: Partial<SegmentEvaluationResult> = {},
): SegmentEvaluationResult {
  return {
    identifier,
    segmentId,
    definitionId: segmentId,
    definitionVersion: 1,
    isMember: true,
    matchedRuleIds: ["high-value-rule"],
    usedFallback: false,
    degraded: false,
    ruleTrace: [{ ruleId: "high-value-rule", status: "matched" }],
    inputs: new Map([["profile.lifetime_value", 5000]]),
    contributingSources: new Map([
      ["profile.lifetime_value", { source: "orders", observedAt: "t0" }],
    ]),
    source: "segment:high_value",
    evaluatedAt: "2026-07-21T00:00:01.000Z",
    ...overrides,
  };
}

describe("UpdateSegmentMembershipProjection", () => {
  it("persists the first membership ever and publishes CustomerEnteredSegment", async () => {
    const { useCase, segments, relay } = wire();
    const result = await useCase.execute({ identifier, result: evaluationResult() });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.applied).toBe(true);
    expect(result.value.transition).toBe("entered");
    expect(result.value.version).toBe(1);

    const stored = await segments.getCurrent(identifier, segmentId);
    expect(stored?.status).toBe("entered");
    expect(await relay.drainOnce()).toBe(1);
  });

  it("is a no-op (applied: false) when re-evaluated with the same status and definitionVersion", async () => {
    const { useCase } = wire();
    await useCase.execute({ identifier, result: evaluationResult() });
    const second = await useCase.execute({
      identifier,
      result: evaluationResult({ evaluatedAt: "t5" }),
    });

    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.value.applied).toBe(false);
    expect(second.value.transition).toBe("unchanged");
  });

  it("is a no-op when an identifier that was never a member evaluates to not-a-member", async () => {
    const { useCase, segments, relay } = wire();
    const result = await useCase.execute({
      identifier,
      result: evaluationResult({ isMember: false }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.applied).toBe(false);
    expect(await segments.getCurrent(identifier, segmentId)).toBeNull();
    expect(await relay.drainOnce()).toBe(0);
  });

  it("transitions to exited and publishes CustomerExitedSegment when membership ends", async () => {
    const { useCase, relay } = wire();
    await useCase.execute({ identifier, result: evaluationResult() });
    await relay.drainOnce();

    const second = await useCase.execute({
      identifier,
      result: evaluationResult({ isMember: false, evaluatedAt: "2026-07-22T00:00:00.000Z" }),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.value.applied).toBe(true);
    expect(second.value.transition).toBe("exited");
    expect(await relay.drainOnce()).toBe(1);
  });

  it("applies but publishes nothing when definitionVersion bumps with status unchanged", async () => {
    const { useCase, segments, relay } = wire();
    await useCase.execute({ identifier, result: evaluationResult() });
    await relay.drainOnce();

    const second = await useCase.execute({
      identifier,
      result: evaluationResult({ definitionVersion: 2, evaluatedAt: "2026-07-22T00:00:00.000Z" }),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.value.applied).toBe(true);
    expect(second.value.transition).toBe("unchanged");
    expect(await relay.drainOnce()).toBe(0);

    const stored = await segments.getCurrent(identifier, segmentId);
    expect(stored?.definitionVersion).toBe(2);
  });

  it("appends a history entry for an applied refresh even though nothing transitioned", async () => {
    const { useCase, history } = wire();
    await useCase.execute({ identifier, result: evaluationResult() });
    await useCase.execute({
      identifier,
      result: evaluationResult({ definitionVersion: 2, evaluatedAt: "2026-07-22T00:00:00.000Z" }),
    });

    const entries = await history.listFor(identifier, segmentId);
    expect(entries.map((e) => e.reason)).toEqual(["entered", "refreshed"]);
  });
});

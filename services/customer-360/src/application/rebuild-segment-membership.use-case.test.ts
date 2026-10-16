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
import { applyMembershipUpdate } from "../domain/segment-membership";
import { toSnapshot } from "../domain/segment-history";
import { IdentityEventTranslator } from "../infrastructure/identity-event-translator";
import { InMemorySegmentHistoryStore } from "../infrastructure/in-memory-segment-history-store";
import { InMemorySegmentStore } from "../infrastructure/in-memory-segment-store";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { RebuildSegmentMembership } from "./rebuild-segment-membership.use-case";
import { TENANT_A } from "../test-support/tenants";

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
  const useCase = new RebuildSegmentMembership({
    segments,
    history,
    unitOfWork,
    idGenerator: ids,
    clock,
  });
  return { useCase, segments, history, relay };
}

describe("RebuildSegmentMembership", () => {
  it("returns null when the pair has no history at all", async () => {
    const { useCase } = wire();
    const result = await useCase.execute({ tenantId: TENANT_A, identifier, segmentId });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.membership).toBeNull();
  });

  it("rebuilds the cache from the latest snapshot without re-running any rule, and publishes MembershipRebuilt", async () => {
    const { useCase, segments, history, relay } = wire();
    const entered = applyMembershipUpdate(null, identifier.type, identifier.value, segmentId, {
      isMember: true,
      definitionId: segmentId,
      definitionVersion: 1,
      matchedRuleIds: ["r1"],
      inputs: new Map(),
      evaluatedAt: "t0",
    }).membership!;
    await history.append(toSnapshot(entered, "entered", "t0"), TENANT_A, undefined);
    expect(await segments.getCurrent(identifier, segmentId, TENANT_A)).toBeNull();

    const result = await useCase.execute({ tenantId: TENANT_A, identifier, segmentId });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.membership?.status).toBe("entered");

    const cached = await segments.getCurrent(identifier, segmentId, TENANT_A);
    expect(cached?.status).toBe("entered");
    expect(cached?.version).toBe(entered.version);
    expect(await relay.drainOnce()).toBe(1);
  });

  it("never regresses the cache when a concurrent update already advanced it past the snapshot this rebuild read", async () => {
    const { useCase, segments, history } = wire();

    const v1 = applyMembershipUpdate(null, identifier.type, identifier.value, segmentId, {
      isMember: true,
      definitionId: segmentId,
      definitionVersion: 1,
      matchedRuleIds: ["r1"],
      inputs: new Map(),
      evaluatedAt: "t0",
    }).membership!;
    await history.append(toSnapshot(v1, "entered", "t0"), TENANT_A, undefined);
    await segments.saveCurrent(v1, TENANT_A, 0);

    const v2 = applyMembershipUpdate(v1, identifier.type, identifier.value, segmentId, {
      isMember: false,
      definitionId: segmentId,
      definitionVersion: 1,
      matchedRuleIds: [],
      inputs: new Map(),
      evaluatedAt: "t1",
    }).membership!;
    await segments.saveCurrent(v2, TENANT_A, v1.version);

    const result = await useCase.execute({ tenantId: TENANT_A, identifier, segmentId });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.membership?.status).toBe("exited");
    expect(result.value.membership?.version).toBe(v2.version);

    const cached = await segments.getCurrent(identifier, segmentId, TENANT_A);
    expect(cached?.status).toBe("exited");

    const snapshots = await history.listFor(identifier, segmentId, TENANT_A);
    expect(snapshots).toHaveLength(1);
    expect(snapshots.map((s) => s.reason)).toEqual(["entered"]);
  });
});

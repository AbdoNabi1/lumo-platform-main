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
import { ConcurrencyError } from "@platform/utils";
import { IdentityEventTranslator } from "../infrastructure/identity-event-translator";
import { InMemorySegmentDefinitionRegistry } from "../infrastructure/in-memory-segment-definition-registry";
import { InMemorySegmentHistoryStore } from "../infrastructure/in-memory-segment-history-store";
import { InMemorySegmentStore } from "../infrastructure/in-memory-segment-store";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { applyMembershipUpdate } from "../domain/segment-membership";
import { toSnapshot } from "../domain/segment-history";
import { CreateSegment } from "./create-segment.use-case";
import { DeleteSegment } from "./delete-segment.use-case";
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
  const segments = new InMemorySegmentStore();
  const history = new InMemorySegmentHistoryStore({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const bus = new InMemoryEventBus();
  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock,
  });
  const create = new CreateSegment({ definitions, unitOfWork, idGenerator: ids, clock });
  const del = new DeleteSegment({ definitions, unitOfWork, idGenerator: ids, clock });
  return { create, del, definitions, segments, history, relay };
}

describe("DeleteSegment", () => {
  it("removes the definition from future evaluation and publishes SegmentDeleted", async () => {
    const { create, del, definitions, relay } = wire();
    await create.execute({
      tenantId: TENANT_A,
      id: "high_value",
      name: "High value",
      ruleSet: {
        id: "high_value",
        version: 1,
        mode: "first_match",
        rules: [{ id: "r1", priority: 1, when: Expr.literal(true), then: true }],
      },
    });
    await relay.drainOnce();

    const result = await del.execute({ tenantId: TENANT_A, id: "high_value", expectedVersion: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.deleted).toBe(true);

    expect(await definitions.getById("high_value", TENANT_A)).toBeNull();
    expect(await relay.drainOnce()).toBe(1);
  });

  it("rejects a stale expectedVersion with ConcurrencyError and never deletes", async () => {
    const { create, del, definitions } = wire();
    await create.execute({
      tenantId: TENANT_A,
      id: "high_value",
      name: "High value",
      ruleSet: {
        id: "high_value",
        version: 1,
        mode: "first_match",
        rules: [{ id: "r1", priority: 1, when: Expr.literal(true), then: true }],
      },
    });

    await expect(
      del.execute({ tenantId: TENANT_A, id: "high_value", expectedVersion: 99 }),
    ).rejects.toBeInstanceOf(ConcurrencyError);
    expect(await definitions.getById("high_value", TENANT_A)).not.toBeNull();
  });

  it("rejects deleting a segment that does not exist", async () => {
    const { del } = wire();
    const result = await del.execute({
      tenantId: TENANT_A,
      id: "does_not_exist",
      expectedVersion: 1,
    });
    expect(result.ok).toBe(false);
  });

  it("never cascades into existing SegmentMembership/SegmentHistory rows", async () => {
    const { create, del, segments, history } = wire();
    await create.execute({
      tenantId: TENANT_A,
      id: "high_value",
      name: "High value",
      ruleSet: {
        id: "high_value",
        version: 1,
        mode: "first_match",
        rules: [{ id: "r1", priority: 1, when: Expr.literal(true), then: true }],
      },
    });

    const identifier = { type: "customer_id" as const, value: "cust-1" };
    const membership = applyMembershipUpdate(
      null,
      identifier.type,
      identifier.value,
      "high_value",
      {
        isMember: true,
        definitionId: "high_value",
        definitionVersion: 1,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: "t0",
      },
    ).membership!;
    await segments.saveCurrent(membership, TENANT_A);
    await history.append(toSnapshot(membership, "entered", "t0"), TENANT_A, undefined);

    await del.execute({ tenantId: TENANT_A, id: "high_value", expectedVersion: 1 });

    expect(await segments.getCurrent(identifier, "high_value", TENANT_A)).not.toBeNull();
    expect(await history.listFor(identifier, "high_value", TENANT_A)).toHaveLength(1);
  });
});

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
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { CreateSegment } from "./create-segment.use-case";
import { UpdateSegment } from "./update-segment.use-case";

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
  const create = new CreateSegment({ definitions, unitOfWork, idGenerator: ids, clock });
  const update = new UpdateSegment({ definitions, unitOfWork, idGenerator: ids, clock });
  return { create, update, definitions, relay };
}

describe("UpdateSegment", () => {
  it("bumps version and publishes SegmentUpdated", async () => {
    const { create, update, definitions, relay } = wire();
    await create.execute({
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

    const result = await update.execute({
      id: "high_value",
      expectedVersion: 1,
      name: "High value (v2)",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.definition.version).toBe(2);

    const stored = await definitions.getById("high_value");
    expect(stored?.name).toBe("High value (v2)");
    expect(await relay.drainOnce()).toBe(1);
  });

  it("rejects a stale expectedVersion with ConcurrencyError and never applies the write", async () => {
    const { create, update, definitions } = wire();
    await create.execute({
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
      update.execute({ id: "high_value", expectedVersion: 99, name: "Stale" }),
    ).rejects.toBeInstanceOf(ConcurrencyError);
    expect((await definitions.getById("high_value"))?.name).toBe("High value");
  });

  it("rejects updating a segment that does not exist", async () => {
    const { update } = wire();
    const result = await update.execute({ id: "does_not_exist", expectedVersion: 1, name: "X" });
    expect(result.ok).toBe(false);
  });
});

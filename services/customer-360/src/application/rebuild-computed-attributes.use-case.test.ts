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
import { applyAttributeUpdate, createEmptyComputedAttribute } from "../domain/computed-attribute";
import { toSnapshot } from "../domain/attribute-snapshot";
import { IdentityEventTranslator } from "../infrastructure/identity-event-translator";
import { InMemoryAttributeHistoryStore } from "../infrastructure/in-memory-attribute-history-store";
import { InMemoryAttributeStore } from "../infrastructure/in-memory-attribute-store";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { RebuildComputedAttributes } from "./rebuild-computed-attributes.use-case";

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
  const useCase = new RebuildComputedAttributes({
    attributes,
    history,
    unitOfWork,
    idGenerator: ids,
    clock,
  });
  return { useCase, attributes, history, relay };
}

describe("RebuildComputedAttributes", () => {
  it("returns null when the identifier has no history at all", async () => {
    const { useCase } = wire();
    const result = await useCase.execute({ identifier });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.attribute).toBeNull();
    expect(result.value.attributeCount).toBe(0);
  });

  it("rebuilds the cache from the latest snapshot without re-running any rule, and publishes AttributeRebuilt", async () => {
    const { useCase, attributes, history, relay } = wire();
    const evaluated = applyAttributeUpdate(
      createEmptyComputedAttribute(identifier.type, identifier.value, "t0"),
      "is_vip",
      {
        value: true,
        definitionId: "is_vip",
        definitionVersion: 1,
        matchedRuleIds: ["vip-rule"],
        inputs: new Map(),
        evaluatedAt: "t0",
      },
    ).attribute;
    await history.append(toSnapshot(evaluated, "created", "t0"), undefined);
    // Corrupt/clear the cache to prove rebuild restores it from the ledger, not from the cache.
    expect(await attributes.getCurrent(identifier)).toBeNull();

    const result = await useCase.execute({ identifier });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.attributeCount).toBe(1);
    expect(result.value.attribute?.attributes.get("is_vip")?.value).toBe(true);

    const cached = await attributes.getCurrent(identifier);
    expect(cached?.attributes.get("is_vip")?.value).toBe(true);
    // The rebuild does not inflate the version — it recomputes, it does not assert a new fact.
    expect(cached?.version).toBe(evaluated.version);

    expect(await relay.drainOnce()).toBe(1);
  });

  it("never regresses the cache when a concurrent update already advanced it past the snapshot this rebuild read (ADR-0060 follow-up)", async () => {
    const { useCase, attributes, history } = wire();

    // "Day 1" state: one attribute, cache and ledger agree at version 1.
    const v1 = applyAttributeUpdate(
      createEmptyComputedAttribute(identifier.type, identifier.value, "t0"),
      "tier",
      {
        value: "bronze",
        definitionId: "tier",
        definitionVersion: 1,
        matchedRuleIds: ["bronze-rule"],
        inputs: new Map(),
        evaluatedAt: "t0",
      },
    ).attribute;
    await history.append(toSnapshot(v1, "created", "t0"), undefined);
    await attributes.saveCurrent(v1, 0);

    // Simulate the race directly at the store level: by the time this rebuild's own transaction
    // runs, a concurrent `UpdateComputedAttributeProjection` has already committed a newer version to
    // the cache (its CAS write lands first, per that use case's own ordering) even though this
    // rebuild's in-flight `execute()` call — reading `history.latestFor` at its own, earlier moment —
    // would otherwise only ever see up to v1 here, since the test never appends a v2 ledger entry.
    // What matters for the guard is exactly this: the cache is now ahead of whatever `rebuilt` this
    // call computes.
    const v2 = applyAttributeUpdate(v1, "tier", {
      value: "gold",
      definitionId: "tier",
      definitionVersion: 1,
      matchedRuleIds: ["gold-rule"],
      inputs: new Map(),
      evaluatedAt: "t1",
    }).attribute;
    await attributes.saveCurrent(v2, v1.version);

    // The rebuild proceeds using the v1 snapshot it read from the ledger. Without the staleness guard
    // this would overwrite the cache back to "bronze"/v1, silently undoing the concurrent update with
    // no error and no signal.
    const result = await useCase.execute({ identifier });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    // The already-newer cache state is returned as-is, not clobbered.
    expect(result.value.attribute?.attributes.get("tier")?.value).toBe("gold");
    expect(result.value.attribute?.version).toBe(v2.version);

    const cached = await attributes.getCurrent(identifier);
    expect(cached?.attributes.get("tier")?.value).toBe("gold");
    expect(cached?.version).toBe(v2.version);

    // No spurious "rebuilt" snapshot was appended for the stale v1 state either.
    const snapshots = await history.listFor(identifier);
    expect(snapshots).toHaveLength(1);
    expect(snapshots.map((s) => s.reason)).toEqual(["created"]);
  });
});

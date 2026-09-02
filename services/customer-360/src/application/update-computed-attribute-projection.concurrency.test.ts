import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import {
  InMemoryEventBus,
  InMemoryEventPublisher,
  InMemoryOutboxStore,
  OutboxRelay,
  OutboxWriter,
  rootEventContext,
} from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import { IdentityEventTranslator } from "../infrastructure/identity-event-translator";
import { InMemoryAttributeHistoryStore } from "../infrastructure/in-memory-attribute-history-store";
import { InMemoryAttributeStore } from "../infrastructure/in-memory-attribute-store";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import type { AttributeEvaluationResult } from "../ports/attribute-evaluation";
import { UpdateComputedAttributeProjection } from "./update-computed-attribute-projection.use-case";

/**
 * Phase 6.4.1 hardening — Task 6 (Concurrency Validation), F2 follow-up sprint.
 *
 * ORIGINAL FINDING (`docs/implementation/SPRINT_6_4_1_HARDENING_REPORT.md` §6): two concurrent
 * evaluations for the same identifier raced on `AttributeStore.saveCurrent`'s blind upsert, and the
 * second write silently discarded the first's applied change — no exception, no signal, permanent
 * data loss. **FIXED** by ADR-0060: `saveCurrent` now takes an optional `expectedVersion` and performs
 * a compare-and-swap; `UpdateComputedAttributeProjection` passes the version it read. This suite now
 * proves the fix: the losing call **rejects** with `ConcurrencyError` instead of silently succeeding,
 * no attribute is ever lost undetected, and a caller that retries recovers both changes in full.
 */

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
  identifier: { type: "customer_id"; value: string },
  definitionId: string,
  value: boolean,
): AttributeEvaluationResult {
  return {
    identifier,
    definitionId,
    definitionVersion: 1,
    value,
    matchedRuleIds: [`${definitionId}-rule`],
    usedFallback: false,
    degraded: false,
    ruleTrace: [{ ruleId: `${definitionId}-rule`, status: "matched" }],
    inputs: new Map(),
    contributingSources: new Map(),
    source: `computed-attribute:${definitionId}`,
    evaluatedAt: "2026-07-21T00:00:01.000Z",
  };
}

describe("UpdateComputedAttributeProjection — concurrency, POST-FIX (Task 6 / F2)", () => {
  it("FIXED: two concurrent evaluations for the SAME identifier — exactly one succeeds, the other rejects with ConcurrencyError, no attribute is silently lost", async () => {
    const { useCase, attributes, history } = wire();
    const identifier = { type: "customer_id" as const, value: "cust-race" };

    const settled = await Promise.allSettled([
      useCase.execute({ identifier, result: evaluationResult(identifier, "is_vip", true) }),
      useCase.execute({ identifier, result: evaluationResult(identifier, "is_churn_risk", true) }),
    ]);

    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    const rejected = settled.filter((s) => s.status === "rejected");

    // Exactly one side wins, exactly one side is explicitly, typed-ly rejected — never both silently
    // "succeeding" with one clobbering the other's data.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyError);
    expect((rejected[0] as PromiseRejectedResult).reason.retryable).toBe(true);

    const winningResult = (
      fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof useCase.execute>>>
    ).value;
    expect(winningResult.ok).toBe(true);

    const finalState = await attributes.getCurrent(identifier);
    // Exactly the winner's attribute is persisted — one attribute, not zero, not a silent merge.
    expect(finalState?.attributes.size).toBe(1);

    // The reordering in ADR-0060 (CAS write before history append) means the loser leaves NO trace
    // at all in the durable ledger either — not an orphaned snapshot with no corresponding cache row.
    const snapshots = await history.listFor(identifier);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.attributes.size).toBe(1);
  });

  it("FIXED, end to end: after a losing write's caller retries (re-read, re-apply, re-write), BOTH attributes end up persisted — no permanent data loss, just a required retry", async () => {
    const { useCase, attributes } = wire();
    const identifier = { type: "customer_id" as const, value: "cust-race-retry" };

    const settled = await Promise.allSettled([
      useCase.execute({ identifier, result: evaluationResult(identifier, "is_vip", true) }),
      useCase.execute({ identifier, result: evaluationResult(identifier, "is_churn_risk", true) }),
    ]);

    const loserIndex = settled.findIndex((s) => s.status === "rejected");
    expect(loserIndex).toBeGreaterThanOrEqual(0);
    const loserDefinitionId = loserIndex === 0 ? "is_vip" : "is_churn_risk";

    // The retry is exactly what ADR-0060 says a caller must do: re-run the whole operation. Since
    // `evaluationResult` here doesn't depend on any freshly-read state, "retry" is just calling
    // `execute` again — `UpdateComputedAttributeProjection` itself re-reads `getCurrent` at the top
    // of `execute`, so it naturally picks up the winner's now-current version as its new base.
    const retried = await useCase.execute({
      identifier,
      result: evaluationResult(identifier, loserDefinitionId, true),
    });
    expect(retried.ok).toBe(true);

    const finalState = await attributes.getCurrent(identifier);
    expect(finalState?.attributes.size).toBe(2);
    expect(finalState?.attributes.get("is_vip")?.value).toBe(true);
    expect(finalState?.attributes.get("is_churn_risk")?.value).toBe(true);
  });

  it("concurrent evaluations for DIFFERENT identifiers never conflict — CAS is scoped per identifier, not global", async () => {
    const { useCase, attributes } = wire();
    const identifierA = { type: "customer_id" as const, value: "cust-a" };
    const identifierB = { type: "customer_id" as const, value: "cust-b" };

    const [resultA, resultB] = await Promise.all([
      useCase.execute({
        identifier: identifierA,
        result: evaluationResult(identifierA, "is_vip", true),
      }),
      useCase.execute({
        identifier: identifierB,
        result: evaluationResult(identifierB, "is_vip", true),
      }),
    ]);

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);

    const stateA = await attributes.getCurrent(identifierA);
    const stateB = await attributes.getCurrent(identifierB);
    expect(stateA?.attributes.get("is_vip")?.value).toBe(true);
    expect(stateB?.attributes.get("is_vip")?.value).toBe(true);
  });

  it("the conflict outcome is deterministic (Node's microtask scheduling, not true randomness) — the same side wins across repeated runs with identical code shape", async () => {
    const identifier = { type: "customer_id" as const, value: "cust-race-repeat" };
    const winners: string[] = [];

    for (let run = 0; run < 5; run += 1) {
      const { useCase, attributes } = wire();
      await Promise.allSettled([
        useCase.execute({ identifier, result: evaluationResult(identifier, "is_vip", true) }),
        useCase.execute({
          identifier,
          result: evaluationResult(identifier, "is_churn_risk", true),
        }),
      ]);
      const finalState = await attributes.getCurrent(identifier);
      const survivor = [...(finalState?.attributes.keys() ?? [])][0];
      winners.push(survivor ?? "none");
    }

    expect(new Set(winners).size).toBe(1);
  });
});

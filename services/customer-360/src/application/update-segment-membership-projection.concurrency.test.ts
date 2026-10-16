import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import { IdentityEventTranslator } from "../infrastructure/identity-event-translator";
import { InMemorySegmentHistoryStore } from "../infrastructure/in-memory-segment-history-store";
import { InMemorySegmentStore } from "../infrastructure/in-memory-segment-store";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import type { SegmentEvaluationResult } from "../ports/segment-evaluation";
import { UpdateSegmentMembershipProjection } from "./update-segment-membership-projection.use-case";
import { TENANT_A } from "../test-support/tenants";

/**
 * Same CAS race the Phase 6.4.1 hardening suite proves for `UpdateComputedAttributeProjection`
 * (`update-computed-attribute-projection.concurrency.test.ts`), mirrored here for
 * `UpdateSegmentMembershipProjection` — a second, structurally identical write path this engine adds,
 * needing the identical proof: exactly one concurrent write wins per `(identifier, segmentId)` pair,
 * the loser rejects with a typed, retryable `ConcurrencyError` (never a silent clobber), and a retry
 * recovers cleanly.
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
  const segments = new InMemorySegmentStore();
  const history = new InMemorySegmentHistoryStore({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const useCase = new UpdateSegmentMembershipProjection({
    segments,
    history,
    unitOfWork,
    idGenerator: ids,
    clock,
  });
  return { useCase, segments, history };
}

function evaluationResult(
  identifier: { type: "customer_id"; value: string },
  segmentId: string,
  isMember: boolean,
): SegmentEvaluationResult {
  return {
    identifier,
    segmentId,
    definitionId: segmentId,
    definitionVersion: 1,
    isMember,
    matchedRuleIds: [`${segmentId}-rule`],
    usedFallback: false,
    degraded: false,
    ruleTrace: [{ ruleId: `${segmentId}-rule`, status: "matched" }],
    inputs: new Map(),
    contributingSources: new Map(),
    source: `segment:${segmentId}`,
    evaluatedAt: "2026-07-21T00:00:01.000Z",
  };
}

describe("UpdateSegmentMembershipProjection — concurrency (CAS race)", () => {
  it("two concurrent first-ever entries for the SAME (identifier, segmentId) — exactly one succeeds, the other rejects with ConcurrencyError", async () => {
    const { useCase, segments, history } = wire();
    const identifier = { type: "customer_id" as const, value: "cust-race" };
    const segmentId = "high_value";

    const settled = await Promise.allSettled([
      useCase.execute({
        tenantId: TENANT_A,
        identifier,
        result: evaluationResult(identifier, segmentId, true),
      }),
      useCase.execute({
        tenantId: TENANT_A,
        identifier,
        result: evaluationResult(identifier, segmentId, true),
      }),
    ]);

    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    const rejected = settled.filter((s) => s.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyError);
    expect((rejected[0] as PromiseRejectedResult).reason.retryable).toBe(true);

    const finalState = await segments.getCurrent(identifier, segmentId, TENANT_A);
    expect(finalState?.status).toBe("entered");
    expect(finalState?.version).toBe(1);

    // The loser leaves no trace in the durable ledger either (CAS write before history append).
    const entries = await history.listFor(identifier, segmentId, TENANT_A);
    expect(entries).toHaveLength(1);
  });

  it("end to end: after a losing write's caller retries, the retry succeeds against the winner's now-current state", async () => {
    const { useCase, segments } = wire();
    const identifier = { type: "customer_id" as const, value: "cust-race-retry" };
    const segmentId = "high_value";

    const settled = await Promise.allSettled([
      useCase.execute({
        tenantId: TENANT_A,
        identifier,
        result: evaluationResult(identifier, segmentId, true),
      }),
      useCase.execute({
        tenantId: TENANT_A,
        identifier,
        result: evaluationResult(identifier, segmentId, true),
      }),
    ]);
    expect(settled.some((s) => s.status === "rejected")).toBe(true);

    // Retry: exit the segment. `UpdateSegmentMembershipProjection` re-reads `getCurrent` at the top of
    // `execute`, so it naturally picks up the winner's now-current version as its new base.
    const retried = await useCase.execute({
      tenantId: TENANT_A,
      identifier,
      result: evaluationResult(identifier, segmentId, false),
    });
    expect(retried.ok).toBe(true);
    if (!retried.ok) throw new Error("unreachable");
    expect(retried.value.transition).toBe("exited");

    const finalState = await segments.getCurrent(identifier, segmentId, TENANT_A);
    expect(finalState?.status).toBe("exited");
    expect(finalState?.version).toBe(2);
  });

  it("concurrent writes for DIFFERENT (identifier, segmentId) pairs never conflict — CAS is scoped per pair, not global", async () => {
    const { useCase, segments } = wire();
    const identifier = { type: "customer_id" as const, value: "cust-a" };

    const [resultA, resultB] = await Promise.all([
      useCase.execute({
        tenantId: TENANT_A,
        identifier,
        result: evaluationResult(identifier, "high_value", true),
      }),
      useCase.execute({
        tenantId: TENANT_A,
        identifier,
        result: evaluationResult(identifier, "churn_risk", true),
      }),
    ]);

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);

    expect((await segments.getCurrent(identifier, "high_value", TENANT_A))?.status).toBe("entered");
    expect((await segments.getCurrent(identifier, "churn_risk", TENANT_A))?.status).toBe("entered");
  });
});

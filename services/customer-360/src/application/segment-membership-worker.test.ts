import { describe, expect, it } from "vitest";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { IdentifierType } from "@platform/tracking";
import { InMemorySegmentDefinitionRegistry } from "../infrastructure/in-memory-segment-definition-registry";
import { IdentityEventTranslator } from "../infrastructure/identity-event-translator";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Expr } from "@platform/expression";
import type { SegmentStore } from "../ports/segment-store";
import type {
  EvaluateAllSegments,
  EvaluateAllSegmentsInput,
  EvaluateAllSegmentsOutput,
} from "./evaluate-all-segments.use-case";
import { SegmentMembershipWorker } from "./segment-membership-worker";

const clock: Clock = { now: () => new Date("2026-07-21T00:00:00.000Z") };
const ids: IdGenerator = { generate: () => crypto.randomUUID() };

function storeWithPairs(
  pairs: readonly { identifierValue: string; segmentId: string }[],
): SegmentStore {
  return {
    getCurrent: async () => null,
    saveCurrent: async () => {},
    listForIdentifier: async () => [],
    listMembers: async () => [],
    listIdentifiers: async () =>
      pairs.map((p) => ({
        identifier: { type: "customer_id" as IdentifierType, value: p.identifierValue },
        segmentId: p.segmentId,
      })),
  };
}

function registry() {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new IdentityEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "customer360",
  });
  return new InMemorySegmentDefinitionRegistry({ outbox, context: rootEventContext(ids) }, [
    {
      id: "high_value",
      name: "High value",
      version: 1,
      ruleSet: {
        id: "high_value",
        version: 1,
        mode: "first_match",
        rules: [{ id: "r", priority: 1, when: Expr.literal(true), then: true }],
      },
      createdAt: "t0",
      updatedAt: "t0",
    },
  ]);
}

function fakeEvaluateAll(): {
  evaluateAll: EvaluateAllSegments;
  calls: EvaluateAllSegmentsInput[];
} {
  const calls: EvaluateAllSegmentsInput[] = [];
  const handler = async (
    input: EvaluateAllSegmentsInput,
  ): Promise<Result<EvaluateAllSegmentsOutput, DomainError>> => {
    calls.push(input);
    return ok({ results: [], applied: [] });
  };
  return { evaluateAll: { execute: handler } as EvaluateAllSegments, calls };
}

describe("SegmentMembershipWorker", () => {
  it("re-evaluates every distinct known identifier against the full registered segment set", async () => {
    const segments = storeWithPairs([
      { identifierValue: "cust-a", segmentId: "high_value" },
      { identifierValue: "cust-a", segmentId: "low_value" }, // same identifier, two segments — deduped
      { identifierValue: "cust-b", segmentId: "high_value" },
    ]);
    const { evaluateAll, calls } = fakeEvaluateAll();
    const worker = new SegmentMembershipWorker({ segments, definitions: registry(), evaluateAll });

    const result = await worker.execute({});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ evaluated: 2, failed: 0 });
    expect(calls.map((c) => c.identifier.value).sort()).toEqual(["cust-a", "cust-b"]);
    expect(calls[0]?.definitions.map((d) => d.id)).toEqual(["high_value"]);
  });

  it("isolates one identifier's failure — the rest of the sweep still runs", async () => {
    const segments = storeWithPairs([
      { identifierValue: "cust-a", segmentId: "high_value" },
      { identifierValue: "cust-b", segmentId: "high_value" },
    ]);
    let calls = 0;
    // `EvaluateAllSegments` is a class with private fields, so a plain `{ execute }` object has
    // no structural overlap with it (comparability fails) — needs the `unknown` hop.
    const evaluateAll: EvaluateAllSegments = {
      execute: async () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        return ok({ results: [], applied: [] });
      },
    } as unknown as EvaluateAllSegments;
    const worker = new SegmentMembershipWorker({ segments, definitions: registry(), evaluateAll });

    const result = await worker.execute({});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ evaluated: 1, failed: 1 });
  });

  it("reports evaluated: 0, failed: 0 when there are no known identifiers", async () => {
    const { evaluateAll } = fakeEvaluateAll();
    const worker = new SegmentMembershipWorker({
      segments: storeWithPairs([]),
      definitions: registry(),
      evaluateAll,
    });

    const result = await worker.execute({});
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ evaluated: 0, failed: 0 });
  });
});

import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Expr } from "@platform/expression";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import type { RuleSet } from "@platform/rules";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { IdentityEventTranslator } from "../infrastructure/identity-event-translator";
import { InMemorySegmentDefinitionRegistry } from "../infrastructure/in-memory-segment-definition-registry";
import { InMemorySegmentHistoryStore } from "../infrastructure/in-memory-segment-history-store";
import { InMemorySegmentStore } from "../infrastructure/in-memory-segment-store";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import type { SegmentDefinition } from "../ports/segment-definition";
import { EvaluateAllSegments } from "./evaluate-all-segments.use-case";
import { EvaluateSegment } from "./evaluate-segment.use-case";
import type {
  GetComputedAttributes,
  GetComputedAttributesInput,
  GetComputedAttributesOutput,
} from "./get-computed-attributes.use-case";
import type {
  GetCustomerProfile,
  GetCustomerProfileInput,
  GetCustomerProfileOutput,
} from "./get-customer-profile.use-case";
import type {
  GetJourneyState,
  GetJourneyStateInput,
  GetJourneyStateOutput,
} from "./get-journey-state.use-case";
import { RebuildSegmentMembership } from "./rebuild-segment-membership.use-case";
import { RecalculateMemberships } from "./recalculate-memberships.use-case";
import { UpdateSegmentMembershipProjection } from "./update-segment-membership-projection.use-case";
import { TENANT_A } from "../test-support/tenants";

/**
 * Segmentation analogue of the Phase 6.4.1 hardening suite's Replay Safety task
 * (`rebuild-computed-attributes.replay-safety.test.ts`), same conclusion: there is no "replay"
 * mechanism here either. `RebuildSegmentMembership` reconstructs from the **latest** history entry
 * only, and re-evaluation always uses whatever `SegmentDefinition` it is handed **now** — there is no
 * "as of definition version 1" API anywhere in this engine's ports.
 */

const clock: Clock = { now: () => new Date("2026-07-21T00:00:00.000Z") };
const ids: IdGenerator = { generate: () => crypto.randomUUID() };
const identifier = { type: "customer_id" as const, value: "cust-replay" };

function fakeGetCustomerProfile(): GetCustomerProfile {
  const handler = async (
    _input: GetCustomerProfileInput,
  ): Promise<Result<GetCustomerProfileOutput, DomainError>> =>
    ok({
      profile: null,
      mergedFrom: [identifier],
      completeness: null,
      confidence: null,
      freshness: null,
      sources: null,
    });
  return { execute: handler } as GetCustomerProfile;
}

function fakeGetJourneyState(): GetJourneyState {
  const handler = async (
    _input: GetJourneyStateInput,
  ): Promise<Result<GetJourneyStateOutput, DomainError>> =>
    ok({ state: { visitorId: "v1", sessionCount: 0, identified: false } });
  return { execute: handler } as GetJourneyState;
}

function fakeGetComputedAttributes(): GetComputedAttributes {
  const handler = async (
    _input: GetComputedAttributesInput,
  ): Promise<Result<GetComputedAttributesOutput, DomainError>> =>
    ok({ attribute: null, mergedFrom: [] });
  return { execute: handler } as GetComputedAttributes;
}

function segmentDefinition(id: string, version: number, isMember: boolean): SegmentDefinition {
  const ruleSet: RuleSet<boolean> = {
    id,
    version,
    mode: "first_match",
    rules: [{ id: `rule-v${version}`, priority: 1, when: Expr.literal(isMember), then: true }],
    fallback: false,
  };
  return { id, name: id, version, ruleSet, createdAt: "t0", updatedAt: "t0" };
}

describe("Segmentation — Replay Safety", () => {
  it("rebuild reflects only the latest history entry, and re-evaluation always uses the current definition — never a historical one, even though the ledger still holds it", async () => {
    const outbox = new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new IdentityEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "customer360",
    });
    const context = rootEventContext(ids);
    const segments = new InMemorySegmentStore();
    const history = new InMemorySegmentHistoryStore({ outbox, context });
    const unitOfWork = new InMemoryUnitOfWork();
    const updateProjection = new UpdateSegmentMembershipProjection({
      segments,
      history,
      unitOfWork,
      idGenerator: ids,
      clock,
    });
    const rebuild = new RebuildSegmentMembership({
      segments,
      history,
      unitOfWork,
      idGenerator: ids,
      clock,
    });

    function recalculateAgainst(definition: SegmentDefinition): RecalculateMemberships {
      const evaluate = new EvaluateSegment({
        getCustomerProfile: fakeGetCustomerProfile(),
        getJourneyState: fakeGetJourneyState(),
        getComputedAttributes: fakeGetComputedAttributes(),
        clock,
      });
      const evaluateAll = new EvaluateAllSegments({ evaluate, updateProjection });
      const registry = new InMemorySegmentDefinitionRegistry(
        { outbox, context },
        { tenantId: TENANT_A, definitions: [definition] },
      );
      return new RecalculateMemberships({ definitions: registry, evaluateAll });
    }

    // "Day 1": definition v1 — matches.
    const v1Result = await recalculateAgainst(segmentDefinition("high_value", 1, true)).execute({
      tenantId: TENANT_A,
      identifier,
    });
    expect(v1Result.ok).toBe(true);

    const afterV1 = await segments.getCurrent(identifier, "high_value", TENANT_A);
    expect(afterV1?.status).toBe("entered");
    expect(afterV1?.definitionVersion).toBe(1);

    // "Day 2": the rule author changes the definition — v2 no longer matches.
    const v2Result = await recalculateAgainst(segmentDefinition("high_value", 2, false)).execute({
      tenantId: TENANT_A,
      identifier,
    });
    expect(v2Result.ok).toBe(true);

    const afterV2 = await segments.getCurrent(identifier, "high_value", TENANT_A);
    expect(afterV2?.status).toBe("exited");
    expect(afterV2?.definitionVersion).toBe(2);

    // The ledger still holds BOTH entries — history is never pruned or overwritten.
    const allEntries = await history.listFor(identifier, "high_value", TENANT_A);
    expect(allEntries.length).toBe(2);
    expect(allEntries[0]?.definitionVersion).toBe(1);
    expect(allEntries[1]?.definitionVersion).toBe(2);

    // Ground truth #1: RebuildSegmentMembership reconstructs from the LATEST entry only — "exited"/v2,
    // never "entered"/v1, even though v1's entry is still sitting in the ledger.
    const rebuilt = await rebuild.execute({
      tenantId: TENANT_A,
      identifier,
      segmentId: "high_value",
    });
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) throw new Error("unreachable");
    expect(rebuilt.value.membership?.status).toBe("exited");
    expect(rebuilt.value.membership?.definitionVersion).toBe(2);

    // Ground truth #2: no API in this engine's ports reconstructs "as of definitionVersion 1" — the
    // only way to see "entered"/v1 again is reading `allEntries[0]` directly off the raw ledger.
    expect(allEntries[0]?.status).toBe("entered");
  });
});

import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Expr } from "@platform/expression";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import type { RuleSet } from "@platform/rules";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { AttributeValue } from "../domain/attribute-value";
import { IdentityEventTranslator } from "../infrastructure/identity-event-translator";
import { InMemoryAttributeDefinitionRegistry } from "../infrastructure/in-memory-attribute-definition-registry";
import { InMemoryAttributeHistoryStore } from "../infrastructure/in-memory-attribute-history-store";
import { InMemoryAttributeStore } from "../infrastructure/in-memory-attribute-store";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import type { ComputedAttributeDefinition } from "../ports/computed-attribute-definition";
import { EvaluateAttributeGraph } from "./evaluate-attribute-graph.use-case";
import { EvaluateComputedAttribute } from "./evaluate-computed-attribute.use-case";
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
import { RebuildComputedAttributes } from "./rebuild-computed-attributes.use-case";
import { RecalculateComputedAttributes } from "./recalculate-computed-attributes.use-case";
import { UpdateComputedAttributeProjection } from "./update-computed-attribute-projection.use-case";
import { TENANT_A } from "../test-support/tenants";

/**
 * Phase 6.4.1 hardening — Task 3 (Replay Safety).
 *
 * There is no "Replay" feature anywhere in Computed Attributes (confirmed by repo-wide search — zero
 * `Replay`/`replay` code under `services/customer-360`). This suite does not invent one — building it
 * would be new feature work, out of scope for a hardening sprint. Instead it pins down, with
 * executable proof, exactly what "recovery" means today so any future change that silently starts
 * pretending to be a replay mechanism (or silently loses today's latest-snapshot guarantee) is caught:
 *
 * 1. `RebuildComputedAttributes` reconstructs the cache from the **latest** history snapshot only —
 *    never any earlier one, even though earlier snapshots remain in the ledger forever.
 * 2. Live (re-)evaluation always uses whatever `ComputedAttributeDefinition` it is handed **now** —
 *    there is no mechanism to evaluate "as of" a past definition version, even though each historical
 *    snapshot still records which `definitionVersion` produced it.
 *
 * Both are real gaps for any future "what was this attribute on date X, under the rules in force
 * then" use case — documented as such in `docs/implementation/SPRINT_6_4_1_HARDENING_REPORT.md`, not
 * fixed here.
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

function tierDefinition(version: number, outcome: AttributeValue): ComputedAttributeDefinition {
  const ruleSet: RuleSet<AttributeValue> = {
    id: "tier",
    version,
    mode: "first_match",
    rules: [{ id: `rule-v${version}`, priority: 1, when: Expr.literal(true), then: outcome }],
  };
  return { id: "tier", version, ruleSet, dependencies: [] };
}

describe("Computed Attributes — Replay Safety (Task 3)", () => {
  it("rebuild reflects only the latest snapshot, and re-evaluation always uses the current definition — never a historical one, even though the ledger still holds it", async () => {
    // Shared, durable stores — standing in for "the same identifier's data over calendar time", the
    // one thing that stays constant while the registry (rule authoring) changes underneath it.
    const outbox = new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new IdentityEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "customer360",
    });
    const context = rootEventContext(ids);
    const attributes = new InMemoryAttributeStore();
    const history = new InMemoryAttributeHistoryStore({ outbox, context });
    const unitOfWork = new InMemoryUnitOfWork();
    const updateProjection = new UpdateComputedAttributeProjection({
      attributes,
      history,
      unitOfWork,
      idGenerator: ids,
      clock,
    });
    const rebuild = new RebuildComputedAttributes({
      attributes,
      history,
      unitOfWork,
      idGenerator: ids,
      clock,
    });

    function recalculateAgainst(
      definition: ComputedAttributeDefinition,
    ): RecalculateComputedAttributes {
      const evaluate = new EvaluateComputedAttribute({
        getCustomerProfile: fakeGetCustomerProfile(),
        getJourneyState: fakeGetJourneyState(),
        attributes,
        clock,
      });
      const evaluateGraph = new EvaluateAttributeGraph({ evaluate, updateProjection });
      const registry = new InMemoryAttributeDefinitionRegistry({
        tenantId: TENANT_A,
        definitions: [definition],
      });
      return new RecalculateComputedAttributes({ definitions: registry, evaluateGraph });
    }

    // "Day 1": definition v1 says "gold".
    const v1Result = await recalculateAgainst(tierDefinition(1, "gold")).execute({
      tenantId: TENANT_A,
      identifier,
    });
    expect(v1Result.ok).toBe(true);

    const afterV1 = await attributes.getCurrent(identifier, TENANT_A);
    expect(afterV1?.attributes.get("tier")?.value).toBe("gold");
    expect(afterV1?.attributes.get("tier")?.definitionVersion).toBe(1);

    // "Day 2": the rule author changes the definition — v2 now says "bronze". Nothing in this engine
    // re-derives Day 1's cache; a fresh recompute against the new definition is what an upstream
    // caller would trigger (this phase never built that automatic trigger — see the model doc's
    // deferred-work section — but the recompute API itself is exercised here directly).
    const v2Result = await recalculateAgainst(tierDefinition(2, "bronze")).execute({
      tenantId: TENANT_A,
      identifier,
    });
    expect(v2Result.ok).toBe(true);

    const afterV2 = await attributes.getCurrent(identifier, TENANT_A);
    expect(afterV2?.attributes.get("tier")?.value).toBe("bronze");
    expect(afterV2?.attributes.get("tier")?.definitionVersion).toBe(2);

    // The ledger still holds BOTH snapshots — history is never pruned or overwritten.
    const allSnapshots = await history.listFor(identifier, TENANT_A);
    expect(allSnapshots.length).toBe(2);
    expect(allSnapshots[0]?.attributes.get("tier")?.definitionVersion).toBe(1);
    expect(allSnapshots[1]?.attributes.get("tier")?.definitionVersion).toBe(2);

    // Ground truth #1: RebuildComputedAttributes reconstructs from the LATEST snapshot only — it
    // returns "bronze"/v2, never "gold"/v1, even though v1's snapshot is still sitting in the ledger.
    const rebuilt = await rebuild.execute({ tenantId: TENANT_A, identifier });
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) throw new Error("unreachable");
    expect(rebuilt.value.attribute?.attributes.get("tier")?.value).toBe("bronze");
    expect(rebuilt.value.attribute?.attributes.get("tier")?.definitionVersion).toBe(2);

    // Ground truth #2: there is no API anywhere in this engine's ports (`AttributeHistoryStore`,
    // `RebuildComputedAttributes`, `GetComputedAttributes`) that accepts "as of version 1" or "as of
    // timestamp t0" and reconstructs the Day-1 "gold" state. The only way to see "gold" again is to
    // read `allSnapshots[0]` directly off the raw ledger, bypassing every use case this engine
    // exposes — which is exactly the gap this test exists to make visible.
    expect(allSnapshots[0]?.attributes.get("tier")?.value).toBe("gold");
  });
});

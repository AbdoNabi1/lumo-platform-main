import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { DomainEvent } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { addEdge, EMPTY_IDENTITY_GRAPH, type IdentityGraph } from "@platform/tracking";
import type { IdentityDecision } from "../ports/identity-decision";
import type { IdentityDecisionStore } from "../ports/identity-decision-store";
import type { IdentityGraphStore } from "../ports/identity-graph-store";
import { SplitIdentity } from "./split-identity.use-case";
import { TENANT_A } from "../test-support/tenants";

function fakeDeps(observed: IdentityGraph = EMPTY_IDENTITY_GRAPH) {
  const recorded: IdentityDecision[] = [];
  const decisions: IdentityDecisionStore = {
    record: async (decision: IdentityDecision, _event: DomainEvent) => {
      recorded.push(decision);
    },
    listFor: async () => [],
    retractedEdges: async () => [],
  };
  const graph: IdentityGraphStore = {
    appendEdge: async () => {},
    loadGraph: async () => observed,
  };
  const unitOfWork: TransactionalUnitOfWork<unknown> = { run: (work) => work(undefined) };
  const idGenerator: IdGenerator = { generate: () => "decision-1" };
  const clock: Clock = { now: () => new Date("2026-07-20T00:00:00.000Z") };
  return { graph, decisions, recorded, unitOfWork, idGenerator, clock };
}

const edge = {
  fromType: "visitor_id" as const,
  fromValue: "v1",
  toType: "device_id" as const,
  toValue: "shared-tablet",
  confidence: "probabilistic" as const,
  observedAt: "2026-07-19T00:00:00.000Z",
  source: "server_stitch",
};

const graphWithEdge = addEdge(EMPTY_IDENTITY_GRAPH, edge);

describe("SplitIdentity", () => {
  it("rejects a blank reason", async () => {
    const deps = fakeDeps();
    const useCase = new SplitIdentity(deps);
    const result = await useCase.execute({
      tenantId: TENANT_A,
      edge,
      reason: "  ",
      actor: "operator-1",
    });
    expect(result.ok).toBe(false);
    expect(deps.recorded).toHaveLength(0);
  });

  it("rejects a blank actor", async () => {
    const deps = fakeDeps();
    const useCase = new SplitIdentity(deps);
    const result = await useCase.execute({
      tenantId: TENANT_A,
      edge,
      reason: "wrong stitch",
      actor: "  ",
    });
    expect(result.ok).toBe(false);
  });

  it("records the decision with the retracted edge and full provenance", async () => {
    const deps = fakeDeps(graphWithEdge);
    const useCase = new SplitIdentity(deps);
    const result = await useCase.execute({
      tenantId: TENANT_A,
      edge,
      reason: "wrong stitch",
      actor: "operator-1",
    });

    expect(result.ok).toBe(true);
    expect(deps.recorded).toHaveLength(1);
    expect(deps.recorded[0]).toMatchObject({
      kind: "split",
      subject: { type: "visitor_id", value: "v1" },
      related: { type: "device_id", value: "shared-tablet" },
      retractedEdge: edge,
      reason: "wrong stitch",
      actor: "operator-1",
    });
  });

  it("rejects splitting an edge that was never observed, instead of silently no-oping", async () => {
    // Regression: before this check, a mistyped or fabricated edge would still record a decision
    // row — `excludeRetractedEdges` matches by the same key and would find nothing to exclude, so
    // the caller sees success ("split.ok === true") while resolution is completely unaffected.
    const deps = fakeDeps(EMPTY_IDENTITY_GRAPH);
    const useCase = new SplitIdentity(deps);
    const result = await useCase.execute({
      tenantId: TENANT_A,
      edge,
      reason: "wrong stitch",
      actor: "operator-1",
    });

    expect(result.ok).toBe(false);
    expect(deps.recorded).toHaveLength(0);
  });

  it("accepts an edge reconstructed with endpoints swapped relative to how it was stored", async () => {
    const deps = fakeDeps(graphWithEdge);
    const useCase = new SplitIdentity(deps);
    const swapped = {
      ...edge,
      fromType: edge.toType,
      fromValue: edge.toValue,
      toType: edge.fromType,
      toValue: edge.fromValue,
    };
    const result = await useCase.execute({
      tenantId: TENANT_A,
      edge: swapped,
      reason: "wrong stitch",
      actor: "operator-1",
    });

    expect(result.ok).toBe(true);
  });
});

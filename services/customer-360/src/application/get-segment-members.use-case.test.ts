import { describe, expect, it } from "vitest";
import { applyMembershipUpdate } from "../domain/segment-membership";
import { InMemorySegmentStore } from "../infrastructure/in-memory-segment-store";
import { GetSegmentMembers } from "./get-segment-members.use-case";
import { TENANT_A } from "../test-support/tenants";

const memberA = { type: "customer_id" as const, value: "cust-a" };
const memberB = { type: "customer_id" as const, value: "cust-b" };
const segmentId = "high_value";

describe("GetSegmentMembers", () => {
  it("returns every identifier currently entered in a segment, defaulting to status=entered", async () => {
    const segments = new InMemorySegmentStore();
    await segments.saveCurrent(
      applyMembershipUpdate(null, memberA.type, memberA.value, segmentId, {
        isMember: true,
        definitionId: segmentId,
        definitionVersion: 1,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: "t0",
      }).membership!,
      TENANT_A,
    );
    const bExited = applyMembershipUpdate(
      applyMembershipUpdate(null, memberB.type, memberB.value, segmentId, {
        isMember: true,
        definitionId: segmentId,
        definitionVersion: 1,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: "t0",
      }).membership!,
      memberB.type,
      memberB.value,
      segmentId,
      {
        isMember: false,
        definitionId: segmentId,
        definitionVersion: 1,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: "t1",
      },
    ).membership!;
    await segments.saveCurrent(bExited, TENANT_A);

    const useCase = new GetSegmentMembers({ segments });
    const entered = await useCase.execute({ tenantId: TENANT_A, segmentId });
    if (!entered.ok) throw new Error("unreachable");
    expect(entered.value.members.map((m) => m.identifierValue)).toEqual([memberA.value]);

    const exited = await useCase.execute({ tenantId: TENANT_A, segmentId, status: "exited" });
    if (!exited.ok) throw new Error("unreachable");
    expect(exited.value.members.map((m) => m.identifierValue)).toEqual([memberB.value]);
  });

  it("returns an empty list for a segment with no members", async () => {
    const useCase = new GetSegmentMembers({ segments: new InMemorySegmentStore() });
    const result = await useCase.execute({ tenantId: TENANT_A, segmentId: "nobody_here" });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.members).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { applyMembershipUpdate } from "./segment-membership";
import { toCustomerSegment } from "./customer-segment";

const IDENTIFIER = { type: "customer_id" as const, value: "cust-1" };

describe("customer-segment — toCustomerSegment", () => {
  it("indexes memberships by segmentId", () => {
    const vip = applyMembershipUpdate(null, IDENTIFIER.type, IDENTIFIER.value, "vip", {
      isMember: true,
      definitionId: "vip",
      definitionVersion: 1,
      matchedRuleIds: [],
      inputs: new Map(),
      evaluatedAt: "t1",
    }).membership!;
    const churnRisk = applyMembershipUpdate(null, IDENTIFIER.type, IDENTIFIER.value, "churn_risk", {
      isMember: true,
      definitionId: "churn_risk",
      definitionVersion: 1,
      matchedRuleIds: [],
      inputs: new Map(),
      evaluatedAt: "t1",
    }).membership!;

    const segment = toCustomerSegment(IDENTIFIER.type, IDENTIFIER.value, [vip, churnRisk]);

    expect(segment.memberships.size).toBe(2);
    expect(segment.memberships.get("vip")?.status).toBe("entered");
    expect(segment.memberships.get("churn_risk")?.status).toBe("entered");
  });

  it("returns an empty membership map for no memberships", () => {
    const segment = toCustomerSegment(IDENTIFIER.type, IDENTIFIER.value, []);
    expect(segment.memberships.size).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { applyMembershipUpdate } from "./segment-membership";
import { toCustomerSegment } from "./customer-segment";
import { mergeCustomerSegments } from "./segment-views";

function membership(
  identifierType: string,
  identifierValue: string,
  segmentId: string,
  evaluatedAt: string,
) {
  return applyMembershipUpdate(null, identifierType, identifierValue, segmentId, {
    isMember: true,
    definitionId: segmentId,
    definitionVersion: 1,
    matchedRuleIds: ["r1"],
    inputs: new Map(),
    evaluatedAt,
  }).membership!;
}

describe("segment-views — mergeCustomerSegments", () => {
  it("merges memberships from every cluster member, per-segment highest version wins", () => {
    const memberA = toCustomerSegment("visitor_id", "v1", [
      membership("visitor_id", "v1", "vip", "2026-07-21T00:00:01.000Z"),
    ]);
    const enteredThenExited = applyMembershipUpdate(
      membership("customer_id", "cust-1", "vip", "2026-07-21T00:00:02.000Z"),
      "customer_id",
      "cust-1",
      "vip",
      {
        isMember: false,
        definitionId: "vip",
        definitionVersion: 1,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: "2026-07-21T00:00:03.000Z",
      },
    ).membership!; // version 2, exited
    const memberB = toCustomerSegment("customer_id", "cust-1", [enteredThenExited]);

    const merged = mergeCustomerSegments([memberA, memberB], "customer_id", "cust-1");
    // memberB's row is version 2, strictly higher than memberA's version 1 — wins regardless of status.
    expect(merged.memberships.get("vip")?.status).toBe("exited");
    expect(merged.memberships.get("vip")?.version).toBe(2);
  });

  it("ties on version are broken by the later evaluatedAt", () => {
    const memberA = toCustomerSegment("visitor_id", "v1", [
      membership("visitor_id", "v1", "vip", "2026-07-21T00:00:01.000Z"),
    ]);
    const memberB = toCustomerSegment("customer_id", "cust-1", [
      membership("customer_id", "cust-1", "vip", "2026-07-21T00:00:05.000Z"),
    ]);

    const merged = mergeCustomerSegments([memberA, memberB], "customer_id", "cust-1");
    expect(merged.memberships.get("vip")?.identifierValue).toBe("cust-1");
  });

  it("is idempotent under duplication: merging [x, x] equals merging [x]", () => {
    const member = toCustomerSegment("visitor_id", "v1", [
      membership("visitor_id", "v1", "vip", "2026-07-21T00:00:01.000Z"),
    ]);

    const once = mergeCustomerSegments([member], "customer_id", "cust-1");
    const twice = mergeCustomerSegments([member, member], "customer_id", "cust-1");
    expect(twice.memberships.get("vip")).toEqual(once.memberships.get("vip"));
  });

  it("unions segment ids across members that don't overlap", () => {
    const memberA = toCustomerSegment("visitor_id", "v1", [
      membership("visitor_id", "v1", "vip", "2026-07-21T00:00:01.000Z"),
    ]);
    const memberB = toCustomerSegment("customer_id", "cust-1", [
      membership("customer_id", "cust-1", "churn_risk", "2026-07-21T00:00:01.000Z"),
    ]);

    const merged = mergeCustomerSegments([memberA, memberB], "customer_id", "cust-1");
    expect(merged.memberships.size).toBe(2);
    expect(merged.memberships.has("vip")).toBe(true);
    expect(merged.memberships.has("churn_risk")).toBe(true);
  });
});

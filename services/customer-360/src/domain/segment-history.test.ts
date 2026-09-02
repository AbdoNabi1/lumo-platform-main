import { describe, expect, it } from "vitest";
import { applyMembershipUpdate } from "./segment-membership";
import { fromSnapshot, toSnapshot } from "./segment-history";

describe("segment-history — toSnapshot / fromSnapshot", () => {
  it("round-trips a membership row through a snapshot without loss", () => {
    const membership = applyMembershipUpdate(null, "customer_id", "cust-1", "vip", {
      isMember: true,
      definitionId: "vip",
      definitionVersion: 1,
      matchedRuleIds: ["r1"],
      inputs: new Map([["profile.ltv", 500]]),
      evaluatedAt: "2026-07-21T00:00:01.000Z",
    }).membership!;

    const snapshot = toSnapshot(membership, "entered", "2026-07-21T00:00:02.000Z");
    expect(snapshot.reason).toBe("entered");
    expect(snapshot.capturedAt).toBe("2026-07-21T00:00:02.000Z");

    const rebuilt = fromSnapshot(snapshot);
    expect(rebuilt).toEqual(membership);
  });

  it("captures the full row, not a diff", () => {
    const membership = applyMembershipUpdate(null, "customer_id", "cust-1", "vip", {
      isMember: true,
      definitionId: "vip",
      definitionVersion: 1,
      matchedRuleIds: ["r1", "r2"],
      inputs: new Map<string, string | number | boolean | null>([
        ["profile.ltv", 500],
        ["attributes.tier", "gold"],
      ]),
      evaluatedAt: "2026-07-21T00:00:01.000Z",
    }).membership!;

    const snapshot = toSnapshot(membership, "entered", "2026-07-21T00:00:02.000Z");
    expect(snapshot.matchedRuleIds).toEqual(["r1", "r2"]);
    expect(snapshot.inputs.get("attributes.tier")).toBe("gold");
    expect(snapshot.enteredAt).toBe(membership.enteredAt);
    expect(snapshot.exitedAt).toBe(membership.exitedAt);
  });
});

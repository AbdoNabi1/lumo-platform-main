import { describe, expect, it } from "vitest";
import { applyMembershipUpdate, type MembershipUpdateInput } from "./segment-membership";

const IDENTIFIER = { type: "customer_id" as const, value: "cust-1" };
const SEGMENT_ID = "high_value";

function update(overrides: Partial<MembershipUpdateInput> = {}): MembershipUpdateInput {
  return {
    isMember: true,
    definitionId: SEGMENT_ID,
    definitionVersion: 1,
    matchedRuleIds: ["rule-1"],
    inputs: new Map(),
    evaluatedAt: "2026-07-21T00:00:01.000Z",
    ...overrides,
  };
}

describe("SegmentMembership domain — applyMembershipUpdate", () => {
  it("is a no-op when an identifier that was never a member evaluates to not-a-member", () => {
    const result = applyMembershipUpdate(
      null,
      IDENTIFIER.type,
      IDENTIFIER.value,
      SEGMENT_ID,
      update({ isMember: false }),
    );

    expect(result.applied).toBe(false);
    expect(result.transition).toBe("unchanged");
    expect(result.membership).toBeNull();
  });

  it("applies and transitions to entered on first membership", () => {
    const result = applyMembershipUpdate(
      null,
      IDENTIFIER.type,
      IDENTIFIER.value,
      SEGMENT_ID,
      update(),
    );

    expect(result.applied).toBe(true);
    expect(result.transition).toBe("entered");
    expect(result.membership?.status).toBe("entered");
    expect(result.membership?.enteredAt).toBe("2026-07-21T00:00:01.000Z");
    expect(result.membership?.exitedAt).toBeNull();
    expect(result.membership?.version).toBe(1);
  });

  it("is a no-op when re-evaluated with the same status and definitionVersion", () => {
    const first = applyMembershipUpdate(
      null,
      IDENTIFIER.type,
      IDENTIFIER.value,
      SEGMENT_ID,
      update(),
    ).membership!;
    const second = applyMembershipUpdate(
      first,
      IDENTIFIER.type,
      IDENTIFIER.value,
      SEGMENT_ID,
      update({ evaluatedAt: "2026-07-21T00:05:00.000Z" }),
    );

    expect(second.applied).toBe(false);
    expect(second.transition).toBe("unchanged");
    expect(second.membership).toBe(first); // returned unchanged, same reference
  });

  it("transitions to exited when an entered member no longer matches", () => {
    const entered = applyMembershipUpdate(
      null,
      IDENTIFIER.type,
      IDENTIFIER.value,
      SEGMENT_ID,
      update(),
    ).membership!;
    const exited = applyMembershipUpdate(
      entered,
      IDENTIFIER.type,
      IDENTIFIER.value,
      SEGMENT_ID,
      update({ isMember: false, evaluatedAt: "2026-07-22T00:00:00.000Z" }),
    );

    expect(exited.applied).toBe(true);
    expect(exited.transition).toBe("exited");
    expect(exited.membership?.status).toBe("exited");
    expect(exited.membership?.exitedAt).toBe("2026-07-22T00:00:00.000Z");
    // enteredAt from the original entry period is preserved on the exited row.
    expect(exited.membership?.enteredAt).toBe("2026-07-21T00:00:01.000Z");
    expect(exited.membership?.version).toBe(2);
  });

  it("resets enteredAt on re-entry after an exit", () => {
    const entered = applyMembershipUpdate(
      null,
      IDENTIFIER.type,
      IDENTIFIER.value,
      SEGMENT_ID,
      update(),
    ).membership!;
    const exited = applyMembershipUpdate(
      entered,
      IDENTIFIER.type,
      IDENTIFIER.value,
      SEGMENT_ID,
      update({ isMember: false, evaluatedAt: "2026-07-22T00:00:00.000Z" }),
    ).membership!;
    const reentered = applyMembershipUpdate(
      exited,
      IDENTIFIER.type,
      IDENTIFIER.value,
      SEGMENT_ID,
      update({ isMember: true, evaluatedAt: "2026-07-23T00:00:00.000Z" }),
    );

    expect(reentered.transition).toBe("entered");
    expect(reentered.membership?.enteredAt).toBe("2026-07-23T00:00:00.000Z");
    expect(reentered.membership?.exitedAt).toBeNull();
    expect(reentered.membership?.version).toBe(3);
  });

  it("applies (but does not transition) when definitionVersion changes with the status unchanged", () => {
    const entered = applyMembershipUpdate(
      null,
      IDENTIFIER.type,
      IDENTIFIER.value,
      SEGMENT_ID,
      update(),
    ).membership!;
    const refreshed = applyMembershipUpdate(
      entered,
      IDENTIFIER.type,
      IDENTIFIER.value,
      SEGMENT_ID,
      update({ definitionVersion: 2, evaluatedAt: "2026-07-22T00:00:00.000Z" }),
    );

    expect(refreshed.applied).toBe(true);
    expect(refreshed.transition).toBe("unchanged");
    expect(refreshed.membership?.status).toBe("entered");
    expect(refreshed.membership?.definitionVersion).toBe(2);
    // enteredAt is not reset by a version-only refresh.
    expect(refreshed.membership?.enteredAt).toBe("2026-07-21T00:00:01.000Z");
  });

  it("never mutates the existing row passed in", () => {
    const entered = applyMembershipUpdate(
      null,
      IDENTIFIER.type,
      IDENTIFIER.value,
      SEGMENT_ID,
      update(),
    ).membership!;
    const before = { ...entered };
    applyMembershipUpdate(
      entered,
      IDENTIFIER.type,
      IDENTIFIER.value,
      SEGMENT_ID,
      update({ isMember: false }),
    );
    expect(entered).toEqual(before);
  });
});

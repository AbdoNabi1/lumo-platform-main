import { describe, expect, it } from "vitest";
import { applyMembershipUpdate, type SegmentMembership } from "./segment-membership";

/**
 * Property-style tests, same hand-rolled seeded-PRNG shape `computed-attribute.property.test.ts`
 * already establishes for this package (no property-testing library is a workspace dependency).
 */

const IDENTIFIER = { type: "customer_id" as const, value: "cust-prop" };
const SEGMENT_ID = "prop_segment";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomEvaluationSequence(rng: () => number, count: number) {
  let cursorMs = Date.parse("2026-07-21T00:00:00.000Z");
  const evaluations: { isMember: boolean; evaluatedAt: string; definitionVersion: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    cursorMs += Math.floor(rng() * 5000); // strictly non-decreasing wall clock
    evaluations.push({
      isMember: rng() < 0.5,
      evaluatedAt: new Date(cursorMs).toISOString(),
      definitionVersion: 1,
    });
  }
  return evaluations;
}

describe("SegmentMembership domain — property tests", () => {
  it("membership.version never decreases across any sequence of applied updates (50 random trials)", () => {
    for (let trial = 0; trial < 50; trial += 1) {
      const rng = mulberry32(trial + 1);
      let membership: SegmentMembership | null = null;
      let previousVersion = 0;

      for (const evaluation of randomEvaluationSequence(rng, 30)) {
        const result = applyMembershipUpdate(
          membership,
          IDENTIFIER.type,
          IDENTIFIER.value,
          SEGMENT_ID,
          {
            isMember: evaluation.isMember,
            definitionId: SEGMENT_ID,
            definitionVersion: evaluation.definitionVersion,
            matchedRuleIds: [],
            inputs: new Map(),
            evaluatedAt: evaluation.evaluatedAt,
          },
        );
        if (result.membership !== null) {
          expect(result.membership.version).toBeGreaterThanOrEqual(previousVersion);
          previousVersion = result.membership.version;
          membership = result.membership;
        }
      }
    }
  });

  it("applyMembershipUpdate never mutates its input row, applied or not (40 random trials)", () => {
    for (let trial = 0; trial < 40; trial += 1) {
      const rng = mulberry32(trial + 1000);
      let membership: SegmentMembership | null = null;

      for (const evaluation of randomEvaluationSequence(rng, 20)) {
        const snapshotBefore = membership === null ? null : { ...membership };
        const result = applyMembershipUpdate(
          membership,
          IDENTIFIER.type,
          IDENTIFIER.value,
          SEGMENT_ID,
          {
            isMember: evaluation.isMember,
            definitionId: SEGMENT_ID,
            definitionVersion: evaluation.definitionVersion,
            matchedRuleIds: [],
            inputs: new Map(),
            evaluatedAt: evaluation.evaluatedAt,
          },
        );
        expect(membership, `trial ${trial} mutated the input row`).toEqual(snapshotBefore);
        if (result.membership !== null) membership = result.membership;
      }
    }
  });

  it("re-evaluating the exact same (isMember, definitionVersion) twice in a row is always a no-op (30 random trials)", () => {
    for (let trial = 0; trial < 30; trial += 1) {
      const rng = mulberry32(trial + 2000);
      const evaluation = randomEvaluationSequence(rng, 1)[0]!;

      const first = applyMembershipUpdate(null, IDENTIFIER.type, IDENTIFIER.value, SEGMENT_ID, {
        isMember: evaluation.isMember,
        definitionId: SEGMENT_ID,
        definitionVersion: evaluation.definitionVersion,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: evaluation.evaluatedAt,
      });
      const second = applyMembershipUpdate(
        first.membership,
        IDENTIFIER.type,
        IDENTIFIER.value,
        SEGMENT_ID,
        {
          isMember: evaluation.isMember,
          definitionId: SEGMENT_ID,
          definitionVersion: evaluation.definitionVersion,
          matchedRuleIds: [],
          inputs: new Map(),
          // A later timestamp, but same isMember/definitionVersion — still expected to be a no-op.
          evaluatedAt: new Date(Date.parse(evaluation.evaluatedAt) + 60_000).toISOString(),
        },
      );

      expect(second.applied).toBe(false);
      expect(second.transition).toBe("unchanged");
      expect(second.membership).toBe(first.membership);
    }
  });

  it("status always matches the most recent isMember evaluation whenever a row exists (50 random trials)", () => {
    for (let trial = 0; trial < 50; trial += 1) {
      const rng = mulberry32(trial + 4000);
      let membership: SegmentMembership | null = null;
      let lastIsMember = false;

      for (const evaluation of randomEvaluationSequence(rng, 25)) {
        const result = applyMembershipUpdate(
          membership,
          IDENTIFIER.type,
          IDENTIFIER.value,
          SEGMENT_ID,
          {
            isMember: evaluation.isMember,
            definitionId: SEGMENT_ID,
            definitionVersion: evaluation.definitionVersion,
            matchedRuleIds: [],
            inputs: new Map(),
            evaluatedAt: evaluation.evaluatedAt,
          },
        );
        if (result.membership !== null) membership = result.membership;
        lastIsMember = evaluation.isMember;
      }

      if (membership !== null) {
        expect(membership.status).toBe(lastIsMember ? "entered" : "exited");
      }
    }
  });
});

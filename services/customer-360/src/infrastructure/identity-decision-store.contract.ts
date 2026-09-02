import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import type { IdentityEdge } from "@platform/tracking";
import { IdentityMerged } from "../events/identity-merged.event";
import { IdentitySplit } from "../events/identity-split.event";
import type { IdentityDecision } from "../ports/identity-decision";
import type { IdentityDecisionStore } from "../ports/identity-decision-store";

/**
 * A store plus the means to run a write inside a transaction — same reasoning as
 * `IdentityGraphStoreHarness` in `identity-graph-store.contract.ts`: `PrismaIdentityDecisionStore
 * .record` hard-requires the unit of work's transaction client (ADR-0003), the in-memory adapter
 * needs none.
 */
export interface IdentityDecisionStoreHarness {
  readonly store: IdentityDecisionStore;
  readonly withTx: (fn: (tx?: unknown) => Promise<void>) => Promise<void>;
}

/**
 * Repository parity contract: the same behavioral assertions run against every
 * `IdentityDecisionStore` adapter, proving the in-memory and Prisma implementations honor the
 * identical port contract — same convention `profile-store.contract.ts` establishes for
 * `ProfileStore`. Call once per adapter with a fresh harness factory (a function, not an instance,
 * so each `it` gets isolated state).
 */
export function runIdentityDecisionStoreContractTests(
  adapterName: string,
  makeHarness: () => IdentityDecisionStoreHarness,
): void {
  describe(`IdentityDecisionStore contract — ${adapterName}`, () => {
    const occurredAt = "2026-07-22T00:00:00.000Z";

    // `id` becomes the row's primary key, typed `uuid` in the `customer_360` schema for the Prisma
    // adapter — a literal label there would fail at the database level, not just risk collision, so
    // every decision gets a fresh real UUID; `label` keeps the business fields human-readable.
    function mergeDecision(label: string): IdentityDecision {
      return {
        id: crypto.randomUUID(),
        kind: "merge",
        subject: { type: "visitor_id", value: `v-${adapterName}-${label}` },
        related: { type: "email_hash", value: `hash-${adapterName}-${label}` },
        reason: "same customer, confirmed at login",
        actor: `operator-${adapterName}`,
        occurredAt,
      };
    }

    function splitDecision(retractedEdge: IdentityEdge): IdentityDecision {
      return {
        id: crypto.randomUUID(),
        kind: "split",
        subject: { type: retractedEdge.fromType, value: retractedEdge.fromValue },
        related: { type: retractedEdge.toType, value: retractedEdge.toValue },
        retractedEdge,
        reason: "shared family device",
        actor: `operator-${adapterName}`,
        occurredAt,
      };
    }

    function mergeEvent(decision: IdentityDecision): IdentityMerged {
      return new IdentityMerged(
        {
          eventId: crypto.randomUUID(),
          aggregateId: UniqueEntityId.from(decision.subject.value),
          occurredAt: new Date(occurredAt),
        },
        {
          decisionId: decision.id,
          subjectType: decision.subject.type,
          subjectValue: decision.subject.value,
          mergedType: decision.related.type,
          mergedValue: decision.related.value,
          reason: decision.reason,
          actor: decision.actor,
        },
      );
    }

    function splitEvent(decision: IdentityDecision): IdentitySplit {
      const retracted = decision.retractedEdge;
      if (retracted === undefined) {
        throw new Error("splitEvent requires a decision with a retractedEdge");
      }
      return new IdentitySplit(
        {
          eventId: crypto.randomUUID(),
          aggregateId: UniqueEntityId.from(decision.subject.value),
          occurredAt: new Date(occurredAt),
        },
        {
          decisionId: decision.id,
          retractedFromType: retracted.fromType,
          retractedFromValue: retracted.fromValue,
          retractedToType: retracted.toType,
          retractedToValue: retracted.toValue,
          reason: decision.reason,
          actor: decision.actor,
        },
      );
    }

    it("listFor returns empty for an identifier with no recorded decisions", async () => {
      const { store } = makeHarness();
      const found = await store.listFor({ type: "visitor_id", value: `v-${adapterName}-none` });
      expect(found).toHaveLength(0);
    });

    it("record then listFor surfaces the decision for its subject identifier", async () => {
      const { store, withTx } = makeHarness();
      const decision = mergeDecision(`merge-${adapterName}-1`);

      await withTx((tx) => store.record(decision, mergeEvent(decision), tx));
      const found = await store.listFor(decision.subject);

      expect(found.some((d) => d.id === decision.id)).toBe(true);
    });

    it("record then listFor also surfaces the decision for its related identifier", async () => {
      const { store, withTx } = makeHarness();
      const decision = mergeDecision(`merge-${adapterName}-2`);

      await withTx((tx) => store.record(decision, mergeEvent(decision), tx));
      const found = await store.listFor(decision.related);

      expect(found.some((d) => d.id === decision.id)).toBe(true);
    });

    it("retractedEdges returns empty when no split decisions have been recorded", async () => {
      const { store, withTx } = makeHarness();
      const decision = mergeDecision(`merge-${adapterName}-3`);
      await withTx((tx) => store.record(decision, mergeEvent(decision), tx));

      const retracted = await store.retractedEdges();
      expect(retracted).toHaveLength(0);
    });

    it("recording a split decision surfaces its retracted edge via retractedEdges", async () => {
      const { store, withTx } = makeHarness();
      const retractedEdge: IdentityEdge = {
        fromType: "visitor_id",
        fromValue: `v-${adapterName}-split`,
        toType: "device_id",
        toValue: `device-${adapterName}-shared`,
        confidence: "probabilistic",
        observedAt: occurredAt,
        source: "server_stitch",
      };
      const decision = splitDecision(retractedEdge);

      await withTx((tx) => store.record(decision, splitEvent(decision), tx));
      const retracted = await store.retractedEdges();

      expect(
        retracted.some(
          (e) => e.fromValue === retractedEdge.fromValue && e.toValue === retractedEdge.toValue,
        ),
      ).toBe(true);
    });
  });
}

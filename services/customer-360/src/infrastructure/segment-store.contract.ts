import { beforeEach, describe, expect, it } from "vitest";
import { ConcurrencyError } from "@platform/utils";
import { INITIAL_SEGMENT_VERSION } from "../domain/segment-version";
import { applyMembershipUpdate } from "../domain/segment-membership";
import type { SegmentStore } from "../ports/segment-store";

/**
 * Repository parity contract: the same behavioral assertions run against every `SegmentStore`
 * adapter — mirrors `attribute-store.contract.ts`'s shape, adapted for the `(identifier, segmentId)`
 * keying (`ports/segment-store.ts`'s module doc). Call once per adapter with a fresh store factory (a
 * function, not an instance, so each `it` gets isolated state).
 */
/**
 * Phase A.20 (Task 7): real ISO timestamps standing in for the placeholder strings `"t1"`/`"t2"`.
 * Unlike `ComputedAttributeCache.attributes` (a `Json` blob), `applyMembershipUpdate`'s
 * `evaluatedAt` flows directly into `SegmentMembership.enteredAt`/`exitedAt`
 * (`domain/segment-membership.ts`'s `nextTimestamps`), which map to real PostgreSQL `DateTime`
 * columns — `new Date("t1")` is Invalid Date there. See
 * PHASE_A19_REAL_POSTGRESQL_VALIDATION_REPORT.md §10.
 */
const T1 = "2026-07-21T00:00:01.000Z";
const T2 = "2026-07-21T00:00:02.000Z";
export function runSegmentStoreContractTests(
  adapterName: string,
  makeStore: () => SegmentStore,
): void {
  describe(`SegmentStore contract — ${adapterName}`, () => {
    // A fresh tenant per test keeps the Prisma run isolated from rows earlier tests left behind.
    let tenantId: string;
    beforeEach(() => {
      tenantId = `tenant-contract-${crypto.randomUUID()}`;
    });

    const identifier = { type: "customer_id" as const, value: `contract-${adapterName}` };
    const segmentId = "high_value";

    function entered() {
      return applyMembershipUpdate(null, identifier.type, identifier.value, segmentId, {
        isMember: true,
        definitionId: segmentId,
        definitionVersion: 1,
        matchedRuleIds: ["rule-1"],
        inputs: new Map(),
        evaluatedAt: "2026-07-21T00:00:01.000Z",
      }).membership!;
    }

    it("getCurrent returns null for a pair that was never saved", async () => {
      const store = makeStore();
      expect(await store.getCurrent(identifier, segmentId, tenantId)).toBeNull();
    });

    it("saveCurrent then getCurrent round-trips the same membership", async () => {
      const store = makeStore();
      const membership = entered();

      await store.saveCurrent(membership, tenantId);
      const loaded = await store.getCurrent(identifier, segmentId, tenantId);

      expect(loaded).not.toBeNull();
      expect(loaded?.status).toBe("entered");
      expect(loaded?.version).toBe(membership.version);
      expect(loaded?.matchedRuleIds).toEqual(["rule-1"]);
    });

    it("saveCurrent upserts — a second save replaces rather than duplicates", async () => {
      const store = makeStore();
      const first = entered();
      const second = applyMembershipUpdate(first, identifier.type, identifier.value, segmentId, {
        isMember: false,
        definitionId: segmentId,
        definitionVersion: 1,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: "2026-07-22T00:00:00.000Z",
      }).membership!;

      await store.saveCurrent(first, tenantId);
      await store.saveCurrent(second, tenantId);
      const loaded = await store.getCurrent(identifier, segmentId, tenantId);

      expect(loaded?.status).toBe("exited");
      expect(loaded?.version).toBe(2);
    });

    // --- ADR-0060: optimistic concurrency (expectedVersion) ---

    it("saveCurrent with a matching expectedVersion succeeds and chains create -> update", async () => {
      const store = makeStore();
      const created = entered();

      await store.saveCurrent(created, tenantId, INITIAL_SEGMENT_VERSION);
      expect((await store.getCurrent(identifier, segmentId, tenantId))?.version).toBe(
        created.version,
      );

      const exited = applyMembershipUpdate(created, identifier.type, identifier.value, segmentId, {
        isMember: false,
        definitionId: segmentId,
        definitionVersion: 1,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: "2026-07-22T00:00:00.000Z",
      }).membership!;

      await store.saveCurrent(exited, tenantId, created.version);
      const loaded = await store.getCurrent(identifier, segmentId, tenantId);
      expect(loaded?.status).toBe("exited");
      expect(loaded?.version).toBe(exited.version);
    });

    it("saveCurrent with a stale expectedVersion rejects with ConcurrencyError and never applies the write", async () => {
      const store = makeStore();
      const created = entered();
      await store.saveCurrent(created, tenantId, INITIAL_SEGMENT_VERSION);

      const staleAttempt = applyMembershipUpdate(
        created,
        identifier.type,
        identifier.value,
        segmentId,
        {
          isMember: false,
          definitionId: segmentId,
          definitionVersion: 1,
          matchedRuleIds: [],
          inputs: new Map(),
          evaluatedAt: "2026-07-22T00:00:00.000Z",
        },
      ).membership!;

      await expect(
        store.saveCurrent(staleAttempt, tenantId, created.version + 1),
      ).rejects.toBeInstanceOf(ConcurrencyError);

      const loaded = await store.getCurrent(identifier, segmentId, tenantId);
      expect(loaded?.status).toBe("entered");
      expect(loaded?.version).toBe(created.version);
    });

    it("saveCurrent with expectedVersion omitted still blindly overwrites — RebuildSegmentMembership's recovery semantics, preserved", async () => {
      const store = makeStore();
      const created = entered();
      await store.saveCurrent(created, tenantId, INITIAL_SEGMENT_VERSION);

      const rebuilt = applyMembershipUpdate(created, identifier.type, identifier.value, segmentId, {
        isMember: false,
        definitionId: segmentId,
        definitionVersion: 2,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: "2026-07-23T00:00:00.000Z",
      }).membership!;

      await store.saveCurrent(rebuilt, tenantId); // no expectedVersion -- unconditional
      const loaded = await store.getCurrent(identifier, segmentId, tenantId);
      expect(loaded?.status).toBe("exited");
    });

    it("listForIdentifier returns every segment's membership for one identifier", async () => {
      const store = makeStore();
      const other = { type: "customer_id" as const, value: `contract-${adapterName}-other` };
      await store.saveCurrent(entered(), tenantId);
      await store.saveCurrent(
        applyMembershipUpdate(null, identifier.type, identifier.value, "churn_risk", {
          isMember: true,
          definitionId: "churn_risk",
          definitionVersion: 1,
          matchedRuleIds: [],
          inputs: new Map(),
          evaluatedAt: "2026-07-21T00:00:01.000Z",
        }).membership!,
        tenantId,
      );
      await store.saveCurrent(
        applyMembershipUpdate(null, other.type, other.value, segmentId, {
          isMember: true,
          definitionId: segmentId,
          definitionVersion: 1,
          matchedRuleIds: [],
          inputs: new Map(),
          evaluatedAt: "2026-07-21T00:00:01.000Z",
        }).membership!,
        tenantId,
      );

      const mine = await store.listForIdentifier(identifier, tenantId);
      expect(mine.map((m) => m.segmentId).sort()).toEqual(["churn_risk", "high_value"]);
    });

    it("listMembers returns every identifier currently entered in a segment, and none exited", async () => {
      const store = makeStore();
      const memberA = { type: "customer_id" as const, value: `contract-${adapterName}-a` };
      const memberB = { type: "customer_id" as const, value: `contract-${adapterName}-b` };

      await store.saveCurrent(
        applyMembershipUpdate(null, memberA.type, memberA.value, segmentId, {
          isMember: true,
          definitionId: segmentId,
          definitionVersion: 1,
          matchedRuleIds: [],
          inputs: new Map(),
          evaluatedAt: T1,
        }).membership!,
        tenantId,
      );
      const bEntered = applyMembershipUpdate(null, memberB.type, memberB.value, segmentId, {
        isMember: true,
        definitionId: segmentId,
        definitionVersion: 1,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: T1,
      }).membership!;
      const bExited = applyMembershipUpdate(bEntered, memberB.type, memberB.value, segmentId, {
        isMember: false,
        definitionId: segmentId,
        definitionVersion: 1,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: T2,
      }).membership!;
      await store.saveCurrent(bExited, tenantId);

      const members = await store.listMembers(segmentId, tenantId, "entered");
      expect(members.map((m) => m.identifierValue)).toEqual([memberA.value]);

      const exitedMembers = await store.listMembers(segmentId, tenantId, "exited");
      expect(exitedMembers.map((m) => m.identifierValue)).toEqual([memberB.value]);
    });

    it("listIdentifiers reports every saved (identifier, segmentId) pair exactly once", async () => {
      const store = makeStore();
      await store.saveCurrent(entered(), tenantId);
      await store.saveCurrent(
        applyMembershipUpdate(null, identifier.type, identifier.value, "churn_risk", {
          isMember: true,
          definitionId: "churn_risk",
          definitionVersion: 1,
          matchedRuleIds: [],
          inputs: new Map(),
          evaluatedAt: T1,
        }).membership!,
        tenantId,
      );
      // Re-saving the first pair must not duplicate it in the listing.
      await store.saveCurrent(entered(), tenantId);

      const pairs = await store.listIdentifiers(tenantId);
      expect(pairs.length).toBe(2);
      expect(pairs.map((p) => p.segmentId).sort()).toEqual(["churn_risk", "high_value"]);
    });

    it("isolates tenants — a membership saved under one tenant is invisible to another (ADR-0014)", async () => {
      const store = makeStore();
      const otherTenant = `${tenantId}-other`;

      await store.saveCurrent(entered(), tenantId);

      expect(await store.getCurrent(identifier, segmentId, otherTenant)).toBeNull();
      expect(await store.listForIdentifier(identifier, otherTenant)).toEqual([]);
      expect(await store.listMembers(segmentId, otherTenant)).toEqual([]);
      expect(await store.listIdentifiers(otherTenant)).toEqual([]);
      expect(await store.listMembers(segmentId, tenantId)).toHaveLength(1);
    });
  });
}

import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { IdentifierType } from "@platform/tracking";
import { applyMembershipUpdate, type SegmentMembership } from "../domain/segment-membership";
import { toSnapshot, type SegmentHistoryEntry } from "../domain/segment-history";
import type { SegmentHistoryStore } from "../ports/segment-history-store";
import type { SegmentStore } from "../ports/segment-store";
import { RebuildSegmentMembership } from "./rebuild-segment-membership.use-case";
import { SegmentProjectionWorker } from "./segment-projection-worker";
import { TENANT_A } from "../test-support/tenants";

function membership(identifierValue: string, segmentId: string): SegmentMembership {
  return applyMembershipUpdate(null, "customer_id", identifierValue, segmentId, {
    isMember: true,
    definitionId: segmentId,
    definitionVersion: 1,
    matchedRuleIds: [],
    inputs: new Map(),
    evaluatedAt: "2026-07-21T00:00:01.000Z",
  }).membership!;
}

function key(identifierValue: string, segmentId: string): string {
  return `${identifierValue}:${segmentId}`;
}

function wire(seed: readonly SegmentMembership[]) {
  const current = new Map<string, SegmentMembership>();
  const entries: SegmentHistoryEntry[] = [];
  for (const m of seed) {
    current.set(key(m.identifierValue, m.segmentId), m);
    entries.push(toSnapshot(m, "entered", m.evaluatedAt));
  }

  const segments: SegmentStore = {
    getCurrent: async (id, segmentId) => current.get(key(id.value, segmentId)) ?? null,
    saveCurrent: async (m) => {
      current.set(key(m.identifierValue, m.segmentId), m);
    },
    listForIdentifier: async () => [],
    listMembers: async () => [],
    listIdentifiers: async () =>
      [...current.values()].map((m) => ({
        identifier: { type: m.identifierType as IdentifierType, value: m.identifierValue },
        segmentId: m.segmentId,
      })),
  };
  const history: SegmentHistoryStore = {
    append: async (entry, event) => {
      entries.push(entry);
      void event;
    },
    listFor: async (id, segmentId) =>
      entries.filter((e) => e.identifierValue === id.value && e.segmentId === segmentId),
    latestFor: async (id, segmentId) => {
      const rows = entries.filter(
        (e) => e.identifierValue === id.value && e.segmentId === segmentId,
      );
      return rows.length === 0 ? null : rows[rows.length - 1]!;
    },
  };
  const unitOfWork: TransactionalUnitOfWork<unknown> = { run: (work) => work(undefined) };
  const idGenerator: IdGenerator = { generate: () => "id-1" };
  const clock: Clock = { now: () => new Date("2026-07-21T02:00:00.000Z") };

  const rebuild = new RebuildSegmentMembership({
    segments,
    history,
    unitOfWork,
    idGenerator,
    clock,
  });
  const worker = new SegmentProjectionWorker({ segments, rebuild });
  return { worker, segments };
}

describe("SegmentProjectionWorker", () => {
  it("rebuilds every known (identifier, segmentId) pair and reports a zero-failure summary", async () => {
    const { worker } = wire([
      membership("cust-a", "high_value"),
      membership("cust-b", "high_value"),
    ]);
    const result = await worker.execute({ tenantId: TENANT_A });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ rebuilt: 2, failed: 0 });
  });

  it("isolates one pair's failure — the rest of the batch still rebuilds", async () => {
    const { segments } = wire([membership("cust-a", "high_value")]);
    // `RebuildSegmentMembership` is a class with private fields, so a plain `{ execute }` object
    // has no structural overlap with it (comparability fails) — needs the `unknown` hop.
    const failingRebuild: RebuildSegmentMembership = {
      execute: async () => {
        throw new Error("boom");
      },
    } as unknown as RebuildSegmentMembership;
    const worker = new SegmentProjectionWorker({ segments, rebuild: failingRebuild });

    const result = await worker.execute({ tenantId: TENANT_A });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ rebuilt: 0, failed: 1 });
  });

  it("reports rebuilt: 0, failed: 0 when there is nothing to rebuild yet", async () => {
    const { worker } = wire([]);
    const result = await worker.execute({ tenantId: TENANT_A });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ rebuilt: 0, failed: 0 });
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import type { IdentityEdge } from "@platform/tracking";
import type { IdentityGraphStore } from "../ports/identity-graph-store";

/**
 * A store plus the means to run a write inside a transaction. The Prisma ledger adapters
 * (`PrismaIdentityGraphStore.appendEdge`) hard-require the unit of work's transaction client
 * (ADR-0003's `requireTx` guard); the in-memory adapter needs none. `withTx` lets one contract test
 * exercise both: in-memory's harness simply invokes the callback with no argument, Prisma's runs it
 * through `PrismaUnitOfWork.run`.
 */
export interface IdentityGraphStoreHarness {
  readonly store: IdentityGraphStore;
  readonly withTx: (fn: (tx?: unknown) => Promise<void>) => Promise<void>;
}

/**
 * Repository parity contract: the same behavioral assertions run against every `IdentityGraphStore`
 * adapter, proving the in-memory and Prisma implementations honor the identical port contract —
 * same convention `profile-store.contract.ts` establishes for `ProfileStore`. Call once per adapter
 * with a fresh harness factory (a function, not an instance, so each `it` gets isolated state).
 */
export function runIdentityGraphStoreContractTests(
  adapterName: string,
  makeHarness: () => IdentityGraphStoreHarness,
): void {
  describe(`IdentityGraphStore contract — ${adapterName}`, () => {
    // A fresh tenant per test keeps the Prisma run isolated from rows earlier tests left behind.
    let tenantId: string;
    beforeEach(() => {
      tenantId = `tenant-contract-${crypto.randomUUID()}`;
    });

    function edge(overrides: Partial<IdentityEdge> = {}): IdentityEdge {
      return {
        fromType: "visitor_id",
        fromValue: `v-${adapterName}-1`,
        toType: "email_hash",
        toValue: `hash-${adapterName}-1`,
        confidence: "deterministic",
        observedAt: "2026-07-22T00:00:00.000Z",
        source: "checkout",
        ...overrides,
      };
    }

    it("loadGraph returns an empty graph when nothing has been appended", async () => {
      const { store } = makeHarness();
      const graph = await store.loadGraph(tenantId);
      expect(graph.edges).toHaveLength(0);
    });

    it("appendEdge then loadGraph rehydrates an equivalent graph containing that edge", async () => {
      const { store, withTx } = makeHarness();
      const observed = edge();

      await withTx((tx) => store.appendEdge(observed, tenantId, undefined, tx));
      const graph = await store.loadGraph(tenantId);

      expect(
        graph.edges.some(
          (e) =>
            e.fromType === observed.fromType &&
            e.fromValue === observed.fromValue &&
            e.toType === observed.toType &&
            e.toValue === observed.toValue,
        ),
      ).toBe(true);
    });

    it("appending multiple edges accumulates them all — never overwrites a prior observation", async () => {
      const { store, withTx } = makeHarness();
      const first = edge({ toValue: `hash-${adapterName}-a` });
      const second = edge({ toValue: `hash-${adapterName}-b`, source: "storefront" });

      await withTx((tx) => store.appendEdge(first, tenantId, undefined, tx));
      await withTx((tx) => store.appendEdge(second, tenantId, undefined, tx));
      const graph = await store.loadGraph(tenantId);

      expect(graph.edges.some((e) => e.toValue === first.toValue)).toBe(true);
      expect(graph.edges.some((e) => e.toValue === second.toValue)).toBe(true);
    });

    it("isolates tenants — an edge appended under one tenant never enters another tenant's graph (ADR-0014)", async () => {
      const { store, withTx } = makeHarness();
      const otherTenant = `${tenantId}-other`;

      await withTx((tx) => store.appendEdge(edge(), tenantId, undefined, tx));

      expect((await store.loadGraph(otherTenant)).edges).toHaveLength(0);
      expect((await store.loadGraph(tenantId)).edges).toHaveLength(1);
    });
  });
}

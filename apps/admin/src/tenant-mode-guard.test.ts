import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { claimTenantResolver, headerTenantResolver, type TenantResolver } from "@platform/http";
import type { Database } from "@platform/db";
import { describe, expect, it } from "vitest";
import { wireAdmin } from "./composition";
import { singleTenantGuardedResolver } from "./http/server";
import {
  TENANT_PIN_EXEMPTIONS,
  assertMultiTenantReady,
  collectMultiTenantFailures,
  findConstructionTimeTenants,
} from "./tenant-mode-guard";

const realChain: readonly TenantResolver[] = [claimTenantResolver, headerTenantResolver];

let counter = 0;
const ids = { generate: () => `id-${(counter += 1)}` };
const clock = { now: () => new Date("2026-09-19T00:00:00.000Z") };

/** The real composed graph, Prisma branches included, pinned to one tenant exactly as `api.ts` does. */
function pinnedProductionShapedGraph(): object {
  return wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator: ids,
    clock,
    prisma: {} as unknown as Database,
    tenantId: "tenant-local",
  });
}

describe("TENANT_PIN_EXEMPTIONS", () => {
  it("is exactly one entry — services/tenancy — carrying the ADR-0014 8f reason", () => {
    expect(TENANT_PIN_EXEMPTIONS).toHaveLength(1);
    const [only] = TENANT_PIN_EXEMPTIONS;
    expect(only?.context).toBe("services/tenancy");
    expect(only?.reason).toContain("8f");
    expect(Object.isFrozen(TENANT_PIN_EXEMPTIONS)).toBe(true);
  });

  it("names a concrete graph key — never a wildcard or a prefix", () => {
    for (const entry of TENANT_PIN_EXEMPTIONS) {
      expect(entry.graphKey).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
      expect(entry.context).not.toMatch(/[*?]/);
    }
  });
});

describe("resolver chain probe", () => {
  it("accepts the real claim → header chain", () => {
    expect(collectMultiTenantFailures({ resolvers: realChain, graph: {} })).toEqual([]);
  });

  it("rejects the single-tenant pinned resolver", () => {
    const failures = collectMultiTenantFailures({
      resolvers: [singleTenantGuardedResolver("tenant-local")],
      graph: {},
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("resolver-chain");
  });

  it("rejects an empty chain", () => {
    expect(collectMultiTenantFailures({ resolvers: [], graph: {} })[0]).toContain("resolver-chain");
  });

  it("rejects a chain that falls back to a default when nothing resolves", () => {
    const defaulting: TenantResolver = (input) =>
      headerTenantResolver(input) ?? claimTenantResolver(input) ?? "tenant-local";
    const failures = collectMultiTenantFailures({ resolvers: [defaulting], graph: {} });
    expect(failures[0]).toContain("resolver-chain");
    expect(failures[0]).toContain("unresolved");
  });
});

describe("construction-time tenant scan", () => {
  it("finds a pinned repository anywhere in the graph, with its path", () => {
    const graph = { orders: { controller: { repo: { deps: { tenantId: "tenant-local" } } } } };
    expect(findConstructionTimeTenants(graph)).toEqual(["orders.controller.repo.deps.tenantId"]);
  });

  it("survives cycles", () => {
    const a: Record<string, unknown> = {};
    a["self"] = a;
    a["repo"] = { tenantId: "t" };
    expect(findConstructionTimeTenants(a)).toEqual(["repo.tenantId"]);
  });

  it("does not treat aggregate rows held in a Map as pins", () => {
    const graph = { store: { rows: new Map([["k", { tenantId: "t" }]]) } };
    expect(findConstructionTimeTenants(graph)).toEqual([]);
  });
});

describe("assertMultiTenantReady", () => {
  it("fails closed on a deliberately pinned graph and names every failed check in one error", () => {
    let message = "";
    try {
      assertMultiTenantReady({
        resolvers: [singleTenantGuardedResolver("tenant-local")],
        graph: { orders: { repo: { tenantId: "tenant-local" } } },
      });
    } catch (error) {
      message = (error as Error).message;
    }
    // Printed so the proof is visible in the test log (T10.4 evidence).
    console.warn(message);
    expect(message).toContain("2 checks failed");
    expect(message).toContain("resolver-chain");
    expect(message).toContain("construction-time-tenant");
    expect(message).toContain("orders.repo.tenantId");
  });

  it("passes on the real production-shaped graph ONLY because of the tenancy exemption", () => {
    const graph = pinnedProductionShapedGraph();
    expect(() => assertMultiTenantReady({ resolvers: realChain, graph })).not.toThrow();

    // Remove the exemption: tenancy — and only tenancy — is reported.
    const failures = collectMultiTenantFailures({
      resolvers: realChain,
      graph,
      exemptions: [],
    });
    expect(failures).toHaveLength(1);
    const paths = findConstructionTimeTenants(graph, []);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(path.startsWith("tenancy.")).toBe(true);
  });

  it("does not exempt a second context that pins a tenant", () => {
    const graph = {
      ...pinnedProductionShapedGraph(),
      orders: { repo: { tenantId: "tenant-local" } },
    };
    expect(() => assertMultiTenantReady({ resolvers: realChain, graph })).toThrow(
      /orders\.repo\.tenantId/,
    );
  });
});

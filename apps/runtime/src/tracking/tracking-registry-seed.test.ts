import { describe, expect, it } from "vitest";
import { SEED_DESTINATIONS, SEED_MAPPING_PROFILES } from "@platform/tracking";
import {
  DEFAULT_RULE_SET_KEY,
  defaultRoutingRuleSet,
  seedTrackingRegistry,
} from "./tracking-registry-seed";
import {
  loadTrackingRegistry,
  type PrismaTrackingRegistryStore,
  type TrackingRegistryRow,
} from "./tracking-registry";

/** An append-only store double with the same per-tenant shape as the Prisma store. */
function memoryStore(initial: readonly (TrackingRegistryRow & { tenantId: string })[] = []) {
  const rows = [...initial];
  const store = {
    count: async (tenantId: string) => rows.filter((r) => r.tenantId === tenantId).length,
    loadAll: async (tenantId: string) => rows.filter((r) => r.tenantId === tenantId),
    append: async (input: TrackingRegistryRow & { tenantId: string; at: Date }) => {
      rows.push(input);
    },
  };
  return { store: store as unknown as PrismaTrackingRegistryStore, rows };
}

const at = new Date("2026-10-18T00:00:00.000Z");

describe("defaultRoutingRuleSet", () => {
  it("routes commerce events to every destination, one rule each, failing closed", () => {
    const ruleSet = defaultRoutingRuleSet([{ key: "meta" }, { key: "tiktok" }] as never);
    expect(ruleSet).toMatchObject({
      id: DEFAULT_RULE_SET_KEY,
      version: 1,
      mode: "all_matches",
      onError: "fail_closed",
    });
    expect(ruleSet.rules.map((r) => [r.id, r.priority, r.then])).toEqual([
      ["route.meta", 1, "meta"],
      ["route.tiktok", 2, "tiktok"],
    ]);
    expect(ruleSet.rules[0]?.description).toBe("Forward commerce events to meta");
  });

  it("defaults to the seed destinations", () => {
    expect(defaultRoutingRuleSet().rules).toHaveLength(SEED_DESTINATIONS.length);
  });
});

describe("seedTrackingRegistry", () => {
  it("writes every mapping, destination and the default rule set as version 1", async () => {
    const { store, rows } = memoryStore();
    const result = await seedTrackingRegistry({ store, tenantId: "tenant-a", at });

    expect(result).toEqual({
      destinations: SEED_DESTINATIONS.length,
      mappings: SEED_MAPPING_PROFILES.length,
      ruleSets: 1,
    });
    expect(rows).toHaveLength(SEED_DESTINATIONS.length + SEED_MAPPING_PROFILES.length + 1);
    expect(rows.every((r) => r.version === 1 && r.status === "active")).toBe(true);
    expect(rows.every((r) => r.tenantId === "tenant-a")).toBe(true);
    // Mappings land before the destinations that reference them.
    expect(rows[0]?.kind).toBe("mapping");
    expect(rows.at(-1)).toMatchObject({ kind: "rule_set", key: DEFAULT_RULE_SET_KEY });
  });

  it("produces a registry that loads with version parity and routes by the default rule set", async () => {
    const { store } = memoryStore();
    await seedTrackingRegistry({ store, tenantId: "tenant-a", at });

    const snapshot = await loadTrackingRegistry(store, "tenant-a");
    expect(snapshot.listActive()).toHaveLength(SEED_DESTINATIONS.length);
    expect(snapshot.ruleSet()).toEqual({ id: DEFAULT_RULE_SET_KEY, version: 1 });
    for (const destination of SEED_DESTINATIONS) {
      expect(snapshot.destinationVersion(destination.key)).toBe(1);
      expect(snapshot.mappingVersion(destination.mappingProfileKey)).toBe(1);
    }
  });

  it("refuses to seed a tenant whose registry already holds definitions", async () => {
    const { store, rows } = memoryStore([
      {
        tenantId: "tenant-a",
        kind: "destination",
        key: "meta",
        version: 1,
        status: "retired",
        value: {},
      },
    ]);
    await expect(seedTrackingRegistry({ store, tenantId: "tenant-a", at })).rejects.toThrow(
      'tracking: registry for tenant "tenant-a" already holds 1 definition(s) — seeding would ' +
        "duplicate them; register new versions instead",
    );
    expect(rows).toHaveLength(1);
  });

  it("seeds one tenant without being blocked by another tenant's rows", async () => {
    const { store, rows } = memoryStore([
      {
        tenantId: "tenant-b",
        kind: "destination",
        key: "meta",
        version: 1,
        status: "active",
        value: {},
      },
    ]);
    await seedTrackingRegistry({ store, tenantId: "tenant-a", at });
    expect(rows.filter((r) => r.tenantId === "tenant-a").length).toBeGreaterThan(0);
  });
});
